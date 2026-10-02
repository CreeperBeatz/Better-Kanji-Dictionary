"""Roles: who may ask to contribute, and who may run the admin page?

    python tests/roles.py

Admin is BETTERRTK_OWNER_EMAIL and nothing else; reviewers are approved by
the admin from a request; every change of role is logged. Accounts live in a
temporary directory (tests/harness.py), so data/auth is untouched.
"""

from __future__ import annotations

import os
import sys

from harness import Checks, Server

from server import auth, mail
from server.routes import admin
from server.routes import auth as auth_routes

check = Checks()


def main() -> int:
    sent: list[tuple] = []
    mail.send_contribution_request = lambda *a: sent.append(a)
    srv = Server(auth_routes.router, admin.router)
    call = srv.call
    try:
        print("who am I")
        for who, role in (("admin", "admin"), ("reviewer", "reviewer"), ("user", "user")):
            _, body = call("GET", "/api/auth/me", who)
            check(f"{who} sees role {role}", body.get("user", {}).get("role") == role, body)

        print("the admin page")
        for who, want in ((None, 401), ("user", 403), ("reviewer", 403), ("admin", 200)):
            status, _ = call("GET", "/api/admin/people", who)
            check(f"{who or 'anonymous'} GET people is {want}", status == want, status)

        print("asking to contribute")
        check("anonymous is 401", call("POST", "/api/auth/contribute", None, {"text": "x" * 20})[0] == 401)
        check("too short is 400", call("POST", "/api/auth/contribute", "user", {"text": "hi"})[0] == 400)
        status, body = call("POST", "/api/auth/contribute", "user", {"text": "I teach Japanese in Sofia."})
        check("a user may ask", status == 200 and body["user"]["contribution"]["status"] == "open", (status, body))
        check("the owner was emailed", len(sent) == 1 and sent[0][0] == auth.owner_email(), sent)
        check("asking twice is 409", call("POST", "/api/auth/contribute", "user", {"text": "again, please!!"})[0] == 409)
        check("a reviewer cannot ask", call("POST", "/api/auth/contribute", "reviewer", {"text": "already reviewing"})[0] == 409)

        _, people = call("GET", "/api/admin/people", "admin")
        reqs = people["requests"]
        check("the request is on the admin page", len(reqs) == 1 and reqs[0]["user"]["id"] == srv.ids["user"], reqs)
        rid = reqs[0]["id"]
        check("a reviewer cannot approve", call("POST", f"/api/admin/requests/{rid}", "reviewer", {"approve": True})[0] == 403)
        check("a user cannot approve their own", call("POST", f"/api/admin/requests/{rid}", "user", {"approve": True})[0] == 403)
        check("the admin approves", call("POST", f"/api/admin/requests/{rid}", "admin", {"approve": True})[0] == 200)
        check("approved twice is 404", call("POST", f"/api/admin/requests/{rid}", "admin", {"approve": True})[0] == 404)
        check("the user is now a reviewer", call("GET", "/api/auth/me", "user")[1]["user"]["role"] == "reviewer")

        print("declining")
        call("POST", "/api/auth/contribute", "other", {"text": "I would like to help"})
        rid = call("GET", "/api/admin/people", "admin")[1]["requests"][0]["id"]
        call("POST", f"/api/admin/requests/{rid}", "admin", {"approve": False})
        me = call("GET", "/api/auth/me", "other")[1]["user"]
        check("declined stays a user", me["role"] == "user" and me["contribution"]["status"] == "declined", me)

        print("revoking")
        revoke = lambda target, who: call("POST", f"/api/admin/reviewers/{srv.ids[target]}/revoke", who, {})[0]
        check("a reviewer cannot revoke", revoke("user", "reviewer") == 403)
        check("the admin revokes", revoke("user", "admin") == 200)
        check("revoked is a user again", call("GET", "/api/auth/me", "user")[1]["user"]["role"] == "user")
        check("the admin cannot be revoked", revoke("admin", "admin") == 404)
        log = call("GET", "/api/admin/people", "admin")[1]["log"]
        changes = [(e["before"], e["after"]) for e in log]
        check("both role changes are logged, newest first", changes == [("reviewer", "user"), ("user", "reviewer")], log)

        print("admin comes from config only")
        os.environ.pop("BETTERRTK_OWNER_EMAIL")
        check("owner unset: nobody is admin", call("GET", "/api/admin/people", "admin")[0] == 403)
        check("owner unset: role is user", call("GET", "/api/auth/me", "admin")[1]["user"]["role"] == "user")
        # A stored "admin" role must not count: admin is never stored.
        data = auth._load()
        data["users"][srv.ids["other"]]["role"] = "admin"
        auth._save(data)
        os.environ["BETTERRTK_OWNER_EMAIL"] = "owner@example.com"
        check("a stored admin role is ignored", call("GET", "/api/admin/people", "other")[0] == 403)
    finally:
        srv.stop()
    return check.done()


if __name__ == "__main__":
    sys.exit(main())
