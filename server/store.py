"""Your associations, and your decomposition fixes, on disk.

This is the only mutable state in the app and the only part that cannot be
rebuilt from a download, so it is written to a real folder rather than living in
browser storage: `data/associations/store.json` plus an `images/` directory, both
git-committable and safe from a cleared cache.

Everything is layered by author from the start. Today there is one author -- you
-- but every record carries who wrote it and where it came from, so importing
someone else's bundle and adopting individual notes needs no migration later.
"""

from __future__ import annotations

import json
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

LOCAL_AUTHOR = "local"

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


def for_char(char: str) -> list[dict]:
    data = load()
    rows = [a for a in data["associations"].values() if a["char"] == char]
    # Your own layer leads; imported layers follow, newest first.
    rows.sort(key=lambda a: (a["author"] != LOCAL_AUTHOR, a.get("updated", "")), reverse=False)
    for r in rows:
        r["authorName"] = data["authors"].get(r["author"], {}).get("name", r["author"])
    return rows


def upsert(char: str, text: str, images: list[str], author: str = LOCAL_AUTHOR) -> dict:
    with _lock:
        data = load()
        existing = next(
            (a for a in data["associations"].values() if a["char"] == char and a["author"] == author),
            None,
        )
        if existing:
            existing.update(text=text, images=images, updated=_now())
            record = existing
        else:
            record = {
                "id": uuid.uuid4().hex,
                "char": char,
                "author": author,
                "text": text,
                "images": images,
                "adoptedFrom": None,
                "created": _now(),
                "updated": _now(),
            }
            data["associations"][record["id"]] = record
        save(data)
        return record


def delete(char: str, author: str = LOCAL_AUTHOR) -> bool:
    with _lock:
        data = load()
        target = next(
            (a for a in data["associations"].values() if a["char"] == char and a["author"] == author),
            None,
        )
        if not target:
            return False
        # Drop images this record owned and nothing else references.
        others = [a for a in data["associations"].values() if a["id"] != target["id"]]
        still_used = {img for a in others for img in a.get("images", [])}
        for img in target.get("images", []):
            if img not in still_used:
                (IMAGES / img).unlink(missing_ok=True)
        del data["associations"][target["id"]]
        save(data)
        return True


def adopt(assoc_id: str) -> dict | None:
    """Copy someone else's note into your own layer, keeping the attribution."""
    with _lock:
        data = load()
        src = data["associations"].get(assoc_id)
        if not src or src["author"] == LOCAL_AUTHOR:
            return None
        mine = next(
            (
                a
                for a in data["associations"].values()
                if a["char"] == src["char"] and a["author"] == LOCAL_AUTHOR
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
                "author": LOCAL_AUTHOR,
                "text": src["text"],
                "images": list(src["images"]),
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


def counts() -> dict:
    data = load()
    return {
        "associations": len(data["associations"]),
        "characters": len({a["char"] for a in data["associations"].values()}),
        "authors": len(data["authors"]),
        "decompositionOverrides": len(data["decomposition"]),
    }


# ---------------------------------------------------------------- import / export


def export_bundle() -> dict:
    """Everything of yours, as one portable object. Images travel by name."""
    data = load()
    return {
        "version": 1,
        "exported": _now(),
        "authors": data["authors"],
        "associations": list(data["associations"].values()),
        "decomposition": data["decomposition"],
    }


def import_bundle(bundle: dict, author_name: str | None = None) -> dict:
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
