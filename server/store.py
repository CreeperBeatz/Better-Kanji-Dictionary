"""Your associations, and your decomposition fixes, on disk.

This is the only mutable state in the app and the only part that cannot be
rebuilt from a download, so it is written to a real folder rather than living in
browser storage: `data/associations/store.json` plus an `images/` directory, both
git-committable and safe from a cleared cache.

A drawing is an ordinary image in that list whose PNG has an Excalidraw scene
beside it under the same stem (`<id>.png` + `<id>.excalidraw`). Records only
ever name the PNG, so anything that shows images needs no special case, and
the scene is what lets a drawing be reopened and carried on with.

Everything is layered by author. An author is a signed-in account (see
server/auth.py) or an imported bundle, which belongs to the account that
imported it. An account can post any number of notes on a character, like
comments, and each is `private` (only its author sees it) or `public`
(everyone does). Imported
layers are only ever shown to their importer.

Notes written before accounts existed belong to the author "local" and are
invisible until an account claims them -- the one whose email is
BETTERRTK_OWNER_EMAIL, or the first to sign in if that is unset.

Signed-out notes never reach this file; the browser keeps them (web/src/localNotes.ts).

Public notes are also the comment section under each character: others can give
one a thumbs up (`likes`, note id -> the accounts that liked it) and reply to it
(`replies`, flat, oldest first). Both go with the note when it is deleted, and
are hidden with it when it is made private again.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent
ASSOC_DIR = ROOT / "data" / "associations"
STORE = ASSOC_DIR / "store.json"
IMAGES = ASSOC_DIR / "images"

# Author of every note written before there were accounts.
LOCAL_AUTHOR = "local"
VISIBILITIES = ("private", "public")

_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _empty() -> dict:
    return {
        "version": 1,
        "authors": {
            LOCAL_AUTHOR: {"id": LOCAL_AUTHOR, "name": "me", "local": True, "imported": None}
        },
        "associations": {},
        "decomposition": {},
        "likes": {},
        "replies": {},
    }


# The last parse, for reads: (mtime_ns, size) of the file it came from, and
# the data. Every kanji page reads the store several times (overrides, notes,
# comments), and parsing it each time grew with every note posted.
_snapshot: tuple[tuple[int, int], dict] | None = None


def _read() -> dict:
    """The store for reading only -- shared, so never mutate what it returns.

    Reparsed when the file changes, so a script editing store.json while the
    server runs is picked up as before. Writers use load(), which parses a copy
    of their own: a write that fails halfway must not leave its edits in here.
    Not for use while holding _lock, which it takes to reparse.
    """
    global _snapshot
    snap = _snapshot
    if snap is not None and snap[0] == _stat_key():
        return snap[1]
    # Under the writers' lock, so a save cannot land between the stat and the
    # parse and leave older data filed under the newer file's key.
    with _lock:
        key = _stat_key()
        if key is None:
            return _empty()
        if _snapshot is None or _snapshot[0] != key:
            _snapshot = (key, load())
        return _snapshot[1]


def _stat_key() -> tuple[int, int] | None:
    try:
        st = STORE.stat()
    except FileNotFoundError:
        return None
    return (st.st_mtime_ns, st.st_size)


def load() -> dict:
    if not STORE.exists():
        return _empty()
    try:
        data = json.loads(STORE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        # Never silently start from scratch over a parse error -- that would
        # destroy the one irreplaceable thing here.
        backup = STORE.with_suffix(f".corrupt-{int(datetime.now().timestamp())}.json")
        shutil.copy2(STORE, backup)
        raise RuntimeError(f"{STORE} is not valid JSON; copied to {backup.name} and stopped")
    data.setdefault("authors", _empty()["authors"])
    data.setdefault("associations", {})
    data.setdefault("decomposition", {})
    data.setdefault("likes", {})
    data.setdefault("replies", {})
    return data


def save(data: dict) -> None:
    global _snapshot
    ASSOC_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STORE)
    # The stat key would notice too, unless two saves land in one mtime tick
    # at the same size.
    _snapshot = None


# ---------------------------------------------------------------- associations


def _visible(rec: dict, viewer: str | None, authors: dict) -> bool:
    if viewer and rec["author"] == viewer:
        return True
    author = authors.get(rec["author"], {})
    if author.get("owner") is not None:
        # An imported layer: only for whoever imported it.
        return author["owner"] == viewer
    if rec["author"] == LOCAL_AUTHOR:
        return False
    return rec.get("visibility") == "public"


def for_char(char: str, viewer: str | None, only_mine: bool = False) -> list[dict]:
    """The notes on this character that `viewer` may see, theirs first."""
    data = _read()
    rows = [
        dict(a)
        for a in data["associations"].values()
        if a["char"] == char
        and (a["author"] == viewer if only_mine else _visible(a, viewer, data["authors"]))
    ]
    # Your own note leads; everyone else's follow, newest first.
    rows.sort(key=lambda a: a.get("updated", ""), reverse=True)
    rows.sort(key=lambda a: a["author"] != viewer)
    for r in rows:
        r["authorName"] = data["authors"].get(r["author"], {}).get("name", r["author"])
        r["drawings"] = [i for i in r.get("images", []) if scene_path(i).exists()]
        r.setdefault("visibility", "private")
    return rows


def ensure_author(user: dict) -> None:
    """Keep an account's entry in the author list, and its public profile, current."""
    entry = {
        "id": user["id"],
        "name": user["name"],
        "username": user.get("username"),
        "avatar": user.get("avatar"),
        "local": True,
        "imported": None,
    }
    with _lock:
        data = load()
        if data["authors"].get(user["id"]) == entry:
            return
        data["authors"][user["id"]] = entry
        save(data)


def sync_authors(users: list[dict]) -> None:
    for user in users:
        ensure_author(user)


def author_card(data: dict, author_id: str) -> dict:
    """What a comment shows about who wrote it. Never the email address."""
    a = data["authors"].get(author_id, {})
    return {
        "id": author_id,
        "name": a.get("name", author_id),
        "username": a.get("username"),
        "avatar": a.get("avatar"),
    }


def claim_legacy(user_id: str, email: str) -> int:
    """Hand pre-account notes, and imports, to their owner. Returns how many moved."""
    owner = (os.environ.get("BETTERRTK_OWNER_EMAIL") or "").strip().lower()
    with _lock:
        data = load()
        if data.get("legacyClaimedBy"):
            return 0
        if owner and owner != email:
            return 0
        moved = 0
        for rec in data["associations"].values():
            if rec["author"] != LOCAL_AUTHOR:
                continue
            rec["author"] = user_id
            rec.setdefault("visibility", "private")
            moved += 1
        for author in data["authors"].values():
            if author["id"].startswith("import-") and author.get("owner") is None:
                author["owner"] = user_id
        data["legacyClaimedBy"] = user_id
        save(data)
        return moved


def scene_path(image: str) -> Path:
    return IMAGES / f"{Path(image).stem}.excalidraw"


def _drop_unused(images: list[str], data: dict) -> None:
    """Delete these image files, and their scenes, if no record still names them."""
    still_used = {img for a in data["associations"].values() for img in a.get("images", [])}
    for img in images:
        if img not in still_used:
            (IMAGES / img).unlink(missing_ok=True)
            scene_path(img).unlink(missing_ok=True)


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


def _record(char: str, author: str, text: str, images: list[str], visibility: str, adopted: str | None = None) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "char": char,
        "author": author,
        "text": text,
        "images": images,
        "visibility": visibility,
        "adoptedFrom": adopted,
        "created": _now(),
        "updated": _now(),
    }


def create(char: str, text: str, images: list[str], author: str, visibility: str = "private") -> dict:
    """Post a new note. Several per character are fine, like comments."""
    with _lock:
        data = load()
        record = _record(char, author, text, images, visibility)
        data["associations"][record["id"]] = record
        save(data)
        return record


def _own(data: dict, assoc_id: str, author: str) -> dict:
    rec = data["associations"].get(assoc_id)
    if not rec:
        raise NotFound()
    if rec["author"] != author:
        raise Forbidden()
    return rec


def update(assoc_id: str, author: str, text: str | None = None, images: list[str] | None = None,
           visibility: str | None = None) -> dict:
    """Edit your own note; any field left as None keeps its value."""
    with _lock:
        data = load()
        rec = _own(data, assoc_id, author)
        dropped = [i for i in rec.get("images", []) if images is not None and i not in images]
        if text is not None:
            rec["text"] = text
        if images is not None:
            rec["images"] = images
        if visibility is not None:
            rec["visibility"] = visibility
        rec["updated"] = _now()
        save(data)
        # Only after saving: an edited drawing replaces its old PNG in the list,
        # and the old one should not outlive the save that let go of it.
        _drop_unused(dropped, data)
        return rec


def delete(assoc_id: str, author: str) -> None:
    with _lock:
        data = load()
        target = _own(data, assoc_id, author)
        del data["associations"][assoc_id]
        _drop_thread(data, assoc_id)
        save(data)
        # Drop images this record owned and nothing else references.
        _drop_unused(target.get("images", []), data)


def adopt(assoc_id: str, author: str) -> dict | None:
    """Copy someone else's note into your own layer, as a new private note."""
    with _lock:
        data = load()
        src = data["associations"].get(assoc_id)
        if not src or src["author"] == author or not _visible(src, author, data["authors"]):
            return None
        record = _record(src["char"], author, src["text"], list(src["images"]), "private", src["id"])
        data["associations"][record["id"]] = record
        save(data)
        return record


# ---------------------------------------------------------------- comments


def _discussable(rec: dict | None) -> bool:
    """A note others can like and reply to: public, and written by an account."""
    return bool(rec) and rec.get("visibility") == "public" and rec["author"].startswith("u-")


def _drop_thread(data: dict, assoc_id: str) -> None:
    data["likes"].pop(assoc_id, None)
    for rid in [r["id"] for r in data["replies"].values() if r["assoc"] == assoc_id]:
        del data["replies"][rid]


SORTS = ("liked", "new")


def notes_for(char: str, viewer: str | None, offset: int, limit: int, sort: str = "liked") -> dict:
    """What the associations tab shows for one character.

    `mine` is all of the viewer's own notes, never paged: private first, then
    public, newest first within each. `items` is one page of everyone else's
    public notes, most liked or newest first; `total` counts those.
    """
    data = _read()
    reply_counts: dict[str, int] = {}
    for r in data["replies"].values():
        reply_counts[r["assoc"]] = reply_counts.get(r["assoc"], 0) + 1

    def likes(a: dict) -> list[str]:
        return data["likes"].get(a["id"], [])

    def view(a: dict) -> dict:
        return {
            "id": a["id"],
            "char": a["char"],
            "author": author_card(data, a["author"]),
            "text": a["text"],
            "images": a.get("images", []),
            "drawings": [i for i in a.get("images", []) if scene_path(i).exists()],
            "visibility": a.get("visibility", "private"),
            "created": a.get("created"),
            "updated": a.get("updated"),
            "likes": len(likes(a)),
            "liked": viewer in likes(a) if viewer else False,
            "replies": reply_counts.get(a["id"], 0),
            "mine": a["author"] == viewer,
        }

    # Latest-added first, so notes posted within the same second still read newest first.
    on_char = [a for a in reversed(data["associations"].values()) if a["char"] == char]
    mine = [a for a in on_char if viewer and a["author"] == viewer]
    mine.sort(key=lambda a: a.get("created", ""), reverse=True)
    mine.sort(key=lambda a: a.get("visibility") == "public")

    others = [a for a in on_char if a["author"] != viewer and _discussable(a)]
    others.sort(key=lambda a: a.get("created", ""), reverse=True)
    if sort == "liked":
        others.sort(key=lambda a: len(likes(a)), reverse=True)
    return {
        "char": char,
        "sort": sort,
        "mine": [view(a) for a in mine],
        "total": len(others),
        "offset": offset,
        "items": [view(a) for a in others[offset : offset + limit]],
    }


def set_like(assoc_id: str, user_id: str, liked: bool) -> dict:
    with _lock:
        data = load()
        rec = data["associations"].get(assoc_id)
        if not _discussable(rec):
            raise NotFound()
        if rec["author"] == user_id:
            raise Forbidden()
        who = data["likes"].setdefault(assoc_id, [])
        if liked and user_id not in who:
            who.append(user_id)
        elif not liked and user_id in who:
            who.remove(user_id)
        if not who:
            del data["likes"][assoc_id]
        save(data)
        return {"id": assoc_id, "likes": len(who), "liked": liked}


def _reply_view(data: dict, r: dict, viewer: str | None) -> dict:
    return {
        "id": r["id"],
        "assoc": r["assoc"],
        "author": author_card(data, r["author"]),
        "text": r["text"],
        "created": r["created"],
        "mine": r["author"] == viewer,
    }


def replies(assoc_id: str, viewer: str | None, offset: int, limit: int) -> dict:
    """One page of the replies to a public note, oldest first so they read as a thread."""
    data = _read()
    if not _discussable(data["associations"].get(assoc_id)):
        raise NotFound()
    thread = sorted(
        (r for r in data["replies"].values() if r["assoc"] == assoc_id),
        key=lambda r: r["created"],
    )
    return {
        "assoc": assoc_id,
        "total": len(thread),
        "offset": offset,
        "items": [_reply_view(data, r, viewer) for r in thread[offset : offset + limit]],
    }


def add_reply(assoc_id: str, author: str, text: str) -> dict:
    with _lock:
        data = load()
        if not _discussable(data["associations"].get(assoc_id)):
            raise NotFound()
        # Microseconds, not the store's usual seconds: replies sort by this.
        rec = {
            "id": uuid.uuid4().hex,
            "assoc": assoc_id,
            "author": author,
            "text": text,
            "created": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
        }
        data["replies"][rec["id"]] = rec
        save(data)
        return _reply_view(data, rec, author)


def delete_reply(reply_id: str, user_id: str) -> None:
    """Only a reply's author may take it back."""
    with _lock:
        data = load()
        rec = data["replies"].get(reply_id)
        if not rec:
            raise NotFound()
        if rec["author"] != user_id:
            raise Forbidden()
        del data["replies"][reply_id]
        save(data)


def add_image(raw: bytes, suffix: str) -> str:
    ASSOC_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    (IMAGES / name).write_bytes(raw)
    return name


def add_drawing(png: bytes, scene: str) -> str:
    """Store an exported PNG and the scene it came from; returns the PNG's name."""
    name = add_image(png, ".png")
    scene_path(name).write_text(scene, encoding="utf-8")
    return name


def counts() -> dict:
    data = _read()
    return {
        "associations": len(data["associations"]),
        "characters": len({a["char"] for a in data["associations"].values()}),
        "authors": len(data["authors"]),
        "decompositionOverrides": len(data["decomposition"]),
    }


# ---------------------------------------------------------------- import / export


def export_bundle(author: str) -> dict:
    """Everything of yours, as one portable object. Images travel by name."""
    data = _read()
    me = data["authors"].get(author, {"id": author, "name": author})
    return {
        "version": 1,
        "exported": _now(),
        "authors": {author: {**me, "local": True}},
        "associations": [a for a in data["associations"].values() if a["author"] == author],
        "decomposition": data["decomposition"],
    }


def import_bundle(bundle: dict, owner: str, author_name: str | None = None) -> dict:
    """Bring in someone else's associations as a separate, attributed layer.

    Imported records never overwrite yours -- they arrive under their own author
    so both are visible side by side and you choose what to adopt.
    """
    with _lock:
        data = load()
        incoming = bundle.get("associations") or []
        src_authors = bundle.get("authors") or {}

        # One new author id per import, so two imports from the same person stay
        # distinguishable and can be removed independently.
        layer = f"import-{uuid.uuid4().hex[:8]}"
        name = author_name or next(
            (a.get("name") for a in src_authors.values() if a.get("local")), None
        ) or "imported"
        data["authors"][layer] = {
            "id": layer,
            "name": name,
            "local": False,
            "imported": _now(),
            "owner": owner,
        }

        added = 0
        for rec in incoming:
            if not rec.get("char"):
                continue
            new_id = uuid.uuid4().hex
            data["associations"][new_id] = {
                "id": new_id,
                "char": rec["char"],
                "author": layer,
                "text": rec.get("text", ""),
                "images": rec.get("images", []),
                "visibility": "private",
                "adoptedFrom": rec.get("id"),
                "created": rec.get("created", _now()),
                "updated": rec.get("updated", _now()),
            }
            added += 1

        save(data)
        return {"author": layer, "name": name, "added": added}


# ---------------------------------------------------------------- decomposition


def decomposition_overrides() -> dict[str, list[str]]:
    return _read()["decomposition"]


def set_decomposition(char: str, components: list[str]) -> dict:
    with _lock:
        data = load()
        data["decomposition"][char] = components
        save(data)
        _write_override_file(data["decomposition"])
        return {"char": char, "components": components}


def clear_decomposition(char: str) -> bool:
    with _lock:
        data = load()
        if char not in data["decomposition"]:
            return False
        del data["decomposition"][char]
        save(data)
        _write_override_file(data["decomposition"])
        return True


def _write_override_file(overrides: dict[str, list[str]]) -> None:
    """Mirror overrides to the file the pipeline reads, so a rebuild keeps them."""
    path = ROOT / "data" / "decomp_overrides.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8")
