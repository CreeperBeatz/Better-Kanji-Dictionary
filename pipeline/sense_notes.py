"""One note per sense of a word: its nuance, whether it is a main meaning, and an example (Dani, 2026-10-24).

    python pipeline/sense_notes.py prepare --pilot          # data/drafts/sense-notes/in/P-000.json
    python pipeline/sense_notes.py prepare [--size 40]      # every JLPT word, and every word with synonym rows
    # one subagent per in/*.json, each reading pipeline/sense_notes_prompt.md
    python pipeline/sense_notes.py check [--batch P-000]
    python pipeline/sense_notes.py merge                     # -> data/word_sense_notes.json

A word's synonym rows each said how the word itself differs from that synonym,
so a sense with three synonyms described the word three ways (古い "stale":
"Plain word. Says something is not new any more..." and "The plain word for
something stale..."). Instead each sense says once, under its glosses, what
the word is in that meaning; the rows say only how the other word differs.

Per sense: `nuance`, one sentence in English; `rank`, main | secondary | rare
(the meanings a learner meets first, the ones met later, the ones barely met);
`ex`, a short example {ja, en}, the word in 【】, taken from the Tatoeba
sentences offered where one fits (src "t"), else written (src "d").
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "sense-notes"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
SITE = ROOT / "data" / "word_sense_notes.json"
NUANCE = 170  # characters
EXAMPLE = 45  # characters of Japanese
OFFERED = 12  # Tatoeba sentences offered per word
PILOT = ["古い", "引く", "込む", "安定", "綺麗", "掛ける", "取る", "見る", "甘い", "明るい", "上がる", "立つ",
         "気持ち", "結構", "大丈夫", "適当", "素直", "勝手", "合う", "付く", "落とす", "調子", "様子", "加減",
         "相当", "確か", "一応", "随分", "生", "温かい"]

_NOTE = re.compile(r"\(.*?\)|\[.*?\]|~")


def _surface(indexed: str) -> str:
    """A Tatoeba index line (lemma(reading)[sense]{surface} ...) back to the sentence."""
    out = ""
    for tok in indexed.split():
        b = tok.find("{")
        out += tok[b + 1:tok.find("}", b)] if b >= 0 else _NOTE.sub("", tok)
    return out


def _sentences(wid: int) -> list[str]:
    """Tatoeba indexes a word by any of its spellings (奇麗 for 綺麗), a word written only in kana by its kana."""
    db = ws.proposals.connect()
    rows = [r[0] for r in db.execute(
        "SELECT s.text FROM sentence_word sw JOIN sentence s ON s.id = sw.sentence_id "
        "WHERE sw.headword IN (SELECT text FROM word_form WHERE word_id = ?1 AND (kana = 0 OR NOT EXISTS "
        "(SELECT 1 FROM word_form k WHERE k.word_id = ?1 AND k.kana = 0)))", (wid,))]
    texts = sorted({_surface(r) for r in rows}, key=len)
    # A sentence cut at its start ("はとても古い都です") is no example.
    return [t for t in texts if 6 <= len(t) <= EXAMPLE and t[0] not in "はがをにでともへや、。"][:OFFERED]


def _synonyms() -> dict[int, dict[int, list[str]]]:
    """Per word and sense, its synonyms and how each differs, so the nuance agrees with the rows."""
    rows = json.loads((ROOT / "data" / "word_synonyms.json").read_text(encoding="utf-8"))
    sc = ws.scope()
    out: dict[int, dict[int, list[str]]] = {}
    for w, rs in rows.items():
        for i, k, o, n, line, *_ in rs:
            if k == "syn" and o in sc:
                out.setdefault(int(w), {}).setdefault(i, []).append(f"{sc[o]['word']} {sc[o]['reading']}: {line}")
    return out


def _item(wid: int, syn: dict[int, dict[int, list[str]]]) -> dict:
    w = ws.scope()[wid]
    return {
        "id": wid, "word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"],
        "senses": [{"n": i + 1, "pos": pos, "misc": misc, "gloss": gloss, "synonyms": syn.get(wid, {}).get(i, [])}
                   for i, (pos, misc, gloss) in enumerate(w["senses"][:ws.SENSES])],
        "sentences": _sentences(wid),
    }


def _pilot_ids() -> list[int]:
    out = []
    for head in PILOT:
        ids = [wid for wid, _ in ws.forms().get(head, [])]
        ids = [i for i in ids if ws.scope()[i]["word"] == head] or ids
        out.append(ids[0])
    return list(dict.fromkeys(out))


def prepare(pilot: bool, size: int) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    syn = _synonyms()
    if pilot:
        ids, kind = _pilot_ids(), "P"
    else:
        sc = ws.scope()
        done = {it["id"] for p in IN.glob("P-*.json") for it in ws._read(p)["items"]}
        ids = sorted((w for w in sc if (sc[w]["jlpt"] or w in syn) and w not in done), key=ws._rank)
        kind = "N"
    for b, i in enumerate(range(0, len(ids), size)):
        name = f"{kind}-{b:03d}"
        ws._dump(IN / f"{name}.json", {"batch": name, "items": [_item(w, syn) for w in ids[i:i + size]]})
    print(f"{kind}: {len(ids)} words, {sum(len(ws.scope()[w]['senses'][:ws.SENSES]) for w in ids)} senses, "
          f"{-(-len(ids) // size)} batches")


def _problems(batch: str) -> tuple[dict, list[str]]:
    src = ws._read(IN / f"{batch}.json")
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = ws._read(path)
    except json.JSONDecodeError as e:
        return {}, [f"{batch}: not JSON ({e})"]
    items = got.get("items") if isinstance(got, dict) else None
    if not isinstance(items, dict):
        return {}, [f"{batch}: no `items` object"]
    good, probs = {}, []
    for it in src["items"]:
        wid = str(it["id"])
        notes = items.get(wid)
        if not isinstance(notes, list) or len(notes) != len(it["senses"]):
            probs.append(f"{batch}: {wid} {it['word']} needs a list of {len(it['senses'])} notes")
            continue
        out = []
        for n, s in enumerate(notes, 1):
            where = f"{batch}: {wid} {it['word']} sense {n}"
            if not isinstance(s, dict) or s.get("rank") not in ("main", "secondary", "rare"):
                probs.append(f"{where}: rank is main, secondary or rare")
            elif not isinstance(s.get("nuance"), str) or not s["nuance"].strip() or len(s["nuance"]) > NUANCE:
                probs.append(f"{where}: one nuance sentence, at most {NUANCE} characters")
            elif s.get("ex") is not None and not (
                    isinstance(s["ex"], dict) and all(isinstance(s["ex"].get(k), str) and s["ex"][k].strip() for k in ("ja", "en"))
                    and s["ex"]["ja"].count("【") == 1 and s["ex"]["ja"].count("】") == 1 and s["ex"].get("src") in ("t", "d")):
                probs.append(f"{where}: ex is null or {{ja with the word in one 【】, en, src t|d}}")
            elif s.get("ex") and s["ex"]["src"] == "t" and s["ex"]["ja"].replace("【", "").replace("】", "") not in it["sentences"]:
                probs.append(f"{where}: src t, but not one of the sentences offered, word for word")
            else:
                ex = s.get("ex")
                out.append({"rank": s["rank"], "nuance": s["nuance"].strip(),
                            "ex": ex and {"ja": ex["ja"].strip(), "en": ex["en"].strip(), "src": ex["src"]}})
        if len(out) == len(it["senses"]):
            if not any(s["rank"] == "main" for s in out):
                probs.append(f"{batch}: {wid} {it['word']}: at least one sense is main")
            else:
                good[wid] = out
    return good, probs


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("*.json"))
    total = 0
    for b in batches:
        good, probs = _problems(b)
        total += len(good)
        if probs or only:
            print(f"{b}: {len(good)} valid words, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{total} valid words in {len(batches)} batches")


def merge() -> None:
    out = {}
    for p in sorted(IN.glob("*.json")):
        good, probs = _problems(p.stem)
        if probs:
            print(f"{p.stem}: {len(probs)} problems, {len(good)} words taken")
        out.update(good)
    ws._dump(SITE, out)
    print(f"{len(out)} words -> {SITE}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--pilot", action="store_true")
    p.add_argument("--size", type=int, default=40)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    sub.add_parser("merge")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.pilot, a.size)
    elif a.cmd == "check":
        check(a.batch)
    else:
        merge()


if __name__ == "__main__":
    main()
