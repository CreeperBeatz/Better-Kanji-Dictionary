# Check claims of a major error in a kanji dictionary entry, with sources

A grader compared two learner's dictionary entries (X and Y) for the same kanji,
blind, and called one problem in one entry **major**. Your job: check each claim
against real dictionaries on the web, and say whether it holds and whether it is
really major. You do not know which dictionary X or Y is. Do not try to find out.

The entries are excerpts: each meaning lists at most 8 words, with written form
and reading only. "Major" meant: the entry teaches the learner something false
(a word under a meaning it does not have, a meaning the kanji does not have, a
wrong reading), or leaves out a meaning needed for common words. The reader is an
English speaker aiming at JLPT N2.

## For each claim

1. Look the facts up. Use at least two sources, and prefer Japanese monolingual
   dictionaries for meaning and origin:
   - kotobank.jp (デジタル大辞泉, 精選版 日本国語大辞典, 大辞林 where shown)
   - dictionary.goo.ne.jp, weblio.jp
   - jisho.org (JMdict, frequency and JLPT tags), en.wiktionary.org
   - kanjipedia.jp (漢字ペディア) for a kanji's meanings and its jōyō readings
   - the jōyō kanji table (文化庁 常用漢字表) for readings
2. Check each part of the claim:
   - For a word under the wrong meaning: what does the word mean, and how does
     the kanji work inside it? Could a fair reader place it under that meaning
     (an extended or historical sense, or a reasonable reading of the label)?
   - For a missing meaning: is the meaning real, and is a word that needs it
     common (jisho "common word", JLPT tag, or used in everyday writing)? Is the
     meaning truly absent from the entry, or only under another label?
   - For a reading: what do the jōyō table and dictionaries say?
   - For a factual claim (a place, a history): what do sources say?
3. Give a verdict:
   - `major`: the claim is right, and it would mislead an N2 learner or leave
     out a meaning they need.
   - `minor`: the claim is partly right, but the problem does not really mislead
     (a defensible placement, a rare word, a meaning that is under another label).
   - `wrong`: the claim is false; the entry is right.
   - `unsure`: sources disagree or you could not find enough. Say what is missing.

Judge the claim, not the grader's wording. A claim can be right about the fact and
still only `minor`. If the grader got a detail wrong but the core problem is real,
judge the core problem and say which detail was wrong.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape:

```json
{"batch": "v-00", "claims": [
 {"id": "m00", "verdict": "major", "why": "one or two sentences: what the sources say",
  "sources": ["https://kotobank.jp/word/...", "https://jisho.org/word/..."]}
]}
```

Every claim in the batch must be in the output, with the URLs you actually read.
