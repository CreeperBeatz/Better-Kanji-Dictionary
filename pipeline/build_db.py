"""Assemble betterrtk.sqlite from the downloaded sources.

Staged so each source can be rebuilt independently:

    python pipeline/build_db.py                  # every stage
    python pipeline/build_db.py radicals         # just the radical picker tables
    python pipeline/build_db.py --list

Run pipeline/fetch_sources.py first.

Windows note: set PYTHONIOENCODING=utf-8 or the console encoder dies on the first kanji.
"""

import argparse
import io
import json
import sqlite3
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(ROOT))  # server.bulgarian: the index and the queries must stem alike
DATA = ROOT / "pipeline" / "data"
DB_PATH = ROOT / "data" / "betterrtk.sqlite"

STAGES: dict[str, str] = {}


def stage(name: str, description: str):
    """Register a build stage."""

    def wrap(fn):
        STAGES[name] = description
        fn._stage = name
        _REGISTRY[name] = fn
        return fn

    return wrap


_REGISTRY: dict[str, callable] = {}


def read_zip_json(path: Path) -> dict:
    """jmdict-simplified ships one .json inside each .zip."""
    with zipfile.ZipFile(path) as z:
        member = z.namelist()[0]
        with z.open(member) as f:
            return json.load(io.TextIOWrapper(f, encoding="utf-8"))


# ---------------------------------------------------------------- stages


@stage("radicals", "KRADFILE/RADKFILE -> radical picker index")
def build_radicals(db: sqlite3.Connection) -> None:
    krad = read_zip_json(DATA / "kradfile.json.zip")["kanji"]
    radk = read_zip_json(DATA / "radkfile.json.zip")["radicals"]

    db.executescript("""
        DROP TABLE IF EXISTS radical;
        DROP TABLE IF EXISTS kanji_radical;
        CREATE TABLE radical (
            radical      TEXT PRIMARY KEY,
            stroke_count INTEGER NOT NULL,
            kanji_count  INTEGER NOT NULL
        );
        CREATE TABLE kanji_radical (
            kanji   TEXT NOT NULL,
            radical TEXT NOT NULL,
            PRIMARY KEY (kanji, radical)
        );
        CREATE INDEX idx_kr_radical ON kanji_radical(radical);
    """)

    db.executemany(
        "INSERT INTO radical (radical, stroke_count, kanji_count) VALUES (?, ?, ?)",
        [(r, v["strokeCount"], len(v["kanji"])) for r, v in radk.items()],
    )
    # KRADFILE is the authoritative kanji->component direction; RADKFILE is its
    # inversion. Build the join table from KRADFILE and keep only radicals that
    # RADKFILE actually offers in the picker, so the grid and the index agree.
    known = set(radk)
    rows = [(k, r) for k, comps in krad.items() for r in comps if r in known]
    db.executemany("INSERT OR IGNORE INTO kanji_radical (kanji, radical) VALUES (?, ?)", rows)

    dropped = sum(len(c) for c in krad.values()) - len(rows)
    print(f"  radicals      {len(radk):>7,} radicals")
    print(f"  kanji         {len(krad):>7,} kanji")
    print(f"  edges         {len(rows):>7,} kanji-radical pairs ({dropped} dropped, not in RADKFILE)")


@stage("graph", "cjk-decomp + kanji.json -> characters, containment edges, fan-out")
def build_graph(db: sqlite3.Connection) -> None:
    from decomp import Decomposition

    d = Decomposition.load(user_overrides=False)
    K = json.loads((DATA / "kanji.json").read_text(encoding="utf-8"))

    # Universe = everything KANJIDIC knows about, plus whatever components that
    # pulls in. Bound forms like 亠 have no KANJIDIC entry but must be nodes.
    comps = d.closure(K.keys())
    joyo = {c for c, v in K.items() if v.get("grade") in (1, 2, 3, 4, 5, 6, 8)}

    db.executescript("""
        DROP TABLE IF EXISTS kanji;
        DROP TABLE IF EXISTS edge;
        DROP TABLE IF EXISTS fanout;
        CREATE TABLE kanji (
            char        TEXT PRIMARY KEY,
            strokes     INTEGER,
            grade       INTEGER,
            freq        INTEGER,   -- newspaper rank 1..2501, NULL = outside it
            jlpt        INTEGER,   -- modern reconstruction, soft signal only
            joyo        INTEGER NOT NULL DEFAULT 0,
            in_kanjidic INTEGER NOT NULL DEFAULT 0,
            meanings    TEXT,      -- JSON array, KANJIDIC verbatim
            on_yomi     TEXT,
            kun_yomi    TEXT
        );
        CREATE TABLE edge (
            parent TEXT NOT NULL,  -- the containing character
            child  TEXT NOT NULL,  -- the component
            PRIMARY KEY (parent, child)
        );
        CREATE INDEX idx_edge_child ON edge(child);
        CREATE TABLE fanout (
            char       TEXT PRIMARY KEY,
            joyo_count INTEGER NOT NULL  -- how many joyo kanji transitively contain it
        );
    """)

    rows = []
    for ch in comps:
        v = K.get(ch)
        rows.append((
            ch,
            (v or {}).get("strokes"),
            (v or {}).get("grade"),
            (v or {}).get("freq"),
            (v or {}).get("jlpt_new"),
            1 if ch in joyo else 0,
            1 if v is not None else 0,
            json.dumps((v or {}).get("meanings") or [], ensure_ascii=False),
            json.dumps((v or {}).get("readings_on") or [], ensure_ascii=False),
            json.dumps((v or {}).get("readings_kun") or [], ensure_ascii=False),
        ))
    db.executemany(
        "INSERT INTO kanji (char, strokes, grade, freq, jlpt, joyo, in_kanjidic, "
        "meanings, on_yomi, kun_yomi) VALUES (?,?,?,?,?,?,?,?,?,?)",
        rows,
    )

    edges = [(parent, child) for parent, children in comps.items() for child in children]
    db.executemany("INSERT OR IGNORE INTO edge (parent, child) VALUES (?, ?)", edges)

    # Fan-out is measured against joyo, since that is the app's target set.
    anc = d.ancestors(comps, joyo)
    db.executemany(
        "INSERT INTO fanout (char, joyo_count) VALUES (?, ?)",
        [(c, len(roots)) for c, roots in anc.items()],
    )

    # Searching "temple" has to reach 寺, not only words meaning temple -- this is
    # a kanji explorer first. Curated meanings are indexed alongside KANJIDIC's so
    # either phrasing finds the character.
    curated: dict[str, str] = {}
    ka = DATA / "ka_data.csv"
    if ka.exists():
        import csv

        with ka.open(encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                ch, m = (r.get("kanji") or "").strip(), (r.get("kmeaning") or "").strip()
                if ch and m:
                    curated[ch] = m

    db.executescript("""
        DROP TABLE IF EXISTS kanji_fts;
        CREATE VIRTUAL TABLE kanji_fts USING fts5(
            meanings, char UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
        );
    """)
    db.executemany(
        "INSERT INTO kanji_fts (meanings, char) VALUES (?, ?)",
        [
            (text, ch)
            for ch, *_ in ((r[0], None) for r in rows)
            if (
                text := ", ".join(
                    filter(None, [curated.get(ch), *( (K.get(ch) or {}).get("meanings") or [] )])
                )
            )
        ],
    )

    bound = sum(1 for r in rows if r[6] == 0)
    print(f"  characters    {len(rows):>7,} nodes ({len(joyo):,} joyo, {bound:,} bound forms)")
    print(f"  edges         {len(edges):>7,} containment pairs")
    print(f"  fan-out       {len(anc):>7,} components appear inside at least one joyo kanji")
    top = sorted(anc.items(), key=lambda kv: -len(kv[1]))[:8]
    print("  highest fan-out: " + "  ".join(f"{c}={len(r)}" for c, r in top))


@stage("dict", "JMdict_e -> words, senses, nf frequency ranks, search indexes")
def build_dict(db: sqlite3.Connection) -> None:
    import gzip
    import re
    import xml.etree.ElementTree as ET

    raw = gzip.open(DATA / "JMdict_e.gz", "rt", encoding="utf-8").read()

    # JMdict encodes part-of-speech and misc tags as XML entities (&n; &vs; ...)
    # declared in its internal DTD. Expanding them to prose would throw away the
    # short codes, which are what we actually want to display, so rewrite each
    # &code; to its own name and drop the DTD.
    declared = set(re.findall(r'<!ENTITY\s+([\w-]+)\s+"', raw))
    raw = re.sub(r"<!DOCTYPE.*?\]>", "", raw, count=1, flags=re.DOTALL)
    raw = re.sub(
        r"&([\w-]+);",
        lambda m: m.group(1) if m.group(1) in declared else m.group(0),
        raw,
    )

    db.executescript("""
        DROP TABLE IF EXISTS word;
        DROP TABLE IF EXISTS word_form;
        DROP TABLE IF EXISTS sense;
        DROP TABLE IF EXISTS word_char;
        DROP TABLE IF EXISTS gloss_fts;
        CREATE TABLE word (
            id       INTEGER PRIMARY KEY,   -- JMdict ent_seq
            headword TEXT NOT NULL,         -- primary written form
            reading  TEXT NOT NULL,
            common   INTEGER NOT NULL,
            nf       INTEGER                -- best nf bucket, 1 = top 500 words
        );
        CREATE TABLE word_form (
            word_id INTEGER NOT NULL,
            text    TEXT NOT NULL,
            kana    INTEGER NOT NULL,       -- 1 = reading, 0 = written form
            ord     INTEGER NOT NULL,
            rare    INTEGER NOT NULL        -- iK/rK/oK/sK -- keep, but rank last
        );
        CREATE INDEX idx_form_text ON word_form(text);
        CREATE TABLE sense (
            word_id INTEGER NOT NULL,
            ord     INTEGER NOT NULL,
            pos     TEXT,
            misc    TEXT,
            gloss   TEXT NOT NULL
        );
        CREATE INDEX idx_sense_word ON sense(word_id);
        CREATE TABLE word_char (
            char    TEXT NOT NULL,
            word_id INTEGER NOT NULL
        );
        CREATE INDEX idx_wc_char ON word_char(char);
    """)

    NF = re.compile(r"^nf(\d+)$")
    RARE = {"iK", "rK", "oK", "sK", "ik", "rk", "ok", "sk"}

    words, forms, senses, chars = [], [], [], []
    seen_chars: set[tuple[str, int]] = set()

    root = ET.fromstring(raw)
    for entry in root.iter("entry"):
        wid = int(entry.findtext("ent_seq"))
        best_nf: int | None = None
        common = 0

        kebs, rebs = [], []
        for group, tag, text_tag, info_tag, store in (
            (entry.findall("k_ele"), "ke_pri", "keb", "ke_inf", kebs),
            (entry.findall("r_ele"), "re_pri", "reb", "re_inf", rebs),
        ):
            for el in group:
                text = el.findtext(text_tag)
                if not text:
                    continue
                pris = [p.text for p in el.findall(tag) if p.text]
                rare = any((i.text or "") in RARE for i in el.findall(info_tag))
                if pris:
                    common = 1
                for p in pris:
                    m = NF.match(p)
                    if m:
                        n = int(m.group(1))
                        best_nf = n if best_nf is None else min(best_nf, n)
                store.append((text, rare))

        if not rebs:
            continue
        headword = kebs[0][0] if kebs else rebs[0][0]
        reading = rebs[0][0]
        words.append((wid, headword, reading, common, best_nf))

        for kana, store in ((0, kebs), (1, rebs)):
            for i, (text, rare) in enumerate(store):
                forms.append((wid, text, kana, i, int(rare)))

        for i, s in enumerate(entry.findall("sense")):
            glosses = [g.text for g in s.findall("gloss") if g.text]
            if not glosses:
                continue
            senses.append((
                wid,
                i,
                ",".join(p.text for p in s.findall("pos") if p.text) or None,
                ",".join(m.text for m in s.findall("misc") if m.text) or None,
                "; ".join(glosses),
            ))

        # Which characters this word is written with, for "words using this kanji".
        for text, rare in kebs:
            if rare:
                continue
            for ch in text:
                if ch > "⺀" and (ch, wid) not in seen_chars:
                    seen_chars.add((ch, wid))
                    chars.append((ch, wid))

    db.executemany("INSERT INTO word VALUES (?,?,?,?,?)", words)
    db.executemany("INSERT INTO word_form VALUES (?,?,?,?,?)", forms)
    db.executemany("INSERT INTO sense VALUES (?,?,?,?,?)", senses)
    db.executemany("INSERT INTO word_char VALUES (?,?)", chars)

    # FTS covers English glosses only. SQLite's unicode61 tokeniser treats a run
    # of CJK as a single token, so it is useless for Japanese -- Japanese lookup
    # goes through word_form's index instead.
    db.executescript("""
        CREATE VIRTUAL TABLE gloss_fts USING fts5(
            gloss, word_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
        );
    """)
    db.executemany(
        "INSERT INTO gloss_fts (gloss, word_id) VALUES (?, ?)",
        [(g, wid) for wid, _, _, _, g in senses],
    )

    ranked = sum(1 for w in words if w[4] is not None)
    print(f"  words         {len(words):>7,} entries ({ranked:,} with an nf rank)")
    print(f"  forms         {len(forms):>7,} written and kana forms")
    print(f"  senses        {len(senses):>7,} senses")
    print(f"  char links    {len(chars):>7,} character-to-word links")


@stage("strokes", "KanjiVG -> stroke paths in writing order")
def build_strokes(db: sqlite3.Connection) -> None:
    import gzip
    import re
    import xml.etree.ElementTree as ET

    db.executescript("""
        DROP TABLE IF EXISTS stroke;
        CREATE TABLE stroke (
            char  TEXT PRIMARY KEY,
            paths TEXT NOT NULL   -- JSON array of SVG path data, in writing order
        );
    """)

    # KanjiVG's viewBox is 109x109 for every glyph, so paths tile without scaling.
    ID = re.compile(r"^kvg:kanji_([0-9a-f]+)$")
    rows = []
    with gzip.open(DATA / "kanjivg.xml.gz", "rb") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != "kanji":
                continue
            m = ID.match(el.get("id") or "")
            # Variant forms carry a suffix (…-Kaisho); keep only the base glyph.
            if m:
                try:
                    ch = chr(int(m.group(1), 16))
                except ValueError:
                    ch = None
                if ch:
                    paths = [p.get("d") for p in el.iter("path") if p.get("d")]
                    if paths:
                        rows.append((ch, json.dumps(paths)))
            el.clear()

    db.executemany("INSERT OR REPLACE INTO stroke VALUES (?,?)", rows)
    counts = [len(json.loads(r[1])) for r in rows]
    print(f"  glyphs        {len(rows):>7,} characters with stroke data")
    print(f"  strokes       {sum(counts):>7,} paths, {sum(counts)/max(len(counts),1):.1f} per character")


@stage("accents", "kanjium -> pitch accent")
def build_accents(db: sqlite3.Connection) -> None:
    db.executescript("""
        DROP TABLE IF EXISTS accent;
        CREATE TABLE accent (
            word    TEXT NOT NULL,
            reading TEXT NOT NULL,
            pitch   TEXT NOT NULL,   -- comma-separated mora positions, 0 = heiban
            PRIMARY KEY (word, reading)
        );
    """)
    rows = []
    with (DATA / "accents.txt").open(encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 3 or not parts[2]:
                continue
            rows.append(tuple(parts))
    db.executemany("INSERT OR IGNORE INTO accent VALUES (?,?,?)", rows)
    stored = db.execute("SELECT COUNT(*) FROM accent").fetchone()[0]
    dupes = len(rows) - stored
    print(f"  accents       {stored:>7,} word readings"
          + (f" ({dupes} duplicate keys collapsed)" if dupes else ""))


@stage("meanings", "Kanji Alive -> curated meaning overlay")
def build_meanings(db: sqlite3.Connection) -> None:
    import csv

    db.executescript("""
        DROP TABLE IF EXISTS kanji_curated;
        CREATE TABLE kanji_curated (
            char     TEXT PRIMARY KEY,
            meaning  TEXT NOT NULL,
            radical  TEXT,
            rad_name TEXT
        );
    """)
    rows = []
    with (DATA / "ka_data.csv").open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            ch = (r.get("kanji") or "").strip()
            meaning = (r.get("kmeaning") or "").strip()
            if ch and meaning:
                rows.append((ch, meaning, (r.get("radical") or "").strip() or None,
                             (r.get("rad_meaning") or "").strip() or None))
    db.executemany("INSERT OR REPLACE INTO kanji_curated VALUES (?,?,?,?)", rows)
    print(f"  curated       {len(rows):>7,} kanji with a curated meaning")


@stage("examples", "Tatoeba jpn_indices -> example sentences per word")
def build_examples(db: sqlite3.Connection) -> None:
    import re
    import tarfile

    db.executescript("""
        DROP TABLE IF EXISTS sentence;
        DROP TABLE IF EXISTS sentence_word;
        CREATE TABLE sentence (
            id   INTEGER PRIMARY KEY,
            text TEXT NOT NULL
        );
        CREATE TABLE sentence_word (
            headword    TEXT NOT NULL,
            sentence_id INTEGER NOT NULL
        );
        CREATE INDEX idx_sw_head ON sentence_word(headword);
    """)

    # Each token is headword(reading){surface}[sense]~ -- we want the headword,
    # which is a real JMdict form, so examples attach by lemma rather than by
    # substring match.
    TOKEN = re.compile(r"^([^(\[{~|]+)")

    tar = tarfile.open(DATA / "jpn_indices.tar.bz2", "r:bz2")
    member = next(m for m in tar.getmembers() if m.name.endswith(".csv"))
    sentences, links = [], []
    seen: set[tuple[str, int]] = set()

    for raw in tar.extractfile(member):
        line = raw.decode("utf-8").rstrip("\n")
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        try:
            sid = int(parts[0])
        except ValueError:
            continue
        sentences.append((sid, parts[2]))
        for tok in parts[2].split():
            m = TOKEN.match(tok)
            if not m:
                continue
            head = m.group(1)
            if head and (head, sid) not in seen:
                seen.add((head, sid))
                links.append((head, sid))

    db.executemany("INSERT OR IGNORE INTO sentence VALUES (?,?)", sentences)
    db.executemany("INSERT INTO sentence_word VALUES (?,?)", links)
    print(f"  sentences     {len(sentences):>7,} indexed Japanese sentences")
    print(f"  links         {len(links):>7,} word-to-sentence links")


BG_OUT = ROOT / "pipeline" / "translate" / "out"


@stage("bg", "translate/out/*.json -> Bulgarian glosses, kanji meanings and their search indexes")
def build_bulgarian(db: sqlite3.Connection) -> None:
    """Load whatever the translating agents have handed back (see translate/TASK.md).

    Checked only for shape here -- each sense must be one JMdict has -- since
    check.py is where the language gets checked. The search indexes hold
    stems (server/bulgarian.py `terms`), so a query for водата finds вода.
    """
    from server.bulgarian import terms

    db.executescript("""
        DROP TABLE IF EXISTS sense_bg;
        DROP TABLE IF EXISTS kanji_bg;
        DROP TABLE IF EXISTS bg_gloss_fts;
        DROP TABLE IF EXISTS bg_kanji_fts;
        CREATE TABLE sense_bg (
            word_id INTEGER NOT NULL,
            ord     INTEGER NOT NULL,
            gloss   TEXT NOT NULL,     -- "; "-joined, like sense.gloss
            source  TEXT NOT NULL,     -- who wrote it: "mt:claude-sonnet-5", later perhaps a dictionary
            PRIMARY KEY (word_id, ord)
        );
        CREATE TABLE kanji_bg (
            char     TEXT PRIMARY KEY,
            meanings TEXT NOT NULL,    -- JSON array
            source   TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE bg_gloss_fts USING fts5(
            terms, word_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE bg_kanji_fts USING fts5(
            terms, char UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
        );
    """)

    known_senses = {(w, o) for w, o in db.execute("SELECT word_id, ord FROM sense")}
    known_kanji = {r[0] for r in db.execute("SELECT char FROM kanji")}

    def glosses(bg) -> list[str] | None:
        if not isinstance(bg, list):
            return None
        out = [g.strip() for g in bg if isinstance(g, str) and g.strip()]
        return out or None

    senses: dict[tuple[int, int], tuple[str, str]] = {}
    kanji: dict[str, tuple[list[str], str]] = {}
    files = sorted(BG_OUT.glob("*.json")) if BG_OUT.exists() else []
    skipped = 0
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            print(f"  skip {path.name}: {e}")
            continue
        source = "mt:" + str(data.get("by") or "unknown").strip()
        for e in data.get("entries") or []:
            for s in (e.get("senses") or []) if isinstance(e, dict) else []:
                ok = isinstance(s, dict) and isinstance(e.get("id"), int) and isinstance(s.get("i"), int)
                key = (e["id"], s["i"]) if ok else None
                g = glosses(s.get("bg")) if key in known_senses else None
                if g is None:
                    skipped += 1
                    continue
                senses[key] = ("; ".join(g), source)
        for k in data.get("kanji") or []:
            char = k.get("char") if isinstance(k, dict) else None
            g = glosses(k.get("bg")) if char in known_kanji else None
            if g is None:
                skipped += 1
                continue
            kanji[char] = (g, source)

    rows = sorted(senses.items())
    db.executemany("INSERT INTO sense_bg VALUES (?,?,?,?)", [(w, o, g, src) for (w, o), (g, src) in rows])
    db.executemany(
        "INSERT INTO bg_gloss_fts (terms, word_id) VALUES (?, ?)",
        [(" ".join(terms(g)), w) for (w, _), (g, _) in rows],
    )
    krows = sorted(kanji.items())
    db.executemany(
        "INSERT INTO kanji_bg VALUES (?,?,?)",
        [(c, json.dumps(m, ensure_ascii=False), src) for c, (m, src) in krows],
    )
    db.executemany(
        "INSERT INTO bg_kanji_fts (terms, char) VALUES (?, ?)",
        [(" ".join(terms(", ".join(m))), c) for c, (m, _) in krows],
    )

    words = len({w for w, _ in senses})
    print(f"  files         {len(files):>7,} in {BG_OUT}")
    print(f"  senses        {len(rows):>7,} Bulgarian senses over {words:,} words")
    print(f"  kanji         {len(krows):>7,} characters with Bulgarian meanings")
    if skipped:
        print(f"  skipped       {skipped:>7,} senses or kanji that match nothing in the dictionary")


# ---------------------------------------------------------------- driver


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA foreign_keys = ON")
    return db


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stages", nargs="*", help="stages to run (default: all)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--bg-out", type=Path, help="translated chunks for the bg stage (default: pipeline/translate/out)")
    args = ap.parse_args()

    global BG_OUT
    if args.bg_out:
        BG_OUT = args.bg_out.resolve()

    if args.list:
        for name, desc in STAGES.items():
            print(f"{name:<12} {desc}")
        return 0

    names = args.stages or list(STAGES)
    unknown = [n for n in names if n not in STAGES]
    if unknown:
        raise SystemExit(f"unknown stage(s): {', '.join(unknown)} (try --list)")

    db = connect()
    print(f"building {DB_PATH}\n")
    for name in names:
        print(f"[{name}] {STAGES[name]}")
        _REGISTRY[name](db)
        db.commit()
        print()
    db.execute("ANALYZE")
    db.commit()
    db.close()
    size = DB_PATH.stat().st_size
    print(f"done  {DB_PATH}  ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
