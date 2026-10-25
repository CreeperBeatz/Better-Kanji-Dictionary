"""A second look at the weak spots of the word synonyms (Dani, 2026-10-24).

    python pipeline/synonym_recheck.py prepare [--size 120]   # data/drafts/synonym-recheck/in/R-*.json
    python pipeline/synonym_recheck.py prepare --mirrored     # W-*.json: the pairs export mirrors (2026-10-24)
    # one Opus subagent per in/*.json, each reading pipeline/synonym_recheck_prompt.md
    python pipeline/synonym_recheck.py check [--batch R-000]
    python pipeline/word_synonyms.py export                   # applies the verdicts (RECHECK)

The rows on the site passed two Sonnet drafts and an Opus check. What that
check did not cover twice:

- `rewritten`: lines the Opus check wrote itself, read by no one since;
- `floor`: pairs both drafts gave only the lowest confidence kept (0.6);
- `mixup`: words read the same and easy to mix up, one Opus pass only;
- `both ways`: a pair shown on both words, whose two lines must agree.
- `mirrored`: a pair export shows on the other word too; that line is the
  quick Sonnet "own line" (pipeline/self_nuance.py), measured at 4.3% major.
  Its batches (W-*) sort after R-*, so their verdicts win.

One item per pair (both directions together where both are shown). Verdict:
"ok", {"line"?, "reverse"?, "why"} with the lines to show instead, or
{"drop": true, "why"}: the pair goes from both words.
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
import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "synonym-recheck"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
LINE = 160  # characters
KINDS = {"syn": "synonym", "ant": "antonym", "mix": "mixup"}


def key(w: int, i: int, kind: str, o: int, n: int) -> str:
    """A row: word, its sense (from 0), kind, other word, the other's sense (from 1)."""
    return f"{w}|{i}|{kind}|{o}|{n}"


def _drafted() -> tuple[set[tuple], set[tuple]]:
    """(word, sense, kind, other) of the shown pairs the Opus check rewrote, and of those at the floor."""
    rewritten, floor = set(), set()
    saved = ws.DRAFTS, ws.IN, ws.OUT, ws.RUNS
    try:
        for folder, runs in ws.SITE_RUNS:
            ws.DRAFTS, ws.IN, ws.OUT = proposals.folders(proposals.DRAFTS / folder)
            ws.RUNS = runs
            merged, _ = ws.combine(runs)
            verdicts, _ = ws.read_skeptic()
            for k, v in merged.items():
                a = verdicts.get(ws._key(k)) or {}
                if a.get("verdict") == "ok":
                    if a.get("fixed"):
                        rewritten.add(k)
                    if v["both"] <= 0.6:
                        floor.add(k)
    finally:
        ws.DRAFTS, ws.IN, ws.OUT, ws.RUNS = saved
    return rewritten, floor


def _side(wid: int, sense: int) -> dict:
    w = ws.scope()[wid]
    return {"word": w["word"], "reading": w["reading"], "sense": ws.senses_of(wid)[sense]}


def prepare(size: int, mirrored_only: bool = False) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    rows = {(int(w), r[0], r[1], r[2], r[3]): r for w, rs in site.items() for r in rs}
    mirrored = {tuple(int(x) if x.isdigit() else x for x in k.split("|")) for k in ws._read(ws.MIRRORED)} if mirrored_only else set()
    rewritten, floor = _drafted() if not mirrored_only else (set(), set())
    items, seen, why = [], set(), Counter()
    for (w, i, kind, o, n), r in sorted(rows.items()):
        if (w, i, kind, o, n) in seen:
            continue
        back = rows.get((o, n - 1, kind, w, i + 1))
        reasons = [x for x, hit in (
            ("mirrored", kind == "syn" and ((w, i, kind, o, n) in mirrored or (o, n - 1, kind, w, i + 1) in mirrored)),
        ) if hit] if mirrored_only else [x for x, hit in (
            ("rewritten", (w, i, kind, o) in rewritten or (back and (o, n - 1, kind, w) in rewritten)),
            ("floor", (w, i, kind, o) in floor or (back and (o, n - 1, kind, w) in floor)),
            ("mixup", kind == "mix"),
            ("both ways", kind == "syn" and back is not None)) if hit]
        if not reasons:
            continue
        seen.add((w, i, kind, o, n))
        if back:
            seen.add((o, n - 1, kind, w, i + 1))
        why.update(reasons)
        items.append({
            "key": key(w, i, kind, o, n), "kind": KINDS[kind], "why": reasons,
            "word": _side(w, i), "other": _side(o, n - 1),
            **({"line": r[4]} if kind != "ant" else {}),
            **({"reverse": back[4]} if back and kind != "ant" else {}),
            "shownBothWays": back is not None,
        })
    for b in range(0, len(items), size):
        name = f"{'W' if mirrored_only else 'R'}-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[b:b + size]})
    print(f"{len(items)} pairs ({dict(why)}) in {-(-len(items) // size)} batches -> {IN}")


def verdicts(batch: str) -> tuple[dict, list[str]]:
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
    by = {it["key"]: it for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in by.keys() - items.keys()] + [f"{batch}: unknown {k}" for k in items.keys() - by.keys()]
    good = {}
    for k, v in items.items():
        it = by.get(k)
        if not it:
            continue
        if v == "ok":
            good[k] = None
            continue
        allowed = {"drop", "why"} | ({"line", "reverse"} if it["kind"] != "antonym" else set())
        if not isinstance(v, dict) or not isinstance(v.get("why"), str) or not v["why"].strip() or v.keys() - allowed \
                or not ({"drop", "line", "reverse"} & v.keys()):
            probs.append(f"{batch}: {k}: \"ok\", {{\"drop\": true, why}} or {{line?, reverse?, why}}")
        elif "drop" in v and (v["drop"] is not True or v.keys() & {"line", "reverse"}):
            probs.append(f"{batch}: {k}: drop is true, alone with why")
        elif "reverse" in v and not it["shownBothWays"]:
            probs.append(f"{batch}: {k}: no reverse row is shown for this pair")
        elif any(not isinstance(v[f], str) or not v[f].strip() or len(v[f]) > LINE for f in ("line", "reverse") if f in v):
            probs.append(f"{batch}: {k}: lines are text, at most {LINE} characters")
        else:
            good[k] = {f: v[f].strip() if isinstance(v[f], str) else v[f] for f in v}
    return good, probs


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    total, done, c = 0, 0, Counter()
    for b in batches:
        good, probs = verdicts(b)
        total += len(good)
        done += not probs
        c.update("ok" if v is None else "drop" if v.get("drop") else "fixed" for v in good.values())
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{total} valid items, {dict(c)}; {done} of {len(batches)} batches complete")


def _decided() -> set[tuple[int, int, str, int]]:
    """Pairs Dani decided (an `override` on the first check's verdict): 2026-10-24, established
    不・非・無 words are antonyms (運 / 不運). No later check drops them."""
    out = set()
    for f in proposals.DRAFTS.glob("word-synonyms*/skeptic/out/*.json"):
        for k, v in (ws._read(f).get("pairs") or {}).items():
            if isinstance(v, dict) and v.get("override"):
                w, n, kind, o = k.split(":")
                out |= {(int(w), int(n) - 1, kind, int(o)), (int(o), None, kind, int(w))}
    return out


def all_verdicts() -> dict[str, dict | None]:
    """Every complete batch's verdicts, for word_synonyms.export; never a drop of a pair Dani decided."""
    out = {}
    for p in sorted(IN.glob("*.json")):
        good, probs = verdicts(p.stem)
        if not probs:
            out.update(good)
    decided = _decided()
    for k, v in list(out.items()):
        w, i, kind, o, _ = k.split("|")
        if v and v.get("drop") and ((int(w), int(i), kind, int(o)) in decided or (int(w), None, kind, int(o)) in decided):
            out[k] = None
    return out


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=120)
    p.add_argument("--mirrored", action="store_true")
    p = sub.add_parser("check")
    p.add_argument("--batch")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.size, a.mirrored)
    else:
        check(a.batch)


if __name__ == "__main__":
    main()
