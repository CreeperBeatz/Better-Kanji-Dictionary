# Sense notes: nuance, rank and an example for each sense of a word

You write the notes a learner of Japanese (aiming at JLPT N2) reads under each
sense of a dictionary entry. Read your input file
`data/drafts/sense-notes/in/<BATCH>.json` and write
`data/drafts/sense-notes/out/<BATCH>.json`.

Each input item is a word: `id`, `word`, `reading`, `jlpt` (5 = N5, null = not
on the list), `senses` (JMdict, numbered from 1: part of speech, misc tags, the
English glosses, and `synonyms` -- other words close in that sense, each with a
line on how *that* word differs from this one), and `sentences` (real Tatoeba
sentences with the word, shortest first; may be empty).

## Output

```json
{"items": {"<id>": [ {"rank": "main", "nuance": "...", "ex": {"ja": "...", "en": "...", "src": "t"}}, ... ]}}
```

One note per sense, in the order of `senses`, for every item.

### `nuance` -- one sentence

What the word is **in this meaning**: where and how it is used, its register
(spoken, written, formal, slang), what it suggests or stresses. One sentence,
at most ~150 characters, plain English in short words (ASD-STE100 style).

- Say what is particular to this word in this meaning. Do not repeat the
  glosses ("Means old." is useless). Do not define it again.
- The synonym lines say how the *other* words differ. Your sentence is the
  other side: this word's own place. It must agree with them, not repeat them,
  and must not name the synonyms.
- Do not start with the word itself ("古い is ..."); the page already shows it.
- Not "a word that means"; not "similar to". No examples inside the nuance.
- Good: "The everyday word for anything not new, from objects to ideas; neutral in tone."
- Good: "Of food or air that has sat too long; often with a slight sense of disgust."

### `rank` -- main | secondary | rare

How soon a learner meets this meaning in real Japanese:
- `main`: the core meaning(s), the ones to learn the word by. At least one per
  word; usually one or two.
- `secondary`: met regularly, but after the main ones.
- `rare`: specialist, archaic, dialect, or barely seen. JMdict's order is a
  hint, not the answer: judge by real usage.

### `ex` -- one example, or null

A short sentence (at most ~40 characters) that shows the word **in this
meaning**, with the word as it appears marked once in 【】 (inflected as it is:
【古く】なった). `en` is a natural English translation.

- First look in `sentences`. If one shows this exact meaning clearly, use it
  **word for word** (only add the 【】) and set `"src": "t"`. Use each offered
  sentence for one sense at most.
- Else write a short, natural, everyday sentence a native speaker would say,
  `"src": "d"`. Plain form unless the meaning needs polite speech. Use common
  kanji; no rare words around it.
- `null` for a `rare` sense where an example would not help.

## Work

Read the whole file first. Write the output as valid JSON (UTF-8, Japanese as
is). Then run `.venv/Scripts/python.exe pipeline/sense_notes.py check --batch <BATCH>`
and fix every problem it lists until it reports none.
