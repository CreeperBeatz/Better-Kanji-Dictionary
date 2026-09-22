"""The offline lookup pack: what search, drawing and the radical picker need,
built from the database for an installed app to keep on the device.

    python -m server.offline          # build now, if the database changed

The server builds it by itself on startup when the database is newer than the
last pack, so deploying new data needs nothing extra. Files are written
gzipped once and served as they are -- the Pi should not be compressing twenty
megabytes for every phone that installs the app.

What goes in, and in what shape, follows from what the client can afford to
hold in memory. A phone cannot keep 218,000 dictionary entries as JavaScript
objects, so the pack is split in two:

  index.bin    everything a query touches: word ranking columns, every
               written and kana form in sorted order, and the English
               full-text indexes. Binary, so the client maps typed arrays
               straight onto it instead of parsing.
  words-NN     the entries themselves, in chunks, which the client files away
               in IndexedDB and reads back only for the results it shows.
  kanji.json   the character table, the handwriting references, radicals,
               levels and each kanji's common words. Small enough to hold.
  strokes.json stroke paths, for the stroke-order diagram.

The English indexes are read back out of the database's own FTS5 tables
through fts5vocab rather than re-tokenised here, so the client's index is
exactly the one the server searches.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import threading
import time
from array import array
from pathlib import Path

from .db import DB_PATH

# Bump when the pack's layout changes, so every client fetches a new one.
FORMAT = 1

OUT = DB_PATH.parent / "offline"
CURRENT = OUT / "current.json"
OVERRIDES = DB_PATH.parent / "decomp_overrides.json"

WORD_CHUNK = 10_000
WORDS_FOR = 12  # what /api/search/words-for returns by default

VERSION = re.compile(r"^[0-9a-f]{12}$")
NAME = re.compile(r"^[a-z0-9-]+\.(json|bin)$")

_lock = threading.Lock()
_building = False
_failed: str | None = None


# ---------------------------------------------------------------- freshness


def _stamp(p: Path) -> str:
    try:
        s = p.stat()
        return f"{s.st_mtime_ns}:{s.st_size}"
    except FileNotFoundError:
        return "-"


def source_key() -> str:
    """Changes whenever anything the pack is built from does."""
    wal = DB_PATH.with_name(DB_PATH.name + "-wal")
    return f"{FORMAT}|{_stamp(DB_PATH)}|{_stamp(wal)}|{_stamp(OVERRIDES)}"


def current() -> dict | None:
    """The manifest of the pack on disk, if it matches the database."""
    try:
        m = json.loads(CURRENT.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return None
    if m.get("key") != source_key() or not (OUT / m["version"]).is_dir():
        return None
    return m


def status() -> dict:
    return {"building": _building, "error": _failed}


def ensure_async() -> None:
    """Start a build in the background unless the pack is current or building."""
    global _building
    with _lock:
        if _building or current() is not None:
            return
        _building = True
    threading.Thread(target=_build_guarded, name="offline-pack", daemon=True).start()


def _build_guarded() -> None:
    global _building, _failed
    try:
        build()
        _failed = None
    except Exception as e:  # reported through the manifest, not raised into a thread
        _failed = f"{type(e).__name__}: {e}"
        print(f"offline pack build failed: {_failed}", file=sys.stderr)
    finally:
        _building = False


def file_path(version: str, name: str) -> Path | None:
    if not VERSION.match(version) or not NAME.match(name):
        return None
    p = OUT / version / f"{name}.gz"
    return p if p.is_file() else None


# ---------------------------------------------------------------- binary sections


class Sections:
    """Named typed arrays, laid end to end behind a JSON header.

    Layout: b"BKDP", u32 header length, header JSON, then each section
    4-byte aligned. The header maps name -> [type, byte offset, count], where
    offsets are from the start of the file.

    "d32" is a u32 array stored as successive differences, modulo 2**32, which
    the client sums back up once on load. Sorted ids and posting lists are
    mostly small steps, and small steps are what gzip is good at.
    """

    TYPES = {"u8": "B", "u16": "H", "u32": "I", "i32": "i", "d32": "I"}

    def __init__(self) -> None:
        self.items: list[tuple[str, str, bytes, int]] = []

    def add(self, name: str, kind: str, values) -> None:
        if kind == "utf8":
            data = values.encode("utf-8")
            self.items.append((name, kind, data, len(data)))
            return
        if kind == "d32":
            prev, deltas = 0, array("I")
            for v in values:
                deltas.append((v - prev) & 0xFFFFFFFF)
                prev = v
            values = deltas
        a = values if isinstance(values, array) else array(self.TYPES[kind], values)
        assert a.typecode == self.TYPES[kind], (name, a.typecode)
        if sys.byteorder == "big":
            a = array(a.typecode, a)
            a.byteswap()
        self.items.append((name, kind, a.tobytes(), len(a)))

    def tobytes(self) -> bytes:
        # The header's own length moves every offset, and the offsets are in
        # the header: lay out until its length stops changing.
        header: dict = {}
        head = b""
        while True:
            pos = _align(8 + len(head))
            header = {}
            for name, kind, data, count in self.items:
                header[name] = [kind, pos, count]
                pos = _align(pos + len(data))
            again = json.dumps({"sections": header}, separators=(",", ":")).encode()
            settled = len(again) == len(head)
            head = again
            if settled:
                break
        out = bytearray(b"BKDP")
        out += len(head).to_bytes(4, "little")
        out += head
        for name, kind, data, count in self.items:
            gap = header[name][1] - len(out)
            assert 0 <= gap < 4, (name, gap)
            out += b"\0" * gap
            out += data
        return bytes(out)


def _align(n: int) -> int:
    return (n + 3) & ~3


def _utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _binary(s: str) -> bytes:
    """SQLite's BINARY collation, which is what the server's range scans use."""
    return s.encode("utf-8")


# ---------------------------------------------------------------- build


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


POS_BITS = (("v1", 1), ("v5", 2), ("vs", 4))


def _pos_mask(pos: str | None) -> int:
    """Which deinflection families one sense's parts of speech satisfy.

    Mirrors japanese.pos_matches: v1*, v5*, vs*, exactly vk, exactly adj-i.
    """
    if not pos:
        return 0
    mask = 0
    for tag in pos.split(","):
        for prefix, bit in POS_BITS:
            if tag.startswith(prefix):
                mask |= bit
        if tag == "vk":
            mask |= 8
        if tag == "adj-i":
            mask |= 16
    return mask


def _fts(conn: sqlite3.Connection, table: str, sec: Sections, prefix: str) -> list[int]:
    """One FTS5 table's inverted index, straight from fts5vocab.

    Per term, the documents it occurs in and how often; per occurrence, its
    token position, so a phrase that tokenises to several words ("e-mail")
    can be matched as FTS5 matches it, adjacent. Streamed in index order, so
    the Pi never holds the million-odd instances at once.

    Returns the rowids in document order, so the caller can say what each
    document is.
    """
    conn.execute(f"DROP TABLE IF EXISTS temp.v_{table}")
    conn.execute(f"CREATE VIRTUAL TABLE temp.v_{table} USING fts5vocab(main, {table}, 'instance')")

    rowids = [r[0] for r in conn.execute(f"SELECT rowid FROM {table} ORDER BY rowid")]
    doc_of = {rid: i for i, rid in enumerate(rowids)}
    doclen = array("H", [0] * len(rowids))

    terms: list[str] = []
    tlen = array("B")
    pstart = array("I", [0])
    docs = array("I")
    tfs = array("B")
    positions = array("B")

    # BINARY order on the term is UTF-8 byte order, which is what the client's
    # binary search assumes; rowid order is document order.
    last_term = last_doc = None
    for term, doc, offset in conn.execute(
        f"SELECT term, doc, offset FROM temp.v_{table} ORDER BY term, doc, offset"
    ):
        if term != last_term:
            if last_term is not None:
                pstart.append(len(docs))
            terms.append(term)
            tlen.append(_utf16_len(term))
            last_term, last_doc = term, None
        if doc != last_doc:
            docs.append(doc_of[doc])
            tfs.append(0)
            last_doc = doc
        # Glosses run to 64 tokens at most; a byte is plenty for both.
        if tfs[-1] == 255 or offset > 255:
            raise ValueError(f"{table}: {term!r} in row {doc} does not fit the pack's byte fields")
        tfs[-1] += 1
        positions.append(offset)
        d = doc_of[doc]
        doclen[d] = min(doclen[d] + 1, 65535)
    pstart.append(len(docs))

    conn.execute(f"DROP TABLE temp.v_{table}")

    sec.add(f"{prefix}.term", "utf8", "".join(terms))
    sec.add(f"{prefix}.tlen", "u8", tlen)
    sec.add(f"{prefix}.pstart", "d32", pstart)
    sec.add(f"{prefix}.doc", "d32", docs)
    sec.add(f"{prefix}.tf", "u8", tfs)
    sec.add(f"{prefix}.pos", "u8", positions)
    sec.add(f"{prefix}.doclen", "u16", doclen)
    return rowids


def _kanji_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT k.char, k.strokes, k.grade, k.freq, k.jlpt, k.joyo, k.in_kanjidic, "
        "       k.meanings, k.on_yomi, k.kun_yomi, COALESCE(f.joyo_count, 0) AS fanout, "
        "       c.meaning AS curated "
        "FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
        "LEFT JOIN kanji_curated c ON c.char = k.char"
    ).fetchall()


def build(force: bool = False) -> dict:
    """Write a new pack if the sources changed, and return its manifest."""
    if not force:
        m = current()
        if m is not None:
            return m

    from . import recognize
    from .routes.graph import by_level
    from .routes.radicals import list_radicals

    started = time.time()
    key = source_key()
    conn = _connect()
    files: dict[str, bytes] = {}

    # --- words, ordered by id so the client can binary-search an id
    words = conn.execute("SELECT id, headword, reading, common, nf FROM word ORDER BY id").fetchall()
    index_of = {w["id"]: i for i, w in enumerate(words)}

    pitch = {(r[0], r[1]): r[2] for r in conn.execute("SELECT word, reading, pitch FROM accent")}

    senses: dict[int, list] = {}
    pos_mask = array("B", [0] * len(words))
    for r in conn.execute("SELECT word_id, pos, misc, gloss FROM sense ORDER BY word_id, ord"):
        senses.setdefault(r[0], []).append([r[1], r[2], r[3]])
        i = index_of.get(r[0])
        if i is not None:
            pos_mask[i] |= _pos_mask(r[1])

    forms: dict[int, list] = {}
    for r in conn.execute("SELECT word_id, text, kana, rare FROM word_form ORDER BY word_id, kana, ord"):
        forms.setdefault(r[0], []).append([r[1], r[2], r[3]])

    for n, lo in enumerate(range(0, len(words), WORD_CHUNK)):
        chunk = [
            [
                w["id"], w["headword"], w["reading"], w["common"], w["nf"],
                pitch.get((w["headword"], w["reading"])),
                senses.get(w["id"], []), forms.get(w["id"], []),
            ]
            for w in words[lo : lo + WORD_CHUNK]
        ]
        files[f"words-{n:02d}.json"] = _json(chunk)
    del senses, forms

    sec = Sections()
    sec.add("word.id", "d32", [w["id"] for w in words])
    sec.add("word.common", "u8", [1 if w["common"] else 0 for w in words])
    sec.add("word.nf", "u8", [w["nf"] or 0 for w in words])
    sec.add("word.len", "u8", [min(len(w["headword"]), 255) for w in words])
    sec.add("word.pos", "u8", pos_mask)

    # --- every form, in the order the server's idx_form_text scan returns them:
    # by text, then by rowid, each (word, text) pair once.
    by_text: dict[str, list[int]] = {}
    for text, word_id in conn.execute("SELECT text, word_id FROM word_form ORDER BY text, rowid"):
        ws = by_text.setdefault(text, [])
        i = index_of.get(word_id)
        if i is not None and i not in ws:
            ws.append(i)
    texts = sorted(by_text, key=_binary)
    flen = array("B")
    fcount = array("B")
    fwords = array("I")
    for t in texts:
        # Lengths rather than offsets: they fit a byte, and the client sums
        # them. No form is anywhere near 255 of either.
        flen.append(_utf16_len(t))
        fcount.append(len(by_text[t]))
        fwords.extend(by_text[t])
    sec.add("form.text", "utf8", "".join(texts))
    sec.add("form.len", "u8", flen)
    sec.add("form.count", "u8", fcount)
    sec.add("form.word", "u32", fwords)
    del by_text, texts

    # --- English: glosses, and kanji meanings
    gloss_rowids = _fts(conn, "gloss_fts", sec, "gloss")
    gloss_word = dict(conn.execute("SELECT rowid, word_id FROM gloss_fts"))
    sec.add("gloss.docword", "u32", [index_of.get(gloss_word[r], 0) for r in gloss_rowids])

    kanji = sorted(_kanji_rows(conn), key=lambda r: _binary(r["char"]))
    kanji_at = {r["char"]: i for i, r in enumerate(kanji)}
    kfts_rowids = _fts(conn, "kanji_fts", sec, "kfts")
    kfts_char = dict(conn.execute("SELECT rowid, char FROM kanji_fts"))
    # A meaning row whose character left the kanji table matches nothing, as
    # the server's join would drop it; 0xFFFFFFFF marks it.
    sec.add("kfts.docchar", "u32", [kanji_at.get(kfts_char[r], 0xFFFFFFFF) for r in kfts_rowids])

    files["index.bin"] = sec.tobytes()

    # --- the character table and the small lookups hung off it
    strokes = {r[0]: json.loads(r[1]) for r in conn.execute("SELECT char, paths FROM stroke")}

    recognize.index()  # fills recognize._meta, which decides what counts as kanji
    # The references as the matcher sees them: per stroke its direction,
    # start cell, end cell and length band, one number each; the pen's travel
    # between strokes; and the travel that closes the gap when a stroke is
    # dropped. Features rather than coordinates, because strokes sit close
    # enough to the thresholds that even four decimals of rounding move some
    # across -- and because small integers are a fraction of the size.
    glyphs = []
    for char, paths in strokes.items():
        if not paths or not recognize._is_kanji(char):
            continue
        lines = recognize.normalise(tuple(recognize.path_endpoints(p) for p in paths))
        g = recognize.Glyph(lines)
        codes = [((d * 9 + st) * 9 + en) * recognize.LENGTH_BUCKETS + ln
                 for d, st, en, ln in zip(g.dirs, g.starts, g.ends, g.lengths)]
        seams = [
            recognize.direction(lines[i - 1][2], lines[i - 1][3], lines[i + 1][0], lines[i + 1][1])
            for i in range(1, len(lines) - 1)
        ]
        glyphs.append([char, codes, list(g.moves), seams])

    # Stroke-count ratio ** LENGTH_POWER, as Python's pow computes it. JS's
    # pow can differ from C's in the last bit, which is enough to reorder the
    # near-ties at the stroke-order rerank cut-off.
    most = max(max((len(g[1]) for g in glyphs), default=0), recognize.MAX_STROKES) + 6
    power = [
        ((n / m) if n < m else (m / n)) ** recognize.LENGTH_POWER
        for n in range(1, most + 1)
        for m in range(1, most + 1)
    ]

    kanji_radicals: dict[str, list[str]] = {}
    for k, r in conn.execute("SELECT kanji, radical FROM kanji_radical ORDER BY kanji, radical"):
        kanji_radicals.setdefault(k, []).append(r)

    words_for: dict[str, list[int]] = {}
    for char, word_id in conn.execute(
        "SELECT wc.char, w.id FROM word_char wc JOIN word w ON w.id = wc.word_id "
        "WHERE w.common = 1 ORDER BY wc.char, w.nf IS NULL, w.nf, LENGTH(w.headword), w.id"
    ):
        ids = words_for.setdefault(char, [])
        if len(ids) < WORDS_FOR and word_id not in ids:
            ids.append(word_id)

    files["kanji.json"] = _json(
        {
            # char, strokes, grade, freq, jlpt, joyo, inKanjidic, meanings,
            # onYomi, kunYomi, fanout, curated -- sorted by char
            "kanji": [
                [
                    r["char"], r["strokes"], r["grade"], r["freq"], r["jlpt"], r["joyo"],
                    r["in_kanjidic"], json.loads(r["meanings"] or "[]"),
                    json.loads(r["on_yomi"] or "[]"), json.loads(r["kun_yomi"] or "[]"),
                    r["fanout"], r["curated"],
                ]
                for r in kanji
            ],
            "glyphs": glyphs,
            "strokePower": {"size": most, "values": power},
            "radicals": list_radicals(),
            "kanjiRadicals": kanji_radicals,
            "levels": {str(n): by_level(n) for n in (1, 2, 3, 4, 5)},
            "wordsFor": words_for,
        }
    )
    files["strokes.json"] = _json(strokes)
    conn.close()

    return _publish(key, files, started)


def _json(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _publish(key: str, files: dict[str, bytes], started: float) -> dict:
    digest = hashlib.sha256()
    for name in sorted(files):
        digest.update(name.encode())
        digest.update(files[name])
    version = digest.hexdigest()[:12]

    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / f".{version}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    listed = []
    for name in sorted(files):
        packed = gzip.compress(files[name], compresslevel=9, mtime=0)
        (tmp / f"{name}.gz").write_bytes(packed)
        listed.append({"name": name, "bytes": len(files[name]), "gz": len(packed)})

    final = OUT / version
    shutil.rmtree(final, ignore_errors=True)
    tmp.rename(final)

    manifest = {
        "format": FORMAT,
        "key": key,
        "version": version,
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seconds": round(time.time() - started, 1),
        "files": listed,
    }
    tmp_manifest = CURRENT.with_suffix(".tmp")
    tmp_manifest.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    tmp_manifest.replace(CURRENT)

    # Keep the pack before this one, so a phone halfway through downloading it
    # can finish; anything older goes.
    dirs = sorted(
        (d for d in OUT.iterdir() if d.is_dir() and VERSION.match(d.name)),
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    for d in dirs[2:]:
        if d.name != version:
            shutil.rmtree(d, ignore_errors=True)
    return manifest


if __name__ == "__main__":
    force = "--force" in sys.argv
    m = build(force=force)
    total = sum(f["gz"] for f in m["files"])
    print(f"pack {m['version']}: {len(m['files'])} files, {total / 1e6:.1f} MB gzipped, built in {m['seconds']}s")
    for f in m["files"]:
        print(f"  {f['name']:16s} {f['bytes'] / 1e6:7.2f} MB  ->  {f['gz'] / 1e6:6.2f} MB")
