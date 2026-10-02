"""What the kanji page's font strip needs to know about its four fonts.

    python pipeline/fetch_sources.py font-mincho font-gothic font-textbook font-brush
    python pipeline/build_db.py fonts

The strip shows a character in print (mincho, gothic) and in handwriting
shapes (a textbook face, a brush face) side by side. Two things cannot be
found out in the browser, so the `fonts` stage works them out:

- **Coverage** (`font_cover`). A font without the character would silently
  fall back to another one and show a lie under its label, so the strip only
  shows the faces that really have it.

- **Old JIS shapes** (`font_old`). Some fonts carry the glyphs of older JIS
  standards behind an OpenType feature: Shippori Mincho and Klee One `jp78`
  and `jp83`, Yuji Syuku `jp78` and `jp90`. 葛 辻 遡 謎 drawn the way 1978,
  1983 or 1990 printing drew them. They share a code point with today's
  shape, so only the font can show them, and a subset font keeping the
  feature is hundreds of KB. Instead both outlines -- today's and the old
  one -- are stored as SVG paths, only where they differ, and a page fetches
  the few hundred bytes for its own character.

Needs fonttools (`pip install fonttools`); a build-time tool, not a server dependency.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

FONTS = Path(__file__).parent / "data" / "fonts"

# key -> file. The keys are what web/src/detail/FontStrip.tsx names them.
FACES = {
    "mincho": "ShipporiMincho-Regular.ttf",
    "gothic": "ZenKakuGothicNew-Regular.ttf",
    "textbook": "KleeOne-Regular.ttf",
    "brush": "YujiSyuku-Regular.ttf",
}
# The older-standard features worth showing, oldest first.
OLD_FEATURES = ("jp78", "jp83", "jp90")


def missing() -> list[str]:
    return [f for f in FACES.values() if not (FONTS / f).exists()]


def _single_subs(font, feature: str) -> dict[str, str]:
    """glyph -> glyph for the feature's single substitutions (type 1, or type 7 wrapping it)."""
    if "GSUB" not in font:
        return {}
    table = font["GSUB"].table
    lookups: set[int] = set()
    for rec in table.FeatureList.FeatureRecord:
        if rec.FeatureTag == feature:
            lookups.update(rec.Feature.LookupListIndex)
    out: dict[str, str] = {}
    for i in sorted(lookups):
        lookup = table.LookupList.Lookup[i]
        for st in lookup.SubTable:
            if lookup.LookupType == 7:
                if st.ExtensionLookupType != 1:
                    continue
                st = st.ExtSubTable
            elif lookup.LookupType != 1:
                continue
            out.update(st.mapping)
    return out


def _path(glyphs, name: str, top: int) -> str:
    """The glyph's outline as SVG path data, y pointing down from the em box's top."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen

    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.0f}")
    glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, top)))
    return pen.getCommands()


def build(db: sqlite3.Connection) -> None:
    from fontTools.ttLib import TTFont

    if missing():
        raise SystemExit(f"missing {missing()}; run pipeline/fetch_sources.py font-mincho font-gothic font-textbook font-brush")
    chars = [r[0] for r in db.execute("SELECT char FROM kanji")]
    db.executescript("""
        DROP TABLE IF EXISTS font_cover;
        DROP TABLE IF EXISTS font_old;
        CREATE TABLE font_cover (
            char  TEXT PRIMARY KEY,
            faces TEXT NOT NULL      -- space-separated keys of the faces that have it
        );
        CREATE TABLE font_old (
            char    TEXT NOT NULL,
            face    TEXT NOT NULL,   -- mincho | gothic | textbook | brush
            feature TEXT NOT NULL,   -- jp78 | jp83 | jp90
            em      INTEGER NOT NULL, -- units per em: the paths' viewBox is 0 0 em em
            now     TEXT NOT NULL,   -- today's shape, SVG path data
            old     TEXT NOT NULL,   -- the feature's shape
            PRIMARY KEY (char, face, feature)
        );
    """)
    cover: dict[str, list[str]] = {c: [] for c in chars}
    old_rows = []
    for key, filename in FACES.items():
        font = TTFont(FONTS / filename)
        cmap = font.getBestCmap()
        glyphs = font.getGlyphSet()
        em = font["head"].unitsPerEm
        # The ideographic em box sits on the typo metrics in these fonts (880 / -120 of 1000).
        top = font["OS/2"].sTypoAscender
        for c in chars:
            if ord(c) in cmap:
                cover[c].append(key)
        for feature in OLD_FEATURES:
            subs = _single_subs(font, feature)
            n = 0
            for c in chars:
                base = cmap.get(ord(c))
                if base is None or base not in subs:
                    continue
                now, then = _path(glyphs, base, top), _path(glyphs, subs[base], top)
                if now != then:
                    old_rows.append((c, key, feature, em, now, then))
                    n += 1
            if n:
                print(f"  {key:9} {feature}  {n:>5} characters drawn differently")
        print(f"  {key:9} has   {sum(1 for c in chars if key in cover[c]):>6,} of {len(chars):,} characters")
    db.executemany("INSERT INTO font_cover VALUES (?,?)", [(c, " ".join(f)) for c, f in cover.items() if f])
    db.executemany("INSERT INTO font_old VALUES (?,?,?,?,?,?)", old_rows)
    print(f"  old shapes    {len(old_rows):>7,} rows over {len({r[0] for r in old_rows}):,} characters")
