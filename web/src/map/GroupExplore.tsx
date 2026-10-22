/**
 * Explore a group: one cluster of the map by meaning, on its own, to pan and
 * zoom in (Dani, 2026-10-22). Its kanji keep the arrangement they have on the
 * map, opened out so each one's meaning fits under it; more frequent is bigger.
 *
 * "See similar clusters" puts the clusters nearest in meaning round it: near
 * ones close, related ones further out, each on the side where it lies on the
 * map. Nearness is between whole clusters -- the cosine of their mean vectors,
 * the `near` grades of pipeline/meaning_map.py -- not between single kanji.
 * Each shows only its SIMILAR_SHOWN most frequent kanji, or the 40-kanji ones
 * shrink the explored one to a speck. Clicking a cluster's name explores all
 * of it; Back returns.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { strings, useLang } from '../i18n'
import { loadMap, type MapData, type Scope } from './mapData'

const S = strings(
  {
    title: 'Group',
    back: 'Back to the previous group',
    similar: 'See similar clusters',
    similarOff: 'Hide similar clusters',
    close: 'Back to the map (Esc)',
    loading: 'Loading the group',
    error: 'Could not load the group.',
    legend: 'Bigger is more frequent. Drag to move, scroll to zoom. Click a kanji to open it.',
    legendSimilar: 'Nearer clusters are closer. Click a cluster’s name to explore it.',
    explore: 'Explore {name}',
    more: '+{n} more',
    open: 'Open {c} in the dictionary',
    zoom: 'Zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    whole: 'Show all',
  },
  {
    title: 'Група',
    back: 'Обратно към предишната група',
    similar: 'Вижте сходни групи',
    similarOff: 'Скрийте сходните групи',
    close: 'Обратно към картата (Esc)',
    loading: 'Групата се зарежда',
    error: 'Групата не се зареди.',
    legend: 'По-големите са по-чести. Плъзнете, за да преместите, превъртете, за да приближите. Кликнете канджи, за да го отворите.',
    legendSimilar: 'По-близките групи са по-близо. Кликнете името на група, за да я разгледате.',
    explore: 'Разгледайте {name}',
    more: 'още {n}',
    open: 'Отворете {c} в речника',
    zoom: 'Мащаб',
    zoomIn: 'Приближете',
    zoomOut: 'Отдалечете',
    whole: 'Покажете всичко',
  },
)

/** Under NARROW the level filter takes the top row and the bar goes below it (theme.css, .gx). */
const NARROW = 880
const topOf = (w: number) => (w < NARROW ? 108 : 64)
const BOTTOM = 56
/** World units: the space a kanji with its meaning needs, and how a cluster grows with its size. */
const MIN_GAP = 64
const CELL = 42
/** Between a cluster and a similar one round it: near, related. */
const RING_GAP = [0, 130, 60]
const MIN_ZOOM = 0.08
const MAX_ZOOM = 4
const GLIDE_MS = 480
/** A similar cluster shows this many of its kanji, the most frequent. */
const SIMILAR_SHOWN = 10

interface Node {
  i: number
  x: number
  y: number
  fs: number
  /** 3 the explored cluster, 2 a near one, 1 a related one */
  stage: number
}

interface Blob {
  k: number
  x: number
  y: number
  r: number
  stage: number
  /** its kanji left out here */
  hidden: number
}

interface Camera {
  x: number
  y: number
  k: number
}

function glyphPx(freq: number | null): number {
  return freq ? 18 + 16 * Math.max(0, 1 - Math.log(freq) / Math.log(2600)) : 17
}

/** Push apart any two points nearer than `gap`; `fixed` ones stay. */
function relax(pts: { x: number; y: number; gap: number; fixed?: boolean }[], passes: number) {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const p = pts[a]
        const q = pts[b]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const dist = Math.hypot(dx, dy) || 0.01
        const over = (p.gap + q.gap) / 2 - dist
        if (over <= 0) continue
        moved = true
        const share = p.fixed ? 0 : q.fixed ? 1 : 0.5
        const ux = dx / dist
        const uy = dy / dist
        p.x -= ux * over * share
        p.y -= uy * over * share
        q.x += ux * over * (1 - share)
        q.y += uy * over * (1 - share)
      }
    }
    if (!moved) break
  }
}

/**
 * One cluster's kanji round (0, 0): their places on the map, scaled so the
 * cluster spans about what its count needs, stragglers pulled in, then
 * spread until no two overlap.
 */
function arrange(d: MapData, members: number[]): { pts: { i: number; x: number; y: number }[]; r: number } {
  const home = d.home!
  const xs = members.map((i) => home[2 * i]).sort((a, b) => a - b)
  const ys = members.map((i) => home[2 * i + 1]).sort((a, b) => a - b)
  const mx = xs[xs.length >> 1]
  const my = ys[ys.length >> 1]
  const off = members.map((i) => ({ i, x: home[2 * i] - mx, y: home[2 * i + 1] - my, gap: MIN_GAP }))
  const dist = off.map((p) => Math.hypot(p.x, p.y)).sort((a, b) => a - b)
  const reach = CELL * Math.sqrt(members.length)
  const q = dist[Math.floor(dist.length * 0.8)] || 1
  const scale = (reach * 0.8) / q
  for (const p of off) {
    p.x *= scale
    p.y *= scale
    const r = Math.hypot(p.x, p.y)
    if (r > reach * 1.15) {
      p.x *= (reach * 1.15) / r
      p.y *= (reach * 1.15) / r
    }
  }
  relax(off, 120)
  let r = 0
  for (const p of off) r = Math.max(r, Math.hypot(p.x, p.y))
  return { pts: off, r: r + 46 }
}

/** The explored cluster in the middle and, when asked, the similar ones round it. */
function scene(d: MapData, centre: number, similar: boolean): { nodes: Node[]; blobs: Blob[] } {
  const byCluster = new Map<number, number[]>()
  for (let i = 0; i < d.n; i++) {
    const k = d.cluster![i]
    if (k < 0) continue
    if (!byCluster.has(k)) byCluster.set(k, [])
    byCluster.get(k)!.push(i)
  }
  const centreOf = (ids: number[]) => {
    let x = 0
    let y = 0
    for (const i of ids) {
      x += d.home![2 * i]
      y += d.home![2 * i + 1]
    }
    return [x / ids.length, y / ids.length]
  }
  const nodes: Node[] = []
  const blobs: (Blob & { gap: number; fixed?: boolean; pts: { i: number; x: number; y: number }[] })[] = []
  const rank = (i: number) => d.freq[i] ?? Infinity
  const own = byCluster.get(centre)
  if (!own) return { nodes, blobs }
  const mid = arrange(d, own)
  blobs.push({ k: centre, x: 0, y: 0, r: mid.r, stage: 3, hidden: 0, gap: 2 * mid.r + 40, fixed: true, pts: mid.pts })

  if (similar) {
    const [cx, cy] = centreOf(own)
    const near = d.clusters[centre].near
    for (let k = 0; k < near.length; k++) {
      const stage = near.charCodeAt(k) - 48
      const ids = byCluster.get(k)
      if (k === centre || stage < 1 || !ids) continue
      const [x, y] = centreOf(ids)
      const ang = Math.atan2(y - cy, x - cx)
      const shown = ids.slice().sort((a, b) => rank(a) - rank(b)).slice(0, SIMILAR_SHOWN)
      const lay = arrange(d, shown)
      const dist = mid.r + lay.r + RING_GAP[stage]
      const hidden = ids.length - shown.length
      blobs.push({ k, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: lay.r, stage, hidden, gap: 2 * lay.r + 40, pts: lay.pts })
    }
    relax(blobs, 200)
  }

  for (const b of blobs) {
    for (const p of b.pts) nodes.push({ i: p.i, x: b.x + p.x, y: b.y + p.y, fs: glyphPx(d.freq[p.i]), stage: b.stage })
  }
  return { nodes, blobs: blobs.map(({ k, x, y, r, stage, hidden }) => ({ k, x, y, r, stage, hidden })) }
}

export function GroupExplore({
  scope,
  char,
  onClose,
  onOpen,
}: {
  scope: Scope
  /** the kanji whose group is explored first; a new one needs a new key */
  char: string
  /** back to the map, given that kanji */
  onClose: (char: string) => void
  onOpen: (char: string) => void
}) {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState<MapData | null>(null)
  const [failed, setFailed] = useState(false)
  const [trail, setTrail] = useState<number[]>([])
  const [similar, setSimilar] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const cam = useRef<Camera>({ x: 0, y: 0, k: 1 })
  const glideTimer = useRef(0)

  useEffect(() => {
    let stale = false
    loadMap(scope, 'meaning').then(
      (d) => !stale && setData(d),
      () => !stale && setFailed(true),
    )
    return () => {
      stale = true
    }
  }, [scope])

  const start = data?.cluster ? (data.cluster[data.index.get(char) ?? -1] ?? -1) : -1
  const centre = trail.length ? trail[trail.length - 1] : start
  const view = useMemo(() => (data?.cluster && centre >= 0 ? scene(data, centre, similar) : null), [data, centre, similar])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const apply = useCallback((glide = false) => {
    const w = worldRef.current
    if (!w) return
    clearTimeout(glideTimer.current)
    w.classList.toggle('gx-glide', glide)
    if (glide) glideTimer.current = window.setTimeout(() => w.classList.remove('gx-glide'), GLIDE_MS + 40)
    const { x, y, k } = cam.current
    w.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    // Cluster names keep a readable size however far out (theme.css, .gx-name).
    w.style.setProperty('--k', String(k))
  }, [])

  const fit = useCallback(
    (glide: boolean) => {
      if (!view || !size) return
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const b of view.blobs) {
        x0 = Math.min(x0, b.x - b.r)
        x1 = Math.max(x1, b.x + b.r)
        y0 = Math.min(y0, b.y - b.r - 40)
        y1 = Math.max(y1, b.y + b.r)
      }
      const top = topOf(size.w)
      const h = size.h - top - BOTTOM
      const k = Math.min(1.3, Math.max(MIN_ZOOM, Math.min((size.w - 40) / (x1 - x0), (h - 20) / (y1 - y0))))
      cam.current = { k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: top + h / 2 - ((y0 + y1) / 2) * k }
      apply(glide)
    },
    [view, size, apply],
  )

  // A new group, or the similar ones in or out: show the whole of it. The
  // first time without the glide, so it does not fly in from the corner.
  const fitted = useRef(false)
  useLayoutEffect(() => {
    if (!view || !size) return
    fit(fitted.current)
    fitted.current = true
  }, [view, size, fit])

  const zoomAt = useCallback(
    (f: number, px: number, py: number, glide = false) => {
      const c = cam.current
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.k * f))
      cam.current = { k, x: px - (px - c.x) * (k / c.k), y: py - (py - c.y) * (k / c.k) }
      apply(glide)
    },
    [apply],
  )

  // Drag to pan, pinch or wheel to zoom. A drag is not a click: the kanji
  // under a pointer that moved does not open.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ptrs = new Map<number, { x: number; y: number }>()
    let moved = 0
    let pinch = 0
    const local = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if ((e.target as HTMLElement).closest('.gx-bar, .map-zoom')) return
      ptrs.set(e.pointerId, local(e))
      if (ptrs.size === 1) moved = 0
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
        moved = 99
      }
    }
    const onMove = (e: PointerEvent) => {
      const prev = ptrs.get(e.pointerId)
      if (!prev) return
      const p = local(e)
      ptrs.set(e.pointerId, p)
      if (ptrs.size === 1) {
        moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)
        if (moved < 4) return
        cam.current = { ...cam.current, x: cam.current.x + p.x - prev.x, y: cam.current.y + p.y - prev.y }
        apply()
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        cam.current = { ...cam.current, x: cam.current.x + (p.x - prev.x) / 2, y: cam.current.y + (p.y - prev.y) / 2 }
        if (pinch > 0) zoomAt(dist / pinch, mx, my)
        pinch = dist
      }
    }
    const onUp = (e: PointerEvent) => {
      ptrs.delete(e.pointerId)
      pinch = 0
    }
    const onClick = (e: MouseEvent) => {
      if (moved >= 4 && !(e.target as HTMLElement).closest('.gx-bar, .map-zoom')) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      zoomAt(Math.exp(-e.deltaY * 0.0016), p.x, p.y)
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    el.addEventListener('click', onClick, true)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('wheel', onWheel)
    }
  }, [apply, zoomAt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') onClose(char)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [char, onClose])

  const name = (k: number) => data!.clusters[k][lang === 'bg' ? 'bg' : 'en']
  const meaningOf = (i: number) => (lang === 'bg' && data!.meaningBg[i] ? data!.meaningBg[i] : data!.meaning[i])
  const zoomCentre = (f: number) => size && zoomAt(f, size.w / 2, topOf(size.w) + (size.h - topOf(size.w) - BOTTOM) / 2, true)

  return (
    <div className="gx" ref={ref}>
      <div className="gx-world" ref={worldRef}>
        {view?.blobs.map((b) => (
          <div
            key={`disc-${b.k}`}
            className="gx-disc"
            data-stage={b.stage}
            style={{ width: 2 * b.r, height: 2 * b.r, transform: `translate(${b.x - b.r}px, ${b.y - b.r}px)` }}
          />
        ))}
        {view?.nodes.map((n) => (
          <button
            key={data!.chars[n.i]}
            className="gx-node"
            data-stage={n.stage}
            data-start={data!.chars[n.i] === char || undefined}
            style={{ transform: `translate(${n.x}px, ${n.y}px)` }}
            title={t('open', { c: data!.chars[n.i] })}
            onClick={() => onOpen(data!.chars[n.i])}
          >
            <span className="gx-glyph" lang="ja" style={{ fontSize: n.fs }}>
              {data!.chars[n.i]}
            </span>
            <span className="gx-meaning">{meaningOf(n.i)}</span>
          </button>
        ))}
        {view?.blobs.map((b) => (
          <div key={`name-${b.k}`} className="gx-label" style={{ transform: `translate(${b.x}px, ${b.y - b.r - 8}px)` }}>
            {b.stage === 3 ? (
              <span className="gx-name" data-stage={3}>
                {name(b.k)}
              </span>
            ) : (
              <button
                className="gx-name"
                data-stage={b.stage}
                title={t('explore', { name: name(b.k) })}
                onClick={() => setTrail((tr) => [...(tr.length ? tr : [start]), b.k])}
              >
                {name(b.k)}
                {b.hidden > 0 && <span className="gx-more">{t('more', { n: b.hidden })}</span>}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="gx-bar">
        <button className="gx-back" onClick={() => setTrail((tr) => tr.slice(0, -1))} disabled={trail.length < 2} aria-label={t('back')} title={t('back')}>
          ←
        </button>
        <span className="gx-title">{t('title')}</span>
        <span className="gx-current">{data && centre >= 0 ? name(centre) : ''}</span>
        <button className="see-components gx-similar" aria-pressed={similar} onClick={() => setSimilar((v) => !v)} disabled={!view}>
          {t(similar ? 'similarOff' : 'similar')}
        </button>
        <button className="gx-x" onClick={() => onClose(char)} aria-label={t('close')} title={t('close')}>
          ×
        </button>
      </div>

      <div className="map-zoom" role="group" aria-label={t('zoom')}>
        <button onClick={() => zoomCentre(1.6)} aria-label={t('zoomIn')} title={t('zoomIn')}>
          +
        </button>
        <button onClick={() => zoomCentre(1 / 1.6)} aria-label={t('zoomOut')} title={t('zoomOut')}>
          −
        </button>
        <button onClick={() => fit(true)} aria-label={t('whole')} title={t('whole')}>
          ⤢
        </button>
      </div>

      <p className="map-status gx-legend" role="status">
        {failed ? t('error') : !view ? t('loading') : similar ? t('legendSimilar') : t('legend')}
      </p>
    </div>
  )
}
