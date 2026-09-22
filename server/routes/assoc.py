"""Associations: notes, sketches and images, layered by author.

Reading works signed out (you see public notes); writing needs an account.
Signed-out notes live in the browser and never come here until you sign in.
Image names are unguessable, and fetching one needs no session, because an
<img> tag cannot send one -- so a private note's images are private only in
the sense that nobody else is told their names.
"""

import json
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .. import store
from ..db import query
from .auth import optional_user, require_user

router = APIRouter(prefix="/api/assoc", tags=["associations"])

ALLOWED_IMAGE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
# Scenes embed any pasted images as data URLs, so they can outgrow the PNG.
MAX_SCENE_BYTES = 32 * 1024 * 1024


@router.get("/stats")
def stats() -> dict:
    return store.counts()


@router.get("/for/{char}")
def get_for(
    char: str,
    withComponents: bool = Query(True),
    user: dict | None = Depends(optional_user),
) -> dict:
    """This character's notes, plus your notes on each of its components.

    The component notes are what make a mnemonic assemble itself: looking at 語
    should show whatever you already wrote about 言 and 吾. Every component is
    listed, noted or not, so a signed-out browser can fill in its own.
    """
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")

    viewer = user["id"] if user else None
    result: dict = {"char": char, "own": store.for_char(char, viewer), "components": []}

    if withComponents:
        rows = query("SELECT child FROM edge WHERE parent = ? ORDER BY child", (char,))
        for r in rows:
            notes = store.for_char(r["child"], viewer, only_mine=True) if viewer else []
            result["components"].append({"char": r["child"], "notes": notes})

    return result


MAX_TEXT = 20000


def _content(payload: dict) -> tuple[str, list[str]]:
    text = (payload.get("text") or "").strip()
    if len(text) > MAX_TEXT:
        raise HTTPException(400, f"a note is at most {MAX_TEXT} characters")
    images = [i for i in (payload.get("images") or []) if isinstance(i, str)]
    # Only names this server handed out, never paths.
    if any(Path(i).name != i or not (store.IMAGES / i).is_file() for i in images):
        raise HTTPException(400, "unknown image")
    if not text and not images:
        raise HTTPException(400, "a note needs some text or a picture")
    return text, images


def _visibility(payload: dict, default: str | None) -> str | None:
    visibility = payload.get("visibility", default)
    if visibility is not None and visibility not in store.VISIBILITIES:
        raise HTTPException(400, "visibility must be private or public")
    return visibility


@router.post("/for/{char}")
def post_for(char: str, payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    """Post a new note on this character; it joins any you already have."""
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")
    text, images = _content(payload)
    return store.create(char, text, images, user["id"], _visibility(payload, "private"))


@router.patch("/{assoc_id}")
def edit(assoc_id: str, payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    """Change a note of yours: its text and pictures, its visibility, or both."""
    text = images = None
    if "text" in payload or "images" in payload:
        text, images = _content(payload)
    try:
        return store.update(assoc_id, user["id"], text, images, _visibility(payload, None))
    except store.NotFound:
        raise HTTPException(404, "no such association")
    except store.Forbidden:
        raise HTTPException(403, "that association is not yours")


@router.delete("/{assoc_id}")
def remove(assoc_id: str, user: dict = Depends(require_user)) -> dict:
    try:
        store.delete(assoc_id, user["id"])
    except store.NotFound:
        raise HTTPException(404, "no such association")
    except store.Forbidden:
        raise HTTPException(403, "that association is not yours")
    return {"id": assoc_id, "deleted": True}


@router.post("/adopt/{assoc_id}")
def adopt(assoc_id: str, user: dict = Depends(require_user)) -> dict:
    rec = store.adopt(assoc_id, user["id"])
    if rec is None:
        raise HTTPException(404, "no such association, or it is already yours")
    return rec


@router.post("/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(require_user)) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE:
        raise HTTPException(400, f"unsupported image type {suffix!r}")
    raw = await file.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "image larger than 8MB")
    name = store.add_image(raw, suffix)
    return {"name": name, "url": f"/api/assoc/image/{name}"}


@router.post("/drawing")
async def upload_drawing(
    png: UploadFile = File(...),
    scene: UploadFile = File(...),
    user: dict = Depends(require_user),
) -> dict:
    """A drawing is saved twice: the PNG to look at, the scene to keep editing."""
    raw = await png.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "drawing larger than 8MB")
    if not raw.startswith(b"\x89PNG"):
        raise HTTPException(400, "drawing is not a PNG")
    scene_raw = await scene.read()
    if len(scene_raw) > MAX_SCENE_BYTES:
        raise HTTPException(413, "scene larger than 32MB")
    try:
        parsed = json.loads(scene_raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(400, f"scene is not valid JSON: {e}")
    if not isinstance(parsed, dict) or parsed.get("type") != "excalidraw":
        raise HTTPException(400, "scene is not an Excalidraw file")
    name = store.add_drawing(raw, scene_raw.decode("utf-8"))
    return {"name": name, "url": f"/api/assoc/image/{name}"}


@router.get("/scene/{name}")
def get_scene(name: str):
    """The Excalidraw scene behind a drawing, looked up by the drawing's PNG name."""
    path = store.scene_path(Path(name).name)
    if not path.exists():
        raise HTTPException(404, "no scene for that image")
    return FileResponse(path, media_type="application/json")


@router.get("/image/{name}")
def get_image(name: str):
    # Name comes from the store, but never trust it as a path.
    safe = Path(name).name
    path = store.IMAGES / safe
    if not path.exists():
        raise HTTPException(404, "no such image")
    return FileResponse(path, media_type=ALLOWED_IMAGE.get(path.suffix.lower(), "application/octet-stream"))


@router.get("/export")
def export(user: dict = Depends(require_user)) -> JSONResponse:
    bundle = store.export_bundle(user["id"])
    return JSONResponse(
        bundle,
        headers={"Content-Disposition": 'attachment; filename="betterrtk-associations.json"'},
    )


@router.post("/import")
async def import_bundle(
    file: UploadFile = File(...),
    name: str | None = None,
    user: dict = Depends(require_user),
) -> dict:
    raw = await file.read()
    try:
        bundle = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(400, f"not a valid bundle: {e}")
    if not isinstance(bundle, dict) or "associations" not in bundle:
        raise HTTPException(400, "bundle has no associations")
    return store.import_bundle(bundle, owner=user["id"], author_name=name)
