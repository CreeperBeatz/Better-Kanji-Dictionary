/**
 * Geometry for the focus view.
 *
 * Containers occupy the upper hemisphere in concentric arcs, ordered by
 * newspaper frequency: common characters hug the focus, rare ones drift out.
 * Ring capacity grows with circumference, so filling inner rings first makes
 * radius a genuine function of rank rather than a decoration.
 *
 * Components hang below in a conventional layered DAG, one row per depth,
 * where depth is the longest path from the focus (assigned server-side).
 *
 * SVG's y axis points down, so "up" is negative y and the container arc is
 * centred on 1.5pi.
 */

import type { GraphResponse, KanjiNode } from '../api'

export type NodeKind = 'focus' | 'container' | 'component'

export interface PositionedNode {
  char: string
  x: number
  y: number
  radius: number
  kind: NodeKind
  dim: boolean
  depth: number
  fanout: number
  freq: number | null
  jlpt: number | null
  joyo: boolean
  meanings: string[]
  onYomi: string[]
  ring?: number
  /** 1 at the innermost container ring, 0 at the rim. Drives opacity. */
  weight?: number
}

export interface PositionedEdge {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  dim: boolean
}

export interface Layout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

// Container arc: centred straight up, spanning ~137 degrees.
const ARC_CENTRE = Math.PI * 1.5
const ARC_HALF_SPAN = Math.PI * 0.38
const ARC_START = ARC_CENTRE - ARC_HALF_SPAN
const ARC_SPAN = ARC_HALF_SPAN * 2

const RING_INNER = 165
const RING_STEP = 82
const CONTAINER_SPACING = 50

const COMPONENT_TOP = 135
const COMPONENT_ROW = 100
const COMPONENT_SPACING = 78

const RADIUS = { focus: 46, container: 25, containerFar: 14, component: 27 } as const

/** How many nodes fit on ring `i` without crowding. */
function ringCapacity(index: number): number {
  const r = RING_INNER + index * RING_STEP
  return Math.max(3, Math.floor((r * ARC_SPAN) / CONTAINER_SPACING))
}

/** How many rings `n` containers will occupy, so ring index can be normalised. */
function ringCount(n: number): number {
  let used = 0
  let ring = 0
  while (used < n) {
    used += ringCapacity(ring)
    ring += 1
  }
  return Math.max(ring, 1)
}

function placeContainers(containers: KanjiNode[]): PositionedNode[] {
  const out: PositionedNode[] = []
  const rings = ringCount(containers.length)
  let i = 0
  let ring = 0

  while (i < containers.length) {
    const capacity = ringCapacity(ring)
    const slice = containers.slice(i, i + capacity)
    const r = RING_INNER + ring * RING_STEP

    // A full ring spreads across the whole arc; a partial one keeps the same
    // angular spacing and stays centred, so the last ring doesn't fan out oddly.
    const step = ARC_SPAN / capacity
    const used = step * (slice.length - 1)
    const start = slice.length === capacity ? ARC_START + step / 2 : ARC_CENTRE - used / 2

    // Distance already encodes frequency; size and weight say the same thing
    // again so the common characters read as important at a glance, without
    // having to judge radius by eye.
    const t = rings === 1 ? 0 : ring / (rings - 1)
    const radius = RADIUS.container * (1 - t) + RADIUS.containerFar * t
    const weight = 1 - t

    slice.forEach((node, k) => {
      const angle = slice.length === 1 ? ARC_CENTRE : start + k * step
      out.push({
        char: node.char,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        radius,
        kind: 'container',
        dim: !node.joyo,
        depth: -1,
        fanout: node.fanout ?? 0,
        freq: node.freq,
        jlpt: node.jlpt,
        joyo: node.joyo,
        meanings: node.meanings,
        onYomi: node.onYomi,
        ring,
        weight,
      })
    })

    i += capacity
    ring += 1
  }
  return out
}

function placeComponents(components: KanjiNode[]): PositionedNode[] {
  const byDepth = new Map<number, KanjiNode[]>()
  for (const n of components) {
    const d = n.depth ?? 1
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(n)
  }

  const out: PositionedNode[] = []
  for (const [depth, row] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const width = COMPONENT_SPACING * (row.length - 1)
    row.forEach((node, k) => {
      out.push({
        char: node.char,
        x: row.length === 1 ? 0 : -width / 2 + k * COMPONENT_SPACING,
        y: COMPONENT_TOP + (depth - 1) * COMPONENT_ROW,
        radius: RADIUS.component,
        kind: 'component',
        dim: !node.inKanjidic,
        depth,
        fanout: node.fanout ?? 0,
        freq: node.freq,
        jlpt: node.jlpt,
        joyo: node.joyo,
        meanings: node.meanings,
        onYomi: node.onYomi,
      })
    })
  }
  return out
}

export function computeLayout(data: GraphResponse): Layout {
  const focus: PositionedNode = {
    char: data.focus.char,
    x: 0,
    y: 0,
    radius: RADIUS.focus,
    kind: 'focus',
    dim: false,
    depth: 0,
    fanout: data.focus.fanout ?? 0,
    freq: data.focus.freq,
    jlpt: data.focus.jlpt,
    joyo: data.focus.joyo,
    meanings: data.focus.meanings,
    onYomi: data.focus.onYomi,
  }

  const containers = placeContainers(data.containers)
  const components = placeComponents(data.components.nodes)
  const nodes = [focus, ...containers, ...components]

  const byChar = new Map(nodes.map((n) => [n.char, n]))
  const edges: PositionedEdge[] = []

  // Containers connect straight to the focus -- one level up only, so there is
  // never a container-to-container edge to draw.
  for (const c of containers) {
    edges.push({
      id: `c:${c.char}`,
      from: { x: c.x, y: c.y },
      to: { x: focus.x, y: focus.y },
      dim: c.dim,
    })
  }

  for (const e of data.components.edges) {
    const a = byChar.get(e.parent)
    const b = byChar.get(e.child)
    if (!a || !b) continue
    edges.push({
      id: `e:${e.parent}>${e.child}`,
      from: { x: a.x, y: a.y },
      to: { x: b.x, y: b.y },
      dim: a.dim || b.dim,
    })
  }

  const pad = 80
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  return {
    nodes,
    edges,
    bounds: {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minY: Math.min(...ys) - pad,
      maxY: Math.max(...ys) + pad,
    },
  }
}

// --- the peek: a second level of containers fanned out around one container.

export interface PeekItem {
  char: string
  x: number
  y: number
  radius: number
  node: KanjiNode
}

const PEEK_RADIUS = 17
const PEEK_GAP = 8
const PEEK_FIRST = 30
const PEEK_ROW = 44
/** How far round the host the fan may wrap, centred on "away from the focus". */
const PEEK_SPAN = Math.PI * 1.15

/**
 * Fan `above` out on arcs around `host`, facing away from the focus so the
 * peek grows into open space instead of back over the graph. Frequency order
 * is kept, nearest first, exactly as the main rings do it.
 */
export function placePeek(host: PositionedNode, above: KanjiNode[]): PeekItem[] {
  const out: PeekItem[] = []
  const facing = Math.atan2(host.y, host.x)
  let i = 0
  let row = 0
  while (i < above.length) {
    const r = host.radius + PEEK_FIRST + PEEK_RADIUS + row * PEEK_ROW
    const capacity = Math.max(1, Math.floor((r * PEEK_SPAN) / (PEEK_RADIUS * 2 + PEEK_GAP)))
    const slice = above.slice(i, i + capacity)
    const step = PEEK_SPAN / capacity
    const start = facing - (step * (slice.length - 1)) / 2
    slice.forEach((node, k) => {
      const a = start + k * step
      out.push({
        char: node.char,
        x: host.x + Math.cos(a) * r,
        y: host.y + Math.sin(a) * r,
        radius: PEEK_RADIUS,
        node,
      })
    })
    i += capacity
    row += 1
  }
  return out
}
