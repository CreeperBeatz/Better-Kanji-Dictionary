"""The labeling queue: who may do what, and does a decision do what it says?

    python tests/review_access.py

Serves the review, decomp and graph routers over real HTTP with throwaway
accounts (tests/harness.py), the association store and the review state in
a temporary directory. Reads the real database, writes nothing in data/.
Uses 青 (parts 龶 月) and 生, which every build has.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from harness import Checks, Server, use_sandbox

from server import review, store
from server.errors import AppError
from server.routes import decomp, graph
from server.routes import review as review_routes

check = Checks()


def main() -> int:
    srv = Server(review_routes.router, decomp.router, graph.router)
    use_sandbox(srv.tmp)
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
            ("itself", ["青"], "parts_self"),
            ("an unknown part", ["A"], "parts_unknown"),
            ("a cycle", ["晴"], "parts_cycle"),
        ):
            status, res = call("POST", "/api/review/suggest", "user", {**body, "value": value})
            check(f"{name} is 400 {code}", (status, res.get("code")) == (400, code), (status, res))

        print("strokes: refused from sources, allowed from people")
        try:
            review.validate("decomposition", "主", ["丶", "王"], machine=True)
            check("a source's stroke split is refused", False)
        except AppError as e:
            check("a source's stroke split is refused", e.code == "parts_stroke", e.code)
        check("a person may use a stroke (the flame on 主)", review.validate("decomposition", "主", ["丶", "王"]) == ["丶", "王"])

        print("the reviewer decides")
        _, q = call("GET", "/api/review/queue", "reviewer")
        card = next(i for i in q["items"] if i["subject"] == "青")
        check("parts are listed as the character's card", card["type"] == "character" and card["kinds"] == ["decomposition"], card)
        _, c = call("GET", "/api/review/characters/%E9%9D%92", "reviewer")
        it = c["items"][0]
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

        print("a character's card is decided as one")
        chk = review.add_item("decomposition", "牛", None, "parts-check", reason="check: one part only")
        fl = review.add_item("form_link", "牛|牜", {"kind": "positional", "note": None}, "ai:test")
        _, c = call("GET", "/api/review/characters/%E7%89%9B", "reviewer")
        check("the card holds both items", {i["id"] for i in c["items"]} == {chk["id"], fl["id"]}, [i["id"] for i in c["items"]])
        status, res = call("POST", "/api/review/characters/%E7%89%9B/decide", "reviewer", {"decisions": [{"item": chk["id"], "action": "keep"}]})
        check("leaving an item out is 409", (status, res.get("code")) == (409, "card_changed"), (status, res))
        status, res = call("POST", "/api/review/characters/%E7%89%9B/decide", "reviewer", {"decisions": [
            {"item": chk["id"], "action": "keep"}, {"item": fl["id"], "action": "accept"}]})
        check("the card is decided", status == 200 and [i["status"] for i in res["items"]] == ["kept", "accepted"], (status, res))
        check("keep changes nothing", "牛" not in store.decomposition_overrides())
        check("kept is logged as kept", review._read()["decisions"][-2]["action"] == "keep")

        print("reports: on a word or a kanji, never live")
        status, res = call("POST", "/api/review/suggest", "reviewer", {"type": "report", "subject": "kanji:合", "value": {"about": "meanings", "text": "0.1 is a bare unit"}})
        check("a reviewer's report is queued too", status == 200 and res["applied"] is False, (status, res))
        check("a report needs what it is about", call("POST", "/api/review/suggest", "user", {"type": "report", "subject": "kanji:合", "value": {"about": "taste", "text": "nope"}, "reason": "x"})[0] == 400)

        print("meanings: senses, then words, and reopening")
        senses = [{"id": "life", "en": "life, birth"}, {"id": "raw", "en": "raw, fresh"}]
        check("no senses is too few", call("POST", "/api/review/edit", "reviewer", {"type": "kanji_senses", "subject": "生", "value": []})[0] == 400)
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

        print("the auto-accept rule for words")
        rows = query("SELECT w.id, w.headword FROM word_char wc JOIN word w ON w.id = wc.word_id WHERE wc.char = '青' AND w.common = 1 LIMIT 3")
        sure, unsure, split = (f"青|{r['id']}" for r in rows)
        run = lambda s, c: {"sense": s, "confidence": c}
        review.add_item("word_sense", sure, "青.colour", "ai:test", evidence={"runs": [run("青.colour", 0.9), run("青.colour", 0.85)]})
        review.add_item("word_sense", unsure, "青.colour", "ai:test", evidence={"runs": [run("青.colour", 0.9), run("青.colour", 0.6)]})
        review.add_item("word_sense", split, "青.colour", "ai:test", evidence={"runs": [run("青.colour", 0.9), run("青.young", 0.9)]})
        call("POST", "/api/review/edit", "reviewer", {"type": "kanji_senses", "subject": "青", "value": [{"id": "colour", "en": "blue, green"}, {"id": "young", "en": "young, unripe"}]})
        placed = review.word_senses("青")
        check("agreeing, confident runs are accepted", placed.get(int(sure.split("|")[1])) == "青.colour", placed)
        check("a low confidence waits for a person", int(unsure.split("|")[1]) not in placed)
        check("disagreeing runs wait for a person", int(split.split("|")[1]) not in placed)
        check("the admin sees it in auto-accepted", any(d["subject"] == sure for d in call("GET", "/api/review/auto", "admin")[1]["items"]))

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

        print("the print dictionaries: a page's scan is for reviewers and the admin")
        pages = srv.tmp / "books" / "kanji" / "pages"
        pages.mkdir(parents=True)
        (pages / "p0061.png").write_bytes(b"PNG")  # a stand-in: only who may fetch it is checked
        os.environ["BETTERRTK_BOOKS_DIR"] = str(srv.tmp / "books")
        for who, want in ((None, 401), ("user", 403), ("reviewer", 200), ("admin", 200)):
            check(f"{who or 'anonymous'} GET a page is {want}", page_status(srv, "/api/review/book/kanji/61", who) == want)
        check("a page that is not here is 404", page_status(srv, "/api/review/book/kanji/62", "reviewer") == 404)
        check("an unknown book is 404", page_status(srv, "/api/review/book/scans/61", "reviewer") == 404)

        print("other dictionaries on a meanings card: for reviewers and the admin, matched to the board")
        kod = srv.tmp / "books" / "kodansha"
        kod.mkdir(parents=True)
        (kod / "kodansha.jsonl").write_text(json.dumps({"type": "kanji", "kanji": "青", "no": 1, "core_meanings": ["BLUE"], "sections": {"compounds": [
            {"kind": "sense", "sense": "1", "text": "**blue**"},
            {"kind": "word", "ja": "青空", "reading": "あおぞら", "gloss": "blue sky", "sense": "1"}]}}, ensure_ascii=False), encoding="utf-8")
        for who, want in ((None, 401), ("user", 403), ("reviewer", 200), ("admin", 200)):
            check(f"{who or 'anonymous'} GET a kanji's dictionaries is {want}", call("GET", "/api/review/dictionaries/%E9%9D%92", who)[0] == want)
        d = call("GET", "/api/review/dictionaries/%E9%9D%92", "reviewer")[1]
        sky = d["kodansha"]["senses"][0]["words"][0]["id"]
        check("the book's word is matched to the board's", sky is not None and d["words"].get(str(sky)) == [{"src": "kodansha", "key": "c:1", "label": "1"}], d["words"])
        check("more than one kanji is 400", call("GET", "/api/review/dictionaries/%E9%9D%92%E7%A9%BA", "reviewer")[0] == 400)

        print("a second source goes beside an item, not into it")
        it = review.add_item("decomposition", "語", None, "cost-ranking", reason="check: many parts")
        view = {"book": "kanji", "split": ["言", "吾"]}
        check("attached to an open item", review.attach_evidence("book", {it["id"]: view}) == 1)
        got = review._read()["items"][it["id"]]
        check("the proposal is untouched", got["proposed"] is None and got["evidence"]["book"] == view, got)
        check("the same view again changes nothing", review.attach_evidence("book", {it["id"]: view}) == 0)
        decided = call("POST", f"/api/review/items/{it['id']}/decide", "reviewer", {"action": "reject"})
        check("the reviewer decides it", decided[0] == 200, decided)
        check("a decided item is left alone", review.attach_evidence("book", {it["id"]: {**view, "no": 1}}) == 0)
        check("evidence comes off an open item", review.drop_evidence("book", [it["id"]]) == 0)  # decided: left as it is

        print("a source re-read: its open proposals restated or withdrawn")
        src = review.add_item("decomposition", "話", ["言", "千", "口"], "tsalta-diff", reason="the book splits it so")
        changed, refused = review.restate({src["id"]: {"proposed": ["言", "舌"], "reason": "corrected", "evidence": None}})
        got = review._read()["items"][src["id"]]
        check("restated in place", (changed, refused) == (1, 0) and got["proposed"] == ["言", "舌"] and got["status"] == "open", got)
        check("a restatement that fails validation leaves it", review.restate({src["id"]: {"proposed": ["話"]}}) == (0, 1))
        before = review.progress()["stages"]["character"]
        check("withdrawn", review.withdraw([src["id"]], "the book no longer gives it") == 1)
        check("out of the queue", all(src["id"] not in i.get("items", [i["id"]]) for i in call("GET", "/api/review/queue?type=character", "reviewer")[1]["items"]))
        after = review.progress()["stages"]["character"]
        check("not counted as a task done", after["done"] == before["done"] and after["total"] == before["total"] - 1, (before, after))
        check("free to be asked again by another source", "話" not in review.subjects("decomposition"))

        print("a kanji's extras: on its groups, and decided with them on the meanings card")
        rows = query("SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id WHERE wc.char = '水' AND w.common = 1 LIMIT 2")
        ex = [r["id"] for r in rows]
        groups = [{"id": "water", "en": "water", "about": "  The liquid.  ", "examples": ex, "original": True, "similar": ["氷"]}]
        bad = review.add_items([{"type": "kanji_senses", "subject": "水", "proposed": [{**groups[0], "examples": [wid]}], "source": "ai:test"}])
        check("an example that is not a word of the kanji is refused", bad == (0, 1), bad)
        bad = review.add_items([{"type": "kanji_senses", "subject": "水", "proposed": [{**groups[0], "similar": ["水"]}], "source": "ai:test"}])
        check("a kanji similar to itself is refused", bad == (0, 1), bad)
        g = review.add_item("kanji_senses", "水", groups, "ai:test")
        check("the group's extras are kept, cleaned", g["proposed"][0] == {"id": "水.water", "en": "water", "bg": None, "note": None, "noteBg": None,
                                                                         "about": "The liquid.", "examples": ex, "original": True, "similar": ["氷"]}, g["proposed"])
        plain = review.validate("kanji_senses", "水", [{"id": "water", "en": "water"}])
        check("a group without extras is as it always was", plain == [{"id": "水.water", "en": "water", "bg": None, "note": None, "noteBg": None}], plain)
        note = {"origin": "A stream.", "originSure": True, "link": None, "mixups": [{"char": "氷", "reading": "こおり"}]}
        x = review.add_item("kanji_extras", "水", note, "ai:test")
        check("extras are not listed in the queue on their own", all(i["id"] != x["id"] for i in call("GET", "/api/review/queue", "reviewer")[1]["items"]))
        check("nor counted as a stage", "kanji_extras" not in call("GET", "/api/review/queue", "reviewer")[1]["types"])
        status, d = call("GET", f"/api/review/items/{g['id']}", "reviewer")
        check("the meanings card carries them", status == 200 and d["context"]["extras"]["item"] == x["id"] and d["context"]["extras"]["value"]["origin"] == "A stream.", d.get("context", {}).get("extras"))
        edited = {**note, "link": "One meaning only."}
        status, _ = call("POST", f"/api/review/items/{g['id']}/decide", "reviewer", {"action": "accept", "words": {}, "extras": edited})
        check("deciding the card decides them", status == 200 and review.extras_of("水")["link"] == "One meaning only.", review.extras_of("水"))
        check("as an edit of their item", review._read()["items"][x["id"]]["status"] == "edited")
        check("the site's groups carry the extras", review.senses_of("水")[0].get("about") == "The liquid.")
        bad = call("POST", "/api/review/edit", "reviewer", {"type": "kanji_extras", "subject": "水", "value": {"mixups": [{"char": "水", "reading": "みず"}]}})
        check("a kanji to mix up with itself is refused", bad[0] == 400, bad)
        b = review.add_item("bg", "kanji:水", ["вода"], "mt:test")
        status, d = call("GET", f"/api/review/items/{b['id']}", "reviewer")
        check("the Bulgarian card carries the extras too", status == 200 and d["context"]["extras"]["value"]["link"] == "One meaning only.", d.get("context", {}).get("extras"))
        status, _ = call("POST", f"/api/review/items/{b['id']}/decide", "reviewer", {
            "action": "accept", "aboutBg": {"水.water": "Течността."}, "extras": {**edited, "originBg": "Поток."}})
        check("it sets each group's about in Bulgarian", status == 200 and review.senses_of("水")[0].get("aboutBg") == "Течността.", review.senses_of("水"))
        check("and the origin's", review.extras_of("水")["originBg"] == "Поток.", review.extras_of("水"))

        print("usage cards")
        card = {"reading": "はやい", "spellings": [
            {"kanji": "早い", "def": "時期が前", "defEn": "early", "defBg": "рано", "examples": [{"ja": "早く起きる。", "kana": "はやくおきる。", "en": "get up early", "bg": "ставам рано"}]},
            {"kanji": "速い", "def": "スピードがある", "defEn": "fast", "defBg": "бързо", "examples": []}], "notes": []}
        u = review.add_item("usage", "はやい", card, "bunkacho")
        check("a usage card is queued", any(i["id"] == u["id"] for i in call("GET", "/api/review/queue?type=usage", "reviewer")[1]["items"]))
        status, d = call("GET", f"/api/review/items/{u['id']}", "reviewer")
        check("its context names its kanji", status == 200 and [k["char"] for k in d["context"]["kanji"]] == ["早", "速"], d.get("context"))
        status, _ = call("POST", f"/api/review/items/{u['id']}/decide", "reviewer", {"action": "accept"})
        check("and accepted", status == 200 and review.live_value("usage", "はやい")["spellings"][1]["defEn"] == "fast")
        check("one spelling is not a card", review.add_items([{"type": "usage", "subject": "x", "proposed": {"spellings": card["spellings"][:1]}, "source": "t"}]) == (0, 1))

        print("admin-only lists")
        for who, want in (("reviewer", 403), ("admin", 200)):
            check(f"{who} GET auto is {want}", call("GET", "/api/review/auto", who)[0] == want)

        print("the store")
        with review._lock:
            check("every change above reached the database", review._fetch(review._db()) == review._read())
    finally:
        srv.stop()
    return check.done()


def page_status(srv: Server, path: str, who: str | None) -> int:
    """A response's status only: a page's scan is not JSON."""
    req = urllib.request.Request(f"http://127.0.0.1:{srv.port}{path}")
    if who:
        req.add_header("Authorization", f"Bearer {srv.sessions[who]}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


if __name__ == "__main__":
    sys.exit(main())
