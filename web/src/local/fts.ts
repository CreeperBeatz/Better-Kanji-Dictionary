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
 * A phrase can end in a prefix, as the server's `"wat"*`: its last word then
 * matches every term starting with it, each occurrence counting as a hit.
 */

import { SortedStrings } from './sections'

const K1 = 1.2
const B = 0.75

// unicode61 drops only these combining marks; every other mark splits a token.
const DROPPED = /[\u0300-\u0304\u0306-\u030C\u030F\u0311\u031B\u0323-\u0328\u032D-\u032E\u0330-\u0331]/g
// It folds accented letters only in the Latin blocks: é is e, but the Cyrillic
// й, ё and ѝ are letters of their own and stay as they are.
const LATIN = /[\u00C0-\u024F\u1E00-\u1EFF]/g
// Case folds that toLowerCase does not make.
const FOLD: Record<string, string> = {
  µ: 'μ', ſ: 's', ẛ: 's', ς: 'σ', ϐ: 'β', ϑ: 'θ', ϕ: 'φ', ϖ: 'π', ϰ: 'κ', ϱ: 'ρ', ϵ: 'ε',
}

function unaccent(c: string): string {
  if (c === 'Ǡ' || c === 'ǡ') return c // its table has no entry for a with dot and macron
  const d = c.normalize('NFD')
  return /^[A-Za-z]$/.test(d[0]) && d.length > 1 && d.slice(1).replace(DROPPED, '') === '' ? d[0] : c
}

/**
 * unicode61 with remove_diacritics 2: fold case, drop the marks it drops,
 * split on anything not a letter or number. Checked against SQLite for every
 * character in the Latin, Greek, Cyrillic and kana blocks.
 */
export function tokenize(s: string): string[] {
  return s
    .replace(LATIN, unaccent)
    .replace(DROPPED, '')
    .toLowerCase()
    .replace(/[µſẛςϐϑϕϖϰϱϵ]/g, (c) => FOLD[c])
    .split(/[^\p{L}\p{N}\p{Co}]+/u)
    .filter(Boolean)
}

export interface Phrase {
  tokens: string[]
  /** The last token also matches longer terms starting with it: `"wat"*`. */
  prefix?: boolean
}

/** The server's query builder (`_phrases`): each whitespace-separated word a quoted phrase, the last one a prefix if asked. */
export function phrasesOf(words: string[], prefix = false): Phrase[] {
  return words.map((w, i) => ({ tokens: tokenize(w), prefix: prefix && i === words.length - 1 }))
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

  /** How many documents hold `term` -- fts5vocab's `doc` column. */
  docs(term: string): number {
    const t = this.terms.indexOf(term)
    return t < 0 ? 0 : this.pstart[t + 1] - this.pstart[t]
  }

  /** Every term, with how many documents hold it: fts5vocab's `row` table. */
  *vocabulary(): Generator<[string, number]> {
    for (let t = 0; t < this.terms.count; t++) yield [this.terms.at(t), this.pstart[t + 1] - this.pstart[t]]
  }

  /** The terms a phrase's token stands for, as [lo, hi): itself, or every term starting with it. */
  private termRange(token: string, prefix: boolean): [number, number] {
    if (prefix) return this.terms.prefixRange(token)
    const t = this.terms.indexOf(token)
    return t < 0 ? [0, 0] : [t, t + 1]
  }

  /** How often each document contains one of the terms in [lo, hi). */
  private token(lo: number, hi: number): Uint32Array | null {
    if (lo >= hi) return null
    const freq = new Uint32Array(this.size)
    for (let t = lo; t < hi; t++) for (let p = this.pstart[t]; p < this.pstart[t + 1]; p++) freq[this.doc[p]] += this.tf[p]
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
    const last = p.tokens.length - 1
    const ranges = p.tokens.map((t, i) => this.termRange(t, !!p.prefix && i === last))
    if (p.tokens.length === 1) return this.token(...ranges[0])
    if (ranges.some(([lo, hi]) => lo >= hi)) return null

    const freq = new Uint32Array(this.size)
    let any = false
    // Walk the first word's occurrences and look for the rest right after it;
    // the last word may be any term of its range.
    const first = ranges[0][0]
    const middle = ranges.slice(1, -1).map(([t]) => t)
    const [lastLo, lastHi] = ranges[last]
    for (let p0 = this.pstart[first]; p0 < this.pstart[first + 1]; p0++) {
      const d = this.doc[p0]
      const mid = middle.map((t) => this.posting(t, d))
      if (mid.some((r) => r < 0)) continue
      const ends: number[] = []
      for (let t = lastLo; t < lastHi; t++) {
        const r = this.posting(t, d)
        if (r >= 0) ends.push(r)
      }
      if (!ends.length) continue
      let n = 0
      for (let i = this.posStart[p0]; i < this.posStart[p0 + 1]; i++) {
        const at = this.pos[i]
        if (mid.every((r, k) => this.hasPosition(r, at + k + 1)) && ends.some((r) => this.hasPosition(r, at + last))) n++
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
