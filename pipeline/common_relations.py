"""Related words for the common words outside JLPT, in one Opus pass (Dani, 2026-10-25).

    python pipeline/common_relations.py prepare [--size 60]   # data/drafts/common-relations/in/C-*.json
    # one Opus subagent per in/*.json, each reading pipeline/common_relations_prompt.md
    python pipeline/common_relations.py check [--batch C-000]
    python pipeline/common_relations.py report
    python pipeline/word_synonyms.py export                    # adds the rows, both ways

The JLPT words took two Sonnet drafts, an Opus check, and then fix passes for
what the drafts got wrong the same way many times: short, polite and spoken
forms of one word taken for synonyms, "Native word" on Sino-Japanese words,
register labels true only beside the other word, a line on one side only,
kinds the box did not have (pair, polite, short, older, spoken), senses kept
to another reading. Here one pass writes the final rows with all of that in
the prompt, and a blind sample measures it (quality_sample "common").

Words: every common word with no JLPT level that has something to ask about
(candidates by shared English or WordNet, JMdict opposites, or words read the
same that share an English phrase), most frequent first. A word with none is
left out: what an agent would add from memory alone is too little for the
tokens. What the site shows already is given, and not asked again.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402

DRAFTS = ROOT / "data" / "drafts" / "common-relations"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
RESTRICTIONS = ROOT / "data" / "sense_restrictions.json"
SENSED = ("syn", "ant", "mix", "pair", "polite")
WHOLE = ("short", "older", "spoken")  # of the whole word, shown in the spellings row
KINDS = SENSED + WHOLE
REGISTERS = ("plain", "polite", "honorific", "humble")
LINE = {"syn": 160, "mix": 180}
SURE = 0.8  # what the site shows
# Tokens (2026-10-25): candidates were 80% of a batch. The best 10 of them, three short senses each.
CANDIDATES, OTHER_SENSES, GLOSS = 10, 3, 80


def _brief(wid: int) -> dict:
    return ws._brief(wid, OTHER_SENSES) | {"senses": [[s[0], s[1], s[3]] for s in ws.senses_of(wid, OTHER_SENSES, GLOSS)]}


def _restricted() -> dict[int, dict]:
    if not RESTRICTIONS.exists():
        return {}
    return {int(w): {int(i): v for i, v in s.items()} for w, s in json.loads(RESTRICTIONS.read_text(encoding="utf-8")).items()}


def _senses(wid: int, restricted: dict) -> list[list]:
    """[number, pos, tags, English], tags with "only read X" / "only written X" where JMdict keeps the sense so."""
    out = []
    for n, pos, misc, gloss in ws.senses_of(wid):
        r = restricted.get(wid, {}).get(n - 1)
        if r:
            only = ([f"only read {'/'.join(r['r'])}"] if r.get("r") else []) + ([f"only written {'/'.join(r['k'])}"] if r.get("k") else [])
            misc = ", ".join(x for x in (misc, *only) if x)
        out.append([n, pos, misc, gloss])
    return out


def _same_reading(words: dict) -> dict[int, list[int]]:
    """Words read the same that share a rare English phrase and are not one word (as ws.same_reading_pairs,
    without the JLPT condition)."""
    idx = ws._phrase_index()
    by_reading = defaultdict(list)
    for wid, w in words.items():
        by_reading[ws.hira(w["reading"])].append(wid)
    phrases = {wid: {p for _, _, g in w["senses"] for p in ws._phrases(g)} for wid, w in words.items()}
    out = defaultdict(list)
    for ids in by_reading.values():
        for a in ids:
            for b in ids:
                if a != b and not ws.same_word(a, b) and any(len(idx.get(p, ())) <= ws.DF_MAX for p in phrases[a] & phrases[b]):
                    out[a].append(b)
    return out


def _shown() -> dict[int, list[list]]:
    site = json.loads(ws.SITE.read_text(encoding="utf-8")) if ws.SITE.exists() else {}
    words = ws.scope()
    return {int(w): [[r[0] + 1 if r[0] >= 0 else None, r[1], words[r[2]]["word"], words[r[2]]["reading"], r[3]]
                     for r in rs if r[2] in words] for w, rs in site.items()}


def prepare(size: int) -> None:
    if any(IN.glob("C-*.json")):
        raise SystemExit(f"{IN} has batches already")
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    words, restricted, shown, same = ws.scope(), _restricted(), _shown(), _same_reading(ws.scope())
    entries, skipped = [], 0
    for wid in sorted((w for w, x in words.items() if not x["jlpt"]), key=lambda w: (ws._rank(w), w)):
        syn, ant = ws.candidates(wid)
        peers = same.get(wid, [])
        if not (syn or ant or peers):
            skipped += 1
            continue
        w = words[wid]
        entries.append({"id": wid, "word": w["word"], "reading": w["reading"], "senses": _senses(wid, restricted),
                        "candidates": [_brief(o) for o in syn[:CANDIDATES]], "opposites": [_brief(o) for o in ant],
                        **({"readTheSame": [_brief(o) for o in peers]} if peers else {}),
                        **({"shown": shown[wid]} if shown.get(wid) else {})})
    for b in range(0, len(entries), size):
        name = f"C-{b // size:03d}"
        (IN / f"{name}.json").write_text(json.dumps({"batch": name, "words": entries[b:b + size]}, ensure_ascii=False,
                                                    separators=(",", ":")), encoding="utf-8")
    print(f"{len(entries)} words in {-(-len(entries) // size)} batches ({skipped} with nothing to ask left out) -> {IN}")


def _resolve(it: dict, offered: dict[int, dict], strict: bool = False) -> tuple[int | None, str | None]:
    """The other word's id, or why it has none. An own word may carry the id of the entry meant, one of
    those spelled so; `strict` asks for it when there are several (D-039)."""
    own = isinstance(it.get("word"), str) and isinstance(it.get("reading"), str)
    if isinstance(it.get("id"), int):
        if it["id"] in offered:
            return it["id"], None
        if not own:
            return None, f"id {it['id']} was not offered; give word + reading"
        bad = ws.picked_homograph(it)
        return (None, bad) if bad else (it["id"], None)
    if not own:
        return None, "give id (an offered word) or word + reading"
    if strict and len(found := ws.homographs(it["word"], it["reading"])) > 1 and found[0] in ws.scope():
        return None, f"{it['word']} {it['reading']} is {len(found)} entries: add the id of the one meant. {ws.homograph_list(found)}"
    found = ws.resolve(it["word"], it["reading"])
    return (found[0], None) if found else (None, f"{it['word']} {it['reading']} is not in the dictionary's word list: drop it")


def verdicts(batch: str, strict: bool = False) -> tuple[dict[int, list[dict]], list[str]]:
    """A batch's items by word id. `strict` is the checker's: the batches done before its homograph
    rule (2026-10-27) are read as they were, so the export does not move."""
    src = ws._read(IN / f"{batch}.json")
    path = OUT / f"{batch}.json"
    if not path.exists():
        return {}, [f"{batch}: no output"]
    try:
        got = ws._read(path).get("words")
    except (json.JSONDecodeError, AttributeError) as e:
        return {}, [f"{batch}: not JSON with a `words` object ({e})"]
    if not isinstance(got, dict):
        return {}, [f"{batch}: no `words` object"]
    words = ws.scope()
    by = {str(e["id"]): e for e in src["words"]}
    probs = [f"{batch}: missing {k}" for k in by.keys() - got.keys()] + [f"{batch}: unknown {k}" for k in got.keys() - by.keys()]
    good = {}
    for k, items in got.items():
        e = by.get(k)
        if not e:
            continue
        wid, where = e["id"], f"{batch}: {k} {e['word']}"
        if not isinstance(items, list):
            probs.append(f"{where}: a list of items (empty if nothing)")
            continue
        offered = {o["id"]: o for f in ("candidates", "opposites", "readTheSame") for o in e.get(f, [])}
        out, seen = [], set()
        for n, it in enumerate(items, 1):
            at = f"{where} item {n}"
            if not isinstance(it, dict) or it.get("kind") not in KINDS:
                probs.append(f"{at}: kind is one of {', '.join(KINDS)}")
                continue
            kind = it["kind"]
            other, why = _resolve(it, offered, strict)
            if other is None:
                probs.append(f"{at}: {why}")
                continue
            if other == wid:
                probs.append(f"{at}: the word itself")
                continue
            o = words[other]
            if kind in ("syn", "ant") and ws.same_word(wid, other):
                probs.append(f"{at}: {o['word']} is a short or polite form of the same word: short, or leave it out")
                continue
            need = []
            if not isinstance(it.get("sure"), (int, float)) or not 0 <= it["sure"] <= 1:
                need.append("sure (0 to 1)")
            if kind in SENSED:
                if not isinstance(it.get("sense"), int) or not 1 <= it["sense"] <= len(e["senses"]):
                    need.append(f"sense (1 to {len(e['senses'])})")
                senses = ws.senses_of(other)
                listed = " | ".join(f"{s[0]}. {s[3][:60]}" for s in senses[:12])
                if not isinstance(it.get("otherSense"), int) or not 1 <= it["otherSense"] <= len(senses):
                    need.append(f"otherSense, the sense of {o['word']} {o['reading']} (id {other}) that matches: {listed}")
                elif ("id" not in it or other not in offered) and len(senses) > 1 and it.get("checked") is not True:
                    # An own word's senses were never shown: its otherSense was a guess (2026-10-25).
                    need.append(f'"checked": true once otherSense is the right one of {o["word"]} {o["reading"]}: {listed}')
            if kind in LINE:
                for f in ("line", "reverse"):
                    if not isinstance(it.get(f), str) or not it[f].strip() or len(it[f]) > LINE[kind]:
                        need.append(f"{f} (at most {LINE[kind]} characters)")
            if kind == "polite":
                reg = it.get("register")
                if not isinstance(reg, dict) or reg.get("word") not in REGISTERS or reg.get("other") not in REGISTERS or reg["word"] == reg["other"]:
                    need.append(f"register {{word, other}}, two different of {', '.join(REGISTERS)}")
            if kind in WHOLE and it.get("full") not in ("word", "other"):
                need.append("full: which one is the full or standard form, word or other")
            key = (it.get("sense") if kind in SENSED else None, other)
            if key in seen:
                need.append("not twice")
            if need:
                probs.append(f"{at} ({kind} {o['word']}): needs {'; '.join(need)}")
                continue
            seen.add(key)
            out.append({**it, "other": other})
        good[wid] = out
    return good, probs


def all_verdicts() -> dict[int, list[dict]]:
    """Every complete batch's items by word id, the other word resolved under `other`."""
    out = {}
    for p in sorted(IN.glob("C-*.json")) if IN.exists() else []:
        good, probs = verdicts(p.stem)
        if not probs:
            out.update(good)
    return out


# Rows the site shows that the run's agents flagged (`report`), and a few found while running, decided
# once (2026-10-26). By word pair, both ways, on the final rows: (word, other, what).
#   drop: the pair goes (rare, literary or slang use; a short form of one sense only; the same word)
#   mix: a synonym that is better a mix-up by meaning; its two lines stay
#   sense N: the pair moves to the word's sense N
#   spoken: a short form that is really a spoken form
#   other ID: the pair is with entry ID, spelled like `other` (D-039); sense numbers stay
FIXES = [
    (1217730, 1584680, "drop"),   # 顔 / 面 (おもて): literary
    (1269990, 1383690, "drop"),   # 後任 / 跡継ぎ: an heir, not the next holder of a post
    (1263960, 1546270, "drop"),   # 言い回し / 用語: a term, not a turn of phrase
    (1505550, 1179760, "drop"),   # 文通 / 往復: only in 往復書簡
    (1596470, 1477910, "drop"),   # 聡明 / 発明 "clever": old, rare
    (1305410, 1151120, "drop"),   # 仕返し / 挨拶 sense 5: rare ironic use
    (1843020, 1467640, "drop"),   # 芸妓 / 猫 "geisha": old slang
    (1140590, 2647190, "drop"),   # リーダー / 長 (おさ): literary
    (1566735, 1012100, "drop"),   # 彷徨く / 間誤付く "loiter": rare
    (1520920, 1520890, "drop"),   # 北極圏 / 北極: short form of one sense only
    (1670710, 1524810, "drop"),   # 幕の内 / 幕内: short form of the sumo sense only
    (1305380, 2013800, "drop"),   # 仕舞う / ちゃう: ちゃう shortens てしまう, not しまう
    (1119460, 1119470, "drop"),   # ベクター / ベクトル: one word, two spellings
    (1504190, 1504200, "drop"),   # 分別 ふんべつ / ぶんべつ: same spelling; the readings section's job (Dani)
    (1626800, 1111050, "drop"),   # 飛球 / フライ "deep-fried food": the fly-ball フライ is out of scope (D-039)
    (1303440, 1105970, "drop"),   # 散らし / ビラ "villa": the handbill ビラ is out of scope (D-039)
    (2780660, 1584800, "drop"),   # もの / 門 "gate": もん typed for もの, a form of もの itself (D-039)
    (1251780, 1401090, "mix"),    # 継承 / 相続
    (1180510, 1521990, "mix"),    # 押収 / 没収
    (1211440, 1211630, "mix"),    # 完結 / 完了
    (1019530, 1146810, "mix"),    # アルファベット / ローマ字
    (1150620, 1575660, "mix"),    # 愛嬌 / 愛想
    (1424290, 1213150, "mix"),    # 中国語 / 漢語
    (1361250, 1303400, "sense 3"),  # 振り切る / 撒く: break off from a pursuer
    (1624030, 1455670, "sense 2"),  # 独白 / 独り言: talking to oneself
    (1064480, 1375260, "sense 2"),  # ジェンダー / 性 sense 4: grammatical gender
    (1008190, 2450680, "spoken"),   # 詰らない / つまんない
    (1090480, 1124390, "other 2853387"),  # ナット / ボルト "volt": the bolt (D-039)
    (1104750, 1121740, "other 2855797"),  # ビジター / ホーム "platform": home (D-039)
]


def apply_fixes(out: dict[int, list], stats) -> None:
    """FIXES on word_synonyms.export's final rows (after mirroring)."""
    for w, o, what in FIXES:
        mine = [r for r in out.get(w, []) if r[2] == o]
        theirs = [r for r in out.get(o, []) if r[2] == w]
        if not (mine or theirs):
            stats["fix: pair not found"] += 1
            continue
        if what == "drop":
            out[w] = [r for r in out[w] if r[2] != o]
            out[o] = [r for r in out[o] if r[2] != w]
        elif what == "mix":
            for rs in (mine, theirs):
                for r in rs:
                    if r[1] == "syn":
                        r[1:] = ["mix", r[2], r[3], r[4], r[5] if len(r) > 5 else None, "meaning"]
        elif what.startswith("sense "):
            n = int(what.split()[1])
            for r in mine:
                r[0] = n - 1
            for r in theirs:
                r[3] = n
        elif what == "spoken":
            for r in mine + theirs:
                r[1] = r[1].replace("short", "spoken")
        elif what.startswith("other "):
            new = int(what.split()[1])
            for r in mine:
                r[2] = new
            out[o] = [r for r in out[o] if r[2] != w]
            out.setdefault(new, []).extend(theirs)
        stats[f"fix: {what.split()[0]}"] += 1


def rows() -> list[tuple[int, list, int, list]]:
    """(word, its row, other, the other's row) for every item sure enough, as word_synonyms.export adds them."""
    out = []
    for w, items in all_verdicts().items():
        for it in items:
            if it["sure"] < SURE:
                continue
            o, kind = it["other"], it["kind"]
            if kind in WHOLE:
                full, part = (o, w) if it["full"] == "other" else (w, o)
                out.append((full, [-1, kind, part, None, None], part, [-1, f"{kind}Of", full, None, None]))
                continue
            i, n = it["sense"] - 1, it["otherSense"]
            if kind == "syn":
                here, back = [i, kind, o, n, it["line"]], [n - 1, kind, w, i + 1, it["reverse"]]
            elif kind == "mix":
                why = it.get("why") if it.get("why") in ("sound", "meaning") else "meaning"
                here = [i, kind, o, n, it["line"], it["reverse"], why]
                back = [n - 1, kind, w, i + 1, it["reverse"], it["line"], why]
            elif kind == "polite":
                here = [i, kind, o, n, it["register"]["other"], it["register"]["word"]]
                back = [n - 1, kind, w, i + 1, it["register"]["word"], it["register"]["other"]]
            else:
                here, back = [i, kind, o, n, None], [n - 1, kind, w, i + 1, None]
            out.append((w, here, o, back))
    return out


def check(only: str | None) -> None:
    batches = [only] if only else sorted(p.stem for p in IN.glob("C-*.json"))
    done, c = 0, Counter()
    for b in batches:
        good, probs = verdicts(b, strict=True)
        done += not probs
        c.update(it["kind"] for items in good.values() for it in items)
        if probs or only:
            print(f"{b}: {len(good)} words valid, {len(probs)} problems")
            for p in probs[:40]:
                print("   ", p)
    print(f"{sum(c.values())} items, {dict(c)}; {done} of {len(batches)} batches complete")


def report() -> None:
    got = all_verdicts()
    items = [it for v in got.values() for it in v]
    print(f"{len(got)} words, {len(items)} items, {sum(it['sure'] >= SURE for it in items)} at {SURE} or more")
    print("by kind (sure enough):", dict(Counter(it["kind"] for it in items if it["sure"] >= SURE)))
    print("words with something:", sum(1 for v in got.values() if any(it["sure"] >= SURE for it in v)))
    flags = [(w, f) for p in sorted(OUT.glob("C-*.json")) for w, f in (ws._read(p).get("flags") or {}).items()]
    print(f"flags on rows shown already: {len(flags)}")
    for w, f in flags[:30]:
        print("  ", w, f)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare").add_argument("--size", type=int, default=60)
    sub.add_parser("check").add_argument("--batch")
    sub.add_parser("report")
    a = ap.parse_args()
    {"prepare": lambda: prepare(a.size), "check": lambda: check(a.batch), "report": report}[a.cmd]()


if __name__ == "__main__":
    main()
