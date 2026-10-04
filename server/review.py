"""The labeling queue: items to decide, every decision, and what they made live.

Four task types (TASK-forms-review.md §5):

    decomposition  subject 青            value: its direct parts, ["龶", "月"]; [] = atomic
    form_link      subject 龶|王          value: {"kind": looks_like, "note": ...}; kind "none" = no link
    kanji_senses   subject 生            value: [{"id": "生.life", "en": "life", "bg": "живот", "note"}]
    word_sense     subject 生|1234567    value: a sense id of the kanji, or "catch-all"

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
the other types here, under `live`. None of it is in the SQLite database,
which is rebuilt and swapped on deploys. `python -m server.review export`
writes the accepted state to tracked files for the pipeline and for git
(data/decomp_overrides.json, data/form_overrides.json,
data/meaning_groups.json); nothing writes those files on its own, so a
`git reset --hard` on deploy can never lose a reviewer's work.

An accepted decomposition changes the offline pack, which takes over a
minute and hundreds of MB to rebuild on the Pi. So the pack's version key
only moves when decompositions have been left alone for PACK_DELAY: twenty
accepts in a row cause one rebuild, not twenty.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import auth, bg_overlay, forms, store
from .db import query, query_one
from .errors import AppError

ROOT = Path(__file__).parent.parent
REVIEW_DIR = ROOT / "data" / "review"
FILE = REVIEW_DIR / "review.json"
EXPORTS = {
    "decomposition": ROOT / "data" / "decomp_overrides.json",
    "form_link": ROOT / "data" / "form_overrides.json",
    "meaning": ROOT / "data" / "meaning_groups.json",
}

TYPES = ("decomposition", "form_link", "kanji_senses", "word_sense", "bg")
ORIGINS = ("proposal", "suggestion")
# open: waiting. The rest say how it was closed.
STATUSES = ("open", "auto-accepted", "accepted", "edited", "rejected")
ACTIONS = ("accept", "edit", "reject", "skip")
CATCH_ALL = "catch-all"
FORM_KINDS = (*forms.KINDS, "none")
# What a decision changed: these can be reverted. skip/reject change nothing.
CHANGES = ("accept", "edit", "direct", "auto", "revert", "reopen")

MAX_OPEN_SUGGESTIONS = 20
MAX_TEXT = 500
PACK_DELAY = 600.0  # seconds of quiet after a decomposition before the offline pack rebuilds

STROKES = set("一丨丶丿乙亅乚㇒㇏")
SENSE_ID = re.compile(r"^[a-z0-9-]{1,24}$")

_lock = threading.RLock()
_snapshot: tuple[tuple[int, int] | None, dict] | None = None
_pack_timer: threading.Timer | None = None


def use_dir(path: Path) -> None:
    """Keep the review state somewhere else (tests/sandbox.py)."""
    global REVIEW_DIR, FILE, _snapshot
    REVIEW_DIR, FILE, _snapshot = path, path / "review.json", None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _empty() -> dict:
    return {
        "version": 1,
        "items": {},
        "decisions": [],
        "live": {"form_link": {}, "kanji_senses": {}, "word_sense": {}, "bg": {}},
        "pack_key": None,
    }


# ---------------------------------------------------------------- storage


def _stat() -> tuple[int, int] | None:
    try:
        st = FILE.stat()
        return (st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        return None


def _load() -> dict:
    """For changing: the caller saves after. When the file has not changed
    since it was last read or written, the parsed copy is reused rather than
    parsing ~30 MB again for every decision: the containers a change adds to
    are copied (shallowly, a few ms), so a reader going through the shared
    copy never sees one grow under it."""
    snap = _snapshot
    if snap is not None and snap[0] is not None and snap[0] == _stat():
        d = snap[1]
        return {
            **d,
            "items": dict(d["items"]),
            "decisions": list(d["decisions"]),
            "live": {k: dict(v) for k, v in d["live"].items()},
        }
    if not FILE.exists():
        return _empty()
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        backup = FILE.with_suffix(f".corrupt-{int(datetime.now().timestamp())}.json")
        shutil.copy2(FILE, backup)
        raise RuntimeError(f"{FILE} is not valid JSON; copied to {backup.name} and stopped")
    base = _empty()
    for k, v in base.items():
        data.setdefault(k, v)
    for k, v in base["live"].items():
        data["live"].setdefault(k, v)
    return data


def _read() -> dict:
    """For reading only: shared, never mutate it. Reparsed when the file changes."""
    global _snapshot
    key = _stat()
    snap = _snapshot
    if snap is not None and snap[0] == key:
        return snap[1]
    with _lock:
        key = _stat()
        _snapshot = (key, _load())
        return _snapshot[1]


def _save(data: dict) -> None:
    global _snapshot
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(FILE)
    # What was just written is the file now: readers and the next change use it as is.
    _snapshot = (_stat(), data)


# ---------------------------------------------------------------- the graph, for checks and impact


def _known(char: str) -> bool:
    return bool(
        query_one("SELECT 1 FROM kanji WHERE char = ?", (char,))
        or query_one("SELECT 1 FROM edge WHERE child = ? OR parent = ? LIMIT 1", (char, char))
    )


def _children(char: str) -> list[str]:
    from .routes.graph import children_of

    return children_of([char]).get(char, [])


def _closure(start: list[str], skip: str | None = None) -> set[str]:
    """Everything below `start`, any depth; `skip` is never walked through."""
    from .routes.graph import children_of

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
    from .routes.graph import parents_of

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


def _word(word_id: int) -> dict | None:
    r = query_one("SELECT id, headword FROM word WHERE id = ?", (word_id,))
    return dict(r) if r else None


def _split(subject: str, n: int = 2) -> list[str]:
    parts = subject.split("|")
    if len(parts) != n or not all(parts):
        raise _bad("bad_subject", "that is not a subject of this type")
    return parts


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
    if type_ not in TYPES:
        raise _bad("bad_type", "unknown task type")
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
            raise _bad("form_kind", "kind must be one of positional, old, form_of, looks_like, none")
        note = (value.get("note") or "").strip()[:300] or None
        if value["kind"] == "form_of" and not note:
            # The rule: a form_of needs historical support, and the note is where it goes.
            raise _bad("form_evidence", "say where this comes from: the old form, or a reference")
        return {"kind": value["kind"], "note": note}

    if type_ == "kanji_senses":
        if len(subject) != 1:
            raise _bad("bad_subject", "senses are of one kanji")
        if value is None:
            return None
        if not isinstance(value, list) or not 2 <= len(value) <= 6:
            raise _bad("senses_count", "a kanji has 2 to 6 meanings here, the catch-all aside")
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
            })
        return out

    if type_ == "bg":
        kind, _, key = subject.partition(":")
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

    # word_sense
    char, wid = _split(subject)
    if len(char) != 1 or not wid.isdigit():
        raise _bad("bad_subject", "a word sense is a kanji and a word id")
    if not query_one("SELECT 1 FROM word_char WHERE word_id = ? AND char = ?", (int(wid), char)):
        raise _bad("word_not_with", "that word is not written with this kanji")
    if value is None:
        return None
    senses = data["live"]["kanji_senses"].get(char)
    if not senses:
        if pending_ok and isinstance(value, str) and (value == CATCH_ALL or value.startswith(f"{char}.")):
            return value
        raise AppError(409, "senses_not_accepted", "this kanji's meanings are not accepted yet")
    ids = {s["id"] for s in senses["senses"]} | {CATCH_ALL}
    if value not in ids:
        raise _bad("sense_unknown", "not one of this kanji's meanings")
    return value


def live_value(type_: str, subject: str, data: dict | None = None) -> Any:
    """The overlay's value for the subject, None when nothing overrides the built data."""
    if type_ == "decomposition":
        ov = store.decomposition_overrides().get(subject)
        return list(ov) if ov is not None else None
    data = data or _read()
    entry = data["live"][type_].get(subject)
    if entry is None:
        return None
    if type_ == "form_link":
        return {"kind": entry["kind"], "note": entry.get("note")}
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
        return {"kind": mine[0]["kind"], "note": mine[0]["note"]} if mine else {"kind": "none", "note": None}
    if type_ == "bg":
        return _bg_shown(subject)
    return live_value(type_, subject, data)


def _bg_built(subject: str) -> list[str] | None:
    """The machine-translated Bulgarian a card starts from, as built."""
    kind, _, key = subject.partition(":")
    if kind == "word":
        rows = query("SELECT s.ord, b.gloss FROM sense s LEFT JOIN sense_bg b ON b.word_id = s.word_id AND b.ord = s.ord "
                     "WHERE s.word_id = ? ORDER BY s.ord", (int(key),))
        return [r["gloss"] or "" for r in rows] or None
    r = query_one("SELECT meanings FROM kanji_bg WHERE char = ?", (key,))
    return json.loads(r["meanings"]) if r else None


def _bg_shown(subject: str) -> list[str] | None:
    """What the site shows now: reviewed, else built."""
    kind, _, key = subject.partition(":")
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
    if type_ == "decomposition":
        if value is None:
            store.clear_decomposition(subject)
        else:
            store.set_decomposition(subject, value)
        _schedule_pack()
        return
    if type_ == "bg":
        if value is None:
            data["live"]["bg"].pop(subject, None)
        else:
            data["live"]["bg"][subject] = {"value": value, "decision": decision}
        _bg_live(subject, value)
        _schedule_pack()
        return
    live = data["live"][type_]
    if value is None:
        live.pop(subject, None)
    elif type_ == "form_link":
        live[subject] = {**value, "decision": decision}
    elif type_ == "kanji_senses":
        before = live.get(subject, {}).get("senses") or []
        live[subject] = {"senses": value, "decision": decision}
        if not explicit_words:
            _reopen_words(data, subject, before, value, decision)
            _auto_words(data, subject, value)
    else:
        live[subject] = {"sense": value, "decision": decision}


def _bg_live(subject: str, value: list[str] | None) -> None:
    """Show reviewed Bulgarian at once, everywhere it is read (server/bg_overlay.py)."""
    kind, _, key = subject.partition(":")
    if kind == "word":
        bg_overlay.set_word(int(key), value)
        return
    bg_overlay.set_kanji(key, value)
    from . import recognize

    if key in recognize._meta:  # handwriting candidates carry the meanings too
        freq, meanings, built = recognize._meta[key]
        recognize._meta[key] = (freq, meanings, value or _bg_built(subject))


def load_bg_overlay() -> None:
    """At startup: the reviewed Bulgarian in the store becomes what pages show."""
    words, kanji = {}, {}
    for subject, entry in _read()["live"].get("bg", {}).items():
        kind, _, key = subject.partition(":")
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
        old = ws.pop(subject)
        data["decisions"].append(_decision(
            "reopen", "word_sense", subject, old["sense"], None, "auto", None,
            f"its meaning group changed in {decision}",
        ))
        item = _latest_item(data, "word_sense", subject)
        if item:
            item.update(status="open", decided_by=None, decided_at=None, decision=None, skipped_by=[])
        else:
            _new_item(data, "word_sense", subject, None, "reopened", "proposal", None, None, "auto", 0.0)


AUTO_CONFIDENCE = 0.8


def word_rule(item: dict, accepted_ids: set[str]) -> bool:
    """TASK §6 for a word's meaning: two independent runs agree, both are
    confident, and their pick is one of the kanji's accepted groups."""
    runs = (item.get("evidence") or {}).get("runs") or []
    if len(runs) < 2:
        return False
    picks = {r.get("sense") for r in runs}
    return (
        len(picks) == 1
        and item["proposed"] in picks
        and all(float(r.get("confidence") or 0) >= AUTO_CONFIDENCE for r in runs)
        and item["proposed"] in accepted_ids | {CATCH_ALL}
    )


def _auto_words(data: dict, char: str, senses: list[dict]) -> None:
    """Once a kanji's groups are accepted, its words that pass the rule go live, as "auto"."""
    ids = {s["id"] for s in senses}
    for item in data["items"].values():
        if item["type"] != "word_sense" or item["status"] != "open" or not item["subject"].startswith(f"{char}|"):
            continue
        if not word_rule(item, ids):
            continue
        before = live_value("word_sense", item["subject"], data)
        d = _decision("auto", "word_sense", item["subject"], before, item["proposed"], "auto", item["id"],
                      "two runs agree, both confident")
        data["live"]["word_sense"][item["subject"]] = {"sense": item["proposed"], "decision": d["id"]}
        item.update(status="auto-accepted", decided_by="auto", decided_at=d["at"], decision=d["id"])
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
    data["items"][item["id"]] = item
    return item


def add_item(type_: str, subject: str, proposed: Any, source: str, origin: str = "proposal",
             reason: str | None = None, evidence: Any = None, by: str = "system",
             priority: float = 0.0, **extra) -> dict:
    """Put a change in the queue; an identical open one is returned instead of a twin."""
    if origin not in ORIGINS:
        raise _bad("bad_origin", "origin is proposal or suggestion")
    with _lock:
        data = _load()
        proposed = validate(type_, subject, proposed, data, pending_ok=origin == "proposal", machine=origin == "proposal")
        for i in data["items"].values():
            if i["status"] == "open" and i["type"] == type_ and i["subject"] == subject and i["proposed"] == proposed:
                return dict(i)
        if origin == "suggestion":
            mine = sum(1 for i in data["items"].values() if i["status"] == "open" and i["created_by"] == by)
            if mine >= MAX_OPEN_SUGGESTIONS:
                raise AppError(429, "too_many_suggestions", "you have {n} suggestions waiting already", n=mine)
        item = _new_item(data, type_, subject, proposed, source, origin,
                         (reason or "").strip()[:MAX_TEXT] or None, evidence, by, priority, **extra)
        _save(data)
        return dict(item)


def add_items(rows: list[dict]) -> tuple[int, int]:
    """Many proposals at once, for loaders: one read and one write, not one per item.

    Each row is add_item's arguments as a dict. Returns (added, refused): a
    row that fails validation is skipped and counted, not raised.
    """
    with _lock:
        data = _load()
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
                      (r.get("reason") or "").strip()[:MAX_TEXT] or None, r.get("evidence"), "system",
                      r.get("priority", 0.0))
            added += 1
        _save(data)
        return added, refused


FOLLOW_UP_PRIORITY = -1.0  # below everything else: the end of the queue


def decide(item_id: str, action: str, user_id: str, value: Any = None, reason: str | None = None,
           words: dict | None = None, skip: dict | None = None, labels: dict | None = None) -> dict:
    """`words`, for a kanji's meanings: word id -> group id (None: in no group),
    as the reviewer left them on the board. Each becomes a decision of its own,
    under this one, and is reverted with it.

    `labels`, for a kanji's Bulgarian card: group id -> its Bulgarian label.
    Bulgarian is labelled in the Bulgarian stage, not on the meanings board,
    so the groups' labels are set here, as a decision under this one.

    `skip`: the words the reviewer was not sure of, word id -> where they had
    it so far. They are left undecided and come back together as a follow-up
    item for the same kanji at the end of the queue, groups fixed, only them.
    """
    if action not in ACTIONS:
        raise _bad("bad_action", "action is accept, edit, reject or skip")
    reason = (reason or "").strip()[:MAX_TEXT] or None
    with _lock:
        data = _load()
        item = data["items"].get(item_id)
        if not item:
            raise AppError(404, "item_not_found", "no such item")
        if item["status"] != "open":
            raise AppError(409, "item_closed", "this item was already decided")
        type_, subject = item["type"], item["subject"]

        if action == "skip":
            if user_id not in item["skipped_by"]:
                item["skipped_by"].append(user_id)
            _save(data)
            return dict(item)

        if action == "reject":
            d = _decision("reject", type_, subject, None, None, user_id, item_id, reason)
            item.update(status="rejected", decided_by=user_id, decided_at=d["at"], decision=d["id"])
            data["decisions"].append(d)
            _save(data)
            return dict(item)

        if action == "accept" and item["proposed"] is None:
            raise _bad("needs_edit", "this item has no proposal to accept; pick a value")
        after = validate(type_, subject, item["proposed"] if action == "accept" else value, data)
        if after is None:
            raise _bad("needs_value", "pick a value")
        before = live_value(type_, subject, data)
        explicit = type_ == "kanji_senses" and words is not None
        if explicit and not isinstance(words, dict):
            raise _bad("words_invalid", "words are a map of word id to group")
        d = _decision(action, type_, subject, before, after, user_id, item_id, reason)
        _apply(data, type_, subject, after, d["id"], explicit_words=explicit)
        item.update(
            status="accepted" if action == "accept" else "edited",
            decided_by=user_id, decided_at=d["at"], decision=d["id"],
        )
        data["decisions"].append(d)
        if explicit:
            held = _skipped(skip)
            _place_words(data, subject, {k: v for k, v in words.items() if str(k) not in held}, user_id, d["id"])
            if held:
                _new_item(data, "kanji_senses", subject, after, f"skipped:{d['id']}", "proposal",
                          f"{len(held)} words left for later", {"words": held}, user_id, FOLLOW_UP_PRIORITY)
        if type_ == "bg" and labels and subject.startswith("kanji:"):
            _label_groups(data, subject[6:], labels, user_id, d["id"])
        _save(data)
        return dict(item)


def _label_groups(data: dict, char: str, labels: Any, user_id: str, parent: str) -> None:
    """Set the Bulgarian labels of a kanji's accepted groups (a decision under `parent`)."""
    if not isinstance(labels, dict):
        raise _bad("bg_invalid", "one Bulgarian gloss per sense")
    before = live_value("kanji_senses", char, data)
    if not before:
        return
    after = validate("kanji_senses", char, [
        {**g, "bg": (" ".join(str(labels.get(g["id"], g.get("bg") or "")).split())[:40] or None)} for g in before
    ], data)
    if after == before:
        return
    c = _decision("direct", "kanji_senses", char, before, after, user_id, None, "Bulgarian labels")
    c["parent"] = parent
    _apply(data, "kanji_senses", char, after, c["id"], explicit_words=True)
    data["decisions"].append(c)


def _skipped(skip: Any) -> dict[str, str | None]:
    """The skip map, cleaned: word id (as text) -> the group it sat in, or None."""
    if not skip:
        return {}
    if not isinstance(skip, dict):
        raise _bad("words_invalid", "words are a map of word id to group")
    out = {}
    for k, v in skip.items():
        if not str(k).isdigit() or not (v is None or isinstance(v, str)):
            raise _bad("words_invalid", "words are a map of word id to group")
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
            raise _bad("words_invalid", "words are a map of word id to group")
        subject = f"{char}|{wid}"
        value = validate("word_sense", subject, group, data)
        before = live_value("word_sense", subject, data)
        item = items.get(int(wid))
        item = item if item and item["status"] == "open" else None
        if item and value is None:
            c = _decision("reject", "word_sense", subject, None, None, user_id, item["id"], None)
            item.update(status="rejected", decided_by=user_id, decided_at=c["at"], decision=c["id"])
        elif item:
            act = "accept" if item["proposed"] == value else "edit"
            c = _decision(act, "word_sense", subject, before, value, user_id, item["id"], None)
            _apply(data, "word_sense", subject, value, c["id"])
            item.update(status="accepted" if act == "accept" else "edited",
                        decided_by=user_id, decided_at=c["at"], decision=c["id"])
        elif before != value:
            c = _decision("direct", "word_sense", subject, before, value, user_id, None, None)
            _apply(data, "word_sense", subject, value, c["id"])
        else:
            continue
        c["parent"] = parent
        data["decisions"].append(c)
        n += 1
    return n


def direct(type_: str, subject: str, value: Any, user_id: str, reason: str | None = None) -> dict:
    """A reviewer's or the admin's own change, from the page: live at once, logged like any other."""
    with _lock:
        data = _load()
        after = validate(type_, subject, value, data)
        before = live_value(type_, subject, data)
        if before == after:
            return {"unchanged": True}
        d = _decision("direct", type_, subject, before, after, user_id, None,
                      (reason or "").strip()[:MAX_TEXT] or None)
        _apply(data, type_, subject, after, d["id"])
        data["decisions"].append(d)
        _save(data)
        return dict(d)


def auto_accept(item_id: str, why: str) -> dict:
    """For loaders whose items pass the mechanical rule (TASK §6); logged as by "auto"."""
    with _lock:
        data = _load()
        item = data["items"][item_id]
        if item["status"] != "open":
            return dict(item)
        after = validate(item["type"], item["subject"], item["proposed"], data, machine=True)
        before = live_value(item["type"], item["subject"], data)
        d = _decision("auto", item["type"], item["subject"], before, after, "auto", item_id, why)
        _apply(data, item["type"], item["subject"], after, d["id"])
        item.update(status="auto-accepted", decided_by="auto", decided_at=d["at"], decision=d["id"])
        data["decisions"].append(d)
        _save(data)
        return dict(item)


def revert(decision_id: str, user_id: str) -> dict:
    """Put back the value from before `decision_id`, as a new decision; reopens its item."""
    with _lock:
        data = _load()
        d = next((x for x in data["decisions"] if x["id"] == decision_id), None)
        if not d:
            raise AppError(404, "decision_not_found", "no such decision")
        if d["action"] not in CHANGES or d["reverted_by"]:
            raise AppError(409, "not_revertible", "that decision changed nothing, or was already reverted")
        if live_value(d["type"], d["subject"], data) != d["after"]:
            raise AppError(409, "changed_since", "this was changed again since; revert the later change first")
        r = _decision("revert", d["type"], d["subject"], d["after"], d["before"], user_id, d["item"],
                      f"revert {decision_id}", supersedes=decision_id)
        if d["before"] is not None or d["type"] == "decomposition":
            validate(d["type"], d["subject"], d["before"], data)
        children = [c for c in data["decisions"] if c.get("parent") == decision_id and not c.get("reverted_by")]
        _apply(data, d["type"], d["subject"], d["before"], r["id"], explicit_words=bool(children))
        d["reverted_by"] = r["id"]
        _reopen(data, d)
        data["decisions"].append(r)
        # The words placed on the meanings board go back with it.
        for c in children:
            if c["action"] == "reject":
                rc = _decision("revert", c["type"], c["subject"], None, None, user_id, c["item"],
                               f"revert {c['id']}", supersedes=c["id"])
            elif c["action"] in CHANGES and live_value(c["type"], c["subject"], data) == c["after"]:
                rc = _decision("revert", c["type"], c["subject"], c["after"], c["before"], user_id, c["item"],
                               f"revert {c['id']}", supersedes=c["id"])
                _apply(data, c["type"], c["subject"], c["before"], rc["id"], explicit_words=True)
            else:
                continue
            rc["parent"] = r["id"]
            c["reverted_by"] = rc["id"]
            _reopen(data, c)
            data["decisions"].append(rc)
        _save(data)
        return dict(r)


def _reopen(data: dict, d: dict) -> None:
    item = data["items"].get(d["item"]) if d["item"] else None
    if item and item["decision"] == d["id"]:
        item.update(status="open", decided_by=None, decided_at=None, decision=None, skipped_by=[])


# ---------------------------------------------------------------- reading the queue


def _names(ids: set[str]) -> dict[str, dict]:
    cards = auth.names_for({i for i in ids if i and i.startswith("u-")})
    cards["auto"] = {"id": "auto", "name": "auto", "username": None, "avatar": None}
    return cards


def _view(item: dict, names: dict, data: dict) -> dict:
    out = {k: v for k, v in item.items() if k != "skipped_by"}
    out["current"] = current(item["type"], item["subject"], data)
    if item["type"] == "bg" and item["subject"].startswith("word:"):
        r = query_one("SELECT headword, reading FROM word WHERE id = ?", (int(item["subject"][5:]),))
        out["label"] = f"{r['headword']}" if r else item["subject"]
    out["createdBy"] = names.get(item["created_by"])
    out["decidedBy"] = names.get(item["decided_by"]) if item["decided_by"] else None
    return out


def queue(user_id: str, type_: str | None = None, origin: str | None = None, limit: int = 50,
          skipped: bool = False) -> dict:
    """Open items, worst first: highest priority, then oldest; your skips left
    out, or only your skips with `skipped`. `types` counts what waits per type
    (for the filter, before the type is picked), `skipped` how many you skipped."""
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
        and (i["type"] != "word_sense" or i["subject"].split("|")[0] in accepted)
        # Bulgarian waits for the meanings too: the groups are its context.
        and (i["type"] != "bg" or not _bg_waits(i["subject"], pending))
        and (origin is None or i["origin"] == origin)
    ]
    mine = [i for i in waiting if (user_id in i["skipped_by"]) == skipped]
    types = {t: 0 for t in TYPES}
    for i in mine:
        types[i["type"]] += 1
    rows = [i for i in mine if type_ is None or i["type"] == type_]
    rows.sort(key=lambda i: (-(i.get("priority") or 0), i["created"]))
    names = _names({i["created_by"] for i in rows[:limit]})
    return {
        "total": len(rows),
        "items": [_view(i, names, data) for i in rows[:limit]],
        "types": types,
        "skipped": sum(1 for i in waiting if user_id in i["skipped_by"] and (type_ is None or i["type"] == type_)),
    }


def _meanings_pending(data: dict) -> set[str]:
    """Kanji that have a meanings task whose groups are not accepted yet."""
    has = {i["subject"] for i in data["items"].values() if i["type"] == "kanji_senses"}
    return has - set(data["live"]["kanji_senses"])


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
    kind, _, key = subject.partition(":")
    if kind == "kanji":
        return key in pending
    return any(c in pending for c in _headword(int(key)))


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
    if it["type"] == "decomposition" and isinstance(it["proposed"], list):
        view["impact"] = impact(it["subject"], it["proposed"])
    view["history"] = [d for d in data["decisions"] if d["type"] == it["type"] and d["subject"] == it["subject"]][-10:]
    return view


def context(type_: str, subject: str, data: dict | None = None) -> dict:
    """What a reviewer needs beside the item: the word, the kanji's meanings, the forms."""
    data = data or _read()
    if type_ in ("kanji_senses", "word_sense"):
        char = subject.split("|")[0]
        k = query_one("SELECT meanings, on_yomi, kun_yomi FROM kanji WHERE char = ?", (char,))
        cur = query_one("SELECT meaning FROM kanji_curated WHERE char = ?", (char,))
        out = {
            "char": char,
            "kanjidic": json.loads(k["meanings"]) if k else [],
            "curated": cur["meaning"] if cur else None,
            "on": json.loads(k["on_yomi"]) if k and k["on_yomi"] else [],
            "kun": json.loads(k["kun_yomi"]) if k and k["kun_yomi"] else [],
            "senses": (data["live"]["kanji_senses"].get(char) or {}).get("senses"),
        }
        from .routes.search import _fetch_words

        if type_ == "word_sense":
            wid = int(subject.split("|")[1])
            out["word"] = _fetch_words([wid]).get(wid)
        else:
            out["board"] = board(char, data)
        return out
    if type_ == "form_link":
        a, b = subject.split("|")
        return {"a": forms.forms_of(a), "b": forms.forms_of(b)}
    if type_ == "bg":
        from .routes.search import _fetch_words

        kind, _, key = subject.partition(":")
        if kind == "word":
            wid = int(key)
            live = data["live"]
            # For each of the word's kanji with accepted groups: the group it is in here.
            groups = []
            for c in dict.fromkeys(_headword(wid)):
                senses = (live["kanji_senses"].get(c) or {}).get("senses")
                if not senses:
                    continue
                placed = (live["word_sense"].get(f"{c}|{wid}") or {}).get("sense")
                g = next((x for x in senses if x["id"] == placed), None)
                groups.append({"char": c, "group": placed, "en": g["en"] if g else None, "bg": g.get("bg") if g else None})
            return {"word": _fetch_words([wid]).get(wid), "built": _bg_built(subject), "groups": groups}
        k = query_one("SELECT meanings, on_yomi, kun_yomi, jlpt, grade, freq FROM kanji WHERE char = ?", (key,))
        cur = query_one("SELECT meaning FROM kanji_curated WHERE char = ?", (key,))
        return {
            "char": key,
            "kanjidic": json.loads(k["meanings"]) if k else [],
            "curated": cur["meaning"] if cur else None,
            "on": json.loads(k["on_yomi"]) if k and k["on_yomi"] else [],
            "kun": json.loads(k["kun_yomi"]) if k and k["kun_yomi"] else [],
            "built": _bg_built(subject),
            "senses": (data["live"]["kanji_senses"].get(key) or {}).get("senses"),
        }
    return {"forms": forms.forms_of(subject)}


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
    }


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
    from .routes.search import _fetch_words

    data = data or _read()
    prefix = f"{char}|"
    placed = {int(k[len(prefix):]): v["sense"] for k, v in data["live"]["word_sense"].items() if k.startswith(prefix)}
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
    """How far review has got: tasks decided per stage, and how many N5-N2
    kanji are fully verified -- nothing open on its parts (to any depth) or
    its forms, its meanings accepted, and none of its words waiting.

    A task is what a reviewer decides in one go. A kanji's meanings are one,
    with all its drafted words on the board, so drafted word placements are
    counted apart (`words`), not as tasks; only a word on its own (a user's
    suggestion, a word reopened when its group changed) is a task.
    """
    from .routes.graph import children_of

    data = _read()
    stages = {t: {"done": 0, "total": 0} for t in TYPES}
    words = {"done": 0, "total": 0}
    open_by: dict[str, set[str]] = {t: set() for t in TYPES}
    for i in data["items"].values():
        if i["status"] == "open":
            open_by[i["type"]].add(i["subject"])
        drafted = i["type"] == "word_sense" and i["source"].startswith("ai:")
        count = words if drafted else stages[i["type"]]
        count["total"] += 1
        if i["status"] != "open":
            count["done"] += 1
    # The kanji in the meanings scope: N5-N2, plus the frequent ones the JLPT lists miss (DATA-ISSUES.md).
    targets = sorted({i["subject"] for i in data["items"].values() if i["type"] == "kanji_senses"})

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

    open_forms = {c for s in open_by["form_link"] for c in s.split("|")}
    open_words = {s.split("|")[0] for s in open_by["word_sense"]}
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
    entry = _read()["live"]["kanji_senses"].get(char)
    return entry["senses"] if entry else None


def word_senses(char: str) -> dict[int, str]:
    """word id -> sense id, for this kanji's accepted word assignments."""
    prefix = f"{char}|"
    return {int(k[len(prefix):]): v["sense"] for k, v in _read()["live"]["word_sense"].items() if k.startswith(prefix)}


def _form_overlay() -> tuple[list[dict], set[tuple[str, str, str]]]:
    added: list[dict] = []
    removed: set[tuple[str, str, str]] = set()
    for subject, v in _read()["live"]["form_link"].items():
        a, b = subject.split("|")
        for k in forms.KINDS:
            removed |= {(a, b, k), (b, a, k)}
        if v["kind"] == "none":
            continue
        row = {"char": a, "other": b, "kind": v["kind"], "source": f"review:{v['decision']}", "note": v.get("note")}
        added.append(row)
        if v["kind"] == "positional":
            added.append({**row, "char": b, "other": a})
    return added, removed


forms.overlay = _form_overlay


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
        with _lock:
            data = _load()
            data["pack_key"] = key
            _save(data)
    return key


def _flush_pack() -> None:
    global _pack_timer
    with _lock:
        _pack_timer = None
        data = _load()
        data["pack_key"] = _overrides_key()
        _save(data)
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
        a, b = subject.split("|")
        removed += [{"char": x, "other": y, "kind": k} for k in forms.KINDS for x, y in ((a, b), (b, a))]
        if v["kind"] != "none":
            links.append({"char": a, "other": b, "kind": v["kind"], "note": v.get("note"), "decision": v["decision"]})
            if v["kind"] == "positional":
                links.append({"char": b, "other": a, "kind": "positional", "note": v.get("note"), "decision": v["decision"]})
    EXPORTS["form_link"].write_text(
        json.dumps({"links": links, "removed": removed}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    meaning = {
        "senses": {c: v["senses"] for c, v in sorted(data["live"]["kanji_senses"].items())},
        "words": {k: v["sense"] for k, v in sorted(data["live"]["word_sense"].items())},
    }
    EXPORTS["meaning"].write_text(json.dumps(meaning, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {"decomposition": len(ov), "form_link": len(data["live"]["form_link"]),
            "kanji_senses": len(meaning["senses"]), "word_sense": len(meaning["words"])}


def load_bg(dry_run: bool = False) -> dict[str, int]:
    """Queue the machine-translated Bulgarian for checking: one card per word in
    the labeling scope (common, or a newspaper rank or JLPT level) and one per
    jōyō or JLPT kanji, most frequent first, kanji before words, all after the
    other stages in the "all" list. A card already queued is not queued twice."""
    rows = []
    for r in query("SELECT k.char, k.freq FROM kanji k JOIN kanji_bg b ON b.char = k.char "
                   "WHERE k.joyo = 1 OR k.jlpt IS NOT NULL"):
        subject = f"kanji:{r['char']}"
        rows.append({"type": "bg", "subject": subject, "proposed": _bg_built(subject), "source": "mt:claude-sonnet-5",
                     "priority": round(0.99 - min(r["freq"] or 2500, 2500) / 100000, 5)})
    for r in query("SELECT DISTINCT w.id, w.nf, j.level AS jlpt FROM word w JOIN sense_bg b ON b.word_id = w.id "
                   "LEFT JOIN word_jlpt j ON j.word_id = w.id WHERE w.common = 1 OR w.nf IS NOT NULL OR j.level IS NOT NULL"):
        subject = f"word:{r['id']}"
        pri = 0.8 - r["nf"] / 100 if r["nf"] else (0.3 - (6 - r["jlpt"]) / 100 if r["jlpt"] else 0.2)
        rows.append({"type": "bg", "subject": subject, "proposed": _bg_built(subject), "source": "mt:claude-sonnet-5",
                     "priority": round(pri, 5)})
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
    else:
        print("usage: python -m server.review export | load-bg [--dry-run]")
