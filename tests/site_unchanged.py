"""The site shows the same data before and after a change to the review code.

    python tests/site_unchanged.py save <file.json>    # before
    python tests/site_unchanged.py check <file.json>   # after: every answer must be the same

Reads the real data/ (review.db, store.json, the database) and writes nothing.
The sample: a fixed set of kanji with every public page answer about them,
and the words their pages list. The review store holds live values AND the
open AI drafts the pages fall back on (review._open_drafts), so removing the
labeling screens must leave every one of these answers byte-identical.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

KANJI = "日生国焼青為兵望区五午邦体医芸道迷迶迷器栞酋巷巽言石糸示戸貝立米及土木田大王白音機案照眠菊頻停像"
KANJI_PATHS = (
    "/api/search/kanji-page/{c}",
    "/api/search/words-with/{c}",
    "/api/search/reading-words/{c}",
    "/api/search/words-for/{c}",
    "/api/kanji/{c}",
    "/api/kanji/{c}/forms",
    "/api/kanji/{c}/similar",
)
OTHER_PATHS = ("/api/decomp/overrides", "/api/kanji/containers", "/api/kanji/by-level/2")
WORDS_PER_KANJI = 4


def _word_ids(page: dict) -> list[int]:
    """Word ids anywhere in a words-with answer, in order, no repeats."""
    seen: list[int] = []

    def walk(v) -> None:
        if isinstance(v, dict):
            wid = v.get("id")
            if isinstance(wid, int) and ("headword" in v or "kana" in v or "reading" in v) and wid not in seen:
                seen.append(wid)
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(page)
    return seen


def snapshot() -> dict[str, object]:
    from server import review
    from server.app import app

    # The startup step the pages need (no `with`: the offline pack is not built here).
    review.load_bg_overlay()
    client = TestClient(app)
    out: dict[str, object] = {}

    def get(path: str):
        r = client.get(path)
        out[path] = {"status": r.status_code, "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text}
        return out[path]["body"]

    for c in dict.fromkeys(KANJI):
        for p in KANJI_PATHS:
            body = get(p.format(c=c))
            if p.endswith("words-with/{c}"):
                for wid in _word_ids(body)[:WORDS_PER_KANJI]:
                    get(f"/api/search/word/{wid}")
    for p in OTHER_PATHS:
        get(p)
    out["pack_key"] = list(review.pack_key())
    return out


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("save", "check"):
        print(__doc__)
        return 2
    mode, file = sys.argv[1], Path(sys.argv[2])
    now = snapshot()
    if mode == "save":
        file.write_text(json.dumps(now, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        print(f"saved {len(now)} answers to {file}")
        return 0
    before = json.loads(file.read_text(encoding="utf-8"))
    now = json.loads(json.dumps(now, ensure_ascii=False, sort_keys=True))
    diff = [k for k in sorted(set(before) | set(now)) if before.get(k) != now.get(k)]
    for k in diff[:30]:
        print(f"  CHANGED {k}")
    print(f"{len(now)} answers, {len(diff)} changed" + ("" if diff else ": all the same"))
    return 1 if diff else 0


if __name__ == "__main__":
    sys.exit(main())
