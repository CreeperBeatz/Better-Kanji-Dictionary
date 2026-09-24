import { forwardRef } from 'react'
import type { KanjiNode } from '../api'
import { levelOf } from '../detail/DetailPanel'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'

const HALF_WIDTH = 130

const S = strings(
  { none: 'no recorded meaning', on: 'On', kun: 'Kun', strokes: 'Strokes', level: 'Level' },
  { none: 'няма записано значение', on: 'Он', kun: 'Кун', strokes: 'Черти', level: 'Ниво' },
)

interface Props {
  node: KanjiNode
  x: number
  y: number
  width: number
  /** Below the finger rather than above, when above is where the peek opens. */
  below: boolean
  openLabel: string
  onOpen: () => void
}

/**
 * What a touch screen shows when a character is tapped: the same facts a
 * mouse gets by hovering, which on a wide screen land in the rail, and the
 * way to its page. Placed off the finger so the finger does not cover it.
 */
export const HoldCard = forwardRef<HTMLDivElement, Props>(function HoldCard(
  { node, x, y, width, below, openLabel, onOpen },
  ref,
) {
  const lang = useLang()
  const t = S(lang)
  const [lead, ...rest] = meaningsOf(node, lang).value
  const left = Math.min(Math.max(x, HALF_WIDTH + 8), Math.max(HALF_WIDTH + 8, width - HALF_WIDTH - 8))
  return (
    <div
      ref={ref}
      className="hold-card"
      data-below={below || undefined}
      style={{ left, top: below ? y + 28 : y - 28 }}
      role="dialog"
      aria-label={node.char}
    >
      <div className="hold-card-head">
        <span className="hold-card-glyph">{node.char}</span>
        <p>
          {lead ?? t('none')}
          {rest.length > 0 && <span> {rest.slice(0, 3).join(', ')}</span>}
        </p>
      </div>
      <dl>
        {node.onYomi.length > 0 && (
          <>
            <dt>{t('on')}</dt>
            <dd className="yomi">{node.onYomi.slice(0, 3).join('  ')}</dd>
          </>
        )}
        {node.kunYomi.length > 0 && (
          <>
            <dt>{t('kun')}</dt>
            <dd className="yomi">{node.kunYomi.slice(0, 3).join('  ')}</dd>
          </>
        )}
        {node.strokes != null && (
          <>
            <dt>{t('strokes')}</dt>
            <dd>{node.strokes}</dd>
          </>
        )}
        <dt>{t('level')}</dt>
        <dd>{levelOf(node, lang)}</dd>
      </dl>
      <button className="see-components hold-card-open" onClick={onOpen}>
        {openLabel}
      </button>
    </div>
  )
})
