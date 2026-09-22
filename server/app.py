"""BetterRTK Explorer -- local API server.

Run:
    .venv/Scripts/uvicorn server.app:app --reload --host 0.0.0.0 --port 8000

Bound to 0.0.0.0 so a phone on the same network can reach it. Writing notes
needs a magic-link sign-in; with no RESEND_API_KEY the link is shown in the page
rather than mailed, so anyone who can reach this can sign in as anyone. Keep it
off untrusted networks until real mail is configured.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import DatabaseMissing
from .routes import assoc, atlas, auth, decomp, graph, radicals, recognize, search

app = FastAPI(
    title="BetterRTK Explorer",
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
app.include_router(decomp.router)
app.include_router(recognize.router)


@app.get("/api/health")
def health() -> dict:
    from .db import query_one

    row = query_one("SELECT COUNT(*) AS n FROM radical")
    return {"status": "ok", "radicals": row["n"]}


# The built frontend (`npm run build` in web/), when present. Unknown non-API
# paths fall back to index.html, which is how `/?login=...` links land.
DIST = Path(__file__).parent.parent / "web" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        file = (DIST / path).resolve()
        if path and file.is_file() and file.is_relative_to(DIST.resolve()):
            return FileResponse(file)
        return FileResponse(DIST / "index.html")
