"""Check translated chunks against their inputs, and keep STATUS.md current.

    python pipeline/translate/check.py words-0001        # check one (or several)
    python pipeline/translate/check.py                   # check every output there is
    python pipeline/translate/check.py --pending 20      # the next 20 chunks nobody has done
    python pipeline/translate/check.py --out DIR ...     # outputs somewhere other than out/

Exit status is 1 when any checked chunk is missing or invalid, so an agent can
run it until it passes. Runs without chunk names rewrite STATUS.md from all of
out/.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
IN = HERE / "in"
OUT = HERE / "out"
STATUS = HERE / "STATUS.md"

CYRILLIC = re.compile(r"[\u0400-\u04FF]")
LETTER = re.compile(r"[^\W\d_]")
ENGLISH_RUN = re.compile(r"\b[A-Za-z]{3,}(?:[\s,;-]+[A-Za-z]{3,}){2,}\b")
MAX_GLOSSES = 8
MAX_LEN = 120


def _gloss_errors(where: str, bg, english: list[str]) -> list[str]:
    if not isinstance(bg, list) or not bg:
        return [f"{where}: bg must be a non-empty list of strings"]
    if len(bg) > MAX_GLOSSES:
        return [f"{where}: {len(bg)} glosses, at most {MAX_GLOSSES}"]
    errs = []
    en = " ".join(english).lower()
    for g in bg:
        if not isinstance(g, str) or not g.strip():
            errs.append(f"{where}: empty gloss")
            continue
        if g != g.strip():
            errs.append(f"{where}: {g!r} has spaces around it")
        if len(g) > MAX_LEN:
            errs.append(f"{where}: {g[:40]!r}... is {len(g)} characters, keep glosses short")
        if CYRILLIC.search(g):
            run = ENGLISH_RUN.search(g)
            if run and run.group(0).lower() not in en:
                errs.append(f"{where}: English left in {g!r}")
        elif LETTER.search(g) and g.lower() not in en:
            # Latin-only is fine for what English also writes that way (CD, DNA, OK).
            errs.append(f"{where}: {g!r} is not Bulgarian")
    if len(set(bg)) != len(bg):
        errs.append(f"{where}: the same gloss twice")
    return errs


def check_words(inp: dict, out: dict) -> list[str]:
    errs = []
    got: dict[int, dict] = {}
    for e in out.get("entries") or []:
        if not isinstance(e, dict) or not isinstance(e.get("id"), int):
            errs.append("an entry without an integer id")
            continue
        if e["id"] in got:
            errs.append(f"id {e['id']}: listed twice")
        got[e["id"]] = e
    want = {e["id"]: e for e in inp["entries"]}
    for wid in got.keys() - want.keys():
        errs.append(f"id {wid}: not in this chunk")
    for wid, e in want.items():
        o = got.get(wid)
        if o is None:
            errs.append(f"id {wid} ({e['headword']}): missing")
            continue
        senses = {}
        for s in o.get("senses") or []:
            if not isinstance(s, dict) or not isinstance(s.get("i"), int):
                errs.append(f"id {wid}: a sense without an integer i")
                continue
            if s["i"] in senses:
                errs.append(f"id {wid} sense {s['i']}: listed twice")
            senses[s["i"]] = s
        for s in e["senses"]:
            o_s = senses.pop(s["i"], None)
            if o_s is None:
                errs.append(f"id {wid} ({e['headword']}) sense {s['i']}: missing")
            else:
                errs += _gloss_errors(f"id {wid} ({e['headword']}) sense {s['i']}", o_s.get("bg"), s["en"])
        for i in senses:
            errs.append(f"id {wid} sense {i}: not in the input")
    return errs


def check_kanji(inp: dict, out: dict) -> list[str]:
    errs = []
    got = {}
    for k in out.get("kanji") or []:
        if not isinstance(k, dict) or not isinstance(k.get("char"), str):
            errs.append("an item without a char")
            continue
        if k["char"] in got:
            errs.append(f"{k['char']}: listed twice")
        got[k["char"]] = k
    want = {k["char"]: k for k in inp["kanji"]}
    for c in got.keys() - want.keys():
        errs.append(f"{c}: not in this chunk")
    for c, k in want.items():
        if c not in got:
            errs.append(f"{c}: missing")
        else:
            errs += _gloss_errors(c, got[c].get("bg"), k["meanings"] + [k.get("curated") or ""])
    return errs


def check(name: str, out_dir: Path) -> list[str]:
    src = IN / f"{name}.json"
    dst = out_dir / f"{name}.json"
    if not src.exists():
        return [f"no input {src.relative_to(HERE)} (run make_chunks.py)"]
    if not dst.exists():
        return ["missing"]
    try:
        out = json.loads(dst.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        return [f"not valid JSON: {e}"]
    if not isinstance(out, dict):
        return ["the file must hold one JSON object"]
    inp = json.loads(src.read_text(encoding="utf-8"))
    errs = []
    if out.get("chunk") != name:
        errs.append(f'"chunk" must be "{name}"')
    if not isinstance(out.get("by"), str) or not out["by"].strip():
        errs.append('"by" must name who translated it, e.g. "claude-sonnet-5"')
    errs += check_words(inp, out) if name.startswith("words-") else check_kanji(inp, out)
    return errs


def _ranges(names: list[str]) -> str:
    """words-0001, words-0002, words-0003 -> words-0001..0003"""
    if not names:
        return "none"
    out, run = [], [names[0]]
    for n in names[1:]:
        prefix, num = n.rsplit("-", 1)
        lp, lnum = run[-1].rsplit("-", 1)
        if prefix == lp and int(num) == int(lnum) + 1:
            run.append(n)
        else:
            out.append(run)
            run = [n]
    out.append(run)
    return ", ".join(r[0] if len(r) == 1 else f"{r[0]}..{r[-1].rsplit('-', 1)[1]}" for r in out)


def status(out_dir: Path) -> tuple[list[str], dict[str, list[str]]]:
    """Rewrite STATUS.md; return the chunks still to do and the invalid ones."""
    names = sorted(p.stem for p in IN.glob("*.json"))
    done, invalid, missing = [], {}, []
    for n in names:
        errs = check(n, out_dir) if (out_dir / f"{n}.json").exists() else ["missing"]
        if not errs:
            done.append(n)
        elif errs == ["missing"]:
            missing.append(n)
        else:
            invalid[n] = errs

    lines = ["# Translation status", "", "Written by check.py; do not edit by hand.", ""]
    for kind in ("words", "kanji"):
        ks = [n for n in names if n.startswith(kind)]
        kd = [n for n in done if n.startswith(kind)]
        lines.append(f"- **{kind}**: {len(kd)} of {len(ks)} chunks done")
    lines += ["", "## Invalid", ""]
    lines += [f"- {n}: {errs[0]}" + (f" (+{len(errs) - 1} more)" if len(errs) > 1 else "")
              for n, errs in invalid.items()] or ["none"]
    lines += ["", "## Done", "", _ranges(done), "", "## To do", "", _ranges(missing), ""]
    STATUS.write_text("\n".join(lines), encoding="utf-8")
    # Kanji first: a few dozen chunks that every character page shows.
    todo = [n for n in missing if n.startswith("kanji")] + [n for n in missing if n.startswith("words")]
    return todo, invalid


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chunks", nargs="*", help="chunk names, e.g. words-0001 kanji-001")
    ap.add_argument("--pending", type=int, metavar="N", help="print the next N chunks with no output yet")
    ap.add_argument("--out", type=Path, default=OUT, help="where the outputs are (default: out/)")
    args = ap.parse_args()

    if not IN.exists():
        raise SystemExit("no in/ directory: run make_chunks.py first")

    # Agents check their own chunk, many at once; only whole-directory runs
    # touch STATUS.md, so they never race over it.
    if args.pending is not None or not args.chunks:
        todo, invalid = status(args.out)
        if args.pending is not None:
            for n in (list(invalid) + todo)[: args.pending]:
                print(n)
            return 0

    names = [c.removesuffix(".json") for c in args.chunks] or sorted(p.stem for p in args.out.glob("*.json"))
    failed = 0
    for n in names:
        errs = check(n, args.out)
        if errs:
            failed += 1
            print(f"{n}: {len(errs)} problem(s)")
            for e in errs[:40]:
                print(f"  - {e}")
            if len(errs) > 40:
                print(f"  ... and {len(errs) - 40} more")
        else:
            print(f"{n}: ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
