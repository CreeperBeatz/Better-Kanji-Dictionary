"""What the review keeps from going live unseen, and what a decision keeps for later.

    python tests/review_safety.py

- "The kanji brings no meaning" is never auto-accepted, nor starts ticked.
- A page edit of a kanji's groups places no word by itself; a changed group's words reopen.
- keep and reject record what the site showed, and can be taken back (the card reopens).
- Accepting a proposal whose subject changed after it was made asks first.
- A change that fails halfway leaves store.json and the Bulgarian overlay as they were.
- A backup carries store.json.
- A meanings card kept, rejected or withdrawn takes its extras with it.
- A reloaded source does not ask again what was already answered.
- A form of another kanji has no parts or meaning of its own.

The review state lives in a temporary directory; the real database is read.
"""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

from harness import Checks, use_sandbox

from server import bg_overlay, review, store
from server.db import query
from server.errors import AppError

check = Checks()
SURE = {"runs": [{"sense": None, "confidence": 0.9}, {"sense": None, "confidence": 0.95}]}


def code(fn) -> str | None:
    try:
        fn()
    except AppError as e:
        return e.code
    return None


def word(char: str, headword: str) -> int:
    return query("SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id WHERE wc.char = ? AND w.headword = ?",
                 (char, headword))[0]["id"]


def sure(sense: str) -> dict:
    return {"runs": [{**r, "sense": sense} for r in SURE["runs"]], "confidence": 0.9}


def backdate(item: dict) -> None:
    """The item made a little earlier, as a real draft is: a change in the same second does not count as later."""
    with review._change() as data:
        old = data["items"][item["id"]]
        review._update(data, old, created="2000-01-01T00:00:00+00:00")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="bkd-test-"))
    use_sandbox(tmp)
    review._schedule_pack = lambda: None

    senses = [{"id": "生.life", "en": "life, birth"}, {"id": "生.student", "en": "student"}]
    life, student, odd = word("生", "生活"), word("生", "学生"), word("生", "生憎")

    print("catch-all")
    for wid, s in ((life, "生.life"), (student, "生.student"), (odd, "catch-all")):
        review.add_item("word_sense", f"生|{wid}", s, "ai:test", evidence=sure(s))
    on_board = {w["id"]: w for w in review.board("生")}
    check("a sure group pick starts ticked", on_board[life]["sure"])
    check("a sure catch-all does not", not on_board[odd]["sure"])

    print("auto-accept, only from the queue")
    review.direct("kanji_senses", "生", senses, "u-test")
    check("a page edit of the groups places no word", review.live_value("word_sense", f"生|{life}") is None)
    meanings = review.add_item("kanji_senses", "生", senses, "ai:test")
    review.decide(meanings["id"], "accept", "u-test")
    check("accepted in the queue, a sure word goes live", review.live_value("word_sense", f"生|{life}") == "生.life")
    check("a sure catch-all does not", review.live_value("word_sense", f"生|{odd}") is None)
    renamed = [{"id": "生.life", "en": "life"}, senses[1]]
    review.direct("kanji_senses", "生", renamed, "u-test", words={str(student): "生.student"})
    check("a page edit that changes a group reopens its words, moved ones or not",
          review.live_value("word_sense", f"生|{life}") is None)
    check("... and places no word itself", review.live_value("word_sense", f"生|{life}") is None
          and review._latest_item(review._read(), "word_sense", f"生|{life}")["status"] == "open")

    print("keep and reject")
    item = review.add_item("decomposition", "森", None, "check:test")
    review.decide(item["id"], "keep", "u-test")
    d = next(x for x in review._read()["decisions"] if x["item"] == item["id"])
    check("keep records what the site showed", d.get("shown") == review.current("decomposition", "森"), d.get("shown"))
    row = lambda x: next(h for h in review.history(None, limit=500)["items"] if h["id"] == x)  # noqa: E731
    check("History offers to take it back", row(d["id"])["revertible"] == "take_back")
    r = review.revert(d["id"], "u-test")
    check("taking a keep back reopens the card", review._read()["items"][item["id"]]["status"] == "open")
    check("... is logged as take_back, which itself has no revert", r["action"] == "take_back" and row(r["id"])["revertible"] is None)
    check("... and changes nothing live", review.live_value("decomposition", "森") is None)
    check("the reopen itself has no revert", code(lambda: review.revert(r["id"], "u-test")) == "not_revertible")
    check("a keep taken back once can't be again", code(lambda: review.revert(d["id"], "u-test")) == "not_revertible")

    print("a proposal drafted before a change")
    item = review.add_item("form_link", "罒|四", {"kind": "looks_like", "note": "looks like 四"}, "ai:test")
    backdate(item)
    review.direct("form_link", "罒|四", {"kind": "looks_like", "note": "a net, not four"}, "u-test")
    check("plain accept is refused", code(lambda: review.decide(item["id"], "accept", "u-test")) == "changed_since_draft")
    review.decide(item["id"], "accept", "u-test", stale_ok=True)
    check("accepted once the reviewer says so", review.live_value("form_link", "罒|四")["note"] == "looks like 四")
    item = review.add_item("form_link", "罒|皿", {"kind": "looks_like", "note": "looks like 皿"}, "ai:test")
    backdate(item)
    check("with no change since, accept goes through", code(lambda: review.decide(item["id"], "accept", "u-test")) is None)

    print("a change that fails halfway")
    before = store.decomposition_overrides().get("森")
    try:
        with review._change() as data:
            review._apply(data, "decomposition", "森", ["林", "木"], "d-test")
            check("inside the change, the split is live", store.decomposition_overrides().get("森") == ["林", "木"])
            raise RuntimeError("a later item on the card fails")
    except RuntimeError:
        pass
    check("the split is put back", store.decomposition_overrides().get("森") == before)
    subject = f"word:{life}"
    shown = bg_overlay.gloss(life, 0, "x")
    try:
        with review._change() as data:
            review._apply(data, "bg", subject, ["тест"], "d-test")
            raise RuntimeError
    except RuntimeError:
        pass
    check("the Bulgarian overlay is put back", bg_overlay.gloss(life, 0, "x") == shown)

    print("a meanings card's extras go with it")
    groups = [{"id": "活.live", "en": "live, active"}]
    m = review.add_item("kanji_senses", "活", groups, "ai:test")
    x = review.add_item("kanji_extras", "活", {"link": "living", "mixups": []}, "ai:test")
    review.decide(m["id"], "keep", "u-test")
    items = review._read()["items"]
    check("kept with its card", items[x["id"]]["status"] == "kept", items[x["id"]]["status"])
    keep = next(d for d in review._read()["decisions"] if d["item"] == m["id"])
    review.revert(keep["id"], "u-test")
    items = review._read()["items"]
    check("and reopened with it", items[m["id"]]["status"] == "open" and items[x["id"]]["status"] == "open")
    review.withdraw([m["id"]], "redrafted")
    check("withdrawn with it", review._read()["items"][x["id"]]["status"] == "withdrawn")
    sug = review.add_item("kanji_senses", "活", groups, "u-other", origin="suggestion", by="u-other")
    x2 = review.add_item("kanji_extras", "活", {"link": "alive", "mixups": []}, "ai:test")
    review.decide(sug["id"], "reject", "u-test")
    check("a rejected suggestion leaves the extras open", review._read()["items"][x2["id"]]["status"] == "open")

    print("a reloaded source")
    row = {"type": "form_link", "subject": "罒|皿", "proposed": {"kind": "looks_like", "note": "looks like 皿"}, "source": "ai:test"}
    check("a proposal already accepted is not asked again", review.add_items([row]) == (0, 0))
    item = review.add_item("decomposition", "林", None, "check:test")
    review.decide(item["id"], "keep", "u-test")
    check_row = {"type": "decomposition", "subject": "林", "proposed": None, "source": "check:test"}
    check("a check kept, with the site unchanged, is not asked again", review.add_items([check_row]) == (0, 0))
    item = review.add_item("decomposition", "林", ["木", "木"], "ai:test")
    review.decide(item["id"], "edit", "u-test", ["木", "十"])
    again = review.add_items([check_row])
    check("once the site changed, the check is asked again", again == (1, 0), (again, review.current("decomposition", "林")))

    print("a form has no parts or meaning of its own")
    parts = review.add_item("decomposition", "⺮", None, "check:test")
    link = review.add_item("form_link", "⺮|竹", None, "check:test")
    card = lambda *ds: code(lambda: review.decide_card("⺮", list(ds), "u-test"))  # noqa: E731
    check("a form of 竹 that keeps 竹 as its part is refused",
          card({"item": parts["id"], "action": "keep"}, {"item": link["id"], "action": "keep"}) == "form_has_parts")
    fl = review.add_item("form_link", "龰|止", {"kind": "form_of", "note": "止 at the bottom of 足"}, "ai:test")
    pm = review.add_item("part_meaning", "龰", {"kind": "meaning", "en": "foot"}, "ai:test")
    check("... and so is one with a meaning of its own", code(lambda: review._form_rule(
        review._read(), "龰", [{"item": fl["id"], "action": "accept"}, {"item": pm["id"], "action": "accept"}])) == "form_has_meaning")
    check("with no parts it goes through",
          card({"item": parts["id"], "action": "edit", "value": []}, {"item": link["id"], "action": "keep"}) is None)
    check("⺮ has no parts now", review.current("decomposition", "⺮") == [])
    root = review.add_item("decomposition", "手", None, "check:test")
    hand = review.add_item("form_link", "扌|手", None, "check:test")
    check("the root itself keeps its parts question", code(lambda: review.decide_card("手", [
        {"item": root["id"], "action": "edit", "value": []}, {"item": hand["id"], "action": "keep"}], "u-test")) is None)

    print("a visual split")
    soil = review.add_item("decomposition", "土", None, "check:test")
    review.decide_card("土", [{"item": soil["id"], "action": "edit", "value": []}], "u-test", visual=["十", "一"])
    check("土 stays whole", review.current("decomposition", "土") == [])
    check("and looks like 十 + 一", review.live_value("visual_split", "土") == {"parts": ["十", "一"]})
    scholar = review.add_item("decomposition", "士", None, "check:test")
    check("a visual split beside parts is refused", code(lambda: review.decide_card(
        "士", [{"item": scholar["id"], "action": "keep"}], "u-test", visual=["十", "一"])) == "visual_with_parts")
    check("one piece is a split (為 ends in 灬)", review.validate("visual_split", "為", {"parts": ["灬"]}) == {"parts": ["灬"]})
    check("no piece is not", code(lambda: review.validate("visual_split", "土", {"parts": []})) == "visual_invalid")
    parent = next(d for d in review._read()["decisions"] if d["subject"] == "土" and d["type"] == "decomposition")
    review.revert(parent["id"], "u-test")
    check("reverting the card takes the visual split back", review.live_value("visual_split", "土") is None)

    print("backup")
    item = review.add_item("decomposition", "森", ["林", "木"], "ai:test")
    review.decide(item["id"], "accept", "u-test")
    dest = tmp / "copy.db"
    review.backup(dest)
    side = dest.with_name(dest.name + ".store.json")
    check("store.json is copied beside it", side.exists() and '"森"' in side.read_text(encoding="utf-8"))
    n = sqlite3.connect(dest).execute("SELECT count(*) FROM decision").fetchone()[0]
    check("the review.db copy has the decisions", n > 0, n)
    return check.done()


if __name__ == "__main__":
    raise SystemExit(main())
