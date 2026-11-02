"""Reports: who may send, see and close them, and what a report may carry.

    python tests/reports_access.py

A real HTTP server around the reports router, accounts and reports in a
temporary directory; nothing in data/ is written.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import requests as httpx  # the venv has requests; same calls
from harness import Checks, Server

from server import reports
from server.routes import reports as reports_routes

check = Checks()

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\0" * 64


def main() -> int:
    srv = Server(reports_routes.router)
    reports.use_dir(srv.tmp / "reports")
    base = f"http://127.0.0.1:{srv.port}"

    def h(who: str | None) -> dict:
        return {"Authorization": f"Bearer {srv.sessions[who]}"} if who else {}

    def send(who, text="the reading is wrong", subject="kanji:生", files=(), context=None):
        r = httpx.post(f"{base}/api/reports", headers=h(who),
                       data={"text": text, **({"subject": subject} if subject else {}),
                             "context": json.dumps(context or {"url": "/kanji/生", "lang": "en", "junk": {"x": 1}})},
                       files=[("files", (n, b, t)) for n, b, t in files])
        return r.status_code, r.json()

    try:
        print("sending")
        st, res = send(None)
        check("signed out: 401", st == 401, (st, res))
        st, res = send("user")
        check("signed in: sent", st == 200 and res.get("status") == "open", (st, res))
        first = res.get("id")
        st, res = send("user", text="   ")
        check("empty text: 400 report_empty", st == 400 and res.get("code") == "report_empty", res)
        st, res = send("user", text="x" * (reports.MAX_TEXT + 1))
        check("too long: 400", st == 400 and res.get("code") == "report_too_long", res)
        st, res = send("user", subject="kanji:生生")
        check("bad subject: 400", st == 400 and res.get("code") == "bad_subject", res)
        st, res = send("user", subject=None)
        check("no subject (a general report) is fine", st == 200, res)
        st, res = send("user", files=[("a.png", b"not a picture", "image/png")])
        check("a file that only claims to be a PNG: 400", st == 400 and res.get("code") == "report_file_type", res)
        st, res = send("user", files=[(f"{k}.png", PNG, "image/png") for k in range(4)])
        check("4 pictures: 400", st == 400 and res.get("code") == "report_files", res)
        st, res = send("user", files=[("big.png", PNG + b"\0" * reports.MAX_FILE_BYTES, "image/png")])
        check("over 5 MB: 400", st == 400 and res.get("code") == "report_file_big", res)
        st, res = send("user", text="see the picture", files=[("shot.png", PNG, "image/png"), ("photo.jpg", JPG, "image/jpeg")])
        check("two pictures: sent", st == 200, res)
        with_pics = res.get("id")
        r = reports.get(with_pics)
        check("stored by their real type", [f["name"] for f in r["files"]] == ["1.png", "2.jpg"], r["files"])
        r1 = reports.get(first)
        check("the page's context kept, junk dropped", r1["context"].get("url") == "/kanji/生" and "junk" not in r1["context"], r1["context"])
        check("the data version added by the server", "data" in r1["context"], r1["context"])

        print("pictures")
        url = f"{base}/api/reports/{with_pics}/files/1.png"
        check("the reporter can open it", httpx.get(url, headers=h("user")).status_code == 200)
        check("the admin can open it", httpx.get(url, headers=h("admin")).status_code == 200)
        check("someone else gets 404", httpx.get(url, headers=h("other")).status_code == 404)
        check("signed out gets 401", httpx.get(url).status_code == 401)
        check("a made-up name gets 404", httpx.get(f"{base}/api/reports/{with_pics}/files/..%2Fx", headers=h("admin")).status_code == 404)

        print("listing and closing")
        check("a user can't see the open count", srv.call("GET", "/api/reports/open-count", "user")[0] == 403)
        check("the admin sees the open count", srv.call("GET", "/api/reports/open-count", "admin")[1] == {"open": 3})
        check("a user can't list", srv.call("GET", "/api/reports", "user")[0] == 403)
        st, res = srv.call("GET", "/api/reports", "admin")
        check("the admin lists all", st == 200 and len(res["items"]) == 3 and res["counts"]["open"] == 3, (st, res.get("counts")))
        check("with the reporter's email (admin only)", res["people"][srv.ids["user"]].get("email") == "user@example.com")
        check("kanji subjects get a label", any(i.get("label") == "生" for i in res["items"]))
        st, res = srv.call("POST", f"/api/reports/{first}/status", "user", {"status": "fixed"})
        check("a user can't close", st == 403, st)
        st, res = srv.call("POST", f"/api/reports/{first}/status", "admin", {"status": "wrong"})
        check("an unknown status: 400", st == 400, st)
        st, res = srv.call("POST", f"/api/reports/{first}/status", "admin", {"status": "fixed", "reply": " Fixed in 12 kanji. "})
        check("the admin closes it", st == 200 and res["report"]["status"] == "fixed", res)
        check("the count follows a close", srv.call("GET", "/api/reports/open-count", "admin")[1] == {"open": 2})
        st, res = srv.call("GET", "/api/reports?status=open", "admin")
        check("filtered by status", st == 200 and len(res["items"]) == 2, len(res.get("items", [])))
        st, mine = srv.call("GET", "/api/reports/mine", "user")
        got = next(i for i in mine["items"] if i["id"] == first)
        check("the reporter sees the status and reply", got["status"] == "fixed" and got["reply"] == "Fixed in 12 kanji.", got)
        check("but not who closed it", "closed_by" not in got, got)
        check("someone else sees none of them", srv.call("GET", "/api/reports/mine", "other")[1]["items"] == [])

        print("the daily limit")
        old = reports.MAX_PER_DAY
        reports.MAX_PER_DAY = 4
        try:
            st, res = send("user")
            check("the 4th today is fine", st == 200, res)
            st, res = send("user")
            check("the 5th: 429", st == 429 and res.get("code") == "too_many_reports", res)
            check("another user is not limited", send("other")[0] == 200)
        finally:
            reports.MAX_PER_DAY = old

        print("Claude Code's side")
        out = Path(tempfile.mkdtemp(prefix="bkd-export-"))
        reports.main(["export", str(out)])
        rows = json.loads((out / "reports.json").read_text(encoding="utf-8"))
        check("export: open ones only", all(r["status"] == "open" for r in rows) and len(rows) == 4, len(rows))
        check("export: pictures copied", (out / "files" / with_pics / "2.jpg").is_file())
        check("export: no emails", "@example.com" not in (out / "reports.json").read_text(encoding="utf-8"))
        batch = out / "batch.json"
        batch.write_text(json.dumps([{"id": with_pics, "status": "not_a_mistake", "reply": "This is the usual reading."}]), encoding="utf-8")
        reports.main(["close", "--file", str(batch)])
        check("close --file", reports.get(with_pics)["status"] == "not_a_mistake" and reports.get(with_pics)["closed_by"] == reports.BOT)
    finally:
        srv.stop()
    return check.done()


if __name__ == "__main__":
    raise SystemExit(main())
