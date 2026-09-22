import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphResponse } from '../api'
import { computeLayout, type PositionedNode } from './layout'

export type ContainerFilter = 'all' | 'common' | 1 | 2 | 3 | 4 | 5

interface Props {
  data: GraphResponse
  trail: string[]
  filter: ContainerFilter
  onFilter: (f: ContainerFilter) => void
  onDrill: (char: string) => void
  onPop: (index: number) => void
  onHover: (char: string | null) => void
}

const FILTERS: { value: ContainerFilter; label: string; title: string }[] = [
  { value: 'all', label: 'all', title: 'every character that contains this one' },
  { value: 'common', label: 'common', title: 'only characters with a newspaper frequency rank' },
  { value: 5, label: 'N5', title: 'N5' },
  { value: 4, label: 'N4', title: 'N5 and N4' },
  { value: 3, label: 'N3', title: 'N3 and easier' },
  { value: 2, label: 'N2', title: 'N2 and easier' },
  { value: 1, label: 'N1', title: 'N1 and easier — the whole JLPT set' },
]

/** What to call a character's level, including the things that have none. */
function levelOf(n: { jlpt: number | null; joyo: boolean; fanout: number }): string {
  if (n.jlpt) return `N${n.jlpt}`
  if (n.joyo) return 'jōyō'
  return n.fanout > 0 ? 'part' : 'rare'
}

/** JLPT runs N5 (easiest) to N1, so "up to N3" means jlpt >= 3. */
function keeps(filter: ContainerFilter) {
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

export function KanjiGraph({ data, trail, filter, onFilter, onDrill, onPop, onHover }: Props) {
  // The filter applies only upward. Going down is never limited: the parts a
  // character is made of are not optional, whatever level they happen to be.
  const shown = useMemo(() => data.containers.filter(keeps(filter)), [data.containers, filter])
  const hidden = data.containers.length - shown.length
  const layout = useMemo(
    () => computeLayout({ ...data, containers: shown }),
    [data, shown],
  )
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [over, setOver] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

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
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }))
  }

  function onPointerUp() {
    drag.current = null
  }

  function activate(node: PositionedNode) {
    if (node.kind === 'focus') return
    onDrill(node.char)
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
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
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

          {layout.nodes.map((n) => (
            <g
              key={n.char}
              className="node"
              data-kind={n.kind}
              data-dim={n.dim}
              style={{
                transform: `translate(${n.x}px, ${n.y}px)`,
                opacity: n.weight === undefined ? 1 : 0.42 + n.weight * 0.58,
              }}
              onClick={() => activate(n)}
              onMouseEnter={() => {
                setOver(n.char)
                onHover(n.char)
              }}
              onMouseLeave={() => {
                setOver((c) => (c === n.char ? null : c))
                onHover(null)
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
          ))}
        </g>
      </svg>

      {trail.length > 1 && (
        <nav className="trail" aria-label="Where you came from">
          {trail.map((c, i) => (
            <button
              key={`${c}-${i}`}
              onClick={() => onPop(i)}
              disabled={i === trail.length - 1}
              aria-current={i === trail.length - 1 ? 'page' : undefined}
            >
              {c}
            </button>
          ))}
        </nav>
      )}

      <div className="filter" role="group" aria-label="Which containing characters to show">
        {FILTERS.map((f) => (
          <button
            key={String(f.value)}
            data-on={filter === f.value}
            title={f.title}
            onClick={() => onFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <span className="filter-count">
          {shown.length} above{hidden > 0 && `, ${hidden} hidden`}
        </span>
      </div>

      <p className="legend">
        above, characters that contain it, nearest first by frequency
        <br />
        below, what it is made of, down to atoms
        <br />
        click any character to make it the centre
      </p>
    </>
  )
}
