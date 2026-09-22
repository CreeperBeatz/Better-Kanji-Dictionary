import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type GraphResponse, type KanjiNode } from '../api'
import { computeLayout, placePeek, type PeekItem, type PositionedNode } from './layout'

export type ContainerFilter = 'all' | 'common' | 1 | 2 | 3 | 4 | 5

interface Props {
  data: GraphResponse
  filter: ContainerFilter
  /** `via` is the container a peeked character was reached through. */
  onDrill: (char: string, via?: string) => void
  onHover: (char: string | null) => void
}

/** What to call a character's level, including the things that have none. */
function levelOf(n: { jlpt: number | null; joyo: boolean; fanout: number | null }): string {
  if (n.jlpt) return `N${n.jlpt}`
  if (n.joyo) return 'jōyō'
  return (n.fanout ?? 0) > 0 ? 'part' : 'rare'
}

/** JLPT runs N5 (easiest) to N1, so "up to N3" means jlpt >= 3. */
export function keeps(filter: ContainerFilter) {
  return (n: { freq: number | null; jlpt: number | null }) => {
    if (filter === 'all') return true
    if (filter === 'common') return n.freq !== null
    return n.jlpt !== null && n.jlpt >= filter
  }
}

interface View {
  x: number
  y: number
  scale: number
}

/** Curve edges slightly so overlapping runs stay tellable apart. */
function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular offset proportional to length, capped so long spokes to the
  // outer rings don't bow absurdly.
  const bow = Math.min(len * 0.08, 26)
  const cx = midX + (-dy / len) * bow
  const cy = midY + (dx / len) * bow
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`
}

// --- the peek: hovering a container shows what contains *it*.
//
// Containers of containers are fetched in one batch per focus and kept for the
// session, so the peek opens instantly and the graph can mark in advance which
// containers have anything above them.

type Above = { total: number; containers: KanjiNode[] }
const aboveCache = new Map<string, Above>()
/** Containers nearest the focus are the ones hovered; prefetch that many. */
const PREFETCH = 64
/** Hover this long before the peek opens, so sweeping across the graph is quiet. */
const OPEN_DELAY = 120
const CLOSE_DELAY = 200

async function fetchAbove(chars: string[]): Promise<void> {
  const missing = chars.filter((c) => !aboveCache.has(c))
  for (let i = 0; i < missing.length; i += PREFETCH) {
    const got = await api.containersOf(missing.slice(i, i + PREFETCH))
    for (const [c, v] of Object.entries(got)) aboveCache.set(c, v)
  }
}

interface Peek {
  host: PositionedNode
  items: PeekItem[]
  total: number
  hidden: number
}

export function KanjiGraph({ data, filter, onDrill, onHover }: Props) {
  // The filter applies only upward. Going down is never limited: the parts a
  // character is made of are not optional, whatever level they happen to be.
  const shown = useMemo(() => data.containers.filter(keeps(filter)), [data.containers, filter])
  const layout = useMemo(
    () => computeLayout({ ...data, containers: shown }),
    [data, shown],
  )
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [over, setOver] = useState<string | null>(null)
  const [peek, setPeek] = useState<Peek | null>(null)
  // Bumped when a prefetch lands, so the "more above" marks redraw.
  const [, setAboveVersion] = useState(0)
  const timers = useRef<{ open?: number; close?: number }>({})
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  // Refit whenever the focus changes: the component tree below and the number of
  // container rings above both vary a lot between characters.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const { width, height } = svg.getBoundingClientRect()
    const b = layout.bounds
    // Cap generously so a sparse graph (few containers) still fills the canvas
    // instead of floating as a small diagram in a large void.
    const scale = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY), 1.7)
    setView({
      x: width / 2 - ((b.minX + b.maxX) / 2) * scale,
      y: height / 2 - ((b.minY + b.maxY) / 2) * scale,
      scale,
    })
  }, [layout, data.focus.char, filter])

  useEffect(() => {
    let stale = false
    fetchAbove(data.containers.slice(0, PREFETCH).map((c) => c.char)).then(
      () => !stale && setAboveVersion((v) => v + 1),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [data.containers])

  // A new focus or filter closes whatever was open.
  useEffect(() => {
    setPeek(null)
    const t = timers.current
    return () => {
      clearTimeout(t.open)
      clearTimeout(t.close)
    }
  }, [data.focus.char, filter])

  function openPeek(host: PositionedNode) {
    const above = aboveCache.get(host.char)
    if (!above) return false
    const kept = above.containers.filter(keeps(filter))
    if (kept.length === 0) {
      setPeek(null)
      return true
    }
    setPeek({
      host,
      items: placePeek(host, kept),
      total: above.total,
      hidden: above.containers.length - kept.length,
    })
    return true
  }

  function hoverContainer(host: PositionedNode) {
    const t = timers.current
    clearTimeout(t.close)
    clearTimeout(t.open)
    if (peek?.host.char === host.char) return
    const id = window.setTimeout(() => {
      if (!openPeek(host)) {
        fetchAbove([host.char]).then(
          () => {
            // Only if the cursor is still waiting on it.
            if (timers.current.open === id) openPeek(host)
          },
          () => {},
        )
      }
    }, OPEN_DELAY)
    t.open = id
  }

  function leave() {
    const t = timers.current
    clearTimeout(t.open)
    t.open = undefined
    clearTimeout(t.close)
    t.close = window.setTimeout(() => setPeek(null), CLOSE_DELAY)
  }

  function stay() {
    clearTimeout(timers.current.close)
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const scale = Math.min(Math.max(v.scale * factor, 0.12), 6)
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // Capture only once it is really a drag, or the click lands on the svg
    // instead of the node under the pointer.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true
      svgRef.current?.setPointerCapture?.(e.pointerId)
      setPeek(null)
    }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
  }

  function onPointerUp() {
    drag.current = null
  }

  function activate(node: PositionedNode) {
    if (node.kind === 'focus') return
    onDrill(node.char)
  }

  const renderNode = (n: PositionedNode, extra?: { className?: string; onEnter?: () => void }) => {
    const above = n.kind === 'container' ? aboveCache.get(n.char) : undefined
    const hasAbove = above !== undefined && above.total > 0
    // The "more above" mark sits on the outer side, pointing away from the focus.
    const out = Math.atan2(n.y, n.x)
    return (
      <g
        key={n.char}
        className={`node ${extra?.className ?? ''}`}
        data-kind={n.kind}
        data-dim={n.dim}
        style={{
          transform: `translate(${n.x}px, ${n.y}px)`,
          opacity: extra ? 1 : n.weight === undefined ? 1 : 0.42 + n.weight * 0.58,
        }}
        onClick={() => activate(n)}
        onMouseEnter={() => {
          setOver(n.char)
          onHover(n.char)
          if (n.kind === 'container') hoverContainer(n)
          extra?.onEnter?.()
        }}
        onMouseLeave={() => {
          setOver((c) => (c === n.char ? null : c))
          onHover(null)
          if (n.kind === 'container') leave()
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            activate(n)
          }
        }}
      >
        <title>
          {n.char}
          {n.meanings.length > 0 && ` — ${n.meanings.slice(0, 3).join(', ')}`}
          {`
${levelOf(n)}`}
        </title>

        <circle className="plate" r={n.radius} strokeWidth={n.kind === 'focus' ? 1 : 0.75} />

        {n.kind === 'focus' && <circle className="seal" r={n.radius + 7} />}

        {hasAbove && (
          <path
            className="above-mark"
            d={arc(n.radius + 3.5, out - 0.42, out + 0.42)}
            strokeWidth={Math.max(1, n.radius * 0.07)}
          />
        )}

        <text className="glyph" fontSize={n.radius * 1.28}>
          {n.char}
        </text>

        {/* Hovering swaps the fan-out count for the level, which is the
            thing you want to know when deciding whether to learn it. */}
        {over === n.char ? (
          <text className="node-level" y={n.radius + 14}>
            {levelOf(n)}
          </text>
        ) : (
          n.kind === 'component' &&
          n.fanout > 1 && (
            <text className="fanout" y={n.radius + 13}>
              {n.fanout}
            </text>
          )
        )}
      </g>
    )
  }

  return (
    <>
      <svg
        ref={svgRef}
        className="graph-svg"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          <radialGradient id="peek-veil">
            <stop offset="0%" stopColor="var(--sumi)" stopOpacity="0.94" />
            <stop offset="70%" stopColor="var(--sumi)" stopOpacity="0.82" />
            <stop offset="100%" stopColor="var(--sumi)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="graph-main" data-peek={peek ? true : undefined}>
            {layout.edges.map((e) => (
              <path
                key={e.id}
                className="edge"
                d={edgePath(e.from, e.to)}
                data-down={e.id.startsWith('e:')}
                data-dim={e.dim}
                strokeWidth={e.id.startsWith('c:') ? 0.75 : 1.1}
              />
            ))}

            {layout.nodes.map((n) => renderNode(n))}
          </g>

          {peek && (
            <PeekLayer
              key={peek.host.char}
              peek={peek}
              zoom={Math.max(1, 1 / view.scale)}
              host={renderNode(peek.host, { className: 'peek-host', onEnter: stay })}
              onEnter={stay}
              onLeave={leave}
              onPick={(c) => onDrill(c, peek.host.char)}
            />
          )}
        </g>
      </svg>

      <p className="legend">
        above, characters that contain it, nearest first by frequency
        <br />
        below, what it is made of, down to atoms
        <br />
        hover one above to see what contains it in turn
      </p>
    </>
  )
}

/** SVG arc path of radius r between two angles. */
function arc(r: number, a0: number, a1: number): string {
  const x0 = Math.cos(a0) * r
  const y0 = Math.sin(a0) * r
  const x1 = Math.cos(a1) * r
  const y1 = Math.sin(a1) * r
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
}

function PeekLayer({
  peek,
  zoom,
  host,
  onEnter,
  onLeave,
  onPick,
}: {
  peek: Peek
  /** A crowded graph is drawn small; the peek magnifies around its host so it
      always reads at full size. */
  zoom: number
  host: React.ReactNode
  onEnter: () => void
  onLeave: () => void
  onPick: (char: string) => void
}) {
  const { host: h, items } = peek
  const reach = items.reduce((m, it) => Math.max(m, Math.hypot(it.x - h.x, it.y - h.y) + it.radius), 0) + 26
  const more = peek.total - items.length - peek.hidden
  const out = Math.atan2(h.y, h.x)

  return (
    // mouseover, not mouseenter: it fires again on every child, which cancels
    // the close the host schedules when the pointer moves off it.
    <g
      className="peek"
      transform={`translate(${h.x} ${h.y}) scale(${zoom}) translate(${-h.x} ${-h.y})`}
      onMouseOver={onEnter}
      onMouseLeave={onLeave}
    >
      {/* The veil catches the pointer across the whole peek, so moving
          between its characters never falls through and closes it. */}
      <circle className="peek-veil" cx={h.x} cy={h.y} r={reach} fill="url(#peek-veil)" />

      {items.map((it, i) => (
        <path
          key={`e:${it.char}`}
          className="peek-edge"
          d={edgePath(it, h)}
          style={{ animationDelay: `${Math.min(i, 24) * 14}ms` }}
        />
      ))}

      {host}

      {items.map((it, i) => (
        <g
          key={it.char}
          className="peek-node"
          data-dim={!it.node.joyo}
          style={
            {
              '--from': `translate(${h.x}px, ${h.y}px) scale(0.35)`,
              '--to': `translate(${it.x}px, ${it.y}px)`,
              transform: `translate(${it.x}px, ${it.y}px)`,
              animationDelay: `${Math.min(i, 24) * 14}ms`,
            } as React.CSSProperties
          }
          onClick={(e) => {
            e.stopPropagation()
            onPick(it.char)
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onPick(it.char)
            }
          }}
        >
          <title>
            {it.char}
            {it.node.meanings.length > 0 && ` — ${it.node.meanings.slice(0, 3).join(', ')}`}
            {`
${levelOf(it.node)}`}
          </title>
          <circle className="plate" r={it.radius} />
          <text className="glyph" fontSize={it.radius * 1.28}>
            {it.char}
          </text>
          <text className="peek-meaning" y={it.radius + 10}>
            {(it.node.meanings[0] ?? '').toLowerCase().slice(0, 14)}
          </text>
        </g>
      ))}

      {(more > 0 || peek.hidden > 0) && (
        <text
          className="peek-more"
          x={h.x + Math.cos(out) * (reach - 8)}
          y={h.y + Math.sin(out) * (reach - 8)}
        >
          {more > 0 && `+${more} more`}
          {more > 0 && peek.hidden > 0 && ' · '}
          {peek.hidden > 0 && `${peek.hidden} hidden by level`}
        </text>
      )}
    </g>
  )
}
