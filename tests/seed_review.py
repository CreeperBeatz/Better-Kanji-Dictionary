"""A few proposals of each kind, for trying the review screen in the sandbox.

    python tests/seed_review.py --dir <sandbox dir>

Writes only into the sandbox's review state (tests/sandbox.py --dir); the
running sandbox picks the items up on its next read.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from harness import use_sandbox

from server import review
from server.db import query


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    use_sandbox(Path(ap.parse_args().dir))

    review.add_item("form_link", "罒|四", {"kind": "looks_like", "note": "looks like 四; it is 网, a net"},
                    "ai:sample", reason="learners often read it as four", priority=2)
    senses = [
        {"id": "life", "en": "life, birth", "bg": "живот, раждане"},
        {"id": "raw", "en": "raw, fresh", "bg": "суров, свеж"},
        {"id": "student", "en": "student", "bg": "ученик"},
    ]
    review.add_item("kanji_senses", "生", senses, "ai:sample", reason="drafted from 40 common words", priority=3)
    picks = {"生活": "生.life", "生まれる": "生.life", "先生": "生.life", "学生": "生.student", "生野菜": "生.raw", "生憎": "catch-all"}
    for word, sense in picks.items():
        rows = query("SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id WHERE wc.char = '生' AND w.headword = ?", (word,))
        if rows:
            review.add_item("word_sense", f"生|{rows[0]['id']}", sense, "ai:sample", evidence={"confidence": 0.8}, priority=1)
    print(review.counts())


if __name__ == "__main__":
    main()
