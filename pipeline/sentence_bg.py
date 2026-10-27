"""Bulgarian for the example sentences on word pages (Dani, 2026-10-27).

    python pipeline/sentence_bg.py prepare [--size 250]   # data/drafts/sentence-bg/in/S-*.json
    # one Opus subagent per in/*.json, each reading pipeline/sentence_bg_prompt.md (pilot S-000..S-004 first)
    python pipeline/sentence_bg.py check [--batch S-000]
    python pipeline/sentence_bg.py sample [--n 40]      # sample.md, for Dani to judge
    python pipeline/sentence_bg.py merge                # -> data/sentence_bg.json
    python pipeline/sentence_bg.py flags                # English or Japanese the translators found wrong

What is translated: every Tatoeba sentence a word page shows (the six shortest of each
word in scope, as search.word_entry picks them, D-040 included), once, from the
Japanese, with Tatoeba's English as a guide and the words it is shown for as context.
Tatoeba's own Bulgarian, where there is one (few, some made from the English and
wrong), goes in as a hint only, as for the sense notes (pipeline/translate_bg.py).
Batches go most-used words first, so the pilot is the sentences seen most.

data/sentence_bg.json: {Tatoeba sentence id: Bulgarian}.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import proposals  # noqa: E402
import translate_bg as tb  # noqa: E402
import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "sentence-bg"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
SITE = ROOT / "data" / "sentence_bg.json"
SHOWN = 6  # sentences per word, as search.word_entry
CONTEXT = 2  # words a sentence is shown for, given as context


def shown() -> dict[int, list[int]]:
    """Sentence id -> the words in scope that show it, best ranked first; the same query as search.word_entry."""
    db = proposals.connect()
    entries = any(r[1] == "entry" for r in db.execute("PRAGMA table_info(sentence_word)"))
    out: dict[int, list[int]] = {}
    for wid in sorted(ws.scope(), key=lambda w: (ws._rank(w), w)):
        mine, args = "", [ws.scope()[wid]["word"]]
        if entries:
            kana = sorted({ws.hira(t) for (t,) in db.execute("SELECT text FROM word_form WHERE word_id = ? AND kana = 1", (wid,))})
            mine = (" AND (sw.entry = ? OR (sw.entry IS NULL AND (sw.reading IS NULL"
                    + (" OR sw.reading IN (" + ",".join("?" * len(kana)) + ")" if kana else "") + ")))")
            args += [wid, *kana]
        for (sid,) in db.execute(f"SELECT s.id FROM sentence_word sw JOIN sentence s ON s.id = sw.sentence_id "
                                 f"WHERE sw.headword = ?{mine} ORDER BY LENGTH(COALESCE(s.real, s.text)) LIMIT {SHOWN}", args):
            out.setdefault(sid, []).append(wid)
    return out


def _context(wid: int) -> str:
    w = ws.scope()[wid]
    return f"{w['word']} 【{w['reading']}】 {ws._short(w['senses'][0][2], 60) if w['senses'] else ''}"


def prepare(size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    db = proposals.connect()
    texts = {sid: (real, en) for sid, real, en in db.execute("SELECT id, real, en FROM sentence")}
    hints = tb._hints()
    sids = shown()  # in order of the best word first: dicts keep insertion order
    items, no_text = [], 0
    for sid, wids in sids.items():
        real, en = texts[sid]
        if not real:
            no_text += 1
            continue
        hint = hints.get(real)
        items.append({"key": f"s{sid}", "ja": real, "en": en, "words": [_context(w) for w in wids[:CONTEXT]],
                      **({"tatoebaBg": hint} if hint else {})})
    for b in range(0, len(items), size):
        name = f"S-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[b:b + size]})
    print(f"{len(items)} sentences ({sum('tatoebaBg' in x for x in items)} with a Tatoeba hint, {no_text} without"
          f" Tatoeba's own text left out) in {-(-len(items) // size)} batches -> {IN}")


def verdicts(batch: str) -> tuple[dict[str, str], list[str]]:
    src = ws._read(IN / f"{batch}.json")
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = ws._read(path).get("items")
    except (json.JSONDecodeError, AttributeError) as e:
        return {}, [f"{batch}: not JSON with an `items` object ({e})"]
    if not isinstance(got, dict):
        return {}, [f"{batch}: no `items` object"]
    by = {it["key"]: it for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in by.keys() - got.keys()] + [f"{batch}: unknown {k}" for k in got.keys() - by.keys()]
    good = {}
    for k, v in got.items():
        it = by.get(k)
        if not it:
            continue
        # With no English, the length is measured against about three times the Japanese.
        bad = tb._bad_bg(it["en"] or "." * 3 * len(it["ja"]), v.get("bg") if isinstance(v, dict) else None)
        if bad:
            probs.append(f"{batch}: {k}: bg needs {bad}")
        else:
            good[k] = v["bg"].strip()
    return good, probs


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    done = 0
    for b in batches:
        good, probs = verdicts(b)
        done += not probs
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    print(f"{done} of {len(batches)} batches complete")


def flags() -> None:
    """The sentences a translator marked (`issue`): Tatoeba's English or the Japanese looks wrong."""
    n = 0
    for p in sorted(OUT.glob("*.json")):
        src = {it["key"]: it for it in ws._read(IN / p.name)["items"]}
        for k, v in (ws._read(p).get("items") or {}).items():
            if isinstance(v, dict) and isinstance(v.get("issue"), str) and v["issue"].strip():
                it = src.get(k, {})
                print(f"{p.stem} {k} | {it.get('ja')} | {it.get('en')} | {v['issue']}")
                n += 1
    print(f"{n} flagged")


def sample(n: int) -> None:
    """sample.md: n translated sentences at random, with their English and Tatoeba's Bulgarian, to judge."""
    rows = []
    for p in sorted(OUT.glob("*.json")):
        good, _ = verdicts(p.stem)
        src = {it["key"]: it for it in ws._read(IN / p.name)["items"]}
        rows += [(src[k], bg) for k, bg in good.items()]
    pick = random.Random(7).sample(rows, min(n, len(rows)))
    lines = [f"# Example sentences in Bulgarian: {len(pick)} of {len(rows)} at random\n"]
    for i, (it, bg) in enumerate(pick, 1):
        lines += [f"{i}. {it['ja']}", f"   - en: {it['en']}", f"   - **bg: {bg}**"]
        if it.get("tatoebaBg"):
            lines.append(f"   - Tatoeba bg: {it['tatoebaBg']}")
        lines.append(f"   - for: {'; '.join(it['words'])}\n")
    (DRAFTS / "sample.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(pick)} -> {DRAFTS / 'sample.md'}")


def merge() -> None:
    out = {}
    for p in sorted(IN.glob("*.json")):
        good, probs = verdicts(p.stem)
        if probs:
            print(f"{p.stem}: {len(probs)} problems, {len(good)} taken")
        out.update({k[1:]: tb._fix(bg) for k, bg in good.items()})
    ws._dump(SITE, out)
    print(f"{len(out)} sentences -> {SITE}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=250)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    p = sub.add_parser("sample")
    p.add_argument("--n", type=int, default=40)
    sub.add_parser("merge")
    sub.add_parser("flags")
    a = ap.parse_args()
    {"prepare": lambda: prepare(a.size), "check": lambda: check(a.batch), "sample": lambda: sample(a.n),
     "merge": merge, "flags": flags}[a.cmd]()


if __name__ == "__main__":
    main()
