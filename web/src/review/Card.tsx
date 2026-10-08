/**
 * The one layout of every review card (Dani, 2026-10-08): characters,
 * meanings, which kanji, Bulgarian and reports draw through it, so they look
 * and read the same.
 *
 *   ReviewCard  the frame: the head, the other dictionaries on top (in night
 *               colours, folded), the card's numbered steps (Stage.tsx), the
 *               footer
 *   CardHead    the subject big; under it what to know about the card (a
 *               person's suggestion, an old form, "Something else is wrong?");
 *               on the right research and the dictionaries
 *   CardFooter  what saving will do, "+ add a reason", what went wrong, the
 *               buttons
 */
import { useState, type ReactNode } from 'react'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    summary: 'Saving will:',
    reason: 'Reason (optional)',
    addReason: 'add a reason',
  },
  {
    summary: 'Записването ще:',
    reason: 'Причина (по желание)',
    addReason: 'добавете причина',
  },
)

export function ReviewCard({ className, head, dicts, children }: { className?: string; head: ReactNode; dicts?: ReactNode; children: ReactNode }) {
  return (
    <article className={`queue-item review-card${className ? ` ${className}` : ''}`}>
      {head}
      {dicts && <div className="card-dicts">{dicts}</div>}
      <div className="queue-decide">{children}</div>
    </article>
  )
}

export function CardHead({ glyph, notes, actions }: { glyph: ReactNode; notes?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="queue-head">
      <span className="queue-big" lang="ja">
        {glyph}
      </span>
      <div>{notes}</div>
      <div className="queue-dict card-head-pills">{actions}</div>
    </header>
  )
}

/**
 * Mount it anew for each card (a `key`), so the reason field starts closed.
 * `summary`: what saving will do, a sentence each. `before`: warnings above
 * the buttons. `actions`: the buttons, the main one first.
 */
export function CardFooter({
  summary,
  reason,
  onReason,
  problem,
  before,
  actions,
}: {
  summary?: string[]
  reason: string
  onReason: (r: string) => void
  problem?: string | null
  before?: ReactNode
  actions: ReactNode
}) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  return (
    <footer className="card-foot">
      {summary && summary.length > 0 && (
        <div className="card-summary">
          <h5>{t('summary')}</h5>
          <ul>
            {summary.map((s, i) => (
              <li key={i} lang="ja">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open || reason ? (
        <label className="review-field">
          <span>{t('reason')}</span>
          <input className="assoc-text" value={reason} maxLength={500} autoFocus={open && !reason} onChange={(e) => onReason(e.target.value)} />
        </label>
      ) : (
        <button type="button" className="clear queue-add-reason" onClick={() => setOpen(true)}>
          + {t('addReason')}
        </button>
      )}
      {problem && <p className="account-problem">{problem}</p>}
      {before}
      <div className="queue-actions">{actions}</div>
    </footer>
  )
}
