"""Bulgarian for the word lines and sense notes (Dani, 2026-10-25).

    python pipeline/translate_bg.py prepare            # data/drafts/translate-bg/in/L-*.json, N-*.json
    # one Opus subagent per in/*.json, each reading pipeline/translate_bg_prompt.md (pilot ~5 first)
    python pipeline/translate_bg.py check [--batch L-000]
    python pipeline/translate_bg.py merge              # -> data/word_lines_bg.json
    python pipeline/translate_bg.py flags              # English texts the translators found wrong (enIssue)

What is translated: every line the word pages show (data/word_synonyms.json:
how a synonym differs, when to write a mix-up, both ways), once per text,
with the pair it was written for as context; and every sense note
(data/word_sense_notes.json): the note and its example's translation, from
the Japanese sentence, with the English as a guide. Where Tatoeba has a
Bulgarian translation of the example (19 from the Japanese, 330 only from
its English, about 15% of those wrong when sampled), it goes in as a hint.

data/word_lines_bg.json: {"lines": {English line: Bulgarian},
"notes": {"word id|sense index": {"nuance": Bulgarian, "ex": Bulgarian or null}}}.
Lines are keyed by their English, so a line fixed later in English simply has
no Bulgarian until translated again.
"""

from __future__ import annotations

import argparse
import bz2
import io
import json
import re
import sys
import tarfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "translate-bg"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
NOTES = ROOT / "data" / "word_sense_notes.json"
SITE = ROOT / "data" / "word_lines_bg.json"
TATOEBA = ROOT / "pipeline" / "data" / "tatoeba"
SIZE = {"L": 400, "N": 250}
JA = re.compile(r"[぀-ヿ㐀-鿿＀-￯々〆〜]+")
LATIN_IN_WORD = re.compile(r"[А-Яа-яЁё][A-Za-z]|[A-Za-z][А-Яа-яЁё]")  # D-021


def _gloss(wid: int, sense: int) -> str:
    s = ws.scope()[wid]["senses"]
    return s[sense][2] if 0 <= sense < len(s) else ""


def _hints() -> dict[str, str]:
    """Japanese sentence -> a Bulgarian Tatoeba translation, where one exists (direct first)."""
    path = TATOEBA / "bul_sentences.tsv.bz2"
    if not path.exists():
        return {}

    def sents(p):
        with bz2.open(p, "rt", encoding="utf-8") as f:
            return {int(x[0]): x[2] for x in (line.rstrip("\n").split("\t") for line in f) if len(x) >= 3}

    def links(p):
        out = {}
        with bz2.open(p, "rt", encoding="utf-8") as f:
            for line in f:
                a, b = map(int, line.split())
                out.setdefault(a, []).append(b)
        return out

    jpn, bul = sents(TATOEBA / "jpn_sentences.tsv.bz2"), sents(path)
    jb, eb = links(TATOEBA / "jpn-bul_links.tsv.bz2"), links(TATOEBA / "eng-bul_links.tsv.bz2")
    je = {}
    with tarfile.open(ROOT / "pipeline" / "data" / "jpn_indices.tar.bz2") as t:
        for line in io.TextIOWrapper(t.extractfile(t.getmembers()[0]), encoding="utf-8"):
            p = line.split("\t")
            if len(p) >= 2 and p[1].strip().isdigit():
                je.setdefault(int(p[0]), int(p[1]))
    out = {}
    for i, text in jpn.items():
        got = [bul[b] for b in jb.get(i, []) if b in bul] or [bul[b] for b in eb.get(je.get(i), []) if b in bul]
        if got:
            out[text] = got[0]
    return out


def prepare() -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    site = json.loads(ws.SITE.read_text(encoding="utf-8"))
    sc = ws.scope()
    lines: dict[str, dict] = {}
    for w, rs in site.items():
        for r in rs:
            if r[1] not in ("syn", "mix"):
                continue
            for text, about, other, i, n in ((r[4], r[2], int(w), r[3] - 1, r[0]), (r[5] if len(r) > 5 else None, int(w), r[2], r[0], r[3] - 1)):
                if text and text not in lines:
                    lines[text] = {"kind": {"syn": "synonym", "mix": "mixup"}[r[1]],
                                   "about": f"{sc[about]['word']} 【{sc[about]['reading']}】 {_gloss(about, i)}",
                                   "against": f"{sc[other]['word']} 【{sc[other]['reading']}】 {_gloss(other, n)}"}
    items = [{"key": f"l{n:05d}", "en": t, **c} for n, (t, c) in enumerate(sorted(lines.items()))]
    hints = _hints()
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    nitems = []
    for w, ns in sorted(notes.items(), key=lambda kv: int(kv[0])):
        if int(w) not in sc:
            continue
        for i, nt in enumerate(ns):
            if not nt:
                continue
            ex = nt.get("ex")
            hint = ex and hints.get(ex["ja"].replace("【", "").replace("】", ""))
            nitems.append({"key": f"{w}|{i}", "word": sc[int(w)]["word"], "reading": sc[int(w)]["reading"],
                           "gloss": _gloss(int(w), i), "nuance": nt["nuance"],
                           **({"ex": {"ja": ex["ja"], "en": ex["en"], **({"tatoebaBg": hint} if hint else {})}} if ex else {})})
    for prefix, rows in (("L", items), ("N", nitems)):
        for b in range(0, len(rows), SIZE[prefix]):
            name = f"{prefix}-{b // SIZE[prefix]:03d}"
            ws._dump(IN / f"{name}.json", {"batch": name, "items": rows[b:b + SIZE[prefix]]})
    print(f"lines {len(items)} in {-(-len(items) // SIZE['L'])} batches; notes {len(nitems)} "
          f"({sum('ex' in x for x in nitems)} examples, {sum('tatoebaBg' in x.get('ex', {}) for x in nitems)} with a Tatoeba hint) "
          f"in {-(-len(nitems) // SIZE['N'])} batches -> {IN}")


def _bad_bg(en: str, bg) -> str | None:
    if not isinstance(bg, str) or not bg.strip():
        return "Bulgarian text"
    if not re.search(r"[А-Яа-я]", bg):
        return "Cyrillic"
    if LATIN_IN_WORD.search(bg):
        return "no Latin letters inside a Bulgarian word"
    if "кандзи" in bg.lower():
        return "канджи, never кандзи"
    missing = [j for j in JA.findall(en) if j not in bg]
    if missing:
        return f"the Japanese kept as written ({' '.join(missing[:3])})"
    if len(bg) > 2.2 * len(en) + 40:
        return "about as long as the English"
    return None


def verdicts(batch: str) -> tuple[dict, list[str]]:
    src = ws._read(IN / f"{batch}.json")
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = ws._read(path).get("items")
    except (json.JSONDecodeError, AttributeError) as e:
        return {}, [f"{batch}: not JSON with an `items` object ({e})"]
    if not isinstance(got, dict):
        return {}, [f"{batch}: no `items` object"]
    by = {it["key"]: it for it in src["items"]}
    probs = [f"{batch}: missing {k}" for k in by.keys() - got.keys()] + [f"{batch}: unknown {k}" for k in got.keys() - by.keys()]
    good = {}
    for k, v in got.items():
        it = by.get(k)
        if not it:
            continue
        if batch.startswith("L"):
            bad = _bad_bg(it["en"], v.get("bg") if isinstance(v, dict) else None)
            if bad:
                probs.append(f"{batch}: {k}: bg needs {bad}")
            else:
                good[k] = {"bg": v["bg"].strip()}
        else:
            if not isinstance(v, dict):
                probs.append(f"{batch}: {k}: {{nuance, ex}}")
                continue
            bad = _bad_bg(it["nuance"], v.get("nuance"))
            if bad:
                probs.append(f"{batch}: {k}: nuance needs {bad}")
                continue
            if "ex" in it:
                ex = v.get("ex")
                if not isinstance(ex, str) or not ex.strip() or not re.search(r"[А-Яа-я]", ex) or LATIN_IN_WORD.search(ex):
                    probs.append(f"{batch}: {k}: ex is the example's Bulgarian translation, Cyrillic")
                    continue
            elif v.get("ex"):
                probs.append(f"{batch}: {k}: no example here, ex is null")
                continue
            good[k] = {"nuance": v["nuance"].strip(), "ex": v["ex"].strip() if "ex" in it else None}
    return good, probs


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    done = 0
    for b in batches:
        good, probs = verdicts(b)
        done += not probs
        if probs or only:
            print(f"{b}: {len(good)} valid, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    print(f"{done} of {len(batches)} batches complete")


def flags() -> None:
    """The English texts a translator marked as looking wrong (`enIssue`), with the batch and key."""
    n = 0
    for p in sorted(OUT.glob("*.json")):
        src = {it["key"]: it for it in ws._read(IN / p.name)["items"]}
        for k, v in (ws._read(p).get("items") or {}).items():
            if isinstance(v, dict) and isinstance(v.get("enIssue"), str) and v["enIssue"].strip():
                it = src.get(k, {})
                print(f"{p.stem} {k} | {it.get('en') or it.get('nuance')} | {v['enIssue']}")
                n += 1
    print(f"{n} flagged")


def merge() -> None:
    out = {"lines": {}, "notes": {}}
    for p in sorted(IN.glob("*.json")):
        good, probs = verdicts(p.stem)
        if probs:
            print(f"{p.stem}: {len(probs)} problems, {len(good)} taken")
        by = {it["key"]: it for it in ws._read(p)["items"]}
        for k, v in good.items():
            if p.stem.startswith("L"):
                out["lines"][by[k]["en"]] = v["bg"]
            else:
                out["notes"][k] = v
    ws._dump(SITE, out)
    print(f"{len(out['lines'])} lines, {len(out['notes'])} notes -> {SITE}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("merge")
    sub.add_parser("flags")
    a = ap.parse_args()
    {"prepare": prepare, "check": lambda: check(a.batch), "merge": merge, "flags": flags}[a.cmd]()


if __name__ == "__main__":
    main()
