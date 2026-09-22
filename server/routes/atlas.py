"""The whole-set map: every character in a scope and the edges between them.

GET /api/map/{scope} returns one scope as columns rather than objects -- at
"all" that is 13k nodes, and repeating every key per node would triple the
payload. The client lays it out itself (a force simulation in a worker), so the
server only answers "which characters, and what is inside what".

Scopes follow the graph filter:

  5 .. 1   JLPT N5 and easier .. N1 and easier, plus every part they are built
           from, whatever its level -- the parts are not optional
  common   the 2,501 newspaper-ranked characters, plus their parts
  all      everything in the graph
"""

import json

from fastapi import APIRouter, HTTPException

from .. import store
from ..db import query

router = APIRouter(prefix="/api/map", tags=["map"])

SCOPES = {"5", "4", "3", "2", "1", "common", "all"}

# Keyed on the override set, so fixing a decomposition invalidates it.
_cache: dict[tuple[str, str], dict] = {}


def _children() -> dict[str, list[str]]:
    """The full containment table with overrides substituted, in one pass.

    Cheaper than children_of() for this: that issues one IN (...) query per
    frontier, and a 13k-character frontier is most of the table anyway.
    """
    kids: dict[str, list[str]] = {}
    for r in query("SELECT parent, child FROM edge"):
        kids.setdefault(r["parent"], []).append(r["child"])
    kids.update({p: list(c) for p, c in store.decomposition_overrides().items()})
    return kids


def _build(scope: str) -> dict:
    kids = _children()
    rows = {
        r["char"]: r
        for r in query(
            "SELECT k.char, k.freq, k.jlpt, k.joyo, k.strokes, k.meanings, "
            "COALESCE(f.joyo_count, 0) AS fanout "
            "FROM kanji k LEFT JOIN fanout f ON f.char = k.char"
        )
    }

    if scope == "all":
        targets = set(rows) | set(kids)
    elif scope == "common":
        targets = {c for c, r in rows.items() if r["freq"] is not None}
    else:
        level = int(scope)
        targets = {c for c, r in rows.items() if r["jlpt"] is not None and r["jlpt"] >= level}

    # Close downward: a level's kanji drag in their parts.
    members = set(targets)
    frontier = list(targets)
    while frontier:
        nxt = []
        for c in frontier:
            for k in kids.get(c, ()):
                if k not in members:
                    members.add(k)
                    nxt.append(k)
        frontier = nxt

    # Frequent first, so the client draws (and labels) the important ones last
    # and on top without sorting.
    def rank(c: str) -> tuple:
        r = rows.get(c)
        freq = r["freq"] if r and r["freq"] is not None else 99999
        fan = r["fanout"] if r else 0
        return (-(fan >= 8), freq, -fan, c)

    chars = sorted(members, key=rank, reverse=True)
    index = {c: i for i, c in enumerate(chars)}

    edges: list[int] = []
    for parent in chars:
        for child in kids.get(parent, ()):
            j = index.get(child)
            if j is not None and child != parent:
                edges += [index[parent], j]

    def col(name: str, default=None):
        return [rows[c][name] if c in rows else default for c in chars]

    meanings = []
    for c in chars:
        m = json.loads(rows[c]["meanings"] or "[]") if c in rows else []
        meanings.append(m[0] if m else "")

    return {
        "scope": scope,
        "chars": chars,
        "freq": col("freq"),
        "jlpt": col("jlpt"),
        "joyo": [1 if c in rows and rows[c]["joyo"] else 0 for c in chars],
        "fanout": col("fanout", 0),
        "strokes": col("strokes"),
        "meaning": meanings,
        # 1 = in the scope in its own right, 0 = pulled in only as a part
        "target": [1 if c in targets else 0 for c in chars],
        "edges": edges,
        "counts": {"nodes": len(chars), "targets": len(targets), "edges": len(edges) // 2},
    }


@router.get("/{scope}")
def get_map(scope: str) -> dict:
    if scope not in SCOPES:
        raise HTTPException(400, f"scope must be one of {sorted(SCOPES)}")
    key = (scope, json.dumps(store.decomposition_overrides(), sort_keys=True))
    if key not in _cache:
        _cache[key] = _build(scope)
    return _cache[key]
