/**
 * Where the other dictionaries put a kanji's words, against where the board
 * has them now (server/dictionaries.py matches the words).
 *
 * A dictionary sense (Kodansha's 1a, 新漢語林's ❷) is one meaning, so its
 * words belong in one group. Each sense goes with the group most of its
 * board words are in; a word of that sense in another group is "elsewhere":
 * the board marks it, and it does not start ticked. When a sense's words
 * split evenly, no group wins and every one of them is elsewhere. Цалта
 * lists words without senses, and a special reading (生憎) is about the
 * reading, not the meaning: neither places a word.
 */
import type { BoardWord, KanjiDictionaries, MeaningGroup } from '../api'
import type { Placements } from './board'
import { CATCH_ALL } from './editors'

export type Bucket = string | null

export interface SenseStat {
  /** Board words of the sense in each bucket. */
  counts: Map<Bucket, number>
  /** The bucket most of them are in; undefined on a tie. */
  group: Bucket | undefined
  total: number
}

const placesWords = (src: string, key: string) => src !== 'tsalta' && key !== 'special'

/** The bucket a word is in now: where it was moved, else where the draft put it; a group that is gone is none. */
export function bucketOf(w: BoardWord, placements: Placements, groups: MeaningGroup[]): Bucket {
  const b = w.id in placements ? placements[w.id] : w.group
  return b && (b === CATCH_ALL || groups.some((g) => g.id === b)) ? b : null
}

export function senseStats(d: KanjiDictionaries, words: BoardWord[], placements: Placements, groups: MeaningGroup[]): Map<string, SenseStat> {
  const out = new Map<string, SenseStat>()
  for (const w of words) {
    const b = bucketOf(w, placements, groups)
    for (const tag of d.words[String(w.id)] ?? []) {
      if (!placesWords(tag.src, tag.key)) continue
      const k = `${tag.src}|${tag.key}`
      if (!out.has(k)) out.set(k, { counts: new Map(), group: undefined, total: 0 })
      const s = out.get(k)!
      s.counts.set(b, (s.counts.get(b) ?? 0) + 1)
      s.total++
    }
  }
  for (const s of out.values()) {
    const ranked = [...s.counts.entries()].sort((a, b) => b[1] - a[1])
    s.group = ranked.length > 1 && ranked[0][1] === ranked[1][1] ? undefined : ranked[0][0]
  }
  return out
}

/** Word id -> the senses (as "src|key") whose other words are in another group. */
export function elsewhere(d: KanjiDictionaries, words: BoardWord[], placements: Placements, groups: MeaningGroup[]): Map<number, string[]> {
  const stats = senseStats(d, words, placements, groups)
  const out = new Map<number, string[]>()
  for (const w of words) {
    const b = bucketOf(w, placements, groups)
    for (const tag of d.words[String(w.id)] ?? []) {
      const s = stats.get(`${tag.src}|${tag.key}`)
      if (!s || s.total < 2 || s.group === b) continue
      if (!out.has(w.id)) out.set(w.id, [])
      out.get(w.id)!.push(`${tag.src}|${tag.key}`)
    }
  }
  return out
}
