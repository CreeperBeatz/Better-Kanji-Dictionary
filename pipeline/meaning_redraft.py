"""Redraft every kanji's meaning groups and word placements with the other dictionaries.

    python pipeline/meaning_redraft.py prepare
    python pipeline/meaning_redraft.py add-etymology      # after pipeline/wiktionary_etymology.py
    # run A: one Sonnet subagent per in/A-*.json (meaning_prompt.md + meaning_dicts_prompt.md)
    python pipeline/meaning_redraft.py check-extras [--batch NNN]
    # kanji whose glyph origin Wiktionary keeps under the old form (会 under 會):
    python pipeline/meaning_redraft.py prepare-origins
    # one subagent per in/O-*.json (pipeline/origin_prompt.md), writing out/O-*.json
    python pipeline/meaning_drafts.py --drafts data/drafts/meanings-v2 prepare-b [--batch NNN]
    # run B: one subagent per in/B-*.json
    python pipeline/meaning_drafts.py --drafts data/drafts/meanings-v2 check
    python pipeline/meaning_redraft.py load [--dry-run] [--review-dir DIR]

The pilot (meaning_pilot.py, 50 kanji) found that drafting with Kodansha's
senses and the compounds it files under each places words better (27.0% ->
20.6% of Kodansha's same-sense pairs split). This is the same drafting for
every kanji in scope, with nothing held out: each kanji carries Kodansha,
Цалта and Wiktionary (server/dictionaries.py). 新漢語林 is left out: too
unsure a transcription, and classical senses (Dani, 2026-10-07). A kanji
with no word in scope also gets up to a dozen of its rarer words, shown
as evidence and not placed, as the first drafts' thin kanji did.

Run A also writes, per group, `about` (what the kanji does in it) and
`examples` (the 2-3 words that show it best), and per kanji `origin` (how
the character was built, summarised only from Wiktionary's glyph origin,
`etymology` in the input), `originSure` and `link` (how its groups
connect). Dani picked these on 2026-10-07. `load` puts them in the groups
item's evidence (`extras`); pipeline/meaning_extras.py then moves them onto
the values reviewers decide, with their Bulgarian and Kodansha's candidates.

`load` puts the new drafts in place of each kanji's open, untouched draft:
its groups item open, never decided, never skipped, no word of it decided.
Its open word items take the new placements; words the new drafts place
that had no item get one. Back up first (`python -m server.review backup`).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import meaning_drafts as md  # noqa: E402
import meaning_pilot as pilot  # noqa: E402
import proposals  # noqa: E402
from proposals import review, sense_id  # noqa: E402

from server import scope  # noqa: E402

DRAFTS = Path("data/drafts/meanings-v2")
ETYMOLOGY = proposals.ROOT / "data" / "drafts" / "wiktionary-etymology.json"
ETYMOLOGY_CHARS = 1500  # of a kanji's glyph origin given to the agents
REASON = "drafted with Kodansha, Цалта and Wiktionary"


def prepare() -> None:
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    if any(md.IN.glob("A-*.json")):
        raise SystemExit(f"{md.IN} already has batches: delete the folder to start again")
    with md._db() as db:
        chars = "".join(scope.kanji(db))
    md.prepare([], None, chars)
    thin = 0
    with md._db() as db:
        for f in sorted(md.IN.glob("A-*.json")):
            batch = json.loads(f.read_text(encoding="utf-8"))
            for k in batch["kanji"]:
                seen, _, _ = pilot._dicts_for(k["char"], k["words"], holdout=False)
                if seen:
                    k["dictionaries"] = seen
                if not k["words"]:
                    thin += 1
                    rare = db.execute(
                        "SELECT w.headword, w.reading, "
                        "(SELECT s.gloss FROM sense s WHERE s.word_id = w.id ORDER BY s.ord LIMIT 1) AS gloss "
                        "FROM word_char wc JOIN word w ON w.id = wc.word_id "
                        "WHERE wc.char = ? AND instr(w.headword, wc.char) > 0 "
                        "ORDER BY w.nf IS NULL, w.nf, LENGTH(w.headword), w.id LIMIT ?",
                        (k["char"], md.RARE_SHOWN),
                    ).fetchall()
                    k["rareWords"] = [[r["headword"], r["reading"], (r["gloss"] or "").split(";")[0][:60]] for r in rare]
            md._write(f, batch)
    n = len(list(md.IN.glob("A-*.json")))
    print(f"{thin} kanji with no word in scope carry their rarer words as evidence; {n} run-A batches")


def add_etymology() -> None:
    """Each run-A kanji gets Wiktionary's glyph origin, for its `origin`."""
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    etym = json.loads(ETYMOLOGY.read_text(encoding="utf-8"))
    n = 0
    for f in sorted(md.IN.glob("A-*.json")):
        batch = json.loads(f.read_text(encoding="utf-8"))
        for k in batch["kanji"]:
            texts = etym.get(k["char"])
            if texts:
                k["etymology"] = " / ".join(texts)[:ETYMOLOGY_CHARS]
                n += 1
        md._write(f, batch)
    print(f"{n} kanji carry Wiktionary's glyph origin")


ORIGIN_BATCH = 40  # kanji per old-form origin batch


def prepare_origins() -> None:
    """O-batches: the in-scope kanji with no glyph origin of their own whose old form has one."""
    from server import forms

    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    etym = json.loads(ETYMOLOGY.read_text(encoding="utf-8"))
    with md._db() as db:
        chars = scope.kanji(db)
    todo = []
    for c in chars:
        if c in etym:
            continue
        old = next((o["char"] for o in forms.forms_of(c)["old"] if o["char"] in etym), None)
        if old:
            todo.append({"char": c, "old": old, "etymology": " / ".join(etym[old])[:ETYMOLOGY_CHARS]})
    for i in range(0, len(todo), ORIGIN_BATCH):
        name = f"O-{i // ORIGIN_BATCH:03d}"
        md._write(md.IN / f"{name}.json", {"batch": name, "kanji": todo[i:i + ORIGIN_BATCH]})
    print(f"{len(todo)} kanji in {-(-len(todo) // ORIGIN_BATCH)} batches -> {md.IN.relative_to(proposals.ROOT)}/O-*.json")


def read_origins() -> dict[str, dict]:
    """The old-form origins written so far: char -> {origin, originSure}."""
    out: dict[str, dict] = {}
    for f in sorted(md.OUT.glob("O-*.json")):
        for c, e in (json.loads(f.read_text(encoding="utf-8")).get("kanji") or {}).items():
            o = e.get("origin") if isinstance(e, dict) else None
            if isinstance(o, str) and o.strip():
                out[c] = {"origin": o.strip(), "originSure": e.get("originSure") is True}
    return out


def read_extras(only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    """Run A's extras, each kanji's checked against its own groups and placements."""
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    good: dict[str, dict] = {}
    problems: list[str] = []
    for inp in sorted(md.IN.glob(f"A-{only or '*'}.json")):
        out = md.OUT / inp.name
        if not out.exists():
            continue
        got = (json.loads(out.read_text(encoding="utf-8")).get("kanji") or {})
        batch = json.loads(inp.read_text(encoding="utf-8"))
        for k in batch["kanji"]:
            c = k["char"]
            e = got.get(c)
            if not isinstance(e, dict):
                continue
            words = e.get("words") or {}
            x = {"about": {}, "examples": {}}
            for sense in e.get("senses") or []:
                sid = str(sense.get("id", "")).strip().lower()
                about = sense.get("about")
                if not isinstance(about, str) or not about.strip() or len(about) > 400:
                    problems.append(f"{inp.stem} {c} {sid}: `about` missing or over 400 characters")
                else:
                    x["about"][sid] = about.strip()
                ex = sense.get("examples")
                placed_here = [w for w, v in words.items() if isinstance(v, dict) and v.get("sense") == sid]
                if not isinstance(ex, list) or not 1 <= len(ex) <= 3 or any(str(w) not in placed_here for w in ex):
                    if placed_here:
                        problems.append(f"{inp.stem} {c} {sid}: `examples` must be 1-3 ids of words placed in this group")
                else:
                    x["examples"][sid] = [int(w) for w in ex]
            origin = e.get("origin")
            if origin is not None and (not isinstance(origin, str) or not origin.strip()):
                problems.append(f"{inp.stem} {c}: `origin` must be text or null")
            elif origin and not k.get("etymology"):
                problems.append(f"{inp.stem} {c}: `origin` given, but the kanji has no `etymology` to take it from")
            else:
                x["origin"] = origin.strip() if origin else None
                if origin:
                    if not isinstance(e.get("originSure"), bool):
                        problems.append(f"{inp.stem} {c}: `originSure` must be true or false")
                    x["originSure"] = e.get("originSure") is True
            link = e.get("link")
            if link is not None and (not isinstance(link, str) or not link.strip()):
                problems.append(f"{inp.stem} {c}: `link` must be text or null")
            else:
                x["link"] = link.strip() if link else None
            good[c] = x
    # A kanji with no origin of its own takes the one written from its old form.
    for c, o in read_origins().items():
        if c in good and not good[c].get("origin"):
            good[c].update(o)
    return good, problems


def check_extras(only: str | None) -> None:
    good, problems = read_extras(only)
    print(f"extras: {len(good)} kanji read, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)
    if good:
        origins = sum(1 for x in good.values() if x.get("origin"))
        unsure = sum(1 for x in good.values() if x.get("origin") and not x.get("originSure"))
        links = sum(1 for x in good.values() if x.get("link"))
        print(f"origin on {origins} ({unsure} unsure), link on {links}")


def load(dry_run: bool, review_dir: Path | None) -> None:
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    a, b = md.check()
    extras, problems = read_extras()
    print(f"extras for {len(extras)} kanji ({len(problems)} problems, those fields left out)")
    (md.DRAFTS / "extras.json").write_text(json.dumps(extras, ensure_ascii=False, indent=1), encoding="utf-8")
    with md._db() as db:
        nf = {r["id"]: r["nf"] for r in db.execute(f"SELECT w.id, w.nf FROM word w WHERE {scope.WORDS}")}
        head = {r["id"]: r["headword"] for r in db.execute(f"SELECT w.id, w.headword FROM word w WHERE {scope.WORDS}")}
    # As meaning_drafts.load: a word filed under the kanji only for a rare spelling (２月 under 二) is not queued.
    for c, v in a.items():
        v["words"] = {w: p for w, p in v["words"].items() if c in head.get(w, "")}
    proposals.use_review_dir(review_dir)
    done = words = added = 0
    left: list[str] = []
    with review._change() as data:
        decided = {d["subject"].split("|")[0] for d in data["decisions"] if d["type"] in ("kanji_senses", "word_sense")}
        items = list(data["items"].values())
        groups_item = {i["subject"]: i for i in items if i["type"] == "kanji_senses" and i["status"] == "open"}
        open_words: dict[str, dict[int, dict]] = {}
        for i in items:
            if i["type"] == "word_sense" and i["status"] == "open":
                c, w = i["subject"].split("|")
                open_words.setdefault(c, {})[int(w)] = i
        for c, v in a.items():
            g = groups_item.get(c)
            if g is None or c in decided or g.get("skipped_by"):
                left.append(c)
                continue
            if dry_run:
                done += 1
                words += len(v["words"])
                continue
            # The extras ride on the groups item until review has a place for them; ids as the groups' full ids.
            x = extras.get(c)
            if x:
                x = {**x, "about": {sense_id(c, k): t for k, t in x["about"].items()},
                     "examples": {sense_id(c, k): ids for k, ids in x["examples"].items()}}
            review._update(data, g, proposed=review.validate("kanji_senses", c, v["senses"], data, pending_ok=True, machine=True),
                           reason=REASON, evidence={**(g.get("evidence") or {}), "extras": x} if x else g.get("evidence"))
            second = b.get(c, {}).get("words", {})
            mine = open_words.get(c, {})
            for wid, pick in v["words"].items():
                row = md._word_row(c, wid, pick, second.get(wid), nf)
                it = mine.get(wid)
                if it is None:
                    review._new_item(data, row["type"], row["subject"], row["proposed"], row["source"], "proposal",
                                     None, row["evidence"], "system", row["priority"])
                    added += 1
                else:
                    review._update(data, it, proposed=row["proposed"], evidence=row["evidence"])
                words += 1
            done += 1
        if dry_run:
            raise SystemExit(f"would redraft {done} kanji ({words} words); leave {len(left)} someone touched or not queued: {''.join(left[:40])}")
    print(f"redrafted {done} kanji ({words} words, {added} new word items); left {len(left)}: {''.join(left[:40])}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare")
    sub.add_parser("add-etymology")
    sub.add_parser("prepare-origins")
    ce = sub.add_parser("check-extras")
    ce.add_argument("--batch", help="just this batch's number, e.g. 007")
    proposals.load_parser(sub, "load")
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare()
    elif args.cmd == "add-etymology":
        add_etymology()
    elif args.cmd == "prepare-origins":
        prepare_origins()
    elif args.cmd == "check-extras":
        check_extras(args.batch)
    else:
        load(args.dry_run, args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
