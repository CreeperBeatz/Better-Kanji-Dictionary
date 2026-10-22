"""The map: every kanji in a scope, where its meanings put it.

GET /api/map/{scope} returns one scope as columns rather than objects --
repeating every key per kanji would triple the payload. Each kanji sits where
data/meaning_map.json (pipeline/meaning_map.py) puts it, with its cluster; the
client only spreads them so none overlap. Kanji only: parts like 氵 have no
meanings to place them by.

Scopes follow the graph filter:

  5 .. 1   JLPT N5 and easier .. N1 and easier
  common   the newspaper-ranked kanji
  all      every kanji the meaning map places
"""

import functools
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import bg_overlay
from ..db import query

router = APIRouter(prefix="/api/map", tags=["map"])

SCOPES = {"5", "4", "3", "2", "1", "common", "all"}

MEANING_MAP = Path(__file__).parent.parent.parent / "data" / "meaning_map.json"


@functools.cache
def _build(scope: str) -> dict:
    mm = json.loads(MEANING_MAP.read_text(encoding="utf-8"))
    xy = mm["layouts"][scope]
    rows = {
        r["char"]: r
        for r in query(
            "SELECT k.char, k.freq, k.jlpt, k.joyo, k.strokes, k.meanings, kb.meanings AS meanings_bg "
            "FROM kanji k LEFT JOIN kanji_bg kb ON kb.char = k.char"
        )
    }
    # Frequent last, so the client draws (and labels) the important ones last
    # and on top without sorting.
    chars = sorted((c for c in xy if c in rows), key=lambda c: (rows[c]["freq"] or 99999, c), reverse=True)

    meanings, meanings_bg = [], []
    for c in chars:
        m = json.loads(rows[c]["meanings"] or "[]")
        meanings.append(m[0] if m else "")
        b = bg_overlay.kanji(c, rows[c]["meanings_bg"]) or []
        meanings_bg.append(b[0] if b else "")

    return {
        "scope": scope,
        "chars": chars,
        "freq": [rows[c]["freq"] for c in chars],
        "jlpt": [rows[c]["jlpt"] for c in chars],
        "joyo": [1 if rows[c]["joyo"] else 0 for c in chars],
        "strokes": [rows[c]["strokes"] for c in chars],
        "meaning": meanings,
        "meaningBg": meanings_bg,
        # flat x,y per kanji, in t-SNE's units: the client scales them to its sizes
        "xy": [v for c in chars for v in xy[c]],
        # cluster id per kanji, -1 = in none
        "cluster": [mm["cluster"].get(c, -1) for c in chars],
        # per cluster its name, and `near`: a digit per cluster, 3 itself, 2 near, 1 related, 0 not
        "clusters": mm["clusters"],
    }


@router.get("/{scope}")
def get_map(scope: str) -> dict:
    if scope not in SCOPES:
        raise HTTPException(400, f"scope must be one of {sorted(SCOPES)}")
    return _build(scope)
