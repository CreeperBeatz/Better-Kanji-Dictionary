"""Checking a "Sign in with Google" credential.

The browser gets an ID token from Google's own button and hands it here. It is
a JWT signed by Google; `google-auth` checks the signature against Google's
published keys, the expiry, the issuer, and that it was minted for our client
id, so a token issued to some other site cannot be replayed at this one.

    GOOGLE_CLIENT_ID   the OAuth "Web application" client id; unset turns Google sign-in off
"""

from __future__ import annotations

import os
import urllib.parse
import urllib.request

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

# Google's keys are fetched over this and cached by it between sign-ins.
_transport = google_requests.Request()

PICTURE_HOSTS = (".googleusercontent.com",)
PICTURE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_PICTURE_BYTES = 1024 * 1024


class InvalidCredential(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code  # what the interface translates; see server/errors.py


def client_id() -> str | None:
    return os.environ.get("GOOGLE_CLIENT_ID") or None


def verify(credential: str) -> dict:
    """The token's claims: `sub`, `email`, `name`, `picture`. Raises InvalidCredential."""
    cid = client_id()
    if not cid:
        raise InvalidCredential("Google sign-in is not set up on this server", "google_not_configured")
    try:
        claims = id_token.verify_oauth2_token(credential, _transport, cid)
    except ValueError as e:
        raise InvalidCredential(f"Google did not vouch for that sign-in ({e})", "google_rejected") from e
    # An unverified address could be anyone's; linking it would hand them that account.
    if not claims.get("email") or not claims.get("email_verified"):
        raise InvalidCredential("that Google account has no verified email address", "google_unverified")
    return claims


def fetch_picture(url: str | None) -> tuple[bytes, str] | None:
    """Download a Google profile picture as (bytes, suffix), or None. Never raises."""
    if not url:
        return None
    host = urllib.parse.urlsplit(url).hostname or ""
    if urllib.parse.urlsplit(url).scheme != "https" or not host.endswith(PICTURE_HOSTS):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BetterRTK/0.1"})
        with urllib.request.urlopen(req, timeout=5) as res:
            suffix = PICTURE_TYPES.get(res.headers.get_content_type())
            raw = res.read(MAX_PICTURE_BYTES + 1)
    except Exception:
        return None
    if not suffix or len(raw) > MAX_PICTURE_BYTES:
        return None
    return raw, suffix
