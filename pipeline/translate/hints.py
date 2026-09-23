"""Human-made Bulgarian candidates for Japanese words, as hints for the translators.

    python pipeline/translate/hints.py      # -> pipeline/data/bg_hints.json

Two sources, both keyed by a Japanese written form:

  wiktionary  English Wiktionary's translation tables. An English sense that
              lists both a Japanese and a Bulgarian translation pairs them,
              labelled with the English word and sense it came through.
              Needs `python pipeline/fetch_sources.py wiktionary` (2.9 GB).
  wordnet     The Japanese WordNet and the BulTreeBank wordnet, joined on
              their shared Princeton synset ids. Needs omw-bul and omw-jpn.

Pivoting through English is lossy -- a group holds every Japanese synonym and
every Bulgarian one -- so these are hints an agent may use, never glosses.
A missing source is skipped: fewer hints, nothing breaks.
"""

from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
OUT = DATA / "bg_hints.json"

STRESS = str.maketrans("", "", "\u0300\u0301")


def clean_bg(w: str) -> str:
    return w.translate(STRESS).strip()


def wiktionary() -> dict[str, list]:
    path = DATA / "raw-wiktextract-data.jsonl.gz"
    if not path.exists():
        print(f"  wiktionary: {path.name} missing, skipped")
        return {}
    groups: dict[tuple, dict] = defaultdict(lambda: {"ja": set(), "bg": set()})
    lines = 0
    with gzip.open(path, "rb") as f:
        for line in f:
            lines += 1
            # Parsing 1.5 million entries is the slow part; most carry neither language.
            if b'"bg"' not in line or b'"ja"' not in line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("lang_code") != "en":
                continue
            trs = list(e.get("translations") or [])
            for s in e.get("senses") or []:
                trs += s.get("translations") or []
            for t in trs:
                code = t.get("lang_code") or t.get("code")
                word = (t.get("word") or "").strip()
                if code in ("ja", "bg") and word:
                    key = (e.get("word") or "", e.get("pos") or "", t.get("sense") or "")
                    groups[key][code].add(clean_bg(word) if code == "bg" else word)
            if lines % 200_000 == 0:
                print(f"\r  wiktionary: {lines:,} lines", end="", flush=True)
    print()

    out: dict[str, list] = defaultdict(list)
    for (en, pos, sense), g in sorted(groups.items()):
        if not g["ja"] or not g["bg"]:
            continue
        label = f"{en} ({sense})" if sense else en
        if pos:
            label += f" [{pos}]"
        bg = sorted(g["bg"])
        for ja in g["ja"]:
            out[ja].append([label, bg])
    print(f"  wiktionary: {len(out):,} Japanese forms with Bulgarian candidates")
    return out


def wordnet() -> dict[str, list]:
    bul, jpn = DATA / "wn-data-bul.tab", DATA / "wn-data-jpn.tab"
    if not bul.exists() or not jpn.exists():
        print("  wordnet: wn-data-bul.tab / wn-data-jpn.tab missing, skipped")
        return {}

    def lemmas(path: Path, tag: str) -> dict[str, list[str]]:
        by: dict[str, list[str]] = defaultdict(list)
        for line in path.open(encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3 and parts[1] == tag and parts[2] not in by[parts[0]]:
                by[parts[0]].append(parts[2])
        return by

    bg = lemmas(bul, "bul:lemma")
    ja = lemmas(jpn, "jpn:lemma")
    out: dict[str, list] = defaultdict(list)
    for synset in sorted(set(bg) & set(ja)):
        candidates = [clean_bg(w) for w in bg[synset]]
        for lemma in ja[synset]:
            # The Japanese WordNet writes suru verbs as 呼吸+する.
            out[lemma.replace("+", "")].append(candidates)
    print(f"  wordnet: {len(out):,} Japanese forms over {len(set(bg) & set(ja)):,} shared synsets")
    return out


def main() -> int:
    wk, wn = wiktionary(), wordnet()
    merged: dict[str, dict] = {}
    for form in sorted(set(wk) | set(wn)):
        entry = {}
        if form in wk:
            entry["wiktionary"] = wk[form]
        if form in wn:
            entry["wordnet"] = wn[form]
        merged[form] = entry
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(merged, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({len(merged):,} forms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
