/**
 * Spelling correction for a search that found nothing, ported from
 * server/spelling.py -- the same guesses on the device as on the server.
 *
 * Each word the index does not know is matched against the words it does
 * know, closest first on a sound-alike key (a doubled letter once; in English
 * ph is f and ck is k), then on the letters as typed, then the most common.
 */

import { compareCodePoints } from './sections'

const MIN_LENGTH = 4
const MAX_SUGGESTIONS = 3

/** The sound-alike key: doubled letters once; in English ph is f, ck is k. */
export function soundKey(word: string, english: boolean): string {
  if (english) word = word.replaceAll('ph', 'f').replaceAll('ck', 'k')
  // Python's re (.)\1+ over code points.
  let out = ''
  let last = ''
  for (const c of word) {
    if (c !== last) out += c
    last = c
  }
  return out
}

/** Damerau-Levenshtein (optimal string alignment) distance over code points, or cap + 1 once past cap. */
export function distance(x: string, y: string, cap: number): number {
  const a = [...x]
  const b = [...y]
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i, ...new Array<number>(b.length).fill(0)]
    let low = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      low = Math.min(low, v)
    }
    if (low > cap) return cap + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

const length = (s: string) => [...s].length

export class Vocabulary {
  private readonly known: (term: string) => boolean
  private readonly english: boolean
  private readonly groups = new Map<string, [string, string, number][]>()

  /** `terms` with how many documents hold each. */
  constructor(terms: Iterable<[string, number]>, english: boolean) {
    const all = new Set<string>()
    this.english = english
    for (const [term, n] of terms) {
      all.add(term)
      const k = soundKey(term, english)
      if (!k) continue
      const first = [...k][0]
      const group = this.groups.get(first)
      if (group) group.push([term, k, n])
      else this.groups.set(first, [[term, k, n]])
    }
    this.known = (t) => all.has(t)
  }

  /** The known words `word` is most likely a misspelling of, best first; none if known or too short. */
  suggest(word: string): string[] {
    const n = length(word)
    if (n < MIN_LENGTH || this.known(word)) return []
    const cap = n <= 5 ? 1 : 2
    const k = soundKey(word, this.english)
    if (!k) return []
    const kn = length(k)
    const found: [number, number, number, string][] = []
    for (const [term, tk, docs] of this.groups.get([...k][0]) ?? []) {
      if (Math.abs(length(tk) - kn) > cap) continue
      const d = distance(k, tk, cap)
      if (d <= cap) found.push([d, distance(word, term, cap + 2), -docs, term])
    }
    found.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || compareCodePoints(a[3], b[3]))
    // Only as close as the best: hapy is happy, not hazy or hay as well.
    return found.filter((f) => f[0] === found[0][0]).slice(0, MAX_SUGGESTIONS).map((f) => f[3])
  }
}
