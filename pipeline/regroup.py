"""Draw a kanji's meaning groups again: meanings, not word-building patterns.

    python pipeline/regroup.py prepare --chars 人物大出一手気立合取 [--size 100000]
    python pipeline/regroup.py --drafts data/drafts/regroup prepare --chars-file chars.txt
    # one Opus subagent per in/<run>-*.json (pipeline/regroup_prompt.md), writing out/<run>-*.json
    python pipeline/regroup.py check
    python pipeline/regroup.py compare
    python pipeline/regroup.py --drafts data/drafts/regroup reconcile-prepare [--per 35]
    # one Opus subagent per reconcile/in-*.json (pipeline/regroup_reconcile_prompt.md)
    python pipeline/regroup.py --drafts data/drafts/regroup final   # -> final.json, checked

The October groups split common kanji by how they build words as well as by
meaning: 人 has "person", "person of a kind" and "counting people", though 人
means "person" in 村人, 商人 and 三人. Words then sit between twin groups and
cannot be placed surely (2026-10-17: 65% of the blocked words). Here a group
is a meaning, and a pattern (a suffix, a counter, an intensifier) is a `use`
inside the meaning whose sense it carries.

Each kanji carries what the October redraft gave it (data/drafts/meanings-v2:
its words, KANJIDIC, Kodansha, Цалта, Wiktionary) and its groups now
(`current`). Two runs, A and B (words shuffled), to see how stable the
groups are. A reconcile pass then picks each kanji's groups and uses from
the two runs by reference ("A:join", "B:join/meet"), so no text is written
twice, and writes the link sentence that walks through the new groups;
`final` assembles them. Nothing is loaded from here.

Drafts live in data/drafts/regroup-pilot/ and data/drafts/regroup/ (untracked).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import proposals  # noqa: E402
from proposals import CATCH_ALL, review  # noqa: E402

DRAFTS, IN, OUT = proposals.folders(proposals.DRAFTS / "regroup-pilot")
SOURCE = proposals.DRAFTS / "meanings-v2" / "in"


def _october(chars: str) -> dict[str, dict]:
    out = {}
    for f in sorted(SOURCE.glob("A-*.json")):
        for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            if k["char"] in chars and k["char"] not in out:
                out[k["char"]] = k
    return out


def _pack(kanji: list[dict], size: int) -> list[list[dict]]:
    """Kanji in their order, a batch closed once its JSON passes `size` characters."""
    batches, cur, n = [], [], 0
    for k in kanji:
        m = len(json.dumps(k, ensure_ascii=False))
        if cur and n + m > size:
            batches.append(cur)
            cur, n = [], 0
        cur.append(k)
        n += m
    return batches + ([cur] if cur else [])


def prepare(chars: str, size: int) -> None:
    if any(IN.glob("*.json")):
        raise SystemExit(f"{IN} has batches already: delete the folder to start again")
    october = _october(chars)
    kanji = []
    for c in chars:
        k = october[c]
        current = [{"id": proposals.short_id(s["id"]), "en": s.get("en"), "about": s.get("about")}
                   for s in review.site_meanings(c)["senses"] or [] if s["id"] != CATCH_ALL]
        kanji.append({"char": c, "kanjidic": k["kanjidic"], "curated": k.get("curated"), "on": k["on"], "kun": k["kun"],
                      "current": current, "dictionaries": k.get("dictionaries"), "words": k["words"]})
    rng = random.Random(5)
    batches = _pack(kanji, size)
    for run in ("A", "B"):
        for i, part in enumerate(batches):
            part = [{**k, "words": k["words"] if run == "A" else rng.sample(k["words"], len(k["words"]))} for k in part]
            path = IN / f"{run}-{i:03d}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            lines = ",\n".join(json.dumps(k, ensure_ascii=False) for k in part)
            path.write_text(f'{{"batch": "{run}-{i:03d}", "run": "{run}", "kanji": [\n{lines}\n]}}\n', encoding="utf-8")
    print(f"{len(kanji)} kanji, {len(batches)} batches a run -> {IN.relative_to(proposals.ROOT)}")


def read_run(run: str, only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    good, problems = {}, []
    for inp, batch, got in proposals.outputs(IN, OUT, f"{only or run + '-*'}.json", problems):
        for k in batch["kanji"]:
            e = (got.get("kanji") or {}).get(k["char"])
            ids = {str(w[0]) for w in k["words"]}
            if not isinstance(e, dict) or not isinstance(e.get("groups"), list) or not e["groups"]:
                problems.append(f"{inp.stem} {k['char']}: missing")
                continue
            bad = [x for g in e["groups"] for x in [*g.get("examples", []), *(y for u in g.get("uses") or [] for y in u.get("examples", []))]
                   if str(x) not in ids]
            if bad:
                problems.append(f"{inp.stem} {k['char']}: examples not in the list {bad[:5]}")
            short = [g.get("id") for g in e["groups"] if not all(g.get(f) for f in ("id", "en", "bg", "about", "aboutBg"))]
            if short:
                problems.append(f"{inp.stem} {k['char']}: groups missing id/en/bg/about/aboutBg {short}")
            # What the review store takes (review.validate): 1-6 groups, labels of 1-4 words, 4 examples.
            if len(e["groups"]) > 6:
                problems.append(f"{inp.stem} {k['char']}: {len(e['groups'])} groups, at most 6")
            long = [g.get("id") for g in e["groups"] if len(g.get("en") or "") > 40 or len((g.get("en") or "").split()) > 4
                    or len(g.get("bg") or "") > 40 or len(g.get("examples") or []) > 4]
            if long:
                problems.append(f"{inp.stem} {k['char']}: en/bg over 4 words or 40 characters, or over 4 examples {long}")
            good[k["char"]] = e
    return good, problems


def check(only: str | None = None) -> None:
    for run in [only.split("-")[0]] if only else ["A", "B"]:
        good, problems = read_run(run, only)
        print(f"run {run}: {len(good)} kanji, {len(problems)} problems")
        for p in problems:
            print("   ", p)


def compare() -> None:
    """Each kanji's groups in both runs, side by side, and what they kept of the current ones."""
    a, _ = read_run("A")
    b, _ = read_run("B")
    lines = []
    for c in a:
        lines.append(f"## {c}")
        for run, got in (("A", a), ("B", b)):
            e = got.get(c)
            if not e:
                continue
            gs = "; ".join(f"{g['id']} ({g['en']})" + (" [uses: " + ", ".join(u["en"] for u in g.get("uses") or []) + "]" if g.get("uses") else "")
                           for g in e["groups"])
            lines.append(f"- {run}: {gs}")
        lines.append(f"- why (A): {a[c].get('why', '')}")
        lines.append("")
    out = DRAFTS / "compare.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


def _inputs(run: str) -> dict[str, dict]:
    return {k["char"]: k for f in sorted(IN.glob(f"{run}-*.json")) for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]}


def _brief(g: dict, words: dict[str, str]) -> dict:
    """A group or use as the reconcile pass sees it: no Bulgarian, examples as words."""
    out = {"id": g["id"], "en": g["en"], "about": g.get("about"), "from": g.get("from") or [],
           "examples": [words.get(str(x), str(x)) for x in g.get("examples") or []]}
    if "uses" in g:
        out["uses"] = [_brief(u, words) for u in g.get("uses") or []]
    return out


def reconcile_prepare(per: int) -> None:
    a, pa = read_run("A")
    b, pb = read_run("B")
    if pa or pb:
        raise SystemExit(f"runs have problems ({len(pa)}, {len(pb)}): run check")
    kanji = _inputs("A")
    rec = DRAFTS / "reconcile"
    if any(rec.glob("in-*.json")):
        raise SystemExit(f"{rec} has batches already")
    rec.mkdir(parents=True, exist_ok=True)
    rows = []
    for c, k in kanji.items():
        words = {str(w[0]): w[1] for w in k["words"]}
        extras = review.site_meanings(c)["extras"] or {}
        rows.append({"char": c, "current": [f"{s['id']} ({s['en']})" for s in k["current"]], "link": extras.get("link"),
                     "A": [_brief(g, words) for g in a[c]["groups"]], "whyA": a[c].get("why"),
                     "B": [_brief(g, words) for g in b[c]["groups"]], "whyB": b[c].get("why")})
    for i in range(0, len(rows), per):
        lines = ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows[i:i + per])
        (rec / f"in-{i // per:03d}.json").write_text(f'{{"batch": "{i // per:03d}", "kanji": [\n{lines}\n]}}\n', encoding="utf-8")
    print(f"{len(rows)} kanji, {-(-len(rows) // per)} reconcile batches -> {rec.relative_to(proposals.ROOT)}")


def _pick(ref: str, runs: dict[str, dict], c: str) -> dict:
    """A group ("A:join") or a use ("B:join/meet") of a run, by reference."""
    run, _, path = ref.partition(":")
    gid, _, uid = path.partition("/")
    g = next((g for g in runs[run][c]["groups"] if g["id"] == gid), None) if run in runs and c in runs[run] else None
    if g is None:
        raise KeyError(ref)
    if not uid:
        return g
    u = next((u for u in g.get("uses") or [] if u["id"] == uid), None)
    if u is None:
        raise KeyError(ref)
    return u


def assemble(c: str, e: dict, runs: dict[str, dict], current: list[dict]) -> tuple[dict, list[str]]:
    """A kanji's final groups from the reconcile pass's choices; the problems found."""
    problems, groups, ids = [], [], set()
    for choice in e.get("groups") or []:
        try:
            g = _pick(choice["take"], runs, c)
            uses = [_pick(r, runs, c) for r in choice.get("uses") or []]
            absorbed = [_pick(r, runs, c) for r in choice.get("absorb") or []]
        except (KeyError, TypeError) as err:
            problems.append(f"{c}: unknown reference {err}")
            continue
        gid = choice.get("id") or g["id"]
        if gid in ids:
            problems.append(f"{c}: group id {gid} twice")
        ids.add(gid)
        texts = {f: choice.get(f) or g.get(f) for f in ("en", "bg", "about", "aboutBg")}
        uids, clean_uses = set(), []
        for u in uses:
            uid = u["id"] if u["id"] not in uids else f"{u['id']}-2"
            uids.add(uid)
            clean_uses.append({"id": uid, "en": u["en"], "about": u.get("about"), "from": u.get("from") or [],
                               "examples": list(u.get("examples") or [])[:4]})
        froms = list(dict.fromkeys([*(g.get("from") or []), *(f for x in absorbed for f in x.get("from") or []),
                                    *(f for u in clean_uses for f in u["from"])]))
        groups.append({"id": gid, **texts, "from": froms, "examples": list(g.get("examples") or [])[:4], "uses": clean_uses})
    if not 1 <= len(groups) <= 6:
        problems.append(f"{c}: {len(groups)} groups")
    missing = [s["id"] for s in current if not any(s["id"] in g["from"] for g in groups)]
    if missing:
        problems.append(f"{c}: current groups no new group takes in (their words are placed again): {missing}")
    if not e.get("link") or not e.get("linkBg"):
        problems.append(f"{c}: link or linkBg missing")
    try:
        review.validate("kanji_senses", c, [{**g, "id": g["id"]} for g in groups])
    except Exception as err:  # noqa: BLE001 - the store's own words for what it won't take
        problems.append(f"{c}: the review store would refuse it: {err}")
    return {"groups": groups, "link": e.get("link"), "linkBg": e.get("linkBg")}, problems


def final(only: str | None = None) -> None:
    """The reconcile pass's choices assembled into final.json (or one batch checked)."""
    runs = {"A": read_run("A")[0], "B": read_run("B")[0]}
    kanji = _inputs("A")
    rec = DRAFTS / "reconcile"
    out, problems = {}, []
    for inp in sorted(rec.glob(f"in-{only or '*'}.json")):
        batch = json.loads(inp.read_text(encoding="utf-8"))
        res = rec / inp.name.replace("in-", "out-")
        got = json.loads(res.read_text(encoding="utf-8")).get("kanji", {}) if res.exists() else {}
        for k in batch["kanji"]:
            c = k["char"]
            if c not in got:
                problems.append(f"{inp.stem} {c}: missing")
                continue
            out[c], p = assemble(c, got[c], runs, kanji[c]["current"])
            problems += [f"{inp.stem} {x}" for x in p]
    hard = [p for p in problems if "placed again" not in p]
    print(f"{len(out)} kanji assembled, {len(hard)} problems, {len(problems) - len(hard)} notes")
    for p in problems:
        print("   ", p)
    if not only and not hard:
        (DRAFTS / "final.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"-> {(DRAFTS / 'final.json').relative_to(proposals.ROOT)}")


PLACE_BATCH = 250  # words per placement batch, as in word_groups


def _targets(groups: list[dict]) -> dict[str, list[str]]:
    """Each current group id -> the new groups that take it in (`from`, uses included)."""
    out: dict[str, list[str]] = {}
    for g in groups:
        for f in g["from"]:
            out.setdefault(f, []).append(g["id"])
    return out


def mapped(char: str, groups: list[dict], placed: dict[int, str], also: dict[int, list[str]]) -> tuple[dict[int, dict], list[int]]:
    """The words whose current group goes to exactly one new group, with that group (and their
    extra groups that do too); and the words to place again: unplaced, or their group split or gone."""
    targets = _targets(groups)
    out, again = {}, []
    for w, g in placed.items():
        if g == CATCH_ALL:
            out[w] = {"main": CATCH_ALL, "extras": []}
            continue
        t = targets.get(proposals.short_id(g), [])
        if len(t) != 1:
            again.append(w)
            continue
        extras = []
        for x in also.get(w) or []:
            tx = targets.get(proposals.short_id(x), [])
            if len(tx) == 1 and tx[0] != t[0] and tx[0] not in extras:
                extras.append(tx[0])
        out[w] = {"main": t[0], "extras": extras}
    return out, again


def place_prepare(review_dir: Path | None) -> None:
    """Map what can be mapped; write placement batches (word_groups format) for the rest."""
    import word_groups as wg  # noqa: PLC0415 - its folders are set here, not at import
    fin = json.loads((DRAFTS / "final.json").read_text(encoding="utf-8"))
    proposals.use_review_dir(review_dir)
    data = review._current()
    place = DRAFTS / "place"
    wg.DRAFTS, wg.IN, wg.OUT = proposals.folders(place)
    if any(wg.IN.glob("*.json")):
        raise SystemExit(f"{wg.IN} has batches already")
    maps, kanji, stats = {}, [], {"words": 0, "mapped": 0, "again": 0, "unplaced": 0}
    by_char: dict[str, set[int]] = {}
    for i in data["items"].values():
        if i["type"] == "word_sense":
            ch, wid = i["subject"].split("|")
            by_char.setdefault(ch, set()).add(int(wid))
    for c, e in fin.items():
        words = sorted(by_char.get(c, ()))
        m = review.site_meanings(c)
        placed = {w: g for w, g in m["placed"].items() if w in set(words)}
        got, split = mapped(c, e["groups"], placed, m.get("also") or {})
        todo = sorted(set(split) | {w for w in words if w not in placed})
        stats["words"] += len(words)
        stats["mapped"] += len(got)
        stats["again"] += len(split)
        stats["unplaced"] += len(todo) - len(split)
        maps[c] = {str(w): v for w, v in got.items()}
        if not todo:
            continue
        fetched = wg._words(sorted(set(todo) | {int(x) for g in e["groups"] for x in g["examples"]}))
        groups = []
        for g in e["groups"]:
            uses = "; ".join(f"{u['en']} ({', '.join(fetched[int(x)]['word'] for x in u['examples'] if int(x) in fetched)})" for u in g["uses"])
            groups.append({"id": g["id"], "en": g["en"], "about": (g.get("about") or "") + (f" Uses in this group: {uses}." if uses else ""),
                           "known": [f"{fetched[int(x)]['word']} {fetched[int(x)]['reading']}" for x in g["examples"] if int(x) in fetched][:4]})
        kanji.append({"char": c, "groups": groups, "words": [fetched[w] for w in todo if w in fetched]})
    (place / "mapped.json").parent.mkdir(parents=True, exist_ok=True)
    (place / "mapped.json").write_text(json.dumps(maps, ensure_ascii=False), encoding="utf-8")
    (place / "pilot.json").write_text(json.dumps({"chars": [k["char"] for k in kanji], "calibration": {k["char"]: [] for k in kanji},
                                                  "unsure": {k["char"]: [w["id"] for w in k["words"]] for k in kanji}}, ensure_ascii=False), encoding="utf-8")
    rng = random.Random(9)
    for run in ("A", "B"):
        # Small kanji share a batch; a big one spans several (word_groups merges them back).
        batches, cur, n = [], [], 0
        for k in kanji:
            ws = k["words"] if run == "A" else rng.sample(k["words"], len(k["words"]))
            for i in range(0, len(ws), PLACE_BATCH):
                part = ws[i:i + PLACE_BATCH]
                if cur and n + len(part) > PLACE_BATCH:
                    batches.append(cur)
                    cur, n = [], 0
                cur.append({**k, "words": part})
                n += len(part)
        batches += [cur] if cur else []
        for i, b in enumerate(batches):
            wg._write(wg.IN / f"{run}-{i:03d}.json", {"batch": f"{run}-{i:03d}", "run": run, "kanji": b})
        print(f"run {run}: {len(batches)} batches")
    print(f"{stats['words']} words: {stats['mapped']} mapped, {stats['again']} whose group split or went, "
          f"{stats['unplaced']} unplaced -> {stats['again'] + stats['unplaced']} to place")


def _placement():
    """word_groups pointed at the placement folder, with both runs read and checked."""
    import word_groups as wg  # noqa: PLC0415
    wg.DRAFTS, wg.IN, wg.OUT = proposals.folders(DRAFTS / "place")
    a, pa = wg.read_run("A")
    b, pb = wg.read_run("B")
    if pa or pb:
        raise SystemExit(f"placement runs have problems ({len(pa)}, {len(pb)}): run word_groups check")
    return wg, a, b, wg._inputs("A")


def skeptic_prepare(n: int) -> None:
    """The placed words whose main group stands below 0.8, for the skeptic pass (word_groups_skeptic_prompt.md)."""
    wg, a, b, kanji = _placement()
    items = []
    for c, k in kanji.items():
        senses = {w["id"]: w["senses"] for w in k["words"]}
        got = wg.combine([a[c], b[c]], senses)
        groups = {g["id"]: g["en"] + (" — " + g["about"] if g.get("about") else "") for g in k["groups"]}
        for w in k["words"]:
            r = got[w["id"]]
            if r["main"] and min(wg._backing([a[c][w["id"]], b[c][w["id"]]], r["main"])) < wg.SURE:
                items.append({"key": f"{c}|{w['id']}", "char": c, "groups": groups, "word": w["word"], "reading": w["reading"],
                              "senses": [f"{s[0]}. {s[3]}" + (f" [{s[2]}]" if s[2] else "") for s in w["senses"]],
                              "main": r["main"], "extras": r["extras"]})
    d = DRAFTS / "place" / "skeptic"
    if any(d.glob("in-*.json")):
        raise SystemExit(f"{d} has batches already")
    d.mkdir(parents=True, exist_ok=True)
    size = -(-len(items) // n)
    for i in range(n):
        if part := items[i * size:(i + 1) * size]:
            (d / f"in-{i:02d}.json").write_text(json.dumps(part, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(items)} placements below 0.8 -> {-(-len(items) // size) if items else 0} skeptic batches in {d.relative_to(proposals.ROOT)}")


def _latest(data: dict, type_: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in data["items"].values():
        if i["type"] == type_ and (i["subject"] not in out or i["created"] > out[i["subject"]]["created"]):
            out[i["subject"]] = i
    return out


def _open(item: dict | None) -> bool:
    """An AI draft no person has touched."""
    return bool(item) and item["status"] == "open" and item["origin"] == "proposal" and not item.get("skipped_by")


REASON = "regrouped: a group is a meaning, patterns are uses (D-028)"


def load(dry_run: bool, review_dir: Path | None) -> None:
    """final.json into the review store's open drafts: each kanji's groups (with the old groups'
    similar kanji, its uses, and what each takes in), its link sentence, and its words: a word
    whose old group went to one new group follows it; the rest take what the placement runs
    gave them, under word_groups' rules (two runs agree; below 0.8 only with a skeptic ok).
    Drafts a person touched are left alone."""
    fin = json.loads((DRAFTS / "final.json").read_text(encoding="utf-8"))
    maps = json.loads((DRAFTS / "place" / "mapped.json").read_text(encoding="utf-8"))
    wg, a, b, kanji = _placement()
    verdicts, checked = wg._skeptic(), wg._checked()
    proposals.use_review_dir(review_dir)
    n = dict.fromkeys(("kanji", "links", "mapped", "placed", "unplaced", "vetoed", "unchecked", "touched", "skipped_kanji"), 0)
    with review._change() as data:
        senses_items, extras_items, words = _latest(data, "kanji_senses"), _latest(data, "kanji_extras"), _latest(data, "word_sense")
        for c, e in fin.items():
            item = senses_items.get(c)
            if c in data["live"]["kanji_senses"] or not _open(item):
                n["skipped_kanji"] += 1
                continue
            old = {proposals.short_id(s["id"]): s for s in item["proposed"] or [] if isinstance(s, dict)}
            groups = [{"id": proposals.sense_id(c, g["id"]), "en": g["en"], "bg": g["bg"], "about": g["about"], "aboutBg": g["aboutBg"],
                       "examples": g["examples"],
                       "similar": list(dict.fromkeys(x for f in g["from"] for x in (old.get(f) or {}).get("similar") or []))[:16],
                       "uses": g["uses"]} for g in e["groups"]]
            ev = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
            ev = {**ev, "regroup": {"from": {g["id"]: g["from"] for g in e["groups"]}, "before": item["proposed"]}}
            if not dry_run:
                review._update(data, item, proposed=groups, evidence=ev, source=SOURCE_AI, reason=REASON)
            n["kanji"] += 1
            ex = extras_items.get(c)
            if _open(ex) and isinstance(ex.get("proposed"), dict) and e.get("link"):
                if not dry_run:
                    review._update(data, ex, proposed={**ex["proposed"], "link": e["link"], "linkBg": e["linkBg"]})
                n["links"] += 1
            targets = {f: t[0] for f, t in _targets(e["groups"]).items() if len(t) == 1}
            rename = {proposals.sense_id(c, f): proposals.sense_id(c, t) for f, t in targets.items()}
            senses_of = {w["id"]: w["senses"] for w in kanji[c]["words"]} if c in kanji else {}
            got = wg.combine([a[c], b[c]], senses_of) if c in kanji else {}
            for wid, m in maps.get(c, {}).items():
                w = words.get(f"{c}|{wid}")
                if not _open(w) or f"{c}|{wid}" in data["live"]["word_sense"]:
                    n["touched"] += 1
                    continue
                old_ev = w.get("evidence") if isinstance(w.get("evidence"), dict) else {}
                new_ev = {**old_ev, "regroup": {"was": w["proposed"]}}
                if isinstance(old_ev.get("runs"), list):
                    new_ev["runs"] = [{**r, "sense": rename.get(r.get("sense"), r.get("sense"))} for r in old_ev["runs"]]
                main = proposals.sense_id(c, m["main"])
                new_ev["also"] = [proposals.sense_id(c, x) for x in m["extras"]]
                new_ev["at"] = {rename[k]: v for k, v in (old_ev.get("at") or {}).items() if rename.get(k) in [main, *new_ev["also"]]}
                if not dry_run:
                    review._update(data, w, proposed=main, evidence=new_ev, reason=REASON)
                n["mapped"] += 1
            for wid, r in got.items():
                w = words.get(f"{c}|{wid}")
                if not _open(w) or f"{c}|{wid}" in data["live"]["word_sense"]:
                    n["touched"] += 1
                    continue
                runs = [a[c][wid], b[c][wid]]
                old_ev = w.get("evidence") if isinstance(w.get("evidence"), dict) else {}
                ev = {**old_ev, "bySense": {"A": runs[0], "B": runs[1]}, "regroup": {"was": w["proposed"]}}
                verdict = verdicts.get(f"{c}|{wid}")
                if verdict and checked.get(f"{c}|{wid}") != r["main"]:
                    verdict = None
                if verdict:
                    ev["skeptic"] = verdict
                below = r["main"] and min(wg._backing(runs, r["main"])) < wg.SURE
                if r["main"] and ((verdict and verdict.get("main") != "ok") or (below and not verdict)):
                    n["vetoed"] += bool(verdict)
                    n["unchecked"] += not verdict
                    r = {**r, "main": None}
                elif r["main"] and verdict:
                    r = {**r, "extras": [g for g in r["extras"] if (verdict.get("extras") or {}).get(g) == "ok"]}
                fields: dict = {"evidence": ev, "reason": REASON}
                if r["main"]:
                    main = proposals.sense_id(c, r["main"])
                    ca, cb = wg._backing(runs, r["main"])
                    fields["proposed"] = main
                    fields["source"] = wg.SOURCE
                    fields["evidence"] = {**ev, "runs": [{"run": "A", "sense": main, "confidence": ca}, {"run": "B", "sense": main, "confidence": cb}],
                                          "confidence": min(ca, cb), "agree": True, "method": "senses",
                                          "also": [proposals.sense_id(c, g) for g in r["extras"]],
                                          "at": {proposals.sense_id(c, g): x for g, x in r["at"].items()}}
                    n["placed"] += 1
                else:
                    n["unplaced"] += 1
                if not dry_run:
                    review._update(data, w, **fields)
        n["manual"] = _manual(data, words, dry_run)
        if dry_run:
            raise SystemExit(f"dry run, nothing written: {n}")
    print(n)


def _manual(data: dict, words: dict[str, dict], dry_run: bool) -> int:
    """manual.json: words placed by hand (the kun readings no card showed), as sure drafts.
    Like every draft, left alone when a person touched it."""
    path = DRAFTS / "manual.json"
    if not path.exists():
        return 0
    done = 0
    drafts = _latest(data, "kanji_senses")
    for m in json.loads(path.read_text(encoding="utf-8"))["words"]:
        c, key = m["char"], f"{m['char']}|{m['id']}"
        w = words.get(key)
        if not _open(w) or key in data["live"]["word_sense"]:
            continue
        groups = review._senses(data, c) or (drafts.get(c) or {}).get("proposed") or []
        ids = {s["id"] for s in groups if isinstance(s, dict)}
        main = proposals.sense_id(c, m["main"])
        extras = [proposals.sense_id(c, x) for x in m.get("extras") or []]
        if main != CATCH_ALL and main not in ids or any(x not in ids for x in extras):
            raise SystemExit(f"manual.json: {key} names a group {c} does not have")
        old = w.get("evidence") if isinstance(w.get("evidence"), dict) else {}
        ev = {**old, "runs": [{"run": "manual", "sense": main, "confidence": m["confidence"]}], "confidence": m["confidence"],
              "agree": True, "method": "senses", "also": extras,
              "at": {proposals.sense_id(c, g): x for g, x in (m.get("at") or {}).items()}, "manual": m["why"]}
        if not dry_run:
            review._update(data, w, proposed=main, evidence=ev, source=SOURCE_AI, reason="placed by hand: a kun reading on no card (D-026)")
        done += 1
    return done


SOURCE_AI = "ai:claude-opus"


def main() -> int:
    global DRAFTS, IN, OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    proposals.drafts_arg(ap, "data/drafts/regroup-pilot")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--chars", help="the kanji, as one string")
    p.add_argument("--chars-file", type=Path, help="a file holding the kanji")
    p.add_argument("--size", type=int, default=100_000, help="characters of JSON per batch")
    ck = sub.add_parser("check")
    ck.add_argument("--batch", help="one batch only, e.g. A-003")
    sub.add_parser("compare")
    rp = sub.add_parser("reconcile-prepare")
    rp.add_argument("--per", type=int, default=35, help="kanji per reconcile batch")
    fp = sub.add_parser("final")
    fp.add_argument("--batch", help="one reconcile batch only, e.g. 003")
    pp = sub.add_parser("place-prepare")
    pp.add_argument("--review-dir", type=Path, help="the review store to map from (default data/review)")
    sp = sub.add_parser("skeptic-prepare")
    sp.add_argument("--n", type=int, default=8, help="skeptic batches")
    lp = sub.add_parser("load")
    lp.add_argument("--dry-run", action="store_true")
    lp.add_argument("--review-dir", type=Path, help="the review store to load into (default data/review)")
    args = ap.parse_args()
    DRAFTS, IN, OUT = proposals.folders(args.drafts or DRAFTS)
    if args.cmd == "prepare":
        prepare(args.chars or args.chars_file.read_text(encoding="utf-8").strip(), args.size)
    elif args.cmd == "check":
        check(args.batch)
    elif args.cmd == "reconcile-prepare":
        reconcile_prepare(args.per)
    elif args.cmd == "final":
        final(args.batch)
    elif args.cmd == "place-prepare":
        place_prepare(args.review_dir)
    elif args.cmd == "skeptic-prepare":
        skeptic_prepare(args.n)
    elif args.cmd == "load":
        load(args.dry_run, args.review_dir)
    else:
        compare()
    return 0


if __name__ == "__main__":
    sys.exit(main())
