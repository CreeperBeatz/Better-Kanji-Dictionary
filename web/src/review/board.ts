/**
 * The meanings board as the server takes it, shared by the queue and a
 * page's Edit dialog: where each word starts, and `finalizeBoard`, which
 * turns the board into the groups with their final ids and word id -> group id.
 */
import type { BoardWord, MeaningGroup } from '../api'
import { CATCH_ALL } from './editors'

/** Word id -> the group it is in; null: in none. */
export type Placements = Record<number, string | null>

/** Equal as the server would see them: values are plain JSON. */
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A board with nothing left for later: one word to place, or a page's. */
export const NO_WORDS = new Set<number>()

const isNew =(id: string) => /\.new\d+$/.test(id)

/** Where each word on the board starts: its group, if that group is one of `groups`. */
export function startPlacements(board: BoardWord[], groups: MeaningGroup[] | null): Placements {
  const ids = new Set((groups ?? []).map((g) => g.id))
  const p: Placements = {}
  for (const w of board) p[w.id] = w.group && (w.group === CATCH_ALL || ids.has(w.group)) ? w.group : null
  return p
}

/** `p` with each of `ids` moved to `to`. */
export const placed = (p: Placements, ids: number[], to: string | null): Placements => ({
  ...p,
  ...Object.fromEntries(ids.map((id) => [id, to])),
})

/** Groups with their final ids (new ones named from their English label) and every placement under them. */
export function finalizeBoard(char: string, groups: MeaningGroup[], placements: Placements) {
  const taken = new Set(groups.filter((g) => !isNew(g.id)).map((g) => g.id))
  const rename: Record<string, string> = {}
  const out = groups.map((g, i) => {
    if (!isNew(g.id)) return g
    const base = g.en.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || `g${i + 1}`
    let id = `${char}.${base}`
    for (let n = 2; taken.has(id); n++) id = `${char}.${base}-${n}`
    taken.add(id)
    rename[g.id] = id
    return { ...g, id }
  })
  // A word left in a group that is gone is in no group.
  const ids = new Set([...out.map((g) => g.id), CATCH_ALL])
  const words: Placements = {}
  for (const [id, b] of Object.entries(placements)) {
    const to = b && rename[b] ? rename[b] : b
    words[Number(id)] = to && ids.has(to) ? to : null
  }
  // A best example moved out of its group is no longer one of its examples.
  const kept = out.map((g) => (g.examples?.some((w) => words[w] !== g.id) ? { ...g, examples: g.examples.filter((w) => words[w] === g.id) } : g))
  return { groups: kept, words }
}
