"""Drop the filler groups the old two-group minimum forced on meanings drafts.

    python pipeline/meaning_prune.py prepare        # -> data/drafts/meanings-prune/in/P-*.json
    # one Sonnet subagent per batch, following the brief in this docstring's PROMPT
    python pipeline/meaning_prune.py check [--batch P-003]
    python pipeline/meaning_prune.py apply [--dry-run]

Until 2026-10-05 a kanji needed at least two groups, so some drafts carry a
group nothing in the kanji's words supports (才 "age" with none of its ten
words). A kanji is a candidate when, with four or more words placed, one of
its groups has none, or, with eight or more, one has a single word. The agent
sees each group with its words and keeps it, drops it (when empty) or merges
it into another group (naming where each of its words goes).

`apply` touches only drafts no one has handled: the kanji's meanings item open,
drafted by the model, never decided or skipped, and no accepted groups. A word
moved out of a dropped group has its open placement re-pointed; its two drafting
runs then no longer agree with it, so it waits for a person (server/review.py,
word_rule) instead of being accepted on its own.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from proposals import CATCH_ALL, ROOT, SOURCE, review, sense_id, short_id  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "meanings-prune")
BATCH = 10
SHOWN = 25  # words shown per group: enough to judge it, the rest counted


def _candidates() -> list[dict]:
    data = review._read()
    decided = {d["subject"] for d in data["decisions"] if d["type"] == "kanji_senses"}
    words: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for i in data["items"].values():
        if i["type"] == "word_sense" and i["status"] == "open" and i["proposed"]:
            c, wid = i["subject"].split("|")
            words[c][i["proposed"]].append(int(wid))
    out = []
    for i in data["items"].values():
        c = i["subject"]
        if (i["type"] != "kanji_senses" or i["status"] != "open" or i["source"] != SOURCE or not i["proposed"]
                or c in decided or i.get("skipped_by") or c in data["live"]["kanji_senses"]):
            continue
        groups = i["proposed"]
        counts = {g["id"]: len(words[c][g["id"]]) for g in groups}
        total = sum(counts.values())
        if (total >= 4 and 0 in counts.values()) or (total >= 8 and 1 in counts.values()):
            out.append({"char": c, "groups": groups, "words": {g: words[c][g] for g in counts},
                        "catchAll": words[c][CATCH_ALL]})
    return sorted(out, key=lambda k: k["char"])


def prepare() -> None:
    cands = _candidates()
    db = proposals.connect()
    head = {r[0]: (r[1], r[2], (r[3] or "").split(";")[0][:60]) for r in db.execute(
        "SELECT w.id, w.headword, w.reading, (SELECT s.gloss FROM sense s WHERE s.word_id = w.id ORDER BY s.ord LIMIT 1) FROM word w")}
    meanings = {c: json.loads(m or "[]") for c, m in db.execute("SELECT char, meanings FROM kanji")}
    IN.mkdir(parents=True, exist_ok=True)
    batches = [cands[i:i + BATCH] for i in range(0, len(cands), BATCH)]
    for n, b in enumerate(batches):
        kanji = []
        for k in b:
            c = k["char"]
            groups = []
            for g in k["groups"]:
                ws = k["words"][g["id"]]
                groups.append({
                    "id": short_id(g["id"]), "en": g["en"], **({"note": g["note"]} if g.get("note") else {}),
                    "count": len(ws),
                    "words": [[w, *head[w]] for w in ws[:SHOWN] if w in head],
                })
            kanji.append({"char": c, "kanjidic": meanings.get(c, []), "groups": groups,
                          "catchAll": [[w, *head[w]] for w in k["catchAll"][:10] if w in head]})
        (IN / f"P-{n:03d}.json").write_text(json.dumps({"batch": f"P-{n:03d}", "kanji": kanji}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(cands)} kanji in {len(batches)} batches -> {IN.relative_to(ROOT)}")


def read(only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    """Each kanji's verdict: the groups kept (ids, maybe relabelled) and where the dropped ones' words go."""
    good, problems = {}, []
    for inp, batch, out in proposals.outputs(IN, OUT, f"{only or 'P-*'}.json", problems):
        got = out.get("kanji") or {}
        for k in batch["kanji"]:
            c, v = k["char"], got.get(k["char"])
            ids = {g["id"] for g in k["groups"]}
            if not isinstance(v, dict) or not isinstance(v.get("keep"), list) or not v["keep"]:
                problems.append(f"{inp.stem} {c}: needs a non-empty keep list")
                continue
            keep = [str(x) for x in v["keep"]]
            if not set(keep) <= ids or len(set(keep)) != len(keep):
                problems.append(f"{inp.stem} {c}: keep names a group that is not there")
                continue
            moves = {str(w): str(g) for w, g in (v.get("moves") or {}).items()}
            dropped = [g for g in k["groups"] if g["id"] not in keep]
            need = {str(w[0]) for g in dropped for w in g["words"]}
            # Words of a dropped group not shown (past SHOWN) follow its first move target.
            if any(g["count"] > len(g["words"]) for g in dropped) and not v.get("rest"):
                problems.append(f"{inp.stem} {c}: a dropped group has more words than shown; say where the rest go in `rest`")
                continue
            if set(moves) != need or any(t not in set(keep) | {CATCH_ALL} for t in moves.values()):
                problems.append(f"{inp.stem} {c}: moves must cover every word of the dropped groups, each into a kept group or catch-all")
                continue
            labels = {str(g): str(l).strip() for g, l in (v.get("labels") or {}).items() if str(g) in keep and str(l).strip()}
            if any(len(l) > 40 or len(l.split()) > 4 for l in labels.values()):
                problems.append(f"{inp.stem} {c}: a label over 4 words")
                continue
            good[c] = {"keep": keep, "moves": {int(w): g for w, g in moves.items()}, "labels": labels,
                       "rest": v.get("rest"), "dropped": [g["id"] for g in dropped]}
    return good, problems


def check(only: str | None = None) -> dict:
    good, problems = read(only)
    print(f"{len(good)} kanji valid, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)
    changed = {c: v for c, v in good.items() if v["dropped"] or v["labels"]}
    print(f"{len(changed)} kanji change: {sum(len(v['dropped']) for v in good.values())} groups dropped, "
          f"{sum(len(v['moves']) for v in good.values())} words moved")
    return good


def apply(dry_run: bool) -> None:
    good = check()
    cands = {k["char"] for k in _candidates()}
    with review._change() as data:
        done = words = 0
        for item in list(data["items"].values()):
            c = item["subject"]
            if item["type"] != "kanji_senses" or c not in good or c not in cands:
                continue
            v = good[c]
            if not v["dropped"] and not v["labels"]:
                continue
            kept = [{**g, **({"en": v["labels"][short_id(g["id"])]} if short_id(g["id"]) in v["labels"] else {})}
                    for g in item["proposed"] if short_id(g["id"]) in v["keep"]]
            value = review.validate("kanji_senses", c, kept, data, pending_ok=True, machine=True)
            dropped = {f"{c}.{g}" for g in v["dropped"]}
            rest = sense_id(c, v["rest"]) if v.get("rest") else None
            for w in list(data["items"].values()):
                if w["type"] != "word_sense" or w["status"] != "open" or not w["subject"].startswith(f"{c}|"):
                    continue
                if w["proposed"] in dropped:
                    wid = int(w["subject"].split("|")[1])
                    new = sense_id(c, v["moves"][wid]) if wid in v["moves"] else rest
                    if new and not dry_run:
                        review._update(data, w, proposed=new)
                    words += 1
            if not dry_run:
                review._update(data, item, proposed=value)
            done += 1
        if dry_run:
            raise SystemExit(f"would change {done} kanji and move {words} words (dry run: nothing written)")
    print(f"changed {done} kanji, moved {words} words")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    c = sub.add_parser("check")
    c.add_argument("--batch")
    proposals.load_parser(sub, "apply", review_dir=False)
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare()
    elif args.cmd == "check":
        check(args.batch)
    else:
        apply(args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
