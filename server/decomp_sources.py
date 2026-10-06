"""Which sources split a character the way it is split now (pipeline/decomp_sources.py).

The page names them beside the parts -- KanjiVG, IDS, the kanji book,
cjk-decomp, topokanji -- and "bkd" (this dictionary's own) when none of them
does: a split set by hand, or decided by a reviewer against every source.
"""

from __future__ import annotations

import functools
import json

from .db import query, query_one

SOURCES = ("kanjivg", "ids", "tsalta", "cjk-decomp", "topokanji")
OWN = "bkd"


@functools.lru_cache(maxsize=1)
def _equiv() -> dict[str, str]:
    if not _present():
        return {}
    return {r["char"]: r["rep"] for r in query("SELECT char, rep FROM decomp_equiv")}


@functools.lru_cache(maxsize=1)
def _present() -> bool:
    """An older database has no sources table: then nothing is named."""
    return query_one("SELECT 1 AS x FROM sqlite_master WHERE name = 'decomp_source'") is not None


def _key(parts: list[str]) -> frozenset[str]:
    eq = _equiv()
    return frozenset(eq.get(p, p) for p in parts)


def splits(char: str) -> list[dict]:
    """Each source's split of `char`: [{source, parts}], the graph's own files under their names."""
    if not _present():
        return []
    out = []
    for r in query("SELECT source, origin, parts FROM decomp_source WHERE char = ?", (char,)):
        name = r["origin"] if r["source"] == "built" else r["source"]
        if name in ("user",):
            continue
        out.append({"source": name, "parts": json.loads(r["parts"])})
    order = {s: i for i, s in enumerate((*SOURCES, OWN))}
    return sorted(out, key=lambda s: order.get(s["source"], 99))


def parts_from(char: str, parts: list[str]) -> dict | None:
    """`by`: the sources that split `char` into `parts` (bkd when none does); `splits`: every source's split."""
    if not _present():
        return None
    every = splits(char)
    want = _key(parts)
    by = [s["source"] for s in every if s["source"] != OWN and _key(s["parts"]) == want]
    if not by:
        by = [OWN]
    return {"by": list(dict.fromkeys(by)), "splits": [s for s in every if s["source"] != OWN]}
