"""Accounts, by emailed magic link or by Google.

There are no passwords. Asking to sign in mints a one-time token that is
emailed as a link; opening the link trades it for a session token the browser
keeps and sends as `Authorization: Bearer ...`. Signing in with Google ends
in the same session, and an address that already has an account signs into
it rather than making a second one. A bearer header rather than a
cookie because the dev frontend and this server sit on different origins.

Every account has a role: `user`, `reviewer` (approved by hand, after asking
to contribute) or `admin`. Admin is never stored: it is whoever's address is
BETTERRTK_OWNER_EMAIL, so no request or API call can grant it, and with that
unset nobody is admin. `reviewer` is stored on the user record; a missing role
is `user`. Every change of role is logged, with who made it.

Only hashes of tokens are stored, so `data/auth/auth.json` leaking does not let
anyone sign in. The file is kept apart from the association store because it
is not something you would ever want to commit or share.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
AUTH_DIR = ROOT / "data" / "auth"
AUTH_FILE = AUTH_DIR / "auth.json"
AVATARS = AUTH_DIR / "avatars"

LINK_TTL = timedelta(minutes=15)
SESSION_TTL = timedelta(days=60)
# One link per address per this long, so the endpoint cannot be used to flood an inbox.
RESEND_GAP = timedelta(seconds=30)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# A username is the handle others see under your comments, so it is unique and
# kept to what reads the same everywhere: lowercase letters, digits, _ and -.
USERNAME_RE = re.compile(r"^[a-z0-9_-]{3,24}$")

_lock = threading.Lock()


class TooSoon(Exception):
    pass


class UsernameTaken(Exception):
    pass


class AlreadyAsked(Exception):
    """There is an open request to contribute, or the account already reviews."""


class NotFound(Exception):
    pass


ROLES = ("user", "reviewer", "admin")
# How much each role may do; a route asking for `reviewer` lets admin through too.
RANK = {"user": 0, "reviewer": 1, "admin": 2}
MAX_REQUEST_TEXT = 1000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load() -> dict:
    if not AUTH_FILE.exists():
        data = {"version": 1, "users": {}, "links": {}, "sessions": {}}
    else:
        data = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    data.setdefault("requests", {})
    data.setdefault("role_log", [])
    return data


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


def normalise_username(username: str) -> str | None:
    username = (username or "").strip().lower().lstrip("@")
    return username if USERNAME_RE.match(username) else None


def _free_username(data: dict, wanted: str, user_id: str | None = None) -> str:
    """`wanted`, cleaned into a valid handle, with a number on it if it is taken."""
    base = re.sub(r"[^a-z0-9_-]+", "", wanted.lower())[:20] or "user"
    if len(base) < 3:
        base = f"{base}{'_' * (3 - len(base))}"
    taken = {u.get("username") for u in data["users"].values() if u["id"] != user_id}
    candidate, n = base, 1
    while candidate in taken:
        n += 1
        candidate = f"{base}{n}"
    return candidate


def migrate() -> list[dict]:
    """Give every account made before usernames existed one. Returns all users."""
    with _lock:
        data = _load()
        changed = False
        for user in data["users"].values():
            if not user.get("username"):
                user["username"] = _free_username(data, user["email"].split("@")[0], user["id"])
                changed = True
            if "avatar" not in user:
                user["avatar"] = None
                changed = True
        if changed:
            _save(data)
        return [dict(u) for u in data["users"].values()]


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
            user = _new_user(data, link["email"])
        session = _new_session(data, user["id"])
        _save(data)
        return session, dict(user), created


def sign_in_google(sub: str, email: str, name: str | None) -> tuple[str, dict, bool]:
    """Sign in the Google account `sub`, whose verified address is `email`.

    Returns (session token, user, is_new_user). The account is found by its
    Google id first, so changing the address on the Google side keeps it; then
    by address, which ties Google to an account first made by email link.
    """
    with _lock:
        data = _load()
        _prune(data)
        user = next((u for u in data["users"].values() if u.get("google") == sub), None)
        if user is None:
            user = next((u for u in data["users"].values() if u["email"] == email), None)
        created = user is None
        if created:
            user = _new_user(data, email, name)
        user["google"] = sub
        session = _new_session(data, user["id"])
        _save(data)
        return session, dict(user), created


def _new_user(data: dict, email: str, name: str | None = None) -> dict:
    user = {
        "id": f"u-{uuid.uuid4().hex[:12]}",
        "email": email,
        # What others see beside your public notes; never the whole address.
        "name": (name or "").strip()[:40] or email.split("@")[0][:40],
        "username": _free_username(data, email.split("@")[0]),
        "avatar": None,
        "created": _now().isoformat(),
    }
    data["users"][user["id"]] = user
    return user


def _new_session(data: dict, user_id: str) -> str:
    session = secrets.token_urlsafe(32)
    data["sessions"][_hash(session)] = {
        "user": user_id,
        "created": _now().isoformat(),
        "expires": (_now() + SESSION_TTL).isoformat(),
    }
    return session


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


def update_profile(user_id: str, name: str | None = None, username: str | None = None) -> dict | None:
    with _lock:
        data = _load()
        user = data["users"].get(user_id)
        if not user:
            return None
        if username is not None and username != user.get("username"):
            if any(u.get("username") == username for u in data["users"].values() if u["id"] != user_id):
                raise UsernameTaken()
            user["username"] = username
        if name is not None:
            user["name"] = name
        _save(data)
        return dict(user)


def set_avatar(user_id: str, raw: bytes | None, suffix: str = ".png") -> dict | None:
    """Replace this account's picture with `raw`, or remove it when `raw` is None.

    Each upload gets a fresh name, so browsers never show a cached old picture.
    """
    with _lock:
        data = _load()
        user = data["users"].get(user_id)
        if not user:
            return None
        old = user.get("avatar")
        if raw is None:
            user["avatar"] = None
        else:
            AVATARS.mkdir(parents=True, exist_ok=True)
            name = f"{user_id}-{secrets.token_hex(6)}{suffix}"
            (AVATARS / name).write_bytes(raw)
            user["avatar"] = name
        _save(data)
        if old and old != user["avatar"]:
            (AVATARS / Path(old).name).unlink(missing_ok=True)
        return dict(user)


# ---------------------------------------------------------------- roles


def owner_email() -> str | None:
    """The admin's address, from BETTERRTK_OWNER_EMAIL; None means nobody is admin."""
    return normalise_email(os.environ.get("BETTERRTK_OWNER_EMAIL", ""))


def role_of(user: dict | None) -> str:
    if not user:
        return "user"
    owner = owner_email()
    if owner and user.get("email") == owner:
        return "admin"
    return "reviewer" if user.get("role") == "reviewer" else "user"


def has_role(user: dict | None, role: str) -> bool:
    return user is not None and RANK[role_of(user)] >= RANK[role]


def _log_role(data: dict, user_id: str, before: str, after: str, by: str, reason: str | None) -> None:
    data["role_log"].append({
        "user": user_id,
        "before": before,
        "after": after,
        "by": by,
        "at": _now().isoformat(),
        "reason": reason,
    })


def _public_card(user: dict) -> dict:
    """What anyone may see of an account: no email, no role."""
    return {"id": user["id"], "name": user["name"], "username": user.get("username"), "avatar": user.get("avatar")}


def _card(user: dict) -> dict:
    """What the admin page shows of an account. Only ever sent to the admin."""
    return {**_public_card(user), "email": user["email"]}


def own_request(user_id: str) -> dict | None:
    """This account's latest request to contribute, for its own Account page."""
    data = _load()
    mine = [r for r in data["requests"].values() if r["user"] == user_id]
    if not mine:
        return None
    r = max(mine, key=lambda r: r["created"])
    return {"id": r["id"], "status": r["status"], "created": r["created"], "decided": r.get("decided_at")}


def request_contribution(user_id: str, text: str) -> dict:
    """Ask to become a reviewer. One open request per account."""
    with _lock:
        data = _load()
        user = data["users"].get(user_id)
        if not user:
            raise NotFound()
        if role_of(user) != "user" or any(r["user"] == user_id and r["status"] == "open" for r in data["requests"].values()):
            raise AlreadyAsked()
        req = {
            "id": f"r-{uuid.uuid4().hex[:12]}",
            "user": user_id,
            "text": text[:MAX_REQUEST_TEXT],
            "status": "open",
            "created": _now().isoformat(),
            "decided_by": None,
            "decided_at": None,
        }
        data["requests"][req["id"]] = req
        _save(data)
        return dict(req)


def open_requests() -> list[dict]:
    data = _load()
    rows = []
    for r in sorted(data["requests"].values(), key=lambda r: r["created"]):
        user = data["users"].get(r["user"])
        if r["status"] == "open" and user:
            rows.append({"id": r["id"], "text": r["text"], "created": r["created"], "user": _card(user)})
    return rows


def decide_request(request_id: str, approve: bool, by: str) -> dict:
    """Approve (the account becomes a reviewer) or decline an open request."""
    with _lock:
        data = _load()
        req = data["requests"].get(request_id)
        if not req or req["status"] != "open":
            raise NotFound()
        req["status"] = "approved" if approve else "declined"
        req["decided_by"] = by
        req["decided_at"] = _now().isoformat()
        user = data["users"].get(req["user"])
        if approve and user and role_of(user) == "user":
            user["role"] = "reviewer"
            _log_role(data, user["id"], "user", "reviewer", by, f"request {request_id}")
        _save(data)
        return dict(req)


def reviewers() -> list[dict]:
    data = _load()
    return [
        {**_card(u), "since": next(
            (e["at"] for e in reversed(data["role_log"]) if e["user"] == u["id"] and e["after"] == "reviewer"),
            None,
        )}
        for u in data["users"].values()
        if role_of(u) == "reviewer"
    ]


def revoke_reviewer(user_id: str, by: str, reason: str | None = None) -> dict:
    with _lock:
        data = _load()
        user = data["users"].get(user_id)
        if not user or role_of(user) != "reviewer":
            raise NotFound()
        user.pop("role", None)
        _log_role(data, user_id, "reviewer", "user", by, reason)
        _save(data)
        return dict(user)


def role_log(limit: int = 100) -> list[dict]:
    data = _load()
    names = {u["id"]: u.get("username") or u["name"] for u in data["users"].values()}
    return [
        {**e, "userName": names.get(e["user"], e["user"]), "byName": names.get(e["by"], e["by"])}
        for e in reversed(data["role_log"][-limit:])
    ]


def names_for(user_ids: set[str]) -> dict[str, dict]:
    """Public cards for the given accounts."""
    data = _load()
    return {uid: _public_card(u) for uid in user_ids if (u := data["users"].get(uid))}
