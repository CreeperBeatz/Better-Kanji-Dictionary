/**
 * Reads index.bin: named typed arrays behind a JSON header, as written by
 * server/offline.py's Sections. Views are taken straight onto the buffer, so
 * loading costs nothing but the "d32" delta columns, which are summed back up.
 */

export type Column = Uint8Array | Uint16Array | Uint32Array | Int32Array

export interface Sections {
  text(name: string): string
  u8(name: string): Uint8Array
  u16(name: string): Uint16Array
  u32(name: string): Uint32Array
}

export function readSections(buf: ArrayBuffer): Sections {
  const bytes = new Uint8Array(buf)
  const magic = String.fromCharCode(...bytes.subarray(0, 4))
  if (magic !== 'BKDP') throw new Error('not a lookup pack')
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('big-endian devices are not supported')
  const headLen = new DataView(buf).getUint32(4, true)
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headLen))) as {
    sections: Record<string, [string, number, number]>
  }

  function section(name: string, want: string[]): [string, number, number] {
    const s = head.sections[name]
    if (!s) throw new Error(`lookup pack has no ${name}`)
    if (!want.includes(s[0])) throw new Error(`${name} is ${s[0]}, not ${want.join('/')}`)
    return s
  }

  return {
    text(name) {
      const [, off, n] = section(name, ['utf8'])
      return new TextDecoder().decode(bytes.subarray(off, off + n))
    },
    u8(name) {
      const [, off, n] = section(name, ['u8'])
      return new Uint8Array(buf, off, n)
    },
    u16(name) {
      const [, off, n] = section(name, ['u16'])
      return new Uint16Array(buf, off, n)
    },
    u32(name) {
      const [kind, off, n] = section(name, ['u32', 'd32'])
      const raw = new Uint32Array(buf, off, n)
      if (kind === 'u32') return raw
      const out = new Uint32Array(n)
      let acc = 0
      for (let i = 0; i < n; i++) {
        acc = (acc + raw[i]) >>> 0
        out[i] = acc
      }
      return out
    },
  }
}

/** Offsets from lengths: n lengths -> n + 1 starts. */
export function starts(lengths: Uint8Array): Uint32Array {
  const out = new Uint32Array(lengths.length + 1)
  for (let i = 0; i < lengths.length; i++) out[i + 1] = out[i] + lengths[i]
  return out
}

/**
 * Code point order, which is SQLite's BINARY collation on UTF-8 and the order
 * the pack is sorted in. Plain `<` on JS strings compares UTF-16 code units,
 * which puts characters beyond U+FFFF before U+E000-U+FFFF.
 */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i)
    let y = b.charCodeAt(i)
    if (x === y) continue
    if (x >= 0xd800) x = x >= 0xe000 ? x - 0x800 : x + 0x2000
    if (y >= 0xd800) y = y >= 0xe000 ? y - 0x800 : y + 0x2000
    return x - y
  }
  return a.length - b.length
}

/** A sorted list of strings kept as one string and a table of offsets. */
export class SortedStrings {
  readonly count: number
  private readonly all: string
  private readonly start: Uint32Array

  constructor(all: string, start: Uint32Array) {
    this.all = all
    this.start = start
    this.count = start.length - 1
  }

  at(i: number): string {
    return this.all.substring(this.start[i], this.start[i + 1])
  }

  /** The first index whose string is >= `s`. */
  lowerBound(s: string): number {
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (compareCodePoints(this.at(mid), s) < 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  indexOf(s: string): number {
    const i = this.lowerBound(s)
    return i < this.count && this.at(i) === s ? i : -1
  }

  /** [lo, hi) of the strings starting with `prefix`. */
  prefixRange(prefix: string): [number, number] {
    const lo = this.lowerBound(prefix)
    let hi = lo
    // Binary-search the end too; a one-letter prefix can cover thousands.
    let top = this.count
    while (hi < top) {
      const mid = (hi + top) >>> 1
      if (this.at(mid).startsWith(prefix)) hi = mid + 1
      else top = mid
    }
    return [lo, hi]
  }
}
