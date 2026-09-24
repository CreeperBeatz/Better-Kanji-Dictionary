"""Pictures to draw with: a search of Pixabay, from the drawing editor.

The key stays here (PIXABAY_API_KEY), not in the page. Pixabay asks that
searches be cached for a day, and says its images may be downloaded and kept,
which a drawing does: the picture chosen is fetched through here, so it comes
from our own origin and can be drawn on a canvas and saved with the scene.
Its thumbnails are shown straight from Pixabay, as it allows for results.
"""

from __future__ import annotations

import os
import time
from collections import OrderedDict

import requests
from fastapi import APIRouter, Depends, Query, Response

from ..errors import AppError
from .auth import require_user

router = APIRouter(prefix="/api/images", tags=["images"])

API = "https://pixabay.com/api/"
DAY = 24 * 3600
PER_PAGE = 30
MAX_BYTES = 8 * 1024 * 1024
KINDS = {"all", "photo", "illustration", "vector"}
LANGS = {"en", "bg"}

# (query, lang, kind, page) -> (when, answer), newest last.
_searches: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
# Pixabay id -> the full-size URL its search gave, for fetching it later.
_urls: OrderedDict[int, str] = OrderedDict()
MAX_KEPT = 2000


def _key() -> str:
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        raise AppError(503, "images_off", "picture search is not set up on this server")
    return key


def _keep(d: OrderedDict, k, v) -> None:
    d[k] = v
    d.move_to_end(k)
    while len(d) > MAX_KEPT:
        d.popitem(last=False)


def _ask(params: dict) -> dict:
    try:
        res = requests.get(API, params={"key": _key(), **params}, timeout=10)
    except requests.RequestException as e:
        print(f"[images] {params.get('q')!r}: {e}", flush=True)
        raise AppError(503, "images_unavailable", "picture search is not available right now")
    if res.status_code == 429:
        raise AppError(503, "images_busy", "picture search is busy; try again in a minute")
    if not res.ok:
        print(f"[images] {params.get('q')!r}: HTTP {res.status_code} {res.text[:200]}", flush=True)
        raise AppError(503, "images_unavailable", "picture search is not available right now")
    return res.json()


@router.get("/search")
def search(
    q: str = Query("", max_length=100),
    lang: str = "en",
    kind: str = "all",
    page: int = Query(1, ge=1, le=20),
    user: dict = Depends(require_user),
) -> dict:
    q = " ".join(q.split()).lower()
    lang = lang if lang in LANGS else "en"
    kind = kind if kind in KINDS else "all"
    if not q:
        return {"total": 0, "page": page, "hits": []}
    key = (q, lang, kind, page)
    hit = _searches.get(key)
    if hit and time.time() - hit[0] < DAY:
        return hit[1]

    data = _ask(
        {"q": q, "lang": lang, "image_type": kind, "page": page, "per_page": PER_PAGE, "safesearch": "true"}
    )
    hits = []
    for h in data.get("hits", []):
        _keep(_urls, h["id"], h.get("largeImageURL") or h["webformatURL"])
        hits.append(
            {
                "id": h["id"],
                "thumb": h["previewURL"],
                "preview": h["webformatURL"],
                "width": h.get("imageWidth"),
                "height": h.get("imageHeight"),
                "tags": h.get("tags", ""),
                "user": h.get("user", ""),
                "page": h.get("pageURL", ""),
            }
        )
    answer = {"total": data.get("totalHits", 0), "page": page, "hits": hits}
    _keep(_searches, key, (time.time(), answer))
    return answer


@router.get("/pixabay/{image_id}")
def fetch(image_id: int, user: dict = Depends(require_user)) -> Response:
    url = _urls.get(image_id)
    if not url:
        # Not from a search this server remembers: ask for it by id.
        found = _ask({"id": image_id}).get("hits") or []
        if not found:
            raise AppError(404, "picture_unfetched", "that picture is not on Pixabay any more")
        url = found[0].get("largeImageURL") or found[0]["webformatURL"]
        _keep(_urls, image_id, url)
    try:
        res = requests.get(url, timeout=20)
    except requests.RequestException:
        raise AppError(503, "images_unavailable", "picture search is not available right now")
    kind = res.headers.get("content-type", "")
    if not res.ok or not kind.startswith("image/") or len(res.content) > MAX_BYTES:
        raise AppError(502, "picture_unfetched", "that picture could not be fetched")
    return Response(res.content, media_type=kind, headers={"Cache-Control": "private, max-age=86400"})
