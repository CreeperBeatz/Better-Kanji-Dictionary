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

### D-022 · The road part draws with two dots
*Found 2026-10-11* (Dani, on prod). The road part is stored as 辶 (U+8FB6)
everywhere: 170 parts in the graph (52 jōyō: 近 道 送 …) and 11 live parts
decisions (逸 達 述 …). Every Japanese font draws U+8FB6 with two dots, but
近 道 送 and almost all jōyō kanji are written with one dot (⻌, U+2ECC).
Two dots are correct only for 遡 遜 謎 and most non-jōyō kanji (辻 這 逢 …;
the 2000 list of printed forms for non-jōyō kanji and JIS 2004 use two dots).
The data has no ⻌ at all; three rare kanji use ⻍.
Source: our own canonical choice (KRADFILE and KanjiVG write 辶;
pipeline/review_sources.py folds ⻌ ⻍ ⻎ into 辶).
Note: our page fonts (Shippori Mincho, Zen Kaku Gothic New) have no ⻌, so
the browser takes it from a system font.
**Status: partly fixed** (2026-10-11, deployed: c551e3f, e117d5a; prod DB
swapped, migration run on prod and on the local review store).
Dani chose "each kanji's part looks like what is written". 58 kanji now hold
⻌ and 115 hold 辶. Which kanji have one dot was measured: Noto Sans JP, Noto
Serif JP and Yu Gothic all agree (decomp.ROAD_ONE_DOT). ⻌ is a form of 辵, like 辶.
The sources stage writes the sources' 辶 the same way. A typed or proposed
part gets the right dots too (review.road_dots). data/pi-migrate/road_dots.py
fixed the 11 live splits (as the Opus bot) and 11 open cards. pipeline/form_checks.py
queued the 2 new form links. On the graph, ⻌ is radical 162 like 辶.
Left: a middle piece keeps its own dots. 随 髄 (one dot) get theirs through 迶
(two). 謎 (two) gets its dots through 迷 (one). The one note on 辶 stays on 辶.

### D-023 · Kanji made in Japan that our list misses
*Found 2026-10-14* (hero-sentence drafts). data/kokuji.txt has 24 kanji,
the ones Kodansha marks. Our own meaning notes or KANJIDIC's keywords say
these six were also made in Japan, but the list does not: 俣 簗 樫 噺 桝 椙.
So their pages do not say "made in Japan", and the drafts were told they
were not (most hero sentences left the claim out; 桝 椙 kept it).
Source: data/kokuji.txt (Kodansha only).
**Status: open.** Check against a second source before adding them.

### D-024 · Bulgarian group labels that name the wrong thing
*Found 2026-10-14* (hero-sentence drafts, Bulgarian side).
麹 «кожи, мая»: «кожи» reads as "skins"; koji is «коджи».
梧 «павловния, платан»: both are other trees; 梧 is the Chinese parasol
tree (*Firmiana*). 鯛 «платика»: a freshwater bream; 鯛 is a sea bream.
Source: the Bulgarian meaning labels (`mt:claude-sonnet-5`).
**Status: in review.** The labels are on the Bulgarian cards. The hero
sentences used the right words.

### D-025 · A verb with two meanings placed in one group only
*Found 2026-10-15* (mix-ups on the kanji page).
揚げる is in 揚's "deep-fry" group only. Its first meaning is "raise, hoist"
(国旗を揚げる), and 揚 has a "raise, lift up" group. 揚がる is in no group.
The mix-up on 上 (あげる) now names each kanji's group for the reading, so
it says 揚 "deep-fry" beside 上 and 挙.
Source: the meanings drafts (`ai:claude-sonnet`); 揚's groups are not
reviewed yet.
**Status: in review.** 揚 is in the meanings queue. A word goes into one
group only, so a verb with two meanings needs a decision on its board.

### D-026 · Core words in no meaning group
*Found 2026-10-17* (Dani, on the dictionary: some kun readings are missing
from every meaning card).
Of the common words of the 2,394 kanji with meanings, 30% of the kun words
and 24% of the on words are in no group. The kanji page does not show them.
In 204 kanji, a kun reading has no word on any card: 焼く, 守る, 育つ, 打つ,
放つ, 加わる, 明かす.
Source: the meanings drafts (`ai:claude-sonnet`). The site shows a drafted
word only when both runs agree with confidence ≥ 0.8 (`DRAFT_WORD_MIN`).
10,925 words have agreeing runs below 0.8; 2,067 have runs that disagree.
Often the runs agree but are unsure because the word has two of the
kanji's meanings: 焼く is "burn" and "bake" (see D-025).
**Status: open.** A fix is on feat/word-groups (pipeline/word_groups.py):
the unsure words are placed again, one JMdict sense at a time, so a word
can have a main group and up to two extra groups (焼く: burn, also bake).
Pilot of 50 kanji: 231 of 565 words placed, and a skeptic found none wrong.
Full run (2026-10-17, 1,476 kanji, 13,059 words, two Opus runs): 5,597 words
placed, 531 with extra groups. A skeptic checked every placement; the 111 it
called wrong or doubtful stay out. Words the site already shows, placed again
unmarked, came out the same 99.6% of the time. In the sandbox, common kun words
in no group go from 29.9% to 17.4%, on words from 24.1% to 13.6%, and kanji
with a kun reading on no card from 204 to 77. A main group at 0.7-0.79 was
let in after a 300-word sample came out 99.3% right; the skeptic then checked
all 2,596 of them (18 held back). Then 0.6-0.69 too (a sample was 99.0%
right), and words both runs call sound-only below 0.8, each checked by the
skeptic (1,484 of 1,494 and 141 of 151 ok). Now 10,097 words are placed: kun
words in no group 7.7%, on words 5.0%, kanji with a kun reading on no card 38.
Not loaded into the review store yet. Left: words whose only sense sits between two groups (育つ: "raise" or
"grow up"), for a reviewer.
2026-10-17, with the regroup (D-028) and 21 words placed by hand: kun words in
no group 3.3%, on words 2.9%, and kanji with a kun reading on no card 19. All
19 are names, fixed spellings, the zodiac or rare words (静岡, 馬鹿, 申 さる);
no learner's kun reading is missing. Dani: solved. Sandbox only until the
regroup is loaded and deployed.

### D-027 · Meanings that no group of the kanji holds
*Found 2026-10-17* (the word-groups pilot, D-026).
For some words, both runs said that no group of the kanji fits any sense:
自首 and 出自 (自 "from"), 劇薬 (劇 "severe, intense"), 御幸 (幸 "imperial
visit"), 物故, 真打, 明け渡す. Each points to a meaning the kanji's groups
lack, or to a word that needs a person.
Source: the meanings drafts' groups (`ai:claude-sonnet`).
**Status: open.** The full run found 92 such words in 81 kanji
(data/drafts/word-groups*/nofit.json): 仮名 (名 "letter, script"), 気概
(概 "spirit"), 具合 (具 "condition"), 千尋 (尋 "fathom"), 文献 (献 "wise men"),
and others. Each needs its kanji's groups looked at, or a person to place it.
2026-10-17: 益 "increase, more" (益々) has no group; 益々 sits under "profit, gain"
for now (data/drafts/regroup/manual.json). The last kun readings on no card were
placed by hand there too: 携わる, 照れる, 却って, 丈 だけ, 居候, 雨脚, 大関 and others.
What is left are names, the zodiac and rare words (静岡, 申 さる, 謀).

### D-028 · Groups that are word-building patterns, not meanings
*Found 2026-10-17* (Dani: well-known kanji like 人 and 物 have the most words
in no group; "it feels like we are not asking the correct question").
人 had "person", "person of a kind" (村人, 素人), "counting people" (三人) and
"human" as four groups, though 人 means "person" in all of them. "Of a kind"
and "counting" are ways the kanji builds words, not meanings. The two placing
runs then split between twin groups, so the word was placed in neither. 物
(thing / goods / substance), 出 (〜出す "start doing"), 性 (-ity "quality" next
to "nature") and 政 ("government" next to "politics") had the same fault.
Source: the meanings drafts' groups (`ai:claude-sonnet`): the more words a
kanji had, the more its groups were split by pattern.
**Status: open, fix drafted.** Dani's rule (2026-10-17): a group is a meaning;
a pattern (suffix, prefix, counter, intensifier, one reading) is a *use* inside
the meaning it carries, like Kodansha's 1a/1b. Showing the uses on the cards
comes later. On feat/word-groups (pipeline/regroup.py), 206 kanji were redrawn:
the 138 with the most run splits or homeless words, 23 with pattern-named groups,
and 45 that an Opus audit of the other 465 kanji with 3+ groups flagged. Two
Opus runs (70% gave the same groups), then a reconcile pass. Result: 790 groups
became 618, with 870 uses. Each placed word follows its old group when that group
went to exactly one new group (15,797 of 17,867). The other 2,070 were placed
again by two Opus runs: 1,096 sure at 0.8, plus 534 at 0.6–0.79 that the skeptic
checked (527 ok, 5 doubtful, 2 wrong; the 7 not ok stay out). In the sandbox
(C:/tmp/rg-sandbox), the common words these kanji place go from 89.8% to 97.6%
(15,898 → 17,271 of 17,699); 立 from 124 to 168 of 182. Not loaded into
data/review or prod yet. Left: words where every sense fits no group (D-027
style): 自首, 出自, 張本人, 得度, 連理, 身代, 総花, 活発, 丁度, 目方.

### D-029 · Kanji listed as close in a meaning they do not share
*Found 2026-10-24.* The Opus check of the similar-kanji nuance lines
(pipeline/kanji_nuance.py verify, then a second look at every hidden pair)
found 120 of 3,174 pairs where no meaning of the other kanji is close to the
meaning it is listed under: 火 水 月 木 金 土 beside 日 "Sunday" (other weekdays),
知 beside 分 "divide" (close only to 分かる), 談 話 述 陳 beside 語 "language"
(close only to its "tell" meaning), 柔 beside 優 "superior".
Source: the meaning groups' `similar` lists.
**Status: open.** The kanji page hides these rows (`mismatch` in
data/kanji_nuances.json, server/synonyms.kanji_not_close); the lists
themselves are unchanged. Left: take the pairs out of the lists, or move
them to the meaning they share, in the review store.

### D-030 · The other kanji's meaning shown on a similar-kanji row is a guess
*Found 2026-10-24.* A row beside a meaning names which meaning of the other
kanji is close: the one that lists this kanji back, else the one worded most
alike (search.close, kanji_nuance._match). The guess is wrong for at least 26
pairs, e.g. 家 shown as "expert, -ist" beside 屋 "house", 株 as "shares"
beside 根 "root".
**Status: fixed locally** (2026-10-25, feat/word-synonyms). The check
flagged them (`wrongLabel` in data/kanji_nuances.json) and wrote the line for
the meaning that is close; those 26 rows now show no label rather than the
guess (synonyms.kanji_wrong_label). Open: naming the right meaning instead.

### D-031 · Tatoeba sentences are shown rebuilt from the index, not as written
*Found 2026-10-24.* The sentence table keeps the jpn_indices line, and the
sentence is rebuilt from its tokens (search._sentence). That loses all
punctuation and every word the index does not list: names and figures
(彼はチェスター区選出の議員に当選した comes back 彼は区選出の議員に当選した,
石の上にも三年 as 石の上にも年), and tokens without a {surface} come back in their
dictionary spelling (かもしれない as かも知れない).
Source: build_db's sentence stage.
**Status: fixed locally** (2026-10-24, feat/word-synonyms). The sentence
table keeps Tatoeba's own text and translation (`real`, `en`; from
pipeline/data/tatoeba/*_sentences.tsv.bz2, 149,855 of 150,075 sentences), and
the word page marks the word in it by walking the index tokens through it in
order (search._sentence; on 200,000 links the same word as before, 145 left
unmarked where the index spells the word otherwise). The sense notes'
examples are put back the same way (sense_evidence.restore; 17 left as
rebuilt). Left for prod: the two Tatoeba files on the Pi and
`build_db.py examples` there; an old db still shows the rebuilt text.

### D-032 · Two old kanji forms missing
*Found 2026-10-24,* reading every spelling tagged "old kanji" (331 in common
or JLPT words, from 142 old/new pairs, all correct). Two old forms are not in
char_form, so spellings with them are not tagged: 冩 (写: 冩眞) and 鬪 (闘:
戰鬪, 鬪爭). 處 in 臺處 is tagged nowhere either, since 台所 is written with 所,
not 処: right as it is.
Source: char_form kind=old (KANJIDIC variants).
**Status: open.**

### D-033 · Word synonyms removed by a rule that did not fit
*Found 2026-10-24,* by sorting once every pair a check or a rule had removed
(pipeline/synonym_removed.py, 579 pairs, Opus). 46 were real pairs (8%):
- the same-word code rule (word_synonyms.same_word) was wrong for 12 of 52.
  It tests the spelling and the reading apart, so 落ちる (おちる) is "お + 散る
  (ちる)", 男の子 is "男子 with の", お腹 is "お + 腹" though it reads おなか
  against はら, and 兎に角 is "兎角 with に";
- the Opus checks were wrong for 34 of 511: a broader-word or other-form rule
  taken too far (子 / 子供, 名 / 名前, 弱る / 弱まる), or the wrong sense judged
  (接する, 回 / 度).
15 more fit no kind the data has (a box issue): keigo counterparts (仰る /
言う, くれる / くださる), words that share an English gloss but differ in
scope (近代 / 現代, 美術 / 芸術, 消極的 / ネガティブ, 割る / 壊す), old variants
(メーター / メートル), letter short forms (ＣＭ), set pairs and series (大 /
小, 級 / 段, 並・上・特上).
Source: the rules in word_synonyms (filter, prompts) and the Opus checks.
**Status: partly fixed** (feat/word-synonyms). The 46 are back on both words
(export reads the "keep" verdicts). The 15 box cases became kinds (pair,
polite, mix by meaning, short, older; synonym_kinds.py).
*2026-10-25 (fix/same-word):* same_word now needs the spelling and the
reading to change the same way: お/ご/御 with its reading on a kanji base,
に・と・的 (てき) and 曜 + 日 (び) tails, ずる/じる, す/せる, る/りる on both;
inserted kana (万一 / 万が一, but 兎角 / 兎に角) go to the agents. The old
rule also hid candidates before any agent saw them: of the 2,897 pairs it
called one word, 60 share a gloss and had never been judged. Sorted once
(synonym_kinds.py F-*): 5 syn, 5 mix, 6 short, 1 older, 43 none; blind
grade of all 60 (quality_sample "freed"): 3 major, 3 minor. Fixed: 締め切り
/ 締め切り日 is no short form, and two lines; the other 2 majors are the
open box below. An emphatic spoken form (思いっきり, 大っきい, 矢っ張り,
すっごい, 余っ程, 何にも) fit no kind, so it showed nothing: a box issue, not
a knowledge one (every pass knew the answer). Dani: new kind `spoken`, in
the spellings row like short and older. Found by code (readings that differ
by an added っ, ん or ー, a shared gloss, one spelling's kanji within the
other's: 39 pairs, S-000), sorted with every kind open: 8 spoken (きちっと /
きちんと moved there from synonyms), 1 short, 2 older, 6 syn (2 shown
already, kept), 1 mix (フラグ / フラッグ), 21 none. Blind grade of all 39
(quality_sample "spoken"): 1 major, 摂氏 / セ氏 left out (two current
spellings of one name, no form kind fits): now synonyms, the line saying
so. **Status: fixed.**

### D-034 · Word lines that call a Sino-Japanese word "native"
*Found 2026-10-25,* by the second look at the mirrored synonym lines: the
quick own lines (pipeline/self_nuance.py, Sonnet) often opened with "Native
word." on words built from on'yomi (点数, 場所, 助言, 娯楽, 王, 級). The same
mistake was in lines the Opus checks had passed, graded minor at most.
Source: drafted synonym lines; a few sense notes.
**Status: fixed locally** (feat/word-synonyms). The second look (W-*, 6,141
pairs) fixed 1,060 lines; then every shown text that says where a word comes
from was checked once (pipeline/origin_claims.py, 1,485 texts): 143 fixed,
179 rows on the site and 3 sense notes. Loanword claims were right; the
errors sat in kanji words. Lesson: a measured sample can grade a systematic
mistake as minor; look for the pattern behind repeated fixes.

### D-035 · Word opposites that were pairs, and pairs no kind held
*Found 2026-10-25,* when Dani's new kinds (D-033) were applied: every
opposite the site showed and every removed pair was sorted once
(pipeline/synonym_kinds.py, 1,758 pairs, Opus). 122 opposites were pairs
(祖父 / 祖母, 甥 / 姪, 上旬 / 下旬) and 14 were no opposites at all (悪い /
美しい, 悪い / 上手); 151 removed pairs fit a new box: 68 easy to mix up by
meaning (近代 / 現代), 47 short forms (ＣＭ), 21 older forms (メーター), 9
pairs, 6 polite forms (仰る / 言う).
Source: the antonym rule (sex pairs as opposites, 2026-10-22) and the
synonym-only question of the first runs.
**Status: fixed locally** (feat/word-synonyms). All 287 changes graded
blind: 0 major, 28 minor. Left: three pairs with the wrong partner (女房 /
夫, 嫁 / 夫, ボーイ / 女の子) and "short form" on a base word (白 / 白色).
Only pairs that slipped into the runs were sorted: a run to find polite
forms, mix-ups by meaning and pairs across all words is still to do.

### D-036 · Register labels on word lines: relative, wrong, or one for all senses
*Found 2026-10-25,* by the Bulgarian translators, who read every line and
kept flagging register claims (実は "written", 基づく "everyday", 努めて
"spoken"); the blind graders had let them pass as minor. Three causes: a
label true only next to the paired word, written as a plain fact ("Formal."
on 見解's row means more formal than 意見); plain misjudgments, mostly on'yomi
words taken as formal or written and kana or mimetic words as spoken; one
label for a word whose register changes with the sense (向き).
Source: the drafting prompts (each synonym line says how the word differs,
register first) and the Sonnet own lines.
**Status: fixed locally** (feat/word-synonyms). Every text with a register
claim, and every text a translator flagged, checked once by Opus with
JMdict's register tags as evidence (pipeline/register_claims.py, 12,648
texts): 2,545 fixed, most now explicit comparisons ("More formal than 意見").
Applied: 3,237 synonym rows, 619 sense notes; Bulgarian redone for them.

### D-037 · Senses JMdict keeps to another reading or spelling
*Found 2026-10-25,* by the translators: 平日 read へいじつ showed a sense JMdict
gives only for ひらび; 刀 its とう senses under かたな; この間 "meanwhile" is
このかん. build_db read every sense as a sense of the headword and dropped
<stagr>/<stagk>: 469 senses in 423 words, 127 of them on our pages.
Source: build_db's dict stage.
**Status: fixed locally** (feat/word-synonyms). data/sense_restrictions.json
(pipeline/sense_restrictions.py) marks them on the word page ("read このかん
in this sense"); the 130 notes and lines under them were checked again
(123 fixed). Open: the search index and the sense table still carry no
restriction.

### D-038 · Other readings shown as spellings, with no sign they are less used
*Found 2026-10-25,* by Dani: 消耗 has しょうもう under the headword, then
しょうこう in "Spellings" as if it were one more way to write the word.
しょうこう is a second reading (the original one; しょうもう is the usual
慣用読み). Spellings shows every kana form but the first, so a reading of
another sound lands there. Nothing marks it as less used: JMdict gives
しょうこう no tag and no priority, and "rare" is set only from re_inf tags.
Scale (common or JLPT words): 3,717 words have a second reading of another
sound; 2,941 of those readings have no tag and no priority while the first
reading has one (本名 ほんめい, 村 そん, 中指 ちゅうし). In kana-only words
(ストア, ストアー) the other kana are real spellings.
Source: Spellings.tsx (all kana forms but the reading) and build_db's rare flag.
**Status: fixed locally** (fix/other-readings). The row lost its "Written"
label, on the word page and the search card: it holds every other form, a
spelling or a reading. Common forms are white; a form with no JMdict priority
beside one of its kind that has one is grey (しょうこう, ほんめい), a rare-tagged
one greyer. build_db writes word_form.pri; pipeline/form_pri.py adds it to an
existing database (prod needs it before the new server starts).

### D-039 · Word pairs that point at another entry spelled the same
*Found 2026-10-27,* by the round-7 Bulgarian translators. 飛球 is paired with
フライ "deep-fried food", 散らし with ビラ "villa", 往々 with しばしば "(blinking)
repeatedly". The lines are right; the entry is not. A drafted word given as
spelling and reading is turned into an entry by word_synonyms.resolve, which
ranks the entries spelled so and takes the first, never by meaning. When the
meant entry is out of scope (the handbill ビラ and the fly-ball フライ are not
marked common), only the wrong one is left to take; with both in scope, the
kana sort put the headword しばしば before 屡々 read so.
Scale: of the 35,766 rows the site shows, 3,634 point at a word spelled like
another JMdict entry (1,414 of them from pipeline/common_relations.py), 2,659
where one of those entries is out of scope. Most are likely right; none are
checked.
Source: word_synonyms.resolve, used by the synonym drafts and common_relations.
**Status: partly fixed** (feat/common-relations, 2026-10-27). 飛球 / フライ and
散らし / ビラ are dropped (common_relations FIXES). New drafts cannot repeat it:
word_synonyms.homographs finds every JMdict entry spelled and read so, in scope
or not, and both checkers ask an own word with more than one for the `id` of
the one meant (an id out of scope: drop it). The runs done before are read as
they were, so the export does not move. The kana sort now takes the commoner of
the words headed so or usually kana: 往々 pairs with 屡々 (both lines have
Bulgarian), the only row that moved.
The 3,634 above counts every row whose other word shares a spelling, however it
got there; a word offered by id was picked with its senses shown. What resolve
picked by rank is narrower: 50 shown pairs (100 rows), typed in by the drafters
and read like more than one entry (24 from the synonym runs, 26 from
common_relations; 37 with a rival out of scope). At least three are wrong:
ナット / ボルト "volt" (meant bolt), ビジター / ホーム "platform" (home), 門 / もの
(もん typed for 物). To do: one check of those 50 (keep, move, drop), then
export; and whether scope should take entries like the handbill ビラ.

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
- Word synonyms leave out about 15,000 pairs that only one drafting run gave,
  or both below 0.6 (2026-10-25). Nothing wrong is shown because of them, but
  words miss real synonyms: a blind sample of 300 found 97.7% right (2.3%
  major, mostly short forms). Task for when there are tokens to spare: an Opus
  check of those pairs (`quality_sample.py` dataset `belowbar` shows how they
  are drawn; about 125 agents at 120 pairs each), then export as usual.
