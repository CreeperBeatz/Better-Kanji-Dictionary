"""Reviewed Bulgarian, laid over the built tables.

The database is read-only and rebuilt on every data deploy, so reviewed
Bulgarian cannot go in it. It lives in the review store (server/review.py),
which keeps these two maps in step: a word's glosses, one per sense, and a
kanji's meanings. Everything that turns a `sense_bg` / `kanji_bg` row into
what a page shows goes through `gloss` and `kanji`, so pages, search
results, the map, handwriting candidates and the offline pack all show the
reviewed text.

(A view over the tables was tried: SQLite cannot fold a view into a query
that LEFT JOINs it, so it rebuilt the view on every query, ~40 ms each.)

Search by Bulgarian text still runs on the built index: a corrected gloss is
found by its new words only once the data is rebuilt with it.
"""

from __future__ import annotations

import hashlib
import json

WORDS: dict[int, list[str]] = {}
KANJI: dict[str, list[str]] = {}


def load(words: dict[int, list[str]], kanji: dict[str, list[str]]) -> None:
    WORDS.clear()
    WORDS.update(words)
    KANJI.clear()
    KANJI.update(kanji)


def set_word(word_id: int, glosses: list[str] | None) -> None:
    if glosses is None:
        WORDS.pop(word_id, None)
    else:
        WORDS[word_id] = glosses


def set_kanji(char: str, meanings: list[str] | None) -> None:
    if meanings is None:
        KANJI.pop(char, None)
    else:
        KANJI[char] = meanings


def gloss(word_id: int, ord_: int, built: str | None) -> str | None:
    """A sense's Bulgarian: the reviewed one, else the built one."""
    g = WORDS.get(word_id)
    return g[ord_] if g and ord_ < len(g) and g[ord_] else built


def kanji(char: str, built: str | None) -> list[str] | None:
    """A kanji's Bulgarian meanings: the reviewed ones, else the built row's (JSON text)."""
    k = KANJI.get(char)
    if k:
        return k
    return json.loads(built) if built else None


def key() -> str:
    """Changes whenever the reviewed Bulgarian does (the offline pack follows it)."""
    blob = json.dumps([sorted(WORDS.items()), sorted(KANJI.items())], ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]
