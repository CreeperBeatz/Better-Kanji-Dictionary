# Synonyms and antonyms of words, one sense at a time (one batch)

You are drafting data for a Japanese dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). On a word's page, each dictionary
sense will show its **synonyms**, each with a one-line **nuance**, and its
**antonyms**. Your job: choose them for every sense of every word.

You get one input file (JSON). Write exactly one output file (JSON) to the
path you are given. Do not edit any other file. Do not open any other file.
Do not browse the web.

**Judge every word yourself.** Do not write or run code, scripts or keyword
rules to choose words or set confidences. Reading the input, thinking, and
writing the output file are the only steps. Running the checker command you
are given, at the end, is fine.

## The input

`words`: the words to do. Each has:

- `id`, `word`, `reading`.
- `senses`: its JMdict senses in JMdict's order (the first is usually the
  commonest): `[number, part of speech, tags, English]`. Tags: `arch`
  archaic, `obs` obsolete, `rare`, `uk` usually written in kana, `col`
  colloquial, `pol` polite, `hum` humble, and so on. A word with many senses
  shows its first 8 only.
- `candidates`: words that may be synonyms, found by machine (shared
  English, WordNet). Many are not synonyms. Each has `id`, `word`,
  `reading` and its first senses `[number, part of speech, English]`.
- `opposites`: words that JMdict says are opposites of the word. Often
  empty. They may also be used as antonyms.

## What to decide

For **each sense** of each word: its synonyms (0 to 5) and its antonyms
(0 to 3). Most senses have fewer. Zero is a normal answer. Never add a word
only to fill the list.

**A synonym** is a word that a learner can use in place of this word, in
this sense, in at least some common sentences, with nearly the same
meaning. Examples: 始める ≈ 開始する; 美しい ≈ 綺麗; 病院 ≈ 医院; 速い ≈ 素早い.

These are **not** synonyms:

- A broader or narrower word: 果物 for りんご, 動物 for 犬.
- A word of the same kind: 犬 for 猫, 火曜日 for 月曜日.
- A related word: 医者 for 病院, 食べる for 料理.
- Another form of the same word: 美しさ for 美しい, 始まる for 始める
  (a transitive/intransitive pair is not a synonym).
- A short form or a polite form of the same word: 金曜 for 金曜日, 訓 for
  訓読み, 経済 for 経済学 when it only shortens it, お風呂 for 風呂,
  見舞い for お見舞い, 余りに for 余り. They are just short or polite forms.
- The same word in another spelling or kanji. 上る, 登る and 昇る all read
  のぼる: they are mix-ups, not synonyms. The candidates never include
  words read the same as the word.

**An antonym** is the plain opposite of the word in this sense: 上がる ↔
下がる; 暑い ↔ 寒い; 開ける ↔ 閉める; 入口 ↔ 出口; 勝つ ↔ 負ける. These are
not antonyms: a negative form (できる / できない), a mere contrast (猫 / 犬),
or a word opposite only in a far, rare sense.

**Pairs that differ by sex** count as antonyms: 祖父 ↔ 祖母, 少年 ↔ 少女,
夫 ↔ 妻, 兄 ↔ 姉. Other pairs of the same kind do not (硬貨 / 紙幣).

**Which sense of the other word.** Give the number of the other word's
sense that matches (`sense`). For an offered word, it must be one of the
numbers shown with it.

**Your own words.** If a clear, common synonym or antonym is not among the
candidates or opposites, you may add it: give `word` (its usual written
form) and `reading` (hiragana) instead of `id`, and `sense` as `null`. Add
only common modern words a learner meets (JLPT level or newspaper words).
At most 2 own words per sense. Most antonyms will be your own words.

**Far senses.** Senses tagged `arch`, `obs` or `rare`, and narrow technical
senses, usually get nothing.

## The nuance

Each synonym has a `nuance`: one line, in English, that tells the learner
how the **synonym** differs from the word. The learner sees it next to the
synonym on this word's page. Write it about the synonym, without repeating
either word.

- Say the real difference: formality, spoken or written, what it is used
  for, what it is used with, strength, feeling.
  - 開始する for 始める: "Formal. Used for events, services and official starts."
  - 綺麗 for 美しい: "Everyday word. Also means clean."
  - 素早い for 速い: "Quick to act or react. Not used for vehicles or speed."
- Use simple technical English: short sentences, one fact each, active
  voice. Not childish. No more than about 100 characters.
- Do not write "a synonym of" or "similar to". Do not translate the word.
- If there is truly no difference a learner should know, say what is
  typical, for example "Same meaning. More common in writing."

An antonym's `nuance` is optional. Give one only if the opposition is
partial ("Opposite only for prices and numbers."). Otherwise leave it out.

## Confidence

Each pick has `sure`, 0.0 to 1.0: how sure you are that it is a real
synonym (or antonym) **in this sense**. Be honest: 0.95 for clear cases,
0.7 when a careful dictionary might or might not list it, 0.5 or less when
you are guessing. Do not give flat confidences. Over-confidence is the worst
error: what both runs give at 0.8 or more goes on the site.

## Output format

Exactly this shape (no comments, no trailing commas, UTF-8):

```json
{
  "batch": "<the input's batch>",
  "run": "<the input's run>",
  "words": {
    "1234560": [
      {"syn": [{"id": 1234570, "sense": 1, "sure": 0.9, "nuance": "Formal. Used for events, services and official starts."}],
       "ant": [{"word": "終える", "reading": "おえる", "sense": null, "sure": 0.9}]},
      {"syn": [], "ant": []}
    ]
  }
}
```

- One list per word, keyed by the word id as a string, with **exactly one
  `{"syn": [...], "ant": [...]}` per sense**, in the senses' order.
- Every word in the input appears once. No other ids.
- An item has `id` (an offered candidate or opposite) or `word` + `reading`
  (your own), then `sense`, `sure`, and `nuance` (required for synonyms).
- No word twice in one sense's list. Never the word itself.

Before writing, check your output against these rules. Then write the file
with your file-writing tool, run the checker you are given, fix what it
reports, and reply with one line: how many words you wrote, and anything
you were unsure about.
