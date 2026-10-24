# Word synonyms: a second look at the weak spots

A Japanese dictionary for learners (aiming at JLPT N2) shows, under each
sense of a word, its synonyms (with a line on how the other word differs),
its antonyms, and words read the same that are easy to mix up (with when to
write which). Each pair here already passed two drafts and one check, but is
a weak spot. Your job: a strict second look. Fix or drop what is wrong; leave
what is right alone.

Read `data/drafts/synonym-recheck/in/<BATCH>.json`, write
`data/drafts/synonym-recheck/out/<BATCH>.json`.

## Input

Each item: `key`, `kind` (synonym | antonym | mixup), `why` it is here,
`word` and `other` (each with its reading and the one sense the pair is for:
`[number, part of speech, tags, English]`), and:
- `line`: shown on the word's page beside `other`. Synonym: how `other`
  differs from the word. Mixup: when to write `other` (not the word).
- `reverse` (when `shownBothWays`): the line on `other`'s page beside the
  word: how the word differs from `other` (mixup: when to write the word).

`why`: `rewritten` (the line was written by the first check and read by no
one since), `floor` (the drafts were only just sure enough), `mixup` (one
pass only), `both ways` (the two lines must agree with each other), `mirrored` (the pair is shown on both words; one of its two lines was a quick draft read by no one, so check both lines with care).

## What is right

**The pair.**
- A synonym: a learner can use `other` in place of the word, in this sense,
  in some common sentences, with nearly the same meaning. Not a broader or
  narrower word (果物 / りんご), not a word of the same kind (犬 / 猫), not a
  related word (医者 / 病院), not another form of the same word (始まる /
  始める), not a short or polite form of it (金曜 / 金曜日, お風呂 / 風呂), not
  the same word read or spelled another way (居る おる / いる), and not one
  that fits only another sense.
- An antonym: the plain opposite in this sense (勝つ / 負ける); not a mere
  contrast or a grammatical negative (できる / できない). Established words
  with 不・非・無・未 are real antonyms (人気 / 不人気). Pairs that differ by sex
  are antonyms here (祖父 / 祖母).
- A mixup: two different words, read the same, that a learner could write
  one for the other in this sense (製作 / 制作, 改定 / 改訂).
If the pair is wrong under these rules, or would mislead a learner more than
help, drop it.

**The lines.** True, useful, about the right word: a synonym line says what
is particular to `other` against the word (formality, spoken or written,
what it is used for or with, strength, feeling); the reverse line, the same
for the word against `other`. A mixup line says when to write that spelling.
Simple technical English, short sentences, one fact each, at most about 100
characters (mixup about 140). Not "similar to", "a synonym of"; do not
repeat either word as its subject. When shown both ways, the two lines must
agree: if one says `other` is more formal, the other must not say the word
is. Fix a line that is false, vague, about the wrong word, or contradicts the
other line; keep one that is true and useful even if you would word it
otherwise.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": "ok",
  "<key>": {"line": "...", "reverse": "...", "why": "line: says the wrong word is formal"},
  "<key>": {"drop": true, "why": "narrower: a kind of fruit"}
}}
```

Every key once. A fix object holds only the lines that change (`reverse`
only when `shownBothWays`; antonyms have no lines, so only "ok" or drop) and
a short `why`.

## Work

Read the whole file first. Judge with your own knowledge of Japanese; do not
write code to judge. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/synonym_recheck.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts of ok, fixed and dropped.
