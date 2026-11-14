"""BKD's problems from the five-way blind check, verified with the web, then fixed (Dani, 2026-11-14).

    python pipeline/dict_blind_fix.py verify-prepare [--size 6]
    # one Sonnet subagent per verify/in/*.md, each reading pipeline/dict_blind_fix_prompt.md
    python pipeline/dict_blind_fix.py verify-report

Every error the graders gave BKD's entry (data/drafts/dict-blind/errors.json), grouped by
kanji. The verifier sees BKD's entry as the site shows it: each meaning with its id, every
word with the sense placed in that meaning (`senseAt`) and its full gloss, the catch-all
("used for its sound only"), and the readings line. The first run's entries showed each
word's first sense, cut at 70 characters; a claim that only held for that is an artifact.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import dict_blind as db  # noqa: E402
import kodansha_blind as kb  # noqa: E402

D = db.DRAFTS / "fix"
SEED = 20261115


def _w(w: dict, tag: str = "") -> str:
    g = db.shown_gloss(w) or ""
    star = "★ " if w.get("star") else ""
    return f"{star}{kb._w(w['headword'], w.get('reading'))}{tag} — {g}"


def entry(page: dict, on: list[str], kun: list[str]) -> str:
    lines = [f"Readings: on {', '.join(kb._kata(r) for r in on) or '—'} | kun {', '.join(kb._kun(r) for r in kun) or '—'}",
             "Meanings (id: label):"]
    for m in page["meanings"]:
        lines.append(f"  [{m['id']}] {m['en']}  ({m.get('total', '?')} common words in all)")
        kun_w = (m.get("kun") or {}).get("words") or []
        on_w = [w for o in m.get("on") or [] for w in o["words"]]
        for w in kun_w + on_w:
            lines.append(f"     - {_w(w)}")
        for a in m.get("also") or []:
            for w in a.get("words", [])[:1]:
                lines.append(f"     - {_w(w, ' [also listed here]')}")
        for w in m.get("exceptions") or []:
            lines.append(f"     - {_w(w, ' [special reading]')}")
    if page.get("soundOnly") and page["soundOnly"].get("words"):
        lines.append("  [catch-all] shown as 'the kanji is used for its sound only'")
        for w in page["soundOnly"]["words"]:
            lines.append(f"     - {_w(w)}")
    if page.get("special"):
        lines.append("  Special readings: " + ", ".join(_w(w) for w in page["special"]))
    return "\n".join(lines)


def verify_prepare(size: int) -> None:
    import sqlite3
    pages = json.loads((db.DRAFTS / "prod-pages.json").read_text(encoding="utf-8"))
    sql = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
    errs = [e for e in json.loads((db.DRAFTS / "errors.json").read_text(encoding="utf-8")) if e["who"] == "bkd"]
    by = defaultdict(list)
    for e in errs:
        by[e["char"]].append(e)
    chars = sorted(by)
    (D / "in").mkdir(parents=True, exist_ok=True)
    (D / "out").mkdir(parents=True, exist_ok=True)
    items = []
    for b in range(math.ceil(len(chars) / size)):
        chunk = chars[b * size:(b + 1) * size]
        parts = [f"# Verify batch fx-{b:02d}: {len(chunk)} kanji\n"]
        for c in chunk:
            on, kun = (json.loads(x or "[]") for x in sql.execute("SELECT on_yomi, kun_yomi FROM kanji WHERE char=?", (c,)).fetchone())
            claims = []
            for e in by[c]:
                cid = f"c{len(items):03d}"
                items.append({"id": cid, "char": c, **{k: e.get(k) for k in ("severity", "kind", "item", "what")}})
                claims.append(f"- {cid} ({e['severity']}, {e['kind']}, on {e.get('item')}): {e['what']}")
            parts.append(f"## {c}\n\n### The entry\n{entry(pages[c], on, kun)}\n\n### Claims\n" + "\n".join(claims) + "\n")
        (D / "in" / f"fx-{b:02d}.md").write_text("\n".join(parts), encoding="utf-8")
    (D / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} claims on {len(chars)} kanji, {math.ceil(len(chars) / size)} batches")


def verify_report() -> None:
    items = {i["id"]: i for i in json.loads((D / "items.json").read_text(encoding="utf-8"))}
    got = {}
    for f in sorted((D / "out").glob("fx-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["claims"]:
            got[r["id"]] = r
    missing = [i for i in items if i not in got]
    t = Counter()
    for i, it in items.items():
        r = got.get(i)
        if r:
            t[(it["severity"], r["verdict"])] += 1
    print(f"{len(got)}/{len(items)} verified; missing {' '.join(missing) or 'none'}")
    for k, v in sorted(t.items()):
        print(f"  {k[0]:5} {k[1]:9} {v}")
    fixes = [{**items[i], **got[i]} for i in items if i in got and got[i]["verdict"] == "confirmed" and got[i].get("fix")]
    (D / "confirmed.json").write_text(json.dumps(fixes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(fixes)} confirmed with a fix -> {D / 'confirmed.json'}")
    print(Counter(f["fix"]["type"] for f in fixes))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("verify-prepare")
    p.add_argument("--size", type=int, default=6)
    sub.add_parser("verify-report")
    a = ap.parse_args()
    {"verify-prepare": lambda: verify_prepare(a.size), "verify-report": verify_report}[a.cmd]()


if __name__ == "__main__":
    main()
