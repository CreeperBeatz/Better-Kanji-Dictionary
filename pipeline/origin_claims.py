"""Word-origin claims in the word lines, checked once (2026-10-25).

    python pipeline/origin_claims.py prepare [--size 120]   # data/drafts/origin-claims/in/O-*.json
    # one Opus subagent per in/*.json, each reading pipeline/origin_claims_prompt.md
    python pipeline/origin_claims.py check [--batch O-000]
    python pipeline/word_synonyms.py export                 # applies the fixes to synonym lines
    python pipeline/sense_notes.py merge                    # and to sense notes

The second look at the mirrored lines found "Native word" written on
Sino-Japanese words (点数, 場所, 助言) again and again; the same lines had
passed the checks as minor at most. Every shown line that says where a word
comes from (native, Sino-Japanese, loanword, ...) is checked here: the
synonym lines (both the line and the own line) and the sense notes. One item
per word and text; a fix replaces that text wherever it is shown.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "origin-claims"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
NOTES = ROOT / "data" / "word_sense_notes.json"
CLAIM = re.compile(r"\b(native|sino|chinese[- ]?(origin|reading|word|loan)|kango|wago|yamato|loan ?words?|borrowed|"
                   r"from (english|german|french|dutch|portuguese|chinese)|western word)", re.I)
LIMIT = {"synonym line": 160, "sense note": 300}


def _found() -> dict[tuple[int, str], dict]:
    """(word the text is about, text) -> where it is shown."""
    out: dict[tuple[int, str], dict] = {}
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    for w, rs in site.items():
        for r in rs:
            if r[1] != "syn":
                continue
            for who, text in ((r[2], r[4]), (int(w), r[5] if len(r) > 5 else None)):
                if text and CLAIM.search(text):
                    out.setdefault((who, text), {"where": "synonym line", "n": 0})["n"] += 1
    for w, ns in json.loads(NOTES.read_text(encoding="utf-8")).items():
        for i, nt in enumerate(ns):
            if nt and nt.get("nuance") and CLAIM.search(nt["nuance"]):
                out.setdefault((int(w), nt["nuance"]), {"where": "sense note", "sense": i + 1, "n": 0})["n"] += 1
    return out


def prepare(size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    found = _found()
    items = []
    for n, ((who, text), f) in enumerate(sorted(found.items(), key=lambda kv: (kv[0][0], kv[0][1]))):
        w = ws.scope()[who]
        items.append({"key": f"o{n:05d}", "word": w["word"], "reading": w["reading"],
                      "senses": [g for _, _, g in w["senses"][:6]], "where": f["where"],
                      **({"sense": f["sense"]} if "sense" in f else {}), "text": text})
    for b in range(0, len(items), size):
        name = f"O-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[b:b + size]})
    print(f"{len(items)} texts ({dict(Counter(f['where'] for f in found.values()))}) in {-(-len(items) // size)} batches -> {IN}")


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
        elif not isinstance(v, dict) or not isinstance(v.get("why"), str) or not v["why"].strip() \
                or not isinstance(v.get("text"), str) or not v["text"].strip() or v.keys() - {"text", "why"}:
            probs.append(f"{batch}: {k}: \"ok\" or {{\"text\": the whole fixed text, \"why\"}}")
        elif len(v["text"]) > LIMIT[it["where"]]:
            probs.append(f"{batch}: {k}: text at most {LIMIT[it['where']]} characters")
        elif v["text"].strip() == it["text"]:
            probs.append(f"{batch}: {k}: the fixed text is the same; say \"ok\" instead")
        else:
            good[k] = {"text": v["text"].strip(), "why": v["why"].strip()}
    return good, probs


def fixes() -> dict[tuple[int, str], str]:
    """(word id, old text) -> new text, from every complete batch."""
    out = {}
    if not IN.exists():
        return out
    ids = {}
    for p in sorted(IN.glob("*.json")):
        good, probs = verdicts(p.stem)
        if probs:
            continue
        for it in ws._read(p)["items"]:
            v = good.get(it["key"])
            if v:
                # Every word so written and read (位 くらい is two words): the text says which one it is about.
                if (it["word"], it["reading"]) not in ids:
                    ids[(it["word"], it["reading"])] = [w for w in ws.resolve(it["word"], it["reading"], best=False)
                                                        if ws.scope()[w]["reading"] == it["reading"]]
                for wid in ids[(it["word"], it["reading"])]:
                    out[(wid, it["text"])] = v["text"]
    return out


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
    p.add_argument("--size", type=int, default=120)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.size)
    else:
        check(a.batch)


if __name__ == "__main__":
    main()
