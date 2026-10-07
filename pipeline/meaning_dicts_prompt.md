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
- `kangorin`: 新漢語林, a Japanese kanji dictionary. ❶ ❷ are its senses,
  [一] [二] group them by reading, ㋐ ㋑ are sub-senses, examples are in
  「」. `japan_only` marks a sense used only in Japan (国訓).
- `tsalta`: a Bulgarian kanji book: its Bulgarian keyword and second
  meaning, and example words with Bulgarian glosses. Useful for the `bg`
  labels.
- `wiktionary`: English Wiktionary's Japanese entries for the kanji.

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
