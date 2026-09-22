/**
 * The map: every character in a scope at once, to wander around in.
 *
 * Canvas, not SVG -- the widest scope is 13k nodes and 27k edges, far past
 * what the DOM keeps interactive. Drawing is on demand (only when the camera,
 * the layout or the hover changes), and detail follows zoom the way a street
 * map's does: from far out, only the large characters -- the frequent ones and
 * the parts many others share -- carry a glyph, and the rest are points of
 * light that resolve into characters as you get close.
 *
 * Clicking a character flies to it and makes it the focus; clicking the focus
 * again opens it in the focus view.
 */

import { interpolateZoom } from 'd3-interpolate'
import { quadtree, type Quadtree } from 'd3-quadtree'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KanjiNode } from '../api'
import type { ContainerFilter } from '../graph/KanjiGraph'
import type { LayoutMessage, LayoutRequest } from './layout.worker'
import { GlyphAtlas, type SpriteStyle } from './glyphs'
import { cachedLayout, loadMap, storeLayout, type MapData, type Scope } from './mapData'

interface Props {
  scope: Scope
  focus: string
  focusNode: KanjiNode | null
  onSelect: (char: string) => void
  onOpen: (char: string) => void
  onScope: (f: ContainerFilter) => void
}

interface Camera {
  x: number
  y: number
  k: number
}

/** A glyph appears once its node is this many pixels across in radius... */
const LABEL_FROM = 5.5
/** ...and is fully opaque by this one. */
const LABEL_FULL = 8.5
/** Flying to a character zooms in at least this far, so it can be read. */
const READABLE_RADIUS = 13
/** How many of the focus's neighbours are always drawn as legible glyphs. */
const NEAR_LIMIT = 48
const GLYPH_PX = 64
/** New glyph sprites one frame may render; the rest follow on later frames. */
const SPRITES_PER_FRAME = 120
const MINCHO = '"Shippori Mincho", "Yu Mincho", "Hiragino Mincho ProN", serif'

// The last finished layout seeds the next scope, so switching N4 -> N3 grows
// the map around where things already were instead of reshuffling it.
let lastLayout: { data: MapData; pos: Float32Array } | null = null

function palette() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    paper: v('--paper'),
    paperDim: v('--paper-dim'),
    muted: v('--muted'),
    faint: v('--faint'),
    rule: v('--rule'),
    ruleBright: v('--rule-bright'),
    ai: v('--ai'),
    aiDeep: v('--ai-deep'),
    shu: v('--shu'),
    sumi: v('--sumi'),
  }
}

function spriteStyles(c: ReturnType<typeof palette>) {
  const base = { plate: c.sumi, font: MINCHO }
  return {
    paper: { ...base, key: 'paper', stroke: c.rule, glyph: c.paper } as SpriteStyle,
    muted: { ...base, key: 'muted', stroke: c.rule, glyph: c.muted } as SpriteStyle,
    part: { ...base, key: 'part', stroke: c.aiDeep, glyph: c.ai } as SpriteStyle,
  }
}

const atlas = new GlyphAtlas()

function levelLabel(d: MapData, i: number): string {
  const j = d.jlpt[i]
  if (j) return `N${j}`
  if (d.joyo[i]) return 'jōyō'
  return d.fanout[i] > 0 ? 'part' : 'rare'
}

/** The narrowest scope a character appears in, for the "not on this map" hint. */
function homeScope(n: KanjiNode | null): ContainerFilter {
  if (n?.jlpt) return n.jlpt as ContainerFilter
  if (n?.freq) return 'common'
  return 'all'
}

const SCOPE_NAME: Record<Scope, string> = {
  '5': 'N5',
  '4': 'N4',
  '3': 'N3',
  '2': 'N2',
  '1': 'N1',
  common: 'common',
  all: 'full',
}

function createState() {
  return {
    data: null as MapData | null,
    pos: null as Float32Array | null,
    cam: { x: 0, y: 0, k: 1 } as Camera,
    w: 0,
    h: 0,
    dpr: 1,
    hover: -1,
    focus: -1,
    focusChar: '',
    userMoved: false,
    /** false until the camera has been pointed at anything */
    placed: false,
    anim: null as null | { start: number; dur: number; at: (t: number) => Camera },
    tree: null as Quadtree<number> | null,
    raf: 0,
    colors: null as ReturnType<typeof palette> | null,
    styles: null as ReturnType<typeof spriteStyles> | null,
    maxSize: 1,
    near: new Set<number>(),
    nearOf: -1,
    nearData: null as MapData | null,
  }
}

type MapState = ReturnType<typeof createState>

/** Draw one frame; true while a camera flight still needs more. */
function drawFrame(s: MapState, canvas: HTMLCanvasElement | null): boolean {
  const ctx = canvas?.getContext('2d')
  const d = s.data
  const pos = s.pos
  if (!canvas || !ctx) return false
  const c = (s.colors ??= palette())
  const { w, h, dpr } = s

  if (s.anim) {
    const t = Math.min(1, (performance.now() - s.anim.start) / s.anim.dur)
    // easeInOutCubic: van Wijk's path already shapes the zoom; this shapes pace.
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    s.cam = s.anim.at(e)
    if (t >= 1) s.anim = null
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (!d || !pos) return false

  const { k } = s.cam
  const ox = w / 2 - s.cam.x * k
  const oy = h / 2 - s.cam.y * k
  const pad = s.maxSize * k + 20
  const inView = (i: number) => {
    const x = pos[2 * i] * k + ox
    const y = pos[2 * i + 1] * k + oy
    return x > -pad && x < w + pad && y > -pad && y < h + pad
  }

  const f = s.focus
  const hv = s.hover

  // --- ambient edges fade in with zoom; a small scope shows them always.
  const edgeAlpha = d.n < 1200 ? 0.55 : Math.max(0, Math.min(1, (k - 0.55) / 0.9)) * 0.55
  if (edgeAlpha > 0.02) {
    ctx.globalAlpha = edgeAlpha
    ctx.strokeStyle = c.rule
    ctx.lineWidth = 1
    ctx.beginPath()
    const e = d.edges
    for (let m = 0; m < e.length; m += 2) {
      const a = e[m]
      const b = e[m + 1]
      if (!inView(a) && !inView(b)) continue
      ctx.moveTo(pos[2 * a] * k + ox, pos[2 * a + 1] * k + oy)
      ctx.lineTo(pos[2 * b] * k + ox, pos[2 * b + 1] * k + oy)
    }
    ctx.stroke()
  }

  // --- the focus's own edges: parts in indigo, users in paper.
  const spokes = (i: number, alpha: number, width: number) => {
    const x = pos[2 * i] * k + ox
    const y = pos[2 * i + 1] * k + oy
    ctx.lineWidth = width
    ctx.globalAlpha = alpha
    ctx.strokeStyle = c.aiDeep
    ctx.beginPath()
    for (let m = d.partsAt[i]; m < d.partsAt[i + 1]; m++) {
      const j = d.partsIdx[m]
      ctx.moveTo(x, y)
      ctx.lineTo(pos[2 * j] * k + ox, pos[2 * j + 1] * k + oy)
    }
    ctx.stroke()
    ctx.strokeStyle = c.ruleBright
    ctx.beginPath()
    for (let m = d.usersAt[i]; m < d.usersAt[i + 1]; m++) {
      const j = d.usersIdx[m]
      ctx.moveTo(x, y)
      ctx.lineTo(pos[2 * j] * k + ox, pos[2 * j + 1] * k + oy)
    }
    ctx.stroke()
  }
  if (f >= 0) spokes(f, 0.9, 1.3)
  if (hv >= 0 && hv !== f) spokes(hv, 0.7, 1)

  // Neighbours of the focus are drawn legibly whatever the zoom: that is
  // the part of the map you are standing in. A hub like 口 has a thousand, so
  // only the most important are promoted.
  if (s.nearOf !== f || s.nearData !== d) {
    const all: number[] = []
    if (f >= 0) {
      for (let m = d.partsAt[f]; m < d.partsAt[f + 1]; m++) all.push(d.partsIdx[m])
      for (let m = d.usersAt[f]; m < d.usersAt[f + 1]; m++) all.push(d.usersIdx[m])
    }
    all.sort((a, b) => d.size[b] - d.size[a])
    s.near = new Set(all.slice(0, NEAR_LIMIT))
    s.nearOf = f
    s.nearData = d
  }
  const near = s.near

  const colorOf = (i: number) => (d.target[i] ? (d.joyo[i] ? c.paper : c.muted) : c.ai)

  // --- distant nodes as points, batched by colour to keep state changes few.
  for (const col of [c.paper, c.muted, c.ai]) {
    ctx.fillStyle = col
    for (let i = 0; i < d.n; i++) {
      const r = d.size[i] * k
      if (r >= LABEL_FROM || near.has(i) || colorOf(i) !== col || !inView(i)) continue
      const x = pos[2 * i] * k + ox
      const y = pos[2 * i + 1] * k + oy
      ctx.globalAlpha = 0.28 + 0.6 * Math.min(1, r / LABEL_FROM)
      if (r < 1.4) {
        ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4)
      } else {
        ctx.beginPath()
        ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // --- near nodes as plates and glyphs, least important first so the big
  // ones land on top.
  // Every node but the focus comes from the sprite atlas: fillText at a new
  // scale re-rasterises the glyph, which made every zoom frame redo them all.
  const styles = (s.styles ??= spriteStyles(c))
  const glyph = (i: number, x: number, y: number, r: number, alpha: number) => {
    ctx.globalAlpha = alpha
    const style = d.target[i] ? (d.joyo[i] ? styles.paper : styles.muted) : styles.part
    atlas.draw(ctx, d.chars[i], style, x, y, r, dpr)
  }

  /** The focus alone is drawn live, in the heavier weight. */
  const liveGlyph = (i: number, x: number, y: number, r: number) => {
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = c.sumi
    ctx.fill()
    ctx.lineWidth = 0.75
    ctx.strokeStyle = d.target[i] ? c.rule : c.aiDeep
    ctx.stroke()
    const sc = (r * 1.28) / GLYPH_PX
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * x, dpr * y)
    ctx.fillStyle = colorOf(i)
    ctx.fillText(d.chars[i], 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  atlas.beginFrame(SPRITES_PER_FRAME)
  for (let i = 0; i < d.n; i++) {
    const r = d.size[i] * k
    if (r < LABEL_FROM || i === f || near.has(i) || !inView(i)) continue
    const a = Math.min(1, (r - LABEL_FROM) / (LABEL_FULL - LABEL_FROM))
    glyph(i, pos[2 * i] * k + ox, pos[2 * i + 1] * k + oy, r, 0.35 + 0.65 * a)
  }
  for (const i of near) {
    if (!inView(i)) continue
    glyph(i, pos[2 * i] * k + ox, pos[2 * i + 1] * k + oy, Math.max(d.size[i] * k, 9), 1)
  }

  // --- the focus: a vermilion seal, as in the focus view.
  if (f >= 0 && inView(f)) {
    const x = pos[2 * f] * k + ox
    const y = pos[2 * f + 1] * k + oy
    const r = Math.max(d.size[f] * k, 18)
    const glow = ctx.createRadialGradient(x, y, r, x, y, r * 3.2)
    glow.addColorStop(0, 'rgba(208, 69, 43, 0.16)')
    glow.addColorStop(1, 'rgba(208, 69, 43, 0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = glow
    ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4)
    ctx.font = `600 ${GLYPH_PX}px ${MINCHO}`
    liveGlyph(f, x, y, r)
    ctx.strokeStyle = c.shu
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, r + Math.max(4, r * 0.16), 0, Math.PI * 2)
    ctx.stroke()
  }

  if (hv >= 0 && hv !== f && inView(hv)) {
    const x = pos[2 * hv] * k + ox
    const y = pos[2 * hv + 1] * k + oy
    const r = Math.max(d.size[hv] * k, near.has(hv) ? 9 : 3)
    ctx.globalAlpha = 1
    ctx.strokeStyle = c.paperDim
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, r + 3, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  return s.anim !== null || atlas.pending > 0
}

export function KanjiMap({ scope, focus, focusNode, onSelect, onOpen, onScope }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'fetch' | 'layout' | 'ready' | 'error'>('fetch')
  const [counts, setCounts] = useState<{ nodes: number; edges: number } | null>(null)
  const [present, setPresent] = useState(true)

  // Everything the draw loop reads lives in one mutable bag, so a pan or a
  // hover never goes through React.
  const s = useRef(createState()).current

  // ------------------------------------------------------------------ drawing



  const request = useMemo(() => {
    const frame = () => {
      s.raf = 0
      if (drawFrame(s, canvasRef.current)) s.raf = requestAnimationFrame(frame)
    }
    return () => {
      if (!s.raf) s.raf = requestAnimationFrame(frame)
    }
  }, [s])

  // ------------------------------------------------------------------ camera

  const bounds = useCallback(() => {
    const pos = s.pos
    if (!pos) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < pos.length; i += 2) {
      const x = pos[i]
      const y = pos[i + 1]
      if (Number.isNaN(x)) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 }
  }, [s])

  const fitCamera = useCallback((): Camera | null => {
    const b = bounds()
    if (!b || !s.w) return null
    const k = Math.min(s.w / (b.x1 - b.x0 + 60), s.h / (b.y1 - b.y0 + 60))
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, k }
  }, [bounds, s])

  const flyTo = useCallback(
    (to: Camera) => {
      const from = s.cam
      const zi = interpolateZoom([from.x, from.y, s.w / from.k], [to.x, to.y, s.w / to.k])
      s.anim = {
        start: performance.now(),
        dur: Math.max(380, Math.min(1400, zi.duration * 0.75)),
        at: (t) => {
          const [x, y, width] = zi(t)
          return { x, y, k: s.w / width }
        },
      }
      request()
    },
    [s, request],
  )

  /** Centre a character, keeping the zoom unless it is too far out to read it. */
  const centreOn = useCallback(
    (i: number, instant = false) => {
      const d = s.data
      const pos = s.pos
      if (!d || !pos) return
      const k = Math.max(s.cam.k, READABLE_RADIUS / d.size[i])
      const to = { x: pos[2 * i], y: pos[2 * i + 1], k: Math.min(k, 8) }
      if (instant) {
        s.cam = to
        request()
      } else flyTo(to)
    },
    [s, flyTo, request],
  )

  const zoomBy = useCallback(
    (factor: number, px = s.w / 2, py = s.h / 2) => {
      const fit = fitCamera()
      const minK = fit ? fit.k * 0.5 : 0.05
      const cam = s.cam
      const k = Math.max(minK, Math.min(10, cam.k * factor))
      // Keep the world point under (px, py) where it is.
      const wx = cam.x + (px - s.w / 2) / cam.k
      const wy = cam.y + (py - s.h / 2) / cam.k
      s.cam = { k, x: wx - (px - s.w / 2) / k, y: wy - (py - s.h / 2) / k }
      s.anim = null
      s.userMoved = true
      request()
    },
    [s, fitCamera, request],
  )

  // ------------------------------------------------------------------ data

  useEffect(() => {
    let cancelled = false
    let worker: Worker | null = null
    setPhase('fetch')
    setPresent(true)

    const settle = (d: MapData, pos: Float32Array) => {
      s.pos = pos
      s.tree = null
      // Arriving from nowhere, start from the whole map and fly in from there.
      if (!s.placed) {
        const fit = fitCamera()
        if (fit) s.cam = fit
        s.placed = true
      }
      lastLayout = { data: d, pos }
      setPhase('ready')
      const i = d.index.get(s.focusChar) ?? -1
      s.focus = i
      setPresent(i >= 0)
      if (i >= 0) centreOn(i)
      else {
        const fit = fitCamera()
        if (fit) flyTo(fit)
      }
    }

    loadMap(scope).then(
      (d) => {
        if (cancelled) return
        s.data = d
        s.hover = -1
        s.focus = -1
        s.maxSize = d.size.reduce((a, b) => Math.max(a, b), 1)
        setCounts({ nodes: d.n, edges: d.edges.length / 2 })

        const cached = cachedLayout(d)
        if (cached) {
          settle(d, cached)
          return
        }

        const seed = new Float32Array(2 * d.n).fill(NaN)
        if (lastLayout) {
          const prev = lastLayout
          for (let i = 0; i < d.n; i++) {
            const j = prev.data.index.get(d.chars[i])
            if (j !== undefined) {
              seed[2 * i] = prev.pos[2 * j]
              seed[2 * i + 1] = prev.pos[2 * j + 1]
            }
          }
        }

        setPhase('layout')
        s.userMoved = false
        worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent<LayoutMessage>) => {
          if (cancelled) return
          s.pos = e.data.positions
          s.tree = null
          if (e.data.kind === 'done') {
            storeLayout(d, e.data.positions)
            worker?.terminate()
            worker = null
            settle(d, e.data.positions)
            return
          }
          // Follow the forming map until the user takes the camera.
          if (!s.userMoved) {
            const fit = fitCamera()
            if (fit) s.cam = fit
            s.placed = true
          }
          request()
        }
        const req: LayoutRequest = { id: 1, n: d.n, edges: d.edges.slice(), size: d.size.slice(), seed }
        worker.postMessage(req, [req.edges.buffer, req.size.buffer, req.seed.buffer])
      },
      () => !cancelled && setPhase('error'),
    )

    return () => {
      cancelled = true
      worker?.terminate()
    }
  }, [scope, s, centreOn, fitCamera, flyTo, request])

  // The focus can change from anywhere -- search, breadcrumb, a word's kanji.
  useEffect(() => {
    s.focusChar = focus
    const d = s.data
    if (!d || !s.pos || phase !== 'ready') return
    const i = d.index.get(focus) ?? -1
    s.focus = i
    setPresent(i >= 0)
    if (i >= 0) centreOn(i)
    else request()
  }, [focus, phase, s, centreOn, request])

  // ------------------------------------------------------------------ canvas size

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect()
      s.dpr = window.devicePixelRatio || 1
      s.w = r.width
      s.h = r.height
      canvas.width = Math.round(r.width * s.dpr)
      canvas.height = Math.round(r.height * s.dpr)
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      request()
    })
    ro.observe(wrap)
    // Canvas text does not wait for web fonts; redraw once Mincho is in.
    document.fonts?.load(`${GLYPH_PX}px "Shippori Mincho"`, '字').then(() => {
      // Sprites rendered before the font arrived are in the fallback face.
      atlas.clear()
      request()
    }, () => {})
    return () => {
      ro.disconnect()
      if (s.raf) cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [s, request])

  // ------------------------------------------------------------------ input

  const pick = useCallback(
    (px: number, py: number): number => {
      const d = s.data
      const pos = s.pos
      if (!d || !pos) return -1
      if (!s.tree) {
        s.tree = quadtree<number>()
          .x((i) => pos[2 * i])
          .y((i) => pos[2 * i + 1])
          .addAll(Array.from({ length: d.n }, (_, i) => i))
      }
      const { k } = s.cam
      const wx = s.cam.x + (px - s.w / 2) / k
      const wy = s.cam.y + (py - s.h / 2) / k
      const i = s.tree.find(wx, wy, (s.maxSize * k + 10) / k)
      if (i === undefined) return -1
      const dist = Math.hypot(pos[2 * i] - wx, pos[2 * i + 1] - wy) * k
      return dist <= Math.max(d.size[i] * k, 8) + 2 ? i : -1
    },
    [s],
  )

  const setHover = useCallback(
    (i: number, px: number, py: number) => {
      const tip = tipRef.current
      const d = s.data
      if (i !== s.hover) {
        s.hover = i
        request()
      }
      if (!tip || !d) return
      if (i < 0) {
        tip.hidden = true
        return
      }
      tip.hidden = false
      tip.style.transform = `translate(${px + 14}px, ${py + 12}px)`
      const meaning = d.meaning[i] || (d.target[i] ? 'no recorded meaning' : 'component')
      tip.innerHTML = ''
      const g = document.createElement('b')
      g.textContent = d.chars[i]
      const m = document.createElement('span')
      m.textContent = meaning
      const l = document.createElement('em')
      l.textContent = i === s.focus ? `${levelLabel(d, i)} · click to open` : levelLabel(d, i)
      tip.append(g, m, l)
    },
    [s, request],
  )

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ x: number; y: number; moved: number; pinch: number | null } | null>(null)

  function local(e: React.PointerEvent | React.WheelEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    canvasRef.current?.setPointerCapture(e.pointerId)
    const [x, y] = local(e)
    pointers.current.set(e.pointerId, { x, y })
    if (pointers.current.size === 1) gesture.current = { x, y, moved: 0, pinch: null }
    else if (gesture.current) {
      const [a, b] = [...pointers.current.values()]
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y)
      gesture.current.moved = 99 // a pinch is never a click
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const [x, y] = local(e)
    const g = gesture.current
    const prev = pointers.current.get(e.pointerId)
    if (!g || !prev) {
      setHover(pick(x, y), x, y)
      return
    }
    pointers.current.set(e.pointerId, { x, y })

    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomBy(dist / g.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2)
      g.pinch = dist
      return
    }

    const dx = x - prev.x
    const dy = y - prev.y
    g.moved += Math.abs(dx) + Math.abs(dy)
    if (g.moved > 4) {
      s.cam = { ...s.cam, x: s.cam.x - dx / s.cam.k, y: s.cam.y - dy / s.cam.k }
      s.anim = null
      s.userMoved = true
      setHover(-1, x, y)
      request()
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const [x, y] = local(e)
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) return
    gesture.current = null
    if (!g || g.moved > 4) return
    const i = pick(x, y)
    const d = s.data
    if (i < 0 || !d) return
    if (i === s.focus) onOpen(d.chars[i])
    else onSelect(d.chars[i])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (!wrapRef.current?.offsetParent) return // map hidden behind the focus view
      if ((e.key === 'c' || e.key === 'C') && s.focus >= 0) centreOn(s.focus)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, centreOn])

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const home = homeScope(focusNode?.char === focus ? focusNode : null)

  return (
    <div className="map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => !gesture.current && setHover(-1, ...local(e))}
      />
      <div className="map-tip" ref={tipRef} hidden />

      {phase !== 'ready' && (
        <p className="map-status" role="status">
          {phase === 'fetch' && 'Fetching the map'}
          {phase === 'layout' && counts && `Laying out ${counts.nodes.toLocaleString()} characters`}
          {phase === 'error' && 'The map could not be loaded.'}
          {phase !== 'error' && <span className="map-status-dots" aria-hidden />}
        </p>
      )}

      {phase === 'ready' && !present && (
        <p className="map-status map-absent">
          <span className="map-absent-glyph">{focus}</span> is not on the {SCOPE_NAME[scope]} map
          {String(home) !== scope && (
            <button onClick={() => onScope(home)}>show on {SCOPE_NAME[String(home) as Scope]}</button>
          )}
        </p>
      )}

      <div className="map-zoom" role="group" aria-label="Zoom">
        <button
          onClick={() => s.focus >= 0 && centreOn(s.focus)}
          disabled={!present || phase !== 'ready'}
          aria-label={`Recentre on ${focus}`}
          title={`Recentre on ${focus} (C)`}
        >
          ◎
        </button>
        <button onClick={() => zoomBy(1.6)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button
          onClick={() => {
            const fit = fitCamera()
            if (fit) flyTo(fit)
          }}
          aria-label="Show the whole map"
          title="Show the whole map"
        >
          ⤢
        </button>
      </div>

      <p className="legend">
        {counts && `${counts.nodes.toLocaleString()} characters, ${counts.edges.toLocaleString()} links`}
        <br />
        larger is more frequent, or a part more characters share
        <br />
        click to centre and select, click again to open
      </p>
    </div>
  )
}
