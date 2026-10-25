# Related words for common words, one batch

A Japanese dictionary for learners (English and Bulgarian speakers, aiming
at JLPT N2) shows, under each sense of a word, other words that relate to
it: synonyms, opposites, words easy to mix up, and a few more kinds below.
The JLPT words are done. These are the common words outside JLPT. Your
answers go on the site as written, so write final data, not drafts.

Read `data/drafts/common-relations/in/<BATCH>.json`, write
`data/drafts/common-relations/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write or run code to choose words. Reading, thinking and
writing the file are the steps; the checker at the end is fine.

## Input

`words`, each with:
- `id`, `word`, `reading`.
- `senses`: `[number, part of speech, tags, English]`, in JMdict's order.
  Tags: `arch`, `obs`, `rare`, `uk` (usually kana), `col`, `sl`, `fam`,
  `hon`, `hum`, `pol`, `form` and so on. "only read X" / "only written X":
  JMdict keeps this sense to that reading or spelling, not the headword's
  (平日 "Sunday or holiday" is only read ひらび). Judge such a sense as that
  reading.
- `candidates`: words found by machine (shared English, WordNet). Most are
  not synonyms. Each: `id`, `word`, `reading`, its first senses.
- `opposites`: words JMdict calls opposites. Often empty.
- `readTheSame`, when present: separate words read the same that share an
  English phrase (製作 / 制作, 改定 / 改訂, 泣く / 鳴く).
- `shown`, when present: what the dictionary shows for the word already,
  `[sense, kind, other word, its reading, other sense]`. Do not give these
  again. If one looks wrong, say so in `flags` (see Output).

## The kinds

Give each related word one kind:

- `syn`: a learner can use the other word in place of this one, in this
  sense, in some common sentences, with nearly the same meaning: 始める /
  開始する, 美しい / 綺麗, 速い / 素早い. Not a broader or narrower word (果物
  / りんご), not a word of the same kind (犬 / 猫, 月曜日 / 火曜日), not a
  related word (医者 / 病院), not another form of the same word (始まる /
  始める, 美しさ / 美しい).
- `ant`: the plain opposite in this sense: 勝つ / 負ける, 入口 / 出口.
  Established words with 不・非・無・未 are opposites (人気 / 不人気). Not a
  negative form (できる / できない), not a mere contrast (猫 / 犬).
- `pair`: two words that clearly go together but are not opposites: the
  two sexes (祖父 / 祖母, 雄 / 雌), two halves of one system (級 / 段), the
  two ends of one process (前提 / 結論). If a learner would say "the
  opposite of X is Y" without a second thought, `ant`.
- `polite`: separate words for one act or thing, one the honorific, humble
  or polite counterpart of the other (仰る / 言う, 召し上がる / 食べる). Give
  `register` for each. A word with お or ご put in front (お茶 / 茶) is not
  polite: leave it out.
- `mix`: two different words a learner mixes up and should not. Either
  they read the same (from `readTheSame`; `why`: "sound"): 製作 / 制作.
  Or English gives one word for both but they are used differently (`why`:
  "meaning"): 近代 / 現代, 美術 / 芸術. Only where the mix-up is real.
- `short`: one is a short form of the other: ＣＭ / コマーシャル, 金曜 /
  金曜日. `older`: one is an old or rare variant (メーター / メートル).
  `spoken`: one is an emphatic or colloquial spoken form, the same word
  (やっぱり / やはり, すっごい / 凄い). For these three give `full`: which is
  the full or standard form, `word` or `other`. They are about the whole
  word: no senses.

Most senses get nothing. Zero is a normal answer. Never add a word only to
fill a list. Far senses (tagged `arch`, `obs`, `rare`, narrow technical
ones) usually get nothing. At most 5 synonyms and 3 opposites a sense.

**Your own words.** A clear, common related word of any kind that is not
offered (a synonym, an opposite, the full form of a short word: 安保 /
安全保障) may be added with `word` (usual written form) and `reading`
(hiragana) instead of `id`. Only common modern words. The checker tells you if the
word is not in the dictionary's list, and shows its senses: pick the
right `otherSense` from them and add `"checked": true`.

## The lines

`syn` and `mix` have two lines. `line` is shown on this word's page, beside
the other word: for `syn` how the other word differs, for `mix` when to
use the other word. `reverse` is shown on the other word's page: the same
about this word. They must agree with each other.

- Say the real difference a learner needs: formality, speech or writing,
  what it is used for and with, strength, feeling. An example in Japanese
  where it helps: "Formal. Used for events and services: 式を開始する."
- Simple technical English: short sentences, one fact each, active voice,
  at most about 120 characters. Not "similar to", not "a synonym of"; do
  not make either word the subject of the first sentence.
- **Register labels say what they compare.** A label true only beside the
  other word names it: "More formal than 始める." Write a plain "Formal." or
  "Spoken." only when it is true of the word on its own. Check the tags:
  a claim against `col`, `form`, `pol` and so on is almost always wrong. A
  word built from on'yomi is not formal for that alone; a kana word is not
  spoken for that alone.
- **No claims about where a word comes from** ("native word", "Sino-
  Japanese", "from Chinese"). They were often wrong and a learner does not
  need them. "Loanword" only for a katakana word from a Western language.
- Each line is about the sense named, not the word's other senses.

## Confidence

Each item has `sure`, 0 to 1: how sure you are that it is right in this
sense. 0.95 clear, 0.8 a careful dictionary would list it, below that you
are guessing. Only 0.8 and above goes on the site; be honest, not flat.

## Output

```json
{"batch": "<BATCH>", "words": {
  "1234560": [
    {"kind": "syn", "sense": 1, "id": 1234570, "otherSense": 2, "sure": 0.9,
     "line": "More formal than 始める. Used for events and services: 式を開始する.",
     "reverse": "The everyday word for any start: 仕事を始める."},
    {"kind": "ant", "sense": 1, "word": "終える", "reading": "おえる", "otherSense": 1, "sure": 0.9},
    {"kind": "mix", "sense": 2, "id": 1234580, "otherSense": 1, "why": "sound", "sure": 0.9, "line": "...", "reverse": "..."},
    {"kind": "polite", "sense": 1, "id": 1234590, "otherSense": 1, "register": {"word": "plain", "other": "honorific"}, "sure": 0.95},
    {"kind": "spoken", "id": 1234600, "full": "word", "sure": 0.95}
  ],
  "1234561": []
},
"flags": {"1234560": "shown synonym 〜 is only a related word"}}
```

- Every word in the input once, keyed by its id as a string; `[]` when it
  has nothing. No other ids.
- `sense` and `otherSense` are sense numbers (from 1); `otherSense` for an
  offered word is one of the numbers shown with it. Whole-word kinds have
  neither.
- `flags` is optional: only real problems with `shown` rows.

Read the whole file first. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/common_relations.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
the number of items per kind, and anything you were unsure about.
