# Drafting meaning groups for kanji (instructions for one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). A human reviewer will check
everything you write; nothing goes live without them. Your job is a careful
first draft. You do not need to browse the web or read any other files.

You get one input file (JSON). Write exactly one output file (JSON) to the
path you are given. Do not edit any other file.

**Judge every word yourself.** Do not write or run code, scripts or
keyword rules to place words or to set confidences: a rule like "every word
with 曜 goes to sun" is exactly the shortcut this data must not contain, and
flat confidences (0.93 on everything) make the confidence useless. Reading
the input, thinking, and writing the output file are the only steps. (Running
the checker command you are given, at the end, is fine.)

## The two kinds of batch

- **Run A** (`"run": "A"` in the input): for each kanji, draft its meaning
  groups (`senses`) **and** place every listed word in one of them.
- **Run B** (`"run": "B"`): the groups are given (`senses` in the input);
  only place every listed word. Do not change the groups.

## Meaning groups (run A)

The question: *what are the 1 to 6 meanings this kanji carries in modern
Japanese words?*

- Groups are defined by **what the kanji contributes inside words**, not by
  English dictionary senses. 青 is blue / green / young-unripe (青二才): the
  English "blue" and "green" are one Japanese colour meaning, "unripe" is
  another.
- 1 to 6 groups; **most kanji need 2 to 4**. A kanji with one meaning in
  modern Japanese (楓 maple) gets **one** group: never add a second group to
  fill a quota -- a name use, a variant spelling or a near-synonym of the
  first is not a meaning of its own. Five or six only for a kanji
  with a hundred or more words that really splits that many ways. **Merge**
  any group that would not get at least two of the listed common words, and
  any group that is one word's gloss rather than a meaning of the kanji
  (板 "pitcher's mound" is a use of "board", not a meaning). Fewer, sharper
  groups beat many thin ones.
- Each group: `id` (short, lowercase a-z, 0-9 and -, e.g. `life`, `raw`,
  `student`; unique within the kanji), `en` (1 to 4 words, e.g. "life, birth"),
  `bg` (the same label in Bulgarian, natural and short, e.g. "живот, раждане";
  the characters themselves are «канджи», never «кандзи»),
  and optionally `note` (one short sentence, only if the label alone would be
  misread).
- Order the groups from most to least common in the listed words.
- The **catch-all** group `catch-all` always exists and is never listed in
  `senses`: it is for words where the kanji is used **for its sound or as a
  fixed spelling** (ateji like 寿司, 生憎, 亜米利加, 珈琲; place and personal
  names whose meaning is not felt). Use it only when the kanji's meaning
  really is not present.
- The `kanjidic` and `curated` lines in the input are hints. Do not copy
  KANJIDIC's glosses as groups: they are too coarse, and sometimes polluted
  (合 "Fit; Suit; Join; 0.1").

## Placing words (runs A and B)

For **every** word listed under a kanji, pick the group the kanji is using
**in that word**.

- Judge by **what this kanji contributes to the word**, not by what the
  word means overall. In 先生 the 生 is "born, live" (one born before
  you), not "teacher". In 生ビール 生 is "raw / fresh", not "beer".
- A word may hold the same kanji in two meanings only rarely; pick the one
  that best explains the word.
- When the kanji is there for sound or as a fixed spelling, use
  `catch-all`. **Do not force** a word into a meaning group: a wrong group
  teaches the learner something false. If unsure between a group and
  catch-all, give your best pick with a low confidence.
- `confidence` is how sure you are, 0.0 to 1.0. Be honest: 0.95 for
  clear-cut cases (生活 → life), 0.6 when two groups are plausible, 0.4 or
  less when you are guessing. Over-confidence is the worst error here,
  because high-confidence picks that agree across runs may be accepted
  without a person looking.

## Output format

Exactly this shape (no comments, no trailing commas, UTF-8):

```json
{
  "batch": "<the input's batch>",
  "run": "<A or B, as in the input>",
  "kanji": {
    "生": {
      "senses": [
        {"id": "life", "en": "life, birth", "bg": "живот, раждане"},
        {"id": "raw", "en": "raw, fresh", "bg": "суров, свеж", "note": "uncooked or unprocessed"},
        {"id": "student", "en": "student", "bg": "ученик"}
      ],
      "words": {
        "1366080": {"sense": "life", "confidence": 0.95},
        "1366090": {"sense": "catch-all", "confidence": 0.8}
      }
    }
  }
}
```

- In run B, leave `senses` out.
- `words` keys are the word ids from the input, as strings. Every listed
  word id must appear exactly once. No other ids.
- `sense` is one of the kanji's group ids (yours in run A, the given ones
  in run B) or `catch-all`.
- Every kanji in the input must appear in `kanji`.

Before writing, check your output against these rules. Then write the file
with your file-writing tool, and reply with one line: how many kanji and
words you wrote, and anything you were unsure about.
