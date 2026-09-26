"""Which verbs are each other's が and を halves: 開く/開ける, 落ちる/落とす.

JMdict marks a verb intransitive (vi) or transitive (vt) but does not link the
two. A pair is found as two verbs that

  * are written alike up to the last kanji and read alike up to there -- 上
    read あ in both 上がる and 上げる, 立ち上 read たちあ in 立ち上がる and
    立ち上げる -- differing only in the kana after it;
  * go opposite ways: one intransitive, the other transitive, each as its
    first sense that says either has it (as the が/を badge in the app);
  * have endings that differ the way pairs do (PATTERNS), once what they
    share is taken off: がる/げる is g-aru/g-eru, the -aru/-eru pattern.

Without the last test a stem gathers its compounds: 見える would pair with
見つめる and 見せびらかす. Pairs whose stems are read differently -- 出る/出す
-- are listed by hand (IRREGULAR).

A common word is only paired with common ones, so the rare -- 伝える's 伝う
aside -- stay out of what the reader sees first.
"""

import re
import sqlite3
from collections import defaultdict

# Kunrei-style, so a row keeps its consonant: ち is ti, つ tu, as in た.
_ROWS = {
    "": "あいうえお", "k": "かきくけこ", "g": "がぎぐげご", "s": "さしすせそ", "z": "ざじずぜぞ",
    "t": "たちつてと", "d": "だぢづでど", "n": "なにぬねの", "h": "はひふへほ", "b": "ばびぶべぼ",
    "p": "ぱぴぷぺぽ", "m": "まみむめも", "r": "らりるれろ",
}
_ROMA = {k: c + "aiueo"[i] for c, row in _ROWS.items() for i, k in enumerate(row)}
_ROMA.update({"や": "ya", "ゆ": "yu", "よ": "yo", "わ": "wa", "を": "o", "ん": "n", "っ": "Q"})

# The shapes 自動詞/他動詞 pairs come in, as the endings' differing tails.
PATTERNS = {
    frozenset(p)
    for p in [
        ("aru", "eru"),   # 上がる/上げる, 閉まる/閉める
        ("u", "eru"),     # 開く/開ける, 立つ/立てる
        ("reru", "su"),   # 壊れる/壊す, 隠れる/隠す
        ("ru", "su"),     # 残る/残す, 起こる/起こす
        ("iru", "osu"),   # 落ちる/落とす, 起きる/起こす
        ("iru", "asu"),   # 生きる/生かす, 延びる/延ばす
        ("u", "asu"),     # 動く/動かす, 飛ぶ/飛ばす
        ("eru", "asu"),   # 逃げる/逃がす, 溶ける/溶かす
        ("eru", "yasu"),  # 冷える/冷やす, 増える/増やす
        ("eru", "su"),    # 消える/消す (by hand: き/け), 出る/出す
        ("ru", "eru"),    # 見る/見える
        ("u", "oeru"),    # 聞く/聞こえる
        ("waru", "eru"),  # 変わる/変える, 伝わる/伝える
        ("aru", "u"),     # 刺さる/刺す, 挟まる/挟む
        ("ru", "seru"),   # 乗る/乗せる, 寄る/寄せる
    ]
}

# (headword, reading) pairs whose stems are read differently.
IRREGULAR = [
    (("出る", "でる"), ("出す", "だす")),
    (("入る", "はいる"), ("入れる", "いれる")),
    (("消える", "きえる"), ("消す", "けす")),
    (("生まれる", "うまれる"), ("生む", "うむ")),
]

_KANA = re.compile(r"^[぀-ゟ]+$")
_VERB = ("v1", "v5", "vk", "vs-", "vz")


def _is_kanji(c: str) -> bool:
    return "一" <= c <= "鿿" or "㐀" <= c <= "䶿" or c == "々"


def _roma(s: str) -> str:
    return "".join(_ROMA.get(c, "?") for c in s)


def endings_pair(a: str, b: str) -> bool:
    """Whether two verbs' endings differ as a pair's do: がる/げる, く/ける."""
    a, b = _roma(a), _roma(b)
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return frozenset((a[n:], b[n:])) in PATTERNS


def pairs(db: sqlite3.Connection) -> list[tuple[int, int, int]]:
    """(word, its counterpart, rank) rows, rank 0 the likeliest counterpart."""
    senses: dict[int, list[set[str]]] = defaultdict(list)
    for wid, pos in db.execute("SELECT word_id, pos FROM sense ORDER BY word_id, ord"):
        senses[wid].append(set((pos or "").split(",")))

    def way(wid: int) -> str | None:
        for p in senses[wid]:
            vi, vt = "vi" in p, "vt" in p
            if vi or vt:
                return "both" if vi and vt else "vi" if vi else "vt"
        return None

    rows = db.execute(
        "SELECT w.id, w.headword, w.reading, w.common, w.nf, j.level "
        "FROM word w LEFT JOIN word_jlpt j ON j.word_id = w.id"
    ).fetchall()
    info = {}  # id -> (way, common, sort key)
    by_spelling = {}
    groups = defaultdict(list)  # (written stem, read stem) -> [(id, ending)]
    for wid, head, reading, common, nf, jlpt in rows:
        w = way(wid)
        if w not in ("vi", "vt") or not any(x.startswith(_VERB) for p in senses[wid] for x in p):
            continue
        # Commonest first: marked common, then by newspaper rank, then the
        # easier JLPT level -- 切る before 切らす, both ranked alike.
        info[wid] = (w, bool(common), (not common, nf is None, nf or 0, -(jlpt or 0), wid))
        by_spelling[(head, reading)] = wid
        last = max((i for i, c in enumerate(head) if _is_kanji(c)), default=-1)
        ending = head[last + 1 :]
        if last < 0 or not ending or not _KANA.match(ending) or not reading.endswith(ending) or reading == ending:
            continue
        groups[(head[: last + 1], reading[: -len(ending)])].append((wid, ending))

    found: dict[int, set[int]] = defaultdict(set)
    for group in groups.values():
        for a, ea in group:
            for b, eb in group:
                if info[a][0] != info[b][0] and endings_pair(ea, eb):
                    found[a].add(b)
    for x, y in IRREGULAR:
        a, b = by_spelling.get(x), by_spelling.get(y)
        if a and b and info[a][0] != info[b][0]:
            found[a].add(b)
            found[b].add(a)

    out = []
    for a, others in found.items():
        kept = [b for b in others if info[b][1] or not info[a][1]]
        for rank, b in enumerate(sorted(kept, key=lambda b: info[b][2])):
            out.append((a, b, rank))
    return out
