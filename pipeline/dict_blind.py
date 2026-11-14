"""Five kanji dictionaries graded blind, with web research (Dani, 2026-11-14).

    python pipeline/dict_blind.py prepare [--n 100 --size 5]
    # one Opus subagent per in/*.md, each reading pipeline/dict_blind_prompt.md
    python pipeline/dict_blind.py check      # every batch graded, every kanji, every entry
    python pipeline/dict_blind.py report     # unblinded: 1-10 scores, errors, ranks per dictionary

The dictionaries:
  bkd       our pages, as betterkanjidictionary.org serves them (live API)
  kodansha  Kodansha Kanji Learner's Dictionary (JapaneseDictionaries/kodansha)
  tsalta    Цалта, Голям японски йероглифен речник (JapaneseDictionaries/kanji), Bulgarian
  kanjidic  KANJIDIC2 meanings and readings, verbatim (our kanji table), as jisho.org shows them
  wikt      English Wiktionary's Japanese kanji entry (wiktextract dump): senses,
            readings from its reading categories, its compounds and one-kanji words

A random sample of kanji that all five have, drawn with a fixed seed. Each
entry is put in one plain shape: readings, then meanings, each with its words
(written form, reading, a short gloss when the dictionary gives one). Up to 8
words a meaning. Prose (BKD's about/hero, Kodansha's notes, Цалта's note) is
left out of all five: it would give the source away and is not graded here.
The letters A-E are a balanced shuffle: each dictionary sits at each letter
equally often. The key stays in key.json, which the graders never see.

Graders build their own reference for each kanji from Japanese monolingual
sources (kanjipedia, kotobank, goo, weblio) and are kept off the sites the
entries come from (jisho, Wiktionary, our site), so no entry is the answer key.

Not independent: BKD's meaning groups were drafted with Kodansha on the
drafter's desk (meanings-v2, 2026-10-07), and BKD's readings and many senses
start from KANJIDIC/JMdict. Agreement between them is partly copied.

Kodansha and Цалта stay local: the batch files and outputs live in
data/drafts, which is not shipped.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import re
import sqlite3
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

from server import dictionaries  # noqa: E402
import kodansha_blind as kb  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "dict-blind"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
BOOKS = ROOT.parent / "JapaneseDictionaries"
DUMP = ROOT / "pipeline" / "data" / "raw-wiktextract-data.jsonl.gz"
SEED = 20261114
CAP = 8  # words a meaning, every dictionary
WHO = ("bkd", "kodansha", "tsalta", "kanjidic", "wikt")
DIMS = ("correctness", "precision", "completeness", "examples", "clarity", "overall")
LEVEL = kb.LEVEL


def _gloss(g: str | None, n: int = 70) -> str:
    g = (g or "").strip()
    if len(g) <= n:
        return g
    cut = g[:n]
    for sep in ("; ", ", "):
        if sep in cut:
            return cut[:cut.rindex(sep)]
    return cut.rstrip() + "…"


def _word(ja: str, reading: str | None, gloss: str | None = None) -> str:
    s = kb._w(ja, reading)
    g = _gloss(gloss)
    return f"{s} — {g}" if g else s


# ---------------------------------------------------------------- the five entries


def bkd(page: dict, on_r: list[str], kun_r: list[str]) -> dict:
    def name(w: dict) -> str:
        order = w.get("order") or list(range(len(w.get("senses") or [])))
        g = (w.get("senses") or [{}])[order[0]].get("gloss") if w.get("senses") else None
        return _word(w["headword"], w.get("reading"), g)

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
    # The site's reading line (web/src/detail/Readings.tsx): every on and kun reading of the kanji
    # table. The site greys out the ones with no common word; that mark is left out here, like
    # every other dictionary's rarity marks (an extra rare reading is not an error to the graders).
    return {"on": [kb._kata(r) for r in on_r], "kun": [kb._kun(r) for r in kun_r],
            "meanings": meanings, "other": other}


def kodansha(e: dict) -> dict:
    v = dictionaries._kodansha_view(e)
    meanings = []
    for s in v["senses"]:
        label = kb._clean(s["text"]) or "(no sense given)"
        if label == "unclassified compounds":
            label = "(other compounds)"
        meanings.append({"label": label, "words": [_word(w["ja"], w["reading"], w.get("gloss")) for w in s["words"][:CAP]]})
    for k in v["kun"]:
        head = kb._w(k["head"], k["kana"]) if k["head"] != k["kana"] else k["kana"]
        top = kb._clean(k.get("text") or "")
        for s in k["senses"]:
            text = kb._clean(s["text"]) if s["text"] != (k.get("text") or "") else ""
            label = "; ".join(x for x in (top, text) if x)
            meanings.append({"label": f"[native word {head}] {label}".strip(),
                             "words": [_word(w["ja"], w["reading"], w.get("gloss")) for w in s["words"][:CAP]]})
    for k in v["independent"]:
        meanings.append({"label": f"[word {k['head']}] {kb._clean(k.get('text') or '')}".strip(), "words": []})
    other = []
    if v["special"]:
        other.append({"label": "special readings",
                      "words": [_word(w["ja"], w["reading"], w.get("gloss")) for w in v["special"][:6]]})
    return {"on": [kb._clean(r) for r in v["on"]], "kun": [kb._clean(r) for r in v["kunReadings"]],
            "meanings": meanings, "other": other}


def tsalta(e: dict) -> dict:
    label = (e.get("keyword") or "").lower()
    if e.get("alt_meaning"):
        label += f"; {e['alt_meaning'].lower()}"
    words = [_word(w["ja"], w.get("romaji"), w.get("bg")) + (" [special reading]" if w.get("star") else "")
             for w in e.get("words") or []]
    return {"on": [r.lower() for r in e.get("on") or []], "kun": list(e.get("kun") or []),
            "meanings": [{"label": label or "(none)", "words": words[:CAP]}],
            "other": [{"label": "more words", "words": words[CAP:]}] if words[CAP:] else []}


def kanjidic(row: tuple) -> dict:
    meanings, on, kun = (json.loads(x or "[]") for x in row)
    return {"on": [kb._kata(r) for r in on], "kun": [kb._kun(r) for r in kun],
            "meanings": [{"label": m.lower(), "words": []} for m in meanings], "other": []}


_ON = re.compile(r"^Japanese kanji with (goon|kan'on|tōon|kan'yōon|on) reading (.+)$")
_KUN = re.compile(r"^Japanese kanji with kun reading (.+)$")


def _live_readings(params: dict) -> tuple[list[str], list[str]]:
    """{{ja-readings}} params from the live page: 'きょう<けふ' is today's reading < the historical one."""
    on, kun = [], []
    for k, v in params.items():
        for r in (x.split("<")[0].strip() for x in v.split(",")):
            if not r:
                continue
            if k in ("goon", "kanon", "toon", "kanyoon", "soon", "on"):
                if kb._kata(r) not in on:
                    on.append(kb._kata(r))
            elif k == "kun":
                r = r.replace("-", "(", 1) + (")" if "-" in r and not r.endswith("-") else "")
                if r not in kun:
                    kun.append(r.rstrip("-("))
    return on, kun


def wikt(entries: list[dict], live: dict | None = None) -> dict:
    ch = next((e for e in entries if e.get("pos") == "character"), None) or {}
    on, kun = [], []
    for c in ch.get("categories") or []:
        if m := _ON.match(c):
            r = kb._kata(m.group(2))
            if r not in on:
                on.append(r)
        elif m := _KUN.match(c):
            r = m.group(1).replace("・", "(", 1) + (")" if "・" in m.group(1) else "")
            if r not in kun:
                kun.append(r)
    if not on and not kun and live:  # the dump lacks the reading categories for a few pages
        on, kun = _live_readings(live)
    meanings = [{"label": "; ".join(s.get("glosses") or []), "words": []}
                for s in ch.get("senses") or [] if s.get("glosses")]
    derived = []
    for e in entries:
        for d in e.get("derived") or []:
            w = d.get("word")
            if w and w not in derived:
                derived.append(w)
    other = []
    for e in entries:
        if e.get("pos") == "character":
            continue
        reading = next((("".join(r[1] for r in f["ruby"])) for f in e.get("forms") or []
                        if "canonical" in (f.get("tags") or []) and f.get("ruby")), None)
        if not reading:
            ht = (e.get("head_templates") or [{}])[0].get("args") or {}
            reading = ht.get("2") or ht.get("1")
        gl = "; ".join(g for s in e.get("senses") or [] for g in s.get("glosses") or [])
        if gl:
            other.append(f"{e['word']} ({reading or '?'}, {e.get('pos')}) — {_gloss(gl, 90)}")
    out_other = []
    if other:
        out_other.append({"label": "the kanji as a word on its own", "words": other[:6]})
    if derived:
        out_other.append({"label": "compounds", "words": derived[:12]})
    return {"on": on, "kun": kun, "meanings": meanings, "other": out_other}


def render(tag: str, entry: dict) -> str:
    lines = [f"### Entry {tag}",
             f"Readings: on {', '.join(entry['on']) or '—'} | kun {', '.join(entry['kun']) or '—'}",
             "Meanings:"]
    for i, m in enumerate(entry["meanings"], 1):
        lines.append(f"  {i}. {m['label']}")
        for w in m["words"]:
            lines.append(f"     - {w}")
    for o in entry["other"]:
        lines.append(f"Other words ({o['label']}):")
        for w in o["words"]:
            lines.append(f"     - {w}")
    return "\n".join(lines)


# ---------------------------------------------------------------- sources


def _tsalta_all() -> dict[str, dict]:
    out = {}
    for line in (BOOKS / "kanji" / "kanji.jsonl").read_text(encoding="utf-8").splitlines():
        e = json.loads(line)
        if e.get("type") == "kanji" and e.get("kanji"):
            out.setdefault(e["kanji"], e)
    return out


def _wikt_chars() -> set[str]:
    return set(json.loads((ROOT / "data" / "drafts" / "wiktionary-kanji.json").read_text(encoding="utf-8")))


def _wikt_entries(chars: set[str]) -> dict[str, list[dict]]:
    """Every Japanese entry whose headword is one of the kanji, from the dump (a few minutes), cached."""
    f = DRAFTS / "wiktionary.json"
    have = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
    need = chars - set(have)
    if need:
        keys = {f'"word": "{c}"' for c in need}
        with gzip.open(DUMP, "rt", encoding="utf-8") as fh:
            for line in fh:
                if '"lang": "Japanese"' not in line or not any(k in line for k in keys):
                    continue
                e = json.loads(line)
                if e.get("lang") == "Japanese" and e.get("word") in need:
                    e.pop("etymology_templates", None)
                    e.pop("sounds", None)
                    have.setdefault(e["word"], []).append(e)
        DRAFTS.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(have, ensure_ascii=False), encoding="utf-8")
    return have


def _prod_pages(chars: list[str]) -> dict[str, dict]:
    import urllib.parse
    import urllib.request
    f = DRAFTS / "prod-pages.json"
    have = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
    for c in chars:
        if c not in have:
            req = urllib.request.Request(kb.PROD + urllib.parse.quote(c), headers={"User-Agent": "curl/8.0"})
            have[c] = json.load(urllib.request.urlopen(req, timeout=60))
    DRAFTS.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(have, ensure_ascii=False), encoding="utf-8")
    return have


# ---------------------------------------------------------------- commands


def _build(n: int):
    """The sample, its balanced letter shuffle, and a function giving each kanji's five entries."""
    pack = kb._pack()
    pages = kb._gz(pack / "pages.json.gz")
    db = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
    kdic = {r[0]: r[1:] for r in db.execute("SELECT char, meanings, on_yomi, kun_yomi FROM kanji")}
    jlpt = {r[0]: r[1] for r in db.execute("SELECT char, jlpt FROM kanji")}
    kd = dictionaries._kodansha()
    ts = _tsalta_all()
    wk = _wikt_chars()
    pool = sorted(c for c, p in pages.items()
                  if p["meanings"] and c in kd and dictionaries._kodansha_view(kd[c])["senses"]
                  and c in ts and c in wk and json.loads(kdic.get(c, ("[]",))[0] or "[]"))
    rnd = random.Random(SEED)
    sample = rnd.sample(pool, n)
    prod = _prod_pages(sample)
    wiki = _wikt_entries(set(sample))
    lf = DRAFTS / "wikt-readings-live.json"  # fetched 2026-11-14 for the pages the dump has no readings for
    live = json.loads(lf.read_text(encoding="utf-8")) if lf.is_file() else {}
    missing = [c for c in sample if not any(e.get("pos") == "character" for e in wiki.get(c, []))]
    if missing:
        sys.exit(f"no Wiktionary character entry in the dump for {''.join(missing)}")
    # A balanced shuffle: five rotations of a shuffled order, each used n/5 times.
    base = list(WHO)
    rnd.shuffle(base)
    rows = [base[i:] + base[:i] for i in range(len(base))]
    perms = [rows[i % len(rows)] for i in range(n)]
    rnd.shuffle(perms)

    def section(c: str, perm: list[str]) -> str:
        on, kun = (json.loads(x or "[]") for x in kdic[c][1:])
        e = {"bkd": bkd(prod[c], on, kun), "kodansha": kodansha(kd[c]), "tsalta": tsalta(ts[c]),
             "kanjidic": kanjidic(kdic[c]), "wikt": wikt(wiki[c], live.get(c))}
        body = "\n\n".join(render(L, e[w]) for L, w in zip("ABCDE", perm))
        return f"## {c}\n\n{body}\n"

    return pool, sample, perms, jlpt, section


def prepare(n: int, size: int) -> None:
    pool, sample, perms, jlpt, section = _build(n)
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    key = {}
    for b in range(math.ceil(n / size)):
        chunk = sample[b * size:(b + 1) * size]
        parts = [f"# Batch db-{b:03d}: {len(chunk)} kanji\n"]
        for i, c in enumerate(chunk):
            perm = perms[b * size + i]
            key[c] = {"letters": dict(zip("ABCDE", perm)), "jlpt": jlpt.get(c), "batch": f"db-{b:03d}"}
            parts.append(section(c, perm))
        (IN / f"db-{b:03d}.md").write_text("\n".join(parts), encoding="utf-8")
    (DRAFTS / "key.json").write_text(json.dumps({"seed": SEED, "pool": len(pool), "kanji": key},
                                                ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"pool {len(pool)}, sample {n}, {math.ceil(n / size)} batches in {IN}")
    print("levels:", Counter(LEVEL.get(k["jlpt"], "none") for k in key.values()))


def _sections(f: Path) -> dict[str, str]:
    return {part[3:].split("\n", 1)[0].strip(): part.rstrip() for part in re.split(r"\n(?=## )", f.read_text(encoding="utf-8"))[1:]}


def _same(a: str, b: str) -> bool:
    """Two renderings of a kanji, with the order of readings ignored."""
    def norm(t: str) -> list:
        out = []
        for line in t.rstrip().splitlines():
            if line.startswith("Readings: "):
                on, kun = line[len("Readings: on "):].split(" | kun ")
                line = (tuple(sorted(on.split(", "))), tuple(sorted(kun.split(", "))))
            out.append(line)
        return out
    return norm(a) == norm(b)


def regrade(size: int) -> None:
    """Kanji whose entries changed since they were graded (2026-11-14: BKD's readings were not the
    site's), in new rg-* batches with the same letters. Their new grades replace the old ones."""
    kf = DRAFTS / "key.json"
    meta = json.loads(kf.read_text(encoding="utf-8"))
    key = meta["kanji"]
    _, sample, _, _, section = _build(len(key))
    old = {}
    for f in sorted(IN.glob("*.md")):
        old.update(_sections(f))
    changed = []
    for c in sample:
        perm = [key[c]["letters"][L] for L in "ABCDE"]
        if not _same(section(c, perm), old[c]):
            changed.append((c, perm))
    done = len(list(IN.glob("rg-*.md")))
    for b in range(math.ceil(len(changed) / size)):
        name = f"rg-{done + b:03d}"
        chunk = changed[b * size:(b + 1) * size]
        parts = [f"# Batch {name}: {len(chunk)} kanji\n"]
        for c, perm in chunk:
            key[c].setdefault("was", []).append(key[c]["batch"])
            key[c]["batch"] = name
            parts.append(section(c, perm))
        (IN / f"{name}.md").write_text("\n".join(parts), encoding="utf-8")
    kf.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(changed)} kanji changed: {''.join(c for c, _ in changed)}; {math.ceil(len(changed) / size)} rg batches")


def _load() -> tuple[dict, dict]:
    key = json.loads((DRAFTS / "key.json").read_text(encoding="utf-8"))["kanji"]
    got = {}
    for f in sorted(OUT.glob("db-*.json")) + sorted(OUT.glob("rg-*.json")):  # a regrade replaces the first grade
        for r in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            if f.stem == key.get(r["char"], {}).get("batch") or r["char"] not in got:
                got[r["char"]] = r
    return key, got


def check() -> None:
    key, got = _load()
    bad = 0
    for c in key:
        r = got.get(c)
        if r is None:
            continue
        for L in "ABCDE":
            s = (r.get("entries") or {}).get(L, {}).get("scores") or {}
            if not all(isinstance(s.get(d), (int, float)) and 1 <= s[d] <= 10 for d in DIMS):
                print("malformed scores", c, L); bad += 1
        if sorted(r.get("ranking") or []) != list("ABCDE"):
            print("malformed ranking", c); bad += 1
        if len(r.get("reference", {}).get("sources") or []) < 2:
            print("fewer than 2 sources", c); bad += 1
    batches = Counter(k["batch"] for c, k in key.items() if c not in got)
    print(f"{len(got)}/{len(key)} graded, {bad} problems; batches missing: {', '.join(sorted(batches)) or 'none'}")


def _ci(xs: list[float]) -> str:
    if len(xs) < 2:
        return f"{xs[0]:.1f}" if xs else "-"
    m = statistics.mean(xs)
    h = 1.96 * statistics.stdev(xs) / math.sqrt(len(xs))
    return f"{m:.1f} ±{h:.1f}"


def report() -> None:
    key, got = _load()
    scores = {w: defaultdict(list) for w in WHO}
    ranks = {w: [] for w in WHO}
    firsts = Counter()
    errs = {w: Counter() for w in WHO}
    kinds = {w: Counter() for w in WHO}
    by_level = defaultdict(lambda: {w: [] for w in WHO})
    errors = []
    for c, r in got.items():
        letters = key[c]["letters"]
        lv = LEVEL.get(key[c]["jlpt"], "none")
        for L, who in letters.items():
            ent = r["entries"][L]
            for d in DIMS:
                scores[who][d].append(ent["scores"][d])
            by_level[lv][who].append(ent["scores"]["overall"])
            es = ent.get("errors") or []
            sev = {e.get("severity") for e in es}
            errs[who]["entries"] += 1
            errs[who]["major_entries"] += "major" in sev
            for e in es:
                errs[who][e.get("severity")] += 1
                kinds[who][(e.get("severity"), e.get("kind"))] += 1
                errors.append({"char": c, "who": who, "letter": L, **e})
        for i, L in enumerate(r["ranking"], 1):
            ranks[letters[L]].append(i)
        firsts[letters[r["ranking"][0]]] += 1
    n = len(got)
    order = sorted(WHO, key=lambda w: -statistics.mean(scores[w]["overall"]) if scores[w]["overall"] else 0)
    print(f"{n} kanji graded blind, 5 entries each\n")
    print(f"{'':10}" + "".join(f"{d[:12]:>14}" for d in DIMS) + f"{'mean rank':>11}{'#1':>5}")
    for w in order:
        print(f"{w:10}" + "".join(f"{_ci(scores[w][d]):>14}" for d in DIMS)
              + f"{statistics.mean(ranks[w]):>11.2f}{firsts[w]:>5}")
    print("\nOverall by JLPT level (mean, entries):")
    for lv in ("N5", "N4", "N3", "N2", "N1", "none"):
        if lv in by_level:
            row = by_level[lv]
            print(f"  {lv:5}" + "".join(f"{w}={statistics.mean(row[w]):.1f}  " for w in order) + f"(n={len(row[order[0]])})")
    print("\nErrors:")
    for w in order:
        e = errs[w]
        print(f"  {w:10} entries with a major error {kb._bound(e['major_entries'], e['entries'])}; "
              f"major {e['major']}, minor {e['minor']} in all")
        for (sev, kind), m in sorted(kinds[w].items(), key=lambda x: (x[0][0] != "major", -x[1]))[:6]:
            print(f"      {sev:5} {kind}: {m}")
    (DRAFTS / "errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=1), encoding="utf-8")
    summary = {w: {d: statistics.mean(scores[w][d]) for d in DIMS} | {"mean_rank": statistics.mean(ranks[w]),
                                                                      "first": firsts[w]} for w in WHO}
    (DRAFTS / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"\nall errors, unblinded: {DRAFTS / 'errors.json'}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--size", type=int, default=5)
    r = sub.add_parser("regrade")
    r.add_argument("--size", type=int, default=5)
    sub.add_parser("check")
    sub.add_parser("report")
    a = ap.parse_args()
    {"prepare": lambda: prepare(a.n, a.size), "regrade": lambda: regrade(a.size),
     "check": check, "report": report}[a.cmd]()


if __name__ == "__main__":
    main()
