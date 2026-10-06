"""Fill the review queue: where other sources disagree with our decompositions.

    python pipeline/review_sources.py count                 # what each source would add
    python pipeline/review_sources.py load [--review-dir D]  # put it in the queue

Part 6 of TASK-forms-review.md. `count` is what Dani sees first; nothing is
loaded until `load` is run, and `load` takes the review state to write to
(the sandbox's, or the server's own data/review when Dani says so).

Sources, for the kanji in scope (server/scope.py: JLPT, jōyō or a newspaper
rank) and everything they contain (the closure). A subject that already has an
item of that kind, decided or not, is not proposed again.

- **ids-diff** -- BabelStone's IDS (free for any use), the Japanese reading
  where it differs, top-level parts only, a nested unencoded piece read as
  its own parts.
- **kanjivg-diff** -- KanjiVG's component groups (CC BY-SA), the elements
  directly under the glyph.
- Both compared with our direct parts after folding the same shape written
  two ways (ALIASES) and the positional forms (訁 is 言, 氵 is 水), since the
  graph files a part under one of them. Only proposals made entirely of
  nodes we know are kept.
- **old-form** -- a modern kanji and its old form drawn from different parts
  in the same places (青 ⿱龶月, 靑 ⿱生丹): a bound part with no `form_of` of
  its own (龶) is proposed as a form of the old form's part (生). These are
  form links, the story layer, never decomposition changes.
- **cost-ranking** -- the existing /api/decomp/review ranking: many parts,
  single-use parts, parts with no entry. Nothing is proposed; the reviewer
  looks and edits, or rejects to keep it.

The §6 rule: a decomposition is accepted without a person only if IDS and
KanjiVG agree on it, it adds no containment edge (it only removes parts, or
replaces a part with one it already contains), and the kanji is not one
KRADFILE lists as a radical of itself (口, 門).
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
DATA = Path(__file__).parent / "data"

import proposals  # noqa: E402
from decomp import ALIASES, BARE_STROKES, is_stroke  # noqa: E402
from proposals import ROOT, review  # noqa: E402

from server import scope as review_scope  # noqa: E402
from server import store  # noqa: E402

IDC = set(chr(c) for c in range(0x2FF0, 0x3000)) | {"㇯"}
ARITY = {c: 3 if c in "⿲⿳" else 2 for c in IDC}


# ---------------------------------------------------------------- the sources


def babelstone() -> dict[str, str]:
    """char -> its IDS, the Japanese one where the file gives several."""
    out: dict[str, str] = {}
    for line in (DATA / "ids" / "IDS.TXT").read_text(encoding="utf-8-sig").splitlines():
        if not line.startswith("U+"):
            continue
        cols = line.split("\t")
        if len(cols) < 3:
            continue
        char, seqs = cols[1], cols[2:]
        pick = None
        for s in seqs:
            m = re.match(r"^\^(.*)\$\(([^)]*)\)", s)
            if not m:
                continue
            if pick is None or "J" in m.group(2):
                pick = m.group(1)
                if "J" in m.group(2):
                    break
        if pick:
            out[char] = pick
    return out


def _tokens(ids: str) -> list[str]:
    """{6}-style placeholders become one opaque token each."""
    return re.findall(r"\{\d+\}|.", ids)


def _parse(tokens: list[str], i: int = 0):
    """An IDS as a tree: a character, or (operator, [children])."""
    t = tokens[i]
    if t in IDC:
        kids, j = [], i + 1
        for _ in range(ARITY.get(t, 2)):
            if j >= len(tokens):
                break
            kid, j = _parse(tokens, j)
            kids.append(kid)
        return (t, kids), j
    return t, i + 1


def ids_parts(ids: str, self_char: str) -> list[str] | None:
    """The direct parts an IDS describes; None if it names no real parts (strokes, placeholders)."""
    toks = _tokens(ids)
    if not toks or toks == [self_char]:
        return None
    tree, _ = _parse(toks)
    if isinstance(tree, str):
        return None
    out: list[str] = []

    def walk(node):
        if isinstance(node, str):
            out.append(node)
        else:
            for k in node[1]:
                walk(k)

    for kid in tree[1]:
        # A nested piece with no code point of its own is read as its parts.
        walk(kid)
    if any(p.startswith("{") or is_stroke(p) for p in out):
        return None
    return list(dict.fromkeys(out))


def kanjivg() -> dict[str, list[str]]:
    """char -> the elements KanjiVG groups directly under the glyph."""
    out: dict[str, list[str]] = {}
    ns = "{http://kanjivg.tagaini.net}"
    with gzip.open(DATA / "kanjivg.xml.gz", "rb") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != "kanji":
                continue
            m = re.match(r"^kvg:kanji_([0-9a-f]+)$", el.get("id") or "")
            if m:
                root = el.find("g")
                parts: list[str] = []
                loose = False  # a stroke outside every named group: the list is not the whole glyph

                def walk(g):
                    nonlocal loose
                    if g.find("path") is not None:
                        loose = True
                    for child in g.findall("g"):
                        e = child.get(f"{ns}element") or child.get("kvg:element")
                        if e:
                            parts.append(e)
                        else:
                            walk(child)

                if root is not None:
                    walk(root)
                if parts and not loose:
                    out[chr(int(m.group(1), 16))] = list(dict.fromkeys(parts))
            el.clear()
    return out


def kradfile() -> dict[str, list[str]]:
    with zipfile.ZipFile(DATA / "kradfile.json.zip") as z, z.open(z.namelist()[0]) as f:
        return json.load(io.TextIOWrapper(f, encoding="utf-8"))["kanji"]


# ---------------------------------------------------------------- our graph


def graph(db: sqlite3.Connection) -> tuple[dict[str, list[str]], set[str]]:
    """Direct parts of every node, with the live overrides; and every node there is."""
    children: dict[str, list[str]] = defaultdict(list)
    for p, c in db.execute("SELECT parent, child FROM edge"):
        children[p].append(c)
    for p, comps in store.decomposition_overrides().items():
        children[p] = list(comps)
    nodes = {r[0] for r in db.execute("SELECT char FROM kanji")} | set(children) | {c for cs in children.values() for c in cs}
    return dict(children), nodes


def closure(children: dict[str, list[str]], roots: list[str]) -> set[str]:
    seen: set[str] = set()
    stack = list(roots)
    while stack:
        c = stack.pop()
        if c in seen:
            continue
        seen.add(c)
        stack.extend(children.get(c, ()))
    return seen


def below(children: dict[str, list[str]], parts: list[str], skip: str) -> set[str]:
    return closure(children, [p for p in parts if p != skip]) - {skip}


def equivalence(db: sqlite3.Connection) -> dict[str, str]:
    """Each character to a representative of the shapes counted as one part."""
    rep: dict[str, str] = {}

    def find(c: str) -> str:
        while rep.get(c, c) != c:
            c = rep[c]
        return c

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            rep[max(ra, rb)] = min(ra, rb)

    for a, b in ALIASES.items():
        union(a, b)
    for a, b in db.execute("SELECT char, other FROM char_form WHERE kind IN ('positional', 'form_of')"):
        union(a, b)
    # Radical-supplement and compatibility forms that draw the same shape as an ideograph.
    for a, b in {"⺝": "月", "⺼": "月", "⻌": "辶", "⻍": "辶", "⻎": "辶", "訁": "言", "⺅": "亻", "⺡": "氵",
                 "⺘": "扌", "⺖": "忄", "⺮": "竹", "⺾": "艹", "⺿": "艹", "⻊": "足", "⻖": "阝", "⻏": "阝"}.items():
        union(a, b)
    return {c: find(c) for c in list(rep)}


# Shapes the graph keeps apart on purpose (decomp.ALIASES) but the sources
# write one for the other, having no code point for the first: a source's 厂
# in 反 is our ⺁. Counted as agreement when comparing, never folded in the graph.
SOURCE_SPELLINGS = {"厂": "⺁", "𠂊": "⺈", "⺌": "⺍", "卩": "㔾", "己": "巳", "曽": "曾"}


def _same(a: list[str], b: list[str], eq: dict[str, str]) -> bool:
    norm = lambda xs: {eq.get(SOURCE_SPELLINGS.get(x, x), SOURCE_SPELLINGS.get(x, x)) for x in xs if x not in BARE_STROKES}
    return norm(a) == norm(b)


def _ours(parts: list[str], nodes: set[str], eq: dict[str, str], prefer: dict[str, str]) -> list[str] | None:
    """A source's parts written as our nodes: the form our graph uses, or None if one is unknown."""
    out = []
    for p in parts:
        p = ALIASES.get(p, p)
        if p in nodes:
            out.append(p)
        elif eq.get(p, p) in prefer:
            out.append(prefer[eq.get(p, p)])
        else:
            return None
    return list(dict.fromkeys(out))


# ---------------------------------------------------------------- what to propose


def _known() -> set[tuple[str, str]]:
    """(type, subject) of every item in the review store, open or decided (a withdrawn one was never asked)."""
    return {(i["type"], i["subject"]) for i in review._read()["items"].values() if i["status"] != "withdrawn"}


def collect() -> dict:
    db = proposals.connect()
    targets = review_scope.kanji(db)
    known = _known()
    children, nodes = graph(db)
    scope = closure(children, targets)
    eq = equivalence(db)
    # For each shape, the node our graph uses most for it.
    use = Counter(c for cs in children.values() for c in cs)
    prefer: dict[str, str] = {}
    for c in sorted(nodes, key=lambda c: -use[c]):
        prefer.setdefault(eq.get(c, c), c)
    ids, kvg, krad = babelstone(), kanjivg(), kradfile()
    fanout = dict(db.execute("SELECT char, joyo_count FROM fanout"))
    freq = {r[0]: r[1] for r in db.execute("SELECT char, freq FROM kanji")}

    decomp, unmappable, agree, strokes = [], Counter(), Counter(), Counter()
    for x in sorted(scope):
        ours = children.get(x, [])
        if not ours or ("decomposition", x) in known:
            continue  # atomic in our graph: a primitive, not a split to argue with
        sources = {}
        for name, raw in (("ids", ids_parts(ids[x], x) if x in ids else None), ("kanjivg", kvg.get(x))):
            if not raw or raw == [x]:
                continue
            if _same(raw, ours, eq):
                agree[name] += 1
                continue
            mapped = _ours(raw, nodes, eq, prefer)
            if mapped is None or x in mapped:
                unmappable[name] += 1
                continue
            if any(p in BARE_STROKES or is_stroke(p) for p in mapped):
                strokes[name] += 1  # the review rules forbid a bare stroke as a part
                continue
            sources[name] = mapped
        if not sources:
            continue
        # One item per distinct proposal; two sources proposing the same thing make one, stronger, item.
        by_value: dict[tuple, list[str]] = defaultdict(list)
        for name, mapped in sources.items():
            key = tuple(sorted(eq.get(p, p) for p in mapped))
            by_value[key].append(name)
        for _, names in by_value.items():
            proposed = sources[names[0]]
            lost = below(children, ours, x) - below(children, proposed, x)
            gained = below(children, proposed, x) - below(children, ours, x)
            self_radical = x in (krad.get(x) or [])
            auto = len(names) == 2 and not gained and not self_radical
            weight = (fanout.get(x) or 0) + (5 if (freq.get(x) or 9999) <= 1000 else 0)
            decomp.append({
                "char": x, "current": ours, "proposed": proposed, "sources": names,
                "lost": sorted(lost), "gained": sorted(gained), "auto": auto, "priority": round(weight + 3 * (len(names) - 1), 2),
                "evidence": {"ids": ids.get(x), "kanjivg": kvg.get(x), "kradfile": krad.get(x)},
            })

    # Old forms: the same layout drawn from different parts.
    form_rows = [(a, b) for a, b in db.execute("SELECT char, other FROM char_form WHERE kind = 'old'")]
    has_form_of = {r[0] for r in db.execute("SELECT char FROM char_form WHERE kind = 'form_of'")}
    # Only parts with no entry of their own: 厶 stands for 弗 in 仏 (佛) but is a
    # part in its own right in 公 and 私, so it must not borrow 弗's meaning.
    bound = {r[0] for r in db.execute("SELECT char FROM kanji WHERE in_kanjidic = 0")} | (nodes - {r[0] for r in db.execute("SELECT char FROM kanji")})
    support: dict[tuple[str, str], list[str]] = defaultdict(list)
    for modern, old in form_rows:
        if modern not in scope or modern not in ids or old not in ids:
            continue
        tm, to = _tokens(ids[modern]), _tokens(ids[old])
        if not tm or not to or tm[0] not in IDC or tm[0] != to[0] or len(tm) != len(to):
            continue
        for a, b in zip(tm[1:], to[1:]):
            if a != b and a not in IDC and b not in IDC and not b.startswith("{") and a in bound and a not in has_form_of and eq.get(a, a) != eq.get(b, b):
                support[(a, b)].append(f"{modern}→{old}")
    olds = [{"part": a, "whole": b, "seen": seen} for (a, b), seen in sorted(support.items(), key=lambda kv: -len(kv[1]))
            if ("form_link", f"{a}|{b}") not in known]

    # The existing cost ranking.
    from server.routes.decomp import review_queue

    ranked = [r for r in review_queue(limit=300)["items"] if r["char"] in scope]
    proposed_chars = {d["char"] for d in decomp}
    ranked = [r for r in ranked if r["char"] not in proposed_chars and ("decomposition", r["char"]) not in known]

    return {"scope": len(scope), "decomposition": decomp, "agree": agree, "unmappable": unmappable, "strokes": strokes,
            "old": olds, "ranked": ranked}


def count() -> dict:
    c = collect()
    d = c["decomposition"]
    print(f"closure of the kanji in scope: {c['scope']} nodes (only what has no item yet)\n")
    print("decomposition (task A)")
    print(f"  agree with our parts       ids {c['agree']['ids']:>5}   kanjivg {c['agree']['kanjivg']:>5}")
    print(f"  differ, not mappable       ids {c['unmappable']['ids']:>5}   kanjivg {c['unmappable']['kanjivg']:>5}")
    print(f"  differ, into bare strokes  ids {c['strokes']['ids']:>5}   kanjivg {c['strokes']['kanjivg']:>5}  (dropped)")
    print(f"  proposals                  {len(d):>5}  over {len({x['char'] for x in d})} characters")
    print(f"    from IDS only            {sum(1 for x in d if x['sources'] == ['ids']):>5}")
    print(f"    from KanjiVG only        {sum(1 for x in d if x['sources'] == ['kanjivg']):>5}")
    print(f"    both agree               {sum(1 for x in d if len(x['sources']) == 2):>5}")
    print(f"    would be auto-accepted   {sum(1 for x in d if x['auto']):>5}  (both agree, no new edge, not a self-listed radical)")
    print(f"    add a containment edge   {sum(1 for x in d if x['gained']):>5}")
    print(f"  cost-ranked, to check      {len(c['ranked']):>5}")
    print("\nform links from old forms (task B)")
    print(f"  bound part -> old form's part  {len(c['old']):>5}")
    for o in c["old"][:12]:
        print(f"    {o['part']} -> {o['whole']}  ({', '.join(o['seen'][:4])})")
    return c


def load(review_dir: Path | None) -> None:
    if review_dir:
        # An auto-accepted split is written to the associations store, which
        # use_dir does not move: loading into another review folder against
        # the real store would change the real graph with no decision behind
        # it. Point the store elsewhere first (tests/load_sandbox.py does).
        if store.ASSOC_DIR.resolve() == (ROOT / "data" / "associations").resolve():
            raise SystemExit("--review-dir with the real associations store: use tests/load_sandbox.py")
    proposals.use_review_dir(review_dir)
    c = collect()
    n = Counter()
    for d in c["decomposition"]:
        src = "+".join(f"{s}-diff" for s in d["sources"])
        why = f"{' and '.join(d['sources'])} split it as {''.join(d['proposed'])}"
        if d["gained"]:
            why += f"; adds {''.join(d['gained'][:8])} as prerequisites"
        item = review.add_item("decomposition", d["char"], d["proposed"], src, reason=why, evidence=d["evidence"], priority=d["priority"])
        n["decomposition"] += 1
        if d["auto"]:
            review.auto_accept(item["id"], "IDS and KanjiVG agree; no new containment edge")
            n["auto"] += 1
    for o in c["old"]:
        review.add_item(
            "form_link", f"{o['part']}|{o['whole']}",
            {"kind": "form_of", "note": f"drawn as {o['whole']} in the old form: {', '.join(o['seen'][:3])}"},
            "old-form", reason=f"{len(o['seen'])} old forms", priority=len(o["seen"]),
        )
        n["form_link"] += 1
    for r in c["ranked"]:
        review.add_item("decomposition", r["char"], None, "cost-ranking", reason="check: " + ", ".join(r["reasons"]), priority=r["score"])
        n["cost-ranking"] += 1
    print("loaded:", dict(n))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("count")
    l = sub.add_parser("load")
    l.add_argument("--review-dir", type=Path)
    args = ap.parse_args()
    if args.cmd == "count":
        count()
    else:
        load(args.review_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
