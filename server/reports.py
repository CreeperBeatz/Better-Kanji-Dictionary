"""Reports: a signed-in user says, in their own words, what is wrong.

A report changes nothing on the site. We read the reports in Claude Code,
check them, find the common pattern and fix every case of it (TASK-reports-first.md).
The site only takes reports, lists them for the admin, and shows each
reporter what became of theirs.

data/reports/reports.db (SQLite): a row per report, its JSON in `body`.
Attached pictures go to data/reports/files/<report id>/. Only the admin and
the reporter can open them.

For Claude Code (no UI):

    python -m server.reports export <dir> [--all]     # open reports (or all) as reports.json + their pictures
    python -m server.reports close <id> <status> [reply]
    python -m server.reports close --file <batch.json> # [{"id": ..., "status": ..., "reply": ...}]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import auth
from .errors import AppError

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "data" / "reports"
DB = REPORTS_DIR / "reports.db"
FILES = REPORTS_DIR / "files"

STATUSES = ("open", "fixed", "not_a_mistake", "duplicate")
MAX_TEXT = 4000
MAX_REPLY = 1000
MAX_FILES = 3
MAX_FILE_BYTES = 5 * 1024 * 1024
# A passionate user can send many; this only stops a script (Dani, 2026-11-02).
MAX_PER_DAY = 100
# The type is read from the file's first bytes, never from its name or what the browser says.
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
SUBJECT = re.compile(r"^(kanji:.|word:\d{1,9})$")
CONTEXT_KEYS = {"url": 500, "lang": 8, "screen": 20, "from": 200, "app": 40, "view": 200}

SCHEMA = """
CREATE TABLE IF NOT EXISTS report (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, created TEXT NOT NULL,
    by_user TEXT NOT NULL, subject TEXT, status TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS report_by ON report (by_user, created);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def use_dir(path: Path) -> None:
    """Keep the reports somewhere else (tests, the sandbox)."""
    global REPORTS_DIR, DB, FILES, _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        REPORTS_DIR, DB, FILES = path, path / "reports.db", path / "files"
        _conn = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _db() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            new = not DB.exists()
            conn = sqlite3.connect(DB, timeout=30, isolation_level=None, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=FULL")
            conn.executescript(SCHEMA)
            _conn = conn
            if new:
                _import_old(conn)
        return _conn


def _row(body: str) -> dict:
    return json.loads(body)


def _put(conn: sqlite3.Connection, r: dict) -> None:
    conn.execute(
        "INSERT INTO report (id, created, by_user, subject, status, body) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (id) DO UPDATE SET status = excluded.status, body = excluded.body",
        (r["id"], r["created"], r["by"], r["subject"], r["status"], json.dumps(r, ensure_ascii=False)),
    )


def _import_old(conn: sqlite3.Connection) -> None:
    """The first time: what users sent through the old review queue (reports and suggested
    changes) comes over as reports, so nothing anyone sent is lost. The queue's rows stay."""
    from . import review

    try:
        items = review._read()["items"].values()
    except Exception:  # noqa: BLE001 -- no review store (a fresh test): nothing to bring over
        return
    for i in items:
        if i.get("origin") != "suggestion":
            continue
        v = i.get("proposed")
        if i["type"] == "report" and isinstance(v, dict):
            text = (v.get("text") or "").strip()
            if v.get("about"):
                text = f"[{v['about']}] {text}"
        else:
            text = f"[suggested change: {i['type']}] {i.get('reason') or ''}\n{json.dumps(v, ensure_ascii=False)}".strip()
        subject = i["subject"].split("|")[0] if i["type"] != "report" else i["subject"]
        if not subject.startswith(("kanji:", "word:")):
            subject = f"kanji:{subject}" if len(subject) == 1 else None
        status = "open" if i["status"] == "open" else ("fixed" if i["status"] in ("accepted", "edited", "auto-accepted") else "not_a_mistake")
        _put(conn, {
            "id": f"r-{i['id'][2:]}", "created": i["created"], "by": i["created_by"], "subject": subject,
            "text": text[:MAX_TEXT], "context": {"from": i.get("evidence", {}).get("from")} if isinstance(i.get("evidence"), dict) else {},
            "files": [], "status": status, "reply": None, "closed_at": i.get("decided_at"), "closed_by": i.get("decided_by"),
            "imported_from": i["id"],
        })


def _image_type(raw: bytes) -> str | None:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def _clean_context(context: Any) -> dict:
    """What the page said about itself, each value a short string; anything else is dropped."""
    if not isinstance(context, dict):
        return {}
    return {k: v.strip()[:n] for k, n in CONTEXT_KEYS.items() if isinstance(v := context.get(k), str) and v.strip()}


def _data_version() -> dict:
    """What the site was showing when the report came: the review store's data key, and the code's commit."""
    out: dict[str, str] = {}
    try:
        from . import review

        out["data"] = ".".join(review.pack_key())
    except Exception:  # noqa: BLE001 -- a report is never refused for this
        pass
    if commit := _commit():
        out["commit"] = commit
    return out


def _commit() -> str | None:
    try:
        head = (ROOT / ".git" / "HEAD").read_text().strip()
        if head.startswith("ref: "):
            ref = ROOT / ".git" / head[5:]
            if ref.exists():
                return ref.read_text().strip()[:12]
            packed = (ROOT / ".git" / "packed-refs").read_text()
            m = re.search(rf"^([0-9a-f]{{40}}) {re.escape(head[5:])}$", packed, re.M)
            return m.group(1)[:12] if m else None
        return head[:12]
    except OSError:
        return None


def add(user_id: str, text: str, subject: str | None = None, context: Any = None,
        files: list[bytes] | None = None) -> dict:
    """A new report. `files`: the pictures' raw bytes, as sent."""
    text = (text or "").strip()
    if not text:
        raise AppError(400, "report_empty", "say what is wrong")
    if len(text) > MAX_TEXT:
        raise AppError(400, "report_too_long", "a report can have up to {n} characters", n=MAX_TEXT)
    subject = (subject or "").strip() or None
    if subject is not None and not SUBJECT.match(subject):
        raise AppError(400, "bad_subject", "a report is about a word or a kanji")
    files = files or []
    if len(files) > MAX_FILES:
        raise AppError(400, "report_files", "up to {n} pictures", n=MAX_FILES)
    kinds = []
    for raw in files:
        if len(raw) > MAX_FILE_BYTES:
            raise AppError(400, "report_file_big", "a picture can be up to {n} MB", n=MAX_FILE_BYTES // (1024 * 1024))
        kind = _image_type(raw)
        if kind is None:
            raise AppError(400, "report_file_type", "pictures only: PNG, JPEG or WebP")
        kinds.append(kind)
    # Before the lock: the data version reads the review store and .git, and nothing here needs the lock.
    context = {**_clean_context(context), **_data_version()}
    with _lock:
        conn = _db()
        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        (n,) = conn.execute("SELECT COUNT(*) FROM report WHERE by_user = ? AND created > ?", (user_id, since)).fetchone()
        if n >= MAX_PER_DAY:
            raise AppError(429, "too_many_reports", "you sent {n} reports today; please try again tomorrow", n=n)
        rid = f"r-{uuid.uuid4().hex[:12]}"
        names = []
        if files:
            folder = FILES / rid
            folder.mkdir(parents=True, exist_ok=True)
            for k, (raw, kind) in enumerate(zip(files, kinds), 1):
                name = f"{k}.{kind}"
                (folder / name).write_bytes(raw)
                names.append({"name": name, "type": IMAGE_TYPES[kind], "bytes": len(raw)})
        r = {
            "id": rid, "created": _now(), "by": user_id, "subject": subject, "text": text,
            "context": context, "files": names,
            "status": "open", "reply": None, "closed_at": None, "closed_by": None,
        }
        try:
            _put(conn, r)
        except Exception:
            shutil.rmtree(FILES / rid, ignore_errors=True)
            raise
        return r


def _all(sql: str, args: tuple | list = ()) -> list[tuple]:
    """A read on the one shared connection: the lock keeps two requests' threads off it at once."""
    with _lock:
        return _db().execute(sql, args).fetchall()


def get(report_id: str) -> dict:
    row = next(iter(_all("SELECT body FROM report WHERE id = ?", (report_id,))), None)
    if row is None:
        raise AppError(404, "report_not_found", "no report with that id")
    return _row(row[0])


def _labels(rows: list[dict]) -> None:
    """Each report's subject as people read it: the kanji, or the word's headword."""
    from .db import query

    ids = {int(s[5:]) for r in rows if (s := r.get("subject") or "").startswith("word:")}
    heads: dict[int, str] = {}
    if ids:
        try:
            # One query for the page, not one per row.
            heads = {w["id"]: w["headword"] for w in query(
                f"SELECT id, headword FROM word WHERE id IN ({','.join('?' * len(ids))})", tuple(ids))}
        except Exception:  # noqa: BLE001 -- no database: the id has to do
            pass
    for r in rows:
        s = r.get("subject") or ""
        if s.startswith("kanji:"):
            r["label"] = s[6:]
        elif s.startswith("word:"):
            r["label"] = heads.get(int(s[5:]), s)


def listing(status: str | None = None, limit: int = 200, offset: int = 0) -> dict:
    """For the admin: newest first, with each reporter's card and email."""
    if status is not None and status not in STATUSES:
        raise AppError(400, "bad_status", "status is one of {s}", s=", ".join(STATUSES))
    where, args = ("WHERE status = ?", [status]) if status else ("", [])
    rows = [_row(b) for (b,) in _all(f"SELECT body FROM report {where} ORDER BY created DESC, seq DESC LIMIT ? OFFSET ?",
                                     [*args, limit, offset])]
    _labels(rows)
    counts = dict.fromkeys(STATUSES, 0) | {s: n for s, n in _all("SELECT status, COUNT(*) FROM report GROUP BY status")}
    data = auth._load()
    people = {}
    for uid in {r["by"] for r in rows}:
        if u := data["users"].get(uid):
            people[uid] = auth._card(u)
    return {"items": rows, "people": people, "counts": counts}


def open_count() -> int:
    """How many reports wait, for the badge on the owner's Reports button."""
    return _all("SELECT COUNT(*) FROM report WHERE status = 'open'")[0][0]


def mine(user_id: str, limit: int = 100) -> dict:
    """Your own reports and what became of them. Who closed them is not shown."""
    keep = ("id", "created", "subject", "text", "files", "status", "reply", "closed_at")
    rows = _all("SELECT body FROM report WHERE by_user = ? ORDER BY created DESC, seq DESC LIMIT ?", (user_id, limit))
    items = [{k: r.get(k) for k in keep} for r in map(_row, (b for (b,) in rows))]
    _labels(items)
    return {"items": items}


def set_status(report_id: str, status: str, reply: str | None, by: str) -> dict:
    if status not in STATUSES:
        raise AppError(400, "bad_status", "status is one of {s}", s=", ".join(STATUSES))
    if reply is not None and not isinstance(reply, str):
        raise AppError(400, "bad_request", "the reply is text")
    reply = (reply or "").strip()[:MAX_REPLY] or None
    with _lock:
        r = get(report_id)
        r.update(status=status, reply=reply,
                 closed_at=None if status == "open" else _now(), closed_by=None if status == "open" else by)
        _put(_db(), r)
        return r


def file_path(report_id: str, name: str, user: dict) -> tuple[Path, str]:
    """A report's picture, for the admin or the one who sent it."""
    r = get(report_id)
    if r["by"] != user["id"] and not auth.has_role(user, "admin"):
        raise AppError(404, "report_not_found", "no report with that id")
    f = next((f for f in r["files"] if f["name"] == name), None)
    if f is None or not (FILES / report_id / name).is_file():
        raise AppError(404, "report_file_missing", "no such picture")
    return FILES / report_id / name, f["type"]


# ---------------------------------------------------------------- for Claude Code


def export(dest: Path, everything: bool = False) -> int:
    """Reports as dest/reports.json, their pictures under dest/files/<id>/; each with the
    reporter's username (no email). Read-only: it runs on the Pi over ssh, so it never
    makes the database, its schema or the first import (`_db` does those, as the server)."""
    dest.mkdir(parents=True, exist_ok=True)
    q = "SELECT body FROM report" + ("" if everything else " WHERE status = 'open'") + " ORDER BY created"
    if not DB.exists():
        rows = []
    else:
        conn = sqlite3.connect(f"{DB.resolve().as_uri()}?mode=ro", uri=True, timeout=30)
        try:
            rows = [_row(b) for (b,) in conn.execute(q)]
        finally:
            conn.close()
    users = auth._load()["users"]
    for r in rows:
        u = users.get(r["by"])
        r["by_username"] = (u.get("username") or u.get("name")) if u else None
        if r["files"]:
            shutil.copytree(FILES / r["id"], dest / "files" / r["id"], dirs_exist_ok=True)
    (dest / "reports.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(rows)


BOT = "claude-code"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m server.reports")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export", help="open reports (or --all) as reports.json plus their pictures")
    e.add_argument("dir", type=Path)
    e.add_argument("--all", action="store_true")
    c = sub.add_parser("close", help="set a report's status, with an optional reply the reporter sees")
    c.add_argument("id", nargs="?")
    c.add_argument("status", nargs="?", choices=STATUSES)
    c.add_argument("reply", nargs="?")
    c.add_argument("--file", type=Path, help='a JSON list of {"id", "status", "reply"}')
    args = ap.parse_args(argv)
    if args.cmd == "export":
        print(f"{export(args.dir, args.all)} reports in {args.dir}")
        return 0
    rows = json.loads(args.file.read_text(encoding="utf-8")) if args.file else [{"id": args.id, "status": args.status, "reply": args.reply}]
    if not rows or not all(r.get("id") and r.get("status") for r in rows):
        ap.error("give <id> <status> [reply], or --file")
    for r in rows:
        set_status(r["id"], r["status"], r.get("reply"), BOT)
    print(f"{len(rows)} reports updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
