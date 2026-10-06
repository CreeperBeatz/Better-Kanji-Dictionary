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

The rules (the reviewers' handbook):

- **Each part must do a job in this character**: give meaning, give the
  sound, or be a kanji written in its form for that position (氵 is 水,
  亻 is 人). A data source that cuts the drawing into stroke groups is
  describing the drawing, not the character.
- **A lookalike is not a part.** 午 visibly contains 干, but 午 is a pestle
  and 干 a shield: 干 does nothing in 午. If no smaller piece does a job,
  the character is **atomic** (no parts) — that is fine and common for
  pictographs: 日 (a picture of the sun), 午, 牛, 車, 斤 are atomic.
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
data issue); `ids` (BabelStone IDS: ⿰ left-right, ⿱ top-bottom, …),
`kanjivg` (its component groups), `kradfile` (radicals it contains, a lookup
aid that lists every shape, not a decomposition), `old` and `oldIds`.

A flag is a reason to look, not a verdict. 林 = 木 is flagged "one part
only" and is fine (a repeat); 三 = 二 is flagged the same way and is wrong
(three strokes, atomic). Most characters have no flag at all: they are on a
card because a source split them differently. Decide each one.

## Output

```json
{
  "batch": "<the input's batch>",
  "chars": [
    {"char": "日", "verdict": "change", "parts": [],
     "why": "A picture of the sun (oracle bone: a circle with a dot); 口 is a lookalike and gives 日 no meaning or sound. Atomic.",
     "lookalikes": ["口"], "confidence": 0.95},
    {"char": "海", "verdict": "keep", "parts": ["氵", "毎"],
     "why": "氵 (water) gives the meaning, 毎 (old form 每) gives the sound カイ←マイ.",
     "confidence": 0.9},
    {"char": "上", "verdict": "change", "parts": [],
     "why": "A mark above a line (指事); 卜 (divination) is a lookalike that does nothing in it. Atomic.",
     "lookalikes": ["卜"], "confidence": 0.85}
  ]
}
```

- `verdict`: `keep` when `parts` equals `current` exactly (same characters,
  same order), else `change`.
- `parts`: your answer in writing order; `[]` for atomic.
- `why`: the proof, 1–2 sentences, at most 400 characters. Say what each
  part does in the character (meaning, sound, or which kanji it is written
  for), and cite the old form or the character's origin when it decides the
  matter. For a change, say what is wrong with today's parts. Plain English;
  a reviewer reads it in a few seconds.
- `lookalikes`: parts of today's split (or a proposal's) that only look like
  a piece of the character, if any. The reviewer can file them under
  "similar".
- `confidence`: 0.0 to 1.0, honest. Below 0.6 when you are guessing; the
  reviewer reads those first.

Answer every character in the batch exactly once. Reply with one line: how
many keep and change, and what you were unsure about.
