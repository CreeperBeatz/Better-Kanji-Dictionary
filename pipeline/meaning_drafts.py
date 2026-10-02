"""Draft meaning groups and word placements with Claude Code subagents, then queue them.

    python pipeline/meaning_drafts.py prepare [--levels 5,4,3,2] [--sample N]
    # run A: one Sonnet subagent per in/A-*.json, each writing out/A-*.json
    python pipeline/meaning_drafts.py prepare-b
    # run B: one subagent per in/B-*.json, each writing out/B-*.json
    python pipeline/meaning_drafts.py check
    python pipeline/meaning_drafts.py load [--dry-run] [--review-dir DIR]

Tasks C and D of TASK-forms-review.md. No model is called from here: the
subagents (Claude Code, Sonnet, up to 20 at once) each read
pipeline/meaning_prompt.md and one input batch, and write one JSON file.

- **Run A** drafts each kanji's 2-6 meaning groups and places every one of
  its common words in a group or the catch-all, with a confidence.
- **Run B** places the same words again, given A's groups, in a shuffled
  order: a second, independent opinion. Where A and B agree with high
  confidence, a word may be accepted without a person once a reviewer has
  accepted the kanji's groups unchanged (the §6 rule; server/review.py).

`check` validates every output against what was asked -- the ids, the
groups, every word placed exactly once -- and reports agreement. `load`
puts what passed into the review queue as proposals; with --dry-run it
only prints the counts, which is what Dani sees before anything is loaded.

Drafts live in data/drafts/meanings/ (untracked).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
DB = ROOT / "data" / "betterrtk.sqlite"
DRAFTS = ROOT / "data" / "drafts" / "meanings"
IN, OUT = DRAFTS / "in", DRAFTS / "out"

BATCH_WORDS = 400  # words per batch: one kanji with more gets a batch of its own
SOURCE = "ai:claude-sonnet"
SENSE_ID = re.compile(r"^[a-z0-9-]{1,24}$")
CATCH_ALL = "catch-all"
HIGH = 0.8  # a confidence this high, from both runs, may let the §6 rule accept a word


def _db() -> sqlite3.Connection:
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    return db


def _kanji(db: sqlite3.Connection, levels: list[int]) -> list[dict]:
    marks = ",".join("?" * len(levels))
    rows = db.execute(
        f"SELECT k.char, k.meanings, k.on_yomi, k.kun_yomi, k.freq, c.meaning AS curated "
        f"FROM kanji k LEFT JOIN kanji_curated c ON c.char = k.char "
        f"WHERE k.jlpt IN ({marks}) ORDER BY k.jlpt DESC, k.freq IS NULL, k.freq",
        levels,
    ).fetchall()
    out = []
    for r in rows:
        words = db.execute(
            "SELECT w.id, w.headword, w.reading, "
            "(SELECT s.gloss FROM sense s WHERE s.word_id = w.id ORDER BY s.ord LIMIT 1) AS gloss "
            "FROM word_char wc JOIN word w ON w.id = wc.word_id "
            "WHERE wc.char = ? AND w.common = 1 ORDER BY w.nf IS NULL, w.nf, LENGTH(w.headword), w.id",
            (r["char"],),
        ).fetchall()
        out.append({
            "char": r["char"],
            "kanjidic": json.loads(r["meanings"] or "[]"),
            "curated": r["curated"],
            "on": json.loads(r["on_yomi"] or "[]"),
            "kun": json.loads(r["kun_yomi"] or "[]"),
            "freq": r["freq"],
            "words": [[w["id"], w["headword"], w["reading"], (w["gloss"] or "").split(";")[0][:60]] for w in words],
        })
    return out


def _batches(kanji: list[dict]) -> list[list[dict]]:
    out, cur, n = [], [], 0
    for k in kanji:
        size = max(len(k["words"]), 1)
        if cur and n + size > BATCH_WORDS:
            out.append(cur)
            cur, n = [], 0
        cur.append(k)
        n += size
    if cur:
        out.append(cur)
    return out


def _write(path: Path, data: dict) -> None:
    """One kanji per line, so a batch reads easily."""
    path.parent.mkdir(parents=True, exist_ok=True)
    head = json.dumps({k: v for k, v in data.items() if k != "kanji"}, ensure_ascii=False)
    lines = ",\n".join(json.dumps(k, ensure_ascii=False) for k in data["kanji"])
    path.write_text(f'{head[:-1]}, "kanji": [\n{lines}\n]}}\n', encoding="utf-8")


def prepare(levels: list[int], sample: int | None) -> None:
    with _db() as db:
        kanji = _kanji(db, levels)
    if sample:
        # A spread, not the first few: common and rare, few words and many.
        step = max(1, len(kanji) // sample)
        kanji = kanji[::step][:sample]
    batches = _batches(kanji)
    for i, b in enumerate(batches):
        name = f"A-{i:03d}"
        for k in b:
            k.pop("freq", None)
        _write(IN / f"{name}.json", {"batch": name, "run": "A", "kanji": b})
    words = sum(len(k["words"]) for k in kanji)
    print(f"{len(kanji)} kanji, {words} words in {len(batches)} batches -> {IN.relative_to(ROOT)}/A-*.json")


def _load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  {path.name}: unreadable ({e})")
        return None


def _valid_senses(senses) -> list[dict] | None:
    if not isinstance(senses, list) or not 2 <= len(senses) <= 6:
        return None
    ids = set()
    out = []
    for s in senses:
        if not isinstance(s, dict):
            return None
        sid, en = str(s.get("id", "")).strip().lower(), (s.get("en") or "").strip()
        if not SENSE_ID.match(sid) or sid == CATCH_ALL or sid in ids or not en or len(en.split()) > 4 or len(en) > 40:
            return None
        ids.add(sid)
        out.append({"id": sid, "en": en, "bg": (s.get("bg") or "").strip()[:40] or None, "note": (s.get("note") or "").strip()[:200] or None})
    return out


def _valid_words(words, wanted: set[int], ids: set[str]) -> dict[int, tuple[str, float]] | None:
    if not isinstance(words, dict):
        return None
    out: dict[int, tuple[str, float]] = {}
    for k, v in words.items():
        if not str(k).isdigit() or int(k) not in wanted or not isinstance(v, dict):
            return None
        sense = str(v.get("sense", ""))
        try:
            conf = float(v.get("confidence"))
        except (TypeError, ValueError):
            return None
        if sense not in ids | {CATCH_ALL} or not 0 <= conf <= 1:
            return None
        out[int(k)] = (sense, conf)
    return out if set(out) == wanted else None


def read_run(run: str, senses_from: dict[str, list[dict]] | None = None, only: str | None = None) -> tuple[dict[str, dict], list[str]]:
    """Every valid kanji of a run's outputs (or one batch's), and what was wrong with the rest."""
    good: dict[str, dict] = {}
    problems: list[str] = []
    for inp in sorted(IN.glob(f"{run}-{only or '*'}.json")):
        batch = _load_json(inp)
        out = _load_json(OUT / inp.name) if (OUT / inp.name).exists() else None
        if batch is None:
            continue
        if out is None:
            problems.append(f"{inp.stem}: no output")
            continue
        got = out.get("kanji") or {}
        for k in batch["kanji"]:
            c = k["char"]
            entry = got.get(c)
            if not isinstance(entry, dict):
                problems.append(f"{inp.stem} {c}: missing")
                continue
            senses = _valid_senses(entry.get("senses")) if run == "A" else (senses_from or {}).get(c)
            if senses is None:
                problems.append(f"{inp.stem} {c}: bad senses")
                continue
            words = _valid_words(entry.get("words"), {w[0] for w in k["words"]}, {s["id"] for s in senses})
            if words is None:
                problems.append(f"{inp.stem} {c}: bad or incomplete words")
                continue
            good[c] = {"senses": senses, "words": words}
    return good, problems


def prepare_b(only: str | None = None) -> None:
    """B batches from A's outputs; `only` the number of one batch (007)."""
    a, problems = read_run("A", only=only)
    if problems:
        print(f"run A has {len(problems)} problems; run B covers the {len(a)} good kanji")
    rng = random.Random(7)
    n = 0
    for inp in sorted(IN.glob(f"A-{only or '*'}.json")):
        batch = _load_json(inp)
        keep = []
        for k in batch["kanji"]:
            if k["char"] not in a:
                continue
            words = list(k["words"])
            rng.shuffle(words)  # another order, so the second opinion is not the first one again
            keep.append({**k, "words": words, "senses": a[k["char"]]["senses"]})
        if keep:
            name = inp.stem.replace("A-", "B-")
            _write(IN / f"{name}.json", {"batch": name, "run": "B", "kanji": keep})
            n += 1
    print(f"{n} run-B batches -> {IN.relative_to(ROOT)}/B-*.json")


def check(only: str | None = None) -> tuple[dict, dict]:
    a, pa = read_run("A", only=only)
    b, pb = read_run("B", {c: v["senses"] for c, v in a.items()}, only=only)
    print(f"run A: {len(a)} kanji valid, {len(pa)} problems")
    for p in pa[:20]:
        print("   ", p)
    if list(IN.glob(f"B-{only or '*'}.json")):
        print(f"run B: {len(b)} kanji valid, {len(pb)} problems")
        for p in pb[:20]:
            print("   ", p)
    sizes = Counter(len(v["senses"]) for v in a.values())
    print("groups per kanji:", dict(sorted(sizes.items())))
    words = sum(len(v["words"]) for v in a.values())
    catch = sum(1 for v in a.values() for s, _ in v["words"].values() if s == CATCH_ALL)
    print(f"words placed: {words}, catch-all {catch} ({catch / max(words, 1):.1%})")
    if b:
        both = agree = high = 0
        for c, v in b.items():
            for wid, (s, conf) in v["words"].items():
                sa, ca = a[c]["words"][wid]
                both += 1
                if s == sa:
                    agree += 1
                    if min(conf, ca) >= HIGH:
                        high += 1
        print(f"A and B agree on {agree}/{both} ({agree / max(both, 1):.1%}); both confident on {high} ({high / max(both, 1):.1%})")
    return a, b


def load(dry_run: bool, review_dir: Path | None) -> None:
    a, b = check()
    with _db() as db:
        freq = {r["char"]: r["freq"] for r in db.execute("SELECT char, freq FROM kanji")}
        nf = {r["id"]: r["nf"] for r in db.execute("SELECT id, nf FROM word WHERE common = 1")}
        head = {r["id"]: r["headword"] for r in db.execute("SELECT id, headword FROM word WHERE common = 1")}
    # A word filed under the kanji only for a rare spelling (夫 under 人, for 良人)
    # is not shown with it (search.words_with), so it is not queued either.
    for c, v in a.items():
        v["words"] = {w: p for w, p in v["words"].items() if c in head.get(w, "")}
    n_senses = len(a)
    n_words = sum(len(v["words"]) for v in a.values())
    print(f"\nwould load {n_senses} kanji_senses and {n_words} word_sense proposals (source {SOURCE})")
    if dry_run:
        return
    from server import review

    if review_dir:
        review.use_dir(review_dir)
    rows = []
    for c, v in a.items():
        f = freq.get(c) or 3000
        rows.append({"type": "kanji_senses", "subject": c, "proposed": v["senses"], "source": SOURCE,
                     "priority": round(10 - f / 500, 2), "reason": "drafted from its common words"})
        for wid, (sense, conf) in v["words"].items():
            runs = [{"run": "A", "sense": f"{c}.{sense}" if sense != CATCH_ALL else sense, "confidence": conf}]
            if c in b and wid in b[c]["words"]:
                sb, cb = b[c]["words"][wid]
                runs.append({"run": "B", "sense": f"{c}.{sb}" if sb != CATCH_ALL else sb, "confidence": cb})
            rows.append({
                "type": "word_sense", "subject": f"{c}|{wid}", "proposed": runs[0]["sense"], "source": SOURCE,
                "evidence": {"runs": runs, "confidence": min(r["confidence"] for r in runs),
                             "agree": len(runs) == 2 and runs[0]["sense"] == runs[1]["sense"]},
                "priority": round(5 - (nf.get(wid) or 48) / 10, 2),
            })
    added, refused = review.add_items(rows)
    print(f"added {added}, refused {refused}")
    print("loaded:", review.counts()["items"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--levels", default="5,4,3,2")
    p.add_argument("--sample", type=int)
    pb = sub.add_parser("prepare-b")
    pb.add_argument("--batch", help="just this batch's number, e.g. 007")
    ck = sub.add_parser("check")
    ck.add_argument("--batch", help="just this batch's number, e.g. 007")
    l = sub.add_parser("load")
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare([int(x) for x in args.levels.split(",")], args.sample)
    elif args.cmd == "prepare-b":
        prepare_b(args.batch)
    elif args.cmd == "check":
        check(args.batch)
    else:
        load(args.dry_run, args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
