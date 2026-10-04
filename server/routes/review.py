"""The labeling queue over HTTP (server/review.py).

Reviewers and the admin work the queue and edit directly; any signed-in user
may suggest a change, which a reviewer then decides. The admin alone sees
everyone's decisions, the auto-accepted ones, and can revert.
"""

from fastapi import APIRouter, Body, Depends, Query

from .. import auth, review
from ..errors import AppError
from .auth import require_role, require_user

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
    if type is not None and type not in review.TYPES:
        raise AppError(400, "bad_type", "unknown task type")
    if origin is not None and origin not in review.ORIGINS:
        raise AppError(400, "bad_origin", "origin is proposal or suggestion")
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
                                  payload.get("words"), payload.get("skip"))}



@router.get("/progress")
def progress(_: dict = Depends(reviewer)) -> dict:
    return review.progress()


@router.post("/edit")
def edit(payload: dict = Body(...), me: dict = Depends(reviewer)) -> dict:
    """A reviewer's own change: live at once, logged."""
    return review.direct(payload.get("type", ""), payload.get("subject", ""), payload.get("value"), me["id"], payload.get("reason"))


@router.post("/suggest")
def suggest(payload: dict = Body(...), me: dict = Depends(require_user)) -> dict:
    """Ask for a change from the page. From a reviewer or the admin it is simply made."""
    type_, subject, value = payload.get("type", ""), payload.get("subject", ""), payload.get("value")
    reason = payload.get("reason")
    if auth.has_role(me, "reviewer"):
        return {"applied": True, "decision": review.direct(type_, subject, value, me["id"], reason)}
    if not (reason or "").strip():
        raise AppError(400, "suggest_reason", "say why, so a reviewer can check it")
    item = review.add_item(type_, subject, value, f"human:{me['id']}", "suggestion", reason, by=me["id"], priority=1.0)
    return {"applied": False, "item": {"id": item["id"], "status": item["status"]}}


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
    if (everyone or by) and not auth.has_role(me, "admin"):
        raise AppError(403, "admin_only", "only the site's owner can do this")
    return review.history(None if everyone or by else me["id"], limit, type, by, since, until)


@router.get("/auto")
def auto(_: dict = Depends(admin)) -> dict:
    return review.auto_accepted()


@router.post("/decisions/{decision_id}/revert")
def revert(decision_id: str, me: dict = Depends(admin)) -> dict:
    return {"decision": review.revert(decision_id, me["id"])}
