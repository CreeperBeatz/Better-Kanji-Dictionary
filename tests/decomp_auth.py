"""Can only reviewers and the site's owner change a decomposition?

    python tests/decomp_auth.py

The graph applies decomposition overrides live for every visitor, so the
write routes must refuse anyone signed out (401) and plain users (403).
Reviewers and the admin (BETTERRTK_OWNER_EMAIL) may write, and each write is
a logged review decision. Accounts, the association store and the review
state live in a temporary directory, so data/ is untouched; the real
database is read to check the parts.
"""

from __future__ import annotations

import os
import sys

from harness import Checks, Server, use_sandbox

from server import review, store
from server.routes import decomp

check = Checks()


def main() -> int:
    srv = Server(decomp.router)
    use_sandbox(srv.tmp)
    review._schedule_pack = lambda: None
    call = srv.call
    put = lambda who=None: call("PUT", "/api/decomp/%E9%9D%92", who, {"components": ["生", "月"]})  # 青
    delete = lambda who=None: call("DELETE", "/api/decomp/%E9%9D%92", who)
    try:
        for name, (status, body) in (("anonymous PUT", put()), ("anonymous DELETE", delete())):
            check(f"{name} is 401 sign_in_required", (status, body.get("code")) == (401, "sign_in_required"), (status, body))
        for name, (status, body) in (("user PUT", put("user")), ("user DELETE", delete("user"))):
            check(f"{name} is 403 reviewers_only", (status, body.get("code")) == (403, "reviewers_only"), (status, body))
        check("nothing was written by them", store.decomposition_overrides() == {})
        check("reviewer PUT is 200", put("reviewer")[0] == 200)
        check("it is live", store.decomposition_overrides().get("青") == ["生", "月"])
        check("admin DELETE is 200", delete("admin")[0] == 200)
        check("it is gone", store.decomposition_overrides() == {})
        check("both writes are logged decisions", [d["by"] for d in review._read()["decisions"]] == [srv.ids["reviewer"], srv.ids["admin"]])
        check("reading the overrides stays open", call("GET", "/api/decomp/overrides")[0] == 200)
        check("a part that is the character itself is 400", call("PUT", "/api/decomp/%E9%9D%92", "reviewer", {"components": ["青"]})[0] == 400)

        os.environ.pop("BETTERRTK_OWNER_EMAIL")
        check("owner unset: the owner is a plain user, 403", put("admin")[0] == 403)
    finally:
        srv.stop()
    return check.done()


if __name__ == "__main__":
    sys.exit(main())
