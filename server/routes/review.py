"""The labeling queue over HTTP (server/review.py).

Reviewers and the admin work the queue and edit directly; any signed-in user
may suggest a change, which a reviewer then decides. The admin alone sees
everyone's decisions, the auto-accepted ones, and can revert.
"""

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import FileResponse

from .. import auth, books, review
from ..errors import AppError
from .auth import check_role, require_role, require_user

router = APIRouter(prefix="/api/review", tags=["review"])

reviewer = require_role("reviewer")
admin = require_role("admin")


@router.get("/queue")
def queue(
    type: str | None = Query(None),
    origin: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    skipped: bool = Query(False, description="only the items you skipped"),
    me: dict = Depends(reviewer),
) -> dict:
    return review.queue(me["id"], type, origin, limit, skipped)


@router.get("/counts")
def counts(_: dict = Depends(reviewer)) -> dict:
    return review.counts()


@router.get("/items/{item_id}")
def item(item_id: str, _: dict = Depends(reviewer)) -> dict:
    return review.item(item_id)


@router.post("/items/{item_id}/decide")
def decide(item_id: str, payload: dict = Body(...), me: dict = Depends(reviewer)) -> dict:
    return {"item": review.decide(item_id, payload.get("action", ""), me["id"], payload.get("value"), payload.get("reason"),
                                  payload.get("words"), payload.get("skip"), payload.get("labels"), payload.get("notes"))}


@router.get("/progress")
def progress(_: dict = Depends(reviewer)) -> dict:
    return review.progress()


@router.post("/edit")
def edit(payload: dict = Body(...), me: dict = Depends(reviewer)) -> dict:
    """A reviewer's own change: live at once, logged."""
    return review.direct(payload.get("type", ""), payload.get("subject", ""), payload.get("value"), me["id"], payload.get("reason"),
                         payload.get("words"))


@router.post("/suggest")
def suggest(payload: dict = Body(...), me: dict = Depends(require_user)) -> dict:
    """Ask for a change from the page. From a reviewer or the admin it is simply made."""
    type_, subject, value = payload.get("type", ""), payload.get("subject", ""), payload.get("value")
    reason = payload.get("reason")
    words = payload.get("words") if type_ == "kanji_senses" else None
    if type_ == "en_report":
        # Reviewers too: the English is JMdict's, so a report is checked, never made live.
        return _queued(me, type_, subject, value, reason or value)
    if auth.has_role(me, "reviewer"):
        return {"applied": True, "decision": review.direct(type_, subject, value, me["id"], reason, words)}
    if not (reason or "").strip():
        raise AppError(400, "suggest_reason", "say why, so a reviewer can check it")
    return _queued(me, type_, subject, value, reason, {"moves": words} if words else None)


def _queued(me: dict, type_: str, subject: str, value, reason, evidence: dict | None = None) -> dict:
    item = review.add_item(type_, subject, value, f"human:{me['id']}", "suggestion", reason,
                           evidence=evidence, by=me["id"], priority=1.0)
    return {"applied": False, "item": {"id": item["id"], "status": item["status"]}}


@router.get("/book-entry")
def book_entry(no: int | None = Query(None), char: str | None = Query(None, max_length=2), _: dict = Depends(reviewer)) -> dict:
    """An entry of the kanji book as transcribed (server/books.py), for drawing it on a card: reviewers and the admin only."""
    e = books.kanji_entry(no, char)
    if e is None:
        raise AppError(404, "book_entry_missing", "that entry of the kanji book is not on this server")
    return e


@router.get("/book/{book}/{page}")
def book_page(book: str, page: int, _: dict = Depends(reviewer)) -> FileResponse:
    """A scanned page of one of the print dictionaries a card cites (server/books.py): reviewers and the admin only."""
    f = books.page_file(book, page)
    if f is None:
        raise AppError(404, "book_page_missing", "that page's scan is not on this server")
    return FileResponse(f, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/page/kanji/{char}")
def page_kanji(char: str, _: dict = Depends(require_user)) -> dict:
    """For the kanji page's Edit / Suggest changes: its meaning groups with their words."""
    return review.page_kanji(char)


@router.get("/page/word/{word_id}")
def page_word(word_id: int, _: dict = Depends(require_user)) -> dict:
    """For the word page's Edit / Suggest changes: its kanji's groups, and its Bulgarian."""
    return review.page_word(word_id)


@router.get("/mine")
def mine(me: dict = Depends(require_user)) -> dict:
    """Your own suggestions and what became of them."""
    return review.suggestions_of(me["id"])


@router.post("/impact")
def impact(payload: dict = Body(...), _: dict = Depends(reviewer)) -> dict:
    """What a decomposition would change, before anyone accepts it."""
    char = payload.get("char", "")
    parts = review.validate("decomposition", char, payload.get("parts"))
    return review.impact(char, parts or [])


@router.get("/history")
def history(
    everyone: bool = Query(False, alias="all"),
    type: str | None = Query(None),
    by: str | None = Query(None, description="one decider's id, or auto (admin)"),
    since: str | None = Query(None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    until: str | None = Query(None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    limit: int = Query(100, ge=1, le=500),
    me: dict = Depends(reviewer),
) -> dict:
    if everyone or by:
        check_role(me, "admin")
    return review.history(None if everyone or by else me["id"], limit, type, by, since, until)


@router.get("/auto")
def auto(_: dict = Depends(admin)) -> dict:
    return review.auto_accepted()


@router.post("/decisions/{decision_id}/revert")
def revert(decision_id: str, me: dict = Depends(admin)) -> dict:
    return {"decision": review.revert(decision_id, me["id"])}
