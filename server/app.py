"""Better Kanji Dictionary -- the API server.

Run:
    .venv/Scripts/uvicorn server.app:app --reload --host 0.0.0.0 --port 8000

Bound to 0.0.0.0 so a phone on the same network can reach it. Writing notes
needs a magic-link sign-in; with no RESEND_API_KEY the link is shown in the page
rather than mailed, so anyone who can reach this can sign in as anyone. Keep it
off untrusted networks until real mail is configured.
"""

import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import DatabaseMissing
from . import auth as accounts
from . import offline as offline_pack
from . import store
from .routes import assoc, atlas, auth, comments, decomp, graph, offline, radicals, recognize, search

app = FastAPI(
    title="Better Kanji Dictionary",
    description="Kanji component graph, dictionary and handwriting lookup.",
    version="0.1.0",
)

# The Vite dev server runs on a different port; in production the built assets
# are served by this same process, so this only matters during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


# The map payload is a few hundred KB of repetitive JSON at the widest scope.
app.add_middleware(GZipMiddleware, minimum_size=2048)


@app.exception_handler(DatabaseMissing)
async def db_missing_handler(request, exc: DatabaseMissing):
    return JSONResponse(status_code=503, content={"error": "database_missing", "detail": str(exc)})


app.include_router(radicals.router)
app.include_router(graph.router)
app.include_router(atlas.router)
app.include_router(search.router)
app.include_router(auth.router)
app.include_router(assoc.router)
app.include_router(comments.router)
app.include_router(decomp.router)
app.include_router(recognize.router)
app.include_router(offline.router)


@app.on_event("startup")
def migrate_accounts() -> None:
    # Accounts from before usernames get one, and every author's public card
    # (name, username, picture) is brought in line with their account.
    store.sync_authors(accounts.migrate())


@app.on_event("startup")
def build_offline_pack() -> None:
    # In the background: a changed database means a new pack, which takes a
    # while on the Pi, and nothing else should wait for it.
    offline_pack.ensure_async()


@app.get("/api/health")
def health() -> dict:
    from .db import query_one

    row = query_one("SELECT COUNT(*) AS n FROM radical")
    return {"status": "ok", "radicals": row["n"]}


# The built frontend (`npm run build` in web/), when present. Unknown non-API
# paths fall back to index.html, which is how `/?login=...` links land.
DIST = Path(__file__).parent.parent / "web" / "dist"

# Not in every platform's table, and the install prompt wants it right.
mimetypes.add_type("application/manifest+json", ".webmanifest")

# The page and the service worker name every other file by hash, so they are
# the two that must never be served from a stale cache.
REVALIDATE = {"index.html", "sw.js", "manifest.webmanifest"}
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        file = (DIST / path).resolve()
        if path and file.is_file() and file.is_relative_to(DIST.resolve()):
            headers = {"Cache-Control": "no-cache"} if file.name in REVALIDATE else None
            return FileResponse(file, headers=headers)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
