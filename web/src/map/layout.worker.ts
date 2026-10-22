/**
 * Layout for the map, off the main thread.
 *
 * Each kanji has a home, from data/meaning_map.json, so there is nothing to
 * simulate but overlaps: the large ones are spread apart so none covers
 * another, each held near its home. Positions stream back while it runs.
 *
 * The force layout over the decomposition that the map by parts used was
 * removed with it (2026-10-22); it is in git history before then.
 */

import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'

export interface LayoutRequest {
  id: number
  n: number
  /** collision radius per node */
  size: Float32Array
  /** each node's home, x,y */
  homes: Float32Array
}

export type LayoutMessage =
  | { id: number; kind: 'progress'; positions: Float32Array; done: number }
  | { id: number; kind: 'done'; positions: Float32Array }

interface Node extends SimulationNodeDatum {
  i: number
}

// The simulation loops synchronously, so a newer request cannot interrupt it
// from in here; the client terminates the worker instead.
self.onmessage = (e: MessageEvent<LayoutRequest>) => relax(e.data)

function post(msg: LayoutMessage) {
  ;(self as unknown as Worker).postMessage(msg, [msg.positions.buffer])
}

function relax(req: LayoutRequest) {
  const { id, n, size, homes } = req
  const nodes: Node[] = Array.from({ length: n }, (_, i) => ({ i, x: homes[2 * i], y: homes[2 * i + 1] }))
  const snapshot = () => {
    const p = new Float32Array(2 * n)
    for (const d of nodes) {
      p[2 * d.i] = d.x ?? 0
      p[2 * d.i + 1] = d.y ?? 0
    }
    return p
  }
  const sim = forceSimulation(nodes)
    .alphaDecay(0.03)
    .velocityDecay(0.4)
    .force('x', forceX<Node>((d) => homes[2 * d.i]).strength(0.3))
    .force('y', forceY<Node>((d) => homes[2 * d.i + 1]).strength(0.3))
    .force('collide', forceCollide<Node>((d) => size[d.i] + 1).iterations(2))
    .stop()
  let last = performance.now()
  for (let t = 0; t < 160; t++) {
    sim.tick()
    const now = performance.now()
    if (now - last > 60) {
      last = now
      post({ id, kind: 'progress', positions: snapshot(), done: 1 })
    }
  }
  post({ id, kind: 'done', positions: snapshot() })
}
