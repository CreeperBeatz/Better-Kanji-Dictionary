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

BOOKS = ("kanji", "bg-ja", "kodansha", "kangorin")

# The books kept as a PDF (server/dictionaries.py), by PDF page: rendered when first asked for,
# then kept beside the transcription like the other books' page images.
PDFS = {"kodansha": ("source/kodansha-kanji.pdf",), "kangorin": ("source/shin-kangorin.pdf",)}
PDF_ZOOM = {"kodansha": 2.0, "kangorin": 1.6}


def books_dir() -> Path:
    """Where the transcription project is: BETTERRTK_BOOKS_DIR, else beside this repo."""
    return Path(os.environ.get("BETTERRTK_BOOKS_DIR") or ROOT.parent / "JapaneseDictionaries")


def page_file(book: str, page: int) -> Path | None:
    """One page's image (a printed page; for a PDF book, a PDF page), or None when it is not here."""
    if book not in BOOKS or not 1 <= page <= 9999:
        return None
    f = books_dir() / book / "pages" / f"p{page:04d}.png"
    if f.is_file():
        return f
    return _render(book, page, f) if book in PDFS else None


def _render(book: str, page: int, to: Path) -> Path | None:
    """A PDF book's page as an image, made once. Needs PyMuPDF, which only a server with the books has."""
    pdf = next((p for pattern in PDFS[book] for p in sorted(books_dir().glob(pattern))), None)
    if pdf is None:
        return None
    try:
        import pymupdf
    except ImportError:
        return None
    with pymupdf.open(pdf) as doc:
        if page > doc.page_count:
            return None
        pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(PDF_ZOOM[book], PDF_ZOOM[book]))
        to.parent.mkdir(parents=True, exist_ok=True)
        pix.save(str(to))
    return to


_entries: tuple[float, dict[int, dict], dict[str, dict], dict[str, dict]] | None = None


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
        by_no, by_char, by_kanji = {}, {}, {}
        for line in f.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            if e.get("type") == "kanji" and isinstance(e.get("no"), int):
                by_no[e["no"]] = e
                if e.get("kanji"):
                    by_kanji.setdefault(e["kanji"], e)
            elif e.get("type") == "grapheme" and e.get("char"):
                by_char.setdefault(e["char"], e)
        _entries = (stamp, by_no, by_char, by_kanji)
    _, by_no, by_char, _ = _entries
    return by_no.get(no) if no is not None else by_char.get(char or "")


def kanji_ref(char: str) -> dict | None:
    """Where the kanji book has `char` -- as a kanji, else as a grapheme -- for a
    card to draw the entry whatever the book says about its parts; None when it hasn't."""
    kanji_entry(None, None)  # reads the file, or notices it changed
    if _entries is None:
        return None
    _, _, by_char, by_kanji = _entries
    e = by_kanji.get(char) or by_char.get(char)
    if e is None:
        return None
    return {"book": "kanji", "no": e.get("no"), "char": e.get("kanji") or e.get("char"), "pages": e.get("pages") or []}
