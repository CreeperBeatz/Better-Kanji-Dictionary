"""Can only the site's owner change a decomposition?

    python tests/decomp_auth.py

The graph applies decomposition overrides live for every visitor, so the
write routes must refuse anyone but BETTERRTK_OWNER_EMAIL -- and everyone
when it is unset. Serves the decomp router alone over real HTTP, with
accounts in a temporary directory and the override store faked, so it needs
neither the database nor touches data/.
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
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402

from server import auth, store  # noqa: E402
from server.errors import AppError, app_error_handler  # noqa: E402
from server.routes import decomp  # noqa: E402

OWNER = "owner@example.com"
failures: list[str] = []


def check(name: str, ok: bool, got: object = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else f'  (got {got})'}")
    if not ok:
        failures.append(name)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="decomp-auth-"))
    auth.AUTH_DIR, auth.AUTH_FILE = tmp, tmp / "auth.json"
    data = auth._load()
    sessions = {}
    for who, email in (("owner", OWNER), ("other", "someone@example.com")):
        user = auth._new_user(data, email)
        sessions[who] = auth._new_session(data, user["id"])
    auth._save(data)

    writes: list[tuple] = []
    store.set_decomposition = lambda c, parts: writes.append(("set", c)) or {"char": c, "components": parts}
    store.clear_decomposition = lambda c: writes.append(("clear", c)) or True
    store.decomposition_overrides = lambda: {}

    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.include_router(decomp.router)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)

    def call(method: str, path: str, who: str | None = None, body: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method)
        if who:
            req.add_header("Authorization", f"Bearer {sessions[who]}")
        if body is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(body).encode()
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    put = lambda who=None: call("PUT", "/api/decomp/%E9%9D%92", who, {"components": ["生", "月"]})  # 青
    delete = lambda who=None: call("DELETE", "/api/decomp/%E9%9D%92", who)

    try:
        os.environ["BETTERRTK_OWNER_EMAIL"] = OWNER
        print("owner set")
        for name, (status, body) in (("anonymous PUT", put()), ("anonymous DELETE", delete())):
            check(f"{name} is 401 sign_in_required", (status, body.get("code")) == (401, "sign_in_required"), (status, body))
        for name, (status, body) in (("other user PUT", put("other")), ("other user DELETE", delete("other"))):
            check(f"{name} is 403 admin_only", (status, body.get("code")) == (403, "admin_only"), (status, body))
        check("nothing was written by them", writes == [], writes)
        check("owner PUT is 200", put("owner")[0] == 200)
        check("owner DELETE is 200", delete("owner")[0] == 200)
        check("the owner's two writes went through", writes == [("set", "青"), ("clear", "青")], writes)
        check("reading the overrides stays open", call("GET", "/api/decomp/overrides")[0] == 200)

        writes.clear()
        os.environ["BETTERRTK_OWNER_EMAIL"] = "  OWNER@Example.com "
        print("owner set with stray case and spaces")
        check("owner PUT is still 200", put("owner")[0] == 200)

        writes.clear()
        os.environ.pop("BETTERRTK_OWNER_EMAIL")
        print("owner unset")
        check("owner PUT is 403", put("owner")[0] == 403)
        check("other user PUT is 403", put("other")[0] == 403)
        check("nothing was written", writes == [], writes)
    finally:
        server.should_exit = True

    print("all good" if not failures else f"{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
