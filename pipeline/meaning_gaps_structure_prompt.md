# Turn a skeptic's fix into exact moves

A learner's kanji dictionary splits each kanji's meanings into groups (G1, G2 …)
and puts every common word in the group whose meaning the kanji has in that
word. The catch-all holds words where the kanji is only there for its sound or a
fixed spelling. A screener flagged a problem and proposed a fix; a skeptic agreed
the problem is real but gave a **different fix**, in free text. Your job: write
the skeptic's fix as exact moves, word by word, so a script can apply it.

Follow the skeptic. Do not judge the fix again, except: if the skeptic's text is
unclear, or names a group that does not exist, use the screener's fix for that
word and say so in `note`.

For each item, give every word of the screener's flag one move:

- `to`: `"G1"`, `"G2"` … (an existing group), `"catch-all"`, `"new"` (a new group,
  only when the skeptic keeps a new group), or `"keep"` (leave the word where it
  is now; for a word in no group this means it stays hidden).
- `also`: other existing groups the skeptic says the word should ALSO be listed
  under (for a word with two senses), else `[]`.

If the skeptic keeps a new group, give `new_group`: `{"en": "...", "about": "..."}`
with the skeptic's label if it gave one, else the screener's. Otherwise `null`.

## Output

Write the JSON file named in your task, UTF-8, exactly this shape:

```json
{"batch": "st-00", "items": [
 {"id": "采-0", "moves": [{"word": "喝采", "to": "catch-all", "also": []},
                          {"word": "納采", "to": "G1", "also": []}],
  "new_group": null, "note": ""}
]}
```

Every item in the batch must be in the output, every word of its flag in `moves`.
