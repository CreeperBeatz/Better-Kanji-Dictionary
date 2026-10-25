"""Synonyms and antonyms of words, one dictionary sense at a time.

    python pipeline/word_synonyms.py wiktionary          # once: Wiktionary's lists, resolved to our words
    python pipeline/word_synonyms.py prepare --pilot 200 [--size 40] [--runs A,B]
    # one Opus subagent per in/<run>-*.json, each reading pipeline/word_synonyms_prompt.md
    python pipeline/word_synonyms.py check [--batch A-000]
    python pipeline/word_synonyms.py skeptic-prepare [--size 120]
    # one Opus subagent per skeptic/in/*.json, each reading pipeline/word_synonyms_skeptic_prompt.md
    python pipeline/word_synonyms.py check-skeptic [--batch SAB-000]
    python pipeline/word_synonyms.py prepare-late --runs E,F   # JLPT words' senses after the first FIRST
    python pipeline/word_synonyms.py skeptic-recheck   # pairs whose other word had senses cut off, all shown
    python pipeline/word_synonyms.py same-reading-prepare   # words read the same that share a meaning (食料/食糧)
    # one Opus subagent per same-reading/in/*.json, each reading pipeline/word_synonyms_same_reading_prompt.md
    python pipeline/word_synonyms.py check-same-reading [--batch R-000]
    python pipeline/word_synonyms.py export   # -> data/word_synonyms.json, what the site shows
    # --runs C,D on skeptic-prepare, check-skeptic, evaluate and sample: another model's two runs
    # (prepare --runs C,D asks the same pilot words again)
    python pipeline/word_synonyms.py evaluate
    python pipeline/word_synonyms.py sample [--n 30]    # sample.md, for Dani to judge

A word sense's synonyms are other words a learner could use in its place, in
that sense, with a **nuance**: one line on how they differ. Its antonyms are
its plain opposites in that sense. Both point at a sense of the other word.
Only words in scope (common or JLPT) are offered or kept.

Candidates come from open data, with no language model (`candidates`):
JMdict senses with the same English phrase (a rare phrase counts more),
Japanese WordNet synsets, and JMdict's own cross-references (<xref>, <ant>).
Words read the same as the word are left out: those are spellings or
mix-ups (上る/登る), which the kanji page's mix-up block covers. A subagent
picks among them and may add words of its own, which are looked up in JMdict.

Wiktionary's synonym and antonym lists are **not** shown to the subagents,
so `evaluate` can check against them blind. They are also the fallback: if
the pilot is not good enough, only Wiktionary's pairs are used.

What counts (`combine`): a pair both runs give for the same sense, each at
least `bar` sure. `evaluate` reports several bars against the skeptic's
verdicts and Wiktionary, to choose one.

Drafts live in data/drafts/word-synonyms/ (untracked).
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
from functools import cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "word-synonyms")
SOURCES = proposals.ROOT / "pipeline" / "data"
WIKTIONARY = proposals.DRAFTS / "word-synonyms" / "wiktionary.json"  # whatever --drafts says

SENSES = 40  # of a word's JMdict senses, at most this many (JLPT words have up to 27)
FIRST = 8  # the runs A,B saw only this many; prepare --late drafts the rest
OTHER_SENSES = 4  # of a candidate's senses, shown to tell which one is meant
GLOSS = 140  # characters of a sense's English
CANDIDATES = 20  # synonym candidates per word
OPPOSITES = 6  # antonym candidates per word
MAX_SYN = 5  # per sense
MAX_ANT = 3  # per sense
NUANCE = 160  # characters
DF_MAX = 80  # an English phrase more words share than this says nothing
SYNSET_MAX = 25  # nor does a WordNet synset with more of our words than this
BARS = (0.9, 0.8, 0.7, 0.6)
SKEPTIC_BAR = 0.6  # pairs both runs give at least this sure go to the skeptic
FAR = {"arch", "obs", "rare"}

_KATA = str.maketrans({chr(c): chr(c - 0x60) for c in range(0x30A1, 0x30F7)})


def hira(s: str) -> str:
    return s.translate(_KATA)


def _dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- our words


@cache
def scope() -> dict[int, dict]:
    """Every common or JLPT word: headword, reading, rank, JLPT level, senses (all of them)."""
    db = proposals.connect()
    jlpt = dict(db.execute("SELECT word_id, MAX(level) FROM word_jlpt GROUP BY word_id"))
    out = {
        wid: {"id": wid, "word": head, "reading": reading, "common": common, "nf": nf or 99, "jlpt": jlpt.get(wid), "senses": []}
        for wid, head, reading, common, nf in db.execute("SELECT id, headword, reading, common, nf FROM word")
        if common or wid in jlpt
    }
    for wid, _, pos, misc, gloss in db.execute("SELECT word_id, ord, pos, misc, gloss FROM sense ORDER BY word_id, ord"):
        if wid in out:
            out[wid]["senses"].append((pos or "", misc or "", gloss))
    return out


def _rank(wid: int) -> tuple:
    w = scope()[wid]
    return (not w["common"], w["jlpt"] is None, w["nf"])


@cache
def forms() -> dict[str, list[tuple[int, str]]]:
    """Written form (kanji or kana) -> the scope words written so, with their readings, best first."""
    words = scope()
    out: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for wid, text in proposals.connect().execute("SELECT word_id, text FROM word_form"):
        if wid in words:
            out[text].append((wid, hira(words[wid]["reading"])))
    for w in words.values():  # the reading itself, for words written in kana
        out[w["reading"]].append((w["id"], hira(w["reading"])))
    return {t: sorted(set(v), key=lambda x: _rank(x[0])) for t, v in out.items()}


def resolve(text: str, reading: str | None = None, best: bool = True) -> list[int]:
    """Our words for a written form (and reading, when known): the best one, or all that match."""
    text = (text or "").strip().strip("【】[]「」")
    if text not in forms() and text.endswith("する") and len(text) > 2:  # 称賛する: JMdict files the noun
        text, reading = text[:-2], reading[:-2] if reading and reading.endswith("する") else reading
    found = forms().get(text) or []
    if reading:
        # A reading that matches none of them names another word (被る こうむる is not 被る かぶる).
        found = [x for x in found if x[1] == hira(reading)]
    ids = list(dict.fromkeys(w for w, _ in found))
    if re.fullmatch(r"[぀-ヿー]+", text):
        # Kana alone names the word headed so (はい yes, not 肺 lung), else one usually written
        # in kana (どう: 如何, not 銅), before a kanji word that only reads so.
        words = scope()
        ids.sort(key=lambda w: (words[w]["word"] != text, not _usually_kana(w)))
    return ids[:1] if best else ids


@cache
def _usually_kana(wid: int) -> bool:
    return any("uk" in (r[0] or "").split(",") for r in proposals.connect().execute(
        "SELECT misc FROM sense WHERE word_id = ? ORDER BY ord LIMIT 2", (wid,)))


def _short(gloss: str, n: int = GLOSS) -> str:
    return gloss if len(gloss) <= n else gloss[:n].rsplit(";", 1)[0]


def senses_of(wid: int, n: int = SENSES, chars: int = GLOSS) -> list[list]:
    return [[i + 1, pos, misc, _short(g, chars)] for i, (pos, misc, g) in enumerate(scope()[wid]["senses"][:n])]


def _brief(wid: int, n: int = OTHER_SENSES) -> dict:
    w = scope()[wid]
    return {"id": wid, "word": w["word"], "reading": w["reading"], "senses": [[s[0], s[1], s[3]] for s in senses_of(wid, n, 100)]}


# ---------------------------------------------------------------- Wiktionary


def _ruby_reading(text: str, ruby: list) -> str | None:
    """美しい + [[美, うつく]] -> うつくしい; None without ruby (kana words need none)."""
    if not ruby:
        return text if not any(ch > "ヿ" for ch in text) else None
    out, i = "", 0
    for pair in ruby:
        if len(pair) != 2:
            return None
        base, rt = pair
        j = text.find(base, i)
        if j < 0:
            return None
        out += text[i:j] + rt
        i = j + len(base)
    return out + text[i:]


def wiktionary() -> None:
    """Japanese entries' synonym and antonym lists, for our words, both ends resolved to our ids.

    Writes wiktionary.json: word id -> {"syn": [[other id, Wiktionary sense or ""]], "ant": [...]}.
    Junk in the lists ("see the following entry") resolves to nothing and drops out."""
    words = forms()
    out: dict[int, dict[str, dict[int, str]]] = defaultdict(lambda: {"syn": {}, "ant": {}})
    raw = SOURCES / "raw-wiktextract-data.jsonl.gz"
    entries = 0
    for line in gzip.open(raw, "rt", encoding="utf-8"):
        if '"lang_code": "ja"' not in line:
            continue
        e = json.loads(line)
        if e.get("lang_code") != "ja" or e.get("word") not in words:
            continue
        canon = next((f for f in e.get("forms", []) if "canonical" in (f.get("tags") or [])), None)
        reading = _ruby_reading(e["word"], canon.get("ruby") or []) if canon else None
        heads = resolve(e["word"], reading, best=False)
        if not heads:
            continue
        lists = [("syn", s, s.get("sense") or "") for s in e.get("synonyms", [])]
        lists += [("ant", s, s.get("sense") or "") for s in e.get("antonyms", [])]
        for sn in e.get("senses", []):
            gloss = "; ".join(sn.get("glosses") or [])
            lists += [("syn", s, gloss) for s in sn.get("synonyms", [])]
            lists += [("ant", s, gloss) for s in sn.get("antonyms", [])]
        if lists:
            entries += 1
        for kind, s, gloss in lists:
            word = s.get("word") or ""
            others = resolve(word, _ruby_reading(word, s.get("ruby") or []))
            for h in heads:
                for o in others:
                    if o != h and hira(scope()[o]["reading"]) != hira(scope()[h]["reading"]):
                        out[h][kind].setdefault(o, gloss)
    data = {str(h): {k: [[o, g] for o, g in v.items()] for k, v in d.items()} for h, d in out.items()}
    _dump(WIKTIONARY, data)
    print(f"{entries:,} Wiktionary entries with lists; {len(data):,} of our words get pairs:"
          f" {sum(len(d['syn']) for d in data.values()):,} synonyms, {sum(len(d['ant']) for d in data.values()):,} antonyms")


@cache
def wiktionary_pairs() -> dict[int, dict[str, set[int]]]:
    return {int(h): {k: {o for o, _ in v} for k, v in d.items()} for h, d in _read(WIKTIONARY).items()}


# ---------------------------------------------------------------- candidates


def _phrases(gloss: str) -> list[str]:
    out = []
    for p in gloss.split(";"):
        p = re.sub(r"\([^)]*\)", "", p).lower()
        p = re.sub(r"^(a|an|the) ", "", re.sub(r"\s+", " ", p).strip())
        if len(p) > 1:
            out.append(p)
    return out


@cache
def _phrase_index() -> dict[str, set[tuple[int, int]]]:
    idx: dict[str, set[tuple[int, int]]] = defaultdict(set)
    for wid, w in scope().items():
        for i, (_, _, g) in enumerate(w["senses"][:SENSES]):
            for p in _phrases(g):
                idx[p].add((wid, i))
    return idx


@cache
def _wordnet() -> tuple[dict[str, set[str]], dict[str, set[int]]]:
    """Lemma -> synsets, and synset -> our words (each lemma's best word)."""
    lemma_sets: dict[str, set[str]] = defaultdict(set)
    members: dict[str, set[int]] = defaultdict(set)
    for line in (SOURCES / "wn-data-jpn.tab").open(encoding="utf-8"):
        t = line.rstrip("\n").split("\t")
        if len(t) < 3 or t[1] != "jpn:lemma":
            continue
        lemma_sets[t[2]].add(t[0])
        for w in resolve(t[2]):
            members[t[0]].add(w)
    return lemma_sets, members


@cache
def _jmdict_refs() -> dict[int, list[tuple[int, str, int | None, str]]]:
    """Word id -> (sense index, xref|ant, target word, target sense number) from JMdict."""
    words = scope()
    out: dict[int, list] = defaultdict(list)
    text = gzip.open(SOURCES / "JMdict_e.gz", "rt", encoding="utf-8").read()
    raw: dict[int, list[tuple[int, str, list[str], int | None]]] = {}
    for m in re.finditer(r"<entry>.*?</entry>", text, re.S):
        e = m.group(0)
        wid = int(re.search(r"<ent_seq>(\d+)", e).group(1))
        if wid not in words:
            continue
        refs = raw.setdefault(wid, [])
        for i, s in enumerate(re.findall(r"<sense>.*?</sense>", e, re.S)):
            for kind, ref in re.findall(r"<(xref|ant)>([^<]*)</\1>", s):
                parts = ref.split("・")
                n = int(parts[-1]) if parts[-1].isdigit() else None
                refs.append((i, kind, [p for p in parts if not p.isdigit()], n))
    named = {wid: {p[0] for _, _, p, _ in refs} for wid, refs in raw.items()}
    for wid, refs in raw.items():
        mine = {words[wid]["word"], words[wid]["reading"]}
        for i, kind, parts, n in refs:
            if len(parts) > 1:
                targets = resolve(parts[0], parts[1])
            else:
                # A bare spelling several entries share (不便 ふべん / 不憫 ふびん, イエス yes / Jesus):
                # the one that names this word back, else the best.
                every = resolve(parts[0], None, best=False)
                back = [t for t in every if named.get(t, set()) & mine]
                targets = back[:1] or every[:1]
            for t in targets:
                out[wid].append((i, kind, t, n))
    return out


WIKTIONARY_CANDIDATES = False  # prepare --wiktionary
_POLITE = ("お", "ご", "御")
_TAILS = ("日", "に", "と", "的")  # 金曜/金曜日, 余り/余りに, 必然/必然的


def same_word(a: int, b: int) -> bool:
    """A short or polite form of the same word, which is no synonym (Dani, 2026-10-22):
    風呂/お風呂, 見舞い/お見舞い, 金曜/金曜日, 余り/余りに, 論ずる/論じる, 済ます/済ませる."""
    x, y = scope()[a], scope()[b]
    for p, q in ((x, y), (y, x)):
        for k in ("word", "reading"):
            s, t = p[k], q[k]
            if any(t == m + s for m in _POLITE) or any(t == s + m for m in _TAILS):
                return True
            if s.endswith("ずる") and t == s[:-2] + "じる":  # 論ずる/論じる
                return True
            if s.endswith("す") and t == s[:-1] + "せる":  # 済ます/済ませる, 任す/任せる
                return True
            if s.endswith("る") and t == s[:-1] + "りる":  # 足る/足りる
                return True
            if any(t[i] in "がにのっ" and t[:i] + t[i + 1:] == s for i in range(1, len(t) - 1)):  # 万一/万が一, 役立つ/役に立つ, 矢張り/矢っ張り
                return True
    return False


def candidates(wid: int, first: int = 0) -> tuple[list[int], list[int]]:
    """A word's synonym candidates (best first, every sense taking turns) and its antonym candidates;
    with `first`, for the senses after it only."""
    words = scope()
    me = words[wid]
    mine = {hira(me["reading"])} | {t for t, v in forms().items() if any(w == wid for w, _ in v)}
    idx = _phrase_index()

    def fine(o: int) -> bool:
        return (o != wid and o in words and hira(words[o]["reading"]) not in mine and words[o]["word"] not in mine
                and not same_word(wid, o))

    per_sense: list[Counter] = [Counter() for _ in me["senses"][:SENSES]]
    for i, (_, _, g) in enumerate(me["senses"][:SENSES]):
        if i < first:
            continue
        for p in _phrases(g):
            hits = {o for o, _ in idx.get(p, ())}
            if len(hits) > DF_MAX:
                continue
            for o in hits:
                if fine(o):
                    per_sense[i][o] += 1 / math.log2(1 + len(hits))
    opposites: list[int] = []
    for i, kind, o, _ in _jmdict_refs().get(wid, ()):
        if not fine(o) or not first <= i < SENSES:
            continue
        if kind == "ant":
            opposites.append(o)
        else:
            per_sense[i][o] += 0.6
    lemma_sets, members = _wordnet()
    wn = Counter()
    for text in {me["word"], *(t for t in mine if any(ch > "ヿ" for ch in t) or me["word"] == me["reading"])}:
        for s in lemma_sets.get(text, ()):
            peers = members.get(s, set())
            if len(peers) > SYNSET_MAX:
                continue
            for o in peers:
                if fine(o):
                    wn[o] += 0.8 / math.sqrt(max(1, len(peers) - 1))
    # Each sense in turn gives its next best; WordNet (no sense) takes a turn too,
    # and Wiktionary's list goes first when it is used (not in the pilot, which checked against it).
    lanes = [[o for o, _ in c.most_common()] for c in per_sense[first:]] + [[o for o, _ in wn.most_common()]]
    if WIKTIONARY_CANDIDATES:
        listed = wiktionary_pairs().get(wid, {})
        lanes.insert(0, [o for o in sorted(listed.get("syn", ()), key=_rank) if fine(o)])
        opposites = [o for o in sorted(listed.get("ant", ()), key=_rank) if fine(o)] + opposites
    picked: list[int] = []
    depth = 0
    while len(picked) < CANDIDATES and any(depth < len(lane) for lane in lanes):
        for lane in lanes:
            if depth < len(lane) and lane[depth] not in picked and len(picked) < CANDIDATES:
                picked.append(lane[depth])
        depth += 1
    return picked, list(dict.fromkeys(opposites))[:OPPOSITES]


# ---------------------------------------------------------------- batches


def _pilot_words(n: int, rng: random.Random) -> list[int]:
    """JLPT words, the same number from each level; 60% of them with a Wiktionary synonym, to check against."""
    wk = wiktionary_pairs()
    by_level: dict[int, list[int]] = defaultdict(list)
    for wid, w in scope().items():
        if w["jlpt"]:
            by_level[w["jlpt"]].append(wid)
    out: list[int] = []
    per = n // len(by_level)
    for level in sorted(by_level, reverse=True):
        pool = sorted(by_level[level])
        listed = [w for w in pool if wk.get(w, {}).get("syn")]
        rest = [w for w in pool if w not in set(listed)]
        k = min(len(listed), round(per * 0.6))
        out += rng.sample(listed, k) + rng.sample(rest, per - k)
    return out


def _entry(wid: int, rng: random.Random, shuffle: bool, first: int = 0) -> dict:
    """With `first`: only the senses after it (numbered as in JMdict); the answers are read as if padded."""
    w = scope()[wid]
    syn, ant = candidates(wid, first)
    if shuffle:
        syn = rng.sample(syn, len(syn))
    return {
        "id": wid, "word": w["word"], "reading": w["reading"], **({"first": first} if first else {}),
        "senses": senses_of(wid)[first:], "candidates": [_brief(o) for o in syn], "opposites": [_brief(o) for o in ant],
    }


def prepare(pilot: int, size: int, runs: list[str], jlpt: bool = False, skip: list[Path] = ()) -> None:
    """Batches for each run; a second call with new run names (another model) asks about the same words.
    With `jlpt`: every JLPT word but those a folder in `skip` asked about."""
    if any(f for r in runs for f in IN.glob(f"{r}-*.json")):
        raise SystemExit(f"{IN} has batches for {runs} already")
    rng = random.Random(17)
    if jlpt and not (DRAFTS / "pilot.json").exists():
        done = {w for f in skip for w in _read(proposals.folders(f)[0] / "pilot.json")["words"]}
        words = sorted(w for w, x in scope().items() if x["jlpt"] and w not in done)
        words = rng.sample(words, len(words))  # levels mixed, so batches are alike
        _dump(DRAFTS / "pilot.json", {"words": words})
    elif (DRAFTS / "pilot.json").exists():
        words = _read(DRAFTS / "pilot.json")["words"]
        rng = random.Random(17 + len(list(IN.glob("*.json"))))
    else:
        words = _pilot_words(pilot, rng)
        _dump(DRAFTS / "pilot.json", {"words": words})
    stats = Counter()
    for r, run in enumerate(runs):
        order = words if r == 0 else rng.sample(words, len(words))
        entries = [_entry(w, rng, shuffle=r > 0) for w in order]
        for e in entries:
            stats["candidates"] += len(e["candidates"])
            stats["opposites"] += len(e["opposites"])
        for b in range(0, len(entries), size):
            name = f"{run}-{b // size:03d}"
            _dump(IN / f"{name}.json", {"batch": name, "run": run, "words": entries[b:b + size]})
    print(f"{len(words)} words, {len(runs)} runs, {math.ceil(len(words) / size)} batches each;"
          f" {stats['candidates'] / len(words) / len(runs):.1f} candidates and {stats['opposites'] / len(words) / len(runs):.1f} opposites a word")


def prepare_late(size: int, runs: list[str]) -> None:
    """Runs A,B saw a word's first FIRST senses only: batches for the rest of every JLPT word's senses."""
    if any(f for r in runs for f in IN.glob(f"{r}-*.json")):
        raise SystemExit(f"{IN} has batches for {runs} already")
    rng = random.Random(23)
    words = sorted(w for w, x in scope().items() if x["jlpt"] and len(x["senses"]) > FIRST)
    for r, run in enumerate(runs):
        order = words if r == 0 else rng.sample(words, len(words))
        entries = [_entry(w, rng, shuffle=r > 0, first=FIRST) for w in order]
        for b in range(0, len(entries), size):
            name = f"{run}-{b // size:03d}"
            _dump(IN / f"{name}.json", {"batch": name, "run": run, "words": entries[b:b + size]})
    print(f"{len(words)} words, {sum(len(scope()[w]['senses']) - FIRST for w in words)} senses after the first {FIRST};"
          f" {len(runs)} runs, {math.ceil(len(words) / size)} batches each")


# ---------------------------------------------------------------- reading the runs


def _valid_item(it, offered: dict[int, int], own_ok: bool, kind: str) -> str | None:
    if not isinstance(it, dict):
        return "not an object"
    if "id" in it:
        if it["id"] not in offered:
            return f"id {it['id']} was not offered"
        n = it.get("sense")
        if not isinstance(n, int) or not 1 <= n <= offered[it["id"]]:
            return f"id {it['id']}: sense must be one of its numbers"
    elif own_ok and isinstance(it.get("word"), str) and isinstance(it.get("reading"), str):
        if "sense" in it and it["sense"] is not None and not isinstance(it["sense"], int):
            return f"{it['word']}: sense must be a number or null"
    else:
        return "needs an offered id, or a word and reading of your own"
    s = it.get("sure")
    if not isinstance(s, (int, float)) or not 0 <= s <= 1:
        return "sure must be 0.0 to 1.0"
    nu = it.get("nuance")
    if kind == "syn" and (not isinstance(nu, str) or not nu.strip()):
        return "a synonym needs a nuance"
    if nu is not None and (not isinstance(nu, str) or len(nu) > NUANCE):
        return f"nuance must be text of at most {NUANCE} characters"
    return None


def _valid(entry, w: dict) -> list[dict] | str:
    if not isinstance(entry, list) or len(entry) != len(w["senses"]):
        return f"needs exactly {len(w['senses'])} sense objects"
    syn = {c["id"]: len(scope()[c["id"]]["senses"][:SENSES]) for c in w["candidates"]}
    ant = {c["id"]: len(scope()[c["id"]]["senses"][:SENSES]) for c in w["opposites"]}
    for i, s in enumerate(entry):
        if not isinstance(s, dict) or not isinstance(s.get("syn", []), list) or not isinstance(s.get("ant", []), list):
            return f"sense {i + 1}: needs {{\"syn\": [...], \"ant\": [...]}}"
        if len(s.get("syn", [])) > MAX_SYN or len(s.get("ant", [])) > MAX_ANT:
            return f"sense {i + 1}: at most {MAX_SYN} synonyms and {MAX_ANT} antonyms"
        for kind, offered in (("syn", syn), ("ant", {**ant, **syn})):
            seen = set()
            for it in s.get(kind, []):
                bad = _valid_item(it, offered, True, kind)
                if bad:
                    return f"sense {i + 1} {kind}: {bad}"
                key = it.get("id") or (it["word"], it["reading"])
                if key in seen:
                    return f"sense {i + 1} {kind}: {key} twice"
                seen.add(key)
                if it.get("id") == w["id"] or (it.get("word") == w["word"] and hira(it.get("reading") or "") == hira(w["reading"])):
                    return f"sense {i + 1} {kind}: the word itself"
    return entry


def _inputs(run: str) -> dict[int, dict]:
    return {w["id"]: w for f in sorted(IN.glob(f"{run}-*.json")) for w in _read(f)["words"]}


def read_run(run: str, only: str | None = None) -> tuple[dict[int, list[dict]], list[str]]:
    good: dict[int, list[dict]] = {}
    problems: list[str] = []
    for inp, batch, got in proposals.outputs(IN, OUT, f"{only or run + '-*'}.json", problems):
        answers = got.get("words") if isinstance(got, dict) else None
        if not isinstance(answers, dict):
            problems.append(f"{inp.stem}: no \"words\" object")
            continue
        for w in batch["words"]:
            entry = answers.get(str(w["id"]))
            if entry is None:
                problems.append(f"{inp.stem}: {w['id']} {w['word']} missing")
                continue
            v = _valid(entry, w)
            if isinstance(v, str):
                problems.append(f"{inp.stem}: {w['id']} {w['word']}: {v}")
            else:
                good[w["id"]] = [{}] * w.get("first", 0) + v
        extra = set(answers) - {str(w["id"]) for w in batch["words"]}
        if extra:
            problems.append(f"{inp.stem}: ids not asked: {sorted(extra)[:5]}")
    return good, problems


def check(only: str | None = None) -> None:
    runs = sorted({f.stem.split("-")[0] for f in IN.glob("*.json")}) if not only else [only.split("-")[0]]
    for run in runs:
        good, problems = read_run(run, only)
        print(f"run {run}: {len(good)} words valid, {len(problems)} problems")
        for p in problems[:30]:
            print("   ", p)


def _pairs(run: dict[int, list[dict]]) -> tuple[dict[tuple, dict], Counter]:
    """(word, sense index, syn|ant, other word) -> what the run said; own words looked up."""
    out: dict[tuple, dict] = {}
    stats = Counter()
    for wid, entry in run.items():
        for i, s in enumerate(entry):
            for kind in ("syn", "ant"):
                for it in s.get(kind, []):
                    if "id" in it:
                        o, own = it["id"], False
                    else:
                        found = resolve(it["word"], it["reading"])
                        stats[f"{kind} own words"] += 1
                        if not found:
                            stats[f"{kind} own words not ours"] += 1
                            continue
                        o, own = found[0], True
                    if o == wid or same_word(wid, o):
                        stats[f"{kind} same word dropped"] += o != wid
                        continue
                    # Read the same: a spelling or a mix-up (眼鏡/メガネ), never a synonym.
                    # An antonym may share it (従兄弟/従姉妹).
                    if kind == "syn" and hira(scope()[o]["reading"]) == hira(scope()[wid]["reading"]):
                        stats["syn same reading dropped"] += 1
                        continue
                    out[(wid, i, kind, o)] = {"sure": float(it["sure"]), "sense": it.get("sense"), "nuance": (it.get("nuance") or "").strip(), "own": own}
    return out, stats


def combine(runs: tuple[str, ...] = ("A", "B")) -> tuple[dict[tuple, dict], Counter]:
    """Every pair any run gave, with each run's answer under its name; `both` = min sure, 0 if a run left it out."""
    got = [read_run(r)[0] for r in runs]
    done = set.intersection(*(set(g) for g in got))
    merged: dict[tuple, dict] = {}
    stats = Counter()
    for r, g in zip(runs, got):
        pairs, st = _pairs({w: e for w, e in g.items() if w in done})
        stats.update(st)
        for k, v in pairs.items():
            merged.setdefault(k, {})[r] = v
    for v in merged.values():
        v["both"] = min(v[r]["sure"] if r in v else 0.0 for r in runs)
    stats["words"] = len(done)
    return merged, stats


# ---------------------------------------------------------------- skeptic


def _sk_folders() -> tuple[Path, Path]:
    return DRAFTS / "skeptic" / "in", DRAFTS / "skeptic" / "out"


RUNS = ("A", "B")  # the two runs combined; --runs C,D for another model's


def _sk_name() -> str:
    return "S" + "".join(RUNS)


def _key(k: tuple) -> str:
    wid, i, kind, o = k
    return f"{wid}:{i + 1}:{kind}:{o}"


def skeptic_prepare(size: int) -> None:
    """Batches of the pairs both runs give at SKEPTIC_BAR that no earlier batch of this run pair holds."""
    sin, _ = _sk_folders()
    earlier = sorted(sin.glob(f"{_sk_name()}-*.json"))
    asked = {p["key"] for f in earlier for p in _read(f)["pairs"]}
    merged, _ = combine(RUNS)
    keys = sorted((k for k, v in merged.items() if v["both"] >= SKEPTIC_BAR and _key(k) not in asked), key=lambda k: (k[0], k[1], k[2]))
    items = []
    for k in keys:
        wid, i, kind, o = k
        w = scope()[wid]
        v = merged[k]
        items.append({
            "key": _key(k), "kind": "synonym" if kind == "syn" else "antonym",
            "word": {"word": w["word"], "reading": w["reading"], "sense": senses_of(wid)[i]},
            "other": _brief(o, SENSES),
            "nuances": list(dict.fromkeys(v[r]["nuance"] for r in RUNS if v[r]["nuance"])),
        })
    for b in range(0, len(items), size):
        name = f"{_sk_name()}-{len(earlier) + b // size:03d}"
        _dump(sin / f"{name}.json", {"batch": name, "pairs": items[b:b + size]})
    print(f"{len(items)} new pairs (both runs >= {SKEPTIC_BAR}) in {math.ceil(len(items) / size)} batches; {len(asked)} asked before")


def skeptic_recheck() -> None:
    """One more batch: the pairs asked before whose other word showed fewer senses than it has.
    A later batch's verdict replaces an earlier one's (read_skeptic reads them in order)."""
    sin, _ = _sk_folders()
    earlier = sorted(sin.glob(f"{_sk_name()}-*.json"))
    verdicts, _ = read_skeptic()
    items = {}
    for f in earlier:
        for p in _read(f)["pairs"]:
            o = p["other"]["id"]
            if len(p["other"]["senses"]) < len(scope()[o]["senses"][:SENSES]):
                a = verdicts.get(p["key"], {})
                given = p["nuances"] + ([a["nuance"]] if a.get("verdict") == "ok" and a.get("nuance") else [])
                items[p["key"]] = {**p, "other": _brief(o, SENSES), "nuances": list(dict.fromkeys(given))}
    name = f"{_sk_name()}-{len(earlier):03d}"
    _dump(sin / f"{name}.json", {"batch": name, "pairs": list(items.values())})
    print(f"{len(items)} pairs again, with all of the other word's senses, in {name}")


def read_skeptic(only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    sin, sout = _sk_folders()
    good: dict[str, dict] = {}
    problems: list[str] = []
    for inp, batch, got in proposals.outputs(sin, sout, f"{only or _sk_name() + '-*'}.json", problems):
        answers = got.get("pairs") if isinstance(got, dict) else None
        if not isinstance(answers, dict):
            problems.append(f"{inp.stem}: no \"pairs\" object")
            continue
        for p in batch["pairs"]:
            a = answers.get(p["key"])
            n_other = len(p["other"]["senses"])
            if not isinstance(a, dict) or a.get("verdict") not in ("ok", "doubtful", "wrong"):
                problems.append(f"{inp.stem}: {p['key']} needs a verdict ok/doubtful/wrong")
            elif a["verdict"] == "ok" and (not isinstance(a.get("sense"), int) or not 1 <= a["sense"] <= n_other):
                problems.append(f"{inp.stem}: {p['key']} ok needs the other word's sense number")
            elif a["verdict"] == "ok" and p["kind"] == "synonym" and (not isinstance(a.get("nuance"), str) or not a["nuance"].strip() or len(a["nuance"]) > NUANCE):
                problems.append(f"{inp.stem}: {p['key']} ok synonym needs a nuance of at most {NUANCE} characters")
            else:
                good[p["key"]] = a
    return good, problems


def check_skeptic(only: str | None = None) -> None:
    good, problems = read_skeptic(only)
    print(f"skeptic: {len(good)} pairs valid, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)


# ---------------------------------------------------------------- read the same

# The runs leave out every pair read the same: those are mix-ups as much as synonyms.
# This pass asks about them on their own (Dani 2026-10-24): near (食料/食糧), sound
# only (課程/過程), the same word (聞く/訊く). The site shows near and sound as
# "easy to mix up" under the sense, with a line on each word's page about the other.

SR_KINDS = ("near", "sound", "same", "wrong")
SR_LINE = 180  # characters


def _sr_folders() -> tuple[Path, Path]:
    return DRAFTS / "same-reading" / "in", DRAFTS / "same-reading" / "out"


def same_reading_pairs() -> list[tuple[int, int, list[str]]]:
    """Two words read the same, one of them JLPT, that share a rare English phrase and are not one word."""
    words, idx = scope(), _phrase_index()
    by_reading: dict[str, list[int]] = defaultdict(list)
    for wid, w in words.items():
        by_reading[hira(w["reading"])].append(wid)
    phrases = {wid: {p for _, _, g in w["senses"] for p in _phrases(g)} for wid, w in words.items()}
    out = []
    for ids in by_reading.values():
        for a in ids:
            for b in ids:
                if b <= a or not (words[a]["jlpt"] or words[b]["jlpt"]) or same_word(a, b):
                    continue
                shared = sorted(p for p in phrases[a] & phrases[b] if len(idx.get(p, ())) <= DF_MAX)
                if shared:
                    out.append((a, b, shared[:4]))
    return out


def same_reading_prepare(size: int) -> None:
    sin, sout = _sr_folders()
    sout.mkdir(parents=True, exist_ok=True)
    items = [{"key": f"{a}:{b}", "reading": hira(scope()[a]["reading"]),
              "a": {k: v for k, v in _brief(a, SENSES).items() if k != "id"},
              "b": {k: v for k, v in _brief(b, SENSES).items() if k != "id"}, "shared": shared}
             for a, b, shared in same_reading_pairs()]
    for i in range(0, len(items), size):
        name = f"R-{i // size:03d}"
        _dump(sin / f"{name}.json", {"batch": name, "items": items[i:i + size]})
    print(f"{len(items)} pairs read the same in {math.ceil(len(items) / size)} batches in {sin}")


def read_same_reading(only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    sin, sout = _sr_folders()
    good: dict[str, dict] = {}
    problems: list[str] = []
    for inp, batch, got in proposals.outputs(sin, sout, f"{only or 'R-*'}.json", problems):
        answers = got.get("items") if isinstance(got, dict) else None
        if not isinstance(answers, dict):
            problems.append(f"{inp.stem}: no \"items\" object")
            continue
        for it in batch["items"]:
            a = answers.get(it["key"])
            n = {"a": len(it["a"]["senses"]), "b": len(it["b"]["senses"])}
            if not isinstance(a, dict) or a.get("kind") not in SR_KINDS:
                problems.append(f"{inp.stem}: {it['key']} needs a kind: {', '.join(SR_KINDS)}")
            elif a["kind"] in ("near", "sound"):
                bad = [f"{x}Sense" for x in "ab" if not isinstance(a.get(f"{x}Sense"), int) or not 1 <= a[f"{x}Sense"] <= n[x]]
                bad += [f for f in ("onA", "onB") if not isinstance(a.get(f), str) or not a[f].strip() or len(a[f]) > SR_LINE]
                bad += [f"{f} says 'similar to'" for f in ("onA", "onB")
                        if re.search(r"\b(synonym of|similar to)\b", str(a.get(f)), re.I)]
                if bad:
                    problems.append(f"{inp.stem}: {it['key']}: fix {', '.join(bad)} (lines at most {SR_LINE} characters)")
                else:
                    good[it["key"]] = a
            elif not isinstance(a.get("why"), str) or not a["why"].strip():
                problems.append(f"{inp.stem}: {it['key']} {a['kind']} needs a short why")
            else:
                good[it["key"]] = a
        extra = set(answers) - {it["key"] for it in batch["items"]}
        if extra:
            problems.append(f"{inp.stem}: keys not asked: {sorted(extra)[:5]}")
    return good, problems


def check_same_reading(only: str | None = None) -> None:
    good, problems = read_same_reading(only)
    print(f"read the same: {len(good)} valid, {dict(Counter(a['kind'] for a in good.values()))}, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)


# ---------------------------------------------------------------- export

SITE = proposals.ROOT / "data" / "word_synonyms.json"
SELF = proposals.DRAFTS / "self-nuance" / "self.json"  # pipeline/self_nuance.py merge
KIND_ORDER = ("mix", "syn", "ant", "pair", "polite", "short", "shortOf", "older", "olderOf")  # as the page shows them
MIRRORED = proposals.DRAFTS / "word-synonyms-jlpt" / "mirrored.json"  # rows shown only by mirroring, for quality_sample
# Every run pair that went through the skeptic: the JLPT run, its senses past the 8th, the pilot.
SITE_RUNS = (("word-synonyms-jlpt", ("A", "B")), ("word-synonyms-jlpt", ("E", "F")), ("word-synonyms", ("C", "D")))
# Antonyms Dani decided that no run drafted: (word, sense, other, other's sense), senses from 1; shown both ways.
# 2026-10-24: 上 superior <-> 下 inferior, in place of 下位 (which pairs with 上位).
DECIDED_ANT = ((1352130, 5, 1184140, 5),)


def export(bar: float = 0.6) -> None:
    """data/word_synonyms.json: word id -> rows [sense index, kind, other id, other's sense, line, own line],
    kind syn / ant / mix (read the same). What the site shows under each sense. `line` says how the other
    differs (mix: when to write it); `own line`, how this word differs from it: the other word's row about
    this one, where it has one for the same senses, else drafted (pipeline/self_nuance.py)."""
    global DRAFTS, IN, OUT, RUNS
    saved = DRAFTS, IN, OUT, RUNS
    out: dict[int, list[list]] = defaultdict(list)
    seen: set[tuple] = set()
    stats = Counter()
    try:
        for folder, runs in SITE_RUNS:
            DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / folder)
            RUNS = runs
            for wid, entry in final(bar).items():
                for i, s in enumerate(entry):
                    for kind in ("syn", "ant"):
                        for it in s[kind]:
                            if (wid, i, kind, it["id"]) not in seen:
                                seen.add((wid, i, kind, it["id"]))
                                out[wid].append([i, kind, it["id"], it["sense"], it["nuance"] or None])
                                stats[kind] += 1
        DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "word-synonyms-jlpt")
        for key, a in read_same_reading()[0].items():
            if a["kind"] not in ("near", "sound"):
                continue
            x, y = map(int, key.split(":"))
            out[x].append([a["aSense"] - 1, "mix", y, a["bSense"], a["onA"].strip(), a["onB"].strip()])
            out[y].append([a["bSense"] - 1, "mix", x, a["aSense"], a["onB"].strip(), a["onA"].strip()])
            stats["mix"] += 2
        for x, a, y, b in DECIDED_ANT:
            for w, i, o, n in ((x, a - 1, y, b), (y, b - 1, x, a)):
                if (w, i, "ant", o) not in seen:
                    seen.add((w, i, "ant", o))
                    out[w].append([i, "ant", o, n, None])
                    stats["ant decided"] += 1
    finally:
        DRAFTS, IN, OUT, RUNS = saved
    # The second look at the weak spots (pipeline/synonym_recheck.py): a pair dropped goes from
    # both words; a line fixed replaces the one shown, and `reverse` the other word's line.
    import synonym_recheck
    lines, drop = {}, set()
    for k, v in synonym_recheck.all_verdicts().items():
        if not v:
            continue
        w, i, kind, o, n = k.split("|")
        here, back = (int(w), int(i), kind, int(o), int(n)), (int(o), int(n) - 1, kind, int(w), int(i) + 1)
        if v.get("drop"):
            drop |= {here, back}
        for f, row in (("line", here), ("reverse", back)):
            if f in v:
                lines[row] = v[f]
    for w in out:
        out[w] = [r for r in out[w] if (w, r[0], r[1], r[2], r[3]) not in drop]
        for r in out[w]:
            r[4] = lines.get((w, r[0], r[1], r[2], r[3]), r[4])
    stats["recheck dropped"], stats["recheck lines"] = len(drop), len(lines)
    out = defaultdict(list, {w: rs for w, rs in out.items() if rs})
    # Pairs removed wrongly (pipeline/synonym_removed.py, "keep"): back on both words, with their lines.
    import synonym_removed
    at = {(w, r[0], r[2]) for w, rs in out.items() for r in rs}
    for k, v in synonym_removed.all_verdicts().items():
        if v["verdict"] != "keep":
            continue
        w, _, kind, o = k.split("|")
        w, o, i, n = int(w), int(o), v["wordSense"] - 1, v["otherSense"]
        if (w, i, o) in at or (o, n - 1, w) in at:
            continue
        line, rev = (v["line"], v["reverse"]) if kind != "ant" else (None, None)
        out[w].append([i, kind, o, n, line] + ([rev] if kind == "mix" else []))
        out[o].append([n - 1, kind, w, i + 1, rev] + ([line] if kind == "mix" else []))
        at |= {(w, i, o), (o, n - 1, w)}
        stats[f"{kind} kept from removed"] += 1
    # Dani's kinds (pipeline/synonym_kinds.py): an opposite may now be a pair or a polite
    # form, a removed pair may fit a new box. Short and older forms are of the whole word
    # (sense -1), shown in its spellings row. Rows: pair [i, pair, o, n, None]; polite
    # [.., other's register, own register]; mix by meaning [.., line, own line, "meaning"].
    # One verdict per two words: an opposite shown under several senses (上 / 下) keeps all
    # of its rows, which change kind together; the verdict's senses add a row if new.
    import synonym_kinds
    for k, v in synonym_kinds.all_verdicts().items():
        w, _, o, _ = k.split("|")
        w, o, kind = int(w), int(o), v["kind"]
        if v["item"]["now"] == "ant" and kind != "ant":
            for a, b, reg in ((w, o, "word"), (o, w, "other")):
                kept = []
                for r in out[a]:
                    if r[1] != "ant" or r[2] != b:
                        kept.append(r)
                    elif kind == "pair":
                        kept.append([r[0], "pair", b, r[3], None])
                    elif kind == "polite":
                        mine, theirs = v["register"][reg], v["register"]["other" if reg == "word" else "word"]
                        kept.append([r[0], "polite", b, r[3], theirs, mine])
                out[a] = kept
        if kind in ("short", "older"):
            full, part = (o, w) if v["full"] == "other" else (w, o)
            out[part].append([-1, f"{kind}Of", full, None, None])
            out[full].append([-1, kind, part, None, None])
        elif kind != "none":
            i, n = v["wordSense"] - 1, v["otherSense"]
            if kind == "polite":
                mine, theirs = v["register"]["word"], v["register"]["other"]
                rows = [i, kind, o, n, theirs, mine], [n - 1, kind, w, i + 1, mine, theirs]
            elif kind == "mix":
                rows = [i, kind, o, n, v["line"], v["reverse"], "meaning"], [n - 1, kind, w, i + 1, v["reverse"], v["line"], "meaning"]
            else:
                rows = [i, kind, o, n, None], [n - 1, kind, w, i + 1, None]
            for a, row in zip((w, o), rows):  # each side apart: before mirroring, a row may be on one only
                if (row[0], row[2]) not in {(r[0], r[2]) for r in out[a]}:
                    out[a].append(row)
        stats[f"kinds: {v['item']['now']} -> {kind}"] += 1
    fwd = {(w, r[0], r[2], r[3] - 1): r[4] for w, rs in out.items() for r in rs if r[1] == "syn"}
    drafted = _read(SELF)["word"] if SELF.exists() else {}
    for w, rs in out.items():
        for r in rs:
            if r[1] == "syn":
                i, _, o, n, _ = r
                own = fwd.get((o, n - 1, w, i)) or (drafted.get(f"{w}:{i}:{o}:{n - 1}") or {}).get("en")
                r.append(own)
                stats["own line"] += bool(own)
    # Every pair on both words' pages: a row the other word lacks is mirrored there. Its line says how this
    # word differs: the second look's `reverse` fix, else the own line; its own line is this row's line.
    have = {(w, r[0], r[2]) for w, rs in out.items() for r in rs}
    mirrored = []
    for w, rs in list(out.items()):
        for r in list(rs):
            i, kind, o, n = r[:4]
            if kind not in ("syn", "ant", "pair") or (o, n - 1, w) in have:
                continue
            line = lines.get((o, n - 1, kind, w, i + 1)) or (r[5] if kind == "syn" else None)
            out[o].append([n - 1, kind, w, i + 1, line] + ([r[4]] if kind == "syn" else []))
            have.add((o, n - 1, w))
            mirrored.append(f"{o}|{n - 1}|{kind}|{w}|{i + 1}")
            stats[f"{kind} mirrored"] += 1
            stats[f"{kind} mirrored without line"] += kind == "syn" and not line
    # Word-origin claims fixed once (pipeline/origin_claims.py): by word and text, wherever shown.
    import origin_claims
    origin = origin_claims.fixes()
    for w, rs in out.items():
        for r in rs:
            if r[1] == "syn":
                for f, who in ((4, r[2]), (5, w)):
                    if len(r) > f and (who, r[f]) in origin:
                        r[f] = origin[(who, r[f])]
                        stats["origin fixed"] += 1
    # Register claims checked once (pipeline/register_claims.py): by the word a line is about, the
    # word it is set against, and the text.
    import register_claims
    register, _ = register_claims.fixes()
    for w, rs in out.items():
        for r in rs:
            if r[1] in ("syn", "mix"):
                for f, about, against in ((4, r[2], w), (5, w, r[2])):
                    if len(r) > f and (about, against, r[f]) in register:
                        r[f] = register[(about, against, r[f])]
                        stats["register fixed"] += 1
    rows = {str(w): sorted(r, key=lambda r: (r[0], KIND_ORDER.index(r[1]))) for w, r in sorted(out.items())}
    SITE.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    _dump(MIRRORED, mirrored)
    print(f"{len(rows)} words, {dict(stats)} -> {SITE}")


# ---------------------------------------------------------------- evaluation


def evaluate() -> None:
    merged, stats = combine(RUNS)
    verdicts, _ = read_skeptic()
    wk = wiktionary_pairs()
    words = {k[0] for k in merged} | set(read_run(RUNS[0])[0])
    first = _inputs(RUNS[0])
    print(f"{stats['words']} words in both runs; own words: syn {stats['syn own words']} ({stats['syn own words not ours']} not ours),"
          f" ant {stats['ant own words']} ({stats['ant own words not ours']} not ours)")
    for kind in ("syn", "ant"):
        print(f"\n{kind}:")
        listed = {w: wk.get(w, {}).get(kind, set()) for w in words}
        asked = sum(1 for s in listed.values() if s)
        offered = {w: {c["id"] for c in first[w]["candidates"] + first[w]["opposites"]} for w in words if w in first}
        hit_c = sum(len(s & offered.get(w, set())) for w, s in listed.items())
        total = sum(len(s) for s in listed.values())
        print(f"  Wiktionary: {asked} pilot words list {total} {kind} of ours; {hit_c} ({hit_c / max(total, 1):.0%}) were among the candidates")
        any_run = {(k[0], k[3]) for k, v in merged.items() if k[2] == kind}
        hit_any = sum(1 for w, s in listed.items() for o in s if (w, o) in any_run)
        print(f"  any run gave {hit_any} ({hit_any / max(total, 1):.0%}) of Wiktionary's")
        for bar in BARS:
            kept = {k: v for k, v in merged.items() if k[2] == kind and v["both"] >= bar}
            ok = [verdicts.get(_key(k), {}).get("verdict") for k in kept]
            judged = [x for x in ok if x]
            senses = {(k[0], k[1]) for k in kept}
            pairs = {(k[0], k[3]) for k in kept}
            hit = sum(1 for w, s in listed.items() for o in s if (w, o) in pairs)
            own = sum(1 for v in kept.values() if any(v.get(r, {}).get("own") for r in RUNS))
            okc = Counter(judged)
            fixed = sum(1 for k in kept if verdicts.get(_key(k), {}).get("verdict") == "ok" and verdicts[_key(k)].get("fixed"))
            print(f"  bar {bar}: {len(kept)} pairs over {len(senses)} senses of {len({k[0] for k in kept})} words; own words {own};"
                  f" Wiktionary recall {hit / max(total, 1):.0%};"
                  f" skeptic ok {okc['ok']}/{len(judged)} ({okc['ok'] / max(len(judged), 1):.0%}), doubtful {okc['doubtful']}, wrong {okc['wrong']}"
                  + (f"; nuance rewritten in {fixed} of {okc['ok']} ok" if kind == "syn" else ""))
    # Agreement between the runs at all.
    for kind in ("syn", "ant"):
        a = {k for k, v in merged.items() if k[2] == kind and RUNS[0] in v}
        b = {k for k, v in merged.items() if k[2] == kind and RUNS[1] in v}
        print(f"\n{kind} run agreement: {RUNS[0]} {len(a)}, {RUNS[1]} {len(b)}, both {len(a & b)} ({len(a & b) / max(len(a | b), 1):.0%} of either)")


def final(bar: float) -> dict[int, list[dict]]:
    """Word -> per sense {syn, ant}: pairs both runs gave at `bar`, the skeptic's ok taken (and its sense and nuance)."""
    merged, _ = combine(RUNS)
    verdicts, _ = read_skeptic()
    out: dict[int, list[dict]] = {}
    for k, v in sorted(merged.items(), key=lambda kv: -kv[1]["both"]):
        a = verdicts.get(_key(k))
        if v["both"] < bar or not a or a["verdict"] != "ok":
            continue
        wid, i, kind, o = k
        entry = out.setdefault(wid, [{"syn": [], "ant": []} for _ in senses_of(wid)])
        entry[i][kind].append({"id": o, "sense": a["sense"], "nuance": (a.get("nuance") or "").strip(), "sure": v["both"]})
    return out


def sample(n: int, bar: float) -> None:
    """sample.md: n pilot words, each sense with what would go live at `bar`, and what the skeptic held back."""
    merged, _ = combine(RUNS)
    verdicts, _ = read_skeptic()
    wk = wiktionary_pairs()
    live = final(bar)
    words = _read(DRAFTS / "pilot.json")["words"]
    pick = sorted(random.Random(5).sample(words, min(n, len(words))), key=lambda w: -(scope()[w]["jlpt"] or 0))
    lines = [f"# Word synonyms pilot, runs {'+'.join(RUNS)}: {len(pick)} words (bar {bar}, skeptic ok)", "",
             "≈ synonym, ↔ antonym. *Held back* = both runs gave it, the skeptic did not say ok.",
             "W = Wiktionary lists it too.", ""]
    for wid in pick:
        w = scope()[wid]
        lines += [f"## {w['word']} 【{w['reading']}】 N{w['jlpt']}", ""]
        mine = live.get(wid)
        listed = wk.get(wid, {})
        for i, (num, pos, misc, gloss) in enumerate(senses_of(wid)):
            lines.append(f"{num}. *{gloss}*" + (f" ({misc})" if misc else ""))
            for kind, mark in (("syn", "≈"), ("ant", "↔")):
                for it in (mine[i][kind] if mine else []):
                    o = scope()[it["id"]]
                    og = scope()[it["id"]]["senses"][it["sense"] - 1][2] if it["sense"] <= len(o["senses"]) else ""
                    wmark = " W" if it["id"] in listed.get(kind, set()) else ""
                    lines.append(f"   - {mark} **{o['word']}** {o['reading']} ({_short(og, 60)}){wmark}: {it['nuance']}")
                held = [k for k, v in merged.items() if k[0] == wid and k[1] == i and k[2] == kind and v["both"] >= bar
                        and verdicts.get(_key(k), {}).get("verdict") not in (None, "ok")]
                for k in held:
                    o = scope()[k[3]]
                    lines.append(f"   - ~~{mark} {o['word']} {o['reading']}~~ held back ({verdicts[_key(k)]['verdict']}: {verdicts[_key(k)].get('why', '')})")
        missed = [o for kind in ("syn", "ant") for o in listed.get(kind, ()) if not any(
            it["id"] == o for s in (mine or []) for it in s[kind])]
        if missed:
            lines.append(f"\n   Wiktionary also lists: {', '.join(scope()[o]['word'] for o in missed)}")
        lines.append("")
    _dump_text = "\n".join(lines) + "\n"
    path = DRAFTS / f"sample-{''.join(RUNS)}.md"
    path.write_text(_dump_text, encoding="utf-8")
    print(f"wrote {path}")


def main() -> int:
    global DRAFTS, IN, OUT, RUNS, WIKTIONARY_CANDIDATES
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    proposals.drafts_arg(ap, "data/drafts/word-synonyms")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("wiktionary")
    p = sub.add_parser("prepare")
    p.add_argument("--pilot", type=int, default=200, help="this many JLPT words")
    p.add_argument("--jlpt", action="store_true", help="every JLPT word, instead of a pilot")
    p.add_argument("--skip", type=Path, action="append", default=[], help="a drafts folder whose words are done")
    p.add_argument("--wiktionary", action="store_true", help="Wiktionary's lists among the candidates")
    p.add_argument("--size", type=int, default=40, help="words per batch")
    p.add_argument("--runs", default="A,B")
    ck = sub.add_parser("check")
    ck.add_argument("--batch", help="just this batch, e.g. A-000")
    pl = sub.add_parser("prepare-late")
    pl.add_argument("--size", type=int, default=20)
    pl.add_argument("--runs", default="E,F")
    sr = sub.add_parser("skeptic-recheck")
    rp = sub.add_parser("same-reading-prepare")
    rp.add_argument("--size", type=int, default=70)
    rc = sub.add_parser("check-same-reading")
    rc.add_argument("--batch", help="just this batch, e.g. R-000")
    sub.add_parser("export")
    sp = sub.add_parser("skeptic-prepare")
    sp.add_argument("--size", type=int, default=120)
    cs = sub.add_parser("check-skeptic")
    cs.add_argument("--batch", help="just this batch, e.g. SAB-000")
    ev = sub.add_parser("evaluate")
    sm = sub.add_parser("sample")
    sm.add_argument("--n", type=int, default=30)
    sm.add_argument("--bar", type=float, default=0.8)
    for sp_ in (sp, sr, cs, ev, sm):
        sp_.add_argument("--runs", default="A,B", help="the two runs to combine, e.g. C,D for another model")
    args = ap.parse_args()
    if args.cmd in ("skeptic-prepare", "skeptic-recheck", "check-skeptic", "evaluate", "sample"):
        RUNS = tuple(args.runs.split(","))
    DRAFTS, IN, OUT = proposals.folders(args.drafts or DRAFTS)
    if args.cmd == "wiktionary":
        wiktionary()
    elif args.cmd == "prepare":
        WIKTIONARY_CANDIDATES = args.wiktionary
        prepare(args.pilot, args.size, args.runs.split(","), args.jlpt, args.skip)
    elif args.cmd == "check":
        check(args.batch)
    elif args.cmd == "prepare-late":
        WIKTIONARY_CANDIDATES = True
        prepare_late(args.size, args.runs.split(","))
    elif args.cmd == "same-reading-prepare":
        same_reading_prepare(args.size)
    elif args.cmd == "check-same-reading":
        check_same_reading(args.batch)
    elif args.cmd == "export":
        export()
    elif args.cmd == "skeptic-recheck":
        skeptic_recheck()
    elif args.cmd == "skeptic-prepare":
        skeptic_prepare(args.size)
    elif args.cmd == "check-skeptic":
        check_skeptic(args.batch)
    elif args.cmd == "evaluate":
        evaluate()
    else:
        sample(args.n, args.bar)
    return 0


if __name__ == "__main__":
    sys.exit(main())
