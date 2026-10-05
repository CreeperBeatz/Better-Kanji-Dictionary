"""The forms of a character, as the kanji page's Forms block shows them.

Built offline into `char_form` (pipeline/forms.py); accepted `form_link`
review decisions lie over it live (server/review.py registers them here), so
a reviewer's change shows at once and a rebuild keeps it via the export.

None of this touches containment: the order never reads it, and the graph
reads only `graph_families` -- which characters to show above a focus, never
an edge.
"""

from __future__ import annotations

import json
import re
from typing import Callable

from . import bg_overlay
from .db import query

KINDS = ("positional", "old", "form_of", "looks_like", "kin")

# Set by server/review.py: (char) -> (added rows, removed (char, other, kind) keys).
overlay: Callable[[], tuple[list[dict], set[tuple[str, str, str]]]] | None = None

# KANJIDIC sometimes files only a radical's number where a meaning would be:
# 亻 "Radical Number 9", 耂 "Variant Of Radical 125". Those say nothing to a
# learner. A radical's *name* does ("Dotted Cliff Radical (no. 53)") and stays.
_FILLER = re.compile(r"\b(radical|number|variant|of)\b|\bno\.|[\d().,\s-]+", re.I)


def real_meanings(meanings: list[str]) -> list[str]:
    return [m for m in meanings if _FILLER.sub("", m).strip()]


def _links() -> list[dict]:
    """Every link, built and reviewed, as dicts."""
    rows = [dict(r) for r in query("SELECT char, other, kind, source, note FROM char_form")]
    if overlay is None:
        return rows
    added, removed = overlay()
    keyed = {(r["char"], r["other"], r["kind"]): r for r in rows if (r["char"], r["other"], r["kind"]) not in removed}
    for r in added:
        if r["kind"] == "form_of":
            for k in [k for k in keyed if k[0] == r["char"] and k[2] == "form_of"]:
                del keyed[k]
        keyed[(r["char"], r["other"], r["kind"])] = r
    return list(keyed.values())


def links_of(char: str) -> list[dict]:
    if overlay is None:
        return [
            dict(r)
            for r in query("SELECT char, other, kind, source, note FROM char_form WHERE char = ? OR other = ?", (char, char))
        ]
    return [r for r in _links() if r["char"] == char or r["other"] == char]


def shape_groups() -> dict[str, set[str]]:
    """For describing a character by its parts (server/kanji_parts.py): each
    part with every form it is written in or mistaken for -- "king" should
    find 理 through 王 and 青 through 龶."""
    out: dict[str, set[str]] = {}
    for r in _links():
        if r["kind"] in ("positional", "form_of", "looks_like"):
            a, b = r["char"], r["other"]
            out.setdefault(a, {a}).add(b)
            out.setdefault(b, {b}).add(a)
    return out


def graph_families() -> dict[str, set[str]]:
    """What the graph shows above a focus besides its own containers: 細 is
    built from 糹, which is 糸 written at the left, so focusing 糸 shows it.

    Only positional links without a note. A note marks a grouping that would
    otherwise surprise (月 at the left of 腕 is 肉), and those stay apart:
    focusing 肉 must not show the moon in 明. Kin (隹 鳥) never merge -- 鳴
    does not look like it contains 隹.
    """
    out: dict[str, set[str]] = {}
    for r in _links():
        if r["kind"] == "positional" and not r["note"]:
            a, b = r["char"], r["other"]
            out.setdefault(a, {a}).add(b)
            out.setdefault(b, {b}).add(a)
    return out


def _nodes(chars: list[str]) -> dict[str, dict]:
    if not chars:
        return {}
    marks = ",".join("?" * len(chars))
    rows = query(f"SELECT char, meanings, joyo FROM kanji WHERE char IN ({marks})", tuple(chars))
    bg = {
        r["char"]: bg_overlay.kanji(r["char"], r["meanings"])
        for r in query(f"SELECT char, meanings FROM kanji_bg WHERE char IN ({marks})", tuple(chars))
    }
    curated = {
        r["char"]: r["meaning"]
        for r in query(f"SELECT char, meaning FROM kanji_curated WHERE char IN ({marks})", tuple(chars))
    }
    # Kanji Alive's curated line reads better than KANJIDIC's where there is one.
    return {
        r["char"]: {
            "meanings": (
                [m.strip() for m in curated[r["char"]].split(",")][:3]
                if r["char"] in curated
                else real_meanings(json.loads(r["meanings"] or "[]"))[:3]
            ),
            "meaningsBg": bg.get(r["char"]),
            "joyo": bool(r["joyo"]),
        }
        for r in rows
    }


def forms_of(char: str) -> dict:
    links = links_of(char)
    variants = [r["other"] for r in query("SELECT other FROM similar WHERE char = ? AND kind = 'variant' ORDER BY rank", (char,))]
    nodes = _nodes(list({char, *(r["other"] for r in links), *(r["char"] for r in links), *variants}))

    def item(c: str, r: dict | None = None) -> dict:
        n = nodes.get(c)
        return {
            "char": c,
            "known": n is not None,
            "meanings": n["meanings"] if n else [],
            "meaningsBg": n["meaningsBg"] if n else None,
            "note": r["note"] if r else None,
            "source": r["source"] if r else "unihan",
        }

    out: dict[str, list] = {
        "positional": [], "old": [], "new": [], "formOf": [], "forms": [], "looksLike": [], "lookalikeOf": [],
        "kin": [],
    }
    for r in links:
        mine = r["char"] == char
        other = r["other"] if mine else r["char"]
        if r["kind"] == "positional" and mine:
            out["positional"].append(item(other, r))
        elif r["kind"] == "old":
            out["old" if mine else "new"].append(item(other, r))
        elif r["kind"] == "form_of":
            out["formOf" if mine else "forms"].append(item(other, r))
        elif r["kind"] == "looks_like":
            out["looksLike" if mine else "lookalikeOf"].append(item(other, r))
        elif r["kind"] == "kin" and other not in {i["char"] for i in out["kin"]}:
            out["kin"].append(item(other, r))
    for group in out.values():
        group.sort(key=lambda i: (not i["known"], i["char"]))

    named = {i["char"] for group in out.values() for i in group}
    out["variants"] = [item(v) for v in variants if v not in named and v != char]

    # A bound part with nothing of its own to say borrows the meaning of what it is a form of.
    own = nodes.get(char)
    borrowed = None
    if out["formOf"] and not (own and own["meanings"]):
        whole = out["formOf"][0]
        borrowed = {"from": whole["char"], "meanings": whole["meanings"], "meaningsBg": whole["meaningsBg"]}
    return {"char": char, "meaning": borrowed, **out}
