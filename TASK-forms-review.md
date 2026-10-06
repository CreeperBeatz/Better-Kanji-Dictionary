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
3. **Group a kanji's words by which meaning of the kanji they use.** Changed
   by Dani 2026-10-02: the kanji page keeps a short flat list (the 5–10 most
   common words) plus a "see all words" button; the grouping lives in the
   search view that button opens. See Part 5.
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
- **Two words, by where an item comes from** (Dani, 2026-10-02):
  - a **proposal** is newly marked data that enters through the review queue:
    an IDS/KanjiVG diff, an old-form diff, an AI draft.
  - a **suggestion** is a change someone asks for after spotting a mistake
    *on the page* (a "suggest a change" action on a kanji, part, form or word
    group).

  Both land in the same queue as items and are decided the same way. The
  `origin` field (`proposal` | `suggestion`) drives the wording in the UI, and
  the queue can filter on it.

### Decided with Dani, 2026-10-06 (the characters stage)
1. **Production starts with a blank queue.** Local decisions are tries; Dani
   decides again there (§9). *Why:* start clean, one record of who decided what.
2. **One card per character**, its questions numbered by kind on every card:
   **1** built from, **2** related characters, **3** a part with no meaning.
   *Why:* everything about a character in one place, and the number says what
   is expected (the handbook's chapters carry the same numbers). Don't split a
   kind of question into a stage of its own: an old-forms list was built and
   removed the same day for exactly that.
3. **Parts rule (D-018):** a base kanji stays whole; otherwise the split the
   sources give (KanjiVG, IDS, Цалта), then the old form; an easy-to-remember
   split goes in the notes; what each part "does" (meaning, sound) is out of
   scope for now. A base pictograph every source splits (貝 見 音 …) is a
   reviewer's call, on a card (`BASE_CHECK`). *Why:* splitting 日 into 口 helps
   no learner; this is a dictionary, so mnemonic splits must not pass as real ones.
4. **Name the source instead of "official / unofficial":** KanjiVG, IDS, Цалта,
   cjk-decomp, topokanji, or BKD (this dictionary's own) when none gives it.
   The AI draft is labelled *Sonnet* on the card; once accepted the page says
   BKD. Цалта shown publicly is fine; quote him properly in a later pass.
5. **The draft is one answer** ("Use the draft"), just before "No parts" (always
   last); it takes the place of any answer with the same parts; only the draft
   has *Edit*; no "something else" when there is a draft. *Why:* fewer, clearer
   choices; editing starts from the AI's answer.
6. **Nothing picked where it matters:** a draft below 0.6, or a link check with
   nothing proposed, starts empty and save waits. *Why:* a tired reviewer must
   not save an unsure answer unread.
7. **The bar for "accurate":** every character in scope is backed by two of
   KanjiVG / IDS / Цалта, or decided by a reviewer. Measured: 360 random
   characters that pass every rule, at most one doubtful (貝, now a card), so
   below ~1.3% wrong. Rerun `decomp_drafts.py flags` after the queue.
8. **Old forms are not reviewed.** They come from an official list (Unihan
   kJapaneseOldVariant, as the Jōyō table prints them); the card shows them as
   information with the source, and a doubt is a report. *Why:* only data we
   drafted or wrote by hand needs a person; the 41 hand-written links stay as checks.
9. **Цалта's entry on every card the book has**, split or not; his katakana
   shapes read as the graph's part where it is the same thing (メ is 乂, D-020).
10. **Mistakes no card can fix are reported** ("Something else is wrong?" on
    every card and page), never made live: they go to DATA-ISSUES and upstream.
11. **Research in Claude** opens claude.ai with a prompt holding the card's
    questions and every answer offered, on the reviewer's own subscription;
    the prompt is also copied, for when the page opens empty.
12. **Explanations in the UI are simple technical English** (ASD-STE100 style:
    short sentences, one fact each, an example), not childish.
13. Dani's own local keeps of 段 and 里 stand; Dani would decide the same in production.

### Answered by Dani, 2026-10-02
1. **Who may suggest:** any signed-in user. A user's suggestion goes into the
   queue. **Reviewers and admins edit directly**: their change goes live at
   once, logged as a decision like any other (and revertible), without passing
   through the queue.
2. **Deploying:** no deploy plan until Dani is back on the Pi's network. Build
   and commit everything on feature branches; don't plan or attempt a deploy.
3. **AI drafting runs on Claude Code Sonnet subagents, not OpenRouter.** Up to
   20 in parallel, one task each (e.g. one batch of kanji), each writing its
   result to a JSON file. A script then validates those files and loads them
   into the queue as `proposal` items with `source: "ai:claude-sonnet"`.
   Nothing in the server calls a model for this.
4. **Scope:** build the whole plan.

---

## 3. What already exists (verified 2026-10-02)

| Thing | Where | State |
|---|---|---|
| Decomposition editor + review queue UI | `web/src/review/DecompPanel.tsx` | Built, **hidden** (comment in `web/src/App.tsx` near the phone tab bar: "putting it back is one line") |
| Override API + cost-ranked `/review` queue | `server/routes/decomp.py` | Writes owner-only since Part 0 (`a6eef1f` on main). **Production still runs the old, unauthenticated version until it is deployed** |
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
| Accounts | `server/auth.py` (`data/auth/auth.json`), deps `optional_user` / `require_user` / `require_admin` in `server/routes/auth.py` | No roles yet; `require_admin` = the `BETTERRTK_OWNER_EMAIL` account |
| Mail | `server/mail.py` (Resend) | Works on prod |
| AI calls | `server/kanjify.py`, `server/semantic.py` via OpenRouter | **Key capped at $5/week, shared with the live site** |
| Offline pack | `server/offline.py` | Includes kanji table and each kanji's common words; **version stamp includes the overrides file** (line ~81) |

Bound-form meanings are mostly empty or useless: 龶 `[]`, ⺤ `[]`, 亻 "Radical
Number 9", 罒 "Net Radical Variant (no. 122)".

---

## 4. The parts, in build order

Order: **0 → 1 → 3 → 2 → 4 → 5 → 6.** Each part is usable on its own; commit
each one separately.

### Part 0 — Lock the decomposition write routes — DONE, not deployed
- Branch `fix/decomp-write-auth` (5ced11d), merged into `main` as a6eef1f.
- `PUT`/`DELETE /api/decomp/{char}` need `require_admin`
  (`server/routes/auth.py`): the account whose email is
  `BETTERRTK_OWNER_EMAIL`. If that's unset, **nobody** may write; it doesn't
  fall back to "first to sign in" the way `store.claim_legacy` does. `GET`
  routes stay public. Error code `admin_only` (en + bg in
  `web/src/i18n/errors.ts`).
- Check: `.venv/Scripts/python tests/decomp_auth.py`. It covers anonymous
  (401), another user (403), the owner (200), an unset owner (403), and
  writes nothing to `data/`. It fails 9 checks against the old routes.
- **To deploy:** the Pi's `.env` must set `BETTERRTK_OWNER_EMAIL` to Dani's
  account email, or Dani is locked out too (which is safe, since the panel is
  hidden). As of 2026-10-02 the Pi was unreachable over SSH, and production was
  older than the mobile-UX merge already on `origin/main`.
- Part 1 replaces `require_admin` with `require_role("reviewer")` for review
  writes, keeping `require_admin` for admin-only routes.

### Part 1 — Account roles (small) — DONE
- Built: `server/auth.py` (roles, requests, role log), `server/routes/admin.py`,
  `require_role` in `server/routes/auth.py`, Account page "Help fix the data",
  `web/src/review/Workbench.tsx` People tab (`?admin=1` opens it). Check:
  `python tests/roles.py`; browser: `tests/sandbox.py` + `web/scripts/roles-check.mjs`.
- Deviation: admin is **derived** from `BETTERRTK_OWNER_EMAIL` on every
  request, never stored (a stored `"role": "admin"` is ignored). No separate
  `ADMIN_EMAIL`. The reviewer badge on public cards is not built (ask Dani).
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

### Part 3 — Font strip (small, front-end only) — DONE
- Built: `pipeline/fonts.py` (`build_db.py fonts` stage → `font_cover`,
  `font_old`), `GET /api/kanji/{char}/fonts`, `web/src/detail/FontStrip.tsx`
  (after the stroke order). Check: `web/scripts/font-strip-check.mjs`.
- Deviations, both for phone speed: Klee One and Yuji Syuku come from Google
  Fonts like the page's own two faces (unicode-range slices, so only the
  slice holding the character loads), injected once the strip is on screen.
  Old JIS shapes are **SVG outlines in the DB**, not subset fonts: a subset
  keeping `jp83` was 130–620 KB per font. Mincho `jp83` is exactly the JIS 2004
  change list (葛 謎 遡 箸 餅 …); 1,043 old outlines over 516 characters.
- A face is shown only if `font_cover` says it has the character *and*
  `document.fonts.load` confirms it loaded (so offline it quietly drops).
- Needs `pip install fonttools` to build; the DB check in `server/db.py`
  now requires the `fonts` stage, so **the deployed DB needs `build_db.py fonts`**.
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

### Part 2 — Forms block (medium) — DONE
- Built: `pipeline/forms.py` (`build_db.py forms` → `char_form`; curated
  lists + Unihan `kJapaneseOldVariant` + `data/form_overrides.json` on top),
  `server/forms.py`, `GET /api/kanji/{char}/forms`, `web/src/detail/Forms.tsx`
  (replaces "Other forms"; leftover Unihan variants show as "Other variants").
  `_VARIANT_GROUPS` is gone: `server/kanji_parts.py` reads positional,
  form_of and looks_like links from the DB. Check: `web/scripts/forms-check.mjs`.
- `form_of` for a non-jōyō member of exactly one positional group is derived
  (亻→人); 阝 is in two groups (阜, 邑), so it gets none. A part whose KANJIDIC
  meanings are only radical names borrows the `form_of` meaning in the page
  head ("a form of 人 · person"); see `realMeanings` / `real_meanings`.
- Added 2026-10-05: kind `kin` ("Related": the same thing drawn differently,
  隹·鳥; stored once, read both ways; never on the graph). And the graph's
  containers take in the other positional forms of the focus: 糸 shows 細
  (built from 糹, marked on the node's title and the hold card). Only groups
  without a note merge (`forms.graph_families`), so 肉/月, 玉/王, 阜/邑/阝, 小/⺌
  stay apart. Display only: no edge, fan-out or order changes.
- Old forms not in our DB (靑) show as dashed, unclickable glyphs. Curated
  notes are English only for now (data, like glosses).
- Offline: the offline page shows no similar-kanji rows, so forms are not in
  the pack either.
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

### Part 4 — Labeling queue (large) — DONE
- **Labeling handbook** (2026-10-04): `web/src/review/handbook.md`, shown as the
  Handbook tab of the review screen. Rules per task type plus worked **Cases**;
  add a case whenever a decision took thought (first one: 龰, IDS 人卜 vs 止).
  The review screen is full-window since then.
- Built: `server/review.py` (items, append-only decisions, live overlay, impact,
  export), `server/routes/review.py`, `web/src/review/{Queue,editors,Suggest}.tsx`,
  History / Auto-accepted tabs in `Workbench.tsx`; "suggest a change" on the
  kanji page's parts line and on the Forms block. `DecompPanel.tsx` is gone;
  `PUT`/`DELETE /api/decomp/{char}` are now reviewer direct edits, logged.
  Check: `python tests/review_access.py`, `python tests/decomp_auth.py`;
  browser: `tests/sandbox.py --dir X`, `tests/seed_review.py --dir X`,
  `web/scripts/review-check.mjs`.
- State: `data/review/review.db`, SQLite, one row per item, decision and live
  entry (gitignored; **back it up with data/associations before any deploy**,
  via `python -m server.review backup <file>`: the db runs in WAL mode, so a
  plain copy of the file while the server runs can miss the latest decisions).
  An old `review.json` is moved in on first start and renamed `.json.migrated`. Decompositions stay in the store,
  where the graph reads them.
- **The server no longer writes `data/decomp_overrides.json`.**
  `python -m server.review export` writes it plus `data/form_overrides.json`
  (read by `pipeline/forms.py`) and `data/meaning_groups.json`; run it where
  the decisions are (the Pi) and commit the result. `deploy/update.sh`'s
  `git reset --hard` can no longer clobber reviewers' work.
- Offline pack: its key follows `review.pack_key()`, moved only after
  `PACK_DELAY` (10 min) without a decomposition decision, so a burst of
  accepts causes one rebuild.
- Choices made: **skip is per reviewer** (the item stays open for others; no
  `skipped` status). A user may have at most 20 open suggestions and must give
  a reason. Revert is admin-only, refuses if the value changed since
  (`changed_since`), and reopens the item. Changing a kanji's sense list
  reopens the words in any group whose id disappeared **or whose English
  label changed** (catches splits; a pure rename reopens needlessly).
  `word_sense` proposals may be loaded before the kanji's senses are
  accepted; they stay out of the queue until then.

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
- Each item also has `origin`: `proposal` (entered through the queue) or
  `suggestion` (asked for from the page). See §2 for the wording rule.
- **"Suggest a change"** on the kanji page, part page, Forms block and word
  groups opens a small form prefilled with the current value. It creates a
  `suggestion` item with the suggester's reason.
- UI: put `DecompPanel` back as a general **Review** screen (reviewers and
  admin only):
  - a queue filtered by type, worst-cost first
  - one view per task type
  - keyboard-friendly: accept, edit, reject, skip
  - a per-reviewer history list

### Part 5 — Meaning groups (large; the most valuable for learners) — BUILT, drafts not loaded
- 5a done: the page keeps 8 words + "See all words with 生, by meaning";
  `*生*` in the search (`web/src/search/WordsWith.tsx`,
  `GET /api/search/words-with/{char}`). Check: `web/scripts/words-with-check.mjs`.
- 5b: `pipeline/meaning_drafts.py` + `pipeline/meaning_prompt.md`. Drafted by
  Claude Code Sonnet subagents through a workflow: 114 batches of ≤400
  words over the 979 N5–N2 kanji (41,028 kanji–word pairs). Run A drafts
  groups and places words; run B re-places them given A's groups, shuffled.
  `check` validates; `load --dry-run` counts; `load` queues (not run on
  `data/review` yet: see the counts in the hand-off message).
- The §6 word rule lives in `server/review.py` (`word_rule`, `_auto_words`):
  when a kanji's groups are accepted, each open word whose two runs agree,
  both ≥ 0.8, on a group that survived review, goes live as `auto`.
- **Drafted 2026-10-02** (228 Sonnet agents, all valid): groups per kanji
  2: 483, 3: 368, 4: 103, 5: 22, 6: 3; catch-all 2.3% of words; runs A and B
  agree on 95.0%, both ≥ 0.8 on 69.8%. Ready to load: 979 `kanji_senses`,
  39,832 `word_sense` (1,196 pairs dropped: the kanji is only in a rare
  spelling, 夫 under 人 via 良人; `*人*` leaves them out too). A spot check of
  40 would-be auto-accepts found none wrong.
- Lesson from the sample: one subagent placed 日's words with a script of
  headword rules and flat 0.93 confidences. The prompt now forbids code for
  judging; keep that line.
- This is spec constraint 2 ("meaning range in a few words", Halpern-style)
  finally getting built. Tasks C and D in §5.
- Pipeline: an AI drafts groups for the 979 N5–N2 kanji first (N1 later), then
  assigns each common word to a group. Results come back as task items. A
  reviewer accepts them; low-confidence word assignments go to the queue
  automatically.
- **Where the groups show (Dani, 2026-10-02):**
  - **Kanji page:** "Words using 生" stays a *flat* list of the 5–10 most common
    words (today: 8 of the top 12 by nf), **not** grouped. Under it, a
    "See all words with 生" button.
  - **The button opens the search view** with a kanji-scoped query (shown in
    the search bar, so it's back/forward-able like any search). It lists
    *every* word containing 生, **divided by the meaning 生 carries in each
    word**: one heading per accepted sense (label, en/bg), words by frequency
    under it, the catch-all group last.
  - Until a kanji's senses are accepted, the same view shows one flat list by
    frequency. So the button and the all-words view (5a) can ship before any
    AI work (5b).
- Build order inside Part 5:
  - **5a** (small, no AI): the button, the kanji-scoped search mode, and an
    endpoint returning all words for a char (paged; common first, then the
    rest). Leave `words_for_kanji` and the offline pack's `WORDS_FOR = 12`
    alone; the page needs ≤10.
  - **5b**: senses + word assignments (tasks C, D), then the grouped response
    from the 5a endpoint.
- "Suggest a change" for word groups (Part 4) sits on the group headings and
  word rows in that search view, not on the kanji page.
- Offline: the pack only has each kanji's top 12 words, so offline the button
  either shows those 12 (grouped if the pack carries the sense ids) or is
  hidden. Decide when building; check `tests/offline_parity.py`.

### Part 6 — Fill the queues (medium) — BUILT, nothing loaded
- `pipeline/review_sources.py count|load`: BabelStone IDS (free for any use;
  `fetch_sources.py babelstone-ids`) and KanjiVG diffs, old-form `form_of`
  proposals for parts with no KANJIDIC entry, the cost ranking. Bare-stroke
  splits, KanjiVG glyphs with strokes outside any named group, and source
  spellings of shapes we keep apart (厂 for ⺁) are left out.
- `pipeline/form_drafts.py` + `form_prompt.md`: subagents propose `form_of`
  (with evidence) / `looks_like` for bound parts with no meaning, and
  classify the Unihan variant pairs nothing classifies (`none` is dropped).
- `pipeline/book_sources.py count|load` (2026-10-06): Dani's two print
  dictionaries (server/books.py; transcribed in Documents/JapaneseDictionaries).
  The kanji book's split where it differs from ours (`tsalta-diff`), its old
  forms we lack (`tsalta`), and its view as `evidence.book` on open parts,
  forms, part-meaning and Bulgarian cards (a kanji's keyword, a word's glosses
  from either book). Cards show it with the page's scan, served to reviewers
  and the admin only and never copied into the repo or the pack. Browser
  check: `web/scripts/books-check.mjs`.
- Counts (2026-10-02), none loaded: decomposition 224 proposals over 213
  characters (IDS only 75, KanjiVG only 115, both 34; 3 would auto-accept;
  182 add a containment edge), 99 cost-ranked checks, 16 old-form links,
  35 AI form links (217 `none` dropped). Reproduce with `count` /
  `load --dry-run`.
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
- **Drafting is done by Claude Code Sonnet subagents** (≤20 in parallel), each
  given one batch and writing one JSON file under `data/drafts/<task>/`. No
  OpenRouter calls for drafting: that key ($5/week cap) is the live site's.
  Run a small sample first and look at it before fanning out.
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

---

## 9. Production deploy of the review — checklist (Dani, 2026-10-06)

Not started: wait for Dani's go-ahead, and do it from the Pi's network.

- **Production starts with a blank queue.** Every card open, nothing
  decided: local decisions (Dani's tries on 8799 — 木 五 段 里 幵 …) do not
  go to production; Dani makes them again there. Before copying the review
  store, run `python pipeline/fresh_queue.py` on a copy (server stopped; it
  backs both stores up), then check `progress()`: 0 done apart from the rule
  auto-accepts. Withdrawn items (the 366 old-form checks) stay withdrawn.
- **The store's reviewed decompositions:** production's `store.json` keeps no
  decomposition overrides except the rule auto-accepts (fresh_queue drops
  them locally; do the same to the Pi's copy, after backing it up).
- **The database:** ship the local `data/betterrtk.sqlite`, built with the
  `fonts`, `forms` and `sources` stages (decomp_source with the Цалта
  shapes, D-020). Copy it with the sqlite backup API, check sha256.
- **The Pi's `.env`:** `BETTERRTK_OWNER_EMAIL=dani.matev123@gmail.com`
  (still empty there; admin comes only from this setting).
- **The books** (Цалта's scans and transcription) are not on the Pi: cards
  there show no book entry or page. Decide with Dani whether to copy the
  transcription (kanji.jsonl) without the scans.
- **Then:** merge `feat/forms-review` into main (ask first), build `web/dist`
  (check the exit code), headless-Chromium check, send dist + models,
  `deploy/update.sh`, and the usual backups of `data/auth` and
  `data/associations`.
