"""Score the `similar` table against human lists of lookalikes and near-synonyms.

    python tests/similar_eval.py

Needs the datasets under pipeline/data/similar/ (see pipeline/similar.py for
what each is). Every list is compared among joyo kanji only, since that is
all kanjistat covers and most of what the human lists cover.

Looks alike, gold:
  yencken-flash   Yencken & Baldwin's flashcard distractors (CC BY 3.0)
  yencken-pool    their pooled experiment: native speakers picking the most
                  confusable kanji out of a set (CC BY 3.0)
  kanjium         kanjium lookalikes.txt (CC BY-SA 4.0)
  siikamiika      similar-kanji (MIT, of unclear origin -- scored, never shipped)
Reads alike, gold:
  bunka           文化審議会「異字同訓」の漢字の使い分け例 (2014), kanji sharing a kun
Means alike, gold:
  kanjium         kanjium synonyms.txt
Baselines: kanjistat's component-transport distance (looks) and its
embedding distance (means), both precomputed by its author.
"""

import gzip
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
S = ROOT / "pipeline" / "data" / "similar"
db = sqlite3.connect(ROOT / "data" / "betterrtk.sqlite")
JOYO = {c for (c,) in db.execute("SELECT char FROM kanji WHERE joyo = 1")}


def pairs_to_gold(pairs, symmetric=True):
    g = defaultdict(set)
    for a, b in pairs:
        if a != b and a in JOYO and b in JOYO:
            g[a].add(b)
            if symmetric:
                g[b].add(a)
    return dict(g)


def tsv_lists(path, sep=","):
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        a, rest = line.split("\t", 1)
        out += [(a.strip(), b.strip()) for b in rest.split(sep) if b.strip()]
    return out


def gold_look():
    flash = []
    for line in (S / "yencken" / "flashcards.csv").read_text(encoding="utf-8").splitlines():
        t = line.split()
        if len(t) >= 3:
            flash += [(t[1], b) for b in t[2]]
    import yaml

    pool = []
    with gzip.open(S / "yencken" / "poolexp_judgements.yaml.gz", "rt", encoding="utf-8") as f:
        for d in yaml.safe_load_all(f):
            if d:
                pool += [(d["pivot"], s) for s in d.get("selected") or []]
    siika = []
    for line in (S / "siikamiika" / "kanji.tgz_similars.ut8").read_text(encoding="utf-8").splitlines():
        t = [x for x in line.split("/") if x]
        siika += [(t[0], b) for b in t[1:]]
    return {
        "yencken-flash": pairs_to_gold(flash, symmetric=False),
        "yencken-pool": pairs_to_gold(pool, symmetric=False),
        "kanjium": pairs_to_gold(tsv_lists(S / "kanjium" / "lookalikes.txt")),
        "siikamiika": pairs_to_gold(siika),
    }


def gold_mean():
    bunka = []
    for line in (S / "bunka" / "ijidokun_groups.tsv").read_text(encoding="utf-8").splitlines()[1:]:
        ks = line.split("\t")[3].split(",")
        bunka += [(a, b) for a in ks for b in ks if a != b]
    return {
        "kanjium": pairs_to_gold(tsv_lists(S / "kanjium" / "synonyms.txt")),
        "bunka": pairs_to_gold(bunka),
    }


def ours(kind):
    lists = defaultdict(list)
    for c, o in db.execute("SELECT char, other FROM similar WHERE kind = ? ORDER BY char, rank", (kind,)):
        if o in JOYO:
            lists[c].append(o)
    return lists


def kanjistat(name):
    lists = defaultdict(list)
    for line in (S / "kanjistat" / name).read_text(encoding="utf-8").splitlines()[1:]:
        a, b, _, _ = line.split("\t")
        lists[a].append(b)
    return lists


def score(lists, gold):
    aps, p1, r5, r10, n = [], [], [], [], 0
    for q, g in gold.items():
        n += 1
        top = [c for c in lists.get(q, []) if c != q]
        hits, prec = 0, []
        for k, c in enumerate(top[:20], 1):
            if c in g:
                hits += 1
                prec.append(hits / k)
        aps.append(sum(prec) / min(len(g), 20))
        p1.append(bool(top) and top[0] in g)
        r5.append(len(g & set(top[:5])) / len(g))
        r10.append(len(g & set(top[:10])) / len(g))
    avg = lambda x: sum(x) / len(x)  # noqa: E731
    return f"MAP {avg(aps):.3f}  p@1 {avg(p1):.3f}  R@5 {avg(r5):.3f}  R@10 {avg(r10):.3f}  ({n} kanji)"


def main() -> int:
    print("LOOKS ALIKE")
    systems = {"ours": ours("look"), "kanjistat": kanjistat("dct_top20.tsv")}
    for gname, gold in gold_look().items():
        for sname, lists in systems.items():
            print(f"  {gname:<14} {sname:<10} {score(lists, gold)}")
    gm = gold_mean()
    read, mean = ours("read"), ours("mean")
    # kanjium's synonyms include pairs that share a reading (側/傍, both そば),
    # which the app lists under Same reading; so it is scored on the two lists
    # together, each character's reading list first, as well as on meaning alone.
    both = {c: read.get(c, []) + mean.get(c, []) for c in set(read) | set(mean)}
    print("\nREADS ALIKE")
    print(f"  {'bunka':<14} {'read':<14} {score(read, gm['bunka'])}")
    print("\nMEANS ALIKE")
    for sname, lists in {"read+mean": both, "mean": mean, "kanjistat": kanjistat("dembed_top20.tsv")}.items():
        print(f"  {'kanjium':<14} {sname:<14} {score(lists, gm['kanjium'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
