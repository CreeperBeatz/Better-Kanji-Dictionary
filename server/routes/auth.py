"""Sign-in by magic link, and the dependencies other routes use to know who is asking."""

import os

from fastapi import APIRouter, Body, Header, HTTPException, Request

from .. import auth, mail, store

router = APIRouter(prefix="/api/auth", tags=["auth"])


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
    return {"id": user["id"], "email": user["email"], "name": user["name"]}


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
    store.ensure_author(user["id"], user["name"])
    store.claim_legacy(user["id"], user["email"])
    return {"session": session, "user": _public(user)}


@router.get("/me")
def me(authorization: str | None = Header(None)) -> dict:
    user = optional_user(authorization)
    return {"user": _public(user) if user else None}


@router.patch("/me")
def update_me(payload: dict = Body(...), authorization: str | None = Header(None)) -> dict:
    user = require_user(authorization)
    name = (payload.get("name") or "").strip()[:40]
    if not name:
        raise HTTPException(400, "a name cannot be empty")
    user = auth.rename(user["id"], name)
    store.ensure_author(user["id"], user["name"])
    return {"user": _public(user)}


@router.post("/logout")
def logout(authorization: str | None = Header(None)) -> dict:
    token = _bearer(authorization)
    if token:
        auth.end_session(token)
    return {"ok": True}
