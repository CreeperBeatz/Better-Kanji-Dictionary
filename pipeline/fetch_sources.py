"""Download every external data source Better Kanji Dictionary needs.

Supersedes fetch.sh, which only handled the original three decomposition sources.
Idempotent: files already present are skipped unless --force.

Usage:
    python pipeline/fetch_sources.py            # everything except the Wiktionary dump
    python pipeline/fetch_sources.py kradfile   # named subset
    python pipeline/fetch_sources.py --list     # show what would be fetched
    python pipeline/fetch_sources.py --force    # re-download

The Wiktionary raw dump (2.9 GB) is excluded by default; fetch it explicitly with
`python pipeline/fetch_sources.py wiktionary` when building the etymology layer.
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).parent / "data"
UA = {"User-Agent": "BetterRTK-Explorer/0.1 (personal kanji study tool)"}

# jmdict-simplified publishes a new release every Monday; resolve the tag at runtime
# rather than pinning, so KRADFILE/KANJIDIC2 stay current.
JMDICT_SIMPLIFIED_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
KANJIVG_API = "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest"

# name -> (filename, url or callable resolving to url, note)
SOURCES = {
    # --- already present from the original pipeline, re-listed so one command rebuilds from scratch
    "cjk-decomp": (
        "cjk-decomp.txt",
        "https://raw.githubusercontent.com/scriptin/topokanji/master/data/cjk-decomp-0.4.0.txt",
        "containment structure",
    ),
    "cjk-override": (
        "cjk-override.txt",
        "https://raw.githubusercontent.com/scriptin/topokanji/master/data/cjk-decomp-override.txt",
        "hand-fixed decompositions",
    ),
    "kanji-data": (
        "kanji.json",
        "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json",
        "JLPT levels, frequency, grade, strokes",
    ),
    # --- new for the explorer
    "kradfile": ("kradfile.json.zip", "@jmdict-simplified:kradfile", "kanji -> components"),
    "radkfile": ("radkfile.json.zip", "@jmdict-simplified:radkfile", "radical -> kanji, for the picker"),
    "kanjidic2": (
        "kanjidic2.xml.gz",
        "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz",
        "meanings verbatim, nanori, radicals",
    ),
    "jmdict": (
        "JMdict_e.gz",
        "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
        "word dictionary, raw XML for nf01-nf48 ranks",
    ),
    "kanjivg": ("kanjivg.xml.gz", "@kanjivg:xml", "stroke paths + component->stroke mapping"),
    "kanjium": (
        "accents.txt",
        "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt",
        "pitch accent",
    ),
    "tatoeba": (
        "jpn_indices.tar.bz2",
        "https://downloads.tatoeba.org/exports/jpn_indices.tar.bz2",
        "example sentences linked to JMdict senses",
    ),
    "kanjialive": (
        "ka_data.csv",
        "https://raw.githubusercontent.com/kanjialive/kanji-data-media/master/language-data/ka_data.csv",
        "curated meanings overlay, 1235 kanji",
    ),
    "wiktionary": (
        "raw-wiktextract-data.jsonl.gz",
        "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz",
        "glyph origin / etymology, and Bulgarian translation hints (2.9 GB, opt in)",
    ),
    # --- word-level JLPT: Jonathan Waller's lists (CC BY), keyed to JMdict ids by stephenmk
    **{
        f"jlpt-n{n}": (
            f"jlpt-vocab-n{n}.csv",
            f"https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/original_data/n{n}.csv",
            f"JLPT N{n} vocabulary with JMdict ids",
        )
        for n in (5, 4, 3, 2, 1)
    },
    # --- Bulgarian translation hints: the two wordnets share Princeton synset ids
    "omw-bul": (
        "wn-data-bul.tab",
        "https://raw.githubusercontent.com/omwn/omw-data/main/wns/bul/wn-data-bul.tab",
        "BulTreeBank wordnet, CC BY 3.0",
    ),
    "omw-jpn": (
        "wn-data-jpn.tab",
        "https://raw.githubusercontent.com/omwn/omw-data/main/wns/jpn/wn-data-jpn.tab",
        "Japanese WordNet (NICT licence)",
    ),
    # --- similar kanji: the glyphs are drawn in two open fonts as well as from
    # KanjiVG's strokes, and Unihan tells variant forms from near-synonyms
    "noto-sans-jp": (
        "NotoSansJP.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
        "Noto Sans JP, OFL -- lookalikes in print",
    ),
    "noto-serif-jp": (
        "NotoSerifJP.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf",
        "Noto Serif JP, OFL -- lookalikes in mincho",
    ),
    "unihan": (
        "Unihan.zip",
        "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip",
        "variant forms (Unicode licence)",
    ),
    # Human lists: shipped as a boost (the pairs people named always show), and
    # the benchmark for tests/similar_eval.py
    "yencken-flashcards": (
        "similar/yencken/flashcards.csv",
        "https://lars.yencken.org/datasets/kanji-confusion/flashcards.csv",
        "lookalikes listed as flashcard distractors, CC BY 3.0",
    ),
    "yencken-pool": (
        "similar/yencken/poolexp_judgements.yaml.gz",
        "https://lars.yencken.org/datasets/kanji-confusion/poolexp_judgements.yaml.gz",
        "lookalikes native speakers picked from a pool, CC BY 3.0",
    ),
    "kanjium-lookalikes": (
        "similar/kanjium/lookalikes.txt",
        "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/lookalikes.txt",
        "lookalikes, CC BY-SA 4.0",
    ),
    "kanjium-synonyms": (
        "similar/kanjium/synonyms.txt",
        "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/synonyms.txt",
        "near-synonym kanji, CC BY-SA 4.0",
    ),
}

# Big, slow, and only needed once for the etymology extract.
OPT_IN = {"wiktionary"}


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


_release_cache: dict[str, dict] = {}


def resolve(url: str) -> str:
    """Expand @repo:asset placeholders against the repo's latest GitHub release."""
    if not url.startswith("@"):
        return url
    repo, _, want = url[1:].partition(":")
    api = {"jmdict-simplified": JMDICT_SIMPLIFIED_API, "kanjivg": KANJIVG_API}[repo]
    if repo not in _release_cache:
        _release_cache[repo] = _get_json(api)
    release = _release_cache[repo]
    for asset in release["assets"]:
        name = asset["name"]
        if repo == "kanjivg":
            # kanjivg-20260714.xml.gz -- the single-file form, not the SVG zips
            if name.endswith(".xml.gz"):
                return asset["browser_download_url"]
        elif name.startswith(want) and name.endswith(".json.zip"):
            return asset["browser_download_url"]
    raise SystemExit(f"no asset matching {want!r} in {repo} release {release.get('tag_name')}")


def fetch(name: str, force: bool = False) -> Path:
    filename, url_spec, note = SOURCES[name]
    dest = DATA / filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        print(f"  skip  {filename:<32} ({dest.stat().st_size:,} bytes, already present)")
        return dest

    url = resolve(url_spec)
    print(f"  get   {filename:<32} {note}")
    print(f"        {url}")
    req = urllib.request.Request(url, headers=UA)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=300) as r, tmp.open("wb") as out:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while chunk := r.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = 100 * done / total
                print(f"\r        {done:>12,} / {total:,} bytes ({pct:5.1f}%)", end="", flush=True)
            else:
                print(f"\r        {done:>12,} bytes", end="", flush=True)
    print()
    tmp.replace(dest)
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="sources to fetch (default: all except opt-in)")
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    ap.add_argument("--list", action="store_true", help="list sources and exit")
    args = ap.parse_args()

    if args.list:
        for name, (filename, _, note) in SOURCES.items():
            mark = "  (opt-in)" if name in OPT_IN else ""
            print(f"{name:<14} {filename:<32} {note}{mark}")
        return 0

    DATA.mkdir(parents=True, exist_ok=True)
    names = args.names or [n for n in SOURCES if n not in OPT_IN]
    unknown = [n for n in names if n not in SOURCES]
    if unknown:
        raise SystemExit(f"unknown source(s): {', '.join(unknown)} (try --list)")

    print(f"fetching {len(names)} source(s) into {DATA}\n")
    for name in names:
        fetch(name, force=args.force)
    print("\ndone")
    return 0


if __name__ == "__main__":
    sys.exit(main())
