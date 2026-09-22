"""Decomposition graph over cjk-decomp, with a user override layer.

The parsing semantics here are lifted verbatim from build.py so the app and the
research pipeline agree on what "contains" means:

  * `char:type(arg,arg)` lines; overrides loaded last and win
  * types fix/lock/ba/built mean atomic -- no components
  * purely numeric args are anonymous intermediate nodes, expanded recursively
  * CJK stroke codepoints (U+31C0-31EF) are dropped, not treated as components

build.py is left untouched -- it is the frozen research artifact that produced
order-n2.tsv, and re-running it must keep giving the same answer. New work reads
this module instead.

The one addition is `user_overrides`: a JSON layer the app writes when you fix a
decomposition from the graph. It wins over both source files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

DATA = Path(__file__).parent / "data"
USER_OVERRIDES = Path(__file__).parent.parent / "data" / "decomp_overrides.json"

LINE = re.compile(r"^(.+?):([a-z0-9/]+)\((.*)\)\s*$")
ATOMIC_TYPES = {"fix", "lock", "ba", "built"}
MAX_DEPTH = 25


def is_stroke(c: str) -> bool:
    """CJK stroke block -- rendering primitives, not meaningful components."""
    return len(c) == 1 and 0x31C0 <= ord(c) <= 0x31EF


class Decomposition:
    def __init__(self, raw: dict[str, tuple[str, list[str]]]):
        self.raw = raw
        self._direct_cache: dict[str, list[str]] = {}

    # ---------------------------------------------------------------- loading

    @classmethod
    def load(cls, *, user_overrides: bool = True) -> "Decomposition":
        raw: dict[str, tuple[str, list[str]]] = {}
        for path in (DATA / "cjk-decomp.txt", DATA / "cjk-override.txt"):
            if not path.exists():
                raise FileNotFoundError(f"{path} missing -- run pipeline/fetch_sources.py")
            with path.open(encoding="utf-8") as f:
                for ln in f:
                    ln = ln.rstrip("\n")
                    if not ln or ln.startswith("#"):
                        continue
                    m = LINE.match(ln)
                    if not m:
                        continue
                    ch, typ, args = m.group(1), m.group(2), m.group(3)
                    raw[ch] = (typ, [p for p in args.split(",") if p])

        d = cls(raw)
        if user_overrides and USER_OVERRIDES.exists():
            d.apply_user_overrides(json.loads(USER_OVERRIDES.read_text(encoding="utf-8")))
        return d

    def apply_user_overrides(self, overrides: dict) -> None:
        """Overrides are {char: [component, ...]}; an empty list means atomic."""
        for ch, comps in overrides.items():
            self.raw[ch] = ("fix", list(comps))
        self._direct_cache.clear()

    # ---------------------------------------------------------------- queries

    def _expand(self, node: str, depth: int, seen: frozenset[str]) -> set[str]:
        """Resolve one arg to real characters, following anonymous numeric nodes."""
        if node in seen or depth > MAX_DEPTH:
            return set()
        if node.isdigit():
            entry = self.raw.get(node)
            if not entry:
                return set()
            out: set[str] = set()
            for p in entry[1]:
                out |= self._expand(p, depth + 1, seen | {node})
            return out
        return {node}

    def direct(self, ch: str) -> list[str]:
        """Immediate components of `ch`, sorted for stable output."""
        if ch in self._direct_cache:
            return self._direct_cache[ch]
        entry = self.raw.get(ch)
        if not entry or entry[0] in ATOMIC_TYPES:
            self._direct_cache[ch] = []
            return []
        out: set[str] = set()
        for p in entry[1]:
            out |= self._expand(p, 0, frozenset({ch}))
        out.discard(ch)
        result = sorted(c for c in out if not is_stroke(c))
        self._direct_cache[ch] = result
        return result

    def closure(self, roots) -> dict[str, list[str]]:
        """Every character reachable downward from `roots`, mapped to its components."""
        comps: dict[str, list[str]] = {}

        def walk(ch: str, stack: tuple[str, ...]) -> None:
            if ch in comps:
                return
            if ch in stack:  # cycle guard, matches build.py
                comps[ch] = []
                return
            d = self.direct(ch)
            comps[ch] = d
            for c in d:
                walk(c, stack + (ch,))

        for r in roots:
            walk(r, ())
        return comps

    def ancestors(self, comps: dict[str, list[str]], roots) -> dict[str, set[str]]:
        """For each component, the set of `roots` that transitively contain it."""
        anc: dict[str, set[str]] = {}

        def descend(root: str, node: str, seen: set[str]) -> None:
            for c in comps.get(node, ()):
                if c in seen:
                    continue
                seen.add(c)
                anc.setdefault(c, set()).add(root)
                descend(root, c, seen)

        for r in roots:
            descend(r, r, set())
        return anc
