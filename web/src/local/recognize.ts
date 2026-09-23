/**
 * Handwriting lookup on the device, ported from server/recognize.py -- see
 * there for why each constant is what it is. The reference glyphs arrive as
 * the server's own stroke features, so only the drawing is measured here, and
 * both sides compare the same numbers.
 */

import { compareCodePoints } from './sections'

const BOX = 255
const DIRECTION_MIN = 51
const DIAGONAL_RATIO = 77 / 256
const CELL = BOX / 3

const W_STROKE_DIR = 1.0
const W_MOVE_DIR = 0.8
const W_LOCATION = 0.6
const W_LENGTH = 0.5
const NEAR = 0.7

const LENGTH_CUTS = [0.18, 0.34, 0.5, 0.68]
const LENGTH_BUCKETS = LENGTH_CUTS.length + 1
const LENGTH_POWER = 0.1
export const STROKE_WINDOW = 3
const OFFBY1_PENALTY = 0.92
const ORDER_BONUS = 25.0
const ORDER_GATE = 80.0
const DOT = 8

export const MAX_RESULTS = 12
export const MAX_STROKES = 40
const RERANK = 60

/** Python's round(): half to even, which matters for the exact .5s the tables produce. */
function pyRound(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

type Line = [number, number, number, number]

function direction(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < DIRECTION_MIN && ady < DIRECTION_MIN) return DOT
  if (adx > ady) {
    const diagonal = ady > DIAGONAL_RATIO * adx
    if (dx > 0) return diagonal ? (dy < 0 ? 1 : 3) : 2
    return diagonal ? (dy < 0 ? 7 : 5) : 6
  }
  const diagonal = adx > DIAGONAL_RATIO * ady
  if (dy > 0) return diagonal ? (dx < 0 ? 5 : 3) : 4
  return diagonal ? (dx < 0 ? 7 : 1) : 0
}

function dirClose(a: number, b: number): boolean {
  if (a === DOT || b === DOT || a === b) return true
  return (a + 1) % 8 === b || (b + 1) % 8 === a
}

function cell(x: number, y: number): number {
  const col = x < CELL ? 0 : x < 2 * CELL ? 1 : 2
  const row = y < CELL ? 0 : y < 2 * CELL ? 1 : 2
  return col * 3 + row
}

function cellClose(a: number, b: number): boolean {
  return Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) <= 1 && Math.abs((a % 3) - (b % 3)) <= 1
}

function lengthBucket(x1: number, y1: number, x2: number, y2: number): number {
  const d = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / BOX
  for (let i = 0; i < LENGTH_CUTS.length; i++) if (d < LENGTH_CUTS[i]) return i
  return LENGTH_BUCKETS - 1
}

const LENGTH_TABLE: number[] = []
for (let a = 0; a < LENGTH_BUCKETS; a++)
  for (let b = 0; b < LENGTH_BUCKETS; b++)
    LENGTH_TABLE.push(pyRound(100 * W_LENGTH * (a === b ? 1.0 : Math.abs(a - b) === 1 ? NEAR : 0.0)))

/** Fit stroke lines to the 0..255 box, uniformly. */
export function normalise(lines: Line[]): Line[] {
  if (!lines.length) return lines
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
  for (const l of lines) {
    minx = Math.min(minx, l[0], l[2])
    maxx = Math.max(maxx, l[0], l[2])
    miny = Math.min(miny, l[1], l[3])
    maxy = Math.max(maxy, l[1], l[3])
  }
  let side = Math.max(maxx - minx, maxy - miny)
  if (side < 1e-6) side = 1.0
  const scale = BOX / side
  const cx = (minx + maxx) / 2
  const cy = (miny + maxy) / 2
  const half = BOX / 2
  return lines.map((l) => [
    (l[0] - cx) * scale + half,
    (l[1] - cy) * scale + half,
    (l[2] - cx) * scale + half,
    (l[3] - cy) * scale + half,
  ])
}

const DESCRIPTORS = 9 * 9 * 9
const TABLE_MAX = pyRound(100 * (W_STROKE_DIR + 2 * W_LOCATION))
const SIM_MAX = TABLE_MAX + pyRound(100 * W_LENGTH)

function descriptor(d: number, start: number, end: number): number {
  return (d * 9 + start) * 9 + end
}

let TABLE: Uint8Array | null = null

function table(): Uint8Array {
  if (TABLE) return TABLE
  const dirScore: number[][] = []
  const locScore: number[][] = []
  for (let a = 0; a < 9; a++) {
    dirScore.push([])
    locScore.push([])
    for (let b = 0; b < 9; b++) {
      dirScore[a].push(pyRound(100 * W_STROKE_DIR * (a === b ? 1.0 : dirClose(a, b) ? NEAR : 0.0)))
      locScore[a].push(pyRound(100 * W_LOCATION * (a === b ? 1.0 : cellClose(a, b) ? NEAR : 0.0)))
    }
  }
  const t = new Uint8Array(DESCRIPTORS * DESCRIPTORS)
  for (let da = 0; da < 9; da++)
    for (let sa = 0; sa < 9; sa++)
      for (let ea = 0; ea < 9; ea++) {
        const base = descriptor(da, sa, ea) * DESCRIPTORS
        for (let db = 0; db < 9; db++) {
          const d = dirScore[da][db]
          for (let sb = 0; sb < 9; sb++) {
            const ds = d + locScore[sa][sb]
            const off = base + (db * 9 + sb) * 9
            const row = locScore[ea]
            for (let eb = 0; eb < 9; eb++) t[off + eb] = ds + row[eb]
          }
        }
      }
  TABLE = t
  return t
}

interface Features {
  dirs: number[]
  starts: number[]
  ends: number[]
  lengths: number[]
  /** The pen's travel between strokes: moves[i] is from stroke i to i + 1. */
  moves: number[]
  /** The travel that replaces moves[i - 1] and moves[i] when stroke i is dropped. */
  seams: number[]
}

/** A character reduced to one line per stroke, as features. */
class Glyph {
  readonly f: Features
  private _counted: [number, number, number][] | null = null

  constructor(f: Features) {
    this.f = f
  }

  /** From lines on the 0..255 box, which is how a drawing arrives. */
  static of(lines: Line[]): Glyph {
    const moves: number[] = []
    for (let i = 1; i < lines.length; i++)
      moves.push(direction(lines[i - 1][2], lines[i - 1][3], lines[i][0], lines[i][1]))
    const seams: number[] = []
    for (let i = 1; i < lines.length - 1; i++)
      seams.push(direction(lines[i - 1][2], lines[i - 1][3], lines[i + 1][0], lines[i + 1][1]))
    return new Glyph({
      dirs: lines.map((l) => direction(l[0], l[1], l[2], l[3])),
      starts: lines.map((l) => cell(l[0], l[1])),
      ends: lines.map((l) => cell(l[2], l[3])),
      lengths: lines.map((l) => lengthBucket(l[0], l[1], l[2], l[3])),
      moves,
      seams,
    })
  }

  /** From the pack: one number per stroke, ((dir * 9 + start) * 9 + end) * 5 + length. */
  static packed(codes: number[], moves: number[], seams: number[]): Glyph {
    const f: Features = { dirs: [], starts: [], ends: [], lengths: [], moves, seams }
    for (const c of codes) {
      f.lengths.push(c % LENGTH_BUCKETS)
      const d = Math.floor(c / LENGTH_BUCKETS)
      f.ends.push(d % 9)
      f.starts.push(Math.floor(d / 9) % 9)
      f.dirs.push(Math.floor(d / 81))
    }
    return new Glyph(f)
  }

  get size(): number {
    return this.f.dirs.length
  }

  /** Distinct (descriptor, length) pairs with how often each occurs. */
  get counted(): [number, number, number][] {
    if (!this._counted) {
      const { dirs, starts, ends, lengths } = this.f
      const tally = new Map<number, [number, number, number]>()
      for (let i = 0; i < dirs.length; i++) {
        const d = descriptor(dirs[i], starts[i], ends[i])
        const k = d * LENGTH_BUCKETS + lengths[i]
        const hit = tally.get(k)
        if (hit) hit[2]++
        else tally.set(k, [d, lengths[i], 1])
      }
      this._counted = [...tally.values()]
    }
    return this._counted
  }

  /** This glyph with stroke `i` removed, for the ordered mode's near miss. */
  without(i: number): Glyph {
    const cut = <T,>(a: T[]) => [...a.slice(0, i), ...a.slice(i + 1)]
    const { moves, seams } = this.f
    const n = this.size
    // Removing a stroke closes a gap: the two travels either side of it
    // become one, and every other travel is unchanged. What the seams become
    // is never asked for -- nothing drops a second stroke.
    let m: number[]
    if (i === 0) m = moves.slice(1)
    else if (i === n - 1) m = moves.slice(0, -1)
    else m = [...moves.slice(0, i - 1), seams[i - 1], ...moves.slice(i + 1)]
    return new Glyph({
      dirs: cut(this.f.dirs),
      starts: cut(this.f.starts),
      ends: cut(this.f.ends),
      lengths: cut(this.f.lengths),
      moves: m,
      seams: [],
    })
  }
}

/**
 * (fewer / more) ** LENGTH_POWER. Taken from the server's table where it has
 * one: V8's pow and C's can disagree in the last bit, and at this coarseness
 * a last bit is enough to reorder tied candidates.
 */
let POWER: { size: number; values: number[] } | null = null

function strokePower(n: number, m: number): number {
  if (POWER && n <= POWER.size && m <= POWER.size) return POWER.values[(n - 1) * POWER.size + (m - 1)]
  return (n < m ? n / m : m / n) ** LENGTH_POWER
}

function chamfer(a: Glyph, b: Glyph): number {
  const n = a.size
  const m = b.size
  if (!n || !m) return 0.0
  const t = table()
  const lt = LENGTH_TABLE
  const bk = b.counted
  const bestB = new Array<number>(bk.length).fill(0)
  let forward = 0
  for (const [ka, la, countA] of a.counted) {
    const base = ka * DESCRIPTORS
    const lrow = la * LENGTH_BUCKETS
    let best = 0
    for (let j = 0; j < bk.length; j++) {
      const v = t[base + bk[j][0]] + lt[lrow + bk[j][1]]
      if (v > best) best = v
      if (v > bestB[j]) bestB[j] = v
    }
    forward += best * countA
  }
  let backward = 0
  for (let j = 0; j < bk.length; j++) backward += bestB[j] * bk[j][2]
  const score = (forward / n + backward / m) / 2
  return ((100.0 * score) / SIM_MAX) * strokePower(n, m)
}

function compare(ga: Glyph, gb: Glyph): number {
  const n = ga.size
  if (n !== gb.size || n === 0) return 0.0
  const a = ga.f
  const b = gb.f
  let score = 0.0
  for (let i = 0; i < n; i++) {
    if (a.dirs[i] === b.dirs[i]) score += W_STROKE_DIR
    else if (dirClose(a.dirs[i], b.dirs[i])) score += W_STROKE_DIR * NEAR

    if (a.starts[i] === b.starts[i]) score += W_LOCATION
    else if (cellClose(a.starts[i], b.starts[i])) score += W_LOCATION * NEAR

    if (a.ends[i] === b.ends[i]) score += W_LOCATION
    else if (cellClose(a.ends[i], b.ends[i])) score += W_LOCATION * NEAR

    if (a.lengths[i] === b.lengths[i]) score += W_LENGTH
    else if (Math.abs(a.lengths[i] - b.lengths[i]) === 1) score += W_LENGTH * NEAR

    if (i) {
      if (a.moves[i - 1] === b.moves[i - 1]) score += W_MOVE_DIR
      else if (dirClose(a.moves[i - 1], b.moves[i - 1])) score += W_MOVE_DIR * NEAR
    }
  }
  const total = n * (W_STROKE_DIR + 2 * W_LOCATION + W_LENGTH) + (n - 1) * W_MOVE_DIR
  return (100.0 * score) / total
}

export interface Candidate {
  char: string
  score: number
  strokes: number
  freq: number | null
  meanings: string[]
  meaningsBg: string[] | null
}

export interface KanjiMeta {
  freq: number | null
  meanings: string[]
  meaningsBg: string[] | null
}

export class Recognizer {
  private readonly buckets = new Map<number, [string, Glyph][]>()
  private readonly meta: (char: string) => KanjiMeta | undefined

  /** `glyphs` as the pack ships them: [char, stroke codes, moves, seams]. */
  constructor(
    glyphs: [string, number[], number[], number[]][],
    meta: (char: string) => KanjiMeta | undefined,
    power?: { size: number; values: number[] },
  ) {
    this.meta = meta
    if (power) POWER = power
    for (const [char, codes, moves, seams] of glyphs) {
      const list = this.buckets.get(codes.length)
      const entry: [string, Glyph] = [char, Glyph.packed(codes, moves, seams)]
      if (list) list.push(entry)
      else this.buckets.set(codes.length, [entry])
    }
    table()
  }

  get count(): number {
    let n = 0
    for (const v of this.buckets.values()) n += v.length
    return n
  }

  get bucketCount(): number {
    return this.buckets.size
  }

  recognise(strokes: number[][][], window = STROKE_WINDOW, limit = MAX_RESULTS): Candidate[] {
    const drawn = toGlyph(strokes)
    if (!drawn || drawn.size > MAX_STROKES) return []

    const n = drawn.size
    const scored: [string, number, number, Glyph][] = []
    for (let size = Math.max(1, n - window); size <= n + window; size++) {
      for (const [char, ref] of this.buckets.get(size) ?? []) scored.push([char, chamfer(drawn, ref), size, ref])
    }
    if (!scored.length) return []

    // Python's sort is stable; so is this one.
    scored.sort((a, b) => b[1] - a[1])
    const leaders = scored.slice(0, RERANK)
    const final = this.withOrderBonus(drawn, leaders)
    for (const [char, shape, size] of scored.slice(RERANK)) final.push([shape, size, char])

    const freqRank = (c: string) => this.meta(c)?.freq ?? Infinity
    final.sort((a, b) => b[0] - a[0] || freqRank(a[2]) - freqRank(b[2]) || compareCodePoints(a[2], b[2]))

    return final.slice(0, limit).map(([score, size, char]) => {
      const m = this.meta(char)
      return {
        char,
        score: Math.round(score * 10) / 10,
        strokes: size,
        freq: m?.freq ?? null,
        meanings: (m?.meanings ?? []).slice(0, 3),
        meaningsBg: m?.meaningsBg ? m.meaningsBg.slice(0, 3) : null,
      }
    })
  }

  private withOrderBonus(drawn: Glyph, leaders: [string, number, number, Glyph][]): [number, number, string][] {
    const n = drawn.size
    const shorter = n > 1 ? Array.from({ length: n }, (_, i) => drawn.without(i)) : []
    const orders = leaders.map(([, , size, ref]) => {
      if (size === n) return compare(drawn, ref)
      if (size === n - 1 && shorter.length) return Math.max(...shorter.map((s) => compare(s, ref))) * OFFBY1_PENALTY
      if (size === n + 1)
        return Math.max(...Array.from({ length: size }, (_, i) => compare(drawn, ref.without(i)))) * OFFBY1_PENALTY
      return 0.0
    })
    const paid = orders.length > 0 && Math.max(...orders) >= ORDER_GATE
    return leaders.map(([char, shape, size], i) => [shape + (paid ? (ORDER_BONUS * orders[i]) / 100.0 : 0.0), size, char])
  }
}

function toGlyph(strokes: number[][][]): Glyph | null {
  const lines: Line[] = []
  for (const s of strokes) {
    const pts = s.filter((p) => p.length >= 2)
    if (!pts.length) continue
    const last = pts[pts.length - 1]
    lines.push([pts[0][0], pts[0][1], last[0], last[1]])
  }
  if (!lines.length) return null
  return Glyph.of(normalise(lines))
}
