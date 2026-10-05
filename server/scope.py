"""What review covers (Dani, 2026-10-05): everything common or rated.

A kanji is in scope with a JLPT level, as jōyō, or with a KANJIDIC newspaper
rank; a word, when JMdict marks it common, gives it a newspaper rank, or a
JLPT list has it. Only what is none of these is left out. Every stage --
parts, forms, meanings, word placements, Bulgarian -- and the progress count
select by this, not by JLPT N5-N2 (that is only the study order's target).
"""

from __future__ import annotations

import sqlite3

# SQL conditions, over `kanji k` and `word w`.
KANJI = "(k.jlpt IS NOT NULL OR k.joyo = 1 OR k.freq IS NOT NULL)"
WORDS = "(w.common = 1 OR w.nf IS NOT NULL OR w.id IN (SELECT word_id FROM word_jlpt))"


def kanji(db: sqlite3.Connection) -> list[str]:
    """Every kanji in scope, most frequent first."""
    return [r[0] for r in db.execute(f"SELECT k.char FROM kanji k WHERE {KANJI} ORDER BY k.freq IS NULL, k.freq, k.char")]
