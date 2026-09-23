import { useCallback, useEffect, useState } from 'react'
import { api, type GraphResponse, type ReviewItem } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    title: 'Its parts',
    hint: 'cjk-decomp is mechanically right and sometimes useless. Correct {c} here and the graph follows.',
    components: 'Components of {c}',
    saving: 'saving',
    use: 'use this',
    reset: 'reset',
    hideQueue: 'hide the review queue',
    showQueue: 'what else needs fixing',
    loading: 'loading',
    nothing: 'Nothing flagged.',
  },
  {
    title: 'Части',
    hint: 'cjk-decomp е механично вярно, но понякога безполезно. Поправете {c} тук и графът ще го последва.',
    components: 'Части на {c}',
    saving: 'запазване',
    use: 'използвайте това',
    reset: 'нулирайте',
    hideQueue: 'скрийте опашката за преглед',
    showQueue: 'какво още трябва да се поправи',
    loading: 'зареждане',
    nothing: 'Нищо не е отбелязано.',
  },
)

interface Props {
  data: GraphResponse
  onPick: (char: string) => void
  onChanged: () => void
}

/**
 * Fix the decomposition you are looking at, and find the next one worth fixing.
 *
 * FINDINGS.md calls hand-review of cjk-decomp "where the real effort lives", so
 * this sits next to the graph rather than in a separate tool: correct a split
 * while you are already looking at it, and the graph redraws.
 */
export function DecompPanel({ data, onPick, onChanged }: Props) {
  const t = S(useLang())
  const char = data.focus.char
  const direct = data.components.nodes.filter((n) => n.depth === 1).map((n) => n.char)

  const [draft, setDraft] = useState(direct.join(''))
  const [open, setOpen] = useState(false)
  const [queue, setQueue] = useState<ReviewItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setDraft(direct.join('')), [char, direct.join('')])

  const loadQueue = useCallback(() => {
    api.reviewQueue(30).then(
      (d) => setQueue(d.items),
      () => setQueue([]),
    )
  }, [])

  useEffect(() => {
    if (open && queue === null) loadQueue()
  }, [open, queue, loadQueue])

  const changed = draft !== direct.join('')

  async function apply() {
    setBusy(true)
    try {
      await api.setDecomposition(char, [...draft].filter((c) => c.trim()))
      onChanged()
      loadQueue()
    } finally {
      setBusy(false)
    }
  }

  async function revert() {
    setBusy(true)
    try {
      await api.clearDecomposition(char)
      onChanged()
      loadQueue()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rail-section">
      <h2>{t('title')}</h2>

      <p className="hint">{t('hint', { c: char })}</p>

      <div className="decomp-edit">
        <input
          className="search-input decomp-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label={t('components', { c: char })}
        />
        <button className="clear" onClick={apply} disabled={!changed || busy}>
          {busy ? t('saving') : t('use')}
        </button>
        <button className="clear" onClick={revert} disabled={busy}>
          {t('reset')}
        </button>
      </div>

      <p className="assoc-actions">
        <button className="clear" onClick={() => setOpen((o) => !o)}>
          {open ? t('hideQueue') : t('showQueue')}
        </button>
      </p>

      {open && (
        <ol className="review">
          {queue === null && <li className="hint">{t('loading')}</li>}
          {queue?.length === 0 && <li className="hint">{t('nothing')}</li>}
          {queue?.map((it) => (
            <li key={it.char}>
              <button className="review-glyph" onClick={() => onPick(it.char)}>
                {it.char}
              </button>
              <span className="review-why">{it.reasons.join(', ')}</span>
              <span className="review-freq">{it.freq ?? '—'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
