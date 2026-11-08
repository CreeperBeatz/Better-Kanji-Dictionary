"""Spelling correction for a search that found nothing.

Each word the index does not know is matched against the words it does know
-- the English glosses' terms, or the Bulgarian glosses' stems -- and the
closest, most common one is taken: beutiful -> beautiful, ябалк -> ябълк.

"Closest" is counted twice. First on a sound-alike key -- a doubled letter
counts once, and in English ph is f and ck is k -- so elefant is elephant
before elegant, and neccessary is necessary. Then on the letters as typed.
Both are Damerau-Levenshtein distances: a swap of two neighbours (recieve)
is one edit. Only words starting with the same letter (on the key) are
looked at, and up to one edit for words of five letters or fewer, two above;
of those, only the ones as close on the key as the best one are offered.

web/src/local/spelling.ts does the same on the device; keep the two in step.
"""

from __future__ import annotations

import re

MIN_LENGTH = 4  # shorter words have too many neighbours to guess from
MAX_SUGGESTIONS = 3

_DOUBLE = re.compile(r"(.)\1+")


def key(word: str, english: bool) -> str:
    """The sound-alike key: doubled letters once; in English ph is f, ck is k."""
    if english:
        word = word.replace("ph", "f").replace("ck", "k")
    return _DOUBLE.sub(r"\1", word)


def distance(a: str, b: str, cap: int) -> int:
    """Damerau-Levenshtein (optimal string alignment) distance, or cap + 1 once it is past cap."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        low = i
        for j in range(1, len(b) + 1):
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur[j] = v
            low = min(low, v)
        if low > cap:
            return cap + 1
        prev2, prev = prev, cur
    return prev[-1]


class Vocabulary:
    """An index's terms with how many documents hold each, grouped by the key's first letter."""

    def __init__(self, docs: dict[str, int], english: bool):
        self.docs = docs
        self.english = english
        self.groups: dict[str, list[tuple[str, str, int]]] = {}
        for term, n in docs.items():
            k = key(term, english)
            if k:
                self.groups.setdefault(k[0], []).append((term, k, n))

    def suggest(self, word: str) -> list[str]:
        """The known words `word` is most likely a misspelling of, best first;
        none if it is known already or too short to guess."""
        if len(word) < MIN_LENGTH or word in self.docs:
            return []
        cap = 1 if len(word) <= 5 else 2
        k = key(word, self.english)
        if not k:
            return []
        found = []
        for term, tk, n in self.groups.get(k[0], ()):
            if abs(len(tk) - len(k)) > cap:
                continue
            d = distance(k, tk, cap)
            if d <= cap:
                found.append((d, distance(word, term, cap + 2), -n, term))
        found.sort()
        # Only as close as the best: hapy is happy, not hazy or hay as well.
        return [t for d, *_, t in found if d == found[0][0]][:MAX_SUGGESTIONS]
