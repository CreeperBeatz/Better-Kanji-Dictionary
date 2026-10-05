"""The forms of a character: positional forms, old forms, what a bound part is
a form of, and the lookalikes learners use as mnemonics.

    python pipeline/build_db.py forms

The modern shape decides the order; the old shape decides the story
(TASK-forms-review.md). So nothing here is a containment edge, ever: 青
contains 月 because that is what is on the page, and its old form 靑 (生 over
丹) is evidence for what the parts mean, shown beside the graph, not in it.

`char_form(char, other, kind, source, note)`, one row per link, read as
"`other` is the <kind> of `char`":

    positional  the same component written for another position: 人 亻,
                水 氵 氺. Stored both ways round, within each group.
    old         `other` is the pre-1946 form of `char`: 青 → 靑, 売 → 賣.
                Unihan kJapaneseOldVariant, plus the gaps curated below.
    form_of     the bound part `char` *is* `other`, squashed or moved: 龶 → 生,
                亻 → 人. One per bound part; it lends the part its meaning.
    looks_like  a popular lookalike, `char` → `other`: 龶 → 王. A mnemonic,
                always labelled as one, never as where the part comes from.
    kin         two characters for the same thing, drawn differently: 隹 鳥.
                Neither is a form of the other. Stored once, read both ways.

`source` is `unihan`, `curated` or `review:<decision id>`. Accepted review
decisions are exported to data/form_overrides.json (server/review.py), the
top layer here, so a rebuild keeps them.
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
from collections.abc import Iterator
from pathlib import Path

DATA = Path(__file__).parent / "data"
OVERRIDES = Path(__file__).parent.parent / "data" / "form_overrides.json"

KINDS = ("positional", "old", "form_of", "looks_like", "kin")

# The forms one component takes, its standalone form first. A note says what
# the grouping means where it would otherwise surprise -- and a group with a
# note stays apart on the graph: focusing 糸 also shows what is built from 糹,
# but focusing 肉 does not show the moon in 明 (server/forms.py graph_families).
POSITIONAL: list[tuple[str, str | None]] = [
    ("人亻", None),
    ("水氵氺", None),
    ("心忄㣺", None),
    ("手扌龵", None),
    ("火灬", None),
    ("犬犭", None),
    ("糸糹", None),
    ("食飠𩙿", None),
    ("衣衤𧘇", None),
    ("示礻", None),
    ("刀刂", None),
    ("竹⺮", None),
    ("足⻊", None),
    ("辵辶", None),
    ("老耂", None),
    ("网罒", None),
    ("羊𦍌", None),
    ("攴攵", None),
    ("艸艹", None),
    ("爪⺤爫", None),
    ("小⺌", "the top of 当 光 尚 is 小"),
    ("阜阝", "阝 at the left (こざとへん, 院 陽) is 阜, a hill"),
    ("邑阝", "阝 at the right (おおざと, 都 部) is 邑, a town"),
    ("玉王", "王 at the left of 理 球 is 玉, a jewel (たまへん), not king"),
    ("肉月", "月 at the left or bottom of 腕 胃 肩 is 肉, flesh (にくづき), not the moon"),
]

# A bound part that is a kanji squashed or moved, where it is not already the
# second member of a positional group above (those are derived).
FORM_OF: dict[str, tuple[str, str | None]] = {
    "龶": ("生", "the top of 青 is 生, plain in the old form 靑; 生 lends 青 and 清 晴 精 請 静 情 the reading セイ"),
}

LOOKS_LIKE: list[tuple[str, str, str | None]] = [
    ("龶", "王", "often called “king”, but it is a squashed 生"),
    ("䒑", "艹", None),
]

# Kin: the same thing, drawn two ways. Shown on the Forms block, never merged
# on the graph -- 鳴 does not look like it contains 隹.
KIN: list[tuple[str, str, str | None]] = [
    ("鳥", "隹", "both began as drawings of a bird; 鶏's old form 鷄 is also written 雞"),
]

# Old forms Unihan does not link: modern -> (old, note).
OLD: dict[str, tuple[str, str | None]] = {
    "青": ("靑", "生 (grow, fresh) over 丹 (red pigment); the 月 of today was 丹"),
    "清": ("淸", None),
}


def unihan_variants() -> Iterator[tuple[str, str, list[str]]]:
    """(char, field, its variants) for each line of Unihan_Variants.txt."""
    with zipfile.ZipFile(DATA / "Unihan.zip") as z:
        for line in z.read("Unihan_Variants.txt").decode("utf-8").splitlines():
            if not line.startswith("U+"):
                continue
            cp, field, value = line.split("\t")
            yield chr(int(cp[2:], 16)), field, [chr(int(v.split("<")[0][2:], 16)) for v in value.split()]


def unihan_old() -> dict[str, list[str]]:
    return {a: olds for a, field, olds in unihan_variants() if field == "kJapaneseOldVariant"}


def _form_of(out: dict, part: str, whole: str, value: tuple[str, str | None]) -> None:
    """A bound part is a form of one thing: a new form_of takes the place of any other."""
    for key in [k for k in out if k[0] == part and k[2] == "form_of"]:
        del out[key]
    out[(part, whole, "form_of")] = value


def rows(joyo: set[str]) -> list[tuple[str, str, str, str, str | None]]:
    """Every link: curated, then Unihan, then accepted review decisions over both."""
    out: dict[tuple[str, str, str], tuple[str, str | None]] = {}

    in_groups: dict[str, list[str]] = {}
    for group, note in POSITIONAL:
        for a in group:
            in_groups.setdefault(a, []).append(group[0])
            for b in group:
                if a != b:
                    out[(a, b, "positional")] = ("curated", note)
    # A non-jōyō member of exactly one group is a form of that group's head.
    for part, heads in in_groups.items():
        if len(heads) == 1 and part != heads[0] and part not in joyo:
            out[(part, heads[0], "form_of")] = ("curated", None)
    for part, (whole, note) in FORM_OF.items():
        _form_of(out, part, whole, ("curated", note))
    for part, like, note in LOOKS_LIKE:
        out[(part, like, "looks_like")] = ("curated", note)
    for a, b, note in KIN:
        out[(a, b, "kin")] = ("curated", note)

    for modern, olds in unihan_old().items():
        for o in olds:
            out.setdefault((modern, o, "old"), ("unihan", None))
    for modern, (o, note) in OLD.items():
        out[(modern, o, "old")] = ("curated", note)

    # Review decisions: {"links": [{char, other, kind, note, decision}], "removed": [{char, other, kind}]}
    if OVERRIDES.exists():
        ov = json.loads(OVERRIDES.read_text(encoding="utf-8"))
        for r in ov.get("removed", []):
            out.pop((r["char"], r["other"], r["kind"]), None)
        for r in ov.get("links", []):
            value = (f"review:{r['decision']}", r.get("note"))
            if r["kind"] == "form_of":
                _form_of(out, r["char"], r["other"], value)
            else:
                out[(r["char"], r["other"], r["kind"])] = value

    return [(a, b, kind, src, note) for (a, b, kind), (src, note) in sorted(out.items())]


def build(db: sqlite3.Connection) -> None:
    joyo = {c for (c,) in db.execute("SELECT char FROM kanji WHERE joyo = 1")}
    db.executescript("""
        DROP TABLE IF EXISTS char_form;
        CREATE TABLE char_form (
            char   TEXT NOT NULL,
            other  TEXT NOT NULL,
            kind   TEXT NOT NULL,   -- positional | old | form_of | looks_like | kin
            source TEXT NOT NULL,   -- unihan | curated | review:<decision id>
            note   TEXT,
            PRIMARY KEY (char, other, kind)
        );
        CREATE INDEX char_form_other ON char_form (other);
    """)
    all_rows = rows(joyo)
    db.executemany("INSERT INTO char_form VALUES (?,?,?,?,?)", all_rows)
    for kind in KINDS:
        n = sum(1 for r in all_rows if r[2] == kind)
        print(f"  {kind:12} {n:>6,} links")
