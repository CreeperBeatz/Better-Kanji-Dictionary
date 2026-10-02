"""The labeling queue: who may do what, and does a decision do what it says?

    python tests/review_access.py

Serves the review, decomp and graph routers over real HTTP with throwaway
accounts (tests/harness.py), the association store and the review state in
a temporary directory. Reads the real database, writes nothing in data/.
Uses 青 (parts 龶 月) and 生, which every build has.
"""

from __future__ import annotations

import sys

from harness import Checks, Server

from server import review, store
from server.routes import decomp, graph
from server.routes import review as review_routes

check = Checks()


def main() -> int:
    srv = Server(review_routes.router, decomp.router, graph.router)
    a = srv.tmp / "associations"
    store.ASSOC_DIR, store.STORE, store.IMAGES = a, a / "store.json", a / "images"
    review.use_dir(srv.tmp / "review")
    review.PACK_DELAY = 0.05
    flushed: list[int] = []
    review._flush_pack = lambda: flushed.append(1)  # the real one rebuilds the offline pack
    call = srv.call
    try:
        print("who may read the queue")
        for who, want in ((None, 401), ("user", 403), ("reviewer", 200), ("admin", 200)):
            check(f"{who or 'anonymous'} GET queue is {want}", call("GET", "/api/review/queue", who)[0] == want)
        check("an unknown type is 400", call("GET", "/api/review/queue?type=nope", "reviewer")[0] == 400)

        print("a user suggests; it waits for a reviewer")
        body = {"type": "decomposition", "subject": "青", "value": ["生", "月"], "reason": "old form 靑 is 生 over 丹"}
        check("anonymous cannot suggest", call("POST", "/api/review/suggest", None, body)[0] == 401)
        check("a suggestion needs a reason", call("POST", "/api/review/suggest", "user", {**body, "reason": ""})[0] == 400)
        status, res = call("POST", "/api/review/suggest", "user", body)
        check("a user's suggestion is queued, not applied", status == 200 and res["applied"] is False, res)
        check("nothing changed yet", "青" not in store.decomposition_overrides())
        status, again = call("POST", "/api/review/suggest", "user", body)
        check("the same suggestion twice is one item", again.get("item", {}).get("id") == res["item"]["id"], again)
        check("a user cannot edit directly", call("POST", "/api/review/edit", "user", body)[0] == 403)
        check("a user sees their suggestion", len(call("GET", "/api/review/mine", "user")[1]["items"]) == 1)

        print("bad values are refused")
        for name, value, code in (
            ("a stroke", ["一", "月"], "parts_stroke"),
            ("itself", ["青"], "parts_self"),
            ("an unknown part", ["A"], "parts_unknown"),
            ("a cycle", ["晴"], "parts_cycle"),
        ):
            status, res = call("POST", "/api/review/suggest", "user", {**body, "value": value})
            check(f"{name} is 400 {code}", (status, res.get("code")) == (400, code), (status, res))

        print("the reviewer decides")
        _, q = call("GET", "/api/review/queue", "reviewer")
        it = next(i for i in q["items"] if i["subject"] == "青")
        check("the item shows today's parts", sorted(it["current"]) == sorted(["龶", "月"]), it["current"])
        check("it says where it came from", it["origin"] == "suggestion")
        _, detail = call("GET", f"/api/review/items/{it['id']}", "reviewer")
        imp = detail["impact"]
        check("impact: 龶 removed, 生 added", imp["removed"] == ["龶"] and imp["added"] == ["生"], imp)
        check("impact: new prerequisites flagged", imp["newEdge"] and "生" in imp["gained"], imp)
        check("impact: 青's containers counted", imp["containers"] >= 6, imp["containers"])
        check("a user cannot decide", call("POST", f"/api/review/items/{it['id']}/decide", "user", {"action": "accept"})[0] == 403)
        status, res = call("POST", f"/api/review/items/{it['id']}/decide", "reviewer", {"action": "accept"})
        check("the reviewer accepts", status == 200 and res["item"]["status"] == "accepted", (status, res))
        check("it is live in the graph", graph.children_of(["青"])["青"] == ["生", "月"], graph.children_of(["青"]))
        check("deciding twice is 409", call("POST", f"/api/review/items/{it['id']}/decide", "reviewer", {"action": "reject"})[0] == 409)

        print("direct edits and revert")
        status, d = call("POST", "/api/review/edit", "reviewer", {"type": "decomposition", "subject": "青", "value": ["龶", "月"], "reason": "no, keep it"})
        check("a reviewer edits directly", status == 200 and d["action"] == "direct", (status, d))
        _, hist = call("GET", "/api/review/history", "reviewer")
        check("the reviewer's history has both", [h["action"] for h in hist["items"]][:2] == ["direct", "accept"], hist["items"][:2])
        accept_id = hist["items"][1]["id"]
        check("history of all is admin-only", call("GET", "/api/review/history?all=1", "reviewer")[0] == 403)
        check("a reviewer cannot revert", call("POST", f"/api/review/decisions/{d['id']}/revert", "reviewer")[0] == 403)
        status, res = call("POST", f"/api/review/decisions/{accept_id}/revert", "admin")
        check("reverting an older change is 409 changed_since", (status, res.get("code")) == (409, "changed_since"), (status, res))
        status, res = call("POST", f"/api/review/decisions/{d['id']}/revert", "admin")
        check("the admin reverts the latest", status == 200, (status, res))
        check("the revert put the accepted value back", store.decomposition_overrides().get("青") == ["生", "月"])
        status, res = call("POST", f"/api/review/decisions/{d['id']}/revert", "admin")
        check("reverting twice is 409", status == 409, status)
        call("DELETE", "/api/decomp/%E9%9D%92", "reviewer")
        check("DELETE through decomp clears the override", "青" not in store.decomposition_overrides())
        check("DELETE by a user is 403", call("DELETE", "/api/decomp/%E9%9D%92", "user")[0] == 403)
        check("PUT by a reviewer works", call("PUT", "/api/decomp/%E9%9D%92", "reviewer", {"components": ["龶", "月"]})[0] == 200)
        import time

        time.sleep(0.3)
        check("several decompositions, one pack rebuild", len(flushed) == 1, flushed)

        print("meanings: senses, then words, and reopening")
        senses = [{"id": "life", "en": "life, birth"}, {"id": "raw", "en": "raw, fresh"}]
        check("one sense is too few", call("POST", "/api/review/edit", "reviewer", {"type": "kanji_senses", "subject": "生", "value": senses[:1]})[0] == 400)
        _, wrow = call("GET", "/api/review/queue", "reviewer")
        from server.db import query

        wid = query("SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id WHERE wc.char = '生' AND w.headword = '生活'")[0]["id"]
        subj = f"生|{wid}"
        item = review.add_item("word_sense", subj, "生.life", "ai:test", evidence={"confidence": 0.9})
        check("a word's meaning may wait for its kanji's", item["status"] == "open")
        check("but stays out of the queue until then", all(i["subject"] != subj for i in call("GET", "/api/review/queue", "reviewer")[1]["items"]))
        status, _ = call("POST", "/api/review/edit", "reviewer", {"type": "kanji_senses", "subject": "生", "value": senses})
        check("the reviewer sets 生's meanings", status == 200)
        check("now the word is in the queue", any(i["subject"] == subj for i in call("GET", "/api/review/queue", "reviewer")[1]["items"]))
        status, res = call("POST", f"/api/review/items/{item['id']}/decide", "reviewer", {"action": "accept"})
        check("the word's meaning is accepted", status == 200 and review.word_senses("生") == {wid: "生.life"}, (status, res))
        bad = call("POST", "/api/review/edit", "reviewer", {"type": "word_sense", "subject": subj, "value": "生.nope"})
        check("an unknown sense is refused", bad[0] == 400, bad)
        call("POST", "/api/review/edit", "reviewer", {"type": "kanji_senses", "subject": "生", "value": [{"id": "birth", "en": "birth"}, senses[1]]})
        check("dropping a sense reopens its words", review.word_senses("生") == {} and review._read()["items"][item["id"]]["status"] == "open")

        print("form links")
        fl = {"type": "form_link", "subject": "龶|生", "value": {"kind": "form_of"}}
        check("form_of without evidence is 400", call("POST", "/api/review/edit", "reviewer", fl)[0] == 400)
        fl["value"]["note"] = "plain in 靑"
        check("with a note it goes live", call("POST", "/api/review/edit", "reviewer", fl)[0] == 200)
        f = call("GET", "/api/kanji/%E9%BE%B6/forms")[1]
        check("the forms block shows the reviewed note", f["formOf"][0]["note"] == "plain in 靑" and f["formOf"][0]["source"].startswith("review:"), f["formOf"])
        none = {"type": "form_link", "subject": "龶|王", "value": {"kind": "none"}}
        call("POST", "/api/review/edit", "reviewer", none)
        check("a link can be taken away", call("GET", "/api/kanji/%E9%BE%B6/forms")[1]["looksLike"] == [])

        print("admin-only lists")
        for who, want in (("reviewer", 403), ("admin", 200)):
            check(f"{who} GET auto is {want}", call("GET", "/api/review/auto", who)[0] == want)
    finally:
        srv.stop()
    return check.done()


if __name__ == "__main__":
    sys.exit(main())
