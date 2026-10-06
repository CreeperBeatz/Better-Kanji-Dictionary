# Labeling handbook

How to decide each kind of card in the review queue. Use the contents to
jump to the stage you are working on; the **Cases** at the end are decisions
that took thought, so the next reviewer decides them the same way.

## Before you start

### The one rule

> **The modern shape decides the order; the old shape decides the story.**

- *Parts* answer "what does it look like today?" They drive the graph and the
  study order: a kanji is never taught before one it visibly contains.
- *Forms* and *meanings* answer "where does it come from, what does each part
  do?" Old forms are evidence for those. For parts they do one thing only:
  break a tie when today's strokes can be grouped two ways (see 従).

### What is in scope

Word labeling covers each kanji's *common* words, and words with a
newspaper rank or a JLPT level. Rarer, unranked words are not labelled here;
they will be a separate task. (A school grade is not a ranking: nearly every
word written in jōyō kanji has one.)

### Nothing is final

- Nothing an AI or a data source proposes is live until a person accepts it.
  A proposal is a starting point, not a fact.
- Every decision is logged under your name, and the admin can revert any of
  them. So decide and move on; a mistake can be undone.
- Your work on a card is kept in this browser until you decide it: reload,
  close the tab or come back tomorrow, and it is as you left it.

### The buttons

| Button | What it does | On |
|---|---|---|
| **accept** | Takes the card as it is shown. | every card |
| **save my answer** | Replaces *accept* once you changed something, and saves your version. | every card |
| **skip** | Leaves it for now. Skipped cards wait under *skipped* in the queue bar. | every card |
| **reset card** | Throws away what you changed and starts again from the proposal (greyed when there is nothing to throw away). | every card |
| **reject** | The proposal is wrong as a whole. | reports, people's suggestions |
| **save** | Saves every answer on a character's card at once. | characters |

A character's card has no *reject*: each of its answers says what it does
(*keep it as it is*, *no parts* …). Meanings and Bulgarian are shaped until
they are right, then accepted, or skipped.

**Keys:** `a` or `Enter` accepts (or saves), `r` rejects, `s` skips, `j` / `k`
move to the next or previous card.

**Something else is wrong?** Every card has it under its title. A mistake
the card can't fix (a word's English, a kanji's readings or levels, its
similar kanji, a part on another card) goes to *reports* for a reviewer to
check. The pages' *Edit* has the same at the bottom. On a single word, `1`–`9` pick a group
and decide in one press.

### The print dictionaries

Many cards show what two printed dictionaries say, in a box with the book's
name: Цалта's kanji book (by entry number) and Иванов's Bulgarian–Japanese
dictionary.

- **A second opinion, not the answer.** The books were made by people, but
  they were transcribed by an AI. The kanji book also splits kanji the way a
  mnemonic course would, not always by today's shape.
- **The entry is drawn as the book prints it**, from the transcription:
  number, keyword, parts, level, the kanji, its readings and words, the note.
- **The printed page is the last resort.** If something in the drawn entry
  looks wrong, *printed page 163 ↗* opens the scan in a popup (click to zoom,
  Esc closes it). When the box says *the transcription may be wrong here*,
  look at the page before you use anything from it.
- **Where it shows:**
  - on a **character's** parts, the book's split, with *use this split* to
    make it your answer; on its forms, the old form the book gives; on a
    part with no meaning, the Bulgarian names the book uses for it;
  - on **Bulgarian** cards, the book's terms. A term that is already in the
    list has a ✓; *+ add* (or *+1*, *+2* for a word's senses) puts it in.
- **The kanji book's own cards.** Some character cards come from
  the book itself (`tsalta-diff`, `tsalta`); judge them like any proposal. It
  calls some name variants old forms (埜 for 野): those are not old forms.

## Characters

> **One card per character.** Up to three questions, in this order: what
> is it built from, how is it related to other characters, and, for a part
> with no meaning in the dictionary, what is it? Only the questions that
> have something waiting are asked.

### How the card works

- **Every answer says what it does.** *Use the proposal* (where it came
  from is beside it), *use the AI draft*, *keep it as it is*, *no parts*,
  *something else*. There is no bare *reject*: say what should be true
  instead. (A check's *reject* used to mean "keep it", and 五 段 為 were
  closed that way with their wrong parts still live.)
- **The AI draft comes with its proof**: what each part does in the
  character, and what the old form shows, with a confidence. It starts
  selected when it gave an answer; it is a suggestion, so read the proof.
  A low confidence is marked red. *Why this card* says what a rule found
  (one part only, strokes in no part, a bare stroke, a data issue).
- **What this changes** shows, for the parts you picked, what every kanji
  containing the character gains or loses. Above *save*, the summary says
  in sentences everything saving will do.
- **Something else is wrong?** under the character files a report for
  what the card can't fix (its readings, its English, its levels).

### Built from

> **Question:** which parts is this character built from, as written today?

#### What counts as a part

- **Each part should mean something in this character.** A data source that
  splits a shape into stroke groups (IDS often does) is describing the
  drawing, not the character. Don't use it.
- **Start from the simplest part, not a stroke.** A learner begins with the
  smallest piece that is a kanji or a real part. If a character can't be
  split into such pieces, it has no parts (it is atomic), and that is fine:
  a small picture like 午 is learned as one piece.
- **A lookalike is not a part.** 午 visibly contains 干, but 干 (a shield)
  does nothing in 午 (a pestle). Ask what the piece does in this character:
  meaning, sound, or its source kanji written for that position. If it
  does none of these, it only looks alike. Lookalikes go in *Similar → looks*, where a
  learner sees them side by side. Your own way of seeing a shape (決 as
  person + ユ) goes in your associations, not in the parts.
- **Bare strokes are parts only when they mean something.** Data sources love
  to chop real parts into strokes (口 → 丨一), so their stroke splits are
  refused outright. You can still use a stroke (一 丨 丶 丿 乙 亅 …) after a
  confirmation, when it carries meaning in that character: 主 is 丶 + 王, a
  lampstand (王) with its flame (丶). If the stroke is only there because the
  drawing has it, leave it out.

#### Today's shape, and when the old form decides

- **Judge by today's shape.** 青 contains 月, even though the old form 靑 had
  丹 there. The 丹 belongs in a form note, not in the parts.
- **Two groupings of the same strokes: the old form decides.** Sometimes
  today's shape allows two splits that use exactly the same strokes, and only
  the grouping differs. Look at the old form and group the strokes the way it
  does. The old form only chooses between splits that are visible today. It
  never adds a part that is no longer visible.

#### Kanji written differently as a part

A bound form is handled by how much it still looks like its source:

| The bound shape… | Parts | Form link |
|---|---|---|
| still looks like the kanji (⺤ 爪, ⺮ 竹, ⺌ 小) | that kanji | *is a form of* that kanji |
| no longer looks like it (亻 人, 氵 水, 忄 心, 罒 网) | none (atomic) | *is a form of* that kanji |

Either way the form link is what carries the meaning across. If it is
missing, add it with *Edit* at the bottom of the character's page, in its
Forms section.

#### Read the impact

"This adds a containment edge" means the study order moves. "157 kanji
contain it" means every one of them gains or loses a prerequisite. A change
that makes many kanji depend on a part that means nothing in them is a bad
change, even if it is technically accurate.

#### Drawing a part

- **Can't type a part?** Under *Something else*, press *Draw* next to the
  parts field and draw it; picking a candidate adds it to the parts.

### Related characters

> **Question:** how does X relate to Y?

| Link | Use it when | Example |
|---|---|---|
| *how it is written in another position* | one is only ever the other, written for a certain position, often with fewer or different strokes; position decides which you see | 人·亻, 水·氵, 衣·衤 |
| *its old form* | Y is the pre-reform shape of X | 青·靑, 会·會 |
| *is a form of* | X is Y, written differently for the place it sits, and lends Y's meaning. Needs history behind it (the old form, a reference). One per bound form. | 龰·止 |
| *looks like* | a mnemonic lookalike only, always shown as such | 龶 looks like 王 |
| *a separate character for the same thing* | X and Y are characters in their own right, with their own readings, that mean the same thing; either can sit in the same place (雅 has 隹 where 鳴 has 鳥) | 隹·鳥 |
| *no relation* | nothing a learner should see: a Chinese simplified form, a rare variant, or a character built from the other | 业·業, 林·木 |

- **Read the sentence.** On a card each choice reads with its two
  characters: "寳 is the old form of 宝", "龰 is a form of 止". An old form,
  a form of and a looks like go one way; if a proposal has them the wrong
  way round, pick *Something else*, press **⇄ swap**, and save.
- **One choice for a bound form.** *Is a form of* covers both "it is that
  kanji written for its place" and "it lends that kanji's meaning". *How it
  is written in another position* is only offered where a link already is one.
- **Position, or two characters?** Looks do not decide it: 氵 has three
  strokes and 水 four, yet 氵 is only ever 水 written on the left, and it
  never stands alone. 隹 and 鳥 are both characters with their own readings
  (スイ, チョウ), and either can sit in the same place. The first is *how it
  is written in another position*; the second, *a separate character for
  the same thing*.
- **Built from it is not a form of it.** A character made of two or more
  of another (林 is two 木, 炎 two 火, 𢆶 two 幺) contains it, and that is
  its parts: 林's parts are 木. It is a character with a meaning of its own
  (林 is a grove, not a tree), so it lends nothing and borrows nothing.
  Choose *no relation*, or *leave it as it is* when nothing links them yet. If the
  doubled character has no meaning in the dictionary (𢆶), it gets one
  under *Part meanings*.
- Don't take a *looks like* that points at a kanji with the wrong meaning
  that the learner will also meet.
- A form link never changes parts.

#### Judge it by the kanji

Each card shows both characters in every font we have (the old 1978/1983
shapes too, where a font draws them differently), and under each one every
kanji with a rating (common, jōyō or JLPT) that contains it, most frequent
first. Read the two lists side by side:

- **An *is a form of* must hold in nearly all of X's kanji.** Its meaning
  is lent to every one of them. If X is Y in 来 but something else in 前,
  米 and 首, it is not a form of Y: it is a shape (see *Part meanings*),
  and the link is left as it is.
- **A *how it is written in another position* should fill the same role** in both
  lists: 氵 in 海 does what 水 does in 泉.

#### What each link changes on the site

The same table is behind the (i) next to *Relation* on every forms card.

<!-- kinds:form -->

### A part with no meaning

> **Question:** this part has no meaning in the dictionary. What is it?

The page of a part with no meaning says "no recorded meaning". Many of
them are among the most common parts there are (丷 is in 243 rated kanji).
A part is one of three things, and only two of them are decided here:

| It is | Decided as | Example |
|---|---|---|
| one kanji, written differently for its place, in nearly all its kanji | a form link: *is a form of*, in the forms queue | 𠂇 is 又, the hand in 左 右 友 |
| a real character that brings its own meaning | *its own meaning* | 劦, joint effort, in 協 脅 |
| a shape that several unrelated old parts merged into | *a shape with no meaning*, with a name | 丷: 八 in 半, grains in 米, hair in 首 |

<!-- kinds:part -->

#### Writing one

- **A shape's name is a name, not a meaning.** Say what it looks like:
  "two drops", "slanted cap". The page shows it as "a shape: “two drops”",
  with "no meaning of its own" beside it. Never pick a name that sounds
  like a meaning a learner would then read into every kanji.
- **Use your own words.** Not Heisig's primitive names (*Remembering the
  Kanji*) and not WaniKani's radical names: both are closed, and this
  dictionary will be open.
- **The note is what makes a shape useful.** Say what it is in which kanji,
  with the old forms: "八 (split) in 半; grains in 米; the top of 止 in 前
  (old form 歬)". Give the Japanese name where there is one (つかんむり for ⺍).
- **A meaning is the one it has in Japanese kanji.** Unihan's line is
  written for Chinese; it often gives a surname or a river. When a part
  mostly gives the sound, keep its meaning short and say so in the note.
- **A shape and a form of cannot both be right.** The form links waiting
  for the part are on the same card, each with what the part's draft thinks
  of it. The card won't save a shape together with a form of: leave the
  link as it is, or answer *it is a form of a kanji*.
- **If it really is a form of a kanji**, pick *it is a form of a kanji* and
  use (or write) the form link above it.

## Meanings

> **Question:** what are the 1–6 things this kanji does in modern words?

### How to group

- Most kanji have 2–4 groups. A kanji with one meaning (楓, maple) has one
  group, not a second one padded out of a name use or a variant spelling.
- Group by what the kanji does in words, not by English senses (青: blue or
  green, young or unripe).
- Each group should cover at least two common words; merge the rest.
- Labels: 1–4 words in English, the same in Bulgarian. Keep the note short.
- Use the words under each group to test the split: if a group's words don't
  share a meaning, the group is wrong.
- Words the kanji brings no meaning to go in their own box (see below). It
  always exists and is not one of the 1–6.

### The board

Each group is a box with its words under it (reading and gloss). The kanji's
common words come placed where the AI drafted them; words with a **red edge**
are the ones it was unsure of, so look at those first.

- **Move words** by dragging them, or right-clicking one to pick its group.
  Click several to select them first and the menu moves them all. (On a
  phone, a long press opens the menu where the browser allows it.)
- **Confirm every word.** Tick each word you have checked (hover a card for
  its checkbox), or right-click *Confirm* on one word or a selection.
  Confirmed words move into a *confirmed* part at the top of their box, open
  so you can still see them (fold it with its arrow). Moving a word clears
  its tick. Groups need no ticking: fix or remove a wrong one, and what you
  accept is what you meant.
- **Accept waits for the ticks.** Until every word in the groups and in the
  no-meaning box is confirmed, *accept* is greyed and says how many are left.
  Words left for later and words not in a group don't count.
- **Some words start ticked.** Two drafting runs placed every word
  independently; where both put it in the same group, both sure, it starts
  confirmed (about 7 words in 10). Glance over them, and untick one that is
  wrong: it is your decision, not theirs. The rest are yours to tick.
- **Not sure about a word?** Right-click it, *Not sure: leave for later*. On
  submit, the groups and every other word are decided, and the skipped words
  come back together as a follow-up for the same kanji at the very end of the
  queue (*left for later*), each where you had it, with the groups fixed.
- **Add or remove groups** with *add a group* / *remove group*. A removed
  group's words drop to *Not in a group*.
- **Not in a group** holds the in-scope words no group claims. Drag one into
  a group if it belongs there.
- **Accept** (or *save my answer*) decides the groups and every word on the
  board together, as you left them. History shows it as one decision
  ("+ N words placed").
- The address names the card (/review/queue/meanings/…), so it can be
  reopened.

### The kanji brings no meaning to the word

The box under the groups is for words where the kanji is *written* but gives
the word none of its meanings: the word means what it means some other way.
Three kinds of word go there:

- **Sound-only spellings (ateji).** The kanji were picked for their reading,
  often for a foreign word: 合羽 カッパ (from Portuguese *capa*), 珈琲 (coffee),
  亜米利加 (America).
- **Whole-word spellings the separate kanji don't explain.** The word is read
  and understood as a unit: 生姜 しょうが (ginger), 百合 ゆり (lily), 生憎
  あいにく (unfortunately).
- **Wordplay.** 米寿 べいじゅ (88th birthday) is there because 米 can be taken
  apart as 八十八, not because of rice.

> **The test:** could you explain the word's meaning from *this* kanji's
> meaning? If yes, even loosely, it belongs in a real group. If not, it goes
> here.

- **Not a shrug box.** The drafting model sometimes put a word here when it
  could not decide. 沖合 (offshore) is one: 合 there is the ordinary "area,
  extent" sense (as in 歩合), which is a real group. Check each word here
  rather than accepting the box as it is.
- **Per kanji, not per word.** In 合羽 the 合 brings nothing, but a word can
  have one kanji in this box and another in a real group: each kanji is
  judged on its own.

### One word at a time

> **Question:** in this word, which of the kanji's groups is the kanji using?

Words are normally placed on the meanings board, so there are few of these.
They come up afterwards: someone's suggestion for one word, or a word whose
group changed. They wait under **meanings**, right after their kanji's card,
and open on the same board: the groups are fixed, the one word stands out,
and the other words show what each group holds. Move the word, then accept.

- Pick what the kanji contributes, not what the word means overall.
- A word with two kanji is two cards, one per kanji, and they can land in
  different groups.
- If the kanji brings no meaning to the word (ateji, whole-word spellings,
  wordplay), pick *the kanji brings no meaning to the word*.

## Bulgarian

> **Question:** is the machine-translated Bulgarian right?

Every Bulgarian gloss and kanji meaning was machine-translated. There is one
card per word (the kanji's common or ranked words) and one per jōyō or JLPT
kanji, most frequent first.

### Meanings come first

A kanji's card waits until its meaning groups are accepted, and a word's
card until the groups of *all* its kanji are (kanji with no meanings task
don't hold anything up). Then the card shows them:

- a **kanji card** lists its groups with their Bulgarian labels, and can fill
  its meanings from them as a start;
- a **word card** says which group each of its kanji is in for this word.

That tells you which sense the translation must carry; the word's own
English is still what you translate.

### Checking a card

- **Words.** Each sense shows the English and, beside it, the Bulgarian to
  check. Fix what is wrong or unnatural; leave what is right. A changed field
  is marked and shows the machine translation under it.
- **Kanji.** One short meaning per field, saying what the English says.
  Add or remove fields as needed (1 to 12).
- **Japanese kanji are канджи**, never кандзи (that is Chinese).
- **Accept** confirms the card as it is; *save my answer* keeps your fixes.
  Either way it shows on the site at once. Search by Bulgarian text still
  uses the old wording until the data is rebuilt.
- **Not sure?** *Skip* it, and come back to it from *skipped*.

## Reports

> **Question:** is what the report says actually wrong?

Some data comes from reference dictionaries and is never edited here:
words' English (JMdict), kanji's English meanings, readings and levels
(KANJIDIC), similar kanji (computed). A person who spots a mistake there,
or anything a card can't fix, says so in their own words with *Something
else is wrong?*, and the report lands here with what it is about. Nothing
on the site changes, whatever you decide.

- **Confirm only a real mistake**: a wrong meaning or reading, a sense
  that is missing and common, a wrong level. Check it against another
  dictionary or the example sentences, not against taste.
- **Reject** a matter of taste (old-fashioned, British, too literal) or a
  misreading of the entry. Say why in the reason: the person sees it.
- A confirmed report is logged as a data issue (DATA-ISSUES.md) and sent
  to the source, so it is fixed there; the next data build picks it up. A
  report about parts or forms becomes a character card instead.

## Cases

Decisions that took thought. When you meet one, write your reasoning in the
reason field and tell the admin, so it can be added here.

### 丷: a shape, not a form of 从 or 八

*Seen 2026-10-06.* 丷 had two *is a form of* proposals waiting: 从 (from
来, old form 來) and 八 (from 曽, old form 曾).

- **Each holds in one or two kanji.** 丷 is in 243 rated kanji. In 半 it is
  八, split; in 米 it is grains; in 首 hair; in 前 the top of 止 (歬). A form
  of lends its meaning to all 243: 前 would "contain" from or eight.
- **So it is a shape.** Several unrelated old parts became the same two
  strokes. No meaning is true across them.

> **Decision:** *leave it as it is* for both form links. Answer 丷 as *a
> shape with no meaning*, named for what it looks like, with a note saying
> what it is in which kanji.

> **Lesson:** before accepting a form of for a bound part, read the list of
> its kanji on the card. If Y is only right in a few, it is a shape.

### 龰: a stroke split against a variant of the same part

*Seen 2026-10-04.* 龰 (the bottom of 足 走 定) has the part 止. IDS proposed
人 + 卜 (`⿺人⺊`).

- **The proposal is a stroke split.** Neither 人 nor 卜 means anything in 龰,
  and all 157 kanji using 龰 would gain 人 as a prerequisite and lose 止. A
  learner would be told 足 contains "person".
- **The current part is fine even though 龰 is "only a version of" 止.** 龰
  is 止 written at the bottom with its last strokes bent; both are a foot.
  It still looks like 止, so by the bound-form table the part stays 止.
- **What was actually missing** was the form link: 龰 had none, so its page
  could not borrow 止's meaning.

> **Decision:** *keep it as it is* (止), with a reason ("IDS splits
> strokes; 龰 is 止 at the bottom"). Then on 龰's page add 止 as *is a form
> of*.

> **Lesson:** when a proposal replaces a recognisable part with stroke
> fragments, don't use it. When the current part is a real kanji written
> differently for its position, keep it if it still looks like it, and make
> sure the form link exists.

### 午: a lookalike inside an atom

*Seen 2026-10-05.* 午 had the part 干. IDS proposed 𠂉 + 十 (`⿱𠂉十`);
KanjiVG and KRADFILE split it as 丿 + 干.

- **The proposal is a stroke split.** 𠂉 is not a part of 午 the way it is
  in 年 or 矢; IDS is cutting the drawing.
- **The current part is a lookalike.** 午 is 丿 over 干 stroke for stroke,
  but 午 is a pestle (it is the 午 in 杵 "pestle") and 干 is a shield. All
  66 kanji built on 午 (許 缶 陶 謡 遥 御 …) would depend on "shield".
- **Nothing smaller does a job in 午**, so it is atomic.

> **Decision:** *no parts*, and save. The
> likeness to 干 千 牛 belongs in *Similar → looks*.

> **Lesson:** a character can visibly contain a kanji without being built
> from it. Strict order is about the parts a character is built from, not
> every shape it contains. When neither the proposal nor the current parts
> do a job in the character, make it atomic.

### 従: the old form picks the grouping

*Seen 2026-10-05.* The right side of 従 can be read two ways, with the same
strokes: 䒑 + 龰 (the dots and the line on top, a foot below) or 八 + 𤴓
(the dots on top, the foot with its line, as in 定 and 是).

- **Today's shape can't decide.** Both splits are visible and use every
  stroke once. They differ only on where the 一 goes.
- **The old form can.** 従 was 從: 彳 + 从 (two people, one following the
  other) + 止 written as 龰. The two people shrank to 䒑, losing a stroke
  (從 has 11 strokes, 従 has 10). The foot did not change. So the 一 belongs to
  the top, and the foot is 龰, not 𤴓.
- **Neither 从 nor 止 becomes a part.** 从 is no longer visible in 従, so the
  story (䒑 is what is left of the two people) goes in 従's notes and
  meanings, not in its parts.

> **Decision:** *keep it as it is*: 彳 + 䒑 + 龰, which is what the data
> already has, not a proposal of 𤴓 or 八.

> **Lesson:** when two splits use the same strokes, follow the old form's
> grouping. The old form chooses between splits that are visible today and
> does not add parts.
