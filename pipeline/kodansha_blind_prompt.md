# Grade two kanji dictionary entries, blind

You get a batch file with about 10 kanji. Each kanji has two entries, **X** and
**Y**, from two different learner's dictionaries. Both are put in the same plain
shape: readings, meanings, and under each meaning some words that use the kanji
in that meaning (written form and reading; no glosses). Word lists are cut to
about 8 words a meaning, so a word missing from a list is not an error by itself.

Do not try to guess which dictionary is which. Judge only what is on the page.

## The reader

An English speaker learning Japanese, aiming at JLPT N2, who opens the entry to
learn what the kanji means in the words they will meet, and which words show
each meaning. Common, modern usage matters most. Rare and classical senses are
fine when they are marked as rare or are real; they are not required.

## What to check, for each entry

1. **Meanings.** Is each meaning a real meaning of this kanji in Japanese? Is a
   meaning that a learner needs for common words missing? Are two meanings the
   same idea split for no reason, or two different ideas merged under one label
   so the learner can't tell them apart? Is a label misleading?
2. **Words under meanings.** Does each word really use the kanji in the meaning it
   is listed under? A word under the wrong meaning is the most important error.
   A word that does not contain the kanji, or has a wrong reading, is an error.
3. **Example choice.** Are the examples words a learner meets, or obscure ones
   when common ones exist?
4. **Readings.** Are the on and kun readings right? A missing common reading is
   an error; an extra rare reading is not.

Grade each problem:

- **major**: teaches the learner something false (a word under a meaning it does
  not have, a meaning the kanji does not have, a wrong reading), or leaves out a
  meaning needed for common words (N2 level or common in general).
- **minor**: does not mislead, but could be better: a vague or overlong label, a
  needless split, an obscure example where a common one exists, a common word
  missing from a short list, a rare reading listed as if common.

Be concrete: name the word or the meaning. Do not count the same problem twice.
Judge both entries with the same strictness. Use your own knowledge of Japanese;
check yourself on any word you are unsure of before calling it wrong.

Then score each entry 1-5:

- **coverage**: are the meanings a learner needs all there, with good examples?
- **clarity**: can a learner tell the meanings apart and see which word shows which?

And say which entry would teach the reader the kanji better: `X`, `Y` or `tie`,
in one sentence why. Different style alone (long labels, short labels, more or
fewer meanings) is not a reason: errors and usefulness are.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape:

```json
{"batch": "kb-000", "kanji": [
 {"char": "雅",
  "X": {"errors": [{"severity": "major", "kind": "misplaced-word", "item": "風雅", "what": "listed under 'honorific prefix'; it means elegance"}],
        "coverage": 4, "clarity": 3},
  "Y": {"errors": [], "coverage": 3, "clarity": 5},
  "better": "Y", "why": "..."}
]}
```

`kind` is one of: `misplaced-word` (word under the wrong meaning),
`wrong-meaning` (a meaning the kanji does not have, or a wrong label),
`missing-meaning`, `merged-meanings`, `needless-split`, `bad-example`
(obscure or not using the kanji), `missing-word`, `reading`, `other`.

Every kanji in the batch must be in the output, in the batch's order.
