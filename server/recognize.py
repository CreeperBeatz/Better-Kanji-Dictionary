"""Handwriting recognition by stroke matching against KanjiVG.

This is a nearest-neighbour search, not a classifier. Each reference character
is reduced to one straight line per stroke -- where the stroke starts and where
it ends -- and the drawing is reduced the same way; the closest reference wins.

That sounds too crude to work, and it is the reason it works well:

  * The features are deliberately coarse -- 8 compass directions, a 3x3 grid
    and five length bands -- so wobbly proportions cost nothing. There is no
    training distribution to fall outside of.
  * Stroke count is strong evidence the writer supplies for free, and it is
    used, but as a weight rather than a hard filter.
  * The reference data is the ideal glyph, already in our own `stroke` table.

The approach is the one behind kanji.sljfaq.org, published in the leafdigital
-> onitake/kanjirecog -> obfusk/kanjidraw lineage. It is reimplemented here
from that description rather than adapted from kanjidraw, whose AGPL would
otherwise relicense this project, and it differs in four measured ways. Figures
below are top-1 / top-10 over jittered glyphs against the whole 6,447-character
reference set; see the constants for how each was chosen.

  * Shape is matched by a Chamfer score -- every drawn stroke against its
    best reference stroke and vice versa -- rather than by a canonical sort of
    the strokes followed by a positional comparison. Sorting is brittle: one
    stroke crossing a grid boundary shifts its position in the order and the
    comparison then lines up unrelated strokes against each other. 39% -> 49%
    on a fixed shortlist, and it removed the shortlist's own ceiling.
  * Strokes carry a length band. The published features do not, and 3x3 cells
    imply length only loosely. 82% -> 91%.
  * Because Chamfer does not need the two sides to be the same length, stroke
    count stops being a hard bucket. Writing a stroke too many or too few
    degrades the ranking instead of emptying it: with the published hard
    bucketing a miscount finds nothing at all, here the character is still in
    the top ten 94% of the time one stroke short, 98% one stroke over.
  * Equal scores break by frequency. Ties are the norm at this coarseness, and
    the common character is nearly always the one that was meant.

There is no stroke-order mode, because there is no reason to make it a choice.
Asking for one is asking the writer to declare whether they know the stroke
order of a character they are looking up. Instead the published sequential
comparison -- which also scores the pen's travel between strokes, and so is
sensitive to order -- runs as a bonus on top of the shape score for the
leaders, and switches itself off when nothing matches the order well. Write a
character properly and it is worth twelve points of top-1; write it in any
other order and it costs nothing at all. See ORDER_GATE.
"""

import json
import re
import threading

from .db import query

# --- feature quantisation ------------------------------------------------
#
# Everything works on a 0..255 box. The thresholds below are the published
# ones, and they are what makes the comparison forgiving: a stroke shorter than
# a fifth of the box in both axes has no meaningful direction at all, and cell
# boundaries at each third mean only opposite thirds count as a real miss.

BOX = 255
DIRECTION_MIN = 51          # below this in both axes, a stroke is a dot
DIAGONAL_RATIO = 77 / 256   # minor/major axis ratio at which a stroke reads as diagonal
CELL = BOX / 3              # 3x3 location grid

W_STROKE_DIR = 1.0          # the direction the stroke itself runs
W_MOVE_DIR = 0.8            # the pen's travel from the last stroke -- order term only
W_LOCATION = 0.6            # start cell, and end cell, scored separately
W_LENGTH = 0.5              # how long the stroke is, in fifths of the box
NEAR = 0.7                  # credit for being one compass point, cell or band off

# Stroke length, as a fraction of the box, cut into five. The published feature
# set has no length term, and 3x3 cells carry it only indirectly: 言's short
# horizontals and 盲's wide bar land in the same cells, so 盲 used to outrank 言
# on a drawing of 言. Adding it was worth top-1 82% -> 91%, top-5 92% -> 98%.
LENGTH_CUTS = (0.18, 0.34, 0.5, 0.68)
LENGTH_BUCKETS = len(LENGTH_CUTS) + 1

# How hard a stroke-count mismatch is punished. Chamfer already penalises it
# indirectly -- unmatched reference strokes drag the reverse half down -- so
# this only has to break the remaining ties in the right direction, and it
# should be gentle. Measured on jittered glyphs: with no penalty at all top-1
# collapses by more than thirty points, but every value from 0.1 to 2.0 scores
# the same when the stroke count is right. The whole difference is in what
# happens when it is wrong -- at 1.0 one miscounted stroke drops the answer out
# of the top ten 98% of the time, at 0.1 it is still in there. So: the smallest
# penalty that still breaks ties.
LENGTH_POWER = 0.1
STROKE_WINDOW = 3           # how far from the drawn stroke count to look at all

OFFBY1_PENALTY = 0.92       # an order match that needed a stroke dropped

# What stroke-order agreement is worth on top of the shape score, which is
# itself 0..100, and how well the best candidate has to agree before any of it
# is paid out.
#
# The gate is the important half, and it is deliberately a property of the
# whole candidate set rather than of each candidate. A bonus paid out
# unconditionally is not free: when the strokes were not made in the
# character's order, whichever candidate happens to fit the order they were
# made in gets lifted over the one that fits the shape. But a per-candidate
# threshold is worse still -- it is all or nothing, so when the right answer
# falls just below it a wrong one that cleared it wins outright.
#
# Asking instead whether *anything* matches the order well tells us what we
# actually want to know: whether this drawing was written in a recognisable
# order at all. If it was, order is real evidence and everyone is scored on it.
# If it was not, the term is switched off entirely and the shape ranking stands.
#
# Top-1 by how wrong the writer's stroke order was, at realistic noise:
#
#                          no bonus   ungated   gated 80   gated 88
#   correct                     86%       98%        98%        98%
#   one adjacent swap           86%       97%        96%        90%
#   one stroke relocated        87%       86%        89%        89%
#   scrambled                   86%       63%        86%        86%
#
# Gated at 80 the term is free: it never costs anything against not having it,
# and a character written properly gains twelve points. A uniformly scrambled
# drawing is not something a person produces -- even writing a character you
# have never seen, you go roughly top-to-bottom -- but it is what tells the
# gate apart from a threshold applied per candidate, which fails the relocated
# case at 74%.
ORDER_BONUS = 25.0
ORDER_GATE = 80.0

DOT = 8                     # direction index of a stroke too short to have one

Line = tuple[float, float, float, float]


def direction(x1: float, y1: float, x2: float, y2: float) -> int:
    """One of 8 compass points as 0..7 clockwise from north, or DOT."""
    dx, dy = x2 - x1, y2 - y1
    adx, ady = abs(dx), abs(dy)
    if adx < DIRECTION_MIN and ady < DIRECTION_MIN:
        return DOT
    # y grows downward, so north is negative dy.
    if adx > ady:
        diagonal = ady > DIAGONAL_RATIO * adx
        if dx > 0:
            return (1 if dy < 0 else 3) if diagonal else 2      # NE / SE / E
        return (7 if dy < 0 else 5) if diagonal else 6          # NW / SW / W
    diagonal = adx > DIAGONAL_RATIO * ady
    if dy > 0:
        return (5 if dx < 0 else 3) if diagonal else 4          # SW / SE / S
    return (7 if dx < 0 else 1) if diagonal else 0              # NW / NE / N


def dir_close(a: int, b: int) -> bool:
    """Adjacent on the compass ring. A dot is close to anything."""
    if a == DOT or b == DOT or a == b:
        return True
    return (a + 1) % 8 == b or (b + 1) % 8 == a


def cell(x: float, y: float) -> int:
    """Index 0..8 in the 3x3 grid, column-major."""
    col = 0 if x < CELL else (1 if x < 2 * CELL else 2)
    row = 0 if y < CELL else (1 if y < 2 * CELL else 2)
    return col * 3 + row


def cell_close(a: int, b: int) -> bool:
    return abs(a // 3 - b // 3) <= 1 and abs(a % 3 - b % 3) <= 1


def length_bucket(x1: float, y1: float, x2: float, y2: float) -> int:
    d = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 / BOX
    for i, cut in enumerate(LENGTH_CUTS):
        if d < cut:
            return i
    return LENGTH_BUCKETS - 1


# Length is scored from its own small table, indexed length_a * buckets +
# length_b, so the main descriptor table stays at 729 x 729.
LENGTH_TABLE = [
    round(100 * W_LENGTH * (1.0 if a == b else NEAR if abs(a - b) == 1 else 0.0))
    for a in range(LENGTH_BUCKETS)
    for b in range(LENGTH_BUCKETS)
]


def normalise(lines: tuple[Line, ...]) -> tuple[Line, ...]:
    """Fit a set of stroke lines to the 0..255 box.

    Applied to both sides, and computed from stroke endpoints only, because
    endpoints are all the reference side has -- measuring the drawing's extent
    from its full ink would put the two on different scales.

    The fit is uniform, so drawing small or off to one side costs nothing while
    a genuinely flat character like 一 stays flat instead of being stretched
    into the square.
    """
    if not lines:
        return lines
    xs = [v for l in lines for v in (l[0], l[2])]
    ys = [v for l in lines for v in (l[1], l[3])]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    side = max(maxx - minx, maxy - miny)
    if side < 1e-6:
        side = 1.0
    scale = BOX / side
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half = BOX / 2
    return tuple(
        (
            (l[0] - cx) * scale + half,
            (l[1] - cy) * scale + half,
            (l[2] - cx) * scale + half,
            (l[3] - cy) * scale + half,
        )
        for l in lines
    )


# --- the stroke similarity table -----------------------------------------
#
# Direction, start cell and end cell together are 9 * 9 * 9 = 729
# possibilities. That is small enough to precompute every pairwise similarity
# once into a flat byte table, so the inner loop of the match is an integer
# index rather than a chain of comparisons -- which is what makes it affordable
# to score a drawing against the entire database. Length is scored from its own
# much smaller table rather than multiplying this one out.

DESCRIPTORS = 9 * 9 * 9
TABLE_MAX = round(100 * (W_STROKE_DIR + 2 * W_LOCATION))  # 220, fits in a byte
SIM_MAX = TABLE_MAX + round(100 * W_LENGTH)               # with the length term

_TABLE: bytes | None = None


def descriptor(d: int, start: int, end: int) -> int:
    return (d * 9 + start) * 9 + end


def _build_table() -> bytes:
    dir_score = [
        [round(100 * W_STROKE_DIR * (1.0 if a == b else NEAR if dir_close(a, b) else 0.0))
         for b in range(9)]
        for a in range(9)
    ]
    loc_score = [
        [round(100 * W_LOCATION * (1.0 if a == b else NEAR if cell_close(a, b) else 0.0))
         for b in range(9)]
        for a in range(9)
    ]

    table = bytearray(DESCRIPTORS * DESCRIPTORS)
    for da in range(9):
        for sa in range(9):
            for ea in range(9):
                base = descriptor(da, sa, ea) * DESCRIPTORS
                for db in range(9):
                    d = dir_score[da][db]
                    for sb in range(9):
                        ds = d + loc_score[sa][sb]
                        off = base + (db * 9 + sb) * 9
                        row = loc_score[ea]
                        for eb in range(9):
                            table[off + eb] = ds + row[eb]
    return bytes(table)


def table() -> bytes:
    global _TABLE
    if _TABLE is None:
        _TABLE = _build_table()
    return _TABLE


class Glyph:
    """A character reduced to one line per stroke, with features precomputed."""

    __slots__ = ("lines", "dirs", "starts", "ends", "lengths", "moves", "_counted")

    def __init__(self, lines: tuple[Line, ...]):
        self.lines = lines
        self.dirs = tuple(direction(*l) for l in lines)
        self.starts = tuple(cell(l[0], l[1]) for l in lines)
        self.ends = tuple(cell(l[2], l[3]) for l in lines)
        self.lengths = tuple(length_bucket(*l) for l in lines)
        # The pen's travel between strokes. This is the only feature carrying
        # stroke order, and it is used by the ordered mode alone.
        self.moves = tuple(
            direction(lines[i - 1][2], lines[i - 1][3], lines[i][0], lines[i][1])
            for i in range(1, len(lines))
        )
        self._counted: tuple[tuple[int, int], ...] | None = None

    def __len__(self) -> int:
        return len(self.lines)

    @property
    def counted(self) -> tuple[tuple[int, int, int], ...]:
        """Distinct (descriptor, length) pairs with how often each occurs.

        Kanji repeat stroke types heavily -- 言 is three near-identical
        horizontals -- so collapsing them shrinks the match loop for free.
        """
        if self._counted is None:
            tally: dict[tuple[int, int], int] = {}
            for i in range(len(self.lines)):
                k = (descriptor(self.dirs[i], self.starts[i], self.ends[i]), self.lengths[i])
                tally[k] = tally.get(k, 0) + 1
            self._counted = tuple((d, n, c) for (d, n), c in tally.items())
        return self._counted

    def without(self, i: int) -> "Glyph":
        """This glyph with stroke `i` removed, for the ordered mode's near miss.

        Built by slicing the precomputed features rather than recomputing them:
        the ordered search does this once per stroke per candidate, so it is
        the hot path there.
        """
        g = Glyph.__new__(Glyph)
        g.lines = self.lines[:i] + self.lines[i + 1:]
        g.dirs = self.dirs[:i] + self.dirs[i + 1:]
        g.starts = self.starts[:i] + self.starts[i + 1:]
        g.ends = self.ends[:i] + self.ends[i + 1:]
        g.lengths = self.lengths[:i] + self.lengths[i + 1:]
        # Removing a stroke closes a gap: the two pen travels either side of it
        # become one, and every other travel is unchanged.
        if i == 0:
            g.moves = self.moves[1:]
        elif i == len(self.lines) - 1:
            g.moves = self.moves[:-1]
        else:
            before, after = self.lines[i - 1], self.lines[i + 1]
            seam = direction(before[2], before[3], after[0], after[1])
            g.moves = self.moves[:i - 1] + (seam,) + self.moves[i + 1:]
        g._counted = None
        return g


def chamfer(a: Glyph, b: Glyph) -> float:
    """Permutation-invariant agreement between two glyphs, as 0..100.

    Every drawn stroke is scored against the reference stroke it resembles
    most, and every reference stroke against the drawn stroke it resembles
    most; the two halves are averaged. Nothing about the order the strokes were
    made in survives, which is the point.

    Taking both directions is what keeps it honest. Forwards alone would let a
    three-stroke scribble match a twenty-stroke character, because each of the
    three would find something; backwards alone would not notice strokes you
    drew that the character does not have.
    """
    n, m = len(a), len(b)
    if not n or not m:
        return 0.0

    t = table()
    lt = LENGTH_TABLE
    bk = b.counted
    best_b = [0] * len(bk)
    forward = 0

    for ka, la, count_a in a.counted:
        base = ka * DESCRIPTORS
        lrow = la * LENGTH_BUCKETS
        best = 0
        for j in range(len(bk)):
            kb, lb, _ = bk[j]
            v = t[base + kb] + lt[lrow + lb]
            if v > best:
                best = v
            if v > best_b[j]:
                best_b[j] = v
        forward += best * count_a

    backward = 0
    for j in range(len(bk)):
        backward += best_b[j] * bk[j][2]

    score = (forward / n + backward / m) / 2
    # Stroke count as a weight, not a filter.
    ratio = (n / m) if n < m else (m / n)
    return 100.0 * score / SIM_MAX * ratio ** LENGTH_POWER


def compare(a: Glyph, b: Glyph) -> float:
    """Sequential agreement, used only when stroke order is being scored."""
    n = len(a)
    if n != len(b) or n == 0:
        return 0.0

    score = 0.0
    for i in range(n):
        if a.dirs[i] == b.dirs[i]:
            score += W_STROKE_DIR
        elif dir_close(a.dirs[i], b.dirs[i]):
            score += W_STROKE_DIR * NEAR

        if a.starts[i] == b.starts[i]:
            score += W_LOCATION
        elif cell_close(a.starts[i], b.starts[i]):
            score += W_LOCATION * NEAR

        if a.ends[i] == b.ends[i]:
            score += W_LOCATION
        elif cell_close(a.ends[i], b.ends[i]):
            score += W_LOCATION * NEAR

        if a.lengths[i] == b.lengths[i]:
            score += W_LENGTH
        elif abs(a.lengths[i] - b.lengths[i]) == 1:
            score += W_LENGTH * NEAR

        if i:
            if a.moves[i - 1] == b.moves[i - 1]:
                score += W_MOVE_DIR
            elif dir_close(a.moves[i - 1], b.moves[i - 1]):
                score += W_MOVE_DIR * NEAR

    total = n * (W_STROKE_DIR + 2 * W_LOCATION + W_LENGTH) + (n - 1) * W_MOVE_DIR
    return 100.0 * score / total


# --- SVG path -> a single line -------------------------------------------

_TOKEN = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?)")

# Numbers each command takes per repetition, and where the endpoint pair sits
# inside that group. H and V move one axis only; A is the odd one out.
_ARGS: dict[str, tuple[int, int | None]] = {
    "m": (2, 0), "l": (2, 0), "t": (2, 0),
    "h": (1, None), "v": (1, None),
    "s": (4, 2), "q": (4, 2),
    "c": (6, 4),
    "a": (7, 5),
}


def path_endpoints(d: str) -> Line:
    """Start and end point of an SVG path, ignoring everything in between.

    Curvature is not part of the comparison on either side, so a stroke is only
    ever where it begins and where it finishes.
    """
    state: dict = {"cmd": "", "x": 0.0, "y": 0.0, "sx": 0.0, "sy": 0.0, "start": None}
    nums: list[float] = []

    def flush() -> None:
        cmd = state["cmd"]
        if not cmd or not nums:
            nums.clear()
            return
        size, at = _ARGS[cmd.lower()]
        rel = cmd.islower()
        for i in range(0, len(nums) - size + 1, size):
            group = nums[i:i + size]
            if cmd in "Hh":
                state["x"] = state["x"] + group[0] if rel else group[0]
            elif cmd in "Vv":
                state["y"] = state["y"] + group[0] if rel else group[0]
            else:
                nx, ny = group[at], group[at + 1]
                state["x"] = state["x"] + nx if rel else nx
                state["y"] = state["y"] + ny if rel else ny
            if state["start"] is None:
                state["start"] = (state["x"], state["y"])
                state["sx"], state["sy"] = state["x"], state["y"]
            # A repeated moveto group is a lineto; only the first starts a subpath.
            if cmd == "M":
                cmd = "L"
            elif cmd == "m":
                cmd = "l"
        nums.clear()

    for m in _TOKEN.finditer(d):
        if m.group(1):
            flush()
            c = m.group(1)
            if c in "Zz":
                state["x"], state["y"] = state["sx"], state["sy"]
                state["cmd"] = ""
                continue
            state["cmd"] = c
        else:
            nums.append(float(m.group(2)))
    flush()

    start = state["start"]
    if start is None:
        return 0.0, 0.0, 0.0, 0.0
    return start[0], start[1], state["x"], state["y"]


# --- the reference index -------------------------------------------------

_index: dict[int, list[tuple[str, Glyph]]] | None = None
_meta: dict[str, tuple[int | None, list[str], list[str] | None]] = {}
_sizes: dict[str, int] | None = None
_lock = threading.Lock()

# KanjiVG also draws kana and Latin letters. They only ever arrive here as
# noise -- this is a kanji explorer, and ロ competing with 口 helps nobody --
# so they are dropped from the index, which makes the search smaller too.
_KANJI_RANGES = (
    (0x2E80, 0x2FDF),    # CJK radicals supplement, Kangxi radicals
    (0x3005, 0x3007),    # 々 〆 〇
    (0x3400, 0x4DBF),    # extension A
    (0x4E00, 0x9FFF),    # unified ideographs
    (0xF900, 0xFAFF),    # compatibility ideographs
    (0x20000, 0x2FA1F),  # extensions B+ -- where many bound components live
)


def _is_kanji(ch: str) -> bool:
    if ch in _meta:  # anything the graph already knows about stays
        return True
    o = ord(ch[0])
    return any(lo <= o <= hi for lo, hi in _KANJI_RANGES)


def index() -> dict[int, list[tuple[str, Glyph]]]:
    """Reference glyphs bucketed by stroke count, built once on first use.

    The buckets no longer decide what is comparable -- Chamfer handles unequal
    lengths -- but they still let the search skip counts nobody could have
    meant, and the ordered mode needs them.
    """
    global _index
    if _index is not None:
        return _index
    with _lock:
        if _index is not None:
            return _index

        table()  # the similarity table, built once alongside

        for row in query(
            "SELECT k.char, k.freq, k.meanings, kb.meanings AS meanings_bg "
            "FROM kanji k LEFT JOIN kanji_bg kb ON kb.char = k.char"
        ):
            bg = json.loads(row["meanings_bg"]) if row["meanings_bg"] else None
            _meta[row["char"]] = (row["freq"], json.loads(row["meanings"] or "[]"), bg)

        buckets: dict[int, list[tuple[str, Glyph]]] = {}
        for row in query("SELECT char, paths FROM stroke"):
            if not _is_kanji(row["char"]):
                continue
            paths = json.loads(row["paths"])
            if not paths:
                continue
            lines = normalise(tuple(path_endpoints(p) for p in paths))
            buckets.setdefault(len(lines), []).append((row["char"], Glyph(lines)))

        _index = buckets
        return _index


# --- input normalisation -------------------------------------------------

def to_glyph(strokes: list[list[list[float]]]) -> Glyph | None:
    """Ink in arbitrary canvas coordinates to a Glyph on the 0..255 box.

    A stroke keeps only its first and last point; the path between them is not
    part of the comparison on either side.
    """
    lines: list[Line] = []
    for s in strokes:
        pts = [p for p in s if len(p) >= 2]
        if not pts:
            continue
        lines.append((pts[0][0], pts[0][1], pts[-1][0], pts[-1][1]))
    if not lines:
        return None
    return Glyph(normalise(tuple(lines)))


# --- search --------------------------------------------------------------

# Top-10 recall is ~100% at realistic noise, so a longer list only adds
# near misses to scan past.
MAX_RESULTS = 12
MAX_STROKES = 40

# How many of the shape leaders get their stroke order scored as well. The
# sequential comparison is far more expensive per candidate than the table
# lookup, and shape recall is high enough that the answer is inside this many
# almost always.
RERANK = 60


def recognise(
    strokes: list[list[list[float]]],
    *,
    window: int = STROKE_WINDOW,
    limit: int = MAX_RESULTS,
) -> list[dict]:
    """Rank reference characters against the drawn strokes.

    One pass, two kinds of evidence. The shape match ignores stroke order
    entirely; the order match is then added on top as a bonus for the leaders,
    so writing a character in the right order sharpens the answer and writing
    it in the wrong order costs nothing.
    """
    drawn = to_glyph(strokes)
    if drawn is None or len(drawn) > MAX_STROKES:
        return []

    buckets = index()
    scored = _shape_scores(drawn, buckets, window)
    if not scored:
        return []

    ranked = sorted(scored.items(), key=lambda kv: -kv[1][0])
    final = _with_order_bonus(drawn, ranked[:RERANK])
    final.extend((s, size, c) for c, (s, size, _) in ranked[RERANK:])

    # Ties are the norm at this coarseness; the common character is nearly
    # always the one that was meant.
    final.sort(key=lambda t: (-t[0], _freq_rank(t[2]), t[2]))

    return [_entry(char, score, size) for score, size, char in final[:limit]]


def describe(chars: list[str]) -> list[dict]:
    """recognise()'s entry for characters some other recogniser proposed.

    The drawing pad also runs an image classifier on the device, and its picks
    need the same meaning and stroke count as the matcher's own. Score 0: this
    says nothing about how well they match. Characters the dictionary does not
    know are left out.
    """
    buckets = index()
    global _sizes
    if _sizes is None:
        _sizes = {char: size for size, refs in buckets.items() for char, _ in refs}
    return [
        _entry(char, 0.0, _sizes.get(char, 0))
        for char in dict.fromkeys(chars)
        if char in _meta
    ]


def _entry(char: str, score: float, size: int) -> dict:
    freq, meanings, meanings_bg = _meta.get(char, (None, [], None))
    return {
        "char": char,
        "score": round(score, 1),
        "strokes": size,
        "freq": freq,
        "meanings": meanings[:3],
        "meaningsBg": meanings_bg[:3] if meanings_bg else None,
    }


def _shape_scores(
    drawn: Glyph, buckets: dict, window: int
) -> dict[str, tuple[float, int, Glyph]]:
    n = len(drawn)
    out: dict[str, tuple[float, int, Glyph]] = {}
    for size in range(max(1, n - window), n + window + 1):
        for char, ref in buckets.get(size, ()):
            out[char] = (chamfer(drawn, ref), size, ref)
    return out


def _with_order_bonus(
    drawn: Glyph, leaders: list[tuple[str, tuple[float, int, Glyph]]]
) -> list[tuple[float, int, str]]:
    """Add the stroke-order agreement to the leaders' shape scores.

    Nothing is paid unless some candidate clears ORDER_GATE, which is the test
    of whether the drawing was made in a recognisable order at all. If it was
    not, the shape ranking stands untouched; if it was, order separates the
    right answer from the characters that merely look like it.

    Sequential comparison needs both sides the same length, so a candidate one
    stroke out is compared after dropping the stroke that helps it most, and
    anything further out scores nothing here.
    """
    n = len(drawn)
    shorter = [drawn.without(i) for i in range(n)] if n > 1 else []

    orders: list[float] = []
    for _, (_, size, ref) in leaders:
        if size == n:
            orders.append(compare(drawn, ref))
        elif size == n - 1 and shorter:
            orders.append(max(compare(s, ref) for s in shorter) * OFFBY1_PENALTY)
        elif size == n + 1:
            orders.append(max(compare(drawn, ref.without(i)) for i in range(size)) * OFFBY1_PENALTY)
        else:
            orders.append(0.0)

    paid = bool(orders) and max(orders) >= ORDER_GATE
    return [
        (shape + (ORDER_BONUS * orders[i] / 100.0 if paid else 0.0), size, char)
        for i, (char, (shape, size, _)) in enumerate(leaders)
    ]


def _freq_rank(char: str) -> float:
    freq = _meta.get(char, (None, []))[0]
    return float(freq) if freq is not None else float("inf")
