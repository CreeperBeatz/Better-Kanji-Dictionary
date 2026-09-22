"""Sign-in by magic link or Google, your profile, and the dependencies other routes use to know who is asking."""

import os
from pathlib import Path

from fastapi import APIRouter, Body, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .. import auth, google, mail, store

router = APIRouter(prefix="/api/auth", tags=["auth"])

# The browser crops and shrinks a picture to a small square before sending it,
# so anything near this limit was not sent by the app.
AVATAR_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
AVATAR_MAGIC = {".png": b"\x89PNG", ".jpg": b"\xff\xd8", ".jpeg": b"\xff\xd8", ".webp": b"RIFF"}
MAX_AVATAR_BYTES = 1024 * 1024


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def optional_user(authorization: str | None = Header(None)) -> dict | None:
    return auth.user_for_session(_bearer(authorization))


def require_user(authorization: str | None = Header(None)) -> dict:
    user = optional_user(authorization)
    if user is None:
        raise HTTPException(401, "sign in to save associations")
    return user


def _public(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "username": user.get("username"),
        "avatar": user.get("avatar"),
    }


def _app_url(request: Request) -> str:
    """Where the emailed link should point: the frontend, not this API.

    In production this must be pinned by APP_URL. Trusting the request's Origin
    there would let anyone have a victim's sign-in link point at their own site.
    In dev there is no email to intercept, and following Origin means the link
    works from whichever address the page was opened on, phone included.
    """
    pinned = os.environ.get("APP_URL")
    if pinned:
        return pinned.rstrip("/")
    if not mail.is_dev():
        raise HTTPException(500, "APP_URL must be set when sending real email")
    return (request.headers.get("origin") or "http://localhost:5173").rstrip("/")


@router.post("/request")
def request_link(request: Request, payload: dict = Body(...)) -> dict:
    email = auth.normalise_email(payload.get("email", ""))
    if not email:
        raise HTTPException(400, "that does not look like an email address")
    try:
        token = auth.request_link(email)
    except auth.TooSoon:
        raise HTTPException(429, "a link was just sent; give it a moment")
    link = f"{_app_url(request)}/?login={token}"
    mail.send_magic_link(email, link)
    # With no mail configured, the link comes back so sign-in still works.
    return {"sent": True, "devLink": link if mail.is_dev() else None}


@router.post("/verify")
def verify(payload: dict = Body(...)) -> dict:
    result = auth.redeem_link(payload.get("token", ""))
    if result is None:
        raise HTTPException(400, "this link has expired or was already used")
    session, user, _ = result
    store.ensure_author(user)
    store.claim_legacy(user["id"], user["email"])
    return {"session": session, "user": _public(user)}


@router.get("/config")
def config() -> dict:
    """Which sign-in methods this server offers; the Google client id is public by design."""
    return {"googleClientId": google.client_id()}


@router.post("/google")
def google_sign_in(payload: dict = Body(...)) -> dict:
    try:
        claims = google.verify(payload.get("credential", ""))
    except google.InvalidCredential as e:
        raise HTTPException(400, str(e))
    email = auth.normalise_email(claims["email"])
    if not email:
        raise HTTPException(400, "that Google account's address is not one we can use")
    session, user, created = auth.sign_in_google(claims["sub"], email, claims.get("name"))
    # A new account starts with its Google picture; an existing one keeps its own.
    if created and not user.get("avatar"):
        picture = google.fetch_picture(claims.get("picture"))
        if picture:
            user = auth.set_avatar(user["id"], *picture)
    store.ensure_author(user)
    store.claim_legacy(user["id"], user["email"])
    return {"session": session, "user": _public(user)}


@router.get("/me")
def me(authorization: str | None = Header(None)) -> dict:
    user = optional_user(authorization)
    return {"user": _public(user) if user else None}


@router.patch("/me")
def update_me(payload: dict = Body(...), authorization: str | None = Header(None)) -> dict:
    user = require_user(authorization)
    name = username = None
    if "name" in payload:
        name = (payload.get("name") or "").strip()[:40]
        if not name:
            raise HTTPException(400, "a name cannot be empty")
    if "username" in payload:
        username = auth.normalise_username(payload.get("username") or "")
        if not username:
            raise HTTPException(400, "a username is 3 to 24 of a-z, 0-9, _ and -")
    try:
        user = auth.update_profile(user["id"], name=name, username=username)
    except auth.UsernameTaken:
        raise HTTPException(409, "that username is taken")
    store.ensure_author(user)
    return {"user": _public(user)}


@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), authorization: str | None = Header(None)) -> dict:
    user = require_user(authorization)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AVATAR_TYPES:
        raise HTTPException(400, "a profile picture must be PNG, JPEG or WebP")
    raw = await file.read()
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "profile picture larger than 1MB")
    if not raw.startswith(AVATAR_MAGIC[suffix]):
        raise HTTPException(400, "that file is not the image it says it is")
    user = auth.set_avatar(user["id"], raw, suffix)
    store.ensure_author(user)
    return {"user": _public(user)}


@router.delete("/avatar")
def remove_avatar(authorization: str | None = Header(None)) -> dict:
    user = auth.set_avatar(require_user(authorization)["id"], None)
    store.ensure_author(user)
    return {"user": _public(user)}


@router.get("/avatar/{name}")
def get_avatar(name: str):
    path = auth.AVATARS / Path(name).name
    if not path.is_file():
        raise HTTPException(404, "no such picture")
    # Every upload gets a new name, so a picture never changes under its name.
    return FileResponse(
        path,
        media_type=AVATAR_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.post("/logout")
def logout(authorization: str | None = Header(None)) -> dict:
    token = _bearer(authorization)
    if token:
        auth.end_session(token)
    return {"ok": True}
