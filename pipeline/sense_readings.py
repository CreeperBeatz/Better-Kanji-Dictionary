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
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
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


def _fields(scope: dict) -> dict[int, dict[int, list[str]]]:
    """Word id -> sense index (among senses with a gloss) -> JMdict <field> tags (go, Buddh, med ...).
    build_db does not keep them, so the drafters never saw them (壁 "wall (of stones)" is a go term)."""
    raw = gzip.open(ROOT / "pipeline" / "data" / "JMdict_e.gz", "rt", encoding="utf-8").read()
    raw = re.sub(r"<!DOCTYPE[^\[]*\[.*?\]>", "", raw, flags=re.S)
    raw = re.sub(r"&([\w-]+);", r"\1", raw)
    out: dict[int, dict[int, list[str]]] = {}
    for entry in ET.fromstring(raw).iter("entry"):
        wid = int(entry.findtext("ent_seq"))
        if wid not in scope:
            continue
        i = -1
        for s in entry.findall("sense"):
            if not [g for g in s.findall("gloss") if g.text]:
                continue
            i += 1
            if f := [x.text for x in s.findall("field") if x.text]:
                out.setdefault(wid, {})[i] = f
    return out


def prepare(size: int) -> None:
    """Writes every batch with no answer yet; a batch already answered is kept as it is, if its keys still match."""
    register_claims.IN.mkdir(parents=True, exist_ok=True)
    register_claims.OUT.mkdir(parents=True, exist_ok=True)
    words, forms = ws.scope(), _forms()
    fields = _fields(words)
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    only = json.loads(ONLY.read_text(encoding="utf-8")) if ONLY.exists() else {}
    groups = []
    for wid in sorted(words, key=lambda w: (ws._rank(w), w)):
        w, ns = words[wid], notes.get(str(wid))
        if not ns or len(forms[wid]["readings"]) < 2 or len(w["senses"]) < 2:
            continue
        about = {"word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"], **forms[wid],
                 "senses": [f"{n}. [{pos}{'; ' + misc if misc else ''}]{''.join(f' {{{f}}}' for f in fields.get(wid, {}).get(n - 1, []))} {g}"
                            for n, (pos, misc, g) in enumerate(w["senses"], 1)]}
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
    kept, again = 0, []
    for b, items in enumerate(batches):
        name = f"{NAME}-{b:03d}"
        path = register_claims.IN / f"{name}.json"
        if (register_claims.OUT / path.name).exists():
            asked = ws._read(path)["items"]
            if [it["key"] for it in asked] != [it["key"] for it in items]:
                sys.exit(f"{name} is answered but would now hold other notes: pick a new NAME for a new run.")
            kept += 1
            # The two pilot batches were asked before the field tags were given: their tagged senses go again,
            # as that batch left them (the F batch sorts after it, so its verdict goes on top).
            good = register_claims.verdicts(name)[0]
            for old, new in zip(asked, items):
                n = new["about"]["sense"]
                if "{" in new["about"]["senses"][n - 1] and "{" not in old["about"]["senses"][n - 1]:
                    v = good.get(new["key"]) or {}
                    again.append({**new, **({"text": v["text"]} if "text" in v else {}),
                                  **({"ex": v["ex"]} if v.get("ex") else {})})
                    if "ex" in v and v["ex"] is None:
                        again[-1].pop("ex", None)
            continue
        data = {"batch": name, "task": "sense readings (D-042)", "items": items}
        if not path.exists() or ws._read(path) != data:  # an agent may be reading it
            ws._dump(path, data)
    print(f"{len(groups)} words, {sum(map(len, batches))} sense notes -> {NAME}-000..{len(batches) - 1:03d}"
          f" ({kept} answered batches kept as they were)")
    path = register_claims.IN / f"{NAME}-F00.json"
    if again and not (register_claims.OUT / path.name).exists():
        ws._dump(path, {"batch": path.stem, "task": "sense readings (D-042), senses with a field tag", "items": again})
        print(f"{len(again)} tagged senses of answered batches asked again -> {path.stem}")


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
