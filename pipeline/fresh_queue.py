"""Start the review over: every card back in the queue, nothing decided.

    python pipeline/fresh_queue.py [--review-dir D] [--dry-run]

Dani, 2026-10-06: before going to production, start clean. Every item ever
loaded comes back open: the decisions, the live overlay and the reviewed
decompositions in the associations store are dropped. A proposal the
mechanical rule accepted (IDS and KanjiVG agree, no new edge) is accepted
by it again, as it would be on a first load.

Not brought back: withdrawn proposals (their source no longer makes them),
the follow-ups a meanings card made for words left for later (their words
are back on the kanji's own card), reopened word items (likewise) and
people's suggestions.

Stop the server first: it keeps the store's overrides and the Bulgarian
overlay in memory. Both stores are copied to your home folder before
anything changes.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from server import review, store  # noqa: E402

DROP_SOURCES = ("skipped:", "reopened")
RESET = {"status": "open", "decided_by": None, "decided_at": None, "decision": None, "skipped_by": []}


def kept(item: dict) -> bool:
    return (
        item["status"] != "withdrawn"
        and item["origin"] == "proposal"
        and not str(item["source"]).startswith(DROP_SOURCES)
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--review-dir", type=Path, help="another review folder (a sandbox's)")
    ap.add_argument("--dry-run", action="store_true", help="only count")
    args = ap.parse_args()
    if args.review_dir:
        if store.ASSOC_DIR.resolve() == (ROOT / "data" / "associations").resolve():
            raise SystemExit("--review-dir with the real associations store: point the store elsewhere first")
        review.use_dir(args.review_dir)

    data = review._read()
    items = [i for i in data["items"].values() if kept(i)]
    auto = [i["id"] for i in items if i["status"] == "auto-accepted"]
    overrides = store.decomposition_overrides()
    print(f"items {len(data['items'])}: keeping {len(items)}, of which {sum(i['status'] != 'open' for i in items)} reopen;"
          f" {len(auto)} auto-accepted again")
    print(f"decisions dropped {len(data['decisions'])}, live entries {sum(len(v) for v in data['live'].values())},"
          f" store decompositions {len(overrides)}")
    if args.dry_run:
        return 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    home = Path.home()
    review.backup(home / f"betterrtk-review-pre-fresh-{stamp}.db")
    shutil.copy2(store.ASSOC_DIR / "store.json", home / f"betterrtk-store-pre-fresh-{stamp}.json")
    print(f"backed up to ~/betterrtk-review-pre-fresh-{stamp}.db and ~/betterrtk-store-pre-fresh-{stamp}.json")

    # A new file beside the old one, then swapped in: nothing half-written is ever the store.
    new = review.DB.with_suffix(".db.new")
    new.unlink(missing_ok=True)
    conn = sqlite3.connect(new)
    conn.executescript(review.SCHEMA)
    conn.executemany(
        "INSERT INTO item (id, type, subject, status, body) VALUES (?, ?, ?, 'open', ?)",
        [(i["id"], i["type"], i["subject"], review._dump({**i, **RESET})) for i in items],
    )
    conn.commit()
    conn.close()

    review.use_dir(review.REVIEW_DIR)  # closes the connection to the old file
    for suffix in ("", "-wal", "-shm"):
        Path(f"{review.DB}{suffix}").unlink(missing_ok=True)
    new.replace(review.DB)
    for char in list(overrides):
        store.clear_decomposition(char)

    for item_id in auto:
        review.auto_accept(item_id, "IDS and KanjiVG agree; no new containment edge")
    c = review.counts()
    print("now:", {t: v for t, v in c["items"].items()}, "decisions", c["decisions"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
