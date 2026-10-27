# Bulgarian for the example sentences

A Japanese dictionary for learners (aiming at JLPT N2) shows, on each word's
page, a few short Japanese sentences from Tatoeba with their English
translation. Bulgarian speakers use it too. Your job: translate each sentence
into Bulgarian. The result is shown as is on Bulgarian pages, under the
Japanese, so it must read as if a careful Bulgarian teacher of Japanese wrote
it.

Read `data/drafts/sentence-bg/in/<BATCH>.json`, write
`data/drafts/sentence-bg/out/<BATCH>.json`. Translate yourself, with your
own knowledge of Japanese and Bulgarian. Do not write code to translate.

## The items

Each item: `key`, `ja` (the sentence as Tatoeba writes it), `en` (Tatoeba's
English translation, or null), and `words`: the words whose page shows it,
each with its reading and first English meaning, so you know which word the
learner is looking at. Sometimes `tatoebaBg`: a Bulgarian translation from
Tatoeba. Output: `{"bg": "..."}`.

## How to translate

- Translate **from the Japanese**. The English is a guide to the meaning, not
  the text to translate; where the two differ, follow the Japanese. Tatoeba's
  English is often loose or old-fashioned ("You are secure from danger here"
  for 君はここなら安全だ).
- Natural Bulgarian, the same register as the Japanese: plain, polite,
  rough, childish, old. A sentence in です/ます need not use вие; one in plain
  speech between friends uses ти.
- The learner reads the Bulgarian to understand the Japanese. Keep the word
  from `words` visible in the translation, in its meaning there (フライ in a
  baseball sentence is a fly ball, not fried food). Do not add or drop facts;
  keep the Japanese sentence's meaning, tense and who does what. Where
  Japanese leaves the subject out, Bulgarian may too.
- A proverb or set phrase (蛙の面に水, 猿も木から落ちる) gets the Bulgarian
  proverb or phrase that means the same, if there is a well-known one;
  otherwise say plainly what it means. Never invent a proverb.
- Numbers as digits (６ペンス: 6 пенса); full-width digits become normal ones.
  Units and money in Bulgarian (グラム: грама, 円: йени, ドル: долара).
- Japanese names and terms in Cyrillic after the Hepburn reading, as in
  канджи (never the Polivanov дз/си style of кандзи): Шитамачи, йокозуна,
  манджу, 太郎: Таро. A word Bulgarian already uses keeps its usual
  Bulgarian spelling: дзен, гейша, джудо, суши, кимоно, Токио, Осака, Киото.
  Foreign names in their usual Bulgarian form (Боб, Мери, Том).
- No Japanese script in the Bulgarian, no 【】, no Latin letters inside
  Bulgarian words.
- `tatoebaBg`, when given, was often made from the English, not the
  Japanese, and some are wrong (English idioms taken word for word). Use it
  only where it is right; otherwise write your own.

## When the English or the Japanese looks wrong

Still translate from the Japanese. But add `"issue": "what looks wrong"` to
that item when Tatoeba's English says something the Japanese does not (a
wrong meaning, a mistranslated word, a different tense or person), or when
the Japanese itself is unnatural or wrong (a phrase a Japanese speaker would
not say, the wrong word). Not for English that is only loose or
old-fashioned but means the same.

## Output

```json
{"batch": "<BATCH>", "items": {
  "s191321": {"bg": "Приятно и безопасно пътуване."},
  "s177862": {"bg": "Тук си в безопасност."},
  "s123456": {"bg": "...", "issue": "the English says 'yesterday'; the Japanese says 'today' (今日)"}
}}
```

Every key once.

## Work

Read the whole file first. Write valid JSON (UTF-8); write it in parts if
it is long, but one file in the end. Then run
`.venv/Scripts/python.exe pipeline/sentence_bg.py check --batch <BATCH>`
from `C:\Users\dani\Documents\BetterRTK` and fix every problem it lists
until it reports none. Reply with one line: how many items, how many with an
`issue`, and anything you were unsure of.
