# Word synonyms: what was removed, looked at once

A Japanese dictionary for learners (English and Bulgarian speakers, aiming at
JLPT N2) shows, under each sense of a word, its synonyms (with a line on how
the other word differs), its antonyms, and words read the same that are easy
to mix up (with when to write which). Each pair here was drafted and then
**removed**: by a check, or by a rule. Your job: decide whether the removal
was right. Some rules may be wrong. A grader who follows the same rule never
sees it misfire, so judge each case on its own, not only by the rules below.

Read `data/drafts/synonym-removed/in/<BATCH>.json`, write
`data/drafts/synonym-removed/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write code to judge.

## Input

Each item: `key`, `kind` (synonym | antonym | mixup), `word` and `other`
(each with its reading, JLPT level, all its JMdict `senses`, and the `sense`
the pair is for when known), `removedBy`, `reason` (why it was removed), and
`drafted` (the lines the drafts wrote, if any).

`removedBy`:
- `check: doubtful` / `check: wrong`: an Opus check held it back.
- `rule: same word`: a code rule dropped it as another form, spelling or
  short form of the same word.
- `second look: drop`: a second Opus check dropped it.
- `read-the-same pass: same` / `wrong`: two words read the same, called one
  word, or not worth showing.

## The rules the pipeline used

- A synonym: a learner can use `other` in place of the word, in this sense,
  in some common sentences, with nearly the same meaning. Not a broader or
  narrower word (果物 / りんご), not a word of the same kind (犬 / 猫), not a
  related word (医者 / 病院), not another form of the same word (始まる /
  始める), not a short or polite form of it (金曜 / 金曜日, お風呂 / 風呂).
- An antonym: the plain opposite in this sense (勝つ / 負ける). Established
  words with 不・非・無・未 are real antonyms (人気 / 不人気). Pairs that differ
  by sex are antonyms (祖父 / 祖母).
- A mixup: two different words, read the same, that a learner could write
  one for the other (製作 / 制作, 改定 / 改訂).
- Dani's decisions: 有る / 無い are antonyms (無い is its own adjective, not
  only a grammatical negative); 上 "superior" pairs with 下 "inferior", and
  下位 pairs with 上位, not with 上.

## Verdicts

- `drop`: the removal was right.
- `keep`: the removal was wrong; this is a real pair a learner is helped by.
  Give `wordSense` and `otherSense` (the sense numbers the pair is for), and
  for a synonym or mixup two lines: `line` (on the word's page: how `other`
  differs; mixup: when to write `other`) and `reverse` (on `other`'s page:
  the same for the word). Simple technical English, short sentences, one fact
  each, at most about 100 characters (mixup about 140). Not "similar to" or
  "a synonym of"; do not make either word the subject. The two lines must
  agree.
- `knowledge`: you cannot decide because the answer lies in Japanese usage
  you are not sure of (is this word really used this way? how common is this
  sense?). Give `research`: the exact question a researcher should answer
  from dictionaries and corpora.
- `question`: no answer fits, because the box is wrong, not the knowledge.
  The pair is real in some way the kinds above cannot hold, or a rule
  removes something a learner needs. Give `box`: what the rule or the kinds
  miss, and what would fit (a new rule, a new kind, a changed definition).

Use `knowledge` and `question` honestly, not as a shrug: when you know the
answer, say `drop` or `keep`. Every verdict has a short `why`.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": {"verdict": "drop", "why": "a narrower word: a kind of fruit"},
  "<key>": {"verdict": "keep", "why": "both mean 'begin' in speech", "wordSense": 1, "otherSense": 2,
            "line": "More formal. Used for events and ceremonies.", "reverse": "Everyday word. Used for any start."},
  "<key>": {"verdict": "knowledge", "why": "unsure the sense is still used", "research": "Is 〜 used today for 〜 in speech?"},
  "<key>": {"verdict": "question", "why": "...", "box": "a set pair (left / right) is neither opposite nor synonym; a 'pair' kind would hold it"}
}}
```

Every key once.

## Work

Read the whole file first. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/synonym_removed.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts of drop, keep, knowledge and question.
