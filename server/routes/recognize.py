"""Handwriting lookup.

The matcher lives in server/recognize.py; this is just the wire format. Ink
arrives in whatever coordinates the canvas used -- the matcher normalises it --
so the client never has to agree with the server about canvas size.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import recognize as engine

router = APIRouter(prefix="/api/recognize", tags=["recognize"])

MAX_STROKES = engine.MAX_STROKES
MAX_POINTS = 400  # per stroke; only the first and last are used


class Ink(BaseModel):
    strokes: list[list[tuple[float, float]]] = Field(default_factory=list)
    window: int = engine.STROKE_WINDOW
    limit: int = engine.MAX_RESULTS


@router.post("")
def recognise(ink: Ink) -> dict:
    if len(ink.strokes) > MAX_STROKES:
        raise HTTPException(400, f"at most {MAX_STROKES} strokes")
    strokes = [[list(p) for p in s[:MAX_POINTS]] for s in ink.strokes if s]
    if not strokes:
        return {"candidates": [], "strokes": 0}

    candidates = engine.recognise(
        strokes,
        window=max(0, min(6, ink.window)),
        limit=max(1, min(60, ink.limit)),
    )
    return {"candidates": candidates, "strokes": len(strokes)}


@router.get("/ready")
def ready() -> dict:
    """Build the reference index if it is not built yet.

    Worth ~1.5s on first use, so the client calls this when the draw panel
    opens rather than paying for it on the first stroke.
    """
    buckets = engine.index()
    return {
        "chars": sum(len(v) for v in buckets.values()),
        "buckets": len(buckets),
    }
