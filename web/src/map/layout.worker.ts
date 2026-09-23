/**
 * Force layout for the map, off the main thread.
 *
 * Closeness on the map means "these combine": a character sits by the parts it
 * is built from, and characters that share a distinctive part end up side by
 * side -- which is also most of what makes two kanji look alike. Nothing pulls
 * toward the centre; what lands in the middle is simply what the most
 * characters are built from.
 *
 * Most nodes are leaves -- characters that are nobody's component -- and a
 * leaf's position is implied by its parts, so the layout goes in two phases
 * (which also keeps the widest scope, 13k nodes, to seconds):
 *
 *   A  simulate only the skeleton: the components. Two components are linked
 *      by how many characters use them together, so 氵 settles near the
 *      phonetics it combines with. Components that many leaves hang off repel
 *      harder, which leaves room for their neighbourhood.
 *   B  drop each leaf at a weighted centroid of its parts, weighted steeply
 *      toward the rarer ones -- 河 sits by 可, not lost in the 氵 crowd, and
 *      beside 何 and 歌 -- then relax collisions with the skeleton pinned.
 *
 * Characters with no connection to the rest (no parts, used in nothing, or a
 * small island of their own) have nowhere meaningful to be, so they are not
 * simulated; they are shelved in rows under the map.
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

/**
 * How steeply a leaf favours its rarer parts: a part's pull is
 * (1 + characters hanging off it) ^ -RARITY.
 */
const RARITY = 3

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

/** Connected-component label per node, ignoring edge direction. */
function components(n: number, edges: Uint32Array): Uint32Array {
  const root = Uint32Array.from({ length: n }, (_, i) => i)
  const find = (x: number) => {
    while (root[x] !== x) x = root[x] = root[root[x]]
    return x
  }
  for (let k = 0; k < edges.length; k += 2) root[find(edges[k])] = find(edges[k + 1])
  for (let i = 0; i < n; i++) root[i] = find(i)
  return root
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

  // Only the largest connected piece is laid out by force; the rest is shelved.
  const label = components(n, edges)
  const count = new Uint32Array(n)
  for (let i = 0; i < n; i++) count[label[i]]++
  let biggest = 0
  for (let i = 0; i < n; i++) if (count[i] > count[biggest]) biggest = i
  const main = nodes.filter((d) => label[d.i] === biggest)

  const snapshot = () => {
    const p = new Float32Array(2 * n)
    for (const nd of main) {
      p[2 * nd.i] = nd.x ?? 0
      p[2 * nd.i + 1] = nd.y ?? 0
    }
    shelve(p, main, label, biggest, size)
    return p
  }

  simulate(id, nodes, main, edges, size, snapshot)
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

/**
 * Lay out every node outside the main piece in rows under it, one island
 * after another, parts before the characters built from them.
 */
function shelve(p: Float32Array, main: Node[], label: Uint32Array, biggest: number, size: Float32Array) {
  let minX = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of main) {
    const r = size[d.i]
    minX = Math.min(minX, (d.x ?? 0) - r)
    maxX = Math.max(maxX, (d.x ?? 0) + r)
    maxY = Math.max(maxY, (d.y ?? 0) + r)
  }
  if (!main.length) minX = maxX = maxY = 0

  const islands = new Map<number, number[]>()
  for (let i = 0; i < label.length; i++) {
    if (label[i] === biggest) continue
    const members = islands.get(label[i])
    if (members) members.push(i)
    else islands.set(label[i], [i])
  }

  const gap = 10
  const width = Math.max(maxX - minX, 400)
  let x = minX
  let y = maxY + 80
  let row = 0
  for (const members of islands.values()) {
    // Nodes arrive most-frequent-last; components sort last too, so reverse
    // puts each island's part first and reads left to right into its user.
    members.reverse()
    const span = members.reduce((s, i) => s + 2 * size[i] + gap, -gap)
    if (x > minX && x + span > minX + width) {
      x = minX
      y += 2 * row + gap
      row = 0
    }
    for (const i of members) {
      const r = size[i]
      p[2 * i] = x + r
      p[2 * i + 1] = y + r
      x += 2 * r + gap
      row = Math.max(row, r)
    }
    x += 3 * gap
  }
}

function simulate(
  id: number,
  nodes: Node[],
  main: Node[],
  edges: Uint32Array,
  size: Float32Array,
  snapshot: () => Float32Array,
) {
  const n = nodes.length
  const inMain = new Uint8Array(n)
  for (const d of main) inMain[d.i] = 1

  const parts: number[][] = Array.from({ length: n }, () => [])
  const isPart = new Uint8Array(n)
  for (let k = 0; k < edges.length; k += 2) {
    if (!inMain[edges[k]]) continue
    parts[edges[k]].push(edges[k + 1])
    isPart[edges[k + 1]] = 1
  }

  const skeleton = main.filter((d) => isPart[d.i])
  const leaves = main.filter((d) => !isPart[d.i])

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
        const w = Math.pow(1 + load[p], -RARITY)
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
    for (const l of leaves) {
      const [jx, jy] = jitter(l.i, 18)
      l.x = anchor[2 * l.i] + jx
      l.y = anchor[2 * l.i + 1] + jy
    }
    post({ id, kind: 'progress', positions: snapshot(), done: 0 })
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
        .strength((d) => -30 - size[d.i] * 2 - 45 * Math.sqrt(load[d.i]))
        .theta(1.1)
        .distanceMax(1400),
    )
    .force('collide', forceCollide<Node>((d) => size[d.i] + 4).iterations(1))
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

  const simB = forceSimulation(main)
    .alphaDecay(0.06)
    .velocityDecay(0.45)
    .force('collide', forceCollide<Node>((d) => size[d.i] + 1.5).iterations(1))
    .force('x', forceX<Node>((d) => (d.fx != null ? d.fx : anchor[2 * d.i])).strength(0.12))
    .force('y', forceY<Node>((d) => (d.fy != null ? d.fy : anchor[2 * d.i + 1])).strength(0.12))
    .stop()

  run(simB, 70, () => post({ id, kind: 'progress', positions: snapshot(), done: 1 }))
  post({ id, kind: 'done', positions: snapshot() })
}
