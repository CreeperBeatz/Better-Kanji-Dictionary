"""Wiktionary's Japanese senses for single kanji, for the meanings cards.

    python pipeline/wiktionary_kanji.py [--out data/drafts/wiktionary-kanji.json]

Reads the wiktextract dump (pipeline/data/raw-wiktextract-data.jsonl.gz,
fetch_sources.py "wiktionary", 2.9 GB, a few minutes) and keeps, for every
single-character headword in the Japanese section, each part of speech with
its glosses: the kanji entry ("character") and the one-kanji words (生 なま,
"raw"). English Wiktionary, CC BY-SA: shown to reviewers beside the other
dictionaries (server/books.py), never copied into the data.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMP = ROOT / "pipeline" / "data" / "raw-wiktextract-data.jsonl.gz"
OUT = ROOT / "data" / "drafts" / "wiktionary-kanji.json"


def is_kanji(w: str) -> bool:
    return len(w) == 1 and ("㐀" <= w <= "鿿" or "豈" <= w <= "﫿" or w >= "\U00020000")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    out_path = ap.parse_args().out

    out: dict[str, list[dict]] = {}
    with gzip.open(DUMP, "rt", encoding="utf-8") as f:
        for line in f:
            # Most lines are other languages: skip them before parsing.
            if '"lang": "Japanese"' not in line and '"lang":"Japanese"' not in line:
                continue
            e = json.loads(line)
            w = e.get("word") or ""
            if e.get("lang") != "Japanese" or not is_kanji(w):
                continue
            glosses = []
            for s in e.get("senses") or []:
                g = "; ".join(s.get("glosses") or [])
                if g and g not in glosses and "form of" not in (s.get("tags") or []):
                    glosses.append(g)
            if not glosses:
                continue
            readings = [f.get("form") for f in e.get("forms") or [] if f.get("form") and f.get("form") != w][:6]
            out.setdefault(w, []).append({"pos": e.get("pos"), "glosses": glosses[:12], "readings": readings})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(out)} kanji -> {out_path}")


if __name__ == "__main__":
    main()
