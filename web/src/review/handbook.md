# Labeling handbook

How to decide items in the review queue. When you meet a case that took
thought, add it under **Cases** so the next reviewer decides it the same way.

## The one rule

**The modern shape decides the order; the old shape decides the story.**

- *Parts* answer "what does it look like today?" They drive the graph and the
  study order: a kanji is never taught before one it visibly contains.
- *Forms* and *meanings* answer "where does it come from, what does each part
  do?" Old forms are evidence for those, never for parts.

Nothing an AI or a data source proposes is live until a person accepts it.
Every decision is logged and can be reverted from History, so decide and move
on; you can always come back.

## Parts (decomposition)

Question: which parts does this character visibly contain, as written today?

- **Each part should mean something in this character.** A data source that
  splits a shape into stroke groups (IDS often does) is describing the
  drawing, not the character. Reject it.
- **Bare strokes are parts only when they mean something.** Data sources love
  to chop real parts into strokes (口 → 丨一), so their stroke splits are
  refused outright. You can still use a stroke (一 丨 丶 丿 乙 亅 …) after a
  confirmation, when it carries meaning in that character: 主 is 丶 + 王, a
  lampstand (王) with its flame (丶). If the stroke is only there because the
  drawing has it, leave it out.
- **Judge by today's shape.** 青 contains 月, even though the old form 靑 had
  丹 there. The 丹 belongs in a form note, not in the parts.
- **Read the impact.** "This adds a containment edge" means the study order
  moves. "157 kanji contain it" means every one of them gains or loses a
  prerequisite. A change that makes many kanji depend on a part that means
  nothing in them is a bad change, even if it is technically accurate.
- **A squashed or moved kanji** (a bound form) is handled by how much it still
  looks like its source:

  | The bound shape… | Parts | Form link |
  |---|---|---|
  | still looks like the kanji (⺤ 爪, ⺮ 竹, ⺌ 小) | that kanji | *is a form of* that kanji |
  | no longer looks like it (亻 人, 氵 水, 忄 心, 罒 网) | none (atomic) | *is a form of* that kanji |

  Either way the form link is what carries the meaning across. If it is
  missing, add it from the character's page (Forms block, "How X relates to
  another character").
- **Checks** (nothing proposed) ask you to look at the current parts. If they
  are right, press *looks right, keep it*. If not, type the right parts.
- **Can't type a part?** Press *Draw* next to the parts field and draw it;
  picking a candidate adds it to the parts.

## Forms (form_link)

Question: how does X relate to Y?

- *same part in another position*: 人·亻, 水·氵, 衣·衤.
- *its old form*: the pre-reform shape, 青·靑, 会·會.
- *is a form of*: X is Y squashed or moved, and lends Y's meaning. Needs
  history behind it (the old form, a reference). One per bound form.
- *looks like*: a mnemonic lookalike only, always shown as such (龶 looks like
  王). Reject one that points at a kanji with the wrong meaning that the
  learner will also meet.

A form link never changes parts.

## Meanings (kanji_senses)

Question: what are the 2–6 things this kanji does in modern words?

- Group by what the kanji does in words, not by English senses (青: blue or
  green, young or unripe).
- Each group should cover at least two common words; merge the rest.
- Labels: 1–4 words in English, the same in Bulgarian. Keep the note short.
- Sound-only uses and fixed spellings (寿司, 生憎) go to the catch-all, which
  always exists and is not one of the 2–6.
- Use the words under each group to test the split: if a group's words don't
  share a meaning, the group is wrong.

### The board

A meanings item shows each group as a box with its words under it (reading
and gloss). The kanji's common words come placed where the AI drafted them;
words with a red edge are the ones it was unsure of, so look at those first.

- **Move words** by dragging them, or tap several and press *move here* on a
  group (works on a phone too).
- **Add or remove groups** with *add a group* / *remove group*. A removed
  group's words drop to *Not in a group*.
- **Not in a group** holds words no group claims. Rarer words load a page at a
  time; drag one into a group if it belongs there.
- **Accept** (or *save my answer* once you changed something) decides the
  groups and every word on the board together, as you left them. History shows
  it as one decision ("+ N words placed"), and reverting it puts all of them
  back in the queue.

## Word meanings (word_sense)

Question: in this word, which of the kanji's groups is the kanji using?

Words are normally placed on the meanings board, so this tab is mostly empty.
It holds what comes up afterwards: a user's suggestion for one word, or a word
whose group changed.

- Pick what the kanji contributes, not what the word means overall.
- A word with two kanji is two items, one per kanji, and they can land in
  different groups.
- Ateji and fixed spellings go to the catch-all.
- Keys 1–9 pick and decide in one press.

## Cases

### 龰: a stroke split against a variant of the same part

*Seen 2026-10-04.* 龰 (the bottom of 足 走 定) has the part 止. IDS proposed
人 + 卜 (`⿺人⺊`).

- **The proposal is a stroke split.** Neither 人 nor 卜 means anything in 龰,
  and all 157 kanji using 龰 would gain 人 as a prerequisite and lose 止. A
  learner would be told 足 contains "person".
- **The current part is fine even though 龰 is "only a version of" 止.** 龰
  is 止 written at the bottom with its last strokes bent; both are a foot.
  It still looks like 止, so by the table above the part stays 止.
- **What was actually missing** was the form link: 龰 had none, so its page
  could not borrow 止's meaning.

**Decision:** reject, with a reason ("IDS splits strokes; 龰 is 止 at the
bottom"). Then on 龰's page add 止 as *is a form of* (and *same part in
another position* if you like, as 亻 has for 人).

**General lesson:** when a proposal replaces a recognisable part with stroke
fragments, reject it. When the current part is a bent or squashed version of
a real kanji, keep it if it still looks like it, and make sure the form link
exists.
