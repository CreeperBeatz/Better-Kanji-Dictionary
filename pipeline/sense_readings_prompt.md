# Sense notes: is each sense read the way the page says?

A Japanese dictionary for learners (aiming at JLPT N2) shows a word page
for each JMdict entry. The page heads the entry with one reading (the
headword's), and under each sense a short English note (`text`) and maybe
an example (`ex`). One entry often holds several readings, and JMdict
mostly does not say which sense goes with which reading. The notes were
written as if every sense were read like the headword. Some are not:
- 紅 くれない (readings くれない, べに, こう): "lipstick, rouge" is べに.
- 十八番 おはこ: "No. 18" is じゅうはちばん.
- 半月 はんげつ: "half a month" is はんつき.
- 上皮 うわかわ: "epithelium" is じょうひ.

Your job: for each note, decide which reading(s) its sense is used with,
and fix the note and its example where a learner would read the word
wrongly. Leave everything else as it is.

Read `data/drafts/register-claims/in/<BATCH>.json`, write
`data/drafts/register-claims/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write code to judge.

## Input

Each item: `key`, `text` (the note), `ex` if it has one (Japanese with the
word in 【】, English, `src` t = a real Tatoeba sentence, d = written for
the dictionary), and `about`: the headword `word` and its `reading` (the
one the page shows), all `readings` and `spellings` of the entry in JMdict
order ("(rare)" = an irregular or rare form), all `senses`, the `sense` the
note is for, and `jmdictOnly` when JMdict does restrict some senses
(sense number -> the only readings `r` / spellings `k` it is used with;
trust it). A sense may carry JMdict's field in braces ({Buddh}, {go},
{med}, {baseb} …): the drafters never saw these, so a note may describe
the sense outside its field (壁 "wall (of stones)" is the go term, not a
stone wall round a field); fix such a note too. A word's notes are all in the same batch: read them together.

## What to do

For each note:
1. **Which reading is this sense used with?** Often all of them, or the
   headword's: then the note is about reading, nothing more to do. Many
   entries' extra readings are only variants for every sense (いつ / なん
   どき is not one of these; 一寸 ちょっと / ちょいと is). Decide from your own
   knowledge, not from the order of the readings.
2. **If the sense is used mainly or only with another reading,** the note
   must say so plainly, in the style already used: "Read べに in this
   sense: …". Where both are used but differ ("usually read はんつき in this
   sense"), say that. Keep the rest of the note if it is true.
3. **The example** must use the word as read in that sense. A Tatoeba
   sentence where the word is read otherwise, or a drafted one that only
   makes sense in another reading, is replaced (`ex` with `ja`, `en`) or set
   to null if no short, natural sentence fits.
4. **Also fix** a note or example that describes the wrong sense, or says
   something false about the reading (a reading it claims that the entry
   does not have, a sense given to the wrong reading). Nothing else: no
   rewording of true notes, no register or style changes.

Most notes need nothing: answer "ok". Do not add "Read X" to a note whose
sense is read like the headword.

Keep the style: simple technical English, short sentences, one fact each.
Notes at most 300 characters.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": "ok",
  "<key>": {"text": "Read べに in this sense: lipstick or rouge; an everyday word.", "why": "this sense is べに, not くれない"},
  "<key>": {"text": "Usually read はんつき in this sense: half a month, about 15 days.", "ex": {"ja": "【半月】ほど休みました。", "en": "I took about half a month off."}, "why": "half a month is はんつき; the old example was the half moon"},
  "<key>": {"ex": null, "why": "the example reads おはこ, the sense is じゅうはちばん"}
}}
```

Every key once. A fix holds `text` (the whole new note), `ex` (a new
example, or null), or both, and a short `why`.

## Work

Read the whole file first. Write the output file early and add to it in
parts, so work is saved if you are cut off. Valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/register_claims.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts of ok and fixed, and any pattern you saw.
