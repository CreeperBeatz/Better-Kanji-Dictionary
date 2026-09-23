"""Kanji by their parts, for descriptions of how a character looks.

Models are poor at the step from parts to a character -- told "king on top,
clothes below" they guess from memory -- and good at the step before it, from
"king" to 王. The decomposition graph is exact at the step they are poor at,
so a description can be read as parts by the model and the characters holding
all of them found here.

A part is named the way a person would, so each one also matches the forms it
takes inside characters: 衣 is 衤 at the left of 裕 and 𧘇 under 表, 水 is 氵.
Containment is at any depth -- 意 holds 立 through 音.
"""

from __future__ import annotations

import threading

from .db import query

# The forms one part takes. A character may sit in more than one group:
# 龶 is drawn like 王 and like the top of 生.
_VARIANT_GROUPS = [
    "人亻", "水氵氺", "心忄㣺", "手扌龵", "火灬", "犬犭", "糸糹", "食飠𩙿", "艹䒑",
    "衣衤𧘇", "示礻", "刀刂", "肉月", "玉王龶", "生龶", "竹⺮", "足⻊", "阜邑阝",
    "辵辶", "老耂", "网罒", "羊𦍌", "攴攵", "艸艹",
]
FORMS: dict[str, set[str]] = {}
for _group in _VARIANT_GROUPS:
    for _c in _group:
        FORMS.setdefault(_c, {_c}).update(_group)

_children: dict[str, set[str]] | None = None
_below: dict[str, frozenset[str]] = {}
_info: dict[str, tuple[bool, int, int]] = {}
_lock = threading.Lock()


def _load() -> None:
    global _children
    with _lock:
        if _children is not None:
            return
        children: dict[str, set[str]] = {}
        for r in query("SELECT parent, child FROM edge"):
            children.setdefault(r["parent"], set()).add(r["child"])
        for r in query("SELECT char, joyo, strokes, freq FROM kanji"):
            _info[r["char"]] = (bool(r["joyo"]), r["strokes"] or 99, r["freq"] or 9999)
        _children = children


def _descendants(char: str, seen: frozenset[str] = frozenset()) -> frozenset[str]:
    if char in _below:
        return _below[char]
    out: set[str] = set()
    for child in _children.get(char, ()):
        if child not in seen:  # the graph has the odd cycle between variants
            out.add(child)
            out |= _descendants(child, seen | {char})
    _below[char] = frozenset(out)
    return _below[char]


def forms(part: str) -> set[str]:
    return FORMS.get(part, {part})


# Single strokes are in nearly every character, and the graph does not break
# characters down to them, so naming one says nothing.
STROKES = set("一丨丶丿乙亅乚㇒㇏")


def _wanted(parts: list[list[str]]) -> list[set[str]]:
    """Each named part as the set of its forms, strokes and repeats left out
    (三 trees is 木 once: the graph lists a part once however often it recurs)."""
    out: list[set[str]] = []
    for p in parts:
        group = set().union(*(forms(f) for f in p)) - STROKES if p else set()
        if group and group not in out:
            out.append(group)
    return out


def is_joyo(char: str) -> bool:
    _load()
    return _info.get(char, (False,))[0]


def holds(char: str, parts: list[list[str]]) -> bool:
    _load()
    below = _descendants(char)
    return all(below & w for w in _wanted(parts))


def containing(parts: list[list[str]], limit: int = 30) -> list[str]:
    """Characters holding every one of `parts`, each part being the forms it
    could be written in; the likeliest first -- those whose parts are exactly
    the ones named, then jōyō, then fewer strokes."""
    _load()
    wanted = _wanted(parts)
    if not wanted:
        return []
    named = set().union(*wanted)
    hits = []
    for char in _children:
        if char in named:
            continue
        below = _descendants(char)
        if all(below & w for w in wanted):
            direct = _children[char]
            joyo, strokes, freq = _info.get(char, (False, 99, 9999))
            exact = all(direct & w for w in wanted) and len(direct) == len(wanted)
            hits.append((not exact, not joyo, strokes, freq, char))
    hits.sort()
    return [h[-1] for h in hits[:limit]]


def rerank(model_kanji: list[str], parts: list[list[str]], limit: int = 12, policy: str = "B") -> list[str]:
    """The model's kanji checked against its own reading of the parts.

    Those that really hold the parts come first, in the model's order, then up
    to three more of the database's that hold them -- jōyō only, since the model
    found one already and the rest are rarely what was meant. If none of the
    model's does, policy "A" puts the database's best three first and policy "B"
    keeps the model's first guess ahead of them. Then the model's other guesses.
    With no usable parts, the model's list."""
    candidates = containing(parts)
    if not candidates:
        return model_kanji[:limit]
    held = [k for k in model_kanji if holds(k, parts)]
    others = [k for k in model_kanji if k not in held]
    fill = [k for k in candidates if k not in held]
    if held:
        order = held + [k for k in fill if is_joyo(k)][:3] + others
    elif policy == "A":
        order = fill[:3] + others
    else:
        order = others[:1] + fill[:3] + others[1:]
    return list(dict.fromkeys(order))[:limit]
