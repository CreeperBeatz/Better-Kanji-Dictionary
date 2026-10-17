# Reconciling two drafts of a kanji's meaning groups (one batch)

You are finishing data for a kanji dictionary for learners (English and
Bulgarian speakers, aiming at JLPT N2). Each kanji has **meaning groups**,
and each of its words is filed under the group the kanji has in it.

Two independent runs (A and B) have redrawn each kanji's groups under one
rule: **a group is a meaning; a pattern is a use inside a meaning**. A
pattern is a way the kanji builds words: a suffix or prefix (〜人 "a person
from …"), a counter (三人), an intensifier, a fixed grammatical role, one
reading. Kodansha shows such patterns as sub-senses (1a, 1b). The runs
mostly agree; where they differ, it is usually on one borderline group that
one run kept and the other made a use.

For each kanji you see `current` (the groups today), the link sentence
today (`link`), and both runs: their groups, each with `from` (the current
groups it takes in), its examples (as words) and its uses. `whyA`/`whyB`
say what each run changed.

## Your job, per kanji

Pick the final groups and uses **by reference**, from either run:

- A group: `"A:join"` (run A's group `join`).
- A use: `"B:join/meet"` (run B's use `meet` in its group `join`).

Rules:

- **Lean groups, uses where needed** (the owner's decision). Where the
  runs differ on a borderline group, keep it a group only when its words
  carry a meaning a learner could not get from the other groups; otherwise
  make it a use under the group whose meaning it carries. 人 "person",
  "others" (人気), "character" (人柄): three meanings. 出 "attend" (出席,
  出場) is "go out" to an event: a use.
- **No word left homeless.** If a run added a group the other lacks
  because its words fit nothing else (合 "between": 合間, 沖合), keep it.
- When you take a group from one run, you may add uses from either run
  (refer to them by their own run and group). If the other run has the
  same group, put its id in `absorb` (`"B:join"`), so its `from` is kept.
- Every current group should end up in some new group's `from` (or a use's
  `from`). The script warns where one doesn't; those words get placed
  again, which is fine when the split was meant.
- 1 to 6 groups, 0 to 4 uses each, most common group first. Prefer the
  run whose wording is clearer; you may override `en`, `bg`, `about`,
  `aboutBg` of a group when neither run's is right (rules: `en` 1 to 4
  words, at most 40 characters; `bg` natural Bulgarian, at most 40
  characters; kanji are «канджи», never «кандзи»; `about` one or two
  plain sentences, one fact each).
- You may rename a group (`id`: short lowercase a-z, 0-9, -), but keep
  the run's id when it is fine: current ids that keep their meaning should
  stay.

Then write the **link**: one or two sentences, in simple technical English
(short sentences, one fact each, no poetry), on how the kanji's meanings
grow from one another, naming the new groups in order. `link` today shows
the style; it may name groups that no longer exist, so do not copy it
blindly. `linkBg`: the same in natural Bulgarian.

## Output

```json
{"batch": "<batch>", "kanji": {
  "合": {
    "groups": [
      {"take": "A:join", "absorb": ["B:join"], "uses": ["A:join/each-other", "B:join/meet", "A:join/mix"]},
      {"take": "A:fit", "absorb": ["B:fit"], "uses": ["A:fit/rule"]},
      {"take": "B:degree", "absorb": ["A:degree"], "uses": []},
      {"take": "A:between", "uses": []}
    ],
    "link": "From things coming together comes joining; things that join well fit. …",
    "linkBg": "…",
    "note": "Optional, one short sentence: what you decided where the runs differed."
  }
}}
```

Optional per group: `"id"`, `"en"`, `"bg"`, `"about"`, `"aboutBg"` to
override the taken group's.

Judge yourself; do not write code to decide. Write the output file with
your file-writing tool, then run the checker you were given; it must report
0 problems (notes about current groups being placed again are fine when you
meant the split). Reply with one line: how many kanji, and those where you
overrode a run or chose between different group sets.
