# Task: forms, fonts, meaning groups, and a reviewed labeling queue

Branch: `feat/forms-review` (off `main` at 3683e28). Written 2026-10-02 from a
design conversation with Dani; nothing below is built yet unless it says so.

This file is the hand-off. Read it whole before writing code — the
"Pitfalls" section is there because each item is an easy wrong turn.

---

## 1. Why this exists

Dani felt stuck between two things:

- making associations easier by using *unofficial* breakdowns (the ones
  learners pass around), at the risk of losing nuance, and
- the *wrong* decompositions inherited from open data (cjk-decomp / topokanji).

The example that unlocked it was **青**. Its top part, 龶, is not a common
character, so many learners call it "king" (王). In our data it is a dead end:
`青 → 龶 + 月`, and 龶 has no meaning, no parts and no variant link
(`cjk-decomp.txt` says `龶:msp(丰)`, the topokanji override says
`龶:fix(十,二)` — neither is right). The real story is **生 over 丹**, plainly
visible in the old form **靑**: 生 gives the meaning ("grow, sprout" — 青 covers
green, 青信号, 青葉) *and* the reading セイ, which 青 passes on to
清 晴 精 請 静 情. "King" works for 青 alone and costs the learner six kanji.

A dictionary author told Dani that the usual tiebreaker for a component is the
**old form, from before the jōyō reform** — and that often both the new and the
old analysis are "correct". Both are, for different questions:

> **The modern shape decides the order; the old shape decides the story.**

- *What does it look like now?* — modern form only. This drives containment,
  the graph and the ordering (spec constraint 3: never teach a kanji before one
  it visually contains). 青 visually contains 月, full stop.
- *Where does it come from, what does each part do?* — the old form is
  evidence. This drives part meanings, role notes, and the story layer.

Old forms are evidence for the story layer. **They are not a second graph.**

The scope then grew to four user-facing features and one piece of
infrastructure, all agreed with Dani:

1. Show the **forms** of a kanji or part: positional forms, the old form, what
   a bound part is a form of, and popular lookalike mnemonics (clearly marked).
2. Show the kanji in **several fonts** side by side (print vs handwriting, old
   vs new glyph shapes).
3. On the kanji page, **group the words by which meaning of the kanji they
   use**, instead of one flat list.
4. **Fix wrong decompositions**, with a human approving anything that isn't
   mechanically obvious.
5. Infrastructure: **account roles** and a general **labeling queue** that 1,
   3 and 4 all feed into.

---

## 2. Decisions already made (don't reopen these)

- **Three account types:** `admin` (Dani only), `reviewer`, `user` (the default).
- **Reviewers are approved by hand.** A user says in the UI that they want to
  contribute; Dani approves or declines. For now Dani only approves people they
  trust (teachers, people from the embassy, friends).
- **No peer review.** A reviewer's decision goes live on its own; nobody reviews
  the reviewers. *But every decision is logged* (who, when, before/after,
  reason), and an admin can revert any of them in one click. That's there for
  honest mistakes, not trolls.
- **The AI can propose and explain, never approve.** Auto-accept is a
  mechanical rule (§6), not a confidence threshold.
- **Don't adopt an off-the-shelf labeling tool** (Label Studio, Argilla, …).
  The volume is hundreds to low thousands of items with a handful of reviewers,
  and the review screens need domain views (glyphs, part trees, old forms,
  containment diffs) a generic tool can't render. Extend the app's own panel.
- **Font comparison is side by side**, not a font switcher.
- Free/open sources only (standing project rule). Check the licence of any new
  data source before using it.
- Every UI string is in English *and* Bulgarian (`strings({...en}, {...bg})`
  pattern used throughout `web/src`).

### Still open — ask Dani
1. **Part 0 deploy:** the decomposition write routes are open on production
   today (§3). Dani hasn't yet said whether to ship the lock on its own first.
   Recommend yes.
2. **Wording in the queue:** "proposal / approve" or "suggestion / accept".
   Settle it before building the UI.

---

## 3. What already exists (verified 2026-10-02)

| Thing | Where | State |
|---|---|---|
| Decomposition editor + review queue UI | `web/src/review/DecompPanel.tsx` | Built, **hidden** (comment in `web/src/App.tsx` near the phone tab bar: "putting it back is one line") |
| Override API + cost-ranked `/review` queue | `server/routes/decomp.py` | **Live on production, writes unauthenticated** |
| Override storage | `server/store.py` `set_decomposition` → `data/associations/store.json` `["decomposition"]`, mirrored to `data/decomp_overrides.json` (tracked in git) | `{}` locally and on prod |
| Overrides applied live | `server/routes/graph.py:41,54,82`, `server/routes/atlas.py:42` | Yes, no rebuild needed |
| Pipeline reads overrides | `pipeline/decomp.py` `USER_OVERRIDES` | Top layer, beats both source files |
| Hand-curated decompositions | `pipeline/decomp.py` `CURATED`, `ALIASES` | 食=人良, 里=田土, anonymous nodes → 良 徴 放 直 呂, … |
| Positional form groups | `server/kanji_parts.py` `_VARIANT_GROUPS` | Server code only, not in DB, not shown. Already notes `"玉王龶", "生龶"` |
| Whole-kanji variants (Unihan) | `pipeline/similar.py` `variants()` → `similar` table `kind='variant'` | Shown as "Other forms" (`DetailPanel.tsx`, `OtherForms`). Includes `kJapaneseOldVariant`: 売→賣, 読→讀, 会→會, 芸→藝, 弁→瓣辨辯. Also links 亻↔人, 氵↔水, 忄↔心㣺, 扌↔手 |
| **No** link 青↔靑 | Unihan has none | Must be curated |
| Curated meanings (Kanji Alive) | `kanji_curated` table, stage `meanings` | One line per kanji: 生 "life, be born, student", 青 "blue" |
| KANJIDIC meanings | `kanji.meanings` | Too coarse to group by: 生 = Life, Genuine, Birth |
| Words for a kanji | `server/routes/search.py` `words_for_kanji` (top 12 common by nf), page shows 8 | Flat list |
| Fonts | `web/src/theme.css:34-35` | `--mincho: 'Shippori Mincho'`, `--gothic: 'Zen Kaku Gothic New'` |
| Accounts | `server/auth.py` (`data/auth/auth.json`), deps `optional_user` / `require_user` in `server/routes/auth.py` | No roles yet |
| Mail | `server/mail.py` (Resend) | Works on prod |
| AI calls | `server/kanjify.py`, `server/semantic.py` via OpenRouter | **Key capped at $5/week, shared with the live site** |
| Offline pack | `server/offline.py` | Includes kanji table and each kanji's common words; **version stamp includes the overrides file** (line ~81) |

Bound-form meanings are mostly empty or useless: 龶 `[]`, ⺤ `[]`, 亻 "Radical
Number 9", 罒 "Net Radical Variant (no. 122)".

---

## 4. The parts, in build order

Order: **0 → 1 → 3 → 2 → 4 → 5 → 6.** Each part is usable on its own; commit
each one separately.

### Part 0 — Lock the decomposition write routes (tiny)
- `PUT /api/decomp/{char}` and `DELETE /api/decomp/{char}` require reviewer or
  admin. `GET /overrides` and `GET /review` can stay public.
- Until Part 1 lands, "admin" = the account whose email matches an
  `ADMIN_EMAIL` env var.
- Done when an anonymous `PUT` returns 401 and a signed-in non-admin gets 403.
  **Don't test this against production with a real write.**

### Part 1 — Account roles (small)
- Add `role` to the user record in `auth.json` (missing = `user`). Seed Dani as
  admin from `ADMIN_EMAIL` at startup; there's no UI to grant admin.
- A `require_role("reviewer")` dependency (admin passes too), next to
  `require_user`.
- **Request to contribute** (Account page): a short form ("who are you, how do
  you know Japanese"). It creates a pending request and emails Dani through
  `server/mail.py`. One open request per user.
- **Admin page:** pending requests (approve / decline), reviewers (revoke).
  Approving sets the role, revoking resets it. Log both.
- `_public(user)` must not leak the role or email of other users. A small
  "reviewer" badge on public cards is fine if Dani wants one; ask.

### Part 3 — Font strip (small, front-end only)
- Under the big glyph on the kanji page: the same character in 3–4 labelled
  fonts, side by side.
  - Mincho: Shippori, already loaded.
  - Gothic: Zen Kaku, already loaded.
  - **Textbook (教科書体-like):** handwriting shapes, e.g. Klee One, OFL.
  - **Brush:** e.g. Yuji Syuku, OFL.
- The point is print vs handwriting (令 心 北 糸 木 differ) and, where a font
  supports it, old vs new shapes inside one code point: two-dot 辶 in 遡 謎,
  葛, 𠮟/叱. Try `font-variant-east-asian: jis78 | jis90 | jis04` and check
  which fonts actually implement the matching OpenType features. Don't assume
  they do; show a variant only if it renders differently.
- Self-host subsets (jōyō + bound forms) and load them only when the strip
  scrolls into view. CJK fonts are megabytes each, and the phone speed work
  (`web/scripts/perf-*.mjs`) must not regress.
- Old forms like 靑 are **different code points**, so they belong in Part 2, not here.

### Part 2 — Forms block (medium)
- New table `char_form(char, other, kind, source, note)`, built in a new
  pipeline stage (`build_db.py` `@stage("forms", …)`). `kind` is one of:
  - `positional`: 人·亻, 水·氵·氺, 衣·衤·𧘇 … Move `_VARIANT_GROUPS` here and
    have `server/kanji_parts.py` read it from the DB.
  - `old`: 青·靑, 売·賣, 会·會 … from Unihan `kJapaneseOldVariant` plus
    curated gaps.
  - `form_of`: a bound part *is* this kanji, squashed or moved: 龶→生, ⺤→爪,
    罒→网, 亻→人, 礻→示 … Curated, then reviewed (task type B).
  - `looks_like`: a popular mnemonic lookalike: 龶→王. Curated and reviewed.
    **Always shown labelled as a mnemonic, never as etymology.**
- `source` is `unihan`, `curated`, or `review:<decision id>`.
- On the page, a "Forms" block replaces today's "Other forms" row. A bound part
  with no meaning of its own shows the meaning of what it's `form_of`, so 龶
  reads "a squashed 生 (grow), as in 靑 · looks like 王".
- Add these rows to the offline pack if the offline kanji page shows forms; check
  `tests/offline_parity.py`.

### Part 4 — Labeling queue (large)
The framework every task type in §5 runs on.
- Storage: decisions are app data like notes. Keep them in the store
  (`data/associations/store.json` or a sibling file), **not** in the SQLite DB,
  which is rebuilt and swapped on deploys.
- Each **item** has: `id`, `type`, `subject` (the char, or char+word),
  `current`, `proposed`, `source` (`ids-diff`, `kanjivg-diff`, `old-form`,
  `ai:<model>`, `human:<user id>`), `reason` (free text, the AI's or the
  reviewer's), `evidence` (links/glyphs to show), `status` (`open`,
  `auto-accepted`, `accepted`, `edited`, `rejected`, `skipped`), `decided_by`,
  `decided_at`, `supersedes` (the decision it replaced, for revert).
- Accepted decisions are applied like today's decomposition overrides: an
  overlay the server reads live and the pipeline reads as its top layer.
- **Revert** = a new decision restoring the previous value. Never delete
  history.
- **Export:** a script writes accepted decisions to tracked files
  (`data/decomp_overrides.json`, plus new ones per type) for Dani to commit, so
  the research pipeline and rebuilds see them.
- UI: put `DecompPanel` back as a general **Review** screen (reviewers and
  admin only):
  - a queue filtered by type, worst-cost first
  - one view per task type
  - keyboard-friendly: accept, edit, reject, skip
  - a per-reviewer history list

### Part 5 — Meaning groups (large; the most valuable for learners)
- This is spec constraint 2 ("meaning range in a few words", Halpern-style)
  finally getting built. Tasks C and D in §5.
- Pipeline: an AI drafts groups for the 979 N5–N2 kanji first (N1 later), then
  assigns each common word to a group. Results come back as task items. A
  reviewer accepts them; low-confidence word assignments go to the queue
  automatically.
- Page: "Words using 生" becomes one short list per meaning (label + 3–5 words,
  "more" to expand), plus the catch-all group at the end.
- `words_for_kanji`'s limit of 12 is too few to fill several groups. Add a grouped
  endpoint rather than raising the default (the offline pack hard-codes
  `WORDS_FOR = 12`).

### Part 6 — Fill the queues (medium)
- **IDS diff:** compare our parts with an IDS source (CHISE IDS or BabelStone
  IDS; **check the licence first**) for the N5–N2 closure (~1,370 nodes).
- **KanjiVG diff:** compare with KanjiVG's component groups (already a source,
  CC BY-SA).
- **Old-form diff:** kanji whose `old` form decomposes differently from the
  modern one. These become `form_of` / part-meaning proposals (the lexicographer's
  tiebreaker), **not** decomposition changes. See §5 A.
- **The existing `/review` ranking** (high fan-out, many bound parts, single-use
  parts).
- **Show Dani the counts per type before loading anything.**

---

## 5. The labeling task types

Shared rules for every type: an item shows its evidence; the reviewer can
accept, edit then accept, reject (reason optional) or skip; the decision is
logged and can be reverted; nothing the AI produced is live until a person
accepts it or the auto-accept rule in §6 passes.

### A. `decomposition` — which parts does this kanji visually contain?
- **Question:** what are the direct components of X *as it is written today*?
- **Subject:** one character (a kanji or a bound form); `current` and
  `proposed` are both ordered lists of parts.
- **Proposals come from:**
  - IDS / KanjiVG disagreeing with us
  - the cost-ranked queue
  - known oddities (五→力 edge, so 語 "contains" 力; 段 has only 殳; 為=灬; 並=二)
  - reviewers' own edits from the graph
- **Reviewer sees:**
  - big glyph, current tree vs proposed tree
  - the old form for reference
  - **impact**: which kanji gain or lose a prerequisite (containment changes
    upstream), how many target kanji are affected, and which public notes or
    Kanjify brackets mention a part that would disappear
- **Rules:**
  - judge by the modern shape. The old form may explain a part, but a part that
    isn't visible today is not a component (青 has 月, not 丹).
  - parts must be nodes we know, or a new bound form the reviewer explicitly
    creates
  - no bare strokes as parts
  - no self-containment, no cycles
  - repeated parts collapse (品=口) by design
- **On accept:** becomes the decomposition override for X.

### B. `form_link` — how does this form relate to another character?
- **Question:** what is the relationship between X and Y?
- **Subject:** a pair (X, Y). `proposed.kind` is one of `positional`, `old`,
  `form_of`, `looks_like`, with an optional `note` (e.g. "the 月 in 青 was 丹,
  red pigment").
- **Proposals come from:**
  - Unihan variants not yet classified
  - `_VARIANT_GROUPS`
  - bound forms in the closure with no or placeholder meaning (龶 ⺤ 罒 亻 …)
  - old-form diffs from Part 6
  - the AI, which must cite the old form or a reference as evidence
- **Reviewer sees:** both glyphs in several fonts, the old form if any, the
  kanji that use X, and the AI's evidence.
- **Rules:**
  - `form_of` needs historical support (old form, standard reference)
  - `looks_like` needs nothing but stays labelled as a mnemonic
  - one `form_of` per bound form; several `looks_like` are allowed
  - a reviewer may reject a `looks_like` that misleads (e.g. points at a
    semantically wrong kanji the learner will also meet)
- **On accept:** a row in `char_form` (Part 2). A `form_of` also lets the bound
  part show its parent's meaning.
- **Does not** change containment edges. Ever.

### C. `kanji_senses` — what are the meanings of this kanji?
- **Question:** what are the 2–6 meanings this kanji carries in modern Japanese
  words?
- **Subject:** one kanji. `proposed` is an ordered list of groups, each with
  an `id` (stable, e.g. `生.raw`), an English label of 1–4 words, a Bulgarian
  label, and an optional note.
- **Proposals come from:** the AI, given KANJIDIC meanings, the Kanji Alive
  curated line, readings, and the kanji's top ~40 common words with glosses.
- **Reviewer sees:** the groups, a handful of example words per group (from a
  provisional assignment), and the KANJIDIC/Kanji Alive lines for comparison.
- **Rules:**
  - groups are defined by what the kanji does in words, not by English
    dictionary senses (青 = blue / green / young-unripe)
  - 2–6 groups; merge anything that wouldn't give at least two common words
  - a fixed **catch-all** group (`sound / fixed spelling`) always exists, needs
    no approval, and isn't counted. Words like 寿司, 生憎, 亜米利加 go there.
- **On accept:** the sense list becomes the target for task D. Changing an
  accepted list (splitting, merging, deleting a group) **reopens the word
  assignments in that group**.

### D. `word_sense` — which meaning does the kanji carry in this word?
- **Question:** in word W, which of kanji X's groups is X using?
- **Subject:** a (kanji, word) pair. `proposed` is a group id, or `catch-all`.
- **Proposals come from:** the AI in batch, **one call per kanji with all its
  words**, not one call per word. The AI returns a confidence.
- **Reviewer sees:**
  - the word, its reading and glosses, maybe an example sentence (Tatoeba is
    already in the DB)
  - the kanji's groups as buttons
  - the AI's pick and reason
- **Rules:**
  - pick by what X contributes to W, not by what W means overall
  - a word may use two kanji in different groups (each pair is its own item)
  - catch-all for ateji and fixed spellings
- **Auto-accept:** only under the §6 rule. Low-confidence or disputed items go
  to the queue.
- **On accept:** the word shows under that group on the kanji page.

### Not in scope yet (mention, don't build)
- `part_role`: semantic / phonetic / form role of each part (spec constraint 1).
  Same framework, and the old-form evidence feeds it, but Dani hasn't asked
  for it yet.
- Reviewing user notes (associations), and peer review of reviewers.

---

## 6. What "mechanically obvious" means (auto-accept)

An item is auto-accepted only if **all** of these hold. Otherwise it waits for
a person.

- **`decomposition`:**
  - at least two independent sources (IDS, KanjiVG, KRADFILE) agree on the
    proposed parts
  - it adds **no new containment edge**: it only removes a part, or replaces a
    part with one it already contains
  - X is not a self-listed radical (口, 門 …)
- **`form_link`:** only `kind = old` taken straight from Unihan
  `kJapaneseOldVariant`, or `positional` already in `_VARIANT_GROUPS`. Nothing
  else.
- **`kanji_senses`:** never.
- **`word_sense`:** two independent model runs (different models, or the same
  model with different prompt orders) agree, the confidence is high, and the
  kanji's sense list is already accepted. Spot-check a sample of
  auto-accepts before trusting the rule. If more than a few percent are wrong,
  tighten it.

Auto-accepted items are logged like any other decision (`decided_by: "auto"`)
and appear in an admin "auto-accepted" list for spot checks.

---

## 7. Pitfalls — what not to do

**Pedagogy**
- **Don't let old forms change containment.** 青 contains 月 because that's
  what's on the page. If the old form starts creating graph edges, the
  ordering constraint breaks.
- **Don't present a lookalike as etymology.** "Looks like 王" is fine as a
  labelled mnemonic. "龶 means king" is false, and it hides 生's セイ reading
  from six other kanji.
- **Don't build Heisig primitives by the back door.** Easy invented splits
  were rejected (spec constraint 1). Form-only splits are allowed only where
  the real source is useless to a learner (段's left side), and only as
  `looks_like` / form notes, never as graph edges.
- **Don't force words into meanings.** Ateji and fixed spellings go to
  catch-all; a wrong meaning teaches something false.
- **Don't use KANJIDIC glosses as the sense list.** They're too coarse, and
  sometimes polluted ("Fit; Suit; Join; 0.1" for 合).

**Data**
- **Don't edit `pipeline/build.py`.** It's the frozen research artifact behind
  `order-n2.tsv`. New work reads `pipeline/decomp.py`.
- **Don't drop the guards in `decomp.py`.** Topokanji's override lines break
  real primitives into strokes (口→丨一, 門→丨彐月). A bound-form guard exists
  because 艹→卄→廾 once made every grass kanji "contain" 廾.
- **Don't fold lookalikes that aren't the same shape.** `ALIASES` is only for
  code points that draw identically. ⺈≠刀, ⺁≠厂, ⺍≠⺌, 㔾≠卩.
- **Don't put review decisions in the SQLite DB.** It's rebuilt and swapped
  on every data deploy (see the deployment notes); decisions would vanish.
- **Watch `data/decomp_overrides.json`:** it's tracked in git *and* written on
  the Pi. A `git pull` in `deploy/update.sh` can conflict with or overwrite
  reviewers' work. Make the Pi store the source of truth and export into git
  deliberately.
- **Every accepted decomposition triggers an offline pack rebuild** (~80 s,
  ~600 MB RSS on the 4 GB Pi), because the pack's version stamp includes the
  overrides file. A reviewer accepting 20 items in a row must not cause 20
  rebuilds: debounce or batch.
- **Don't orphan notes.** Public notes and Kanjify brackets refer to parts.
  The impact view must list them before a decomposition that removes a part is
  accepted.

**AI**
- **The OpenRouter key has a $5/week cap and the live site uses the same
  key.** Batch per kanji, run small samples first, log spend, and stop if a
  run is interrupted (a stopped benchmark once still spent ~$1.30). Use a
  separate key for bulk drafting if Dani gives one.
- **Model choice:** GPT-6 Luna (low effort) is the measured default here.
  **Avoid Haiku 4.5 for kanji work**; it scored 30/64 on the semantic
  benchmark.
- **Validate model output server-side.** Kanjify once returned a variant (毎
  for 每) that isn't in the graph. Reject any character or group id that isn't
  in the allowed set.
- **Never let the AI approve,** and don't turn its confidence into
  auto-accept on its own (§6).

**Security and accounts**
- Gate every write behind `require_role`, and test anonymous / user /
  reviewer / admin for each route.
- Never send another user's email or role in public payloads.
- Don't grant admin through any UI or API; it comes from config.

**Process**
- **Other agents share the main working tree** and have switched its branch
  mid-task. Work in a separate worktree or a careful branch. Merge with
  `git commit-tree` / `update-ref` rather than checking out `main` under
  someone else.
- Commit on `feat/*` freely. Ask before committing to `main`, and always
  before deploying.
- Before any frontend deploy: `npm run build`, **check its exit code** (it
  runs `tsc -b`), then load the page in headless Chromium (playwright) and check
  for page errors.
- Back up `data/auth` and `data/associations` on the Pi before a deploy that
  touches accounts or the store.
- Don't reintroduce features Dani deferred or rejected (SRS, the Similar view,
  the radical picker) or any non-free content (WaniKani, Heisig, jpdb).

---

## 8. Where to look

- Spec and findings: `README.md`, `FINDINGS.md`, `pipeline/README.md`
- Decomposition: `pipeline/decomp.py`, `pipeline/verify.py` (invariants),
  `server/routes/decomp.py`, `server/routes/graph.py`, `server/routes/atlas.py`
- Variants: `pipeline/similar.py` (`variants()`), `server/kanji_parts.py`
- Kanji page: `web/src/detail/DetailPanel.tsx`, `web/src/similar/SimilarRows.tsx`
- Review UI to revive: `web/src/review/DecompPanel.tsx`
- Accounts: `server/auth.py`, `server/routes/auth.py`, `web/src/account/`
- AI patterns to copy: `server/kanjify.py` (prompt + validation),
  `server/semantic.py`
- Offline: `server/offline.py`, `web/src/local/`, `tests/offline_parity.py`
- Pipeline stages: `pipeline/build_db.py` (`@stage(...)`)
