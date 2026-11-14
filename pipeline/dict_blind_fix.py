"""BKD's problems from the five-way blind check, verified with the web, then fixed (Dani, 2026-11-14).

    python pipeline/dict_blind_fix.py verify-prepare [--size 6]
    # one Sonnet subagent per verify/in/*.md, each reading pipeline/dict_blind_fix_prompt.md
    python pipeline/dict_blind_fix.py verify-report
    python pipeline/dict_blind_fix.py load [--dry-run] [--review-dir DIR]   # the hand-picked fixes, into the review store

Every error the graders gave BKD's entry (data/drafts/dict-blind/errors.json), grouped by
kanji. The verifier sees BKD's entry as the site shows it: each meaning with its id, every
word with the sense placed in that meaning (`senseAt`) and its full gloss, the catch-all
("used for its sound only"), and the readings line. The first run's entries showed each
word's first sense, cut at 70 characters; a claim that only held for that is an artifact.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import dict_blind as db  # noqa: E402
import kodansha_blind as kb  # noqa: E402

D = db.DRAFTS / "fix"
SEED = 20261115


def _w(w: dict, tag: str = "") -> str:
    g = db.shown_gloss(w) or ""
    star = "★ " if w.get("star") else ""
    return f"{star}{kb._w(w['headword'], w.get('reading'))}{tag} — {g}"


def entry(page: dict, on: list[str], kun: list[str]) -> str:
    lines = [f"Readings: on {', '.join(kb._kata(r) for r in on) or '—'} | kun {', '.join(kb._kun(r) for r in kun) or '—'}",
             "Meanings (id: label):"]
    for m in page["meanings"]:
        lines.append(f"  [{m['id']}] {m['en']}  ({m.get('total', '?')} common words in all)")
        kun_w = (m.get("kun") or {}).get("words") or []
        on_w = [w for o in m.get("on") or [] for w in o["words"]]
        for w in kun_w + on_w:
            lines.append(f"     - {_w(w)}")
        for a in m.get("also") or []:
            for w in a.get("words", [])[:1]:
                lines.append(f"     - {_w(w, ' [also listed here]')}")
        for w in m.get("exceptions") or []:
            lines.append(f"     - {_w(w, ' [special reading]')}")
    if page.get("soundOnly") and page["soundOnly"].get("words"):
        lines.append("  [catch-all] shown as 'the kanji is used for its sound only'")
        for w in page["soundOnly"]["words"]:
            lines.append(f"     - {_w(w)}")
    if page.get("special"):
        lines.append("  Special readings: " + ", ".join(_w(w) for w in page["special"]))
    return "\n".join(lines)


def verify_prepare(size: int) -> None:
    import sqlite3
    pages = json.loads((db.DRAFTS / "prod-pages.json").read_text(encoding="utf-8"))
    sql = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
    errs = [e for e in json.loads((db.DRAFTS / "errors.json").read_text(encoding="utf-8")) if e["who"] == "bkd"]
    by = defaultdict(list)
    for e in errs:
        by[e["char"]].append(e)
    chars = sorted(by)
    (D / "in").mkdir(parents=True, exist_ok=True)
    (D / "out").mkdir(parents=True, exist_ok=True)
    items = []
    for b in range(math.ceil(len(chars) / size)):
        chunk = chars[b * size:(b + 1) * size]
        parts = [f"# Verify batch fx-{b:02d}: {len(chunk)} kanji\n"]
        for c in chunk:
            on, kun = (json.loads(x or "[]") for x in sql.execute("SELECT on_yomi, kun_yomi FROM kanji WHERE char=?", (c,)).fetchone())
            claims = []
            for e in by[c]:
                cid = f"c{len(items):03d}"
                items.append({"id": cid, "char": c, **{k: e.get(k) for k in ("severity", "kind", "item", "what")}})
                claims.append(f"- {cid} ({e['severity']}, {e['kind']}, on {e.get('item')}): {e['what']}")
            parts.append(f"## {c}\n\n### The entry\n{entry(pages[c], on, kun)}\n\n### Claims\n" + "\n".join(claims) + "\n")
        (D / "in" / f"fx-{b:02d}.md").write_text("\n".join(parts), encoding="utf-8")
    (D / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} claims on {len(chars)} kanji, {math.ceil(len(chars) / size)} batches")


def verify_report() -> None:
    items = {i["id"]: i for i in json.loads((D / "items.json").read_text(encoding="utf-8"))}
    got = {}
    for f in sorted((D / "out").glob("fx-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["claims"]:
            got[r["id"]] = r
    missing = [i for i in items if i not in got]
    t = Counter()
    for i, it in items.items():
        r = got.get(i)
        if r:
            t[(it["severity"], r["verdict"])] += 1
    print(f"{len(got)}/{len(items)} verified; missing {' '.join(missing) or 'none'}")
    for k, v in sorted(t.items()):
        print(f"  {k[0]:5} {k[1]:9} {v}")
    fixes = [{**items[i], **got[i]} for i in items if i in got and got[i]["verdict"] == "confirmed" and got[i].get("fix")]
    (D / "confirmed.json").write_text(json.dumps(fixes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(fixes)} confirmed with a fix -> {D / 'confirmed.json'}")
    print(Counter(f["fix"]["type"] for f in fixes))


# ---------------------------------------------------------------- the fixes (2026-11-14)
# Picked by hand from confirmed.json. Left out, with why:
#   次 "order", "Nth time" and 植 植物 (c074, c076, c077): the page has them as Uses blocks,
#     which neither the graders nor the verifiers saw.
#   我慢 未練 皮肉 雲母 金糸雀 酔っ払い 落ち着き払う (c046, c106, c108, c078, c098, c050): the kanji
#     is not there for its sound, but its meaning in the word today is not the group's either
#     (我慢 "patience" is not "arrogant"). They stay in the catch-all, whose heading now says
#     "No clear meaning" (web/src/detail/MeaningCards.tsx). 払's "completely" was not confirmed.
#   臆 臆測, 絶 絶つ, 禄 貫禄 (c111, c103, c091): not on the page whatever their group (headword
#     憶測 / 断つ, or not common): D-048.
#   宙's defunct agency names (c016): common in JMdict and placed right; no way to hide a word.
#   掃 シュ, 梢 くすのき (c059, c072): data/reading_fixes.json (D-045). 見 下見 (c124): D-047.
#   遣 気遣わしい's English (c139): JMdict's (D-043).
SOURCE = "ai:claude-opus"
REASON = "five-way blind check 2026-11-14: a grader's error, confirmed by a web check"
MOVES = {  # word -> its group, and the claim behind it
    "山|1913490": ("山.mountain", "c019"),  # 山鉾, a float topped like a mountain
    "山|1755200": ("山.mountain", "c019"),  # 山吹, the kerria of the hills (山振)
    "念|1469470": ("念.remember", "c034"),  # 念仏, calling the Buddha to mind
    "抜|1620490": ("抜.pull", "c053"),  # 生え抜き, from 生え抜く
    "月|1255580": ("月.moon", "c066"),  # 月桂冠, the laurel of the moon legend
    "禄|1261110": ("禄.stipend", "c090"),  # 元禄, an era named for good fortune
    "未|1527090": ("未.sheep", "c068"),  # 未 ひつじ, the zodiac sign
}
SENSES = {  # word -> main group, its other groups, which sense of the word each group shows
    "幼|1545250": ("幼.child", [], {"幼.child": 1}, "c031"),  # 幼稚: childish, not infancy
    "細|1295530": ("細.small", ["細.detail"], {"細.detail": 1}, "c101"),  # 細かい: also fine, minute
    "親|1365220": ("親.kin", ["親.close"], {"親.close": 1}, "c128"),  # 親身: also kind, cordial
}
LABELS = {  # group -> new label (and note), en + bg
    "匠.craftsman": {"en": "craftsman, master; design", "bg": "майстор, занаятчия; замисъл",
                    "about": "A skilled worker who makes things by hand, and a master of an art. "
                             "In 意匠 it is the skill of making: a design or an idea.",
                    "aboutBg": "Умел работник, който прави неща на ръка, и майстор на изкуство. "
                               "В 意匠 това е умението да се създава: замисъл или идея.", "claim": "c007"},
    "衷.inner": {"en": "inner heart, sincerity; middle", "bg": "вътрешно сърце, искреност; среда", "claim": "c121"},
    "醒.awake": {"en": "wake up, sober up", "bg": "събуждам се, изтрезнявам", "claim": "c144"},
    "鬼.fierce": {"en": "uncanny, superhuman", "bg": "свръхестествен, нечовешки", "claim": "c157"},
}
NEW_GROUPS = {
    "未": {"id": "未.sheep", "en": "the Sheep (zodiac sign)", "bg": "Овцата (зодиакален знак)",
          "about": "The eighth of the twelve signs of the zodiac, the Sheep. It also names the hour around 2 p.m.",
          "aboutBg": "Осмият от дванайсетте знака на зодиака, Овцата. Назовава и часа около 14 ч.",
          "examples": [1527090], "claim": "c068"},
}


def load(dry_run: bool, review_dir: Path | None) -> None:
    import proposals
    from server import review

    proposals.use_review_dir(review_dir)
    n = Counter()

    def latest(data: dict, type_: str, subject: str) -> dict | None:
        its = [i for i in data["items"].values() if i["type"] == type_ and i["subject"] == subject]
        return max(its, key=lambda i: i["created"]) if its else None

    def is_open(item: dict | None) -> bool:
        return bool(item) and item["status"] == "open" and item["origin"] == "proposal" and not item.get("skipped_by")

    with review._change() as data:
        # The kanji's groups first, new ones and new labels, so the words can go there.
        chars = {g.split(".")[0] for g in LABELS} | set(NEW_GROUPS)
        groups = {}
        for c in sorted(chars):
            if review._senses(data, c) is not None:
                raise SystemExit(f"{c}: its meanings were accepted by a person; not touched")
            item = latest(data, "kanji_senses", c)
            if not is_open(item):
                raise SystemExit(f"{c}: its draft is not an open, untouched proposal")
            new = [dict(g) if isinstance(g, dict) else g for g in item["proposed"]]
            for g in new:
                if isinstance(g, dict) and g.get("id") in LABELS:
                    g.update({k: v for k, v in LABELS[g["id"]].items() if k != "claim"})
                    n["groups relabelled"] += 1
            if c in NEW_GROUPS and NEW_GROUPS[c]["id"] not in {x.get("id") for x in new if isinstance(x, dict)}:
                new.append({k: v for k, v in NEW_GROUPS[c].items() if k != "claim"})
                n["groups added"] += 1
            review.validate("kanji_senses", c, new, data)
            groups[c] = (item, new)
        for c, (item, new) in groups.items():
            ev = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
            if not dry_run:
                review._update(data, item, proposed=new, source=SOURCE, reason=REASON,
                               evidence={**ev, "dictBlind": {"labels": [g for g in LABELS if g.startswith(c + ".")],
                                                             "added": [NEW_GROUPS[c]["id"]] if c in NEW_GROUPS else []}})
        # Then the words.
        todo = {s: (to, [], {}, claim) for s, (to, claim) in MOVES.items()} | SENSES
        for subject, (to, also, at, claim) in todo.items():
            if subject in data["live"]["word_sense"]:
                raise SystemExit(f"{subject}: its placement was accepted by a person; not touched")
            it = latest(data, "word_sense", subject)
            if not is_open(it):
                raise SystemExit(f"{subject}: its draft is not an open, untouched proposal")
            review.validate("word_sense", subject, to, data, pending_ok=True, machine=True)
            old = it.get("evidence") if isinstance(it.get("evidence"), dict) else {}
            ev = {"runs": [{"run": "dict-blind", "sense": to, "confidence": 0.9}], "confidence": 0.9, "agree": True,
                  "also": also, "at": at,
                  "dictBlind": {"claim": claim, "was": it["proposed"], "wasAlso": old.get("also") or []}}
            n["words moved" if it["proposed"] != to else "words given a sense or another group"] += 1
            if not dry_run:
                review._update(data, it, proposed=to, evidence={**old, **ev}, source=SOURCE, reason=REASON)
        if dry_run:
            raise SystemExit(f"dry run, nothing written: {dict(sorted(n.items()))}")
    print(dict(sorted(n.items())))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("verify-prepare")
    p.add_argument("--size", type=int, default=6)
    sub.add_parser("verify-report")
    lp = sub.add_parser("load")
    lp.add_argument("--dry-run", action="store_true")
    lp.add_argument("--review-dir", type=Path)
    a = ap.parse_args()
    {"verify-prepare": lambda: verify_prepare(a.size), "verify-report": verify_report,
     "load": lambda: load(a.dry_run, a.review_dir)}[a.cmd]()


if __name__ == "__main__":
    main()
