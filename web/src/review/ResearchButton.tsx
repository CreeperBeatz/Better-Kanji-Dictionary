/**
 * "Research in Claude" on a character's card: a new conversation on
 * claude.ai, in the reviewer's own account, with a prompt that asks every
 * open question on the card -- the parts, each form link, the part's
 * meaning -- and lists the answers the card offers, lettered, with who gives
 * each and the draft's reason, so Claude judges each one and picks. The
 * prompt is also copied, for when the page opens without it. Research mode
 * is switched on in Claude itself.
 */
import { useState } from 'react'
import type { CharacterCard, FormLink, PartMeaning } from '../api'
import { strings, useLang } from '../i18n'
import { draftOf, partsOptions, setOf } from './cardOptions'
import { useLinkSentence } from './KindsInfo'

const S = strings(
  {
    open: 'Research in Claude ↗',
    title: 'Open a new conversation on claude.ai with a research prompt about this card (the prompt is also copied)',
    copied: 'Prompt copied. If Claude opens without it, paste it. Turn on Research in Claude for a deep search.',
  },
  {
    open: 'Проучване в Claude ↗',
    title: 'Отваря нов разговор в claude.ai със заявка за проучване по тази карта (заявката се копира и в клипборда)',
    copied: 'Заявката е копирана. Ако Claude се отвори без нея, поставете я. Включете Research в Claude за задълбочено търсене.',
  },
)

const NAMES: Record<string, string> = {
  kanjivg: 'KanjiVG',
  ids: 'IDS (BabelStone)',
  tsalta: 'Tsalta’s kanji book',
  'cjk-decomp': 'cjk-decomp',
  topokanji: 'topokanji',
}

const LETTERS = 'ABCDEFGH'
const list = (parts: string[]) => (parts.length ? parts.join(' + ') : 'no parts')

type Sentence = (kind: FormLink['kind'], subject: string, reverse?: boolean) => string

/** The prompt: one numbered question per kind of item on the card, each with the card's answers, lettered. */
export function researchPrompt(card: CharacterCard, sentence: Sentence): string {
  const c = card.char
  const parts = card.items.filter((i) => i.type === 'decomposition')
  const forms = card.items.filter((i) => i.type === 'form_link')
  const meaning = card.items.find((i) => i.type === 'part_meaning')
  const users = Array.isArray(card.context.users) ? card.context.users.slice(0, 15) : []
  const lines: string[] = [
    `Research the character ${c} for a Japanese kanji dictionary for learners. Do a deep search.`,
    'Check the historical forms (oracle bone, bronze, seal script, Shuowen Jiezi), the old Japanese form (kyūjitai), Japanese kanji dictionaries (Kanjigen, Shinjigen, Kadokawa Shinjigen), KanjiVG, and IDS data. Cite your sources.',
    'A reviewer must choose one answer for each question below. Judge each answer: say if it is correct, wrong or partly correct, and why. Then recommend one answer. If no answer is correct, give the correct one.',
    '',
  ]
  const answers = (opts: string[]) => opts.forEach((o, i) => lines.push(`   ${LETTERS[i]}. ${o}`))
  let n = 0

  if (parts.length) {
    const splits = card.context.splits ?? []
    const by = (p: string[]) => splits.filter((s) => setOf(s.parts) === setOf(p)).map((s) => NAMES[s.source] ?? s.source)
    const from = (who: string[]) => (who.length ? ` (given by ${who.join(', ')})` : '')
    const draft = draftOf(parts)
    lines.push(`${++n}. Parts. Which components is ${c} built from, as it is written in Japan today?`)
    lines.push('   Rules: a basic pictograph stays one piece. Otherwise prefer the split the standard sources give for today’s shape. Use the old form only when the sources do not decide. A shape that only looks like a part is not a part. Every part must be a real character or component, and together they must cover the whole shape.')
    const opts = partsOptions(parts, card.context.parts, draft).map((o) => {
      if (o.key === 'now') return `Keep it as it is: ${list(o.parts)}${from(by(o.parts))}`
      if (o.key === 'atomic') return 'No parts: it is learned as one piece'
      if (o.key === 'draft' && draft)
        return `Use the AI draft: ${list(o.parts)}${from(['an AI draft (Claude Sonnet)', ...by(o.parts)])}. The draft’s reason: ${draft.why}`
      return `Use the proposal: ${list(o.parts)}${from(by(o.parts).length ? by(o.parts) : [o.item?.source ?? 'a source'])}`
    })
    answers([...opts, 'Something else: a split of your own'])
  }

  for (const f of forms) {
    const [a, b] = f.subject.split('|')
    const p = f.proposed as FormLink | null
    const now = f.current as FormLink | null
    lines.push(`${++n}. Relation between ${a} and ${b}.`)
    answers([
      ...(p ? [`Use the proposal: “${sentence(p.kind, f.subject, p.reverse)}”${p.note ? `. Its evidence: ${p.note}` : ''}`] : []),
      `Leave it as it is: ${now && now.kind !== 'none' ? `“${sentence(now.kind, f.subject, now.reverse)}”` : 'no link between them'}`,
      `Something else, one of: “${a} is a form of ${b}” (the same character written for its position, giving its meaning); “one is the old form of the other”; “${a} only looks like ${b}” (a memory aid); “separate characters with the same meaning”; “not related”`,
    ])
  }

  if (meaning) {
    const p = meaning.proposed as PartMeaning | null
    lines.push(`${++n}. The part ${c} has no meaning in KANJIDIC. What is it?${users.length ? ` It is in: ${users.join(' ')}.` : ''}`)
    answers([
      ...(p
        ? [`Use the proposal: ${p.kind === 'shape' ? `a shape with no single meaning, named “${p.en}”` : `its own meaning, “${p.en}”`}${p.note ? `. Note: ${p.note}` : ''}`]
        : []),
      'Another version: its own meaning (a real character that gives its meaning), or a shape with a name (several unrelated old parts became one shape)',
      'It is a form of one kanji, which gives it its meaning (see the relations above)',
      'Leave it with no meaning for now',
    ])
    lines.push('   For each kanji listed, say what the part stands for in it.')
  }

  lines.push('', 'For each question, give: your judgement of each lettered answer, your recommended answer, the evidence, the sources, and how sure you are.')
  return lines.join('\n')
}

export function ResearchButton({ card }: { card: CharacterCard }) {
  const t = S(useLang())
  const sentence = useLinkSentence()
  const [copied, setCopied] = useState(false)
  function open() {
    const prompt = researchPrompt(card, sentence)
    navigator.clipboard?.writeText(prompt).then(
      () => setCopied(true),
      () => {},
    )
    window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener')
  }
  return (
    <>
      <button type="button" className="clear research-open" title={t('title')} onClick={open}>
        {t('open')}
      </button>
      {copied && <p className="hint research-copied">{t('copied')}</p>}
    </>
  )
}
