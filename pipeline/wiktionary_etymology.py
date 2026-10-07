"""Wiktionary's glyph origin of each kanji, for the meaning drafts' etymology.

    python pipeline/wiktionary_etymology.py [--out data/drafts/wiktionary-etymology.json]

From the wiktextract dump (as wiktionary_kanji.py): the etymology of each
single-character "Chinese character" entry -- the glyph origin, with its
sources (Shuowen, Zhang 2022, ...). It is what the drafting agents summarise
for learners; they are told to write nothing that is not in it. English
Wiktionary, CC BY-SA.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from wiktionary_kanji import DUMP, ROOT, is_kanji

OUT = ROOT / "data" / "drafts" / "wiktionary-etymology.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    out_path = ap.parse_args().out
    out: dict[str, list[str]] = {}
    with gzip.open(DUMP, "rt", encoding="utf-8") as f:
        for line in f:
            if '"lang": "Chinese"' not in line or '"etymology_text"' not in line:
                continue
            e = json.loads(line)
            w = e.get("word") or ""
            text = (e.get("etymology_text") or "").strip()
            if e.get("lang") != "Chinese" or e.get("pos") != "character" or not is_kanji(w) or not text:
                continue
            # A character has an entry per etymology; the glyph origin is told once per distinct text.
            if text not in out.setdefault(w, []):
                out[w].append(text)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(out)} kanji -> {out_path}")


if __name__ == "__main__":
    main()
