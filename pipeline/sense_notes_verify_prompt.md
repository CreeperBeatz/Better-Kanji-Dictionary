# Sense notes: check every note

Another model drafted, for each sense of a Japanese word, the note a learner
(aiming at JLPT N2) reads under that sense: a `rank`, a one-sentence `nuance`
and an example `ex`. You are the check. Assume nothing is right until you have
read it; fix what is wrong, leave what is right alone.

Read `data/drafts/sense-notes/verify/in/<BATCH>.json`, write
`data/drafts/sense-notes/verify/out/<BATCH>.json`.

## Input

Each item is a word: `id`, `word`, `reading`, `jlpt` (5 = N5, null = not on the
list), `senses` and `sentences`.

Each sense: `n` (JMdict's number), `pos`, `misc` (JMdict tags: arch, obs, rare,
dated, hist, col, sl, uk ...), and where JMdict has them `field` (math, econ,
law, sumo, Buddh ...: a specialist term, usually `rare` for a learner unless
the field is everyday), `dialect` (ksb = Kansai ...) and `info` (JMdict's own
note on the sense); `gloss`; and `note` -- the draft:
`{rank, nuance, ex: {ja (the word in 【】), en, src: "t" Tatoeba | "d" drafted} | null}`.

Some senses also have:
- `flags`: what the dictionaries say. **Hints, not truth.** They come from the
  Tatoeba corpus's sense tags, which were made against an older JMdict whose
  senses were since split and reordered: in a sample, 8 of 10 "example tagged
  another sense" flags were the tag's mistake. Sense 1 is tagged far more often
  than its real share, so "main, never tagged" says little for a later sense.
  "main but JMdict arch" on a one-sense word is usually an archaic word, not a
  wrong rank: there, check that the nuance says it is archaic. Weigh each flag,
  then decide yourself.
- `offered`: real Tatoeba sentences tagged with this sense, with their human
  translation. Tags can be wrong; check the sentence really shows this sense.

`sentences`: other real Tatoeba sentences with the word (untagged), shortest first.

## What to check, per sense

**rank** -- main | secondary | rare: how soon a learner meets this meaning in
real Japanese today. `main`: the meanings to learn the word by (at least one
per word). `secondary`: met regularly, after the main ones. `rare`:
specialist, archaic, dialect or barely seen. Judge by real usage, not JMdict's
order. A wrong rank moves the sense on the page, so fix any you are sure of
(e.g. a counter word's counter sense marked rare, 冊 "volume" for books).

**nuance** -- one sentence, at most ~150 characters, plain English in short
words (ASD-STE100 style). It says what the word is *in this meaning*: where
and how it is used, its register, what it stresses. Fix it if:
- any claim is untrue or doubtful (register, who says it, what it implies,
  grammar such as particles or set phrases, how it is written);
- it only repeats or re-defines the glosses;
- it fits another sense of the word better than this one;
- it misses something a learner must know: archaic or dated, rude or vulgar,
  usually written in kana, mostly in a fixed phrase;
- it starts with the word itself, says "a word that means" or "similar to",
  names a synonym, or holds an example.
Do not rewrite a nuance that is true and useful just to word it your way.

**ex** -- a short sentence (at most ~40 characters) that shows the word *in
this meaning*, the word as it appears marked once in 【】 (inflected as it is),
with a correct, natural English translation. Fix it if:
- it shows another sense, or the sense only vaguely;
- the Japanese is unnatural, odd or wrong, or the 【】 do not mark the word;
- the translation is wrong or misses the point.
- If the example is drafted (`d`) or missing (null for a sense that is not
  rare), and a sentence in `offered` or `sentences` shows this exact sense
  clearly and naturally, **use that real sentence** instead: word for word,
  only add the 【】, `"src": "t"`. For an `offered` sentence keep its
  translation unless it is wrong. A real sentence beats a drafted one, but a
  clear drafted one beats an odd or long real one.
- Else, if it must change, write a short, natural, everyday sentence, `"src": "d"`.
- `null` is fine for a `rare` sense.

## Output

```json
{"items": {"<id>": ["ok", {"rank": "main", "why": "..."}, {"nuance": "...", "ex": {"ja": "...", "en": "...", "src": "t"}, "why": "..."}]}}
```

One verdict per sense, in order, for every item: `"ok"`, or an object with
only the fields that change (`rank`, `nuance`, `ex`; `ex` may be null) and
`why`, a few words on what was wrong ("rank: the usual counter for books";
"ex: shows sense 1"; "nuance: not formal, everyday speech"). Each word keeps
at least one `main` sense.

## Work

Read the whole file first. Write valid JSON (UTF-8, Japanese as is). Then run
`.venv/Scripts/python.exe pipeline/sense_notes.py verify-check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
the counts of ok and fixed senses.
