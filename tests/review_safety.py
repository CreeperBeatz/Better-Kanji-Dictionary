"""What the review keeps from going live unseen, and what a decision keeps for later.

    python tests/review_safety.py

- "The kanji brings no meaning" is never auto-accepted, nor starts ticked.
- A page edit of a kanji's groups places no word by itself; a changed group's words reopen.
- keep and reject record what the site showed, and can be taken back (the card reopens).
- Accepting a proposal whose subject changed after it was made asks first.
- A change that fails halfway leaves store.json and the Bulgarian overlay as they were.
- A backup carries store.json.

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
    r = review.revert(d["id"], "u-test")
    check("taking a keep back reopens the card", review._read()["items"][item["id"]]["status"] == "open")
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
