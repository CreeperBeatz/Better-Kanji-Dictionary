# Word pairs: which kind is each?

A Japanese dictionary for learners (English and Bulgarian speakers, aiming
at JLPT N2) shows, beside each sense of a word, other words that relate to
it. It now has more kinds than before. Your job: give each pair below the
one kind that fits it best, or `none`.

Read `data/drafts/synonym-kinds/in/<BATCH>.json`, write
`data/drafts/synonym-kinds/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write code to judge.

## Input

Each item: `key`, `now` (`ant`: the site shows it as an opposite today;
`none`: it was removed), `came` (where it comes from), sometimes a `reason`
(why it was removed, and what a later check said), and `word` and `other`,
each with its reading, JLPT level, all its JMdict `senses`, and the `sense`
the pair was for when known.

Synonyms are not asked here: a pair removed as "not a synonym" stays
removed unless it fits one of the kinds below.

## The kinds

- `ant`: the plain opposite in this sense: 勝つ / 負ける, 暑い / 寒い, 入る /
  出る. Established words with 不・非・無・未 are opposites (人気 / 不人気).
  有る / 無い are opposites.
- `pair`: two words that clearly pair up, but are not opposites. The two
  sexes of one thing (祖父 / 祖母, 少年 / 少女, 兄 / 姉, 雄 / 雌); two halves
  of one system (級 / 段); the two ends of one process (前提 / 結論); members
  of a short series (並 / 上 / 特上). Test: would a learner say "the
  opposite of X is Y" without a second thought? Then `ant`; if they would
  say "X goes with Y", `pair`. Not a mere topic link (医者 / 病院 is none).
- `polite`: two separate words for the same act or thing, one the
  honorific, humble or polite counterpart of the other: 仰る / 言う,
  いらっしゃる / 居る, 召し上がる / 食べる, 参る / 行く, 下さる / 呉れる,
  ご覧になる / 見る. Give `register` for each: plain, polite, honorific or
  humble. Not a word with お or ご put in front (お風呂 / 風呂): that is none.
- `mix`: two different words a learner mixes up by meaning, because English
  gives one word for both, but they are used differently: 近代 / 現代
  (modern era / present day), 美術 / 芸術, 消極的 / ネガティブ, 割る / 壊す.
  Give `line` (on the word's page: when to use `other`) and `reverse` (on
  `other`'s page: when to use the word). Simple technical English, short
  sentences, one fact each, at most about 140 characters, an example in
  Japanese where it helps. Use `mix` only where the mix-up is real and the
  difference is worth a line.
- `short`: one is a short form of the other, and both are dictionary
  entries: ＣＭ / コマーシャル, パソコン / パーソナルコンピューター, 三角 /
  三角形, 金曜 / 金曜日. Give `full`: which one is the long form (`word` or
  `other`).
- `older`: one is an old or rare variant of the other: メーター / メートル,
  ビールス / ウイルス. Give `full`: which one is the standard form today.
- `none`: none of these. A removed pair that fits none stays removed; an
  opposite shown today that is not a real opposite, pair or polite form
  goes.

For `ant`, `pair`, `polite` and `mix`, give `wordSense` and `otherSense`:
the sense numbers the pair is for (keep the given `sense` unless it is
wrong). `short` and `older` are about the whole word: no senses.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": {"kind": "ant", "wordSense": 1, "otherSense": 1, "why": "plain opposites"},
  "<key>": {"kind": "pair", "wordSense": 1, "otherSense": 1, "why": "grandfather and grandmother"},
  "<key>": {"kind": "polite", "wordSense": 1, "otherSense": 1, "register": {"word": "honorific", "other": "plain"}, "why": "honorific of 言う"},
  "<key>": {"kind": "mix", "wordSense": 1, "otherSense": 1, "line": "...", "reverse": "...", "why": "both 'modern'"},
  "<key>": {"kind": "short", "full": "other", "why": "ＣＭ is short for コマーシャル"},
  "<key>": {"kind": "none", "why": "only a topic link"}
}}
```

Every key once; every item has a short `why`.

## Work

Read the whole file first. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/synonym_kinds.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts per kind.
