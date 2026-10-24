# Words read the same: when to write which (one batch)

You are drafting data for a Japanese dictionary for learners (aiming at JLPT
N2). Each item is two different dictionary words that are **read the same**
and share some English meaning: 食料 / 食糧 (しょくりょう), 改定 / 改訂
(かいてい), 課程 / 過程 (かてい). Learners hear one word and write the other.
On each word's page, under its sense, the learner will see the other word
with one line that tells it apart.

You get one input file. Each item has `key`, `reading`, `a` and `b` (each:
`word`, `reading`, and all its `senses` `[number, part of speech, English]`),
and `shared`, the English they share.

For each item, judge with your own knowledge of Japanese:

1. `kind`:
   - `near`: two words with nearly the same meaning in some sense, told apart
     by use: 食料 (food in general) / 食糧 (staple food, rations); 改定 (revise a
     rule, a price) / 改訂 (revise a text, a book); 込む / 混む.
   - `sound`: they only sound alike; the meanings differ, even if the English
     overlaps a little: 課程 (a course of study) / 過程 (a process); 泣く / 鳴く.
     These are still worth showing: learners mix them up when they write.
   - `same`: one word, written two ways, with no difference a learner should
     know (聞く / 訊く as plain "ask" can be this; 綺麗 / 奇麗). Also when one
     spelling is only a rare or old one.
   - `wrong`: not a pair a learner needs (for example a name, or one word is
     far too rare to meet).
2. For `near` and `sound`: `aSense` and `bSense`, the numbers of the senses
   where they meet (for `sound`, the senses a learner confuses).
3. For `near` and `sound`: `onA`, the line shown on **a's** page about **b**,
   and `onB`, the line shown on **b's** page about **a**. Each tells when to
   write the other word, or what it means instead. Use the kanji where they
   help ("糧 is food to live on: rations, staple food. 食糧不足."). Give one
   short typical word or phrase in Japanese script.
   - Simple technical English: short sentences, one fact each. At most
     about 140 characters. Never "similar to" or "synonym of".
4. For `same` and `wrong`: a short `why`.

Do not write code to judge; read and think. Do not open any other file.
Write the output file as:

```json
{"batch": "<the input's batch>",
 "items": {
  "<key>": {"kind": "near", "aSense": 1, "bSense": 1, "onA": "…", "onB": "…"},
  "<key>": {"kind": "same", "why": "訊く is a rarer spelling of 聞く in the sense 'ask'."}
 }}
```

Every item's `key` appears once. Then run the checker you are given, fix
what it reports, and reply with one line: counts of near, sound, same and wrong.
