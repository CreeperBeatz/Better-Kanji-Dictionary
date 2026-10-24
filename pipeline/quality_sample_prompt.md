# Grading a sample of dictionary data

You grade a random sample of data shown to learners of Japanese (English and
Bulgarian speakers, aiming at JLPT N2) in a kanji and word dictionary. You
do not fix anything: you measure. Grade each item as it is, strictly and
fairly, with your own knowledge of Japanese. Do not write code to judge.

Read `data/drafts/quality-sample/in/<BATCH>.json`, write
`data/drafts/quality-sample/out/<BATCH>.json`. The input's `dataset` says
which kind of items it holds.

## Grades

For each part of an item: `ok`, `minor` or `major`.
- `ok`: right, and useful as it is.
- `minor`: could be better, but does not mislead: clumsy or vague wording,
  a weak or slightly long example, a debatable judgement call, a small
  omission.
- `major`: wrong, or would mislead a learner: a false claim, the wrong
  sense, a wrong reading or word, an example that does not show the sense
  or is unnatural Japanese, a wrong translation, a rank that clearly puts a
  core meaning as rare or a rare one as main, a pair that is not a synonym
  (or antonym, or mix-up) at all, broken Bulgarian.
Grade what you are sure of. Where usage is genuinely debatable, that is
`minor` at most.

## dataset "notes": a note under one sense of a word

Item: the word, its reading, `jlpt` level, all its `senses` (JMdict), the
`sense` number the note is for, and the `note`: `rank` (main = a meaning to
learn the word by; secondary = met regularly, after the main ones; rare =
specialist, archaic or barely seen), `nuance` (one sentence: where and how
the word is used in this sense, its register, what it stresses), `ex` (a
short sentence with the word in 【】 and its translation; `src` t = from the
Tatoeba corpus, d = written for the dictionary; null = none).
Parts: `rank`, `nuance`, `ex`. `ex` null is `ok` for a rare sense; for a
main sense it is `minor`.

## dataset "kanji": a line on a kanji's page

`kind` "similar": `kanji` in one `meaning`, and `other`, a kanji listed
beside it as close in meaning; the line says how `other` differs from
`kanji` in this meaning (`otherMeaning` is the pipeline's guess at which
meaning of `other` that is; judge the line on what is true of `other`).
`kind` "mixup": kanji `a` and `b` share the kun reading `reading`; the line
says when to write which.
Parts: `en` (the English line) and `bg` (the Bulgarian line: it must say the
same as the English, in natural Bulgarian; Japanese kanji are «канджи», a
neuter word). A line about a pair that does not belong together is `major`.

## dataset "synonyms": a pair under one sense of a word

`kind` synonym, antonym or mixup (two words read the same, easy to confuse);
`word` and `other`, each with all senses and the `sense` the pair is for;
`line`: for a synonym, how `other` differs from the word; for a mixup, when
to write `other`. Antonyms have no line.
Parts: `pair` (is it a real synonym in this sense, usable in place of the
word in some common sentences / the plain opposite / a real mix-up? Not a
broader or narrower word, not a short or polite form of the same word) and
`line` (true and useful; not for antonyms).

## datasets "mirrored", "mixup", "belowbar"

Graded exactly as "synonyms". In "belowbar" the `other` word may have no
`sense`: grade the pair `ok` if one of its senses makes it right, and judge
the line against that sense.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": {"rank": "ok", "nuance": "ok", "ex": "ok"},
  "<key>": {"rank": "ok", "nuance": "major", "ex": "minor", "issue": "nuance: it is not formal; ex: long"}
}}
```

Every key once, every part graded; `issue` (a few words per part graded
below ok) whenever a part is not ok.

## Work

Read the whole file first. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/quality_sample.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts of items with a major part, with only minor parts, and all ok.
