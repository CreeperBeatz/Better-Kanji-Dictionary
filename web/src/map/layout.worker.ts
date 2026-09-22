/**
 * Force layout for the map, off the main thread.
 *
 * A plain force simulation over the widest scope (13k nodes) takes ~40 s here:
 * many-body repulsion is the cost, and it scales with every node. But most
 * nodes are leaves -- characters that are nobody's component -- and a leaf's
 * position is already implied by its parts. So large graphs go in two phases:
 *
 *   A  simulate only the skeleton: components, plus anything unconnected.
 *      Two components are linked by how many characters use them together,
 *      so 氵 settles near the phonetics it combines with. Components that many
 *      leaves hang off repel harder, which leaves room for their neighbourhood.
 *   B  drop each leaf at a weighted centroid of its parts -- rarer parts pull
 *      harder, so 河 sits by 可 rather than lost in the 氵 crowd -- then relax
 *      collisions with the skeleton pinned.
 *
 * Positions stream back while it runs, so the map visibly forms rather than
 * sitting blank.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'

export interface LayoutRequest {
  id: number
  n: number
  /** parent,child index pairs */
  edges: Uint32Array
  /** collision radius per node */
  size: Float32Array
  /** starting positions, NaN where unknown */
  seed: Float32Array
}

export type LayoutMessage =
  | { id: number; kind: 'progress'; positions: Float32Array; done: number }
  | { id: number; kind: 'done'; positions: Float32Array }

interface Node extends SimulationNodeDatum {
  i: number
}

interface Link extends SimulationLinkDatum<Node> {
  w: number
}

/** Below this, simulate everything; the two-phase split only pays on big graphs. */
const DIRECT_LIMIT = 1600

// The simulation loops synchronously, so a newer request cannot interrupt it
// from in here; the client terminates the worker instead.
self.onmessage = (e: MessageEvent<LayoutRequest>) => layout(e.data)

function post(msg: LayoutMessage) {
  ;(self as unknown as Worker).postMessage(msg, [msg.positions.buffer])
}

/** Deterministic scatter, so an unseeded layout comes out the same each time. */
function jitter(i: number, spread: number): [number, number] {
  const a = i * 2.399963 // golden angle
  const r = spread * Math.sqrt(((i * 7919) % 101) / 101 + 0.05)
  return [Math.cos(a) * r, Math.sin(a) * r]
}

function layout(req: LayoutRequest) {
  const { id, n, edges, size, seed } = req
  const nodes: Node[] = Array.from({ length: n }, (_, i) => {
    const node: Node = { i }
    if (!Number.isNaN(seed[2 * i])) {
      node.x = seed[2 * i]
      node.y = seed[2 * i + 1]
    }
    return node
  })

  const snapshot = () => {
    const p = new Float32Array(2 * n)
    for (const nd of nodes) {
      p[2 * nd.i] = nd.x ?? 0
      p[2 * nd.i + 1] = nd.y ?? 0
    }
    return p
  }

  if (n <= DIRECT_LIMIT) direct(id, nodes, edges, size, snapshot)
  else twoPhase(id, nodes, edges, size, snapshot)
}

/** Run a simulation to completion, streaming a snapshot every ~60 ms. */
function run(sim: ReturnType<typeof forceSimulation<Node>>, ticks: number, onFrame: () => void) {
  let last = performance.now()
  for (let t = 0; t < ticks; t++) {
    sim.tick()
    const now = performance.now()
    if (now - last > 60) {
      last = now
      onFrame()
    }
  }
}

function direct(
  id: number,
  nodes: Node[],
  edges: Uint32Array,
  size: Float32Array,
  snapshot: () => Float32Array,
) {
  const seeded = nodes.filter((d) => d.x !== undefined).length
  // A seed from a neighbouring scope is mostly right already; start cool.
  const alpha = seeded > nodes.length * 0.5 ? 0.35 : 1

  for (const d of nodes) {
    if (d.x === undefined) {
      const [x, y] = jitter(d.i, 40 * Math.sqrt(nodes.length))
      d.x = x
      d.y = y
    }
  }

  const links: Link[] = []
  for (let k = 0; k < edges.length; k += 2) links.push({ source: edges[k], target: edges[k + 1], w: 1 })

  const sim = forceSimulation(nodes)
    .alpha(alpha)
    .force(
      'link',
      forceLink<Node, Link>(links)
        .id((d) => d.i)
        .distance((l) => 14 + size[(l.source as Node).i] + size[(l.target as Node).i]),
    )
    .force('charge', forceManyBody<Node>().strength((d) => -18 - size[d.i] * 3).theta(1).distanceMax(600))
    .force('collide', forceCollide<Node>((d) => size[d.i] + 2).iterations(1))
    .force('x', forceX(0).strength(0.035))
    .force('y', forceY(0).strength(0.035))
    .stop()

  const ticks = Math.ceil(Math.log(sim.alphaMin() / alpha) / Math.log(1 - sim.alphaDecay()))
  run(sim, ticks, () => post({ id, kind: 'progress', positions: snapshot(), done: 0 }))
  post({ id, kind: 'done', positions: snapshot() })
}

function twoPhase(
  id: number,
  nodes: Node[],
  edges: Uint32Array,
  size: Float32Array,
  snapshot: () => Float32Array,
) {
  const n = nodes.length
  const parts: number[][] = Array.from({ length: n }, () => [])
  const isPart = new Uint8Array(n)
  for (let k = 0; k < edges.length; k += 2) {
    parts[edges[k]].push(edges[k + 1])
    isPart[edges[k + 1]] = 1
  }

  // Skeleton: every component, and anything with no parts to anchor it.
  const skeleton = nodes.filter((d) => isPart[d.i] || parts[d.i].length === 0)
  const leaves = nodes.filter((d) => !isPart[d.i] && parts[d.i].length > 0)

  // How many leaves hang directly off each component.
  const load = new Float32Array(n)
  for (const l of leaves) for (const p of parts[l.i]) load[p] += 1

  // Component-to-component links: decomposition edges, plus co-use by leaves.
  const pair = new Map<number, number>()
  const bump = (a: number, b: number, w: number) => {
    if (a === b) return
    const key = a < b ? a * n + b : b * n + a
    pair.set(key, (pair.get(key) ?? 0) + w)
  }
  for (const d of skeleton) for (const p of parts[d.i]) bump(d.i, p, 3)
  for (const l of leaves) {
    const ps = parts[l.i]
    for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) bump(ps[a], ps[b], 1)
  }
  const links: Link[] = []
  const weight = new Float32Array(n)
  for (const [key, w] of pair) {
    const a = Math.floor(key / n)
    const b = key % n
    links.push({ source: a, target: b, w })
    weight[a] += w
    weight[b] += w
  }

  const seeded = skeleton.filter((d) => d.x !== undefined).length
  const alpha = seeded > skeleton.length * 0.5 ? 0.35 : 1
  for (const d of skeleton) {
    if (d.x === undefined) {
      const [x, y] = jitter(d.i, 60 * Math.sqrt(skeleton.length))
      d.x = x
      d.y = y
    }
  }

  const anchor = new Float32Array(2 * n)
  const placeLeaves = () => {
    for (const l of leaves) {
      let x = 0
      let y = 0
      let wsum = 0
      for (const p of parts[l.i]) {
        const w = 1 / Math.sqrt(1 + load[p])
        x += (nodes[p].x ?? 0) * w
        y += (nodes[p].y ?? 0) * w
        wsum += w
      }
      anchor[2 * l.i] = x / wsum
      anchor[2 * l.i + 1] = y / wsum
    }
  }

  // Leaves ride their anchors during phase A, so the whole map forms at once.
  const frameA = () => {
    placeLeaves()
    const p = snapshot()
    for (const l of leaves) {
      const [jx, jy] = jitter(l.i, 18)
      p[2 * l.i] = anchor[2 * l.i] + jx
      p[2 * l.i + 1] = anchor[2 * l.i + 1] + jy
    }
    post({ id, kind: 'progress', positions: p, done: 0 })
  }

  const simA = forceSimulation(skeleton)
    .alpha(alpha)
    .force(
      'link',
      forceLink<Node, Link>(links)
        .id((d) => d.i)
        .distance((l) => 24 + size[(l.source as Node).i] + size[(l.target as Node).i])
        .strength((l) => Math.min(1, (l.w * 1.5) / Math.min(weight[(l.source as Node).i], weight[(l.target as Node).i]))),
    )
    .force(
      'charge',
      forceManyBody<Node>()
        .strength((d) => -30 - size[d.i] * 2 - 26 * Math.sqrt(load[d.i]))
        .theta(1.1)
        .distanceMax(1400),
    )
    .force('collide', forceCollide<Node>((d) => size[d.i] + 4).iterations(1))
    .force('x', forceX(0).strength(0.02))
    .force('y', forceY(0).strength(0.02))
    .stop()

  const ticksA = Math.ceil(Math.log(simA.alphaMin() / alpha) / Math.log(1 - simA.alphaDecay()))
  run(simA, ticksA, frameA)

  // --- phase B: leaves settle around their anchors, skeleton pinned.
  placeLeaves()
  for (const d of skeleton) {
    d.fx = d.x
    d.fy = d.y
  }
  for (const l of leaves) {
    const [jx, jy] = jitter(l.i, 12)
    l.x = anchor[2 * l.i] + jx
    l.y = anchor[2 * l.i + 1] + jy
  }

  const simB = forceSimulation(nodes)
    .alphaDecay(0.06)
    .velocityDecay(0.45)
    .force('collide', forceCollide<Node>((d) => size[d.i] + 1.5).iterations(1))
    .force('x', forceX<Node>((d) => (d.fx != null ? d.fx : anchor[2 * d.i])).strength(0.12))
    .force('y', forceY<Node>((d) => (d.fy != null ? d.fy : anchor[2 * d.i + 1])).strength(0.12))
    .stop()

  run(simB, 70, () => post({ id, kind: 'progress', positions: snapshot(), done: 1 }))
  post({ id, kind: 'done', positions: snapshot() })
}
