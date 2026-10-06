/**
 * The old forms (Unihan's kJapaneseOldVariant: 舊 for 旧), checked as one
 * list, a page at a time, not a card each: most are right, and the reviewer
 * only has to catch the odd one. Every row starts ticked ("right"); untick a
 * row and say what the two are instead. Saving decides the whole page
 * (server/review.py old_forms, decide_old_forms).
 */
import { useCallback, useEffect, useState } from 'react'
import { api, dataChanged, type FormKind, type FormLink, type OldFormRow } from '../api'
import { errorText } from '../i18n/errors'
import { strings, useLang } from '../i18n'
import { FORM_KINDS, KindsInfoButton, KindsTable, useKindsInfo, useLinkSentence } from './KindsInfo'

const S = strings(
  {
    title: 'Old forms',
    intro: 'Each row says: the second character is the old form of the first. The old form is the shape before the 1946 reform. Untick a row that is wrong, and select what the two are instead. Save checks the whole page.',
    right: 'Right',
    instead: 'Instead:',
    note: 'Note: why (optional)',
    compat: 'A font difference only (D-017): most fonts draw both the same.',
    usedIn: 'in {n} kanji:',
    save: 'Save this page: {ok} right, {bad} changed',
    left: '{n} left',
    loading: 'loading',
    done: 'All old forms are checked.',
  },
  {
    title: 'Стари форми',
    intro: 'Всеки ред казва: вторият знак е старата форма на първия. Старата форма е формата преди реформата от 1946 г. Махнете отметката на грешен ред и изберете какво са двата знака всъщност. „Запазване“ проверява цялата страница.',
    right: 'Вярно',
    instead: 'Всъщност:',
    note: 'Бележка: защо (по желание)',
    compat: 'Само разлика в шрифта (D-017): повечето шрифтове рисуват двата еднакво.',
    usedIn: 'в {n} канджи:',
    save: 'Запазване на страницата: {ok} верни, {bad} променени',
    left: 'остават {n}',
    loading: 'зареждане',
    done: 'Всички стари форми са проверени.',
  },
)

/** A row unticked: what the two are instead. */
type Change = { kind: FormKind; note: string }

export function OldFormsList({ onSaved, onDone, onKanji }: { onSaved: () => void; onDone: () => void; onKanji?: (c: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const sentence = useLinkSentence()
  const [info, toggleInfo] = useKindsInfo()
  const [rows, setRows] = useState<OldFormRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [changes, setChanges] = useState<Record<string, Change>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    setRows(null)
    setChanges({})
    api.reviewOldForms().then(
      (d) => {
        setRows(d.items)
        setTotal(d.total)
        if (!d.items.length) onDone()
      },
      (e) => setProblem(errorText(e, lang)),
    )
  }, [lang, onDone])
  useEffect(load, [])

  async function save() {
    if (!rows || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await api.decideOldForms(
        rows.map((r) => {
          const c = changes[r.id]
          if (!c) return { item: r.id, action: 'keep' as const }
          const value: FormLink = { kind: c.kind, note: c.note.trim() || null }
          return { item: r.id, action: 'edit' as const, value }
        }),
      )
      if (Object.keys(changes).length) dataChanged()
      onSaved()
      load()
    } catch (e) {
      setProblem(errorText(e, lang))
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <p className="hint">{problem ?? t('loading')}</p>
  if (!rows.length) return <p className="hint">{t('done')}</p>
  const bad = Object.keys(changes).length
  return (
    <article className="queue-item old-forms">
      <header className="queue-head">
        <div>
          <h3>
            {t('title')} <KindsInfoButton open={info} onToggle={toggleInfo} />
          </h3>
          <p className="hint">{t('intro')}</p>
          <p className="tally">{t('left', { n: total })}</p>
        </div>
      </header>
      {info && <KindsTable of="form" />}
      <ol className="old-forms-rows">
        {rows.map((r) => {
          const [a, b] = r.subject.split('|')
          const c = changes[r.id]
          const set = (patch: Partial<Change> | null) =>
            setChanges((all) => {
              const next = { ...all }
              if (patch === null) delete next[r.id]
              else next[r.id] = { ...(all[r.id] ?? { kind: 'none', note: '' }), ...patch }
              return next
            })
          return (
            <li key={r.id} className="old-forms-row" data-changed={c ? true : undefined}>
              <label className="old-forms-tick">
                <input type="checkbox" aria-label={t('right')} checked={!c} onChange={(e) => set(e.target.checked ? null : {})} />
                
              </label>
              <span className="old-forms-pair" lang="ja">
                <button type="button" className="clear" onClick={() => onKanji?.(a)}>{a}</button>
                <span className="old-forms-arrow" aria-hidden>←</span>
                <button type="button" className="clear" onClick={() => onKanji?.(b)}>{b}</button>
              </span>
              <span className="old-forms-what">
                <span lang="ja">{sentence(r.current.kind, r.subject, r.current.reverse)}</span>
                {r.compat && <span className="hint old-forms-compat"> · {t('compat')}</span>}
                {r.inScope > 0 && (
                  <span className="hint">
                    {' '}
                    · {t('usedIn', { n: r.inScope })} <span lang="ja">{r.users.join(' ')}</span>
                  </span>
                )}
                {c && (
                  <span className="old-forms-instead">
                    {t('instead')}{' '}
                    <select value={c.kind} onChange={(e) => set({ kind: e.target.value as FormKind })}>
                      {FORM_KINDS.filter((k) => k !== 'old').map((k) => (
                        <option key={k} value={k}>
                          {sentence(k, r.subject)}
                        </option>
                      ))}
                    </select>{' '}
                    <input type="text" className="old-forms-note" placeholder={t('note')} value={c.note} onChange={(e) => set({ note: e.target.value })} />
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {problem && <p className="account-problem">{problem}</p>}
      <div className="queue-actions">
        <button className="account-submit" disabled={busy} onClick={save}>
          {t('save', { ok: rows.length - bad, bad })}
        </button>
      </div>
    </article>
  )
}
