"""Multi-radical search -- the picker, and the fallback for when drawing fails.

Two endpoints:
    GET /api/radicals                 the full grid, grouped by stroke count
    GET /api/radicals/search?r=...    kanji containing ALL the given radicals,
                                      plus which radicals are still selectable

The second half of that is what makes a radical picker usable: after you pick
a radical, every radical that appears in no remaining candidate is greyed out,
so you can never construct an empty result.
"""

from fastapi import APIRouter, Query

from ..db import query

router = APIRouter(prefix="/api/radicals", tags=["radicals"])


@router.get("")
def list_radicals() -> dict:
    """Every radical, grouped by stroke count, in picker order."""
    rows = query(
        "SELECT radical, stroke_count, kanji_count FROM radical "
        "ORDER BY stroke_count, kanji_count DESC"
    )
    groups: dict[int, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["stroke_count"], []).append(
            {"radical": r["radical"], "kanjiCount": r["kanji_count"]}
        )
    return {
        "groups": [
            {"strokeCount": sc, "radicals": rads} for sc, rads in sorted(groups.items())
        ],
        "total": len(rows),
    }


@router.get("/search")
def search_by_radicals(
    r: list[str] = Query(default=[], description="radical, repeatable"),
    limit: int = Query(default=400, ge=1, le=2000),
) -> dict:
    """Kanji containing every supplied radical, plus the still-selectable set."""
    if not r:
        return {"kanji": [], "available": [], "total": 0}

    radicals = list(dict.fromkeys(r))  # de-dupe, keep order
    placeholders = ",".join("?" * len(radicals))

    # Kanji that carry all N radicals: count matching rows per kanji and require N.
    # Ordered by newspaper frequency, so the character you actually wanted is at
    # the front instead of buried among rare homographs. KRADFILE covers 12,156
    # characters, most of which have no frequency rank -- those sort last.
    candidates = [
        row["kanji"]
        for row in query(
            f"SELECT kr.kanji AS kanji FROM kanji_radical kr "
            f"LEFT JOIN kanji k ON k.char = kr.kanji "
            f"WHERE kr.radical IN ({placeholders}) "
            f"GROUP BY kr.kanji HAVING COUNT(DISTINCT kr.radical) = ? "
            f"ORDER BY MIN(k.joyo) IS NULL, MIN(k.joyo) DESC, "
            f"         MIN(k.freq) IS NULL, MIN(k.freq), MIN(k.strokes), kr.kanji",
            (*radicals, len(radicals)),
        )
    ]

    if not candidates:
        return {"kanji": [], "available": [], "total": 0, "selected": radicals}

    # Which radicals still narrow the set further -- everything else is dead.
    cand_ph = ",".join("?" * len(candidates))
    available = [
        row["radical"]
        for row in query(
            f"SELECT DISTINCT radical FROM kanji_radical WHERE kanji IN ({cand_ph})",
            tuple(candidates),
        )
    ]

    return {
        "selected": radicals,
        "kanji": candidates[:limit],
        "available": sorted(available),
        "total": len(candidates),
        "truncated": len(candidates) > limit,
    }
