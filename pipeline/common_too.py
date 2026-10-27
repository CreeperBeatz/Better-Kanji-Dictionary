"""Entries we take as common though JMdict does not mark them (build_db.COMMON_TOO, D-039).

    python pipeline/common_too.py [path/to/betterrtk.sqlite]

build_db's dict stage now sets word.common for them. This sets it in a database
built before that, without rebuilding the dict stage (prod's database is a copy
with tables of its own). Their Bulgarian is in pipeline/translate/out/words-s005.json
(the bg stage), and `python -m server.review load-bg` queues their cards.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from build_db import COMMON_TOO  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "betterrtk.sqlite"


def main() -> None:
    db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else DB)
    ids = sorted(COMMON_TOO)
    db.executemany("UPDATE word SET common = 1 WHERE id = ?", [(w,) for w in ids])
    db.commit()
    for wid, head, reading, common in db.execute(
            f"SELECT id, headword, reading, common FROM word WHERE id IN ({','.join('?' * len(ids))})", ids):
        print(f"  {wid} {head} {reading}: common {common}")


if __name__ == "__main__":
    main()
