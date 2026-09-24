"""GIFs for notes: a search of KLIPY, which took over from Tenor when Google
closed Tenor's API in 2026, and answers Tenor's own v2 calls.

The key stays here (KLIPY_API_KEY). KLIPY's terms forbid caching or storing
its GIFs, so nothing is kept: a note holds the GIF's address on KLIPY's own
servers (static.klipy.com), and the reader's browser fetches it from there.
They also ask for their name wherever the GIFs are, and the uploader's where
it is given; the web client shows both.
"""

from __future__ import annotations

import hashlib
import os
import re

import requests
from fastapi import APIRouter, Depends, Query

from ..errors import AppError
from .auth import optional_user

router = APIRouter(prefix="/api/gifs", tags=["gifs"])

API = "https://api.klipy.com/v2"
PER_PAGE = 24
LOCALES = {"en": "en_US", "bg": "bg_BG"}
FORMATS = "gif,mediumgif,tinygif,nanogif"

# What a note may hold instead of an image of ours: a GIF on KLIPY's servers.
GIF_URL = re.compile(r"https://([a-z0-9-]+\.)*klipy\.com/[^\s\"'<>]{1,500}")


def is_gif_url(s: str) -> bool:
    return bool(GIF_URL.fullmatch(s))


def _key() -> str:
    key = os.environ.get("KLIPY_API_KEY")
    if not key:
        raise AppError(503, "gifs_off", "GIF search is not set up on this server")
    return key


def _media(formats: dict, *names: str) -> dict | None:
    for n in names:
        m = formats.get(n)
        if m and m.get("url"):
            return m
    return None


def _hits(data: dict) -> tuple[list[dict], str]:
    hits = []
    for r in data.get("results") or []:
        formats = r.get("media_formats") or {}
        # A note shows the middle size: the full one runs to megabytes.
        full = _media(formats, "mediumgif", "gif", "tinygif")
        thumb = _media(formats, "tinygif", "nanogif", "mediumgif", "gif")
        if not full or not thumb or not is_gif_url(full["url"]):
            continue
        dims = full.get("dims") or [0, 0]
        hits.append(
            {
                "id": str(r.get("id", "")),
                "url": full["url"],
                "thumb": thumb["url"],
                "width": dims[0] if len(dims) > 1 else 0,
                "height": dims[1] if len(dims) > 1 else 0,
                "title": r.get("content_description") or r.get("title") or "",
            }
        )
    return hits, str(data.get("next") or "")


@router.get("/search")
def search(
    q: str = Query("", max_length=100),
    lang: str = "en",
    pos: str = Query("", max_length=100),
    user: dict | None = Depends(optional_user),
) -> dict:
    q = " ".join(q.split())
    # One id per reader, and not their account id: KLIPY uses it to vary
    # what it suggests.
    who = hashlib.sha256(f"betterrtk:{user['id'] if user else 'anon'}".encode()).hexdigest()[:16]
    params = {
        "key": _key(),
        "client_key": "betterkanjidictionary",
        "customer_id": who,
        "limit": PER_PAGE,
        "media_filter": FORMATS,
        "contentfilter": "medium",
        "locale": LOCALES.get(lang, "en_US"),
    }
    if pos:
        params["pos"] = pos
    if q:
        params["q"] = q
    try:
        res = requests.get(f"{API}/{'search' if q else 'featured'}", params=params, timeout=10)
    except requests.RequestException as e:
        print(f"[gifs] {q!r}: {e}", flush=True)
        raise AppError(503, "gifs_unavailable", "GIF search is not available right now")
    if res.status_code == 429:
        raise AppError(503, "gifs_busy", "GIF search is busy; try again in a minute")
    if not res.ok:
        print(f"[gifs] {q!r}: HTTP {res.status_code} {res.text[:200]}", flush=True)
        raise AppError(503, "gifs_unavailable", "GIF search is not available right now")
    hits, next_pos = _hits(res.json())
    return {"hits": hits, "next": next_pos}
