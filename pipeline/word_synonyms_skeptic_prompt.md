# Checking synonyms and antonyms of words (skeptic pass, one batch)

You are a skeptical reviewer for a Japanese dictionary for learners (aiming
at JLPT N2). Another model chose synonyms and antonyms for each sense of
some words, with a one-line nuance for each synonym. The learner will see
them on the word's page, under that sense.

You get one input file: `pairs`, each with:

- `key`, and `kind`: `synonym` or `antonym`.
- `word`: the word, its reading, and the one `sense` the pair is for
  (`[number, part of speech, tags, English]`).
- `other`: the proposed synonym or antonym, with its senses.
- `nuances`: the nuance lines the model wrote (one or two versions).

For each pair, judge with your own knowledge of Japanese:

1. **Is it real?**
   - A synonym: a learner can use `other` in place of the word, in this
     sense, in at least some common sentences, with nearly the same meaning.
     It is `wrong` if it is a broader or narrower word (果物 / りんご), a word
     of the same kind (犬 / 猫), only a related word (医者 / 病院), another
     form of the same word (始まる / 始める), a short or polite form of the
     same word (金曜 / 金曜日, 訓 / 訓読み, お風呂 / 風呂), or fits only
     another sense of the word. The same word written or read another way
     is `wrong` too: the same kanji with another reading of the same word
     (居る おる / いる, 抱く いだく / だく, 明日 あした / あす), a kana
     spelling (ほどく / 解く), a colloquial contraction (つまんない /
     詰まらない, 合わす / 合わせる). Two really different words that share a
     spelling are fine (解ける とける / ほどける).
   - An antonym: the plain opposite in this sense (勝つ / 負ける). It is
     `wrong` for a grammatical negative form (できる / できない), a mere
     contrast, or an opposite only in another sense. An established word
     made with 不・非・無・未 is a real antonym (人気 / 不人気, 公式 / 非公式).
     Pairs that differ by sex are antonyms here (祖父 / 祖母, 少年 / 少女);
     other pairs of the same kind are not (硬貨 / 紙幣).
   - `doubtful`: a careful dictionary might list it, but it would mislead a
     learner more than help, or it is a stretch.
2. **Which sense of `other`** matches: give its number.
3. **The nuance** (synonyms only): give the line to show. Keep a given one
   if it is true and useful. Otherwise rewrite it. It tells how `other`
   differs from the word: formality, spoken or written, what it is used
   for or with, strength, feeling. Simple technical English: short
   sentences, one fact each. No more than about 100 characters. It must not
   repeat either word or say "synonym of" / "similar to". A false nuance is
   an error even when the pair is right: fix it.

Be strict but fair. `ok` only when you would put the pair in a learner's
dictionary as it is (after your nuance fix).

Do not write code to judge; read and think. Do not open any other file.
Write the output file as:

```json
{"batch": "<the input's batch>",
 "pairs": {
  "<key>": {"verdict": "ok", "sense": 1, "nuance": "Formal. Used for events, services and official starts.", "fixed": false},
  "<key>": {"verdict": "wrong", "why": "Narrower: a kind of fruit."}
 }}
```

- Every pair's `key` appears once.
- `ok` needs `sense`, and `nuance` for a synonym. Set `fixed` to true when
  no given nuance was usable and you wrote a new one or corrected a fact;
  false when you kept one or only trimmed the wording. `doubtful` and `wrong`
  need a short `why`.

Then run the checker you are given, fix what it reports, and reply with one
line: counts of ok, doubtful and wrong.
