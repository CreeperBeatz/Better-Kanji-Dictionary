"""BetterRTK Explorer -- local API server.

Run:
    .venv/Scripts/uvicorn server.app:app --reload --host 0.0.0.0 --port 8000

Bound to 0.0.0.0 so a phone on the same network can reach it; there is no auth,
so keep it off untrusted networks.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import DatabaseMissing
from .routes import assoc, decomp, graph, radicals, recognize, search

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


@app.exception_handler(DatabaseMissing)
async def db_missing_handler(request, exc: DatabaseMissing):
    return JSONResponse(status_code=503, content={"error": "database_missing", "detail": str(exc)})


app.include_router(radicals.router)
app.include_router(graph.router)
app.include_router(search.router)
app.include_router(assoc.router)
app.include_router(decomp.router)
app.include_router(recognize.router)


@app.get("/api/health")
def health() -> dict:
    from .db import query_one

    row = query_one("SELECT COUNT(*) AS n FROM radical")
    return {"status": "ok", "radicals": row["n"]}
