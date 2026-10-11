"""The site falls back on the open AI drafts where nothing is reviewed yet (Dani, 2026-10-11).

    python tests/drafts_live.py

Serves the search router over real HTTP, the review state in a temporary directory. Reads
the real database, writes nothing in data/. Uses 水 and 生, which every build has.
"""

from __future__ import annotations

from harness import Checks, Server, use_sandbox

from server import review
from server.routes import review as review_routes
from server.routes import search

check = Checks()


def words_of(char: str, n: int = 6) -> list[int]:
    from server.db import query
    return [r["id"] for r in query(
        "SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id "
        "WHERE wc.char = ? AND instr(w.headword, ?) > 0 AND w.common = 1 ORDER BY w.nf IS NULL, w.nf, w.id LIMIT ?",
        (char, char, n))]


def placement(char: str, wid: int, sense: str, confidence: float, agree: bool = True) -> dict:
    return {"type": "word_sense", "subject": f"{char}|{wid}", "proposed": sense, "source": "ai:claude-sonnet",
            "evidence": {"confidence": confidence, "agree": agree}}


def main() -> int:
    srv = Server(search.router, review_routes.router)
    use_sandbox(srv.tmp)
    review._flush_pack = lambda: None
    call = srv.call
    try:
        w = words_of("水")
        groups = [{"id": "水.water", "en": "water", "about": "The liquid."},
                  {"id": "水.wednesday", "en": "Wednesday", "about": "Short for 水曜日."}]
        review.add_items([
            {"type": "kanji_senses", "subject": "水", "proposed": groups, "source": "ai:claude-sonnet"},
            {"type": "kanji_extras", "subject": "水", "proposed": {"link": "Water first.", "mixups": []},
             "source": "extras"},
            placement("水", w[0], "水.water", 0.95),
            placement("水", w[1], "水.water", 0.6),  # unsure: waits, ungrouped
            placement("水", w[2], "水.water", 0.9, agree=False),  # the runs disagree: waits
            placement("水", w[3], "水.nope", 0.95),  # a group the draft doesn't have
        ])

        print("nothing reviewed: the drafts show, marked")
        status, res = call("GET", "/api/search/words-with/%E6%B0%B4?common=true")
        check("200", status == 200, status)
        check("the drafted groups show", [s["id"] for s in res["senses"] or []] == ["水.water", "水.wednesday"], res["senses"])
        check("marked as a draft", res["draft"] == {"senses": True, "words": 1, "extras": True}, res["draft"])
        placed = {x["id"] for g in res["groups"] for x in g["words"]}
        check("only the sure word is placed", placed == {w[0]}, placed)
        check("the unsure ones wait, ungrouped", {w[1], w[2], w[3]} <= {x["id"] for x in res["rest"]["words"]})
        check("the drafted extras show", (res["extras"] or {}).get("link") == "Water first.", res["extras"])

        print("a reviewed kanji shows only what was accepted, plus sure drafted words in its groups")
        item = next(i for i in review._read()["items"].values() if i["type"] == "kanji_senses" and i["subject"] == "水")
        review.decide(item["id"], "edit", "u-test", [groups[0]])
        status, res = call("GET", "/api/search/words-with/%E6%B0%B4?common=true")
        check("the accepted groups, unmarked", [s["id"] for s in res["senses"]] == ["水.water"] and not res["draft"]["senses"],
              (res["senses"], res["draft"]))

        print("anyone may see how much is checked")
        status, res = call("GET", "/api/review/verified")
        check("anonymous GET verified is 200", status == 200 and set(res.get("kanji", {})) == {"verified", "total"}, (status, res))

        print("no draft at all: as before")
        status, res = call("GET", "/api/search/words-with/%E7%94%9F?common=true")
        check("no groups, nothing marked", res["groups"] == [] and res["draft"] == {"senses": False, "words": 0, "extras": False},
              res["draft"])
    finally:
        srv.stop()
    return check.done()


if __name__ == "__main__":
    raise SystemExit(main())
