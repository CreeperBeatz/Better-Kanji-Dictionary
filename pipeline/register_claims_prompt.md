# Word lines: are the register claims true, and do they say what they compare?

A Japanese dictionary for learners (aiming at JLPT N2) shows short English
texts on its word pages. Many say a word's register: formal, written,
literary, spoken, casual, everyday, slang, polite, old-fashioned. These were
written by models, and many are wrong or misleading. Your job: check each
claim and fix the text where needed. Leave everything else as it is.

Read `data/drafts/register-claims/in/<BATCH>.json`, write
`data/drafts/register-claims/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write code to judge.

## Input

Each item: `key`, `where`, `text`, `about` (the word the text describes:
reading, its JMdict `senses` with their tags, and the `sense` meant), and:
- `synonym line`: shown on the page of the `against` word, beside `about`.
  It says how `about` differs from `against` (its `sense` given too).
- `mixup line`: when to write `about` rather than `against`.
- `sense note`: under one sense of `about`, what the word is in that sense;
  `ex` is its example (Japanese with the word in 【】, English).
- `flags`, when present: notes from a translator who thought the text (or
  its example) was wrong. Check each flag yourself; it may be wrong.

JMdict tags in the senses, as evidence: col colloquial, sl slang, fam
familiar, hon honorific, hum humble, pol polite, form formal or literary,
arch archaic, obs obsolete, dated, poet poetical, male / fem, vulg vulgar,
rare, uk usually written in kana. A claim against a tag is very likely
wrong. Most words have no tag; then judge from how the word is used.

## What is right

1. **True for this word in this sense.** 実は is everyday speech, not
   written; 基づく and 誤り are formal, not everyday; ぶつ (to hit) is
   colloquial. Do not take a word as formal or written just because it is
   built from on'yomi, or as spoken just because it is in kana. Where the
   register differs by sense, the claim is about this sense only.
2. **Says what it compares.** A synonym line sits beside one other word,
   and a label there is read as a fact about the word. When the claim holds
   only next to `against` ("Formal." meaning more formal than 意見), write
   the comparison: "More formal than 意見." Keep a plain label ("Formal.",
   "Literary.") only when it is true of the word on its own. A sense note
   has no comparison: its claims are about the word itself.
3. **Agrees with itself.** No "spoken" and "written only" in one text.

If a flag shows another error in the text (a wrong fact, the wrong word or
reading, an example that does not fit), fix that too. In a sense note you
may also replace the example (`ex`), or set it to null if no good example
fits.

Keep the style: simple technical English, short sentences, one fact each.
Change only what is wrong; keep a true text even if you would word it
otherwise. Synonym lines at most 160 characters, mixup lines 180, notes 300.

## Output

```json
{"batch": "<BATCH>", "items": {
  "<key>": "ok",
  "<key>": {"text": "More formal than 意見. Used for official or expert views: 公式見解.", "why": "formal only next to 意見"},
  "<key>": {"text": "Everyday speech, often to open a confession: 実は…", "why": "実は is spoken, not written"},
  "<key>": {"ex": {"ja": "…【word】…", "en": "…"}, "why": "the example used another word"}
}}
```

Every key once. A fix holds `text` (the whole new text), `ex` (notes only),
or both, and a short `why`.

## Work

Read the whole file first. Write the output file early and add to it in
parts, so work is saved if you are cut off. Valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/register_claims.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts of ok and fixed, and any pattern you saw.
