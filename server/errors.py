"""Errors the interface shows to people, with a code it can translate.

The body stays FastAPI's `{"detail": "<English>"}` -- anything reading
`detail` keeps working -- plus `code`, a stable name the web client looks up
in its own strings (web/src/i18n/errors.ts), and `params` for the numbers a
message carries.
"""

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class AppError(HTTPException):
    def __init__(self, status: int, code: str, detail: str, **params) -> None:
        super().__init__(status, detail)
        self.code = code
        self.params = params


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    body: dict = {"detail": exc.detail, "code": exc.code}
    if exc.params:
        body["params"] = exc.params
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)
