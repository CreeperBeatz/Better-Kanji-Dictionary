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
English translation, or null: then give `enFix`, your English, with no
`issue` needed), and `words`: the words whose page shows it,
each with its reading and first English meaning, so you know which word the
learner is looking at. Sometimes `tatoebaBg`: a Bulgarian translation from
Tatoeba. In R-* batches, `issue`: what an earlier reader found wrong with
the sentence; judge it yourself. Output: `{"bg": "..."}`.

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
- Numbers as a careful Bulgarian writer would: digits for measures, money,
  dates, times and figures (６ペンス: 6 пенса, 1500 грама, в 7 часа), words in
  proverbs and set phrases (Какъвто е на три години, такъв е и на сто) and
  for small counts in plain prose where words read better (веднъж седмично,
  двама приятели). Full-width digits become normal ones. Units and money in
  Bulgarian (グラム: грама, 円: йени, ドル: долара).
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

Always give `bg`. Add `"issue": "what looks wrong"`, and one of these:

- **The English is wrong**: Tatoeba's English says something the Japanese
  does not (a wrong meaning, a mistranslated word, a different tense or
  person, words added or dropped: まだ蕾だ given as "still in bloom"). Add
  `"enFix"`: a correct English translation of the Japanese, plain and
  natural, as short as the sentence allows. English pages show it in place
  of Tatoeba's. Not for English that is only loose or old-fashioned but
  means the same ("You are secure from danger here" is fine).
- **The Japanese is wrong**: a typo (自信 for 自身), a wrong word (規制正しく),
  broken grammar (多く学生), a calque of an English saying no Japanese
  speaker would use, or a phrase a native speaker would not write. Add
  `"broken": true`: the sentence is taken off the word pages, so a learner
  never copies it. Give `bg` for what the sentence means to say.

When unsure whether the Japanese is wrong or only unusual, it is not
broken: say so in `issue` and leave `broken` out.

- **Shown for the wrong word**: the sentence does not have a word from
  `words` in that word's meaning (一時 read ひととき on the page of 一時
  【いちじ】 "one o'clock"; the name 谷雄 on the page of 雄; 味方 on the page of
  見方). Add `"notFor": ["一時 【いちじ】"]`: each such word as `words` gives
  it, up to and including the 】. The sentence comes off that word's page
  only. With an `issue`, as above; it may come with `enFix` or `broken`.
  `words` shows only a word's first meaning, and most words have more: a
  sentence that uses another meaning of the same word is right where it is
  (勤務中 is 中 【ちゅう】 "during", a meaning of that word too; 色 for
  "complexion"). Use `notFor` only where the sentence does not have that
  word at all: another word written alike, a name, or a piece of a longer
  word (人文学 is not 文学).

## Output

```json
{"batch": "<BATCH>", "items": {
  "s191321": {"bg": "Приятно и безопасно пътуване."},
  "s177862": {"bg": "Тук си в безопасност."},
  "s186619": {"bg": "Цветята още са в пъпки.", "issue": "the English says 'still in bloom'; まだ蕾 is still in bud",
              "enFix": "The flowers are still in bud."},
  "s138290": {"bg": "Много студенти не успяха да предадат заданията си.", "issue": "多く学生 should be 多くの学生",
              "broken": true}
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
