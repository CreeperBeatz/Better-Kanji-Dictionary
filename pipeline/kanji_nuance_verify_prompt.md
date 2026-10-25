# Kanji nuance lines: check every line

Another model drafted, for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2), one line per item in English and
Bulgarian. You are the check. Assume nothing is right until you have read it;
fix what is wrong, leave what is right alone.

Read `data/drafts/kanji-nuance/verify/in/<BATCH>.json`, write
`data/drafts/kanji-nuance/verify/out/<BATCH>.json`. The input's `kind` says
which job the batch is. Each item has the draft in `line` {en, bg}.

## kind "similar"

An item is one meaning of a kanji (`kanji`, `meaning`, example `words`) and
another kanji listed beside it as close in meaning (`other`, `otherMeaning`,
`otherWords`). The line tells the learner how **the other kanji** differs
from this kanji in this meaning (旦 beside 日 "day": "Only the start of a day or
a single day: 元旦, 一旦."). Check:

- **Is the pair right?** Some pairs are listed by mistake: the other kanji
  does not share this meaning at all (当 "this" beside 打). Then set
  `"mismatch": true`: the row is hidden and the pair is logged as a data
  mistake. The drafter already marked some (`"mismatch": true` in the item);
  if such a pair is in fact close in this meaning, set `"mismatch": false`.
  Judge by the other kanji itself: a mismatch is a pair where **no meaning of
  the other kanji** is close to this meaning of this kanji, or where the two
  meet only through a homophone or through another meaning of *this* kanji
  (分 "divide" beside 知, close only to 分かる "understand").
- **`otherMeaning` is a guess** by the pipeline at which of the other kanji's
  meanings is the close one. If the pair is right but that label is the
  wrong meaning (家 shown as "expert, -ist" beside 屋 "house"), the pair is
  **not** a mismatch: keep it, write the line for the meaning that really is
  close, and set `"wrongLabel": true` so the label is fixed later.
- **Is the line true?** Each claim about use, words, register, strength or
  scope must hold in real Japanese. Japanese words quoted must exist, be
  written so, and use the other kanji in this sense.
- **Is it about the other kanji**, and does it say a real difference, not
  only repeat the meaning label or say "similar to"? At most ~120 characters,
  simple technical English (short sentences, one fact each).

## kind "mixup"

An item is two kanji (`a`, `b`) sharing a kun reading (`reading`), with their
meanings and words read that way. The note says when to write which, in the
form "a: …. b: …." with a word in Japanese script for each (日 / 陽, ひ: "日:
the sun and the day in everyday words, 日が昇る. 陽: sunlight or a sunny place,
mostly in writing, 陽だまり."). Check that each use is true, each word is real
and written with that kanji on that reading, and that a rare, archaic or
name-only use is said plainly. At most ~260 characters.

## Both kinds: the Bulgarian

`bg` must say the same as `en` (after your fixes), in natural, plain
Bulgarian a native speaker would write: no calques of English word order, no
Russian words, correct grammar and gender. Japanese kanji are «канджи», never
«кандзи», and the word is **neuter**, as everywhere in the app: канджито,
канджитата, друго канджи, обичайното канджи (never канджият, обичайният
канджи, този канджи). Japanese words stay in Japanese script. If you change `en`, write
`bg` again to match.

## Output

```json
{"batch": "<BATCH>", "items": {"<key>": "ok", "<key>": {"en": "...", "bg": "...", "why": "..."}, "<key>": {"mismatch": true, "why": "..."}}}
```

Every input key once: `"ok"`, or an object with only the fields that change
(`en`, `bg`, and for "similar" `mismatch`, `wrongLabel`) and `why`, a few words on what was
wrong ("en: 旦 is not used for daytime"; "bg: calque"; "mismatch: 打 never
means this").

## Work

Read the whole file first. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/kanji_nuance.py verify-check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
the counts of ok, fixed and mismatch items.
