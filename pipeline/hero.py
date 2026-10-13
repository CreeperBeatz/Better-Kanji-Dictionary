"""The hero sentence: what a kanji is about, at the top of its page (Dani, 2026-10-14).

    python pipeline/hero.py prepare --sample 生上気...   # batches for a side-by-side sample
    python pipeline/hero.py prepare                      # every kanji in scope
    python pipeline/hero.py prepare --redo 奈仮津...      # a second pass (R-*), which wins over H-*
    # one subagent per data/drafts/hero/in/H-*.json (pipeline/hero_prompt.md)
    python pipeline/hero.py check [--out DIR]
    python pipeline/hero.py compare DIR DIR              # the sample, both runs, as Markdown
    python pipeline/hero.py load [--dry-run] [--review-dir DIR]

One to three sentences that flow and stick: the gist of the kanji, not a list of
its meanings. How the meanings connect stays `link`, in the meanings section.
The kanji is never written in its own sentence: the page shows it right above.

Input per kanji: its meaning groups as the site shows them (label, about, a
few words), KANJIDIC's keywords, Цалта's keyword for the Bulgarian, and its
origin when the drafts are sure of it.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from meaning_redraft import DRAFTS as MEANINGS, read_extras  # noqa: E402

from server import review, scope  # noqa: E402
from server.routes.search import kanji_page  # noqa: E402

HERO = proposals.DRAFTS / "hero"
IN, OUT = HERO / "in", HERO / "out"
BATCH = 40  # kanji per batch
WORDS = 4  # words per group
MAX_LEN = 320
KOKUJI = proposals.ROOT / "data" / "kokuji.txt"
SOURCE = "hero: Opus 5.5, pipeline/hero_prompt.md"
BOT = "u-3280c437d36a"  # Claude Opus 5.5, the reviewer account the drafts go live under
# Kanji that are another way of writing a kanji in everyday use: the hero may
# name that one (渕 is 淵 written another way). Old forms (萬 for 万) and
# variants; the database's char_form has only some of them.
FORMS = {
    "煕": "熙", "渕": "淵", "嶋": "島", "嶌": "島", "冨": "富", "聯": "連", "翫": "玩", "苅": "刈",
    "舘": "館", "銕": "鉄", "礒": "磯", "簑": "蓑", "舩": "船", "頚": "頸",
    "讃": "賛", "萬": "万", "嶽": "岳", "廣": "広", "搜": "捜", "澤": "沢", "燈": "灯",
    "眞": "真", "龍": "竜", "藝": "芸", "藏": "蔵",
}
JAPANESE = re.compile(r"[぀-ヿ㐀-鿿豈-﫿\U00020000-\U0003ffff]")


def _tsalta() -> dict[str, str]:
    out = {}
    for f in sorted((MEANINGS / "in").glob("A-*.json")):
        for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            t = (k.get("dictionaries") or {}).get("tsalta")
            if t and t.get("keyword"):
                out[k["char"]] = t["keyword"]
    return out


def _word(w: dict) -> str:
    gloss = w["senses"][0]["gloss"].split(";")[0] if w.get("senses") else ""
    return f"{w['headword']} {w['reading']}: {gloss}"


def _row(c: str, conn, extras: dict, tsalta: dict, kokuji: set[str]) -> dict:
    page = kanji_page(c)
    groups = []
    for m in page["meanings"]:
        ws = [*(m["kun"]["words"] if m["kun"] else []), *(w for o in m["on"] for w in o["words"])]
        groups.append({"en": m["en"], "bg": m["bg"], "about": m["about"], "words": [_word(w) for w in ws[:WORDS]]})
    k = conn.execute("SELECT meanings FROM kanji WHERE char = ?", (c,)).fetchone()
    x = extras.get(c) or {}
    return {
        "char": c,
        "keywords": json.loads(k[0] or "[]")[:6] if k else [],
        "tsalta": tsalta.get(c),
        "kokuji": c in kokuji,
        "origin": x.get("origin") if x.get("originSure") else None,
        "groups": groups,
        "soundOnly": [_word(w) for w in page["soundOnly"]["words"][:3]] if page["soundOnly"] else [],
    }


def prepare(sample: str | None, redo: str | None = None) -> None:
    conn = proposals.connect()
    extras, _ = read_extras()
    tsalta = _tsalta()
    kokuji = set(KOKUJI.read_text(encoding="utf-8").split()) if KOKUJI.exists() else set()
    chars = list(dict.fromkeys(sample or redo or "")) or scope.kanji(conn)
    rows = [_row(c, conn, extras, tsalta, kokuji) for c in chars]
    for r in rows:
        if r["char"] in FORMS:
            r["formOf"] = FORMS[r["char"]]
    IN.mkdir(parents=True, exist_ok=True)
    prefix = "S" if sample else "R" if redo else "H"
    for old in IN.glob(f"{prefix}-*.json"):
        old.unlink()
    for i in range(0, len(rows), BATCH):
        name = f"{prefix}-{i // BATCH:03d}"
        (IN / f"{name}.json").write_text(
            json.dumps({"batch": name, "kanji": rows[i:i + BATCH]}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)} kanji in {-(-len(rows) // BATCH)} batches -> {IN}/{prefix}-*.json")


def read(out: Path, prefix: str = "*") -> tuple[dict[str, dict], list[str]]:
    """char -> {"hero", "heroBg"}, checked against the input."""
    good, problems = {}, []
    for inp in sorted(IN.glob(f"{prefix}-*.json")):
        rows = json.loads(inp.read_text(encoding="utf-8"))["kanji"]
        want = [k["char"] for k in rows]
        form = {k["char"]: k.get("formOf") or "" for k in rows}
        f = out / inp.name
        if not f.exists():
            problems.append(f"{inp.name}: no output")
            continue
        got = json.loads(f.read_text(encoding="utf-8")).get("kanji") or {}
        for c in want:
            v = got.get(c) or {}
            for key in ("hero", "heroBg"):
                s = " ".join(str(v.get(key) or "").split())
                if not s:
                    problems.append(f"{c}: no {key}")
                elif c in s:
                    problems.append(f"{c}: {key} writes the kanji itself")
                elif JAPANESE.search(s.replace(form[c], "") if form[c] else s):
                    problems.append(f"{c}: {key} has Japanese in it")
                elif len(s) > MAX_LEN:
                    problems.append(f"{c}: {key} is {len(s)} characters")
                elif key == "heroBg" and re.search(r"кандзи", s):
                    problems.append(f"{c}: кандзи")
            if v.get("hero") and v.get("heroBg"):
                good[c] = {"hero": " ".join(v["hero"].split()), "heroBg": " ".join(v["heroBg"].split())}
    return good, problems


def compare(a: Path, b: Path) -> None:
    ra, _ = read(a, "S")
    rb, _ = read(b, "S")
    extras, _ = read_extras()
    lines = [f"# Hero sentences: {a.name} vs {b.name}", ""]
    order = [k["char"] for f in sorted(IN.glob("S-*.json")) for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]]
    for c in order:
        lines += [f"## {c}", "", f"- now (link): {(extras.get(c) or {}).get('link') or '—'}"]
        for name, r in ((a.name, ra), (b.name, rb)):
            v = r.get(c) or {}
            lines += [f"- **{name}**: {v.get('hero', '—')}", f"  - {v.get('heroBg', '—')}"]
        lines.append("")
    (HERO / "compare.md").write_text("\n".join(lines), encoding="utf-8")
    print(HERO / "compare.md")


def load(dry_run: bool, review_dir: Path | None) -> None:
    """Each kanji's hero onto its open kanji_extras draft, or a new draft where it has none.
    A kanji whose extras are already accepted gets it as a direct change by the bot."""
    good, problems = read(OUT, "H")
    redone, more = read(OUT, "R")  # the second pass wins
    good.update(redone)
    problems += more
    print(f"{len(good)} kanji, {len(problems)} problems")
    for p in problems[:20]:
        print("  " + p)
    proposals.use_review_dir(review_dir)
    updated = added = 0
    live: list[str] = []
    # A dry run reads the store and changes nothing.
    with contextlib.nullcontext(review._read()) if dry_run else review._change() as data:
        open_item = {i["subject"]: i for i in data["items"].values() if i["type"] == "kanji_extras" and i["status"] == "open"}
        for c, h in good.items():
            item = open_item.get(c)
            if item is None and c in data["live"]["kanji_extras"]:
                live.append(c)
                continue
            base = (item or {}).get("proposed") or {"link": None, "linkBg": None, "mixups": []}
            note = review.validate("kanji_extras", c, {**base, **h}, data, machine=True)
            if dry_run:
                pass
            elif item:
                review._update(data, item, proposed=note)
            else:
                review._new_item(data, "kanji_extras", c, note, SOURCE, "proposal", None, None, "system", 0.0)
            updated += bool(item)
            added += not item
    for c in live:
        if not dry_run:
            review.direct("kanji_extras", c, {**review.extras_of(c), **good[c]}, BOT,
                          "Hero sentence drafted by Opus 5.5 (2026-10-14), at Dani's go-ahead.")
    print(f"{updated} drafts updated, {added} new drafts, {len(live)} accepted extras changed directly"
          + (" (dry run)" if dry_run else ""))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--sample")
    p.add_argument("--redo")
    c = sub.add_parser("check")
    c.add_argument("--out", type=Path, default=OUT)
    c.add_argument("--prefix", default="*")
    m = sub.add_parser("compare")
    m.add_argument("a", type=Path)
    m.add_argument("b", type=Path)
    ld = sub.add_parser("load")
    ld.add_argument("--dry-run", action="store_true")
    ld.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare(args.sample, args.redo)
    elif args.cmd == "check":
        good, problems = read(args.out, args.prefix)
        print(f"{len(good)} kanji good, {len(problems)} problems")
        for p in problems:
            print("  " + p)
    elif args.cmd == "compare":
        compare(args.a, args.b)
    else:
        load(args.dry_run, args.review_dir)


if __name__ == "__main__":
    main()
