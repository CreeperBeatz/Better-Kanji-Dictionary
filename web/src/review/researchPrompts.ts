/**
 * The prompts behind "Research in Claude" on a meanings card and a Bulgarian
 * card (the character card's is in ResearchButton.tsx). Each holds what the
 * card shows -- the draft, the words, the other dictionaries -- and asks
 * Claude to judge it, so the reviewer starts from a second opinion with
 * sources, not from nothing. English, plain sentences, like the handbook.
 */
import type { BoardWord, BookGloss, BookKeyword, ItemDetail, KanjiDictionaries, MeaningGroup } from '../api'
import type { Placements } from './board'
import { bucketOf, elsewhere } from './dictMatch'
import { CATCH_ALL } from './editors'

const WORDS_SHOWN = 20 // per group: the prompt has to fit in an address
const plain = (s: string) => s.replace(/\[img:[^\]]*\]/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Meanings: the groups and their words as the board has them now, and what the other dictionaries say. */
export function meaningsPrompt(
  char: string,
  groups: MeaningGroup[],
  words: BoardWord[],
  placements: Placements,
  dicts: KanjiDictionaries | null | undefined,
  kanjidic: string[],
): string {
  const away = dicts ? elsewhere(dicts, words, placements, groups) : new Map<number, string[]>()
  const word = (w: BoardWord) => `${w.headword} (${w.reading}, ${cut(w.gloss.split(/[;/]/)[0].trim(), 40)})${away.has(w.id) ? ' (!)' : ''}`
  // The (!) words first, so they are in the prompt even when a group is cut.
  const inBucket = (b: string | null) =>
    words.filter((w) => bucketOf(w, placements, groups) === b).sort((x, y) => Number(away.has(y.id)) - Number(away.has(x.id)))
  const list = (ws: BoardWord[]) =>
    ws.length ? `${ws.slice(0, WORDS_SHOWN).map(word).join(', ')}${ws.length > WORDS_SHOWN ? `, and ${ws.length - WORDS_SHOWN} more` : ''}` : '(no words)'

  const lines = [
    `Research the kanji ${char} for a Japanese kanji dictionary for learners. Do a deep search.`,
    `Check Japanese kanji dictionaries (漢字源, 新漢語林, the 漢検漢字辞典 on kanjipedia.jp, 新明解現代漢和辞典), Kodansha's Kanji Learner's Dictionary, and how ${char} is used in modern Japanese words. Cite your sources.`,
    '',
    `We group the words that contain ${char} by the meaning ${char} carries in each word. The rules:`,
    `- A group is a meaning ${char} has inside modern Japanese words, not an English dictionary sense. Example: 青 has "blue, green" (one colour meaning in Japanese) and "young, unripe" (青二才).`,
    '- 1 to 6 groups; most kanji need 2 to 4. A group needs at least two common words.',
    `- When ${char} gives no meaning to a word (a sound-only spelling like 寿司, a whole-word spelling like 生憎), the word goes to "no meaning".`,
    `- Place a word by what ${char} contributes to it, not by what the whole word means.`,
    '',
    `KANJIDIC's English: ${kanjidic.join(', ') || '(none)'}`,
    '',
    'The draft groups and the words in each (reading, English). (!) = another dictionary lists the word with words that are in another group: check these first.',
  ]
  groups.forEach((g, i) => lines.push(`${i + 1}. "${g.en}"${g.note ? ` (note: ${g.note})` : ''}: ${list(inBucket(g.id))}`))
  lines.push(`No meaning: ${list(inBucket(CATCH_ALL))}`)
  const none = inBucket(null)
  if (none.length) lines.push(`Not in a group yet: ${list(none)}`)

  if (dicts?.kodansha || dicts?.kangorin || dicts?.wiktionary) {
    lines.push('', 'What other dictionaries say:')
    const k = dicts.kodansha
    if (k) {
      const senses = k.senses.map((s) => `${s.n} ${cut(plain(s.text), 70)}${s.words?.length ? ` (${s.words.slice(0, 4).map((w) => w.ja).join(', ')})` : ''}`)
      lines.push(`- Kodansha Kanji Learner's Dictionary: core meaning ${k.core.join(', ')}. Senses: ${senses.join('; ')}`)
      if (k.special.length) lines.push(`  Special readings: ${k.special.map((w) => w.ja).join(', ')}`)
    }
    const g = dicts.kangorin
    if (g?.senses.length) lines.push(`- 新漢語林, senses used only in Japan (国訓): ${g.senses.map((s) => cut(plain(s.text), 80)).join(' ')}`)
    if (dicts.wiktionary?.length)
      lines.push(`- Wiktionary: ${dicts.wiktionary.map((e) => `${e.pos}${e.readings.length ? ` (${e.readings.join(', ')})` : ''}: ${cut(e.glosses.join('; '), 120)}`).join(' | ')}`)
  }

  lines.push(
    '',
    'Questions:',
    `1. Are the groups right? For each group say: keep, rename, merge or split, and why. Is a meaning of ${char} in modern Japanese missing?`,
    '2. Which words are in the wrong group? Check the (!) words first. For each wrong word, give the right group and the reason.',
    '3. Which words should be in "no meaning", and which words in "no meaning" do get a meaning from the kanji?',
    'For each answer, give the evidence, the sources, and how sure you are.',
  )
  return lines.join('\n')
}

/** Bulgarian: a word's senses with the Bulgarian now, or a kanji's meanings, and what the print dictionaries give. */
export function bgPrompt(detail: ItemDetail, value: string[]): string {
  const c = detail.context
  const book = detail.evidence?.book
  const rules = [
    'The dictionary is for Bulgarian speakers who learn Japanese. They search in Bulgarian, so each gloss must hold the words a Bulgarian would think of first.',
    'Rules: natural, short Bulgarian, the most usual word first, then close synonyms. For a verb, give both aspects (правя, направя). Japanese kanji are "канджи" in Bulgarian, never "кандзи". Do not add meanings the Japanese does not have.',
  ]
  const lines: string[] = []
  if (c.word) {
    const w = c.word
    lines.push(`Check the Bulgarian translation of the Japanese word ${w.headword} (${w.reading}) for a Japanese–Bulgarian dictionary. Search where you need to.`, ...rules, '')
    lines.push('Its senses (English, from JMdict), each with the Bulgarian it has now (a machine translation, or a reviewer’s):')
    w.senses.forEach((s, i) => lines.push(`${i + 1}. ${s.pos.length ? `[${s.pos.join(', ')}] ` : ''}${s.gloss} → ${value[i]?.trim() || '(no Bulgarian)'}`))
    const groups = (c.groups ?? []).filter((g) => g.en || g.group === CATCH_ALL)
    if (groups.length)
      lines.push('', `What its kanji bring: ${groups.map((g) => `${g.char}: ${g.group === CATCH_ALL ? 'no meaning (sound or spelling)' : `${g.en}${g.bg ? ` (${g.bg})` : ''}`}`).join('; ')}`)
    if (Array.isArray(book) && book.length)
      lines.push('', `Print Japanese–Bulgarian dictionaries give: ${(book as BookGloss[]).map((b) => `"${b.bg}" (${b.book === 'bg-ja' ? 'Иванов' : 'Цалта'}, for ${b.ja})`).join('; ')}`)
    lines.push('', 'For each sense: is the Bulgarian correct and natural? Give the best Bulgarian for it. Then list other words a Bulgarian might search with to find this word. Say how sure you are.')
  } else {
    const char = detail.subject.split(':')[1] ?? detail.subject
    lines.push(`Check the Bulgarian meanings of the kanji ${char} for a Japanese–Bulgarian kanji dictionary.`, ...rules, '')
    lines.push(`English meanings (KANJIDIC): ${(c.kanjidic ?? []).join(', ')}`)
    if (c.curated) lines.push(`Kanji Alive: ${c.curated}`)
    if (c.senses?.length) lines.push(`Its meaning groups: ${c.senses.map((g) => `${g.en}${g.bg ? ` (${g.bg})` : ''}`).join('; ')}`)
    lines.push(`The Bulgarian meanings now: ${value.filter((v) => v.trim()).join(', ') || '(none)'}`)
    if (book && !Array.isArray(book)) {
      const k = book as BookKeyword
      if (k.keyword) lines.push(`Цалта's kanji book gives the keyword "${k.keyword}"${k.alt ? ` and also "${k.alt}"` : ''}.`)
    }
    lines.push('', 'Are the Bulgarian meanings correct and natural? Give the best short list, most usual first, and say which of the current ones to change and why. Say how sure you are.')
  }
  return lines.join('\n')
}
