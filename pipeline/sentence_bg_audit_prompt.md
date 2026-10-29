# Which word's page an example sentence belongs on

A Japanese dictionary for learners shows, on each word's page, a few example
sentences. The index that files sentences under words sometimes puts one under
the wrong word: another word written alike (一時 read ひととき under 一時
【いちじ】 "one o'clock"), a name (林 the surname under 林 "grove"), or a
piece of a longer word (文学 inside 人文学). Translators marked such sentences
`notFor` a word, which takes them off that word's page. They saw only the
word's first meaning, so some removed a sentence that uses another meaning of
the same word. Your job: decide each one again, now with all of the word's
meanings in front of you.

Read `data/drafts/sentence-bg/in/<BATCH>.json`, write
`data/drafts/sentence-bg/out/<BATCH>.json`. Decide yourself; do not write code
that decides.

## The items

Each item: `key`, `ja` (the sentence), `en` (its English), `word` (the word
whose page it is on, with its reading and first meaning), `senses` (all of that
word's meanings, numbered), `now` (`off`: a translator took it off this page;
`ask`: nobody has decided yet, either because the sentence is shown on two
words written alike or because no translator was shown this word), and sometimes `issue`, what the translator wrote.

## The rule

The sentence belongs on the page (`keep`) when the word as it stands in the
sentence is this dictionary entry, in any one of its meanings in `senses`:

- another meaning of the same word: keep (勤務中 is 中 【ちゅう】 "during",
  its meaning 3; 通 as the counter for letters is 通 【つう】 meaning 2);
- the word inflected or with an ending: keep (食べた on 食べる);
- an honorific or humble form of the word itself: keep.

It does not belong (`off`) when the sentence has something else:

- another word written alike, or read otherwise (一時 ひととき, 値 ね on
  値 【あたい】, 二分 にふん on 二分 【にぶん】, 塩 しお on 塩 【えん】);
- a name of a person, place, company or work (ボーイング the company on
  "bowing"; 啄木 the poet on "woodpecker");
- a piece of a longer word that is a word of its own (人文学 on 文学,
  即戦力 on 戦力, 取り沙汰 on 沙汰);
- on a noun's page, the verb it comes from in a verb form (読み終える, 読み
  さえすれば on 読み 【よみ】 "reading"; 役に立ち on 立ち): that is the verb, not
  the noun. But the noun itself, with any particle, is the noun.

When the word in the sentence is a typo for another word (友に for 共に), it is
`off` this word's page.

For `ask` items, say for this word whether the sentence belongs on its page.
Most will: say `off` only for one of the cases above.

## Output

```json
{"batch": "<BATCH>", "items": {
  "s156171|1620400": {"verdict": "keep", "why": "勤務中: 中 'during' is meaning 3 of this word"},
  "s235376|1576100": {"verdict": "off", "why": "３０日 is the 30th, not みそか"}
}}
```

Every key once; `why` in a few words.

## Work

Read the whole file first. Write valid JSON (UTF-8). Then run
`PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe pipeline/sentence_bg.py check --batch <BATCH>`
from `C:\Users\dani\Documents\BetterRTK` and fix every problem until it
reports none. Reply with one line: how many items, how many keep and how many
off, and anything you were unsure of.
