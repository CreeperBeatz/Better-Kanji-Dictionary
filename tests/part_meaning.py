"""Part meanings (D-015): a part with no meaning gets its own, or a shape name.

    python tests/part_meaning.py

Checks what the value accepts, that an accepted one shows on the part's forms
(and stops it borrowing a form_of's meaning), that a revert takes it away,
and what a form link card and a part card carry for the reviewer: the
in-scope kanji each character is in. The review state lives in a temporary
directory; the real database is read.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from harness import Checks, use_sandbox

from server import forms, review
from server.errors import AppError
from server.forms import real_meanings

check = Checks()


def refused(value, subject: str = "丷") -> str | None:
    try:
        review.validate("part_meaning", subject, value)
    except AppError as e:
        return e.code
    return None


def main() -> int:
    use_sandbox(Path(tempfile.mkdtemp(prefix="bkd-test-")))
    review._schedule_pack = lambda: None

    print("the value")
    check("a kind is needed", refused({"en": "horns"}) == "part_kind")
    check("a label is needed", refused({"kind": "shape", "en": " "}) == "part_label")
    check("six words is too long", refused({"kind": "meaning", "en": "a b c d e f"}) == "part_label")
    check("a character not in the graph is refused", refused({"kind": "meaning", "en": "x"}, "A") == "bad_subject")
    v = review.validate("part_meaning", "丷", {"kind": "shape", "en": "  two   drops ", "bg": "", "note": "八 in 半"})
    check("spaces collapse, empty Bulgarian is None", v == {"kind": "shape", "en": "two drops", "bg": None, "note": "八 in 半", "noteBg": None}, v)

    print("on the page")
    check("丷 has nothing yet", forms.forms_of("丷")["part"] is None)
    item = review.add_item("part_meaning", "丷", {"kind": "shape", "en": "two drops", "note": "八 in 半, grains in 米"},
                           "ai:test", evidence={"confidence": 0.8})
    detail = review.item(item["id"])
    ctx = detail["context"]
    check("the card lists kanji built from it", "前" in ctx["users"] and "米" in ctx["users"], ctx["users"][:10])
    check("most frequent first", ctx["users"].index("前") < ctx["users"].index("糞") if "糞" in ctx["users"] else True)
    check("only kanji in scope", all(len(c) == 1 for c in ctx["users"]) and "丷" not in ctx["users"])
    review.decide(item["id"], "accept", "u-test")
    part = forms.forms_of("丷")["part"]
    check("accepted, the page has the shape", part and part["kind"] == "shape" and part["en"] == "two drops", part)

    # A part with a reviewed meaning borrows nothing from a form_of.
    review.direct("form_link", "龰|止", {"kind": "form_of", "note": "止 at the bottom of 足"}, "u-test")
    check("龰 borrows 止's meaning", (forms.forms_of("龰")["meaning"] or {}).get("from") == "止")
    d = review.direct("part_meaning", "龰", {"kind": "meaning", "en": "foot"}, "u-test")
    f = forms.forms_of("龰")
    check("with its own, it borrows nothing", f["meaning"] is None and f["part"]["en"] == "foot", f["meaning"])
    review.revert(d["id"], "u-owner")
    check("reverted, it borrows again", forms.forms_of("龰")["part"] is None and forms.forms_of("龰")["meaning"])

    print("form link cards")
    item = review.add_item("form_link", "𠂇|又", {"kind": "form_of", "note": "the hand in 左 and 友"}, "ai:test")
    users = review.item(item["id"])["context"]["users"]
    check("both sides list their kanji", "右" in users["a"] and "友" in users["b"], {k: v[:8] for k, v in users.items()})

    print("progress")
    review.add_item("part_meaning", "𠂇", {"kind": "meaning", "en": "hand"}, "ai:test")
    check("part meanings count under characters", "character" in review.progress()["stages"])

    print("bare numbers")
    check("卌 keeps 40", real_meanings(["40"]) == ["40"])
    check("万 drops 10,000 beside Ten Thousand", real_meanings(["Ten Thousand", "10,000"]) == ["Ten Thousand"])
    check("a radical number still goes", real_meanings(["Radical Number 9"]) == [])
    return check.done()


if __name__ == "__main__":
    raise SystemExit(main())
