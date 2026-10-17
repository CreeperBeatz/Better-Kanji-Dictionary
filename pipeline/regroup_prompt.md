# Regrouping a kanji's meanings: meanings, not patterns (one batch)

You are drafting data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). Each kanji has **meaning groups**,
and each of its words is filed under the group the kanji has in it.

The kanji in this batch already have groups (`current`), but they mix two
different things, and that makes words impossible to place. 人 has
"person", "person of a kind" and "counting people" as three groups, yet in
村人, 商人 and 三人 人 simply means *person*: "of a kind" and "counting" are
ways the kanji **builds words**, not other meanings. Your job is to draw the
groups again, keeping the two apart:

- **A group is a meaning**: what the kanji means in the word. Test: a
  learner who knows group X understands the word's kanji without learning
  a new idea. 人気 "popularity" uses 人 as *other people, the public*:
  that is a new idea, so a group of its own. 人柄 "personality" uses 人 as
  *a person's nature*: another. 村人 "villager" does not: it is a person.
- **A use is a pattern** inside a meaning: the kanji as a suffix or prefix
  (〜人 "a person of/from …": 日本人, 村人; 〜人 "one who does …": 商人,
  料理人), as a counter (三人), as an intensifier (打ち〜), in a fixed
  grammatical role, or with one reading. A use belongs to the group whose
  meaning it carries. Kodansha often shows these as sub-senses (1a, 1b, 2a).

Rules:

- **As few groups as the meanings need.** Most kanji: 2 to 4. A very common
  kanji is not entitled to more groups because it has more words. Merge
  groups that a learner could not tell apart in the words (人 "person" and
  "human"; 物 "thing" and "substance" if the words do not keep them apart).
  Keep apart what learners really meet as different meanings (物 "thing"
  and 物 "person, figure" as in 人物, if the words bear it out).
- **Keep current ids** where a group keeps the same meaning (`person` stays
  `person`); say which current groups each new group takes in (`from`).
  A current group that becomes a use is listed in the use's `from`.
- Order groups from most to least common in the words.
- `catch-all` (sound only, fixed spellings, names) always exists and is
  never listed.
- Read the words. The dictionaries are evidence, not rules; go by modern
  usage in the listed words.

## Output, per kanji

```json
{"batch": "<batch>", "run": "<run>", "kanji": {
  "人": {
    "groups": [
      {"id": "person", "en": "person, people", "bg": "човек, хора",
       "about": "A human being. The kanji says the word is about a person or people.",
       "from": ["person", "human"],
       "examples": ["<word id>", "<word id>"],
       "uses": [
         {"id": "of", "en": "a person of/from …", "about": "After a place, group or time: who someone is.",
          "from": ["kind"], "examples": ["<id>", "<id>", "<id>"]},
         {"id": "counter", "en": "counting people", "about": "After a number: how many people.",
          "from": ["count"], "examples": ["<id>", "<id>"]}
       ]},
      {"id": "others", "en": "other people", "bg": "другите", "about": "…", "from": ["others"], "examples": ["…"], "uses": []}
    ],
    "why": "One or two sentences: what you merged, split or turned into a use, and why."
  }
}}
```

- `id`: short lowercase a-z, 0-9, -; unique within the kanji (use ids only
  within their group). `en`: 1 to 4 words. `bg`: natural Bulgarian, short;
  kanji are «канджи», never «кандзи». `about`: one or two plain sentences
  for a learner (short sentences, one fact each).
- `examples`: 2 or 3 word ids from the list that show the group (or use)
  best: common, clear cases.
- `uses`: 0 to 4 per group, only patterns that cover several words.

Judge yourself; do not write code to decide. Write the output file with your
file-writing tool and reply with one line per kanji: the new groups (and
uses), and what changed from `current`.
