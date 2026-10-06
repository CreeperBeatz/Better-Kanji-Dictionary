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

import json
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


_entries: tuple[float, dict[int, dict], dict[str, dict]] | None = None


def kanji_entry(no: int | None = None, char: str | None = None) -> dict | None:
    """One entry of the kanji book, as transcribed: a kanji by its number, a
    grapheme (which has none) by its character. Read again when the file changes,
    so a corrected transcription shows without a restart."""
    global _entries
    f = books_dir() / "kanji" / "kanji.jsonl"
    if not f.is_file():
        return None
    stamp = f.stat().st_mtime
    if _entries is None or _entries[0] != stamp:
        by_no, by_char = {}, {}
        for line in f.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            if e.get("type") == "kanji" and isinstance(e.get("no"), int):
                by_no[e["no"]] = e
            elif e.get("type") == "grapheme" and e.get("char"):
                by_char.setdefault(e["char"], e)
        _entries = (stamp, by_no, by_char)
    _, by_no, by_char = _entries
    return by_no.get(no) if no is not None else by_char.get(char or "")
