"""Which spellings and readings of a word JMdict marks as common (2026-10-25).

    python pipeline/form_pri.py [path/to/betterrtk.sqlite]

build_db's dict stage now writes word_form.pri (the form has a ke_pri/re_pri:
ichi1, news1, nf..). This adds and fills the column in a database built
before that, without rebuilding the dict stage (prod's database is a copy
with tables of its own). The word page greys a form without it where another
of the same kind has it: 消耗 is read しょうもう (ichi1, news1), JMdict gives
しょうこう no tag at all, so nothing else said it is the less used one (D-038).
"""

from __future__ import annotations

import gzip
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "betterrtk.sqlite"


def _common_forms() -> set[tuple[int, str, int]]:
    raw = gzip.open(ROOT / "pipeline" / "data" / "JMdict_e.gz", "rt", encoding="utf-8").read()
    raw = re.sub(r"<!DOCTYPE[^\[]*\[.*?\]>", "", raw, flags=re.S)
    raw = re.sub(r"&([\w-]+);", r"\1", raw)
    out: set[tuple[int, str, int]] = set()
    for entry in ET.fromstring(raw).iter("entry"):
        wid = int(entry.findtext("ent_seq"))
        for kana, el_tag, text_tag, pri_tag in ((0, "k_ele", "keb", "ke_pri"), (1, "r_ele", "reb", "re_pri")):
            for el in entry.findall(el_tag):
                if el.findall(pri_tag):
                    out.add((wid, el.findtext(text_tag), kana))
    return out


def main() -> None:
    db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else DB)
    cols = {r[1] for r in db.execute("PRAGMA table_info(word_form)")}
    if "pri" not in cols:
        db.execute("ALTER TABLE word_form ADD COLUMN pri INTEGER NOT NULL DEFAULT 0")
    common = _common_forms()
    db.execute("UPDATE word_form SET pri = 0")
    db.executemany("UPDATE word_form SET pri = 1 WHERE word_id = ? AND text = ? AND kana = ?", sorted(common))
    db.commit()
    n = db.execute("SELECT count(*) FROM word_form WHERE pri = 1").fetchone()[0]
    print(f"{len(common):,} common forms in JMdict, {n:,} marked")


if __name__ == "__main__":
    main()
