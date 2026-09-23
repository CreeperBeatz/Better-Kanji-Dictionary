# Translating the dictionary into Bulgarian: the brief for one chunk

You are translating one chunk of a Japanese–English dictionary into
**Japanese–Bulgarian**. The chunk holds 100 dictionary entries (or 100 kanji).
You write one JSON file with the Bulgarian glosses, run a checker, and fix
problems until it passes. That is the whole job.

The glosses are for **Bulgarian speakers learning Japanese** who use Better
Kanji Dictionary (betterkanjidictionary.org). They search in Bulgarian, they
see your glosses under each Japanese word, and they rely on them to tell the
senses of a word apart. Write what a good bilingual dictionary would print:
short, natural, exact Bulgarian, never an explanation where a word will do.

The English glosses come from JMdict/KANJIDIC (EDRDG, CC BY-SA 4.0). What you
write is published under the same licence.

---

## 1. What you are given

Your prompt names a chunk, e.g. `words-0007` or `kanji-003`. Read
`pipeline/translate/in/<chunk>.json`. Do not change any file other than your
output file.

### Word chunks: `in/words-NNNN.json`

```json
{
  "chunk": "words-0003",
  "entries": [
    {
      "id": 1341000,
      "headword": "春",
      "reading": "はる",
      "senses": [
        {"i": 0, "en": ["spring", "springtime"], "pos": ["n", "adv"]},
        {"i": 1, "en": ["New Year"], "pos": ["n"]},
        {"i": 2, "en": ["prime (of life)", "height (of one's prosperity)", "heyday"], "pos": ["n"]},
        {"i": 3, "en": ["adolescence", "puberty"], "pos": ["n"]},
        {"i": 4, "en": ["sexuality", "sexual desire"], "pos": ["n"]}
      ],
      "hints": {
        "wiktionary": [{"via": "spring (season) [noun]", "bg": ["пролет"]}],
        "wordnet": [["пролет", "пролетен сезон"]]
      }
    }
  ]
}
```

- `id`: the entry's JMdict number. Copy it as it is.
- `headword`, `reading`, `forms`: how the word is written. **Use them.** You
  know Japanese: the headword tells you which "spring" the English means
  (春 is the season, ばね is the coil, 泉 is the water).
- `senses`: one object per sense. `i` is the sense number; the numbers can
  skip values, so copy each one exactly. `en` holds the English glosses for
  that sense.
- `pos`: JMdict part-of-speech codes. The ones that matter most:
  - `n` noun
  - `v1`, `v5*` verbs
  - `vi` intransitive, `vt` transitive
  - `vs` a noun that takes する
  - `adj-i`, `adj-na` adjectives
  - `adv` adverb
  - `exp` expression
  - `int` interjection
  - `ctr` counter
  - `prt` particle
  - `suf` / `pref` suffix / prefix
- `misc`: JMdict usage notes, e.g.
  - `uk` usually written in kana
  - `abbr` abbreviation
  - `col` colloquial, `sl` slang, `vulg` vulgar
  - `arch` archaic, `hon` / `hum` honorific / humble
  - `on-mim` onomatopoeia
- `hints` (not always present): Bulgarian words that human-made sources pair
  with this Japanese word.
  - `wiktionary` came through an English Wiktionary sense, named in `via`.
  - `wordnet` lists synonyms of a wordnet concept.
  - Hints go through English, so **they are often for a different sense, or
    wrong**. Use one when it fits a sense, because it is usually the natural
    Bulgarian word. Ignore it otherwise.

### Kanji chunks: `in/kanji-NNN.json`

```json
{
  "chunk": "kanji-001",
  "kanji": [
    {
      "char": "日",
      "meanings": ["Day", "Sun", "Japan", "Counter For Days"],
      "on": ["にち", "じつ"],
      "kun": ["ひ", "-び", "-か"],
      "curated": "day, sun, Japan",
      "words": [{"headword": "毎日", "reading": "まいにち", "en": "every day"}]
    }
  ]
}
```

- `meanings` are KANJIDIC's English meanings. They are sometimes noisy, and
  can include a unit or a rare sense.
- `curated` (when present) is a hand-picked summary.
- `words` are common words written with the character, as context.

---

## 2. What you write

Write `pipeline/translate/out/<chunk>.json`: UTF-8, one JSON object, entries in
the same order as the input.

### Word chunks

```json
{
  "chunk": "words-0003",
  "by": "claude-sonnet-5",
  "entries": [
    {
      "id": 1341000,
      "senses": [
        {"i": 0, "bg": ["пролет"]},
        {"i": 1, "bg": ["Нова година"]},
        {"i": 2, "bg": ["разцвет (на живота)", "връх (на благополучието)", "златни години"]},
        {"i": 3, "bg": ["юношество", "пубертет"]},
        {"i": 4, "bg": ["сексуалност", "полово влечение"]}
      ]
    }
  ]
}
```

- `chunk`: the chunk name.
- `by`: the value your prompt gives you. If it gives none, write `"claude"`.
- **Every entry and every sense in the input must appear exactly once**, with
  the same `id` and `i`.
- `bg`: 1 to 8 Bulgarian glosses for that sense, each a word or a short
  phrase.

### Kanji chunks

```json
{
  "chunk": "kanji-001",
  "by": "claude-sonnet-5",
  "kanji": [
    {"char": "日", "bg": ["ден", "слънце", "Япония", "брояч за дни"]}
  ]
}
```

Every character in the input must appear once, with 1 to 8 meanings.

---

## 3. How to write the Bulgarian

**Sense boundaries are sacred.**
- One output sense per input sense.
- Never merge two senses, never split one, and never move a meaning from one
  sense to another.
- Translate each sense's English glosses into Bulgarian glosses for that same
  sense.
- If two English glosses come out as the same Bulgarian word, write it once.
- You may add one close Bulgarian synonym when it helps a learner.
- Put the most usual Bulgarian word first in each sense: search ranks an
  entry higher when its first gloss is exactly what was typed.

**Citation forms** (as Bulgarian dictionaries print them):
- **Nouns:** singular, indefinite (`вода`, not `водата`). Use the plural only
  for words that exist only in the plural (`очила`, `пари`).
- **Adjectives:** masculine singular, indefinite (`хубав`, `червен`).
- **Verbs:** first person singular present (`пиша`, `ям`, `отварям`).
  - Give the aspect pair as one gloss, imperfective first, when both are
    natural: `отварям, отворя`.
  - Impersonal verbs go in the third person: `вали`, `зазорява се`.
- **Transitivity matters.** Japanese pairs like 開く/開ける and 閉まる/閉める
  differ exactly here.
  - For `vi` senses, use the Bulgarian intransitive, usually with `се`:
    `開く (vi)` → `отварям се`.
  - For `vt` senses, use the transitive: `開ける` → `отварям`.
  - When a sense is both `vi` and `vt`, give both: `отварям, отварям се`.
- **Nouns that take する (`vs`):** translate the noun (`учене`), not a verb.
  The verb use is covered by the reader's grammar.
- **Expressions and interjections:** the natural Bulgarian equivalent, not a
  word-for-word version (`お早う` → `добро утро`).
- **Counters:** `брояч за …` (`枚` → `брояч за тънки плоски предмети (напр.
  листове хартия, чинии, монети)`).
- **Particles, auxiliaries and grammar words:** a short functional gloss in
  parentheses, as the English does: `(частица, отбелязваща пряко допълнение)`.

**Keep what the English keeps.**
- **Parentheses:** keep and translate the qualifiers: `to open (a door, etc.)`
  → `отварям (врата и др.)`. Use Bulgarian abbreviations: `напр.`, `и др.`,
  `т.е.`, `нещо`, `някого`.
- **Proper nouns** get capitals. Everything else is lowercase.
- **Names and places:**
  - Use the established Bulgarian form where there is one: `Токио`, `Киото`,
    `Осака`, `Хирошима`, `Фуджи`, `Шекспир`.
  - Otherwise transcribe Japanese the Bulgarian way: ち→чи, つ→цу, し→ши,
    じ→джи, しゃ→ша, ちゃ→ча, きょ→кьо, ゆ→ю, よ→йо; long vowels are not
    doubled.
- **Loanwords** (katakana): give the Bulgarian word for the meaning, which is
  often the same loan (`コーヒー` → `кафе`, `パソコン` → `компютър`). Never
  transliterate the katakana.
- **Abbreviations:** use the Bulgarian form where Bulgarians use one (`ДНК`,
  `САЩ`, `ЕС`). Keep Latin only where Bulgarians write it in Latin (`CD`,
  `DVD`, `OK`, `Wi-Fi`).

**Register:** don't add labels like `(разг.)` or `(остар.)`. The app shows
JMdict's own tags next to your glosses. Instead, choose Bulgarian of the same
register: a slang sense gets a colloquial Bulgarian word, and a polite set
phrase gets its polite Bulgarian counterpart.

**Uncertainty:** if you cannot find a good Bulgarian equivalent (a very
specialised term, a Japan-only concept), give the closest short description
and end that gloss with `?`, e.g. `вид японска сладка от ориз?`. Don't leave
senses out.

**Kanji meanings:**
- 1–5 core meanings, most important first, lowercase except proper nouns.
- Use `curated` and the example `words` to find what the character is really
  about. Drop KANJIDIC noise (units, obscure senses) unless it is central.
- Keep counter senses the character is commonly used for (`брояч за дни`).
- Don't list readings.

---

## 4. Check your work

```
python pipeline/translate/check.py <chunk>
```

It prints `<chunk>: ok`, or a list of problems:
- missing or extra entries or senses
- empty or overlong glosses
- English left in
- glosses that are not Bulgarian

Fix every problem and run it again until it says `ok`. Then stop; you're
done. Report the chunk name and anything you flagged with `?` that a human
should look at.

---

## 5. For whoever runs the agents

**Setup** (once):
```
python pipeline/fetch_sources.py wiktionary omw-bul omw-jpn   # hint sources, optional
python pipeline/translate/hints.py                            # -> pipeline/data/bg_hints.json
python pipeline/translate/make_chunks.py                      # -> pipeline/translate/in/
```

**What's left:** `python pipeline/translate/check.py --pending 20` prints the
next 20 chunks with no valid output. That is invalid ones first, then kanji,
then words, commonest first. `STATUS.md` has the totals.

**One agent per chunk.** Give it this prompt, with the chunk and model filled
in:

> Read pipeline/translate/TASK.md and follow it for chunk `words-0007`. Write
> pipeline/translate/out/words-0007.json with "by": "claude-sonnet-5", then run
> `python pipeline/translate/check.py words-0007` and fix every problem until
> it prints ok.

**Running it:**
- Chunks are independent, so run as many agents in parallel as you like. Each
  touches only its own output file.
- Start with a pilot (e.g. `kanji-001` and `words-0001`…`words-0004`) and read
  the output before scaling up.
- Commit `out/` as you go. It is source data, and the history records who
  translated what.

**Loading it:** `python pipeline/build_db.py bg` reads every file in `out/` into
the database. It loads each sense that matches a real JMdict sense, and
reports and skips anything malformed. Run `check.py` over everything before a
release. Senses without a translation fall back to English in the app, so a
partial run is fine to ship.
