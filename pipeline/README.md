# BetterRTK ordering pipeline

Generates a study order over the JLPT N5–N2 kanji in which **no kanji ever appears
before a kanji or component it visually contains**.

## Run

    sh fetch.sh                 # download source data (see ../FINDINGS.md for provenance)
    PYTHONIOENCODING=utf-8 python build.py    # parse decomposition -> graph.json
    PYTHONIOENCODING=utf-8 python fanout.py   # component fan-out  -> fanout.json
    PYTHONIOENCODING=utf-8 python order.py    # topological sort   -> orders.json
    PYTHONIOENCODING=utf-8 python final.py    # writes ../order-n2.tsv
    PYTHONIOENCODING=utf-8 python phon3.py    # phonetic-series analysis (optional)

`PYTHONIOENCODING=utf-8` is required on Windows; the default cp1252 console
encoding cannot print kanji and the scripts will crash.

## Scripts

| file | does |
|---|---|
| `build.py`  | parses cjk-decomp + overrides, walks the N5–N2 closure, writes `graph.json` |
| `fanout.py` | how many target kanji each component appears inside; writes `fanout.json` |
| `order.py`  | inlines fan-out-1 components, runs 3 ordering policies, prints learning curves |
| `phon3.py`  | detects phonetic series and measures on'yomi predictability |
| `final.py`  | phonetic analysis with semantic radicals excluded; emits `../order-n2.tsv` |

## Output

`../order-n2.tsv` — 1,191 rows: `idx, char, level (N5–N2 / N1 / COMP), meanings, on_yomi, fanout`.
