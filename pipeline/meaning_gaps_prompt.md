# Find the meanings a kanji's groups miss, and the words in the wrong group

A learner's kanji dictionary splits each kanji's meanings into **groups** (G1,
G2 …), each with a short label and a note. Every common word written with the
kanji is placed in the group whose meaning the kanji has *in that word*. You get
a batch of about 10 kanji. For each kanji you see its groups, then every common
word in each group with its dictionary senses (JMdict, English) and its
frequency (nf01 = the most common 500 words, nf48 = rare), then the words that
are in no group.

The reader: an English speaker learning Japanese, aiming at JLPT N2.

## The rules the groups follow

- A group is a **meaning** of the kanji, not a word-building pattern. "person
  who does X" is not a group of 人; it is a use of "person". Do not ask for a
  new group for a pattern.
- A word goes in one group: the meaning the kanji carries in the word's main,
  common sense. A word may also be listed in a second group when another of its
  senses uses another meaning (marked "also listed in another group").
- The catch-all holds words where the kanji is only there for its sound (ateji)
  or the spelling is fixed and has no meaning to learn from (place names, 寿司).
- A word in no group is not shown on the kanji's page at all.

## What to find

For each kanji, read every word against its group and ask: does the kanji mean
*this group's meaning* in this word? Then look at the words in no group.

1. **misplaced**: the word sits in a group whose meaning the kanji does not have
   in this word. Example: 揚がる (to rise, go up) under 揚's "deep-fry" when 揚
   also has "raise, lift up". If another group fits, give it as the fix.
2. **missing-meaning**: the kanji has a meaning in one or more common words that
   no group holds, so those words are in no group or forced into a wrong one.
   Example: 益 has only "profit, gain", but 益々 means "more and more". Propose the new group: a short label (2-5 words, like the others)
   and a note of one or two short sentences in plain English, in the style of
   the existing notes. List every word that should move to it.
3. **unplaced**: a word in no group that an existing group (or the catch-all)
   does fit. Give the group.

Do **not** flag:
- A word whose main sense fits its group, even if a rare later sense does not.
- A label you would word differently, or two groups you would merge or split,
  when no word is misled by them.
- Etymology. Judge today's meaning: the kanji's meaning in the word as a
  learner meets it. Where today's meaning comes from an older one, and the
  group's note makes the link plain, it is not misplaced.
- Readings. Only the groups and the words.

## Severity

- **major**: a learner would learn something false about a common word (nf01-24,
  or a word on the JLPT lists) or about the kanji: the word is under a meaning it
  does not have, or a meaning they need for such words is missing.
- **minor**: the rest: rarer words, defensible placements that a better group
  would serve, a common word that is only hidden (unplaced) but fits an existing
  group.

Be strict with yourself: flag what is wrong, not what could be styled better.
Most kanji should have no flags. Use your own knowledge of Japanese; check each
word's senses as given before you call it misplaced.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape:

```json
{"batch": "mg-000", "kanji": [
 {"char": "益", "flags": [
   {"type": "missing-meaning", "severity": "major", "words": ["益々"],
    "now": "G1", "fix": "new",
    "new_group": {"en": "more, increase", "about": "More and more: something grows in amount or degree."},
    "why": "益々 means more and more, not profit; no group holds it."}
 ]},
 {"char": "川", "flags": []}
]}
```

`now` is the group the word is in (G1 …, "catch-all" or "none"). `fix` is the
group it should be in (G1 …, "catch-all" or "new"). `new_group` only when `fix`
is "new", else null. Several words with the same problem go in one flag. Every
kanji in the batch must be in the output, in the batch's order, with `flags: []`
when nothing is wrong.
