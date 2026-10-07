# Writing a kanji's origin from its old form (instructions for one batch)

You are drafting data for a kanji dictionary for learners. A person checks
everything you write. You do not need to browse the web or read any other
file.

Each kanji in the input has **no glyph origin of its own** in our source,
but its **old form** (kyūjitai, the form used in Japan before 1946) has one:
`old` is that form, `etymology` is English Wiktionary's glyph origin of the
old form, with the sources it cites.

For each kanji, write:

- `origin`: how the character was built, for a learner, in 1 to 3 short
  sentences, **summarised only from `etymology`**. Start by naming the old
  form: "Simplified from 會. 會 is ..." Name the parts and what they stood
  for, as the text says. When the text gives more than one explanation,
  give the first and say "Another explanation: ...". Add nothing that is
  not in the text, not even something you are sure of. Write it as the
  dictionary's own text: never "the field says", "Wiktionary says" or
  "according to". If the text says nothing about how the old form was
  built, write `null`.
- `originSure`: `false` when the text calls the explanation uncertain,
  disputed or "folk", or when you had to simplify a lot; otherwise `true`.
  Leave it out when `origin` is `null`.

Plain, simple English: short sentences, one fact in each, common words.
Not childish.

Output, exactly this shape (UTF-8, no comments):

```json
{
  "batch": "<the input's batch>",
  "kanji": {
    "会": {"origin": "Simplified from 會. 會 shows a lid on a pot ...", "originSure": true},
    "来": {"origin": null}
  }
}
```

Every kanji in the input must appear once. Write the file with your
file-writing tool, then reply with one line: how many kanji you wrote, and
anything you were unsure about.
