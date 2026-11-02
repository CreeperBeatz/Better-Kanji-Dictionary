"""D-042: senses that belong to another reading than the page shows (Dani, 2026-11-02).

    python pipeline/sense_readings.py prepare [--size 250]   # data/drafts/register-claims/in/G-Y42-*.json
    # one Opus subagent per batch, each reading pipeline/sense_readings_prompt.md
    python pipeline/register_claims.py check [--batch G-Y42-000]
    python pipeline/sense_notes.py merge                     # applies the fixes (register_claims.fixes)

One JMdict entry holds several readings, and most senses carry no tag saying
which reading they go with. The page heads the entry with one reading, and
the notes were written for it: 紅 くれない got the lipstick sense (read べに),
十八番 おはこ "No. 18" (じゅうはちばん), 半月 はんげつ "half a month" (はんつき). The
Bulgarian translators of round 9 flagged 59 such notes (fixed in G-X09); the
other notes on words with two or more readings and two or more senses were
never asked. This asks each of them once: which reading the sense goes with,
and whether the note and its example say so.

The batches use register_claims's format (`where` "sense note", verdict
"ok" or {text?, ex?, why}) and sit in its folder, so `sense_notes.py merge`
applies them like its other fixes. G-Y42 sorts after G-X09, so these go on
top of the round-9 fixes; the text asked about is the note as the site has it
now. A later batch on the same notes must sort after G-Y42.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import proposals  # noqa: E402
import register_claims  # noqa: E402
import word_synonyms as ws  # noqa: E402

NOTES = ROOT / "data" / "word_sense_notes.json"
ONLY = ROOT / "data" / "sense_restrictions.json"
NAME = "G-Y42"


def _forms() -> dict[int, dict[str, list[str]]]:
    """Word id -> its readings and spellings in JMdict order, a rare one marked "(rare)"."""
    out: dict[int, dict[str, list[str]]] = defaultdict(lambda: {"readings": [], "spellings": []})
    for wid, text, kana, rare in proposals.connect().execute(
            "SELECT word_id, text, kana, rare FROM word_form ORDER BY word_id, kana, ord"):
        out[wid]["readings" if kana else "spellings"].append(text + (" (rare)" if rare else ""))
    return out


def prepare(size: int) -> None:
    register_claims.IN.mkdir(parents=True, exist_ok=True)
    register_claims.OUT.mkdir(parents=True, exist_ok=True)
    if any(register_claims.IN.glob(f"{NAME}-*.json")):
        sys.exit(f"{NAME} batches exist already: their outputs would no longer match. Finish them, or pick a new name.")
    words, forms = ws.scope(), _forms()
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    only = json.loads(ONLY.read_text(encoding="utf-8")) if ONLY.exists() else {}
    groups = []
    for wid in sorted(words, key=lambda w: (ws._rank(w), w)):
        w, ns = words[wid], notes.get(str(wid))
        if not ns or len(forms[wid]["readings"]) < 2 or len(w["senses"]) < 2:
            continue
        about = {"word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"], **forms[wid],
                 "senses": [f"{n}. [{pos}{'; ' + misc if misc else ''}] {g}" for n, (pos, misc, g) in enumerate(w["senses"], 1)]}
        if str(wid) in only:
            about["jmdictOnly"] = {str(int(i) + 1): v for i, v in only[str(wid)].items()}
        groups.append([{"key": f"{wid}|{i}|note", "where": "sense note", "text": n["nuance"],
                        "about": {**about, "sense": i + 1}, **({"ex": n["ex"]} if n.get("ex") else {})}
                       for i, n in enumerate(ns) if n])
    batches, cur = [], []
    for g in groups:  # a word's senses stay in one batch
        if cur and len(cur) + len(g) > size:
            batches.append(cur)
            cur = []
        cur += g
    if cur:
        batches.append(cur)
    for b, items in enumerate(batches):
        name = f"{NAME}-{b:03d}"
        ws._dump(register_claims.IN / f"{name}.json", {"batch": name, "task": "sense readings (D-042)", "items": items})
    print(f"{len(groups)} words, {sum(map(len, batches))} sense notes -> {NAME}-000..{len(batches) - 1:03d}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--size", type=int, default=250)
    a = ap.parse_args()
    prepare(a.size)


if __name__ == "__main__":
    main()
