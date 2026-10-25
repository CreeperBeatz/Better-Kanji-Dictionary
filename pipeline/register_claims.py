"""Register claims in the word lines, checked once, and made to say what they compare (Dani, 2026-10-25).

    python pipeline/register_claims.py prepare [--size 200]   # data/drafts/register-claims/in/G-*.json
    # one Opus subagent per in/*.json, each reading pipeline/register_claims_prompt.md
    python pipeline/register_claims.py check [--batch G-000]
    python pipeline/word_synonyms.py export                   # applies the fixes to synonym lines
    python pipeline/sense_notes.py merge                      # and to sense notes

The Bulgarian translators, reading every line, kept finding wrong register
labels (実は "written", 基づく "everyday", 努めて "spoken"), and graders had let
them pass as minor. Three causes: a label that is relative ("Formal." on
見解's row means more formal than 意見) but reads as absolute; plain
misjudgments, mostly on'yomi words taken as formal and kana words as spoken;
and one label for a word whose register differs by sense.

Asked: every synonym line and sense note that makes a register claim, and
every text a translator flagged as wrong (pipeline/translate_bg.py flags,
data/drafts/translate-bg/reported_en_issues.tsv), with the flag. A synonym
line is asked once per comparison (the word it is about, the word it is set
against), since the same text may sit under different pairs. JMdict's own
register tags of both words' senses are given as evidence.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "register-claims"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
NOTES = ROOT / "data" / "word_sense_notes.json"
BG = ROOT / "data" / "drafts" / "translate-bg"
REGISTER = re.compile(r"\b(formal|informal|written|literary|bookish|spoken|speech|casual|everyday|colloquial|slang|"
                      r"stiff|plain|polite|humble|honorific|old-fashioned|dated|archaic|daily (talk|life|use)|in talk)\b", re.I)
LIMIT = {"synonym line": 160, "mixup line": 180, "sense note": 300}


def _brief(wid: int) -> dict:
    w = ws.scope()[wid]
    return {"word": w["word"], "reading": w["reading"],
            "senses": [f"{n}. [{pos}{'; ' + misc if misc else ''}] {g}" for n, (pos, misc, g) in enumerate(w["senses"][:12], 1)]}


def _flags() -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """English line text -> translators' notes; "wid|sense" -> notes on that sense note."""
    lines, notes = defaultdict(list), defaultdict(list)
    src = {}
    for p in sorted((BG / "in").glob("*.json")):
        for it in ws._read(p)["items"]:
            src[it["key"]] = it
    for p in sorted((BG / "out").glob("*.json")):
        for k, v in (ws._read(p).get("items") or {}).items():
            note = isinstance(v, dict) and v.get("enIssue")
            if isinstance(note, str) and note.strip() and k in src:
                (lines[src[k]["en"]] if p.stem.startswith("L") else notes[k]).append(note.strip())
    tsv = BG / "reported_en_issues.tsv"
    if tsv.exists():
        with tsv.open(encoding="utf-8") as f:
            for row in csv.reader(f, delimiter="\t"):
                if len(row) >= 2 and row[0] in src:
                    lines[src[row[0]]["en"]].append(row[1])
    return lines, notes


def prepare(size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    flag_lines, flag_notes = _flags()
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    items, seen, why = [], set(), Counter()
    for w, rs in sorted(site.items(), key=lambda kv: int(kv[0])):
        for r in rs:
            if r[1] not in ("syn", "mix"):
                continue
            where = "synonym line" if r[1] == "syn" else "mixup line"
            for about, against, a_sense, b_sense, text in ((r[2], int(w), r[3], r[0] + 1, r[4]),
                                                            (int(w), r[2], r[0] + 1, r[3], r[5] if len(r) > 5 else None)):
                if not text or (about, against, text) in seen:
                    continue
                flags = flag_lines.get(text, [])
                if not (flags or (r[1] == "syn" and REGISTER.search(text))):
                    continue
                seen.add((about, against, text))
                why["flagged" if flags else "register"] += 1
                items.append({"key": f"{about}|{against}|{len(items)}", "where": where, "text": text,
                              "about": {**_brief(about), "sense": a_sense}, "against": {**_brief(against), "sense": b_sense},
                              **({"flags": flags} if flags else {})})
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    for w, ns in sorted(notes.items(), key=lambda kv: int(kv[0])):
        if int(w) not in ws.scope():
            continue
        for i, n in enumerate(ns):
            if not n:
                continue
            flags = flag_notes.get(f"{w}|{i}", [])
            if not (flags or REGISTER.search(n["nuance"])):
                continue
            why["flagged note" if flags else "register note"] += 1
            items.append({"key": f"{w}|{i}|note", "where": "sense note", "text": n["nuance"],
                          "about": {**_brief(int(w)), "sense": i + 1}, **({"ex": n["ex"]} if n.get("ex") else {}),
                          **({"flags": flags} if flags else {})})
    for b in range(0, len(items), size):
        name = f"G-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[b:b + size]})
    print(f"{len(items)} texts ({dict(why)}) in {-(-len(items) // size)} batches -> {IN}")


def verdicts(batch: str) -> tuple[dict, list[str]]:
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
        if v == "ok":
            good[k] = None
            continue
        allowed = {"text", "why"} | ({"ex"} if it["where"] == "sense note" else set())
        if not isinstance(v, dict) or v.keys() - allowed or not isinstance(v.get("why"), str) or not v["why"].strip() \
                or not ({"text", "ex"} & v.keys()):
            probs.append(f"{batch}: {k}: \"ok\" or {{text?, ex? (notes only), why}}")
        elif "text" in v and (not isinstance(v["text"], str) or not v["text"].strip() or len(v["text"]) > LIMIT[it["where"]]
                              or v["text"].strip() == it["text"]):
            probs.append(f"{batch}: {k}: text is the whole new text, changed, at most {LIMIT[it['where']]} characters")
        elif "ex" in v and v["ex"] is not None and not (
                isinstance(v["ex"], dict) and isinstance(v["ex"].get("ja"), str) and isinstance(v["ex"].get("en"), str)
                and v["ex"]["ja"].count("【") == 1 and v["ex"]["ja"].count("】") == 1 and v["ex"]["en"].strip()):
            probs.append(f"{batch}: {k}: ex is null (no example) or {{ja with the word in one 【】, en}}")
        else:
            good[k] = {f: (v[f].strip() if isinstance(v[f], str) else v[f]) for f in v}
    return good, probs


def fixes() -> tuple[dict[tuple[int, int, str], str], dict[tuple[int, int], dict]]:
    """Synonym and mix-up lines: (about, against, old text) -> new text. Sense notes: (word, sense) -> {text?, ex?}."""
    lines, notes = {}, {}
    if not IN.exists():
        return lines, notes
    for p in sorted(IN.glob("*.json")):
        good, probs = verdicts(p.stem)
        if probs:
            continue
        for it in ws._read(p)["items"]:
            v = good.get(it["key"])
            if not v:
                continue
            a, b, _ = it["key"].split("|")
            if it["where"] == "sense note":
                notes[(int(a), int(b))] = v
            elif "text" in v:
                lines[(int(a), int(b), it["text"])] = v["text"]
    return lines, notes


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    done, c = 0, Counter()
    for b in batches:
        good, probs = verdicts(b)
        done += not probs
        c.update("ok" if v is None else "fixed" for v in good.values())
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{sum(c.values())} valid items, {dict(c)}; {done} of {len(batches)} batches complete")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=200)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.size)
    else:
        check(a.batch)


if __name__ == "__main__":
    main()
