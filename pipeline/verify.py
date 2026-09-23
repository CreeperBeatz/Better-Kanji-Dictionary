"""Correctness checks for the built database.

    python pipeline/verify.py

Checks the invariants the app depends on, plus two regression tests that the
extracted decomposition logic still agrees with the original research pipeline
(build.py / fanout.py), which produced order-n2.tsv.
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))

from decomp import Decomposition  # noqa: E402

DB = ROOT / "data" / "betterrtk.sqlite"
DATA = Path(__file__).parent / "data"

failures: list[str] = []
checks = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global checks
    checks += 1
    mark = "ok  " if ok else "FAIL"
    print(f"  {mark}  {label}{('  -- ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def main() -> int:
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    one = lambda sql, *p: db.execute(sql, p).fetchone()[0]  # noqa: E731

    print("row counts")
    check("radicals = 253", one("SELECT COUNT(*) FROM radical") == 253)
    check(
        "kradfile kanji = 12,156",
        one("SELECT COUNT(DISTINCT kanji) FROM kanji_radical") == 12156,
    )
    check("joyo = 2,136", one("SELECT COUNT(*) FROM kanji WHERE joyo = 1") == 2136)
    check(
        "kanjidic characters = 13,108",
        one("SELECT COUNT(*) FROM kanji WHERE in_kanjidic = 1") == 13108,
    )
    check("containment edges > 25,000", one("SELECT COUNT(*) FROM edge") > 25000)

    print("\nmeanings")
    row = one("SELECT meanings FROM kanji WHERE char = ?", "合")
    meanings = json.loads(row)
    # "0.1" is a real KANJIDIC sense -- 合 as the volume unit, one tenth of a
    # sho. It is terse, not corrupt, and must survive verbatim.
    check("合 keeps its 0.1 volume-unit sense", "0.1" in meanings, ", ".join(meanings))

    print("\ngraph shape")
    kids = [r["child"] for r in db.execute("SELECT child FROM edge WHERE parent = ?", ("言",))]
    check("言 is built from 口 二 亠", sorted(kids) == sorted(["口", "二", "亠"]), "".join(kids))

    # The override file's fixes are read (記 used to come out with no parts),
    # but it may not break primitives down into strokes.
    kids = [r["child"] for r in db.execute("SELECT child FROM edge WHERE parent = ?", ("記",))]
    check("記 is built from 言 己", sorted(kids) == sorted(["言", "己"]), "".join(kids))
    kids = [r["child"] for r in db.execute("SELECT child FROM edge WHERE parent = ?", ("食",))]
    check("食 is built from 人 良", sorted(kids) == sorted(["人", "良"]), "".join(kids))
    whole = [c for c in "口月門心氵辶卄" if one("SELECT COUNT(*) FROM edge WHERE parent = ?", c)]
    check("口 月 門 心 氵 辶 卄 stay whole", not whole, "".join(whole))
    hands = one("SELECT joyo_count FROM fanout WHERE char = ?", "廾") or 0
    check("grass kanji do not hold 廾 (two hands)", hands < 40, str(hands))
    bare = one("SELECT COUNT(*) FROM kanji k WHERE k.freq IS NOT NULL AND NOT EXISTS "
               "(SELECT 1 FROM edge e WHERE e.parent = k.char)")
    check("common characters without parts <= 60", bare <= 60, str(bare))

    n_containers = one("SELECT COUNT(*) FROM edge WHERE child = ?", "言")
    n_joyo = one(
        "SELECT COUNT(*) FROM edge e JOIN kanji k ON k.char = e.parent "
        "WHERE e.child = ? AND k.joyo = 1",
        "言",
    )
    check("言 has >250 containers", n_containers > 250, f"{n_containers} total, {n_joyo} joyo")
    check("言's joyo containers 60-80", 60 <= n_joyo <= 80, str(n_joyo))

    # No character may contain itself at any depth, or the layered DAG has no
    # valid depth assignment and the graph view would loop.
    d = Decomposition.load(user_overrides=False)
    K = json.loads((DATA / "kanji.json").read_text(encoding="utf-8"))
    comps = d.closure(K.keys())
    anc = d.ancestors(comps, comps.keys())
    self_containing = [c for c, roots in anc.items() if c in roots]
    check("no character contains itself", not self_containing, "".join(self_containing[:10]))

    # A variant codepoint left in the edge table splits a component's meaning
    # from its usage again (⺙ used in 38 jōyō, 攵 holding the meaning in 1).
    from decomp import ALIASES

    stray = [c for c in ALIASES if one("SELECT COUNT(*) FROM edge WHERE child = ?", c)]
    check("variant codepoints are folded", not stray, "".join(stray))

    print("\ndictionary")
    check("JMdict entries = 218,798", one("SELECT COUNT(*) FROM word") == 218798)
    ranked = one("SELECT COUNT(*) FROM word WHERE nf IS NOT NULL")
    check("nf ranks survived the XML parse", ranked > 20000, f"{ranked:,} ranked")
    # kanjium has a handful of duplicate (word, reading) pairs; the table keeps
    # one row each, so this is 3 fewer than the file has lines.
    check("pitch accents > 124,000", one("SELECT COUNT(*) FROM accent") > 124000,
          f"{one('SELECT COUNT(*) FROM accent'):,} distinct word readings")
    check("curated meanings = 1,235", one("SELECT COUNT(*) FROM kanji_curated") == 1235)
    check("example sentences > 140,000", one("SELECT COUNT(*) FROM sentence") > 140000)

    top = [
        r[0]
        for r in db.execute(
            "SELECT w.headword FROM word_char wc JOIN word w ON w.id = wc.word_id "
            "WHERE wc.char = ? AND w.common = 1 "
            "ORDER BY w.nf IS NULL, w.nf, LENGTH(w.headword) LIMIT 3",
            ("言",),
        )
    ]
    check("言's commonest words lead with 言葉", "言葉" in top, " ".join(top))

    print("\nstroke order")
    n_glyphs = one("SELECT COUNT(*) FROM stroke")
    check("stroke data > 6,500 glyphs", n_glyphs > 6500, f"{n_glyphs:,} characters")
    for ch, want in (("言", 7), ("明", 8), ("時", 10)):
        got = len(json.loads(one("SELECT paths FROM stroke WHERE char = ?", ch)))
        check(f"{ch} has {want} strokes", got == want, str(got))

    print("\ndeinflection")
    sys.path.insert(0, str(ROOT))
    from server.japanese import deinflect, romaji_to_kana

    for surface, want in (
        ("食べたくなかった", "食べる"),
        ("行かせられた", "行く"),
        ("美しくない", "美しい"),
        ("読んでいます", "読む"),
        ("勉強しました", "勉強する"),
        ("買った", "買う"),
        ("来ない", "来る"),
    ):
        check(f"{surface} -> {want}", want in {c.text for c in deinflect(surface)})

    check("romaji jikan -> じかん", romaji_to_kana("jikan") == "じかん")
    check("romaji leaves English alone", romaji_to_kana("temple") == "")

    print("\nhandwriting")
    from server import recognize as rec

    ref = {c: g for bucket in rec.index().values() for c, g in bucket}
    check("reference glyphs > 6,000", len(ref) > 6000, f"{len(ref):,} characters")
    check("kana and Latin are excluded", "ロ" not in ref and "K" not in ref)

    def ink(ch, order=None):
        """A character's own KanjiVG endpoints, as if they had been drawn."""
        lines = ref[ch].lines
        if order is not None:
            lines = [lines[i] for i in order]
        return [[[a, b], [c, d]] for a, b, c, d in lines]

    for ch in ("言", "語", "時", "議", "口", "水", "猫"):
        got = [h["char"] for h in rec.recognise(ink(ch))]
        check(f"{ch} matches itself", got[:1] == [ch], "".join(got[:5]))

    # Order is a bonus, never a requirement: a character written backwards has
    # to still come back first on shape alone.
    backwards = rec.recognise(ink("語", order=range(13, -1, -1)))
    check("語 backwards still matches", backwards[0]["char"] == "語")

    # And the whole point of scoring length rather than filtering on it.
    short = [h["char"] for h in rec.recognise(ink("時")[1:])]
    check("時 minus a stroke is still offered", "時" in short[:10], "".join(short[:6]))

    # Writing it properly must beat writing it in a scrambled order, and both
    # must find it -- that is the whole point of folding the two into one score.
    proper = rec.recognise(ink("言"))
    scrambled = rec.recognise(ink("言", order=(3, 0, 6, 1, 5, 2, 4)))
    check("言 written properly scores higher", proper[0]["score"] > scrambled[0]["score"],
          f"{proper[0]['score']} vs {scrambled[0]['score']}")
    check("言 found either way", proper[0]["char"] == "言" and scrambled[0]["char"] == "言")

    print("\nsimilar kanji")
    near = lambda c, kind, n: [r[0] for r in db.execute(  # noqa: E731
        "SELECT other FROM similar WHERE char = ? AND kind = ? ORDER BY rank LIMIT ?", (c, kind, n))]
    check("未 looks like 末 (top 3)", "末" in near("未", "look", 3), "".join(near("未", "look", 3)))
    check("問 looks like 間 and 門 (top 5)", {"間", "門"} <= set(near("問", "look", 5)), "".join(near("問", "look", 5)))
    check("早 reads like 速 (first)", near("早", "read", 1) == ["速"], "".join(near("早", "read", 3)))
    check("温 reads like 暖 (first)", near("温", "read", 1) == ["暖"], "".join(near("温", "read", 3)))
    check("側 reads like 傍 (top 3)", "傍" in near("側", "read", 3), "".join(near("側", "read", 3)))
    check("話 means like 語 or 談 (top 3)", {"語", "談"} & set(near("話", "mean", 3)), "".join(near("話", "mean", 3)))
    check("no pair both reads and means alike", one(
        "SELECT COUNT(*) FROM similar a JOIN similar b ON a.char = b.char AND a.other = b.other "
        "WHERE a.kind = 'read' AND b.kind = 'mean'") == 0)
    check("龍 is a variant of 竜, not a synonym", "竜" in near("龍", "variant", 6) and "竜" not in near("龍", "mean", 30))
    check("nothing is similar to itself", one("SELECT COUNT(*) FROM similar WHERE char = other") == 0)

    print("\nregression against the research pipeline")
    old_graph = json.loads((Path(__file__).parent / "graph.json").read_text(encoding="utf-8"))
    target = {k for k, v in K.items() if v.get("jlpt_new") in (5, 4, 3, 2)}
    check("N5-N2 target set = 979", len(target) == 979, str(len(target)))

    # Parsing must still match build.py once the intended differences (variant
    # folding, override args) are switched off for this comparison.
    d = Decomposition.load(user_overrides=False, as_build_py=True)
    new_closure = {k: sorted(v) for k, v in d.closure(target).items()}
    old_closure = {k: sorted(v) for k, v in old_graph["comps"].items()}
    check(
        "decomp.py closure == build.py closure",
        new_closure == old_closure,
        f"{len(new_closure)} nodes",
    )

    old_fanout = json.loads((Path(__file__).parent / "fanout.json").read_text(encoding="utf-8"))
    sub_anc = d.ancestors(d.closure(target), target)
    new_fanout = {c: len(sub_anc.get(c, ())) for c in set(new_closure) - target}
    check("decomp.py fan-out == fanout.py fan-out", new_fanout == old_fanout, f"{len(new_fanout)} components")

    print(f"\n{checks - len(failures)}/{checks} passed")
    if failures:
        print("failed: " + ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
