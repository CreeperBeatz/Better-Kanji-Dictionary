/**
 * The Similar view: one character, what looks like it above; below, what
 * shares its reading on the left and what means much the same on the right --
 * apart, because writing 速 for 早 and mixing up 側 and 横 are different
 * mistakes. Closest first in all three. Click one to move there, so
 * you can walk a chain of lookalikes (己 -> 已 -> 巳) the way the focus view
 * walks containers.
 *
 * Hovering a lookalike -- or holding it, on a touch screen -- shows the two
 * side by side with the strokes that tell them apart lit (compare.ts).
 *
 * The whole thing fits the stage, so there is no pan or zoom: at most a few
 * dozen characters, laid out once per focus.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type KanjiNode, type SimilarResponse } from '../api'
import { keeps, type ContainerFilter } from '../graph/KanjiGraph'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { strokeDiff } from './compare'
import { FOCUS_RADIUS, layoutSimilar, type Placed } from './layout'
import { whyText } from './why'

const S = strings(
  {
    looksLike: 'looks like',
    readsLike: 'same reading',
    meansLike: 'similar meaning',
    otherForms: 'other forms',
    loading: 'Finding what looks and means alike…',
    failed: 'Could not load what is similar to {char}.',
    nothing: 'Nothing similar at this level.',
    tryAll: 'Show all',
    legendAbove: 'above, characters that look like it, the most alike nearest',
    legendBelow: 'below left, characters that share its reading, with the words written with either; below right, characters that mean much the same',
    legendHover: 'hover one above to see which strokes tell the two apart',
    apart: 'what tells them apart',
    same: 'no stroke tells them apart on paper; the difference is in proportion',
  },
  {
    looksLike: 'прилича на',
    readsLike: 'същото четене',
    meansLike: 'сходно значение',
    otherForms: 'други форми',
    loading: 'Търсим какво прилича и какво означава същото…',
    failed: 'Не успяхме да заредим подобните на {char}.',
    nothing: 'Няма подобни на това ниво.',
    tryAll: 'Покажете всички',
    legendAbove: 'отгоре — йероглифите, които приличат на него, най-подобните най-близо',
    legendBelow: 'отдолу вляво — йероглифите със същото четене и думите, писани с всеки от двата; отдолу вдясно — йероглифите, които означават почти същото',
    legendHover: 'посочете някой отгоре, за да видите кои черти ги различават',
    apart: 'какво ги различава',
    same: 'никоя черта не ги различава; разликата е в пропорциите',
  },
)

const MAX_LOOK = 24
const MAX_READ = 8
const MAX_MEAN = 8
const HOLD_DELAY = 450

type Look = SimilarResponse['look'][number]

interface Props {
  focus: KanjiNode
  /** The focus's own strokes, for the comparison. */
  strokes: string[]
  filter: ContainerFilter
  onDrill: (char: string) => void
  /** The character under the pointer, for the rail to preview. */
  onHover: (node: KanjiNode | null) => void
  onFilter: (f: ContainerFilter) => void
  legend: boolean
}

export function SimilarView({ focus, strokes, filter, onDrill, onHover, onFilter, legend }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState<SimilarResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [over, setOver] = useState<Look | null>(null)
  const hold = useRef<{ timer?: number; shown: boolean }>({ shown: false })
  // Whether the stage is portrait, which changes the arcs (see layout.ts).
  const host = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  useEffect(() => {
    const el = host.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setTall(el.clientHeight > el.clientWidth * 1.25))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let stale = false
    setFailed(false)
    setOver(null)
    api.similar(focus.char).then(
      (d) => !stale && setData(d),
      () => !stale && setFailed(true),
    )
    return () => {
      stale = true
    }
  }, [focus.char])

  const ready = data?.char === focus.char ? data : null
  const layout = useMemo(() => {
    if (!ready) return null
    const keep = keeps(filter)
    return layoutSimilar(
      ready.look.filter(keep).slice(0, MAX_LOOK),
      ready.read.filter(keep).slice(0, MAX_READ),
      ready.mean.filter(keep).slice(0, MAX_MEAN),
      ready.variant,
      tall,
    )
  }, [ready, filter, tall])

  // The probe stays mounted through loading, so the stage's shape is known by the time the lists arrive.
  const probe = <div ref={host} hidden />
  if (failed)
    return (
      <>
        {probe}
        <p className="stage-empty hint">{t('failed', { char: focus.char })}</p>
      </>
    )
  if (!layout)
    return (
      <>
        {probe}
        <p className="stage-empty hint">{t('loading')}</p>
      </>
    )

  const { bounds: b } = layout
  const empty = !layout.looks.length && !layout.reads.length && !layout.means.length && !layout.variants.length

  const enter = (n: KanjiNode, look?: Look) => {
    onHover(n)
    setOver(look ?? null)
  }
  const leave = () => {
    onHover(null)
    setOver(null)
  }
  // Touch has no hover: pressing and holding a lookalike shows the comparison,
  // and letting go does not open it.
  const press = (e: React.PointerEvent, n: KanjiNode, look?: Look) => {
    hold.current.shown = false
    if (e.pointerType !== 'touch') return
    clearTimeout(hold.current.timer)
    hold.current.timer = window.setTimeout(() => {
      hold.current.shown = true
      enter(n, look)
    }, HOLD_DELAY)
  }
  const release = () => {
    clearTimeout(hold.current.timer)
    if (hold.current.shown) leave()
  }
  const pick = (c: string) => {
    if (hold.current.shown) {
      hold.current.shown = false
      return
    }
    onDrill(c)
  }

  const node = (p: Placed<KanjiNode>, kind: 'look' | 'read' | 'mean' | 'variant', extra?: React.ReactNode, look?: Look) => {
    const m = meaningsOf(p.node, lang).value
    return (
      <g
        key={`${kind}:${p.node.char}`}
        className="node similar-node"
        data-kind={kind}
        data-dim={!p.node.joyo}
        style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: 0.45 + p.weight * 0.55 }}
        onClick={() => pick(p.node.char)}
        onMouseEnter={() => enter(p.node, look)}
        onMouseLeave={leave}
        onPointerDown={(e) => press(e, p.node, look)}
        onPointerUp={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
        role="button"
        tabIndex={0}
        onFocus={() => enter(p.node, look)}
        onBlur={leave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onDrill(p.node.char)
          }
        }}
      >
        <title>
          {p.node.char}
          {m.length ? ` — ${m.slice(0, 3).join(', ')}` : ''}
        </title>
        <circle className="plate" r={p.radius} strokeWidth={0.75} />
        <text className="glyph" fontSize={p.radius * 1.28}>
          {p.node.char}
        </text>
        {extra}
      </g>
    )
  }

  return (
    <>
      {probe}
      <svg
        className="graph-svg similar-svg"
        viewBox={`${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* A character can be in two lists -- 合 looks like 会 and reads あう too. */}
        {(
          [
            ['look', layout.looks],
            ['read', layout.reads],
            ['mean', layout.means],
          ] as const
        ).flatMap(([kind, items]) =>
          items.map((p) => (
            <line key={`e:${kind}:${p.node.char}`} className="edge similar-edge" x1={0} y1={0} x2={p.x} y2={p.y} />
          )),
        )}

        {(
          [
            ['look', layout.looks, 'looksLike'],
            ['read', layout.reads, 'readsLike'],
            ['mean', layout.means, 'meansLike'],
          ] as const
        ).map(([kind, items, key]) => {
          if (!items.length) return null
          const at = layout.labels[kind]
          return (
            <text key={kind} className="similar-label" x={at.x} y={at.y} textAnchor="middle">
              {t(key)}
            </text>
          )
        })}
        {layout.variants.length > 0 && (
          <text
            className="similar-label"
            x={layout.variants[0].x - 22}
            y={layout.variants[layout.variants.length - 1].y + 44}
          >
            {t('otherForms')}
          </text>
        )}

        {layout.looks.map((p) => node(p, 'look', undefined, p.node))}
        {[...layout.reads.map((p) => ['read', p] as const), ...layout.means.map((p) => ['mean', p] as const)].map(([kind, p]) => {
          const why = whyText(p.node.why, lang, true)
          const gloss = (meaningsOf(p.node, lang).value[0] ?? '').toLowerCase()
          return node(
            p,
            kind,
            <>
              <text className="similar-meaning" y={p.radius + 12}>
                {gloss.length > 16 ? `${gloss.slice(0, 15)}…` : gloss}
              </text>
              {why && (
                <text className="similar-why-label" y={p.radius + 26}>
                  {why.length > 18 ? `${why.slice(0, 17)}…` : why}
                </text>
              )}
            </>,
          )
        })}
        {layout.variants.map((p) => node(p, 'variant'))}

        <g className="node" data-kind="focus" style={{ transform: 'translate(0px, 0px)' }}>
          <circle className="plate" r={FOCUS_RADIUS} strokeWidth={1} />
          <circle className="seal" r={FOCUS_RADIUS + 7} />
          <text className="glyph" fontSize={FOCUS_RADIUS * 1.28}>
            {focus.char}
          </text>
        </g>
      </svg>

      {empty && (
        <div className="similar-empty">
          <p className="hint">{t('nothing')}</p>
          {filter !== 'all' && (
            <button className="see-components" onClick={() => onFilter('all')}>
              {t('tryAll')}
            </button>
          )}
        </div>
      )}

      {over && <Compare a={focus} aStrokes={strokes} b={over} />}

      {legend && (
        <p className="legend" id="stage-legend">
          {t('legendAbove')}
          <br />
          {t('legendBelow')}
          <br />
          {t('legendHover')}
        </p>
      )}
    </>
  )
}

/** The two characters drawn from their strokes, the differing strokes lit. */
function Compare({ a, aStrokes, b }: { a: KanjiNode; aStrokes: string[]; b: Look }) {
  const lang = useLang()
  const t = S(lang)
  const diff = useMemo(() => strokeDiff(aStrokes, b.paths), [aStrokes, b.paths])
  if (!aStrokes.length || !b.paths.length) return null
  const none = !diff.a.some(Boolean) && !diff.b.some(Boolean)
  const side = (n: KanjiNode, paths: string[], lit: boolean[]) => (
    <figure>
      <svg viewBox="0 0 109 109" aria-label={n.char}>
        {paths.map((d, i) => (
          <path key={i} d={d} data-lit={lit[i] || undefined} />
        ))}
      </svg>
      <figcaption>
        <span className="compare-char">{n.char}</span> {meaningsOf(n, lang).value.slice(0, 2).join(', ')}
      </figcaption>
    </figure>
  )
  return (
    <div className="compare-card" role="status">
      <p>{none ? t('same') : t('apart')}</p>
      <div className="compare-pair">
        {side(a, aStrokes, diff.a)}
        {side(b, b.paths, diff.b)}
      </div>
    </div>
  )
}
