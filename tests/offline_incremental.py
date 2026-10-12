"""Does a change to the kanji pages alone rebuild only pages.json?

    python tests/offline_incremental.py

Builds into a temporary directory, with the review store's key made up: a whole
pack, then one whose key differs in the pages' part only (the other files must be
the last pack's, linked, and the pages built again), and one whose other part
differs too (all built again).
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import offline, review  # noqa: E402

failed = 0


def check(what: str, ok: bool, detail=None) -> None:
    global failed
    print(f"{'ok  ' if ok else 'FAIL'} {what}" + ("" if ok or detail is None else f": {detail}"))
    failed += not ok


def main() -> int:
    review.load_bg_overlay()
    out = Path(tempfile.mkdtemp(prefix="bkd-pack-"))
    offline.OUT, offline.CURRENT = out, out / "current.json"
    key = ["aaaa.1111"]
    review._pack_data_key = lambda: key[0]
    try:
        check("an old key, without the pages' part, is not pages only", not offline._pages_only("6|1:2|-|abc", "6|1:2|-|abd"))

        whole = offline.build(fresh=True)
        print(f"     whole pack in {whole['seconds']} s")
        check("the same key again builds nothing", offline.build(fresh=True)["version"] == whole["version"])

        key[0] = "aaaa.2222"
        same = offline.build(fresh=True)
        print(f"     pages only in {same['seconds']} s")
        check("pages only: much quicker than the whole", same["seconds"] < whole["seconds"] / 2, (same["seconds"], whole["seconds"]))
        check("pages that came out the same: the same pack", same["version"] == whole["version"] and same["key"] != whole["key"])

        # A page changes: what a reviewed meaning does.
        real = offline._pages
        offline._pages = lambda conn: {**real(conn), "上": {"char": "上", "link": "changed"}}
        key[0] = "aaaa.3333"
        try:
            changed = offline.build(fresh=True)
        finally:
            offline._pages = real
        old = {f["name"]: f for f in whole["files"]}
        new = {f["name"]: f for f in changed["files"]}
        check("a changed page: a new version", changed["version"] != whole["version"])
        check("the same files, listed", sorted(old) == sorted(new))
        moved = [n for n in new if new[n] != old[n]]
        check("only pages.json differs", moved == ["pages.json"], moved)
        linked = [n for n in new if n != "pages.json"
                  and os.path.samefile(out / whole["version"] / f"{n}.gz", out / changed["version"] / f"{n}.gz")]
        check("the rest are the last pack's files, linked", len(linked) == len(new) - 1, len(linked))
        check("the pack before stays for phones halfway through it", (out / whole["version"]).is_dir())

        key[0] = "bbbb.3333"
        again = offline.build(fresh=True)
        check("anything else changed: the whole pack again", again["seconds"] > same["seconds"] * 2, again["seconds"])
        check("whole again, with the first pack's pages: the first pack", again["version"] == whole["version"])
    finally:
        shutil.rmtree(out, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
