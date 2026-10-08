"""Take etymology off the meanings cards, into their evidence (Dani, 2026-10-08).

    python pipeline/park_etymology.py [--review-dir D] [--dry-run]

The meanings card no longer asks how a kanji was built (its origin, from
Wiktionary's glyph origin) or which group holds its original meaning: that
is "interesting stuff about the kanji", for a queue of its own, at another
time, with other sources. So an open card's value loses them, and the
drafts move into the meanings item's evidence as `etymology`
({origin, originBg, originSure, original: [group ids]}), kept as one source
for that queue. A decided card is not touched.

pipeline/meaning_extras.py `load` writes new drafts this way already; this
moves the ones loaded before. The review store is copied to your home
folder first.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from server import review  # noqa: E402

ORIGIN = ("origin", "originBg", "originSure")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--review-dir", type=Path, help="another review folder (a sandbox's)")
    ap.add_argument("--dry-run", action="store_true", help="only count")
    args = ap.parse_args()
    if args.review_dir:
        review.use_dir(args.review_dir)

    data = review._read()
    open_ = lambda t: {i["subject"]: i for i in data["items"].values() if i["type"] == t and i["status"] == "open"}  # noqa: E731
    senses, extras = open_("kanji_senses"), open_("kanji_extras")
    todo = sorted(c for c in set(senses) | set(extras)
                  if any(k in ((extras.get(c) or {}).get("proposed") or {}) for k in ORIGIN)
                  or any("original" in g for g in (senses.get(c) or {}).get("proposed") or []))
    origins = sum(1 for c in todo if ((extras.get(c) or {}).get("proposed") or {}).get("origin"))
    originals = sum(1 for c in todo if any(g.get("original") for g in (senses.get(c) or {}).get("proposed") or []))
    print(f"{len(todo)} kanji: {origins} drafted origins, {originals} original meanings move to the evidence")
    if args.dry_run or not todo:
        return 0

    if not args.review_dir:
        dest = Path.home() / f"betterrtk-review-pre-etymology-{datetime.now():%Y%m%d-%H%M}.db"
        review.backup(dest)
        print(f"backed up to {dest}")
    with review._change() as data:
        for c in todo:
            s = next((i for i in data["items"].values() if i["type"] == "kanji_senses" and i["subject"] == c and i["status"] == "open"), None)
            x = next((i for i in data["items"].values() if i["type"] == "kanji_extras" and i["subject"] == c and i["status"] == "open"), None)
            ety = {k: ((x or {}).get("proposed") or {}).get(k) for k in ORIGIN}
            ety["original"] = [g["id"] for g in (s or {}).get("proposed") or [] if g.get("original")]
            # On the meanings item, where the loader puts it; on the extras item if there is none.
            home = s or x
            review._update(data, home, evidence={**(home.get("evidence") or {}), "etymology": ety})
            if s:
                s = data["items"][s["id"]]
                review._update(data, s, proposed=review.validate("kanji_senses", c, s["proposed"], data, pending_ok=True, machine=True))
            if x and x["proposed"] is not None:
                x = data["items"][x["id"]]
                review._update(data, x, proposed=review.validate("kanji_extras", c, x["proposed"], data, machine=True))
    print(f"moved {len(todo)} kanji")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
