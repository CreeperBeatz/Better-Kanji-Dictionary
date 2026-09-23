/**
 * Which strokes tell two lookalikes apart.
 *
 * Both characters are KanjiVG strokes on the same 109x109 canvas, so a stroke
 * of one can be laid over a stroke of the other as it stands. Each stroke is
 * sampled into a few points; every stroke of one is paired with at most one
 * of the other, closest pairs first; and a stroke left without a partner, or
 * paired with one that strays too far from it anywhere along it, is a
 * difference. 未 and 末 then differ in their two horizontals, 己 and 已 in
 * their last stroke, 大 and 犬 in the dot.
 */

const POINTS = 12
/**
 * Two paired strokes are the same stroke when no point of one lies more than
 * SAME_MAX from its counterpart and they are SAME_MEAN apart on average, in
 * canvas units. The maximum is what catches a difference at one end only --
 * 己 and 已, whose last strokes part only where they finish.
 */
const SAME_MAX = 8.5
const SAME_MEAN = 5.5
/** Strokes further apart than this on average are not paired at all. */
const PAIR = 14

type Pt = [number, number]

const TOKEN = /([MmLlHhVvCcSsQqTtZz])|(-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?)/g
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2 }

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[]) {
  for (let i = 1; i <= 8; i++) {
    const t = i / 8
    const u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
}

/** An SVG path as a polyline. KanjiVG uses M, C/c and S/s, and the odd L. */
export function polyline(d: string): Pt[] {
  const pts: Pt[] = []
  let cur: Pt = [0, 0]
  let start: Pt = [0, 0]
  let ctrl: Pt | null = null
  let cmd = ''
  let nums: number[] = []

  const run = () => {
    const k = ARGS[cmd.toLowerCase()]
    if (!k) return
    const rel = cmd === cmd.toLowerCase()
    for (let i = 0; i + k <= nums.length; i += k) {
      const g = nums.slice(i, i + k)
      const bx = rel ? cur[0] : 0
      const by = rel ? cur[1] : 0
      const at = (j: number): Pt => [bx + g[j], by + g[j + 1]]
      switch (cmd.toLowerCase()) {
        case 'm':
          cur = at(0)
          start = cur
          pts.push(cur)
          cmd = rel ? 'l' : 'L'
          ctrl = null
          break
        case 'l':
        case 't':
        case 'q':
          cur = at(k - 2)
          pts.push(cur)
          ctrl = null
          break
        case 'h':
          cur = [bx + g[0], cur[1]]
          pts.push(cur)
          ctrl = null
          break
        case 'v':
          cur = [cur[0], by + g[0]]
          pts.push(cur)
          ctrl = null
          break
        case 'c': {
          const p2 = at(2)
          const p3 = at(4)
          cubic(cur, at(0), p2, p3, pts)
          ctrl = p2
          cur = p3
          break
        }
        case 's': {
          const p1: Pt = ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur
          const p2 = at(0)
          const p3 = at(2)
          cubic(cur, p1, p2, p3, pts)
          ctrl = p2
          cur = p3
          break
        }
      }
    }
  }

  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) {
      if (cmd && nums.length) run()
      nums = []
      cmd = m[1]
      if (cmd === 'Z' || cmd === 'z') {
        cur = start
        pts.push(cur)
        cmd = ''
      }
    } else {
      nums.push(parseFloat(m[2]))
    }
  }
  if (cmd && nums.length) run()
  return pts
}

/** `n` points evenly spaced along a polyline. */
function resample(line: Pt[], n = POINTS): Pt[] {
  if (line.length < 2) return Array.from({ length: n }, () => line[0] ?? [0, 0])
  const seg: number[] = [0]
  for (let i = 1; i < line.length; i++) {
    seg.push(seg[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  }
  const total = seg[seg.length - 1] || 1
  const out: Pt[] = []
  let j = 1
  for (let k = 0; k < n; k++) {
    const want = (total * k) / (n - 1)
    while (j < line.length - 1 && seg[j] < want) j++
    const a = line[j - 1]
    const b = line[j]
    const span = seg[j] - seg[j - 1] || 1
    const f = Math.min(1, Math.max(0, (want - seg[j - 1]) / span))
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
  }
  return out
}

/** Mean and greatest distance between corresponding points, whichever way round b runs. */
function distance(a: Pt[], b: Pt[]): [number, number] {
  let fwd = 0
  let back = 0
  let fwdMax = 0
  let backMax = 0
  for (let i = 0; i < a.length; i++) {
    const f = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
    const r = Math.hypot(a[i][0] - b[b.length - 1 - i][0], a[i][1] - b[b.length - 1 - i][1])
    fwd += f
    back += r
    fwdMax = Math.max(fwdMax, f)
    backMax = Math.max(backMax, r)
  }
  return fwd <= back ? [fwd / a.length, fwdMax] : [back / a.length, backMax]
}

const sampled = new Map<string, Pt[]>()

function sample(d: string): Pt[] {
  let s = sampled.get(d)
  if (!s) {
    s = resample(polyline(d))
    sampled.set(d, s)
  }
  return s
}

/**
 * For each stroke of `a` and of `b`, whether it is one that tells them apart.
 *
 * The same part is often drawn a little higher or lower in one character than
 * the other (目 in 貝 and in 見), so `b` is also tried shifted by a few units
 * each way, and the shift that leaves the fewest differences wins.
 */
export function strokeDiff(a: string[], b: string[]): { a: boolean[]; b: boolean[] } {
  const pa = a.map(sample)
  const pb = b.map(sample)
  let best = pair(pa, pb)
  let fewest = count(best)
  for (const dx of SHIFTS) {
    for (const dy of SHIFTS) {
      if (!dx && !dy) continue
      const got = pair(pa, pb.map((s) => s.map(([x, y]): Pt => [x + dx, y + dy])))
      const n = count(got)
      if (n < fewest) {
        best = got
        fewest = n
      }
    }
  }
  return best
}

const SHIFTS = [-8, -4, 0, 4, 8]

function count(d: { a: boolean[]; b: boolean[] }): number {
  return d.a.filter(Boolean).length + d.b.filter(Boolean).length
}

function pair(pa: Pt[][], pb: Pt[][]): { a: boolean[]; b: boolean[] } {
  const pairs: [number, number, number, number][] = []
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pb.length; j++) pairs.push([...distance(pa[i], pb[j]), i, j])
  }
  pairs.sort((x, y) => x[0] - y[0])
  const da = pa.map(() => true)
  const db = pb.map(() => true)
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  for (const [mean, max, i, j] of pairs) {
    if (mean > PAIR) break
    if (usedA.has(i) || usedB.has(j)) continue
    usedA.add(i)
    usedB.add(j)
    const same = mean <= SAME_MEAN && max <= SAME_MAX
    da[i] = !same
    db[j] = !same
  }
  return { a: da, b: db }
}
