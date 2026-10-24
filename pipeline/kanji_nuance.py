"""Nuance lines for kanji of the same meaning, and notes for kanji easy to mix up (Dani, 2026-10-23).

    python pipeline/kanji_nuance.py prepare [--size 100]
    # one Opus subagent per data/drafts/kanji-nuance/in/*.json, each reading pipeline/kanji_nuance_prompt.md
    python pipeline/kanji_nuance.py check [--batch S-000]
    python pipeline/kanji_nuance.py verify-prepare # verify/in/KS-*.json, KM-*.json
    # one Opus subagent per verify/in/*.json, each reading pipeline/kanji_nuance_verify_prompt.md
    python pipeline/kanji_nuance.py verify-check [--batch KS-000]
    python pipeline/kanji_nuance.py merge          # -> data/drafts/kanji-nuance/nuances.json + data/kanji_nuances.json

Scope: jōyō kanji and kanji with a JLPT level.

`similar` (S-* batches): each meaning group's kanji of the same meaning (生 health -> 康 健)
gets a `nuance`, one line on how the other kanji differs from this one in that
meaning, shown beside it on this kanji's page. Keyed "char|group id|other".

`mixup` (M-* batches): kanji easy to mix up on a shared kun reading that no usage
card (Bunkacho's 異字同訓) explains get a `note`: when to write which. One per
pair and reading, shown on both kanji's pages. Keyed "a|b|reading", a < b.

Both have English and Bulgarian. Drafts only: nothing here touches the review store.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import review  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "kanji-nuance"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
VIN, VOUT = DRAFTS / "verify" / "in", DRAFTS / "verify" / "out"
DB = ROOT / "data" / "betterrtk.sqlite"
NUANCE = 160  # characters
_PLAIN = {"the", "and", "for", "with", "something", "someone", "one", "its", "that", "this", "from", "into"}


def _db() -> sqlite3.Connection:
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def _scope(db) -> list[str]:
    return [r[0] for r in db.execute("SELECT char FROM kanji WHERE joyo = 1 OR jlpt IS NOT NULL ORDER BY freq IS NULL, freq, char")]


def _words(db, ids: list[int], n: int = 3) -> list[str]:
    """'食べる たべる: to eat' for the first `n` words."""
    out = []
    for wid in ids[:n]:
        w = db.execute("SELECT headword, reading FROM word WHERE id = ?", (wid,)).fetchone()
        g = db.execute("SELECT gloss FROM sense WHERE word_id = ? ORDER BY ord LIMIT 1", (wid,)).fetchone()
        if w:
            out.append(f"{w['headword']} {w['reading']}: {(g['gloss'] if g else '')[:60]}")
    return out


def _wording(g: dict) -> set[str]:
    return set(re.findall(r"[a-z]{3,}", f"{g.get('en') or ''} {g.get('about') or ''}".lower())) - _PLAIN


def _groups(c: str) -> list[dict]:
    return [g for g in review.site_meanings(c)["senses"] or [] if g["id"] != review.CATCH_ALL]


def _match(o: str, char: str, here: dict) -> dict | None:
    """Which of `o`'s meanings is the one close to `here`: the group naming `char` back, else the worded most alike."""
    gs = _groups(o)
    return next((g for g in gs if char in (g.get("similar") or [])), None) or max(
        gs, key=lambda g: len(_wording(g) & _wording(here)), default=None)


def _reading_words(db, c: str, reading: str, n: int = 3) -> list[str]:
    """Common words where `c` is read `reading` (okurigana words: 降る for ふる)."""
    kana = reading.rstrip("¹²³⁴⁵⁶⁷⁸⁹")
    sql = ("SELECT w.id, w.headword FROM word_reading r JOIN word w ON w.id = r.word_id WHERE r.char = ? AND r.main = 1"
           " AND (replace(r.reading, '.', '') = ? OR r.whole = ?) {} ORDER BY w.common DESC, w.nf IS NULL, w.nf, length(w.headword) LIMIT 12")
    rows = (db.execute(sql.format("AND (w.common = 1 OR w.nf IS NOT NULL)"), (c, kana, kana)).fetchall()
            or db.execute(sql.format(""), (c, kana, kana)).fetchall())  # a rare kanji: whatever words it has
    ids = list({r["headword"]: r["id"] for r in reversed(rows)}.values())[::-1]  # one per spelling, best first
    return _words(db, ids, n)


def _brief(g: dict | None) -> str | None:
    return g and f"{g['en']}" + (f" ({g['about']})" if g.get("about") else "")


def prepare(size: int) -> None:
    db = _db()
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    similar, mixups, seen = [], [], set()
    for c in _scope(db):
        site = review.site_meanings(c)
        for g in _groups(c):
            for o in g.get("similar") or []:
                og = _match(o, c, g)
                similar.append({
                    "key": f"{c}|{g['id']}|{o}", "kanji": c, "meaning": _brief(g), "words": _words(db, g.get("examples") or []),
                    "other": o, "otherMeaning": _brief(og), "otherWords": _words(db, (og or {}).get("examples") or []),
                })
        cards = review.site_usage(c)
        for m in (site.get("extras") or {}).get("mixups") or []:
            o, r = m["char"], m["reading"]
            covered = any(r.rstrip("¹²³⁴⁵⁶⁷⁸⁹") in card["reading"].split("・")
                          and o in "".join(s["kanji"] for s in card["spellings"]) for card in cards)
            a, b = sorted((c, o))
            key = f"{a}|{b}|{r}"
            if covered or key in seen:
                continue
            seen.add(key)
            mixups.append({
                "key": key, "reading": r,
                "a": a, "aMeanings": [g["en"] for g in _groups(a)], "aWords": _reading_words(db, a, r),
                "b": b, "bMeanings": [g["en"] for g in _groups(b)], "bWords": _reading_words(db, b, r),
            })
    for kind, items in (("S", similar), ("M", mixups)):
        for i in range(0, len(items), size):
            n = i // size
            (IN / f"{kind}-{n:03d}.json").write_text(json.dumps(
                {"batch": f"{kind}-{n:03d}", "kind": "similar" if kind == "S" else "mixup", "items": items[i:i + size]},
                ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(similar)} similar pairs, {len(mixups)} mix-ups without a usage card; batches of {size} in {IN}")


def _problems(batch: str) -> tuple[dict, list[str]]:
    src = json.loads((IN / f"{batch}.json").read_text(encoding="utf-8"))
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {}, [f"{batch}: not JSON ({e})"]
    items = got.get("items") if isinstance(got, dict) else None
    if not isinstance(items, dict):
        return {}, [f"{batch}: no `items` object"]
    keys = {it["key"] for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in keys - items.keys()] + [f"{batch}: unknown {k}" for k in items.keys() - keys]
    good = {}
    for k, v in items.items():
        if k not in keys:
            continue
        if not isinstance(v, dict) or not all(isinstance(v.get(f), str) and v[f].strip() for f in ("en", "bg")):
            probs.append(f"{batch}: {k} needs `en` and `bg`")
            continue
        limit = NUANCE if src["kind"] == "similar" else 2 * NUANCE
        if len(v["en"]) > limit or len(v["bg"]) > limit + 60:
            probs.append(f"{batch}: {k} too long ({len(v['en'])} chars English)")
        if "кандзи" in v["bg"].lower():
            probs.append(f"{batch}: {k}: Bulgarian writes канджи, never кандзи")
        if re.search(r"\b(synonym of|similar to)\b", v["en"], re.I):
            probs.append(f"{batch}: {k}: say the difference, not 'similar to'")
        good[k] = {"en": v["en"].strip(), "bg": v["bg"].strip(), **({"mismatch": True} if v.get("mismatch") is True else {})}
    return good, probs


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    total = 0
    for b in batches:
        good, probs = _problems(b)
        total += len(good)
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{total} valid items in {len(batches)} batches")


def _drafts() -> dict:
    out = {"similar": {}, "mixup": {}}
    for p in sorted(IN.glob("*.json")):
        good, probs = _problems(p.stem)
        if probs:
            print(f"{p.stem}: skipped, {len(probs)} problems")
            continue
        out["similar" if p.stem.startswith("S") else "mixup"].update(good)
    return out


def verify_prepare(size: int) -> None:
    """Every drafted line, with what it was drafted from, to an Opus check (KS-*, KM-*)."""
    VIN.mkdir(parents=True, exist_ok=True)
    VOUT.mkdir(parents=True, exist_ok=True)
    lines = _drafts()
    for kind, pre in (("similar", "S"), ("mixup", "M")):
        items = [{**it, "line": {"en": v["en"], "bg": v["bg"]}, **({"mismatch": True} if v.get("mismatch") else {})}
                 for p in sorted(IN.glob(f"{pre}-*.json")) for it in json.loads(p.read_text(encoding="utf-8"))["items"]
                 if (v := lines[kind].get(it["key"]))]
        for i in range(0, len(items), size):
            name = f"K{pre}-{i // size:03d}"
            (VIN / f"{name}.json").write_text(json.dumps({"batch": name, "kind": kind, "items": items[i:i + size]},
                                                         ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{kind}: {len(items)} lines, {-(-len(items) // size)} batches")


def _verdicts(batch: str) -> tuple[dict, list[str]]:
    """{key: None (ok) | {en?, bg?, mismatch?, why}} for one check batch."""
    src = json.loads((VIN / f"{batch}.json").read_text(encoding="utf-8"))
    path = VOUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {}, [f"{batch}: not JSON ({e})"]
    items = got.get("items") if isinstance(got, dict) else None
    if not isinstance(items, dict):
        return {}, [f"{batch}: no `items` object"]
    keys = {it["key"] for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in keys - items.keys()] + [f"{batch}: unknown {k}" for k in items.keys() - keys]
    fields = {"en", "bg", "mismatch"} if src["kind"] == "similar" else {"en", "bg"}
    limit = NUANCE if src["kind"] == "similar" else 2 * NUANCE
    good = {}
    for k, v in items.items():
        if k not in keys:
            continue
        if v == "ok":
            good[k] = None
            continue
        if not isinstance(v, dict) or not isinstance(v.get("why"), str) or not v["why"].strip() \
                or not (fields & v.keys()) or v.keys() - fields - {"why"}:
            probs.append(f"{batch}: {k}: \"ok\", or {{the fields that change ({', '.join(sorted(fields))}), why}}")
            continue
        if any(not isinstance(v[f], str) or not v[f].strip() for f in ("en", "bg") if f in v):
            probs.append(f"{batch}: {k}: en and bg are text")
        elif "mismatch" in v and not isinstance(v["mismatch"], bool):
            probs.append(f"{batch}: {k}: mismatch is true or false")
        elif len(v.get("en", "")) > limit or len(v.get("bg", "")) > limit + 60:
            probs.append(f"{batch}: {k}: too long")
        elif "кандзи" in v.get("bg", "").lower():
            probs.append(f"{batch}: {k}: Bulgarian writes канджи, never кандзи")
        elif re.search(r"\b(synonym of|similar to)\b", v.get("en", ""), re.I):
            probs.append(f"{batch}: {k}: say the difference, not 'similar to'")
        else:
            good[k] = {f: v[f].strip() if isinstance(v[f], str) else v[f] for f in v}
    return good, probs


def verify_check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in VIN.glob("*.json"))
    total, done = 0, 0
    for b in batches:
        good, probs = _verdicts(b)
        total += len(good)
        done += not probs
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{total} valid items; {done} of {len(batches)} batches complete")


def merge() -> None:
    """The drafts with the check's fixes -> nuances.json, and the copy the site reads (keeping its `self`)."""
    out = _drafts()
    fixed = {}
    for p in sorted(VIN.glob("*.json")):
        good, probs = _verdicts(p.stem)
        if probs:
            print(f"{p.stem}: {len(probs)} problems in the check, {len(good)} taken")
        kind = "similar" if p.stem.startswith("KS") else "mixup"
        for k, v in good.items():
            fixed["checked"] = fixed.get("checked", 0) + 1
            if v:
                line = {**out[kind][k], **{f: v[f] for f in ("en", "bg", "mismatch") if f in v}}
                if not line.get("mismatch"):
                    line.pop("mismatch", None)
                out[kind][k] = line
                for f in ("en", "bg", "mismatch"):
                    fixed[f] = fixed.get(f, 0) + (f in v)
    (DRAFTS / "nuances.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    site = ROOT / "data" / "kanji_nuances.json"
    if site.exists():
        out = {**json.loads(site.read_text(encoding="utf-8")), **out}
    site.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    mism = sum(1 for v in out["similar"].values() if v.get("mismatch"))
    print(f"{len(out['similar'])} nuances ({mism} pairs listed by mistake), {len(out['mixup'])} mix-up notes "
          f"-> {DRAFTS / 'nuances.json'}, {site}" + (f"; check: {fixed}" if fixed else ""))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=100)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    p = sub.add_parser("verify-prepare")
    p.add_argument("--size", type=int, default=100)
    p = sub.add_parser("verify-check")
    p.add_argument("--batch")
    sub.add_parser("merge")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.size)
    elif a.cmd == "check":
        check(a.batch)
    elif a.cmd == "verify-prepare":
        verify_prepare(a.size)
    elif a.cmd == "verify-check":
        verify_check(a.batch)
    else:
        merge()


if __name__ == "__main__":
    main()
