/**
 * One "Edit" (reviewers) or "Suggest changes" (everyone else) on a kanji's
 * page, in place of a "change it" link on every block (Dani, 2026-10-05). The
 * dialog shows all that can be changed about the kanji -- meaning groups,
 * parts, forms, Bulgarian -- and the person ticks what needs changing. Each
 * ticked section that differs goes out as its own suggestion or edit, with
 * the one reason.
 */
import { useEffect, useState } from 'react'
import { api, dataChanged, type FormKind, type FormsResponse, type MeaningGroup, type TaskType, type TaskValue } from '../api'
import { useAuth } from '../account/auth'
import { useForms } from '../detail/Forms'
import { realMeanings } from '../detail/DetailPanel'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { strokesOk, ValueEditor, ValueView } from './editors'

const S = strings(
  {
    suggest: 'Suggest changes',
    edit: 'Edit',
    titleSuggest: 'Suggest changes to {char}',
    titleEdit: 'Edit {char}',
    pick: 'Tick what needs changing.',
    s_senses: 'Meaning groups',
    s_parts: 'Parts',
    s_form: 'Forms',
    s_bg: 'Bulgarian',
    noSenses: 'No accepted meaning groups yet.',
    noForms: 'No forms recorded yet.',
    noBg: 'No Bulgarian meanings yet.',
    formHint: 'Add or change how {char} relates to one other character.',
    other: 'The other character',
    english: 'English',
    bgHint: 'One meaning per field, short: what the kanji means, as the English says it.',
    add: 'add',
    remove: 'remove',
    reason: 'Why?',
    reasonHint: 'What is wrong now, and how you know: the old form, a dictionary, a teacher.',
    reasonOptional: 'Why? (kept with the change)',
    nothing: 'Tick a section and change something in it first.',
    send: 'send',
    save: 'save',
    cancel: 'cancel',
    close: 'close',
    loading: 'loading…',
    sent: 'sent for review',
    saved: 'saved, live now',
    unchanged: 'no change',
    sentAll: 'Thank you. A reviewer will look at it; you can see what became of it on your account page.',
    savedAll: 'Saved. It is live now, and logged.',
    signIn: 'Sign in to suggest a change.',
    logIn: 'log in',
    failed: 'could not send this',
    f_old: 'Old form',
    f_new: 'Today’s form',
    f_formOf: 'A form of',
    f_positional: 'In other positions',
    f_forms: 'Its squashed or moved forms',
    f_looksLike: 'Looks like',
    f_lookalikeOf: 'Mistaken for it',
    f_variants: 'Other variants',
  },
  {
    suggest: 'Предложете промени',
    edit: 'Редактирайте',
    titleSuggest: 'Предложете промени по {char}',
    titleEdit: 'Редактиране на {char}',
    pick: 'Отметнете какво трябва да се промени.',
    s_senses: 'Групи значения',
    s_parts: 'Части',
    s_form: 'Форми',
    s_bg: 'Български',
    noSenses: 'Още няма приети групи значения.',
    noForms: 'Още няма записани форми.',
    noBg: 'Още няма значения на български.',
    formHint: 'Добавете или променете как {char} се свързва с един друг знак.',
    other: 'Другият знак',
    english: 'Английски',
    bgHint: 'По едно кратко значение в поле: какво значи кандзито, както го казва английският.',
    add: 'добавете',
    remove: 'махнете',
    reason: 'Защо?',
    reasonHint: 'Какво не е наред сега и откъде знаете: старата форма, речник, учител.',
    reasonOptional: 'Защо? (пази се с промяната)',
    nothing: 'Първо отметнете раздел и променете нещо в него.',
    send: 'изпратете',
    save: 'запазете',
    cancel: 'отказ',
    close: 'затворете',
    loading: 'зарежда се…',
    sent: 'изпратено за преглед',
    saved: 'запазено, в сила',
    unchanged: 'без промяна',
    sentAll: 'Благодарим. Рецензент ще го погледне; какво е станало, ще видите в профила си.',
    savedAll: 'Запазено. Вече е в сила и е записано.',
    signIn: 'Влезте, за да предложите промяна.',
    logIn: 'вход',
    failed: 'не можа да бъде изпратено',
    f_old: 'Стара форма',
    f_new: 'Днешна форма',
    f_formOf: 'Форма на',
    f_positional: 'В други позиции',
    f_forms: 'Сбитите или преместени форми',
    f_looksLike: 'Прилича на',
    f_lookalikeOf: 'Бъркат го с него',
    f_variants: 'Други варианти',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
type Section = 'senses' | 'parts' | 'form' | 'bg'
const SECTIONS: Section[] = ['senses', 'parts', 'form', 'bg']
const FORM_ROWS = ['old', 'new', 'formOf', 'positional', 'forms', 'looksLike', 'lookalikeOf', 'variants'] as const

type Form = { other: string; kind: FormKind; note: string | null }
type Outcome = 'sent' | 'saved' | 'unchanged' | { problem: string }

/** What the kanji has now, loaded when the dialog opens. */
interface Now {
  senses: MeaningGroup[] | null
  parts: string[]
  english: string[]
  bg: string[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The button for the page's head, and its dialog. */
export function KanjiEditButton({ char, onSignIn }: { char: string; onSignIn?: () => void }) {
  const t = S(useLang())
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="clear kanji-edit-link" onClick={() => setOpen(true)}>
        {t(user && user.role !== 'user' ? 'edit' : 'suggest')}
      </button>
      {open && (
        <KanjiEditDialog
          char={char}
          onClose={() => setOpen(false)}
          onSignIn={
            onSignIn &&
            (() => {
              setOpen(false)
              onSignIn()
            })
          }
        />
      )}
    </>
  )
}

function KanjiEditDialog({ char, onClose, onSignIn }: { char: string; onClose: () => void; onSignIn?: () => void }) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  const direct = user !== null && user.role !== 'user'
  const forms = useForms(char)
  const [now, setNow] = useState<Now | null>(null)
  const [on, setOn] = useState<Set<Section>>(new Set())
  const [senses, setSenses] = useState<MeaningGroup[]>([])
  const [parts, setParts] = useState<string[]>([])
  const [form, setForm] = useState<Form>({ other: '', kind: 'looks_like', note: null })
  const [bg, setBg] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Partial<Record<Section, Outcome>>>({})
  const [loadError, setLoadError] = useState<unknown>(null)

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

  useEffect(() => {
    let stale = false
    Promise.all([api.kanji(char), api.wordsWith(char, true, 0, 1).catch(() => null)]).then(
      ([g, w]) => {
        if (stale) return
        const n: Now = {
          senses: w?.senses ?? null,
          parts: g.components.nodes.filter((x) => x.depth === 1).map((x) => x.char),
          english: realMeanings(g.focus.meanings),
          bg: g.focus.meaningsBg ?? [],
        }
        setNow(n)
        setSenses(n.senses ?? [])
        setParts(n.parts)
        setBg(n.bg)
      },
      (e) => !stale && setLoadError(e),
    )
    return () => {
      stale = true
    }
  }, [char])

  // Unticking a section puts it back as it was.
  function toggle(s: Section) {
    const off = on.has(s)
    setOn((o) => {
      const n = new Set(o)
      if (off) n.delete(s)
      else n.add(s)
      return n
    })
    if (!off || !now) return
    if (s === 'senses') setSenses(now.senses ?? [])
    if (s === 'parts') setParts(now.parts)
    if (s === 'form') setForm({ other: '', kind: 'looks_like', note: null })
    if (s === 'bg') setBg(now.bg)
  }

  // What each ticked section would send, when it differs from what is there.
  const other = [...form.other.trim()][0] ?? ''
  const changes: { section: Section; type: TaskType; subject: string; value: TaskValue }[] = []
  if (now) {
    if (on.has('senses') && !same(senses, now.senses ?? [])) changes.push({ section: 'senses', type: 'kanji_senses', subject: char, value: senses })
    if (on.has('parts') && !same(parts, now.parts)) changes.push({ section: 'parts', type: 'decomposition', subject: char, value: parts })
    if (on.has('form') && other) changes.push({ section: 'form', type: 'form_link', subject: `${char}|${other}`, value: { kind: form.kind, note: form.note } })
    const cleanBg = bg.map((m) => m.trim()).filter(Boolean)
    if (on.has('bg') && !same(cleanBg, now.bg)) changes.push({ section: 'bg', type: 'bg', subject: `kanji:${char}`, value: cleanBg })
  }
  const pending = changes.filter((c) => !isDone(outcomes[c.section]))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!pending.length) return setProblem(t('nothing'))
    const p = pending.find((c) => c.type === 'decomposition')
    if (p && !strokesOk(p.value, lang)) return
    setBusy(true)
    setProblem(null)
    const next = { ...outcomes }
    for (const c of pending) {
      try {
        const res = direct
          ? await api.reviewEdit(c.type, c.subject, c.value, reason.trim() || undefined)
          : await api.suggest(c.type, c.subject, c.value, reason.trim())
        next[c.section] = 'unchanged' in res && res.unchanged ? 'unchanged' : direct || ('applied' in res && res.applied) ? 'saved' : 'sent'
      } catch (err) {
        next[c.section] = { problem: err instanceof Error ? errorText(err, lang) : t('failed') }
      }
    }
    setOutcomes(next)
    if (Object.values(next).some((o) => o === 'saved')) dataChanged()
    setBusy(false)
  }

  const title = t(direct ? 'titleEdit' : 'titleSuggest', { char })
  const allDone = changes.length > 0 && pending.length === 0
  const sentAny = Object.values(outcomes).some((o) => o === 'sent')

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel account-panel suggest-panel kanji-edit" role="dialog" aria-modal="true" aria-label={title}>
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
        ) : allDone ? (
          <>
            <ul className="kanji-edit-outcomes">
              {changes.map((c) => (
                <li key={c.section}>
                  <b>{t(`s_${c.section}` as Key)}</b>: {t(outcomes[c.section] as 'sent' | 'saved' | 'unchanged')}
                </li>
              ))}
            </ul>
            <p className="hint">{t(sentAny ? 'sentAll' : 'savedAll')}</p>
            <p className="assoc-actions">
              <button className="clear" onClick={onClose}>
                {t('close')}
              </button>
            </p>
          </>
        ) : !now ? (
          <p className="hint">{loadError ? (loadError instanceof Error ? errorText(loadError, lang) : t('failed')) : t('loading')}</p>
        ) : (
          <form className="account-form" onSubmit={submit}>
            <p className="hint">{t('pick')}</p>
            {SECTIONS.map((s) => {
              const o = outcomes[s]
              return (
                <fieldset key={s} className="kanji-edit-section" data-on={on.has(s) || undefined} disabled={isDone(o) || undefined}>
                  <legend>
                    <label>
                      <input type="checkbox" checked={on.has(s)} onChange={() => toggle(s)} />
                      {t(`s_${s}` as Key)}
                    </label>
                    {o && (
                      <span className={typeof o === 'object' ? 'account-problem' : 'hint'}>
                        {' '}
                        — {typeof o === 'object' ? o.problem : t(o)}
                      </span>
                    )}
                  </legend>
                  {s === 'senses' &&
                    (on.has(s) ? (
                      <ValueEditor type="kanji_senses" value={senses} onChange={(v) => setSenses(v as MeaningGroup[])} char={char} withBg />
                    ) : now.senses ? (
                      <ValueView type="kanji_senses" value={now.senses} />
                    ) : (
                      <p className="hint">{t('noSenses')}</p>
                    ))}
                  {s === 'parts' &&
                    (on.has(s) ? (
                      <ValueEditor type="decomposition" value={parts} onChange={(v) => setParts(v as string[])} />
                    ) : (
                      <ValueView type="decomposition" value={now.parts} />
                    ))}
                  {s === 'form' && (
                    <>
                      <FormsNow forms={forms} t={t} />
                      {on.has(s) && (
                        <>
                          <p className="hint">{t('formHint', { char })}</p>
                          <label className="review-field">
                            <span>{t('other')}</span>
                            <input
                              className="assoc-text"
                              lang="ja"
                              value={form.other}
                              maxLength={2}
                              autoFocus
                              onChange={(e) => setForm({ ...form, other: e.target.value })}
                            />
                          </label>
                          <ValueEditor
                            type="form_link"
                            value={{ kind: form.kind, note: form.note }}
                            onChange={(v) => setForm({ ...form, ...(v as { kind: FormKind; note: string | null }) })}
                          />
                        </>
                      )}
                    </>
                  )}
                  {s === 'bg' && (
                    <>
                      {now.english.length > 0 && (
                        <p className="kanji-edit-english">
                          <span className="hint">{t('english')}:</span> {now.english.slice(0, 8).join(', ')}
                        </p>
                      )}
                      {on.has(s) ? (
                        <div className="review-field">
                          <span className="hint">{t('bgHint')}</span>
                          <div className="bg-meanings">
                            {bg.map((m, i) => (
                              <span key={i} className="bg-meaning">
                                <input
                                  className="assoc-text"
                                  lang="bg"
                                  value={m}
                                  maxLength={60}
                                  aria-label={`${t('s_bg')} ${i + 1}`}
                                  onChange={(e) => setBg(bg.map((x, j) => (j === i ? e.target.value : x)))}
                                />
                                <button type="button" className="clear" onClick={() => setBg(bg.filter((_, j) => j !== i))}>
                                  {t('remove')}
                                </button>
                              </span>
                            ))}
                          </div>
                          {bg.length < 12 && (
                            <span className="bg-meaning-tools">
                              <button type="button" className="clear" onClick={() => setBg([...bg, ''])}>
                                + {t('add')}
                              </button>
                            </span>
                          )}
                        </div>
                      ) : now.bg.length ? (
                        <ValueView type="bg" value={now.bg} />
                      ) : (
                        <p className="hint">{t('noBg')}</p>
                      )}
                    </>
                  )}
                </fieldset>
              )
            })}
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
              <button className="account-submit" disabled={busy || !pending.length || (!direct && !reason.trim())}>
                {direct ? t('save') : t('send')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const isDone = (o: Outcome | undefined) => o === 'sent' || o === 'saved' || o === 'unchanged'

/** The forms recorded now, read-only, so a change starts from what is there. */
function FormsNow({ forms, t }: { forms: FormsResponse | null; t: ReturnType<typeof S> }) {
  const rows = forms ? FORM_ROWS.filter((k) => forms[k].length > 0) : []
  if (!rows.length) return <p className="hint">{t('noForms')}</p>
  return (
    <dl className="kanji-edit-forms">
      {rows.map((k) => (
        <div key={k}>
          <dt>{t(`f_${k}` as Key)}</dt>
          <dd lang="ja">
            {forms![k].map((i) => (
              <span key={i.char}>
                {i.char}
                {i.note && <span className="hint"> ({i.note})</span>}{' '}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
