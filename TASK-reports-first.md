# Reports first: users report problems, AI fixes them

Branch `feat/reports-first` (off main 60b5a78). Agreed with Dani 2026-11-02.

## The idea

BetterRTK is a data-first platform. We label automatically what we can.
Users do not label. They report what they see wrong, in free text with
optional images. We read the reports in Claude Code, check them, find the
common pattern, and fix all its cases with AI agents. There is no UI for
that analysis.

The site keeps two jobs:
1. Show the data.
2. Take reports.

The review screen keeps one job: a list of reports, each linking to the
kanji or word it is about.

## Decisions (Dani, 2026-11-02)

- Only signed-in users can report. Signed-out visitors see "Sign in to
  report a problem".
- No direct edit on the page, also not for the admin. Every change goes
  through Claude Code.
- The analysis has no UI. It runs in Claude Code.

## The trap: the review store is live data

`data/review/review.db` is not only a queue. The site reads it:
- `live` rows = accepted values (decompositions, meanings, Bulgarian, ...).
- OPEN proposal items = the drafts the site falls back on
  (`review._open_drafts` -> `site_meanings`, `site_usage`): kanji_senses,
  kanji_extras, usage, sure word_sense placements. Bulgarian overlay too.

So: **do not close, withdraw or delete queue items**. The store stays as
it is and becomes plain storage. Only the screens and routes that label go.
AI fixes keep writing through `review.direct(...)` as the bot account, so
each fix is logged and can be reverted. Dani's decisions stay protected
(`_decided`, DECIDED_* guards in the pipelines).

Guard test: before and after every removal step, the site API answers for a
fixed sample of kanji and words (page, meanings, usage, bg, graph, offline
pack key) must be byte-identical. Add `tests/site_unchanged.py` first.

## Parts

### 1. Report dialog (site)
- One "Report a problem" link on the kanji page and the word card. It
  replaces "Suggest changes" (PageEdit/KanjiEdit) and "The English meaning
  is wrong".
- Fields: free text (required, up to 4,000 characters) and up to 3 images
  (png/jpeg/webp, up to 5 MB each; check the type by its first bytes, not
  the file name). Paste from the clipboard works on desktop.
- Captured automatically, not typed: subject (`kanji:生` / `word:123`, from
  the page; may be empty for a general report), page URL, UI language,
  data version (pack key + commit), screen size, and the card it was sent
  from.
- Stored as today: item type `report`, origin `suggestion`, in review.db.
  The images go to `data/reports/files/<item id>/`. Only the admin and the
  reporter can see them.
- After sending: "Thank you. We check every report." Simple technical
  English, en + bg.

### 2. Reports screen (admin)
- `/review` becomes one list: newest first, filter open / fixed /
  not a mistake / duplicate.
- Row = text, image thumbnails, subject as a link to its page (new tab),
  reporter, date, captured context folded.
- Actions: set the status, plus one optional reply line. Nothing else.

### 3. Reporter sees the answer
- Account popup: "Your reports", each with status and reply
  (`suggestions_of` already exists). No notifications for now.

### 4. Remove labeling
- Web: Queue, Workbench, CharacterCard, MeaningsBoard, BgCard, Extras,
  Handbook, Onboarding, Progress, PageEdit, Stage steps, research buttons,
  dictionaries tab (BookViewer etc.), only what nothing else imports.
- Server: queue/decide/card/board/progress/verified routes; decomp
  PUT/DELETE; the `reviewer` role (existing reviewers become users).
  Then delete the code in `server/review.py` that only those used. Keep:
  storage, `live_value`, `site_*`, `direct`, `revert`, `history`,
  `backup`, bg overlay, pack key.
- Tests: drop the labeling tests, keep `review_safety` cases that still
  apply, and keep `site_unchanged`.

### 5. Claude Code side (CLI, no UI)
- `python -m server.reports export <dir>`: open reports as JSON plus their
  images, for reading in Claude Code. Runs read-only on the Pi over ssh.
- `python -m server.reports close <id> <status> [reply]` and a batch form
  from a JSON file. This writes to prod, so it runs only with Dani's go,
  like every other prod write.
- Fixes themselves = pipeline scripts calling `review.direct` as the bot
  account, with a dry run first. Log each pattern in DATA-ISSUES.md.

### 6. Deploy
- Check prod's review.db for existing `report`/`suggestion` items and keep
  them (the local store is behind prod).
- `site_unchanged` against a copy of prod before the switch.
- Needs Dani's go: merge to main, deploy, Pi .env unchanged.

## Open, not blocking
- The public "not everything is checked" / draft marks: with no human
  checking, do they still mean anything? Ask Dani at part 4.
- Rate limit for reports (e.g. 20 per user per day)? Default yes, easy to
  lift.
