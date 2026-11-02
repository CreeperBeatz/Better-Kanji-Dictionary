"""Our kanji pages against Kodansha's Kanji Learner's Dictionary, graded blind (Dani, 2026-11-02).

    python pipeline/kodansha_blind.py prepare [--n 100 --size 10] [--prod]
    # one Opus subagent per in/*.md, each reading pipeline/kodansha_blind_prompt.md
    python pipeline/kodansha_blind.py check      # every batch graded, every kanji, both entries
    python pipeline/kodansha_blind.py report     # unblinded: errors per entry, which is better

A random sample of the kanji pages the site serves (offline pack pages.json),
drawn with a fixed seed. Each kanji's two entries -- ours and Kodansha's --
are put in one plain shape: readings, then meanings, each with its words
(written form and reading only, no glosses), then the other words. Up to 8
words a meaning on both sides. The prose (about, hero, link) is left out: only
ours has it, so it would give the source away. Which entry is X and which
is Y is a coin toss per kanji; the key stays in key.json, which the graders
never see.

Not independent: our meaning groups were drafted with Kodansha on the
drafter's desk (meanings-v2, 2026-10-07), so agreement with Kodansha is
partly copied. What this measures is which entry teaches the kanji better and
how many errors each has, judged by a grader that does not know which is ours.

Kodansha stays local and reviewer-only (server/dictionaries.py): the batch
files and outputs live in data/drafts, which is not shipped.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import dictionaries  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "kodansha-blind"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
SEED = 20261102
CAP = 8  # words a meaning, both sides
LEVEL = {1: "N1", 2: "N2", 3: "N3", 4: "N4", 5: "N5"}


def _pack() -> Path:
    cur = json.loads((ROOT / "data" / "offline" / "current.json").read_text(encoding="utf-8"))
    return ROOT / "data" / "offline" / cur["version"]


def _gz(p: Path):
    with gzip.open(p, "rt", encoding="utf-8") as f:
        return json.load(f)


def _words(pack: Path) -> dict[int, tuple[str, str]]:
    out = {}
    for f in sorted(pack.glob("words-*.json.gz")):
        for w in _gz(f):
            out[w[0]] = (w[1], w[2])
    return out


def _kata(s: str) -> str:
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)


def _kun(r: str) -> str:
    """ふる.い -> ふる(い), the one notation for both sides."""
    if "." in r:
        a, b = r.split(".", 1)
        return f"{a}({b})"
    return r


def _clean(t: str) -> str:
    """Kodansha's sense text without its print styling: **OLD** -> old."""
    t = t.replace("**", "").replace("*", "").replace("▲", "").replace("△", "").replace("×", "")
    # Its entry numbers: [also 盲 2547], [rarely also 伶 れい 0075].
    t = re.sub(r"(?<=[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff])\s+\d{4}\b", "", t)
    return re.sub(r"\b[A-Z][A-Z'\-]+(?:s)?\b", lambda m: m.group(0).lower(), t).strip()


def _w(ja: str, reading: str | None) -> str:
    if reading:
        reading = re.sub(r"\(=([^)]*)\)", r" / \1", reading)  # ぼうげん(=もうげん)
    ja = ja.replace("×", "").replace("▲", "").replace("△", "")
    return f"{ja} ({reading})" if reading and reading != ja else ja


# ---------------------------------------------------------------- the two entries


def ours(page: dict, info: dict, words: dict[int, tuple[str, str]]) -> dict:
    def name(x: dict) -> str:
        if "id" in x and "headword" in x:  # the live API's full word
            return _w(x["headword"], x.get("reading"))
        w = words.get(x["$w"])
        if not w:
            return x.get("headword") or str(x["$w"])
        return _w(x.get("headword") or w[0], w[1])

    meanings = []
    for m in page["meanings"]:
        kun = (m.get("kun") or {}).get("words") or []
        on = [w for o in m.get("on") or [] for w in o["words"]]
        stars = [w for w in kun + on if w.get("star")]
        rest = [w for w in kun + on if not w.get("star")]
        shown = [name(w) for w in (stars + rest)[:CAP]]
        shown += [name(a["words"][0]) for a in m.get("also") or [] if a.get("words")]
        shown += [name(w) + " [special reading]" for w in (m.get("exceptions") or [])[:3]]
        meanings.append({"label": m["en"], "words": shown})
    other = []
    if page.get("soundOnly") and page["soundOnly"].get("words"):
        other.append({"label": "the kanji is used for its sound only",
                      "words": [name(w) for w in page["soundOnly"]["words"][:6]]})
    if page.get("special"):
        other.append({"label": "special readings", "words": [name(w) for w in page["special"][:6]]})
    return {"on": [_kata(r) for r in info.get("onYomi") or []],
            "kun": [_kun(r) for r in info.get("kunYomi") or []],
            "meanings": meanings, "other": other}


def kodansha(e: dict) -> dict:
    v = dictionaries._kodansha_view(e)
    meanings = []
    for s in v["senses"]:
        label = _clean(s["text"]) or "(no sense given)"
        if label == "unclassified compounds":
            label = "(other compounds)"
        meanings.append({"label": label, "words": [_w(w["ja"], w["reading"]) for w in s["words"][:CAP]]})
    for k in v["kun"]:
        head = _w(k["head"], k["kana"]) if k["head"] != k["kana"] else k["kana"]
        top = _clean(k.get("text") or "")
        for s in k["senses"]:
            text = _clean(s["text"]) if s["text"] != (k.get("text") or "") else ""
            label = "; ".join(x for x in (top, text) if x)
            meanings.append({"label": f"[native word {head}] {label}".strip(),
                             "words": [_w(w["ja"], w["reading"]) for w in s["words"][:CAP]]})
    for k in v["independent"]:
        meanings.append({"label": f"[word {k['head']}] {_clean(k.get('text') or '')}".strip(), "words": []})
    other = []
    if v["special"]:
        other.append({"label": "special readings", "words": [_w(w["ja"], w["reading"]) for w in v["special"][:6]]})
    return {"on": [_clean(r) for r in v["on"]], "kun": [_clean(r) for r in v["kunReadings"]], "meanings": meanings, "other": other}


def render(char: str, tag: str, entry: dict) -> str:
    lines = [f"### Entry {tag}",
             f"Readings: on {', '.join(entry['on']) or '—'} | kun {', '.join(entry['kun']) or '—'}",
             "Meanings:"]
    for i, m in enumerate(entry["meanings"], 1):
        lines.append(f"  {i}. {m['label']}")
        if m["words"]:
            lines.append(f"     words: {', '.join(m['words'])}")
    for o in entry["other"]:
        lines.append(f"Other words ({o['label']}): {', '.join(o['words'])}")
    return "\n".join(lines)


# ---------------------------------------------------------------- commands


PROD = "https://betterkanjidictionary.org/api/search/kanji-page/"


def _prod_pages(chars: list[str]) -> dict[str, dict]:
    """The pages the live site serves, cached: the local review store can be behind prod."""
    import urllib.parse
    import urllib.request
    f = DRAFTS / "prod-pages.json"
    have = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
    for c in chars:
        if c not in have:
            req = urllib.request.Request(PROD + urllib.parse.quote(c), headers={"User-Agent": "curl/8.0"})
            have[c] = json.load(urllib.request.urlopen(req, timeout=60))
    DRAFTS.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(have, ensure_ascii=False), encoding="utf-8")
    return have


def prepare(n: int, size: int, prod: bool = False) -> None:
    pack = _pack()
    pages = _gz(pack / "pages.json.gz")
    kpack = _gz(pack / "kanji.json.gz")
    info = {k["char"]: k for lv in kpack["levels"].values() for k in lv["kanji"]}
    # The levels hold only JLPT kanji: readings come from the kanji table, as the page's do.
    import sqlite3
    db = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
    for ch, on, kun in db.execute("SELECT char, on_yomi, kun_yomi FROM kanji"):
        if ch in pages:
            info.setdefault(ch, {"jlpt": None}).update(onYomi=json.loads(on or "[]"), kunYomi=json.loads(kun or "[]"))
    kd = dictionaries._kodansha()
    pool = sorted(c for c, p in pages.items()
                  if c in kd and p["meanings"] and dictionaries._kodansha_view(kd[c])["senses"])
    rnd = random.Random(SEED)
    sample = rnd.sample(pool, n)
    if prod:  # same sample and sides, drawn from the local pool; the entries as prod serves them
        pages = {**pages, **_prod_pages(sample)}
    words = _words(pack)
    # X is ours for exactly half the kanji, in a shuffled order: a grader leaning to X or Y tilts nothing.
    sides = [i < n // 2 for i in range(n)]
    rnd.shuffle(sides)
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    key = {}
    for b in range(math.ceil(n / size)):
        chunk = sample[b * size:(b + 1) * size]
        parts = [f"# Batch kb-{b:03d}: {len(chunk)} kanji\n"]
        for i, c in enumerate(chunk):
            a, k = ours(pages[c], info.get(c, {}), words), kodansha(kd[c])
            x_is_ours = sides[b * size + i]
            key[c] = {"X": "ours" if x_is_ours else "kodansha", "Y": "kodansha" if x_is_ours else "ours",
                      "jlpt": info.get(c, {}).get("jlpt"), "batch": f"kb-{b:03d}"}
            x, y = (a, k) if x_is_ours else (k, a)
            parts.append(f"## {c}\n\n{render(c, 'X', x)}\n\n{render(c, 'Y', y)}\n")
        (IN / f"kb-{b:03d}.md").write_text("\n".join(parts), encoding="utf-8")
    (DRAFTS / "key.json").write_text(json.dumps({"seed": SEED, "pool": len(pool), "pack": "prod" if prod else pack.name,
                                                 "kanji": key},
                                                ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"pool {len(pool)}, sample {n}, {math.ceil(n / size)} batches in {IN}")


def _load() -> tuple[dict, dict]:
    key = json.loads((DRAFTS / "key.json").read_text(encoding="utf-8"))["kanji"]
    got = {}
    for f in sorted(OUT.glob("kb-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            got[r["char"]] = r
    return key, got


def check() -> None:
    key, got = _load()
    bad = 0
    for c in key:
        r = got.get(c)
        if r is None:
            print("missing", c, key[c]["batch"]); bad += 1; continue
        if r.get("better") not in ("X", "Y", "tie") or not all(t in r for t in ("X", "Y")):
            print("malformed", c); bad += 1
    print(f"{len(got)}/{len(key)} graded, {bad} problems")


def _bound(k: int, n: int) -> str:
    """Wilson 95% interval."""
    if not n:
        return "-"
    p, z = k / n, 1.96
    d = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return f"{100 * p:.0f}% ({100 * max(0, mid - h):.0f}-{100 * min(1, mid + h):.0f}%)"


def report() -> None:
    key, got = _load()
    side = {"ours": Counter(), "kodansha": Counter()}
    kinds = {"ours": Counter(), "kodansha": Counter()}
    better = Counter()
    by_level = defaultdict(Counter)
    scores = {"ours": defaultdict(list), "kodansha": defaultdict(list)}
    errors = []
    for c, r in got.items():
        k = key[c]
        for tag in ("X", "Y"):
            who = k[tag]
            errs = r[tag].get("errors") or []
            sev = {e.get("severity") for e in errs}
            side[who]["entries"] += 1
            side[who]["major_entries"] += "major" in sev
            side[who]["any_entries"] += bool(errs)
            for e in errs:
                side[who][e.get("severity")] += 1
                kinds[who][(e.get("severity"), e.get("kind"))] += 1
                errors.append({"char": c, "who": who, **e})
            for s in ("coverage", "clarity"):
                if isinstance(r[tag].get(s), (int, float)):
                    scores[who][s].append(r[tag][s])
        win = r["better"] if r["better"] == "tie" else k[r["better"]]
        better[win] += 1
        by_level[LEVEL.get(k["jlpt"], "none")][win] += 1
    n = len(got)
    print(f"{n} kanji graded blind\n")
    print("Better entry: " + ", ".join(f"{w} {better[w]} ({_bound(better[w], n)})" for w in ("ours", "kodansha", "tie")))
    for lv in ("N5", "N4", "N3", "N2", "N1", "none"):
        if by_level[lv]:
            b = by_level[lv]
            print(f"  {lv}: ours {b['ours']}, kodansha {b['kodansha']}, tie {b['tie']}")
    for who in ("ours", "kodansha"):
        s = side[who]
        sc = ", ".join(f"{k} {sum(v) / len(v):.2f}" for k, v in scores[who].items() if v)
        print(f"\n{who}: entries with a major error {_bound(s['major_entries'], s['entries'])}; "
              f"major {s['major']}, minor {s['minor']} errors in all; mean {sc}")
        for (sev, kind), m in sorted(kinds[who].items(), key=lambda x: (x[0][0] != "major", -x[1])):
            print(f"  {sev:5} {kind}: {m}")
    (DRAFTS / "errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nall errors, unblinded: {DRAFTS / 'errors.json'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--size", type=int, default=10)
    p.add_argument("--prod", action="store_true", help="the entries as the live site serves them")
    sub.add_parser("check")
    sub.add_parser("report")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.n, a.size, a.prod)
    elif a.cmd == "check":
        check()
    else:
        report()


if __name__ == "__main__":
    main()
