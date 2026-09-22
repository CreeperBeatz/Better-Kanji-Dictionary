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
imported it. Each account has at most one note per character, and each note is
`private` (only its author sees it) or `public` (everyone does). Imported
layers are only ever shown to their importer.

Notes written before accounts existed belong to the author "local" and are
invisible until an account claims them -- the one whose email is
BETTERRTK_OWNER_EMAIL, or the first to sign in if that is unset.

Signed-out notes never reach this file; the browser keeps them (web/src/localNotes.ts).
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
    }


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
    return data


def save(data: dict) -> None:
    ASSOC_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STORE)


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
    data = load()
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


def ensure_author(user_id: str, name: str) -> None:
    """Keep an account's entry in the author list, and its display name, current."""
    with _lock:
        data = load()
        entry = data["authors"].get(user_id)
        if entry and entry.get("name") == name:
            return
        data["authors"][user_id] = {"id": user_id, "name": name, "local": True, "imported": None}
        save(data)


def claim_legacy(user_id: str, email: str) -> int:
    """Hand pre-account notes, and imports, to their owner. Returns how many moved."""
    owner = (os.environ.get("BETTERRTK_OWNER_EMAIL") or "").strip().lower()
    with _lock:
        data = load()
        if data.get("legacyClaimedBy"):
            return 0
        if owner and owner != email:
            return 0
        # This account's own notes win over legacy ones on the same character.
        taken = {a["char"] for a in data["associations"].values() if a["author"] == user_id}
        moved = 0
        for rec in data["associations"].values():
            if rec["author"] != LOCAL_AUTHOR or rec["char"] in taken:
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


def upsert(char: str, text: str, images: list[str], author: str, visibility: str = "private") -> dict:
    with _lock:
        data = load()
        existing = next(
            (a for a in data["associations"].values() if a["char"] == char and a["author"] == author),
            None,
        )
        if existing:
            dropped = [i for i in existing.get("images", []) if i not in images]
            existing.update(text=text, images=images, visibility=visibility, updated=_now())
            record = existing
        else:
            record = {
                "id": uuid.uuid4().hex,
                "char": char,
                "author": author,
                "text": text,
                "images": images,
                "visibility": visibility,
                "adoptedFrom": None,
                "created": _now(),
                "updated": _now(),
            }
            data["associations"][record["id"]] = record
            dropped = []
        save(data)
        # Only after saving: an edited drawing replaces its old PNG in the list,
        # and the old one should not outlive the save that let go of it.
        _drop_unused(dropped, data)
        return record


def delete(char: str, author: str) -> bool:
    with _lock:
        data = load()
        target = next(
            (a for a in data["associations"].values() if a["char"] == char and a["author"] == author),
            None,
        )
        if not target:
            return False
        del data["associations"][target["id"]]
        save(data)
        # Drop images this record owned and nothing else references.
        _drop_unused(target.get("images", []), data)
        return True


def adopt(assoc_id: str, author: str) -> dict | None:
    """Copy someone else's note into your own layer, keeping the attribution."""
    with _lock:
        data = load()
        src = data["associations"].get(assoc_id)
        if not src or src["author"] == author or not _visible(src, author, data["authors"]):
            return None
        mine = next(
            (
                a
                for a in data["associations"].values()
                if a["char"] == src["char"] and a["author"] == author
            ),
            None,
        )
        if mine:
            mine.update(text=src["text"], images=list(src["images"]), adoptedFrom=src["id"], updated=_now())
            record = mine
        else:
            record = {
                "id": uuid.uuid4().hex,
                "char": src["char"],
                "author": author,
                "text": src["text"],
                "images": list(src["images"]),
                "visibility": "private",
                "adoptedFrom": src["id"],
                "created": _now(),
                "updated": _now(),
            }
            data["associations"][record["id"]] = record
        save(data)
        return record


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
    data = load()
    return {
        "associations": len(data["associations"]),
        "characters": len({a["char"] for a in data["associations"].values()}),
        "authors": len(data["authors"]),
        "decompositionOverrides": len(data["decomposition"]),
    }


# ---------------------------------------------------------------- import / export


def export_bundle(author: str) -> dict:
    """Everything of yours, as one portable object. Images travel by name."""
    data = load()
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
    return load()["decomposition"]


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
