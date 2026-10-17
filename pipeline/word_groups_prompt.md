# Putting each sense of a word into a kanji's meaning groups (one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). Each kanji has meaning groups: the
meanings it carries in modern Japanese words. Your job: for every word, say
which group the kanji is in **for each of the word's dictionary senses**.

You get one input file (JSON). Write exactly one output file (JSON) to the
path you are given. Do not edit any other file. Do not browse the web.

**Judge every word yourself.** Do not write or run code, scripts or keyword
rules to place words or set confidences. Reading the input, thinking, and
writing the output file are the only steps. Running the checker command you
are given, at the end, is fine.

## The input

Each kanji has:

- `groups`: its meaning groups. `id` is what you write; `en` is the label;
  `about` says what the kanji does in the group's words; `known` are a few
  words already in the group (written form and reading).
- `words`: the words to do. Each has its JMdict `senses`, in JMdict's order
  (the first is usually the commonest): `[number, part of speech, tags,
  English]`. Tags: `arch` archaic, `obs` obsolete, `rare`, `uk` usually
  written in kana, `col` colloquial, and so on. A word with many senses
  shows its first 8 only.

## What to decide

For **each sense** of each word, ask: *in this sense of the word, what does
this kanji contribute?* Answer with one of:

- a group `id`: the kanji carries that group's meaning in this sense.
- `catch-all`: the kanji is there only for its sound or as a fixed
  spelling (ateji: 寿司, 生憎; names whose meaning is not felt). Its meaning
  is not present.
- `-`: none of the groups fits this sense, and it is not sound either: a
  far, figurative use that no group holds. Use it sparingly. When every sense of
  a word is `-`, the kanji has a meaning none of its groups holds (劇 is
  "severe" in 劇薬): say so in your reply, naming the word.

Rules:

- **Judge by what the kanji contributes, not by what the word means
  overall.** In 先生 the 生 is "born, live" (one born before you), not
  "teacher". In 生ビール 生 is "raw, fresh", not "beer".
- **Most words have one group in all their senses.** 上昇 is "go up" in
  every sense. Give a second group only when a sense really uses the kanji
  in a different one of its meanings: 上げる sense 1 "to raise" is `rise`,
  sense 5 "to give" is `offer`. A sense that only narrows or extends the
  same meaning keeps the same group: 上げる "to increase (a price)" is
  still `rise`.
- **Do not hedge.** Never give a sense a second group because you are
  unsure which of two fits: pick the better one and lower the confidence.
- A figurative sense goes where its picture comes from when the learner can
  still see it (燃える "to burn with passion" stays with the kanji's "burn"
  group, at a lower confidence); `-` only when no group's picture is there.
- The groups are given. Do not invent or rename groups.

Each answer has a confidence, 0.0 to 1.0: how sure you are that this group
is right for this sense. Be honest: 0.95 for clear-cut cases, 0.6 when two
groups are plausible, 0.4 or less when you are guessing. Do not give flat
confidences (0.9 on everything): a confidence that does not vary is
useless. Over-confidence is the worst error here, because what both runs
give at 0.8 or more goes on the site.

## Output format

Exactly this shape (no comments, no trailing commas, UTF-8):

```json
{
  "batch": "<the input's batch>",
  "run": "<the input's run>",
  "kanji": {
    "上": {
      "1352320": [["rise", 0.95], ["rise", 0.95], ["rise", 0.85], ["rise", 0.6], ["offer", 0.85], ["rise", 0.7], ["rise", 0.75], ["rise", 0.6]],
      "1353320": [["higher", 0.85], ["higher", 0.55]]
    }
  }
}
```

- One list per word, keyed by the word id as a string, with **exactly one
  `[group, confidence]` per sense**, in the senses' order.
- Every word of every kanji in the input appears once. No other ids.
- Every kanji in the input appears in `kanji`.

Before writing, check your output against these rules. Then write the file
with your file-writing tool, run the checker you are given, fix what it
reports, and reply with one line: how many kanji and words you wrote, and
anything you were unsure about.
