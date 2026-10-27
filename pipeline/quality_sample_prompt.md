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

## dataset "kinds"

A pair of words and the kind the dictionary now gives it. Kinds:
- `ant`: the plain opposite (勝つ / 負ける).
- `pair`: two words that clearly go together but are not opposites: the two
  sexes (祖父 / 祖母), two halves of one system (級 / 段), two ends (前提 /
  結論), members of a short series. If a learner would call them opposites
  without a second thought, `pair` is `minor` at most (debatable), not major.
- `polite`: two separate words for one act or thing, in different registers
  (仰る / 言う); `register` gives each one's register.
- `mix`: two words a learner mixes up by meaning, one English word for both
  (近代 / 現代); `line` (when to use `other`) and `reverse` (when to use the
  word) are graded together as the part `line`.
- `short`: one is a short form of the other (ＣＭ / コマーシャル); `full`
  says which is the long one. `older`: one is an old or rare variant of the
  other (メーター / メートル); `full` says which is standard today.
- `removed: not an opposite`: the dictionary showed them as opposites and
  now shows nothing.
Parts: `kind` (is this kind, with its register / full / senses, right?) and
`line` (only for `mix`). A kind that is plainly wrong (a real opposite
removed, a short form that is a different word, a wrong register) is
`major`.

## dataset "freed"

Graded as "kinds", for word pairs that share an English gloss and that the
dictionary had never shown. Two more kinds:
- `syn`: a synonym: a learner can use `other` in place of the word, in this
  sense, in some common sentences, with nearly the same meaning; `line`
  (how `other` differs) and `reverse` (how the word differs) are graded
  together as the part `line`.
- `left out: no kind fits`: the dictionary shows nothing for the pair. It is
  `major` if they are real synonyms, opposites, a mix-up a learner needs, or
  a short or older form of one word.

## dataset "spoken"

Graded as "freed", for word pairs whose readings differ by an added っ, ん
or ー (やっぱり / やはり). One more kind:
- `spoken`: one is an emphatic or colloquial spoken form of the other, the
  same word with its own entry (やっぱり / やはり, 大っきい / 大きい); `full`
  says which is the standard form. Shown beside the spellings, not under a
  sense. A word that has become its own word with its own use (一人っ子) as
  `spoken` is `major`.

## dataset "common"

Graded as "spoken", for common words: every kind above, `syn` and `mix`
with `line` (on the word's page, about `other`) and `reverse` (on
`other`'s page, about the word), graded together as the part `line`. A
`mix` is read the same or shares one English word. A line that labels a
register true only beside the other word without naming it ("Formal."
where only "more formal than X" holds), or that claims a word's origin
wrongly, is at least `minor`; `major` if it misleads.

## dataset "final"

Graded as "synonyms", with two more kinds, as defined under "kinds":
`pair` (two words that go together, not opposites) and `polite` (separate
words in different registers; `register` gives each). Neither has a line;
grade only `pair` for them, as you would grade an antonym.

## dataset "bg"

Bulgarian translations of English texts on the word pages, for Bulgarian
learners. `kind` line: a line on a synonym or a mix-up; `kind` note: the
note on one sense of a `word` (with its `sense`), and maybe an example
`ex` (Japanese `ja`, English `en`, Bulgarian `bg`).
Parts: `text` (the Bulgarian `bg` against the English `en`) and `ex` (the
example's Bulgarian against the Japanese; only where there is an `ex`).
- `major`: says something the English does not (a wrong fact, a wrong
  register, a wrong word), drops a fact that matters, broken or unnatural
  Bulgarian a reader would trip on, the Japanese changed, кандзи for
  канджи. For `ex`: a wrong meaning against the Japanese.
- `minor`: right but stiff, a calque of the English, a weaker word choice.
- `ok`: right, and reads as natural Bulgarian.
You know Bulgarian well; judge as a careful Bulgarian editor would.
Dataset "bglate" is graded the same way; it has lines only.
