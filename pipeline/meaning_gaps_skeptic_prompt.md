# Check flags on a kanji's meaning groups, with sources

A learner's kanji dictionary splits each kanji's meanings into groups (G1, G2 …)
and places every common word in the group whose meaning the kanji has *in that
word*. A screener read the groups and words and raised **flags**. Your job: check
each flag against real dictionaries on the web and say whether it is right, and
whether its fix is right. Be a skeptic: a flag is wrong until the sources back it.

The reader is an English speaker aiming at JLPT N2. A group is a meaning of the
kanji, not a word-building pattern. The catch-all holds words where the kanji is
only there for its sound or the spelling is fixed. A word in no group is not
shown on the kanji's page.

Each flag has a `type`:
- `misplaced`: the word is in a group whose meaning the kanji does not have in it.
- `missing-meaning`: the kanji has a meaning in common words that no group holds;
  `new_group` proposes it.
- `unplaced`: a word in no group that an existing group fits.

And a `severity`: `major` (a learner would learn something false about a common
word, nf01-24 or on the JLPT lists, or miss a meaning they need for such words) or
`minor` (the rest).

## For each flag

1. Look up the word(s) and the kanji in at least two sources. Prefer Japanese
   monolingual dictionaries for the kanji's meaning in a word:
   - kotobank.jp (デジタル大辞泉, 精選版 日本国語大辞典), dictionary.goo.ne.jp, weblio.jp
   - kanjipedia.jp (漢字ペディア): the kanji's meanings, often with the words under each
   - jisho.org (JMdict, common-word and JLPT tags), en.wiktionary.org
2. Ask:
   - Does the kanji really not carry the current group's meaning in this word?
     Read the group's note too: a fair reader may accept a placement the screener
     did not.
   - For a new group: is it a real meaning of the kanji (kanjipedia or a 漢字
     dictionary lists it), not a pattern or one word's idiom? Is the label right?
   - Is the proposed fix right: the right existing group, or a good new one?
   - Is the severity right? Is the word common?
3. Verdict:
   - `right`: the problem is real and the fix is right.
   - `right-other-fix`: the problem is real, but the fix should be different. Say what.
   - `wrong`: the current placement is fine (say why).
   - `unsure`: sources disagree or are thin. Say what is missing.
   Also give `severity`: `major` or `minor`, as you judge it.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape:

```json
{"batch": "sk-00", "flags": [
 {"id": "益-0", "verdict": "right", "severity": "major",
  "why": "one or two sentences: what the sources say",
  "fix": "only for right-other-fix: the better fix",
  "sources": ["https://kanjipedia.jp/kanji/...", "https://kotobank.jp/word/..."]}
]}
```

Every flag in the batch must be in the output, with the URLs you actually read.
