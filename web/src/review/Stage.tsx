/**
 * One step of a card (Dani, 2026-10-08): framed apart from the others, with a
 * big numbered title. The title folds and unfolds it; "Done" at its bottom
 * folds it and brings the next step into view. Folded, it shows a line of
 * what it holds. Folding only hides: nothing is decided by it.
 */
import { useRef, useState, type ReactNode } from 'react'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    done: 'Done: collapse this step',
    open: 'Open this step',
    fold: 'Collapse this step',
  },
  {
    done: 'Готово: свийте тази стъпка',
    open: 'Отворете тази стъпка',
    fold: 'Свийте тази стъпка',
  },
)

export function Stage({ n, title, summary, children }: { n: number; title: ReactNode; summary?: ReactNode; children: ReactNode }) {
  const t = S(useLang())
  const [shut, setShut] = useState(false)
  const root = useRef<HTMLElement>(null)
  function done() {
    setShut(true)
    // The step folds where it is; the next one comes up under it.
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  return (
    <section ref={root} className="review-step" data-n={n} data-shut={shut || undefined}>
      <header className="review-step-head">
        <button type="button" className="review-step-toggle" aria-expanded={!shut} title={t(shut ? 'open' : 'fold')} onClick={() => setShut((s) => !s)}>
          <span className="review-step-n">{n}</span>
          <span className="review-step-title">{title}</span>
          <span className="review-step-caret" aria-hidden>
            {shut ? '▸' : '▾'}
          </span>
        </button>
        {shut && summary && <span className="hint review-step-summary">{summary}</span>}
      </header>
      {!shut && (
        <>
          <div className="review-step-body">{children}</div>
          <button type="button" className="clear review-step-done" onClick={done}>
            ▴ {t('done')}
          </button>
        </>
      )}
    </section>
  )
}
