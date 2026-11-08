"""What the kanji page's font strip needs to know about its fonts.

    python pipeline/fetch_sources.py font-mincho font-textbook
    python pipeline/build_db.py fonts

The strip shows a character in print (mincho) and in the textbook face
schools teach handwriting from. Two things cannot be found out in the
browser, so the `fonts` stage
works them out:

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

  Unicode keeps more old printed shapes as *compatibility ideographs*: 館
  (U+FA2C) is 館 with the old 食 radical, 神 礼 福 the old 示, 都 諸 the
  dotted 者. Each is the same character as its base -- Unicode
  normalization turns one into the other -- so it gets no page, and text is
  no safe way to show it: normalizing or a phone's own font draws today's
  shape instead. Where the mincho draws one differently from its base it is
  stored the same way, as feature `compat` -- only ideographs with a Japanese
  source (Unihan kIRG_JSource). The Korean (F900-) and Taiwanese (2F800-)
  duplicates are regional designs, not old Japanese printing: 更 契 冬 再, and
  練 would have shown the Korean F996 instead of its own old form 練 (FA57).

  Some old printed shapes have no code point at all, only an ideographic
  variation sequence, which only a font with Adobe-Japan1 IVS draws -- not
  Shippori. `IVS_OLD` lists the ones taken from Noto Serif JP (at weight 400)
  as feature `ivs`: kanji of the well-defined families whose shape nothing else
  shows, ⻌ with two dots (道 通), 𩙿 (飾 飯), 靑 (情 請). Each was picked by eye
  (2026-11-03); where the font has several variants, the one differing least
  outside the family's part.

Needs fonttools (`pip install fonttools`); a build-time tool, not a server dependency.
"""

from __future__ import annotations

import sqlite3
import unicodedata
from pathlib import Path

FONTS = Path(__file__).parent / "data" / "fonts"

# key -> file. The keys are what web/src/detail/FontStrip.tsx names them.
FACES = {
    "mincho": "ShipporiMincho-Regular.ttf",
    "textbook": "KleeOne-Regular.ttf",
}
# The older-standard features worth showing, oldest first.
OLD_FEATURES = ("jp78", "jp83", "jp90")
# The face whose compatibility ideographs are old printed shapes worth showing.
COMPAT_FACE = "mincho"
UNIHAN = Path(__file__).parent / "data" / "Unihan.zip"

# Old printed shapes that are only a variation sequence: kanji -> selector, in
# Noto Serif JP. Stored under the mincho face, the strip's print face.
IVS_FONT = Path(__file__).parent / "data" / "NotoSerifJP.ttf"
IVS_OLD: dict[str, int] = {
    **{c: 0xE0101 for c in
       "選通進近道運過送述追退造達週速迎遺遣適込逆返途避逮迫遠還遊迷透巡遇遭遍迅迭逐遵"  # ⻌ two dots
       "導縫"  # ⻌ inside, not the radical
       "食養飾飢餓飽"  # 𩙿
       "情請"},  # 靑
    "連": 0xE0100,
    "遷": 0xE0102,  # all three variants have the two dots; this one changes least besides
}


def _japanese_sourced() -> set[str]:
    """Characters Unihan gives a Japanese source (kIRG_JSource)."""
    import zipfile

    with zipfile.ZipFile(UNIHAN) as z:
        text = z.read("Unihan_IRGSources.txt").decode("utf-8")
    return {chr(int(line.split("\t")[0][2:], 16)) for line in text.splitlines() if "\tkIRG_JSource\t" in line}


def compat_shapes() -> dict[str, list[str]]:
    """base character -> the Japanese-sourced compatibility ideographs that are it (館 -> 館)."""
    japanese = _japanese_sourced()
    out: dict[str, list[str]] = {}
    for cp in [*range(0xF900, 0xFB00), *range(0x2F800, 0x2FA20)]:
        d = unicodedata.decomposition(chr(cp))
        if d and " " not in d and not d.startswith("<") and chr(cp) in japanese:
            out.setdefault(chr(int(d, 16)), []).append(chr(cp))
    return out


def missing() -> list[str]:
    return [f for f in FACES.values() if not (FONTS / f).exists()] + [p.name for p in (IVS_FONT, UNIHAN) if not p.exists()]


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
        raise SystemExit(f"missing {missing()}; run pipeline/fetch_sources.py font-mincho font-textbook noto-serif-jp unihan")
    chars = [r[0] for r in db.execute("SELECT char FROM kanji")]
    db.executescript("""
        DROP TABLE IF EXISTS font_cover;
        DROP TABLE IF EXISTS font_old;
        DROP TABLE IF EXISTS font_drawn;  -- the semi-cursive brush outlines, removed 2026-11-08
        CREATE TABLE font_cover (
            char  TEXT PRIMARY KEY,
            faces TEXT NOT NULL      -- space-separated keys of the faces that have it
        );
        CREATE TABLE font_old (
            char    TEXT NOT NULL,
            face    TEXT NOT NULL,   -- mincho | textbook
            feature TEXT NOT NULL,   -- jp78 | jp83 | jp90, compat: a compatibility ideograph's shape,
                                     -- or ivs: a variation sequence's shape (Noto Serif JP)
            em      INTEGER NOT NULL, -- units per em: the paths' viewBox is 0 0 em em
            now     TEXT NOT NULL,   -- today's shape, SVG path data
            old     TEXT NOT NULL,   -- the feature's shape
            code    TEXT,            -- compat: the ideograph's code point, FA2C; ivs: the selector, E0101
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
                    old_rows.append((c, key, feature, em, now, then, None))
                    n += 1
            if n:
                print(f"  {key:9} {feature}  {n:>5} characters drawn differently")
        if key == COMPAT_FACE:
            n = 0
            for c, variants in compat_shapes().items():
                base = cmap.get(ord(c))
                if c not in cover or base is None:
                    continue
                now = _path(glyphs, base, top)
                for v in variants:
                    g = cmap.get(ord(v))
                    then = _path(glyphs, g, top) if g else ""
                    # One row per character, the first drawn differently: 88 bases have
                    # several, mostly Korean duplicates the mincho draws as today's shape.
                    if then and then != now:
                        old_rows.append((c, key, "compat", em, now, then, f"{ord(v):04X}"))
                        n += 1
                        break
            print(f"  {key:9} compat {n:>5} characters drawn differently (compatibility ideographs)")
            # Variation sequences, from the IVS font at the print face's weight.
            ivs = TTFont(IVS_FONT)
            sequences = {(cp, sel): g for sel, pairs in next(t for t in ivs["cmap"].tables if t.format == 14).uvsDict.items()
                         for cp, g in pairs if g}
            ivs_glyphs, ivs_cmap = ivs.getGlyphSet(location={"wght": 400}), ivs.getBestCmap()
            ivs_em, ivs_top = ivs["head"].unitsPerEm, ivs["OS/2"].sTypoAscender
            n = 0
            for c, sel in IVS_OLD.items():
                g = sequences.get((ord(c), sel))
                now = _path(ivs_glyphs, ivs_cmap[ord(c)], ivs_top)
                then = _path(ivs_glyphs, g, ivs_top) if g else ""
                if not then or then == now:
                    print(f"  WARNING: {IVS_FONT.name} draws {c} {sel:X} as today's shape (or not at all); left out")
                    continue
                old_rows.append((c, key, "ivs", ivs_em, now, then, f"{sel:X}"))
                n += 1
            print(f"  {key:9} ivs    {n:>5} characters from {IVS_FONT.name} variation sequences")
        print(f"  {key:9} has   {sum(1 for c in chars if key in cover[c]):>6,} of {len(chars):,} characters")
    db.executemany("INSERT INTO font_cover VALUES (?,?)", [(c, " ".join(f)) for c, f in cover.items() if f])
    db.executemany("INSERT INTO font_old VALUES (?,?,?,?,?,?,?)", old_rows)

    print(f"  old shapes    {len(old_rows):>7,} rows over {len({r[0] for r in old_rows}):,} characters")
