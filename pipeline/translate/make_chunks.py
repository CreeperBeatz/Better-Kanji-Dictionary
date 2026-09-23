"""Split the dictionary into chunks for the translating agents.

    python pipeline/translate/make_chunks.py            # -> pipeline/translate/in/
    python pipeline/translate/make_chunks.py --size 50  # smaller chunks

Reads the built database (and pipeline/data/bg_hints.json when present) and
writes, 100 to a file:

  in/words-0001.json ...  JMdict entries, most frequent first: common words
                          by nf rank, then the rest by id. words-0001 is the
                          commonest hundred.
  in/kanji-001.json ...   characters with KANJIDIC meanings, jōyō and JLPT
                          first, by newspaper frequency.

The order depends only on the data, so re-running after a dictionary update
keeps chunk names pointing at (nearly) the same words. See TASK.md for what an
agent does with a chunk, and check.py for what it has to hand back.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DB = ROOT / "data" / "betterrtk.sqlite"
HINTS = ROOT / "pipeline" / "data" / "bg_hints.json"
IN = HERE / "in"

MAX_HINTS = 6  # per source, per entry: enough to steer, not enough to drown the senses


def load_hints() -> dict[str, dict]:
    if not HINTS.exists():
        print(f"  no {HINTS.name}: chunks go out without hints (run hints.py first for better output)")
        return {}
    return json.loads(HINTS.read_text(encoding="utf-8"))


def entry_hints(forms: list[str], hints: dict[str, dict]) -> dict:
    wk: list = []
    wn: list = []
    for f in forms:
        h = hints.get(f)
        if not h:
            continue
        for label, bg in h.get("wiktionary", []):
            item = {"via": label, "bg": bg}
            if item not in wk:
                wk.append(item)
        for bg in h.get("wordnet", []):
            if bg not in wn:
                wn.append(bg)
    out = {}
    if wk:
        out["wiktionary"] = wk[:MAX_HINTS]
    if wn:
        out["wordnet"] = wn[:MAX_HINTS]
    return out


def words(db: sqlite3.Connection, hints: dict, size: int) -> int:
    order = [
        r[0]
        for r in db.execute(
            "SELECT id FROM word ORDER BY common DESC, nf IS NULL, nf, id"
        )
    ]
    forms: dict[int, list[tuple[str, int, int]]] = {}
    for wid, text, kana, rare in db.execute(
        "SELECT word_id, text, kana, rare FROM word_form ORDER BY word_id, kana, ord"
    ):
        forms.setdefault(wid, []).append((text, kana, rare))
    senses: dict[int, list[dict]] = {}
    for wid, ord_, pos, misc, gloss in db.execute(
        "SELECT word_id, ord, pos, misc, gloss FROM sense ORDER BY word_id, ord"
    ):
        s = {"i": ord_, "en": [g.strip() for g in gloss.split("; ") if g.strip()]}
        if pos:
            s["pos"] = pos.split(",")
        if misc:
            s["misc"] = misc.split(",")
        senses.setdefault(wid, []).append(s)
    head = {r[0]: (r[1], r[2]) for r in db.execute("SELECT id, headword, reading FROM word")}

    n = 0
    for start in range(0, len(order), size):
        n += 1
        entries = []
        for wid in order[start : start + size]:
            if wid not in senses:
                continue
            headword, reading = head[wid]
            fs = forms.get(wid, [])
            e = {"id": wid, "headword": headword, "reading": reading}
            also = [t for t, kana, rare in fs if t not in (headword, reading) and not rare]
            if also:
                e["forms"] = also
            e["senses"] = senses[wid]
            h = entry_hints([t for t, _, rare in fs if not rare], hints)
            if h:
                e["hints"] = h
            entries.append(e)
        name = f"words-{n:04d}"
        (IN / f"{name}.json").write_text(
            json.dumps({"chunk": name, "entries": entries}, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return n


def kanji(db: sqlite3.Connection, size: int) -> int:
    rows = db.execute(
        "SELECT k.char, k.meanings, k.on_yomi, k.kun_yomi, c.meaning "
        "FROM kanji k LEFT JOIN kanji_curated c ON c.char = k.char "
        "WHERE k.in_kanjidic = 1 AND k.meanings != '[]' "
        "ORDER BY (k.joyo = 1 OR k.jlpt IS NOT NULL) DESC, k.freq IS NULL, k.freq, k.joyo DESC, k.char"
    ).fetchall()

    def example_words(char: str) -> list[dict]:
        out = []
        for headword, reading, gloss in db.execute(
            "SELECT w.headword, w.reading, "
            "  (SELECT gloss FROM sense s WHERE s.word_id = w.id ORDER BY ord LIMIT 1) "
            "FROM word_char wc JOIN word w ON w.id = wc.word_id "
            "WHERE wc.char = ? AND w.common = 1 "
            "ORDER BY w.nf IS NULL, w.nf, LENGTH(w.headword), w.id LIMIT 5",
            (char,),
        ):
            out.append({"headword": headword, "reading": reading, "en": (gloss or "").split("; ")[0]})
        return out

    n = 0
    for start in range(0, len(rows), size):
        n += 1
        items = []
        for char, meanings, on, kun, curated in rows[start : start + size]:
            item = {
                "char": char,
                "meanings": json.loads(meanings),
                "on": json.loads(on or "[]"),
                "kun": json.loads(kun or "[]"),
            }
            if curated:
                item["curated"] = curated
            ex = example_words(char)
            if ex:
                item["words"] = ex
            items.append(item)
        name = f"kanji-{n:03d}"
        (IN / f"{name}.json").write_text(
            json.dumps({"chunk": name, "kanji": items}, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--size", type=int, default=100, help="entries per chunk (default 100)")
    args = ap.parse_args()

    if not DB.exists():
        raise SystemExit(f"{DB} not found: run pipeline/build_db.py first")
    shutil.rmtree(IN, ignore_errors=True)
    IN.mkdir(parents=True)
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    hints = load_hints()
    nw = words(db, hints, args.size)
    nk = kanji(db, args.size)
    print(f"wrote {nw:,} word chunks and {nk:,} kanji chunks to {IN}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
