"""Queue a check of every built form link nobody has reviewed.

    python pipeline/form_checks.py [--dry-run] [--review-dir DIR]

Why (2026-10-06 data review): the 471 links pipeline/forms.py builds (char_form)
went live without a person looking at them; the queue only held new
proposals. A "form of" lends its meaning to every kanji with the part, so a
wrong one misleads on many pages.

- The **old forms** are not checked: they come from an official list (Unihan
  kJapaneseOldVariant, which matches the old forms the Jōyō Kanji Table
  prints in brackets), so there is nothing for a person to verify (Dani,
  2026-10-06). The card shows them as information; a reviewer who doubts one
  files a report.
- **Every other link** (a form for a position, "form of", "looks like", "the
  same thing") was written by hand in pipeline/forms.py: a check on its
  character's card, with nothing proposed; the reviewer says whether it stays.

A pair with a link already waiting is left alone; running it again adds nothing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from proposals import review  # noqa: E402

CHECK = "form-check"


def rows() -> list[dict]:
    db = proposals.connect()
    data = review._read()
    waiting = {frozenset(i["subject"].split("|")) for i in data["items"].values()
               if i["type"] == "form_link" and i["status"] == "open"}
    decided = {frozenset(i["subject"].split("|")) for i in data["items"].values()
               if i["type"] == "form_link" and i["status"] not in ("open", "withdrawn")}
    out, seen = [], set()
    for char, other, kind, source in db.execute(
            "SELECT char, other, kind, source FROM char_form WHERE kind != 'old' ORDER BY char, other"):
        pair = frozenset((char, other))
        if pair in seen or pair in waiting or pair in decided:
            continue
        seen.add(pair)
        users = len(review.users_of(char))
        out.append({
            "type": "form_link", "subject": f"{char}|{other}", "proposed": None, "source": CHECK,
            "reason": f"check: a built link nobody has reviewed ({source or 'pipeline/forms.py'})",
            "priority": round(min(users, 300) / 30, 2),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    proposals.use_review_dir(args.review_dir)
    rs = rows()
    print(f"{len(rs)} links to check, on character cards")
    if not args.dry_run:
        print("added %d, refused %d" % review.add_items(rs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
