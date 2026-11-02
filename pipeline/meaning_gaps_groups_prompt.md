# Write the new meaning groups, in English and Bulgarian

A learner's kanji dictionary splits each kanji's meanings into groups. A check
found meanings that no group holds, and words that need them. For each new group
below you get the kanji's existing groups (follow their style), the proposed
label and note, and the words that will go in it. Write the group as the site
will show it.

## The fields

- `id`: a short id, lower-case a-z, 0-9 and hyphens, 1-3 words (`on-purpose`,
  `sudden`, `army`). Not one of the kanji's existing ids.
- `en`: the label, 1 to 4 words, like the existing labels ("estimate, plan").
- `about`: one or two short sentences, in the style of the existing notes.
  Simple technical English: short sentences, one fact each, common words, no
  idioms. Say what the kanji means in these words; you may name one of them.
- `bg`: the label in Bulgarian, at most 40 characters, like a dictionary gloss.
- `aboutBg`: the note in natural Bulgarian, the same facts. A kanji is
  "канджи" in Bulgarian, never "кандзи". Japanese words stay in Japanese script.
- `drop`: `true` only if, on reflection, this is not a meaning of the kanji
  itself but one word's idiom or a word-building pattern (then the other fields
  may be empty). Otherwise `false`.

Keep the labels distinct from the kanji's existing labels, so a learner can tell
the groups apart.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape:

```json
{"groups": [
 {"key": "故-N1", "id": "on-purpose", "en": "on purpose", "bg": "умишлено",
  "about": "Done on purpose, not by chance. The kanji has this meaning in 故意.",
  "aboutBg": "Направено нарочно, а не случайно. Канджито има това значение в 故意.",
  "drop": false}
]}
```

`key` is the heading of each group in the input (`故-N1`). Every group in the
input must be in the output.
