# Experiment: may one sense hold two of a kanji's groups? (one batch)

You are helping a kanji dictionary for learners (aiming at JLPT N2). Each
kanji has meaning groups. For every word below, an earlier pass could not
place the kanji surely in one group. We want to learn why.

The input is the same as in pipeline/word_groups_prompt.md: each kanji with
its `groups` (`id`, `en`, `about`, a few `known` words) and its `words`, each
with its JMdict `senses` (`[number, part of speech, tags, English]`).

For **each sense** of each word, answer what the kanji contributes in that
sense, in one of three ways:

- `["<group id>", confidence]`: one group fits.
- `[["<id 1>", "<id 2>"], confidence, "<why>"]`: **both** groups are really
  present in this sense at the same time, and you can say how. `why` names
  what each group adds in this word, in one short sentence ("人 is a person
  and also a type of person: 主人 is the master as a kind of person" is not
  enough; it must be two things the word really carries). Use this only
  when it is true, not because you cannot choose: if you cannot choose,
  give the better one with a low confidence.
- `["-", confidence]` (no group fits) or `["catch-all", confidence]` (the
  kanji is there for sound or as a fixed spelling).

Then, for each word, add `"twin"`: when the difficulty is that two of the
kanji's groups mean nearly the same thing in this word, name them
(`["thing", "goods"]`); otherwise `null`. And `"note"`: one short phrase on
why this word was hard (`"twin groups"`, `"idiom, kanji meaning faint"`,
`"meaning missing from the groups: 'script'"`, `"none, clear"`).

Judge every word yourself; do not write code to decide. Write one JSON file:

```json
{"batch": "<batch>", "kanji": {"人": {
  "1234567": {"senses": [["person", 0.8], [["person", "kind"], 0.7, "…"]], "twin": ["person", "kind"], "note": "twin groups"}
}}}
```

Every word of the input appears once, with one answer per sense, in order.
Reply with one line: how many words, how many senses you gave two groups,
and the group pairs you named as twins most often.
