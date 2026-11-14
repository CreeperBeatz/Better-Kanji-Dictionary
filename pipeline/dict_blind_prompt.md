# Grade five kanji dictionary entries, blind, with research

You get a batch file with 5 kanji. Each kanji has five entries, **A** to **E**,
from five different kanji dictionaries. All five are put in the same plain shape:
readings, meanings, and under each meaning the words the dictionary lists for it
(written form, reading, and a short gloss when the dictionary gives one). Prose
notes are left out of every entry. Word lists are cut to 8 words a meaning, so a
word missing from a long list is not an error by itself. Some dictionaries list no
words at all; that is real, not a cut.

Do not try to find out which dictionary is which. Judge only what is on the page.
The letters are shuffled per kanji.

Entries can be in English or in Bulgarian, and readings in kana or in romaji
(capitals or lower case). Language and notation are not graded: assume the reader
reads the entry's language. A Bulgarian gloss is judged by whether it is right,
like an English one.

## The reader

A learner of Japanese, aiming at JLPT N2, who opens the entry to learn what the
kanji means in the words they will meet, how it is read, and which words show each
meaning. Common, modern usage matters most. Rare and classical senses and
readings are fine when they are real; they are not required.

## Step 1: research the kanji first

For each kanji, before you score, build your own reference from real Japanese
dictionaries on the web. Read at least two sources per kanji:

- **kanjipedia.jp** (漢字ペディア): the kanji's meanings (意味) and its jōyō readings.
  Search there or use `https://www.kanjipedia.jp/` search; this one is required.
- **kotobank.jp** (デジタル大辞泉, 精選版 日本国語大辞典, 漢字の字通/普及版 字通 where shown),
  **dictionary.goo.ne.jp** (goo 漢字辞典), **weblio.jp** (漢字辞典, 国語辞典, 英和/和英).
- The 文化庁 常用漢字表 for the jōyō readings, when in doubt.

Do **not** open jisho.org, wiktionary.org, edrdg.org / KANJIDIC, betterkanjidictionary.org,
kanshudo, tangorin, wanikani, or any page that copies them. Some of the entries come
from those sites; using them would make one entry the answer key. If a search result
leads there, skip it.

Your reference, per kanji: the meanings a learner needs (mark each common or rare),
the on and kun readings (mark jōyō ones), and 2-4 common words that show each common
meaning. Write it down in the output (`reference`) with the URLs you read.

Then check any word, gloss or reading in the entries you are not sure of: look the
word up (kotobank, goo, weblio). Do not call something wrong from memory alone when
you can look it up.

## Step 2: find the errors in each entry

1. **Meanings.** Is each meaning a real meaning of this kanji in Japanese (not only
   in Chinese)? Is a meaning that common words need missing? Is a label vague,
   misleading, or wrong? Are two different ideas merged so a learner can't tell them
   apart, or one idea split for no reason?
2. **Words.** Does each word use the kanji in the meaning it is listed under? A word
   under the wrong meaning is the most important error. A word that does not contain
   the kanji, a wrong reading, or a wrong gloss is an error.
3. **Readings.** Are the on and kun readings right? A missing common (jōyō) reading is
   an error; an extra rare reading is not, unless it is false.

Grade each problem:

- **major**: teaches something false (a meaning the kanji does not have, a word under
  a meaning it does not have, a wrong reading, a wrong gloss), or leaves out a meaning
  or reading that common words need.
- **minor**: does not mislead, but could be better: a vague label, a needless split,
  an obscure example where a common one exists, a gloss that is loose but not wrong,
  a secondary reading or meaning missing.

Be concrete: name the word, meaning or reading. Count each problem once. Use the
same strictness for all five entries.

## Step 3: score each entry 1-10

Score each dimension on its own. Use the whole scale. The anchors:

- **correctness**: is everything stated true?
  10 nothing false · 8 one minor slip · 6 several minor slips or one major error ·
  4 two or three major errors · 2 mostly false.
- **precision**: are labels sharp, glosses exact, and words placed under the right
  meaning? 10 every label pins the sense and every word sits clearly where it is ·
  7 a few loose labels or debatable placements · 5 labels broad or vague (a learner
  can't tell what the kanji does in a word) · 3 one blurred catch-all · 1 nothing
  usable. An entry with a single one-word keyword is judged on whether that word is
  exact for the kanji's main use.
- **completeness**: against your reference, how full is it?
  10 every common meaning and every jōyō reading, each meaning with words ·
  8 a rare-ish meaning or secondary reading missing · 6 one common meaning or reading
  missing, or meanings with no words · 4 only the main meaning · 2 almost nothing.
- **examples**: are the words common, correct, and do they show each meaning and the
  main readings? 10 the words a learner meets, for every meaning and reading ·
  7 good but thin or one obscure pick · 5 a few words, some obscure or uncovered
  meanings · 3 one or two words only · 1 no words.
- **clarity**: can the learner tell the meanings apart and see which word shows which?
  10 clear at a glance · 5 a flat list to untangle · 1 confusing or contradictory.
- **overall**: how well does this entry teach the kanji to the reader? Your own
  judgement, not the average of the others.

Then rank the five entries, best first. Ties are not allowed in the ranking; break
them by fewer major errors, then by usefulness to the reader.

Different style alone (long or short labels, more or fewer meanings, romaji, Bulgarian)
is not a reason for a score: errors, precision, fullness and usefulness are.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape, every kanji in the
batch's order, every letter A-E:

```json
{"batch": "db-000", "kanji": [
 {"char": "協",
  "reference": {"meanings": [{"meaning": "cooperate, work together", "common": true, "words": ["協力", "協調"]}],
                "on": ["キョウ (jōyō)"], "kun": [],
                "sources": ["https://www.kanjipedia.jp/kanji/...", "https://kotobank.jp/word/..."]},
  "entries": {
    "A": {"errors": [{"severity": "major", "kind": "misplaced-word", "item": "協和", "what": "listed under X; it means Y"}],
          "scores": {"correctness": 7, "precision": 8, "completeness": 9, "examples": 9, "clarity": 8, "overall": 8},
          "note": "one sentence: the main strength or weakness"},
    "B": {...}, "C": {...}, "D": {...}, "E": {...}},
  "ranking": ["A", "E", "C", "B", "D"],
  "why": "one or two sentences on the ranking"}
]}
```

`kind` is one of: `misplaced-word`, `wrong-meaning`, `missing-meaning`,
`merged-meanings`, `needless-split`, `bad-example`, `wrong-gloss`, `missing-word`,
`reading`, `missing-reading`, `other`.
