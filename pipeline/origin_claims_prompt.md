# Word lines: is the word-origin claim true?

A Japanese dictionary for learners (aiming at JLPT N2) shows short lines
about words: under a synonym ("how this word differs") and under each sense
of a word (a note on how it is used). Some of these lines say where the word
comes from: "Native word", "Sino-Japanese", "a loanword", "from English".
Many were written quickly, and a common mistake is "Native word" on a word
built from on'yomi (点数, 場所, 助言, 娯楽): those are Sino-Japanese (漢語).

Read `data/drafts/origin-claims/in/<BATCH>.json`, write
`data/drafts/origin-claims/out/<BATCH>.json`. Use your own knowledge of
Japanese. Do not write code to judge.

## Input

Each item: `key`, `word`, `reading`, its first `senses` (English), `where`
the text is shown (`synonym line` or `sense note`), and `text`. The text is
about `word`.

## What is right

- Native (和語): a Japanese word read with kun'yomi or kana only (話す,
  言葉, 山, きれい). Words mixing kun and on (重箱 / 湯桶 readings) are
  neither purely native nor Sino-Japanese: do not call them either.
- Sino-Japanese (漢語): built from on'yomi (会話, 場所, 時代, 助言), also
  when it feels everyday.
- Loanword (外来語): from a Western language, usually in katakana (テーブル).
  Say the language only when you are sure.
- 熟字訓 and ateji (素人, 大人, 今日) read as a whole: the reading is native.
- A claim about register that follows from the origin ("Sino-Japanese, so
  more formal") must still be true for this word.

## Verdict

- `"ok"`: the origin claim is true (and so is the rest of the text, as far
  as you see).
- `{"text": "...", "why": "..."}`: the whole text again, with the origin
  claim corrected or removed, and nothing else changed unless it is false
  too. Keep the style: simple technical English, short sentences, one fact
  each. A synonym line stays at most 160 characters. If the origin was the
  line's only point, say instead what is true and useful about the word
  (formality, use, what it is said of).

## Output

```json
{"batch": "<BATCH>", "items": {
  "o00012": "ok",
  "o00013": {"text": "Formal. Used in writing and on the job: 助言を求める.", "why": "助言 is Sino-Japanese, not native"}
}}
```

Every key once.

## Work

Read the whole file first. Write valid JSON (UTF-8). Then run
`.venv/Scripts/python.exe pipeline/origin_claims.py check --batch <BATCH>`
and fix every problem it lists until it reports none. Reply with one line:
counts of ok and fixed.
