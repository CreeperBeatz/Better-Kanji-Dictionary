"""Draft form links with Claude Code subagents, then queue them (task B).

    python pipeline/form_drafts.py prepare
    # one Sonnet subagent per data/drafts/forms/in/*.json, following pipeline/form_prompt.md
    python pipeline/form_drafts.py check [--batch F-000]
    python pipeline/form_drafts.py load [--dry-run] [--review-dir DIR]

Two kinds of item, both in the N5-N2 closure:

- **parts**: bound parts with no meaning of their own and no `form_of` yet
  (KANJIDIC gives at most a radical number). The subagent may propose what
  each is a form of -- citing an old form or a reference -- and a mnemonic
  lookalike.
- **pairs**: Unihan variant pairs the forms table does not classify (most
  are Chinese simplified forms, or financial numerals: `none`).

Every link proposed is a `form_link` proposal; `none` is only loaded where
it would hide something the page shows (it never does today: unclassified
variants are listed as "Other variants", which `none` leaves as it is), so
it is counted and dropped. Nothing is accepted without a reviewer: §6 lets
only Unihan's own Japanese old forms through, and those are built in.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
DB = ROOT / "data" / "betterrtk.sqlite"
DRAFTS = ROOT / "data" / "drafts" / "forms"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
SOURCE = "ai:claude-sonnet"
KINDS = ("positional", "old", "form_of", "looks_like", "none")
PARTS_PER_BATCH, PAIRS_PER_BATCH = 30, 80


def _unihan_fields() -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    with zipfile.ZipFile(ROOT / "pipeline" / "data" / "Unihan.zip") as z:
        for line in z.read("Unihan_Variants.txt").decode("utf-8").splitlines():
            if not line.startswith("U+"):
                continue
            cp, field, value = line.split("\t")
            a = chr(int(cp[2:], 16))
            for v in value.split():
                b = chr(int(v.split("<")[0][2:], 16))
                out.setdefault((a, b), field)
                out.setdefault((b, a), field + " (reverse)")
    return out


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def prepare() -> None:
    import review_sources as rs
    from server.forms import real_meanings

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    children, nodes = rs.graph(db)
    targets = [r[0] for r in db.execute("SELECT char FROM kanji WHERE jlpt >= 2")]
    scope = rs.closure(children, targets)
    meanings = {c: json.loads(m or "[]") for c, m in db.execute("SELECT char, meanings FROM kanji")}
    linked = {(a, b) for a, b in db.execute("SELECT char, other FROM char_form")}
    form_of = {a for (a,) in db.execute("SELECT char FROM char_form WHERE kind = 'form_of'")}
    old = {a: b for a, b in db.execute("SELECT char, other FROM char_form WHERE kind = 'old'")}
    ids = rs.babelstone()
    containers: dict[str, list[str]] = {}
    for p, cs in children.items():
        for c in cs:
            containers.setdefault(c, []).append(p)
    freq = {c: f or 9999 for c, f in db.execute("SELECT char, freq FROM kanji")}

    parts = []
    for c in sorted(scope, key=lambda c: -len(containers.get(c, []))):
        if c not in containers or real_meanings(meanings.get(c, [])) or c in form_of:
            continue
        users = sorted(containers[c], key=lambda k: freq.get(k, 9999))[:10]
        parts.append({
            "part": c,
            "kanjidic": meanings.get(c, []),
            "in": [{"kanji": u, "ids": ids.get(u), "old": old.get(u), "oldIds": ids.get(old[u]) if u in old else None} for u in users],
        })
    fields = _unihan_fields()
    pairs = []
    for a, b in db.execute("SELECT char, other FROM similar WHERE kind = 'variant'"):
        if a in scope and (a, b) not in linked and (b, a) not in linked and a < b:
            pairs.append({"pair": [a, b], "meanings": [meanings.get(a, []), meanings.get(b, [])], "unihan": fields.get((a, b))})

    n = 0
    for i in range(0, len(parts), PARTS_PER_BATCH):
        _write(IN / f"F-{n:03d}.json", {"batch": f"F-{n:03d}", "parts": parts[i:i + PARTS_PER_BATCH], "pairs": []})
        n += 1
    for i in range(0, len(pairs), PAIRS_PER_BATCH):
        _write(IN / f"F-{n:03d}.json", {"batch": f"F-{n:03d}", "parts": [], "pairs": pairs[i:i + PAIRS_PER_BATCH]})
        n += 1
    print(f"{len(parts)} parts, {len(pairs)} pairs in {n} batches -> {IN.relative_to(ROOT)}")


def read(only: str | None = None) -> tuple[list[dict], list[str]]:
    good, problems = [], []
    for inp in sorted(IN.glob(f"{only or 'F-*'}.json")):
        batch = json.loads(inp.read_text(encoding="utf-8"))
        out_path = OUT / inp.name
        if not out_path.exists():
            problems.append(f"{inp.stem}: no output")
            continue
        try:
            out = json.loads(out_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            problems.append(f"{inp.stem}: not JSON ({e})")
            continue
        parts = {p["part"] for p in batch["parts"]}
        pairs = {f"{p['pair'][0]}|{p['pair'][1]}" for p in batch["pairs"]}
        seen_pairs, seen_form_of = set(), set()
        for link in out.get("links", []):
            subj, kind = str(link.get("subject", "")), link.get("kind")
            x, _, y = subj.partition("|")
            ok = len(x) == 1 and len(y) == 1 and x != y and kind in KINDS
            ok = ok and (subj in pairs or (x in parts and kind in ("form_of", "looks_like")))
            try:
                conf = float(link.get("confidence"))
            except (TypeError, ValueError):
                conf = -1
            note = (link.get("note") or "").strip()
            if not ok or not 0 <= conf <= 1 or (kind == "form_of" and not note):
                problems.append(f"{inp.stem} {subj} {kind}: invalid")
                continue
            if kind == "form_of":
                if x in seen_form_of:
                    problems.append(f"{inp.stem} {x}: two form_of")
                    continue
                seen_form_of.add(x)
            if subj in pairs:
                seen_pairs.add(subj)
            good.append({"subject": subj, "kind": kind, "note": note[:300] or None, "confidence": conf, "batch": inp.stem})
        for p in sorted(pairs - seen_pairs):
            problems.append(f"{inp.stem} {p}: pair not answered")
    return good, problems


def check(only: str | None = None) -> list[dict]:
    good, problems = read(only)
    print(f"{len(good)} links valid, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)
    print("by kind:", dict(Counter(l["kind"] for l in good)))
    return good


def load(dry_run: bool, review_dir: Path | None) -> None:
    good = check()
    keep = [l for l in good if l["kind"] != "none"]
    print(f"\nwould load {len(keep)} form_link proposals ({len(good) - len(keep)} 'none' dropped)")
    if dry_run:
        return
    from server import review

    if review_dir:
        review.use_dir(review_dir)
    for l in keep:
        review.add_item("form_link", l["subject"], {"kind": l["kind"], "note": l["note"]}, SOURCE,
                        reason=l["note"], evidence={"confidence": l["confidence"], "batch": l["batch"]},
                        priority=round(l["confidence"] * 3, 2))
    print("loaded:", review.counts()["items"].get("form_link"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    c = sub.add_parser("check")
    c.add_argument("--batch")
    l = sub.add_parser("load")
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--review-dir", type=Path)
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
