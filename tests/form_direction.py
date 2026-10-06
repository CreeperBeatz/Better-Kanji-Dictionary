"""Which way a form link reads, and turning it round.

    python tests/form_direction.py

A link X|Y of a one-way kind reads "Y is the old form of X", "X is a form of
Y", "X looks like Y"; `reverse` reads it from Y to X. A reviewer turns a
proposal round with it instead of rejecting it. The review state lives in a
temporary directory; the real database is read.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from harness import Checks, use_sandbox

from server import forms, review

check = Checks()


def chars(rows: list[dict]) -> set[str]:
    return {r["char"] for r in rows}


def main() -> int:
    use_sandbox(Path(tempfile.mkdtemp(prefix="bkd-test-")))
    review._schedule_pack = lambda: None

    print("the value")
    v = review.validate("form_link", "宝|寳", {"kind": "old", "note": None, "reverse": True})
    check("a one-way link keeps reverse", v.get("reverse") is True, v)
    v = review.validate("form_link", "水|氵", {"kind": "positional", "note": None, "reverse": True})
    check("a symmetric one drops it", "reverse" not in v, v)
    v = review.validate("form_link", "宝|寳", {"kind": "old", "note": None, "reverse": False})
    check("unturned, the value is as it always was", v == {"kind": "old", "note": None}, v)

    print("what is built, read from the other side")
    now = review.current("form_link", "靑|青")
    check("靑|青 reads as reversed: 靑 is the old form of 青", now.get("kind") == "old" and now.get("reverse") is True, now)
    check("青|靑 reads straight", "reverse" not in review.current("form_link", "青|靑"))

    print("turning one round")
    review.direct("form_link", "宝|寳", {"kind": "old", "note": None}, "u-test")
    check("straight: 寳 is the old form of 宝", "寳" in chars(forms.forms_of("宝")["old"]))
    review.direct("form_link", "宝|寳", {"kind": "old", "note": None, "reverse": True}, "u-test")
    f = forms.forms_of("宝")
    check("reversed: 宝 is the old form of 寳", "寳" in chars(f["new"]) and "寳" not in chars(f["old"]), f["old"] + f["new"])
    check("and the card says so", review.current("form_link", "宝|寳").get("reverse") is True)
    return check.done()


if __name__ == "__main__":
    raise SystemExit(main())
