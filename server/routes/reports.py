"""Reports over HTTP (server/reports.py): signed-in users send them, the admin lists and closes them."""

import json

from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse

from .. import reports
from ..errors import AppError
from .auth import require_role, require_user

router = APIRouter(prefix="/api/reports", tags=["reports"])

admin = require_role("admin")


@router.post("")
async def send(
    text: str = Form(...),
    subject: str | None = Form(None),
    context: str | None = Form(None, description="JSON: what the page said about itself"),
    files: list[UploadFile] = File(default=[]),
    me: dict = Depends(require_user),
) -> dict:
    if len(files) > reports.MAX_FILES:
        raise AppError(400, "report_files", "up to {n} pictures", n=reports.MAX_FILES)
    raw = []
    for f in files:
        # One byte over the limit is enough to know it is too big.
        b = await f.read(reports.MAX_FILE_BYTES + 1)
        if b:
            raw.append(b)
    try:
        ctx = json.loads(context) if context else None
    except ValueError:
        ctx = None
    r = reports.add(me["id"], text, subject, ctx, raw)
    return {"id": r["id"], "status": r["status"]}


@router.get("/mine")
def mine(me: dict = Depends(require_user)) -> dict:
    return reports.mine(me["id"])


@router.get("/open-count")
def open_count(_: dict = Depends(admin)) -> dict:
    return {"open": reports.open_count()}


@router.get("")
def listing(
    status: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: dict = Depends(admin),
) -> dict:
    return reports.listing(status, limit, offset)


@router.post("/{report_id}/status")
def set_status(report_id: str, payload: dict = Body(...), me: dict = Depends(admin)) -> dict:
    return {"report": reports.set_status(report_id, payload.get("status", ""), payload.get("reply"), me["id"])}


@router.get("/{report_id}/files/{name}")
def picture(report_id: str, name: str, me: dict = Depends(require_user)) -> FileResponse:
    path, kind = reports.file_path(report_id, name, me)
    return FileResponse(path, media_type=kind, headers={"Cache-Control": "private, max-age=86400"})
