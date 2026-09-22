"""Fixing decompositions from inside the graph, plus a queue of what to fix.

cjk-decomp is mechanically correct and pedagogically useless in a few hundred
places. FINDINGS.md calls hand-review "where the real effort lives", so the app
makes it something you do in passing while studying rather than a separate
spreadsheet session.

Edits are written to data/decomp_overrides.json, which pipeline/decomp.py loads
as its top layer, so a rebuild keeps them and the research pipeline can pick
them up too.
"""

from fastapi import APIRouter, Body, HTTPException, Query

from .. import store
from ..db import query

router = APIRouter(prefix="/api/decomp", tags=["decomposition"])


@router.get("/overrides")
def list_overrides() -> dict:
    ov = store.decomposition_overrides()
    return {"count": len(ov), "overrides": ov}


@router.put("/{char}")
def set_override(char: str, payload: dict = Body(...)) -> dict:
    if len(char) != 1:
        raise HTTPException(400, "expected a single character")
    components = payload.get("components")
    if not isinstance(components, list) or any(not isinstance(c, str) or len(c) != 1 for c in components):
        raise HTTPException(400, "components must be a list of single characters")
    if char in components:
        raise HTTPException(400, "a character cannot contain itself")
    return store.set_decomposition(char, components)


@router.delete("/{char}")
def clear_override(char: str) -> dict:
    return {"char": char, "cleared": store.clear_decomposition(char)}


@router.get("/review")
def review_queue(limit: int = Query(50, ge=1, le=300)) -> dict:
    """Decompositions most worth a human look, worst first.

    Ranked by how much a bad split actually costs: a wrong component inside a
    high-fan-out character misleads you everywhere it appears, whereas a wrong
    split of something rare costs almost nothing. Characters you have already
    overridden drop out.
    """
    fixed = set(store.decomposition_overrides())

    rows = query(
        """
        SELECT k.char,
               k.freq,
               k.strokes,
               k.joyo,
               COUNT(e.child)                          AS n_parts,
               SUM(CASE WHEN c.in_kanjidic = 0 THEN 1 ELSE 0 END) AS n_bound,
               SUM(CASE WHEN COALESCE(f.joyo_count, 0) <= 1 THEN 1 ELSE 0 END) AS n_singleuse
        FROM kanji k
        JOIN edge e   ON e.parent = k.char
        JOIN kanji c  ON c.char = e.child
        LEFT JOIN fanout f ON f.char = e.child
        WHERE k.joyo = 1
        GROUP BY k.char
        """
    )

    scored = []
    for r in rows:
        if r["char"] in fixed:
            continue
        reasons = []
        score = 0.0

        # A split into many pieces is usually the mechanical one, not the useful one.
        if r["n_parts"] >= 4:
            score += 2.0 + (r["n_parts"] - 4) * 0.5
            reasons.append(f"{r['n_parts']} parts")

        # Components that appear in nothing else are the classic symptom of a
        # split that exists only because the algorithm had to produce something.
        if r["n_singleuse"]:
            score += 1.5 * r["n_singleuse"]
            reasons.append(f"{r['n_singleuse']} single-use part{'s' if r['n_singleuse'] > 1 else ''}")

        # Bound forms with no dictionary entry at all are hard to learn from.
        if r["n_bound"]:
            score += 1.0 * r["n_bound"]
            reasons.append(f"{r['n_bound']} with no entry")

        if not reasons:
            continue

        # Weight by how often you will actually meet the character.
        freq = r["freq"]
        score *= 2.0 if freq and freq <= 500 else 1.5 if freq and freq <= 1500 else 1.0
        scored.append(
            {
                "char": r["char"],
                "freq": freq,
                "strokes": r["strokes"],
                "parts": r["n_parts"],
                "score": round(score, 2),
                "reasons": reasons,
            }
        )

    scored.sort(key=lambda s: (-s["score"], s["freq"] if s["freq"] is not None else 9999))
    return {"total": len(scored), "fixed": len(fixed), "items": scored[:limit]}
