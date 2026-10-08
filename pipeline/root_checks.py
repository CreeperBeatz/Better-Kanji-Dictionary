"""Queue a check of every character that lists a form of itself, or its own root, as a part.

    python pipeline/root_checks.py [--load] [--review-dir DIR]

Why (Dani, 2026-10-08): the graph is what is made from what. A form of
another kanji is that kanji written for its place (⺮ is 竹 on top); it is
not built from it, so it has no parts of its own, and the "is a form of"
link, with the root marked, carries the relation. Five characters break this:
a form with its root as its part (⺮ 竹, ⺤ 爪, 龵 手), and a root whose only part
is one of its own forms (手 扌, 生 龶). 龰 has its card already.

Each gets a parts check, and a form gets a check of its link beside it, so
the card asks the root first and closes the parts with it. Nothing changes
until a reviewer answers. Without --load it only lists them.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
import review_sources as rs  # noqa: E402
from proposals import review  # noqa: E402

from server import forms  # noqa: E402
from server import scope as review_scope  # noqa: E402

CHECK = "root-check"


def rows() -> list[dict]:
    db = proposals.connect()
    children, _ = rs.graph(db)
    roots = forms.roots()
    data = review._read()
    open_parts = {i["subject"] for i in data["items"].values() if i["type"] == "decomposition" and i["status"] == "open"}
    open_links = {frozenset(i["subject"].split("|")) for i in data["items"].values() if i["type"] == "form_link" and i["status"] == "open"}
    out = []
    for x in sorted(rs.closure(children, review_scope.kanji(db))):
        parts = children.get(x, [])
        # A form with its root among its parts, or a root whose only part is one of its own forms
        # (老 is 耂 and 匕: built from its top and more, which is fine).
        own = [p for p in parts if roots.get(x) == p or (roots.get(p) == x and len(parts) == 1)]
        if not own:
            continue
        users = len(review.users_of(x))
        p = own[0]
        if roots.get(x) == p:
            why = f"check: {x} is a form of {p}, yet has {p} as its part; a form has no parts of its own"
            link = f"{x}|{p}"
        else:
            why = f"check: {x} has the part {p}, which is a form of {x} itself"
            link = f"{p}|{x}"
        if x not in open_parts:
            out.append({"type": "decomposition", "subject": x, "proposed": None, "source": CHECK, "reason": why,
                        "priority": round(min(users, 50) / 10, 2)})
        if frozenset(link.split("|")) not in open_links:
            out.append({"type": "form_link", "subject": link, "proposed": None, "source": CHECK,
                        "reason": "check: mark which of the two is the root", "priority": round(min(users, 50) / 10, 2)})
        print(f"  {x}  parts {''.join(parts)}  in {users:>3} kanji   {why[7:]}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--load", action="store_true", help="put them in the queue (default: only list them)")
    ap.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.load:
        proposals.use_review_dir(args.review_dir)
    r = rows()
    print(f"{len(r)} checks")
    if args.load:
        added, refused = review.add_items(r)
        print(f"loaded: {added} added, {refused} refused")
    else:
        print("nothing written; --load puts them in the queue")
    return 0


if __name__ == "__main__":
    sys.exit(main())
