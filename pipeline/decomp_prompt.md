# Drafting a character's parts (instructions for one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). A human reviewer checks everything;
nothing goes live without them. Your draft is shown on the reviewer's card
next to today's parts, with your proof, so the proof matters as much as the
answer. Judge each character yourself: do not write or run code or rules to
decide them. Write exactly one output file, to the path you are given; edit
nothing else.

## What "parts" means here

The parts of a character are the pieces it is **built from, as written
today**. They drive a study order: a kanji is never taught before one of its
parts. So a wrong part costs the learner: if 日 had 口 as a part, all 382
common kanji with 日 would wait for 口 and tell the learner the sun is a
mouth.

The rules (the reviewers' handbook; the dictionary owner's rule, D-018):

- **A base kanji stays whole.** A pictograph a learner meets as one piece
  (日 木 土 田 大 王 白 止 糸 用 西 示) has no parts, even when its drawing
  contains smaller shapes: 日 is not 口, 木 is not 八 + 十. Splitting it
  helps nobody and is not what the sources say.
- **The standard split first.** There is no official Japanese standard, so
  the open sources stand in for one: KanjiVG, then IDS, then Цалта's kanji
  book (`kanjivg`, `ids`, `tsalta` in the input; `[]` = it keeps the
  character whole). Where they agree on today's shape, take that split
  (春 = 𡗗 + 日, not 三 + 人 + 日). Use the old form or the history only
  where they disagree or give nothing.
- **An easy-to-remember split is not a part.** A memorable but unofficial
  split (春 as 三 人 日) belongs in a learner's note, not in the parts.
- **A lookalike is not a part.** 午 visibly contains 干, but 午 is a pestle
  and 干 a shield, and no source splits 午 that way: 午 is whole. Do not
  make a mid-level kanji whole only because you cannot say what a piece
  does in it: if the sources split it, keep their split.
- **Nothing may be lost.** A split must account for the whole shape: 皮 is
  not just 又, and 段 is not just 殳. If the rest is not a real part, either
  name the part it is (when one exists in the graph) or make the character
  atomic.
- **Bare strokes** (一 丨 丶 丿 乙 亅) are parts only when they mean
  something in the character: 主 is 丶 (the flame) over 王 (the lampstand).
  A stroke there only because the drawing has it is not a part.
- **Judge by today's shape.** 青 contains 月 even though the old form 靑 had
  丹 there. The old form is evidence for the story (cite it in `why`), and
  breaks a tie when today's strokes can be grouped two ways (従: 彳 䒑 龰,
  as 從 groups them). It never adds a part that is no longer visible.
- **Repeats collapse**: 品 is 口 once, 林 is 木 once. That is by design;
  do not flag it.
- **Bound forms**: a bound shape that still looks like its kanji (⺤ for 爪,
  ⺮ for 竹) has that kanji as its part; one that no longer looks like it
  (亻 氵 忄 罒) has none (atomic).
- Parts must be characters the dictionary knows: prefer the ones in
  `current`, `proposals`, `kradfile` and the examples' parts. Write each part
  as one character. Do not invent unencoded pieces.

## Input

Each character has: `strokes`; `meaning`; `inScope`, how many common or
JLPT-rated kanji contain it (the cost of a mistake); `examples`; `current`,
today's parts with their meanings and strokes; `proposals`, other sources'
splits waiting for review; `flags`, what a rule found suspicious (one part
only, strokes unaccounted for, a bare stroke, no source splits it, a known
data issue, a source keeping it whole, fewer than two sources splitting
it as we do); `ids` (BabelStone IDS: ⿰ left-right, ⿱ top-bottom, …),
`kanjivg` (its component groups), `tsalta` (Цалта's split; `[]` = whole), `kradfile` (radicals it contains, a lookup
aid that lists every shape, not a decomposition), `old` and `oldIds`.

A flag is a reason to look, not a verdict. 林 = 木 is flagged "one part
only" and is fine (a repeat); 三 = 二 is flagged the same way and is wrong
(three strokes, atomic). In this pass every character is flagged: most because only one
source (or none) splits it as we do. Often the split is still right; say
which sources give it. Decide each one.

## Output

```json
{
  "batch": "<the input's batch>",
  "chars": [
    {"char": "日", "verdict": "change", "parts": [],
     "why": "A base kanji: a picture of the sun (oracle bone: a circle with a dot). KanjiVG and Цалта keep it whole; 口 is a lookalike.",
     "lookalikes": ["口"], "confidence": 0.95},
    {"char": "海", "verdict": "keep", "parts": ["氵", "毎"],
     "why": "KanjiVG and IDS both give 氵 + 毎 (old form 每).",
     "confidence": 0.9},
    {"char": "上", "verdict": "change", "parts": [],
     "why": "A base kanji: a mark above a line (指事). KanjiVG keeps it whole; 卜 is a lookalike.",
     "lookalikes": ["卜"], "confidence": 0.85}
  ]
}
```

- `verdict`: `keep` when `parts` equals `current` exactly (same characters,
  same order), else `change`.
- `parts`: your answer in writing order; `[]` for atomic.
- `why`: the proof, 1–2 sentences, at most 400 characters. Say which
  sources give your split (or that it is a base kanji), and cite the old
  form or the character's origin when it decides the matter. For a change, say what is wrong with today's parts. Plain English;
  a reviewer reads it in a few seconds.
- `lookalikes`: parts of today's split (or a proposal's) that only look like
  a piece of the character, if any. The reviewer can file them under
  "similar".
- `confidence`: 0.0 to 1.0, honest. Below 0.6 when you are guessing; the
  reviewer reads those first.

Answer every character in the batch exactly once. Reply with one line: how
many keep and change, and what you were unsure about.
