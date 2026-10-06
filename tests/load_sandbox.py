"""Fill a sandbox's review queue with every drafted proposal, for trying the review screen.

    python tests/load_sandbox.py --dir <sandbox dir>
    python tests/sandbox.py --dir <sandbox dir>

Loads, into the sandbox only, what Part 6 and the subagent drafts would put
in the real queue: IDS / KanjiVG decomposition proposals (the three that
pass the §6 rule are auto-accepted), cost-ranked checks, old-form links, the
drafted form links, every kanji's meaning groups and word placements, and
what the print dictionaries say (pipeline/book_sources.py), when they are here.
The real data/review and data/associations are not touched.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from harness import ROOT, use_sandbox

sys.path.insert(0, str(ROOT / "pipeline"))

from server import review  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    tmp = Path(ap.parse_args().dir)
    tmp.mkdir(parents=True, exist_ok=True)
    use_sandbox(tmp, copy_notes=True)
    review._schedule_pack = lambda: None  # no offline pack rebuilds from a loader

    import form_drafts
    import meaning_drafts
    import review_sources

    print("== decompositions, checks, old-form links")
    review_sources.load(None)
    print("== drafted form links")
    form_drafts.load(False, None)
    print("== meaning groups and word placements")
    meaning_drafts.load(False, None)
    from server import books

    if (books.books_dir() / "kanji" / "kanji.jsonl").exists():
        # The books' view goes on the part-meaning and Bulgarian cards, so those come first.
        import part_drafts

        print("== part meanings")
        part_drafts.load(False, None)
        print("== Bulgarian cards")
        print(review.load_bg())
        import book_sources

        print("== the print dictionaries, beside all of that")
        book_sources.load(None)
    print("queue:", review.counts()["items"])


if __name__ == "__main__":
    main()
