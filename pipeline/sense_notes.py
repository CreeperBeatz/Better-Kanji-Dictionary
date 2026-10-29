"""One note per sense of a word: its nuance, whether it is a main meaning, and an example (Dani, 2026-10-24).

    python pipeline/sense_notes.py prepare --pilot          # data/drafts/sense-notes/in/P-000.json
    python pipeline/sense_notes.py prepare [--size 40]      # every JLPT word, and every word with synonym rows
    # one subagent per in/*.json, each reading pipeline/sense_notes_prompt.md
    python pipeline/sense_notes.py check [--batch P-000]
    python pipeline/sense_notes.py merge                     # -> data/word_sense_notes.json
    python pipeline/sense_evidence.py                        # dictionary hints for the check
    python pipeline/sense_notes.py verify-prepare            # verify/in/V-*.json
    # one Opus subagent per verify/in/*.json, each reading pipeline/sense_notes_verify_prompt.md
    python pipeline/sense_notes.py verify-check [--batch V-000]
    python pipeline/sense_notes.py merge                     # the drafts with the check's fixes

The common words with no JLPT level (2026-10-29), most frequent first, in a
fixed series an agent can pick up with no context:

    python pipeline/sense_notes.py status                    # what is done, what to run next, and how
    python pipeline/sense_notes.py prepare --common          # once: in/K-*.json, 80 words each, ranked
    # one Sonnet subagent per K batch, reading pipeline/sense_notes_prompt.md
    python pipeline/sense_notes.py check --batch K-000
    python pipeline/sense_evidence.py                        # after new K drafts, before verify-prepare
    python pipeline/sense_notes.py verify-prepare --common   # verify/in/VK-n.json for each clean K-n
    # one Opus subagent per VK batch, reading pipeline/sense_notes_verify_prompt.md
    python pipeline/sense_notes.py verify-check --batch VK-000
    python pipeline/sense_notes.py merge                     # a K word reaches the site once checked

The K batches are cut once and never again, so K-n is the same words for
every agent; VK-n is K-n's words. A batch is done when its out file checks
clean. `status` reads only the files, so whoever stops, the next one starts
from it.

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
import bz2
import gzip
import json
import re
import sys
from collections import Counter
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "sense-notes"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
VIN, VOUT = DRAFTS / "verify" / "in", DRAFTS / "verify" / "out"
EVIDENCE = DRAFTS / "evidence.json"  # pipeline/sense_evidence.py
SITE = ROOT / "data" / "word_sense_notes.json"
RESTRICTIONS = ROOT / "data" / "sense_restrictions.json"  # pipeline/sense_restrictions.py
SENTENCE_BG = ROOT / "data" / "sentence_bg.json"  # pipeline/sentence_bg.py: broken and notFor
COMMON, COMMON_SIZE = "K", 80  # the common words with no JLPT level: 1.4 senses each, against 2.1
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


@cache
def _tatoeba() -> dict[int, str]:
    """Tatoeba's own text by sentence id. The db keeps the index line, and the sentence
    rebuilt from it loses every word the index skips: 石の上にも三年 came back 石の上にも年."""
    out = {}
    with bz2.open(ROOT / "pipeline" / "data" / "tatoeba" / "jpn_sentences.tsv.bz2", "rt", encoding="utf-8") as f:
        for line in f:
            i, _, text = line.rstrip("\n").split("\t", 2)
            out[int(i)] = text
    return out


@cache
def _jmdict_extras() -> dict[int, list[dict]]:
    """Per word, per sense: JMdict's field, dialect and sense note, which the db drops
    (需要 sense 2 is the economics term)."""
    import xml.etree.ElementTree as ET
    raw = gzip.open(ROOT / "pipeline" / "data" / "JMdict_e.gz", "rt", encoding="utf-8").read()
    declared = set(re.findall(r'<!ENTITY\s+([\w-]+)\s+"', raw))
    raw = re.sub(r"<!DOCTYPE.*?\]>", "", raw, count=1, flags=re.DOTALL)
    raw = re.sub(r"&([\w-]+);", lambda m: m.group(1) if m.group(1) in declared else m.group(0), raw)
    out = {}
    for entry in ET.fromstring(raw).iter("entry"):
        senses = []
        for s in entry.findall("sense"):
            x = {k: ", ".join(e.text for e in s.findall(tag) if e.text)
                 for k, tag in (("field", "field"), ("dialect", "dial"), ("info", "s_inf"))}
            senses.append({k: v for k, v in x.items() if v})
        if any(senses):
            out[int(entry.findtext("ent_seq"))] = senses
    return out


@cache
def _sentence_checks() -> tuple[frozenset[int], dict[int, set[int]]]:
    """Sentences whose Japanese is wrong, and the words a sentence is filed under but lacks (D-041)."""
    if not SENTENCE_BG.exists():
        return frozenset(), {}
    d = json.loads(SENTENCE_BG.read_text(encoding="utf-8"))
    return frozenset(int(s) for s in d.get("broken", [])), {int(s): set(ids) for s, ids in d.get("notFor", {}).items()}


@cache
def _restricted() -> dict[int, dict[int, dict]]:
    if not RESTRICTIONS.exists():
        return {}
    return {int(w): {int(i): v for i, v in s.items()} for w, s in json.loads(RESTRICTIONS.read_text(encoding="utf-8")).items()}


def _sentences(wid: int) -> list[str]:
    """Tatoeba indexes a word by any of its spellings (奇麗 for 綺麗), a word written only in kana by its kana."""
    db = ws.proposals.connect()
    rows = db.execute(
        "SELECT s.id, s.text FROM sentence_word sw JOIN sentence s ON s.id = sw.sentence_id "
        "WHERE sw.headword IN (SELECT text FROM word_form WHERE word_id = ?1 AND (kana = 0 OR NOT EXISTS "
        "(SELECT 1 FROM word_form k WHERE k.word_id = ?1 AND k.kana = 0)))", (wid,)).fetchall()
    broken, not_for = _sentence_checks()
    rows = [(i, t) for i, t in rows if i not in broken and wid not in not_for.get(i, ())]
    texts = sorted({_tatoeba().get(i) or _surface(t) for i, t in rows}, key=len)
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


def _only(wid: int, i: int) -> dict:
    """{"only": "read このかん"} where JMdict keeps sense i to another reading or spelling (D-037)."""
    r = _restricted().get(wid, {}).get(i)
    if not r:
        return {}
    return {"only": "; ".join(([f"read {'/'.join(r['r'])}"] if r.get("r") else []) +
                              ([f"written {'/'.join(r['k'])}"] if r.get("k") else []))}


def _item(wid: int, syn: dict[int, dict[int, list[str]]]) -> dict:
    w = ws.scope()[wid]
    return {
        "id": wid, "word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"],
        "senses": [{"n": i + 1, "pos": pos, "misc": misc, **_only(wid, i), "gloss": gloss,
                    "synonyms": syn.get(wid, {}).get(i, [])}
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


def _common_ids() -> list[int]:
    """The common words with no JLPT level, most frequent first (JMdict's nf, then id: the same order every time)."""
    sc = ws.scope()
    return sorted((w for w, x in sc.items() if x["common"] and not x["jlpt"]), key=lambda w: (sc[w]["nf"], w))


def prepare(pilot: bool, size: int, common: bool = False) -> None:
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    syn = _synonyms()
    if common:
        if any(IN.glob(f"{COMMON}-*.json")):
            raise SystemExit(f"{IN} has {COMMON} batches already: they are cut once (see `status`)")
        noted = set(json.loads(SITE.read_text(encoding="utf-8"))) if SITE.exists() else set()
        ids = [w for w in _common_ids() if str(w) not in noted]
        for b, i in enumerate(range(0, len(ids), COMMON_SIZE)):
            name = f"{COMMON}-{b:03d}"
            ws._dump(IN / f"{name}.json", {"batch": name, "items": [_item(w, syn) for w in ids[i:i + COMMON_SIZE]]})
        print(f"{COMMON}: {len(ids)} words, {sum(len(ws.scope()[w]['senses'][:ws.SENSES]) for w in ids)} senses, "
              f"{-(-len(ids) // COMMON_SIZE)} batches")
        return
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
        if not only and not (OUT / f"{b}.json").exists():
            continue  # not drafted yet: `status` lists those
        good, probs = _problems(b)
        total += len(good)
        if probs or only:
            print(f"{b}: {len(good)} valid words, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{total} valid words in {len(batches)} batches")


def _drafts() -> dict:
    out = {}
    for p in sorted(IN.glob("*.json")):
        if not (OUT / p.name).exists():
            continue  # a K batch not drafted yet
        good, probs = _problems(p.stem)
        if probs:
            print(f"{p.stem}: {len(probs)} problems, {len(good)} words taken")
        out.update(good)
    return out


def verify_prepare(size: int, start: int) -> None:
    """Every drafted note to an Opus check, with what pipeline/sense_evidence.py found beside it.
    From batch `start` on, and never over a batch already checked: the batches are the same
    words every time (ranked, then cut), so a rerun only refreshes what the check has not read."""
    VIN.mkdir(parents=True, exist_ok=True)
    VOUT.mkdir(parents=True, exist_ok=True)
    notes = _drafts()
    ev = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    common = _batch_words(COMMON)
    ids = sorted((int(k) for k in notes if int(k) not in common), key=ws._rank)
    written = 0
    for b, i in enumerate(range(0, len(ids), size)):
        name = f"V-{b:03d}"
        if b < start or (VOUT / f"{name}.json").exists():
            continue
        ws._dump(VIN / f"{name}.json", {"batch": name, "items": [_verify_item(w, notes, ev) for w in ids[i:i + size]]})
        written += 1
    print(f"V: {len(ids)} words, {sum(len(notes[str(w)]) for w in ids)} senses, {-(-len(ids) // size)} batches; "
          f"{written} written from V-{start:03d}")


def _verify_item(wid: int, notes: dict, ev: dict) -> dict:
    k, w = str(wid), ws.scope()[wid]
    flags, offer = ev["flags"].get(k, []), ev["offer"].get(k, {})
    ext = _jmdict_extras().get(wid, [])
    return {
        "id": wid, "word": w["word"], "reading": w["reading"], "jlpt": w["jlpt"],
        "senses": [{"n": n + 1, "pos": pos, "misc": misc, **_only(wid, n), **(ext[n] if n < len(ext) else {}),
                    "gloss": gloss, "note": notes[k][n],
                    **({"flags": [f"{kind}{': ' + d if d else ''}" for s, kind, d in flags if s == n]}
                       if any(s == n for s, _, _ in flags) else {}),
                    **({"offered": [{"ja": o["ja"], "en": o["en"]} for o in offer[str(n)]]} if str(n) in offer else {})}
                   for n, (pos, misc, gloss) in enumerate(w["senses"][:len(notes[k])])],
        "sentences": _sentences(wid),
    }


def _batch_words(kind: str) -> dict[int, str]:
    """Word id -> the batch of this kind it is in."""
    return {it["id"]: p.stem for p in sorted(IN.glob(f"{kind}-*.json")) for it in ws._read(p)["items"]}


def _evidence_fresh(batches: list[str]) -> bool:
    """sense_evidence.py read these batches' drafts: its file is newer than each of their out files."""
    return EVIDENCE.exists() and all((OUT / f"{b}.json").stat().st_mtime < EVIDENCE.stat().st_mtime for b in batches)


def verify_prepare_common() -> None:
    """VK-n for each K-n that checks clean and has no VK-n yet: the same words, so the two series stay in step."""
    VIN.mkdir(parents=True, exist_ok=True)
    VOUT.mkdir(parents=True, exist_ok=True)
    ready = [p.stem for p in sorted(IN.glob(f"{COMMON}-*.json"))
             if (OUT / p.name).exists() and not (VIN / f"V{p.name}").exists() and not _problems(p.stem)[1]]
    if not ready:
        print("no K batch is drafted, clean and without its VK batch")
        return
    if not _evidence_fresh(ready):
        raise SystemExit("evidence.json is older than some of these drafts: run pipeline/sense_evidence.py first")
    notes, ev = _drafts(), json.loads(EVIDENCE.read_text(encoding="utf-8"))
    for b in ready:
        name = f"V{b}"
        ws._dump(VIN / f"{name}.json", {"batch": name, "items": [_verify_item(it["id"], notes, ev)
                                                                  for it in ws._read(IN / f"{b}.json")["items"]]})
    print(f"{len(ready)} VK batches written: {ready[0]} .. {ready[-1]}")


def _verdicts(batch: str) -> tuple[dict, list[str]]:
    """{word id: [None (ok) | {rank?, nuance?, ex?, why}]} for one V batch."""
    src = ws._read(VIN / f"{batch}.json")
    path = VOUT / f"{batch}.json"
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
        vs = items.get(wid)
        if not isinstance(vs, list) or len(vs) != len(it["senses"]):
            probs.append(f"{batch}: {wid} {it['word']} needs a list of {len(it['senses'])} verdicts")
            continue
        offered = set(it["sentences"]) | {o["ja"].replace("【", "").replace("】", "") for s in it["senses"] for o in s.get("offered", [])}
        out, after = [], []
        for s, v in zip(it["senses"], vs):
            where = f"{batch}: {wid} {it['word']} sense {s['n']}"
            if v == "ok":
                out.append(None)
                after.append(s["note"])
                continue
            if not isinstance(v, dict) or not isinstance(v.get("why"), str) or not v["why"].strip() \
                    or not ({"rank", "nuance", "ex"} & v.keys()) or v.keys() - {"rank", "nuance", "ex", "why"}:
                probs.append(f"{where}: \"ok\", or {{the fields that change (rank, nuance, ex), why}}")
                continue
            note = {**s["note"], **{f: v[f] for f in ("rank", "nuance", "ex") if f in v}}
            ex = note.get("ex")
            if note["rank"] not in ("main", "secondary", "rare"):
                probs.append(f"{where}: rank is main, secondary or rare")
            elif not isinstance(note["nuance"], str) or not note["nuance"].strip() or len(note["nuance"]) > NUANCE:
                probs.append(f"{where}: one nuance sentence, at most {NUANCE} characters")
            elif ex is not None and not (
                    isinstance(ex, dict) and all(isinstance(ex.get(f), str) and ex[f].strip() for f in ("ja", "en"))
                    and ex["ja"].count("【") == 1 and ex["ja"].count("】") == 1 and ex.get("src") in ("t", "d")):
                probs.append(f"{where}: ex is null or {{ja with the word in one 【】, en, src t|d}}")
            elif "ex" in v and ex and ex["src"] == "t" and ex["ja"].replace("【", "").replace("】", "") not in offered:
                probs.append(f"{where}: src t, but not one of `sentences` or `offered`, word for word")
            else:
                fix = {f: v[f] for f in ("rank", "nuance", "ex") if f in v}
                if fix.get("nuance"):
                    fix["nuance"] = fix["nuance"].strip()
                out.append({**fix, "why": v["why"].strip()})
                after.append(note)
                continue
            out.append("bad")
        if len(out) == len(it["senses"]) and "bad" not in out:
            if not any(n["rank"] == "main" for n in after):
                probs.append(f"{batch}: {wid} {it['word']}: at least one sense stays main")
            else:
                good[wid] = out
    return good, probs


def verify_check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in VIN.glob("*.json"))
    total, done = 0, 0
    for b in batches:
        good, probs = _verdicts(b)
        total += len(good)
        done += not probs
        if probs or only:
            print(f"{b}: {len(good)} valid words, {len(probs)} problems")
            for p in probs[:30]:
                print("   ", p)
    if not only:
        print(f"{total} valid words; {done} of {len(batches)} batches complete")


def merge() -> None:
    out = _drafts()
    fixed = Counter()
    checked = set()
    for p in sorted(VIN.glob("*.json")):
        if not (VOUT / p.name).exists():
            continue  # a VK batch not checked yet
        good, probs = _verdicts(p.stem)
        if probs:
            print(f"{p.stem}: {len(probs)} problems in the check, {len(good)} words taken")
        checked |= set(good)
        for wid, vs in good.items():
            for n, v in enumerate(vs):
                fixed["checked"] += 1
                if v:
                    out[wid][n] = {**out[wid][n], **{f: v[f] for f in ("rank", "nuance", "ex") if f in v}}
                    fixed.update(f for f in ("rank", "nuance", "ex") if f in v)
    unchecked = {str(w) for w in _batch_words(COMMON)} - checked
    out = {k: v for k, v in out.items() if k not in unchecked}  # a common word reaches the site once checked
    import origin_claims  # word-origin claims fixed once, by word and text
    origin = origin_claims.fixes()
    for wid, ns in out.items():
        for n, nt in enumerate(ns):
            if nt and (int(wid), nt.get("nuance")) in origin:
                ns[n] = {**nt, "nuance": origin[(int(wid), nt["nuance"])]}
                fixed["origin"] += 1
    import register_claims  # register claims checked once; a new example is one written for the dictionary
    for (wid, n), v in register_claims.fixes()[1].items():
        ns = out.get(str(wid)) or out.get(wid)
        if ns and n < len(ns) and ns[n]:
            if "text" in v:
                ns[n] = {**ns[n], "nuance": v["text"]}
            if "ex" in v:
                ns[n] = {**ns[n], "ex": v["ex"] and {**v["ex"], "src": "d"}}
            fixed["register"] += 1
    import sense_evidence
    print("Tatoeba examples:", sense_evidence.restore(out))
    ws._dump(SITE, out)
    print(f"{len(out)} words -> {SITE}" + (f"; checked {fixed['checked']} senses, fixed rank {fixed['rank']}, "
                                           f"nuance {fixed['nuance']}, ex {fixed['ex']}, origin {fixed['origin']}, register {fixed['register']}" if fixed else ""))


def status(show: int) -> None:
    """Where the common words (K, VK) stand, read from the files alone, and what to run next."""
    ks = sorted(p.stem for p in IN.glob(f"{COMMON}-*.json"))
    if not ks:
        print("No K batches yet. Run: python pipeline/sense_notes.py prepare --common")
        return
    todo, bad, clean = [], [], []
    for b in ks:
        if not (OUT / f"{b}.json").exists():
            todo.append(b)
        else:
            (bad if _problems(b)[1] else clean).append(b)
    vtodo, vbad, vdone, unwritten = [], [], [], []
    for b in clean:
        v = f"V{b}"
        if not (VIN / f"{v}.json").exists():
            unwritten.append(b)
        elif not (VOUT / f"{v}.json").exists():
            vtodo.append(v)
        else:
            (vbad if _verdicts(v)[1] else vdone).append(v)
    words = _batch_words(COMMON)
    site = set(json.loads(SITE.read_text(encoding="utf-8"))) if SITE.exists() else set()
    checked = {it["id"] for v in vdone for it in ws._read(VIN / f"{v}.json")["items"]}
    print(f"Common words: {len(words)} in {len(ks)} K batches of {COMMON_SIZE}, most frequent first")
    print(f"  drafted, clean      {len(clean):>4}")
    print(f"  drafted, problems   {len(bad):>4}  {' '.join(bad[:show])}")
    print(f"  not drafted         {len(todo):>4}  next: {' '.join(todo[:show])}")
    print(f"  check (VK) to write {len(unwritten):>4}  {' '.join(unwritten[:show])}")
    print(f"  check to run        {len(vtodo):>4}  next: {' '.join(vtodo[:show])}")
    print(f"  check, problems     {len(vbad):>4}  {' '.join(vbad[:show])}")
    print(f"  checked             {len(vdone):>4}  ({len(checked)} words)")
    print(f"  on the site         {sum(str(w) in site for w in words):>4} words; checked, not merged: "
          f"{sum(str(w) not in site for w in checked)}")
    print("\nNext, in this order (each step is safe to repeat; run status again after any of them):")
    if bad or vbad:
        print(f"  - Fix: a batch with problems has an out file that does not check. Run `check --batch K-n` or "
              f"`verify-check --batch VK-n` and give it back to an agent with the problems (or delete the out file to redo it).")
    if vtodo:
        print(f"  - Check: one Opus subagent per VK batch, prompt: \"Read pipeline/sense_notes_verify_prompt.md and "
              f"follow it for batch {vtodo[0]}.\" Its out file is verify/out/{vtodo[0]}.json.")
    if unwritten:
        stale = not _evidence_fresh(unwritten)
        print(f"  - Write the checks: {'python pipeline/sense_evidence.py, then ' if stale else ''}"
              f"python pipeline/sense_notes.py verify-prepare --common")
    if todo:
        print(f"  - Draft: one Sonnet subagent per K batch, prompt: \"Read pipeline/sense_notes_prompt.md and "
              f"follow it for batch {todo[0]}.\" Its out file is out/{todo[0]}.json.")
    if vdone and sum(str(w) not in site for w in checked):
        print("  - Put the checked words on the site: python pipeline/sense_notes.py merge; then their Bulgarian: "
              "pipeline/translate_bg.py (see its docstring)")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--pilot", action="store_true")
    p.add_argument("--common", action="store_true")
    p.add_argument("--size", type=int, default=40)
    p = sub.add_parser("check")
    p.add_argument("--batch")
    p = sub.add_parser("verify-prepare")
    p.add_argument("--common", action="store_true")
    p.add_argument("--size", type=int, default=60)
    p.add_argument("--start", type=int, default=0)
    p = sub.add_parser("verify-check")
    p.add_argument("--batch")
    sub.add_parser("merge")
    p = sub.add_parser("status")
    p.add_argument("--show", type=int, default=8)
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.pilot, a.size, a.common)
    elif a.cmd == "check":
        check(a.batch)
    elif a.cmd == "status":
        status(a.show)
    elif a.cmd == "verify-prepare" and a.common:
        verify_prepare_common()
    elif a.cmd == "verify-prepare":
        verify_prepare(a.size, a.start)
    elif a.cmd == "verify-check":
        verify_check(a.batch)
    else:
        merge()


if __name__ == "__main__":
    main()
