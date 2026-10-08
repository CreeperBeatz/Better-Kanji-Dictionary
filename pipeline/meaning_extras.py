"""What the meanings cards carry beyond the groups, for review (Dani, 2026-10-07).

    python pipeline/meaning_extras.py candidates      # Kodansha's links and flags, mapped onto the redraft's groups
    python pipeline/meaning_extras.py prepare-bg      # batches for the Bulgarian of about / origin / link
    # one subagent per data/drafts/meanings-v2/in/BG-*.json (pipeline/extras_bg_prompt.md)
    python pipeline/meaning_extras.py check-bg [--batch NNN]
    python pipeline/meaning_extras.py load [--dry-run] [--review-dir DIR]

Per group (on the kanji_senses value):
  about, aboutBg  what the kanji does in the group's words (run A; Bulgarian by the BG pass)
  examples        the 2-3 words that show the group best (run A)
  original        the group holds the kanji's original meaning: Kodansha marks
                  that sense "[original meaning]", and the group is where most
                  of the words it lists under that sense are
  similar         kanji of the same meaning *in this group* (生 health -> 康 健).
                  Candidates are Kodansha's synonyms of the sense the group
                  maps to; those our own open data also links (the `similar`
                  table) start ticked. Only what a reviewer leaves ticked is kept.

Per kanji (a kanji_extras item, decided on the same card):
  origin, originBg, originSure   how the character was built (run A, from Wiktionary's glyph origin)
  link, linkBg                   how the groups connect (run A)
  mixups                         kanji easy to mix up with it: Kodansha's homophones,
                                 [{"char", "reading"}]; those Bunkacho's 異字同訓 list
                                 or our same-reading list also has start ticked

Kodansha's own words (its glosses) go in the evidence, for reviewers only;
what is published is the reviewer's choice of kanji, never Kodansha's text.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import meaning_drafts as md  # noqa: E402
import proposals  # noqa: E402
from meaning_redraft import DRAFTS, read_extras  # noqa: E402
from proposals import review, sense_id  # noqa: E402

from server import dictionaries, scope  # noqa: E402

CANDIDATES = DRAFTS / "candidates.json"
BG_BATCH = 90  # kanji per Bulgarian batch
KOKUJI = proposals.ROOT / "data" / "kokuji.txt"
ORIGINAL = re.compile(r"\[original meaning")
SOURCE = "extras: run A + Kodansha candidates"


def _db() -> sqlite3.Connection:
    db = sqlite3.connect(proposals.ROOT / "data" / "betterrtk.sqlite")
    db.row_factory = sqlite3.Row
    return db


def _bunkacho_pairs() -> set[frozenset[str]]:
    out = set()
    for line in (Path(__file__).parent / "ijidokun.tsv").read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or "\t" not in line:
            continue
        ks = line.split("\t")[1].split(",")
        out |= {frozenset((a, b)) for a in ks for b in ks if a != b}
    return out


def _homophones(entry: dict) -> list[tuple[str, str, str]]:
    """Kodansha's HOMOPHONES box as (reading, kanji, gloss): a reading then the kanji under it."""
    out, reading = [], None
    for x in (entry.get("sections") or {}).get("homophones") or []:
        if x.get("kind") == "homophone":
            reading = x.get("reading")
        if x.get("ja") and reading and x.get("kind") in ("homophone", "ref"):
            out.append((reading, x["ja"], x.get("gloss") or ""))
    return out


_synonyms = dictionaries.kodansha_synonyms


def _covers(n: str, key: str) -> bool:
    """Whether a synonym sense number covers a compound sense key: 1 covers c:1a and c:1b, 2a only c:2a."""
    k = key.removeprefix("c:")
    return k == n or (k.startswith(n) and k[len(n):].isalpha())


def candidates() -> None:
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    a, _ = md.read_run("A")
    kodansha = dictionaries._kodansha()
    with _db() as db:
        in_scope = set(scope.kanji(db))
        kw = {r["char"]: json.loads(r["meanings"] or "[]")[:1] for r in db.execute("SELECT char, meanings FROM kanji")}
        ours: dict[frozenset[str], str] = {}
        for r in db.execute("SELECT char, other, kind FROM similar WHERE kind IN ('mean', 'read', 'variant')"):
            ours.setdefault(frozenset((r["char"], r["other"])), r["kind"])
        heads = {}
        for f in sorted(md.IN.glob("A-*.json")):
            for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
                heads[k["char"]] = [{"id": w[0], "headword": w[1], "reading": w[2]} for w in k["words"]]
    bunkacho = _bunkacho_pairs()

    out: dict[str, dict] = {}
    stats = Counter()
    for c, v in a.items():
        e = kodansha.get(c)
        if not e:
            continue
        stats["kanji with Kodansha"] += 1
        placed = {w: s for w, (s, _) in v["words"].items()}
        tags = dictionaries.view(c, heads.get(c, []))["words"]
        by_key: dict[str, list[int]] = {}
        for wid, ts in tags.items():
            for t in ts:
                if t["src"] == "kodansha" and t["key"] != "special":
                    by_key.setdefault(t["key"], []).append(int(wid))
        groups = [s["id"] for s in v["senses"]]

        def group_of(keys: list[str]) -> str | None:
            votes = Counter(placed[w] for k in keys for w in by_key.get(k, []) if w in placed)
            votes.pop(md.CATCH_ALL, None)
            if votes:
                return votes.most_common(1)[0][0]
            return groups[0] if len(groups) == 1 else None  # one group: every sense is it

        senses = dictionaries._kodansha_view(e)["senses"]
        x: dict = {"original": [], "similar": {}, "unplaced": [], "mixups": []}
        orig = [s["key"] for s in senses if ORIGINAL.search(s["text"])]
        if orig:
            stats["kanji with an original sense"] += 1
            g = group_of(orig)
            if g:
                x["original"] = [sense_id(c, g)]
                stats["original mapped to a group"] += 1
        for n, other, gloss in _synonyms(e):
            if len(other) != 1 or other == c or other not in in_scope:
                continue
            g = group_of([s["key"] for s in senses if _covers(n, s["key"])])
            cand = {"char": other, "gloss": gloss, "en": (kw.get(other) or [None])[0],
                    "ticked": frozenset((c, other)) in ours}
            stats["synonym candidates"] += 1
            if g is None:
                x["unplaced"].append({**cand, "sense": n})
                stats["synonyms not mapped to a group"] += 1
                continue
            row = x["similar"].setdefault(sense_id(c, g), [])
            if not any(r["char"] == other for r in row):
                row.append(cand)
                stats["synonyms ticked"] += cand["ticked"]
        seen = set()
        for reading, other, gloss in _homophones(e):
            if len(other) != 1 or other == c or other not in in_scope or other in seen:
                continue
            seen.add(other)
            pair = frozenset((c, other))
            x["mixups"].append({"char": other, "reading": reading, "gloss": gloss, "en": (kw.get(other) or [None])[0],
                                "ticked": pair in bunkacho or ours.get(pair) == "read"})
            stats["mix-up candidates"] += 1
            stats["mix-ups ticked"] += x["mixups"][-1]["ticked"]
        out[c] = x
    CANDIDATES.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    kokuji = sorted(c for c, e in kodansha.items() if e.get("kokuji") and len(c) == 1)
    KOKUJI.write_text("# Kanji made in Japan (kokuji), as Kodansha marks them. One per line.\n"
                      + "\n".join(kokuji) + "\n", encoding="utf-8")
    for k, n in stats.items():
        print(f"{k:34} {n:>7}")
    print(f"{len(kokuji)} kokuji -> {KOKUJI.relative_to(proposals.ROOT)} ({sum(1 for c in kokuji if c in in_scope)} in scope)")
    print(f"-> {CANDIDATES}")


# ---------------------------------------------------------------- Bulgarian


def prepare_bg() -> None:
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    a, _ = md.read_run("A")
    extras, _ = read_extras()
    tsalta = {}
    for f in sorted(md.IN.glob("A-*.json")):
        for k in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            t = (k.get("dictionaries") or {}).get("tsalta")
            if t:
                tsalta[k["char"]] = t.get("keyword")
    rows = []
    for c, v in a.items():
        x = extras.get(c) or {}
        groups = [{"id": s["id"], "en": s["en"], "bg": s.get("bg"), "about": x.get("about", {}).get(s["id"])}
                  for s in v["senses"]]
        if not any(g["about"] for g in groups) and not x.get("origin") and not x.get("link"):
            continue
        rows.append({"char": c, "tsalta": tsalta.get(c), "groups": groups,
                     "origin": x.get("origin"), "link": x.get("link")})
    for i in range(0, len(rows), BG_BATCH):
        name = f"BG-{i // BG_BATCH:03d}"
        md._write(md.IN / f"{name}.json", {"batch": name, "kanji": rows[i:i + BG_BATCH]})
    print(f"{len(rows)} kanji in {-(-len(rows) // BG_BATCH)} batches -> {md.IN}/BG-*.json")


def read_bg(only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    """char -> {"about": {short id: bg}, "origin": bg, "link": bg}, checked against the input."""
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    good, problems = {}, []
    for inp in sorted(md.IN.glob(f"BG-{only or '*'}.json")):
        out = md.OUT / inp.name
        if not out.exists():
            problems.append(f"{inp.stem}: no output")
            continue
        try:
            got = json.loads(out.read_text(encoding="utf-8")).get("kanji") or {}
        except json.JSONDecodeError as err:
            problems.append(f"{inp.stem}: not JSON ({err})")
            continue
        for k in json.loads(inp.read_text(encoding="utf-8"))["kanji"]:
            c, e = k["char"], got.get(k["char"])
            if not isinstance(e, dict):
                problems.append(f"{inp.stem} {c}: missing")
                continue
            x = {"about": {}}
            for g in k["groups"]:
                t = (e.get("about") or {}).get(g["id"])
                if g["about"] and not (isinstance(t, str) and t.strip() and len(t) <= 500):
                    problems.append(f"{inp.stem} {c} {g['id']}: about missing")
                elif g["about"]:
                    x["about"][g["id"]] = t.strip()
            for f in ("origin", "link"):
                t = e.get(f)
                if k[f] and not (isinstance(t, str) and t.strip()):
                    problems.append(f"{inp.stem} {c}: {f} missing")
                elif k[f]:
                    x[f] = t.strip()
            if any(re.search(r"кандзи", t) for t in [*x["about"].values(), x.get("origin") or "", x.get("link") or ""]):
                problems.append(f"{inp.stem} {c}: «кандзи» -- Japanese kanji are «канджи»")
            good[c] = x
    return good, problems


def check_bg(only: str | None) -> None:
    good, problems = read_bg(only)
    print(f"Bulgarian: {len(good)} kanji, {len(problems)} problems")
    for p in problems[:30]:
        print("   ", p)


# ---------------------------------------------------------------- load


def load(dry_run: bool, review_dir: Path | None) -> None:
    """The extras onto each kanji's open, untouched groups item, and a kanji_extras item beside it."""
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    extras, problems = read_extras()
    bg, bg_problems = read_bg()
    cands = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    print(f"extras {len(extras)} kanji ({len(problems)} problems), Bulgarian {len(bg)} ({len(bg_problems)} problems), "
          f"candidates {len(cands)}")
    proposals.use_review_dir(review_dir)
    done = notes = 0
    left: list[str] = []
    with review._change() as data:
        decided = {d["subject"].split("|")[0] for d in data["decisions"] if d["type"] in ("kanji_senses", "word_sense", "kanji_extras")}
        groups_item = {i["subject"]: i for i in data["items"].values() if i["type"] == "kanji_senses" and i["status"] == "open"}
        extras_item = {i["subject"]: i for i in data["items"].values() if i["type"] == "kanji_extras" and i["status"] == "open"}
        for c, x in extras.items():
            g = groups_item.get(c)
            if g is None or c in decided or g.get("skipped_by") or not g["proposed"]:
                left.append(c)
                continue
            b = bg.get(c, {})
            k = cands.get(c, {})
            ticked = {sid: [r["char"] for r in rows if r["ticked"]] for sid, rows in (k.get("similar") or {}).items()}
            senses = []
            for s in g["proposed"]:
                short = s["id"].split(".", 1)[1]
                senses.append({
                    **s,
                    "about": x["about"].get(short),
                    "aboutBg": b.get("about", {}).get(short),
                    "examples": x["examples"].get(short) or [],
                    "original": s["id"] in (k.get("original") or []),
                    "similar": ticked.get(s["id"]) or [],
                })
            note = {
                "origin": x.get("origin"), "originBg": b.get("origin") if x.get("origin") else None,
                "originSure": x.get("originSure", True) if x.get("origin") else None,
                "link": x.get("link"), "linkBg": b.get("link") if x.get("link") else None,
                "mixups": [{"char": r["char"], "reading": r["reading"]} for r in k.get("mixups") or [] if r["ticked"]],
            }
            evidence = {**(g.get("evidence") or {}), "candidates": {
                "similar": k.get("similar") or {}, "unplaced": k.get("unplaced") or [], "mixups": k.get("mixups") or []}}
            evidence.pop("extras", None)  # now on the value itself
            if dry_run:
                review.validate("kanji_senses", c, senses, data, pending_ok=True, machine=True)
                review.validate("kanji_extras", c, note, data, machine=True)
                done += 1
                continue
            review._update(data, g, proposed=review.validate("kanji_senses", c, senses, data, pending_ok=True, machine=True),
                           evidence=evidence)
            note = review.validate("kanji_extras", c, note, data, machine=True)
            old = extras_item.get(c)
            if old:
                review._update(data, old, proposed=note)
            else:
                review._new_item(data, "kanji_extras", c, note, SOURCE, "proposal", None, None, "system", g.get("priority") or 0.0)
                notes += 1
            done += 1
        if dry_run:
            raise SystemExit(f"would add extras to {done} kanji; leave {len(left)}: {''.join(left[:40])}")
    print(f"extras on {done} kanji ({notes} new kanji_extras items); left {len(left)}: {''.join(left[:40])}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("candidates")
    sub.add_parser("prepare-bg")
    cb = sub.add_parser("check-bg")
    cb.add_argument("--batch", help="just this batch's number, e.g. 007")
    proposals.load_parser(sub, "load")
    args = ap.parse_args()
    if args.cmd == "candidates":
        candidates()
    elif args.cmd == "prepare-bg":
        prepare_bg()
    elif args.cmd == "check-bg":
        check_bg(args.batch)
    else:
        load(args.dry_run, args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
