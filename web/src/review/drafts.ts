/**
 * Work in progress on a review item, kept in the browser until it is
 * decided: the answer being edited, the reason, and on the meanings board
 * where the words are and what was confirmed. A reload, or coming back
 * tomorrow, picks up where it was left. Deciding the item (accept, edit,
 * reject) throws it away; skipping keeps it.
 *
 * Work is kept with a fingerprint of what the card proposed when it began
 * (`checkDraft`). If the proposal changed since (a redraft), the work no
 * longer fits it -- a word placed in a group that is gone would silently
 * fall out -- so it is thrown away, and the card says so.
 */
import type { KanjiExtras, TaskValue } from '../api'
import { strings } from '../i18n'

/** Shown on a card whose kept work `checkDraft` threw away. */
export const DROPPED = strings(
  { workDropped: 'This card changed after you began it. Your unsaved work on it was thrown away.' },
  { workDropped: 'Тази карта се промени, след като я започнахте. Незапазената ви работа по нея е изхвърлена.' },
)

const PREFIX = 'betterrtk:review-draft:'
const KEEP_DAYS = 30

export interface BoardDraft {
  okWords: number[]
  /** Boxes whose confirmed words are folded away (they show by default). */
  openOk?: string[]
  shut: string[]
}

export interface ItemDraft {
  at: number
  /** The fingerprint of the proposal the work began on (see checkDraft). */
  base?: string
  draft?: TaskValue
  reason?: string
  placements?: Record<number, string | null>
  /** Meanings: the words left for later. */
  skipped?: number[]
  /** A kanji's Bulgarian card: the groups' Bulgarian labels as edited. */
  labels?: Record<string, string>
  /** And their Bulgarian notes. */
  notes?: Record<string, string>
  /** A kanji's Bulgarian card: the Bulgarian of each group's about, by group id. */
  aboutBg?: Record<string, string>
  /** A kanji's extras as edited on its meanings or Bulgarian card. */
  extras?: KanjiExtras
  board?: BoardDraft
  /** A character's card: each step's answer (CharacterCard.tsx). */
  card?: unknown
}

export function readDraft(id: string): ItemDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + id)
    return raw ? (JSON.parse(raw) as ItemDraft) : null
  } catch {
    return null
  }
}

/** A short fingerprint of a value (djb2 over its JSON): enough to notice that a proposal changed. */
export function fingerprint(v: unknown): string {
  const text = JSON.stringify(v) ?? ''
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// The fingerprint each item's work is written under, set when its card opens.
const bases = new Map<string, string>()

/**
 * When an item's card opens, with the fingerprint of what it proposes now:
 * kept work begun on another proposal is thrown away (true: tell the reviewer).
 * Work kept before fingerprints existed is taken as it is.
 */
export function checkDraft(id: string, base: string): boolean {
  bases.set(id, base)
  const kept = readDraft(id)
  if (kept?.base && kept.base !== base) {
    clearDraft(id)
    return true
  }
  return false
}

/** Merge `patch` in; a field set to undefined is dropped, and an empty draft is removed. */
export function writeDraft(id: string, patch: Partial<Omit<ItemDraft, 'at' | 'base'>>) {
  try {
    const old = readDraft(id)
    const next: Record<string, unknown> = { ...(old ?? {}), ...patch }
    delete next.at
    delete next.base
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    const base = bases.get(id) ?? old?.base
    if (Object.keys(next).length === 0) localStorage.removeItem(PREFIX + id)
    else localStorage.setItem(PREFIX + id, JSON.stringify({ ...next, ...(base ? { base } : {}), at: Date.now() }))
  } catch {
    // Private mode or a full store: the work just isn't kept.
  }
}

export function clearDraft(id: string) {
  try {
    localStorage.removeItem(PREFIX + id)
  } catch {
    // nothing kept, nothing to clear
  }
}

// Drafts nobody came back to for a month are dropped.
try {
  const old = Date.now() - KEEP_DAYS * 86_400_000
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (!k?.startsWith(PREFIX)) continue
    const d = readDraft(k.slice(PREFIX.length))
    if (!d || d.at < old) localStorage.removeItem(k)
  }
} catch {
  // no storage
}
