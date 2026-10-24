"""Measured quality: a random sample of each AI-made dataset, graded blind (Dani, 2026-10-24).

    python pipeline/quality_sample.py prepare notes|kanji|synonyms [--n 300 --size 50]
    # one Opus subagent per in/*.json, each reading pipeline/quality_sample_prompt.md
    python pipeline/quality_sample.py check [--batch notes-000]
    python pipeline/quality_sample.py report           # error rates with their 95% bounds
    python pipeline/quality_sample.py sheet notes|kanji|synonyms [--n 30]   # a list for a person to grade

The checks so far were models fixing models; this measures what they left.
Each item is graded "ok", "minor" (could be better, does not mislead) or
"major" (wrong, or misleads a learner), per part: a sense note's rank,
nuance and example; a kanji line's English and Bulgarian; a word pair and
its line. An item is wrong if any part is major. The sample is drawn with a
fixed seed from what the site serves, and the graders are told nothing of
how an item was made or checked.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "quality-sample"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
DATA = ROOT / "data"
SEED = 20261024
PARTS = {"notes": ("rank", "nuance", "ex"), "kanji": ("en", "bg"), "synonyms": ("pair", "line"),
         # Graded like synonyms (2026-10-24): rows shown only by mirroring (their line is the Sonnet own line),
         # every read-the-same row, and pairs the runs gave below the bar (what the bar throws away).
         "mirrored": ("pair", "line"), "mixup": ("pair", "line"), "belowbar": ("pair", "line"),
         # Every pair whose kind changed in pipeline/synonym_kinds.py (2026-10-25), all of them.
         "kinds": ("kind", "line")}
GRADES = ("ok", "minor", "major")


def _word(wid: int) -> dict:
    w = ws.scope()[wid]
    return {"word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"],
            "senses": [f"{n}. [{pos}{'; ' + misc if misc else ''}] {gloss}" for n, (pos, misc, gloss) in enumerate(w["senses"][:ws.SENSES], 1)]}


def _notes(rng: random.Random, n: int) -> list[dict]:
    notes = json.loads((DATA / "word_sense_notes.json").read_text(encoding="utf-8"))
    pool = [(k, i) for k, ns in notes.items() for i in range(len(ns))]
    return [{"key": f"{k}|{i}", **_word(int(k)), "sense": i + 1, "note": notes[k][i]} for k, i in rng.sample(pool, n)]


def _kanji(rng: random.Random, n: int) -> list[dict]:
    lines = json.loads((DATA / "kanji_nuances.json").read_text(encoding="utf-8"))
    src = {it["key"]: it for p in sorted((ROOT / "data" / "drafts" / "kanji-nuance" / "in").glob("*.json"))
           for it in json.loads(p.read_text(encoding="utf-8"))["items"]}
    pool = [("similar", k) for k, v in lines["similar"].items() if not v.get("mismatch") and k in src] + \
           [("mixup", k) for k in lines["mixup"] if k in src]
    out = []
    for kind, k in rng.sample(pool, n):
        it = {f: v for f, v in src[k].items() if f != "key"}
        out.append({"key": f"{kind}|{k}", "kind": kind, **it, "line": {f: lines[kind][k][f] for f in ("en", "bg")}})
    return out


def _synonyms(rng: random.Random, n: int, keep=lambda w, r: True) -> list[dict]:
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    pool = [(int(w), r) for w, rs in site.items() for r in rs if keep(int(w), r)]
    out = []
    for w, r in rng.sample(pool, min(n, len(pool))):
        i, kind, o, on = r[0], r[1], r[2], r[3]
        out.append({"key": f"{w}|{i}|{kind}|{o}|{on}", "kind": {"syn": "synonym", "ant": "antonym", "mix": "mixup"}[kind],
                    "word": {**_word(w), "sense": i + 1}, "other": {**_word(o), "sense": on},
                    **({"line": r[4]} if kind != "ant" else {})})
    return out


def _mirrored(rng: random.Random, n: int) -> list[dict]:
    keys = set(ws._read(ws.MIRRORED))
    return _synonyms(rng, n, lambda w, r: r[1] == "syn" and f"{w}|{r[0]}|{r[1]}|{r[2]}|{r[3]}" in keys)


def _mixup(rng: random.Random, n: int) -> list[dict]:
    return _synonyms(rng, n, lambda w, r: r[1] == "mix")


def _belowbar(rng: random.Random, n: int) -> list[dict]:
    """Pairs a run gave that the bar kept out (both runs at least 0.6), not shown on the site by another way."""
    import proposals
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    shown = {(int(w), r[0], r[2]) for w, rs in site.items() for r in rs}
    pool = []
    saved = ws.DRAFTS, ws.IN, ws.OUT, ws.RUNS
    try:
        for folder, runs in ws.SITE_RUNS:
            ws.DRAFTS, ws.IN, ws.OUT = proposals.folders(proposals.DRAFTS / folder)
            ws.RUNS = runs
            for (w, i, kind, o), v in ws.combine(runs)[0].items():
                if v["both"] < ws.SKEPTIC_BAR and (w, i, o) not in shown:
                    said = [v[r] for r in runs if r in v]
                    pool.append((w, i, kind, o, said[0].get("sense"), next((x["nuance"] for x in said if x["nuance"]), None)))
    finally:
        ws.DRAFTS, ws.IN, ws.OUT, ws.RUNS = saved
    out = []
    for w, i, kind, o, on, line in rng.sample(sorted(set(pool), key=str), n):
        out.append({"key": f"{w}|{i}|{kind}|{o}|{on or ''}", "kind": {"syn": "synonym", "ant": "antonym"}[kind],
                    "word": {**_word(w), "sense": i + 1}, "other": {**_word(o), **({"sense": on} if on else {})},
                    **({"line": line} if kind == "syn" else {})})
    return out


def _kinds(rng: random.Random, n: int) -> list[dict]:
    import synonym_kinds
    out = []
    for k, v in sorted(synonym_kinds.all_verdicts().items()):
        it = v["item"]
        if v["kind"] == it["now"]:
            continue
        kind = v["kind"] if v["kind"] != "none" else "removed: not an opposite"
        w, o = int(k.split("|")[0]), int(k.split("|")[2])
        out.append({"key": k, "kind": kind,
                    "word": {**_word(w), **({"sense": v["wordSense"]} if "wordSense" in v else {})},
                    "other": {**_word(o), **({"sense": v["otherSense"]} if "otherSense" in v else {})},
                    **({"register": v["register"]} if "register" in v else {}),
                    **({"full": v["full"]} if "full" in v else {}),
                    **({"line": v["line"], "reverse": v["reverse"]} if v["kind"] == "mix" else {})})
    return rng.sample(out, min(n, len(out)))


def prepare(which: str, n: int, size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(f"{SEED}-{which}")
    items = {"notes": _notes, "kanji": _kanji, "synonyms": _synonyms, "mirrored": _mirrored,
             "mixup": _mixup, "belowbar": _belowbar, "kinds": _kinds}[which](rng, n)
    for b in range(0, len(items), size):
        name = f"{which}-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "dataset": which, "items": items[b:b + size]})
    print(f"{which}: {len(items)} items in {-(-len(items) // size)} batches")


def grades(batch: str) -> tuple[dict, list[str]]:
    src = ws._read(IN / f"{batch}.json")
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = ws._read(path)
    except json.JSONDecodeError as e:
        return {}, [f"{batch}: not JSON ({e})"]
    items = got.get("items") if isinstance(got, dict) else None
    if not isinstance(items, dict):
        return {}, [f"{batch}: no `items` object"]
    parts = PARTS[src["dataset"]]
    by = {it["key"]: it for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in by.keys() - items.keys()] + [f"{batch}: unknown {k}" for k in items.keys() - by.keys()]
    good = {}
    for k, v in items.items():
        it = by.get(k)
        if not it:
            continue
        need = [p for p in parts if not (p == "line" and (it.get("kind") == "antonym" or src["dataset"] == "kinds" and "line" not in it))]
        if not isinstance(v, dict) or any(v.get(p) not in GRADES for p in need):
            probs.append(f"{batch}: {k}: grade each of {', '.join(need)} as ok, minor or major")
        elif any(v.get(p) != "ok" for p in need) and not (isinstance(v.get("issue"), str) and v["issue"].strip()):
            probs.append(f"{batch}: {k}: say the issue for a minor or major grade")
        else:
            good[k] = {p: v[p] for p in need} | ({"issue": v["issue"].strip()} if v.get("issue") else {})
    return good, probs


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    done = 0
    for b in batches:
        good, probs = grades(b)
        done += not probs
        if probs or only:
            print(f"{b}: {len(good)} graded, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{done} of {len(batches)} batches complete")


def _upper(k: int, n: int, z: float = 1.96) -> float:
    """Wilson upper bound of a rate k/n."""
    if n == 0:
        return 1.0
    p = k / n
    return (p + z * z / (2 * n) + z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def report() -> None:
    for which in PARTS:
        got = {}
        for p in sorted(IN.glob(f"{which}-*.json")):
            g, probs = grades(p.stem)
            if not probs:
                got.update(g)
        if not got:
            continue
        n = len(got)
        major = [k for k, v in got.items() if "major" in v.values()]
        minor = [k for k, v in got.items() if "minor" in v.values() and k not in major]
        print(f"\n{which}: {n} graded; wrong (any part major) {len(major)} = {len(major) / n:.1%} "
              f"(95% at most {_upper(len(major), n):.1%}); minor only {len(minor)} = {len(minor) / n:.1%}")
        for part in PARTS[which]:
            c = Counter(v[part] for v in got.values() if part in v)
            if c:
                t = sum(c.values())
                print(f"  {part:7} major {c['major']}/{t} ({c['major'] / t:.1%}, at most {_upper(c['major'], t):.1%}), minor {c['minor']}")
        for k in major:
            print(f"    major {k}: {got[k].get('issue', '')[:150]}")


def sheet(which: str, n: int) -> None:
    """The first `n` sampled items as a list a person can grade, beside the model's grades."""
    items = [it for p in sorted(IN.glob(f"{which}-*.json")) for it in ws._read(p)["items"]][:n]
    lines = [f"# {which}: {len(items)} items to grade (ok / minor / major per part)\n"]
    for it in items:
        if which == "notes":
            nt = it["note"]
            ex = nt["ex"] and f"{nt['ex']['ja']} — {nt['ex']['en']}"
            lines.append(f"- **{it['word']}** {it['reading']}, sense {it['sense']}: {it['senses'][it['sense'] - 1]}\n"
                         f"  - rank: {nt['rank']}\n  - nuance: {nt['nuance']}\n  - example: {ex or '—'}\n  - grade: rank __ nuance __ example __")
        elif which == "kanji":
            head = f"{it['kanji']} {it['meaning']} → {it['other']}" if it["kind"] == "similar" else f"{it['a']} / {it['b']}, {it['reading']}"
            lines.append(f"- **{head}**\n  - en: {it['line']['en']}\n  - bg: {it['line']['bg']}\n  - grade: en __ bg __")
        else:
            w, o = it["word"], it["other"]
            lines.append(f"- **{w['word']}** ({w['senses'][w['sense'] - 1]}) {it['kind']} **{o['word']}** ({o['senses'][o['sense'] - 1] if o.get('sense') else 'sense not given'})\n"
                         f"  - line: {it.get('line') or '—'}\n  - grade: pair __ line __")
    path = DRAFTS / f"sheet-{which}.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(items)} items -> {path}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("which", choices=list(PARTS))
    p.add_argument("--n", type=int, default=300)
    p.add_argument("--size", type=int, default=50)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("report")
    p = sub.add_parser("sheet")
    p.add_argument("which", choices=list(PARTS))
    p.add_argument("--n", type=int, default=30)
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.which, a.n, a.size)
    elif a.cmd == "check":
        check(a.batch)
    elif a.cmd == "report":
        report()
    else:
        sheet(a.which, a.n)


if __name__ == "__main__":
    main()
