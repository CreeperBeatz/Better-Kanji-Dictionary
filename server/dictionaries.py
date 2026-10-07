"""Other dictionaries' view of a kanji's meanings, for the meanings card.

What the reviewer judges the groups and the words' places by, beside KANJIDIC
and Kanji Alive (review._kanji_info):

- **Kodansha** (Halpern's Kanji Learner's Dictionary): core meanings, the
  on-reading senses (1a, 1b, 2 ...) with the compounds listed under each, each
  kun word with its own senses, and the special readings (ateji, jukujikun).
- **新漢語林**: 字義, the senses ❶❷ with their example words in 「」, a
  Japan-only sense marked 国; and 解字.
- **Цалта**: drawn by the card from its book entry (books.kanji_ref); its
  example words are matched here like the others'.
- **Wiktionary** (English, Japanese section): the kanji's own entries, one
  per part of speech and reading.

All of it is transcribed in Documents/JapaneseDictionaries (books.books_dir)
or extracted by pipeline/wiktionary_kanji.py, read from there, and only ever
shown to reviewers: nothing is copied into the data. A server without the
files just shows less.

`view` also matches each dictionary's words to the board's (JMdict ids, by
written form, the reading deciding between entries that share one: 生物
せいぶつ is not なまもの), so the board can say, per word, where each
dictionary puts it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

from . import books
from .db import query
from .japanese import katakana_to_hiragana, romaji_to_kana

ROOT = Path(__file__).parent.parent
WIKTIONARY = ROOT / "data" / "drafts" / "wiktionary-kanji.json"

_cache: dict[str, tuple[object, object]] = {}


def _cached(key: str, stamp: object, build):
    """`build()`, kept until `stamp` (the files' mtimes) changes."""
    hit = _cache.get(key)
    if hit is None or hit[0] != stamp:
        hit = (stamp, build())
        _cache[key] = hit
    return hit[1]


def _jsonl(f: Path) -> list[dict]:
    return [json.loads(line) for line in f.read_text(encoding="utf-8").splitlines() if line.strip()]


# ---------------------------------------------------------------- Kodansha


def _kodansha() -> dict[str, dict]:
    f = books.books_dir() / "kodansha" / "kodansha.jsonl"
    if not f.is_file():
        return {}

    def build():
        out: dict[str, dict] = {}
        for e in _jsonl(f):
            if e.get("type") == "kanji" and e.get("kanji"):
                out.setdefault(e["kanji"], e)
        return out

    return _cached("kodansha", (str(f), f.stat().st_mtime), build)


def _kodansha_view(e: dict) -> dict:
    """The entry as the card shows it: each sense with the words listed under it."""
    s = e.get("sections") or {}

    def senses(items: list[dict], prefix: str) -> list[dict]:
        out, by = [], {}
        for x in items:
            if x.get("kind") == "sense":
                one = {"key": f"{prefix}{x['sense']}", "n": x["sense"], "text": x.get("text") or "", "words": []}
                by[x["sense"]] = one
                out.append(one)
        for x in items:
            if x.get("kind") == "word":
                one = by.get(x.get("sense") or "")
                if one is None:  # a word under no sense: a sense of its own, unnamed
                    one = by[""] = {"key": prefix.rstrip(":") or "c", "n": "", "text": "", "words": []}
                    out.append(one)
                one["words"].append({"ja": x.get("ja"), "reading": x.get("reading"), "gloss": x.get("gloss")})
        return out

    kun, cur, rows = [], None, []
    for x in s.get("kun") or []:
        if x.get("kind") == "headword":
            if cur:
                kun.append({**cur, "senses": senses(rows, f"k:{cur['head']}:")})
            cur, rows = {"head": x.get("kanji") or x.get("kana"), "kana": x.get("kana"), "text": x.get("text")}, []
        else:
            rows.append(x)
    if cur:
        kun.append({**cur, "senses": senses(rows, f"k:{cur['head']}:")})
    # A kun word with no senses of its own is one "sense", the headword's own.
    for k in kun:
        if not k["senses"]:
            k["senses"] = [{"key": f"k:{k['head']}", "n": "", "text": k.get("text") or "", "words": []}]

    return {
        "no": e.get("no"),
        "pages": e.get("pdf_pages") or [],
        "core": e.get("core_meanings") or [],
        # The entry's top block, as the book prints it beside the headword.
        "on": e.get("on") or [], "kunReadings": e.get("kun") or [], "grade": e.get("grade"),
        "strokes": e.get("strokes"), "skip": e.get("skip"), "unicode": e.get("unicode"),
        "senses": senses(s.get("compounds") or [], "c:"),
        "kun": kun,
        "independent": [{"head": x.get("kanji") or x.get("kana"), "kana": x.get("kana"), "text": x.get("text")}
                        for x in s.get("independent") or [] if x.get("kind") == "headword"],
        "special": [{"ja": x.get("ja"), "reading": x.get("reading"), "gloss": x.get("gloss")}
                    for x in s.get("special_readings") or [] if x.get("kind") == "word"],
    }


# ---------------------------------------------------------------- 新漢語林


def _kangorin() -> dict[str, dict]:
    """Each kanji's entry, stitched from the transcribed pages (the book is still being transcribed)."""
    d = books.books_dir() / "kangorin" / "raw"
    if not d.is_dir():
        return {}
    files = sorted(d.glob("p*.json"))
    stamp = (len(files), max((f.stat().st_mtime for f in files), default=0))

    def build():
        out: dict[str, list[dict]] = {}
        cur: dict | None = None
        for f in files:
            page = json.loads(f.read_text(encoding="utf-8"))
            for b in page.get("blocks") or []:
                t = b.get("type")
                if t == "kanji":
                    # The old form in 〖〗 right after the headword (【会】〖會〗) is the same entry.
                    if b.get("bracket") == "〖〗" and cur is not None and not cur["sections"] and b.get("kanji"):
                        cur["old"] = b["kanji"]
                        out.setdefault(b["kanji"], []).append(cur)
                        continue
                    # A pointer (生部。→ ページ) is not an entry: it only ends the one before.
                    cur = None
                    if b.get("no") and b.get("kanji"):
                        cur = {"kanji": b["kanji"], "no": b["no"], "classes": b.get("classes") or [],
                               "joyo": b.get("joyo") or [], "pages": [page.get("pdf_page")], "sections": {},
                               "compounds": []}
                        out.setdefault(b["kanji"], []).append(cur)
                    continue
                if cur is None:
                    continue
                if page.get("pdf_page") not in cur["pages"]:
                    cur["pages"].append(page.get("pdf_page"))
                if t == "section":
                    label = b.get("label")
                    text = b.get("text") or ""
                    if label == "字義" and "字義" in cur["sections"]:
                        # A second 字義: the next entry, its headword missed at a page break. Not this kanji's.
                        cur = None
                        continue
                    if label:
                        cur["sections"][label] = cur["sections"].get(label, "") + text
                        cur["last"] = label
                    elif b.get("cont_prev") and cur.get("last"):
                        cur["sections"][cur["last"]] += text
                elif t == "compound":
                    if b.get("heading"):
                        cur["compounds"].append(b["heading"])
                        cur["last"] = None
                    elif b.get("cont_prev") and cur.get("last"):
                        cur["sections"][cur["last"]] += b.get("text") or ""
        # A headword met twice (a misread number, a repeated page): the entry with the fullest 字義.
        return {c: max(es, key=lambda e: len(e["sections"].get("字義") or "")) for c, es in out.items()}

    return _cached("kangorin", (str(d), stamp), build)


# A reading group is [一] or a bare 一 just before its ❶ (一❶した。… 二❶くだ-る。…); [国] holds Japan-only senses.
_SENSE_MARK = re.compile(r"(\[[一二三四五国]\]|[一二三四五](?=❶))|([❶-❿⓫-⓴])|(国(?=\*\*))")


def jigi_senses(text: str) -> list[dict]:
    """字義 cut into its senses: ❶ ❷ (under [一] [二] when the readings split them), 国 or [国] = Japan-only senses.
    Text under a reading group with no numbers of its own ([二]つくる。なす。) is that group's one sense."""
    out: list[dict] = []
    group = ""
    cur = {"n": "", "text": "", "japan": False}
    out.append(cur)
    pos = 0
    for m in _SENSE_MARK.finditer(text):
        cur["text"] += text[pos:m.start()]
        pos = m.end()
        if m.group(1):
            group = m.group(1) if m.group(1).startswith("[") else f"[{m.group(1)}]"
            cur = {"n": group, "text": "", "japan": group == "[国]"}
        else:
            n = m.group(2) or "国"
            # The group's first number: the group's own sense becomes it.
            label = f"{group}{n}"
            if cur["n"] == group and group and not cur["text"].strip():
                out.pop()
            cur = {"n": label, "text": "", "japan": n == "国" or group == "[国]"}
        out.append(cur)
    cur["text"] += text[pos:]
    seen: set[str] = set()
    for s in out:
        s["text"] = s["text"].strip()
        s["key"] = f"g:{s['n']}"
        # A number printed (or transcribed) twice (依 ❷ ❷) still needs a key of its own.
        while s["key"] in seen:
            s["key"] += "'"
        seen.add(s["key"])
        s["examples"] = re.findall(r"「([^」]+)」", s["text"])
        # Its sub-senses ㋐ ㋑, each with its own examples: 造作 and 耕作 are both ❶ つくる, but not one meaning.
        parts = re.split(r"([㋐-㋾])", s["text"])
        s["subs"] = [{"n": parts[i], "key": f"{s['key']}{parts[i]}", "examples": re.findall(r"「([^」]+)」", parts[i + 1])}
                     for i in range(1, len(parts) - 1, 2)]
    return [s for s in out if s["text"]]


def _kangorin_view(e: dict) -> dict:
    sec = e["sections"]
    return {
        "no": e["no"], "classes": e["classes"], "joyo": e["joyo"], "old": e.get("old"), "pages": e["pages"],
        "senses": jigi_senses(sec.get("字義") or ""),
        "kaiji": sec.get("解字"), "note": sec.get("参考"),
        "compounds": len(e["compounds"]),
    }


# ---------------------------------------------------------------- Цалта, Wiktionary


def _tsalta() -> dict[str, dict]:
    f = books.books_dir() / "kanji" / "kanji.jsonl"
    if not f.is_file():
        return {}

    def build():
        out: dict[str, dict] = {}
        for e in _jsonl(f):
            if e.get("type") == "kanji" and e.get("kanji"):
                out.setdefault(e["kanji"], e)
        return out

    return _cached("tsalta", (str(f), f.stat().st_mtime), build)


def _wiktionary() -> dict[str, list[dict]]:
    if not WIKTIONARY.is_file():
        return {}
    return _cached("wiktionary", WIKTIONARY.stat().st_mtime, lambda: json.loads(WIKTIONARY.read_text(encoding="utf-8")))


def _wiktionary_view(entries: list[dict]) -> list[dict]:
    # The "character" entry's forms are labels ("Jōyō kanji"), not readings.
    return [{"pos": e.get("pos"), "glosses": e.get("glosses") or [],
             "readings": [] if e.get("pos") == "character" else e.get("readings") or []} for e in entries]


# ---------------------------------------------------------------- the board's words


def _variants(ja: str, reading: str | None) -> list[tuple[str, str | None]]:
    """A dictionary's word as JMdict may write it: 生保(=生命保険) is both, 写生する is 写生, marks dropped."""
    ja = re.sub(r"[▲△★*]", "", ja or "")
    reading = katakana_to_hiragana(re.sub(r"[▲△★*\s・]", "", reading or "")) or None
    js = [ja.split("(=")[0]] + re.findall(r"\(=([^)]+)\)", ja)
    rs = ([reading.split("(=")[0]] + re.findall(r"\(=([^)]+)\)", reading)) if reading else [None]
    out = []
    for i, j in enumerate(js):
        r = rs[i] if i < len(rs) else None
        out.append((j, r))
        if j.endswith("する") and len(j) > 2:
            out.append((j[:-2], r[:-2] if r and r.endswith("する") else r))
    return out


class _Matcher:
    """The board's words by every written form, with their readings."""

    def __init__(self, words: list[dict]):
        ids = [w["id"] for w in words]
        self.kana: dict[int, set[str]] = {w["id"]: {katakana_to_hiragana(w.get("reading") or "")} for w in words}
        self.by_form: dict[str, list[int]] = {}
        for w in words:
            self.by_form.setdefault(w["headword"], []).append(w["id"])
        for i in range(0, len(ids), 500):
            part = ids[i:i + 500]
            for r in query(f"SELECT word_id, text, kana FROM word_form WHERE word_id IN ({','.join('?' * len(part))})", tuple(part)):
                if r["kana"]:
                    self.kana[r["word_id"]].add(katakana_to_hiragana(r["text"]))
                elif r["word_id"] not in self.by_form.get(r["text"], []):
                    self.by_form.setdefault(r["text"], []).append(r["word_id"])

    def find(self, ja: str, reading: str | None) -> int | None:
        for j, r in _variants(ja, reading):
            ids = self.by_form.get(j) or []
            if r:
                ids = [i for i in ids if r in self.kana[i]]
            elif len(ids) > 1:
                continue
            if ids:
                return ids[0]
        return None


def view(char: str, words: list[dict]) -> dict:
    """Every dictionary's entry for `char`, and where each puts the board's `words` (id -> [tag])."""
    out: dict = {"char": char, "kanjipedia": f"https://www.kanjipedia.jp/search?k={quote(char)}&kt=1&sk=perfect"}
    m = _Matcher(words)
    tags: dict[int, list[dict]] = {}

    def tag(wid: int | None, src: str, key: str, label: str) -> bool:
        if wid is None:
            return False
        if not any(t["src"] == src and t["key"] == key for t in tags.get(wid, [])):
            tags.setdefault(wid, []).append({"src": src, "key": key, "label": label})
        return True

    k = _kodansha().get(char)
    if k:
        kv = _kodansha_view(k)
        for s in kv["senses"]:
            for w in s["words"]:
                w["id"] = m.find(w["ja"], w["reading"])
                tag(w["id"], "kodansha", s["key"], s["n"] or "–")
        for h in kv["kun"]:
            for s in h["senses"]:
                for w in s["words"]:
                    w["id"] = m.find(w["ja"], w["reading"])
                    tag(w["id"], "kodansha", s["key"], f"{h['head']} {s['n']}".strip())
            # The kun word itself (生きる) belongs with its first sense.
            tag(m.find(h["head"] or "", h.get("kana")), "kodansha", h["senses"][0]["key"], h["head"] or "")
        for w in kv["special"]:
            w["id"] = m.find(w["ja"], w["reading"])
            tag(w["id"], "kodansha", "special", "special reading")
        out["kodansha"] = kv

    g = _kangorin().get(char)
    if g:
        gv = _kangorin_view(g)
        for s in gv["senses"]:
            sub = {x: u for u in s["subs"] for x in u["examples"]}
            s["exampleIds"] = []
            for x in s["examples"]:
                wid = m.find(x.split("(")[0], None)
                s["exampleIds"].append(wid)
                u = sub.get(x)
                tag(wid, "kangorin", u["key"] if u else s["key"], f"{s['n']}{u['n'] if u else ''}" or "–")
        out["kangorin"] = gv

    t = _tsalta().get(char)
    if t:
        for w in t.get("words") or []:
            r = romaji_to_kana(w.get("romaji") or "") if w.get("romaji") else None
            tag(m.find(w.get("ja") or "", r), "tsalta", "t", w.get("bg") or "")
        out["tsalta"] = books.kanji_ref(char)

    wk = _wiktionary().get(char)
    if wk:
        out["wiktionary"] = _wiktionary_view(wk)

    out["words"] = {str(k): v for k, v in tags.items()}
    return out
