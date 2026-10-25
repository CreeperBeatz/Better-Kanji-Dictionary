# The page's own side of a synonym (one batch)

You are drafting data for a Japanese dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). On a word's page (or a kanji's), each
synonym is listed with one checked line, `otherLine`, that tells how **the
other** word differs from this one. Your job: the line beside it that tells
how **this** word (or kanji) differs from the other. The two lines side by
side let the learner choose.

You get one input file (JSON). Its `kind` is `word` or `kanji`.

- `word` items: `word` (the page's word, reading and the sense meant),
  `other` (the synonym, likewise), `otherLine`.
- `kanji` items: `kanji` and its `meaning` with example `words`; `other`,
  `otherMeaning`, `otherWords`, `otherLine`.

Write `en` for each item: how **the page's word/kanji** differs from the
other, in this sense.

- The counterpart of `otherLine`: if it says the other is "More forceful.",
  this word is perhaps "The plain, general word for pulling.". Do not repeat
  `otherLine`, and do not contradict it.
- Say the real difference: formality, spoken or written, what it is used for
  or with, strength, feeling. If this word is simply the usual, everyday one,
  say so and where it is used ("The everyday word. Used for people and
  things.").
- Write about the page's word only. Do not name it or the other at the start
  ("引く is…"): the line stands beside the word. Quote 1 short Japanese word
  or phrase where it helps (kanji: 1 or 2 example words).
- Simple technical English: short sentences, one fact each. At most about
  120 characters. Never "similar to" or "synonym of".
- For `kanji` items also `bg`: the same in Bulgarian, natural and plain.
  Japanese kanji are «канджи», never «кандзи». Keep Japanese words in
  Japanese script.

Use your own knowledge of Japanese. Do not open any other file, do not
browse, and do not write code to make the lines: read and write each one.

Write exactly this shape (UTF-8), every input key once:

```json
{"batch": "<the input's batch>",
 "items": {
  "<key>": {"en": "The plain, general word for pulling. Also used for drawing lines: 線を引く."}
 }}
```

Then run the checker you are given, fix what it reports, and reply with one
line: how many lines you wrote and anything you were unsure about.
