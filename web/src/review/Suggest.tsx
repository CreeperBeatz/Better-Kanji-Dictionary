/**
 * "Suggest a change", from the page: a small form prefilled with what the
 * page shows now. A user's suggestion goes to the review queue with their
 * reason; a reviewer's or the admin's is simply made, live at once, and
 * logged like any other decision (Dani, 2026-10-02).
 */
import { useEffect, useState } from 'react'
import { api, dataChanged, type MeaningGroup, type TaskType, type TaskValue } from '../api'
import { useAuth } from '../account/auth'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { strokesOk, ValueEditor } from './editors'

const S = strings(
  {
    suggest: 'Suggest a change',
    edit: 'Change it',
    t_decomposition: 'The parts of {subject}',
    t_form_link: 'How {a} relates to another character',
    t_kanji_senses: 'The meaning groups of {subject}',
    t_word_sense: 'Which meaning of {a} this word uses',
    other: 'The other character',
    reason: 'Why?',
    reasonHint: 'What is wrong now, and how you know: the old form, a dictionary, a teacher.',
    reasonOptional: 'Why? (kept with the change)',
    send: 'send',
    save: 'save',
    cancel: 'cancel',
    close: 'close',
    sent: 'Thank you. A reviewer will look at it; you can see what became of it on your account page.',
    saved: 'Saved. It is live now, and logged.',
    signIn: 'Sign in to suggest a change.',
    logIn: 'log in',
    failed: 'could not send this',
  },
  {
    suggest: 'Предложете промяна',
    edit: 'Променете го',
    t_decomposition: 'Частите на {subject}',
    t_form_link: 'Как {a} се свързва с друг знак',
    t_kanji_senses: 'Групите значения на {subject}',
    t_word_sense: 'Кое значение на {a} използва тази дума',
    other: 'Другият знак',
    reason: 'Защо?',
    reasonHint: 'Какво не е наред сега и откъде знаете: старата форма, речник, учител.',
    reasonOptional: 'Защо? (пази се с промяната)',
    send: 'изпратете',
    save: 'запазете',
    cancel: 'отказ',
    close: 'затворете',
    sent: 'Благодарим. Рецензент ще го погледне; какво е станало, ще видите в профила си.',
    saved: 'Запазено. Вече е в сила и е записано.',
    signIn: 'Влезте, за да предложите промяна.',
    logIn: 'вход',
    failed: 'не можа да бъде изпратено',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

export interface SuggestTarget {
  type: TaskType
  /** For form_link, `a|b`, or `a|` to let the other character be typed. */
  subject: string
  value: TaskValue
  groups?: MeaningGroup[] | null
}

/** The link that opens the dialog: "suggest a change", or for a reviewer "change it". */
export function SuggestLink({ onOpen }: { onOpen: () => void }) {
  const t = S(useLang())
  const { user } = useAuth()
  return (
    <button className="clear suggest-link" onClick={onOpen}>
      {t(user && user.role !== 'user' ? 'edit' : 'suggest')}
    </button>
  )
}

export function SuggestDialog({
  target,
  onClose,
  onSignIn,
}: {
  target: SuggestTarget
  onClose: () => void
  /** Opens sign-in; without it the dialog only says to sign in. */
  onSignIn?: () => void
}) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  const direct = user !== null && user.role !== 'user'
  const [a, b0] = target.subject.split('|')
  const [other, setOther] = useState(b0 ?? '')
  const [value, setValue] = useState<TaskValue>(target.value)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<'sent' | 'saved' | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const subject = target.type === 'form_link' ? `${a}|${[...other.trim()][0] ?? ''}` : target.subject
  const title = t(`t_${target.type}` as Key, { subject: a, a })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (target.type === 'decomposition' && !strokesOk(value, lang)) return
    setBusy(true)
    setProblem(null)
    try {
      const res = direct
        ? await api.reviewEdit(target.type, subject, value, reason.trim() || undefined)
        : await api.suggest(target.type, subject, value, reason.trim())
      if (direct || ('applied' in res && res.applied)) {
        dataChanged()
        setDone('saved')
      } else setDone('sent')
    } catch (err) {
      setProblem(err instanceof Error ? errorText(err, lang) : t('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel account-panel suggest-panel" role="dialog" aria-modal="true" aria-label={title}>
        <button className="account-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
          ×
        </button>
        <h2>{title}</h2>
        {!user ? (
          <>
            <p className="hint">{t('signIn')}</p>
            <p className="assoc-actions">
              {onSignIn && (
                <button className="account-submit" onClick={onSignIn}>
                  {t('logIn')}
                </button>
              )}
              <button className="clear" onClick={onClose}>
                {t('close')}
              </button>
            </p>
          </>
        ) : done ? (
          <>
            <p className="hint">{t(done)}</p>
            <p className="assoc-actions">
              <button className="clear" onClick={onClose}>
                {t('close')}
              </button>
            </p>
          </>
        ) : (
          <form className="account-form" onSubmit={submit}>
            {target.type === 'form_link' && (
              <label className="review-field">
                <span>{t('other')}</span>
                <input className="assoc-text" lang="ja" value={other} maxLength={2} autoFocus={!b0} onChange={(e) => setOther(e.target.value)} />
              </label>
            )}
            <ValueEditor type={target.type} value={value} onChange={setValue} groups={target.groups} char={a} autoFocus={target.type !== 'form_link'} />
            <label className="review-field">
              <span>{direct ? t('reasonOptional') : t('reason')}</span>
              <textarea className="assoc-text" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              {!direct && <span className="hint">{t('reasonHint')}</span>}
            </label>
            {problem && <p className="account-problem">{problem}</p>}
            <div className="account-row profile-save">
              <button type="button" className="clear" onClick={onClose}>
                {t('cancel')}
              </button>
              <button className="account-submit" disabled={busy || (!direct && !reason.trim())}>
                {direct ? t('save') : t('send')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
