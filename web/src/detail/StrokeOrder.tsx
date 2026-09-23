/**
 * Stroke-order diagram: one small glyph per stroke, each adding the next.
 *
 * Static rather than animated -- you can read the whole order at a glance and
 * compare two strokes side by side, which a single animating glyph does not let
 * you do. KanjiVG draws every character on the same 109x109 canvas, so these
 * tile without any per-glyph scaling.
 */
import { strings, useLang } from '../i18n'

const S = strings(
  { title: 'Stroke order', stroke: '{char} stroke {n}' },
  { title: 'Ред на чертите', stroke: '{char}, черта {n}' },
)

interface Props {
  char: string
  strokes: string[]
}

const BOX = 109

export function StrokeOrder({ char, strokes }: Props) {
  const t = S(useLang())
  if (strokes.length === 0) return null

  return (
    <div className="strokes">
      <h3>
        {t('title')} <span className="strokes-count">{strokes.length}</span>
      </h3>
      <ol>
        {strokes.map((_, i) => (
          <li key={i}>
            <svg viewBox={`0 0 ${BOX} ${BOX}`} role="img" aria-label={t('stroke', { char, n: i + 1 })}>
              {/* Strokes already written stay quiet; the new one leads. */}
              <g className="done">
                {strokes.slice(0, i).map((d, j) => (
                  <path key={j} d={d} />
                ))}
              </g>
              <path className="new" d={strokes[i]} />
            </svg>
          </li>
        ))}
      </ol>
    </div>
  )
}
