# BetterRTK Explorer

A kanji explorer built around one view: select a character and see what it is
made of, all the way down, and what it builds into, ordered by how common those
characters actually are — plus a dictionary, handwriting lookup, and somewhere
to write your own associations onto the components.

The research pipeline that produced `order-n2.tsv` and `FINDINGS.md` is
unchanged. The explorer is a separate front end over the same decomposition data,
and `pipeline/verify.py` asserts on every run that the two still agree.

## Running it

    python -m venv .venv
    .venv/Scripts/python -m pip install -r requirements.txt

    python pipeline/fetch_sources.py      # ~35 MB, skips what already exists
    python pipeline/build_db.py           # assembles data/betterrtk.sqlite (~165 MB)
    python pipeline/verify.py             # 32 correctness checks

    .venv/Scripts/python -m uvicorn server.app:app --port 8000 --host 0.0.0.0
    cd web && npm install && npm run dev

Then open http://localhost:5173.

On Windows set `PYTHONIOENCODING=utf-8` before any pipeline script, or the
console encoder fails on the first kanji.

The server binds `0.0.0.0` so a phone on the same network can reach it. There is
no authentication and no offline mode — keep it off untrusted networks.

## Reading the graph

The focused character sits at the centre, ringed in vermilion. Above it, in
concentric arcs, are the characters that contain it: the most frequent hug the
centre and are largest and brightest, fading and shrinking outward to the rare,
with non-jōyō characters dimmed. Below, in indigo, is its decomposition to
atoms, one row per level, the number under each component being how many jōyō
characters it appears inside.

Click any character to bring it to the centre. Backspace or the breadcrumb walks
back out. Hover one of the characters above to peek a level further up: what
contains *it* fans out around it, and a small arc on a container's outer edge
says it has anything above it at all.

## The map

**Map** (or `M`; `F` returns to the focus view) shows every character in a
scope at once, to wander around in. The level buttons pick the scope: N5 to N1
each include the parts their kanji are built from, `common` is the 2,501
newspaper-ranked characters and their parts, and `all` is the whole graph,
13,490 characters.

Characters sit near the parts they share, larger when frequent or when many
characters use them, and resolve from points into glyphs as you zoom in.
Links are drawn only for the selected character (its parts in indigo, the
characters it appears in as paper) and for the one under the pointer; a haze of
all 27k said little and cost most of every frame. Clicking a character flies to
it and makes it the focus; clicking the focus again opens it in the focus view.
`◎` or `C` recentres on the focus.

The layout is a force simulation in a Web Worker, run once per scope and kept in
`localStorage` (about 2 s for N1, 7 s for `all`). Large scopes lay out the shared
components first and then place each leaf character at a weighted centroid of
its parts, which is what makes `all` tractable at all -- a plain simulation took
40 s. Nodes are drawn from a glyph sprite atlas, so zooming does not re-rasterise
text every frame.

## What each piece does

| Area | Notes |
|---|---|
| **Search** | One box takes English, Japanese, or romaji. Returns characters *and* words. Full deinflection, so 食べたくなかった finds 食べる and shows the chain. |
| **Dictionary** | JMdict with real `nf01`–`nf48` frequency ranks, pitch accent contours, and Tatoeba examples linked by lemma rather than substring. Clicking a word opens its entry in the side panel: senses, other spellings, examples, and each kanji it is written with, any of which moves the graph there. |
| **Draw** | Stroke matching against KanjiVG, server-side. One score, from shape plus a bonus for stroke order — writing it properly sharpens the answer, writing it any other way costs nothing, and the stroke count need not be exact. Picking a result opens it in the graph. |
| **Radical picker** | KRADFILE's 253 radicals. After each pick, radicals present in no remaining candidate grey out, so you cannot build an empty result. |
| **Associations** | Text, pasted or dropped images, and in-app sketches, on both kanji and components. A character's panel pulls in your notes on each of its parts, so the mnemonic assembles itself. Autosaves to disk. |
| **Stroke order** | A static diagram from KanjiVG: one small glyph per stroke, each adding the next, so the whole order reads at a glance. |
| **Decomposition** | Fix a bad split from the graph and it redraws immediately. A review queue ranks what is worth fixing by how much a bad split actually costs. |

## Layout

    pipeline/   data acquisition and database assembly
      fetch_sources.py  downloads every source (supersedes fetch.sh)
      decomp.py         decomposition graph, shared by app and pipeline
      build_db.py       staged SQLite build (run one stage: `build_db.py graph`)
      verify.py         invariants + regression against build.py / fanout.py
      build.py          frozen research pipeline, produced order-n2.tsv
    server/     FastAPI read-only API, plus the association store
      japanese.py       romaji and deinflection
      store.py          associations and decomposition overrides on disk
    web/        React + TypeScript client
      src/graph/layout.ts   the orbit-above / DAG-below geometry, and the peek
      src/map/              the map: canvas renderer, layout worker, sprite atlas

`decomp.py` is the single source of truth for what "contains" means. It
reproduces `build.py`'s 1,370-node closure and 391-component fan-out exactly.

## Your data

Associations live in `data/associations/store.json` with images beside them —
a real folder, so they survive a cleared cache and can be committed. Every
record carries an author and provenance, and imports arrive as a separate
attributed layer rather than overwriting yours, so browsing and adopting other
people's associations later needs no migration.

Decomposition fixes are mirrored to `data/decomp_overrides.json`, which
`pipeline/decomp.py` loads as its top layer — so a rebuild keeps them.

## Data sources

All redistributable, all but three share-alike, so the data layer is CC BY-SA
4.0 and the app carries a credits panel. KANJIDIC2's SKIP codes are
CC BY-**NC**-SA unlike the rest of that file and are stripped during the build.

| Source | Gives | Licence |
|---|---|---|
| cjk-decomp (via topokanji) | containment structure | — |
| davidluzgouveia/kanji-data | JLPT, frequency, grade, strokes | KANJIDIC-derived |
| JMdict_e, KRADFILE (EDRDG) | words, character data, radicals | CC BY-SA 4.0 |
| KanjiVG | stroke order, and the handwriting reference | CC BY-SA 3.0 |
| kanjium | pitch accent | CC BY-SA 4.0 |
| Tatoeba | example sentences | CC BY 2.0 FR |
| Kanji Alive | curated meanings | CC BY 4.0 |

Deliberately excluded: WaniKani mnemonics, Heisig keywords, and jpdb data — all
closed, and any of them would end the option of open-sourcing this.

## Not built yet

Stroke-order *animation* (the static diagram is built), phonetic-series
display, component role labels (semantic / phonetic / form), the BetterRTK study
order as a browsable view, offline mode, and association discovery.

KANJIDIC2 is downloaded but no build stage reads it yet: meanings come from
`kanji.json`, which is already KANJIDIC-derived. KANJIDIC2 would add nanori,
Kangxi radical numbers and go-on/kan-on tagging when something needs them.
