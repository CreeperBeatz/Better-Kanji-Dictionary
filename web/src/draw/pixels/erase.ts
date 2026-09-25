/**
 * The pixel eraser's geometry: what is left of a path of points once the
 * eraser's circles are taken out of it.
 *
 * A pen stroke or a line is kept as the points it passes through, so erasing
 * part of it is cutting that path where it enters each circle and where it
 * leaves, and keeping the pieces outside. The cuts fall exactly on the circle
 * -- grown by half the ink's width, so that no ink is left inside it.
 */

import type { Pt } from './geometry'

export interface Circle {
  x: number
  y: number
  r: number
}

/** A run of points, each with its pen pressure where the stroke has them. */
export interface Piece {
  pts: Pt[]
  pressures: number[] | null
  /** Whether the piece begins at the path's first point, and ends at its last. */
  start: boolean
  end: boolean
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Where on segment a-b (0 to 1) it runs inside the circle, if it does. */
function inside(a: Pt, b: Pt, c: Circle): [number, number] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - c.x
  const fy = a.y - c.y
  const A = dx * dx + dy * dy
  const C = fx * fx + fy * fy - c.r * c.r
  if (A === 0) return C < 0 ? [0, 1] : null
  const B = 2 * (fx * dx + fy * dy)
  const disc = B * B - 4 * A * C
  if (disc <= 0) return null
  const s = Math.sqrt(disc)
  const t0 = Math.max(0, (-B - s) / (2 * A))
  const t1 = Math.min(1, (-B + s) / (2 * A))
  return t0 < t1 ? [t0, t1] : null
}

function cut(piece: Piece, c: Circle): Piece[] | null {
  const { pts, pressures } = piece
  const n = pts.length
  if (n === 1) {
    return Math.hypot(pts[0].x - c.x, pts[0].y - c.y) < c.r ? [] : null
  }
  const out: Piece[] = []
  let cur: Piece | null = Math.hypot(pts[0].x - c.x, pts[0].y - c.y) < c.r ? null : { pts: [pts[0]], pressures: pressures && [pressures[0]], start: piece.start, end: false }
  let changed = cur === null
  const at = (i: number, t: number): [Pt, number | undefined] => [
    { x: lerp(pts[i].x, pts[i + 1].x, t), y: lerp(pts[i].y, pts[i + 1].y, t) },
    pressures ? lerp(pressures[i], pressures[i + 1], t) : undefined,
  ]
  const push = (p: Pt, w: number | undefined) => {
    cur!.pts.push(p)
    if (cur!.pressures && w !== undefined) cur!.pressures.push(w)
  }
  for (let i = 0; i < n - 1; i++) {
    const hit = inside(pts[i], pts[i + 1], c)
    if (!hit) {
      if (!cur) cur = { pts: [pts[i]], pressures: pressures && [pressures[i]], start: false, end: false }
      push(pts[i + 1], pressures?.[i + 1])
      continue
    }
    changed = true
    const [t0, t1] = hit
    if (cur) {
      if (t0 > 0) push(...at(i, t0))
      out.push(cur)
    }
    cur = null
    if (t1 < 1) {
      const [p, w] = at(i, t1)
      cur = { pts: [p], pressures: pressures && w !== undefined ? [w] : null, start: false, end: false }
      push(pts[i + 1], pressures?.[i + 1])
    }
  }
  if (!changed) return null
  if (cur) {
    cur.end = piece.end
    out.push(cur)
  }
  return out
}

/**
 * The pieces of a path left outside every circle, each circle grown by `pad`;
 * null if the circles miss it.
 */
export function erasePath(pts: Pt[], pressures: number[] | null, circles: Circle[], pad: number): Piece[] | null {
  let pieces: Piece[] = [{ pts, pressures, start: true, end: true }]
  let changed = false
  for (const circle of circles) {
    const c = { ...circle, r: circle.r + pad }
    const next: Piece[] = []
    for (const piece of pieces) {
      const cutUp = cut(piece, c)
      if (cutUp) changed = true
      next.push(...(cutUp ?? [piece]))
    }
    pieces = next
    if (!pieces.length) break
  }
  if (!changed) return null
  // A sliver left between two circles is not worth a stroke of its own.
  return pieces.filter((p) => p.pts.length > 1 && length(p.pts) > pad / 2)
}

function length(pts: Pt[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return d
}

/** Whether any circle reaches into a rectangle turned by `angle` about its centre. */
export function touchesBox(x: number, y: number, w: number, h: number, angle: number, circles: Circle[]): boolean {
  const cx = x + w / 2
  const cy = y + h / 2
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  return circles.some((c) => {
    const dx = c.x - cx
    const dy = c.y - cy
    const u = Math.abs(dx * cos - dy * sin) - w / 2
    const v = Math.abs(dx * sin + dy * cos) - h / 2
    return Math.hypot(Math.max(u, 0), Math.max(v, 0)) < c.r
  })
}
