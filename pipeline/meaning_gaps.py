"""Meanings no group holds (D-027): screen a kanji's groups against all its common words (2026-11-02).

    python pipeline/meaning_gaps.py pilot-prepare          # 8 known + 42 random kanji, 10 a batch
    # one Opus subagent per in/*.md, each reading pipeline/meaning_gaps_prompt.md
    python pipeline/meaning_gaps.py check
    python pipeline/meaning_gaps.py skeptic-prepare        # every flag, for a Sonnet agent with the web
    # one Sonnet subagent per skeptic/in/*.md, each reading pipeline/meaning_gaps_skeptic_prompt.md
    python pipeline/meaning_gaps.py report

The blind check against Kodansha (pipeline/kodansha_blind.py) found that all
our major errors are one kind: the kanji has a meaning none of its groups
holds, so its word is in no group (及び) or in the nearest one (懲りる under
"punish", 照れる under "shine"). Unplaced words a script can count; misplaced
ones it can't. So a model reads each kanji whole: its groups as the site
shows them, and every common word with its JMdict senses and its group.

Data is read from prod (the local review store is behind it): the groups and
their notes from /api/search/kanji-page, the placements from
/api/search/words-with?common=true. Glosses come from the local DB (same
JMdict build). Kodansha is not shown: a later blind check stays independent.

The pilot: the 8 kanji the verified check flagged (懲 照 及 膳 燥 並 醒 采),
mixed unmarked with 42 random kanji. It measures whether the screen finds the
known gaps, how many kanji it flags, and (via the skeptic) how often a flag is right.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRAFTS = ROOT / "data" / "drafts" / "meaning-gaps"
IN, OUT = DRAFTS / "in", DRAFTS / "out"
SK = DRAFTS / "skeptic"
SEED = 20261103
KNOWN = list("懲照及膳燥並醒采")
API = "https://betterkanjidictionary.org/api/search/"
LEVEL = {1: "N1", 2: "N2", 3: "N3", 4: "N4", 5: "N5"}


def _get(path: str) -> dict:
    req = urllib.request.Request(API + path, headers={"User-Agent": "curl/8.0"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def _prod(chars: list[str]) -> dict[str, dict]:
    """Each kanji's page and its common words by group, from prod, cached."""
    f = DRAFTS / "prod.json"
    have = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
    for c in chars:
        if c in have:
            continue
        q = urllib.parse.quote(c)
        page = _get(f"kanji-page/{q}")
        ww = _get(f"words-with/{q}?common=true")
        rest = list(ww["rest"]["words"])
        while len(rest) < ww["rest"]["total"]:
            more = _get(f"words-with/{q}?common=true&offset={len(rest)}")["rest"]["words"]
            if not more:
                break
            rest += more
        have[c] = {
            "page": {"meanings": [{"id": m["id"], "en": m["en"], "about": m.get("about"),
                                   "uses": [{"en": u.get("en"), "about": u.get("about")} for u in m.get("uses") or []]}
                                  for m in page["meanings"]]},
            "groups": [{"id": g["id"], "en": g.get("en"),
                        "words": [{"id": w["id"], "hw": w["headword"], "r": w.get("reading"), "nf": w.get("nf"),
                                   "also": bool(w.get("alsoOf"))} for w in g["words"]]} for g in ww["groups"]],
            "rest": [{"id": w["id"], "hw": w["headword"], "r": w.get("reading"), "nf": w.get("nf")} for w in rest],
        }
    DRAFTS.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(have, ensure_ascii=False), encoding="utf-8")
    return have


def _glosses(ids: list[int]) -> dict[int, list[str]]:
    db = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
    out: dict[int, list[str]] = {}
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        q = f"SELECT word_id, ord, gloss FROM sense WHERE word_id IN ({','.join('?' * len(part))}) ORDER BY word_id, ord"
        for wid, _, g in db.execute(q, part):
            out.setdefault(wid, []).append(g)
    return out


def _kanji_info() -> dict[str, dict]:
    db = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
    return {c: {"jlpt": j, "on": json.loads(on or "[]"), "kun": json.loads(kun or "[]")}
            for c, j, on, kun in db.execute("SELECT char, jlpt, on_yomi, kun_yomi FROM kanji")}


def _kun(r: str) -> str:
    a, _, b = r.partition(".")
    return f"{a}({b})" if b else a


def _kata(s: str) -> str:
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)


def render(c: str, p: dict, info: dict, gl: dict[int, list[str]]) -> str:
    def word(w: dict) -> str:
        senses = gl.get(w["id"]) or []
        g = " | ".join(f"{i}. {s[:90]}" for i, s in enumerate(senses[:4], 1))
        more = f" (+{len(senses) - 4} senses)" if len(senses) > 4 else ""
        nf = f" nf{w['nf']:02d}" if w.get("nf") else ""
        also = " [also listed in another group]" if w.get("also") else ""
        return f"    - {w['hw']} ({w['r']}){nf}{also}: {g}{more}"

    i = info.get(c, {})
    lines = [f"## {c}", "",
             f"JLPT {LEVEL.get(i.get('jlpt'), '-')}; readings: on {', '.join(_kata(r) for r in i.get('on', [])) or '-'}"
             f" | kun {', '.join(_kun(r) for r in i.get('kun', [])) or '-'}", "", "Groups:"]
    about = {m["id"]: m for m in p["page"]["meanings"]}
    gid = {}
    for n, m in enumerate(p["page"]["meanings"], 1):
        gid[m["id"]] = f"G{n}"
        lines.append(f"  G{n}. {m['en']}: {m.get('about') or ''}")
        for u in m.get("uses") or []:
            lines.append(f"      use: {u['en']}: {u.get('about') or ''}")
    lines.append("")
    for g in p["groups"]:
        name = gid.get(g["id"])
        if name is None:  # the catch-all (sound-only or fixed spellings), or a group the page doesn't name
            name = "catch-all" if g["en"] is None else g["en"]
            lines.append(f"  Words in {name} (the kanji is there for its sound, or a fixed spelling):")
        else:
            lines.append(f"  Words in {name} ({about[g['id']]['en']}):")
        lines += [word(w) for w in g["words"]]
    if p["rest"]:
        lines.append("  Words in no group:")
        lines += [word(w) for w in p["rest"]]
    return "\n".join(lines) + "\n"


def pilot_prepare(size: int) -> None:
    pages = json.load(gzip.open(ROOT / "data" / "offline" / json.loads(
        (ROOT / "data" / "offline" / "current.json").read_text(encoding="utf-8"))["version"] / "pages.json.gz",
        "rt", encoding="utf-8"))
    pool = sorted(c for c in pages if c not in KNOWN)
    rnd = random.Random(SEED)
    chars = KNOWN + rnd.sample(pool, 50 - len(KNOWN))
    rnd.shuffle(chars)
    prod = _prod(chars)
    info = _kanji_info()
    gl = _glosses(sorted({w["id"] for c in chars for g in prod[c]["groups"] for w in g["words"]}
                         | {w["id"] for c in chars for w in prod[c]["rest"]}))
    IN.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for b in range(math.ceil(len(chars) / size)):
        chunk = chars[b * size:(b + 1) * size]
        body = "\n".join(render(c, prod[c], info, gl) for c in chunk)
        (IN / f"mg-{b:03d}.md").write_text(f"# Batch mg-{b:03d}: {len(chunk)} kanji\n\n{body}", encoding="utf-8")
    (DRAFTS / "pilot.json").write_text(json.dumps({"seed": SEED, "known": KNOWN, "chars": chars}, ensure_ascii=False,
                                                  indent=1), encoding="utf-8")
    sizes = [len((IN / f"mg-{b:03d}.md").read_text(encoding="utf-8")) for b in range(math.ceil(len(chars) / size))]
    print(f"{len(chars)} kanji, batch sizes (chars): {sizes}")


RUNS = {"pilot": (DRAFTS, "mg", "pilot.json"), "focus": (DRAFTS / "focus", "mf", "focus.json")}


def _run(run: str) -> tuple[Path, str, dict]:
    d, prefix, f = RUNS[run]
    return d, prefix, json.loads((d / f).read_text(encoding="utf-8"))


def focus_prepare(target: int) -> None:
    """Every kanji with a common word in no group on prod (the pilot's 50 aside), packed ~`target` chars a batch."""
    scan = DRAFTS.parent / "kodansha-blind" / "prod-words-with.json"
    have = json.loads(scan.read_text(encoding="utf-8"))
    pilot = set(json.loads((DRAFTS / "pilot.json").read_text(encoding="utf-8"))["chars"])
    chars = sorted(c for c, v in have.items() if v["restTotal"] and c not in pilot)
    random.Random(SEED + 1).shuffle(chars)
    prod = _prod(chars)
    info = _kanji_info()
    gl = _glosses(sorted({w["id"] for c in chars for g in prod[c]["groups"] for w in g["words"]}
                         | {w["id"] for c in chars for w in prod[c]["rest"]}))
    d = DRAFTS / "focus"
    (d / "in").mkdir(parents=True, exist_ok=True)
    (d / "out").mkdir(parents=True, exist_ok=True)
    batches, cur, size = [], [], 0
    for c in chars:
        text = render(c, prod[c], info, gl)
        if cur and size + len(text) > target:
            batches.append(cur)
            cur, size = [], 0
        cur.append((c, text))
        size += len(text)
    if cur:
        batches.append(cur)
    for b, chunk in enumerate(batches):
        body = "\n".join(t for _, t in chunk)
        (d / "in" / f"mf-{b:03d}.md").write_text(f"# Batch mf-{b:03d}: {len(chunk)} kanji\n\n{body}", encoding="utf-8")
    (d / "focus.json").write_text(json.dumps({"chars": chars, "batches": [[c for c, _ in ch] for ch in batches]},
                                             ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(chars)} kanji in {len(batches)} batches; kanji a batch {min(map(len, batches))}-{max(map(len, batches))}")


def _results(run: str = "pilot") -> dict[str, dict]:
    d, prefix, _ = _run(run)
    got = {}
    for f in sorted((d / "out").glob(f"{prefix}-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["kanji"]:
            got[r["char"]] = r
    return got


def check(run: str) -> None:
    d, prefix, meta = _run(run)
    got = _results(run)
    miss = [c for c in meta["chars"] if c not in got]
    print(f"{len(got)}/{len(meta['chars'])} screened" + (f"; missing {''.join(miss)}" if miss else ""))
    if run == "focus" and miss:
        print("batches with gaps:", sorted({f"mf-{b:03d}" for b, ch in enumerate(meta["batches"]) for c in ch if c in miss}))


def skeptic_prepare(run: str, size: int) -> None:
    d, prefix, meta = _run(run)
    sk = d / "skeptic"
    prod = _prod(meta["chars"])
    info = _kanji_info()
    got = _results(run)
    items = []
    for c in meta["chars"]:
        for n, fl in enumerate(got.get(c, {}).get("flags") or []):
            items.append({"id": f"{c}-{n}", "char": c, **fl})
    gl = _glosses(sorted({w["id"] for c in meta["chars"] for g in prod[c]["groups"] for w in g["words"]}
                         | {w["id"] for c in meta["chars"] for w in prod[c]["rest"]}))
    (sk / "in").mkdir(parents=True, exist_ok=True)
    (sk / "out").mkdir(parents=True, exist_ok=True)
    # Two tracks (focus run): the hard flags (major, misplaced, a new group) in small batches with the
    # web; the easy ones (a hidden word to an existing group or the catch-all) in large batches,
    # the web only when unsure. The pilot's skeptic had used the web on every flag.
    def hard(it: dict) -> bool:
        return it.get("severity") == "major" or it.get("type") != "unplaced" or it.get("fix") == "new"

    tracks = [("", items, size)] if run == "pilot" else [
        ("h", [it for it in items if hard(it)], size), ("e", [it for it in items if not hard(it)], size * 4)]
    named: list[tuple[str, list[dict]]] = []
    for tag, its_all, cap in tracks:
        # Whole kanji per batch: a kanji's flags are checked side by side, with its page shown once.
        by: dict[str, list[dict]] = {}
        for it in its_all:
            by.setdefault(it["char"], []).append(it)
        cur: list[dict] = []
        n = 0
        for c, its in by.items():
            if cur and len(cur) + len(its) > cap:
                named.append((f"sk-{tag}{n:02d}", cur))
                cur, n = [], n + 1
            cur += its
        if cur:
            named.append((f"sk-{tag}{n:02d}", cur))
    batches = [ch for _, ch in named]
    for name, chunk in named:
        parts = [f"# Skeptic batch {name}: {len(chunk)} flags\n"]
        shown = set()
        for it in chunk:
            flag = {k: v for k, v in it.items() if k not in ("id", "char")}
            parts.append(f"## Flag {it['id']}\n\n```json\n{json.dumps(flag, ensure_ascii=False, indent=1)}\n```\n")
            if it["char"] not in shown:
                parts.append(render(it["char"], prod[it["char"]], info, gl))
                shown.add(it["char"])
            else:
                parts.append(f"(The kanji {it['char']} is shown above.)\n")
        (sk / "in" / f"{name}.md").write_text("\n".join(parts), encoding="utf-8")
    (sk / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} flags, {len(batches)} batches")


def _verdicts(d: Path) -> dict[str, dict]:
    out = {}
    for f in sorted((d / "skeptic" / "out").glob("sk-*.json")):
        for r in json.loads(f.read_text(encoding="utf-8"))["flags"]:
            out[r["id"]] = r
    return out


def report(run: str) -> None:
    d, prefix, meta = _run(run)
    got = _results(run)
    verdicts = _verdicts(d)
    flagged = {c for c, r in got.items() if r.get("flags")}
    major = {c for c, r in got.items() if any(f.get("severity") == "major" for f in r.get("flags") or [])}
    if run == "pilot":
        known = set(meta["known"])
        rand = [c for c in meta["chars"] if c not in known]
        print(f"screened {len(got)}; known gaps flagged {len(flagged & known)}/{len(known)} "
              f"(as major {len(major & known)}): {''.join(sorted(flagged & known))}; missed {''.join(sorted(known - flagged))}")
        print(f"random kanji flagged {len(flagged & set(rand))}/{len(rand)}, with a major flag {len(major & set(rand))}")
    else:
        known = set()
        print(f"screened {len(got)}/{len(meta['chars'])}; flagged {len(flagged)}, with a major flag {len(major)}")
    kinds = Counter((f.get("type"), f.get("severity")) for r in got.values() for f in r.get("flags") or [])
    print("flags by type:", dict(kinds))
    words = sum(len(f.get("words") or []) for r in got.values() for f in r.get("flags") or [])
    print("words named in flags:", words)
    if verdicts:
        pairs = [(f"{c}-{n}", fl) for c, r in got.items() for n, fl in enumerate(r.get("flags") or [])]
        v = Counter((fl.get("severity"), verdicts[i]["verdict"]) for i, fl in pairs if i in verdicts)
        print("skeptic (flag severity, verdict):", dict(v))
        print("skeptic severity:", dict(Counter(verdicts[i].get("severity") for i, _ in pairs if i in verdicts)))
        print("unchecked flags:", sum(1 for i, _ in pairs if i not in verdicts))
        if run == "pilot":
            for c in meta["chars"]:
                for n, fl in enumerate(got.get(c, {}).get("flags") or []):
                    vv = verdicts.get(f"{c}-{n}", {})
                    mark = "*" if c in known else " "
                    print(f"{mark}{c} {fl.get('severity', '?'):5} {fl.get('type', '?'):15} {','.join(fl.get('words') or [])[:40]:40} "
                          f"-> {vv.get('verdict', '-')}: {(vv.get('why') or '')[:110]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pilot-prepare")
    p.add_argument("--size", type=int, default=10)
    f = sub.add_parser("focus-prepare")
    f.add_argument("--target", type=int, default=32000, help="characters of input a batch")
    for name in ("check", "report"):
        x = sub.add_parser(name)
        x.add_argument("--run", choices=RUNS, default="pilot")
    s = sub.add_parser("skeptic-prepare")
    s.add_argument("--run", choices=RUNS, default="pilot")
    s.add_argument("--size", type=int, default=8)
    a = ap.parse_args()
    if a.cmd == "pilot-prepare":
        pilot_prepare(a.size)
    elif a.cmd == "focus-prepare":
        focus_prepare(a.target)
    elif a.cmd == "check":
        check(a.run)
    elif a.cmd == "skeptic-prepare":
        skeptic_prepare(a.run, a.size)
    else:
        report(a.run)


if __name__ == "__main__":
    main()
