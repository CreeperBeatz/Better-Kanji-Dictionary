# Which kanji for this reading: translating Bunkacho's usage notes (one batch)

You are drafting data for a kanji dictionary for learners whose language is
English or Bulgarian. A person checks everything you write. You do not need
the web or any other file.

The input is part of the Japanese government's (Bunkacho's) report on kanji
that share a kun reading (異字同訓, 2014). For each `reading` it gives each
`spelling` (the kanji, as words: 早い・早まる・早める), a short Japanese
definition `def`, the report's example phrases `examples`, and `notes`:
footnotes on borderline cases. A `*` in a spelling or example points to a
note.

For each reading, write:

- per spelling:
  - `kanji`: copied exactly from the input.
  - `defEn`, `defBg`: the definition in English and in Bulgarian. Translate
    it faithfully and shortly; do not add what it does not say. Keep `⇔`
    antonyms as they are, translated ("(⇔ 遅い) ...").
  - `examples`: pick **2 to 4** of the report's examples that show the
    difference from the other spellings best: common, clear, varied. For
    each: `ja` copied **exactly** as the input has it (with its 。 and any
    `*` or （）), `kana`: the whole phrase in hiragana (the reading of every
    kanji, as a Japanese speaker reads it here), `en` and `bg`: a natural
    translation of the phrase.
- `notes`: one per input note, **in the same order**: `en` and `bg`, a
  faithful translation of the note, shortened only where it repeats itself.

How to write:

- English and Bulgarian: plain and natural, short sentences, common words.
- Bulgarian: **Japanese kanji are «канджи»**, never «кандзи». Verbs as a
  dictionary gives them where you gloss a single word (`бързам`); full
  phrases are translated as phrases.
- Keep every Japanese word you mention in Japanese script.
- The point of the card is the difference between the spellings: make each
  `defEn` / `defBg` show it, using the report's own words.

Output, exactly this shape (UTF-8, no comments), with every entry of the
input once, keyed by its `key` (its reading; two entries with the same
reading carry their number too, as きく 51 and きく 52):

```json
{
  "batch": "<the input's batch>",
  "entries": {
    "はやい・はやまる・はやめる": {
      "spellings": [
        {"kanji": "早い・早まる・早める",
         "defEn": "Before the usual or planned time; taking little time.",
         "defBg": "По-рано от обичайното или планираното време; за кратко време.",
         "examples": [
           {"ja": "時期が早い。", "kana": "じきがはやい。", "en": "It is too early.", "bg": "Още е рано."},
           {"ja": "早く起きる。", "kana": "はやくおきる。", "en": "Get up early.", "bg": "Ставам рано."}
         ]},
        {"kanji": "速い・速まる・速める",
         "defEn": "Having speed; becoming faster.",
         "defBg": "С голяма скорост; ставам по-бърз.",
         "examples": [
           {"ja": "流れが速い。", "kana": "ながれがはやい。", "en": "The current is fast.", "bg": "Течението е бързо."}
         ]}
      ],
      "notes": []
    }
  }
}
```

Write the file with your file-writing tool to the path your prompt gives,
then reply with one line: how many readings you wrote, and anything you
were unsure about.
