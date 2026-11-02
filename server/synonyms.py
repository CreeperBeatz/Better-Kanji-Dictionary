"""Drafted synonyms, opposites and mix-ups of words, and the lines on kanji close in meaning.

data/word_synonyms.json (pipeline/word_synonyms.py export): word id -> rows
[sense index, kind, other word id, the other's sense number, line, own line];
kind is syn (≈, the line says how the other differs), ant (↔, no line), mix
(easy to mix up, the line says when to write the other; a 7th field says why:
"sound", read the same, the default, or "meaning", one English word for two),
pair (the two go together, not opposites: 祖父 / 祖母, 級 / 段; no line) or
polite (one is the honorific, humble or polite counterpart of the other: the
line and own line are the two registers). The own line says the same of the
word itself, beside it. Short and older forms are of the whole word (sense -1,
no other sense): short / shortOf (ＣＭ is the short form of コマーシャル),
older / olderOf (メーター is an older form of メートル), spoken / spokenOf
(やっぱり is a spoken form of やはり).

data/kanji_nuances.json (pipeline/kanji_nuance.py merge): `similar`, keyed
"kanji|meaning id|other", one line on how the other kanji differs in that
meaning; `mixup`, keyed "a|b|reading" with a < b, when to write which, for
kanji easy to mix up that no usage card tells apart. Both English and Bulgarian.

data/word_sense_notes.json (pipeline/sense_notes.py merge): word id -> one note
per sense, {rank: main|secondary|rare, nuance, ex: {ja (the word in 【】), en, src} | null}.

data/sense_restrictions.json (pipeline/sense_restrictions.py export): senses JMdict
gives only for some readings or spellings of a word, other than the headword's.

data/word_lines_bg.json (pipeline/translate_bg.py merge): the Bulgarian of both,
{lines: {English line: Bulgarian}, notes: {"word id|sense": {nuance, ex}}}. A text
with no Bulgarian yet (fixed in English since) is shown in English.

Any file missing, there is just nothing to show.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
NOTES_PATH = DATA / "word_sense_notes.json"


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
def _notes_read() -> tuple[dict, str]:
    try:
        s = NOTES_PATH.stat()
        stamp = f"{s.st_mtime_ns}:{s.st_size}"
    except FileNotFoundError:
        stamp = "-"
    return _load(NOTES_PATH.name), stamp


def _notes() -> dict:
    return _notes_read()[0]


def notes_stamp() -> str:
    """The sense notes file as this process read it: the offline pack's words carry their order."""
    return _notes_read()[1]


@cache
def _only() -> dict:
    return _load("sense_restrictions.json")


def sense_only(word_id: int) -> dict | None:
    """Senses JMdict keeps to other readings or spellings: sense index -> {r: readings, k: spellings}."""
    return _only().get(str(word_id))


@cache
def _bg() -> dict:
    return _load("word_lines_bg.json")


@cache
def _sentences_bg() -> dict:
    return _load("sentence_bg.json")


def sentence_bg(sentence_id: int) -> str | None:
    """A Tatoeba example sentence in Bulgarian (pipeline/sentence_bg.py merge), if translated."""
    return _sentences_bg().get("bg", {}).get(str(sentence_id))


def sentence_en(sentence_id: int) -> str | None:
    """Our English for a sentence whose Tatoeba English says something the Japanese does not."""
    return _sentences_bg().get("en", {}).get(str(sentence_id))


def sentence_not_for(sentence_id: int, word_id: int) -> bool:
    """Whether the index files this sentence under a word it does not have in that meaning (一時 ひととき under いちじ)."""
    return word_id in _sentences_bg().get("notFor", {}).get(str(sentence_id), ())


@cache
def sentences_broken() -> frozenset[int]:
    """Sentences whose Japanese is wrong (a typo, broken grammar): kept off the word pages."""
    return frozenset(int(s) for s in _sentences_bg().get("broken", []))


def line_bg(line: str | None) -> str | None:
    return line and _bg().get("lines", {}).get(line)


_RANK = {"main": 0, "secondary": 1, "rare": 2}


def sense_order(word_id: int, count: int) -> list[int] | None:
    """The word's senses (0-based) in our order: main, then secondary, then rare, JMdict's order
    within each. The site numbers senses by it; the index stays the sense's id everywhere else.
    None where it is JMdict's own order (and for a word with no notes)."""
    notes = _notes().get(str(word_id)) or []
    rank = [_RANK.get((notes[i] or {}).get("rank"), 1) if i < len(notes) else 1 for i in range(count)]
    order = sorted(range(count), key=lambda i: (rank[i], i))
    return None if order == list(range(count)) else order


def sense_notes(word_id: int) -> list[dict] | None:
    """The notes, each with its Bulgarian (nuanceBg, ex.bg) where translated."""
    notes = _notes().get(str(word_id))
    if not notes:
        return notes
    bg = _bg().get("notes", {})
    out = []
    for i, n in enumerate(notes):
        b = n and bg.get(f"{word_id}|{i}")
        ex_ja = n and n.get("ex") and n["ex"]["ja"]
        # Only while the English is what was translated: a note changed since has no Bulgarian yet.
        src = (b or {}).get("src") or {"nuance": n and n["nuance"], "ex": ex_ja}
        if b and src == {"nuance": n["nuance"], "ex": ex_ja}:
            n ={**n, "nuanceBg": b["nuance"], **({"ex": {**n["ex"], "bg": b["ex"]}} if n.get("ex") and b.get("ex") else {})}
        out.append(n)
    return out


def word_rows(word_id: int) -> list[list]:
    return _words().get(str(word_id), [])


def _text(v: dict | None) -> dict | None:
    return v and {"en": v["en"], "bg": v.get("bg")}


def kanji_nuance(char: str, meaning: str, other: str) -> dict | None:
    """How `other` differs from `char` in `meaning`: {en, bg}."""
    return _text(_kanji().get("similar", {}).get(f"{char}|{meaning}|{other}"))


def kanji_not_close(char: str, meaning: str, other: str) -> bool:
    """Whether `other` is listed beside `char`'s `meaning` by mistake: the check found
    it does not share the meaning (DATA-ISSUES.md), so its row is not shown."""
    return bool((_kanji().get("similar", {}).get(f"{char}|{meaning}|{other}") or {}).get("mismatch"))


def kanji_wrong_label(char: str, meaning: str, other: str) -> bool:
    """Whether the guess at which meaning of `other` is close (search.close) is wrong for
    this row: the check said so (D-030), and wrote the line for the meaning that is."""
    return bool((_kanji().get("similar", {}).get(f"{char}|{meaning}|{other}") or {}).get("wrongLabel"))


def kanji_mixup(a: str, b: str, reading: str) -> dict | None:
    """When to write `a` and when `b` on `reading`: {en, bg}."""
    x, y = sorted((a, b))
    return _text(_kanji().get("mixup", {}).get(f"{x}|{y}|{reading}"))
