"""Where a character's parts come from: each source's split, for the page to name.

There is no official decomposition of Japanese kanji to load (Dani, 2026-10-06:
mark the source instead). So every character gets each source's split,
written as the graph's own characters, and the page names the sources that
split it the way it is split now -- or "BKD" (this dictionary's own) when
none does:

- **kanjivg** -- KanjiVG's component groups, drawn for Japanese (CC BY-SA).
  A glyph with no group is one piece ([]).
- **ids** -- BabelStone's IDS, the Japanese sequence where it gives one.
  A character described as itself is one piece.
- **tsalta** -- Цалта's kanji book, as transcribed (server/books.py), when
  the books are on this machine.
- **built** -- what the graph was built from (pipeline/decomp.py): its
  `origin` names the file, cjk-decomp or topokanji, or bkd for a split set by
  hand there.

Tables (the `sources` stage of build_db.py, after `graph` and `forms`):
`decomp_source(char, source, origin, parts)` and `decomp_equiv(char, rep)`,
the shapes counted as one part (氵 is 水), so a split written with either
matches.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter

import review_sources as rs
from decomp import BARE_STROKES, Decomposition, is_stroke


def _prefer(children: dict[str, list[str]], nodes: set[str], eq: dict[str, str]) -> dict[str, str]:
    """For each shape, the node the graph uses most for it."""
    use = Counter(c for cs in children.values() for c in cs)
    prefer: dict[str, str] = {}
    for c in sorted(nodes, key=lambda c: -use[c]):
        prefer.setdefault(eq.get(c, c), c)
    return prefer


# Shapes the kanji book writes with a character the graph doesn't have, for the part the graph
# has: katakana used as shapes (区 = 匚 メ), and the positional or rare code points of a part
# (現 = 𤣩 見, 慕 = 莫 ⺗). Only plain identities -- a book shape with no graph part (施's 𭤨,
# 賞's 𫩠) still leaves its split out, rather than read as something it is not.
BOOK_SHAPES = {
    "メ": "乂", "㐅": "乂", "ム": "厶",
    "𤣩": "王", "⺗": "㣺", "𭕄": "⺍", "黾": "黽",
}


def _tsalta() -> dict[str, list[str]]:
    """The kanji book's split of each kanji, as the characters it names; none without the books."""
    try:
        from server import books

        path = books.books_dir() / "kanji" / "kanji.jsonl"
    except Exception:  # noqa: BLE001 -- the books are optional
        return {}
    if not path.exists():
        return {}
    out: dict[str, list[str]] = {}
    seen: Counter = Counter()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        e = json.loads(line)
        if e.get("type") != "kanji":
            continue
        seen[e["kanji"]] += 1
        raw = [BOOK_SHAPES.get(p.get("char"), p.get("char")) for p in e.get("parts") or []]
        if all(raw):  # a part with no character (the top of 京) leaves the split partial: not used
            out[e["kanji"]] = raw
    # A kanji the book has twice is a misread headword (book_sources.py): neither is trusted.
    return {k: v for k, v in out.items() if seen[k] == 1}


def build(db: sqlite3.Connection) -> None:
    children: dict[str, list[str]] = {}
    for p, c in db.execute("SELECT parent, child FROM edge"):
        children.setdefault(p, []).append(c)
    nodes = {r[0] for r in db.execute("SELECT char FROM kanji")}
    eq = rs.equivalence(db)
    prefer = _prefer(children, nodes, eq)
    d = Decomposition.load(user_overrides=False)

    def ours(raw: list[str], x: str) -> list[str] | None:
        """A source's parts as graph nodes; None when one is unknown, a stroke, or the character itself."""
        mapped = rs._ours(raw, nodes, eq, prefer)
        if mapped is None or x in mapped or any(p in BARE_STROKES or is_stroke(p) for p in mapped):
            return None
        return mapped

    ids, kvg, book = rs.babelstone(), rs.kanjivg(whole=True), _tsalta()
    rows = []
    for x in sorted(nodes):
        if x in d.origin:
            rows.append((x, "built", d.origin[x], json.dumps(children.get(x, []), ensure_ascii=False)))
        if x in kvg:
            parts = ours(kvg[x], x) if kvg[x] else []
            if parts is not None:
                rows.append((x, "kanjivg", None, json.dumps(parts, ensure_ascii=False)))
        if x in ids:
            toks = rs._tokens(ids[x])
            parts = [] if toks == [x] else (lambda p: ours(p, x) if p else None)(rs.ids_parts(ids[x], x))
            if parts is not None:
                rows.append((x, "ids", None, json.dumps(parts, ensure_ascii=False)))
        if x in book:
            parts = ours(book[x], x) if book[x] != [x] else []
            if parts is not None:
                rows.append((x, "tsalta", None, json.dumps(parts, ensure_ascii=False)))

    db.executescript("""
        DROP TABLE IF EXISTS decomp_source;
        DROP TABLE IF EXISTS decomp_equiv;
        CREATE TABLE decomp_source (
            char   TEXT NOT NULL,
            source TEXT NOT NULL,   -- built | kanjivg | ids | tsalta
            origin TEXT,            -- for built: cjk-decomp | topokanji | bkd
            parts  TEXT NOT NULL,   -- JSON array of graph nodes; [] = one piece
            PRIMARY KEY (char, source)
        );
        CREATE TABLE decomp_equiv (
            char TEXT PRIMARY KEY,
            rep  TEXT NOT NULL      -- the shape it is counted as (氵 -> 水)
        );
    """)
    db.executemany("INSERT INTO decomp_source (char, source, origin, parts) VALUES (?, ?, ?, ?)", rows)
    db.executemany("INSERT INTO decomp_equiv (char, rep) VALUES (?, ?)", [(c, r) for c, r in eq.items() if c != r])
    by = Counter(r[1] for r in rows)
    print("  splits        " + "  ".join(f"{k} {v:,}" for k, v in sorted(by.items())))
    print(f"  equivalences  {sum(1 for c, r in eq.items() if c != r):>7,} shapes counted as another")
