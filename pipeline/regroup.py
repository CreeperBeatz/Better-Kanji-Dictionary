"""Draw a kanji's meaning groups again: meanings, not word-building patterns.

    python pipeline/regroup.py prepare --chars 人物大出一手気立合取 [--per 2]
    # one Opus subagent per in/<run>-*.json (pipeline/regroup_prompt.md), writing out/<run>-*.json
    python pipeline/regroup.py check
    python pipeline/regroup.py compare

The October groups split common kanji by how they build words as well as by
meaning: 人 has "person", "person of a kind" and "counting people", though 人
means "person" in 村人, 商人 and 三人. Words then sit between twin groups and
cannot be placed surely (2026-10-17: 65% of the blocked words). Here a group
is a meaning, and a pattern (a suffix, a counter, an intensifier) is a `use`
inside the meaning whose sense it carries.

Each kanji carries what the October redraft gave it (data/drafts/meanings-v2:
its words, KANJIDIC, Kodansha, Цалта, Wiktionary) and its groups now
(`current`). Two runs, A and B (words shuffled), to see how stable the
groups are. Nothing is loaded from here: the groups are shown to Dani first.

Drafts live in data/drafts/regroup-pilot/ (untracked).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from proposals import CATCH_ALL, review  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "regroup-pilot")
SOURCE = proposals.DRAFTS / "meanings-v2" / "in"


def _october(chars: str) -> dict[str, dict]:
    out = {}
    for f in sorted(SOURCE.glob("A-*.json")):
        for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            if k["char"] in chars and k["char"] not in out:
                out[k["char"]] = k
    return out


def prepare(chars: str, per: int) -> None:
    if any(IN.glob("*.json")):
        raise SystemExit(f"{IN} has batches already: delete the folder to start again")
    october = _october(chars)
    kanji = []
    for c in chars:
        k = october[c]
        current = [{"id": proposals.short_id(s["id"]), "en": s.get("en"), "about": s.get("about")}
                   for s in review.site_meanings(c)["senses"] or [] if s["id"] != CATCH_ALL]
        kanji.append({"char": c, "kanjidic": k["kanjidic"], "curated": k.get("curated"), "on": k["on"], "kun": k["kun"],
                      "current": current, "dictionaries": k.get("dictionaries"), "words": k["words"]})
    rng = random.Random(5)
    for run in ("A", "B"):
        for i in range(0, len(kanji), per):
            part = [{**k, "words": k["words"] if run == "A" else rng.sample(k["words"], len(k["words"]))} for k in kanji[i:i + per]]
            path = IN / f"{run}-{i // per:03d}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            lines = ",\n".join(json.dumps(k, ensure_ascii=False) for k in part)
            path.write_text(f'{{"batch": "{run}-{i // per:03d}", "run": "{run}", "kanji": [\n{lines}\n]}}\n', encoding="utf-8")
    print(f"{len(kanji)} kanji, {-(-len(kanji) // per)} batches a run -> {IN.relative_to(proposals.ROOT)}")


def read_run(run: str) -> tuple[dict[str, dict], list[str]]:
    good, problems = {}, []
    for inp, batch, got in proposals.outputs(IN, OUT, f"{run}-*.json", problems):
        for k in batch["kanji"]:
            e = (got.get("kanji") or {}).get(k["char"])
            ids = {str(w[0]) for w in k["words"]}
            if not isinstance(e, dict) or not isinstance(e.get("groups"), list) or not e["groups"]:
                problems.append(f"{inp.stem} {k['char']}: missing")
                continue
            bad = [x for g in e["groups"] for x in [*g.get("examples", []), *(y for u in g.get("uses") or [] for y in u.get("examples", []))]
                   if str(x) not in ids]
            if bad:
                problems.append(f"{inp.stem} {k['char']}: examples not in the list {bad[:5]}")
            good[k["char"]] = e
    return good, problems


def check() -> None:
    for run in ("A", "B"):
        good, problems = read_run(run)
        print(f"run {run}: {len(good)} kanji, {len(problems)} problems")
        for p in problems:
            print("   ", p)


def compare() -> None:
    """Each kanji's groups in both runs, side by side, and what they kept of the current ones."""
    a, _ = read_run("A")
    b, _ = read_run("B")
    lines = []
    for c in a:
        lines.append(f"## {c}")
        for run, got in (("A", a), ("B", b)):
            e = got.get(c)
            if not e:
                continue
            gs = "; ".join(f"{g['id']} ({g['en']})" + (" [uses: " + ", ".join(u["en"] for u in g.get("uses") or []) + "]" if g.get("uses") else "")
                           for g in e["groups"])
            lines.append(f"- {run}: {gs}")
        lines.append(f"- why (A): {a[c].get('why', '')}")
        lines.append("")
    out = DRAFTS / "compare.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


def main() -> int:
    global DRAFTS, IN, OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    proposals.drafts_arg(ap, "data/drafts/regroup-pilot")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--chars", required=True)
    p.add_argument("--per", type=int, default=2, help="kanji per batch")
    sub.add_parser("check")
    sub.add_parser("compare")
    args = ap.parse_args()
    DRAFTS, IN, OUT = proposals.folders(args.drafts or DRAFTS)
    if args.cmd == "prepare":
        prepare(args.chars, args.per)
    elif args.cmd == "check":
        check()
    else:
        compare()
    return 0


if __name__ == "__main__":
    sys.exit(main())
