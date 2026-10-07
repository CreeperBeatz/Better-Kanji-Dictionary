"""Usage cards: which kanji to write for a shared kun reading (はやい: 早い or 速い).

    python pipeline/usage_bunkacho.py prepare     # parse the report into batches
    # one subagent per data/drafts/usage/in/U-*.json (pipeline/usage_prompt.md)
    python pipeline/usage_bunkacho.py check [--batch NNN]
    python pipeline/usage_bunkacho.py load [--dry-run] [--review-dir DIR]

The source is Bunkacho's report 「「異字同訓」の漢字の使い分け例（報告）」
(文化審議会国語分科会, 2014-02-21; pipeline/data/similar/bunka/ijidokun_140221.txt,
the PDF's text). For each of its 133 readings it gives each spelling, a short
Japanese definition, example phrases, and footnotes on the borderline cases.
Its terms are MEXT's (the government standard terms, compatible with CC BY
4.0): it may be translated and edited, with credit, saying it was translated,
and never presented as the government's own text.

The Japanese stays as the report has it. The agents add the English and the
Bulgarian of each definition and footnote, pick 2 to 4 examples per spelling,
and give each its reading and translations. One `usage` item per reading
(subject: the reading as the report heads it, はやい・はやまる・はやめる).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from proposals import review  # noqa: E402

SOURCE_TXT = Path(__file__).parent / "data" / "similar" / "bunka" / "ijidokun_140221.txt"
DRAFTS = proposals.ROOT / "data" / "drafts" / "usage"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
BATCH = 20  # readings per batch
SOURCE = "bunkacho-ijidokun-2014 (translated)"

HEAD = re.compile(r"^([ぁ-ゖー・（）]+) ([０-９]{3})$")
SPELLING = re.compile(r"^【(.+?)】(.*)$")
FOOTER = re.compile(r"^- \d+ -$|^（[０-９]）.行")


def parse() -> list[dict]:
    """The report's main table: [{"reading", "no", "spellings": [{"kanji", "def", "examples"}], "notes": [str]}]."""
    lines = SOURCE_TXT.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.strip() == "本 表" and i > 100)
    out: list[dict] = []
    cur = spell = note = None
    for ln in lines[start + 1:]:
        ln = ln.strip()
        if not ln or FOOTER.match(ln):
            continue
        if ln.replace(" ", "").startswith("＜参考資料＞"):
            break
        m = HEAD.match(ln)
        if m:
            cur = {"reading": m.group(1), "no": int(m.group(2).translate(str.maketrans("０１２３４５６７８９", "0123456789"))),
                   "spellings": [], "notes": []}
            out.append(cur)
            spell = note = None
            continue
        if cur is None:
            continue
        m = SPELLING.match(ln)
        if m:
            spell = {"kanji": m.group(1), "def": m.group(2).strip(), "examples": ""}
            cur["spellings"].append(spell)
            note = None
            continue
        if ln.startswith("*"):
            note = len(cur["notes"])
            cur["notes"].append(ln)
            continue
        if note is not None:
            cur["notes"][note] += ln
        elif spell is not None:
            spell["examples"] += ln
    # Two entries can share a reading (きく: 聞く・聴く, and 利く・効く): the second is told by its number.
    seen: dict[str, int] = {}
    for e in out:
        seen[e["reading"]] = seen.get(e["reading"], 0) + 1
    for e in out:
        e["key"] = e["reading"] if seen[e["reading"]] == 1 else f"{e['reading']} {e['no']}"
    for e in out:
        for s in e["spellings"]:
            s["examples"] = [x + "。" for x in (t.strip() for t in s["examples"].split("。")) if x]
    return out


def prepare() -> None:
    entries = parse()
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for i in range(0, len(entries), BATCH):
        name = f"U-{i // BATCH:03d}"
        (IN / f"{name}.json").write_text(json.dumps({"batch": name, "entries": entries[i:i + BATCH]}, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
    n = sum(len(e["spellings"]) for e in entries)
    x = sum(len(s["examples"]) for e in entries for s in e["spellings"])
    print(f"{len(entries)} readings, {n} spellings, {x} examples, {sum(len(e['notes']) for e in entries)} notes "
          f"-> {-(-len(entries) // BATCH)} batches in {IN}")


def _text(v, n: int) -> str | None:
    return " ".join(v.split())[:n] or None if isinstance(v, str) else None


def read(only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    """reading -> the card's value, checked against the report."""
    good, problems = {}, []
    for inp in sorted(IN.glob(f"U-{only or '*'}.json")):
        out = OUT / inp.name
        if not out.exists():
            problems.append(f"{inp.stem}: no output")
            continue
        try:
            got = json.loads(out.read_text(encoding="utf-8")).get("entries") or {}
        except json.JSONDecodeError as err:
            problems.append(f"{inp.stem}: not JSON ({err})")
            continue
        for e in json.loads(inp.read_text(encoding="utf-8"))["entries"]:
            r = e.get("key") or e["reading"]
            g = got.get(r) or got.get(e["reading"])
            if not isinstance(g, dict):
                problems.append(f"{inp.stem} {r}: missing")
                continue
            try:
                good[r] = validate_value(e, g)
            except ValueError as err:
                problems.append(f"{inp.stem} {r}: {err}")
    return good, problems


def validate_value(e: dict, g: dict) -> dict:
    """The agent's output for one reading, joined to the report's own Japanese."""
    spellings = []
    by = {s.get("kanji"): s for s in g.get("spellings") or [] if isinstance(s, dict)}
    for s in e["spellings"]:
        t = by.get(s["kanji"])
        if not t:
            raise ValueError(f"spelling {s['kanji']} missing")
        exs = []
        for x in t.get("examples") or []:
            ja = (x or {}).get("ja")
            if ja not in s["examples"]:
                raise ValueError(f"{s['kanji']}: example {ja!r} is not one of the report's")
            if not all(_text(x.get(k), 300) for k in ("kana", "en", "bg")):
                raise ValueError(f"{s['kanji']}: example {ja} needs kana, en and bg")
            exs.append({"ja": ja, "kana": _text(x["kana"], 300), "en": _text(x["en"], 300), "bg": _text(x["bg"], 300)})
        if not 1 <= len(exs) <= 4 and s["examples"]:
            raise ValueError(f"{s['kanji']}: give 1 to 4 examples")
        if not _text(t.get("defEn"), 300) or not _text(t.get("defBg"), 300):
            raise ValueError(f"{s['kanji']}: defEn and defBg needed")
        spellings.append({"kanji": s["kanji"], "def": s["def"], "defEn": _text(t["defEn"], 300), "defBg": _text(t["defBg"], 300),
                          "examples": exs})
    notes = g.get("notes") or []
    if len(notes) > len(e["notes"]) and not e["notes"]:
        notes = []  # an entry's notes merged with another of the same reading (きく) went to that one
    if len(notes) != len(e["notes"]):
        raise ValueError(f"{len(e['notes'])} notes in the report, {len(notes)} translated")
    out_notes = []
    for ja, n in zip(e["notes"], notes):
        if not _text((n or {}).get("en"), 800) or not _text(n.get("bg"), 800):
            raise ValueError("each note needs en and bg")
        out_notes.append({"ja": ja, "en": _text(n["en"], 800), "bg": _text(n["bg"], 800)})
    if any("кандзи" in json.dumps(x, ensure_ascii=False) for x in (spellings, out_notes)):
        raise ValueError("«кандзи»: Japanese kanji are «канджи»")
    return {"reading": e["reading"], "no": e["no"], "spellings": spellings, "notes": out_notes}


def check(only: str | None) -> None:
    good, problems = read(only)
    print(f"usage: {len(good)} readings, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)


def load(dry_run: bool, review_dir: Path | None) -> None:
    good, problems = read()
    print(f"usage: {len(good)} readings ({len(problems)} problems, those left out)")
    proposals.use_review_dir(review_dir)
    known = review.subjects("usage")
    rows = [{"type": "usage", "subject": r, "proposed": v, "source": SOURCE,
             "reason": "Bunkacho's 異字同訓 report, translated", "priority": 0.5 - v["no"] / 10000}
            for r, v in good.items() if r not in known]
    if dry_run:
        raise SystemExit(f"would queue {len(rows)} usage cards ({len(good) - len(rows)} already queued)")
    added, refused = review.add_items(rows)
    print(f"queued {added} usage cards, {refused} refused")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    c = sub.add_parser("check")
    c.add_argument("--batch")
    proposals.load_parser(sub, "load")
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare()
    elif args.cmd == "check":
        check(args.batch)
    else:
        load(args.dry_run, args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
