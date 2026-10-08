"""Accept the parts cards where KanjiVG, IDS, Цалта and the draft all give the same split.

    python pipeline/auto_agree.py --by USER_ID [--apply] [--spot 0.1] [--review-dir DIR]

Why (Dani, 2026-10-08): on the first 51 prod cards, every one where the three
sources and the draft agreed was accepted as they said (19 of 19), and the
2026-10-06 audit found 0 wrong in a random 60 such characters. So those cards
are decided by rule, as `--by` (on prod the "Claude Opus 5.5" account), each
with its reason, revertible from History like any decision.

Only cards with nothing but parts on them, and not a form of another kanji
(a form has no parts of its own). The sources are compared after writing a
root kanji as the graph's side form (糸 as 糹). A seeded random `--spot`
share is left open for a person: if one of those is changed, stop and look
again. Without --apply it only lists them.
"""

from __future__ import annotations

import argparse
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from server import decomp_sources, forms, review  # noqa: E402
from server.db import query  # noqa: E402
from server.errors import AppError  # noqa: E402

SOURCES = ("kanjivg", "ids", "tsalta")
REASON = "auto: KanjiVG, IDS, Цалта and the draft give the same split (rule agreed with Dani, 2026-10-08)"


def candidates() -> list[tuple[str, list[str], list[dict]]]:
    """(char, the agreed parts, its open parts items) for every card the rule decides."""
    data = review._read()
    eq = {r["char"]: r["rep"] for r in query("SELECT char, rep FROM decomp_equiv")}
    key = lambda p: frozenset(eq.get(c, c) for c in p)  # noqa: E731 -- order and position don't count
    roots, anchor = forms.roots(), review._anchors(data)
    cards: dict[str, list[dict]] = defaultdict(list)
    for i in data["items"].values():
        if i["status"] == "open" and i["type"] in review.CHARACTER_TYPES:
            cards[anchor(i)].append(i)
    out = []
    for c, items in sorted(cards.items()):
        if c in roots or any(i["type"] != "decomposition" for i in items):
            continue
        given = {s["source"]: s["parts"] for s in decomp_sources.splits(c)}
        if not all(given.get(s) for s in SOURCES):
            continue
        splits = [review.side_forms(c, given[s]) for s in SOURCES]
        if len({key(p) for p in splits}) != 1:
            continue
        draft = next(((i.get("evidence") or {}).get("draft") for i in items if (i.get("evidence") or {}).get("draft")), None)
        if not draft or key(draft["parts"]) != key(splits[0]):
            continue
        out.append((c, splits[0], items))
    return out


def card_decisions(c: str, parts: list[str], items: list[dict]) -> list[dict]:
    """The card closed as a person would: keep where the graph agrees, else accept the matching proposal."""
    if set(review.current("decomposition", c)) == set(parts):
        return [{"item": i["id"], "action": "keep"} for i in items]
    carrier = next((i for i in items if isinstance(i["proposed"], list) and set(i["proposed"]) == set(parts)), None)
    act = {"action": "accept"} if carrier else {"action": "edit", "value": parts}
    carrier = carrier or items[0]
    return [{"item": i["id"], **(act if i is carrier else {"action": "reject"})} for i in items]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--by", required=True, help="the account the decisions are made as")
    ap.add_argument("--apply", action="store_true", help="decide them (default: only list them)")
    ap.add_argument("--spot", type=float, default=0.1, help="share left open for a person to check")
    ap.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.review_dir:
        review.use_dir(args.review_dir)
    found = candidates()
    spot = set(random.Random(20261008).sample([c for c, _, _ in found], round(len(found) * args.spot)))
    print(f"{len(found)} cards agree; {len(spot)} left open as a spot check: {''.join(sorted(spot))}")
    done = skipped = 0
    for c, parts, items in found:
        if c in spot:
            continue
        if not args.apply:
            done += 1
            continue
        try:
            review.decide_card(c, card_decisions(c, parts, items), args.by, REASON)
            done += 1
        except AppError as e:  # changed since it was drafted, or anything else: a person looks
            skipped += 1
            print(f"  {c}: left open ({e.code})")
    print(f"{done} cards {'decided' if args.apply else 'to decide; --apply decides them'}" + (f", {skipped} left open" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
