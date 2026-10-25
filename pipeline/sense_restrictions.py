"""Senses that JMdict keeps to some readings or spellings of a word (<stagr>, <stagk>) (2026-10-25).

    python pipeline/sense_restrictions.py export     # -> data/sense_restrictions.json
    python pipeline/sense_restrictions.py prepare    # data/drafts/register-claims/in/G-R00.json, a re-check

build_db reads every sense of an entry as a sense of its headword, so a sense
JMdict gives only for another reading shows as if read like the headword:
この間 (このあいだ) "meanwhile" is このかん, キッチン "chitin" is キチン, 平日 in
the radical sense is ひらび. The Bulgarian translators kept finding notes and
examples written for the headword's reading. The word page now marks such a
sense ("read このかん", "written 羽根"), and the notes and lines under these
senses are checked again with the restriction given (register_claims picks up
the verdicts of G-R00 like its other batches).

data/sense_restrictions.json: word id -> {sense index (among senses with a
gloss, as everywhere else) -> {"r": [readings], "k": [spellings]}}, only where
the headword's reading or spelling is not among them.
"""

from __future__ import annotations

import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import register_claims  # noqa: E402
import word_synonyms as ws  # noqa: E402

SITE = ROOT / "data" / "sense_restrictions.json"
NOTES = ROOT / "data" / "word_sense_notes.json"


def _restrictions() -> dict[int, dict[int, dict]]:
    raw = gzip.open(ROOT / "pipeline" / "data" / "JMdict_e.gz", "rt", encoding="utf-8").read()
    raw = re.sub(r"<!DOCTYPE[^\[]*\[.*?\]>", "", raw, flags=re.S)
    raw = re.sub(r"&([\w-]+);", r"\1", raw)
    out: dict[int, dict[int, dict]] = {}
    for entry in ET.fromstring(raw).iter("entry"):
        kebs = [k.findtext("keb") for k in entry.findall("k_ele")]
        rebs = [r.findtext("reb") for r in entry.findall("r_ele")]
        if not rebs:
            continue
        head_k, head_r = (kebs[0] if kebs else None), rebs[0]
        i = -1
        for s in entry.findall("sense"):
            if not [g for g in s.findall("gloss") if g.text]:
                continue
            i += 1
            r = [x.text for x in s.findall("stagr") if x.text]
            k = [x.text for x in s.findall("stagk") if x.text]
            if (r and head_r not in r) or (k and head_k not in k):
                out.setdefault(int(entry.findtext("ent_seq")), {})[i] = {**({"r": r} if r else {}), **({"k": k} if k else {})}
    return out


def export() -> None:
    data = _restrictions()
    ws._dump(SITE, {str(w): {str(i): v for i, v in d.items()} for w, d in sorted(data.items())})
    print(f"{sum(len(d) for d in data.values())} senses in {len(data)} words -> {SITE}")


def prepare() -> None:
    data = {int(w): {int(i): v for i, v in d.items()} for w, d in json.loads(SITE.read_text(encoding="utf-8")).items()}
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    items = []
    for w, senses in sorted(data.items()):
        if w not in ws.scope():
            continue
        for i, only in senses.items():
            n = (notes.get(str(w)) or [None] * (i + 1))[i] if i < len(notes.get(str(w)) or []) else None
            if n:
                items.append({"key": f"{w}|{i}|note", "where": "sense note", "text": n["nuance"], "restricted": only,
                              "about": {**register_claims._brief(w), "sense": i + 1}, **({"ex": n["ex"]} if n.get("ex") else {})})
        for r in site.get(str(w), []):
            if r[0] in senses and r[1] in ("syn", "mix") and len(r) > 5 and r[5]:
                items.append({"key": f"{w}|{r[2]}|r{len(items)}", "where": "synonym line" if r[1] == "syn" else "mixup line",
                              "text": r[5], "restricted": senses[r[0]],
                              "about": {**register_claims._brief(w), "sense": r[0] + 1},
                              "against": {**register_claims._brief(r[2]), "sense": r[3]}})
    path = register_claims.IN / "G-R00.json"
    ws._dump(path, {"batch": "G-R00", "items": items})
    print(f"{len(items)} texts under restricted senses -> {path}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    {"export": export, "prepare": prepare}[sys.argv[1]]()


if __name__ == "__main__":
    main()
