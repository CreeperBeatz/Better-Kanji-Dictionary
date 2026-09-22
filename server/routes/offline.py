"""The offline lookup pack, for an installed app to download once.

    GET /api/offline/manifest            what the current pack is made of
    GET /api/offline/{version}/{name}    one file of it, gzipped on disk

Files are addressed by version, so each URL's content never changes and can
be cached for good; a new database means a new version and new URLs. The
pack itself is built by server/offline.py.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from .. import offline

router = APIRouter(prefix="/api/offline", tags=["offline"])

NO_STORE = {"Cache-Control": "no-store"}


@router.get("/manifest")
def manifest():
    m = offline.current()
    if m is None:
        offline.ensure_async()
        # 503 and not 404: the client should come back, not give up.
        return JSONResponse(status_code=503, content={"building": True, **offline.status()}, headers=NO_STORE)
    return JSONResponse(
        {
            "version": m["version"],
            "built": m["built"],
            "files": [{"name": f["name"], "bytes": f["bytes"], "gz": f["gz"]} for f in m["files"]],
        },
        headers=NO_STORE,
    )


@router.get("/{version}/{name}")
def pack_file(version: str, name: str):
    path = offline.file_path(version, name)
    if path is None:
        raise HTTPException(404, "no such pack file")
    return FileResponse(
        path,
        media_type="application/json" if name.endswith(".json") else "application/octet-stream",
        # Already compressed, so the gzip middleware leaves it alone and the
        # browser inflates it on the way in.
        headers={"Content-Encoding": "gzip", "Cache-Control": "public, max-age=31536000, immutable"},
    )
