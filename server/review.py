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

from . import auth, forms, store
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

TYPES = ("decomposition", "form_link", "kanji_senses", "word_sense")
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
        "live": {"form_link": {}, "kanji_senses": {}, "word_sense": {}},
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
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(FILE)
    _snapshot = None


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


def validate(type_: str, subject: str, value: Any, data: dict | None = None, pending_ok: bool = False) -> Any:
    """`value` cleaned, or an AppError saying what is wrong with it. None clears an override.

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
        if strokes:
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
    return live_value(type_, subject, data)


def _apply(data: dict, type_: str, subject: str, value: Any, decision: str) -> None:
    """Make `value` live (None: back to the built data). The caller saves."""
    if type_ == "decomposition":
        if value is None:
            store.clear_decomposition(subject)
        else:
            store.set_decomposition(subject, value)
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
        _reopen_words(data, subject, before, value, decision)
        _auto_words(data, subject, value)
    else:
        live[subject] = {"sense": value, "decision": decision}


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
        proposed = validate(type_, subject, proposed, data, pending_ok=origin == "proposal")
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
                proposed = validate(r["type"], r["subject"], r.get("proposed"), data, pending_ok=True)
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


def decide(item_id: str, action: str, user_id: str, value: Any = None, reason: str | None = None) -> dict:
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
        d = _decision(action, type_, subject, before, after, user_id, item_id, reason)
        _apply(data, type_, subject, after, d["id"])
        item.update(
            status="accepted" if action == "accept" else "edited",
            decided_by=user_id, decided_at=d["at"], decision=d["id"],
        )
        data["decisions"].append(d)
        _save(data)
        return dict(item)


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
        after = validate(item["type"], item["subject"], item["proposed"], data)
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
        _apply(data, d["type"], d["subject"], d["before"], r["id"])
        d["reverted_by"] = r["id"]
        item = data["items"].get(d["item"]) if d["item"] else None
        if item and item["decision"] == decision_id:
            item.update(status="open", decided_by=None, decided_at=None, decision=None, skipped_by=[])
        data["decisions"].append(r)
        _save(data)
        return dict(r)


# ---------------------------------------------------------------- reading the queue


def _names(ids: set[str]) -> dict[str, dict]:
    cards = auth.names_for({i for i in ids if i and i.startswith("u-")})
    cards["auto"] = {"id": "auto", "name": "auto", "username": None, "avatar": None}
    return cards


def _view(item: dict, names: dict, data: dict) -> dict:
    out = {k: v for k, v in item.items() if k != "skipped_by"}
    out["current"] = current(item["type"], item["subject"], data)
    out["createdBy"] = names.get(item["created_by"])
    out["decidedBy"] = names.get(item["decided_by"]) if item["decided_by"] else None
    return out


def queue(user_id: str, type_: str | None = None, origin: str | None = None, limit: int = 50) -> dict:
    """Open items, worst first: highest priority, then oldest; your skips left out."""
    data = _read()
    accepted = data["live"]["kanji_senses"]
    rows = [
        i for i in data["items"].values()
        if i["status"] == "open"
        and user_id not in i["skipped_by"]
        # A word's meaning waits until its kanji's meanings are accepted.
        and (i["type"] != "word_sense" or i["subject"].split("|")[0] in accepted)
        and (type_ is None or i["type"] == type_)
        and (origin is None or i["origin"] == origin)
    ]
    rows.sort(key=lambda i: (-(i.get("priority") or 0), i["created"]))
    names = _names({i["created_by"] for i in rows[:limit]})
    return {"total": len(rows), "items": [_view(i, names, data) for i in rows[:limit]]}


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
            # The drafted word assignments, as examples of each proposed group.
            pending = [
                i for i in data["items"].values()
                if i["type"] == "word_sense" and i["subject"].startswith(f"{char}|") and i["status"] == "open"
            ]
            pending.sort(key=lambda i: -(i.get("priority") or 0))
            ids = [int(i["subject"].split("|")[1]) for i in pending[:80]]
            words = _fetch_words(ids)
            out["drafts"] = [
                {
                    "word": w["headword"],
                    "reading": w["reading"],
                    "gloss": (w["senses"][0]["gloss"] if w["senses"] else "").split(";")[0],
                    "proposed": i["proposed"],
                }
                for i, wid in zip(pending, ids)
                if (w := words.get(wid))
            ]
        return out
    if type_ == "form_link":
        a, b = subject.split("|")
        return {"a": forms.forms_of(a), "b": forms.forms_of(b)}
    return {"forms": forms.forms_of(subject)}


def history(user_id: str | None, limit: int = 100, type_: str | None = None) -> dict:
    """Decisions, newest first: one reviewer's, or everyone's for the admin."""
    data = _read()
    rows = [
        d for d in reversed(data["decisions"])
        if (user_id is None or d["by"] == user_id) and (type_ is None or d["type"] == type_)
    ][:limit]
    names = _names({d["by"] for d in rows})
    return {"items": [{**d, "byCard": names.get(d["by"])} for d in rows]}


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
    return hashlib.sha256(json.dumps(ov, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


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


if __name__ == "__main__":
    if sys.argv[1:] == ["export"]:
        for k, n in export().items():
            print(f"{k:14} {n:>6}")
        print("wrote " + ", ".join(str(p.relative_to(ROOT)) for p in EXPORTS.values()))
    else:
        print("usage: python -m server.review export")
