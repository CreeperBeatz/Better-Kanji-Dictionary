"""Put what Dani's two print dictionaries say into the review queue.

    python pipeline/book_sources.py count                 # what it would add
    python pipeline/book_sources.py load [--review-dir D]  # put it in the queue

The books (server/books.py) are Цалта's kanji book (2,800 kanji: a Bulgarian
keyword, the parts with Bulgarian names, the old form, example words with
Bulgarian glosses) and Иванов's Bulgarian-Japanese dictionary (3,921
entries), transcribed by vision agents in Documents/JapaneseDictionaries.
Nothing here goes live: the goal is data that is right, so every use of the
books passes a person, who has the page's scan on the card to catch a misread.

- **Decomposition**: a kanji in scope the book splits otherwise than our
  graph gets an item (`tsalta-diff`), the book's parts written as our nodes
  (review_sources' folding). An open item about the kanji gets the book's
  split beside it as evidence instead; one decided by a person gets a new item.
  A split into a bare stroke (百 = 一 + 白), into a shape the graph does
  not have, or with a part the agent found no character for (the top of 京)
  is not proposed, only counted.
- **Form links**: an old form the book gives that we do not have (沒 for 没)
  is proposed as one (`tsalta`); the book also calls some name variants old
  forms (埜 for 野), which the reviewer turns into another kind or rejects.
- **Part meanings, Bulgarian**: the book's view is attached to the open
  items as evidence (`book`) and the proposal is left as it is: the part's
  Bulgarian names and the grapheme's note; a kanji's keyword and second
  meaning; for a word, every gloss either book gives it.

Fields the transcribing agent marked unsure travel with the evidence, so the
card can say so. Loading again after the books were corrected restates this
loader's open items, withdraws the ones the books no longer support, and
takes the books' view off cards it no longer fits; decided items stay as they are.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
import review_sources as rs  # noqa: E402
from decomp import BARE_STROKES, is_stroke  # noqa: E402
from proposals import review  # noqa: E402

from server import books, store  # noqa: E402
from server import scope as review_scope  # noqa: E402
from server.japanese import deinflect, katakana_to_hiragana, romaji_to_kana  # noqa: E402

SOURCE_DECOMP = "tsalta-diff"
SOURCE_FORM = "tsalta"
OWN = (SOURCE_DECOMP, SOURCE_FORM)  # this loader's own items: re-reading the books restates them
KEY = "book"  # where the books' view goes in an item's evidence


# ---------------------------------------------------------------- the books


def read_books() -> tuple[list[dict], list[dict]]:
    """The kanji book's entries (kanji and graphemes) and the bg-ja dictionary's."""
    d = books.books_dir()
    kanji = [json.loads(line) for line in (d / "kanji" / "kanji.jsonl").read_text(encoding="utf-8").splitlines() if line]
    bgja = [json.loads(line) for line in (d / "bg-ja" / "bg-ja.jsonl").read_text(encoding="utf-8").splitlines() if line]
    # The stitched bg-ja file lost the agents' flags; they are on the raw pages, by printed text.
    flags: dict[tuple[str, str], list[str]] = {}
    for f in sorted((d / "bg-ja" / "raw").glob("p*.json")):
        for b in json.loads(f.read_text(encoding="utf-8")).get("blocks", []):
            why = [u.get("why", "") for u in (b.get("uncertain") or [])] + [t.get("why", "") for t in (b.get("book_typo") or [])]
            if why and b.get("bg"):
                flags[(b["bg"], b.get("ja") or "")] = why
    for e in bgja:
        e["unsure"] = flags.get((e["raw"]["bg"], e["raw"].get("ja") or ""), [])
    return kanji, bgja


def unsure(entry: dict, *prefixes: str) -> list[str]:
    """What the agent was unsure of in these fields of an entry, in its words."""
    out = []
    for flag in (*(entry.get("uncertain") or []), *(entry.get("book_typo") or [])):
        path = flag.get("path", "")
        if not prefixes or any(path == p or path.startswith((p + "[", p + ".")) for p in prefixes):
            out.append(f"{path}: {flag.get('why', '')}")
    return out


def ref(entry: dict) -> dict:
    """Where an entry of the kanji book is: its number and printed pages."""
    return {"book": "kanji", "no": entry.get("no"), "char": entry.get("kanji") or entry.get("char"), "pages": entry["pages"]}


# ---------------------------------------------------------------- readings

_KANA = {
    "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o", "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
    "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so", "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
    "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no", "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
    "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo", "や": "ya", "ゆ": "yu", "よ": "yo",
    "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro", "わ": "wa", "ゐ": "i", "ゑ": "e", "を": "o", "ん": "n",
    "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go", "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
    "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do", "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po", "ゔ": "vu",
    "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o", "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ゎ": "wa",
}


def kana_romaji(s: str) -> str:
    """Hepburn, roughly: enough to compare with the books' romaji after fold()."""
    s = katakana_to_hiragana(s)
    out: list[str] = []
    double = False
    for i, c in enumerate(s):
        if c == "っ":
            double = True
            continue
        if c == "ー":
            out.append(next((ch for ch in reversed("".join(out)) if ch in "aeiou"), ""))
            continue
        r = _KANA.get(c, "")
        if c in "ゃゅょ" and out and out[-1].endswith("i") and len(out[-1]) > 1:
            prev = out.pop()[:-1]
            r = (prev if prev in ("sh", "ch", "j") else prev + "y") + r[1]
        elif c in "ぁぃぅぇぉ" and out and out[-1]:
            out[-1] = out[-1][:-1]
        if double and r:
            r = ("t" if r.startswith("ch") else r[0]) + r
            double = False
        out.append(r)
    return "".join(out)


_MACRON = str.maketrans("āēīōūâêîôû", "aeiouaeiou")


def fold(romaji: str) -> str:
    """The two books and Hepburn spell long vowels and syllabic n differently: fold them away."""
    s = re.sub(r"[^a-z]", "", romaji.lower().translate(_MACRON))
    s = s.replace("tch", "cch")
    s = re.sub(r"m(?=[bmp])", "n", s)
    for pair, single in (("ou", "o"), ("oo", "o"), ("uu", "u"), ("aa", "a"), ("ii", "i"), ("ee", "e")):
        s = s.replace(pair, single)
    return s


class Words:
    """Every JMdict word by each written form and kana spelling, with its readings folded."""

    def __init__(self, db):
        self.by_text: dict[str, set[int]] = defaultdict(set)
        self.readings: dict[int, set[str]] = defaultdict(set)
        for wid, text, kana in db.execute("SELECT word_id, text, kana FROM word_form"):
            self.by_text[text].add(wid)
            if kana:
                self.readings[wid].add(fold(kana_romaji(text)))
        for wid, head, reading in db.execute("SELECT id, headword, reading FROM word"):
            self.by_text[head].add(wid)
            self.readings[wid].add(fold(kana_romaji(reading)))

    def find(self, ja: str, romaji: str | None) -> set[int]:
        """The words written `ja` and read `romaji`; with no reading to tell them apart, only an unambiguous one."""
        ja = re.sub(r"[（(][^）)]*[）)]|[〜～]", "", ja).strip()
        if not ja:
            return set()
        if "[" in ja:  # [お]花見: with and without the optional part
            return self.find(re.sub(r"\[[^\]]*\]", "", ja), romaji) or self.find(re.sub(r"[\[\]]", "", ja), romaji)
        texts = [ja] + [c.text for c in deinflect(ja)[1:]]  # 押します -> 押す, 楽しく -> 楽しい
        texts += [ja[: -len(end)] for end in ("な", "の", "に", "する", "します") if ja.endswith(end) and len(ja) > len(end)]
        readings = set()
        for r in re.split(r"[,、]", re.sub(r"[（(][^）)]*[）)]", "", romaji or "")):
            r = re.sub(r"\s+(na|no|ni|da|shimasu|suru)$", "", r.strip().lower())
            if not r:
                continue
            readings.add(fold(r))
            # wasuremasu -> 忘れる: the polite form's reading, taken back like its kanji
            kana = romaji_to_kana(r.translate(_MACRON).replace(" ", ""))
            readings |= {fold(kana_romaji(c.text)) for c in deinflect(kana)[1:]} if kana else set()
        for text in dict.fromkeys(texts):
            ids = self.by_text.get(text, set())
            if not ids:
                continue
            hit = {i for i in ids if self.readings[i] & readings} if readings else set()
            if hit:
                return hit
            if not readings and len(ids) == 1:
                return set(ids)
        return set()


# ---------------------------------------------------------------- what to add


def _open_items(type_: str) -> dict[str, list[dict]]:
    """Open items of a type, by subject; this loader's own are not "another item" to stand beside."""
    out: dict[str, list[dict]] = defaultdict(list)
    for i in review._read()["items"].values():
        if i["type"] == type_ and i["status"] == "open" and i["source"] not in OWN:
            out[i["subject"]].append(i)
    return out


def _own() -> dict[tuple[str, str], str]:
    """(type, subject) -> id of this loader's open items, which a reload restates or withdraws."""
    return {(i["type"], i["subject"]): i["id"] for i in review._read()["items"].values()
            if i["status"] == "open" and i["source"] in OWN}


def collect() -> dict:
    db = proposals.connect()
    kanji_book, bgja = read_books()
    entries = [e for e in kanji_book if e["type"] == "kanji"]
    # A kanji the book has twice is a misread headword (№112 畠 was read as 畑):
    # neither entry can be trusted to be about it, so neither is used.
    twice = {k for k, v in Counter(e["kanji"] for e in entries).items() if v > 1}
    if twice:
        print(f"  the book has these kanji twice, both left out: {''.join(sorted(twice))}")
        entries = [e for e in entries if e["kanji"] not in twice]
    graphemes = [e for e in kanji_book if e["type"] == "grapheme"]
    data = review._read()
    decided = {i["subject"] for i in data["items"].values() if i["type"] == "decomposition" and i["status"] not in ("open", "withdrawn")}

    # -- decomposition
    targets = review_scope.kanji(db)
    children, nodes = rs.graph(db)
    scope = rs.closure(children, targets)
    eq = rs.equivalence(db)
    use = Counter(c for cs in children.values() for c in cs)
    prefer: dict[str, str] = {}
    for c in sorted(nodes, key=lambda c: -use[c]):
        prefer.setdefault(eq.get(c, c), c)
    fanout = dict(db.execute("SELECT char, joyo_count FROM fanout"))
    freq = dict(db.execute("SELECT char, freq FROM kanji"))
    open_decomp = _open_items("decomposition")

    n = Counter()
    new_decomp, attach_decomp = [], {}
    for e in entries:
        x, raw = e["kanji"], [p["char"] for p in e["parts"] if p.get("char")]
        ours = children.get(x, [])
        if x not in scope or not raw or not ours:
            continue  # atomic in our graph: a primitive, not a split to argue with
        mapped = rs._ours(raw, nodes, eq, prefer)
        whole = len(raw) == len(e["parts"])  # every part has a character: the split is the whole kanji
        usable = whole and mapped is not None and x not in mapped and not any(p in BARE_STROKES or is_stroke(p) for p in mapped)
        view = {**ref(e), "parts": e["parts"], "split": mapped if usable else None, "unsure": unsure(e, "parts")}
        for i in open_decomp.get(x, []):
            attach_decomp[i["id"]] = view
        if whole and (rs._same(raw, ours, eq) or (usable and rs._same(mapped, ours, eq))):
            n["decomp agrees"] += 1
            continue
        if not whole:
            # A part the agent could not name a character for (the top of 京, 売's 冖儿): the
            # rest is not the whole kanji, so it is shown beside an item but never proposed.
            n["decomp differs, a part with no code point"] += 1
            continue
        if mapped is None or x in mapped:
            n["decomp differs, a part not in our graph"] += 1
            continue
        if not usable:
            n["decomp differs, into a bare stroke"] += 1
            continue
        if x in open_decomp:
            n["decomp differs, beside an open item"] += 1
            continue
        gained = rs.below(children, mapped, x) - rs.below(children, ours, x)
        why = f"the kanji book splits it as {''.join(mapped)}"
        if gained:
            why += f"; adds {''.join(sorted(gained)[:8])} as prerequisites"
        if x in decided:
            why = "decided before, without the book; " + why
        weight = (fanout.get(x) or 0) + (5 if (freq.get(x) or 9999) <= 1000 else 0)
        new_decomp.append({"type": "decomposition", "subject": x, "proposed": mapped, "source": SOURCE_DECOMP, "reason": why,
                           "evidence": {KEY: view},
                           "priority": round(weight - (1 if view["unsure"] else 0), 2)})
        n["decomp new items"] += 1

    # -- form links: old forms
    known_links = {i["subject"] for i in data["items"].values() if i["type"] == "form_link" and i["status"] != "withdrawn"
                   and not (i["status"] == "open" and i["source"] in OWN)}
    open_links = _open_items("form_link")
    new_links, attach_links = [], {}
    for e in entries:
        a, b = e["kanji"], e.get("old_form")
        if not b or len(b) != 1 or b == a:
            continue
        view = {**ref(e), "old": b, "unsure": unsure(e, "old_form")}
        for subject in (f"{a}|{b}", f"{b}|{a}"):
            for i in open_links.get(subject, []):
                attach_links[i["id"]] = view
        if f"{a}|{b}" in known_links or f"{b}|{a}" in known_links:
            n["old form already an item"] += 1
            continue
        if review.current("form_link", f"{a}|{b}")["kind"] != "none":
            n["old form linked already"] += 1
            continue
        new_links.append({"type": "form_link", "subject": f"{a}|{b}",
                          "proposed": {"kind": "old", "note": f"Цалта's kanji book, №{e['no']}"},
                          "source": SOURCE_FORM, "reason": f"the kanji book gives {b} as the old form of {a}",
                          "evidence": {KEY: view}, "priority": 1.0})
        n["old form new items"] += 1

    # -- part meanings: the parts' Bulgarian names
    names: dict[str, Counter] = defaultdict(Counter)
    seen_in: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        for p in e["parts"]:
            if p.get("char") and p.get("name"):
                names[p["char"]][p["name"].lower()] += 1
                if len(seen_in[p["char"]]) < 3:
                    seen_in[p["char"]].append({**ref(e), "name": p["name"].lower()})
    by_char = {g["char"]: g for g in graphemes if g.get("char")}
    by_char.update({e["kanji"]: e for e in entries})
    attach_parts = {}
    for subject, items in _open_items("part_meaning").items():
        g = by_char.get(subject)
        if subject not in names and not g:
            continue
        view = {
            "names": [[name, k] for name, k in names[subject].most_common()],  # lists, as the store gives them back
            "entry": {**ref(g), "name": (g.get("name") or g.get("keyword") or "").lower() or None, "note": g.get("note"),
                      "unsure": unsure(g, "char", "name", "note")} if g else None,
            "seen": seen_in[subject],
        }
        for i in items:
            attach_parts[i["id"]] = view

    # -- Bulgarian: a kanji's keyword, a word's glosses
    open_bg = _open_items("bg")
    attach_bg = {}
    for e in entries:
        for i in open_bg.get(f"kanji:{e['kanji']}", []):
            attach_bg[i["id"]] = {**ref(e), "keyword": e["keyword"].lower(), "alt": e.get("alt_meaning"),
                                  "unsure": unsure(e, "keyword", "alt_meaning")}
    words = Words(db)
    glosses: dict[int, list[dict]] = defaultdict(list)
    for e in entries:
        for k, w in enumerate(e["words"]):
            ids = words.find(w["ja"], w.get("romaji"))
            n["kanji-book words found" if ids else "kanji-book words not found"] += 1
            for wid in ids:
                glosses[wid].append({**ref(e), "ja": w["ja"], "romaji": w.get("romaji"), "bg": w["bg"],
                                     "unsure": unsure(e, f"words[{k}]"), "shared": len(ids) > 1})
    for e in bgja:
        ids = set()
        for f in e["forms"] or []:
            for part in re.split("[、・]", f.get("ja") or ""):
                ids |= words.find(part, f.get("romaji"))
        n["bg-ja entries found" if ids else "bg-ja entries not found"] += 1
        for wid in ids:
            glosses[wid].append({"book": "bg-ja", "pages": e["pages"], "bg": ", ".join(e["bg"]),
                                 "notes": e["bg_notes"], "ja": " / ".join(f["ja"] for f in e["forms"] or []),
                                 "romaji": " / ".join(f.get("romaji") or "" for f in e["forms"] or []), "unsure": e["unsure"],
                                 # イースト is yeast and east: the gloss may be the other word's
                                 "shared": len(ids) > 1})
    for wid, gs in glosses.items():
        # The same gloss printed twice (a word under two of its kanji) is shown once.
        once = list({(g["book"], g["bg"]): g for g in gs}.values())
        for i in open_bg.get(f"word:{wid}", []):
            attach_bg[i["id"]] = once
    n["word cards with a book gloss"] = sum(1 for k, v in attach_bg.items() if isinstance(v, list))
    n["words with a book gloss, no open card"] = sum(1 for wid in glosses if f"word:{wid}" not in open_bg)

    return {"counts": n, "new": new_decomp + new_links, "own": _own(),
            "attach": {"decomposition": attach_decomp, "form_link": attach_links, "part_meaning": attach_parts, "bg": attach_bg}}


def plan(c: dict) -> dict:
    """What loading does to the queue: new items, this loader's open items to restate
    or withdraw (the books were corrected since), and evidence that no longer applies."""
    own, new = c["own"], {(r["type"], r["subject"]): r for r in c["new"]}
    attached = {i for by_item in c["attach"].values() for i in by_item}
    return {
        "add": [r for k, r in new.items() if k not in own],
        "restate": {own[k]: r for k, r in new.items() if k in own},
        "withdraw": [i for k, i in own.items() if k not in new],
        "drop": [i["id"] for i in review._read()["items"].values()
                 if i["status"] == "open" and i["source"] not in OWN and isinstance(i["evidence"], dict)
                 and KEY in i["evidence"] and i["id"] not in attached],
    }


def count() -> dict:
    c = collect()
    for k, v in sorted(c["counts"].items()):
        print(f"  {k:42} {v:>6}")
    for k, v in c["attach"].items():
        print(f"  evidence for open {k} items{'':16} {len(v):>6}")
    p = c["plan"] = plan(c)
    print(f"  queue: {len(p['add'])} new, {len(p['restate'])} of ours restated, {len(p['withdraw'])} of ours withdrawn, "
          f"evidence off {len(p['drop'])} items")
    return c


def load(review_dir: Path | None) -> None:
    if review_dir and store.ASSOC_DIR.resolve() == (proposals.ROOT / "data" / "associations").resolve():
        # The graph is read from the association store: loading another review folder against the real one would mix them.
        raise SystemExit("--review-dir with the real associations store: use tests/load_sandbox.py")
    proposals.use_review_dir(review_dir)
    c = count()
    p = c["plan"]
    added, refused = review.add_items(p["add"])
    print(f"new items: {added} added, {refused} refused")
    changed, refused = review.restate(p["restate"])
    print(f"our open items: {changed} changed, {len(p['restate']) - changed - refused} as they were, {refused} refused")
    print(f"withdrawn, the books no longer give them: {review.withdraw(p['withdraw'], 'the corrected book no longer gives this')}")
    for type_, by_item in c["attach"].items():
        print(f"evidence on open {type_} items: {review.attach_evidence(KEY, by_item)}")
    print(f"evidence that no longer applies, taken off: {review.drop_evidence(KEY, p['drop'])}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("count")
    l = sub.add_parser("load")
    l.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.cmd == "count":
        count()
    else:
        load(args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
