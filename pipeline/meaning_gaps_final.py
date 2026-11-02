"""Meaning gaps (D-027), after the skeptic: the fixes made exact, the new groups in Bulgarian, the load.

    python pipeline/meaning_gaps_final.py structure-prepare   # the "right, other fix" verdicts, for an agent
    # one Opus subagent per structure/in/*.md, reading pipeline/meaning_gaps_structure_prompt.md
    python pipeline/meaning_gaps_final.py groups-prepare      # every new group, for the Bulgarian
    # one Opus subagent per groups/in/*.md, reading pipeline/meaning_gaps_groups_prompt.md
    python pipeline/meaning_gaps_final.py final               # -> data/drafts/meaning-gaps/final.json
    python pipeline/meaning_gaps_final.py load [--dry-run] [--review-dir DIR]

What goes in, per flag of both runs (pilot, focus):
- skeptic `right`: the screener's fix, word by word;
- `right-other-fix`: the skeptic's fix, made exact by an agent (structure/);
- `unsure` and `wrong`: nothing (the word stays where it is, or hidden).

The load writes open AI drafts only, like pipeline/regroup.py: a kanji's groups
gain the new group in its open kanji_senses draft; a word's open word_sense
draft (or a new one) takes its group with evidence {agree, confidence 0.9,
method "senses"}, so the site shows it as it shows the word-groups drafts.
Anything a person decided is left alone: accepted groups (live kanji_senses),
accepted placements (live word_sense), drafts a person touched. Those are
counted, not changed.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))

import meaning_gaps as mg  # noqa: E402

D = mg.DRAFTS
ST, GR = D / "structure", D / "groups"
CATCH = "catch-all"
SOURCE = "ai:claude-opus"
REASON = "meaning gaps (D-027): a common word in no group or the wrong one, checked by a skeptic"


def _flags() -> list[dict]:
    """Every flag of both runs with its skeptic verdict."""
    out = []
    for run in mg.RUNS:
        d, _, meta = mg._run(run)
        got, ver = mg._results(run), mg._verdicts(d)
        for c in meta["chars"]:
            for n, fl in enumerate(got.get(c, {}).get("flags") or []):
                fid = f"{c}-{n}"
                out.append({"run": run, "id": fid, "char": c, **fl, "skeptic": ver.get(fid)})
    return out


def _prod() -> dict:
    return json.loads((D / "prod.json").read_text(encoding="utf-8"))


def _groups(p: dict) -> dict[str, dict]:
    """G1.. -> the page's meaning, in page order."""
    return {f"G{n}": m for n, m in enumerate(p["page"]["meanings"], 1)}


def _words(p: dict) -> dict[str, list[dict]]:
    """headword -> the kanji's common words of that headword, each with where it is now."""
    by: dict[str, list[dict]] = defaultdict(list)
    for g in p["groups"]:
        for w in g["words"]:
            if not w.get("also"):
                by[w["hw"]].append({**w, "now": g["id"]})
    for w in p["rest"]:
        by[w["hw"]].append({**w, "now": None})
    return by


def _kanji_block(c: str, p: dict) -> str:
    lines = [f"Groups of {c}:"]
    for g, m in _groups(p).items():
        lines.append(f"  {g}. {m['en']}: {m.get('about') or ''}")
    return "\n".join(lines)


# ---------------------------------------------------------------- 1. structure


def structure_prepare(size: int) -> None:
    prod = _prod()
    items = [f for f in _flags() if (f["skeptic"] or {}).get("verdict") == "right-other-fix"]
    (ST / "in").mkdir(parents=True, exist_ok=True)
    (ST / "out").mkdir(parents=True, exist_ok=True)
    n = math.ceil(len(items) / size)
    for b in range(n):
        chunk = items[b * size:(b + 1) * size]
        parts = [f"# Structure batch st-{b:02d}: {len(chunk)} items\n"]
        for it in chunk:
            flag = {k: it.get(k) for k in ("type", "words", "now", "fix", "new_group", "why")}
            sk = {k: it["skeptic"].get(k) for k in ("fix", "why")}
            parts.append(f"## {it['id']}\n\n{_kanji_block(it['char'], prod[it['char']])}\n\n"
                         f"Screener's flag:\n```json\n{json.dumps(flag, ensure_ascii=False)}\n```\n"
                         f"Skeptic (right, other fix):\n```json\n{json.dumps(sk, ensure_ascii=False)}\n```\n")
        (ST / "in" / f"st-{b:02d}.md").write_text("\n".join(parts), encoding="utf-8")
    print(f"{len(items)} items, {n} batches")


def _structured() -> dict[str, dict]:
    out = {}
    for f in sorted((ST / "out").glob("st-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["items"]:
            out[r["id"]] = r
    return out


# ---------------------------------------------------------------- the moves


def _moves() -> tuple[dict[str, dict], Counter]:
    """char -> {"new": {key: {en, about, words}}, "words": [{hw, to, also, flag}]}: G#/catch-all/new:key."""
    prod, st = _prod(), _structured()
    out: dict[str, dict] = defaultdict(lambda: {"new": {}, "words": []})
    n = Counter()
    for f in _flags():
        v = (f["skeptic"] or {}).get("verdict")
        c = f["char"]
        if v == "right":
            moves = [{"word": w, "to": f["fix"]} for w in f.get("words") or []]
            ng = f.get("new_group") if f.get("fix") == "new" else None
        elif v == "right-other-fix" and f["id"] in st:
            moves = st[f["id"]].get("moves") or []
            ng = st[f["id"]].get("new_group")
        else:
            n[f"held {v or 'unchecked'}"] += len(f.get("words") or [])
            continue
        key = None
        if ng and any(m.get("to") == "new" for m in moves):
            key = f"N{len(out[c]['new']) + 1}"
            out[c]["new"][key] = {"en": ng.get("en"), "about": ng.get("about"), "flag": f["id"], "words": []}
        for m in moves:
            to = m.get("to")
            if to in (None, "keep"):
                n["kept"] += 1
                continue
            if to == "new":
                if not key:
                    n["new without a group"] += 1
                    continue
                to = f"new:{key}"
                out[c]["new"][key]["words"].append(m["word"])
            elif to != CATCH and to not in _groups(prod[c]):
                n["unknown group"] += 1
                continue
            also = [a for a in m.get("also") or [] if a in _groups(prod[c]) and a != to]
            out[c]["words"].append({"hw": m["word"], "to": to, "also": also, "flag": f["id"], "verdict": v})
            n[f"move {v}"] += 1
    return dict(out), n


# ---------------------------------------------------------------- 2. new groups


def groups_prepare() -> None:
    prod = _prod()
    moves, _ = _moves()
    rows = [(c, k, g) for c, m in moves.items() for k, g in m["new"].items()]
    (GR / "in").mkdir(parents=True, exist_ok=True)
    (GR / "out").mkdir(parents=True, exist_ok=True)
    parts = [f"# New groups: {len(rows)}\n"]
    for c, k, g in rows:
        lines = [f"## {c}-{k}", "", f"Existing groups of {c} (the style to follow):"]
        for gi, m in _groups(prod[c]).items():
            lines.append(f"  {gi}. en: {m['en']} | about: {m.get('about') or ''}")
        lines.append("")
        lines.append(f"Proposed new group: en: {g['en']} | about: {g['about']}")
        lines.append(f"Words that go in it: {', '.join(g['words'])}")
        parts.append("\n".join(lines) + "\n")
    (GR / "in" / "gr-00.md").write_text("\n".join(parts), encoding="utf-8")
    print(f"{len(rows)} new groups in {len({c for c, _, _ in rows})} kanji")


def _group_texts() -> dict[str, dict]:
    out = {}
    for f in sorted((GR / "out").glob("gr-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["groups"]:
            out[r["key"]] = r
    return out


# ---------------------------------------------------------------- 3. final


def final() -> None:
    prod = _prod()
    moves, n = _moves()
    texts = _group_texts()
    out = {}
    for c, m in sorted(moves.items()):
        p = prod[c]
        gid = {g: x["id"] for g, x in _groups(p).items()}
        byhw = _words(p)
        new = []
        for k, g in m["new"].items():
            t = texts.get(f"{c}-{k}")
            if not t or t.get("drop"):
                n["new group dropped"] += 1
                continue
            sid = re.sub(r"[^a-z0-9-]", "", t["id"].lower())
            new.append({"key": k, "id": f"{c}.{sid}", "en": t["en"], "bg": t["bg"], "about": t["about"],
                        "aboutBg": t["aboutBg"], "examples": []})
        new_id = {f"new:{g['key']}": g["id"] for g in new}
        if len(p["page"]["meanings"]) + len(new) > 6:
            n["kanji over 6 groups"] += 1
        words = []
        for w in m["words"]:
            to = w["to"]
            to = new_id.get(to) if to.startswith("new:") else (CATCH if to == CATCH else gid[to])
            if to is None:
                n["word's new group dropped"] += 1
                continue
            hits = byhw.get(w["hw"]) or []
            if not hits:
                n["word not found"] += 1
                continue
            for h in hits:
                if h["now"] == to:
                    n["already there"] += 1
                    continue
                words.append({"id": h["id"], "hw": h["hw"], "r": h.get("r"), "nf": h.get("nf"), "from": h["now"], "to": to,
                              "also": [gid[a] for a in w["also"]], "flag": w["flag"], "verdict": w["verdict"]})
        for g in new:  # its best examples: its most common words
            mine = sorted((x for x in words if x["to"] == g["id"]), key=lambda x: x["nf"] or 99)
            g["examples"] = [x["id"] for x in mine[:4]]
            g.pop("key")
        if new or words:
            out[c] = {"new_groups": new, "words": words}
    (D / "final.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    n["kanji"] = len(out)
    n["words"] = sum(len(v["words"]) for v in out.values())
    n["new groups"] = sum(len(v["new_groups"]) for v in out.values())
    n["placed from hidden"] = sum(1 for v in out.values() for w in v["words"] if w["from"] is None)
    print(dict(sorted(n.items())))


# ---------------------------------------------------------------- 4. load


def load(dry_run: bool, review_dir: Path | None) -> None:
    import proposals
    from server import review

    fin = json.loads((D / "final.json").read_text(encoding="utf-8"))
    proposals.use_review_dir(review_dir)
    n = Counter()

    def latest(data: dict, type_: str) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for i in data["items"].values():
            if i["type"] == type_ and (i["subject"] not in out or i["created"] > out[i["subject"]]["created"]):
                out[i["subject"]] = i
        return out

    def is_open(item: dict | None) -> bool:
        return bool(item) and item["status"] == "open" and item["origin"] == "proposal" and not item.get("skipped_by")

    with review._change() as data:
        senses, words = latest(data, "kanji_senses"), latest(data, "word_sense")
        for c, e in fin.items():
            live = review._senses(data, c)
            item = senses.get(c)
            groups = live or ((item or {}).get("proposed") if is_open(item) else None) or []
            ids = {g["id"] for g in groups if isinstance(g, dict)} | {review.CATCH_ALL}
            if e["new_groups"]:
                if live is not None or not is_open(item):
                    n["new groups held: groups accepted or touched"] += len(e["new_groups"])
                else:
                    have = [g for g in item["proposed"] if isinstance(g, dict)]
                    add = [g for g in e["new_groups"] if g["id"] not in {x["id"] for x in have}]
                    if len(have) + len(add) > 6:
                        n["new groups held: over 6"] += len(add)
                        add = []
                    if add:
                        new = have + [{k: g[k] for k in ("id", "en", "bg", "about", "aboutBg", "examples")} for g in add]
                        try:
                            review.validate("kanji_senses", c, new, data)
                        except Exception as x:  # noqa: BLE001
                            n[f"new groups refused: {getattr(x, 'code', x)}"] += len(add)
                            add = []
                        else:
                            ev = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
                            if not dry_run:
                                review._update(data, item, proposed=new, evidence={**ev, "gaps": {"added": [g["id"] for g in add]}},
                                               source=SOURCE, reason=REASON)
                            ids |= {g["id"] for g in add}
                            n["new groups added"] += len(add)
            for w in e["words"]:
                subject = f"{c}|{w['id']}"
                if w["to"] not in ids:
                    n["word held: its group is not shown"] += 1
                    continue
                if subject in data["live"]["word_sense"]:
                    n["word held: placement accepted"] += 1
                    continue
                it = words.get(subject)
                ev = {"runs": [{"run": "gaps", "sense": w["to"], "confidence": 0.9}], "confidence": 0.9, "agree": True,
                      "method": "senses", "also": [a for a in w["also"] if a in ids],
                      "gaps": {"flag": w["flag"], "verdict": w["verdict"], "was": w["from"]}}
                try:
                    review.validate("word_sense", subject, w["to"], data, pending_ok=True, machine=True)
                except Exception as x:  # noqa: BLE001
                    n[f"word refused: {getattr(x, 'code', x)}"] += 1
                    continue
                if it is None:
                    if not dry_run:
                        review._new_item(data, "word_sense", subject, w["to"], SOURCE, "proposal", REASON, ev, "system", 0.0)
                    n["word drafted (new)"] += 1
                elif is_open(it):
                    old = it.get("evidence") if isinstance(it.get("evidence"), dict) else {}
                    if not dry_run:
                        review._update(data, it, proposed=w["to"], evidence={**old, **ev}, source=SOURCE, reason=REASON)
                    n["word drafted (updated)"] += 1
                else:
                    n["word held: draft decided or touched"] += 1
        if dry_run:
            raise SystemExit(f"dry run, nothing written: {dict(sorted(n.items()))}")
    print(dict(sorted(n.items())))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("structure-prepare")
    s.add_argument("--size", type=int, default=70)
    sub.add_parser("groups-prepare")
    sub.add_parser("final")
    lp = sub.add_parser("load")
    lp.add_argument("--dry-run", action="store_true")
    lp.add_argument("--review-dir", type=Path)
    a = ap.parse_args()
    if a.cmd == "structure-prepare":
        structure_prepare(a.size)
    elif a.cmd == "groups-prepare":
        groups_prepare()
    elif a.cmd == "final":
        final()
    else:
        load(a.dry_run, a.review_dir)


if __name__ == "__main__":
    main()
