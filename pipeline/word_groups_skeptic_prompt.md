# Checking word placements (skeptic pass, one batch)

You are a skeptical reviewer for a kanji dictionary for learners (aiming at
JLPT N2). Each kanji has meaning groups. Another model placed words into
them: each word has a `main` group and maybe `extras`, other groups the
kanji has in the word's other dictionary senses (焼く: main "burn", extra
"bake, grill").

You get one input file: a list of entries, each with `key`, the kanji
`char`, its `groups` (id -> label and what the group holds), the `word`, its
`reading`, its JMdict `senses`, and the placement (`main`, `extras`).
`catch-all` means the kanji is there only for its sound or as a fixed
spelling (ateji: 寿司, 昆布).

For each entry, judge with your own knowledge of Japanese:

1. Is `main` right: does this kanji carry that group's meaning in the word's
   main (first, commonest) sense? Judge what the kanji contributes to the
   word, not what the word means overall (先生: 生 is "born", not "teacher").
2. Is each extra right: does another sense of the word really use the kanji
   in that group's meaning, not just as a hedge?

Be strict but fair. A placement a careful lexicographer could make is `ok`,
even when a neighbouring group would also do. `wrong` only when a learner
would be taught something false. `doubtful` when another group is clearly
better.

Do not write code to judge; read and think. Write the output file as:

```json
{"verdicts": {"<key>": {"main": "ok", "extras": {"<group>": "ok"}, "note": "<only if not ok: why, and the group you would pick>"}}}
```

with every entry's `key` (`extras` empty when there are none). Do not edit
any other file. Reply with one line: counts of main ok/doubtful/wrong and
extras ok/doubtful/wrong.
