"""Dani's two print dictionaries, as evidence in the review queue.

Цалта's kanji book and Иванов's Bulgarian-Japanese dictionary were
transcribed to JSON in a separate local project (Documents/JapaneseDictionaries).
pipeline/book_sources.py reads that JSON and puts what the books say into
review items' evidence, under `book`. The page scans themselves may not be
shared, so they never enter this repo, the offline pack or any build: the
server reads them from that folder, for reviewers and the admin only, and a
server without the folder (the Pi) just has no pictures.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).parent.parent

BOOKS = ("kanji", "bg-ja")


def books_dir() -> Path:
    """Where the transcription project is: BETTERRTK_BOOKS_DIR, else beside this repo."""
    return Path(os.environ.get("BETTERRTK_BOOKS_DIR") or ROOT.parent / "JapaneseDictionaries")


def page_file(book: str, page: int) -> Path | None:
    """One printed page's scan, or None when it is not here."""
    if book not in BOOKS or not 1 <= page <= 9999:
        return None
    f = books_dir() / book / "pages" / f"p{page:04d}.png"
    return f if f.is_file() else None
