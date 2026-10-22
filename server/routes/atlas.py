"""The map: every kanji in a scope, where its meanings put it.

GET /api/map/{scope} returns one scope as columns rather than objects --
repeating every key per kanji would triple the payload. Each kanji sits where
data/meaning_map.json (pipeline/meaning_map.py) puts it, with its cluster; the
client only spreads them so none overlap. Kanji only: parts like 氵 have no
meanings to place them by. The map by parts -- a force layout over the
decomposition, with parts as nodes -- was removed on 2026-10-22 (Dani: "let it
be only meaning").

Scopes follow the graph filter:

  5 .. 1   JLPT N5 and easier .. N1 and easier
  common   the newspaper-ranked kanji
  all      every kanji the meaning map places

GET /api/map/group/{name} is one cluster's kanji, by its English name, as the
search's kanji results, the most frequent first: what the search lists when a
group is opened from the map card or a kanji's page.
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

_cache: dict[str, dict] = {}


@functools.cache
def _meaning_map() -> dict:
    return json.loads(MEANING_MAP.read_text(encoding="utf-8"))


def _build(scope: str) -> dict:
    mm = _meaning_map()
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
        "clusters": mm["clusters"],
        "regions": mm["regions"],
    }


@router.get("/group/{name}")
def get_group(name: str) -> dict:
    from .search import _kanji_hits

    mm = _meaning_map()
    k = next((i for i, c in enumerate(mm["clusters"]) if c["en"] == name), -1)
    if k < 0:
        raise HTTPException(404, f"no group named {name!r} on the map")
    hits = _kanji_hits([c for c, kk in mm["cluster"].items() if kk == k])
    hits.sort(key=lambda h: (h["freq"] is None, h["freq"] or 0, h["char"]))
    return {"group": {"en": mm["clusters"][k]["en"], "bg": mm["clusters"][k]["bg"]}, "kanji": hits}


@router.get("/{scope}")
def get_map(scope: str) -> dict:
    if scope not in SCOPES:
        raise HTTPException(400, f"scope must be one of {sorted(SCOPES)}")
    if scope not in _cache:
        _cache[scope] = _build(scope)
    return _cache[scope]
