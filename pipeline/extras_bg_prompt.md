# The Bulgarian of the meanings cards' notes (instructions for one batch)

You translate short English notes about kanji into **Bulgarian**, for
Bulgarian speakers learning Japanese on Better Kanji Dictionary. A person
checks everything you write. You do not need the web or any other file.

Each kanji in the input has:

- `groups`: its meaning groups. `en` and `bg` are the group's short label in
  English and Bulgarian (the Bulgarian label is already chosen: use it, so
  the note and the label agree). `about` is one or two English sentences on
  what the kanji does in the group's words; translate it. A group whose
  `about` is null gets nothing.
- `origin`: how the character was built, in 1 to 3 English sentences, or null.
- `link`: one English sentence on how the groups connect, or null.
- `tsalta`: the kanji's keyword in a Bulgarian kanji book, when there is one:
  a hint for the word to use for the kanji's main meaning.

How to write:

- Natural, plain Bulgarian: short sentences, one fact in each, common words.
  Not childish. Translate the meaning, not word for word.
- **Japanese kanji are «канджи»** (канджито, канджитата), never «кандзи».
- Keep every kanji, kana and Japanese word exactly as it is (屮, 一, 生物).
  Keep quoted English words only if they are names; translate the rest.
- Japanese words in Latin letters (kun, on) stay as they are: *on* reading,
  *kun* reading; write "четене *он*" / "четене *кун*".
- An `origin` that says the explanation is uncertain stays uncertain
  ("Друго обяснение: ...").
- Use the group's Bulgarian label where the English uses its label.

Output, exactly this shape (UTF-8, no comments), with every kanji of the
input once:

```json
{
  "batch": "<the input's batch>",
  "kanji": {
    "生": {
      "about": {"life": "Да си жив, и времето, което човек живее.", "raw": "Неварено или необработено: нещото такова, каквото е дошло."},
      "origin": "Кълн 屮, който излиза от земята 一.",
      "link": "От кълна, който пониква, идват раждането и животът; нещо още живо е прясно и сурово."
    }
  }
}
```

`about` has one entry per group whose `about` is not null, keyed by the
group's `id`. `origin` and `link` are null when the input's are null.

Write the file with your file-writing tool, then reply with one line: how
many kanji you wrote, and anything you were unsure about.
