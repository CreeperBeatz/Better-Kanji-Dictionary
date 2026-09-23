/**
 * Map scopes: fetching, sizing, adjacency, and the layout cache.
 *
 * A layout is expensive (seconds, at the widest scope) and entirely determined
 * by the node list and edges, so a finished one is kept in localStorage under
 * a key that changes whenever either does -- a decomposition fix lays that
 * scope out again rather than drawing stale positions.
 */

import { api, type MapResponse } from '../api'
import type { ContainerFilter } from '../graph/KanjiGraph'

export type Scope = '5' | '4' | '3' | '2' | '1' | 'common' | 'all'

export function scopeOf(filter: ContainerFilter): Scope {
  return String(filter) as Scope
}

export interface MapData {
  scope: Scope
  n: number
  chars: string[]
  index: Map<string, number>
  meaning: string[]
  /** The first Bulgarian meaning, or "" where there is none yet. */
  meaningBg: string[]
  freq: (number | null)[]
  jlpt: (number | null)[]
  joyo: Uint8Array
  target: Uint8Array
  fanout: Uint16Array
  edges: Uint32Array
  /** world-space radius, drives collision, drawing and label level-of-detail */
  size: Float32Array
  /** CSR adjacency: parts of i are partsIdx[partsAt[i] .. partsAt[i+1]] */
  partsAt: Uint32Array
  partsIdx: Uint32Array
  usersAt: Uint32Array
  usersIdx: Uint32Array
  key: string
}

/**
 * Size encodes importance twice over, so the map reads like one with cities:
 * frequent characters are larger, and so is any part that many characters
 * share. Whichever is bigger wins, so 日 is large for both reasons.
 */
function sizeOf(freq: number | null, fanout: number, target: boolean): number {
  const byFreq = freq ? 4 + 9 * (1 - Math.log(freq) / Math.log(2600)) : target ? 3.6 : 3
  const byFan = fanout > 0 ? Math.min(24, 4 + 2.6 * Math.log2(1 + fanout)) : 0
  return Math.max(byFreq, byFan)
}

function csr(n: number, from: Uint32Array, to: Uint32Array): [Uint32Array, Uint32Array] {
  const at = new Uint32Array(n + 1)
  for (const f of from) at[f + 1]++
  for (let i = 0; i < n; i++) at[i + 1] += at[i]
  const fill = at.slice(0, n)
  const idx = new Uint32Array(from.length)
  for (let k = 0; k < from.length; k++) idx[fill[from[k]]++] = to[k]
  return [at, idx]
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function prepare(r: MapResponse): MapData {
  const n = r.chars.length
  const edges = Uint32Array.from(r.edges)
  const m = edges.length / 2
  const parents = new Uint32Array(m)
  const children = new Uint32Array(m)
  for (let k = 0; k < m; k++) {
    parents[k] = edges[2 * k]
    children[k] = edges[2 * k + 1]
  }
  const [partsAt, partsIdx] = csr(n, parents, children)
  const [usersAt, usersIdx] = csr(n, children, parents)

  const size = new Float32Array(n)
  for (let i = 0; i < n; i++) size[i] = sizeOf(r.freq[i], r.fanout[i] ?? 0, r.target[i] === 1)

  return {
    scope: r.scope as Scope,
    n,
    chars: r.chars,
    index: new Map(r.chars.map((c, i) => [c, i])),
    meaning: r.meaning,
    meaningBg: r.meaningBg ?? [],
    freq: r.freq,
    jlpt: r.jlpt,
    joyo: Uint8Array.from(r.joyo),
    target: Uint8Array.from(r.target),
    fanout: Uint16Array.from(r.fanout, (f) => f ?? 0),
    edges,
    size,
    partsAt,
    partsIdx,
    usersAt,
    usersIdx,
    key: `betterrtk:map:v2:${r.scope}:${n}:${m}:${hash(r.chars.join('') + r.edges.join(','))}`,
  }
}

const inflight = new Map<Scope, Promise<MapData>>()

export function loadMap(scope: Scope): Promise<MapData> {
  let p = inflight.get(scope)
  if (!p) {
    p = api.map(scope).then(prepare)
    p.catch(() => inflight.delete(scope))
    inflight.set(scope, p)
  }
  return p
}

// Positions are stored as Int16 at half-unit precision: plenty for a map a few
// thousand units across, and a quarter the size of JSON floats.
export function cachedLayout(data: MapData): Float32Array | null {
  try {
    const raw = localStorage.getItem(data.key)
    if (!raw) return null
    const bin = atob(raw)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const ints = new Int16Array(bytes.buffer)
    if (ints.length !== data.n * 2) return null
    return Float32Array.from(ints, (v) => v / 2)
  } catch {
    return null
  }
}

export function storeLayout(data: MapData, positions: Float32Array) {
  try {
    const ints = Int16Array.from(positions, (v) => Math.max(-32767, Math.min(32767, Math.round(v * 2))))
    const bytes = new Uint8Array(ints.buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    // Drop older layouts of the same scope, from any layout version; they can
    // never be read again.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('betterrtk:map:') && k.split(':')[3] === data.scope && k !== data.key) {
        localStorage.removeItem(k)
      }
    }
    localStorage.setItem(data.key, btoa(bin))
  } catch {
    // Storage full or blocked: the layout just gets recomputed next time.
  }
}
