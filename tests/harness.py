"""A real HTTP server around some routers, with throwaway accounts.

Shared by the access tests (tests/roles.py, tests/review_access.py, ...).
Accounts live in a temporary directory, one per role, so nothing in data/auth
is read or written; each test fakes or redirects whatever else it touches.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402

from server import auth  # noqa: E402
from server.errors import AppError, app_error_handler  # noqa: E402

OWNER = "owner@example.com"
WHO = ("admin", "reviewer", "user", "other")


class Checks:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def __call__(self, name: str, ok: bool, got: object = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else f'  (got {got})'}")
        if not ok:
            self.failures.append(name)

    def done(self) -> int:
        print("all good" if not self.failures else f"{len(self.failures)} failed")
        return 1 if self.failures else 0


class Server:
    """Accounts for each of WHO (plus `None` = anonymous) and a server for `routers`."""

    def __init__(self, *routers) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="bkd-test-"))
        auth.AUTH_DIR, auth.AUTH_FILE = self.tmp / "auth", self.tmp / "auth" / "auth.json"
        os.environ["BETTERRTK_OWNER_EMAIL"] = OWNER
        data = auth._load()
        self.sessions: dict[str, str] = {}
        self.ids: dict[str, str] = {}
        for who in WHO:
            user = auth._new_user(data, OWNER if who == "admin" else f"{who}@example.com")
            if who == "reviewer":
                user["role"] = "reviewer"
            self.ids[who] = user["id"]
            self.sessions[who] = auth._new_session(data, user["id"])
        auth._save(data)

        app = FastAPI()
        app.add_exception_handler(AppError, app_error_handler)
        for r in routers:
            app.include_router(r)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning"))
        threading.Thread(target=self.server.run, daemon=True).start()
        while not self.server.started:
            time.sleep(0.05)

    def call(self, method: str, path: str, who: str | None = None, body: dict | None = None) -> tuple[int, dict]:
        path = urllib.parse.quote(path, safe="/?=&%")
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method)
        if who:
            req.add_header("Authorization", f"Bearer {self.sessions[who]}")
        if body is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(body).encode()
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raw = e.read() or b"{}"
            try:
                return e.code, json.loads(raw)
            except json.JSONDecodeError:
                return e.code, {"raw": raw.decode("utf-8", "replace")[:200]}

    def stop(self) -> None:
        self.server.should_exit = True
