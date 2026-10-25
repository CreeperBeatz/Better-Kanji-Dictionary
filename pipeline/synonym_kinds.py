"""The new kinds of word pairs, sorted once (Dani, 2026-10-25).

    python pipeline/synonym_kinds.py prepare [--size 110]   # data/drafts/synonym-kinds/in/K-*.json
    # one Opus subagent per in/*.json, each reading pipeline/synonym_kinds_prompt.md
    python pipeline/synonym_kinds.py check [--batch K-000]
    python pipeline/synonym_kinds.py report
    python pipeline/word_synonyms.py export                 # applies the kinds

Sorting what was removed (D-033) found pairs no kind held. Dani's boxes:
- ant: the plain opposite (勝つ / 負ける, 人気 / 不人気, 有る / 無い);
- pair: two words that clearly pair up but are not opposites: the two sexes
  (祖父 / 祖母), two halves of one system (級 / 段), two ends (前提 / 結論);
- polite: separate words for one act or thing, one the honorific, humble or
  polite counterpart of the other (仰る / 言う, いらっしゃる / 居る);
- mix: easy to mix up, now also by meaning: one English word, two uses
  (近代 / 現代, 美術 / 芸術), with when to use which;
- short / older: a short form (ＣＭ / コマーシャル) or an old variant (メーター /
  メートル) of another entry, shown in the spellings row, not under a sense.

Asked: every antonym the site shows (it may be a pair or a polite form now),
and every pair a check or rule removed (it may fit one of the new boxes).
Pairs Dani decided are left as they are.
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

import synonym_recheck  # noqa: E402
import synonym_removed  # noqa: E402
import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "synonym-kinds"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
KINDS = ("ant", "pair", "polite", "mix", "short", "older", "none")
SENSED = ("ant", "pair", "polite", "mix")  # shown under a sense; short and older are word-wide
REGISTERS = ("plain", "polite", "honorific", "humble")
LINE = 180


def _brief(wid: int, sense: int | None) -> dict:
    return {**synonym_removed._brief(wid), **({"sense": sense} if sense else {})}


def _decided() -> set[frozenset]:
    """Unordered pairs Dani decided: never asked again."""
    out = {frozenset((w, o)) for w, _, kind, o in synonym_recheck._decided() if kind == "ant"}
    out |= {frozenset((x, y)) for x, _, y, _ in ws.DECIDED_ANT}
    return out


def prepare(size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    decided = _decided()
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    items, seen, by = [], set(), Counter()

    def add(w, i, o, n, now, came, reason=""):
        pair = frozenset((w, o))
        if pair in seen or pair in decided or w == o:
            return
        seen.add(pair)
        by[came] += 1
        items.append({"key": f"{w}|{'' if i is None else i}|{o}|{n or ''}", "now": now, "came": came,
                      **({"reason": reason} if reason else {}),
                      "word": _brief(w, None if i is None else i + 1), "other": _brief(o, n)})

    for w, rs in sorted(site.items(), key=lambda kv: int(kv[0])):
        for r in rs:
            if r[1] == "ant":
                add(int(w), r[0], r[2], r[3], "ant", "shown as an opposite")
    for k, v in sorted(synonym_removed.all_verdicts().items()):
        if v["verdict"] in ("drop", "question"):
            it = v["item"]
            w, i, _, o = k.split("|")
            add(int(w), int(i) if i else None, int(o), it["other"].get("sense"), "none",
                f"removed: {it['kind']}", f"{it['removedBy']}: {it['reason']}; then: {v['why']}")
    src = {it["key"]: it for p in sorted(synonym_recheck.IN.glob("*.json")) for it in ws._read(p)["items"]}
    for k, v in synonym_recheck.all_verdicts().items():
        if v and v.get("drop"):
            w, i, kind, o, n = k.split("|")
            add(int(w), int(i), int(o), int(n), "none", f"removed: {src[k]['kind']}", f"second look: {v['why']}")
    for b in range(0, len(items), size):
        name = f"K-{b // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[b:b + size]})
    print(f"{len(items)} pairs ({dict(by)}) in {-(-len(items) // size)} batches -> {IN}")


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
        if not isinstance(v, dict) or v.get("kind") not in KINDS:
            probs.append(f"{batch}: {k}: kind is one of {', '.join(KINDS)}")
            continue
        need = []
        if not isinstance(v.get("why"), str) or not v["why"].strip():
            need.append("why")
        kind = v["kind"]
        if kind in SENSED:
            for side, f in (("word", "wordSense"), ("other", "otherSense")):
                if not isinstance(v.get(f), int) or not 1 <= v[f] <= len(it[side]["senses"]):
                    need.append(f"{f} (a sense number of {side})")
        if kind == "polite":
            reg = v.get("register")
            if not isinstance(reg, dict) or reg.get("word") not in REGISTERS or reg.get("other") not in REGISTERS \
                    or reg["word"] == reg["other"]:
                need.append(f"register {{word, other}}, two different of {', '.join(REGISTERS)}")
        if kind == "mix":
            for f in ("line", "reverse"):
                if not isinstance(v.get(f), str) or not v[f].strip() or len(v[f]) > LINE:
                    need.append(f"{f} (at most {LINE} characters)")
        if kind in ("short", "older") and v.get("full") not in ("word", "other"):
            need.append("full: which one is the full or standard form, word or other")
        if need:
            probs.append(f"{batch}: {k}: {kind} needs {', '.join(need)}")
        else:
            good[k] = v
    return good, probs


def all_verdicts() -> dict[str, dict]:
    out = {}
    if not IN.exists():
        return out
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
        c.update(v["kind"] for v in good.values())
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{sum(c.values())} valid items, {dict(c)}; {done} of {len(batches)} batches complete")


def report() -> None:
    got = all_verdicts()
    c = Counter((v["item"]["now"], v["kind"]) for v in got.values())
    for (now, kind), n in sorted(c.items()):
        print(f"{now:5} -> {kind:7} {n}")
    for kind in ("pair", "polite", "mix", "short", "older"):
        rows = [v for v in got.values() if v["kind"] == kind]
        print(f"\n{kind}: {len(rows)}")
        for v in rows[:40]:
            it = v["item"]
            extra = f" {v['register']}" if kind == "polite" else f" full={v['full']}" if kind in ("short", "older") else ""
            print(f"  {it['word']['word']} / {it['other']['word']} (was {it['now']}){extra}: {v['why'][:90]}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=110)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("report")
    a = ap.parse_args()
    {"prepare": lambda: prepare(a.size), "check": lambda: check(a.batch), "report": report}[a.cmd]()


if __name__ == "__main__":
    main()
