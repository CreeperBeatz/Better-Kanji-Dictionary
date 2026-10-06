"""The labeling queue: items to decide, every decision, and what they made live.

The task types (TASK-forms-review.md §5, and more since):

    decomposition  subject 青            value: its direct parts, ["龶", "月"]; [] = atomic
    form_link      subject 龶|王          value: {"kind": looks_like, "note": ..., "reverse": true?}; kind "none" = no link
    part_meaning   subject 丷            value: {"kind": meaning | shape, "en", "bg", "note", "noteBg"}
    kanji_senses   subject 生            value: [{"id": "生.life", "en": "life", "bg": "живот", "note"}]
    word_sense     subject 生|1234567    value: a sense id of the kanji, or "catch-all"
    bg             subject word:123 | kanji:生   value: the Bulgarian, per sense / per meaning
    report         subject word:123 | kanji:生   value: {"about": english | ..., "text": ...}; never live

Parts, forms and part meanings are decided together, on one card per
character (`character_card`, `decide_card`): a reviewer answers "what is it
built from", "is it another kanji written differently", "what does it mean"
for the same character at once, so the three answers can't contradict.

An **item** is a change waiting for a person: a `proposal` (newly marked data
loaded into the queue: an IDS diff, an AI draft) or a `suggestion` (a user
asking for a change from the page). A reviewer accepts it, edits then accepts,
rejects or skips it. Reviewers and the admin may also edit directly, from the
page; that is a decision with no item.

Every decision is logged -- who, when, the value before and after, why -- and
none is ever deleted. The admin can revert one, which is a new decision
putting the value from before back, provided nothing changed it since.

What decisions make live is an overlay the server reads on every request:
decompositions in the association store (where the graph already reads them),
the other types here, under `live`. All of this is in data/review/review.db,
not in the data database, which is rebuilt and swapped on deploys. Copy it
with `python -m server.review backup <file>`, which is safe while the server runs. `python -m server.review export`
writes the accepted state to tracked files for the pipeline and for git
(data/decomp_overrides.json, data/form_overrides.json,
data/meaning_groups.json, data/part_meanings.json); nothing writes those files on its own, so a
`git reset --hard` on deploy can never lose a reviewer's work.

An accepted decomposition changes the offline pack, which takes over a
minute and hundreds of MB to rebuild on the Pi. So the pack's version key
only moves when decompositions have been left alone for PACK_DELAY: twenty
accepts in a row cause one rebuild, not twenty.
"""

from __future__ import annotations

import functools
import hashlib
import json
import re
import sqlite3
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import auth, bg_overlay, decomp_sources, forms, scope, store
from .db import query, query_one
from .errors import AppError
from .routes.graph import children_of, parents_map, parents_of
from .routes.search import _fetch_words

ROOT = Path(__file__).parent.parent
REVIEW_DIR = ROOT / "data" / "review"
DB = REVIEW_DIR / "review.db"
LEGACY = REVIEW_DIR / "review.json"  # the store before review.db; read once, then renamed
EXPORTS = {
    "decomposition": ROOT / "data" / "decomp_overrides.json",
    "form_link": ROOT / "data" / "form_overrides.json",
    "meaning": ROOT / "data" / "meaning_groups.json",
    "part_meaning": ROOT / "data" / "part_meanings.json",
}

TYPES = ("decomposition", "form_link", "part_meaning", "kanji_senses", "word_sense", "bg", "report")
# The three types a character's card decides together; the queue lists them as one stage.
CHARACTER_TYPES = ("decomposition", "form_link", "part_meaning")
CHARACTER = "character"

# A report that something is wrong that no card or edit can fix: a word's
# English (JMdict's), a kanji's dictionary meanings or readings, its levels,
# its similar kanji -- in the reporter's words. It changes nothing on the site:
# those come from reference dictionaries, so a reviewer checks the report, and
# a real mistake is logged in DATA-ISSUES.md and sent upstream to be fixed at
# the source (Dani, 2026-10-05; widened from the English alone 2026-10-06).
REPORT_MAX = 1000
REPORT_ABOUT = {
    "word": ("english", "reading", "other"),
    "kanji": ("meanings", "readings", "levels", "parts", "forms", "similar", "strokes", "other"),
}
ORIGINS = ("proposal", "suggestion")
# keep: leave it as it is now. A check with nothing proposed is kept when
# today's value is right; a proposal is kept-against when today's beats it.
# Unlike reject, it says what the reviewer meant: the value stays, on purpose.
ACTIONS = ("accept", "edit", "keep", "reject", "skip")
CATCH_ALL = "catch-all"
FORM_KINDS = (*forms.KINDS, "none")
# A link of these kinds reads one way: subject X|Y says "Y is the old form of
# X", "X is a form of Y", "X looks like Y". `reverse` reads it from Y to X, so
# a reviewer can turn a link round without a new item. The others are symmetric.
ONE_WAY = ("old", "form_of", "looks_like")
# A part with no meaning in the dictionary (D-015) gets one of two things: its
# own meaning, when it is a real character that means something where it is
# used (夋, 堇, 劦), or a name for its shape, when several unrelated old parts
# merged into it and no one meaning is true in all its kanji (丷 is 八 in 半,
# grains in 米, hair in 首). A shape's name is shown as a name, never as a meaning.
PART_KINDS = ("meaning", "shape")
# What a decision changed: these can be reverted. skip/reject change nothing.
CHANGES = ("accept", "edit", "direct", "auto", "revert", "reopen")

MAX_OPEN_SUGGESTIONS = 20
MAX_TEXT = 500
PACK_DELAY = 600.0  # seconds of quiet after a decomposition before the offline pack rebuilds

STROKES = set("一丨丶丿乙亅乚㇒㇏")
SENSE_ID = re.compile(r"^[a-z0-9-]{1,24}$")

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_state: dict | None = None
_version: int | None = None
_pack_timer: threading.Timer | None = None


def use_dir(path: Path) -> None:
    """Keep the review state somewhere else (tests/sandbox.py)."""
    global REVIEW_DIR, DB, LEGACY, _conn, _state
    with _lock:
        if _conn is not None:
            _conn.close()
        REVIEW_DIR, DB, LEGACY = path, path / "review.db", path / "review.json"
        _conn = _state = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _empty() -> dict:
    return {
        "items": {},
        "decisions": [],
        "live": {"form_link": {}, "part_meaning": {}, "kanji_senses": {}, "word_sense": {}, "bg": {}},
        "pack_key": None,
    }


# ---------------------------------------------------------------- storage


# data/review/review.db (SQLite, not the swapped data DB): a row per item, per
# decision and per live entry, so a decision writes the few rows it touched.
# The whole state is also kept in memory, read once, and everything reads it
# there; another process's commit (a loader) is noticed and read again.
SCHEMA = """
CREATE TABLE IF NOT EXISTS item (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS live (
    type TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (type, subject));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def _dump(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def _db() -> sqlite3.Connection:
    """The connection, opened once; the caller holds _lock."""
    global _conn
    if _conn is None:
        REVIEW_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB, timeout=30, isolation_level=None, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")
        conn.executescript(SCHEMA)
        _conn = conn
        _migrate(conn)
    return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    """The first time: everything in the old review.json moves in, and the file is renamed."""
    if not LEGACY.exists():
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        if conn.execute("SELECT 1 FROM item UNION ALL SELECT 1 FROM decision LIMIT 1").fetchone():
            conn.execute("ROLLBACK")
            return
        data = {**_empty(), **json.loads(LEGACY.read_text(encoding="utf-8"))}
        for k, v in _empty()["live"].items():
            data["live"].setdefault(k, v)
        _write(conn, _empty(), {
            **data,
            "_dirty": {"items": dict.fromkeys(data.get("items", {})), "decisions": {},
                       "live": {(t, s) for t, entries in data["live"].items() for s in entries}},
        })
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    LEGACY.replace(LEGACY.with_suffix(".json.migrated"))


def _fetch(conn: sqlite3.Connection) -> dict:
    data = _empty()
    items = data["items"]
    for (body,) in conn.execute("SELECT body FROM item ORDER BY seq"):
        i = json.loads(body)
        items[i["id"]] = i
    data["decisions"] = [json.loads(b) for (b,) in conn.execute("SELECT body FROM decision ORDER BY seq")]
    for t, s, body in conn.execute("SELECT type, subject, body FROM live"):
        data["live"].setdefault(t, {})[s] = json.loads(body)
    row = conn.execute("SELECT value FROM meta WHERE key = 'pack_key'").fetchone()
    data["pack_key"] = row[0] if row else None
    return data


def _current() -> dict:
    """The state in memory, read again if another process committed since; the caller holds _lock."""
    global _state, _version
    conn = _db()
    v = conn.execute("PRAGMA data_version").fetchone()[0]
    if _state is None or v != _version:
        _state, _version = _fetch(conn), v
    return _state


def _read() -> dict:
    """For reading only: shared, never mutate it."""
    with _lock:
        return _current()


@contextmanager
def _change():
    """For changing: a copy to change, written when the block ends, as one transaction.

    The copy shares items and decisions with the state readers see, so
    neither is changed in place: `_update`, `_update_decision` and
    `_set_live` put changed copies in, and mark them to be written. Only the
    containers are copied (a few ms), so a reader never sees one grow under
    it, and a block that raises leaves the state as it was.
    """
    global _state
    with _lock:
        conn = _db()
        conn.execute("BEGIN IMMEDIATE")  # other processes wait; their commits are read first
        try:
            base = _current()
            work = {
                **base,
                "items": dict(base["items"]),
                "decisions": list(base["decisions"]),
                "live": {k: dict(v) for k, v in base["live"].items()},
                "_dirty": {"items": {}, "decisions": {}, "live": set()},
            }
            yield work
            _write(conn, base, work)
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        _state = work


def _write(conn: sqlite3.Connection, base: dict, work: dict) -> None:
    """The rows `work` changed from `base`: decisions are only ever added, the rest as marked."""
    dirty = work.pop("_dirty")
    conn.executemany(
        "INSERT INTO item (id, type, subject, status, body) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT (id) DO UPDATE SET status = excluded.status, body = excluded.body",
        [(i["id"], i["type"], i["subject"], i["status"], _dump(i)) for i in map(work["items"].__getitem__, dirty["items"])],
    )
    conn.executemany(
        "INSERT INTO decision (id, type, subject, action, body) VALUES (?, ?, ?, ?, ?)",
        [(d["id"], d["type"], d["subject"], d["action"], _dump(d)) for d in work["decisions"][len(base["decisions"]):]],
    )
    conn.executemany("UPDATE decision SET body = ? WHERE id = ?", [(_dump(d), d["id"]) for d in dirty["decisions"].values()])
    gone, there = [], []
    for t, s in dirty["live"]:
        entry = work["live"][t].get(s)
        if entry is None:
            gone.append((t, s))
        else:
            there.append((t, s, _dump(entry)))
    conn.executemany("DELETE FROM live WHERE type = ? AND subject = ?", gone)
    conn.executemany("INSERT INTO live (type, subject, body) VALUES (?, ?, ?) "
                     "ON CONFLICT (type, subject) DO UPDATE SET body = excluded.body", there)
    if work["pack_key"] != base["pack_key"]:
        conn.execute("INSERT INTO meta (key, value) VALUES ('pack_key', ?) "
                     "ON CONFLICT (key) DO UPDATE SET value = excluded.value", (work["pack_key"],))


def _put(data: dict, item: dict) -> dict:
    data["items"][item["id"]] = item
    data["_dirty"]["items"][item["id"]] = None
    return item


def _update(data: dict, item: dict, **fields) -> dict:
    """`item` with `fields` changed, as a new dict in its place (see _change)."""
    return _put(data, {**item, **fields})


def _update_decision(data: dict, d: dict, **fields) -> dict:
    new = {**d, **fields}
    ds = data["decisions"]
    ds[next(k for k in range(len(ds) - 1, -1, -1) if ds[k] is d)] = new
    data["_dirty"]["decisions"][new["id"]] = new
    return new


def _set_live(data: dict, type_: str, subject: str, entry: dict | None) -> None:
    if entry is None:
        data["live"][type_].pop(subject, None)
    else:
        data["live"][type_][subject] = entry
    data["_dirty"]["live"].add((type_, subject))


def backup(dest: Path) -> None:
    """A consistent copy of the store, safe while the server runs."""
    with _lock:
        out = sqlite3.connect(dest)
        try:
            _db().backup(out)
        finally:
            out.close()


# ---------------------------------------------------------------- the graph, for checks and impact


def _known(char: str) -> bool:
    return bool(
        query_one("SELECT 1 FROM kanji WHERE char = ?", (char,))
        or query_one("SELECT 1 FROM edge WHERE child = ? OR parent = ? LIMIT 1", (char, char))
    )


def _children(char: str) -> list[str]:
    return children_of([char]).get(char, [])


def _closure(start: list[str], skip: str | None = None) -> set[str]:
    """Everything below `start`, any depth; `skip` is never walked through."""
    seen: set[str] = set()
    level = [c for c in start if c != skip]
    while level:
        seen.update(level)
        nxt = []
        for kids in children_of(level).values():
            nxt.extend(k for k in kids if k not in seen and k != skip)
        level = list(dict.fromkeys(nxt))
    return seen


def _ancestors(char: str) -> set[str]:
    seen: set[str] = set()
    level = [char]
    while level:
        nxt = []
        for c in level:
            for p in parents_of(c):
                if p not in seen and p != char:
                    seen.add(p)
                    nxt.append(p)
        level = nxt
    return seen


def impact(char: str, parts: list[str]) -> dict:
    """What changing `char`'s parts to `parts` would do, for the reviewer to see first.

    Containment upstream: what `char` -- and so everything containing it --
    gains or loses as a prerequisite; how many kanji contain it; and the
    public notes on it or above it that mention a part it would lose.
    """
    old = _children(char)
    below_old = _closure(old, skip=char)
    below_new = _closure(parts, skip=char)
    lost, gained = sorted(below_old - below_new), sorted(below_new - below_old)
    above = _ancestors(char)
    rows = []
    if above:
        marks = ",".join("?" * len(above))
        rows = query(
            f"SELECT char, joyo, freq FROM kanji WHERE char IN ({marks}) ORDER BY freq IS NULL, freq",
            tuple(above),
        )
    notes = []
    if lost:
        data = store._read()
        watch = {char, *above}
        for a in data["associations"].values():
            if a["char"] in watch and a.get("visibility") == "public":
                hit = [c for c in lost if c in a.get("text", "")]
                if hit:
                    notes.append({"id": a["id"], "char": a["char"], "mentions": hit, "text": a["text"][:140]})
    return {
        "char": char,
        "before": old,
        "after": parts,
        "removed": [c for c in old if c not in parts],
        "added": [c for c in parts if c not in old],
        "lost": lost,
        "gained": gained,
        "newEdge": bool(gained),
        "containers": len(above),
        "containersJoyo": sum(1 for r in rows if r["joyo"]),
        "topContainers": [r["char"] for r in rows[:24]],
        "notes": notes[:20],
        "notesTotal": len(notes),
    }


# ---------------------------------------------------------------- the four types


def _bad(code: str, detail: str, **params) -> AppError:
    return AppError(400, code, detail, **params)


def _bad_words() -> AppError:
    return _bad("words_invalid", "words are a map of word id to group")


def _known_type(type_: str, character: bool = False) -> None:
    if type_ not in TYPES and not (character and type_ == CHARACTER):
        raise _bad("bad_type", "unknown task type")


def _known_origin(origin: str) -> None:
    if origin not in ORIGINS:
        raise _bad("bad_origin", "origin is proposal or suggestion")


@functools.lru_cache(maxsize=256)
def _word_ids(char: str) -> frozenset[int]:
    """The words written with `char`, read once per kanji (the database does not
    change under a running server): word_char is indexed by char only, so asking
    word by word scanned all of 国's for each word on its board."""
    return frozenset(r["word_id"] for r in query("SELECT word_id FROM word_char WHERE char = ?", (char,)))


def _split(subject: str, n: int = 2) -> list[str]:
    parts = subject.split("|")
    if len(parts) != n or not all(parts):
        raise _bad("bad_subject", "that is not a subject of this type")
    return parts


def _char(subject: str) -> str:
    """The kanji of a meanings subject: 生 itself, or the 生 of 生|1234567."""
    return subject.split("|")[0]


def _word_of(subject: str) -> int:
    """The word of a word_sense subject, 生|1234567."""
    return int(subject.split("|")[1])


def _target(subject: str) -> tuple[str, str]:
    """A Bulgarian card's or a report's subject, word:1234567 or kanji:生, as (kind, key)."""
    kind, _, key = subject.partition(":")
    return kind, key


def _text(reason: str | None) -> str | None:
    return (reason or "").strip()[:MAX_TEXT] or None


def _senses(data: dict, char: str) -> list[dict] | None:
    """A kanji's accepted meaning groups."""
    return (data["live"]["kanji_senses"].get(char) or {}).get("senses")


def _placed(data: dict, subject: str) -> str | None:
    """The group a word is accepted in (subject 生|1234567)."""
    return (data["live"]["word_sense"].get(subject) or {}).get("sense")


def _placements(data: dict, char: str) -> dict[int, str]:
    """word id -> group, for this kanji's accepted words."""
    prefix = f"{char}|"
    return {int(k[len(prefix):]): v["sense"] for k, v in data["live"]["word_sense"].items() if k.startswith(prefix)}


def validate(type_: str, subject: str, value: Any, data: dict | None = None, pending_ok: bool = False,
             machine: bool = False) -> Any:
    """`value` cleaned, or an AppError saying what is wrong with it. None clears an override.

    `machine`: the value comes from a data source or a model, not a person. A
    bare stroke as a part is refused only then -- sources chop real parts into
    strokes (口 -> 丨一) -- while a reviewer may decide a stroke means
    something in a character (the flame 丶 on 主), as people suggesting may.

    `pending_ok`: a word's meaning may be proposed before its kanji's meanings
    are accepted (the AI drafts both at once); it waits, out of the queue, until they are.
    """
    _known_type(type_)
    data = data or _read()

    if type_ == "decomposition":
        if len(subject) != 1:
            raise _bad("bad_subject", "a decomposition is of one character")
        if value is None:
            return None
        if not isinstance(value, list) or any(not isinstance(c, str) or len(c) != 1 for c in value):
            raise _bad("parts_invalid", "parts must be single characters")
        parts = list(dict.fromkeys(value))  # 品 is 口 once: repeats collapse by design
        if subject in parts:
            raise _bad("parts_self", "a character cannot contain itself")
        strokes = [c for c in parts if c in STROKES]
        if strokes and machine:
            raise _bad("parts_stroke", "a bare stroke is not a part: {parts}", parts="".join(strokes))
        unknown = [c for c in parts if not _known(c)]
        if unknown:
            raise _bad("parts_unknown", "not in the graph: {parts}", parts="".join(unknown))
        loops = [c for c in parts if subject in _closure([c])]
        if loops:
            raise _bad("parts_cycle", "{parts} already contains this character", parts="".join(loops))
        return parts

    if type_ == "form_link":
        a, b = _split(subject)
        if len(a) != 1 or len(b) != 1 or a == b:
            raise _bad("bad_subject", "a form link joins two different characters")
        if value is None:
            return None
        if not isinstance(value, dict) or value.get("kind") not in FORM_KINDS:
            raise _bad("form_kind", "kind must be one of positional, old, form_of, looks_like, kin, none")
        note = (value.get("note") or "").strip()[:300] or None
        if value["kind"] == "form_of" and not note:
            # The rule: a form_of needs historical support, and the note is where it goes.
            raise _bad("form_evidence", "say where this comes from: the old form, or a reference")
        out = {"kind": value["kind"], "note": note}
        if value.get("reverse") is True and value["kind"] in ONE_WAY:
            out["reverse"] = True  # only when set, so an unturned link equals what it always was
        return out

    if type_ == "part_meaning":
        if len(subject) != 1 or not _known(subject):
            raise _bad("bad_subject", "a part meaning is of one character in the graph")
        if value is None:
            return None
        if not isinstance(value, dict) or value.get("kind") not in PART_KINDS:
            raise _bad("part_kind", "kind must be meaning or shape")
        en = " ".join(str(value.get("en") or "").split())
        if not en or len(en) > 40 or len(en.split()) > 5:
            raise _bad("part_label", "the meaning or the shape's name is 1 to 5 words")

        def text(k: str, n: int) -> str | None:
            return " ".join(str(value.get(k) or "").split())[:n] or None

        return {"kind": value["kind"], "en": en, "bg": text("bg", 40), "note": text("note", 400), "noteBg": text("noteBg", 400)}

    if type_ == "kanji_senses":
        if len(subject) != 1:
            raise _bad("bad_subject", "senses are of one kanji")
        if value is None:
            return None
        # One is enough for a kanji with one meaning (楓, maple); more than six is a list, not groups.
        if not isinstance(value, list) or not 1 <= len(value) <= 6:
            raise _bad("senses_count", "a kanji has 1 to 6 meanings here, the catch-all aside")
        out, ids = [], set()
        for s in value:
            if not isinstance(s, dict):
                raise _bad("senses_invalid", "each meaning needs an id and an English label")
            sid = str(s.get("id", "")).strip().lower().removeprefix(f"{subject}.")
            en = (s.get("en") or "").strip()
            if not SENSE_ID.match(sid) or sid == CATCH_ALL or sid in ids:
                raise _bad("senses_id", "each meaning needs its own short id: a-z, 0-9 and -")
            if not en or len(en) > 40 or len(en.split()) > 4:
                raise _bad("senses_label", "a meaning's label is 1 to 4 words")
            ids.add(sid)
            out.append({
                "id": f"{subject}.{sid}",
                "en": en,
                "bg": (s.get("bg") or "").strip()[:40] or None,
                "note": (s.get("note") or "").strip()[:200] or None,
                "noteBg": (s.get("noteBg") or "").strip()[:200] or None,
            })
        return out

    if type_ == "bg":
        kind, key = _target(subject)
        if kind == "word" and key.isdigit():
            n = query_one("SELECT COUNT(*) AS n FROM sense WHERE word_id = ?", (int(key),))["n"]
            if not n:
                raise _bad("bad_subject", "no such word")
            if value is None:
                return None
            if not isinstance(value, list) or len(value) != n or any(not isinstance(g, str) for g in value):
                raise _bad("bg_invalid", "one Bulgarian gloss per sense")
            out = [" ".join(g.split())[:400] for g in value]
            if not any(out):
                raise _bad("bg_invalid", "one Bulgarian gloss per sense")
            return out
        if kind == "kanji" and len(key) == 1:
            if value is None:
                return None
            if not isinstance(value, list) or any(not isinstance(m, str) for m in value):
                raise _bad("bg_invalid", "one Bulgarian gloss per sense")
            out = [" ".join(m.split())[:60] for m in value]
            out = [m for m in out if m]
            if not 1 <= len(out) <= 12:
                raise _bad("bg_meanings", "a kanji has 1 to 12 Bulgarian meanings")
            return out
        raise _bad("bad_subject", "that is not a subject of this type")

    if type_ == "report":
        kind, key = _target(subject)
        if kind == "word":
            if not key.isdigit() or not query_one("SELECT 1 AS x FROM word WHERE id = ?", (int(key),)):
                raise _bad("bad_subject", "no such word")
        elif kind != "kanji" or len(key) != 1 or not _known(key):
            raise _bad("bad_subject", "a report is about a word or a character")
        if value is None:
            return None
        if not isinstance(value, dict) or value.get("about") not in REPORT_ABOUT[kind]:
            raise _bad("report_about", "say what the report is about")
        text = " ".join(str(value.get("text") or "").split())
        if len(text) < 3:
            raise _bad("report_empty", "say what is wrong")
        return {"about": value["about"], "text": text[:REPORT_MAX]}

    # word_sense
    char, wid = _split(subject)
    if len(char) != 1 or not wid.isdigit():
        raise _bad("bad_subject", "a word sense is a kanji and a word id")
    if int(wid) not in _word_ids(char):
        raise _bad("word_not_with", "that word is not written with this kanji")
    if value is None:
        return None
    senses = _senses(data, char)
    if not senses:
        if pending_ok and isinstance(value, str) and (value == CATCH_ALL or value.startswith(f"{char}.")):
            return value
        raise AppError(409, "senses_not_accepted", "this kanji's meanings are not accepted yet")
    ids = {s["id"] for s in senses} | {CATCH_ALL}
    if value not in ids:
        raise _bad("sense_unknown", "not one of this kanji's meanings")
    return value


def live_value(type_: str, subject: str, data: dict | None = None) -> Any:
    """The overlay's value for the subject, None when nothing overrides the built data."""
    if type_ == "report":
        return None  # a report is never live
    if type_ == "decomposition":
        ov = store.decomposition_overrides().get(subject)
        return list(ov) if ov is not None else None
    data = data or _read()
    entry = data["live"][type_].get(subject)
    if entry is None:
        return None
    if type_ == "form_link":
        return {k: v for k, v in entry.items() if k != "decision"}
    if type_ == "part_meaning":
        return {k: v for k, v in entry.items() if k != "decision"}
    if type_ == "kanji_senses":
        return entry["senses"]
    if type_ == "bg":
        return entry["value"]
    return entry["sense"]


def current(type_: str, subject: str, data: dict | None = None) -> Any:
    """What the site shows now: the overlay, or the built data under it."""
    if type_ == "decomposition":
        return _children(subject)
    if type_ == "form_link":
        a, b = subject.split("|")
        links = [r for r in forms.links_of(a) if {r["char"], r["other"]} == {a, b}]
        mine = [r for r in links if r["char"] == a] or links
        if not mine:
            return {"kind": "none", "note": None}
        r = mine[0]
        out = {"kind": r["kind"], "note": r["note"]}
        if r["char"] == b and r["kind"] in ONE_WAY:
            out["reverse"] = True  # built the other way round: 靑 is the old form of 青, asked as 靑|青
        return out
    if type_ == "bg":
        return _bg_shown(subject)
    return live_value(type_, subject, data)


def _bg_built(subject: str) -> list[str] | None:
    """The machine-translated Bulgarian a card starts from, as built."""
    kind, key = _target(subject)
    if kind == "word":
        rows = query("SELECT s.ord, b.gloss FROM sense s LEFT JOIN sense_bg b ON b.word_id = s.word_id AND b.ord = s.ord "
                     "WHERE s.word_id = ? ORDER BY s.ord", (int(key),))
        return [r["gloss"] or "" for r in rows] or None
    r = query_one("SELECT meanings FROM kanji_bg WHERE char = ?", (key,))
    return json.loads(r["meanings"]) if r else None


def _bg_shown(subject: str) -> list[str] | None:
    """What the site shows now: reviewed, else built."""
    kind, key = _target(subject)
    if kind == "word":
        wid = int(key)
        built = _bg_built(subject) or []
        return [bg_overlay.gloss(wid, i, g) or "" for i, g in enumerate(built)]
    return bg_overlay.kanji(key, None) or _bg_built(subject)


def _apply(data: dict, type_: str, subject: str, value: Any, decision: str, explicit_words: bool = False) -> None:
    """Make `value` live (None: back to the built data). The caller saves.

    `explicit_words`: the reviewer placed the kanji's words themselves (the
    meanings board), so none are reopened or auto-accepted behind their back.
    """
    if type_ == "report":
        return  # confirmed or not, the site stays as its sources have it
    if type_ == "decomposition":
        if value is None:
            store.clear_decomposition(subject)
        else:
            store.set_decomposition(subject, value)
        _schedule_pack()
        return
    if type_ == "bg":
        _set_live(data, "bg", subject, None if value is None else {"value": value, "decision": decision})
        _bg_live(subject, value)
        _schedule_pack()
        return
    if value is None:
        _set_live(data, type_, subject, None)
    elif type_ in ("form_link", "part_meaning"):
        _set_live(data, type_, subject, {**value, "decision": decision})
    elif type_ == "kanji_senses":
        before = _senses(data, subject) or []
        _set_live(data, type_, subject, {"senses": value, "decision": decision})
        if not explicit_words:
            _reopen_words(data, subject, before, value, decision)
            _auto_words(data, subject, value)
    else:
        _set_live(data, type_, subject, {"sense": value, "decision": decision})


def _bg_live(subject: str, value: list[str] | None) -> None:
    """Show reviewed Bulgarian at once, everywhere it is read (server/bg_overlay.py)."""
    kind, key = _target(subject)
    if kind == "word":
        bg_overlay.set_word(int(key), value)
        return
    bg_overlay.set_kanji(key, value)
    from . import recognize

    if key in recognize._meta:  # handwriting candidates carry the meanings too
        freq, meanings, _ = recognize._meta[key]
        recognize._meta[key] = (freq, meanings, value or _bg_built(subject))


def load_bg_overlay() -> None:
    """At startup: the reviewed Bulgarian in the store becomes what pages show."""
    words, kanji = {}, {}
    for subject, entry in _read()["live"]["bg"].items():
        kind, key = _target(subject)
        if kind == "word":
            words[int(key)] = entry["value"]
        else:
            kanji[key] = entry["value"]
    bg_overlay.load(words, kanji)


def _reopen_words(data: dict, char: str, before: list[dict], after: list[dict], decision: str) -> None:
    """A sense split, merged, renamed or deleted: its words go back to the queue.

    Splitting a group usually keeps its id for one half and relabels it, so a
    changed English label counts as a change too; a pure rename reopens
    needlessly, which is the safe way round.
    """
    now = {s["id"]: s["en"] for s in after}
    changed = {s["id"] for s in before if now.get(s["id"]) != s["en"]}
    if not changed:
        return
    ws = data["live"]["word_sense"]
    for subject in [k for k, v in ws.items() if k.startswith(f"{char}|") and v["sense"] in changed]:
        old = ws[subject]
        _set_live(data, "word_sense", subject, None)
        data["decisions"].append(_decision(
            "reopen", "word_sense", subject, old["sense"], None, "auto", None,
            f"its meaning group changed in {decision}",
        ))
        item = _latest_item(data, "word_sense", subject)
        if item:
            _reopen_item(data, item)
        else:
            _new_item(data, "word_sense", subject, None, "reopened", "proposal", None, None, "auto", 0.0)


AUTO_CONFIDENCE = 0.8


def word_rule(item: dict, accepted_ids: set[str]) -> bool:
    """TASK §6 for a word's meaning: two independent runs agree, both are
    confident, and their pick is one of the kanji's accepted groups."""
    return _runs_agree(item) and item["proposed"] in accepted_ids | {CATCH_ALL}


def _auto_words(data: dict, char: str, senses: list[dict]) -> None:
    """Once a kanji's groups are accepted, its words that pass the rule go live, as "auto"."""
    ids = {s["id"] for s in senses}
    for item in list(data["items"].values()):
        if item["type"] != "word_sense" or item["status"] != "open" or not item["subject"].startswith(f"{char}|"):
            continue
        if not word_rule(item, ids):
            continue
        before = live_value("word_sense", item["subject"], data)
        d = _decision("auto", "word_sense", item["subject"], before, item["proposed"], "auto", item["id"],
                      "two runs agree, both confident")
        _set_live(data, "word_sense", item["subject"], {"sense": item["proposed"], "decision": d["id"]})
        _close(data, item, "auto-accepted", d)
        data["decisions"].append(d)


# ---------------------------------------------------------------- items and decisions


def _decision(action: str, type_: str, subject: str, before: Any, after: Any, by: str,
              item: str | None, reason: str | None, supersedes: str | None = None) -> dict:
    return {
        "id": f"d-{uuid.uuid4().hex[:12]}",
        "action": action,
        "type": type_,
        "subject": subject,
        "before": before,
        "after": after,
        "by": by,
        "at": _now(),
        "item": item,
        "reason": reason,
        "supersedes": supersedes,
        "reverted_by": None,
    }


def _latest_item(data: dict, type_: str, subject: str) -> dict | None:
    mine = [i for i in data["items"].values() if i["type"] == type_ and i["subject"] == subject]
    return max(mine, key=lambda i: i["created"]) if mine else None


def _close(data: dict, item: dict, status: str, d: dict) -> dict:
    """`item` decided by `d`: accepted, edited, rejected or auto-accepted."""
    return _update(data, item, status=status, decided_by=d["by"], decided_at=d["at"], decision=d["id"])


def _reopen_item(data: dict, item: dict) -> dict:
    return _update(data, item, status="open", decided_by=None, decided_at=None, decision=None, skipped_by=[])


def _moves_of(item: dict) -> dict | None:
    """A suggestion's word moves, from the page's board (see _moves)."""
    ev = item.get("evidence")
    return ev.get("moves") if isinstance(ev, dict) else None


def _new_item(data: dict, type_: str, subject: str, proposed: Any, source: str, origin: str,
              reason: str | None, evidence: Any, by: str, priority: float, **extra) -> dict:
    item = {
        "id": f"i-{uuid.uuid4().hex[:12]}",
        "type": type_,
        "subject": subject,
        "proposed": proposed,
        "source": source,
        "origin": origin,
        "reason": reason,
        "evidence": evidence,
        "priority": priority,
        "status": "open",
        "created": _now(),
        "created_by": by,
        "decided_by": None,
        "decided_at": None,
        "decision": None,
        "skipped_by": [],
        **extra,
    }
    return _put(data, item)


def add_item(type_: str, subject: str, proposed: Any, source: str, origin: str = "proposal",
             reason: str | None = None, evidence: Any = None, by: str = "system",
             priority: float = 0.0, **extra) -> dict:
    """Put a change in the queue; an identical open one is returned instead of a twin."""
    _known_origin(origin)
    with _change() as data:
        proposed = validate(type_, subject, proposed, data, pending_ok=origin == "proposal", machine=origin == "proposal")
        moves = evidence.get("moves") if isinstance(evidence, dict) else None
        if moves is not None:
            moves = _moves(subject, proposed, moves)
            evidence = {**evidence, "moves": moves}
        for i in data["items"].values():
            if (i["status"] == "open" and i["type"] == type_ and i["subject"] == subject and i["proposed"] == proposed
                    and _moves_of(i) == moves):
                return dict(i)
        if origin == "suggestion":
            mine = sum(1 for i in data["items"].values() if i["status"] == "open" and i["created_by"] == by)
            if mine >= MAX_OPEN_SUGGESTIONS:
                raise AppError(429, "too_many_suggestions", "you have {n} suggestions waiting already", n=mine)
        item = _new_item(data, type_, subject, proposed, source, origin, _text(reason), evidence, by, priority, **extra)
        return dict(item)


def _moves(char: str, groups: Any, moves: Any) -> dict[str, str | None]:
    """A suggestion's word moves, cleaned: word id (as text) -> one of the
    suggested groups, the catch-all, or None (in no group)."""
    if not isinstance(moves, dict) or len(moves) > 5000:
        raise _bad_words()
    ids = {g["id"] for g in groups or []} | {CATCH_ALL}
    known = _word_ids(char)
    out = {}
    for k, v in moves.items():
        if not str(k).isdigit() or int(k) not in known or not (v is None or v in ids):
            raise _bad_words()
        out[str(k)] = v
    return out


def add_items(rows: list[dict]) -> tuple[int, int]:
    """Many proposals at once, for loaders: one read and one write, not one per item.

    Each row is add_item's arguments as a dict. Returns (added, refused): a
    row that fails validation is skipped and counted, not raised.
    """
    with _change() as data:
        open_keys = {
            (i["type"], i["subject"], json.dumps(i["proposed"], sort_keys=True, ensure_ascii=False))
            for i in data["items"].values() if i["status"] == "open"
        }
        added = refused = 0
        for r in rows:
            try:
                proposed = validate(r["type"], r["subject"], r.get("proposed"), data, pending_ok=True, machine=True)
            except AppError:
                refused += 1
                continue
            key = (r["type"], r["subject"], json.dumps(proposed, sort_keys=True, ensure_ascii=False))
            if key in open_keys:
                continue
            open_keys.add(key)
            _new_item(data, r["type"], r["subject"], proposed, r["source"], "proposal",
                      _text(r.get("reason")), r.get("evidence"), "system", r.get("priority", 0.0))
            added += 1
        return added, refused


def attach_evidence(key: str, by_item: dict[str, Any]) -> int:
    """Put a second source's view beside open items' own evidence, under `key`;
    the proposal itself is not touched. Returns how many items changed (one
    already carrying the same value, or decided meanwhile, is left alone)."""
    with _change() as data:
        n = 0
        for item_id, value in by_item.items():
            i = data["items"].get(item_id)
            if not i or i["status"] != "open":
                continue
            ev = i["evidence"] if isinstance(i["evidence"], dict) else {}
            if ev.get(key) == value:
                continue
            _update(data, i, evidence={**ev, key: value})
            n += 1
        return n


def drop_evidence(key: str, item_ids: list[str]) -> int:
    """Take a second source's view off open items it no longer applies to."""
    with _change() as data:
        n = 0
        for item_id in item_ids:
            i = data["items"].get(item_id)
            if i and i["status"] == "open" and isinstance(i["evidence"], dict) and key in i["evidence"]:
                _update(data, i, evidence={k: v for k, v in i["evidence"].items() if k != key})
                n += 1
        return n


def restate(rows: dict[str, dict]) -> tuple[int, int]:
    """A source re-read: its open, undecided proposals take the new proposal,
    reason, evidence and priority (item id -> add_items row). Returns
    (changed, refused); a row that no longer validates leaves its item as it was."""
    with _change() as data:
        changed = refused = 0
        for item_id, r in rows.items():
            i = data["items"].get(item_id)
            if not i or i["status"] != "open" or i["origin"] != "proposal":
                continue
            try:
                proposed = validate(i["type"], i["subject"], r.get("proposed"), data, pending_ok=True, machine=True)
            except AppError:
                refused += 1
                continue
            new = {"proposed": proposed, "reason": _text(r.get("reason")), "evidence": r.get("evidence"),
                   "priority": r.get("priority", 0.0)}
            if any(i.get(k) != v for k, v in new.items()):
                _update(data, i, **new)
                changed += 1
        return changed, refused


def withdraw(item_ids: list[str], why: str) -> int:
    """Open proposals their source no longer makes (a misread corrected): out
    of the queue as `withdrawn`. Nothing was decided, so nothing is undone,
    and the item stays on record."""
    with _change() as data:
        n = 0
        for item_id in item_ids:
            i = data["items"].get(item_id)
            if i and i["status"] == "open" and i["origin"] == "proposal":
                _update(data, i, status="withdrawn", withdrawn_at=_now(), withdrawn_why=_text(why))
                n += 1
        return n


FOLLOW_UP_PRIORITY = -1.0  # below everything else: the end of the queue


def decide(item_id: str, action: str, user_id: str, value: Any = None, reason: str | None = None,
           words: dict | None = None, skip: dict | None = None, labels: dict | None = None,
           notes: dict | None = None) -> dict:
    """`words`, for a kanji's meanings: word id -> group id (None: in no group),
    as the reviewer left them on the board. Each becomes a decision of its own,
    under this one, and is reverted with it.

    `labels`, for a kanji's Bulgarian card: group id -> its Bulgarian label;
    `notes` likewise, its Bulgarian note.
    Bulgarian is labelled in the Bulgarian stage, not on the meanings board,
    so the groups' labels are set here, as a decision under this one.

    `skip`: the words the reviewer was not sure of, word id -> where they had
    it so far. They are left undecided and come back together as a follow-up
    item for the same kanji at the end of the queue, groups fixed, only them.
    """
    with _change() as data:
        return _decide(data, item_id, action, user_id, value, _text(reason), words, skip, labels, notes)


def _decide(data: dict, item_id: str, action: str, user_id: str, value: Any = None, reason: str | None = None,
            words: dict | None = None, skip: dict | None = None, labels: dict | None = None,
            notes: dict | None = None) -> dict:
    """decide() inside a change already open: a character's card decides several items in one."""
    if action not in ACTIONS:
        raise _bad("bad_action", "action is accept, edit, keep, reject or skip")
    item = data["items"].get(item_id)
    if not item:
        raise AppError(404, "item_not_found", "no such item")
    if item["status"] != "open":
        raise AppError(409, "item_closed", "this item was already decided")
    type_, subject = item["type"], item["subject"]

    if action == "skip":
        if user_id not in item["skipped_by"]:
            item = _update(data, item, skipped_by=[*item["skipped_by"], user_id])
        return dict(item)

    if action in ("reject", "keep"):
        # Nothing changes either way; "keep" says today's value is right, on purpose.
        d = _decision(action, type_, subject, None, None, user_id, item_id, reason)
        item = _close(data, item, "rejected" if action == "reject" else "kept", d)
        data["decisions"].append(d)
        return dict(item)

    if action == "accept" and item["proposed"] is None:
        raise _bad("needs_edit", "this item has no proposal to accept; pick a value")
    after = validate(type_, subject, item["proposed"] if action == "accept" else value, data)
    if after is None:
        raise _bad("needs_value", "pick a value")
    before = live_value(type_, subject, data)
    explicit = _on_the_board(type_, words)
    d = _decision(action, type_, subject, before, after, user_id, item_id, reason)
    _apply(data, type_, subject, after, d["id"], explicit_words=explicit)
    item = _close(data, item, "accepted" if action == "accept" else "edited", d)
    data["decisions"].append(d)
    if explicit:
        held = _skipped(skip)
        _place_words(data, subject, {k: v for k, v in words.items() if str(k) not in held}, user_id, d["id"])
        if held:
            _new_item(data, "kanji_senses", subject, after, f"skipped:{d['id']}", "proposal",
                      f"{len(held)} words left for later", {"words": held}, user_id, FOLLOW_UP_PRIORITY)
    if type_ == "bg" and (labels or notes) and subject.startswith("kanji:"):
        _label_groups(data, _target(subject)[1], labels or {}, user_id, d["id"], notes or {})
    return dict(item)


def _label_groups(data: dict, char: str, labels: Any, user_id: str, parent: str, notes: Any = None) -> None:
    """Set the Bulgarian labels and notes of a kanji's accepted groups (a decision under `parent`)."""
    notes = notes or {}
    if not isinstance(labels, dict) or not isinstance(notes, dict):
        raise _bad("bg_invalid", "one Bulgarian gloss per sense")
    before = live_value("kanji_senses", char, data)
    if not before:
        return
    clean = lambda v, n: " ".join(str(v).split())[:n] or None  # noqa: E731
    after = validate("kanji_senses", char, [
        {**g, "bg": clean(labels.get(g["id"], g.get("bg") or ""), 40), "noteBg": clean(notes.get(g["id"], g.get("noteBg") or ""), 200)}
        for g in before
    ], data)
    if after == before:
        return
    c = _decision("direct", "kanji_senses", char, before, after, user_id, None, "Bulgarian labels")
    c["parent"] = parent
    _apply(data, "kanji_senses", char, after, c["id"], explicit_words=True)
    data["decisions"].append(c)


def _on_the_board(type_: str, words: Any) -> bool:
    """Whether the reviewer placed a kanji's words themselves: `words` from the meanings board."""
    if type_ != "kanji_senses" or words is None:
        return False
    if not isinstance(words, dict):
        raise _bad_words()
    return True


def _skipped(skip: Any) -> dict[str, str | None]:
    """The skip map, cleaned: word id (as text) -> the group it sat in, or None."""
    if not skip:
        return {}
    if not isinstance(skip, dict):
        raise _bad_words()
    out = {}
    for k, v in skip.items():
        if not str(k).isdigit() or not (v is None or isinstance(v, str)):
            raise _bad_words()
        out[str(k)] = v
    return out


def follow_up_words(item: dict) -> dict[str, str | None] | None:
    """For a follow-up of skipped words: word id -> where the reviewer had it."""
    w = (item.get("evidence") or {}).get("words") if item["type"] == "kanji_senses" else None
    return w if isinstance(w, dict) else None


def _word_items(data: dict, char: str) -> dict[int, dict]:
    """word id -> the latest word_sense item for it under `char`."""
    prefix, out = f"{char}|", {}
    for i in data["items"].values():
        if i["type"] == "word_sense" and i["subject"].startswith(prefix):
            wid = int(i["subject"][len(prefix):])
            if wid not in out or i["created"] > out[wid]["created"]:
                out[wid] = i
    return out


def _place_words(data: dict, char: str, words: dict, user_id: str, parent: str) -> int:
    """The board's placements as decisions under `parent`: an open item is
    accepted, edited or rejected; a word with no item is changed directly."""
    items = _word_items(data, char)
    n = 0
    for key, group in words.items():
        wid = str(key)
        if not wid.isdigit():
            raise _bad_words()
        subject = f"{char}|{wid}"
        value = validate("word_sense", subject, group, data)
        before = live_value("word_sense", subject, data)
        item = items.get(int(wid))
        item = item if item and item["status"] == "open" else None
        if item and value is None:
            c = _decision("reject", "word_sense", subject, None, None, user_id, item["id"], None)
            _close(data, item, "rejected", c)
        elif item:
            act = "accept" if item["proposed"] == value else "edit"
            c = _decision(act, "word_sense", subject, before, value, user_id, item["id"], None)
            _apply(data, "word_sense", subject, value, c["id"])
            _close(data, item, "accepted" if act == "accept" else "edited", c)
        elif before != value:
            c = _decision("direct", "word_sense", subject, before, value, user_id, None, None)
            _apply(data, "word_sense", subject, value, c["id"])
        else:
            continue
        c["parent"] = parent
        data["decisions"].append(c)
        n += 1
    return n


def direct(type_: str, subject: str, value: Any, user_id: str, reason: str | None = None,
           words: dict | None = None) -> dict:
    """A reviewer's or the admin's own change, from the page: live at once, logged like any other.

    Not a report on the English: that always goes to the queue (`suggest`).

    `words`, for a kanji's meanings edited on the page's board: word id -> group
    (None: in no group), as the reviewer left them. As in `decide`, each word
    that moves is a decision under this one, reverted with it.
    """
    if type_ == "report":
        raise _bad("report_queued", "a report goes to the review queue")
    with _change() as data:
        after = validate(type_, subject, value, data)
        before = live_value(type_, subject, data)
        explicit = _on_the_board(type_, words)
        if before == after and not explicit:
            return {"unchanged": True}
        d = _decision("direct", type_, subject, before, after, user_id, None, _text(reason))
        if before != after:
            _apply(data, type_, subject, after, d["id"], explicit_words=explicit)
        moved = _place_words(data, subject, words, user_id, d["id"]) if explicit else 0
        if before == after and not moved:
            return {"unchanged": True}
        data["decisions"].append(d)
        return dict(d)


def auto_accept(item_id: str, why: str) -> dict:
    """For loaders whose items pass the mechanical rule (TASK §6); logged as by "auto"."""
    with _change() as data:
        item = data["items"][item_id]
        if item["status"] != "open":
            return dict(item)
        after = validate(item["type"], item["subject"], item["proposed"], data, machine=True)
        before = live_value(item["type"], item["subject"], data)
        d = _decision("auto", item["type"], item["subject"], before, after, "auto", item_id, why)
        _apply(data, item["type"], item["subject"], after, d["id"])
        item = _close(data, item, "auto-accepted", d)
        data["decisions"].append(d)
        return dict(item)


def revert(decision_id: str, user_id: str) -> dict:
    """Put back the value from before `decision_id`, as a new decision; reopens its item."""
    with _change() as data:
        d = next((x for x in data["decisions"] if x["id"] == decision_id), None)
        if not d:
            raise AppError(404, "decision_not_found", "no such decision")
        if d["action"] not in CHANGES or d["reverted_by"]:
            raise AppError(409, "not_revertible", "that decision changed nothing, or was already reverted")
        if live_value(d["type"], d["subject"], data) != d["after"]:
            raise AppError(409, "changed_since", "this was changed again since; revert the later change first")
        r = _undo(d, user_id)
        if d["before"] is not None or d["type"] == "decomposition":
            validate(d["type"], d["subject"], d["before"], data)
        children = [c for c in data["decisions"] if c.get("parent") == decision_id and not c.get("reverted_by")]
        _apply(data, d["type"], d["subject"], d["before"], r["id"], explicit_words=bool(children))
        _reverted(data, d, r)
        # The words placed on the meanings board go back with it.
        for c in children:
            if c["action"] == "reject":
                rc = _undo(c, user_id)
            elif c["action"] in CHANGES and live_value(c["type"], c["subject"], data) == c["after"]:
                rc = _undo(c, user_id)
                _apply(data, c["type"], c["subject"], c["before"], rc["id"], explicit_words=True)
            else:
                continue
            rc["parent"] = r["id"]
            _reverted(data, c, rc)
        return dict(r)


def _undo(d: dict, user_id: str) -> dict:
    """The decision reverting `d`: its value from before put back."""
    return _decision("revert", d["type"], d["subject"], d["after"], d["before"], user_id, d["item"],
                     f"revert {d['id']}", supersedes=d["id"])


def _reverted(data: dict, d: dict, r: dict) -> None:
    """Log `r` as reverting `d`, and reopen the item `d` decided."""
    d = _update_decision(data, d, reverted_by=r["id"])
    item = data["items"].get(d["item"]) if d["item"] else None
    if item and item["decision"] == d["id"]:
        _reopen_item(data, item)
    data["decisions"].append(r)


# ---------------------------------------------------------------- reading the queue


def _names(ids: set[str]) -> dict[str, dict]:
    cards = auth.names_for({i for i in ids if i and i.startswith("u-")})
    cards["auto"] = {"id": "auto", "name": "auto", "username": None, "avatar": None}
    return cards


def _label(word_id: int) -> str | None:
    r = query_one("SELECT headword FROM word WHERE id = ?", (word_id,))
    return r["headword"] if r else None


def _view(item: dict, names: dict, data: dict) -> dict:
    out = {k: v for k, v in item.items() if k != "skipped_by"}
    out["current"] = current(item["type"], item["subject"], data)
    kind, key = _target(item["subject"])
    if item["type"] in ("bg", "report") and kind == "word":
        out["label"] = _label(int(key)) or item["subject"]
    elif item["type"] == "word_sense":
        out["label"] = _label(_word_of(item["subject"]))
    out["createdBy"] = names.get(item["created_by"])
    out["decidedBy"] = names.get(item["decided_by"]) if item["decided_by"] else None
    return out


def queue(user_id: str, type_: str | None = None, origin: str | None = None, limit: int = 50,
          skipped: bool = False) -> dict:
    """Open items, worst first: highest priority, then oldest; your skips left
    out, or only your skips with `skipped`. `types` counts what waits per type
    (for the filter, before the type is picked), `skipped` how many you skipped."""
    if type_ is not None:
        _known_type(type_, character=True)
    if origin is not None:
        _known_origin(origin)
    data = _read()
    accepted = data["live"]["kanji_senses"]
    # Words waiting in a follow-up are decided there, not one by one.
    held = {
        f"{i['subject']}|{w}" for i in data["items"].values()
        if i["status"] == "open" and (fw := follow_up_words(i)) for w in fw
    }
    pending = _meanings_pending(data)
    waiting = [
        i for i in data["items"].values()
        if i["status"] == "open"
        and i["subject"] not in held
        # A word's meaning waits until its kanji's meanings are accepted.
        and (i["type"] != "word_sense" or _char(i["subject"]) in accepted)
        # Bulgarian waits for the meanings too: the groups are its context.
        and (i["type"] != "bg" or not _bg_waits(i["subject"], pending))
        and (origin is None or i["origin"] == origin)
    ]
    mine = [i for i in waiting if (user_id in i["skipped_by"]) == skipped]
    anchor = _anchors(data)
    types = {t: 0 for t in TYPES if t not in CHARACTER_TYPES}
    types[CHARACTER] = len({anchor(i) for i in mine if i["type"] in CHARACTER_TYPES})
    for i in mine:
        if i["type"] not in CHARACTER_TYPES:
            types[i["type"]] += 1
    # The meanings stage holds a kanji's groups and its single words both;
    # the character stage, a character's parts, forms and part meaning.
    def wanted(i: dict) -> bool:
        return (type_ is None or i["type"] == type_ or (type_ == "kanji_senses" and i["type"] == "word_sense")
                or (type_ == CHARACTER and i["type"] in CHARACTER_TYPES))

    rows = [i for i in mine if wanted(i)]
    rows.sort(key=lambda i: (-(i.get("priority") or 0), i["created"]))
    rows = _by_character(_by_kanji(rows), anchor)
    names = _names({i["created_by"] for i in rows[:limit] if i["type"] != CHARACTER})
    return {
        "total": len(rows),
        "items": [i if i["type"] == CHARACTER else _view(i, names, data) for i in rows[:limit]],
        "types": types,
        "skipped": len(_by_character([i for i in waiting if user_id in i["skipped_by"] and wanted(i)], anchor)),
    }


def _anchors(data: dict):
    """Which character's card an item is on: its subject, or for a form link X|Y,
    X -- unless only Y has a card of its own (parts or a part meaning waiting)."""
    hosts = {i["subject"] for i in data["items"].values()
             if i["status"] == "open" and i["type"] in ("decomposition", "part_meaning")}

    def anchor(i: dict) -> str:
        if i["type"] != "form_link":
            return i["subject"]
        a, b = i["subject"].split("|")
        return b if b in hosts and a not in hosts else a

    return anchor


def _by_character(rows: list[dict], anchor) -> list[dict]:
    """A character's parts, forms and part-meaning items as one card, at the
    place its first item had: the queue lists the card, the card holds the items."""
    out, cards = [], {}
    for i in rows:
        if i["type"] not in CHARACTER_TYPES:
            out.append(i)
            continue
        c = anchor(i)
        card = cards.get(c)
        if card is None:
            card = cards[c] = {
                "id": f"char:{c}", "type": CHARACTER, "subject": c, "origin": "proposal", "sources": [],
                "kinds": [], "items": [], "proposed": None, "current": None, "evidence": None, "reason": None,
                "status": "open", "priority": i.get("priority") or 0, "createdBy": None,
            }
            out.append(card)
        card["items"].append(i["id"])
        if i["type"] not in card["kinds"]:
            card["kinds"].append(i["type"])
        if i["source"] not in card["sources"]:
            card["sources"].append(i["source"])
        if i["origin"] == "suggestion":
            card["origin"] = "suggestion"
    for card in cards.values():
        card["source"] = ", ".join(card["sources"])
    return out


def character_card(char: str) -> dict:
    """Everything waiting about one character, each item as `item` shows it, and the character's own facts."""
    data = _read()
    anchor = _anchors(data)
    ids = [i["id"] for i in sorted(data["items"].values(), key=lambda i: (-(i.get("priority") or 0), i["created"]))
           if i["status"] == "open" and i["type"] in CHARACTER_TYPES and anchor(i) == char]
    if not ids:
        raise AppError(404, "card_empty", "nothing waits about this character")
    users = users_of(char)
    return {
        "char": char,
        "items": [item(i) for i in ids],
        "context": {"char": char, **_kanji_info(char), "forms": forms.forms_of(char), "users": users,
                    "old": _old_forms(users[:40]), "parts": _children(char),
                    # Each source's split, so every answer can say who gives it.
                    "splits": decomp_sources.splits(char)},
    }


def decide_card(char: str, decisions: list[dict], user_id: str, reason: str | None = None) -> list[dict]:
    """A character's card, decided as one: every item on it, in one change.

    `decisions`: [{"item", "action", "value"}], one per open item on the card;
    all "skip" to leave the card for later. A part named as a shape and a
    "form of" for the same part can't both be right (the shape would win on
    the page and the form of lend nothing), so that pair is refused.
    """
    if not isinstance(decisions, list) or not decisions:
        raise _bad("card_decisions", "decide every item on the card")
    reason = _text(reason)
    with _change() as data:
        anchor = _anchors(data)
        open_ids = {i["id"] for i in data["items"].values()
                    if i["status"] == "open" and i["type"] in CHARACTER_TYPES and anchor(i) == char}
        asked = [d.get("item") for d in decisions if isinstance(d, dict)]
        if len(asked) != len(decisions) or set(asked) != open_ids or len(set(asked)) != len(asked):
            raise AppError(409, "card_changed", "this card changed since it was opened; open it again")
        order = {"decomposition": 0, "form_link": 1, "part_meaning": 2}
        decisions = sorted(decisions, key=lambda d: order[data["items"][d["item"]]["type"]])
        changes = {"accept", "edit"}
        shape = any(
            d["action"] in changes and data["items"][d["item"]]["type"] == "part_meaning"
            and ((d.get("value") if d["action"] == "edit" else data["items"][d["item"]]["proposed"]) or {}).get("kind") == "shape"
            for d in decisions
        )
        for d in decisions:
            it = data["items"][d["item"]]
            v = d.get("value") if d["action"] == "edit" else it["proposed"]
            if shape and d["action"] in changes and it["type"] == "form_link" and (v or {}).get("kind") == "form_of":
                x = it["subject"].split("|")[1 if v.get("reverse") else 0]
                if x == char:
                    raise _bad("shape_and_form_of", "a shape and a form of can't both be right: pick one")
        return [_decide(data, d["item"], d["action"], user_id, d.get("value"), reason) for d in decisions]


def _by_kanji(rows: list[dict]) -> list[dict]:
    """A kanji's meanings card and its single words one after another, at the
    place the first of them had; the card before its words."""
    meaning = ("kanji_senses", "word_sense")
    first: dict[str, int] = {}
    for n, i in enumerate(rows):
        if i["type"] in meaning:
            first.setdefault(_char(i["subject"]), n)

    def key(p: tuple[int, dict]) -> tuple[int, int, int]:
        n, i = p
        if i["type"] in meaning:
            return (first[_char(i["subject"])], i["type"] != "kanji_senses", n)
        return (n, 0, n)

    return [i for _, i in sorted(enumerate(rows), key=key)]


def _meanings_pending(data: dict) -> set[str]:
    """Kanji that have a meanings task whose groups are not accepted yet."""
    return subjects("kanji_senses", data) - set(data["live"]["kanji_senses"])


_headwords: dict[int, str] | None = None


def _headword(word_id: int) -> str:
    """Headwords of the translated words, read once (the database does not change under a running server)."""
    global _headwords
    if _headwords is None:
        _headwords = {r["id"]: r["headword"] for r in query(
            "SELECT id, headword FROM word WHERE id IN (SELECT DISTINCT word_id FROM sense_bg)")}
    return _headwords.get(word_id, "")


def _bg_waits(subject: str, pending: set[str]) -> bool:
    """A Bulgarian card waits while its kanji's groups, or any of its word's kanji's, are still to be made."""
    kind, key = _target(subject)
    if kind == "kanji":
        return key in pending
    return any(c in pending for c in _headword(int(key)))


def subjects(type_: str, data: dict | None = None) -> set[str]:
    """Every subject with an item of this type, open or decided (not withdrawn)."""
    return {i["subject"] for i in (data or _read())["items"].values() if i["type"] == type_ and i["status"] != "withdrawn"}


def counts() -> dict:
    data = _read()
    out: dict[str, dict] = {}
    for i in data["items"].values():
        t = out.setdefault(i["type"], {})
        key = f"{i['status']}:{i['origin']}"
        t[key] = t.get(key, 0) + 1
    return {"items": out, "decisions": len(data["decisions"])}


def item(item_id: str) -> dict:
    data = _read()
    it = data["items"].get(item_id)
    if not it:
        raise AppError(404, "item_not_found", "no such item")
    view = _view(it, _names({it["created_by"], it["decided_by"]}), data)
    view["context"] = context(it["type"], it["subject"], data)
    if (only := follow_up_words(it)) is not None:
        view["context"]["board"] = board(it["subject"], data, only)
    moves = _moves_of(it)
    if moves and view["context"].get("board"):
        # A suggestion from the page's board: its words start where the person put them.
        view["context"]["board"] = [{**w, "group": moves[str(w["id"])]} if str(w["id"]) in moves else w
                                    for w in view["context"]["board"]]
    if it["type"] == "decomposition" and isinstance(it["proposed"], list):
        view["impact"] = impact(it["subject"], it["proposed"])
    view["history"] = [d for d in data["decisions"] if d["type"] == it["type"] and d["subject"] == it["subject"]][-10:]
    return view


def context(type_: str, subject: str, data: dict | None = None) -> dict:
    """What a reviewer needs beside the item: the word, the kanji's meanings, the forms."""
    data = data or _read()
    if type_ in ("kanji_senses", "word_sense"):
        char = _char(subject)
        out = {"char": char, **_kanji_info(char), "senses": _senses(data, char)}
        if type_ == "word_sense":
            wid = _word_of(subject)
            out["word"] = _fetch_word(wid)
            # The kanji's board around it, to place the one word among the others;
            # a rare word not on the board is added to it.
            out["board"] = board(char, data)
            if out["word"] and not any(w["id"] == wid for w in out["board"]):
                out["board"].append(_board_word(out["word"], _placed(data, subject), _latest_item(data, "word_sense", subject)))
        else:
            out["board"] = board(char, data)
        return out
    if type_ == "form_link":
        a, b = subject.split("|")
        nodes = forms._nodes([a, b])
        return {
            "a": forms.forms_of(a), "b": forms.forms_of(b),
            # Each side's own meanings, and the kanji in scope it is in: does X act like Y in them?
            "meanings": {k: (nodes.get(c) or {}).get("meanings", []) for k, c in (("a", a), ("b", b))},
            "users": {"a": users_of(a), "b": users_of(b)},
        }
    if type_ == "part_meaning":
        users = users_of(subject)
        return {
            "char": subject, **_kanji_info(subject), "forms": forms.forms_of(subject), "users": users,
            "old": _old_forms(users[:40]),
            # Open form links about the part: a form_of lends a meaning, so it and a shape name cannot both be right.
            "formItems": [
                {"id": i["id"], "subject": i["subject"], "proposed": i["proposed"]}
                for i in data["items"].values()
                if i["type"] == "form_link" and i["status"] == "open" and subject in i["subject"].split("|")
            ],
        }
    kind, key = _target(subject)
    if type_ == "report":
        if kind == "word":
            return {"word": _fetch_word(int(key))}
        return {"char": key, **_kanji_info(key), "forms": forms.forms_of(key)}
    if type_ == "bg":
        if kind == "word":
            wid = int(key)
            # For each of the word's kanji with accepted groups: the group it is in here.
            groups = []
            for c in dict.fromkeys(_headword(wid)):
                senses = _senses(data, c)
                if not senses:
                    continue
                placed = _placed(data, f"{c}|{wid}")
                g = next((x for x in senses if x["id"] == placed), None)
                groups.append({"char": c, "group": placed, "en": g["en"] if g else None, "bg": g.get("bg") if g else None})
            return {"word": _fetch_word(wid), "built": _bg_built(subject), "groups": groups}
        return {"char": key, **_kanji_info(key), "built": _bg_built(subject), "senses": _senses(data, key)}
    return {"forms": forms.forms_of(subject)}


_ranked: dict[str, tuple] | None = None


def users_of(char: str) -> list[str]:
    """The kanji in scope (server/scope.py) built from `char` at any depth,
    most frequent first: what a reviewer of its forms or meaning checks it against."""
    global _ranked
    if _ranked is None:
        _ranked = {
            r["char"]: (r["freq"] is None, r["freq"] or 0, r["jlpt"] is None, -(r["jlpt"] or 0), r["strokes"] or 99, r["char"])
            for r in query(f"SELECT k.char, k.freq, k.jlpt, k.strokes FROM kanji k WHERE {scope.KANJI}")
        }
    parents = parents_map()
    seen: set[str] = set()
    level = [char]
    while level:
        nxt = []
        for c in level:
            for p in parents.get(c, ()):
                if p not in seen and p != char:
                    seen.add(p)
                    nxt.append(p)
        level = nxt
    return sorted((c for c in seen if c in _ranked), key=_ranked.__getitem__)


def _old_forms(chars: list[str]) -> dict[str, str]:
    """The old (pre-1946) form of each, where it has one: 前 -> 歬 shows what 丷 was."""
    if not chars:
        return {}
    marks = ",".join("?" * len(chars))
    return {r["char"]: r["other"] for r in query(
        f"SELECT char, other FROM char_form WHERE kind = 'old' AND char IN ({marks})", tuple(chars))}


def _kanji_info(char: str) -> dict:
    """KANJIDIC's meanings and readings of a kanji, and Kanji Alive's curated line."""
    k = query_one("SELECT meanings, on_yomi, kun_yomi FROM kanji WHERE char = ?", (char,))
    cur = query_one("SELECT meaning FROM kanji_curated WHERE char = ?", (char,))
    return {
        "kanjidic": json.loads(k["meanings"]) if k else [],
        "curated": cur["meaning"] if cur else None,
        "on": json.loads(k["on_yomi"]) if k and k["on_yomi"] else [],
        "kun": json.loads(k["kun_yomi"]) if k and k["kun_yomi"] else [],
    }


def _fetch_word(word_id: int) -> dict | None:
    return _fetch_words([word_id]).get(word_id)


_grades: dict[str, int] | None = None


def word_grade(headword: str) -> int | None:
    """The school grade of the hardest kanji in a word (1-6 primary, 8 secondary
    jōyō, 9-10 name kanji); None when one of its kanji has no grade."""
    global _grades
    if _grades is None:
        _grades = {r["char"]: r["grade"] for r in query("SELECT char, grade FROM kanji WHERE grade IS NOT NULL")}
    kanji = [c for c in headword if "㐀" <= c <= "鿿" or "豈" <= c <= "﫿" or c >= "\U00020000"]
    if not kanji:
        return 0
    got = [_grades.get(c) for c in kanji]
    return None if None in got else max(got)


def word_order(nf: int | None, jlpt: int | None, grade: int | None, headword: str, wid: int) -> tuple:
    """How the board lists words: newspaper frequency, then JLPT (N5 first),
    then the grade of its hardest kanji. Words with neither a newspaper rank
    nor a JLPT level fall to the bottom by the first two keys alone."""
    return (nf or 99, 6 - jlpt if jlpt else 99, grade if grade is not None else 99, len(headword), wid)


def _words_of(char: str) -> list[dict]:
    """Every word written with `char` whose headword shows it, in `word_order`."""
    rows = query(
        "SELECT w.id, w.common, w.nf, w.headword, j.level AS jlpt FROM word_char wc JOIN word w ON w.id = wc.word_id "
        "LEFT JOIN word_jlpt j ON j.word_id = w.id "
        "WHERE wc.char = ? AND instr(w.headword, ?) > 0",
        (char, char),
    )
    out = [dict(r) for r in rows]
    out.sort(key=lambda r: word_order(r["nf"], r["jlpt"], word_grade(r["headword"]), r["headword"], r["id"]))
    return out


def _board_word(w: dict, group: str | None, item: dict | None) -> dict:
    ev = (item or {}).get("evidence") or {}
    first = w["senses"][:2]
    return {
        "id": w["id"],
        "headword": w["headword"],
        "reading": w["reading"],
        "common": w["common"],
        "nf": w["nf"],
        "jlpt": w["jlpt"],
        "grade": word_grade(w["headword"]),
        "gloss": " / ".join(s["gloss"] for s in first if s["gloss"]),
        "glossBg": " / ".join(s["glossBg"] for s in first if s.get("glossBg")) or None,
        "group": group,
        "confidence": ev.get("confidence"),
        "agree": ev.get("agree"),
        # Two drafting runs put it in the same group, both sure: the board starts it ticked.
        "sure": bool(item and item["status"] == "open" and _runs_agree(item)),
    }


def _runs_agree(item: dict) -> bool:
    """Two independent runs agree on the item's proposal, both at AUTO_CONFIDENCE or more."""
    runs = (item.get("evidence") or {}).get("runs") or []
    return (
        len(runs) >= 2
        and {r.get("sense") for r in runs} == {item["proposed"]}
        and all(float(r.get("confidence") or 0) >= AUTO_CONFIDENCE for r in runs)
    )


def _on_board(r: dict) -> bool:
    """In the labeling scope: common, or ranked (a newspaper rank or a JLPT level).
    Rarer words are left for a separate task; a grade alone is no ranking, as
    nearly every word written in jōyō kanji has one."""
    return bool(r["common"] or r["nf"] or r["jlpt"])


def board(char: str, data: dict | None = None, only: dict[str, str | None] | None = None) -> list[dict]:
    """The meanings board: the kanji's common or ranked words, and any other word
    already placed, each in the group it is in now -- placed, else drafted, else none.

    `only`, for a follow-up: just these words, each where the reviewer left it
    when skipping (unless it was placed since)."""
    data = data or _read()
    placed = _placements(data, char)
    items = _word_items(data, char)
    rows = _words_of(char)
    if only is not None:
        ids = [r["id"] for r in rows if str(r["id"]) in only]
    else:
        ids = [r["id"] for r in rows if _on_board(r) or r["id"] in placed]
    words = _fetch_words(ids)
    out = []
    for wid in ids:
        w = words.get(wid)
        if not w:
            continue
        it = items.get(wid)
        if wid in placed:
            group = placed[wid]
        elif only is not None and str(wid) in only:
            group = only[str(wid)]
        else:
            group = it["proposed"] if it and it["status"] == "open" else None
        out.append(_board_word(w, group, it))
    return out


def page_kanji(char: str) -> dict:
    """What the page's Edit / Suggest changes needs for a kanji's meanings: its
    accepted groups (or, when none are, the open draft, marked as such) and
    the board's words, each in the group it is in now."""
    if len(char) != 1:
        raise _bad("bad_subject", "senses are of one kanji")
    data = _read()
    senses = _senses(data, char)
    drafted = False
    if not senses:
        drafts = [i for i in data["items"].values()
                  if i["type"] == "kanji_senses" and i["subject"] == char and i["status"] == "open" and i["proposed"]]
        if drafts:
            senses, drafted = max(drafts, key=lambda i: i["created"])["proposed"], True
    return {"char": char, "senses": senses, "drafted": drafted, "board": board(char, data)}


def page_word(word_id: int) -> dict:
    """What the page's Edit / Suggest changes needs for a word: for each of its
    kanji, the kanji's accepted groups and the one this word is in; and the
    machine Bulgarian under any correction."""
    data = _read()
    w = _fetch_word(word_id)
    if not w:
        raise AppError(404, "word_not_found", "no such word")
    kanji = [
        {"char": c, "senses": _senses(data, c), "group": _placed(data, f"{c}|{word_id}")}
        for c in dict.fromkeys(_headword(word_id)) if word_id in _word_ids(c)
    ]
    return {"word": w, "kanji": kanji, "bgBuilt": _bg_built(f"word:{word_id}")}


def history(user_id: str | None, limit: int = 100, type_: str | None = None, by: str | None = None,
            since: str | None = None, until: str | None = None) -> dict:
    """Decisions, newest first: one reviewer's, or everyone's for the admin.

    `by` narrows to one decider ("auto" too); `since` / `until` are dates
    (YYYY-MM-DD, inclusive, UTC). The words a meanings decision placed are
    folded into it, as a count. `people` is everyone who has decided anything,
    for the admin's filter.
    """
    data = _read()
    kids: dict[str, int] = {}
    for d in data["decisions"]:
        if d.get("parent"):
            kids[d["parent"]] = kids.get(d["parent"], 0) + 1
    rows = [
        d for d in reversed(data["decisions"])
        if not d.get("parent")
        and (user_id is None or d["by"] == user_id)
        and (by is None or d["by"] == by)
        and (type_ is None or d["type"] == type_)
        and (since is None or d["at"][:10] >= since)
        and (until is None or d["at"][:10] <= until)
    ][:limit]
    everyone = {d["by"] for d in data["decisions"]} if user_id is None else set()
    names = _names(everyone | {d["by"] for d in rows})
    people = sorted((names[b] for b in everyone if b in names), key=lambda c: (c["id"] == "auto", (c["name"] or "").lower()))
    return {
        "items": [{**d, "byCard": names.get(d["by"]), "words": kids.get(d["id"], 0)} for d in rows],
        "people": people,
    }


def progress() -> dict:
    """How far review has got: tasks decided per stage, and how many in-scope
    kanji are fully verified -- nothing open on its parts (to any depth) or
    its forms or its parts' meanings, its meanings accepted, and none of its words waiting.

    A task is what a reviewer decides in one go. A kanji's meanings are one,
    with all its drafted words on the board, so drafted word placements are
    counted apart (`words`), not as tasks; only a word on its own (a user's
    suggestion, a word reopened when its group changed) is a task.
    """
    data = _read()
    stages = {t: {"done": 0, "total": 0} for t in TYPES}
    words = {"done": 0, "total": 0}
    open_by: dict[str, set[str]] = {t: set() for t in TYPES}
    for i in data["items"].values():
        if i["status"] == "withdrawn":
            continue  # its source took it back: not a task
        if i["status"] == "open":
            open_by[i["type"]].add(i["subject"])
        drafted = i["type"] == "word_sense" and i["source"].startswith("ai:")
        count = words if drafted else stages[i["type"]]
        count["total"] += 1
        if i["status"] != "open":
            count["done"] += 1
    # Parts, forms and part meanings are decided a character at a time: one task per card.
    anchor = _anchors(data)
    cards: dict[str, bool] = {}
    for i in data["items"].values():
        if i["type"] in CHARACTER_TYPES and i["status"] != "withdrawn":
            c = anchor(i)
            cards[c] = cards.get(c, True) and i["status"] != "open"
    for t in CHARACTER_TYPES:
        del stages[t]
    stages[CHARACTER] = {"done": sum(cards.values()), "total": len(cards)}
    # The kanji in scope (server/scope.py) that have a meanings task.
    targets = sorted(subjects("kanji_senses", data))

    # Every part below every target, a level at a time, then each closure from that map.
    kids: dict[str, list[str]] = {}
    level = list(targets)
    while level:
        got = children_of(level)
        for c in level:
            kids[c] = got.get(c, [])
        level = list({k for c in level for k in kids[c] if k not in kids})
    memo: dict[str, frozenset[str]] = {}

    def below(c: str) -> frozenset[str]:
        if c not in memo:
            memo[c] = frozenset({c})  # a guard; the graph has no cycles
            memo[c] = frozenset({c}).union(*(below(k) for k in kids.get(c, [])))
        return memo[c]

    open_forms = {c for s in open_by["form_link"] for c in s.split("|")} | open_by["part_meaning"]
    open_words = {_char(s) for s in open_by["word_sense"]}
    senses = data["live"]["kanji_senses"]
    verified = sum(
        1 for c in targets
        if c in senses and c not in open_words
        and not (below(c) & open_by["decomposition"]) and not (below(c) & open_forms)
    )
    return {
        "tasks": {"done": sum(s["done"] for s in stages.values()), "total": sum(s["total"] for s in stages.values())},
        "stages": stages,
        "kanji": {"verified": verified, "total": len(targets)},
        "meanings": {"accepted": sum(1 for c in targets if c in senses), "total": len(targets)},
        "words": words,
    }


def auto_accepted(limit: int = 200) -> dict:
    data = _read()
    rows = [d for d in reversed(data["decisions"]) if d["action"] == "auto"][:limit]
    return {"items": rows}


def suggestions_of(user_id: str) -> dict:
    data = _read()
    rows = sorted(
        (i for i in data["items"].values() if i["created_by"] == user_id and i["origin"] == "suggestion"),
        key=lambda i: i["created"], reverse=True,
    )
    return {"items": [{k: i[k] for k in ("id", "type", "subject", "proposed", "status", "created", "decided_at")} for i in rows[:50]]}


# ---------------------------------------------------------------- live state for the rest of the server


def senses_of(char: str) -> list[dict] | None:
    return _senses(_read(), char)


def word_senses(char: str) -> dict[int, str]:
    """word id -> sense id, for this kanji's accepted word assignments."""
    return _placements(_read(), char)


def _form_link_rows(subject: str, v: dict) -> tuple[list[tuple[str, str]], list[tuple[str, str, str]]]:
    """What an accepted form link does to the built ones: the (char, other) rows
    it adds -- none for "none", both ways round for a positional form, from b
    to a when reversed -- and the (char, other, kind) rows it takes the place
    of, every kind both ways."""
    a, b = subject.split("|")
    replaced = [(x, y, k) for k in forms.KINDS for x, y in ((a, b), (b, a))]
    if v["kind"] == "none":
        return [], replaced
    if v.get("reverse"):
        a, b = b, a
    return ([(a, b), (b, a)] if v["kind"] == "positional" else [(a, b)]), replaced


def _form_overlay() -> tuple[list[dict], set[tuple[str, str, str]]]:
    added: list[dict] = []
    removed: set[tuple[str, str, str]] = set()
    for subject, v in _read()["live"]["form_link"].items():
        rows, replaced = _form_link_rows(subject, v)
        removed.update(replaced)
        added += [{"char": x, "other": y, "kind": v["kind"], "source": f"review:{v['decision']}", "note": v.get("note")}
                  for x, y in rows]
    return added, removed


forms.overlay = _form_overlay


def part_meaning_of(char: str) -> dict | None:
    """A part's reviewed meaning or shape name, as the page shows it."""
    return live_value("part_meaning", char)


forms.part_meaning = part_meaning_of


# ---------------------------------------------------------------- the offline pack


def _overrides_key() -> str:
    ov = store.decomposition_overrides()
    blob = json.dumps(ov, ensure_ascii=False, sort_keys=True) + bg_overlay.key()
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def pack_key() -> str:
    """What the offline pack's version follows: the decompositions as of the last quiet moment."""
    key = _read().get("pack_key")
    if key is None:
        key = _overrides_key()
        with _change() as data:
            data["pack_key"] = key
    return key


def _flush_pack() -> None:
    global _pack_timer
    with _change() as data:
        _pack_timer = None
        data["pack_key"] = _overrides_key()
    from . import offline

    offline.ensure_async()


def _schedule_pack() -> None:
    """Rebuild the offline pack once decompositions have been left alone a while."""
    global _pack_timer
    with _lock:
        if _pack_timer is not None:
            _pack_timer.cancel()
        _pack_timer = threading.Timer(PACK_DELAY, _flush_pack)
        _pack_timer.daemon = True
        _pack_timer.start()


# ---------------------------------------------------------------- export to tracked files


def export() -> dict[str, int]:
    """Write the accepted state to the tracked files the pipeline reads, for committing."""
    data = _read()
    ov = store.decomposition_overrides()
    EXPORTS["decomposition"].write_text(json.dumps(ov, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    links, removed = [], []
    for subject, v in sorted(data["live"]["form_link"].items()):
        rows, replaced = _form_link_rows(subject, v)
        removed += [{"char": x, "other": y, "kind": k} for x, y, k in replaced]
        links += [{"char": x, "other": y, "kind": v["kind"], "note": v.get("note"), "decision": v["decision"]} for x, y in rows]
    EXPORTS["form_link"].write_text(
        json.dumps({"links": links, "removed": removed}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    meaning = {
        "senses": {c: v["senses"] for c, v in sorted(data["live"]["kanji_senses"].items())},
        "words": {k: v["sense"] for k, v in sorted(data["live"]["word_sense"].items())},
    }
    EXPORTS["meaning"].write_text(json.dumps(meaning, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    parts = dict(sorted(data["live"]["part_meaning"].items()))
    EXPORTS["part_meaning"].write_text(json.dumps(parts, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {"decomposition": len(ov), "form_link": len(data["live"]["form_link"]), "part_meaning": len(parts),
            "kanji_senses": len(meaning["senses"]), "word_sense": len(meaning["words"])}


def load_bg(dry_run: bool = False) -> dict[str, int]:
    """Queue the machine-translated Bulgarian for checking: one card per word and
    per kanji in scope (server/scope.py), most frequent first, kanji before
    words, all after the other stages in the "all" list. A subject that has a
    card already, open or decided, is not queued again."""
    known = subjects("bg")
    rows = []
    for r in query(f"SELECT k.char, k.freq FROM kanji k JOIN kanji_bg b ON b.char = k.char WHERE {scope.KANJI}"):
        subject = f"kanji:{r['char']}"
        rows.append({"type": "bg", "subject": subject, "proposed": _bg_built(subject), "source": "mt:claude-sonnet-5",
                     "priority": round(0.99 - min(r["freq"] or 2500, 2500) / 100000, 5)})
    for r in query("SELECT DISTINCT w.id, w.nf, j.level AS jlpt FROM word w JOIN sense_bg b ON b.word_id = w.id "
                   f"LEFT JOIN word_jlpt j ON j.word_id = w.id WHERE {scope.WORDS}"):
        subject = f"word:{r['id']}"
        pri = 0.8 - r["nf"] / 100 if r["nf"] else (0.3 - (6 - r["jlpt"]) / 100 if r["jlpt"] else 0.2)
        rows.append({"type": "bg", "subject": subject, "proposed": _bg_built(subject), "source": "mt:claude-sonnet-5",
                     "priority": round(pri, 5)})
    rows = [r for r in rows if r["subject"] not in known]
    counts = {"kanji": sum(1 for r in rows if r["subject"].startswith("kanji:")), "words": sum(1 for r in rows if r["subject"].startswith("word:"))}
    if dry_run:
        return counts
    added, refused = add_items(rows)
    return {**counts, "added": added, "refused": refused}


if __name__ == "__main__":
    if sys.argv[1:2] == ["load-bg"]:
        print(load_bg(dry_run="--dry-run" in sys.argv))
    elif sys.argv[1:] == ["export"]:
        for k, n in export().items():
            print(f"{k:14} {n:>6}")
        print("wrote " + ", ".join(str(p.relative_to(ROOT)) for p in EXPORTS.values()))
    elif sys.argv[1:2] == ["backup"] and len(sys.argv) == 3:
        backup(Path(sys.argv[2]))
        print(f"copied {DB} to {sys.argv[2]}")
    else:
        print("usage: python -m server.review export | load-bg [--dry-run] | backup <file.db>")
