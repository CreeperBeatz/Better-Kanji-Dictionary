"""Associations: your own notes, sketches and images, layered by author."""

import json
from pathlib import Path

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .. import store
from ..db import query

router = APIRouter(prefix="/api/assoc", tags=["associations"])

ALLOWED_IMAGE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


@router.get("/stats")
def stats() -> dict:
    return store.counts()


@router.get("/for/{char}")
def get_for(char: str, withComponents: bool = Query(True)) -> dict:
    """This character's notes, plus your notes on each of its components.

    The component notes are what make a mnemonic assemble itself: looking at 語
    should show whatever you already wrote about 言 and 吾.
    """
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")

    result: dict = {"char": char, "own": store.for_char(char), "components": []}

    if withComponents:
        rows = query("SELECT child FROM edge WHERE parent = ? ORDER BY child", (char,))
        for r in rows:
            notes = store.for_char(r["child"])
            if notes:
                result["components"].append({"char": r["child"], "notes": notes})

    return result


@router.put("/for/{char}")
def put_for(char: str, payload: dict = Body(...)) -> dict:
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")
    text = (payload.get("text") or "").strip()
    images = [i for i in (payload.get("images") or []) if isinstance(i, str)]
    if not text and not images:
        store.delete(char)
        return {"char": char, "deleted": True}
    return store.upsert(char, text, images)


@router.delete("/for/{char}")
def delete_for(char: str) -> dict:
    return {"char": char, "deleted": store.delete(char)}


@router.post("/adopt/{assoc_id}")
def adopt(assoc_id: str) -> dict:
    rec = store.adopt(assoc_id)
    if rec is None:
        raise HTTPException(404, "no such association, or it is already yours")
    return rec


@router.post("/image")
async def upload_image(file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE:
        raise HTTPException(400, f"unsupported image type {suffix!r}")
    raw = await file.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "image larger than 8MB")
    name = store.add_image(raw, suffix)
    return {"name": name, "url": f"/api/assoc/image/{name}"}


@router.get("/image/{name}")
def get_image(name: str):
    # Name comes from the store, but never trust it as a path.
    safe = Path(name).name
    path = store.IMAGES / safe
    if not path.exists():
        raise HTTPException(404, "no such image")
    return FileResponse(path, media_type=ALLOWED_IMAGE.get(path.suffix.lower(), "application/octet-stream"))


@router.get("/export")
def export() -> JSONResponse:
    bundle = store.export_bundle()
    return JSONResponse(
        bundle,
        headers={"Content-Disposition": 'attachment; filename="betterrtk-associations.json"'},
    )


@router.post("/import")
async def import_bundle(file: UploadFile = File(...), name: str | None = None) -> dict:
    raw = await file.read()
    try:
        bundle = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(400, f"not a valid bundle: {e}")
    if not isinstance(bundle, dict) or "associations" not in bundle:
        raise HTTPException(400, "bundle has no associations")
    return store.import_bundle(bundle, author_name=name)
