# Data issues

The dictionary should be ground truth, so every mistake found in the data is
written down here, with what was done about it. Add an entry the moment one
is found, even if nothing is done yet; move it to **Fixed** when it is.

Each entry: an id, when it was found, what is wrong (with an example), where
it comes from, and its status. Statuses:

- **open**: known, nothing done yet
- **in review**: in the review queue (/review), waiting for a person
- **partly fixed**: some of it done; the entry says what is left
- **fixed**: done; the entry says how and where

## Open

### D-001 · Frequent kanji with no JLPT level
*Found 2026-10-04.* 分 的 無 可 身 韓 岡 阪 狙 埼 里 have no JLPT level in our
kanji data, though 分 is basic N5/N4 vocabulary. Meanings were drafted only
for JLPT N5–N2 kanji, so these got no meanings task, and their Bulgarian
cards opened with no groups behind them.
Source: the kanji data's `jlpt_new` field (a modern reconstruction).
Selection used: jōyō, no JLPT level, and frequency rank ≤ 1000 or school
grade ≤ 2.
**Status: partly fixed** (2026-10-05). Meanings tasks drafted (two runs,
96.5% agreement) and queued for all 11: 11 meaning-group items and 706 word
placements. The meanings scope is now "every kanji with a meanings task", not
"JLPT N5–N2", so progress counts them. The JLPT level itself is still missing in the data (search filters
and the map's levels still leave them out).

### D-002 · All Bulgarian is machine-translated and unchecked
*Found 2026-10-04.* Every Bulgarian gloss (30,200 words) and kanji meaning
(10,350 kanji) came from a machine translation. It sometimes picks the wrong
sense: 生 is "Life, Genuine, Birth" in English but "живот, раждам се, ученик"
(student) in Bulgarian.
Source: jmdict-kanjidic-bg (`mt:claude-sonnet-5`).
**Status: in review.** The Bulgarian stage has one card per in-scope word and
per jōyō/JLPT kanji (32,545). Each card opens once its kanji's meaning groups
are accepted. Corrections show on the site at once. This database is the
source of truth: `python -m server.review export` writes them to
data/bg_reviewed.json, the next data build searches by them, and
jmdict-kanjidic-bg takes them when its `scripts/build.py` is run. Both are
done by hand, when the admin decides.

### D-003 · KANJIDIC English meanings with noise
*Found 2026-10-02.* 合 is listed as "Fit, Suit, Join, 0.1". The "0.1" is the
old unit 合 (a tenth of a 升), shown as a bare number.
Source: KANJIDIC2 meanings, shown verbatim.
**Status: open.** No task type covers kanji English meanings yet. How many
kanji have this kind of noise is not known.

### D-004 · Decompositions that lose or invent parts
*Found 2026-10-02* (TASK-forms-review.md §5 A).
- 五 → 力: 五 is given 力 as a part, so 語 (via 吾) "contains" 力.
- 段 has only 殳; the left half is missing.
- 為 is only 灬.
- 並 is only 二.
- 午 → 干: a lookalike (午 is a pestle, 干 a shield); all 66 kanji on 午
  inherit 干. 午 should be atomic (handbook case, 2026-10-05).
- 牛 → 二: a stroke split; 牛 should most likely be atomic.

Source: cjk-decomp / topokanji, through pipeline/decomp.py.
More of the same, found 2026-10-06 in a random sample of 80 in-scope kanji
that never reach the queue (no source disagrees, so nothing flags them):
車 = 二 日 and 斤 = ⺁ 丅 (stroke splits), 以 = 丨 丶 人 (bare strokes from a
source), 皮 = 又 and 良 = 艮 (parts lost), 且 = 目 (a lookalike), and, open to
argument, 交 = 亠 父 and 自 = 目. That is 6–8 in 80, so roughly 150 of the
1,950 in-scope kanji the queue never shows.

Source: cjk-decomp / topokanji, through pipeline/decomp.py.
**Status: in review** (2026-10-06). The queue was started over (every card
back, nothing decided), so 午's fix is undone until its card is decided
again. A check card has no *reject* any more: a character's card asks what
it is built from, with answers that say what they do. Rules now look at
every character in scope (pipeline/decomp_drafts.py: one part only, strokes
in no part, a bare stroke, no source splits it, these data issues), and a
Sonnet draft with its proof sits on every parts card: 1,010 characters, 571
drafted differently from today (161 at confidence 0.8 or more). All of the
kanji named above have a card. See D-018 for what the drafts say about the
basic kanji.

### D-005 · 龰 has no form link to 止
*Found 2026-10-04.* 龰 (the bottom of 足 走 定) is 止 written at the bottom,
but nothing records that, so its page cannot borrow 止's meaning.
**Status: in review.** A drafted form link (龰 is a form of 止) is in the
queue. (The IDS stroke split 人 卜 for its parts was rejected; see the
handbook case.)

### D-006 · Drafted word placements: the no-meaning box used as a shrug
*Found 2026-10-04.* The meanings drafts sometimes put a word in "the kanji
brings no meaning" when the model could not decide. 沖合 (offshore) is one:
its 合 is the ordinary "area, extent" sense, as in 歩合.
Source: the subagent drafts (`ai:claude-sonnet`).
**Status: in review.** Every placement is checked on its kanji's meanings
board. The handbook warns about this box.

### D-013 · In-scope words with no Bulgarian at all
*Found 2026-10-05,* when review widened from JLPT N5–N2 to everything common
or rated (server/scope.py). 396 words in scope have no Bulgarian gloss:
mostly words on a JLPT list that JMdict does not mark common, which the
translation run (jmdict-kanjidic-bg) did not take in.
Source: the Bulgarian translation's selection, not a mistake in a gloss.
**Status: fixed** (2026-10-05). Translated as chunks words-s001..s004
(pipeline/translate/out), built in, and queued as 396 Bulgarian cards.

### D-014 · Words filed under kanji they are not written with
*Found 2026-10-05,* drafting meanings for the widened scope. A kanji's word
list (word_char) takes in every written form of an entry, so 広報 is listed
under 弘, 町 under 街, 受ける under 請. The drafting runs placed them at low
confidence; loading drops any word whose headword lacks the kanji (787 of
10,588), as D-011's rule already does for the kanji page.
Source: JMdict alternative spellings in word_char.
**Status: handled at load.** Nothing dropped reaches the queue.

### D-015 · Parts in common kanji with no recorded meaning
*Found 2026-10-06.* 187 parts inside in-scope kanji have no KANJIDIC meaning
(after the radical-number filter), no Kanji Alive line and no form link to
borrow one from, so their page says "no recorded meaning". The most used are
丷 (in 243 in-scope kanji: 前 業 米 首), 卄 (230), 𠂇 (100: 左 右 友 有),
⺁ ⺈ 𠂉 (62–75), 丆 龴 龰 龷 𠮛 ⺍ ⺺ 覀. They are of three kinds:
- forms of a real kanji with the link missing: 𠂇 = 又, ⺺ = 聿, 㔾 = 卩,
  覀 = 襾, 兑 = 兌, 夹 = 夾, 录 = 彔 (and 龰 = 止, D-005);
- rare real characters KANJIDIC leaves out: 夋 堇 劦 豖 冎 壴 桼 罙 仌;
- shapes that several unrelated old parts merged into, with no one meaning:
  丷 is 八 in 半, grains in 米, hair in 首, the top of 止 in 前.
Also 卌's KANJIDIC meaning is "40", which `real_meanings` drops as filler.
Source: KANJIDIC has no entry for most bound parts; the form links are
incomplete.
**Status: in review** (2026-10-06). 卌 is fixed: a bare number is kept when
it is a kanji's only meaning. A new stage, *part meanings* (`part_meaning`),
holds a part's own meaning or a shape's name, shown on its page in place of
"no recorded meaning". All 186 other parts were drafted
(`pipeline/part_drafts.py`, Sonnet subagents): 102 shapes, 45 meanings, 39
forms of a kanji. Queued locally: 147 part meanings and 17 new form links;
the other 22 forms of agreed with links already waiting. The drafts judged
18 waiting form links wrong (丷|从, 丷|八, ⺀|皿, ⺁|厂, 龷|北 …): each says
so on its part's card, for the reviewer to reject.

### D-016 · School grades from before the 2020 revision
*Found 2026-10-06.* The 2020 school curriculum moved the 20 prefecture
kanji (茨 媛 岡 潟 岐 熊 香 佐 埼 崎 滋 鹿 縄 井 沖 栃 奈 梨 阪 阜) into
grade 4, and shifted some others between grades 4–6. Our data still gives
them grade 8 (secondary school): 岡 has grade 8. Anything that reads the
grade (ordering, filters) treats them as later kanji than they are.
Source: KANJIDIC's `grade`. Found while comparing Tsalta's kanji book, whose
Kanken levels follow the same old lists (岡 = 2級, now 7級), so the book
can't be used to fix it.
**Status: open.** Needs the current official grade list, which also gives
the current Kanken levels for the jōyō kanji.

### D-017 · Old forms that are compatibility code points
*Found 2026-10-06.* 62 of the 366 Unihan old forms are CJK compatibility
ideographs: 侮 > 侮 (U+FA30), 僧 > 僧, 器 > 器, 墨 > 墨. The old shape differs
from today's only in a detail (每 for 毎, 臭's 犬). Many fonts draw the two
the same, so the page says "the old form of 侮 is 侮". Unicode
normalisation (NFC), which copy-paste and many tools apply, turns the old
code point into the modern one.
Source: Unihan kJapaneseOldVariant, through
pipeline/forms.py.
**Status: open.** A display problem, not a wrong link: the old forms come
from an official list and are not reviewed (D-019). These could show the
font_old glyphs (jp78/jp83) instead of the text character.

### D-018 · The basic pictographs are split into lookalikes
*Found 2026-10-06,* by the parts drafts (D-004). The graph gives the most
used simple kanji parts that only look like pieces of them: 日 = 口 (382
in-scope kanji contain 日), 土 = 十 (370), 木 = 八 十 (318), 田 = 冂 土,
大 = 人, 王 = 土, 白 = 日, 小 = 八, 中 = 口, 宀 = 冖, 艹 = 卄, 扌 = 二.
By the handbook's rule (the 午 case: a lookalike is not a part) each of
them is atomic, and the drafts say so, mostly at confidence 0.85–0.95.
Through them, 1,611 of the 2,679 in-scope kanji contain a character whose
parts a confident draft would change.
Source: cjk-decomp / KRADFILE-style visual splits, through pipeline/decomp.py.
**Status: in review; the rule is decided** (Dani, 2026-10-06): a base kanji
stays whole; otherwise the split the sources give (KanjiVG, IDS, Цалта),
then the old form; a memorable split goes in the notes. A second pass
(pipeline/decomp_drafts.py, `prepare --new`) checks every character in scope
against it: 155 that a source keeps whole but the graph splits (止 = 丄 卜,
用 = 二 冂, 糸 = 小 幺, 示 = 二 小, 西 = 兀 囗), and every split fewer than two
sources give. 324 characters had no card; each now has one, with a draft
under the new rule (91 proposals, 233 checks; 离 without a draft).
Audit of what no rule flags (`prepare --audit 60`, data/drafts/decomp-audit):
a random 60 of the 1,687 characters two sources back and nothing flags,
judged by Sonnet under the same rule: 0 wrong (only order, or 竹 written
⺮). With 0 in 60, the error rate there is below 5% at 95% confidence.
A second sample of 300 more (`--audit 300 --seed 300 --exclude …`,
data/drafts/decomp-audit-300): one disagreement, 貝 = 八 目 (the draft
would keep it whole as a base pictograph, at 0.55, against every source).
Over all 360: at most 1 wrong, so below about 1.3% at 95% confidence. It
points at the one kind the rules can't see: a base pictograph that every
source splits (貝 見 音 穴 玄 辛 舛 元 舌 支 高 among the in-scope radicals).

### D-019 · Built form links nobody reviewed
*Found 2026-10-06.* The 471 links pipeline/forms.py builds (char_form) went
live unreviewed; the queue held only new proposals. A wrong "form of" lends
its meaning to every kanji with the part.
Source: Unihan kJapaneseOldVariant (366 old forms) and pipeline/forms.py's
own lists (positional forms, form of, looks like, same thing).
**Status: in review** (2026-10-06, pipeline/form_checks.py): the 41 pairs
written by hand (the two directions of a link counted once) are checks on
their characters' cards. The 366 old forms are not reviewed (Dani,
2026-10-06): they come from an official list (Unihan kJapaneseOldVariant,
which matches the Jōyō Kanji Table; 青 靑 and 清 淸 added by hand, both the
standard old forms). Card and page show their source; a doubt is a report.

### D-020 · Цалта's split lost where the book writes a part as a shape
*Found 2026-10-06* (Dani, on 区). The kanji book writes some parts with
katakana or rare code points: 区 = 匚 + メ, 勾 = 勹 + ム, 現 = 𤣩 + 見. None
of them is in the graph, so the whole split was left out of the sources
(decomp_source) and the card and page named no Цалта where he agrees.
68 splits were lost this way; another 46 entries draw a part with no
character at all (the top of 京), and are partial.
Source: the transcription (Documents/JapaneseDictionaries), through
pipeline/decomp_sources.py.
**Status: partly fixed** (2026-10-06): plain identities are mapped
(メ 㐅 → 乂, ム → 厶, 𤣩 → 王, ⺗ → 㣺, 𭕄 → ⺍, 黾 → 黽; BOOK_SHAPES), which
recovers 34. The other 34 use a shape the graph has no part for (施's 𭤨,
賞's 𫩠, 歓's 𮥶): still left out, rather than read as something else.

### D-021 · Latin letters inside Bulgarian words
*Found 2026-10-06.* The machine translation typed some Bulgarian words with a
Latin letter: граничa, чертa, дashi. The meaning drafts have умe (梅), групa
(輩, 塊), старa (薩) and решa (櫛). The words look right but search never
finds them. Latin on its own (NHK, COVID-19) and stress marks (какà, самò)
are correct.
Source: the Bulgarian translation (`mt:claude-sonnet-5`) and the meanings
drafts.
**Status: in review.** Reviewers fix them on the cards. A Bulgarian field
with a Latin letter shows a warning; nothing is refused.

## Fixed

### D-007 · 主 lost its dot
*Found 2026-10-04.* 主 had only 王 as a part; the flame 丶 on top was dropped.
**Fixed 2026-10-04** by review: 主 = 丶 王. People may now use single strokes
as parts after a confirmation; data sources still may not.

### D-008 · 龶 was a dead end
*Found 2026-10-02.* 青 → 龶 + 月, and 龶 had no meaning, no parts and no
link, so learners called it "king".
**Fixed 2026-10-02** in the forms data: 龶 is a form of 生, and looks like 王
(labelled as a mnemonic only).

### D-009 · Override lines that broke real parts into strokes
Topokanji's override lines split real parts into strokes (口 → 丨一, 門 →
丨彐月), and 艹 → 卄 → 廾 made every grass kanji "contain" 廾.
**Fixed** by guards in pipeline/decomp.py.

### D-010 · `fix(...)` override lines read as atomic
Override lines written `fix(...)` were read as "no parts".
**Fixed** in pipeline/decomp.py. (The research ordering in order-n2.tsv
predates the fix.)

### D-011 · Words filed under a kanji only through a rare spelling
夫 is filed under 人 because of its rare spelling 良人, which would read as a
mistake in 人's word list.
**Fixed:** a word is listed, drafted and queued under a kanji only when its
headword contains it.

### D-012 · Sources that spell a shape we keep apart
IDS and KanjiVG sometimes write 厂 for ⺁, which we treat as a different shape.
**Fixed:** such spellings are left out of the queue's proposals
(pipeline/review_sources.py).

## Known limits (not mistakes, but worth knowing)

- A corrected Bulgarian gloss shows everywhere at once, but searching by
  Bulgarian text still finds the word by its old wording until it is
  exported (`python -m server.review export`) and the data is rebuilt.
