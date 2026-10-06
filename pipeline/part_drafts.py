"""Draft what each part with no meaning is, with Claude Code subagents, then queue it (D-015).

    python pipeline/part_drafts.py prepare
    # one Sonnet subagent per data/drafts/parts/in/*.json, following pipeline/part_prompt.md
    python pipeline/part_drafts.py check [--batch P-000]
    python pipeline/part_drafts.py load [--dry-run] [--review-dir DIR]

The parts: every character inside a kanji in scope (server/scope.py) whose
page would say "no recorded meaning" -- no KANJIDIC meaning, no Kanji Alive
line, nothing borrowed through an accepted form_of, no reviewed part meaning
-- and that has no part_meaning item yet. The subagent sorts each into one
of three, and the loader queues it where it is decided:

- **form_of**: the part is one kanji, written differently for its place, in
  nearly all its kanji (𠂇 is 又). A `form_link` proposal; it lends that kanji's meaning.
- **meaning**: a real character with a meaning of its own where it is used
  (夋, 劦). A `part_meaning` proposal of kind meaning.
- **shape**: several unrelated old parts merged into it (丷 is 八 in 半,
  grains in 米, hair in 首). A `part_meaning` proposal of kind shape: a
  name for the shape, and a note saying what it comes from in which kanji.

The form links already proposed for a part are shown to the subagent, which
says of each whether it holds; a "reject" is kept on the part's item as
evidence for the reviewer, never acted on.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
import review_sources as rs  # noqa: E402
from proposals import ROOT, SOURCE, review  # noqa: E402

from server import forms  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "parts")
PER_BATCH = 10
UNIHAN = ROOT / "pipeline" / "data" / "Unihan.zip"
VARIANT_FIELDS = ("kTraditionalVariant", "kSemanticVariant", "kZVariant", "kSpecializedSemanticVariant", "kCompatibilityVariant")


def unihan() -> tuple[dict[str, str], dict[str, list[tuple[str, str]]]]:
    """kDefinition per character, and its variants with the field that links them."""
    defs: dict[str, str] = {}
    variants: dict[str, list[tuple[str, str]]] = defaultdict(list)
    with zipfile.ZipFile(UNIHAN) as z:
        for name in z.namelist():
            if "Readings" not in name and "Variants" not in name:
                continue
            for line in z.read(name).decode("utf-8").splitlines():
                if line.startswith("#") or not line.strip():
                    continue
                cp, field, value = line.split("\t", 2)
                ch = chr(int(cp[2:], 16))
                if field == "kDefinition":
                    defs[ch] = value
                elif field in VARIANT_FIELDS:
                    for v in value.split():
                        other = chr(int(v.split("<")[0][2:], 16))
                        if other != ch:
                            variants[ch].append((field[1:], other))
    return defs, variants


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def unexplained() -> list[str]:
    """The parts in scope a page would show with no meaning, most used first."""
    db = proposals.connect()
    children, _ = rs.graph(db)
    parents: dict[str, set[str]] = defaultdict(set)
    for p, cs in children.items():
        for c in cs:
            parents[c].add(p)
    users = {c: review.users_of(c) for c in parents}
    data = review._read()
    asked = review.subjects("part_meaning", data)
    out = []
    for c, u in users.items():
        if not u or c in asked:
            continue
        f = forms.forms_of(c)
        if f["meaning"] or f["part"]:
            continue
        own = forms._nodes([c]).get(c)
        if own and own["meanings"]:
            continue
        out.append(c)
    return sorted(out, key=lambda c: (-len(users[c]), c))


def prepare() -> None:
    db = proposals.connect()
    children, _ = rs.graph(db)
    parents: dict[str, set[str]] = defaultdict(set)
    for p, cs in children.items():
        for c in cs:
            parents[c].add(p)
    meanings = {c: json.loads(m or "[]") for c, m in db.execute("SELECT char, meanings FROM kanji")}
    old = {a: b for a, b in db.execute("SELECT char, other FROM char_form WHERE kind = 'old'")}
    freq = {c: f or 9999 for c, f in db.execute("SELECT char, freq FROM kanji")}
    ids = rs.babelstone()
    defs, variants = unihan()
    data = review._read()
    open_forms: dict[str, list[dict]] = defaultdict(list)
    for i in data["items"].values():
        if i["type"] == "form_link" and i["status"] == "open":
            for c in set(i["subject"].split("|")):
                open_forms[c].append({"subject": i["subject"], **i["proposed"]})

    parts = []
    for c in unexplained():
        users = review.users_of(c)
        in_scope = set(users)
        direct = sorted(parents[c], key=lambda k: (k not in in_scope, freq.get(k, 9999), k))[:14]
        parts.append({
            "part": c,
            "inScope": len(users),
            "examples": users[:12],
            "kanjidic": meanings.get(c, []),
            "unihan": defs.get(c),
            "variants": [{"field": f, "char": o, "meanings": meanings.get(o, [])[:3]} for f, o in variants.get(c, [])][:6],
            "directIn": [
                {"kanji": k, "inScope": k in in_scope, "ids": ids.get(k), "old": old.get(k),
                 "oldIds": ids.get(old[k]) if k in old else None, "meanings": meanings.get(k, [])[:3]}
                for k in direct
            ],
            "openFormLinks": open_forms.get(c, []),
        })
    for i in range(0, len(parts), PER_BATCH):
        n = i // PER_BATCH
        _write(IN / f"P-{n:03d}.json", {"batch": f"P-{n:03d}", "parts": parts[i:i + PER_BATCH]})
    print(f"{len(parts)} parts in {-(-len(parts) // PER_BATCH)} batches -> {IN.relative_to(ROOT)}")


KINDS = ("form_of", "meaning", "shape")


def read(only: str | None = None) -> tuple[list[dict], list[str]]:
    good, problems = [], []
    for inp, batch, out in proposals.outputs(IN, OUT, f"{only or 'P-*'}.json", problems):
        asked = {p["part"]: p for p in batch["parts"]}
        seen = set()
        for d in out.get("parts", []):
            part, kind = str(d.get("part", "")), d.get("kind")
            where = f"{inp.stem} {part}"
            if part not in asked or part in seen:
                problems.append(f"{where}: not asked, or twice")
                continue
            try:
                conf = float(d.get("confidence"))
            except (TypeError, ValueError):
                conf = -1
            if kind not in KINDS or not 0 <= conf <= 1:
                problems.append(f"{where}: bad kind or confidence")
                continue
            verdicts = d.get("openFormLinks") or {}
            known = {f["subject"] for f in asked[part]["openFormLinks"]}
            if not isinstance(verdicts, dict) or set(verdicts) - known or set(verdicts.values()) - {"keep", "reject"}:
                problems.append(f"{where}: openFormLinks must map each listed subject to keep or reject")
                continue
            row = {"part": part, "kind": kind, "confidence": conf, "batch": inp.stem, "verdicts": verdicts,
                   "inScope": asked[part]["inScope"], "unihan": asked[part]["unihan"]}
            if kind == "form_of":
                to, note = str(d.get("formOf") or ""), (d.get("evidence") or "").strip()
                if len(to) != 1 or to == part or not note:
                    problems.append(f"{where}: form_of needs formOf and evidence")
                    continue
                row |= {"formOf": to, "evidence": note[:300]}
            else:
                value = {k: d.get(k) for k in ("en", "bg", "note", "noteBg")}
                try:
                    row["value"] = review.validate("part_meaning", part, {"kind": kind, **value})
                except Exception as e:  # noqa: BLE001 -- reported, not raised
                    problems.append(f"{where}: {e}")
                    continue
            seen.add(part)
            good.append(row)
        for p in sorted(set(asked) - seen):
            problems.append(f"{inp.stem} {p}: not answered")
    return good, problems


def check(only: str | None = None) -> list[dict]:
    good, problems = read(only)
    print(f"{len(good)} parts valid, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)
    print("by kind:", dict(Counter(g["kind"] for g in good)))
    rejects = sum(1 for g in good for v in g["verdicts"].values() if v == "reject")
    print(f"open form links judged wrong: {rejects}")
    return good


def load(dry_run: bool, review_dir: Path | None) -> None:
    good = check()
    proposals.use_review_dir(review_dir)
    data = review._read()
    form_of_open = {i["subject"] for i in data["items"].values()
                    if i["type"] == "form_link" and i["status"] == "open" and (i["proposed"] or {}).get("kind") == "form_of"}
    rows = []
    for g in good:
        # Most used first, within the stage: 丷 (in 243 kanji) before 㒸 (3).
        priority = round(min(g["inScope"], 300) / 100, 2)
        evidence = {"confidence": g["confidence"], "batch": g["batch"], "inScope": g["inScope"]}
        if g["kind"] == "form_of":
            subject = f"{g['part']}|{g['formOf']}"
            if subject in form_of_open:
                continue  # proposed already, and the draft agrees
            rows.append({"type": "form_link", "subject": subject, "proposed": {"kind": "form_of", "note": g["evidence"]},
                         "source": SOURCE, "reason": g["evidence"], "evidence": evidence, "priority": priority})
        else:
            if g["unihan"]:
                evidence["unihan"] = g["unihan"]
            if g["verdicts"]:
                evidence["formLinks"] = g["verdicts"]
            rows.append({"type": "part_meaning", "subject": g["part"], "proposed": g["value"], "source": SOURCE,
                         "reason": g["value"]["note"], "evidence": evidence, "priority": priority})
    print(f"\nwould load {sum(r['type'] == 'part_meaning' for r in rows)} part meanings, "
          f"{sum(r['type'] == 'form_link' for r in rows)} form links")
    if dry_run:
        return
    added, refused = review.add_items(rows)
    print(f"added {added}, refused {refused}")


def main() -> int:
    global DRAFTS, IN, OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    proposals.drafts_arg(ap, "data/drafts/parts")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    c = sub.add_parser("check")
    c.add_argument("--batch")
    proposals.load_parser(sub, "load")
    args = ap.parse_args()
    DRAFTS, IN, OUT = proposals.folders(args.drafts or DRAFTS)
    if args.cmd == "prepare":
        prepare()
    elif args.cmd == "check":
        check(args.batch)
    else:
        load(args.dry_run, args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
