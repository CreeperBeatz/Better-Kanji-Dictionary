# Drafting form links (instructions for one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). A human reviewer checks everything;
nothing goes live without them. Write a careful first draft. Judge each item
yourself: do not write or run code or rules to decide them. Write exactly
one output file, to the path you are given; edit nothing else.

The principle: **the modern shape decides what a kanji contains; the old
shape tells the story.** A form link never changes what contains what. It
explains a part.

## The kinds

- `form_of` — the part X **is** the kanji Y, written differently for its
  position: 亻 is 人, 氵 is 水, 龶 is 生 (plain in the old form 靑 of 青).
  **Needs evidence** in `note`: an old form where Y appears in X's place
  (cite it: "靑, the old form of 青"), or a standard reference (Kangxi
  radical, Shuowen). At most one `form_of` per part. If you cannot point to
  evidence, do not propose `form_of`.
- `looks_like` — a popular **mnemonic** lookalike: 龶 looks like 王. Not
  etymology, and always shown as a mnemonic. Propose one only if learners
  really do read it that way and it helps; do not propose lookalikes that
  point at a semantically wrong kanji the learner will meet anyway, in a way
  that would mislead.
- `old` — Y is the **Japanese pre-1946 (kyūjitai)** form of X: 売 → 賣.
  Only the Japanese old form, not a Chinese traditional character that
  Japan never used as X's old form.
- `positional` — X and Y are the same component written for different
  positions (水 氵, 心 忄).
- `none` — no link worth showing a Japanese learner: Chinese simplified
  forms (业 for 業), rare graphic variants, numerals' financial forms
  (壹 for 一), unrelated characters.

## Input

- `parts`: bound parts with no meaning of their own. For each: the part,
  KANJIDIC's line if any, kanji that contain it, and those kanji's old forms
  and IDS where known. Propose a `form_of` (with evidence) and/or a
  `looks_like`, or nothing.
- `pairs`: Unihan variant pairs `[X, Y]`, with each character's meanings
  and the Unihan field that links them. Give the kind from X to Y, or `none`.

## Output

```json
{
  "batch": "<the input's batch>",
  "links": [
    {"subject": "龶|生", "kind": "form_of", "note": "plain in 靑, the old form of 青", "confidence": 0.9},
    {"subject": "龶|王", "kind": "looks_like", "note": "often called king; it is really 生", "confidence": 0.8},
    {"subject": "业|業", "kind": "none", "note": "Chinese simplified form", "confidence": 0.9}
  ]
}
```

- `subject` is `X|Y`: for `parts`, X is the part; for `pairs`, keep the
  pair's order.
- Every pair must get exactly one entry (its kind, or `none`). Parts may get
  zero, one or two entries.
- `note`: one short English sentence a learner can read; for `form_of` it
  is the evidence.
- `confidence` 0.0 to 1.0, honest.

Reply with one line: how many links you wrote and what you were unsure about.
