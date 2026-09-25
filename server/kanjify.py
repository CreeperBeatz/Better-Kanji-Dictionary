"""Kanjify: marking an association's words with the characters they stand for.

The learner writes a story -- "a person leans on a tree to rest" -- and a
language model, told the kanji and every part it is built from, puts each
character in square brackets after the words that stand for it: "a person [亻]
leans on a tree [木] to rest [休]". For a word, every kanji of the word and
their parts.

The model only picks the places. What comes back is the learner's own text
with the brackets put in here: an answer that changed a single letter of the
text is refused, a new bracket for a character that is not one of the parts
is dropped (or taken as the form of it the list has -- 氺 for 氵), and a part
is marked once however often, and in however many of its forms, the model
marked it.

Where the learner left an empty bracket -- [] or 「」 -- they are asking, and
the model puts its best guess there: any kanji the dictionary knows, not only
a part.

The model is GPT-6 Luna at low effort, by a trial of twenty associations in
English, Bulgarian and Japanese: nineteen came back clean, in about three
seconds, at about $0.0001 each. No reasoning was faster and sloppier (日
three times over, "I" as 心); medium was no better than low.

    OPENROUTER_API_KEY   turns it on, as for semantic search
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections import OrderedDict

import requests

from . import kanji_parts
from .db import query, query_one
from .semantic import URL, Off, Unavailable

MODEL = "openai/gpt-6-luna"
REASONING = {"effort": "low"}
TIMEOUT = 60
MAX_TEXT = 3000


class Garbled(Exception):
    """The model's answer was not the learner's text with brackets put in."""


def enabled() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY"))


_PROMPT = """You help a learner of Japanese annotate their own mnemonic. They wrote an \
association -- a little story or picture -- for a kanji or a word. Mark, in their text, \
the words that stand for kanji, by writing the kanji in square brackets straight after them:

  a person [亻] leans on a tree [木] to rest [休]

Rules:
- Copy the text exactly. Only add brackets; do not fix, reword, translate or add anything else.
- Put a bracket after the word or short phrase that stands for a kanji, in the language the \
text is written in. The meaning can be loose (a "guy" is 亻, "sunlight" is 日), but it must \
really be that thing in the story.
- The kanji itself (or each kanji of the word) goes after the words that give its meaning.
- For the brackets you add, only use the characters listed below. Never invent one that \
is not in the list.
- A character that nothing in the text stands for is left out. Leaving one out is better \
than a forced guess.
- A part can be listed in more than one form (水 and 氵, 人 and 亻). Use the form listed \
first in its kanji's list: that is the one written in it.
- Where the learner left an empty bracket, [] or 「」, they are asking which kanji the word \
just before it is: put that kanji inside it. Here any kanji may go, listed or not -- "dark []" \
is "dark [暗]", "friend []" is "friend [友]". Always fill it with one kanji, keep their kind \
of bracket, and add no other bracket after that word.
- Mark each kanji once, at its clearest place, and put one bracket after a word at most.
- Leave text already in square brackets as it is, and do not mark a kanji twice.
- Answer with the annotated text and nothing else."""


def _meaning(char: str, seen: frozenset[str] = frozenset()) -> str:
    row = query_one("SELECT meaning FROM kanji_curated WHERE char = ?", (char,))
    if row and row["meaning"]:
        return row["meaning"]
    row = query_one("SELECT meanings FROM kanji WHERE char = ?", (char,))
    # A variant's own entry is often just "Radical Number 9"; the form it is
    # a variant of has the meaning (亻 is 人, a person).
    meanings = [m for m in json.loads(row["meanings"]) if "radical" not in m.lower()] if row else []
    if meanings:
        return ", ".join(meanings[:2]).lower()
    for other in sorted(kanji_parts.forms(char) - seen - {char}):
        m = _meaning(other, seen | {char})
        if m:
            return m
    return ""


_known: set[str] | None = None


def _is_kanji(char: str) -> bool:
    """A kanji or a part the dictionary knows: what a bracket may hold."""
    global _known
    if _known is None:
        known = {r["char"] for r in query("SELECT char FROM kanji")}
        for r in query("SELECT parent, child FROM edge"):
            known.update((r["parent"], r["child"]))
        _known = known
    return char in _known


def context(subject: str) -> tuple[str, list[str]]:
    """What the model is told about the subject, and the characters it may add
    brackets for: each kanji, then its parts."""
    lines, listed = [], []
    if len(subject) > 1:
        lines.append(f"The note is about the word {subject}.")
    for k in dict.fromkeys(c for c in subject if _is_kanji(c)):
        listed.append(k)
        lines.append(f"{k} ({_meaning(k)}) is made of:")
        for p in kanji_parts.parts_of(k):
            listed.append(p)
            lines.append(f"  {p} ({_meaning(p) or 'no common name'})")
    return "\n".join(lines), list(dict.fromkeys(listed))


# A bracket of a few characters at most, or an empty one to be filled -- [],
# 「」 or the full-width ［］ of a Japanese keyboard; anything longer is the
# learner's own writing.
_TAG = re.compile(r"\[\s*([^\[\]\s]{0,4})\s*\]|「\s*([^「」\s]{0,4})\s*」|［\s*([^［］\s]{0,4})\s*］")
_CJK = re.compile("[\\u3000-\\u9fff\\uf900-\\ufaff\\U00020000-\\U0003ffff]")


def _read(text: str) -> tuple[str, list[tuple[int, str]]]:
    """The text without whitespace or brackets, and each bracket's contents
    with how many of those characters come before it."""
    plain: list[str] = []
    tags: list[tuple[int, str]] = []
    at = 0
    for m in _TAG.finditer(text):
        plain.extend(c for c in text[at:m.start()] if not c.isspace())
        tags.append((len(plain), next((g for g in m.groups() if g is not None), "")))
        at = m.end()
    plain.extend(c for c in text[at:] if not c.isspace())
    return "".join(plain), tags


def merge(text: str, answer: str, listed: list[str]) -> str:
    """The learner's text with the brackets the model put in, checked: the
    empty ones they left filled, and new ones added.

    An empty bracket may be filled with any kanji the dictionary knows; a new
    one only with a listed character (or the listed form of one: 氺 is 氵).
    The model's spacing is not trusted; a new bracket goes straight after the
    character it followed, with a space before it after a letter and none
    after a kanji or kana."""
    plain, had = _read(text)
    got, tags = _read(answer.strip())
    if got != plain:
        raise Garbled("the answer is not the text")
    # What the model put at each place, less copies of the learner's own.
    offered: dict[int, list[str]] = {}
    for pos, c in tags:
        if c and all(_is_kanji(ch) for ch in c):
            offered.setdefault(pos, []).append(c)
    for pos, c in had:
        if c and c in offered.get(pos, ()):
            offered[pos].remove(c)
    # The learner's own marks count as marked; a quote of theirs does not
    # (「休む」 says nothing about where 休 is).
    marked = {ch for _, c in had if all(_is_kanji(ch) for ch in c) for ch in c}
    fills: list[str | None] = []
    for pos, c in had:
        fill = None
        if not c and offered.get(pos):
            # The word before an empty bracket gets what is put in it, and
            # nothing more.
            fill = offered.pop(pos)[0]
            marked.update(fill)
        fills.append(fill)
    ok = set(listed)
    inserts: dict[int, list[str]] = {}
    for pos, cs in offered.items():
        for c in cs:
            if c not in ok:
                c = next((f for f in listed if f in kanji_parts.forms(c)), "")
            # One part once, in whichever form: "water [氵][水]" says it twice.
            if not c or pos == 0 or kanji_parts.forms(c) & marked:
                continue
            marked.add(c)
            inserts.setdefault(pos, []).append(c)
    if not inserts and not any(fills):
        return text
    out: list[str] = []
    seen = 0

    def copy(chunk: str) -> None:
        nonlocal seen
        for ch in chunk:
            out.append(ch)
            if ch.isspace():
                continue
            seen += 1
            if seen in inserts:
                gap = "" if _CJK.match(ch) else " "
                out.append(gap + "".join(f"[{c}]" for c in inserts[seen]))

    # The learner's own brackets go through whole, _read did not count them,
    # and an empty one gets what the model put in it.
    at = 0
    for m, fill in zip(_TAG.finditer(text), fills):
        copy(text[at:m.start()])
        out.append(m.group(0)[0] + fill + m.group(0)[-1] if fill else m.group(0))
        at = m.end()
    copy(text[at:])
    return "".join(out)


_cache: OrderedDict[tuple[str, str], str] = OrderedDict()
_cache_lock = threading.Lock()
_CACHE_SIZE = 256


def kanjify(subject: str, text: str) -> str:
    """`text` with the characters of `subject` marked in it. Raises Off with no
    key, Unavailable when the model cannot be reached, Garbled when it did not
    keep to the text."""
    key = (subject, text)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise Off()
    ctx, listed = context(subject)
    try:
        res = requests.post(
            URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": os.environ.get("APP_URL", "https://betterkanjidictionary.org"),
                "X-Title": "Better Kanji Dictionary",
            },
            json={
                "model": MODEL,
                "reasoning": REASONING,
                # Thinking counts against the cap, and the answer is the text again.
                "max_tokens": 3000 + 2 * len(text),
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": _PROMPT + "\n\n" + ctx},
                    {"role": "user", "content": text},
                ],
            },
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise Unavailable(str(e)) from e
    if not res.ok:
        print(f"[kanjify] OpenRouter {res.status_code}: {res.text[:300]}", flush=True)
        raise Unavailable(f"OpenRouter answered {res.status_code}")
    try:
        answer = res.json()["choices"][0]["message"].get("content") or ""
    except (ValueError, KeyError, IndexError) as e:
        raise Unavailable(f"an answer without text: {e}") from e
    result = merge(text, answer, listed)
    with _cache_lock:
        _cache[key] = result
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return result
