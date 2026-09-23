"""The component graph -- the view the whole app is built around.

GET /api/kanji/{char} returns everything one focus view needs:

  focus       the selected character and its metadata
  containers  characters that DIRECTLY contain it, one level up only,
              ordered by frequency so the client can map rank -> orbit radius
  components  its full decomposition down to atoms, as a layered DAG
              (a component can be shared between branches, so nodes + edges,
              not a tree)

Depth is assigned server-side by longest path from the focus, which is what
makes the downward layering deterministic -- shortest path would let a shared
component float up above something it is actually a part of.
"""

import json

from fastapi import APIRouter, HTTPException, Query

from .. import store
from ..db import query, query_one

router = APIRouter(prefix="/api/kanji", tags=["graph"])

MAX_DEPTH = 25


# --- user overrides are applied here, at query time.
#
# The edge table is built offline, so a decomposition you fix from the graph
# would not move anything until the next rebuild. Overriding on read keeps the
# edit immediate; the override file is still what a rebuild consumes, so the two
# never drift.


def children_of(chars: list[str]) -> dict[str, list[str]]:
    """Components of each character, with overrides substituted wholesale."""
    if not chars:
        return {}
    ov = store.decomposition_overrides()
    out: dict[str, list[str]] = {c: list(ov[c]) for c in chars if c in ov}

    stored = [c for c in chars if c not in ov]
    if stored:
        ph = ",".join("?" * len(stored))
        for r in query(f"SELECT parent, child FROM edge WHERE parent IN ({ph})", tuple(stored)):
            out.setdefault(r["parent"], []).append(r["child"])
    return out


def parents_of(char: str) -> list[str]:
    """Characters directly containing `char`, honouring overrides in both directions."""
    ov = store.decomposition_overrides()
    base = {r["parent"] for r in query("SELECT parent FROM edge WHERE child = ?", (char,))}
    # An override replaces that character's parts entirely, so it can both drop
    # an edge the table has and introduce one it does not.
    base = {p for p in base if p not in ov or char in ov[p]}
    base |= {p for p, comps in ov.items() if char in comps}
    return sorted(base)


# --- what lies above a character, however far up.
#
# The level filter keeps a container only if it is at the level itself, so a
# part between the focus and the kanji that use it -- 关 between 丷 and 送 --
# was dropped, and the way up with it. Knowing what is above each container
# lets the client keep the ones that lead somewhere at the level.

_reach_cache: tuple[object, dict[str, tuple[bool, int | None]]] | None = None


def reach() -> dict[str, tuple[bool, int | None]]:
    """For every character: is anything above it newspaper-ranked, and the
    easiest JLPT level above it (5 is easiest). Only what is strictly above;
    the character's own rank is on its node.

    Built from the whole edge table once, then again whenever the overrides
    change -- the store hands back the same dict until they do.
    """
    global _reach_cache
    ov = store.decomposition_overrides()
    cached = _reach_cache
    if cached is not None and cached[0] is ov:
        return cached[1]

    parents: dict[str, set[str]] = {}
    for r in query("SELECT parent, child FROM edge"):
        if r["parent"] not in ov:
            parents.setdefault(r["child"], set()).add(r["parent"])
    for p, comps in ov.items():
        for c in comps:
            parents.setdefault(c, set()).add(p)
    rank = {r["char"]: (r["freq"] is not None, r["jlpt"]) for r in query("SELECT char, freq, jlpt FROM kanji")}

    out: dict[str, tuple[bool, int | None]] = {}
    visiting: set[str] = set()

    def up(c: str) -> tuple[bool, int | None]:
        if c in out:
            return out[c]
        if c in visiting:  # a cycle in a hand-made override; stop there
            return (False, None)
        visiting.add(c)
        freq, jlpt = False, None
        for p in parents.get(c, ()):
            p_freq, p_jlpt = rank.get(p, (False, None))
            a_freq, a_jlpt = up(p)
            freq = freq or p_freq or a_freq
            for j in (p_jlpt, a_jlpt):
                if j is not None and (jlpt is None or j > jlpt):
                    jlpt = j
        visiting.discard(c)
        out[c] = (freq, jlpt)
        return out[c]

    for c in parents:
        up(c)
    _reach_cache = (ov, out)
    return out


def _with_reach(nodes: list[dict]) -> list[dict]:
    """Say on each container what is above it, for the level filter."""
    r = reach()
    for n in nodes:
        n["upFreq"], n["upJlpt"] = r.get(n["char"], (False, None))
    return nodes


def _node(row) -> dict:
    """Shape one character row for the client."""
    return {
        "char": row["char"],
        "strokes": row["strokes"],
        "grade": row["grade"],
        "freq": row["freq"],
        "jlpt": row["jlpt"],
        "joyo": bool(row["joyo"]),
        "inKanjidic": bool(row["in_kanjidic"]),
        "meanings": json.loads(row["meanings"] or "[]"),
        "meaningsBg": json.loads(row["meanings_bg"]) if row["meanings_bg"] else None,
        "onYomi": json.loads(row["on_yomi"] or "[]"),
        "kunYomi": json.loads(row["kun_yomi"] or "[]"),
        "fanout": row["joyo_count"] if "joyo_count" in row.keys() else None,
    }


KANJI_COLS = """
    k.char, k.strokes, k.grade, k.freq, k.jlpt, k.joyo, k.in_kanjidic,
    k.meanings, k.on_yomi, k.kun_yomi, COALESCE(f.joyo_count, 0) AS joyo_count,
    (SELECT kb.meanings FROM kanji_bg kb WHERE kb.char = k.char) AS meanings_bg
"""


def _fetch(chars: list[str]) -> dict[str, dict]:
    if not chars:
        return {}
    ph = ",".join("?" * len(chars))
    rows = query(
        f"SELECT {KANJI_COLS} FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
        f"WHERE k.char IN ({ph})",
        tuple(chars),
    )
    return {r["char"]: _node(r) for r in rows}


PEEK_LIMIT = 48


# Registered before /{char}, like by-level below.
@router.get("/containers")
def containers_of(c: list[str] = Query(default=[], max_length=64)) -> dict:
    """Direct containers of several characters at once, frequency-ordered.

    This is what the graph's hover peek reads: one level further up from a
    container. Batched so the client can prefetch the whole inner ring in one
    request and the peek opens without a round trip.
    """
    out: dict[str, dict] = {}
    for char in dict.fromkeys(ch for ch in c if len(ch) == 1):
        parents = parents_of(char)
        if not parents:
            out[char] = {"total": 0, "containers": []}
            continue
        ph = ",".join("?" * len(parents))
        # Only the first PEEK_LIMIT are shaped: 口 or 人 have over a thousand
        # containers, and building every one to send 48 was most of the time.
        rows = query(
            f"SELECT {KANJI_COLS} FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
            f"WHERE k.char IN ({ph}) "
            f"ORDER BY k.freq IS NULL, k.freq, k.strokes, k.char LIMIT {PEEK_LIMIT}",
            tuple(parents),
        )
        total = query_one(f"SELECT COUNT(*) AS n FROM kanji WHERE char IN ({ph})", tuple(parents))["n"]
        out[char] = {"total": total, "containers": _with_reach([_node(r) for r in rows])}
    return out


# Registered before /{char} -- FastAPI matches in declaration order, and
# "by-level" would otherwise be read as a (too long) character.
@router.get("/by-level/{level}")
def by_level(level: int) -> dict:
    """Every kanji at one JLPT level, plus the parts they are built from.

    The components are the point: a level's kanji pull in bound forms and
    non-jōyō characters that have no level of their own, and those are exactly
    the things you have to learn anyway. They come back separately so the client
    can show them as present but not-a-target.
    """
    if level not in (1, 2, 3, 4, 5):
        raise HTTPException(400, "level must be 1-5")

    rows = query(
        f"SELECT {KANJI_COLS} FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
        f"WHERE k.jlpt = ? ORDER BY k.freq IS NULL, k.freq, k.strokes, k.char",
        (level,),
    )
    kanji = [_node(r) for r in rows]

    # Walk down from the level's kanji and keep whatever has no JLPT level.
    targets = {k["char"] for k in kanji}
    seen: set[str] = set(targets)
    frontier = list(targets)
    extra: set[str] = set()
    depth = 0
    while frontier and depth < MAX_DEPTH:
        nxt: list[str] = []
        for children in children_of(frontier).values():
            for c in children:
                if c in seen:
                    continue
                seen.add(c)
                extra.add(c)
                nxt.append(c)
        frontier = nxt
        depth += 1

    components: list[dict] = []
    if extra:
        chars = sorted(extra)
        ph = ",".join("?" * len(chars))
        comp_rows = query(
            f"SELECT {KANJI_COLS} FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
            f"WHERE k.char IN ({ph}) AND k.jlpt IS NULL "
            f"ORDER BY COALESCE(f.joyo_count, 0) DESC, k.char",
            tuple(chars),
        )
        components = [_node(r) for r in comp_rows]

    return {
        "level": level,
        "kanji": kanji,
        "components": components,
        "counts": {"kanji": len(kanji), "components": len(components)},
    }


@router.get("/{char}/similar")
def similar_to(char: str) -> dict:
    """What looks like `char`, what shares a reading with it, what means much
    the same, and its other forms.

    Built offline by pipeline/similar.py. Every stored neighbour comes back,
    closest first; the client filters by level, as it does containers.
    """
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")
    rows = query(
        "SELECT other, kind, score, note FROM similar WHERE char = ? ORDER BY kind, rank",
        (char,),
    )
    nodes = _fetch(list(dict.fromkeys(r["other"] for r in rows)))
    out: dict[str, list] = {"look": [], "read": [], "mean": [], "variant": []}
    for r in rows:
        n = nodes.get(r["other"])
        if n is None:
            continue
        item = {**n, "score": r["score"]}
        if r["kind"] in ("read", "mean"):
            item["why"] = json.loads(r["note"]) if r["note"] else None
        out[r["kind"]].append(item)
    return {"char": char, **out}


@router.get("/{char}")
def get_kanji(char: str) -> dict:
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")

    focus_row = query_one(
        f"SELECT {KANJI_COLS} FROM kanji k LEFT JOIN fanout f ON f.char = k.char WHERE k.char = ?",
        (char,),
    )
    if focus_row is None:
        raise HTTPException(404, f"{char} is not in the graph")

    # --- containers: one level up only, frequency-ordered (NULL freq = rarest)
    parent_chars = parents_of(char)
    containers: list[dict] = []
    if parent_chars:
        ph = ",".join("?" * len(parent_chars))
        container_rows = query(
            f"SELECT {KANJI_COLS} FROM kanji k "
            f"LEFT JOIN fanout f ON f.char = k.char "
            f"WHERE k.char IN ({ph}) "
            f"ORDER BY k.freq IS NULL, k.freq, k.strokes, k.char",
            tuple(parent_chars),
        )
        containers = _with_reach([_node(r) for r in container_rows])

    # --- components: full descent to atoms, depth = longest path from focus
    depth: dict[str, int] = {char: 0}
    edges: list[dict] = []
    seen_edges: set[tuple[str, str]] = set()
    frontier = [char]
    level = 0
    while frontier and level < MAX_DEPTH:
        kids = children_of(frontier)
        nxt: list[str] = []
        for parent, children in kids.items():
            for child in children:
                key = (parent, child)
                if key not in seen_edges:
                    seen_edges.add(key)
                    edges.append({"parent": parent, "child": child})
                # longest path wins, so a shared component sinks to its deepest use
                if depth.get(child, -1) < level + 1:
                    depth[child] = level + 1
                    nxt.append(child)
        frontier = list(dict.fromkeys(nxt))
        level += 1

    component_chars = [c for c in depth if c != char]
    nodes = _fetch(component_chars)
    components = []
    for c in component_chars:
        n = nodes.get(c) or {
            "char": c, "strokes": None, "grade": None, "freq": None, "jlpt": None,
            "joyo": False, "inKanjidic": False, "meanings": [], "meaningsBg": None, "onYomi": [],
            "kunYomi": [], "fanout": 0,
        }
        n["depth"] = depth[c]
        components.append(n)
    components.sort(key=lambda n: (n["depth"], -(n["fanout"] or 0), n["char"]))

    stroke_row = query_one("SELECT paths FROM stroke WHERE char = ?", (char,))

    return {
        "focus": _node(focus_row),
        "strokes": json.loads(stroke_row["paths"]) if stroke_row else [],
        "containers": containers,
        "components": {"nodes": components, "edges": edges},
        "counts": {
            "containers": len(containers),
            "containersJoyo": sum(1 for c in containers if c["joyo"]),
            "components": len(components),
            "maxDepth": max(depth.values()) if depth else 0,
        },
    }
