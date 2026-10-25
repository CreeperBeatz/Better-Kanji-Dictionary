"""The new kinds of word pairs, sorted once (Dani, 2026-10-25).

    python pipeline/synonym_kinds.py prepare [--size 110]   # data/drafts/synonym-kinds/in/K-*.json
    python pipeline/synonym_kinds.py prepare --freed         # in/F-*.json: the pairs the old same-word rule hid
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

Freed (D-033, 2026-10-25): the old same-word rule tested the spelling and the
reading apart, and dropped pairs before any agent saw them (お腹 / 腹, ご飯 /
飯, 目前 / 目の前). The pairs it hid that share a gloss are asked once here,
with `syn` as one more kind.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import synonym_recheck  # noqa: E402
import synonym_removed  # noqa: E402
import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "synonym-kinds"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
KINDS = ("syn", "ant", "pair", "polite", "mix", "short", "older", "none")  # syn: freed pairs only
SENSED = ("syn", "ant", "pair", "polite", "mix")  # shown under a sense; short and older are word-wide
REGISTERS = ("plain", "polite", "honorific", "humble")
LINE = {"syn": 160, "mix": 180}


def _brief(wid: int, sense: int | None) -> dict:
    return {**synonym_removed._brief(wid), **({"sense": sense} if sense else {})}


def _decided() -> set[frozenset]:
    """Unordered pairs Dani decided: never asked again."""
    out = {frozenset((w, o)) for w, _, kind, o in synonym_recheck._decided() if kind == "ant"}
    out |= {frozenset((x, y)) for x, _, y, _ in ws.DECIDED_ANT}
    return out


def _old_same_word(a: int, b: int) -> bool:
    """The same-word rule before D-033: spelling and reading tested apart, inserted kana allowed."""
    x, y = ws.scope()[a], ws.scope()[b]
    for p, q in ((x, y), (y, x)):
        for k in ("word", "reading"):
            s, t = p[k], q[k]
            if any(t == m + s for m in "おご御") or any(t == s + m for m in ("日", "に", "と", "的")):
                return True
            if any(s.endswith(e) and t == s[:-len(e)] + f for e, f in (("ずる", "じる"), ("す", "せる"), ("る", "りる"))):
                return True
            if any(t[i] in "がにのっ" and t[:i] + t[i + 1:] == s for i in range(1, len(t) - 1)):
                return True
    return False


def prepare_freed(size: int) -> None:
    """Pairs the old rule called one word and the new one does not, that share a gloss (either word's
    candidates), not on the site and not judged before."""
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    words = ws.scope()
    by = {"word": defaultdict(set), "reading": defaultdict(set)}
    for w, x in words.items():
        by["word"][x["word"]].add(w)
        by["reading"][x["reading"]].add(w)
    old = set()
    for w, x in words.items():
        for k in ("word", "reading"):
            s = x[k]
            forms = [m + s for m in "おご御"] + [s + m for m in ("日", "に", "と", "的")]
            forms += [s[:-len(e)] + f for e, f in (("ずる", "じる"), ("す", "せる"), ("る", "りる")) if s.endswith(e)]
            forms += [s[:i] + c + s[i:] for i in range(1, len(s)) for c in "がにのっ"]
            for t in forms:
                old |= {frozenset((w, o)) for o in by[k].get(t, ()) if o != w and _old_same_word(w, o)}
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    shown = {frozenset((int(w), r[2])) for w, rs in site.items() for r in rs}
    judged = {frozenset((int(k.split("|")[0]), int(k.split("|")[3]))) for k in synonym_removed.all_verdicts()}  # w|i|kind|o
    judged |= {frozenset((int(k.split("|")[0]), int(k.split("|")[2])))  # w|i|o|n
               for k, v in all_verdicts().items() if v["item"]["now"] != "freed"}
    cands = {}
    items = []
    for pair in sorted(old, key=sorted):
        a, b = sorted(pair)
        if ws.same_word(a, b) or pair in shown or pair in judged or pair in _decided():
            continue
        for w in (a, b):
            if w not in cands:
                syn, ant = ws.candidates(w)
                cands[w] = set(syn) | set(ant)
        if b not in cands[a] and a not in cands[b]:
            continue
        items.append({"key": f"{a}||{b}|", "now": "freed", "came": "hidden by the old same-word rule",
                      "word": _brief(a, None), "other": _brief(b, None)})
    for n in range(0, len(items), size):
        name = f"F-{n // size:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": items[n:n + size]})
    print(f"{len(old)} pairs the old rule called one word; {len(items)} freed with a shared gloss -> {IN}/F-*")


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
        if kind == "syn" and it["now"] != "freed":
            probs.append(f"{batch}: {k}: syn only for freed pairs")
            continue
        if kind in SENSED:
            for side, f in (("word", "wordSense"), ("other", "otherSense")):
                if not isinstance(v.get(f), int) or not 1 <= v[f] <= len(it[side]["senses"]):
                    need.append(f"{f} (a sense number of {side})")
        if kind == "polite":
            reg = v.get("register")
            if not isinstance(reg, dict) or reg.get("word") not in REGISTERS or reg.get("other") not in REGISTERS \
                    or reg["word"] == reg["other"]:
                need.append(f"register {{word, other}}, two different of {', '.join(REGISTERS)}")
        if kind in LINE:
            for f in ("line", "reverse"):
                if not isinstance(v.get(f), str) or not v[f].strip() or len(v[f]) > LINE[kind]:
                    need.append(f"{f} (at most {LINE[kind]} characters)")
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
    for kind in ("syn", "pair", "polite", "mix", "short", "older"):
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
    p.add_argument("--freed", action="store_true")
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("report")
    a = ap.parse_args()
    {"prepare": lambda: (prepare_freed if a.freed else prepare)(a.size), "check": lambda: check(a.batch), "report": report}[a.cmd]()


if __name__ == "__main__":
    main()
