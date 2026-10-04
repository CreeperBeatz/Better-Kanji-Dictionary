/**
 * Work in progress on a review item, kept in the browser until it is
 * decided: the answer being edited, the reason, and on the meanings board
 * where the words are and what was confirmed. A reload, or coming back
 * tomorrow, picks up where it was left. Deciding the item (accept, edit,
 * reject) throws it away; skipping keeps it.
 */
import type { TaskValue } from '../api'

const PREFIX = 'betterrtk:review-draft:'
const KEEP_DAYS = 30

export interface BoardDraft {
  okWords: number[]
  openOk: string[]
  shut: string[]
}

export interface ItemDraft {
  at: number
  draft?: TaskValue
  reason?: string
  placements?: Record<number, string | null>
  /** Meanings: the words left for later. */
  skipped?: number[]
  /** A kanji's Bulgarian card: the groups' Bulgarian labels as edited. */
  labels?: Record<string, string>
  board?: BoardDraft
}

export function readDraft(id: string): ItemDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + id)
    return raw ? (JSON.parse(raw) as ItemDraft) : null
  } catch {
    return null
  }
}

/** Merge `patch` in; a field set to undefined is dropped, and an empty draft is removed. */
export function writeDraft(id: string, patch: Partial<Omit<ItemDraft, 'at'>>) {
  try {
    const next: Record<string, unknown> = { ...(readDraft(id) ?? {}), ...patch }
    delete next.at
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    if (Object.keys(next).length === 0) localStorage.removeItem(PREFIX + id)
    else localStorage.setItem(PREFIX + id, JSON.stringify({ ...next, at: Date.now() }))
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
