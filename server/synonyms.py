"""Drafted synonyms, opposites and mix-ups of words, and the lines on kanji close in meaning.

data/word_synonyms.json (pipeline/word_synonyms.py export): word id -> rows
[sense index, kind, other word id, the other's sense number, line, own line];
kind is syn (≈, the line says how the other differs), ant (↔, no line) or mix
(read the same, the line says when to write the other). The own line says the
same of the word itself, beside it.

data/kanji_nuances.json (pipeline/kanji_nuance.py merge): `similar`, keyed
"kanji|meaning id|other", one line on how the other kanji differs in that
meaning; `mixup`, keyed "a|b|reading" with a < b, when to write which, for
kanji easy to mix up that no usage card tells apart. Both English and Bulgarian.

data/word_sense_notes.json (pipeline/sense_notes.py merge): word id -> one note
per sense, {rank: main|secondary|rare, nuance, ex: {ja (the word in 【】), en, src} | null}.

Any file missing, there is just nothing to show.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def _load(name: str) -> dict:
    try:
        return json.loads((DATA / name).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


@cache
def _words() -> dict:
    return _load("word_synonyms.json")


@cache
def _kanji() -> dict:
    return _load("kanji_nuances.json")


@cache
def _notes() -> dict:
    return _load("word_sense_notes.json")


def sense_notes(word_id: int) -> list[dict] | None:
    return _notes().get(str(word_id))


def word_rows(word_id: int) -> list[list]:
    return _words().get(str(word_id), [])


def _text(v: dict | None) -> dict | None:
    return v and {"en": v["en"], "bg": v.get("bg")}


def kanji_nuance(char: str, meaning: str, other: str) -> dict | None:
    """How `other` differs from `char` in `meaning`: {en, bg}."""
    return _text(_kanji().get("similar", {}).get(f"{char}|{meaning}|{other}"))


def kanji_own_nuance(char: str, meaning: str, other: str, other_meaning: str | None) -> dict | None:
    """How `char` itself differs from `other` in `meaning`: the other kanji's line about this one,
    in its meaning that is close, where it has one, else drafted (pipeline/self_nuance.py)."""
    k = _kanji()
    back = other_meaning and k.get("similar", {}).get(f"{other}|{other_meaning}|{char}")
    return _text(back or k.get("self", {}).get(f"{char}|{meaning}|{other}"))


def kanji_mixup(a: str, b: str, reading: str) -> dict | None:
    """When to write `a` and when `b` on `reading`: {en, bg}."""
    x, y = sorted((a, b))
    return _text(_kanji().get("mixup", {}).get(f"{x}|{y}|{reading}"))
