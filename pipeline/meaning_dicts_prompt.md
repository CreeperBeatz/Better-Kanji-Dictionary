# Other dictionaries (read after meaning_prompt.md)

In this batch each kanji also has a `dictionaries` field: what published
dictionaries say about it. Use them as **evidence**, the way a careful
lexicographer would. They do not replace the rules in meaning_prompt.md.

- `kodansha`: Kodansha Kanji Learner's Dictionary (Halpern). `core` is the
  kanji's core meaning. `senses` are its meanings in on-reading compounds,
  numbered 1a, 1b, 2 ...; `words` are compounds the dictionary lists under
  that sense. `kun` are the kun words, each with its own senses. `special`
  are words with an irregular reading (ateji, jukujikun): these are often,
  not always, catch-all words.
- `tsalta`: a Bulgarian kanji book: its Bulgarian keyword and second
  meaning, and example words with Bulgarian glosses. Useful for the `bg`
  labels.
- `wiktionary`: English Wiktionary's Japanese entries for the kanji.

Some kanji also have:

- `etymology` (beside `dictionaries`): English Wiktionary's glyph origin of
  the kanji, with the sources it cites. It is the **only** source for the
  `origin` you write (see "Extras" below).
- `rareWords`: when the kanji has no word to place, up to a dozen of its
  rarer words, as evidence for its groups. They are not placed.

How to use them:

- **Groups.** Check your groups against the dictionaries' senses. A sense
  that two dictionaries give and that holds common words in the list should
  usually be one of your groups, or clearly merged into one. Senses that are
  classical-only (no modern word in the list uses them) are not groups.
  Dictionary senses are often finer than your groups: Kodansha's 1a and 1b
  may well be one group. Do not split a group only because a dictionary
  numbers two senses.
- **Words.** Words a dictionary lists under one sense belong in one group
  together, unless you have a clear reason. A word the dictionary does not
  list is placed by the same reasoning: which listed words is it most like?
  The dictionaries list only some of the words; place every word yourself.
- **Disagreement.** When the dictionaries disagree with each other or with
  the words, go by the words in the list (modern usage) and lower your
  confidence for the words concerned.
- Do not copy a dictionary's wording into the labels. Labels stay 1 to 4
  plain English words, as in meaning_prompt.md.

## Extras (run A only)

In run A, write these too. They are drafts for a person to check, like
everything else. Write in plain, simple English: short sentences, one fact
in each, common words, no jargon a learner would not know. Do not be
childish. In run B, write none of them.

**For each group**, beside `id`, `en`, `bg` and `note`:

- `about`: one or two sentences on what the kanji does in the words of
  this group, so a learner sees the meaning, not only the label.
  Example for 生 `raw`: "Uncooked or not processed: the thing as it came.
  The kanji says that something has not been changed."
- `examples`: the ids (strings) of the 2 or 3 words of the list that
  show this group best: common words, clear cases. Each must be a word you
  placed in this group. A group with one word gives that one.

**For each kanji**, beside `senses` and `words`:

- `origin`: how the character was built, for a learner, in 1 to 3
  sentences, **summarised only from the kanji's `etymology` field**. Name
  the parts and what they stood for, as the field says (生: "A sprout 屮
  coming up from the ground 一."). When the field gives more than one
  explanation, give the first and say "Another explanation: ...". Do not
  add anything that is not in the field, not even something you are sure
  of. If the kanji has no `etymology`, or it says nothing about how the
  character was built, write `null`.
- `originSure`: `false` when the field itself calls the explanation
  uncertain, disputed or "folk", or when you had to simplify a lot;
  otherwise `true`. Leave it out when `origin` is `null`.
- `link`: one sentence on how the kanji's groups connect, when they do
  (生: "From a plant sprouting comes being born and living; something
  still alive is fresh and raw."). Use the groups' order. Write `null`
  for a kanji with one group, or when the groups are not connected (a
  meaning only borrowed for its sound). Do not invent a link.

The output for one kanji then looks like this:

```json
"生": {
  "senses": [
    {"id": "life", "en": "life, living", "bg": "живот", "about": "Being alive, and the time a person lives.", "examples": ["1378840", "1369020"]},
    {"id": "raw", "en": "raw, fresh", "bg": "суров", "about": "Uncooked or not processed: the thing as it came.", "examples": ["1442400", "1378950"]}
  ],
  "origin": "A sprout 屮 coming up from the ground 一.",
  "originSure": true,
  "link": "From a plant sprouting comes being born and living; something still alive is fresh and raw.",
  "words": {"1378840": {"sense": "life", "confidence": 0.95}}
}
```
