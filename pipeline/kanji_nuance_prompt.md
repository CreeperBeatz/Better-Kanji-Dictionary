# Kanji of the same meaning, kanji easy to mix up (one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). You get one input file (JSON). Write
exactly one output file (JSON) to the path you are given. Do not open any
other file. Do not browse the web. Do not write code or scripts: read,
think, write the file, then run the checker you are given and fix what it
reports.

The input's `kind` says which job the batch is.

## kind "similar": a nuance line

Each item is one meaning of a kanji (`kanji`, `meaning`, example `words`)
and another kanji with a close meaning (`other`, `otherMeaning`,
`otherWords`). On the kanji's page, the other kanji is listed beside this
meaning. Write its `nuance`: one line that tells the learner how **the other
kanji** differs from this kanji in this meaning.

- Say the real difference: what it is used for, in which words, how
  formal or literary it is, how strong, how narrow. Use the words given
  as evidence, and your own knowledge of Japanese.
  - 旦 beside 日 (day): "Only the start of a day or a single day: 元旦, 一旦."
  - 曜 beside 日 (day): "Only a day of the week: 曜日, 月曜日."
  - 康 beside 健 (health): "Peace and good health together; mostly in 健康 and 小康."
- Write about the other kanji. Do not make the line only a repeat of the
  meaning label; using its words inside a real difference is fine ("Change
  by force: 改革."). Quote 1 or 2 short words in Japanese script where they help.
- Simple technical English: short sentences, one fact each, active voice.
  Not childish. At most about 120 characters.
- Never write "similar to", "a synonym of" or "also means X" alone. If
  there is truly no difference a learner should know, say what is typical
  ("Same meaning. Rare outside names.").
- Some pairs are listed by mistake: the other kanji does not share this
  meaning at all (当 "this" beside 打). Still write a line that says what
  the other kanji really means, and add `"mismatch": true` to the item.

## kind "mixup": a note for kanji easy to mix up

Each item is two kanji (`a`, `b`) that share a kun reading (`reading`), with
their meanings and words read that way. Learners write one for the other.
Write a `note`: when to write which.

- One short sentence per kanji, in the form "a: …. b: …." Give each
  kanji's use on this reading and one word in Japanese script.
  - 日 / 陽, ひ: "日: the sun and the day in everyday words, 日が昇る. 陽: sunlight
    or a sunny place, mostly in writing, 陽だまり."
- If one of them is rare, archaic or used only in names on this reading,
  say so plainly ("朔: rare; write 一日 or 1日 for the first of the month.").
- At most about 260 characters.

## Both kinds

- `bg`: the same text in Bulgarian, natural and plain. Japanese kanji are
  «канджи», never «кандзи». Keep every Japanese word in Japanese script.

## Output

Exactly this shape (UTF-8, no comments, no trailing commas), every input
item once, keyed by its `key`:

```json
{
  "batch": "<the input's batch>",
  "items": {
    "日|日.day|旦": {"en": "Only the start of a day or a single day: 元旦, 一旦.", "bg": "Само началото на деня или един ден: 元旦, 一旦."}
  }
}
```

For "similar" items `en`/`bg` is the nuance; for "mixup" items it is the
note. Then reply with one line: how many items you wrote, and anything you
were unsure about.
