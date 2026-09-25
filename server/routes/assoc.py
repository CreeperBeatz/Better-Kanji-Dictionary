"""Associations: notes, sketches and images, layered by author.

A note is on a subject: one character, or a dictionary word as `word:<id>`
(its JMdict entry number, which stays put across dictionary releases).

Reading works signed out (you see public notes); writing needs an account.
Signed-out notes live in the browser and never come here until you sign in.
Image names are unguessable, and fetching one needs no session, because an
<img> tag cannot send one -- so a private note's images are private only in
the sense that nobody else is told their names.
"""

import json
import re
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .. import kanjify as kanjifier
from .. import semantic, store
from ..errors import AppError
from ..db import query, query_one
from .auth import optional_user, require_user
from .gifs import is_gif_url

router = APIRouter(prefix="/api/assoc", tags=["associations"])

ALLOWED_IMAGE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
# Scenes embed any pasted images as data URLs, so they can outgrow the PNG.
MAX_SCENE_BYTES = 32 * 1024 * 1024


WORD_SUBJECT = re.compile(r"word:(\d{1,10})")


def subject_or_400(subject: str) -> str:
    """The subject if it is one a note can be on, a 400 otherwise."""
    if len(subject) == 1:
        return subject
    m = WORD_SUBJECT.fullmatch(subject)
    if m and query_one("SELECT 1 FROM word WHERE id = ?", (int(m[1]),)):
        return subject
    raise HTTPException(400, "expected a single character or a word as word:<id>")


def _parts(subject: str) -> list[str]:
    """What a subject is built from: a character's components, a word's kanji."""
    m = WORD_SUBJECT.fullmatch(subject)
    if not m:
        return [r["child"] for r in query("SELECT child FROM edge WHERE parent = ? ORDER BY child", (subject,))]
    row = query_one("SELECT headword FROM word WHERE id = ?", (int(m[1]),))
    headword = row["headword"] if row else ""
    return [c for c in dict.fromkeys(headword) if "一" <= c <= "鿿" or "㐀" <= c <= "䶿"]


@router.get("/stats")
def stats() -> dict:
    return store.counts()


@router.get("/for/{char}")
def get_for(
    char: str,
    withComponents: bool = Query(True),
    user: dict | None = Depends(optional_user),
) -> dict:
    """This subject's notes, plus your notes on each of its parts.

    The part notes are what make a mnemonic assemble itself: looking at 語
    should show whatever you already wrote about 言 and 吾, and 水道 what you
    wrote about 水 and 道. Every part is listed, noted or not, so a signed-out
    browser can fill in its own.
    """
    char = subject_or_400(char)

    viewer = user["id"] if user else None
    result: dict = {"char": char, "own": store.for_char(char, viewer), "components": []}

    if withComponents:
        for part in _parts(char):
            notes = store.for_char(part, viewer, only_mine=True) if viewer else []
            result["components"].append({"char": part, "notes": notes})

    return result


MAX_TEXT = 20000


def _content(payload: dict) -> tuple[str, list[str]]:
    text = (payload.get("text") or "").strip()
    if len(text) > MAX_TEXT:
        raise AppError(400, "note_too_long", f"a note is at most {MAX_TEXT} characters", max=MAX_TEXT)
    images = [i for i in (payload.get("images") or []) if isinstance(i, str)]
    # Only names this server handed out, never paths -- or a GIF on KLIPY's
    # servers, which may not be copied here (routes/gifs.py).
    if any(not is_gif_url(i) and (Path(i).name != i or not (store.IMAGES / i).is_file()) for i in images):
        raise AppError(400, "image_unknown", "unknown image")
    if not text and not images:
        raise AppError(400, "note_empty", "a note needs some text or a picture")
    return text, images


def _visibility(payload: dict, default: str | None) -> str | None:
    visibility = payload.get("visibility", default)
    if visibility is not None and visibility not in store.VISIBILITIES:
        raise HTTPException(400, "visibility must be private or public")
    return visibility


@router.post("/for/{char}")
def post_for(char: str, payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    """Post a new note on this subject; it joins any you already have."""
    char = subject_or_400(char)
    text, images = _content(payload)
    return store.create(char, text, images, user["id"], _visibility(payload, "private"))


@router.post("/kanjify")
def kanjify(payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    """An association with the characters of its subject marked after the
    words that stand for them (server/kanjify.py). The subject is how the
    kanji or word is written."""
    subject = str(payload.get("subject") or "").strip()
    text = str(payload.get("text") or "")
    if not subject or len(subject) > 20 or not text.strip():
        raise HTTPException(400, "a subject and a text are needed")
    if len(text) > kanjifier.MAX_TEXT:
        raise AppError(400, "kanjify_too_long", f"Kanjify takes at most {kanjifier.MAX_TEXT} characters",
                       max=kanjifier.MAX_TEXT)
    try:
        return {"text": kanjifier.kanjify(subject, text)}
    except semantic.Off:
        raise AppError(503, "kanjify_off", "Kanjify is not set up on this server")
    except (semantic.Unavailable, kanjifier.Garbled) as e:
        print(f"[kanjify] {subject} {text[:80]!r}: {e}", flush=True)
        raise AppError(503, "kanjify_unavailable", "Kanjify could not do this one right now")


@router.patch("/{assoc_id}")
def edit(assoc_id: str, payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    """Change a note of yours: its text and pictures, its visibility, or both."""
    text = images = None
    if "text" in payload or "images" in payload:
        text, images = _content(payload)
    try:
        return store.update(assoc_id, user["id"], text, images, _visibility(payload, None))
    except store.NotFound:
        raise AppError(404, "assoc_not_found", "no such association")
    except store.Forbidden:
        raise AppError(403, "assoc_not_yours", "that association is not yours")


@router.delete("/{assoc_id}")
def remove(assoc_id: str, user: dict = Depends(require_user)) -> dict:
    try:
        store.delete(assoc_id, user["id"])
    except store.NotFound:
        raise AppError(404, "assoc_not_found", "no such association")
    except store.Forbidden:
        raise AppError(403, "assoc_not_yours", "that association is not yours")
    return {"id": assoc_id, "deleted": True}


@router.post("/adopt/{assoc_id}")
def adopt(assoc_id: str, user: dict = Depends(require_user)) -> dict:
    rec = store.adopt(assoc_id, user["id"])
    if rec is None:
        raise AppError(404, "assoc_not_adoptable", "no such association, or it is already yours")
    return rec


@router.post("/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(require_user)) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE:
        raise AppError(400, "image_type", f"unsupported image type {suffix!r}", type=suffix)
    raw = await file.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise AppError(413, "image_too_big", "image larger than 8MB")
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
        raise AppError(413, "drawing_too_big", "drawing larger than 8MB")
    if not raw.startswith(b"\x89PNG"):
        raise AppError(400, "drawing_not_png", "drawing is not a PNG")
    scene_raw = await scene.read()
    if len(scene_raw) > MAX_SCENE_BYTES:
        raise AppError(413, "scene_too_big", "scene larger than 32MB")
    try:
        parsed = json.loads(scene_raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise AppError(400, "scene_invalid", f"scene is not valid JSON: {e}")
    if not isinstance(parsed, dict) or parsed.get("type") != "excalidraw":
        raise AppError(400, "scene_not_excalidraw", "scene is not an Excalidraw file")
    name = store.add_drawing(raw, scene_raw.decode("utf-8"))
    return {"name": name, "url": f"/api/assoc/image/{name}"}


@router.get("/scene/{name}")
def get_scene(name: str):
    """The Excalidraw scene behind a drawing, looked up by the drawing's PNG name."""
    path = store.scene_path(Path(name).name)
    if not path.exists():
        raise AppError(404, "scene_not_found", "no scene for that image")
    return FileResponse(path, media_type="application/json")


@router.get("/image/{name}")
def get_image(name: str):
    # Name comes from the store, but never trust it as a path.
    safe = Path(name).name
    path = store.IMAGES / safe
    if not path.exists():
        raise AppError(404, "image_not_found", "no such image")
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
        raise AppError(400, "bundle_invalid", f"not a valid bundle: {e}")
    if not isinstance(bundle, dict) or "associations" not in bundle:
        raise AppError(400, "bundle_empty", "bundle has no associations")
    return store.import_bundle(bundle, owner=user["id"], author_name=name)
