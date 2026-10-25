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

import functools
import json
import re
import threading
from collections.abc import Iterator

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from .. import bg_overlay
from .. import bulgarian as bg
from .. import kanji_parts
from .. import semantic as sem
from .. import synonyms
from ..db import get_db, query, query_one
from ..errors import AppError
from ..japanese import deinflect, has_japanese, is_kana, katakana_to_hiragana, pos_matches, romaji_to_kana
from .auth import require_user

router = APIRouter(prefix="/api/search", tags=["search"])


def seldom_forms(forms: list[dict], pri: list[bool]) -> list[bool]:
    """A form JMdict gives no priority (ichi1, news1, nf..) while another of the
    same kind has one: 消耗's しょうこう beside しょうもう. JMdict tags only some
    such forms rare (rK, sK..), so this is what greys the rest (D-038)."""
    common = {k for f, p in zip(forms, pri) if p for k in [f["kana"]]}
    return [not p and not f["rare"] and f["kana"] in common for f, p in zip(forms, pri)]

# Words in Latin or Cyrillic letters. Japanese among two or more of them is a
# question about it -- "difference between 暑い and 熱い" -- not a word to look
# up: the dictionary steps aside for Search by meaning, rather than answering
# with every character the question happens to contain.
_WORD = re.compile(r"[A-Za-z\u0400-\u04FF]+")


def is_question(q: str) -> bool:
    return has_japanese(q) and len(_WORD.findall(q)) >= 2


# Ids per query in _fetch_words: well under SQLite's limit on bound values.
FETCH_CHUNK = 5000


def _fetch_words(ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    if len(ids) > FETCH_CHUNK:
        out: dict[int, dict] = {}
        for lo in range(0, len(ids), FETCH_CHUNK):
            out.update(_fetch_words(ids[lo : lo + FETCH_CHUNK]))
        return out
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
                    "glossBg": bg_overlay.gloss(r["word_id"], r["ord"], r["gloss_bg"]),
                }
            )
    pri: dict[int, list[bool]] = {}
    for r in query(
        f"SELECT word_id, text, kana, rare, pri FROM word_form WHERE word_id IN ({ph}) ORDER BY word_id, kana, ord",
        tuple(ids),
    ):
        w = words.get(r["word_id"])
        if w:
            w["forms"].append({"text": r["text"], "kana": bool(r["kana"]), "rare": bool(r["rare"])})
            pri.setdefault(r["word_id"], []).append(bool(r["pri"]))
    for wid, w in words.items():
        for f, s in zip(w["forms"], seldom_forms(w["forms"], pri.get(wid, []))):
            if s:
                f["seldom"] = True
    # A spelling in old kanji (學校): with its old kanji made new, another of the word's spellings.
    old = _old_kanji()
    for w in words.values():
        texts = {f["text"] for f in w["forms"]}
        for f in w["forms"]:
            if any(c in old for c in f["text"]) and "".join(old.get(c, c) for c in f["text"]) in texts:
                f["old"] = True

    # One query for every word's accent, not one each: a kanji's page fetches hundreds.
    heads = sorted({w["headword"] for w in words.values()})
    pitch = {
        (r["word"], r["reading"]): r["pitch"]
        for r in query(f"SELECT word, reading, pitch FROM accent WHERE word IN ({','.join('?' * len(heads))})", tuple(heads))
    } if heads else {}
    for w in words.values():
        w["pitch"] = pitch.get((w["headword"], w["reading"]))
    return words


@functools.cache
def _old_kanji() -> dict[str, str]:
    """Each old kanji and its new form: 學 -> 学."""
    return {r["other"]: r["char"] for r in query("SELECT char, other FROM char_form WHERE kind = 'old'")}


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


# `_order` in SQL, over word w and its JLPT level j, for ranking many words without fetching them.
_NEWS = ("w.nf IS NULL", "COALESCE(w.nf, 0)")
_LEVEL = ("j.level IS NULL", "-COALESCE(j.level, 0)")
_ORDER_SQL = {
    ("news", False): ", ".join((_NEWS[0], _NEWS[1], *_LEVEL, "1 - w.common", "length(w.headword)")),
    ("news", True): ", ".join((_NEWS[0], "-" + _NEWS[1], *_LEVEL, "1 - w.common", "length(w.headword)")),
    ("jlpt", False): ", ".join((_LEVEL[0], _LEVEL[1], *_NEWS, "1 - w.common", "length(w.headword)")),
    ("jlpt", True): ", ".join((_LEVEL[0], "COALESCE(j.level, 0)", *_NEWS, "1 - w.common", "length(w.headword)")),
}


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
    limit: int = Query(30, ge=1, le=1000, description="the search page asks again for 30 more each time"),
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
    jp_tiers: dict[int, int] = {}  # one kanji: common words with it first, then further in, then the rest

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

        # Prefix match tops up short result sets, so typing 時 still suggests 時間:
        # the first of every word starting with it in the order asked for, not
        # the first few in character order, which left 日本語 and 日記 out of 日.
        if bg_terms is None and len(word_ids) < limit:
            lo, hi = target, target + "￿"
            have = set(word_ids)
            rows = query(
                "SELECT w.id FROM word_form f JOIN word w ON w.id = f.word_id LEFT JOIN word_jlpt j ON j.word_id = w.id "
                "WHERE f.text >= ? AND f.text < ?" + (" AND w.common = 1" if common else "") + " "
                "GROUP BY w.id ORDER BY " + _ORDER_SQL[(sort, order == "desc")] + ", w.id LIMIT ?",
                (lo, hi, limit * 6 + len(have)),
            )
            word_ids += [r["id"] for r in rows if r["id"] not in have][: limit * 6]

        # One kanji: after the common words that start with it, the common words
        # that have it further in (技術, 芸術 for 術), then the rare ones that start with it.
        if bg_terms is None and len(target) == 1 and japanese and not is_kana(target):
            have = set(word_ids)
            rows = query(
                "SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id LEFT JOIN word_jlpt j ON j.word_id = w.id "
                "WHERE wc.char = ? AND w.common = 1 AND instr(w.headword, wc.char) > 1 "
                "ORDER BY " + _ORDER_SQL[(sort, order == "desc")] + ", w.id LIMIT ?",
                (target, limit * 6 + len(have)),
            )
            inner = list(dict.fromkeys(r["id"] for r in rows if r["id"] not in have))[: limit * 6]
            ph = ",".join("?" * len(word_ids))
            common_ids = {r["id"] for r in query(f"SELECT id FROM word WHERE common = 1 AND id IN ({ph})", word_ids)} if word_ids else set()
            first = [w for w in word_ids if w in common_ids]
            rest = [w for w in word_ids if w not in common_ids]
            word_ids = first + inner + rest
            jp_tiers = {**{w: 0 for w in first}, **{w: 1 for w in inner}, **{w: 2 for w in rest}}

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
    tiers = en_tiers if en_tiers is not None else jp_tiers or bg_tiers
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
            "meaningsBg": bg_overlay.kanji(r["char"], r["meanings_bg"]),
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


@functools.cache
def _has_readings() -> bool:
    """Whether the database has the readings stage (pipeline/readings.py): one
    from before it has no word_reading or classical_radical."""
    return query_one("SELECT 1 FROM sqlite_master WHERE name = 'word_reading'") is not None


def _mark(r) -> list[int]:
    """Where the kanji's kana are in a word_reading row's reading, [from, to): じょう in じょうしょう."""
    return [r["at"], r["at"] + len(r["kana"])]


def _marked(char: str, words: dict[int, dict]) -> dict[int, dict]:
    """The words, each with the kana of its reading that are `char`'s marked (`mark`).
    Left as they are on a database from before the readings stage."""
    if not words or not _has_readings():
        return words
    ids = list(words)
    for r in query(
        f"SELECT word_id, at, kana FROM word_reading WHERE char = ? AND main = 1 AND word_id IN ({','.join('?' * len(ids))})",
        (char, *ids),
    ):
        words[r["word_id"]]["mark"] = _mark(r)
    return words


def _laned(char: str, words: dict[int, dict]) -> dict[int, dict]:
    """The words, each with how it reads `char`, for the meaning cards' lanes: `lane`
    kun, on, or special (its kana go over more than the kanji: 今日 きょう), and `as`,
    the reading (じょう). Left as they are on a database from before the readings stage."""
    if not words or not _has_readings():
        return words
    row = query_one("SELECT on_yomi FROM kanji WHERE char = ?", (char,))
    on = {r.strip("-") for r in json.loads((row and row["on_yomi"]) or "[]")}
    ids = list(words)
    for r in query(
        f"SELECT word_id, reading FROM word_reading WHERE char = ? AND main = 1 AND word_id IN ({','.join('?' * len(ids))})",
        (char, *ids),
    ):
        w = words[r["word_id"]]
        w["lane"] = "special" if r["reading"] is None else "on" if r["reading"] in on else "kun"
        w["as"] = r["reading"]
    return words


@router.get("/words-with/{char}")
def words_with(
    char: str,
    common: bool = Query(False, description="only words JMdict marks as common"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    """Every word written with `char`, for the search's `*生*`.

    Divided by the meaning of the kanji each word uses: the groups reviewers
    accepted, else the AI's draft of them, with the words placed in them
    (accepted, or drafted and sure; server/review.py `site_meanings`). One list
    per group, the catch-all last, all at once. The words not placed follow,
    common first, a page at a time. With no groups at all, that list is all
    there is. `draft` says what is unreviewed, for the page to mark it.
    """
    from .. import review

    if len(char) != 1:
        return {"char": char, "senses": None, "groups": [], "rest": {"total": 0, "offset": 0, "words": []},
                "draft": {"senses": False, "words": 0, "extras": False}}
    rows = query(
        "SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id "
        # Only words whose headword shows the kanji: 夫 is filed under 人 for its
        # rare spelling 良人, which would read as a mistake here.
        "WHERE wc.char = ? AND instr(w.headword, ?) > 0" + (" AND w.common = 1" if common else "") + " "
        "ORDER BY w.common DESC, w.nf IS NULL, w.nf, LENGTH(w.headword), w.id",
        (char, char),
    )
    ids = [r["id"] for r in rows]
    meanings = review.site_meanings(char)
    senses, placed = meanings["senses"], meanings["placed"]
    groups = []
    if senses:
        in_group: dict[str, list[int]] = {}
        for wid in ids:
            if wid in placed:
                in_group.setdefault(placed[wid], []).append(wid)
        also_in = _also_in(ids, meanings)
        fetched = _laned(char, _marked(char, _fetch_words([w for ws in in_group.values() for w in ws])))
        for s in [*senses, {"id": review.CATCH_ALL, "en": None, "bg": None}]:
            # Its best examples, starred: the words to know it by. Then the words that
            # have this meaning in another of their senses (焼く under "bake").
            best = set(s.get("examples") or [])
            words = [
                _in_card(fetched[w], w, s["id"], meanings, senses, best)
                for w in [*in_group.get(s["id"], []), *also_in.get(s["id"], [])] if w in fetched
            ]
            if words:  # a group with none of the words shown (common only) is left out
                groups.append({**s, "words": words})
    rest = [w for w in ids if w not in placed]
    page = rest[offset:offset + limit]
    fetched = _marked(char, _fetch_words(page))
    return {
        "char": char,
        "senses": senses,
        # How its groups link, the kanji it is easy to mix up with.
        "extras": meanings["extras"],
        "draft": meanings["draft"],
        "kokuji": char in review.kokuji(),
        "groups": groups,
        "rest": {"total": len(rest), "offset": offset, "words": [fetched[w] for w in page if w in fetched]},
    }


def _also_in(ids: list[int], meanings: dict) -> dict[str, list[int]]:
    """group -> the words of `ids` that have it beside their main group, in the order of `ids`."""
    out: dict[str, list[int]] = {}
    for wid in ids:
        for g in meanings.get("also", {}).get(wid, []):
            out.setdefault(g, []).append(wid)
    return out


def _in_card(word: dict, wid: int, group: str, meanings: dict, senses: list[dict], best: set[int] | list[int]) -> dict:
    """A word as a meaning's card lists it: starred if one of the meaning's best examples;
    `senseAt`, the sense of the word that has this meaning, where not its first (焼く's
    "to roast; to bake" under "bake"); `alsoOf`, the word's main meaning, where this is
    another of its meanings."""
    out = {**word, "star": True} if wid in best else dict(word)
    if n := meanings.get("at", {}).get(wid, {}).get(group):
        out["senseAt"] = n
    main = meanings["placed"].get(wid)
    if main != group and (g := next((x for x in senses if x["id"] == main), None)):
        out["alsoOf"] = {"id": g["id"], "en": g.get("en"), "bg": g.get("bg")}
    return out


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


# At most: common words beside each reading, special readings, words in each
# part of a meaning (the card shows a few and opens more of them in place),
# words beside a reading a meaning has only now and then, and words where the
# kanji is there for its sound.
READING_EXAMPLES = 2
SPECIAL_READINGS = 12
LANE_WORDS = 26
ALSO_WORDS = 2
SOUND_WORDS = 5


# Words too common in the meanings' wording to say two meanings are alike.
_PLAIN = {"the", "and", "for", "with", "that", "this", "its", "from", "something", "thing", "things", "kanji",
          "word", "words", "also", "can", "one", "are", "into", "out", "being", "more", "such", "has", "have",
          "what", "who", "which", "when", "where", "used", "use", "says", "names", "covers", "means", "mean"}


def _wording(g: dict) -> set[str]:
    return set(re.findall(r"[a-z]{3,}", f"{g.get('en') or ''} {g.get('about') or ''}".lower())) - _PLAIN


def _key_word(w: dict) -> bool:
    """A word worth showing on a kanji's page: common, and on the N5-N2 lists or
    among the 4,000 most frequent (nf08)."""
    return w["common"] and ((w["jlpt"] or 0) >= 2 or (w["nf"] is not None and w["nf"] <= 8))


@router.get("/kanji-page/{char}")
def kanji_page(char: str) -> dict:
    """A kanji's meanings, readings and words, as its page shows them: one unit.

    `meanings`: each meaning group (review.site_meanings) with what it says and
    its words by how they read the kanji (pipeline/readings.py): `kun`, the
    words that read it in Japanese (上げる, 値上げ), and `on`, one part per
    Chinese reading the meaning has (ジョウ: 上昇, 向上) -- key words, the
    examples first. A reading the meaning has in only a word or two is `also`,
    so it does not read as a rule; its special readings are `exceptions`
    (上手 じょうず under "higher"). `total`: its common words. And the kanji
    close to it in meaning, and `mixups`: kanji easy to mix up with on one of
    its readings (挙げる and 揚げる beside 上げる), each with the usage card that
    tells them apart. `hero`: the kanji's gist, the line its page opens with.
    `link`: how the meanings follow from each other.
    `mixups`: those on no meaning's reading. `soundOnly`: words where the kanji is there for its
    sound (上海). `readings`, keyed by the reading with its dashes dropped
    (あ.げる, じょう): the word it forms, how many common words read the kanji
    so, and the commonest of them. `special`: its special readings, the kana
    going over more than one kanji or matching none of its readings (今日 きょう
    under 今), one word each. And its classical radical, which the page names only on the radical's own.
    """
    from .. import review
    from .graph import _fetch

    out: dict = {"char": char, "meanings": [], "hero": None, "heroBg": None, "link": None, "linkBg": None, "mixups": [], "soundOnly": None,
                 "readings": {}, "special": [], "radical": None}
    if len(char) != 1:
        return out
    formed = {r.strip("-"): w for r, w in reading_words(char)["words"].items()}
    has_readings = _has_readings()
    rows = query(
        "SELECT r.word_id, r.reading, r.kana, r.span, r.written, r.whole, r.main, r.at FROM word_reading r "
        "JOIN word w ON w.id = r.word_id LEFT JOIN word_jlpt j ON j.word_id = w.id "
        "WHERE r.char = ? AND w.common = 1 "
        "ORDER BY j.level IS NULL, -j.level, w.nf IS NULL, w.nf, LENGTH(r.written), w.id",
        (char,),
    ) if has_readings else []

    # --- readings: the words read each way, each as written and read where it
    # reads the kanji so (一日 いちじつ under じつ); a word as its entry heads it
    # first: 今日 is きょう before it is こんにち.
    by_reading: dict[str, list] = {}
    for r in sorted(rows, key=lambda r: not r["main"]):
        if r["reading"] is not None:
            by_reading.setdefault(r["reading"], []).append(r)
    # The reading each word gives the kanji, as its entry reads it, for the meanings.
    reading_of = {r["word_id"]: r["reading"] for r in rows if r["main"] and r["reading"] is not None}
    # Which kana of a word's reading are the kanji's, for the page to mark: じょう in じょうしょう.
    mark_of = {r["word_id"]: _mark(r) for r in rows if r["main"]}

    # Special readings by the kanji they span and their kana, the commonest first,
    # each word as its entry writes and reads it: not 良人 おっと, a spelling of 夫.
    found: dict[tuple[str, str], list] = {}
    for r in rows:
        if r["reading"] is None and r["main"]:
            found.setdefault((r["span"], r["kana"]), []).append(r)

    # Each one once, by a word that is just the span (二十日 はつか, met in
    # 二百二十日) or the span with okurigana (上手い うまい). One met only
    # inside longer words (日本 にっぽん in 日本銀行) shows only if its span has nothing else.
    def own(span: str, rs: list):
        return next((r for r in rs if r["written"] == span), None) or next(
            (r for r in rs if r["written"].startswith(span) and is_kana(r["written"][len(span):])), None
        )

    owned = {key: own(key[0], rs) for key, rs in found.items()}
    covered = {span for (span, _), r in owned.items() if r}
    special = []
    for (span, kana), rs in found.items():
        if owned[(span, kana)]:
            special.append(owned[(span, kana)])
        elif span not in covered:
            covered.add(span)
            special.append(min(rs, key=lambda r: (len(r["written"]), r["word_id"])))
    examples = {
        reading: [r for r in rs if r["word_id"] != (formed.get(reading) or {}).get("id")][:READING_EXAMPLES]
        for reading, rs in by_reading.items()
    }

    # --- meanings: the groups and the common words placed in them.
    site = review.site_meanings(char)
    senses, placed, extras = site["senses"] or [], site["placed"], site["extras"] or {}
    common = [
        r["id"] for r in query(
            "SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id LEFT JOIN word_jlpt j ON j.word_id = w.id "
            "WHERE wc.char = ? AND instr(w.headword, ?) > 0 AND w.common = 1 "
            "ORDER BY j.level IS NULL, -j.level, w.nf IS NULL, w.nf, LENGTH(w.headword), w.id",
            (char, char),
        )
    ]
    in_group: dict[str, list[int]] = {}
    for wid in common:
        if wid in placed:
            in_group.setdefault(placed[wid], []).append(wid)
    # The words that have a meaning in another of their senses (焼く: "burn", also "bake").
    also_in = _also_in(common, site)
    special_ids = {r["word_id"] for r in special}
    words = _fetch_words(
        list({*(w for ws in in_group.values() for w in ws), *special_ids,
              *(r["word_id"] for rs in examples.values() for r in rs), *(w for s in senses for w in s.get("examples") or []),
              *(w for s in senses for u in s.get("uses") or [] for w in u["examples"])})
    )
    on_row = query_one("SELECT on_yomi FROM kanji WHERE char = ?", (char,))
    on_readings = {r.strip("-") for r in json.loads((on_row and on_row["on_yomi"]) or "[]")}

    def pick(ids: list[int], first: list[int], n: int = LANE_WORDS) -> list[int]:
        """`first` that are among `ids`, then the key words, then the rest, commonest
        first: what the card shows first leads. At most `n`."""
        chosen = [w for w in dict.fromkeys(first) if w in ids]
        chosen += [w for w in ids if w not in chosen and _key_word(words[w])]
        chosen += [w for w in ids if w not in chosen]
        return chosen[:n]

    # Kanji easy to mix up, by the reading they share, each with the usage card
    # (異字同訓) for that reading, where there is one; a card can cover two
    # readings (あがる・あげる).
    cards = review.site_usage(char)
    card_of = {r: c for c in cards for r in c["reading"].split("・")}
    mix: dict[str, list[str]] = {}
    for m in extras.get("mixups") or []:
        mix.setdefault(m["reading"], []).append(m["char"])
    for card in cards:
        if not any(r in mix for r in card["reading"].split("・")):
            mix[card["reading"]] = [c for s in card["spellings"] for c in s["kanji"] if c != char and review._is_kanji(c)]
    nodes = _fetch(sorted({c for cs in mix.values() for c in cs} | {c for s in senses for c in s.get("similar") or []}))

    def lite(c: str) -> dict:
        n = nodes.get(c) or {}
        return {"char": c, "meanings": n.get("meanings") or [], "meaningsBg": n.get("meaningsBg")}

    def read_as(c: str, reading: str) -> dict | None:
        """Which of `c`'s meanings it has when read `reading` (あがる・あげる is
        either): the one the word the reading forms is in -- 鳴く's "cry, shout"
        for なく, not 鳴る's "sound, ring" -- else the one with the most words
        read so."""
        if not has_readings:
            return None
        site_c = review.site_meanings(c)
        groups = {g["id"]: g for g in site_c["senses"] or [] if g["id"] != review.CATCH_ALL}
        kana = reading.split("・")

        def plain(r: str) -> str:
            return katakana_to_hiragana(r.replace(".", "").strip("-"))

        forms = {plain(r): w["id"] for r, w in reading_words(c)["words"].items()}
        g = next((g for k in kana if (g := site_c["placed"].get(forms.get(k))) in groups), None)
        if g is None:
            count: dict[str, int] = {}
            for r in query("SELECT word_id, reading FROM word_reading WHERE char = ? AND main = 1 AND reading IS NOT NULL", (c,)):
                p = site_c["placed"].get(r["word_id"])
                if p in groups and plain(r["reading"]) in kana:
                    count[p] = count.get(p, 0) + 1
            g = max(count, key=count.get, default=None)
        return g and {"id": g, "en": groups[g].get("en"), "bg": groups[g].get("bg")}

    # Each kanji with the meaning it has on that reading, this one (`self`) too.
    mixups = [
        {"reading": r, "self": read_as(char, r),
         # With no usage card, a line on when to write which (pipeline/kanji_nuance.py), where drafted.
         "kanji": [{**lite(c), "sense": read_as(c, r), **({} if r.split("・")[0] in card_of else {"note": synonyms.kanji_mixup(char, c, r)})}
                   for c in dict.fromkeys(cs)],
         "usage": card_of.get(r.split("・")[0])}
        for r, cs in mix.items() if cs
    ]

    def close(c: str, here: dict) -> dict:
        """A kanji close to this meaning, and which of its own meanings that is: the one
        that names this kanji back (昇's "rise, ascend" for 上's "go up"), else the
        one worded most like this one."""
        groups = [g for g in review.site_meanings(c)["senses"] or [] if g["id"] != review.CATCH_ALL]
        mine = _wording(here)
        g = next((g for g in groups if char in (g.get("similar") or [])), None) or max(
            groups, key=lambda g: len(_wording(g) & mine), default=None
        )
        if synonyms.kanji_wrong_label(char, here["id"], c):
            g = None  # the check found the guess wrong (D-030): no label rather than a false one
        return {**lite(c), "sense": {"id": g["id"], "en": g.get("en"), "bg": g.get("bg")} if g else None,
                # How it differs; what this kanji is in the meaning, its card says.
                "nuance": synonyms.kanji_nuance(char, here["id"], c)}

    def as_here(r) -> dict:
        """The word as written and read here, which may not be how its entry heads it,
        with the kanji's kana marked."""
        return {**words[r["word_id"]], "headword": r["written"], "reading": r["whole"], "mark": _mark(r)}

    def marked(w: int) -> dict:
        """The word with the kanji's kana in its reading marked, where the readings stage knows them."""
        return {**words[w], "mark": mark_of.get(w)}

    claimed: set[str] = set()
    placed_special: set[int] = set()
    for s in senses:
        if s["id"] == review.CATCH_ALL:
            continue
        own = in_group.get(s["id"], [])
        ids = [*own, *(w for w in also_in.get(s["id"], []) if w not in own)]
        first = s.get("examples") or []
        by: dict[str, list[int]] = {}
        for w in ids:
            if w not in special_ids and w in reading_of:
                by.setdefault(reading_of[w], []).append(w)

        def ruled(r: str) -> bool:
            """Whether the meaning has this reading as a rule, not now and then: three
            of its words or a fifth of them, or the word the reading forms."""
            ws = by[r]
            return len(ws) >= 3 or len(ws) * 5 >= len(ids) or (formed.get(r) or {}).get("id") in ws

        kun = [r for r in by if r not in on_readings]
        kun_ids = [w for w in ids if reading_of.get(w) in kun]
        formed_here = [formed[r]["id"] for r in kun if formed.get(r)]
        on = sorted((r for r in by if r in on_readings and ruled(r)), key=lambda r: -len(by[r]))
        also = [r for r in by if r in on_readings and not ruled(r)]
        exceptions = [r for r in special if r["word_id"] in ids]
        placed_special |= {r["word_id"] for r in exceptions}
        # A reading's kana as a word says it: あ.げる is あげる.
        kana = {katakana_to_hiragana(r.replace(".", "")) for r in by}
        # On a meaning's card, this kanji's meaning there is that meaning.
        here = [{**m, "self": {"id": s["id"], "en": s.get("en"), "bg": s.get("bg")}}
                for m in mixups if set(m["reading"].split("・")) & kana and m["reading"] not in claimed]
        claimed |= {m["reading"] for m in here}
        # A kanji easy to mix up with it here is not listed again as close in meaning.
        mixed = {k["char"] for m in here for k in m["kanji"]}

        def starred(word: dict, wid: int, group: str = s["id"]) -> dict:
            """The word as this meaning's card lists it (_in_card): starred if one of the
            meaning's best examples, and with the sense that has this meaning."""
            return _in_card(word, wid, group, site, senses, first)

        out["meanings"].append({
            "id": s["id"], "en": s.get("en"), "bg": s.get("bg"), "about": s.get("about"), "aboutBg": s.get("aboutBg"),
            "total": len(ids),
            # Starred first in each part, then the words the readings form, then the rest.
            "kun": {"words": [starred(marked(w), w) for w in pick(kun_ids, [*first, *formed_here])]} if kun_ids else None,
            "on": [{"reading": r, "words": [starred(marked(w), w) for w in pick(by[r], first)]} for r in on],
            "also": [{"reading": r, "words": [starred(marked(w), w) for w in by[r][:ALSO_WORDS]]} for r in also],
            "exceptions": [starred(as_here(r), r["word_id"]) for r in exceptions],
            "similar": [close(c, s) for c in s.get("similar") or []
                        if c not in mixed and not synonyms.kanji_not_close(char, s["id"], c)],
            "mixups": here,
            # The patterns it builds words in (〜人 "a person from …": 日本人, 村人), each with its examples.
            "uses": [{"id": u["id"], "en": u["en"], "bg": u.get("bg"), "about": u.get("about"), "aboutBg": u.get("aboutBg"),
                      "words": [marked(w) for w in u["examples"] if w in words]} for u in s.get("uses") or []],
        })
    sound = [w for w in in_group.get(review.CATCH_ALL, []) if w not in special_ids]
    if sound:
        out["soundOnly"] = {"words": [marked(w) for w in pick(sound, [], SOUND_WORDS)]}
    out["hero"], out["heroBg"] = extras.get("hero"), extras.get("heroBg")
    out["link"], out["linkBg"] = extras.get("link"), extras.get("linkBg")
    out["mixups"] = [m for m in mixups if m["reading"] not in claimed]

    for reading in set(by_reading) | set(formed):
        out["readings"][reading] = {
            "formed": formed.get(reading),
            "common": len({r["word_id"] for r in by_reading.get(reading, [])}),
            "examples": [as_here(r) for r in examples.get(reading, []) if r["word_id"] in words],
        }
    # Those no meaning has, at the end; a page with no meanings has them all there.
    out["special"] = [as_here(r) for r in special if r["word_id"] not in placed_special][:SPECIAL_READINGS]
    rad = query_one("SELECT number, radical FROM classical_radical WHERE char = ?", (char,)) if has_readings else None
    if rad:
        out["radical"] = {"char": rad["radical"], "number": rad["number"]}
    return out


@router.get("/examples/{headword}")
def examples(headword: str, limit: int = Query(5, ge=1, le=30)) -> dict:
    rows = query(
        f"SELECT s.text, {'s.real' if _sentence_real() else 'NULL'} AS real FROM sentence_word sw "
        "JOIN sentence s ON s.id = sw.sentence_id WHERE sw.headword = ? LIMIT ?",
        (headword, limit),
    )
    return {"headword": headword, "sentences": [r["real"] or r["text"] for r in rows]}


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
        f"SELECT s.text, {'s.real' if _sentence_real() else 'NULL'} AS real FROM sentence_word sw "
        "JOIN sentence s ON s.id = sw.sentence_id "
        "WHERE sw.headword = ? ORDER BY LENGTH(COALESCE(real, s.text)) LIMIT 6",
        (w["headword"],),
    )
    return {
        "word": w,
        "kanji": kanji,
        "examples": [_sentence(r["text"], r["real"], w["headword"]) for r in rows],
        "pairs": verb_pairs(word_id),
        "related": related_words(word_id),
        "senseNotes": synonyms.sense_notes(word_id),
        "senseOnly": synonyms.sense_only(word_id),
        "spelling": spelling_kanji(w),
    }


def spelling_kanji(w: dict) -> dict:
    """The kanji of the word's other spellings: which have a page to open (旧 in 旧い), and
    which are the old form of another (學 for 学, so 學校 is 学校 in old kanji)."""
    chars = list(dict.fromkeys(c for f in w["forms"] if not f["kana"] for c in f["text"]
                               if "一" <= c <= "鿿" or "㐀" <= c <= "䶿"))
    if not chars:
        return {"open": [], "old": {}}
    from .graph import _fetch

    pages, old = _fetch(chars), _old_kanji()
    return {"open": [c for c in chars if c in pages], "old": {c: old[c] for c in chars if c in old}}


def related_words(word_id: int) -> list[dict]:
    """The word's synonyms (≈), opposites (↔) and the words read the same that are easy to
    mix up with it (!), sense by sense (server/synonyms.py): each the other word, the
    number of its sense that matches, the line on how it differs or when to write it, and
    the line on how this word differs from it."""
    rows = synonyms.word_rows(word_id)
    others = _fetch_words(list({r[2] for r in rows}))
    return [{"sense": r[0], "kind": r[1], "word": others[r[2]], "otherSense": r[3], "line": r[4],
             "ownLine": r[5] if len(r) > 5 else None,
             **({"lineBg": synonyms.line_bg(r[4]), "ownLineBg": synonyms.line_bg(r[5] if len(r) > 5 else None)}
                if r[1] in ("syn", "mix") else {}),
             **({"why": r[6] if len(r) > 6 else "sound"} if r[1] == "mix" else {})}
            for r in rows if r[2] in others]


def verb_pairs(word_id: int) -> list[dict]:
    """The verb going the other way, が for を: 開ける for 開く (pipeline/verb_pairs.py)."""
    ids = [r[0] for r in query("SELECT other_id FROM verb_pair WHERE word_id = ? ORDER BY rank", (word_id,))]
    words = _fetch_words(ids)
    return [words[i] for i in ids if i in words]


_ANNOTATION = re.compile(r"\(.*?\)|\[.*?\]|~")


@functools.cache
def _sentence_real() -> bool:
    """Whether the db keeps Tatoeba's own text (built after D-031); an older one does not."""
    return any(r["name"] == "real" for r in query("PRAGMA table_info(sentence)"))


def _sentence(indexed: str, real: str | None, headword: str) -> dict:
    """The sentence as Tatoeba writes it, and where the word is in it.

    `indexed` is the jpn_indices B-line, one token per space:
    `lemma(reading)[sense]{surface}` -- only the lemma is mandatory, and the
    surface form, when given, is what the sentence actually says. Matching on
    the lemma is what lets 食べた be marked as an example of 食べる. The tokens
    are found in `real` in order, so the word's own place is marked, not an
    earlier look-alike. Without `real` (an old db), the sentence is rebuilt from
    the tokens, which loses punctuation and every word the index skips (D-031).
    """
    tokens = []
    for token in indexed.split():
        brace = token.find("{")
        lemma = _ANNOTATION.sub("", token[:brace] if brace >= 0 else token)
        tokens.append((lemma, token[brace + 1 : token.find("}", brace)] if brace >= 0 else lemma))
    if real:
        at, hit = 0, None
        for lemma, surface in tokens:
            pos = real.find(surface, at)
            if pos < 0:
                continue  # a token without its surface form, in dictionary spelling
            if hit is None and lemma == headword:
                hit = [pos, pos + len(surface)]
            at = pos + len(surface)
        if hit is None:
            word = next((s for lemma, s in tokens if lemma == headword), None)
            pos = real.find(word) if word else -1
            hit = [pos, pos + len(word)] if pos >= 0 else None
        return {"text": real, "hit": hit}
    text, hit = "", None
    for lemma, surface in tokens:
        if hit is None and lemma == headword:
            hit = [len(text), len(text) + len(surface)]
        text += surface
    return {"text": text, "hit": hit}
