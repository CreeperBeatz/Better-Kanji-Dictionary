"""The other half of a synonym's nuance: how the page's own word or kanji differs (Dani, 2026-10-24).

    python pipeline/self_nuance.py prepare [--size 250]
    # one Sonnet subagent per data/drafts/self-nuance/in/*.json, each reading pipeline/self_nuance_prompt.md
    python pipeline/self_nuance.py check [--batch W-000]
    python pipeline/self_nuance.py merge     # -> data/drafts/self-nuance/self.json

A synonym row says how the other word differs from this one (引っ張る beside 引く:
"More forceful."). Its own side, how 引く differs from 引っ張る, is the line on
引っ張る's page about 引く, where that pair was drafted; most were not (the
other word outside the JLPT run, or not chosen there). This drafts the rest, each
as the counterpart of the line already checked.

W-* batches: words, keyed as the forward row "word:sense:other:other sense"
(senses from 0), English. K-* batches: kanji, keyed as kanji_nuances "kanji|meaning
id|other", English and Bulgarian. Drafts only: `export` (word_synonyms.py) and
data/kanji_nuances.json take them in.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "self-nuance"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
LINE = 160  # characters


def _gloss(wid: int, n: int) -> str:
    s = ws.scope()[wid]["senses"]
    return ws._short(s[n][2], 100) if n < len(s) else ""


def word_items() -> list[dict]:
    """Every synonym row in data/word_synonyms.json whose reverse row (same senses) has no line."""
    rows = json.loads((ROOT / "data" / "word_synonyms.json").read_text(encoding="utf-8"))
    fwd = {(int(w), i, o, n - 1): line for w, rs in rows.items() for i, k, o, n, line, *_ in rs if k == "syn"}
    sc = ws.scope()
    return [{
        "key": f"{w}:{i}:{o}:{n}",
        "word": f"{sc[w]['word']} {sc[w]['reading']}: {_gloss(w, i)}",
        "other": f"{sc[o]['word']} {sc[o]['reading']}: {_gloss(o, n)}",
        "otherLine": line,
    } for (w, i, o, n), line in sorted(fwd.items()) if not fwd.get((o, n, w, i))]


def kanji_items() -> list[dict]:
    """Every kanji nuance whose reverse (the other kanji's meaning that lists this one) has none."""
    src = {it["key"]: it for f in sorted((ROOT / "data" / "drafts" / "kanji-nuance" / "in").glob("S-*.json"))
           for it in json.loads(f.read_text(encoding="utf-8"))["items"]}
    lines = json.loads((ROOT / "data" / "kanji_nuances.json").read_text(encoding="utf-8"))["similar"]
    by_pair = {(k.split("|")[0], k.split("|")[2]) for k in lines}
    return [{
        "key": key, "kanji": it["kanji"], "meaning": it["meaning"], "words": it["words"],
        "other": it["other"], "otherMeaning": it["otherMeaning"], "otherWords": it["otherWords"], "otherLine": v["en"],
    } for key, v in sorted(lines.items()) if (it := src.get(key)) and (it["other"], it["kanji"]) not in by_pair]


def prepare(size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for kind, items in (("W", word_items()), ("K", kanji_items())):
        for i in range(0, len(items), size):
            name = f"{kind}-{i // size:03d}"
            ws._dump(IN / f"{name}.json", {"batch": name, "kind": "word" if kind == "W" else "kanji", "items": items[i:i + size]})
        print(f"{kind}: {len(items)} lines to draft, {-(-len(items) // size)} batches")


def _problems(batch: str) -> tuple[dict, list[str]]:
    src = ws._read(IN / f"{batch}.json")
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = ws._read(path)
    except json.JSONDecodeError as e:
        return {}, [f"{batch}: not JSON ({e})"]
    items = got.get("items") if isinstance(got, dict) else None
    if not isinstance(items, dict):
        return {}, [f"{batch}: no `items` object"]
    keys = {it["key"] for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in sorted(keys - items.keys())][:20] + [f"{batch}: unknown {k}" for k in items.keys() - keys]
    fields = ("en", "bg") if src["kind"] == "kanji" else ("en",)
    good = {}
    for k, v in items.items():
        if k not in keys:
            continue
        if not isinstance(v, dict) or not all(isinstance(v.get(f), str) and v[f].strip() for f in fields):
            probs.append(f"{batch}: {k} needs {' and '.join(fields)}")
        elif len(v["en"]) > LINE or len(v.get("bg") or "") > LINE + 60:
            probs.append(f"{batch}: {k} too long ({len(v['en'])} characters English, at most {LINE})")
        elif "кандзи" in (v.get("bg") or "").lower():
            probs.append(f"{batch}: {k}: Bulgarian writes канджи, never кандзи")
        elif re.search(r"\b(synonym of|similar to)\b", v["en"], re.I):
            probs.append(f"{batch}: {k}: say the difference, not 'similar to'")
        else:
            good[k] = {f: v[f].strip() for f in fields}
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
        print(f"{total} valid lines in {len(batches)} batches")


def merge() -> None:
    out = {"word": {}, "kanji": {}}
    for p in sorted(IN.glob("*.json")):
        good, probs = _problems(p.stem)
        if probs:
            print(f"{p.stem}: skipped, {len(probs)} problems")
            continue
        out["word" if p.stem.startswith("W") else "kanji"].update(good)
    ws._dump(DRAFTS / "self.json", out)
    print(f"{len(out['word'])} word lines, {len(out['kanji'])} kanji lines -> {DRAFTS / 'self.json'}")
    # What the site reads: the kanji nuances with these beside them (the word ones go in by word_synonyms.py export).
    site = ROOT / "data" / "kanji_nuances.json"
    data = json.loads((ROOT / "data" / "drafts" / "kanji-nuance" / "nuances.json").read_text(encoding="utf-8"))
    data["self"] = out["kanji"]
    site.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {site}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=250)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("merge")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.size)
    elif a.cmd == "check":
        check(a.batch)
    else:
        merge()


if __name__ == "__main__":
    main()
