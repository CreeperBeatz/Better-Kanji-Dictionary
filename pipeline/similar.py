"""Which kanji look alike, and which mean alike -- built from open data only.

LOOKS ALIKE

Every character with KanjiVG strokes is drawn three ways -- from its strokes,
in Noto Sans JP and in Noto Serif JP -- and shown to DaKanji, the handwriting
model the drawing pad already uses (glyph_render.py). Four measures come out,
and are merged by reciprocal rank:

  confusion  how strongly the model, shown one character, answers the other
             (its raw class scores, z-scored per image, both directions)
  features   cosine of the model's pooled 256-number feature vectors
  pixels     cosine of the blurred KanjiVG drawing at 32x32
  parts      Jaccard overlap of everything each is built from (the edge table)

tests/similar_eval.py scores this against the lookalikes people listed in
Yencken & Baldwin's flashcard set (COLING 2008): MAP 0.55, a listed lookalike
in the top 5 for 70% of kanji and in the top 10 for 83%. The model alone gets
0.51; parts alone, which is what placed characters on the map, 0.23.

MEANS ALIKE

Three open sources, none of them a language model:

  spelling   JMdict words written with either of two kanji -- 早い/速い,
             取り替える/取り換える, 固い/堅い/硬い. The strongest evidence
             there is that two kanji compete for one meaning, and the words
             themselves are the note shown to the reader.
  wordnet    Japanese WordNet senses shared by the two kanji's own words
             (the kanji alone, or it plus kana: 暖かい, 温かい).
  glosses    KANJIDIC meanings in common, weighted by rarity, so "warm" counts
             for much more than "counter".

Unihan's variant tables (竜/龍, 籠/篭, 国/國) are kept apart, as `variant`:
the same character in another form, not a near-synonym.
"""

import json
import math
import re
import sqlite3
import warnings
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

DATA = Path(__file__).parent / "data"

# How many neighbours to keep per character: the best overall, and the best
# among common characters (newspaper-ranked, JLPT or joyo), so a level filter
# in the app still has something to show.
KEEP_ALL = 24
KEEP_COMMON = 16
RRF_K = 10
# A pair written interchangeably in this many (weighted) words needs no other evidence.
SWAP_ALONE = 4

_KANJI_RANGES = (
    (0x2E80, 0x2FDF), (0x3005, 0x3007), (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0x20000, 0x2FA1F),
)


def is_kanji(ch: str) -> bool:
    o = ord(ch[0])
    return any(lo <= o <= hi for lo, hi in _KANJI_RANGES)


# ---------------------------------------------------------------- drawing

def _font_views(chars: list[str]) -> list[tuple[np.ndarray, np.ndarray]]:
    """Each font's rendering of every character, and which ones it has."""
    from PIL import Image, ImageDraw, ImageFont

    from glyph_render import SIZE

    out = []
    for name in ("NotoSansJP.ttf", "NotoSerifJP.ttf"):
        font = ImageFont.truetype(str(DATA / name), round(SIZE * 0.766))
        try:
            font.set_variation_by_axes([400])
        except OSError:
            pass

        def draw(ch: str) -> np.ndarray:
            im = Image.new("L", (SIZE, SIZE), 0)
            ImageDraw.Draw(im).text((SIZE / 2, SIZE / 2), ch, font=font, fill=255, anchor="mm")
            return np.asarray(im, dtype=np.float32)

        missing = draw("\U0010fffd")  # whatever the font draws for a glyph it lacks
        ims = np.stack([draw(ch) for ch in chars])
        has = ~np.all(ims == missing, axis=(1, 2)) & (ims.max(axis=(1, 2)) > 0)
        out.append((ims, has))
    return out


def looks(db: sqlite3.Connection) -> tuple[list[str], np.ndarray, np.ndarray, np.ndarray]:
    """Draw and look at every character with strokes.

    Returns chars, features (n, views*256, per-view unit vectors, zero where a
    font lacks the glyph), confusion scores (n, 6507, z-scored and averaged
    over views), and the blurred stroke drawing (n, 1024, unit).
    """
    from glyph_render import look, render

    rows = [(c, p) for c, p in db.execute("SELECT char, paths FROM stroke ORDER BY char") if is_kanji(c)]
    chars = [c for c, _ in rows]
    kvg = np.stack([render(json.loads(p)) for _, p in rows])
    views = [(kvg, np.ones(len(chars), bool)), *_font_views(chars)]

    feats, zsum, zn = [], 0, 0
    for ims, has in views:
        f, logits = look(ims)
        f = f - f[has].mean(0)
        f /= np.linalg.norm(f, axis=1, keepdims=True) + 1e-9
        f[~has] = 0
        feats.append(f)
        z = (logits - logits.mean(1, keepdims=True)) / (logits.std(1, keepdims=True) + 1e-9)
        zsum = zsum + z * has[:, None]
        zn = zn + has[:, None]
    conf = (zsum / zn).astype(np.float32)

    small = (kvg > 127).astype(np.float32).reshape(-1, 32, 4, 32, 4).mean((2, 4))
    pix = _blur(small, 2).reshape(len(chars), -1)
    pix -= pix.mean(0)
    pix /= np.linalg.norm(pix, axis=1, keepdims=True) + 1e-9
    return chars, np.concatenate(feats, axis=1), conf, pix.astype(np.float32)


def _blur(x: np.ndarray, r: int) -> np.ndarray:
    k = 2 * r + 1
    c = np.pad(x, ((0, 0), (r + 1, r), (r + 1, r))).cumsum(1)
    x = c[:, k:] - c[:, :-k]
    c = x.cumsum(2)
    return (c[:, :, k:] - c[:, :, :-k]) / (k * k)


def all_parts(db: sqlite3.Connection) -> dict[str, set[str]]:
    kids: dict[str, set[str]] = defaultdict(set)
    for p, c in db.execute("SELECT parent, child FROM edge"):
        if p != c:
            kids[p].add(c)
    memo: dict[str, set[str]] = {}

    def down(c: str) -> set[str]:
        if c not in memo:
            memo[c] = set()  # a cycle, should one sneak in, ends here
            s = set(kids.get(c, ()))
            for k in list(s):
                s |= down(k)
            memo[c] = s
        return memo[c]

    return {c: down(c) for c in list(kids)}


# ---------------------------------------------------------------- human lists
#
# Pairs people have named are always kept and go first. Set
# SIMILAR_COMPUTED_ONLY=1 to build without them, which is how the figures in
# the docstring above were measured: tests/similar_eval.py scores against these
# same lists, so with them in it would be marking its own homework.

SIMILAR = DATA / "similar"
BOOST_LOOK = 0.5   # fused scores run 0..1, and a good first neighbour is ~0.5
BOOST_MEAN = 1.0


def _computed_only() -> bool:
    import os

    return os.environ.get("SIMILAR_COMPUTED_ONLY") == "1"


def _both_ways(pairs) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for a, b in pairs:
        if a != b:
            out[a].add(b)
            out[b].add(a)
    return out


def _tab_lists(path: Path) -> list[tuple[str, str]]:
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "	" in line and not line.startswith("#"):
                a, rest = line.split("	", 1)
                out += [(a.strip(), b.strip()) for b in rest.split(",") if b.strip()]
    return out


def listed_lookalikes() -> dict[str, set[str]]:
    """Yencken's flashcards and pooled picks (CC BY 3.0), kanjium's list (CC BY-SA 4.0)."""
    if _computed_only():
        return {}
    pairs = _tab_lists(SIMILAR / "kanjium" / "lookalikes.txt")
    flash = SIMILAR / "yencken" / "flashcards.csv"
    if flash.exists():
        for line in flash.read_text(encoding="utf-8").splitlines():
            t = line.split()
            if len(t) >= 3:
                pairs += [(t[1], b) for b in t[2]]
    pool = SIMILAR / "yencken" / "poolexp_judgements.yaml.gz"
    if pool.exists():
        import gzip

        import yaml

        with gzip.open(pool, "rt", encoding="utf-8") as f:
            for d in yaml.safe_load_all(f):
                if d:
                    pairs += [(d["pivot"], x) for x in d.get("selected") or []]
    return _both_ways(pairs)


def listed_synonyms() -> tuple[dict[str, set[str]], dict[tuple[str, str], str]]:
    """kanjium's synonyms (CC BY-SA 4.0) and the Bunkacho 異字同訓 groups
    (pipeline/ijidokun.tsv), the latter with the kun reading they share."""
    if _computed_only():
        return {}, {}
    pairs = _tab_lists(SIMILAR / "kanjium" / "synonyms.txt")
    kun: dict[tuple[str, str], str] = {}
    for line in (Path(__file__).parent / "ijidokun.tsv").read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or "	" not in line:
            continue
        reading, ks = line.split("	")
        ks = ks.split(",")
        for a in ks:
            for b in ks:
                if a != b:
                    pairs.append((a, b))
                    kun.setdefault((a, b), reading.split("・")[0])
    return _both_ways(pairs), kun


def _ranks(sim: np.ndarray) -> np.ndarray:
    order = np.argsort(-sim, axis=1, kind="stable")
    r = np.empty_like(order)
    r[np.arange(len(sim))[:, None], order] = np.arange(sim.shape[1])
    return r


def lookalikes(db: sqlite3.Connection, pools: dict[str, list[int]] | None = None, block: int = 256):
    """Yield (char, other, rank, score) for the best lookalikes of every character.

    `score` is the fused reciprocal-rank score, scaled so a candidate ranked
    first by every measure scores 1.
    """
    from glyph_render import labels

    chars, feats, conf, pix = looks(db)
    n = len(chars)
    lab = {c: i for i, c in enumerate(labels())}
    col = np.array([lab.get(c, -1) for c in chars])
    known = col >= 0

    parts = all_parts(db)
    vocab = {p: i for i, p in enumerate(sorted({p for c in chars for p in parts.get(c, ())} | set(chars)))}
    A = np.zeros((n, len(vocab)), np.float32)
    for i, c in enumerate(chars):
        for p in parts.get(c, set()) | {c}:
            A[i, vocab[p]] = 1
    asize = A.sum(1)

    views = feats.shape[1] // 256
    fv = feats.reshape(n, views, 256)
    present = (np.abs(fv).sum(2) > 0).astype(np.float32)  # (n, views)

    common = {c for (c,) in db.execute(
        "SELECT char FROM kanji WHERE freq IS NOT NULL OR jlpt IS NOT NULL OR joyo = 1")}
    common_ix = np.array([i for i, c in enumerate(chars) if c in common])

    top = 4 / (RRF_K + 0)
    listed = listed_lookalikes()
    at = {c: i for i, c in enumerate(chars)}
    for s in range(0, n, block):
        q = np.arange(s, min(n, s + block))
        # features: the mean cosine over the views both characters have
        num = np.einsum("qvd,nvd->qn", fv[q], fv)
        den = present[q] @ present.T
        m_feat = num / np.maximum(den, 1)
        # confusion: both directions where the model knows the character
        fwd = np.where(known[None, :], conf[q][:, np.where(known, col, 0)], np.nan)
        back = np.where(known[q][:, None], conf[:, np.where(known[q], col[q], 0)].T, np.nan)
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # neither direction known: -9 below
            m_conf = np.nan_to_num(np.nanmean(np.stack([fwd, back]), axis=0), nan=-9.0)
        m_pix = pix[q] @ pix.T
        inter = A[q] @ A.T
        m_parts = inter / (asize[q][:, None] + asize[None, :] - inter)

        fused = sum(1.0 / (RRF_K + _ranks(m)) for m in (m_conf, m_feat, m_pix, m_parts)) / top
        for a, i in enumerate(q):
            for o in listed.get(chars[i], ()):
                if o in at:
                    fused[a, at[o]] += BOOST_LOOK
        fused[np.arange(len(q)), q] = -1  # never oneself

        for a, i in enumerate(q):
            row = fused[a]
            best = list(np.argsort(-row)[:KEEP_ALL])
            if len(common_ix):
                cb = common_ix[np.argsort(-row[common_ix])[:KEEP_COMMON]]
                best += [j for j in cb if j not in best]
            best.sort(key=lambda j: -row[j])
            for r, j in enumerate(best):
                yield chars[i], chars[j], r, float(row[j])


# ---------------------------------------------------------------- meaning

NUMERALS = set("〇一二三四五六七八九十百千万")
KANA = re.compile(r"^[぀-ゟ]*$")
_STOP = {
    "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "be", "one", "as",
    "by", "with", "at", "from", "something", "someone", "thing", "kanji", "radical",
    "no", "(", ")", "counter", "used", "phonetic", "variant", "e.g.", "etc",
}


def variants() -> dict[str, set[str]]:
    """Unihan's variant links, both ways: the same character in another form."""
    out: dict[str, set[str]] = defaultdict(set)
    keep = {"kSemanticVariant", "kZVariant", "kSimplifiedVariant", "kTraditionalVariant",
            "kJapaneseNewVariant", "kJapaneseOldVariant"}
    with zipfile.ZipFile(DATA / "Unihan.zip") as z:
        for line in z.read("Unihan_Variants.txt").decode("utf-8").splitlines():
            if not line.startswith("U+"):
                continue
            cp, field, value = line.split("\t")
            if field not in keep:
                continue
            a = chr(int(cp[2:], 16))
            for v in value.split():
                b = chr(int(v.split("<")[0][2:], 16))
                if a != b:
                    out[a].add(b)
                    out[b].add(a)
    return out


def spelling_swaps(db: sqlite3.Connection) -> tuple[Counter, dict]:
    """Kanji pairs that swap inside one JMdict word, with the words as evidence."""
    forms: dict[int, list[str]] = defaultdict(list)
    for wid, text in db.execute("SELECT word_id, text FROM word_form WHERE kana = 0 AND rare = 0 ORDER BY word_id, ord"):
        forms[wid].append(text)
    common = {w for (w,) in db.execute("SELECT id FROM word WHERE common = 1")}
    nf = dict(db.execute("SELECT id, COALESCE(nf, 99) FROM word"))
    weight: Counter = Counter()
    words: dict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
    for wid, fs in forms.items():
        seen = set()
        for i in range(len(fs)):
            for j in range(i + 1, len(fs)):
                a, b = fs[i], fs[j]
                if len(a) != len(b):
                    continue
                diff = [(x, y) for x, y in zip(a, b) if x != y]
                if len(diff) != 1 or not (is_kanji(diff[0][0]) and is_kanji(diff[0][1])):
                    continue
                x, y = diff[0]
                if x in NUMERALS and y in NUMERALS:
                    continue  # 十一/一一: numerals written two ways, not meaning
                key = (x, y) if x < y else (y, x)
                if key in seen:
                    continue
                seen.add(key)
                weight[key] += 2 if wid in common else 1
                # the reader sees these: common, short words first
                words[key].append((0 if wid in common else 1, nf.get(wid, 99), len(a), f"{a}・{b}" if x == key[0] else f"{b}・{a}"))
    notes = {k: [w for *_, w in sorted(v)[:3]] for k, v in words.items()}
    return weight, notes


def wordnet_senses() -> dict[str, set[str]]:
    """Kanji -> WordNet synsets of its own words: itself, or itself plus kana."""
    k2s: dict[str, set[str]] = defaultdict(set)
    for line in (DATA / "wn-data-jpn.tab").open(encoding="utf-8"):
        t = line.rstrip("\n").split("\t")
        if len(t) < 3 or t[1] != "jpn:lemma":
            continue
        lemma = t[2]
        if not lemma or not is_kanji(lemma[0]) or len(lemma) > 5:
            continue
        if KANA.match(lemma[1:]):
            k2s[lemma[0]].add(t[0])
    return k2s


def _gloss_words(meanings: list[str]) -> set[str]:
    out = set()
    for m in meanings:
        m = re.sub(r"\(.*?\)", " ", m.lower())
        for w in re.findall(r"[a-z][a-z'-]+", m):
            if w in _STOP or len(w) < 3:
                continue
            for suf in ("ness", "ing", "ed", "th", "ly", "s"):
                if w.endswith(suf) and len(w) - len(suf) >= 4:
                    w = w[: -len(suf)]
                    break
            out.add(w)
    return out


def meaning_neighbours(db: sqlite3.Connection, keep: int = 16, keep_common: int = 10):
    """Yield (char, other, kind, rank, score, note) for near-synonyms and variant forms."""
    rows = {c: json.loads(m or "[]") for c, m in db.execute("SELECT char, meanings FROM kanji WHERE meanings IS NOT NULL")}
    level = {c: (f, j, jo) for c, f, j, jo in db.execute("SELECT char, freq, jlpt, joyo FROM kanji")}
    var = variants()

    # glosses: tf-idf over KANJIDIC meaning words
    gw = {c: _gloss_words(m) for c, m in rows.items()}
    df = Counter(w for ws in gw.values() for w in ws)
    N = len(gw)
    idf = {w: math.log(N / d) for w, d in df.items()}
    gnorm = {c: math.sqrt(sum(idf[w] ** 2 for w in ws)) for c, ws in gw.items()}
    by_word: dict[str, list[str]] = defaultdict(list)
    for c, ws in gw.items():
        for w in ws:
            if df[w] <= 60:  # a word shared by more than 60 kanji says little
                by_word[w].append(c)

    senses = wordnet_senses()
    by_sense: dict[str, list[str]] = defaultdict(list)
    for c, ss in senses.items():
        for s in ss:
            by_sense[s].append(c)

    swaps, swap_words = spelling_swaps(db)
    swap_of: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for (a, b), w in swaps.items():
        swap_of[a].append((b, w))
        swap_of[b].append((a, w))

    listed, kun = listed_synonyms()
    chars = set(rows) | set(senses) | set(swap_of) | set(listed)
    for c in chars:
        # --- variant forms, apart
        vs = sorted(var.get(c, set()) & level.keys(), key=lambda v: (level[v][0] is None, level[v][0] or 0))
        for r, v in enumerate(vs[:6]):
            yield c, v, "variant", r, 1.0, None

        cand: dict[str, dict] = defaultdict(lambda: {"spell": 0.0, "wn": 0.0, "gloss": 0.0, "shared": set()})
        for o, w in swap_of.get(c, ()):
            cand[o]["spell"] = w
        for s in senses.get(c, ()):
            for o in by_sense[s]:
                if o != c:
                    cand[o]["wn"] += 1
        for w in gw.get(c, ()):
            for o in by_word.get(w, ()):
                if o != c:
                    cand[o]["gloss"] += idf[w] ** 2
                    cand[o]["shared"].add(w)
        for o in listed.get(c, ()):
            cand[o]["listed"] = True

        scored = []
        for o, e in cand.items():
            if o in var.get(c, ()) or o not in level:
                continue
            wn = e["wn"] / math.sqrt(len(senses.get(c, ())) * len(senses.get(o, ()))) if e["wn"] else 0.0
            gl = e["gloss"] / (gnorm.get(c, 1) * gnorm.get(o, 1)) if e["gloss"] else 0.0
            # A swap in one or two words is often a homophone written by
            # accident or ateji (川/皮 in かわ...); it needs the other sources
            # to agree. Several words make it evidence on its own.
            spell = 1 - math.exp(-e["spell"] / 3) if e["spell"] >= SWAP_ALONE or wn or gl > 0.1 else 0.0
            score = 1.0 * spell + 0.8 * min(1.0, wn * 1.5) + 0.7 * gl
            if e.get("listed"):
                score += BOOST_MEAN
            elif spell == 0 and wn < 0.15 and gl < 0.35:
                continue  # one weak signal alone is noise
            # What the reader is shown as the reason: words that take either
            # kanji, else the kun reading they share, else meanings in common.
            if spell:
                note = {"words": swap_words[(c, o) if c < o else (o, c)][:2]}
            elif (c, o) in kun:
                note = {"kun": kun[(c, o)]}
            elif e["shared"]:
                note = {"gloss": sorted(e["shared"], key=lambda w: -idf[w])[:2]}
            else:
                note = None
            scored.append((score, o, note))
        scored.sort(key=lambda t: -t[0])
        best = scored[:keep]
        best += [t for t in scored[keep:] if level[t[1]] != (None, None, 0)][:keep_common]
        best.sort(key=lambda t: -t[0])
        for r, (score, o, note) in enumerate(best):
            yield c, o, "mean", r, round(score, 4), json.dumps(note, ensure_ascii=False) if note else None
