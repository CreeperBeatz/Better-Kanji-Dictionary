/**
 * Geometry for the Similar view.
 *
 * The focus sits at the centre, as in the focus view. Lookalikes fill arcs
 * above it; below, kanji that share its reading fill arcs to the left and
 * near-synonyms arcs to the right. Each list runs closest first, so distance
 * from the centre means "less alike" in all three; they are three lists, not
 * one score, and never share a ring. Other forms of the character sit to its
 * right on the line between the halves.
 *
 * SVG's y axis points down, so "up" is negative y.
 */

import type { KanjiNode } from '../api'

export interface Placed<T extends KanjiNode> {
  node: T
  x: number
  y: number
  radius: number
  /** 1 on the innermost ring, 0 on the outermost. Drives opacity. */
  weight: number
}

interface Arc {
  centre: number
  halfSpan: number
  inner: number
  step: number
  spacing: number
  near: number
  far: number
}

const LOOK: Arc = { centre: Math.PI * 1.5, halfSpan: Math.PI * 0.35, inner: 150, step: 76, spacing: 54, near: 27, far: 17 }
// The two lower lists carry a meaning and a reason under each character, so
// they sit wider apart. Neither half reaches the horizontal, which is left to
// the other forms, and the two lower arcs leave a gap straight down between them.
const READ: Arc = { centre: Math.PI * 0.71, halfSpan: Math.PI * 0.16, inner: 170, step: 92, spacing: 86, near: 25, far: 18 }
const MEAN: Arc = { ...READ, centre: Math.PI * 0.29 }

// On a tall, narrow stage (a phone held upright) the arcs close in and stack
// more rings, so the view is drawn larger instead of shrinking to the width.
const TALL = {
  look: { halfSpan: Math.PI * 0.22, spacing: 50 },
  read: { centre: Math.PI * 0.64, halfSpan: Math.PI * 0.12, spacing: 80 },
  mean: { centre: Math.PI * 0.36, halfSpan: Math.PI * 0.12, spacing: 80 },
}

// When one of the two lower lists is empty, the other has the whole half.
const BELOW: Arc = { ...READ, centre: Math.PI * 0.5, halfSpan: Math.PI * 0.32 }
const TALL_BELOW = { halfSpan: Math.PI * 0.22, spacing: 80 }

/** Where a list's name goes: between the focus and its first ring, in the middle of its arc. */
function labelAt(arc: Arc): { x: number; y: number } {
  const r = arc.inner - (arc === LOOK || arc.centre > Math.PI ? 48 : 58)
  return { x: Math.cos(arc.centre) * r, y: Math.sin(arc.centre) * r }
}

export const FOCUS_RADIUS = 46

function capacity(arc: Arc, ring: number) {
  return Math.max(2, Math.floor(((arc.inner + ring * arc.step) * arc.halfSpan * 2) / arc.spacing))
}

function place<T extends KanjiNode>(items: T[], arc: Arc): Placed<T>[] {
  let rings = 0
  for (let used = 0; used < items.length; rings++) used += capacity(arc, rings)
  const out: Placed<T>[] = []
  let i = 0
  for (let ring = 0; i < items.length; ring++) {
    const cap = capacity(arc, ring)
    const slice = items.slice(i, i + cap)
    const r = arc.inner + ring * arc.step
    const step = (arc.halfSpan * 2) / cap
    // A partial ring keeps the spacing of a full one and stays centred.
    const start = arc.centre - (step * (slice.length - 1)) / 2
    const t = rings <= 1 ? 0 : ring / (rings - 1)
    // Middle out: the closest of a ring sits straight above (or below) the
    // focus, and the rest alternate outwards from it.
    const slots = slice.map((_, k) => start + k * step).sort((x, y) => Math.abs(x - arc.centre) - Math.abs(y - arc.centre))
    slice.forEach((node, k) => {
      const a = slots[k]
      out.push({ node, x: Math.cos(a) * r, y: Math.sin(a) * r, radius: arc.near * (1 - t) + arc.far * t, weight: 1 - t })
    })
    i += cap
  }
  return out
}

export function layoutSimilar<L extends KanjiNode, M extends KanjiNode, V extends KanjiNode>(
  look: L[],
  read: M[],
  mean: M[],
  variant: V[],
  tall = false,
) {
  const alone = !read.length || !mean.length
  const lookArc = tall ? { ...LOOK, ...TALL.look } : LOOK
  const below = tall ? { ...BELOW, ...TALL_BELOW } : BELOW
  const readArc = alone ? below : tall ? { ...READ, ...TALL.read } : READ
  const meanArc = alone ? below : tall ? { ...MEAN, ...TALL.mean } : MEAN
  const looks = place(look, lookArc)
  const reads = place(read, readArc)
  const means = place(mean, meanArc)
  const labels = { look: labelAt(lookArc), read: labelAt(readArc), mean: labelAt(meanArc) }
  // Beside the focus; on a tall stage, stacked, since the width is short.
  const variants: Placed<V>[] = variant.map((node, k) => ({
    node,
    x: FOCUS_RADIUS + 74 + (tall ? 0 : k * 58),
    y: tall ? k * 50 : 0,
    radius: 22,
    weight: 1,
  }))

  const all = [...looks, ...reads, ...means, ...variants]
  const pad = 70
  const xs = [0, ...all.map((p) => p.x)]
  const ys = [0, ...all.map((p) => p.y)]
  // Keep the focus in the middle, so the halves read as above and below it.
  const w = Math.max(...xs.map(Math.abs), tall ? 150 : 260) + pad
  const top = Math.max(-Math.min(...ys), 200) + pad
  // The lower lists have two lines of text under each character.
  const bottom = Math.max(Math.max(...ys), 200) + pad + 34
  return { looks, reads, means, variants, labels, bounds: { minX: -w, maxX: w, minY: -top, maxY: bottom } }
}
