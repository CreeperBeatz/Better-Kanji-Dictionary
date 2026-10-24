"""What the dictionaries say about the sense notes, before any model checks them (Dani, 2026-10-24).

    python pipeline/sense_evidence.py         # -> data/drafts/sense-notes/evidence.json, and a report

The sense notes (pipeline/sense_notes.py) are Sonnet drafts. Two sources know
something about them without a model:

- JMdict tags a sense archaic, obsolete, rare, dated or historical; such a
  sense ranked "main" is suspect.
- The Tatoeba index (jpn_indices) tags many of its words with the JMdict sense
  they are used in: 為る(する)[01]{した}, and ~ where the example was checked as a
  good one. How often each sense is tagged says roughly how common it is, the
  tag of a chosen example says whether it is in the right sense, and a tagged
  sentence with its human translation can replace a drafted example.

Out, per word id: `flags` [[sense index, kind, detail]], and `offer` {sense
index: [{ja, en, id}, at most OFFER]}: tagged Tatoeba sentences, with their
human translation, for senses whose example was drafted, missing or tagged
another sense. Both go to the model check, which decides; nothing here changes
a note.

The tags are hints, not truth. They were made against an older JMdict, whose
senses have since been split and reordered: where a chosen example's tag and
its sense disagree (301 of 2,129 tagged, 2026-10-24) the tag was wrong in 8 of
10 read (鼻が詰まった tagged "packed", 傷が塞がる "clogged"). And they count what was
tagged, not all uses: sense 1 is tagged far more often than its share, so a
later sense never tagged says little. A "JMdict arch" main is mostly a
one-sense archaic word (天皇 すめらぎ): its rank is right, its nuance should say so.
"""

from __future__ import annotations

import bz2
import json
import re
import sys
import tarfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import word_synonyms as ws  # noqa: E402
from sense_notes import DRAFTS, EXAMPLE, SITE  # noqa: E402

RAW = ROOT / "pipeline" / "data"
OUT = DRAFTS / "evidence.json"
OLD = {"arch", "obs", "rare", "dated", "hist"}
OFFER = 3
# A sentence cut at its start is no example (as sense_notes._sentences).
CUT = "はがをにでともへや、。"
TOKEN = re.compile(r"^(?P<head>[^(\[{~]+)(?:\((?P<reading>[^)]*)\))?(?:\[(?P<sense>\d+)\])?(?:\{(?P<surface>[^}]*)\})?(?P<good>~)?$")


def _sentences(path: Path) -> dict[int, str]:
    out = {}
    with bz2.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            i, _, text = line.rstrip("\n").split("\t", 2)
            out[int(i)] = text
    return out


def _index():
    """Each indexed sentence: its id, its English id, and its tokens."""
    tar = tarfile.open(RAW / "jpn_indices.tar.bz2", "r:bz2")
    member = next(m for m in tar.getmembers() if m.name.endswith(".csv"))
    for raw in tar.extractfile(member):
        parts = raw.decode("utf-8").rstrip("\n").split("\t")
        if len(parts) < 3:
            continue
        try:
            yield int(parts[0]), int(parts[1]), [m for t in parts[2].split() if (m := TOKEN.match(t))]
        except ValueError:
            continue


def _word(head: str, reading: str | None, sc: dict) -> int | None:
    """The one word an index token names; the index adds a reading where the spelling is shared."""
    ids = ws.resolve(head, reading, best=False)
    if len(ids) > 1:
        ids = [w for w in ids if sc[w]["word"] == head] or ids
    return ids[0] if len(ids) == 1 else None


def _mark(text: str, surface: str) -> str | None:
    if text.count(surface) != 1:
        return None
    return text.replace(surface, f"【{surface}】")


def _plain(ja: str) -> str:
    return ja.replace("【", "").replace("】", "")


PUNCT = re.compile(r"[。、！？!?.,，．「」『』（）()・…\s　]")


def restore(notes: dict) -> dict:
    """Every Tatoeba example as Tatoeba writes it. The drafts took sentences rebuilt from
    the index, which drops punctuation and every word it does not index: names, figures
    (彼はチェスター区選出の議員に当選した came back 彼は区選出の議員に当選した). Where only
    punctuation was lost, the real text is put back. Where words were lost, the real
    sentence and its human translation replace it (the English was written for the broken
    one), if the word can be marked in it once; else it is listed."""
    jpn = _sentences(RAW / "tatoeba" / "jpn_sentences.tsv.bz2")
    eng = _sentences(RAW / "tatoeba" / "eng_sentences.tsv.bz2")
    real: dict[str, list[tuple[str, str | None]]] = defaultdict(list)
    for sid, eid, toks in _index():
        if sid in jpn:
            real["".join(m["surface"] if m["surface"] is not None else m["head"] for m in toks)].append((jpn[sid], eng.get(eid)))
    texts = set(jpn.values())
    stats, broken = Counter(), []
    for k, ns in notes.items():
        for i, n in enumerate(ns):
            ex = n.get("ex")
            if not ex or ex["src"] != "t":
                continue
            plain = _plain(ex["ja"])
            if plain in texts:
                stats["already real"] += 1
                continue
            word = ex["ja"][ex["ja"].index("【") + 1:ex["ja"].index("】")]
            found = real.get(plain, [])
            same = [(j, e) for j, e in found if PUNCT.sub("", j) == plain]
            if same:
                ja = _mark(same[0][0], word)
                if ja:
                    n["ex"] = {**ex, "ja": ja}
                    stats["punctuation back"] += 1
                    continue
            full = [(j, e) for j, e in found if e and len(j) <= EXAMPLE + 15 and _mark(j, word)]
            if full:
                j, e = min(full, key=lambda x: len(x[0]))
                n["ex"] = {"ja": _mark(j, word), "en": e, "src": "t"}
                stats["lost words: real sentence"] += 1
            else:
                broken.append({"id": int(k), "sense": i, "ex": ex, "real": [j for j, _ in found]})
                stats["lost words: listed"] += 1
    ws._dump(DRAFTS / "broken_examples.json", broken)
    return dict(stats)


def run() -> None:
    notes = json.loads(SITE.read_text(encoding="utf-8"))
    sc = ws.scope()
    jpn = _sentences(RAW / "tatoeba" / "jpn_sentences.tsv.bz2")
    eng = _sentences(RAW / "tatoeba" / "eng_sentences.tsv.bz2")

    tags: dict[int, Counter] = defaultdict(Counter)
    # The sentences a sense is tagged in: (good, length, id, ja marked, en).
    tagged: dict[tuple[int, int], list] = defaultdict(list)
    # The sense a word is tagged with in a sentence, by the sentence as sense_notes offered it.
    by_text: dict[tuple[int, str], set[int]] = defaultdict(set)
    stats = Counter()
    for sid, eid, toks in _index():
        rebuilt = "".join(m["surface"] if m["surface"] is not None else m["head"] for m in toks)
        for m in toks:
            if m["sense"] is None:
                continue
            stats["tagged"] += 1
            wid = _word(m["head"], m["reading"], sc)
            if wid is None or str(wid) not in notes:
                stats["no word" if wid is None else "out of scope"] += 1
                continue
            s = int(m["sense"]) - 1
            if s >= len(sc[wid]["senses"]):
                stats["sense past the entry"] += 1
                continue
            stats["counted"] += 1
            tags[wid][s] += 1
            by_text[(wid, rebuilt)].add(s)
            ja, en = jpn.get(sid), eng.get(eid)
            if ja and en and 6 <= len(ja) <= EXAMPLE + 1 and ja[0] not in CUT:
                marked = _mark(ja, m["surface"] or m["head"])
                if marked:
                    tagged[(wid, s)].append((not m["good"], len(ja), sid, marked, en))

    flags: dict[str, list] = defaultdict(list)
    offer: dict[str, dict] = defaultdict(dict)
    kinds = Counter()
    for k, ns in notes.items():
        wid = int(k)
        senses = sc[wid]["senses"]
        total = sum(tags[wid].values())
        top = tags[wid].most_common(1)[0][0] if total else None
        for i, n in enumerate(ns):
            misc = set((senses[i][1] or "").split(","))
            count = tags[wid][i]
            share = count / total if total else 0
            found = []
            if n["rank"] == "main" and misc & OLD:
                found.append(("main but JMdict " + "/".join(sorted(misc & OLD)), ""))
            if total >= 20 and len(ns) > 1:
                if n["rank"] == "main" and count == 0 and i > 0:
                    found.append(("main, never tagged", f"0 of {total}"))
                if n["rank"] == "rare" and count >= 5 and share >= 0.15:
                    found.append(("rare, often tagged", f"{count} of {total}"))
                if n["rank"] != "main" and i == top and share >= 0.4:
                    found.append(("most tagged, not main", f"{count} of {total}"))
            ex = n.get("ex")
            wrong = False
            if ex and ex["src"] == "t":
                seen = by_text.get((wid, _plain(ex["ja"])))
                if seen and i not in seen:
                    wrong = True
                    found.append(("example tagged another sense", ",".join(str(s + 1) for s in sorted(seen))))
            for kind, detail in found:
                flags[k].append([i, kind, detail])
                kinds[kind] += 1
            if (not ex or ex["src"] == "d" or wrong) and tagged.get((wid, i)):
                offer[k][str(i)] = [{"ja": ja, "en": en, "id": sid} for _, _, sid, ja, en in sorted(tagged[(wid, i)])[:OFFER]]
                kinds["offer for " + ("none" if not ex else "drafted" if ex["src"] == "d" else "tagged other")] += 1

    ws._dump(OUT, {"flags": flags, "offer": offer})
    print("index:", ", ".join(f"{k} {v:,}" for k, v in stats.items()))
    for kind, v in kinds.most_common():
        print(f"  {kind:32} {v:>6,}")
    print(f"{sum(map(len, flags.values())):,} flags over {len(flags):,} words, "
          f"{sum(map(len, offer.values())):,} senses offered tagged sentences -> {OUT}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
