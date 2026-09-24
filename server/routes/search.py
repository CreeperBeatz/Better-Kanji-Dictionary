"""Unified search: English, Bulgarian, Japanese, romaji, all through one box.

Japanese lookup does not go through FTS. SQLite's unicode61 tokeniser treats a
run of CJK as one token, so 日本語 would never match 日本 -- Japanese is matched
against the indexed word_form table by exact and prefix range instead, and FTS
is reserved for English and Bulgarian glosses.

What a query is read as follows from how it is typed. Cyrillic is Bulgarian.
Latin is romaji first; when the interface is in Bulgarian (`lang=bg`) and the
romaji finds nothing, Latin is tried as shlyokavitsa -- Bulgarian typed in
Latin letters -- before English. When romaji wins but the Bulgarian reading
would have found words too, that reading comes back in `alternatives`.
"""

import json
import re
import threading
from collections.abc import Iterator

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from .. import bulgarian as bg
from .. import kanji_parts
from .. import semantic as sem
from ..db import get_db, query
from ..errors import AppError
from ..japanese import deinflect, has_japanese, is_kana, katakana_to_hiragana, pos_matches, romaji_to_kana
from .auth import require_user

router = APIRouter(prefix="/api/search", tags=["search"])

# Words in Latin or Cyrillic letters. Japanese among two or more of them is a
# question about it -- "difference between 暑い and 熱い" -- not a word to look
# up: the dictionary steps aside for Search by meaning, rather than answering
# with every character the question happens to contain.
_WORD = re.compile(r"[A-Za-z\u0400-\u04FF]+")


def is_question(q: str) -> bool:
    return has_japanese(q) and len(_WORD.findall(q)) >= 2


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
            "jlpt": r["jlpt"],
            "senses": [],
            "forms": [],
            "pitch": None,
        }
        for r in query(
            f"SELECT w.*, j.level AS jlpt FROM word w LEFT JOIN word_jlpt j ON j.word_id = w.id "
            f"WHERE w.id IN ({ph})",
            tuple(ids),
        )
    }
    for r in query(
        f"SELECT s.word_id, s.ord, s.pos, s.misc, s.gloss, b.gloss AS gloss_bg FROM sense s "
        f"LEFT JOIN sense_bg b ON b.word_id = s.word_id AND b.ord = s.ord "
        f"WHERE s.word_id IN ({ph}) ORDER BY s.word_id, s.ord",
        tuple(ids),
    ):
        w = words.get(r["word_id"])
        if w:
            w["senses"].append(
                {
                    "pos": (r["pos"] or "").split(",") if r["pos"] else [],
                    "misc": (r["misc"] or "").split(",") if r["misc"] else [],
                    "gloss": r["gloss"],
                    "glossBg": r["gloss_bg"],
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


def _order(w: dict, sort: str, desc: bool) -> tuple:
    """Where a word goes among words that matched equally well.

    By newspaper rank (JMdict nf) or by JLPT level, ascending meaning the
    basic end first -- the top of the newspaper list, N5 -- and descending
    the other end. Words without the rank or level go last either way; the
    other measure, then commonness and length, break ties.
    """
    nf, lv = w["nf"], w["jlpt"]
    news = (nf is None, nf or 0)  # ascending: top 500 first
    level = (lv is None, -(lv or 0))  # ascending: N5 first
    common = 0 if w["common"] else 1
    if sort == "jlpt":
        first = (level[0], -level[1] if desc else level[1])
        return (*first, *news, common, len(w["headword"]))
    first = (news[0], -news[1] if desc else news[1])
    return (*first, *level, common, len(w["headword"]))


def _en_length(text: str) -> int:
    """How many words FTS5 reads in `text`, not counting the "to" of "to
    sleep" -- what the English index's n counts (build_db `_en_length`)."""
    conn = get_db()
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.en_q USING fts5(x, tokenize = 'unicode61 remove_diacritics 2')")
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.en_q_v USING fts5vocab(temp, en_q, 'instance')")
    conn.execute("DELETE FROM temp.en_q")
    conn.execute("INSERT INTO temp.en_q (x) VALUES (?)", (text,))
    terms = [r[0] for r in conn.execute("SELECT term FROM temp.en_q_v ORDER BY offset")]
    return len(terms) - (1 if len(terms) > 1 and terms[0] == "to" else 0)


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


# How many Bulgarian glosses and kanji hold each stem -- what picks the likeliest
# reading of a word typed in shlyokavitsa. Read once; the database is rebuilt
# offline and the server restarted with it.
_bg_docs: dict[str, int] | None = None
_bg_lock = threading.Lock()


def _bg_doc_count(stem: str) -> int:
    global _bg_docs
    if _bg_docs is None:
        with _bg_lock:
            if _bg_docs is None:
                counts: dict[str, int] = {}
                conn = get_db()
                for table in ("bg_gloss_fts", "bg_kanji_fts"):
                    conn.execute(
                        f"CREATE VIRTUAL TABLE IF NOT EXISTS temp.v_{table} USING fts5vocab(main, {table}, 'row')"
                    )
                    for term, docs in conn.execute(f"SELECT term, doc FROM temp.v_{table}"):
                        counts[term] = counts.get(term, 0) + docs
                _bg_docs = counts
    return _bg_docs.get(stem, 0)


# Every kanji reading, as kana a query can equal: reading -> {char: tier}, the
# tier being how the character is read that way (see `_reading_tier`).
_readings: dict[str, dict[str, int]] | None = None
_readings_lock = threading.Lock()


def _kanji_by_reading(kana: str) -> dict[str, int]:
    """The characters read as `kana`, each with how (lower first): a kun'yomi
    that is the whole word (みず for 水, たべる for 食), a kun'yomi's stem before
    its okurigana (た of た.べる), then an on'yomi (すい for 水)."""
    global _readings
    if _readings is None:
        with _readings_lock:
            if _readings is None:
                import json as _json

                table: dict[str, dict[str, int]] = {}

                def add(reading: str, char: str, tier: int) -> None:
                    if reading:
                        at = table.setdefault(reading, {})
                        at[char] = min(tier, at.get(char, tier))

                # 一-鿿 only, as for typed kanji: the compatibility block holds
                # a second 神 that would sit beside the first.
                for r in query("SELECT char, on_yomi, kun_yomi FROM kanji WHERE char >= '一' AND char <= '鿿'"):
                    for kun in _json.loads(r["kun_yomi"] or "[]"):
                        kun = kun.replace("-", "")
                        add(kun.replace(".", ""), r["char"], 0)
                        if "." in kun:
                            add(kun.split(".")[0], r["char"], 1)
                    for on in _json.loads(r["on_yomi"] or "[]"):
                        add(katakana_to_hiragana(on.replace("-", "")), r["char"], 2)
                _readings = table
    return _readings.get(kana, {})


def _only_common(ids: list[int]) -> list[int]:
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    common = {r["id"] for r in query(f"SELECT id FROM word WHERE common = 1 AND id IN ({ph})", tuple(ids))}
    return [i for i in ids if i in common]


def _shlyokavitsa(q: str) -> str | None:
    """The Cyrillic a Latin query most likely stands for, or None."""
    readings = []
    for word in q.split():
        r = bg.best_reading(word, _bg_doc_count)
        if r is None:
            return None
        readings.append(r)
    return " ".join(readings) or None


def _bulgarian_words(text: str, limit: int) -> tuple[list[int], dict[int, int]]:
    """Words whose Bulgarian glosses hold every stem of `text`, best match
    first, and how well each matched (lower is better, see `_bg_tier`)."""
    terms = bg.terms(text)
    if not terms:
        return [], {}
    rows = query(
        "SELECT word_id, n, place, spelled FROM bg_gloss_fts WHERE bg_gloss_fts MATCH ? ORDER BY rank LIMIT ?",
        (" ".join(f'"{t}"' for t in terms), limit * 8),
    )
    spelled = bg.spelling(text)
    tiers: dict[int, int] = {}
    for r in rows:
        tier = _bg_tier(r["n"] == len(terms), r["spelled"] == spelled, r["place"])
        tiers[r["word_id"]] = min(tier, tiers.get(r["word_id"], tier))
    return list(dict.fromkeys(r["word_id"] for r in rows)), tiers


def _bg_tier(exact: bool, same_spelling: bool, place: int) -> int:
    """How well a gloss item matched, lower first. 0-7 an item that is the query
    exactly as written, by where it stands (the entry's first item, another in
    the first sense, a later sense; bare before qualified); 8-15 the same for an
    item that only shares the query's stems (водя for вода); 16 and 17 an item
    that merely mentions them, in the first sense or later."""
    if not exact:
        return 16 + (place >= 4)
    return place + (0 if same_spelling else 8)


@router.get("")
def search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(30, ge=1, le=100),
    lang: str = Query("en", pattern="^(en|bg)$"),
    common: bool = Query(False, description="only words JMdict marks as common"),
    sort: str = Query("news", pattern="^(news|jlpt)$", description="newspaper rank or JLPT level"),
    order: str = Query("asc", pattern="^(asc|desc)$", description="asc: the basic end first"),
) -> dict:
    q = q.strip()
    if not q:
        return {"query": q, "words": [], "interpretation": None}
    if is_question(q):
        return {"query": q, "interpretation": {"kind": "question"}, "alternatives": [], "kanji": [], "words": [], "total": 0}

    word_ids: list[int] = []
    interpretation: dict | None = None
    alternatives: list[dict] = []
    inflections: dict[int, list[str]] = {}
    bg_terms: list[str] | None = None  # set when the words were found in Bulgarian
    bg_tiers: dict[int, int] = {}  # and how well each one matched
    en_tiers: dict[int, int] | None = None  # set, the same way, for an English search

    japanese = has_japanese(q)
    cyrillic = not japanese and bg.has_cyrillic(q)
    kana_guess = "" if japanese or cyrillic else romaji_to_kana(q)
    latin_bg = lang == "bg" and not japanese and not cyrillic and bg.is_latin_query(q)

    if cyrillic:
        bg_terms = bg.terms(q)
        word_ids, bg_tiers = _bulgarian_words(q, limit)
        interpretation = {"kind": "bulgarian"}

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
        if latin_bg:
            reading = _shlyokavitsa(q)
            found, tiers = _bulgarian_words(reading, limit) if reading else ([], {})
            if word_ids and found:
                # Romaji won, but the Bulgarian reading is one tap away.
                alternatives.append({"kind": "bulgarian", "query": reading})
            elif found:
                word_ids, bg_terms, bg_tiers = found, bg.terms(reading), tiers
                interpretation = {"kind": "bulgarian", "reading": reading}
                kana_guess = ""
        if not japanese and not word_ids:
            kana_guess = ""  # romaji reading found nothing, fall through to English
            interpretation = None

        # Prefix match tops up short result sets, so typing 時 still suggests 時間.
        if bg_terms is None and len(word_ids) < limit:
            lo, hi = target, target + "￿"
            extra = query(
                "SELECT DISTINCT word_id FROM word_form WHERE text >= ? AND text < ? LIMIT ?",
                (lo, hi, limit * 6),
            )
            for r in extra:
                if r["word_id"] not in word_ids:
                    word_ids.append(r["word_id"])

    elif latin_bg:
        # Latin that cannot be romaji (4ovek, voda) is Bulgarian before English.
        reading = _shlyokavitsa(q)
        found, tiers = _bulgarian_words(reading, limit) if reading else ([], {})
        if found:
            word_ids, bg_terms, bg_tiers = found, bg.terms(reading), tiers
            interpretation = {"kind": "bulgarian", "reading": reading}

    if not word_ids and not japanese and bg_terms is None:
        # English gloss search. Quote the term so punctuation can't be read as
        # FTS syntax, and prefix-match the last word so partial typing works.
        safe = q.replace('"', " ").strip()
        if safe:
            fts_q = " ".join(f'"{t}"' for t in safe.split()[:-1] + [safe.split()[-1] + '*'])
            rows = query(
                "SELECT word_id, n, place FROM gloss_fts WHERE gloss_fts MATCH ? "
                "ORDER BY rank LIMIT ?",
                (fts_q, limit * 8),
            )
            # How each word matched, lower first: a gloss that is the query
            # (0 in the first sense, 1 a later one), or one that mentions it (2, 3).
            wanted = _en_length(safe)
            en_tiers = {}
            for r in rows:
                tier = (0 if r["n"] == wanted else 2) + r["place"]
                if r["word_id"] not in en_tiers:
                    word_ids.append(r["word_id"])
                en_tiers[r["word_id"]] = min(tier, en_tiers.get(r["word_id"], tier))
            interpretation = {"kind": "english"}

    if common:
        # A view over what was found, not a different search: the query is read
        # the same way, and only the words left out change.
        word_ids = _only_common(word_ids)
    words = _fetch_words(word_ids[: limit * 4])
    for wid, reasons in inflections.items():
        if wid in words and reasons:
            words[wid]["inflection"] = reasons
    # A Bulgarian search puts the words that mean exactly the query first: вода
    # finds 水 before 水道, ябълка finds 林檎 before 目玉 (очна ябълка).
    # An English one likewise; among equal matches, the order asked for.
    tiers = en_tiers if en_tiers is not None else bg_tiers
    desc = order == "desc"
    ordered = sorted(words.values(), key=lambda w: (tiers.get(w["id"], 0), *_order(w, sort, desc)))[:limit]
    return {
        "query": q,
        "interpretation": interpretation,
        "alternatives": alternatives,
        "kanji": _search_kanji(q, japanese, kana_guess, bg_terms),
        "words": ordered,
        "total": len(words),
    }


@router.get("/semantic")
def semantic(
    q: str = Query(min_length=1, max_length=200),
    lang: str = Query("en", pattern="^(en|bg)$"),
    user: dict = Depends(require_user),
):
    """What a language model takes the query to mean, for when the dictionary
    found nothing, streamed as server-sent events while the model writes:

        {"type": "thinking"}
        {"type": "kanji", "kanji": {...a kanji result, "why"}}
        {"type": "word", "word": {...a word entry, "why"}}
        {"type": "note", "note": "..."}
        {"type": "done"}                 or {"type": "error", "code": ...}

    Kanji and words keep the model's order, and only what the database has is
    sent. A character described by its parts is checked against the
    decomposition graph as the model names it: those truly built from the parts
    go out at once, the rest wait for the end, behind at most three jōyō ones
    the model missed -- the order kanji_parts.rerank gives, without anything on
    the page moving. An empty answer is an answer (gibberish finds nothing).

    Failing to reach the model at all is a 503 like any other error, so the
    page can tell "not set up" from "not available now"."""
    q = q.strip()
    try:
        events = sem.open_stream(q, lang)
    except sem.Off:
        raise AppError(503, "semantic_off", "semantic search is not set up on this server")
    except sem.Unavailable as e:
        print(f"[semantic] {q!r}: {e}", flush=True)
        raise AppError(503, "semantic_unavailable", "semantic search is not available right now")
    return StreamingResponse(
        _semantic_events(q, events),
        media_type="text/event-stream",
        # No proxy on the way (the Cloudflare tunnel, nginx) may hold events back.
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _semantic_events(q: str, events) -> Iterator[str]:
    candidates: list[str] = []  # what the database says holds the parts
    parts: list[list[str]] = []
    sent: list[str] = []  # kanji already on the page
    later: list[tuple[str, str | None]] = []  # the model's kanji that do not hold the parts
    words_sent: set[int] = set()

    def kanji(char: str, why: str | None) -> str | None:
        if char in sent or len(sent) >= sem.MAX_KANJI:
            return None
        hit = _kanji_hits([char])
        if not hit:
            return None
        sent.append(char)
        return _sse({"type": "kanji", "kanji": {**hit[0], "why": why}})

    try:
        for kind, value in events:
            out = None
            if kind == "thinking":
                out = _sse({"type": "thinking"})
            elif kind == "parts":
                parts = value
                candidates = kanji_parts.containing(parts)
                if not candidates:
                    parts = []  # nothing holds them: the model's order stands
            elif kind == "kanji":
                if not parts or kanji_parts.holds(value["char"], parts):
                    out = kanji(value["char"], value["why"])
                else:
                    later.append((value["char"], value["why"]))
            elif kind == "word":
                w = _word_for(value["word"], value["reading"])
                if w and w["id"] not in words_sent:
                    words_sent.add(w["id"])
                    out = _sse({"type": "word", "word": {**w, "why": value["why"]}})
            elif kind == "note":
                out = _sse({"type": "note", "note": value})
            elif kind == "answer" and parts:
                # The end of the model's kanji: what it missed, then what it
                # guessed that does not hold the parts -- rerank's order.
                model = {c for c, _ in later} | set(sent)
                fill = [(c, None) for c in candidates if c not in model]
                if sent:
                    tail = [f for f in fill if kanji_parts.is_joyo(f[0])][:3] + later
                else:
                    tail = later[:1] + fill[:3] + later[1:]
                out = "".join(e for c, why in tail if (e := kanji(c, why)))
            if out:
                yield out
    except sem.Unavailable as e:
        print(f"[semantic] {q!r}: {e}", flush=True)
        yield _sse({"type": "error", "code": "semantic_unavailable"})
        return
    yield _sse({"type": "done"})


def _word_for(text: str, reading: str | None) -> dict | None:
    """The dictionary entry a suggested word most likely is: one written that
    way, read the way the model said if one is, common before not."""
    ids = [r["word_id"] for r in query("SELECT DISTINCT word_id FROM word_form WHERE text = ? LIMIT 20", (text,))]
    if not ids:
        return None
    reading = katakana_to_hiragana(reading) if reading else None

    def rank(w: dict) -> tuple:
        kana = {katakana_to_hiragana(f["text"]) for f in w["forms"] if f["kana"]} | {katakana_to_hiragana(w["reading"])}
        return (reading is not None and reading not in kana, w["headword"] != text, not w["common"], w["nf"] is None, w["nf"] or 0)

    return min(_fetch_words(ids).values(), key=rank, default=None)


def _search_kanji(q: str, japanese: bool, kana_guess: str, bg_terms: list[str] | None = None) -> list[dict]:
    """Characters matching the query, by meaning or directly by character."""
    chars: list[str] = []
    tiers: dict[str, int] = {}

    if japanese:
        # Any kanji typed directly is a result in its own right.
        chars = [c for c in dict.fromkeys(q) if "一" <= c <= "鿿"]

    # Kana, typed or read from romaji, finds the characters read that way.
    reading = kana_guess or (katakana_to_hiragana(q) if japanese and not chars and is_kana(q) else "")
    if reading and bg_terms is None:
        tiers = _kanji_by_reading(reading)
        chars = list(tiers)

    if bg_terms is not None:
        if bg_terms:
            rows = query(
                "SELECT char FROM bg_kanji_fts WHERE bg_kanji_fts MATCH ? ORDER BY rank LIMIT 80",
                (" ".join(f'"{t}"' for t in bg_terms),),
            )
            chars = [r["char"] for r in rows]
    elif not chars and not japanese and not kana_guess:
        safe = q.replace('"', " ").split()
        if safe:
            fts_q = " ".join(f'"{t}"' for t in safe[:-1] + [safe[-1] + "*"])
            rows = query(
                "SELECT char FROM kanji_fts WHERE kanji_fts MATCH ? ORDER BY rank LIMIT 80",
                (fts_q,),
            )
            chars = [r["char"] for r in rows]

    out = _kanji_hits(chars)
    # FTS rank alone puts obscure characters first, because their meaning lists
    # are short. What you almost always want is the common one: 寺 before 刹.
    # By reading, kun'yomi come before on'yomi -- among the joyo first, so a
    # rare character's kun'yomi cannot put it ahead of 水 for すい.
    out.sort(key=lambda k: (0 if k["joyo"] else 1, tiers.get(k["char"], 0), k["freq"] if k["freq"] is not None else 9999))
    return out[:12]


def _kanji_hits(chars: list[str]) -> list[dict]:
    """The result row for each of `chars` the database has, in no set order."""
    if not chars:
        return []

    ph = ",".join("?" * len(chars))
    rows = query(
        f"SELECT k.char, k.meanings, k.freq, k.jlpt, k.joyo, k.strokes, "
        f"       COALESCE(f.joyo_count, 0) AS fanout, c.meaning AS curated, kb.meanings AS meanings_bg "
        f"FROM kanji k LEFT JOIN fanout f ON f.char = k.char "
        f"LEFT JOIN kanji_curated c ON c.char = k.char "
        f"LEFT JOIN kanji_bg kb ON kb.char = k.char "
        f"WHERE k.char IN ({ph})",
        tuple(chars),
    )
    import json as _json

    return [
        {
            "char": r["char"],
            "meanings": _json.loads(r["meanings"] or "[]"),
            "meaningsBg": _json.loads(r["meanings_bg"]) if r["meanings_bg"] else None,
            "curated": r["curated"],
            "freq": r["freq"],
            "jlpt": r["jlpt"],
            "joyo": bool(r["joyo"]),
            "strokes": r["strokes"],
            "fanout": r["fanout"],
        }
        for r in rows
    ]


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


def reading_forms(char: str, reading: str, on: bool) -> list[tuple[str, str]]:
    """The (written, kana) a word read this way would have, likeliest first.

    A kun reading carries its okurigana after the dot, so あ.げる on 上 is
    上げる, read あげる. An on reading is the character alone as a noun, or a
    verb on it: 察する -- with つ turning to っ before する, as in さっする --
    感じる, 案ずる. The dashes that mark a prefix or suffix form are dropped.
    """
    r = reading.strip("-")
    if not on:
        stem, _, okuri = r.partition(".")
        return [(char + okuri, stem + okuri)]
    kana = katakana_to_hiragana(r)
    out = [(char, kana), (char + "する", kana + "する")]
    if kana.endswith(("つ", "ち")):
        out.append((char + "する", kana[:-1] + "っする"))
    out += [(char + "じる", kana + "じる"), (char + "ずる", kana + "ずる")]
    return out


@router.get("/reading-words/{char}")
def reading_words(char: str) -> dict:
    """For each of the character's readings, the word it forms, where there is one.

    Keyed by the reading as KANJIDIC writes it. Of the words a reading could
    be -- a noun and a verb on the same on reading, homographs -- the most
    common one, then one headed by that spelling, then the likeliest shape.
    """
    if len(char) != 1:
        return {"char": char, "words": {}}
    row = query("SELECT on_yomi, kun_yomi FROM kanji WHERE char = ?", (char,))
    if not row:
        return {"char": char, "words": {}}
    readings = [(r, True) for r in json.loads(row[0]["on_yomi"] or "[]")]
    readings += [(r, False) for r in json.loads(row[0]["kun_yomi"] or "[]")]

    shapes = {reading: reading_forms(char, reading, on) for reading, on in readings}
    pairs = {pair for forms in shapes.values() for pair in forms}
    if not pairs:
        return {"char": char, "words": {}}
    # Every word written one of these ways and read one of those, in one go;
    # which (written, kana) pair each row is sorts out below.
    written = sorted({w for w, _ in pairs})
    kana = sorted({k for _, k in pairs})
    by_pair: dict[tuple[str, str], list] = {}
    for r in query(
        f"SELECT DISTINCT w.id, w.headword, w.common, w.nf, a.text AS written, b.text AS kana "
        f"FROM word_form a JOIN word_form b ON b.word_id = a.word_id JOIN word w ON w.id = a.word_id "
        f"WHERE a.text IN ({','.join('?' * len(written))}) AND b.text IN ({','.join('?' * len(kana))})",
        (*written, *kana),
    ):
        by_pair.setdefault((r["written"], r["kana"]), []).append(r)

    best: dict[str, int] = {}
    for reading, forms in shapes.items():
        found = [
            (not r["common"], r["headword"] != w, r["nf"] is None, r["nf"] or 0, rank, r["id"])
            for rank, (w, k) in enumerate(forms)
            for r in by_pair.get((w, k), [])
        ]
        if found:
            best[reading] = min(found)[-1]

    words = _fetch_words(list(set(best.values())))
    return {"char": char, "words": {r: words[i] for r, i in best.items() if i in words}}


@router.get("/examples/{headword}")
def examples(headword: str, limit: int = Query(5, ge=1, le=30)) -> dict:
    rows = query(
        "SELECT s.text FROM sentence_word sw JOIN sentence s ON s.id = sw.sentence_id "
        "WHERE sw.headword = ? LIMIT ?",
        (headword, limit),
    )
    return {"headword": headword, "sentences": [r["text"] for r in rows]}


@router.get("/word/{word_id}")
def word_entry(word_id: int) -> dict:
    """One dictionary entry, the way the side panel shows it.

    Alongside the entry: each kanji it is written with, in order, so the panel
    can link straight back into the graph, and a handful of example sentences.
    """
    from fastapi import HTTPException

    from .graph import _fetch

    w = _fetch_words([word_id]).get(word_id)
    if w is None:
        raise HTTPException(404, "no such word")

    chars = [c for c in dict.fromkeys(w["headword"]) if "一" <= c <= "鿿" or "㐀" <= c <= "䶿"]
    nodes = _fetch(chars)
    curated = {
        r["char"]: r["meaning"]
        for r in query(
            f"SELECT char, meaning FROM kanji_curated WHERE char IN ({','.join('?' * len(chars))})",
            tuple(chars),
        )
    } if chars else {}
    kanji = []
    for c in chars:
        if c in nodes:
            kanji.append({**nodes[c], "curated": curated.get(c)})

    rows = query(
        "SELECT s.text FROM sentence_word sw JOIN sentence s ON s.id = sw.sentence_id "
        "WHERE sw.headword = ? ORDER BY LENGTH(s.text) LIMIT 6",
        (w["headword"],),
    )
    return {"word": w, "kanji": kanji, "examples": [_sentence(r["text"], w["headword"]) for r in rows]}


_ANNOTATION = re.compile(r"\(.*?\)|\[.*?\]|~")


def _sentence(indexed: str, headword: str) -> dict:
    """Rebuild the sentence from a Tatoeba index line, and find the word in it.

    The stored text is the jpn_indices B-line, one token per space:
    `lemma(reading)[sense]{surface}` -- only the lemma is mandatory, and the
    surface form, when given, is what the sentence actually says. Matching on
    the lemma is what lets 食べた be marked as an example of 食べる.
    """
    text = ""
    hit = None
    for token in indexed.split():
        brace = token.find("{")
        lemma = _ANNOTATION.sub("", token[:brace] if brace >= 0 else token)
        surface = token[brace + 1 : token.find("}", brace)] if brace >= 0 else lemma
        if hit is None and lemma == headword:
            hit = [len(text), len(text) + len(surface)]
        text += surface
    return {"text": text, "hit": hit}
