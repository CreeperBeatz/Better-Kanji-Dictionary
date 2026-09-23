import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type GraphResponse, type KanjiNode } from '../api'
import { strings, useLang, type Translate } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { HoldCard } from './HoldCard'
import { computeLayout, PEEK_SPAN, placePeek, type PeekItem, type PositionedNode } from './layout'

export type ContainerFilter = 'all' | 'common' | 1 | 2 | 3 | 4 | 5

interface Props {
  data: GraphResponse
  filter: ContainerFilter
  /** `via` is the container a peeked character was reached through. */
  onDrill: (char: string, via?: string) => void
  onHover: (char: string | null) => void
  /** Show how to read the graph, opened from the (i). */
  legend: boolean
}

const S = strings(
  {
    joyo: 'jōyō',
    part: 'part',
    rare: 'rare',
    zoom: 'Zoom',
    recentre: 'Recentre on {c}',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    whole: 'Show the whole graph',
    legendAbove: 'above, characters that contain it, nearest first by frequency',
    legendBelow: 'below, what it is made of, down to atoms',
    legendHover: 'hover one above to see what contains it in turn',
    legendVia: 'dashed, not at this level itself, but inside characters that are',
    via: 'not at this level itself, but inside characters that are',
  },
  {
    joyo: 'джойо',
    part: 'част',
    rare: 'рядък',
    zoom: 'Мащаб',
    recentre: 'Центрирайте върху {c}',
    zoomIn: 'Приближете',
    zoomOut: 'Отдалечете',
    whole: 'Покажете целия граф',
    legendAbove: 'отгоре - йероглифите, които го съдържат, най-честите най-близо',
    legendBelow: 'отдолу - от какво е съставен, чак до най-простите части',
    legendHover: 'посочете някой отгоре, за да видите какво на свой ред го съдържа',
    legendVia: 'с прекъсната линия - не е от това ниво, но е част от йероглифи, които са',
    via: 'не е от това ниво, но е част от йероглифи, които са',
  },
)
type T = Translate<Parameters<ReturnType<typeof S>>[0]>

/** What to call a character's level, including the things that have none. */
function levelOf(n: { jlpt: number | null; joyo: boolean; fanout: number | null }, t: T): string {
  if (n.jlpt) return `N${n.jlpt}`
  if (n.joyo) return t('joyo')
  return (n.fanout ?? 0) > 0 ? t('part') : t('rare')
}

/** "水 — water, liquid" as a node's tooltip names it. */
function titleMeanings(n: { meanings: string[]; meaningsBg?: string[] | null }, t: T): string {
  const m = meaningsOf(n, t.lang).value
  return m.length > 0 ? ` - ${m.slice(0, 3).join(', ')}` : ''
}

/** JLPT runs N5 (easiest) to N1, so "up to N3" means jlpt >= 3. */
export function keeps(filter: ContainerFilter) {
  return (n: { freq: number | null; jlpt: number | null }) => {
    if (filter === 'all') return true
    if (filter === 'common') return n.freq !== null
    return n.jlpt !== null && n.jlpt >= filter
  }
}

/**
 * Whether something the filter keeps is further up from `n` -- 关 is no
 * JLPT kanji, but 送 above it is, so 关 is the way from 丷 up to 送.
 */
function leadsUp(filter: ContainerFilter) {
  return (n: KanjiNode) => {
    if (filter === 'all') return false
    if (filter === 'common') return !!n.upFreq
    return n.upJlpt != null && n.upJlpt >= filter
  }
}

/** What the filter shows above: what it keeps, and what leads up to that. */
function sieve(nodes: KanjiNode[], filter: ContainerFilter) {
  const keep = keeps(filter)
  const leads = leadsUp(filter)
  const via = new Set<string>()
  const shown = nodes.filter((n) => {
    if (keep(n)) return true
    if (!leads(n)) return false
    via.add(n.char)
    return true
  })
  return { shown, via }
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
/** Press this long on a touch screen to see a character's details, as hovering does. */
const HOLD_DELAY = 450

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
  via: Set<string>
}

export function KanjiGraph({ data, filter, onDrill, onHover, legend }: Props) {
  const t = S(useLang())
  // The filter applies only upward. Going down is never limited: the parts a
  // character is made of are not optional, whatever level they happen to be.
  // A container outside the level stays if it leads up to something inside it.
  const { shown, via } = useMemo(() => sieve(data.containers, filter), [data.containers, filter])
  const layout = useMemo(
    () => computeLayout({ ...data, containers: shown }, via),
    [data, shown, via],
  )
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [over, setOver] = useState<string | null>(null)
  const [peek, setPeek] = useState<Peek | null>(null)
  // Bumped when a prefetch lands, so the "more above" marks redraw.
  const [, setAboveVersion] = useState(0)
  const timers = useRef<{ open?: number; close?: number }>({})
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  // Fingers on the graph, for a two-finger pinch; `dist` is their last spread.
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null)
  // A pinch ends with fingers lifting over nodes, which must not open them.
  const pinched = useRef(false)
  const [held, setHeld] = useState<{ node: KanjiNode; x: number; y: number } | null>(null)
  const hold = useRef<{ timer?: number; shown: boolean }>({ shown: false })
  // The full entries, for the hold card: layout nodes carry only what drawing needs.
  const entries = useMemo(() => {
    const m = new Map<string, KanjiNode>()
    for (const n of [data.focus, ...data.containers, ...data.components.nodes]) m.set(n.char, n)
    return m
  }, [data])

  /** Frame the whole graph. */
  const fit = useCallback(() => {
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
  }, [layout])

  // Refit whenever the focus changes: the component tree below and the number of
  // container rings above both vary a lot between characters.
  useEffect(fit, [fit, data.focus.char, filter])

  /** The svg's middle, which the buttons zoom about. */
  function middle(): [number, number] {
    const r = svgRef.current?.getBoundingClientRect()
    return r ? [r.width / 2, r.height / 2] : [0, 0]
  }

  /** Put the focused character, which the layout keeps at its origin, in the middle. */
  function recentre() {
    const [mx, my] = middle()
    setView((v) => ({ ...v, x: mx, y: my }))
  }

  // Keep the graph where it was relative to the middle as the stage changes
  // size -- dragging the rail wider or narrower, say.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    let last = svg.getBoundingClientRect()
    const ro = new ResizeObserver(() => {
      const now = svg.getBoundingClientRect()
      const dx = (now.width - last.width) / 2
      const dy = (now.height - last.height) / 2
      last = now
      if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    })
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

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
    const { shown: kept, via } = sieve(above.containers, filter)
    if (kept.length === 0) {
      setPeek(null)
      return true
    }
    setPeek({
      host,
      items: placePeek(host, kept),
      via,
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

  /** Zoom by `factor` about a point in the svg, then move by (dx, dy). */
  function zoomAt(factor: number, px: number, py: number, dx = 0, dy = 0) {
    setView((v) => {
      const scale = Math.min(Math.max(v.scale * factor, 0.12), 6)
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k + dx, y: py - (py - v.y) * k + dy }
    })
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
  }

  function spread() {
    const [a, b] = [...touches.current.values()]
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    if (e.pointerType === 'touch') {
      const rect = svgRef.current?.getBoundingClientRect()
      touches.current.set(e.pointerId, { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
      if (touches.current.size === 1) pinched.current = false
      if (touches.current.size === 2) {
        // A second finger turns the drag into a pinch.
        for (const id of touches.current.keys()) svgRef.current?.setPointerCapture?.(id)
        drag.current = null
        pinched.current = true
        clearTimeout(hold.current.timer)
        setPeek(null)
        pinch.current = spread()
        return
      }
    }
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
  }

  // Touch has no hover, so pressing and holding stands in for it. Letting go
  // hides the card and does not open the character.
  function startHold(e: React.PointerEvent, char: string) {
    hold.current.shown = false
    if (e.pointerType !== 'touch') return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    clearTimeout(hold.current.timer)
    hold.current.timer = window.setTimeout(() => {
      const node = entries.get(char)
      if (!node) return
      hold.current.shown = true
      drag.current = null
      setPeek(null)
      setHeld({ node, x, y })
    }, HOLD_DELAY)
  }

  function endHold() {
    clearTimeout(hold.current.timer)
    setHeld(null)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (touches.current.has(e.pointerId)) {
      const rect = svgRef.current?.getBoundingClientRect()
      touches.current.set(e.pointerId, { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
      const p = pinch.current
      if (p && touches.current.size >= 2) {
        const now = spread()
        if (p.dist > 0) zoomAt(now.dist / p.dist, now.mx, now.my, now.mx - p.mx, now.my - p.my)
        pinch.current = now
        return
      }
    }
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // Capture only once it is really a drag, or the click lands on the svg
    // instead of the node under the pointer.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      clearTimeout(hold.current.timer)
      d.moved = true
      svgRef.current?.setPointerCapture?.(e.pointerId)
      setPeek(null)
    }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
  }

  function onPointerUp(e: React.PointerEvent) {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
    drag.current = null
    endHold()
  }

  function activate(node: PositionedNode) {
    // The click that ends a press-and-hold only closes the card.
    if (hold.current.shown) {
      hold.current.shown = false
      return
    }
    if (pinched.current) return
    if (node.kind === 'focus') return
    onDrill(node.char)
  }

  const renderNode = (n: PositionedNode, extra?: { className?: string; onEnter?: () => void }) => {
    const above = n.kind === 'container' ? aboveCache.get(n.char) : undefined
    // Only if the filter would show something up there: a mark that opens
    // onto nothing is a promise the peek does not keep.
    const hasAbove = above !== undefined && sieve(above.containers, filter).shown.length > 0
    // The "more above" mark sits on the outer side, pointing away from the focus.
    const out = Math.atan2(n.y, n.x)
    return (
      <g
        key={n.char}
        className={`node ${extra?.className ?? ''}`}
        data-kind={n.kind}
        data-dim={n.dim}
        data-via={n.via || undefined}
        style={{
          transform: `translate(${n.x}px, ${n.y}px)`,
          opacity: extra ? 1 : n.weight === undefined ? 1 : 0.42 + n.weight * 0.58,
        }}
        onClick={() => activate(n)}
        onPointerDown={(e) => startHold(e, n.char)}
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
          {titleMeanings(n, t)}
          {`
${levelOf(n, t)}`}
          {n.via && `
${t('via')}`}
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
            {levelOf(n, t)}
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
        onPointerCancel={onPointerUp}
        // A long press would otherwise open the browser's own menu.
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="graph-main" data-peek={peek ? true : undefined}>
            {layout.edges.map((e) => (
              <path
                key={e.id}
                className="edge"
                d={edgePath(e.from, e.to)}
                data-down={e.id.startsWith('e:')}
                data-dim={e.dim}
                data-via={e.via || undefined}
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

      {/* The same corner and buttons as the map's. */}
      <div className="map-zoom" role="group" aria-label={t('zoom')}>
        <button
          onClick={recentre}
          aria-label={t('recentre', { c: data.focus.char })}
          title={t('recentre', { c: data.focus.char })}
        >
          ◎
        </button>
        <button onClick={() => zoomAt(1.6, ...middle())} aria-label={t('zoomIn')} title={t('zoomIn')}>
          +
        </button>
        <button onClick={() => zoomAt(1 / 1.6, ...middle())} aria-label={t('zoomOut')} title={t('zoomOut')}>
          −
        </button>
        <button onClick={fit} aria-label={t('whole')} title={t('whole')}>
          ⤢
        </button>
      </div>

      {held && (
        <HoldCard
          node={held.node}
          x={held.x}
          y={held.y}
          width={svgRef.current?.getBoundingClientRect().width ?? 0}
        />
      )}

      {legend && (
        <p className="legend" id="stage-legend">
          {t('legendAbove')}
          <br />
          {t('legendBelow')}
          <br />
          {t('legendHover')}
          <br />
          {t('legendVia')}
        </p>
      )}
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
  const t = S(useLang())
  const { host: h, items } = peek
  const reach = items.reduce((m, it) => Math.max(m, Math.hypot(it.x - h.x, it.y - h.y) + it.radius), 0) + 26
  // The cone the peek fans out in, from the host away from the focus. It is
  // both the veil behind the peek and what holds it open: moving off it --
  // sideways onto the next character, say -- lets that one be hovered.
  const out = Math.atan2(h.y, h.x)
  const half = PEEK_SPAN / 2 + 0.3
  const cone =
    `M ${h.x} ${h.y} ` +
    `L ${h.x + Math.cos(out - half) * reach} ${h.y + Math.sin(out - half) * reach} ` +
    `A ${reach} ${reach} 0 0 1 ${h.x + Math.cos(out + half) * reach} ${h.y + Math.sin(out + half) * reach} Z`

  return (
    // mouseover, not mouseenter: it fires again on every child, which cancels
    // the close the host schedules when the pointer moves off it.
    <g
      className="peek"
      transform={`translate(${h.x} ${h.y}) scale(${zoom}) translate(${-h.x} ${-h.y})`}
      onMouseOver={onEnter}
      onMouseLeave={onLeave}
    >
      <defs>
        <radialGradient id="peek-veil-cone" gradientUnits="userSpaceOnUse" cx={h.x} cy={h.y} r={reach}>
          <stop offset="0%" stopColor="var(--sumi)" stopOpacity="0.94" />
          <stop offset="70%" stopColor="var(--sumi)" stopOpacity="0.82" />
          <stop offset="100%" stopColor="var(--sumi)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path className="peek-veil" d={cone} fill="url(#peek-veil-cone)" />

      {items.map((it, i) => (
        <path
          key={`e:${it.char}`}
          className="peek-edge"
          data-via={peek.via.has(it.char) || undefined}
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
          data-via={peek.via.has(it.char) || undefined}
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
            {titleMeanings(it.node, t)}
            {`
${levelOf(it.node, t)}`}
            {peek.via.has(it.char) && `
${t('via')}`}
          </title>
          <circle className="plate" r={it.radius} />
          <text className="glyph" fontSize={it.radius * 1.28}>
            {it.char}
          </text>
          <text className="peek-meaning" y={it.radius + 10}>
            {(meaningsOf(it.node, t.lang).value[0] ?? '').toLowerCase().slice(0, 14)}
          </text>
        </g>
      ))}

    </g>
  )
}
