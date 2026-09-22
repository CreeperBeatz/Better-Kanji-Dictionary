"""Accounts, by emailed magic link.

There are no passwords. Asking to sign in mints a one-time token that is
emailed as a link; opening the link trades it for a session token the browser
keeps and sends as `Authorization: Bearer ...`. A bearer header rather than a
cookie because the dev frontend and this server sit on different origins.

Only hashes of tokens are stored, so `data/auth/auth.json` leaking does not let
anyone sign in. The file is kept apart from the association store because it
is not something you would ever want to commit or share.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
AUTH_DIR = ROOT / "data" / "auth"
AUTH_FILE = AUTH_DIR / "auth.json"

LINK_TTL = timedelta(minutes=15)
SESSION_TTL = timedelta(days=60)
# One link per address per this long, so the endpoint cannot be used to flood an inbox.
RESEND_GAP = timedelta(seconds=30)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_lock = threading.Lock()


class TooSoon(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load() -> dict:
    if not AUTH_FILE.exists():
        return {"version": 1, "users": {}, "links": {}, "sessions": {}}
    return json.loads(AUTH_FILE.read_text(encoding="utf-8"))


def _save(data: dict) -> None:
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    tmp = AUTH_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(AUTH_FILE)


def _prune(data: dict) -> None:
    now = _now().isoformat()
    data["links"] = {k: v for k, v in data["links"].items() if v["expires"] > now}
    data["sessions"] = {k: v for k, v in data["sessions"].items() if v["expires"] > now}


def normalise_email(email: str) -> str | None:
    email = (email or "").strip().lower()
    return email if EMAIL_RE.match(email) and len(email) <= 254 else None


def request_link(email: str) -> str:
    """Mint a sign-in token for this address; returns the raw token to email."""
    with _lock:
        data = _load()
        _prune(data)
        recent = [
            v for v in data["links"].values()
            if v["email"] == email and v["created"] > (_now() - RESEND_GAP).isoformat()
        ]
        if recent:
            raise TooSoon()
        token = secrets.token_urlsafe(32)
        data["links"][_hash(token)] = {
            "email": email,
            "created": _now().isoformat(),
            "expires": (_now() + LINK_TTL).isoformat(),
        }
        _save(data)
        return token


def redeem_link(token: str) -> tuple[str, dict, bool] | None:
    """Spend a sign-in token. Returns (session token, user, is_new_user)."""
    with _lock:
        data = _load()
        _prune(data)
        link = data["links"].pop(_hash(token or ""), None)
        if link is None:
            _save(data)
            return None

        user = next((u for u in data["users"].values() if u["email"] == link["email"]), None)
        created = user is None
        if created:
            user = {
                "id": f"u-{uuid.uuid4().hex[:12]}",
                "email": link["email"],
                # What others see beside your public notes; never the whole address.
                "name": link["email"].split("@")[0][:40],
                "created": _now().isoformat(),
            }
            data["users"][user["id"]] = user

        session = secrets.token_urlsafe(32)
        data["sessions"][_hash(session)] = {
            "user": user["id"],
            "created": _now().isoformat(),
            "expires": (_now() + SESSION_TTL).isoformat(),
        }
        _save(data)
        return session, dict(user), created


def user_for_session(session: str | None) -> dict | None:
    if not session:
        return None
    data = _load()
    s = data["sessions"].get(_hash(session))
    if not s or s["expires"] <= _now().isoformat():
        return None
    user = data["users"].get(s["user"])
    return dict(user) if user else None


def end_session(session: str) -> None:
    with _lock:
        data = _load()
        if data["sessions"].pop(_hash(session), None) is not None:
            _save(data)


def rename(user_id: str, name: str) -> dict | None:
    with _lock:
        data = _load()
        user = data["users"].get(user_id)
        if not user:
            return None
        user["name"] = name
        _save(data)
        return dict(user)
