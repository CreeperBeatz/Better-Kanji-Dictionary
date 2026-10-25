# Bulgarian for the word lines and sense notes

A Japanese dictionary for learners (aiming at JLPT N2) has short English
texts on its word pages. Bulgarian speakers use it too. Your job: write each
text in Bulgarian. The result is shown as is on Bulgarian pages, so it must
read as if a careful Bulgarian teacher of Japanese wrote it.

Read `data/drafts/translate-bg/in/<BATCH>.json`, write
`data/drafts/translate-bg/out/<BATCH>.json`. Translate yourself, with your
own knowledge of Japanese and Bulgarian. Do not write code to translate.

## Two kinds of batch

**L-*: lines.** Each item: `key`, `en` (the line), `kind`, `about` and
`against`. A `synonym` line says how the word in `about` differs from the
word in `against`; a `mixup` line says when to write the word in `about`
(and not the one in `against`). The words are given so you know what the
line is about; do not add them to the line. Output: `{"bg": "..."}`.

**N-*: sense notes.** Each item: `key`, `word`, `reading`, `gloss` (the
English meaning of this sense), `nuance` (one sentence on how the word is
used in this sense) and, when there is one, `ex`: an example sentence `ja`
(the word marked with 【】) with its English translation `en`. Output:
`{"nuance": "...", "ex": "..."}`: the note, and the Bulgarian translation of
the example; `ex` is null when the item has no `ex`.
- Translate the example **from the Japanese**. The English is a guide to the
  meaning, not the text to translate; where the two differ, follow the
  Japanese. Natural Bulgarian, the same register (plain, polite, rough), no
  【】.
- `tatoebaBg`, when given, is a Bulgarian translation from Tatoeba. Many
  were made from the English, not the Japanese, and some are wrong (English
  idioms taken word for word: 私がご馳走します "it's on me" given as "I'll take
  care of it"). Use it only where it is right; otherwise write your own.

## How to write

- Say what the English means: the same facts, no more, no less, with the
  same hedges ("often", "mostly"). But write it the way a Bulgarian would,
  not word for word: the English is terse and often clumsy, and copying its
  shape gives calques. Re-order or re-phrase freely; never change a fact.
  - "A bit more written" → "Малко по-книжовно", not "Малко повече в
    писмената реч"; "a little spoken and old-fashioned" → "Леко
    разговорно и старомодно"; "a formal, written word" → "книжовна дума";
    "used in speech and writing" → "Среща се и в говоримата, и в
    писмената реч".
  - An English noun phrase that opens a note ("Going to bed for the
    night...") may become a plain Bulgarian sentence or a definition, as a
    good Bulgarian dictionary would put it.
- Simple technical Bulgarian: short sentences, one fact each, plain words.
  Not childish, not bureaucratic.
- Keep every Japanese word, phrase and example in the text exactly as
  written (田中と申します, 〜した上で, 現代社会). Do not transliterate.
- In the Bulgarian translation of an example, write Japanese names and
  terms in Cyrillic after the Hepburn reading, as in канджи (never the
  Polivanov дз/си style of кандзи): Токио, Шитамачи, йокозуна, Мандзю
  only where Hepburn has dz. In notes and lines, Japanese stays in Japanese.
- Do not address the reader; where you must, use the formal вие.
- No Latin letters inside Bulgarian words.
- Terms, always these:
  - kanji: **канджи** (neuter: канджито, канджитата), never кандзи;
  - native word (和語): исконно японска дума; Sino-Japanese (漢語):
    китайско-японска дума; loanword (外来語): заемка (from English: от
    английски);
  - formal: официално; written / spoken: в писмената / в говоримата реч;
    literary: книжовно; polite: учтиво; honorific: почтително; humble:
    скромно (за себе си); casual: разговорно; slang: жаргонно;
  - reading: четене; on'yomi / kun'yomi: он-четене / кун-четене;
  - counter (助数詞): брояч; suffix / prefix: наставка / представка;
  - transitive / intransitive: преходен / непреходен.
- Grammar words of English that have no Bulgarian twin (the "-ing" form,
  articles) are not to be copied; say what they mean in Bulgarian.

## When the English looks wrong

Translate it as written; do not fix facts yourself. But add
`"enIssue": "what looks wrong"` to that item (a wrong fact, a mix-up with
another word, a line that contradicts itself, an unclear phrase), so the
English can be fixed and the line translated again.
The same for a Japanese example that is unnatural or wrong (a phrase a
Japanese speaker would not say, the wrong word or reading): still
translate it, and say so in `enIssue`.

## Output

```json
{"batch": "<BATCH>", "items": {
  "l00012": {"bg": "Официално. Използва се за ранг и място в списък или ред."},
  "123456|0": {"nuance": "...", "ex": "..."},
  "123457|2": {"nuance": "...", "ex": null}
}}
```

Every key once.

## Work

Read the whole file first. Write valid JSON (UTF-8); write it in parts if
it is long, but one file in the end. Then run
`.venv/Scripts/python.exe pipeline/translate_bg.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
how many items, and anything you were unsure of.
