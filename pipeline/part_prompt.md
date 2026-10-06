# Drafting what a meaningless part is (instructions for one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). A human reviewer checks everything;
nothing goes live without them. Write a careful first draft. Judge each part
yourself: do not write or run code or rules to decide them. Write exactly
one output file, to the path you are given; edit nothing else.

Every part in your batch appears inside common kanji, but the dictionary
has no meaning for it, so its page says "no recorded meaning". Your job is
to say what each part **is**, so the page can say something true.

The principle: **the modern shape decides what a kanji contains; the old
shape tells the story.** Nothing you write changes what contains what.

## The three kinds

Pick exactly one per part.

- `form_of` — the part **is** one kanji Y, written differently for its
  place, in nearly all the kanji it appears in: 𠂇 is 又 (the hand in 左 右 友 有), 龰 is 止 (the
  foot in 足 走), ⺺ is 聿. The page will then lend it Y's meaning
  everywhere, so it must be true in most of the examples. **Needs evidence**
  in `evidence`: an old form where Y stands in the part's place ("又 stands
  there in the seal forms of 右 and 友"), or a standard reference (Kangxi
  radical variant, Shuowen). No evidence, no `form_of`.
- `meaning` — the part is a real character with a meaning of its own, and
  that meaning is what it brings to the kanji it is in: 夋, 堇, 劦 (three
  ploughs: joint effort, in 協 脅). The meaning must be the one that matters
  in Japanese kanji, not an unrelated Chinese use (Unihan often gives a
  surname or a river's name: ignore those).
- `shape` — several **unrelated** old parts merged into this one modern
  shape, so no one meaning is true across its kanji. 丷 is 八 (split) in
  半, the grains in 米, hair in 首, part of 止 in 前 (old 歬). Any single
  meaning would teach something false in most of its kanji. Give the shape
  a **name**, which the page shows as a name ("the shape called …"), never
  as a meaning. Also use `shape` for a fragment that is just strokes cut
  from a bigger part and means nothing alone.

When a part is a form of Y in most kanji but something else in a few,
prefer `form_of` and name the exceptions in the evidence. When it is two or
more things about equally often, it is a `shape`.

## Writing

- `en`: for `meaning`, 1 to 3 words, lower case, the meaning a learner
  needs ("joint effort", "clay"). For `shape`, a short, plain, visual name
  of 1 to 4 words ("two drops", "crossed hook"). Do **not** use the
  primitive names from Heisig's *Remembering the Kanji* or WaniKani's
  radical names: those are proprietary and this dictionary will be open.
  Describe what the strokes look like, in your own words.
- `bg`: the same in Bulgarian. Japanese kanji are «канджи» in Bulgarian,
  never «кандзи».
- `note`: one or two short English sentences a learner can read. For a
  `shape`, say what it comes from in which kanji, citing old forms: "八
  (split) in 半; grains in 米; hair in 首; the top of 止 in 前 (old form
  歬)." If Japan has a traditional name for the shape (つかんむり for ⺍,
  しょうがしら for ⺌), give it here. For a `meaning`, say how it works in
  one or two of the examples. Up to 400 characters.
- `noteBg`: the note in Bulgarian.
- `evidence` (only `form_of`): one short English sentence, the evidence.
- `confidence`: 0.0 to 1.0, honest.

## Form links already proposed

`openFormLinks` lists links other drafts proposed for this part that a
reviewer has not decided yet (a `form_of` X|Y says the part is Y). For each,
say `keep` or `reject` in your answer's `openFormLinks`, keyed by its
`subject`. A `form_of` that is true in only one or two of the part's kanji
(丷|从 holds for 来 only) is a `reject`: it would lend the wrong meaning to
every other kanji. If you answer `form_of` with a Y someone already
proposed, keep that one; you need not repeat it.

## Input

Each part has: `inScope`, how many common or JLPT-rated kanji contain it;
`examples`, the most frequent of those; `kanjidic` (usually empty);
`unihan`, Unihan's English definition (Chinese-centred, often unhelpful);
`variants`, Unihan's variant links; `directIn`, the characters it is a
direct part of, with their IDS, old form and the old form's IDS where known;
and `openFormLinks`.

## Output

```json
{
  "batch": "<the input's batch>",
  "parts": [
    {"part": "丷", "kind": "shape", "en": "two drops", "bg": "две капки",
     "note": "Not one thing: 八 (split) in 半; grains in 米; hair in 首; the top of 止 in 前 (old form 歬).",
     "noteBg": "…", "confidence": 0.8,
     "openFormLinks": {"丷|从": "reject", "丷|八": "reject"}},
    {"part": "𠂇", "kind": "form_of", "formOf": "又",
     "evidence": "又, a right hand, stands in its place in the seal forms of 右, 友 and 有.",
     "confidence": 0.85, "openFormLinks": {"𠂇|又": "keep"}},
    {"part": "劦", "kind": "meaning", "en": "joint effort", "bg": "общо усилие",
     "note": "Three 力 (plough, strength) together: many pulling at once, as in 協 (cooperate).",
     "noteBg": "…", "confidence": 0.8, "openFormLinks": {}}
  ]
}
```

Answer every part in the batch exactly once. Reply with one line: how many
parts of each kind, and what you were unsure about.
