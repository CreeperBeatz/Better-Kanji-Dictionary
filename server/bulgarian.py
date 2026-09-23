"""Bulgarian text: normalising, stemming, and reading shlyokavitsa.

web/src/local/bulgarian.ts is a line-for-line twin, and tests/offline_parity.py
holds the two to the same answers, word by word.

The Bulgarian gloss indexes store *stems*, not words: build_db.py runs every
gloss through `terms()` before it goes into FTS5, and a query goes through the
same function, so водата finds вода without a custom SQLite tokeniser.

`stem` is Jacques Savoy's light stemmer ("Searching Strategies for the
Bulgarian Language", 2007) as Apache Lucene implements it in
BulgarianStemmer.java (Apache License 2.0).
"""

from __future__ import annotations

import unicodedata

STRESS = {"\u0300", "\u0301"}  # grave and acute over a vowel mark stress, not spelling
UNSTRESS = {"ѐ": "е", "ѝ": "и"}


def has_cyrillic(s: str) -> bool:
    return any("\u0400" <= c <= "\u04FF" for c in s)


def is_latin_query(s: str) -> bool:
    """Plain ASCII with something to read in it: what shlyokavitsa is typed in."""
    return s.isascii() and any(c.isalnum() for c in s)


def normalize(s: str) -> str:
    """Lower case, stress marks off. й stays: it is a letter, not и with a mark."""
    return "".join(UNSTRESS.get(c, c) for c in s.lower() if c not in STRESS)


def _is_word_char(c: str) -> bool:
    cat = unicodedata.category(c)
    return cat[0] in "LN" or cat == "Co"


def words(s: str) -> list[str]:
    """Runs of letters and digits, split where unicode61 would split them."""
    out, cur = [], []
    for c in s:
        if _is_word_char(c):
            cur.append(c)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def _remove_article(w: str) -> str:
    n = len(w)
    if n > 6 and w.endswith("ият"):
        return w[:-3]
    if n > 5 and w.endswith(("ът", "то", "те", "та", "ия")):
        return w[:-2]
    if n > 4 and w.endswith("ят"):
        return w[:-2]
    return w


def _remove_plural(w: str) -> str:
    n = len(w)
    if n > 6:
        if w.endswith("овци"):
            return w[:-3]  # -овци -> -о
        if w.endswith("ове"):
            return w[:-3]
        if w.endswith("еве"):
            return w[:-3] + "й"  # -еве -> -й
    if n > 5:
        if w.endswith("ища"):
            return w[:-3]
        if w.endswith("та"):
            return w[:-2]
        if w.endswith("ци"):
            return w[:-2] + "к"
        if w.endswith("зи"):
            return w[:-2] + "г"
        if w[-3] == "е" and w[-1] == "и":
            return w[:-3] + "я" + w[-2]  # -еXи -> -яX
    if n > 4:
        if w.endswith("си"):
            return w[:-2] + "х"
        if w.endswith("и"):
            return w[:-1]
    return w


def stem(w: str) -> str:
    """Savoy's light stemmer: articles, plurals and a final vowel off."""
    if len(w) < 4:
        return w
    if len(w) > 5 and w.endswith("ища"):
        return w[:-3]
    w = _remove_article(w)
    w = _remove_plural(w)
    if len(w) > 3:
        if w.endswith("я"):
            w = w[:-1]
        if w.endswith(("а", "о", "е")):
            w = w[:-1]
    # The paper writes the ен -> н rule twice; Lucene, like Savoy's own Perl, applies it once.
    if len(w) > 4 and w.endswith("ен"):
        w = w[:-2] + "н"
    if len(w) > 5 and w[-2] == "ъ":
        w = w[:-2] + w[-1]  # ъN -> N
    return w


def terms(text: str) -> list[str]:
    """What the Bulgarian indexes store for a gloss, and what a query looks for."""
    return [stem(w) for w in words(normalize(text))]


# ------------------------------------------------------------ shlyokavitsa

# Latin spellings, longest first, each with the Cyrillic it can stand for in
# the order it most often does. Covers the official 2009 transliteration
# (zh, ts, ch, sh, sht, yu, ya, a for ъ) and the informal SMS habits
# (4 for ч, 6 for ш, 6t / w for щ, q for я, y / u / 1 / ` for ъ, j for ж or й).
SHLYOKAVITSA: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("sht", ("щ",)),
    ("dzh", ("дж",)),
    ("6t", ("щ",)),
    ("zh", ("ж",)),
    ("ch", ("ч",)),
    ("sh", ("ш",)),
    ("ts", ("ц",)),
    ("dz", ("дз",)),
    ("dj", ("дж",)),
    ("yu", ("ю",)),
    ("iu", ("ю",)),
    ("ju", ("ю",)),
    ("ya", ("я",)),
    ("ia", ("я", "ия")),
    ("ja", ("я",)),
    ("yo", ("йо", "ьо")),
    ("io", ("йо", "ьо")),
    ("jo", ("йо", "ьо")),
    ("a", ("а", "ъ")),
    ("b", ("б",)),
    ("c", ("ц", "к")),
    ("d", ("д",)),
    ("e", ("е",)),
    ("f", ("ф",)),
    ("g", ("г",)),
    ("h", ("х",)),
    ("i", ("и", "й")),
    ("j", ("ж", "й")),
    ("k", ("к",)),
    ("l", ("л",)),
    ("m", ("м",)),
    ("n", ("н",)),
    ("o", ("о",)),
    ("p", ("п",)),
    ("q", ("я",)),
    ("r", ("р",)),
    ("s", ("с",)),
    ("t", ("т",)),
    ("u", ("у", "ъ")),
    ("v", ("в",)),
    ("w", ("в", "щ")),
    ("x", ("х", "кс")),
    ("y", ("ъ", "й")),
    ("z", ("з",)),
    ("1", ("ъ",)),
    ("`", ("ъ",)),
    ("4", ("ч",)),
    ("6", ("ш",)),
    ("7", ("щ",)),
)

MAX_CANDIDATES = 512


def shlyokavitsa(word: str) -> list[str]:
    """Every Cyrillic spelling a Latin-typed word could be, most likely first.

    Depth first over the rules above -- every rule that matches at a position,
    longest first, each reading in order -- so `sh` gives ш before сх. Stops
    at MAX_CANDIDATES. A character no rule reads means no candidates at all.
    """
    w = word.lower()
    out: list[str] = []

    def walk(i: int, acc: str) -> None:
        if len(out) >= MAX_CANDIDATES:
            return
        if i == len(w):
            out.append(acc)
            return
        for latin, cyrillic in SHLYOKAVITSA:
            if w.startswith(latin, i):
                for c in cyrillic:
                    walk(i + len(latin), acc + c)
                    if len(out) >= MAX_CANDIDATES:
                        return

    walk(0, "")
    return out


def best_reading(word: str, docs) -> str | None:
    """The candidate whose stem the most Bulgarian glosses contain.

    `docs(stem)` says how many documents in the Bulgarian indexes hold that
    stem. Ties go to the earlier candidate; nothing held means None.
    """
    best, best_n = None, 0
    for c in shlyokavitsa(word):
        n = docs(stem(c))
        if n > best_n:
            best, best_n = c, n
    return best
