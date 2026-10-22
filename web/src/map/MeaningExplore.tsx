/**
 * Explore by meaning: one kanji in the middle and its nearest kanji in meaning
 * round it (Dani, 2026-10-22). Nearer in meaning sits closer, more frequent is
 * bigger, and kanji in the middle one's group are bright. Clicking one puts it
 * in the middle, so the view is a walk; the trail above leads back.
 *
 * The neighbours come from the meaning vectors themselves
 * (pipeline/meaning_map.py explore), not from the map, whose plane keeps only
 * about half of each kanji's nearest. Their angles keep kanji alike in meaning
 * on the same side; here they are only spread, so none crowd together.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type NearResponse } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    title: 'Explore by meaning',
    back: 'Back',
    open: 'See in Dictionary',
    close: 'Back to the map (Esc)',
    legend: 'Closer is nearer in meaning. Bigger is more frequent. Bright kanji are in its group.',
    loading: 'Finding the nearest kanji',
    absent: '{c} is not on this level’s map.',
    error: 'Could not load the nearest kanji.',
    centreTitle: 'Open {c} in the dictionary',
    nodeTitle: 'Put {c} in the middle',
  },
  {
    title: 'Разглеждане по значение',
    back: 'Назад',
    open: 'Вижте в речника',
    close: 'Обратно към картата (Esc)',
    legend: 'По-близките са по-близки по значение. По-големите са по-чести. Светлите канджи са от групата му.',
    loading: 'Търсене на най-близките канджи',
    absent: '{c} не е на картата за това ниво.',
    error: 'Най-близките канджи не се заредиха.',
    centreTitle: 'Отворете {c} в речника',
    nodeTitle: 'Поставете {c} в средата',
  },
)

/** The trail keeps this many kanji on screen; older ones are still a Back away. */
const TRAIL_SHOWN = 6
/**
 * Room for the bar above and the legend below, in px. Under NARROW the level
 * filter takes the top row, and the bar goes below it (theme.css, .explore).
 */
const NARROW = 880
const topOf = (w: number) => (w < NARROW ? 108 : 64)
const BOTTOM = 56
/** Half a meaning label's width: how near a kanji may come to the sides. */
const HALF_LABEL = 52
/** How much of a raw angle survives the spreading: the rest is an even share of the circle. */
const ANGLE_KEEP = 0.5
const CENTRE_PX = 76

interface Placed {
  x: number
  y: number
  /** glyph size in px */
  fs: number
}

/** Glyph size by newspaper frequency, as the map sizes them: rank 1 is largest. */
function glyphPx(freq: number | null): number {
  return freq ? 20 + 20 * Math.max(0, 1 - Math.log(freq) / Math.log(2600)) : 18
}

/**
 * The neighbours on an ellipse round the middle: the nearest on the inner
 * edge, the least near on the outer. The angles keep their order, half spread
 * evenly, then a few passes push apart any that still overlap.
 */
function place(d: NearResponse, w: number, h: number): Map<string, Placed> {
  const out = new Map<string, Placed>()
  const TOP = topOf(w)
  const cx = w / 2
  const cy = TOP + (h - TOP - BOTTOM) / 2
  out.set(d.centre.char, { x: cx, y: cy, fs: CENTRE_PX })
  const n = d.near.length
  if (!n) return out
  const ry = Math.max(80, (h - TOP - BOTTOM) / 2 - 36)
  const rx = Math.max(80, Math.min(w / 2 - 56, ry * 1.7))
  const sims = d.near.map((e) => e.sim)
  const hi = Math.max(...sims)
  const lo = Math.min(...sims)

  const order = d.near.map((e, i) => ({ e, i, a: e.angle })).sort((p, q) => p.a - q.a)
  const nodes = order.map(({ e, a }, j) => {
    const even = order[0].a + (j * 360) / n
    const ang = ((ANGLE_KEEP * a + (1 - ANGLE_KEEP) * even) * Math.PI) / 180
    const t = hi > lo ? (hi - e.sim) / (hi - lo) : 0.5
    const r = 0.42 + 0.58 * t
    const fs = glyphPx(e.freq)
    return { char: e.char, x: cx + Math.cos(ang) * rx * r, y: cy + Math.sin(ang) * ry * r, fs, rho: Math.max(fs + 14, 66) / 2 }
  })

  // Overlaps: push each pair apart along the line between them, and off the middle.
  const centreRho = 64
  for (let pass = 0; pass < 80; pass++) {
    for (let a = 0; a < nodes.length; a++) {
      const p = nodes[a]
      for (let b = a + 1; b < nodes.length; b++) {
        const q = nodes[b]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const dist = Math.hypot(dx, dy) || 0.01
        const gap = p.rho + q.rho - dist
        if (gap > 0) {
          const ux = (dx / dist) * gap * 0.5
          const uy = (dy / dist) * gap * 0.5
          p.x -= ux
          p.y -= uy
          q.x += ux
          q.y += uy
        }
      }
      const dx = p.x - cx
      const dy = p.y - cy
      const dist = Math.hypot(dx, dy) || 0.01
      if (dist < centreRho + p.rho) {
        p.x = cx + (dx / dist) * (centreRho + p.rho)
        p.y = cy + (dy / dist) * (centreRho + p.rho)
      }
      p.x = Math.min(w - HALF_LABEL, Math.max(HALF_LABEL, p.x))
      p.y = Math.min(h - BOTTOM - p.rho / 2, Math.max(TOP + p.rho / 2, p.y))
    }
  }
  for (const p of nodes) out.set(p.char, { x: p.x, y: p.y, fs: p.fs })
  return out
}

export function MeaningExplore({
  scope,
  char,
  onClose,
  onOpen,
}: {
  scope: string
  /** where the walk starts; give a new one as a new key, which starts a new walk */
  char: string
  /** back to the map, given the kanji last in the middle */
  onClose: (char: string) => void
  onOpen: (char: string) => void
}) {
  const lang = useLang()
  const t = S(lang)
  const [trail, setTrail] = useState([char])
  const centre = trail[trail.length - 1]
  const [data, setData] = useState<NearResponse | null>(null)
  const [failed, setFailed] = useState<null | 'absent' | 'error'>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // The view keeps the last middle until the next one's neighbours are in, so
  // the clicked kanji slides to the middle rather than the screen blanking.
  useEffect(() => {
    let stale = false
    setFailed(null)
    api.mapNear(scope, centre).then(
      (d) => !stale && setData(d),
      (e: unknown) => !stale && setFailed((e as { status?: number }).status === 404 ? 'absent' : 'error'),
    )
    return () => {
      stale = true
    }
  }, [scope, centre])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') onClose(centre)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [centre, onClose])

  const shown = data && size ? data : null
  const at = shown ? place(shown, size!.w, size!.h) : null
  const group = shown?.centre.group ?? null
  const meaningOf = (k: { meaning: string; meaningBg: string }) => (lang === 'bg' && k.meaningBg ? k.meaningBg : k.meaning)
  const nodes = shown ? [shown.centre, ...shown.near] : []
  const TOP = size ? topOf(size.w) : 0
  const ring = (f: number) =>
    size && {
      rx: Math.max(80, Math.min(size.w / 2 - 56, Math.max(80, (size.h - TOP - BOTTOM) / 2 - 36) * 1.7)) * f,
      ry: Math.max(80, (size.h - TOP - BOTTOM) / 2 - 36) * f,
    }

  return (
    <div className="explore" ref={ref}>
      {size && (
        <svg className="explore-rings" width={size.w} height={size.h} aria-hidden>
          {[0.42, 1].map((f) => {
            const r = ring(f)!
            return <ellipse key={f} cx={size.w / 2} cy={TOP + (size.h - TOP - BOTTOM) / 2} rx={r.rx} ry={r.ry} />
          })}
        </svg>
      )}

      <div className="explore-bar">
        <span className="explore-title">{t('title')}</span>
        <button className="explore-back" onClick={() => setTrail((tr) => tr.slice(0, -1))} disabled={trail.length < 2} aria-label={t('back')} title={t('back')}>
          ←
        </button>
        <ol className="explore-trail">
          {trail.slice(-TRAIL_SHOWN).map((c, j, shownTrail) => {
            const last = j === shownTrail.length - 1
            const index = trail.length - shownTrail.length + j
            return (
              <li key={index}>
                <button lang="ja" aria-current={last || undefined} disabled={last} onClick={() => setTrail((tr) => tr.slice(0, index + 1))}>
                  {c}
                </button>
              </li>
            )
          })}
        </ol>
        <button className="see-components explore-open" onClick={() => onOpen(centre)}>
          {t('open')}
        </button>
        <button className="explore-x" onClick={() => onClose(centre)} aria-label={t('close')} title={t('close')}>
          ×
        </button>
      </div>

      {at &&
        nodes.map((k) => {
          const p = at.get(k.char)
          if (!p) return null
          const middle = k.char === shown!.centre.char
          const kin = !middle && group !== null && k.group?.en === group.en
          return (
            <button
              key={k.char}
              className="explore-node"
              data-middle={middle || undefined}
              data-kin={kin || undefined}
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              title={t(middle ? 'centreTitle' : 'nodeTitle', { c: k.char })}
              onClick={() => (middle ? onOpen(k.char) : setTrail((tr) => [...tr, k.char]))}
            >
              <span className="explore-glyph" lang="ja" style={{ fontSize: p.fs }}>
                {k.char}
              </span>
              <span className="explore-meaning">{meaningOf(k)}</span>
              {middle && <span className="explore-group">{group ? group[lang === 'bg' ? 'bg' : 'en'] : ''}</span>}
            </button>
          )
        })}

      <p className="map-status explore-legend" role="status">
        {failed === 'absent'
          ? t('absent', { c: centre })
          : failed === 'error'
            ? t('error')
            : !shown || shown.centre.char !== centre
              ? t('loading')
              : t('legend')}
      </p>
    </div>
  )
}
