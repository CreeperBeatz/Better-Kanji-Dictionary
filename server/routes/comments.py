"""The comment section under each character: public notes, thumbs up, replies.

A public note is the top-level comment -- someone's interpretation of the
character. Reading needs no account; liking and replying do. Both lists are
paged, since a common character could gather many of each.
"""

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import store
from .auth import optional_user, require_user

router = APIRouter(prefix="/api/comments", tags=["comments"])

MAX_REPLY = 2000


def _viewer(user: dict | None) -> str | None:
    return user["id"] if user else None


@router.get("/for/{char}")
def notes_for(
    char: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=50),
    sort: str = Query("liked"),
    user: dict | None = Depends(optional_user),
) -> dict:
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")
    if sort not in store.SORTS:
        raise HTTPException(400, "sort must be liked or new")
    return store.notes_for(char, _viewer(user), offset, limit, sort)


@router.put("/like/{assoc_id}")
def like(assoc_id: str, payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    try:
        return store.set_like(assoc_id, user["id"], bool(payload.get("liked", True)))
    except store.NotFound:
        raise HTTPException(404, "no such public note")
    except store.Forbidden:
        raise HTTPException(403, "you cannot like your own note")


@router.get("/replies/{assoc_id}")
def replies(
    assoc_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(5, ge=1, le=50),
    user: dict | None = Depends(optional_user),
) -> dict:
    try:
        return store.replies(assoc_id, _viewer(user), offset, limit)
    except store.NotFound:
        raise HTTPException(404, "no such public note")


@router.post("/replies/{assoc_id}")
def reply(assoc_id: str, payload: dict = Body(...), user: dict = Depends(require_user)) -> dict:
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "a reply cannot be empty")
    if len(text) > MAX_REPLY:
        raise HTTPException(400, f"a reply is at most {MAX_REPLY} characters")
    try:
        return store.add_reply(assoc_id, user["id"], text)
    except store.NotFound:
        raise HTTPException(404, "no such public note")


@router.delete("/reply/{reply_id}")
def delete_reply(reply_id: str, user: dict = Depends(require_user)) -> dict:
    try:
        store.delete_reply(reply_id, user["id"])
    except store.NotFound:
        raise HTTPException(404, "no such reply")
    except store.Forbidden:
        raise HTTPException(403, "that reply is not yours")
    return {"id": reply_id, "deleted": True}
