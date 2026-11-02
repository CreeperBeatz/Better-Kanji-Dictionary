# Sense notes: does each note describe its sense inside its field?

A Japanese dictionary for learners (aiming at JLPT N2) shows a word page for
each JMdict entry, with a short English note (`text`) under each sense and
maybe an example (`ex`). JMdict marks some senses with a field: {go},
{Buddh}, {sumo}, {baseb}, {comp}, {med}, {law}, {food}, {mahj}, {cards} and
so on. The notes were written without seeing these tags, so some describe
the sense outside its field:
- 壁 "wall (of stones)" {go}: the note described a stone wall round a field;
  it is the go term for a solid line of stones.
- 切る {go} "to cut": the note and example were about cutting ties with people.
- 山 {cards} "deck": the note said "cards or tiles"; the tile wall is the
  separate {mahj} sense.
- 女性 {gramm} "feminine gender": the note brought in 女性語 and people.

Your job: check each note against its field and fix it where it is wrong.
Leave everything else as it is.

Read `data/drafts/register-claims/in/<BATCH>.json`, write
`data/drafts/register-claims/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write code to judge.

## Input

Each item: `key`, `text` (the note), `field` (the sense's JMdict field
tags), `ex` if it has one (Japanese with the word in 【】, English; `src` t
= a real Tatoeba sentence, d = written for the dictionary), and `about`:
the headword `word`, its `reading` (the one the page shows), all
`readings` and `spellings` of the entry, all `senses` (field tags in
braces), the `sense` the note is for, the `notes` of every sense of the
word (context: what the neighbouring senses already say), and `jmdictOnly`
when JMdict restricts some senses to some readings or spellings (trust it).
A word's tagged senses are all in the same batch.

## What is right

1. **The note describes this sense, in its field.** Not a neighbouring
   sense, not the everyday meaning, not another field's sense of the same
   word. Naming the field helps when the gloss alone is unclear ("A go
   term: …", "In sumo, …"); do not add it to a note that is already clear.
2. **The example shows this sense in its field.** An example that shows
   the everyday meaning, or another sense, is replaced (`ex` with `ja`,
   `en`) or set to null if no short, natural sentence fits. Many field
   terms are rare: null is fine for them.
3. **True facts.** Fix a wrong claim about the term (what it means in the
   field, who uses it, how it is read in this sense, how it is usually
   written). If the sense is read or written otherwise than the page's
   headword in this field, the note says so ("Read かしら in this sense").

Most notes are right: answer "ok". Do not reword a true note, and do not
change register or style claims unless they are false.

Keep the style: simple technical English, short sentences, one fact each.
Notes at most 300 characters.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": "ok",
  "<key>": {"text": "A go term: a solid line of stones facing open space; used only by go players.", "why": "described a stone wall, not the go term"},
  "<key>": {"ex": {"ja": "ここで【切る】と白は苦しくなる。", "en": "If you cut here, White is in trouble."}, "why": "the example was about cutting ties"},
  "<key>": {"ex": null, "why": "the example shows the everyday sense; no short go sentence fits"}
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
