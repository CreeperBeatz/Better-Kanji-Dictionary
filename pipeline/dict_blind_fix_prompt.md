# Check claims against a kanji dictionary entry, with sources, and say the fix

Graders compared five kanji dictionaries blind and listed problems in one of them. For
each kanji in your batch file you get that dictionary's entry, as its site shows it, and
the claims made against it. Check every claim against real dictionaries on the web, and
say what exactly should change.

## How the entry works

- Each meaning has an id in brackets (`[払.pay]`) and an English label. Under it are the
  words the site shows for that meaning, with the gloss of the sense of the word that is
  placed in that meaning. ★ marks the words picked as the best examples.
- A meaning shows only some of its words; `(N common words in all)` is the total.
- `[also listed here]`: a word whose main place is another meaning, also shown here for a
  second sense. Being listed twice is by design, not an error, when each sense fits.
- `[catch-all]`, shown as "the kanji is used for its sound only": words placed in no
  meaning. Only words where the kanji really is there for its sound (ateji like 上海,
  寿司) belong here. A word where the kanji keeps a meaning does not.
- The readings line is every on and kun reading the dictionary lists.
- The site keeps meanings lean: few groups, each a real, distinct use. A rare or classical
  sense with no common word does not need its own meaning.

The graders saw an older rendering. In it, each word's gloss was its FIRST sense, not the
placed one, and long glosses were cut at 70 characters. If a claim only holds for that
(a gloss that "contradicts" the meaning, a cut gloss), and the entry below is fine, the
verdict is `artifact`.

## For each claim

1. Look the facts up. Read at least one source per claim, two when it is not obvious.
   Prefer Japanese monolingual dictionaries: kotobank.jp (デジタル大辞泉, 精選版 日本国語大辞典,
   字通), kanjipedia.jp (meanings, jōyō readings), weblio.jp 国語辞典. jisho.org for whether
   a word is common (its "common word" tag, JLPT tag). Do NOT open betterkanjidictionary.org.
2. Decide:
   - `confirmed`: the claim is right about the entry as shown below, and a learner aiming
     at N2 would be misled or would miss something they need.
   - `minor-only`: true, but not worth changing: a matter of taste, a rare sense with no
     common word, a defensible placement, a split or merge a fair editor could go either way on.
   - `wrong`: the claim is false; the entry is right.
   - `artifact`: the claim does not hold for the entry shown below (see above).
   - `unsure`: sources disagree or are missing. Say what is missing.
3. For `confirmed`, give the smallest fix, as one of:
   - `move`: a word goes to another meaning. `{"type": "move", "word": "払う", "to": "払.pay"}`.
     `to` is an existing id, or `new` with a `label` (then also say which other words go there).
   - `new_meaning`: a meaning the entry lacks, needed by common words.
     `{"type": "new_meaning", "label": "Big Dipper; ladle-shaped", "words": ["北斗七星", "泰斗"]}`.
     Words must contain the kanji. Only common words (jisho common or JLPT tag) make a
     meaning necessary; list them.
   - `relabel`: a meaning's label is wrong or merges two ideas so a learner is misled.
     `{"type": "relabel", "id": "衷.inside", "label": "inner heart, sincerity; middle"}`.
   - `split`: one meaning holds two ideas that common words need kept apart.
     `{"type": "split", "id": "...", "new_label": "...", "old_label": "...", "words": ["words that go to the new one"]}`.
   - `example`: a ★ example or shown word is obscure or defunct and a better one exists.
     `{"type": "example", "id": "...", "drop": ["経済企画庁"], "prefer": ["企画"]}`.
   - `reading`: a reading is listed that the kanji does not have.
     `{"type": "reading", "drop": "くすのき", "kind": "kun"}`.
   - `other`: anything else, in a sentence.

Judge the claim, not the grader's wording. One fix per claim; if two claims need the same
fix, give it on both.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape, every claim in the batch:

```json
{"batch": "fx-00", "claims": [
 {"id": "c000", "verdict": "confirmed", "why": "one or two sentences: what the sources say",
  "fix": {"type": "move", "word": "生え抜き", "to": "抜.pull"},
  "sources": ["https://kotobank.jp/word/...", "https://jisho.org/word/..."]}
]}
```

`fix` only for `confirmed`. List the URLs you actually read.
