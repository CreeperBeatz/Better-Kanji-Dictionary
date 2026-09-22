"""Unified search: English, Japanese, romaji, all through one box.

Japanese lookup does not go through FTS. SQLite's unicode61 tokeniser treats a
run of CJK as one token, so 日本語 would never match 日本 -- Japanese is matched
against the indexed word_form table by exact and prefix range instead, and FTS
is reserved for English glosses.
"""

from fastapi import APIRouter, Query

from ..db import query
from ..japanese import deinflect, has_japanese, is_kana, katakana_to_hiragana, pos_matches, romaji_to_kana

router = APIRouter(prefix="/api/search", tags=["search"])


def _fetch_words(ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    ph = ",".join("?" * len(ids))
    words = {
        r["id"]: {
            "id": r["id"],
            "headword": r["headword"],
            "reading": r["reading"],
            "common": bool(r["common"]),
            "nf": r["nf"],
            "senses": [],
            "forms": [],
            "pitch": None,
        }
        for r in query(f"SELECT * FROM word WHERE id IN ({ph})", tuple(ids))
    }
    for r in query(
        f"SELECT word_id, ord, pos, misc, gloss FROM sense WHERE word_id IN ({ph}) ORDER BY word_id, ord",
        tuple(ids),
    ):
        w = words.get(r["word_id"])
        if w:
            w["senses"].append(
                {
                    "pos": (r["pos"] or "").split(",") if r["pos"] else [],
                    "misc": (r["misc"] or "").split(",") if r["misc"] else [],
                    "gloss": r["gloss"],
                }
            )
    for r in query(
        f"SELECT word_id, text, kana, rare FROM word_form WHERE word_id IN ({ph}) ORDER BY word_id, kana, ord",
        tuple(ids),
    ):
        w = words.get(r["word_id"])
        if w:
            w["forms"].append({"text": r["text"], "kana": bool(r["kana"]), "rare": bool(r["rare"])})

    for w in words.values():
        row = query(
            "SELECT pitch FROM accent WHERE word = ? AND reading = ? LIMIT 1",
            (w["headword"], w["reading"]),
        )
        if row:
            w["pitch"] = row[0]["pitch"]
    return words


def _rank(w: dict) -> tuple:
    """Common words with a good nf bucket first; unranked entries last."""
    return (0 if w["common"] else 1, w["nf"] if w["nf"] is not None else 99, len(w["headword"]))


def _by_form(texts: list[str], limit: int) -> list[int]:
    """Exact matches on any written or kana form, preserving `texts` order."""
    if not texts:
        return []
    ph = ",".join("?" * len(texts))
    rows = query(
        f"SELECT DISTINCT word_id, text FROM word_form WHERE text IN ({ph}) LIMIT ?",
        (*texts, limit * 4),
    )
    order = {t: i for i, t in enumerate(texts)}
    return [r["word_id"] for r in sorted(rows, key=lambda r: order.get(r["text"], 99))]


@router.get("")
def search(q: str = Query(min_length=1, max_length=64), limit: int = Query(30, ge=1, le=100)) -> dict:
    q = q.strip()
    if not q:
        return {"query": q, "words": [], "interpretation": None}

    word_ids: list[int] = []
    interpretation: dict | None = None
    inflections: dict[int, list[str]] = {}

    japanese = has_japanese(q)
    kana_guess = "" if japanese else romaji_to_kana(q)

    if japanese or kana_guess:
        target = q if japanese else kana_guess
        if kana_guess:
            interpretation = {"kind": "romaji", "reading": kana_guess}

        # Exact first, then every grammatical dictionary form the input could be.
        candidates = deinflect(target)
        forms = [c.text for c in candidates]
        hits = _by_form(forms, limit)

        # Drop deinflections whose part of speech contradicts the rule that
        # produced them: 着ます must not resolve through a godan reading.
        by_text: dict[str, list] = {}
        for c in candidates:
            by_text.setdefault(c.text, []).append(c)

        checked: list[int] = []
        rows = _fetch_words(hits)
        for wid in hits:
            w = rows.get(wid)
            if not w:
                continue
            text_forms = {f["text"] for f in w["forms"]}
            matched = [c for t, cs in by_text.items() if t in text_forms for c in cs]
            if not matched:
                continue
            ok = [c for c in matched if not c.reasons] or [
                c for c in matched if any(pos_matches(",".join(s["pos"]), c.types) for s in w["senses"])
            ]
            if ok:
                best = min(ok, key=lambda c: len(c.reasons))
                # Carried separately because the final fetch below builds fresh
                # dicts; annotating `w` here would be thrown away.
                inflections[wid] = list(best.reasons)
                checked.append(wid)

        word_ids = checked
        if not japanese and not word_ids:
            kana_guess = ""  # romaji reading found nothing, fall through to English
            interpretation = None

        # Prefix match tops up short result sets, so typing 時 still suggests 時間.
        if len(word_ids) < limit:
            lo, hi = target, target + "￿"
            extra = query(
                "SELECT DISTINCT word_id FROM word_form WHERE text >= ? AND text < ? LIMIT ?",
                (lo, hi, limit * 6),
            )
            for r in extra:
                if r["word_id"] not in word_ids:
                    word_ids.append(r["word_id"])

    if not word_ids and not japanese:
        # English gloss search. Quote the term so punctuation can't be read as
        # FTS syntax, and prefix-match the last word so partial typing works.
        safe = q.replace('"', " ").strip()
        if safe:
            fts_q = " ".join(f'"{t}"' for t in safe.split()[:-1] + [safe.split()[-1] + '*'])
            rows = query(
                "SELECT word_id, rank FROM gloss_fts WHERE gloss_fts MATCH ? "
                "ORDER BY rank LIMIT ?",
                (fts_q, limit * 8),
            )
            seen: set[int] = set()
            for r in rows:
                if r["word_id"] not in seen:
                    seen.add(r["word_id"])
                    word_ids.append(r["word_id"])
            interpretation = {"kind": "english"}

    words = _fetch_words(word_ids[: limit * 4])
    for wid, reasons in inflections.items():
        if wid in words and reasons:
            words[wid]["inflection"] = reasons
    ordered = sorted(words.values(), key=_rank)[:limit]
    return {
        "query": q,
        "interpretation": interpretation,
        "kanji": _search_kanji(q, japanese, kana_guess),
        "words": ordered,
        "total": len(words),
    }


def _search_kanji(q: str, japanese: bool, kana_guess: str) -> list[dict]:
    """Characters matching the query, by meaning or directly by character."""
    chars: list[str] = []

    if japanese:
        # Any kanji typed directly is a result in its own right.
        chars = [c for c in dict.fromkeys(q) if "一" <= c <= "鿿"]

    if not chars and not japanese and not kana_guess:
        safe = q.replace('"', " ").split()
        if safe:
            fts_q = " ".join(f'"{t}"' for t in safe[:-1] + [safe[-1] + "*"])
            rows = query(
                "SELECT char FROM kanji_fts WHERE kanji_fts MATCH ? ORDER BY rank LIMIT 80",
                (fts_q,),
            )
            chars = [r["char"] for r in rows]

    if not chars:
        return []

    ph = ",".join("?" * len(chars))
    rows = query(
        f"SELECT k.char, k.meanings, k.freq, k.jlpt, k.joyo, k.strokes, "
        f"       COALESCE(f.joyo_count, 0) AS fanout, c.meaning AS curated "
        f"FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
        f"LEFT JOIN kanji_curated c ON c.char = k.char "
        f"WHERE k.char IN ({ph})",
        tuple(chars),
    )
    import json as _json

    out = [
        {
            "char": r["char"],
            "meanings": _json.loads(r["meanings"] or "[]"),
            "curated": r["curated"],
            "freq": r["freq"],
            "jlpt": r["jlpt"],
            "joyo": bool(r["joyo"]),
            "strokes": r["strokes"],
            "fanout": r["fanout"],
        }
        for r in rows
    ]
    # FTS rank alone puts obscure characters first, because their meaning lists
    # are short. What you almost always want is the common one: 寺 before 刹.
    out.sort(key=lambda k: (0 if k["joyo"] else 1, k["freq"] if k["freq"] is not None else 9999))
    return out[:12]


@router.get("/words-for/{char}")
def words_for_kanji(char: str, limit: int = Query(12, ge=1, le=60)) -> dict:
    """The most common words written with this character, by nf rank."""
    if len(char) != 1:
        return {"char": char, "words": []}
    rows = query(
        "SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id "
        "WHERE wc.char = ? AND w.common = 1 "
        "ORDER BY w.nf IS NULL, w.nf, LENGTH(w.headword) LIMIT ?",
        (char, limit),
    )
    words = _fetch_words([r["id"] for r in rows])
    order = {r["id"]: i for i, r in enumerate(rows)}
    return {
        "char": char,
        "words": sorted(words.values(), key=lambda w: order.get(w["id"], 999)),
    }


@router.get("/examples/{headword}")
def examples(headword: str, limit: int = Query(5, ge=1, le=30)) -> dict:
    rows = query(
        "SELECT s.text FROM sentence_word sw JOIN sentence s ON s.id = sw.sentence_id "
        "WHERE sw.headword = ? LIMIT ?",
        (headword, limit),
    )
    return {"headword": headword, "sentences": [r["text"] for r in rows]}
