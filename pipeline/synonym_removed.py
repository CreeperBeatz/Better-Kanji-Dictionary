"""What the word-synonym pipeline removed, looked at once (Dani, 2026-10-24).

    python pipeline/synonym_removed.py prepare [--size 70]   # data/drafts/synonym-removed/in/T-*.json
    # one Opus subagent per in/*.json, each reading pipeline/synonym_removed_prompt.md
    python pipeline/synonym_removed.py check [--batch T-000]
    python pipeline/synonym_removed.py report                # verdicts, the research and question lists
    python pipeline/word_synonyms.py export                  # adds the pairs called "keep"

The measured samples graded what the site shows. A wrong rule removes good
pairs, and a grader who follows the same rule never sees them (有る / 無い was
dropped as "a grammatical negative"). Here every pair a check or a rule
removed gets one verdict, sorted the way Dani asked:

- drop: rightly removed;
- keep: a real pair, the removal was wrong (with its senses and lines);
- knowledge: the answer is in Japanese usage the grader is not sure of: a
  research task, with the question to research;
- question: no answer fits the box the question gives: the rule or the box
  must change, with what it misses.

Removed by: the Opus check (doubtful / wrong), the same-word filter in
word_synonyms._pairs, the second look (synonym_recheck), the read-the-same
pass (same / wrong). Pairs Dani decided are left out.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import proposals  # noqa: E402
import synonym_recheck  # noqa: E402
import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "synonym-removed"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
VERDICTS = ("drop", "keep", "knowledge", "question")
KINDS = {"syn": "synonym", "ant": "antonym", "mix": "mixup"}
LINE = {"synonym": 160, "mixup": 180}
# Dani decided these on 2026-10-24: never asked again.
DANI_DROPPED = {(1352130, 1184480)}  # 上 / 下位: 下位 pairs with 上位


def _brief(wid: int) -> dict:
    w = ws.scope()[wid]
    return {"word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"],
            "senses": [f"{n}. [{pos}{'; ' + misc if misc else ''}] {gloss}" for n, (pos, misc, gloss) in enumerate(w["senses"][:ws.SENSES], 1)]}


def _skeptic_and_filter() -> tuple[list[dict], set[tuple]]:
    """Pairs the Opus check held back, and pairs the same-word filter dropped, over every run pair the site uses."""
    items, decided = [], synonym_recheck._decided()
    saved = ws.DRAFTS, ws.IN, ws.OUT, ws.RUNS
    try:
        for folder, runs in ws.SITE_RUNS:
            ws.DRAFTS, ws.IN, ws.OUT = proposals.folders(proposals.DRAFTS / folder)
            ws.RUNS = runs
            merged, _ = ws.combine(runs)
            verdicts, _ = ws.read_skeptic()
            for k, v in merged.items():
                a = verdicts.get(ws._key(k))
                wid, i, kind, o = k
                if v["both"] < ws.SKEPTIC_BAR or not a or a["verdict"] == "ok" or (wid, i, kind, o) in decided:
                    continue
                items.append({"pair": (wid, i, kind, o), "removedBy": f"check: {a['verdict']}", "reason": a.get("why", ""),
                              "lines": list(dict.fromkeys(v[r]["nuance"] for r in runs if v[r]["nuance"]))})
            # The same-word filter in ws._pairs, re-run here to name the pairs it dropped.
            for run in runs:
                for wid, entry in ws.read_run(run)[0].items():
                    for i, s in enumerate(entry):
                        for kind in ("syn", "ant"):
                            for it in s.get(kind, []):
                                found = [it["id"]] if "id" in it else ws.resolve(it["word"], it["reading"])
                                if found and found[0] != wid and ws.same_word(wid, found[0]):
                                    items.append({"pair": (wid, i, kind, found[0]), "removedBy": "rule: same word",
                                                  "reason": "a code rule: another form, spelling or short form of the same word",
                                                  "lines": [it["nuance"].strip()] if it.get("nuance") else []})
    finally:
        ws.DRAFTS, ws.IN, ws.OUT, ws.RUNS = saved
    return items, decided


def _second_look(decided: set[tuple]) -> list[dict]:
    src = {it["key"]: it for p in sorted(synonym_recheck.IN.glob("*.json")) for it in ws._read(p)["items"]}
    out = []
    for k, v in synonym_recheck.all_verdicts().items():
        if not v or not v.get("drop"):
            continue
        w, i, kind, o, n = k.split("|")
        w, i, o, n = int(w), int(i), int(o), int(n)
        if (w, o) in DANI_DROPPED or (w, i, kind, o) in decided:
            continue
        it = src[k]
        out.append({"pair": (w, i, kind, o), "otherSense": n, "removedBy": "second look: drop", "reason": v["why"],
                    "lines": [x for x in (it.get("line"), it.get("reverse")) if x]})
    return out


def _same_reading() -> list[dict]:
    saved = ws.DRAFTS, ws.IN, ws.OUT
    try:
        ws.DRAFTS, ws.IN, ws.OUT = proposals.folders(proposals.DRAFTS / "word-synonyms-jlpt")
        got, _ = ws.read_same_reading()
    finally:
        ws.DRAFTS, ws.IN, ws.OUT = saved
    out = []
    for k, a in got.items():
        if a["kind"] in ("same", "wrong"):
            x, y = map(int, k.split(":"))
            out.append({"pair": (x, None, "mix", y), "removedBy": f"read-the-same pass: {a['kind']}", "reason": a["why"], "lines": []})
    return out


def prepare(size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    found, decided = _skeptic_and_filter()
    found += _second_look(decided) + _same_reading()
    items, seen, by = [], set(), Counter()
    for f in found:
        w, i, kind, o = f["pair"]
        pair = (min(w, o), max(w, o), kind)
        if pair in seen or (w, o) in DANI_DROPPED or (o, w) in DANI_DROPPED:
            continue
        seen.add(pair)
        by[f["removedBy"]] += 1
        items.append({
            "key": f"{w}|{'' if i is None else i}|{kind}|{o}", "kind": KINDS[kind],
            "word": {**_brief(w), **({"sense": i + 1} if i is not None else {})},
            "other": {**_brief(o), **({"sense": f["otherSense"]} if f.get("otherSense") else {})},
            "removedBy": f["removedBy"], "reason": f["reason"], "drafted": f["lines"],
        })
    for b in range(0, len(items), size):
        name = f"T-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[b:b + size]})
    print(f"{len(items)} removed pairs ({dict(by)}) in {-(-len(items) // size)} batches -> {IN}")


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
        need = []
        if not isinstance(v, dict) or v.get("verdict") not in VERDICTS:
            probs.append(f"{batch}: {k}: verdict is one of {', '.join(VERDICTS)}")
            continue
        if not isinstance(v.get("why"), str) or not v["why"].strip():
            need.append("why")
        if v["verdict"] == "keep":
            for side, f in (("word", "wordSense"), ("other", "otherSense")):
                if not isinstance(v.get(f), int) or not 1 <= v[f] <= len(it[side]["senses"]):
                    need.append(f"{f} (a sense number of {side})")
            if it["kind"] in LINE:
                for f in ("line", "reverse"):
                    if not isinstance(v.get(f), str) or not v[f].strip() or len(v[f]) > LINE[it["kind"]]:
                        need.append(f"{f} (at most {LINE[it['kind']]} characters)")
        elif v["verdict"] == "knowledge" and not (isinstance(v.get("research"), str) and v["research"].strip()):
            need.append("research (the question to look up)")
        elif v["verdict"] == "question" and not (isinstance(v.get("box"), str) and v["box"].strip()):
            need.append("box (what the rule or the box misses)")
        if need:
            probs.append(f"{batch}: {k}: {v['verdict']} needs {', '.join(need)}")
        else:
            good[k] = v
    return good, probs


def all_verdicts() -> dict[str, dict]:
    """Every complete batch's verdicts, with the item they are about under `item`."""
    out = {}
    for p in sorted(IN.glob("*.json")):
        good, probs = verdicts(p.stem)
        if not probs:
            by = {it["key"]: it for it in ws._read(p)["items"]}
            out.update({k: {**v, "item": by[k]} for k, v in good.items()})
    return out


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    done, c = 0, Counter()
    for b in batches:
        good, probs = verdicts(b)
        done += not probs
        c.update(v["verdict"] for v in good.values())
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{sum(c.values())} valid items, {dict(c)}; {done} of {len(batches)} batches complete")


def report() -> None:
    got = all_verdicts()
    c = Counter((v["item"]["removedBy"], v["verdict"]) for v in got.values())
    for by in sorted({b for b, _ in c}):
        print(f"{by:28} " + ", ".join(f"{x} {c[(by, x)]}" for x in VERDICTS if c[(by, x)]))
    for kind, field in (("knowledge", "research"), ("question", "box"), ("keep", "why")):
        rows = [(k, v) for k, v in got.items() if v["verdict"] == kind]
        print(f"\n{kind}: {len(rows)}")
        for k, v in rows:
            it = v["item"]
            print(f"  {it['word']['word']} {it['kind']} {it['other']['word']} ({it['removedBy']}): {v[field]}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=70)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("report")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.size)
    elif a.cmd == "check":
        check(a.batch)
    else:
        report()


if __name__ == "__main__":
    main()
