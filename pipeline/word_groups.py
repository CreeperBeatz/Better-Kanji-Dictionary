"""Place the unsure words again, one dictionary sense at a time (D-025, D-026).

    python pipeline/word_groups.py prepare --pilot 50 [--size 150] [--runs A,B] [--extra-run C:250]
    # every other kanji with unsure words, one calibration word each, into a folder of its own
    python pipeline/word_groups.py --drafts data/drafts/word-groups prepare --all --size 250 --calibration 1         --skip data/drafts/word-groups-pilot
    # one Opus subagent per in/<run>-*.json, each reading pipeline/word_groups_prompt.md
    python pipeline/word_groups.py check [--batch A-000]
    python pipeline/word_groups.py evaluate
    python pipeline/word_groups.py sample [--n 30]
    python pipeline/word_groups.py load [--dry-run] [--review-dir DIR]
    python pipeline/word_groups.py nofit   # words no group of their kanji holds, both runs agreeing (D-027)

A drafted word shows on the site only when both drafting runs put it in one group,
each at least 0.8 sure (server/review.py DRAFT_WORD_MIN). 13,000 common words
miss that bar, 焼く and 守る among them, often because the word has two of
the kanji's meanings: 焼く is "burn" and "bake". Here the subagent does not pick
one group for the word: it puts each of the word's JMdict senses into one of the
kanji's groups. The word's **main** group is the group of its first sense; the
groups its other senses land in are its **extra** groups.

What counts (`combine`): a sense both runs put in the same group, each at
least `MAIN_SURE` (0.6) for the main group -- at the highest of `MAIN_BARS` that gives
one -- and `SURE` (0.8) for an extra one. The
word's main group is the first such sense's, in JMdict's order; the later
ones' are its extras (at most `MAX_EXTRAS`; not from senses JMdict marks
archaic, obsolete or rare). A word with no such sense is not placed. A main
group below 0.8 goes live only with the skeptic's `ok`, given for that same
main group: samples of 300 were 99.3% ok at 0.7-0.79 and 99.0% at 0.6-0.69, as
good as the 0.8 ones (2026-10-17). So every group a word is shown in has a
sense of it that both runs were sure of: 放つ "to fire" is unsure, but
"to set free" and "to emit" are not.

The batches hold each kanji's unsure words and, unmarked, a few of its words
that are live already (`calibration`): if the method disagrees with them, it is
not trusted. Kodansha is not shown to the subagents, so `evaluate` can check
the placements against it blind.

Drafts live in data/drafts/word-groups-pilot/ (untracked).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from proposals import CATCH_ALL, ROOT, review  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "word-groups-pilot")

SURE = 0.8  # the bar an extra group passes in both runs, and a main group with no skeptic verdict
MAIN_SURE = 0.6  # the lowest bar a main group passes in both runs, with a skeptic `ok` below SURE (review.SENSES_WORD_MIN)
MAIN_BARS = (SURE, 0.7, MAIN_SURE)  # tried in turn: a word sure at a higher bar keeps the main group it has there
MAX_EXTRAS = 2
NONE = "-"  # a sense no group holds: a far use of the word
FAR = {"arch", "obs", "rare"}  # senses that never give an extra group
SENSES = 8  # of a word's JMdict senses, at most this many
GLOSS = 140  # characters of a sense's English
KNOWN = 4  # live words shown with each group, to say what it holds
CALIBRATION = 5  # live words per kanji placed again, unmarked
MUST = "焼守育加揚明打放"  # the cases that showed the problem


def _unsure_and_live(data: dict) -> tuple[dict[str, list[int]], dict[str, dict[int, str]]]:
    """Each kanji's common words that no run placed surely and no person decided,
    and the words the site shows now (word id -> group)."""
    common = {r[0] for r in proposals.connect().execute("SELECT id FROM word WHERE common = 1")}
    accepted = set(data["live"]["word_sense"])
    unsure: dict[str, list[int]] = defaultdict(list)
    for i in data["items"].values():
        if i["type"] != "word_sense" or i["status"] != "open" or i["origin"] != "proposal" or i["subject"] in accepted:
            continue
        c, w = i["subject"].split("|")
        ev = i.get("evidence") if isinstance(i.get("evidence"), dict) else {}
        if int(w) in common and not (ev.get("agree") and (ev.get("confidence") or 0) >= review.DRAFT_WORD_MIN):
            unsure[c].append(int(w))
    live = {c: review.site_meanings(c)["placed"] for c in unsure}
    return dict(unsure), live


def _words(ids: list[int]) -> dict[int, dict]:
    db = proposals.connect()
    out: dict[int, dict] = {}
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        marks = ",".join("?" * len(part))
        for wid, head, reading in db.execute(f"SELECT id, headword, reading FROM word WHERE id IN ({marks})", part):
            out[wid] = {"id": wid, "word": head, "reading": reading, "senses": []}
        for wid, ord_, pos, misc, gloss in db.execute(
            f"SELECT word_id, ord, pos, misc, gloss FROM sense WHERE word_id IN ({marks}) ORDER BY word_id, ord", part
        ):
            s = out[wid]["senses"]
            if len(s) < SENSES:
                g = gloss if len(gloss) <= GLOSS else gloss[:GLOSS].rsplit(";", 1)[0]
                s.append([len(s) + 1, pos or "", misc or "", g])
    return out


def _kanji(c: str, words: list[int], live: dict[int, str], fetched: dict[int, dict]) -> dict:
    """The kanji's groups, each with a few live words it holds -- not the words asked
    about, so a calibration word's answer is not given -- and the words to place."""
    senses = [s for s in review.site_meanings(c)["senses"] or [] if s["id"] != CATCH_ALL]
    by_group: dict[str, list[int]] = defaultdict(list)
    for w, g in live.items():
        by_group[g].append(w)
    groups = []
    for s in senses:
        known = [w for w in [*(s.get("examples") or []), *by_group.get(s["id"], [])] if w in fetched and w not in words]
        groups.append({
            "id": proposals.short_id(s["id"]), "en": s.get("en"), "about": s.get("about"),
            "known": [f"{fetched[w]['word']} {fetched[w]['reading']}" for w in dict.fromkeys(known)][:KNOWN],
        })
    return {"char": c, "groups": groups, "words": [fetched[w] for w in words if w in fetched]}


def prepare(pilot: int | None, size: int, runs: list[str], extra: list[tuple[str, int]],
            calibration: int = CALIBRATION, skip: list[Path] = ()) -> None:
    """Batches for `pilot` kanji (焼守… first, then at random), or with `pilot` None for every
    kanji with unsure words but those another folder in `skip` asked about."""
    if any(IN.glob("*.json")):
        raise SystemExit(f"{IN} has batches already: delete the folder to start again")
    data = review._current()
    unsure, live = _unsure_and_live(data)
    rng = random.Random(17)
    if pilot is None:
        asked = {c for f in skip for c in json.loads((proposals.folders(f)[0] / "pilot.json").read_text(encoding="utf-8"))["chars"]}
        chars = sorted((c for c in unsure if c not in asked), key=lambda c: -len(unsure[c]))
    else:
        chars = [c for c in MUST if c in unsure]
        chars += rng.sample(sorted(c for c in unsure if c not in chars), pilot - len(chars))
    # Calibration: a few live words of each kanji, at random.
    calib: dict[str, list[int]] = {}
    for c in chars:
        sure = [w for w, g in live[c].items() if g != CATCH_ALL and w not in unsure[c]]
        calib[c] = rng.sample(sure, min(calibration, len(sure)))
    known_ids = {w for c in chars for w in live[c]}
    for c in chars:
        for s in review.site_meanings(c)["senses"] or []:
            known_ids |= set(s.get("examples") or [])
    fetched = _words(sorted(known_ids | {w for c in chars for w in unsure[c] + calib[c]}))
    kanji = [_kanji(c, unsure[c] + calib[c], live[c], fetched) for c in chars]
    DRAFTS.mkdir(parents=True, exist_ok=True)
    (DRAFTS / "pilot.json").write_text(json.dumps({"chars": chars, "calibration": calib, "unsure": {c: unsure[c] for c in chars}},
                                                  ensure_ascii=False), encoding="utf-8")
    for run, n in [*((r, size) for r in runs), *extra]:
        order = list(kanji) if run == runs[0] else rng.sample(kanji, len(kanji))
        batches = _batches(order, n)
        for i, b in enumerate(batches):
            # Another order of the words too, so a second opinion is not the first one again.
            b = b if run == runs[0] else [{**k, "words": rng.sample(k["words"], len(k["words"]))} for k in b]
            _write(IN / f"{run}-{i:03d}.json", {"batch": f"{run}-{i:03d}", "run": run, "kanji": b})
        print(f"run {run}: {len(batches)} batches of about {n} words")
    total = sum(len(k["words"]) for k in kanji)
    print(f"{len(chars)} kanji, {total} words ({sum(map(len, calib.values()))} calibration) -> {IN.relative_to(ROOT)}")


def _batches(kanji: list[dict], size: int) -> list[list[dict]]:
    """Whole kanji, about `size` words each: a kanji's words stay with its groups."""
    out, cur, n = [], [], 0
    for k in kanji:
        if cur and n + len(k["words"]) > size:
            out.append(cur)
            cur, n = [], 0
        cur.append(k)
        n += len(k["words"])
    if cur:
        out.append(cur)
    return out


def _write(path: Path, data: dict) -> None:
    """One word per line, so a batch reads easily."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for k in data["kanji"]:
        head = json.dumps({"char": k["char"], "groups": k["groups"]}, ensure_ascii=False)
        words = ",\n    ".join(json.dumps(w, ensure_ascii=False) for w in k["words"])
        lines.append(f'{head[:-1]}, "words": [\n    {words}\n  ]}}')
    path.write_text(f'{{"batch": "{data["batch"]}", "run": "{data["run"]}", "kanji": [\n  ' + ",\n  ".join(lines) + "\n]}\n",
                    encoding="utf-8")


# ---------------------------------------------------------------- reading the runs


def _valid(entry, k: dict) -> dict[int, list[tuple[str, float]]] | str:
    """A kanji's output as word id -> [(group, confidence)] per sense, or what is wrong with it."""
    if not isinstance(entry, dict):
        return "missing"
    ids = {g["id"] for g in k["groups"]} | {CATCH_ALL, NONE}
    out: dict[int, list[tuple[str, float]]] = {}
    for w in k["words"]:
        got = entry.get(str(w["id"]))
        if not isinstance(got, list) or len(got) != len(w["senses"]):
            return f"{w['word']}: wants {len(w['senses'])} senses"
        row = []
        for s in got:
            if not (isinstance(s, list) and len(s) == 2 and s[0] in ids and isinstance(s[1], (int, float)) and 0 <= s[1] <= 1):
                return f"{w['word']}: bad sense {s!r}"
            row.append((s[0], float(s[1])))
        out[w["id"]] = row
    if set(entry) - {str(w["id"]) for w in k["words"]}:
        return "ids that were not asked"
    return out


def read_run(run: str, only: str | None = None) -> tuple[dict[str, dict[int, list[tuple[str, float]]]], list[str]]:
    good: dict[str, dict] = {}
    problems: list[str] = []
    for inp, batch, got in proposals.outputs(IN, OUT, f"{only or run + '-*'}.json", problems):
        for k in batch["kanji"]:
            v = _valid((got.get("kanji") or {}).get(k["char"]), k)
            if isinstance(v, str):
                problems.append(f"{inp.stem} {k['char']}: {v}")
            else:
                good.setdefault(k["char"], {}).update(v)  # a kanji may span batches
    return good, problems


def derive(row: list[tuple[str, float]], senses: list[list]) -> tuple[tuple[str, float] | None, dict[str, float]]:
    """One run's (main group, its confidence) and extra groups (group -> confidence) for a word:
    the first sense's group that has one, and the others' of `SURE` or more."""
    main = next(((g, c) for g, c in row if g != NONE), None)
    extras: dict[str, float] = {}
    for (g, c), s in zip(row, senses):
        far = set(s[2].split(",")) & FAR
        if main and g not in (NONE, CATCH_ALL, main[0]) and not far and c >= SURE:
            extras[g] = max(extras.get(g, 0), c)
    return main, extras


def sure_senses(runs: list[list[tuple[str, float]]], senses: list[list], bar: float = SURE) -> dict[str, int]:
    """The groups, in JMdict's order, of the senses every run puts in the same group at `SURE`
    or more, each with the first such sense (0-based): each group shown is one a sense of the
    word holds, for sure. "-" holds none."""
    out: dict[str, int] = {}
    for i, s in enumerate(senses):
        picks = {r[i][0] for r in runs}
        if len(picks) == 1 and (g := picks.pop()) != NONE and min(r[i][1] for r in runs) >= bar:
            if g == CATCH_ALL and out:
                continue  # sound only in a later sense says nothing next to a real group
            if set(s[2].split(",")) & FAR and out:
                continue  # an archaic or rare sense adds no group
            out.setdefault(g, i)
    return out


def combine(runs: list[dict[int, list]], senses: dict[int, list], bars: tuple[float, ...] | None = None) -> dict[int, dict]:
    """Per word: `main`, the group of its first sense both runs are sure of (or of its very first
    sense, when they agree on it and another sense makes that group sure), and `extras`, those of
    its later ones (at most MAX_EXTRAS); a catch-all main has none. `a`, `b`: each run's own main."""
    out = {}
    for w in set(runs[0]) & set(runs[1]):
        # The highest bar that gives the word a group: lowering the bar must not change the
        # main group of a word already placed (and checked) at a higher one.
        at: dict[str, int] = {}
        for bar in bars or MAIN_BARS:
            if at := sure_senses([runs[0][w], runs[1][w]], senses[w], bar):
                break
        groups = list(at)
        # Its first sense leads when the runs agree on it and a sure sense holds that group too:
        # 放つ "to fire" (unsure) and "to emit" (sure) are "send out", before "to set free".
        first = {runs[0][w][0][0], runs[1][w][0][0]}
        if len(first) == 1 and (f := first.pop()) in groups:
            groups = [f, *(g for g in groups if g != f)]
            at[f] = 0
        main = groups[0] if groups else None
        # Extras only from senses both runs are sure of at the full bar.
        firm = sure_senses([runs[0][w], runs[1][w]], senses[w], SURE)
        extras = [g for g in firm if g not in (main, CATCH_ALL)][:MAX_EXTRAS] if main and main != CATCH_ALL else []
        ma, mb = derive(runs[0][w], senses[w])[0], derive(runs[1][w], senses[w])[0]
        where = {**{g: firm[g] for g in extras}, **({main: at[main]} if main else {})}
        out[w] = {"main": main, "extras": extras, "at": {g: n for g, n in where.items() if n},
                  "a": ma and ma[0], "b": mb and mb[0]}
    return out


def _inputs(run: str) -> dict[str, dict]:
    """Each kanji of a run's batches, its words gathered from every batch it spans."""
    out: dict[str, dict] = {}
    for f in sorted(IN.glob(f"{run}-*.json")):
        for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            if k["char"] in out:
                out[k["char"]]["words"] += k["words"]
            else:
                out[k["char"]] = {**k, "words": list(k["words"])}
    return out


def check(only: str | None = None) -> None:
    runs = sorted({f.stem.split("-")[0] for f in IN.glob("*.json")}) if not only else [only.split("-")[0]]
    for run in runs:
        good, problems = read_run(run, only)
        print(f"run {run}: {len(good)} kanji valid, {len(problems)} problems")
        for p in problems[:30]:
            print("   ", p)


# ---------------------------------------------------------------- evaluation


def _kodansha_mates(c: str, words: list[dict], sure: dict[int, str]) -> dict[int, str]:
    """For each word Kodansha lists under a sense: the group most of that sense's
    live words are in (the word itself left out). No majority, no entry."""
    from server import dictionaries

    v = dictionaries.view(c, [{"id": w["id"], "headword": w["word"], "reading": w["reading"]} for w in words])
    if "kodansha" not in v:
        return {}
    kv = v["kodansha"]
    senses: dict[str, set[int]] = defaultdict(set)
    for s in [*kv["senses"], *(s for h in kv["kun"] for s in h["senses"])]:
        for w in s["words"]:
            if w.get("id"):
                senses[s["key"]].add(w["id"])
    out = {}
    for ws in senses.values():
        for w in ws:
            cnt = Counter(sure[x] for x in ws if x != w and x in sure)
            top = cnt.most_common(2)
            if top and not (len(top) > 1 and top[0][1] == top[1][1]):
                out[w] = top[0][0]
    return out


def evaluate(pair: tuple[str, str] = ("A", "B"), extra: str | None = "C") -> dict:
    pilot = json.loads((DRAFTS / "pilot.json").read_text(encoding="utf-8"))
    kanji = _inputs(pair[0])
    data = review._current()
    a, pa = read_run(pair[0])
    b, pb = read_run(pair[1])
    print(f"runs {pair[0]}/{pair[1]}: {len(a)}/{len(b)} kanji valid ({len(pa)}/{len(pb)} problems)")
    stats = Counter()
    rows = []
    for c in pilot["chars"]:
        if c not in a or c not in b:
            continue
        k = kanji[c]
        senses = {w["id"]: w["senses"] for w in k["words"]}
        got = combine([a[c], b[c]], senses)
        live = review.site_meanings(c)["placed"]
        calib = set(pilot["calibration"][c])
        sure = {w: g for w, g in live.items() if w not in pilot["unsure"][c]}
        mates = _kodansha_mates(c, k["words"], {w: g for w, g in sure.items()})
        for w in k["words"]:
            r = got[w["id"]]
            main = r["main"] and proposals.sense_id(c, r["main"])
            extras = [proposals.sense_id(c, g) for g in r["extras"]]
            kind = "calib" if w["id"] in calib else "unsure"
            stats[f"{kind} words"] += 1
            stats[f"{kind} main agree"] += r["a"] == r["b"]
            if main:
                stats[f"{kind} placed"] += 1
                stats[f"{kind} with extras"] += bool(extras)
            if kind == "calib" and main:
                stats["calib main = live"] += main == live.get(w["id"])
                stats["calib live in main+extras"] += live.get(w["id"]) in [main, *extras]
            if kind == "unsure" and main and w["id"] in mates:
                stats["kodansha checked"] += 1
                stats["kodansha main"] += mates[w["id"]] == main
                stats["kodansha main+extras"] += mates[w["id"]] in [main, *extras]
            rows.append({"char": c, "id": w["id"], "word": w["word"], "reading": w["reading"], "kind": kind,
                         "main": r["main"], "extras": r["extras"], "a": r["a"], "b": r["b"],
                         "live": live.get(w["id"]), "senses": w["senses"]})
    def pct(x, y):
        return f"{stats[x]}/{stats[y]} ({stats[x] / max(stats[y], 1):.1%})"
    for kind in ("unsure", "calib"):
        print(f"{kind}: main agrees {pct(f'{kind} main agree', f'{kind} words')}, placed {pct(f'{kind} placed', f'{kind} words')}, "
              f"with extras {pct(f'{kind} with extras', f'{kind} placed')}")
    print(f"calibration: main = live {pct('calib main = live', 'calib placed')}, live among main+extras {pct('calib live in main+extras', 'calib placed')}")
    print(f"kodansha (blind, unsure words placed): main {pct('kodansha main', 'kodansha checked')}, "
          f"main or extra {pct('kodansha main+extras', 'kodansha checked')}")
    (DRAFTS / "evaluation.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    if extra and list(IN.glob(f"{extra}-*.json")):
        # The bigger batches against the same first run: does size cost agreement?
        c_, pc = read_run(extra)
        agree = n = 0
        for ch, v in c_.items():
            senses = {w["id"]: w["senses"] for w in kanji[ch]["words"]}
            for w, row in v.items():
                if ch in a and w in a[ch]:
                    n += 1
                    agree += (derive(row, senses[w])[0] or [None])[0] == (derive(a[ch][w], senses[w])[0] or [None])[0]
        _, pbb = read_run(pair[1])
        n2 = agree2 = 0
        for ch, v in b.items():
            senses = {w["id"]: w["senses"] for w in kanji[ch]["words"]}
            for w, row in v.items():
                if ch in a and w in a[ch]:
                    n2 += 1
                    agree2 += (derive(row, senses[w])[0] or [None])[0] == (derive(a[ch][w], senses[w])[0] or [None])[0]
        print(f"main agrees with {pair[0]}: run {pair[1]} (same size) {agree2}/{n2} ({agree2 / max(n2, 1):.1%}), "
              f"run {extra} (bigger batches) {agree}/{n} ({agree / max(n, 1):.1%}); {len(pc)} problems in {extra}")
    return stats


def sample(n: int) -> None:
    """A random sample of placed unsure words, for a person or a skeptic to check."""
    rows = json.loads((DRAFTS / "evaluation.json").read_text(encoding="utf-8"))
    groups = {}
    for k in _inputs("A").values():
        groups[k["char"]] = {g["id"]: g["en"] for g in k["groups"]}
    placed = [r for r in rows if r["kind"] == "unsure" and r["main"]]
    rng = random.Random(3)
    lines = []
    for r in rng.sample(placed, min(n, len(placed))):
        g = groups[r["char"]]
        name = lambda x: f"{x} ({g.get(x, x)})"
        senses = "; ".join(f"{s[0]}. {s[3]}" for s in r["senses"][:4])
        extra = ", ".join(name(x) for x in r["extras"]) or "none"
        lines.append(f"- **{r['word']}** {r['reading']} [{r['char']}] → {name(r['main'])}; extra: {extra}\n  {senses}")
    out = DRAFTS / "sample.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(lines)} words -> {out.relative_to(ROOT)}")


def nofit() -> None:
    """The words both runs put in no group in any sense: each points to a meaning its kanji's
    groups lack (自 "from" in 出自), or a word for a person to place. Written to nofit.json."""
    kanji = _inputs("A")
    a, _ = read_run("A")
    b, _ = read_run("B")
    out = []
    for c, k in kanji.items():
        groups = ", ".join(g["en"] or g["id"] for g in k["groups"])
        for w in k["words"]:
            ra, rb = a.get(c, {}).get(w["id"]), b.get(c, {}).get(w["id"])
            if ra and rb and all(g == NONE for g, _ in ra) and all(g == NONE for g, _ in rb):
                out.append({"char": c, "id": w["id"], "word": w["word"], "reading": w["reading"],
                            "gloss": w["senses"][0][3], "groups": groups})
    (DRAFTS / "nofit.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} words in {len({r['char'] for r in out})} kanji -> {(DRAFTS / 'nofit.json').relative_to(ROOT)}")
    for r in out:
        print(f"  {r['char']}  {r['word']} {r['reading']}: {r['gloss'][:50]}  | groups: {r['groups'][:60]}")


SOURCE = "ai:claude-opus"


def _backing(runs: list[list[tuple[str, float]]], group: str) -> list[float]:
    """Each run's confidence on the first sense both put in `group`, the surest such sense."""
    best = max((min(r[i][1] for r in runs), i) for i in range(len(runs[0])) if all(r[i][0] == group for r in runs))
    if best[0] >= MAIN_SURE:
        i = best[1]
        return [r[i][1] for r in runs]
    return [r[0][1] for r in runs]


def _checked() -> dict[str, str]:
    """The main group each skeptic verdict was given for, by "char|word id", from the batches it read."""
    out: dict[str, str] = {}
    for folder in {DRAFTS, DRAFTS.parent / "word-groups", DRAFTS.parent / "word-groups-exp"}:
        for f in [*folder.glob("skeptic/in-*.json"), *folder.glob("band*-in-*.json"), *folder.glob("skeptic-in.json")]:
            for e in json.loads(f.read_text(encoding="utf-8")):
                out.setdefault(e.get("key") or f"{e['char']}|{e['id']}", e["main"])
    return out


def _skeptic() -> dict[str, dict]:
    """The skeptic pass's verdicts, by "char|word id": skeptic/out-*.json, and the pilot's
    skeptic-out.json (keyed by word id alone; a word under two of its kanji gets the verdict on both)."""
    out: dict[str, dict] = {}
    for f in sorted((DRAFTS / "skeptic").glob("out-*.json")):
        out.update(json.loads(f.read_text(encoding="utf-8"))["verdicts"])
    single = DRAFTS / "skeptic-out.json"
    if single.exists():
        by_id = json.loads(single.read_text(encoding="utf-8"))["verdicts"]
        pilot = json.loads((DRAFTS / "pilot.json").read_text(encoding="utf-8"))
        for c, ws in pilot["unsure"].items():
            out.update({f"{c}|{w}": by_id[str(w)] for w in ws if str(w) in by_id})
    return out


def load(dry_run: bool, review_dir: Path | None) -> None:
    """The unsure words placed again, into their open drafts in the review queue: a word both
    runs are sure of gets its main group as the proposal, with its extra groups and the sense
    each comes from (`also`, `at`), so the site shows it; every word keeps what the runs said
    sense by sense (`bySense`) for its reviewer, and its old evidence (`before`). Drafts a
    person touched are left alone. Where the skeptic pass ran, a main group it did not call
    `ok` is not placed, and only the extra groups it called `ok` are kept (`skeptic`)."""
    pilot = json.loads((DRAFTS / "pilot.json").read_text(encoding="utf-8"))
    kanji = _inputs("A")
    a, pa = read_run("A")
    b, pb = read_run("B")
    if pa or pb:
        raise SystemExit(f"runs have problems ({len(pa)}, {len(pb)}): run check")
    verdicts = _skeptic()
    checked = _checked()
    proposals.use_review_dir(review_dir)
    placed = extra = kept = touched = vetoed = unchecked = 0
    with review._change() as data:
        latest: dict[str, dict] = {}
        for i in data["items"].values():
            if i["type"] == "word_sense" and (i["subject"] not in latest or i["created"] > latest[i["subject"]]["created"]):
                latest[i["subject"]] = i
        for c in pilot["chars"]:
            senses = {w["id"]: w["senses"] for w in kanji[c]["words"]}
            got = combine([a[c], b[c]], senses)
            for wid in pilot["unsure"][c]:
                item = latest.get(f"{c}|{wid}")
                if (not item or item["status"] != "open" or item["origin"] != "proposal" or item.get("skipped_by")
                        or f"{c}|{wid}" in data["live"]["word_sense"]):
                    touched += 1
                    continue
                r = got[wid]
                old = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
                ev = {"bySense": {"A": a[c][wid], "B": b[c][wid]}, "before": {k: v for k, v in old.items() if k != "before"}}
                verdict = verdicts.get(f"{c}|{wid}")
                if verdict and checked.get(f"{c}|{wid}") != r["main"]:
                    verdict = None  # given for another main group than this one
                if verdict:
                    ev["skeptic"] = verdict
                fields: dict = {"evidence": {**old, **ev}}
                below = r["main"] and min(_backing([a[c][wid], b[c][wid]], r["main"])) < SURE
                if r["main"] and ((verdict and verdict.get("main") != "ok") or (below and not verdict)):
                    # The skeptic said no -- or, below 0.8, never said yes.
                    vetoed += bool(verdict)
                    unchecked += not verdict
                    r = {**r, "main": None}
                elif r["main"] and verdict:
                    r = {**r, "extras": [g for g in r["extras"] if (verdict.get("extras") or {}).get(g) == "ok"]}
                if r["main"]:
                    main = proposals.sense_id(c, r["main"])
                    ca, cb = _backing([a[c][wid], b[c][wid]], r["main"])
                    fields["proposed"] = main
                    fields["source"] = SOURCE
                    fields["reason"] = "placed again sense by sense (D-026)"
                    fields["evidence"] = {
                        **ev,
                        "runs": [{"run": "A", "sense": main, "confidence": ca}, {"run": "B", "sense": main, "confidence": cb}],
                        "confidence": min(ca, cb), "agree": True, "method": "senses",
                        "also": [proposals.sense_id(c, g) for g in r["extras"]],
                        "at": {proposals.sense_id(c, g): n for g, n in r["at"].items()},
                    }
                    placed += 1
                    extra += bool(r["extras"])
                else:
                    kept += 1
                if not dry_run:
                    review._update(data, item, **fields)
        if dry_run:
            raise SystemExit(f"would place {placed} ({extra} with extra groups), keep {kept} unsure ({vetoed} vetoed by "
                             f"the skeptic, {unchecked} below 0.8 not checked), leave {touched} a person touched (dry run: nothing written)")
    print(f"placed {placed} ({extra} with extra groups), kept {kept} unsure ({vetoed} vetoed by the skeptic, {unchecked} unchecked), "
          f"left {touched} a person touched")


def main() -> int:
    global DRAFTS, IN, OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    proposals.drafts_arg(ap, "data/drafts/word-groups-pilot")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--pilot", type=int, default=50, help="this many kanji")
    p.add_argument("--all", action="store_true", help="every kanji with unsure words, instead of a pilot")
    p.add_argument("--calibration", type=int, default=CALIBRATION, help="live words per kanji placed again, unmarked")
    p.add_argument("--skip", type=Path, action="append", default=[], help="a drafts folder whose kanji are done")
    p.add_argument("--size", type=int, default=150, help="words per batch")
    p.add_argument("--runs", default="A,B")
    p.add_argument("--extra-run", action="append", default=[], help="RUN:SIZE, another run with other batch sizes")
    ck = sub.add_parser("check")
    ck.add_argument("--batch", help="just this batch, e.g. A-000")
    sub.add_parser("evaluate")
    sp = sub.add_parser("sample")
    sp.add_argument("--n", type=int, default=30)
    proposals.load_parser(sub, "load")
    sub.add_parser("nofit")
    args = ap.parse_args()
    DRAFTS, IN, OUT = proposals.folders(args.drafts or DRAFTS)
    if args.cmd == "prepare":
        extra = [(r, int(n)) for r, n in (x.split(":") for x in args.extra_run)]
        prepare(None if args.all else args.pilot, args.size, args.runs.split(","), extra, args.calibration, args.skip)
    elif args.cmd == "check":
        check(args.batch)
    elif args.cmd == "evaluate":
        evaluate()
    elif args.cmd == "load":
        load(args.dry_run, args.review_dir)
    elif args.cmd == "nofit":
        nofit()
    else:
        sample(args.n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
