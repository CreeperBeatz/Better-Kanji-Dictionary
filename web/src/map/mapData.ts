/**
 * Map scopes: fetching, sizing, and the layout cache.
 *
 * Each kanji has a home from data/meaning_map.json; the layout (layout.worker.ts)
 * only spreads the large ones apart round their homes. A finished layout is
 * kept in localStorage under a key that changes whenever the kanji or their
 * homes do, so a rebuilt meaning map is laid out again rather than drawn stale.
 */

import { api, type MapResponse } from '../api'
import type { ContainerFilter } from '../graph/KanjiGraph'

export type Scope = '5' | '4' | '3' | '2' | '1' | 'common' | 'all'

export interface Group {
  en: string
  bg: string
}

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
  /** world-space radius, drives collision, drawing and label level-of-detail */
  size: Float32Array
  /** where each kanji belongs, in world units */
  home: Float32Array
  /** cluster per kanji, -1 = in none */
  cluster: Int16Array
  clusters: (Group & { region: number; near: string })[]
  regions: Group[]
  key: string
}

/** More frequent is larger, so the map reads like one with cities. */
function sizeOf(freq: number | null): number {
  return freq ? 4 + 9 * (1 - Math.log(freq) / Math.log(2600)) : 3.6
}

/**
 * The meaning map's positions in world units: spread so the kanji, at their
 * sizes, cover about a third of the area they span -- room to tell clusters
 * apart, close enough that a cluster still reads as one.
 */
function homes(xy: number[], size: Float32Array): Float32Array {
  const n = size.length
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let area = 0
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, xy[2 * i])
    x1 = Math.max(x1, xy[2 * i])
    y0 = Math.min(y0, xy[2 * i + 1])
    y1 = Math.max(y1, xy[2 * i + 1])
    area += Math.PI * size[i] ** 2
  }
  const k = Math.sqrt((area * 3) / Math.max(1e-9, (x1 - x0) * (y1 - y0)))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return Float32Array.from(xy, (v, j) => (v - (j % 2 ? cy : cx)) * k)
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function prepare(r: MapResponse): MapData {
  const n = r.chars.length
  const size = Float32Array.from(r.freq, sizeOf)
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
    size,
    home: homes(r.xy, size),
    cluster: Int16Array.from(r.cluster),
    clusters: r.clusters,
    regions: r.regions,
    // v4: by meaning only. The fourth field is the slot a newer layout
    // replaces: the scope.
    key: `betterrtk:map:v4:${r.scope}:${n}:${hash(r.chars.join('') + ';' + r.xy.join(','))}`,
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
    // Drop older layouts of the same scope, and any from before v4 (by parts,
    // or the meaning-<scope> slots); none can be read again.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      const f = k?.split(':') ?? []
      if (k && k.startsWith('betterrtk:map:') && k !== data.key && (f[2] !== 'v4' || f[3] === data.scope)) {
        localStorage.removeItem(k)
      }
    }
    localStorage.setItem(data.key, btoa(bin))
  } catch {
    // Storage full or blocked: the layout just gets recomputed next time.
  }
}
