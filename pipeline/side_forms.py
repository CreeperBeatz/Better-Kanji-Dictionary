"""Write a root kanji as its side form in the open parts proposals and drafts.

    python pipeline/side_forms.py [--apply] [--review-dir DIR]

Why (2026-10-08 labeling): the sources and the drafts write a part as its
kanji -- 糸, 竹, 人 -- where the graph builds the character with the side form,
糹, ⺮, 亻. Accepting such a proposal moved 織 off the 糹 that 280 other kanji
use. New proposals are put right when they are loaded (server/review.py
side_forms, for every machine value); this puts right the ones already
waiting, and the drafts on their cards. Without --apply it only lists them.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from server import review  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="change them (default: only list them)")
    ap.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.review_dir:
        review.use_dir(args.review_dir)
    with review._change() as data:
        n = 0
        for i in list(data["items"].values()):
            if i["type"] != "decomposition" or i["status"] != "open":
                continue
            fields = {}
            if isinstance(i["proposed"], list) and (new := review.side_forms(i["subject"], i["proposed"])) != i["proposed"]:
                fields["proposed"] = new
            draft = (i.get("evidence") or {}).get("draft")
            if draft and draft.get("parts") and (new := review.side_forms(i["subject"], draft["parts"])) != draft["parts"]:
                fields["evidence"] = {**i["evidence"], "draft": {**draft, "parts": new}}
            if not fields:
                continue
            n += 1
            was = "".join(i["proposed"] or []) + " / draft " + "".join((draft or {}).get("parts") or [])
            now = "".join(fields.get("proposed", i["proposed"]) or []) + " / draft " + "".join(fields.get("evidence", i.get("evidence") or {}).get("draft", {}).get("parts") or [])
            print(f"  {i['subject']}  {was}  ->  {now}")
            if args.apply:
                review._update(data, i, **fields)
        print(f"{n} items {'changed' if args.apply else 'to change; --apply changes them'}")
        if not args.apply:
            raise SystemExit(0)  # nothing written: the change is rolled back
    return 0


if __name__ == "__main__":
    sys.exit(main())
