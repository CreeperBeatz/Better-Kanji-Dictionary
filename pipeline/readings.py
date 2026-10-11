"""Which reading of a kanji each word uses, and the kanji's classical radical.

JmdictFurigana says which kana of a word's reading go over which kanji. For
every word written with a kanji, the kana over it are matched to one of the
kanji's readings, allowing for the sound changes compounds make: 学 in 学校 is
がっ, がく with its last kana doubled; 社 in 会社 is しゃ, but in 神社 じゃ.
A kun reading is told from its look-alikes by the okurigana after it: 上る is
のぼ.る, 上り坂 のぼ.り.

A word is a special reading of the kanji (Kodansha's term) when the kana go
over more than one kanji at once -- 今日 きょう, 一日 ついたち, 芝生 しばふ --
or match none of its readings: 為替 かわせ.

The radical is KANJIDIC's classical one, by its Kangxi number.
"""

from __future__ import annotations

import gzip
import io
import json
import sqlite3
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

DATA = Path(__file__).parent / "data"

_VOICED = dict(zip("かきくけこさしすせそたちつてとはひふへほ", "がぎぐげござじずぜぞだぢづでどばびぶべぼ"))
_SEMI = dict(zip("はひふへほ", "ぱぴぷぺぽ"))
# The kana a reading can end in that a compound doubles: がく -> がっ in 学校.
_DOUBLED = set("つちくき")


def _hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def sounds(reading: str) -> list[str]:
    """The reading as a compound can say it: as is, voiced or half-voiced at
    the start, and with its last kana doubled. As is comes first."""
    starts = [reading]
    if reading and reading[0] in _VOICED:
        starts.append(_VOICED[reading[0]] + reading[1:])
    if reading and reading[0] in _SEMI:
        starts.append(_SEMI[reading[0]] + reading[1:])
    out = list(starts)
    if len(reading) > 1 and reading[-1] in _DOUBLED:
        out += [s[:-1] + "っ" for s in starts]
    return out


def plain(reading: str) -> str:
    """A reading as the page keys it: the dashes that mark a prefix or suffix dropped."""
    return reading.strip("-")


def _kana(c: str) -> bool:
    return "ぁ" <= c <= "ゟ"


def _okuri_fit(okuri: str, tail: str) -> int | None:
    """How well `tail`, the kana that go on after the stem, fit the okurigana:
    0 as written (上る, のぼ.る), 1 conjugated (下らない, くだ.る; 学び, まな.ぶ)
    or cut short (売上 うりあげ, あ.げる), None not at all."""
    if tail.startswith(okuri):
        return 0
    if okuri and tail[: len(okuri) - 1] == okuri[:-1] and len(tail) >= len(okuri) and _kana(tail[len(okuri) - 1]):
        return 1
    if tail and okuri.startswith(tail):
        return 1
    return None


def match(rt: str, after: str, on: list[str], kun: list[str]) -> str | None:
    """The reading of the kanji the kana `rt` are, `after` being the text that
    follows the kanji in the word; None when none of them fits.

    The kana over the kanji may carry okurigana the spelling leaves out: 売上
    うりあげ is あ.げる with げ unwritten, 取引 とりひき is ひ.く."""
    tail = ""
    for c in after:
        if not _kana(c):
            break
        tail += c
    best: tuple | None = None
    for r in [*on, *kun]:
        p = plain(r)
        stem, _, okuri = p.partition(".")
        for changed, form in enumerate(sounds(_hira(stem))):
            if not rt.startswith(form):
                continue
            unwritten = rt[len(form):]
            if unwritten and not okuri:
                continue
            fit = _okuri_fit(okuri, unwritten + tail) if okuri else (0 if not tail else 1)
            if fit is None:
                continue
            # Kana after the kanji are better explained by okurigana than by a
            # noun reading with a particle after it: 生み is う.む, not う.
            key = (changed > 0, fit, bool(tail) and not okuri, -len(okuri))
            if best is None or key < best[0]:
                best = (key, p)
    return best[1] if best else None


def furigana() -> dict[tuple[str, str], list[dict]]:
    with zipfile.ZipFile(DATA / "furigana" / "JmdictFurigana.json.zip") as z:
        rows = json.loads(z.read(z.namelist()[0]).decode("utf-8-sig"))
    return {(r["text"], r["reading"]): r["furigana"] for r in rows}


def word_readings(db: sqlite3.Connection) -> list[tuple]:
    """(char, word_id, reading or None, kana, span, written, whole, main) for
    every kanji in every way a word is written and read: `written`, `whole`.
    `span` is the kanji the kana go over: the kanji itself, or 今日 for きょう.
    `main`: the entry's first spelling without numerals, read its first way --
    一日 ついたち in the entry headed １日, but not 良人 in the one headed 夫."""
    readings = {
        c: (json.loads(on or "[]"), json.loads(kun or "[]"))
        for c, on, kun in db.execute("SELECT char, on_yomi, kun_yomi FROM kanji")
    }
    split = furigana()
    # Every spelling with every reading, not only the headword's first: 一日 is
    # いちにち, and also ついたち, an entry headed 朔日. The furigana list has only
    # the pairs JMdict allows.
    pairs = db.execute(
        "SELECT t.word_id, t.text, k.text FROM word_form t "
        "JOIN word_form k ON k.word_id = t.word_id AND k.kana = 1 AND k.rare = 0 "
        "WHERE t.kana = 0 AND t.rare = 0 ORDER BY t.word_id, t.ord, k.ord"  # as the entry heads it first
    ).fetchall()
    out: list[tuple] = []
    main: dict[int, tuple[str, str]] = {}
    for wid, written, kana in pairs:
        parts = split.get((written, kana))
        if not parts:
            continue
        if wid not in main and not any(c.isdigit() for c in written):
            main[wid] = (written, kana)
        at = 0
        seen: set[str] = set()
        for part in parts:
            ruby, rt = part["ruby"], part.get("rt")
            at += len(ruby)
            if not rt:
                continue
            for c in ruby:
                if c not in readings or c in seen:
                    continue
                seen.add(c)
                if len(ruby) == 1:
                    reading = match(rt, written[at:], *readings[c])
                else:
                    reading = None
                out.append((c, wid, reading, rt, ruby, written, kana, main.get(wid) == (written, kana)))
    return out


def radicals() -> list[tuple[str, int, str]]:
    """(char, Kangxi number, the radical) from KANJIDIC's classical radical."""
    out = []
    with gzip.open(DATA / "kanjidic2.xml.gz", "rb") as f:
        for _, el in ET.iterparse(io.BufferedReader(f), events=("end",)):
            if el.tag != "character":
                continue
            literal = el.findtext("literal")
            for rv in el.iter("rad_value"):
                if rv.get("rad_type") == "classical" and rv.text:
                    n = int(rv.text)
                    # The Kangxi Radicals block is in Kangxi order; NFKC gives the ordinary kanji.
                    out.append((literal, n, unicodedata.normalize("NFKC", chr(0x2F00 + n - 1))))
                    break
            el.clear()
    return out


def build(db: sqlite3.Connection) -> None:
    db.executescript("""
        DROP TABLE IF EXISTS word_reading;
        CREATE TABLE word_reading (
            char    TEXT NOT NULL,
            word_id INTEGER NOT NULL,
            reading TEXT,            -- the kanji's reading, as the kanji table writes it, dashes off; NULL: special
            kana    TEXT NOT NULL,   -- the kana over it in this word: がっ in 学校
            span    TEXT NOT NULL,   -- the kanji those kana go over: 今日 for きょう, else the kanji itself
            written TEXT NOT NULL,   -- the word as written here: 二十日, an entry headed ２０日
            whole   TEXT NOT NULL,   -- the word's reading this is in: 一日 is いちにち, and ついたち
            main    INTEGER NOT NULL, -- 1: the entry's own spelling and reading (see word_readings)
            PRIMARY KEY (char, word_id, kana)
        );
        DROP TABLE IF EXISTS classical_radical;
        CREATE TABLE classical_radical (
            char    TEXT PRIMARY KEY,
            number  INTEGER NOT NULL,  -- Kangxi, 1-214
            radical TEXT NOT NULL
        );
    """)
    rows = word_readings(db)
    db.executemany("INSERT OR IGNORE INTO word_reading VALUES (?,?,?,?,?,?,?,?)", rows)
    db.execute("CREATE INDEX word_reading_reading ON word_reading (char, reading)")
    special = sum(1 for r in rows if r[2] is None)
    print(f"  readings      {len(rows):>7,} kanji in words, {special:,} of them special readings")
    rads = radicals()
    db.executemany("INSERT OR IGNORE INTO classical_radical VALUES (?,?,?)", rads)
    print(f"  radicals      {len(rads):>7,} characters with a classical radical")
