"""The admin page: who asked to review, who reviews, and every change of role.

Admin is the BETTERRTK_OWNER_EMAIL account and only that one (server/auth.py);
nothing here can make anyone admin.
"""

from fastapi import APIRouter, Body, Depends

from .. import auth
from ..errors import AppError
from .auth import require_role

router = APIRouter(prefix="/api/admin", tags=["admin"])

admin_only = require_role("admin")


@router.get("/people")
def people(_: dict = Depends(admin_only)) -> dict:
    return {"requests": auth.open_requests(), "reviewers": auth.reviewers(), "log": auth.role_log()}


@router.post("/requests/{request_id}")
def decide(request_id: str, payload: dict = Body(...), me: dict = Depends(admin_only)) -> dict:
    approve = payload.get("approve")
    if not isinstance(approve, bool):
        raise AppError(400, "bad_request", "approve must be true or false")
    try:
        req = auth.decide_request(request_id, approve, me["id"])
    except auth.NotFound:
        raise AppError(404, "request_not_found", "no open request with that id")
    return {"request": {"id": req["id"], "status": req["status"]}}


@router.post("/reviewers/{user_id}/revoke")
def revoke(user_id: str, payload: dict = Body(default={}), me: dict = Depends(admin_only)) -> dict:
    try:
        auth.revoke_reviewer(user_id, me["id"], (payload.get("reason") or "").strip()[:200] or None)
    except auth.NotFound:
        raise AppError(404, "reviewer_not_found", "that account is not a reviewer")
    return {"ok": True}
