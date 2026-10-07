"""Pilot: do the other dictionaries make better meaning drafts?

    python pipeline/meaning_pilot.py prepare [--n 50] [--seed 1]
    # run A: one Sonnet subagent per in/A-*.json (meaning_prompt.md + meaning_dicts_prompt.md)
    python pipeline/meaning_drafts.py --drafts data/drafts/meanings-pilot prepare-b
    # run B: one subagent per in/B-*.json
    python pipeline/meaning_drafts.py --drafts data/drafts/meanings-pilot check
    python pipeline/meaning_pilot.py compare [--review-dir DIR]

The same drafting as meaning_drafts.py (same batches, same prompt), for a
spread of in-scope kanji, with one addition: each kanji carries what the
other dictionaries say (server/dictionaries.py) -- Kodansha's senses with
their compounds, 新漢語林's 字義, Цалта's keyword and words, Wiktionary.

To measure it fairly, half of the board words Kodansha files under a sense
are held out: the agents see the sense, not those words in it
(holdout.json). `compare` then asks of the current drafts (the queue's
proposals) and of the new ones: for two words Kodansha puts under the same
sense, at least one held out, are they in the same group? A split pair is a
likely misplacement. It also reports what changes for a reviewer: groups
per kanji, catch-all, the two runs' agreement, and how many words would
start ticked.
"""

from __future__ import annotations

import argparse
import json
import random
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import meaning_drafts as md  # noqa: E402
import proposals  # noqa: E402
from proposals import CATCH_ALL, review, sense_id  # noqa: E402

from server import dictionaries, scope  # noqa: E402

DRAFTS = Path("data/drafts/meanings-pilot")
HIGH = review.AUTO_CONFIDENCE


def _plain(s: str) -> str:
    return " ".join(s.replace("**", "").split())


def _dicts_for(char: str, words: list[list]) -> tuple[dict, dict[int, str], dict[int, str]]:
    """What the agents see of the dictionaries, and Kodansha's placements of the board words: (seen, visible, hidden)."""
    board = [{"id": w[0], "headword": w[1], "reading": w[2]} for w in words]
    v = dictionaries.view(char, board)
    rng = random.Random(f"{char}-holdout")
    visible: dict[int, str] = {}
    hidden: dict[int, str] = {}

    def senses(items: list[dict]) -> list[dict]:
        out = []
        for s in items:
            shown = []
            for w in s.get("words") or []:
                wid = w.get("id")
                if wid is not None and wid not in visible and wid not in hidden:
                    if rng.random() < 0.5:
                        hidden[wid] = s["key"]
                        continue
                    visible[wid] = s["key"]
                elif wid in hidden:
                    continue
                shown.append(w["ja"])
            out.append({"n": s["n"], "text": _plain(s["text"]), "words": shown})
        return out

    seen: dict = {}
    k = v.get("kodansha")
    if k:
        seen["kodansha"] = {
            "core": k["core"],
            "senses": senses(k["senses"]),
            "kun": [{"head": h["head"], "senses": senses(h["senses"])} for h in k["kun"]],
            "special": [w["ja"] for w in k["special"]],
        }
    # 新漢語林 is not given to the agents: too unsure a transcription, and classical senses (Dani, 2026-10-07).
    t = dictionaries._tsalta().get(char)
    if t:
        seen["tsalta"] = {"keyword": t.get("keyword"), "alt": t.get("alt_meaning"),
                          "words": [[w.get("ja"), w.get("bg")] for w in t.get("words") or []]}
    if v.get("wiktionary"):
        seen["wiktionary"] = [{"pos": e["pos"], "glosses": e["glosses"]} for e in v["wiktionary"]]
    return seen, visible, hidden


def prepare(n: int, seed: int) -> None:
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    if any(md.IN.glob("A-*.json")):
        raise SystemExit(f"{md.IN} already has batches: delete the folder to start again")
    with md._db() as db:
        chars = scope.kanji(db)
    kod = dictionaries._kodansha()
    with md._db() as db:
        all_k = md._kanji(db, [], "".join(c for c in chars if c in kod))
    # A spread by size: many words, some, few (a kanji with under 3 words has little to place).
    by_size = {"big": [k for k in all_k if len(k["words"]) >= 60],
               "mid": [k for k in all_k if 15 <= len(k["words"]) < 60],
               "small": [k for k in all_k if 3 <= len(k["words"]) < 15]}
    rng = random.Random(seed)
    take = {"big": round(n * 0.3), "mid": round(n * 0.4)}
    take["small"] = n - take["big"] - take["mid"]
    picked = "".join(k["char"] for size, ks in by_size.items() for k in rng.sample(ks, take[size]))
    md.prepare([], None, picked)

    holdout = {}
    for f in sorted(md.IN.glob("A-*.json")):
        batch = json.loads(f.read_text(encoding="utf-8"))
        for k in batch["kanji"]:
            seen, visible, hidden = _dicts_for(k["char"], k["words"])
            k["dictionaries"] = seen
            holdout[k["char"]] = {"visible": {str(w): s for w, s in visible.items()}, "hidden": {str(w): s for w, s in hidden.items()}}
        md._write(f, batch)
    (md.DRAFTS / "holdout.json").write_text(json.dumps(holdout, ensure_ascii=False, indent=1), encoding="utf-8")
    hid = sum(len(h["hidden"]) for h in holdout.values())
    vis = sum(len(h["visible"]) for h in holdout.values())
    print(f"picked {len(picked)} kanji ({', '.join(f'{s} {take[s]}' for s in take)}): {picked}")
    print(f"Kodansha places {vis + hid} of their board words: {vis} shown to the agents, {hid} held out")


# ---------------------------------------------------------------- compare


def _old(chars: set[str], review_dir: Path | None) -> dict[str, dict]:
    """The queue's open drafts for these kanji: groups, and each word's run-A and run-B pick."""
    proposals.use_review_dir(review_dir)
    data = review._read()
    out: dict[str, dict] = {}
    for it in data["items"].values():
        if it["type"] == "kanji_senses" and it["subject"] in chars and it["status"] == "open" and it["proposed"]:
            out.setdefault(it["subject"], {"words": {}})["senses"] = it["proposed"]
    for it in data["items"].values():
        if it["type"] != "word_sense" or it["status"] != "open":
            continue
        c, wid = it["subject"].split("|")
        if c not in out:
            continue
        runs = (it.get("evidence") or {}).get("runs") or []
        a = next((r for r in runs if r["run"] == "A"), None)
        b = next((r for r in runs if r["run"] == "B"), None)
        out[c]["words"][int(wid)] = (a["sense"] if a else it["proposed"], a["confidence"] if a else 0.0,
                                     b["sense"] if b else None, b["confidence"] if b else 0.0)
    return out


def _new(a: dict, b: dict) -> dict[str, dict]:
    out = {}
    for c, v in a.items():
        second = b.get(c, {}).get("words", {})
        out[c] = {"senses": [{**s, "id": sense_id(c, s["id"])} for s in v["senses"]], "words": {}}
        for wid, (s, conf) in v["words"].items():
            sb = second.get(wid)
            out[c]["words"][wid] = (sense_id(c, s), conf, sense_id(c, sb[0]) if sb else None, sb[1] if sb else 0.0)
    return out


def _pairs(drafts: dict[str, dict], holdout: dict, which: str) -> tuple[int, int]:
    """Pairs of words Kodansha puts under one sense (at least one `which`: hidden, or any), and how many a draft splits."""
    split = total = 0
    for c, h in holdout.items():
        d = drafts.get(c)
        if not d:
            continue
        sense = {int(w): s for part in ("visible", "hidden") for w, s in h[part].items()}
        hidden = {int(w) for w in h["hidden"]}
        ids = sorted(w for w in sense if w in d["words"])
        for i, x in enumerate(ids):
            for y in ids[i + 1:]:
                if sense[x] != sense[y] or (which == "hidden" and x not in hidden and y not in hidden):
                    continue
                total += 1
                split += d["words"][x][0] != d["words"][y][0]
    return split, total


def _summary(d: dict[str, dict]) -> dict:
    words = [w for v in d.values() for w in v["words"].values()]
    agree = [w for w in words if w[2] is not None]
    return {
        "groups per kanji": dict(sorted(Counter(len(v["senses"]) for v in d.values()).items())),
        "catch-all": f"{sum(1 for w in words if w[0].endswith(CATCH_ALL)) / max(len(words), 1):.1%}",
        "runs agree": f"{sum(1 for w in agree if w[0] == w[2]) / max(len(agree), 1):.1%}",
        "start ticked (agree, both >= %.2f)" % HIGH: f"{sum(1 for w in agree if w[0] == w[2] and min(w[1], w[3]) >= HIGH) / max(len(words), 1):.1%}",
    }


def compare(review_dir: Path | None) -> None:
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    holdout = json.loads((md.DRAFTS / "holdout.json").read_text(encoding="utf-8"))
    a, b = md.check()
    new = _new(a, b)
    old = _old(set(new), review_dir)
    both = sorted(set(new) & set(old))
    print(f"\n{len(both)} kanji drafted both ways")
    # Only words both drafts place: the old load left out words filed under a kanji for a rare spelling.
    for c in both:
        common = set(old[c]["words"]) & set(new[c]["words"])
        for d in (old, new):
            d[c] = {**d[c], "words": {w: p for w, p in d[c]["words"].items() if w in common}}
    old, new = {c: old[c] for c in both}, {c: new[c] for c in both}
    hold = {c: holdout[c] for c in both}
    for name, d in (("current drafts", old), ("with dictionaries", new)):
        sh, th = _pairs(d, hold, "hidden")
        sa, ta = _pairs(d, hold, "any")
        print(f"\n{name}")
        print(f"  Kodansha pairs split, held-out words: {sh}/{th} ({sh / max(th, 1):.1%})")
        print(f"  Kodansha pairs split, all its words:  {sa}/{ta} ({sa / max(ta, 1):.1%})")
        for k, v in _summary(d).items():
            print(f"  {k}: {v}")
    # Per kanji, the groups both ways, for reading through.
    lines = []
    for c in both:
        sh_o, th = _pairs({c: old[c]}, {c: hold[c]}, "hidden")
        sh_n, _ = _pairs({c: new[c]}, {c: hold[c]}, "hidden")
        lines.append(f"{c}  split held-out pairs {sh_o}/{th} -> {sh_n}/{th}")
        lines.append(f"   now:  {' | '.join(s['en'] for s in old[c]['senses'])}")
        lines.append(f"   new:  {' | '.join(s['en'] for s in new[c]['senses'])}")
    (md.DRAFTS / "compare.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nper kanji: {(md.DRAFTS / 'compare.txt').relative_to(proposals.ROOT)}")


def load(review_dir: Path) -> None:
    """The pilot's drafts in place of the current ones, in a sandbox's queue, to judge them on the cards.
    Only kanji no one has touched: the groups item open and undecided, no word decided."""
    md.DRAFTS, md.IN, md.OUT = proposals.folders(DRAFTS)
    a, b = md.check()
    with md._db() as db:
        nf = {r["id"]: r["nf"] for r in db.execute(f"SELECT w.id, w.nf FROM word w WHERE {scope.WORDS}")}
        head = {r["id"]: r["headword"] for r in db.execute(f"SELECT w.id, w.headword FROM word w WHERE {scope.WORDS}")}
    # As meaning_drafts.load: a word filed under the kanji only for a rare spelling (２月 under 二) is not queued.
    for c, v in a.items():
        v["words"] = {w: p for w, p in v["words"].items() if c in head.get(w, "")}
    proposals.use_review_dir(review_dir)
    done = words = 0
    with review._change() as data:
        decided = {d["subject"].split("|")[0] for d in data["decisions"] if d["type"] in ("kanji_senses", "word_sense")}
        items = list(data["items"].values())
        for c, v in a.items():
            g = next((i for i in items if i["type"] == "kanji_senses" and i["subject"] == c and i["status"] == "open"), None)
            if g is None or c in decided or g.get("skipped_by"):
                continue
            review._update(data, g, proposed=review.validate("kanji_senses", c, v["senses"], data, pending_ok=True, machine=True),
                           reason="pilot: drafted with the other dictionaries")
            open_words = {int(i["subject"].split("|")[1]): i for i in items
                          if i["type"] == "word_sense" and i["status"] == "open" and i["subject"].startswith(f"{c}|")}
            second = b.get(c, {}).get("words", {})
            for wid, pick in v["words"].items():
                row = md._word_row(c, wid, pick, second.get(wid), nf)
                it = open_words.get(wid)
                if it is None:
                    review._new_item(data, row["type"], row["subject"], row["proposed"], row["source"], "proposal",
                                     None, row["evidence"], "system", row["priority"])
                else:
                    review._update(data, it, proposed=row["proposed"], evidence=row["evidence"])
                words += 1
            done += 1
    print(f"replaced the drafts of {done} kanji ({words} words) in {review_dir}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--n", type=int, default=50)
    p.add_argument("--seed", type=int, default=1)
    c = sub.add_parser("compare")
    c.add_argument("--review-dir", type=Path, help="the review data the current drafts are read from (default: data/review)")
    ld = sub.add_parser("load", help="the pilot's drafts in place of the current ones, in a sandbox")
    ld.add_argument("--review-dir", type=Path, required=True, help="a sandbox's review folder (never data/review)")
    args = ap.parse_args()
    if args.cmd == "prepare":
        prepare(args.n, args.seed)
    elif args.cmd == "load":
        if args.review_dir.resolve() == (proposals.ROOT / "data" / "review").resolve():
            raise SystemExit("the pilot goes into a sandbox, not data/review")
        load(args.review_dir)
    else:
        compare(args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
