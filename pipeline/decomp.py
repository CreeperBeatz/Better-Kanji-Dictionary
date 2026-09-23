"""Decomposition graph over cjk-decomp, with a user override layer.

The parsing semantics here are lifted verbatim from build.py so the app and the
research pipeline agree on what "contains" means:

  * `char:type(arg,arg)` lines; overrides loaded last and win
  * the args are the components, whatever the type; `0` alone means atomic,
    and so does a list that is nothing but strokes
  * purely numeric args are anonymous intermediate nodes, expanded recursively
  * CJK stroke codepoints (U+31C0-31EF) are dropped, not treated as components

Two deliberate departures, both switched off by `as_build_py`:

  * variant codepoints of the same component are folded together (see
    ALIASES), so meaning and usage land on one node
  * build.py read the types fix/lock/ba/built as atomic and dropped their args.
    That is not what they mean: topokanji, which wrote the override file,
    ignores the type altogether, and every override is `fix` -- so 記:fix(言,己)
    came out with no parts at all, as did 別, 込, 印, 声 and ~80 other jōyō.
    Those lines are now read, with two guards (see `_curb`), because topokanji
    wrote them to fix a learning order, not to describe shapes: it breaks even
    口 into 丨一 and 門 into 丨彐月 so everything bottoms out in a few strokes.

build.py is left untouched -- it is the frozen research artifact that produced
order-n2.tsv, and re-running it must keep giving the same answer. New work reads
this module instead.

The one addition is `user_overrides`: a JSON layer the app writes when you fix a
decomposition from the graph. It wins over both source files.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

DATA = Path(__file__).parent / "data"
USER_OVERRIDES = Path(__file__).parent.parent / "data" / "decomp_overrides.json"

LINE = re.compile(r"^(.+?):([a-z0-9/]+)\((.*)\)\s*$")
# Only build.py's reading; see the module docstring.
BUILD_PY_ATOMIC_TYPES = {"fix", "lock", "ba", "built"}
MAX_DEPTH = 25


# cjk-decomp writes some components with a CJK Radicals Supplement codepoint (or
# a glyph variant) while KANJIDIC files the meaning under the unified ideograph,
# so the app saw two unrelated nodes: ⺙ in 38 jōyō with no meaning, 攵 with the
# meaning in one. Each pair here draws the same shape, so folding them keeps the
# visual-containment rule intact. Look-alikes that are NOT the same shape stay
# separate on purpose: ⺈ is not 刀, ⺁ is not 厂, ⺍ is not ⺌, 㔾 is not 卩.
ALIASES = {
    "⺙": "攵",
    "⺆": "冂",
    "户": "戸",
    "戶": "戸",
    "⺊": "卜",
    "⺹": "耂",
    "⻭": "歯",
}

# 卄 is overloaded: the grass top of 草/花 and the two-hands shape of 弁/戒/弄.
# KRADFILE marks grass with the placeholder 艾, so that decides which one a
# given character holds.
GRASS_SOURCE, GRASS = "卄", "艹"
KRAD_GRASS = "艾"


def is_stroke(c: str) -> bool:
    """CJK stroke block -- rendering primitives, not meaningful components."""
    return len(c) == 1 and 0x31C0 <= ord(c) <= 0x31EF


# Single strokes that are also ideographs. As a part they say nothing a learner
# can use, so the lines build.py ignored may not add them (旦 = 日 + 一 from
# cjk-decomp itself is left alone).
BARE_STROKES = frozenset("一丨丶丿亅乙乚ノ")

# KRADFILE files some radicals under a stand-in character (辶 under 込, 阝 under
# 邦 ...), so those list themselves without being primitives.
KRAD_PLACEHOLDERS = frozenset("化个并刈込尚忙扎汁犯艾邦阡老杰礼疔禹初買滴乞")


def _krad() -> dict[str, list[str]]:
    path = DATA / "kradfile.json.zip"
    if not path.exists():
        return {}
    with zipfile.ZipFile(path) as z, z.open(z.namelist()[0]) as f:
        return json.load(io.TextIOWrapper(f, encoding="utf-8"))["kanji"]


def _krad_sets() -> tuple[frozenset[str], frozenset[str]]:
    """(characters carrying the grass radical, characters that are a radical themselves)."""
    krad = _krad()
    grass = frozenset(k for k, comps in krad.items() if KRAD_GRASS in comps)
    primitive = frozenset(k for k, comps in krad.items() if k in comps) - KRAD_PLACEHOLDERS
    return grass, primitive


class Decomposition:
    def __init__(
        self,
        raw: dict[str, tuple[str, list[str]]],
        grass: frozenset[str] = frozenset(),
        as_build_py: bool = False,
        primitive: frozenset[str] = frozenset(),
    ):
        self.raw = raw
        self.grass = grass  # characters KRADFILE says carry the grass radical
        self.primitive = primitive  # characters KRADFILE counts as a radical in their own right
        self.as_build_py = as_build_py
        self._direct_cache: dict[str, list[str]] = {}

    # ---------------------------------------------------------------- loading

    @classmethod
    def load(cls, *, user_overrides: bool = True, as_build_py: bool = False) -> "Decomposition":
        """`as_build_py=True` reproduces build.py exactly, for the regression check."""
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

        grass, primitive = (frozenset(), frozenset()) if as_build_py else _krad_sets()
        d = cls(raw, grass, as_build_py, primitive)
        if user_overrides and USER_OVERRIDES.exists():
            d.apply_user_overrides(json.loads(USER_OVERRIDES.read_text(encoding="utf-8")))
        return d

    def apply_user_overrides(self, overrides: dict) -> None:
        """Overrides are {char: [component, ...]}; an empty list means atomic."""
        for ch, comps in overrides.items():
            self.raw[ch] = ("user", list(comps))
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
        if not entry or (self.as_build_py and entry[0] in BUILD_PY_ATOMIC_TYPES):
            self._direct_cache[ch] = []
            return []
        out: set[str] = set()
        for p in entry[1]:
            out |= self._expand(p, 0, frozenset({ch}))
        if not self.as_build_py:
            out = {ALIASES.get(c, c) for c in out}
        if GRASS_SOURCE in out and ch in self.grass:
            out = (out - {GRASS_SOURCE}) | {GRASS}
        out.discard(ch)
        if entry[0] in BUILD_PY_ATOMIC_TYPES and not self.as_build_py:
            out = self._curb(ch, out)
        result = sorted(c for c in out if not is_stroke(c))
        self._direct_cache[ch] = result
        return result

    def _curb(self, ch: str, parts: set[str]) -> set[str]:
        """Guard the lines build.py ignored: a character KRADFILE treats as a
        radical of its own (口, 月, 門) stays whole, and bare strokes are not parts."""
        if ch in self.primitive:
            return set()
        return parts - BARE_STROKES

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
