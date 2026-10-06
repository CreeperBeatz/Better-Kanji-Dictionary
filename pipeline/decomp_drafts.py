"""Check every decomposition by rule, and have an AI draft each parts card with its proof.

    python pipeline/decomp_drafts.py flags                 # what the rules find, nothing written
    python pipeline/decomp_drafts.py prepare               # batches for the subagents
    python pipeline/decomp_drafts.py prepare --new         # a later pass: only what has no draft yet (E-*)
    python pipeline/decomp_drafts.py --drafts data/drafts/decomp-audit prepare --audit 60
                                                           # a random sample of what no rule flags (A-*), to measure
    # one Sonnet subagent per data/drafts/decomp/in/*.json, following pipeline/decomp_prompt.md
    python pipeline/decomp_drafts.py check [--batch D-000]
    python pipeline/decomp_drafts.py load [--dry-run] [--review-dir DIR]

Why (2026-10-06 data review): a decomposition reaches the queue only when
IDS or KanjiVG disagree with it, or the cost ranking picks it. Mistakes all
the sources share never surface: in a random 80 of the 1,950 in-scope kanji
with no card, 車 = 二日, 斤 = ⺁丅, 以 = 丨丶人, 皮 = 又, 良 = 艮 and 且 = 目
were wrong. These rules find that kind, over every character inside a kanji
in scope (the closure):

- **one part**: a character built from a single part is either that part
  with strokes added (皮 = 又 + …, the rest lost) or only looks like it
  (且 = 目, 午 = 干). Both need a person.
- **strokes unaccounted**: the parts' strokes fall two or more short of the
  whole (段 = 殳 leaves 5), and no part's count explains the gap as a
  repeat (品 = 口, three times, is by design).
- **bare stroke**: a part that is a single stroke (以 = 丨丶人).
- **no source splits it**: neither IDS nor KanjiVG gives it parts, and we do.
- **data issue**: named in DATA-ISSUES.md (五 段 為 並 牛 …).
- **a source keeps it whole** (D-018, Dani's rule: a base kanji stays
  whole): KanjiVG, IDS or Цалта give it no parts, and we split it
  (止 = 丄 卜, 糸 = 小 幺).
- **weak backing**: fewer than two of KanjiVG, IDS and Цалта split it as we
  do -- only one source does, they all split it otherwise, or none can be
  read (具, 合, 直). Two sources agreeing is the bar for a split no person
  has checked.

Every parts card -- these and the ones already queued -- then gets a draft:
the parts it should have (or none), whether that keeps or changes today's,
and a short proof: what each part does in it (meaning, sound, or the form of
a kanji in that position) and what the old form shows. The loader puts the
draft on the card as evidence; where it names parts nobody proposed, it also
becomes a proposal of its own. A flagged character with no card gets one.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
import review_sources as rs  # noqa: E402
from decomp import BARE_STROKES  # noqa: E402
from proposals import ROOT, SOURCE, review  # noqa: E402

from server import scope as review_scope  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "decomp")
PER_BATCH = 30
FLAG_SOURCE = "parts-check"
# The sources a split is checked against (decomp_source), in the order a reviewer trusts them.
BACKERS = (("kanjivg", "KanjiVG"), ("ids", "IDS"), ("tsalta", "Цалта"))

# DATA-ISSUES.md D-004: found by people, whether or not a rule sees them.
DATA_ISSUES = {
    "五": "D-004: 五 is given 力, so 語 (via 吾) contains 力",
    "段": "D-004: 段 has only 殳; the left half is missing",
    "為": "D-004: 為 is only 灬",
    "並": "D-004: 並 is only 二",
    "牛": "D-004: 牛 = 二 is a stroke split",
    "車": "D-004: 車 = 二日 is a stroke split",
    "斤": "D-004: 斤 = ⺁丅 is a stroke split",
    "以": "D-004: 以 is built of bare strokes",
    "皮": "D-004: 皮 = 又 loses the rest",
    "良": "D-004: 良 = 艮 loses the dot",
    "且": "D-004: 且 = 目 is a lookalike",
    "交": "D-004: 交 = 亠父 may be a lookalike",
    "自": "D-004: 自 = 目 may be a lookalike",
}


def strokes(db) -> dict[str, int]:
    out = {c: n for c, n in db.execute("SELECT char, strokes FROM kanji WHERE strokes IS NOT NULL")}
    for c, paths in db.execute("SELECT char, paths FROM stroke"):
        out.setdefault(c, len(json.loads(paths)))
    return out


def flags() -> tuple[dict[str, list[str]], dict]:
    """char -> what the rules found, over the closure of the kanji in scope; and what was read."""
    db = proposals.connect()
    children, nodes = rs.graph(db)
    scope = rs.closure(children, review_scope.kanji(db))
    st = strokes(db)
    ids, kvg = rs.babelstone(), rs.kanjivg()
    splits = source_splits(db)
    eq = rs.equivalence(db)
    key = lambda p: frozenset(eq.get(c, c) for c in p)  # noqa: E731 -- order and position (糹 for 糸) don't count
    out: dict[str, list[str]] = defaultdict(list)
    for x in sorted(scope):
        parts = children.get(x, [])
        if x in DATA_ISSUES:
            out[x].append(DATA_ISSUES[x])
        if not parts:
            continue
        if len(parts) == 1:
            out[x].append(f"one part only: {parts[0]}")
        if x in st and all(p in st for p in parts):
            gap = st[x] - sum(st[p] for p in parts)
            if gap >= 2 and not any(gap % st[p] == 0 for p in parts):
                out[x].append(f"{gap} of its {st[x]} strokes are in no part")
        bare = [p for p in parts if p in BARE_STROKES]
        if bare:
            out[x].append(f"bare stroke as a part: {''.join(bare)}")
        unread = (x not in ids or rs.ids_parts(ids[x], x) is None) and x not in kvg
        if unread:
            out[x].append("neither IDS nor KanjiVG splits it")
        got = splits.get(x, {})
        whole = [name for s, name in BACKERS if got.get(s) == []]
        if whole:
            out[x].append(f"{' and '.join(whole)} keep{'s' if len(whole) == 1 else ''} it whole: a base kanji stays whole (D-018)")
        agree = [name for s, name in BACKERS if got.get(s) and key(got[s]) == key(parts)]
        other = [f"{name} {''.join(got[s])}" for s, name in BACKERS if got.get(s) and key(got[s]) != key(parts)]
        if len(agree) < 2:
            if agree and other:
                out[x].append(f"only {agree[0]} splits it like this ({'; '.join(other)})")
            elif agree:
                out[x].append(f"only {agree[0]} splits it like this")
            elif other:
                out[x].append(f"every source splits it otherwise: {'; '.join(other)}")
            elif not whole and not unread:
                out[x].append("no source we can read splits it")
    return dict(out), {"db": db, "children": children, "nodes": nodes, "scope": scope, "strokes": st, "ids": ids, "kvg": kvg}


def source_splits(db) -> dict[str, dict[str, list[str]]]:
    """char -> source -> parts, from the build's decomp_source (pipeline/decomp_sources.py); [] = one piece."""
    out: dict[str, dict[str, list[str]]] = defaultdict(dict)
    for c, src, parts in db.execute("SELECT char, source, parts FROM decomp_source WHERE source != 'built'"):
        out[c][src] = json.loads(parts)
    return out


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def subjects() -> tuple[dict[str, list[dict]], dict[str, list[str]], dict]:
    """The characters to draft: every open parts card, and every flagged one."""
    found, ctx = flags()
    cards: dict[str, list[dict]] = defaultdict(list)
    for i in review._read()["items"].values():
        if i["type"] == "decomposition" and i["status"] == "open":
            cards[i["subject"]].append(i)
    return dict(cards), found, ctx


def _decided(data: dict | None = None) -> set[str]:
    """Characters whose parts a person decided in this queue: no draft or check is put back on them."""
    data = data or review._read()
    return {i["subject"] for i in data["items"].values()
            if i["type"] == "decomposition" and i["status"] not in ("open", "withdrawn")}


def prepare(new: bool = False, audit: int = 0, seed: int = 20261006, exclude: str | None = None) -> None:
    """Batches for the subagents. `new`: a later pass -- only the flagged characters with no
    card and no decision yet, as E-* batches beside the first pass's D-*, which stay."""
    cards, found, ctx = subjects()
    splits = source_splits(ctx["db"])
    db, children, st, ids, kvg = ctx["db"], ctx["children"], ctx["strokes"], ctx["ids"], ctx["kvg"]
    krad = rs.kradfile()
    meanings = {c: json.loads(m or "[]")[:4] for c, m in db.execute("SELECT char, meanings FROM kanji")}
    curated = dict(db.execute("SELECT char, meaning FROM kanji_curated"))
    old = {a: b for a, b in db.execute("SELECT char, other FROM char_form WHERE kind = 'old'")}
    if audit:
        # What passes every rule (two sources agree, nothing flagged) and has no card: how often is it still wrong?
        import random

        # An earlier sample's characters (--exclude 'data/drafts/decomp-audit/in/A-*.json') are not drawn again.
        before = {r["char"] for f in ROOT.glob(exclude) for r in json.loads(f.read_text(encoding="utf-8"))["chars"]} if exclude else set()
        passed = sorted(c for c in ctx["scope"]
                        if children.get(c) and c not in found and c not in cards and c not in _decided() and c not in before)
        chars = sorted(random.Random(seed).sample(passed, min(audit, len(passed))), key=lambda c: (-len(review.users_of(c)), c))
        print(f"sampled {len(chars)} of the {len(passed)} that pass every rule")
    elif new:
        decided = _decided()
        chars = sorted((c for c in found if c not in cards and c not in decided), key=lambda c: (-len(review.users_of(c)), c))
    else:
        chars = sorted(set(cards) | set(found), key=lambda c: (-len(review.users_of(c)), c))
    rows = []
    for c in chars:
        users = review.users_of(c)
        mean = lambda p: curated.get(p) or ", ".join(meanings.get(p, [])) or None  # noqa: E731
        rows.append({
            "char": c,
            "strokes": st.get(c),
            "meaning": mean(c),
            "inScope": len(users),
            "examples": users[:8],
            "current": [{"part": p, "meaning": mean(p), "strokes": st.get(p)} for p in children.get(c, [])],
            "proposals": [{"parts": i["proposed"], "source": i["source"]} for i in cards.get(c, []) if i["proposed"] is not None],
            "flags": found.get(c, []),
            "ids": ids.get(c),
            "kanjivg": kvg.get(c),
            "tsalta": splits.get(c, {}).get("tsalta"),
            "kradfile": krad.get(c),
            "old": old.get(c),
            "oldIds": ids.get(old[c]) if c in old else None,
        })
    prefix = "A" if audit else "E" if new else "D"
    for f in IN.glob(f"{prefix}-*.json"):
        f.unlink()
    for i in range(0, len(rows), PER_BATCH):
        n = i // PER_BATCH
        _write(IN / f"{prefix}-{n:03d}.json", {"batch": f"{prefix}-{n:03d}", "chars": rows[i:i + PER_BATCH]})
    print(f"{len(rows)} characters ({len(cards)} with a card, {len(set(found) - set(cards))} flagged with none)"
          f" in {-(-len(rows) // PER_BATCH)} batches -> {IN.relative_to(ROOT)}")


VERDICTS = ("keep", "change")


def read(only: str | None = None) -> tuple[list[dict], list[str]]:
    good, problems = [], []
    for inp, batch, out in proposals.outputs(IN, OUT, f"{only or '[DE]-*'}.json", problems):
        asked = {r["char"]: r for r in batch["chars"]}
        seen = set()
        for d in out.get("chars", []):
            c = str(d.get("char", ""))
            where = f"{inp.stem} {c}"
            if c not in asked or c in seen:
                problems.append(f"{where}: not asked, or twice")
                continue
            try:
                conf = float(d.get("confidence"))
            except (TypeError, ValueError):
                conf = -1
            why = " ".join(str(d.get("why") or "").split())
            if d.get("verdict") not in VERDICTS or not 0 <= conf <= 1 or not why:
                problems.append(f"{where}: needs verdict keep|change, confidence 0-1 and why")
                continue
            try:
                parts = review.validate("decomposition", c, d.get("parts"))  # a person may use a stroke; so may a draft, flagged
            except Exception as e:  # noqa: BLE001 -- reported, not raised
                problems.append(f"{where}: {e}")
                continue
            current = [p["part"] for p in asked[c]["current"]]
            if d["verdict"] == "keep" and sorted(parts) == sorted(current):
                parts = current  # the same parts, another order: a keep
            if (d["verdict"] == "keep") != (parts == current):
                problems.append(f"{where}: verdict {d['verdict']} but parts {''.join(parts)} vs now {''.join(current)}")
                continue
            seen.add(c)
            good.append({"char": c, "parts": parts, "verdict": d["verdict"], "why": why[:400], "confidence": conf,
                         "lookalikes": [str(x) for x in d.get("lookalikes") or []][:6], "batch": inp.stem,
                         "current": current, "flags": asked[c]["flags"], "inScope": asked[c]["inScope"]})
        for c in sorted(set(asked) - seen):
            problems.append(f"{inp.stem} {c}: not answered")
    return good, problems


def check(only: str | None = None) -> list[dict]:
    good, problems = read(only)
    print(f"{len(good)} valid, {len(problems)} problems")
    for p in problems[:40]:
        print("   ", p)
    print("verdicts:", dict(Counter(g["verdict"] for g in good)),
          " atomic:", sum(1 for g in good if g["verdict"] == "change" and not g["parts"]))
    return good


def load(dry_run: bool, review_dir: Path | None) -> None:
    good = check()
    proposals.use_review_dir(review_dir)
    data = review._read()
    cards: dict[str, list[dict]] = defaultdict(list)
    for i in data["items"].values():
        if i["type"] == "decomposition" and i["status"] == "open":
            cards[i["subject"]].append(i)
    evidence, rows = {}, []
    n = Counter()
    decided = _decided(data)
    # The rules as they are now (a later pass adds some): what the card says under "why this card".
    found, _ = flags()
    eq = rs.equivalence(proposals.connect())

    def norm(parts: list[str]) -> frozenset[str]:
        """The same parts in another order, or one written in another position (糹 for 糸), are the same answer."""
        return frozenset(eq.get(p, p) for p in parts)

    for g in good:
        c = g["char"]
        if c in decided:
            continue
        g = {**g, "flags": found.get(c, g["flags"])}
        # A learner sees no difference: a keep.
        if norm(g["parts"]) == norm(g["current"]):
            g = {**g, "verdict": "keep", "parts": g["current"]}
        draft = {"parts": g["parts"], "verdict": g["verdict"], "why": g["why"], "confidence": g["confidence"],
                 "lookalikes": g["lookalikes"], "flags": g["flags"]}
        for i in cards.get(c, []):
            evidence[i["id"]] = draft
        proposed = [norm(i["proposed"]) for i in cards.get(c, []) if i["proposed"] is not None]
        priority = round(min(g["inScope"], 300) / 30, 2)
        # A draft with a bare stroke is no source proposal (review.validate refuses it from a machine):
        # it stays on the card as the draft's view, which the reviewer may take as their own.
        strokes = any(p in review.STROKES for p in g["parts"])
        if g["verdict"] == "change" and norm(g["parts"]) not in proposed and not strokes:
            rows.append({"type": "decomposition", "subject": c, "proposed": g["parts"], "source": SOURCE,
                         "reason": g["why"], "evidence": {"draft": draft}, "priority": priority + 1})
            n["proposal"] += 1
        elif not cards.get(c):
            # Flagged, no card, and the draft keeps it (or proposes what is proposed): a check, with the draft's word.
            rows.append({"type": "decomposition", "subject": c, "proposed": None, "source": FLAG_SOURCE,
                         "reason": "check: " + "; ".join(g["flags"]), "evidence": {"draft": draft}, "priority": priority})
            n["check"] += 1
    print(f"would put the draft on {len(evidence)} cards, add {n['proposal']} proposals and {n['check']} checks")
    if dry_run:
        return
    print("evidence on", review.attach_evidence("draft", evidence), "cards")
    added, refused = review.add_items(rows)
    print(f"added {added}, refused {refused}")


def main() -> int:
    global DRAFTS, IN, OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    proposals.drafts_arg(ap, "data/drafts/decomp")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("flags")
    pp = sub.add_parser("prepare")
    pp.add_argument("--new", action="store_true")
    pp.add_argument("--audit", type=int, default=0, help="a random sample of this many that pass every rule")
    pp.add_argument("--seed", type=int, default=20261006)
    pp.add_argument("--exclude", help="a glob of earlier audit batches whose characters are not drawn again")
    c = sub.add_parser("check")
    c.add_argument("--batch")
    proposals.load_parser(sub, "load")
    args = ap.parse_args()
    DRAFTS, IN, OUT = proposals.folders(args.drafts or DRAFTS)
    if args.cmd == "flags":
        found, _ = flags()
        kinds = Counter(f.split(":")[0] if f.startswith("D-") or f.startswith("one") or f.startswith("bare") else
                        ("strokes" if "strokes" in f else f) for fs in found.values() for f in fs)
        print(f"{len(found)} characters flagged:", dict(kinds))
        print(" ".join(f"{c}" for c in found))
    elif args.cmd == "prepare":
        prepare(args.new, args.audit, args.seed, args.exclude)
    elif args.cmd == "check":
        check(args.batch)
    else:
        load(args.dry_run, args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
