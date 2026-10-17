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


def words_of(char: str, n: int = 7) -> list[int]:
    from server.db import query
    return [r["id"] for r in query(
        "SELECT w.id FROM word_char wc JOIN word w ON w.id = wc.word_id "
        "WHERE wc.char = ? AND instr(w.headword, ?) > 0 AND w.common = 1 ORDER BY w.nf IS NULL, w.nf, w.id LIMIT ?",
        (char, char, n))]


def placement(char: str, wid: int, sense: str, confidence: float, agree: bool = True, **more) -> dict:
    return {"type": "word_sense", "subject": f"{char}|{wid}", "proposed": sense, "source": "ai:claude-sonnet",
            "evidence": {"confidence": confidence, "agree": agree, **more}}


def card_words(page: dict, group: str) -> dict[int, dict]:
    m = next((m for m in page["meanings"] if m["id"] == group), None) or {}
    ws = [*((m.get("kun") or {}).get("words") or []), *(x for o in m.get("on") or [] for x in o["words"]),
          *(x for o in m.get("also") or [] for x in o["words"])]
    return {x["id"]: x for x in ws}


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
            # Sure, and in another group too, by its second sense (D-025: 焼く is "burn" and "bake").
            placement("水", w[4], "水.water", 0.9, also=["水.wednesday", "水.nope", "水.water"], at={"水.wednesday": 1}),
            # Placed sense by sense, checked by the skeptic: shows from 0.7. The old kind does not.
            placement("水", w[5], "水.water", 0.75, method="senses"),
        ])

        print("nothing reviewed: the drafts show, marked")
        status, res = call("GET", "/api/search/words-with/%E6%B0%B4?common=true")
        check("200", status == 200, status)
        check("the drafted groups show", [s["id"] for s in res["senses"] or []] == ["水.water", "水.wednesday"], res["senses"])
        check("marked as a draft", res["draft"] == {"senses": True, "words": 3, "extras": True}, res["draft"])
        placed = {x["id"] for g in res["groups"] for x in g["words"]}
        check("only the sure words are placed; a sense-by-sense draft from 0.7", placed == {w[0], w[4], w[5]}, placed)
        wed = {x["id"]: x for g in res["groups"] if g["id"] == "水.wednesday" for x in g["words"]}
        check("a word shows under its other group too", w[4] in wed, list(wed))
        check("there, with the sense that has it and its main group",
              wed.get(w[4], {}).get("senseAt") == 1 and (wed.get(w[4], {}).get("alsoOf") or {}).get("id") == "水.water",
              wed.get(w[4]))
        mine = [x for g in res["groups"] if g["id"] == "水.water" for x in g["words"] if x["id"] == w[4]]
        check("under its main group, plain", len(mine) == 1 and "alsoOf" not in mine[0] and "senseAt" not in mine[0], mine)
        check("a group the kanji lacks, and its main group, are not extras",
              review.site_meanings("水")["also"].get(w[4]) == ["水.wednesday"], review.site_meanings("水")["also"])
        status, page = call("GET", "/api/search/kanji-page/%E6%B0%B4")
        if page["meanings"] and card_words(page, "水.water"):  # a database with the readings stage
            check("the kanji page lists it under both", w[4] in card_words(page, "水.water") and w[4] in card_words(page, "水.wednesday"))
            check("with the sense on the other one", card_words(page, "水.wednesday").get(w[4], {}).get("senseAt") == 1)
        check("the unsure ones wait, ungrouped", {w[1], w[2], w[3]} <= {x["id"] for x in res["rest"]["words"]})
        check("the drafted extras show", (res["extras"] or {}).get("link") == "Water first.", res["extras"])

        print("a reviewed kanji shows only what was accepted, plus sure drafted words in its groups")
        item = next(i for i in review._read()["items"].values() if i["type"] == "kanji_senses" and i["subject"] == "水")
        review.decide(item["id"], "edit", "u-test", [groups[0]])
        status, res = call("GET", "/api/search/words-with/%E6%B0%B4?common=true")
        check("the accepted groups, unmarked", [s["id"] for s in res["senses"]] == ["水.water"] and not res["draft"]["senses"],
              (res["senses"], res["draft"]))
        check("a drafted word keeps no extra group the kanji no longer has",
              w[4] in review.site_meanings("水")["placed"] and w[4] not in review.site_meanings("水")["also"],
              review.site_meanings("水")["also"])

        print("groups accepted as drafted: a sure word goes live with its extra groups")
        f = words_of("木", 2)
        tree = [{"id": "木.tree", "en": "tree"}, {"id": "木.thursday", "en": "Thursday"}]
        review.add_items([
            {"type": "kanji_senses", "subject": "木", "proposed": tree, "source": "ai:claude-sonnet"},
            placement("木", f[0], "木.tree", 0.9, runs=[{"run": "A", "sense": "木.tree", "confidence": 0.9},
                                                       {"run": "B", "sense": "木.tree", "confidence": 0.9}],
                      also=["木.thursday"], at={"木.thursday": 2}),
        ])
        item = next(i for i in review._read()["items"].values() if i["type"] == "kanji_senses" and i["subject"] == "木")
        review.decide(item["id"], "accept", "u-test", tree)
        live = review._read()["live"]["word_sense"].get(f"木|{f[0]}") or {}
        check("its extra groups and their senses come with it",
              live.get("also") == ["木.thursday"] and live.get("at") == {"木.thursday": 2}, live)
        review.direct("kanji_senses", "木", [tree[0], {"id": "木.thursday", "en": "Thursday, day"}], "u-test")
        live = review._read()["live"]["word_sense"].get(f"木|{f[0]}") or {}
        check("a changed group: the word keeps its main group and loses that extra",
              live.get("sense") == "木.tree" and "also" not in live, live)

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
