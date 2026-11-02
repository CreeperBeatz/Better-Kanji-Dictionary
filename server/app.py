"""Better Kanji Dictionary -- the API server.

Run:
    .venv/Scripts/uvicorn server.app:app --reload --host 0.0.0.0 --port 8000

Bound to 0.0.0.0 so a phone on the same network can reach it. Writing notes
needs a magic-link sign-in; with no RESEND_API_KEY the link is shown in the page
rather than mailed, so anyone who can reach this can sign in as anyone. Keep it
off untrusted networks until real mail is configured.
"""

import mimetypes
import threading
import unicodedata
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import DatabaseMissing
from .errors import AppError, app_error_handler
from . import auth as accounts
from . import offline as offline_pack
from . import store
from .routes import assoc, atlas, auth, comments, decomp, gifs, graph, images, offline, recognize, reports, search

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


class NormalizeText:
    """Every API path and query in Unicode NFC, so text pasted from an old
    document finds what it means: 館 (U+FA2C, a compatibility ideograph) is
    館, and か plus a combining ゛ is が. The database holds NFC only."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            path = unicodedata.normalize("NFC", scope["path"])
            qs = scope.get("query_string", b"").decode("latin-1")
            pairs = parse_qsl(qs, keep_blank_values=True)
            fixed = [(k, unicodedata.normalize("NFC", v)) for k, v in pairs]
            if path != scope["path"] or fixed != pairs:
                scope = dict(scope, path=path, raw_path=quote(path).encode())
                if fixed != pairs:
                    scope["query_string"] = urlencode(fixed).encode()
        await self.app(scope, receive, send)


app.add_middleware(NormalizeText)


app.add_exception_handler(AppError, app_error_handler)


@app.exception_handler(DatabaseMissing)
async def db_missing_handler(request, exc: DatabaseMissing):
    return JSONResponse(status_code=503, content={"error": "database_missing", "detail": str(exc)})


app.include_router(graph.router)
app.include_router(atlas.router)
app.include_router(search.router)
app.include_router(auth.router)
app.include_router(assoc.router)
app.include_router(images.router)
app.include_router(gifs.router)
app.include_router(comments.router)
app.include_router(decomp.router)
app.include_router(reports.router)
app.include_router(recognize.router)
app.include_router(offline.router)


@app.on_event("startup")
def migrate_accounts() -> None:
    # Accounts from before usernames get one, and every author's public card
    # (name, username, picture) is brought in line with their account.
    store.sync_authors(accounts.migrate())


@app.on_event("startup")
def reviewed_bulgarian() -> None:
    # Before anything is served: pages show reviewed Bulgarian over the built text.
    from . import review as review_store

    review_store.load_bg_overlay()


@app.on_event("startup")
def old_reports() -> None:
    # What users sent through the old review queue shows among the reports (once; safe to repeat).
    from . import reports

    try:
        n = reports.import_old()
    except Exception as e:  # noqa: BLE001 -- a copy of old data must not keep the site down; the next start tries again
        print(f"[reports] old review queue not brought over: {e!r}", flush=True)
        return
    if n:
        print(f"[reports] {n} brought over from the old review queue", flush=True)


@app.on_event("startup")
def build_offline_pack() -> None:
    from . import review as review_store

    def start() -> None:
        # Changes that were still waiting for quiet when the server stopped (a deploy) go in now.
        review_store.refresh_pack_key()
        offline_pack.ensure_async()

    # In the background: a changed database means a new pack, which takes a
    # while on the Pi, and nothing else should wait for it.
    threading.Thread(target=start, name="offline-pack-key", daemon=True).start()


@app.get("/api/health")
def health() -> dict:
    from .db import query_one

    row = query_one("SELECT COUNT(*) AS n FROM kanji")
    return {"status": "ok", "kanji": row["n"]}


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
