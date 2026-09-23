"""Does offline lookup on the device answer as the server does?

    python tests/offline_parity.py            # a few thousand checks, ~2 minutes
    python tests/offline_parity.py --quick    # a few hundred
    python tests/offline_parity.py --keep DIR # and leave the answers in DIR

Asks the server's own route functions -- search, recognise, the radical
picker, words-for -- then has web/scripts/parity.ts put the same questions to
the TypeScript engine over the built offline pack, and lists every answer
that differs. Queries are the hand-picked hard cases below plus a seeded
random sample of real headwords, readings, glosses and their prefixes, each
searched with the interface in English and some again in Bulgarian, where
Latin input can also be shlyokavitsa. server/bulgarian.py's normalising,
stemming and shlyokavitsa readings are compared word by word too.

Needs the database and `npm install` in web/. Builds the pack if it is stale.
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import bulgarian, offline, recognize  # noqa: E402
from server.db import query  # noqa: E402
from server.japanese import katakana_to_hiragana  # noqa: E402
from server.routes.radicals import search_by_radicals  # noqa: E402
from server.routes.search import search, words_for_kanji  # noqa: E402

HARD = [
    # English, including prefixes, stop words, punctuation and accents
    "water", "wat", "w", "a", "the", "to eat", "eat", "dog", "big", "red car", "x-ray", "don't",
    "café", "naïve", "e-mail", "o'clock", '"quoted"', "to be", "run fast", "!!", "12", "Tokyo",
    # romaji, clean and not
    "taberu", "tabemashita", "nihongo", "kanji", "sushi", "tame", "konnichiwa", "gakkou", "kitte",
    "ni", "n", "shi", "tsu", "kya", "xyz", "arigatou", "benkyou", "taberareru",
    # romaji and kana that find kanji by reading: kun'yomi, a kun'yomi's stem, on'yomi
    "mizu", "sui", "kami", "ta", "ue", "kou", "shou", "みず", "スイ", "かみ",
    # Japanese, dictionary form and conjugated
    "食べる", "食べた", "食べたくなかった", "行った", "日本", "日本語", "時", "見る", "見ます", "来ない",
    "します", "勉強している", "高くない", "カタカナ", "ひらがな", "言", "語", "々", "読んでいます",
    "書かれた", "着ます", "話せる", "泳いだ", "死んだ", "買った", "待って", "飲みたい", "寒かった",
    "ありがとう", "こんにちは", "ラーメン", "コーヒー", "漢字", "東京", "大学生", "する", "くる",
    "𠮟る", "𩸽", "〆切", "ー", "ぁ",
    # letters unicode61 keeps apart from their unaccented look-alikes
    "йод", "иод", "ёж", "ѝ", "край", "ǡ", "ḯ",
]

# Searched with the interface in Bulgarian as well as English.
HARD_BG = [
    # Cyrillic: plain, inflected, stressed, capitalised, mixed with punctuation
    "вода", "водата", "Вода", "пу" + chr(0x301) + "ша", "котки", "котката", "човек", "човекът", "хора", "книга",
    "добро утро", "японски език", "край", "ъгъл", "чадър!", "море", "дъжд", "пролет", "и", "а",
    # shlyokavitsa: official, SMS style, and collisions with romaji
    "voda", "4ovek", "chovek", "zhaba", "riba", "more", "kasa", "kotka", "kniga", "dete", "prozorec",
    "prozorets", "dobro utro", "yaponski ezik", "6apka", "shtastie", "wastie", "dyzhd", "d1zhd", "sam",
    # ordinary queries, to see Bulgarian mode leaves them alone
    "water", "taberu", "食べる", "日本", "nihongo", "x-ray", "12", "!!",
]

LATIN = dict(zip("абвгдежзийклмнопрстуфхцчшщъьюя",
                 ["a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s",
                  "t", "u", "f", "h", "ts", "ch", "sh", "sht", "a", "y", "yu", "ya"]))
SMS = {"ч": "4", "ш": "6", "щ": "6t", "я": "q", "ъ": "u", "ц": "c"}


def latinize(text: str, rng: random.Random) -> str:
    """Bulgarian as someone might type it in Latin letters, officially or not."""
    sms = rng.random() < 0.5
    return "".join((SMS.get(c) if sms and c in SMS else None) or LATIN.get(c, c) for c in text.lower())


def sample_bg(n: int, rng: random.Random) -> list[str]:
    """Words and phrases from the Bulgarian glosses, as typed and in Latin."""
    glosses = [r["gloss"] for r in query("SELECT gloss FROM sense_bg ORDER BY word_id, ord")]
    glosses += [m for r in query("SELECT meanings FROM kanji_bg ORDER BY char") for m in json.loads(r["meanings"])]
    out: list[str] = []
    for _ in range(n if glosses else 0):
        words = glosses[rng.randrange(len(glosses))].replace(";", " ").split()
        if not words:
            continue
        start = rng.randrange(len(words))
        phrase = " ".join(words[start : start + rng.randint(1, 2)])
        kind = rng.randrange(3)
        out.append(phrase if kind == 0 else latinize(phrase, rng) if kind == 1 else phrase[: rng.randint(1, len(phrase))])
    return [q for q in out if q.strip()]


def sample(n: int, rng: random.Random) -> list[str]:
    rows = query("SELECT headword, reading FROM word ORDER BY id")
    glosses = query("SELECT gloss FROM sense ORDER BY rowid")
    out: list[str] = []
    for _ in range(n):
        w = rows[rng.randrange(len(rows))]
        kind = rng.randrange(6)
        if kind == 0:
            out.append(w["headword"])
        elif kind == 1:
            out.append(w["reading"])
        elif kind == 2:
            # a prefix, as someone typing would send it
            t = w["headword"]
            out.append(t[: rng.randint(1, max(1, len(t)))])
        elif kind == 3:
            words = glosses[rng.randrange(len(glosses))]["gloss"].replace(";", " ").split()
            if words:
                start = rng.randrange(len(words))
                out.append(" ".join(words[start : start + rng.randint(1, 2)]))
        elif kind == 4:
            words = glosses[rng.randrange(len(glosses))]["gloss"].split()
            if words:
                wd = words[rng.randrange(len(words))]
                out.append(wd[: rng.randint(1, len(wd))])
        else:
            out.append(romaji_of(katakana_to_hiragana(w["reading"])))
    return [q for q in out if q.strip()]


_KANA = {v: k for k, v in __import__("server.japanese", fromlist=["_ROMAJI"])._ROMAJI.items() if len(k) <= 3}


def romaji_of(kana: str) -> str:
    """A rough romanisation, so the romaji path sees real words too."""
    out, i = "", 0
    while i < len(kana):
        for size in (2, 1):
            chunk = kana[i : i + size]
            if chunk in _KANA:
                out += _KANA[chunk]
                i += size
                break
        else:
            if kana[i] == "っ" and i + 1 < len(kana):
                nxt = _KANA.get(kana[i + 1], "")
                out += nxt[:1]
            i += 1
    return out


def jittered(char: str, rng: random.Random) -> list[list[list[float]]] | None:
    """A drawing of `char`: its reference strokes, shaken, scaled and shifted."""
    row = query("SELECT paths FROM stroke WHERE char = ?", (char,))
    if not row:
        return None
    paths = json.loads(row[0]["paths"])
    scale = rng.uniform(1.5, 3.0)
    dx, dy = rng.uniform(-20, 20), rng.uniform(-20, 20)
    ink = []
    for p in paths:
        x1, y1, x2, y2 = recognize.path_endpoints(p)
        j = lambda v: v * scale + rng.gauss(0, 4)  # noqa: E731
        ink.append([[j(x1) + dx, j(y1) + dy], [j(x2) + dx, j(y2) + dy]])
    return ink


def main() -> int:
    quick = "--quick" in sys.argv
    rng = random.Random(20260923)
    m = offline.build()
    pack_dir = offline.OUT / m["version"]

    queries = list(dict.fromkeys(HARD + sample(300 if quick else 2500, rng)))
    bg_queries = list(dict.fromkeys(HARD + HARD_BG + sample_bg(150 if quick else 1000, rng) + queries[: 200 if quick else 800]))
    plain = ("news", "asc")
    asked = [(q, "en", False, plain) for q in dict.fromkeys(queries + HARD_BG)]
    asked += [(q, "bg", False, plain) for q in bg_queries]
    # Common words only, and every other order, over a slice of both.
    asked += [(q, "en", True, plain) for q in HARD + queries[: 100 if quick else 600]]
    asked += [(q, "bg", True, plain) for q in HARD_BG]
    for how in (("news", "desc"), ("jlpt", "asc"), ("jlpt", "desc")):
        asked += [(q, "en", True, how) for q in HARD + queries[: 50 if quick else 300]]
        asked += [(q, "bg", False, how) for q in HARD_BG]
    print(f"asking the server {len(asked)} searches")
    golden: dict = {"search": [], "bulgarian": [], "draw": [], "radicals": [], "wordsFor": []}
    for q, lang, common, (sort, order) in asked:
        out = search(q=q[:64], limit=30, lang=lang, common=common, sort=sort, order=order)
        golden["search"].append({"q": q[:64], "lang": lang, "common": common, "sort": sort, "order": order, "out": out})

    texts = list(dict.fromkeys(HARD_BG + [w for q in bg_queries for w in q.split()]))
    for t in texts:
        golden["bulgarian"].append({
            "text": t,
            "normalized": bulgarian.normalize(t),
            "terms": bulgarian.terms(t),
            "spelling": bulgarian.spelling(t),
            "candidates": bulgarian.shlyokavitsa(t)[:64],
        })

    recognize.index()
    common = [r["char"] for r in query("SELECT char FROM kanji WHERE freq IS NOT NULL ORDER BY freq")]
    for char in rng.sample(common, 60 if quick else 400):
        ink = jittered(char, rng)
        if ink:
            out = recognize.recognise(ink)
            golden["draw"].append({"char": char, "strokes": ink, "out": out})

    kr: dict[str, list[str]] = {}
    for r in query("SELECT kanji, radical FROM kanji_radical"):
        kr.setdefault(r["kanji"], []).append(r["radical"])
    kanji_list = sorted(kr)
    for _ in range(80 if quick else 500):
        rads = kr[kanji_list[rng.randrange(len(kanji_list))]]
        pick = rng.sample(rads, min(len(rads), rng.randint(1, 3)))
        golden["radicals"].append({"r": pick, "out": search_by_radicals(r=pick, limit=400)})

    for char in rng.sample(common, 60 if quick else 300):
        golden["wordsFor"].append({"char": char, "out": [w["id"] for w in words_for_kanji(char, limit=12)["words"]]})

    web = ROOT / "web"
    keep = sys.argv[sys.argv.index("--keep") + 1] if "--keep" in sys.argv else None
    with tempfile.TemporaryDirectory() as scratch:
        tmp = keep or scratch
        Path(tmp).mkdir(parents=True, exist_ok=True)
        g = Path(tmp) / "golden.json"
        g.write_text(json.dumps(golden, ensure_ascii=False), encoding="utf-8")
        bundle = Path(tmp) / "parity.mjs"
        npx = "npx.cmd" if sys.platform == "win32" else "npx"
        subprocess.run(
            [npx, "rolldown", "scripts/parity.ts", "--format", "esm", "--platform", "node", "--file", str(bundle)],
            cwd=web, check=True, capture_output=True,
        )
        return subprocess.run(["node", str(bundle), str(pack_dir), str(g)], cwd=web).returncode


if __name__ == "__main__":
    sys.exit(main())
