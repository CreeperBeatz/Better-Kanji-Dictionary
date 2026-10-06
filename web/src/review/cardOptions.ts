/**
 * What a character's card offers for its parts question (CharacterCard.tsx),
 * shared with the research prompt (ResearchButton.tsx), which lists the same
 * answers for Claude to judge.
 */
import type { ItemDetail } from '../api'

/** The AI's view of a character's parts (pipeline/decomp_drafts.py), on its items' evidence. */
export interface Draft {
  parts: string[]
  verdict: 'keep' | 'change'
  why: string
  confidence: number
  lookalikes?: string[]
  flags?: string[]
}

export interface PartsOption {
  key: string
  parts: string[]
  /** The item whose proposal this is, if one. */
  item?: ItemDetail
}

export const setOf = (a: string[]) => [...a].sort().join('')

/**
 * The parts answers on offer, in a fixed order: each source's distinct
 * proposal, today's, the draft, and no parts last. The draft takes the place
 * of any answer with the same parts (it carries that answer's labels), so
 * nothing is offered twice; its own items (an `ai:` source) are the draft.
 */
export function partsOptions(items: ItemDetail[], now: string[], draft: Draft | null): PartsOption[] {
  const out: PartsOption[] = []
  const drafted = draft ? setOf(draft.parts) : null
  const seen = new Set<string>([setOf(now)])
  for (const i of items) {
    const p = i.proposed as string[] | null
    if (!p || i.source.startsWith('ai:') || seen.has(setOf(p)) || setOf(p) === drafted) continue
    seen.add(setOf(p))
    out.push({ key: `p:${i.id}`, parts: p, item: i })
  }
  if (setOf(now) !== drafted) out.push({ key: 'now', parts: now })
  if (draft) out.push({ key: 'draft', parts: draft.parts })
  if (!seen.has('') && drafted !== '') out.push({ key: 'atomic', parts: [] })
  return out
}

/** The draft on a card's parts items, if any has one. */
export function draftOf(items: ItemDetail[]): Draft | null {
  for (const i of items) {
    const d = i.evidence?.draft as Draft | undefined
    if (d) return d
  }
  return null
}
