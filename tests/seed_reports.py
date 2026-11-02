"""A sandbox directory with dummy reports, to look at the reports UI.

    python tests/seed_reports.py <dir> [--owner you@example.com]
    python tests/sandbox.py --dir <dir> --owner you@example.com

Copies the real review store into <dir>/review (so the pages show what they
show today), makes the owner's account and three dummy reporters, and sends
a dozen reports from them: some with pictures, some already closed with a
reply. Writes nothing in data/.
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from server import auth, reports, review  # noqa: E402
from server.db import query_one  # noqa: E402

FONT = next((f for f in ("C:/Windows/Fonts/YuGothM.ttc", "C:/Windows/Fonts/msgothic.ttc", "C:/Windows/Fonts/meiryo.ttc")
             if os.path.exists(f)), None)


def font(size: int):
    return ImageFont.truetype(FONT, size) if FONT else ImageFont.load_default()


def shot(big: str, lines: list[str], mark: int | None = None, w: int = 900, h: int = 560) -> bytes:
    """A made-up screenshot of a page: the kanji, some lines, one circled in red."""
    img = Image.new("RGB", (w, h), (18, 16, 14))
    d = ImageDraw.Draw(img)
    d.text((40, 30), big, font=font(120), fill=(237, 230, 218))
    y = 200
    for k, line in enumerate(lines):
        d.text((40, y), line, font=font(26), fill=(154, 145, 134) if k else (237, 230, 218))
        if k == mark:
            d.rounded_rectangle((28, y - 10, w - 40, y + 42), radius=10, outline=(208, 69, 43), width=4)
        y += 62
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def photo(text: str) -> bytes:
    """A made-up phone photo of a dictionary page, as a JPEG."""
    img = Image.new("RGB", (720, 960), (236, 228, 210))
    d = ImageDraw.Draw(img)
    d.text((60, 80), text, font=font(160), fill=(30, 26, 22))
    for k in range(9):
        d.line((60, 330 + k * 60, 660, 330 + k * 60), fill=(170, 160, 140), width=3)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def word(headword: str) -> str:
    r = query_one("SELECT id FROM word WHERE headword = ? ORDER BY id LIMIT 1", (headword,))
    return f"word:{r['id']}" if r else "word:1"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path)
    ap.add_argument("--owner", default="admin@example.com")
    args = ap.parse_args()
    tmp: Path = args.dir
    if tmp.exists() and any(tmp.iterdir()):
        sys.exit(f"{tmp} is not empty")
    tmp.mkdir(parents=True, exist_ok=True)
    os.environ["BETTERRTK_OWNER_EMAIL"] = args.owner

    # The review store as it is today: the pages read their meanings from it.
    (tmp / "review").mkdir()
    review.backup(tmp / "review" / "review.db")
    (tmp / "review" / "review.db.store.json").unlink(missing_ok=True)
    if review.store.ASSOC_DIR.exists():
        shutil.copytree(review.store.ASSOC_DIR, tmp / "associations")

    auth.AUTH_DIR = tmp / "auth"
    auth.AUTH_FILE = auth.AUTH_DIR / "auth.json"
    data = auth._load()
    auth._new_user(data, args.owner, "Dani")
    people = {}
    for key, email, name, username in (("mika", "mika@example.com", "Mika Tanaka", "mika"),
                                       ("ivan", "ivan@example.com", "Иван Петров", "ivan_p"),
                                       ("sam", "sam@example.com", "Sam Lee", "samlee")):
        u = auth._new_user(data, email, name)
        u["username"] = username
        people[key] = u["id"]
    auth._save(data)

    reports.use_dir(tmp / "reports")
    review.use_dir(tmp / "review")
    now = datetime.now(timezone.utc)
    rows = [
        # (who, hours ago, subject, text, pictures, status, reply, context)
        ("mika", 2, "kanji:生", "The second meaning group mixes two meanings: 生む (to give birth) and 生える (to grow, of hair or plants). "
         "They are different senses in every dictionary I checked (Kodansha, 大辞林).",
         [shot("生", ["Meaning groups", "life, live", "birth; grow  生む 生える 生やす", "raw, unprocessed"], mark=2)], "open", None,
         {"url": "/kanji/生", "lang": "en", "screen": "1440x900", "from": "kanji page"}),
        ("ivan", 5, "kanji:焼", "Българският превод на „bake“ е „пека“, а не „пържа“. Пържа е fry.",
         [], "open", None, {"url": "/kanji/焼", "lang": "bg", "screen": "390x844", "from": "kanji page"}),
        ("sam", 9, word("焼く"), "The reading shown for 焼く is やく, fine, but the example sentence translation says \"to fry\". "
         "The Japanese sentence is about grilling fish (魚を焼く).",
         [shot("焼く", ["やく", "to bake; to grill; to burn", "魚を焼く — to fry fish", ""], mark=2)], "open", None,
         {"url": "/word/" + word("焼く")[5:], "lang": "en", "screen": "1280x720", "from": "word card"}),
        ("mika", 20, "kanji:青", "The old form shown is 靑, correct. But the parts say 生 + 月, and the part meaning for 月 says \"moon\". "
         "In 青 the bottom is 丹 (red pigment), not the moon. My printed dictionary shows it:",
         [photo("靑"), shot("青", ["Parts", "生 + 月", "月: moon", ""], mark=1)], "open", None,
         {"url": "/kanji/青", "lang": "en", "screen": "1440x900", "from": "kanji page"}),
        ("ivan", 30, None, "On my phone the search bar covers the first result after I rotate the screen.",
         [], "open", None, {"url": "/", "lang": "bg", "screen": "844x390", "from": "kanji page"}),
        ("sam", 50, "kanji:及", "及 is listed as N1 but my JLPT book has it in N2.",
         [], "not_a_mistake", "Thanks! Lists differ here. We use the Tanos lists, which put 及 in N1. We show that source on the page now.",
         {"url": "/kanji/及", "lang": "en", "screen": "1280x720", "from": "kanji page"}),
        ("mika", 70, "kanji:国", "国's meaning groups miss \"province\" (as in 国司, 西国).",
         [], "fixed", "Thank you. We added a group for old provinces to 国, and found 11 other kanji with the same gap.",
         {"url": "/kanji/国", "lang": "en", "screen": "1440x900", "from": "kanji page"}),
        ("ivan", 75, "kanji:国", "国 няма значение за провинция (старите провинции на Япония).",
         [], "duplicate", "Same as an earlier report: fixed now.",
         {"url": "/kanji/国", "lang": "bg", "screen": "390x844", "from": "kanji page"}),
        ("sam", 100, word("生まれる"), "Typo in the English: \"to be bron\".",
         [shot("生まれる", ["うまれる", "to be bron", "", ""], mark=1)], "fixed", "Fixed. It was our copy of the gloss, JMdict is right.",
         {"url": "/word/" + word("生まれる")[5:], "lang": "en", "screen": "1280x720", "from": "word card"}),
    ]
    for who, hours, subject, text, pics, status, reply, ctx in rows:
        r = reports.add(people[who], text, subject, ctx, pics)
        r["created"] = (now - timedelta(hours=hours)).isoformat(timespec="seconds")
        if status != "open":
            r.update(status=status, reply=reply, closed_by=auth.owner_email() and "seed",
                     closed_at=(now - timedelta(hours=hours - 3)).isoformat(timespec="seconds"))
        reports._put(reports._db(), r)
    print(f"{len(rows)} reports in {tmp / 'reports'}; reporters mika@example.com, ivan@example.com, sam@example.com")


if __name__ == "__main__":
    main()
