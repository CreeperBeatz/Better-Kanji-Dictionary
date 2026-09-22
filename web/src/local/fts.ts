/**
 * The English full-text indexes, answering the same queries the server sends
 * to SQLite FTS5 -- `"one" "two" "thr*"`, ordered by bm25 -- from the inverted
 * index server/offline.py read out of those very FTS5 tables.
 *
 * Ranking follows FTS5's bm25 exactly: k1 = 1.2, b = 0.75, idf floored at
 * 1e-6, document length counted over the whole row. Ties come back in rowid
 * order, as SQLite returns them. A quoted phrase that tokenises to several
 * words ("x-ray") has to find them adjacent and in order, which is what the
 * token positions in the pack are for.
 *
 * There is no prefix matching, because the server has none either: it sends
 * `"wat*"`, and inside quotes FTS5 reads the star as punctuation, so that is
 * the whole word "wat". Should the server start sending `"wat"*`, this has to
 * learn prefixes too -- SortedStrings.prefixRange is there for it.
 */

import { SortedStrings } from './sections'

const K1 = 1.2
const B = 0.75

/** unicode61 with remove_diacritics 2: fold case, drop marks, split on anything not a letter or number. */
export function tokenize(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{Co}]+/u)
    .filter(Boolean)
}

export interface Phrase {
  tokens: string[]
}

/** The server's query builder: each whitespace-separated word a quoted phrase. */
export function phrasesOf(words: string[]): Phrase[] {
  return words.map((w) => ({ tokens: tokenize(w) }))
}

export class FtsIndex {
  private readonly terms: SortedStrings
  private readonly pstart: Uint32Array
  private readonly doc: Uint32Array
  private readonly tf: Uint8Array
  private readonly pos: Uint8Array
  /** Where each posting's positions start in `pos`: the running sum of `tf`. */
  private readonly posStart: Uint32Array
  private readonly doclen: Uint16Array
  private readonly avgdl: number

  constructor(
    terms: SortedStrings,
    pstart: Uint32Array,
    doc: Uint32Array,
    tf: Uint8Array,
    pos: Uint8Array,
    doclen: Uint16Array,
  ) {
    this.terms = terms
    this.pstart = pstart
    this.doc = doc
    this.tf = tf
    this.pos = pos
    this.doclen = doclen
    this.posStart = new Uint32Array(tf.length + 1)
    for (let i = 0; i < tf.length; i++) this.posStart[i + 1] = this.posStart[i] + tf[i]
    let total = 0
    for (let i = 0; i < doclen.length; i++) total += doclen[i]
    this.avgdl = total / doclen.length
  }

  get size(): number {
    return this.doclen.length
  }

  /** How often each document contains one token. */
  private token(token: string): Uint32Array | null {
    const t = this.terms.indexOf(token)
    if (t < 0) return null
    const freq = new Uint32Array(this.size)
    for (let p = this.pstart[t]; p < this.pstart[t + 1]; p++) freq[this.doc[p]] += this.tf[p]
    return freq
  }

  /** The posting of term `t` in document `d`, or -1. Postings are in document order. */
  private posting(t: number, d: number): number {
    let lo = this.pstart[t]
    let hi = this.pstart[t + 1]
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.doc[mid] < d) lo = mid + 1
      else hi = mid
    }
    return lo < this.pstart[t + 1] && this.doc[lo] === d ? lo : -1
  }

  private hasPosition(p: number, at: number): boolean {
    for (let i = this.posStart[p]; i < this.posStart[p + 1]; i++) if (this.pos[i] === at) return true
    return false
  }

  /** Per-document frequency of a whole phrase; null when nothing has it. */
  private phrase(p: Phrase): Uint32Array | null {
    if (p.tokens.length === 1) return this.token(p.tokens[0])

    const ts = p.tokens.map((t) => this.terms.indexOf(t))
    if (ts.some((t) => t < 0)) return null
    const freq = new Uint32Array(this.size)
    let any = false
    // Walk the first word's occurrences and look for the rest right after it.
    for (let p0 = this.pstart[ts[0]]; p0 < this.pstart[ts[0] + 1]; p0++) {
      const d = this.doc[p0]
      const rest = ts.slice(1).map((t) => this.posting(t, d))
      if (rest.some((r) => r < 0)) continue
      let n = 0
      for (let i = this.posStart[p0]; i < this.posStart[p0 + 1]; i++) {
        const at = this.pos[i]
        if (rest.every((r, k) => this.hasPosition(r, at + k + 1))) n++
      }
      if (n) {
        freq[d] = n
        any = true
      }
    }
    return any ? freq : null
  }

  /** Documents matching every phrase, best first, at most `limit`. */
  search(phrases: Phrase[], limit: number): number[] {
    // A phrase with no letters in it is dropped by FTS5, not failed on --
    // unless it is all there is.
    const live = phrases.filter((p) => p.tokens.length > 0)
    if (live.length === 0) return []

    const freqs: Uint32Array[] = []
    for (const p of live) {
      const f = this.phrase(p)
      if (!f) return []
      freqs.push(f)
    }

    const n = this.size
    const idf = freqs.map((f) => {
      let hits = 0
      for (let d = 0; d < n; d++) if (f[d]) hits++
      const v = Math.log((n - hits + 0.5) / (hits + 0.5))
      return v <= 0 ? 1e-6 : v
    })

    const docs: number[] = []
    const scores: number[] = []
    outer: for (let d = 0; d < n; d++) {
      for (const f of freqs) if (!f[d]) continue outer
      const norm = K1 * (1 - B + (B * this.doclen[d]) / this.avgdl)
      let score = 0
      for (let i = 0; i < freqs.length; i++) {
        const tf = freqs[i][d]
        score += (idf[i] * (tf * (K1 + 1))) / (tf + norm)
      }
      docs.push(d)
      scores.push(score)
    }

    const order = docs.map((_, i) => i)
    order.sort((a, b) => scores[b] - scores[a] || docs[a] - docs[b])
    return order.slice(0, limit).map((i) => docs[i])
  }
}
