import { useCallback, useEffect, useState } from 'react'
import { api, type GraphResponse, type ReviewItem } from '../api'

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
      <h2>Its parts</h2>

      <p className="hint">
        cjk-decomp is mechanically right and sometimes useless. Correct {char} here and the
        graph follows.
      </p>

      <div className="decomp-edit">
        <input
          className="search-input decomp-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label={`Components of ${char}`}
        />
        <button className="clear" onClick={apply} disabled={!changed || busy}>
          {busy ? 'saving' : 'use this'}
        </button>
        <button className="clear" onClick={revert} disabled={busy}>
          reset
        </button>
      </div>

      <p className="assoc-actions">
        <button className="clear" onClick={() => setOpen((o) => !o)}>
          {open ? 'hide the review queue' : 'what else needs fixing'}
        </button>
      </p>

      {open && (
        <ol className="review">
          {queue === null && <li className="hint">loading</li>}
          {queue?.length === 0 && <li className="hint">Nothing flagged.</li>}
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
