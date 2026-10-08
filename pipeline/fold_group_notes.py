"""Fold the meaning groups' notes into their about lines (Dani, 2026-10-08).

    python pipeline/fold_group_notes.py [--review-dir D] [--dry-run]

A group had two lines of text: a short note, from the first drafts, and its
`about` (what the kanji does in the group's words). They said the same
thing, so a group now has only the about line; server/review.py no longer
keeps a note. Most notes only repeated their about line and are dropped.
Those that told a fact the about line does not are added to it, in English
and in Bulgarian (ADD). Only open meanings cards change: a decided one
keeps what was decided.

Run it again after reloading the meanings drafts (data/drafts still has the
notes). The review store is copied to your home folder first.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from server import review  # noqa: E402

# Group id -> the sentence its note adds to the about line, English and Bulgarian.
ADD = {
    "米.america": ("It comes from 亜米利加, an old way to write America.", "Идва от 亜米利加, стар начин да се пише Америка."),
    "件.condition": ("It is used in 条件 and the words made from it.", "Използва се в 条件 и в думите, образувани от него."),
    "掛.toward": ("It is mostly the ending -かける of verbs.", "Най-често е окончанието -かける на глаголи."),
    "減.adjust": ("An example is 加減.", "Пример: 加減."),
    "極.decide": ("These words are usually written with 決 (決める).", "Тези думи обикновено се пишат с 決 (決める)."),
    "里.league": ("One ri is about 3.9 km.", "Едно ри е около 3,9 км."),
    "覆.repeat": ("In these words it is usually written 復.", "В тези думи обикновено се пише 復."),
    "冨.rich": ("It is used mostly in names.", "Използва се главно в имена."),
    "芥.rubbish": ("It also means mustard, as in 芥子.", "Значи и синап, както в 芥子."),
    "俺.i": ("It is casual, mostly male speech.", "Разговорно е, говорят го главно мъже."),
    "竪.vertical": ("Today these words are usually written with 縦 or 立て.", "Днес тези думи обикновено се пишат с 縦 или 立て."),
}


def folded(groups: list[dict]) -> list[dict]:
    out = []
    for g in groups:
        g = {k: v for k, v in g.items() if k not in ("note", "noteBg")}
        if g["id"] in ADD:
            en, bg = ADD[g["id"]]
            if en not in (g.get("about") or ""):
                g["about"] = f"{g.get('about') or ''} {en}".strip()
                if g.get("aboutBg"):
                    g["aboutBg"] = f"{g['aboutBg']} {bg}"
        out.append(g)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--review-dir", type=Path, help="another review folder (a sandbox's)")
    ap.add_argument("--dry-run", action="store_true", help="only count")
    args = ap.parse_args()
    if args.review_dir:
        review.use_dir(args.review_dir)

    data = review._read()
    todo = [i for i in data["items"].values()
            if i["type"] == "kanji_senses" and i["status"] == "open"
            and any("note" in g or "noteBg" in g for g in i["proposed"] or [])]
    notes = sum(1 for i in todo for g in i["proposed"] if g.get("note") or g.get("noteBg"))
    found = {g["id"] for i in todo for g in i["proposed"] if g["id"] in ADD}
    print(f"{len(todo)} open meanings cards carry a note field; {notes} notes, {len(found)} of them added to the about line")
    if missing := sorted(set(ADD) - found):
        print("not found (already folded, or no longer open):", " ".join(missing))
    if args.dry_run or not todo:
        return 0

    if not args.review_dir:
        dest = Path.home() / f"betterrtk-review-pre-notes-{datetime.now():%Y%m%d-%H%M}.db"
        review.backup(dest)
        print(f"backed up to {dest}")
    with review._change() as data:
        for i in todo:
            item = data["items"][i["id"]]
            value = review.validate("kanji_senses", item["subject"], folded(item["proposed"]), data, pending_ok=True, machine=True)
            review._update(data, item, proposed=value)
    print(f"folded {len(todo)} cards")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
