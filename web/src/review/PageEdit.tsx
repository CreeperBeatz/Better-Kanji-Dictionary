/**
 * One "Edit" (reviewers) or "Suggest changes" (everyone else) at the bottom of
 * a kanji's or a word's page, in place of a "change it" link on every block
 * (Dani, 2026-10-05). The dialog shows all that can be changed, and the person
 * ticks what needs changing:
 *
 *   a kanji  its meaning groups on the board, with their words; its parts;
 *            its forms; its Bulgarian meanings and group labels
 *   a word   which group of each of its kanji it is in; its Bulgarian
 *
 * Each ticked section that differs goes out as its own edit or suggestion,
 * with the one reason. A reviewer's is live at once; a user's goes to the queue.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  api,
  dataChanged,
  type BoardWord,
  type FormKind,
  type FormsResponse,
  type MeaningGroup,
  type TaskType,
  type TaskValue,
  type Word,
} from '../api'
import { useAuth } from '../account/auth'
import { useForms } from '../detail/Forms'
import { realMeanings } from '../detail/meanings'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { CATCH_ALL, groupLabel, strokesOk, ValueEditor, ValueView } from './editors'
import { finalizeBoard, MeaningsBoard } from './MeaningsBoard'

const S = strings(
  {
    suggest: 'Suggest changes',
    edit: 'Edit',
    titleSuggest: 'Suggest changes to {x}',
    titleEdit: 'Edit {x}',
    pick: 'Tick what needs changing.',
    s_senses: 'Meaning groups',
    s_parts: 'Parts',
    s_form: 'Forms',
    s_bg: 'Bulgarian',
    s_groups: 'Meaning in this word',
    s_en: 'The English meaning is wrong',
    enHint: 'The English is JMdict’s. Tick this to report a mistake in it.',
    enLabel: 'What is wrong?',
    whyNot: 'Why can’t I edit the English?',
    whyNotText: 'We use JMdict as the reference for English. A mistake in it has to be sent to JMdict and fixed there, not here. Once we verify your claim, we will contact JMdict to fix the mistake.',
    sensesHint: 'Drag words between groups, or right-click a word (or a selection of several) to pick its group.',
    noSenses: 'No accepted meaning groups yet.',
    drafted: 'Not reviewed yet: these groups are drafts waiting in the review queue.',
    words: '{n} words',
    noForms: 'No forms recorded yet.',
    noBg: 'No Bulgarian meanings yet.',
    formHint: 'Add or change how {char} relates to one other character.',
    other: 'The other character',
    english: 'English',
    bgHint: 'One meaning per field, short: what the kanji means, as the English says it.',
    bgLabels: 'Group labels and notes',
    noteBg: 'the note in Bulgarian',
    noNote: 'no English note',
    wordBgHint: 'One Bulgarian gloss per sense, beside the English.',
    noKanji: 'This word has no kanji.',
    noGroupsFor: '{char} has no accepted meaning groups yet.',
    notPlaced: 'not placed yet',
    add: 'add',
    remove: 'remove',
    reason: 'Why?',
    reasonHint: 'What is wrong now, and how you know: the old form, a dictionary, a teacher.',
    reasonOptional: 'Why? (kept with the change)',
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
    titleSuggest: 'Предложете промени по {x}',
    titleEdit: 'Редактиране на {x}',
    pick: 'Отметнете какво трябва да се промени.',
    s_senses: 'Групи значения',
    s_parts: 'Части',
    s_form: 'Форми',
    s_bg: 'Български',
    s_groups: 'Значение в тази дума',
    s_en: 'Английското значение е грешно',
    enHint: 'Английският е от JMdict. Отметнете това, за да съобщите за грешка в него.',
    enLabel: 'Какво не е наред?',
    whyNot: 'Защо не мога да редактирам английския?',
    whyNotText: 'Ползваме JMdict като еталон за английския. Грешка в него трябва да се изпрати на JMdict и да се поправи там, а не тук. След като проверим твърдението ви, ще се свържем с JMdict, за да поправят грешката.',
    sensesHint: 'Плъзгайте думи между групите или щракнете с десния бутон върху дума (или избрани няколко), за да ѝ изберете група.',
    noSenses: 'Още няма приети групи значения.',
    drafted: 'Още не е прегледано: тези групи са чернови, които чакат в опашката за преглед.',
    words: '{n} думи',
    noForms: 'Още няма записани форми.',
    noBg: 'Още няма значения на български.',
    formHint: 'Добавете или променете как {char} се свързва с един друг знак.',
    other: 'Другият знак',
    english: 'Английски',
    bgHint: 'По едно кратко значение в поле: какво значи кандзито, както го казва английският.',
    bgLabels: 'Етикети и бележки на групите',
    noteBg: 'бележката на български',
    noNote: 'няма английска бележка',
    wordBgHint: 'По една българска глоса за всяко значение, до английската.',
    noKanji: 'Тази дума няма кандзи.',
    noGroupsFor: '{char} още няма приети групи значения.',
    notPlaced: 'още не е поставена',
    add: 'добавете',
    remove: 'махнете',
    reason: 'Защо?',
    reasonHint: 'Какво не е наред сега и откъде знаете: старата форма, речник, учител.',
    reasonOptional: 'Защо? (пази се с промяната)',
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

type T = ReturnType<typeof S>
type Key = Parameters<T>[0]
type Placements = Record<number, string | null>
type Outcome = 'sent' | 'saved' | 'unchanged' | { problem: string }

/** One request the dialog will send; `section` is where its outcome shows. */
interface Change {
  key: string
  section: string
  type: TaskType
  subject: string
  value: TaskValue
  words?: Placements
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const isDone = (o: Outcome | undefined) => o === 'sent' || o === 'saved' || o === 'unchanged'

/** The button at the bottom of a page: Edit for reviewers, Suggest changes for everyone else. */
function EditButton({ children }: { children: (close: () => void) => ReactNode }) {
  const t = S(useLang())
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <p className="page-edit">
      <button className="clear page-edit-link" onClick={() => setOpen(true)}>
        {t(user && user.role !== 'user' ? 'edit' : 'suggest')}
      </button>
      {/* On the body: a page in the rail is a box of its own (it slides), which would clip a fixed overlay. */}
      {open && createPortal(children(() => setOpen(false)), document.body)}
    </p>
  )
}

export function KanjiEditButton({ char, onSignIn }: { char: string; onSignIn?: () => void }) {
  return <EditButton>{(close) => <KanjiEditDialog char={char} onClose={close} onSignIn={thenSignIn(close, onSignIn)} />}</EditButton>
}

export function WordEditButton({ id, headword, onSignIn }: { id: number; headword: string; onSignIn?: () => void }) {
  return <EditButton>{(close) => <WordEditDialog id={id} headword={headword} onClose={close} onSignIn={thenSignIn(close, onSignIn)} />}</EditButton>
}

/** Signing in from the dialog closes it first. */
function thenSignIn(close: () => void, onSignIn?: () => void) {
  if (!onSignIn) return undefined
  return () => {
    close()
    onSignIn()
  }
}

/**
 * What both dialogs share: sign-in, the sections' ticks, the reason, sending
 * each change and saying what became of it.
 */
function EditShell({
  of,
  wide,
  ready,
  loadError,
  changes,
  onReset,
  onClose,
  onSignIn,
  children,
}: {
  of: string
  wide?: boolean
  ready: boolean
  loadError: unknown
  changes: Change[]
  /** A section was unticked: put it back as it was. */
  onReset: (section: string) => void
  onClose: () => void
  onSignIn?: () => void
  children: (s: {
    on: Set<string>
    section: (id: string, label: string, body: ReactNode, editable?: boolean, why?: { title: string; text: string }) => ReactNode
  }) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  const direct = user !== null && user.role !== 'user'
  const [on, setOn] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const live = changes.filter((c) => on.has(c.section))
  const pending = live.filter((c) => !isDone(outcomes[c.key]))
  // What is made at once, as against sent: a reviewer's changes, but never a report.
  const makes = direct && pending.some((c) => c.type !== 'en_report')
  const needsReason = !direct && pending.some((c) => c.type !== 'en_report')
  const [info, setInfo] = useState<string | null>(null)
  const allDone = live.length > 0 && pending.length === 0

  function toggle(id: string) {
    const off = on.has(id)
    setOn((o) => {
      const n = new Set(o)
      if (off) n.delete(id)
      else n.add(id)
      return n
    })
    if (off) onReset(id)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!pending.length) return
    const parts = pending.find((c) => c.type === 'decomposition')
    if (parts && !strokesOk(parts.value, lang)) return
    setBusy(true)
    const next = { ...outcomes }
    for (const c of pending) {
      try {
        // A report on the English goes to the queue from reviewers too; its text is its reason.
        const res =
          direct && c.type !== 'en_report'
            ? await api.reviewEdit(c.type, c.subject, c.value, reason.trim() || undefined, c.words)
            : await api.suggest(c.type, c.subject, c.value, reason.trim() || (c.type === 'en_report' ? (c.value as string) : ''), c.words)
        next[c.key] = 'unchanged' in res && res.unchanged ? 'unchanged' : 'applied' in res && !res.applied ? 'sent' : 'saved'
      } catch (err) {
        next[c.key] = { problem: err instanceof Error ? errorText(err, lang) : t('failed') }
      }
    }
    setOutcomes(next)
    if (Object.values(next).some((o) => o === 'saved')) dataChanged()
    setBusy(false)
  }

  const title = t(direct ? 'titleEdit' : 'titleSuggest', { x: of })
  const outcomeOf = (id: string) => {
    const mine = live.filter((c) => c.section === id).map((c) => outcomes[c.key])
    const problem = mine.find((o): o is { problem: string } => typeof o === 'object')
    if (problem) return problem
    return mine.length && mine.every(isDone) ? (mine.find((o) => o !== 'unchanged') ?? 'unchanged') : undefined
  }
  /** `why`: a reason the section is as it is, behind an (i) beside its title. */
  const section = (id: string, label: string, body: ReactNode, editable = true, why?: { title: string; text: string }) => {
    const o = outcomeOf(id)
    return (
      <fieldset key={id} className="page-edit-section" data-on={on.has(id) || undefined} disabled={isDone(o) || undefined}>
        <legend>
          {editable ? (
            <label>
              <input type="checkbox" checked={on.has(id)} onChange={() => toggle(id)} />
              {label}
            </label>
          ) : (
            label
          )}
          {why && (
            <button
              type="button"
              className="page-edit-info"
              aria-expanded={info === id}
              aria-label={why.title}
              title={why.title}
              onClick={() => setInfo(info === id ? null : id)}
            >
              i
            </button>
          )}
          {o && <span className={typeof o === 'object' ? 'account-problem' : 'hint'}> — {typeof o === 'object' ? o.problem : t(o)}</span>}
        </legend>
        {why && info === id && (
          <div className="page-edit-why">
            <b>{why.title}</b>
            <p>{why.text}</p>
          </div>
        )}
        {body}
      </fieldset>
    )
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="overlay-panel account-panel suggest-panel page-edit-panel"
        data-wide={wide || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
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
            <ul className="page-edit-outcomes">
              {[...new Set(live.map((c) => c.section))].map((id) => (
                <li key={id}>
                  <b>{t(`s_${id}` as Key)}</b>: {t(outcomeOf(id) as 'sent' | 'saved' | 'unchanged')}
                </li>
              ))}
            </ul>
            <p className="hint">{t(Object.values(outcomes).some((o) => o === 'sent') ? 'sentAll' : 'savedAll')}</p>
            <p className="assoc-actions">
              <button className="clear" onClick={onClose}>
                {t('close')}
              </button>
            </p>
          </>
        ) : !ready ? (
          <p className="hint">{loadError ? (loadError instanceof Error ? errorText(loadError, lang) : t('failed')) : t('loading')}</p>
        ) : (
          <form className="account-form" onSubmit={submit}>
            <p className="hint">{t('pick')}</p>
            {children({ on, section })}
            <label className="review-field">
              <span>{needsReason ? t('reason') : t('reasonOptional')}</span>
              <textarea className="assoc-text" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              {needsReason && <span className="hint">{t('reasonHint')}</span>}
            </label>
            <div className="account-row profile-save">
              <button type="button" className="clear" onClick={onClose}>
                {t('cancel')}
              </button>
              <button className="account-submit" disabled={busy || !pending.length || (needsReason && !reason.trim())}>
                {makes ? t('save') : t('send')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/** Where each word on the board starts: its group, if that group is one of `groups`. */
function startPlacements(board: BoardWord[], groups: MeaningGroup[] | null): Placements {
  const ids = new Set((groups ?? []).map((g) => g.id))
  const p: Placements = {}
  for (const w of board) p[w.id] = w.group && (w.group === CATCH_ALL || ids.has(w.group)) ? w.group : null
  return p
}

interface KanjiNow {
  senses: MeaningGroup[] | null
  drafted: boolean
  board: BoardWord[]
  start: Placements
  parts: string[]
  english: string[]
  bg: string[]
}

function KanjiEditDialog({ char, onClose, onSignIn }: { char: string; onClose: () => void; onSignIn?: () => void }) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  const forms = useForms(char)
  const [now, setNow] = useState<KanjiNow | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [groups, setGroups] = useState<MeaningGroup[]>([])
  const [placements, setPlacements] = useState<Placements>({})
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [notesBg, setNotesBg] = useState<Record<string, string>>({})
  const [parts, setParts] = useState<string[]>([])
  const [form, setForm] = useState<{ other: string; kind: FormKind; note: string | null }>({ other: '', kind: 'looks_like', note: null })
  const [bg, setBg] = useState<string[]>([])
  const [fresh, setFresh] = useState(0)

  useEffect(() => {
    if (!user) return
    let stale = false
    Promise.all([api.kanji(char), api.pageKanji(char)]).then(
      ([g, p]) => {
        if (stale) return
        const accepted = p.drafted ? null : p.senses
        const n: KanjiNow = {
          senses: p.senses,
          drafted: p.drafted,
          board: p.board,
          start: startPlacements(p.board, accepted),
          parts: g.components.nodes.filter((x) => x.depth === 1).map((x) => x.char),
          english: realMeanings(g.focus.meanings),
          bg: g.focus.meaningsBg ?? [],
        }
        setNow(n)
        setGroups(accepted ?? [])
        setPlacements(n.start)
        setLabels(Object.fromEntries((accepted ?? []).map((s) => [s.id, s.bg ?? ''])))
        setNotesBg(Object.fromEntries((accepted ?? []).map((s) => [s.id, s.noteBg ?? ''])))
        setParts(n.parts)
        setBg(n.bg)
      },
      (e) => !stale && setLoadError(e),
    )
    return () => {
      stale = true
    }
  }, [char, user])

  function reset(section: string) {
    if (!now) return
    const accepted = now.drafted ? null : now.senses
    if (section === 'senses') {
      setGroups(accepted ?? [])
      setPlacements(now.start)
      setFresh((n) => n + 1)
    }
    if (section === 'parts') setParts(now.parts)
    if (section === 'form') setForm({ other: '', kind: 'looks_like', note: null })
    if (section === 'bg') {
      setBg(now.bg)
      setLabels(Object.fromEntries((accepted ?? []).map((s) => [s.id, s.bg ?? ''])))
      setNotesBg(Object.fromEntries((accepted ?? []).map((s) => [s.id, s.noteBg ?? ''])))
    }
  }

  // What each section would send, if it is ticked and differs.
  const changes: Change[] = []
  const accepted = now && !now.drafted ? now.senses : null
  if (now) {
    if (accepted) {
      // Bulgarian labels and notes over the board's groups; a note only once it changed, so an untouched group stays as stored.
      const withLabels = groups.map((g) => {
        let out = g.id in labels ? { ...g, bg: labels[g.id].trim() || null } : g
        const note = notesBg[g.id]?.trim()
        if (note !== undefined && note !== (g.noteBg ?? '')) out = { ...out, noteBg: note || null }
        return out
      })
      const fin = finalizeBoard(char, withLabels, placements)
      const moved: Placements = {}
      for (const [id, g] of Object.entries(fin.words)) if (now.start[Number(id)] !== g) moved[Number(id)] = g
      if (!same(fin.groups, accepted) || Object.keys(moved).length) {
        // Labels alone are the Bulgarian section's; anything else is the board's.
        const plain = (gs: MeaningGroup[]) => gs.map((g) => ({ ...g, bg: null, noteBg: null }))
        const boardChanged = Object.keys(moved).length > 0 || !same(plain(fin.groups), plain(accepted))
        changes.push({
          key: 'senses',
          section: boardChanged ? 'senses' : 'bg',
          type: 'kanji_senses',
          subject: char,
          value: fin.groups,
          // Only the words moved: a page is not the queue, where a reviewer
          // looks at every word on the board and decides them all.
          words: Object.keys(moved).length ? moved : undefined,
        })
      }
    }
    if (!same(parts, now.parts)) changes.push({ key: 'parts', section: 'parts', type: 'decomposition', subject: char, value: parts })
    const other = [...form.other.trim()][0]
    if (other) changes.push({ key: 'form', section: 'form', type: 'form_link', subject: `${char}|${other}`, value: { kind: form.kind, note: form.note } })
    const cleanBg = bg.map((m) => m.trim()).filter(Boolean)
    if (!same(cleanBg, now.bg)) changes.push({ key: 'bg', section: 'bg', type: 'bg', subject: `kanji:${char}`, value: cleanBg })
  }

  return (
    <EditShell of={char} wide ready={!!now} loadError={loadError} changes={changes} onReset={reset} onClose={onClose} onSignIn={onSignIn}>
      {({ on, section }) =>
        now && (
          <>
            {section(
              'senses',
              t('s_senses'),
              !now.senses ? (
                <p className="hint">{t('noSenses')}</p>
              ) : now.drafted ? (
                <>
                  <p className="hint">{t('drafted')}</p>
                  <GroupsSummary groups={now.senses} board={now.board} start={startPlacements(now.board, now.senses)} t={t} />
                </>
              ) : on.has('senses') ? (
                <>
                  <p className="hint">{t('sensesHint')}</p>
                  <MeaningsBoard
                    key={fresh}
                    plain
                    cacheKey={`page:${char}`}
                    char={char}
                    groups={groups}
                    onGroups={setGroups}
                    words={now.board}
                    placements={placements}
                    onPlace={(ids, to) => setPlacements((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, to])) }))}
                    skipped={NONE}
                    onSkip={() => {}}
                  />
                </>
              ) : (
                <GroupsSummary groups={now.senses} board={now.board} start={now.start} t={t} />
              ),
              !!accepted,
            )}
            {section('parts', t('s_parts'), on.has('parts') ? <ValueEditor type="decomposition" value={parts} onChange={(v) => setParts(v as string[])} /> : <ValueView type="decomposition" value={now.parts} />)}
            {section(
              'form',
              t('s_form'),
              <>
                <FormsNow forms={forms} t={t} />
                {on.has('form') && (
                  <>
                    <p className="hint">{t('formHint', { char })}</p>
                    <label className="review-field">
                      <span>{t('other')}</span>
                      <input className="assoc-text" lang="ja" value={form.other} maxLength={2} autoFocus onChange={(e) => setForm({ ...form, other: e.target.value })} />
                    </label>
                    <ValueEditor
                      type="form_link"
                      value={{ kind: form.kind, note: form.note }}
                      onChange={(v) => setForm({ ...form, ...(v as { kind: FormKind; note: string | null }) })}
                    />
                  </>
                )}
              </>,
            )}
            {section(
              'bg',
              t('s_bg'),
              <>
                {now.english.length > 0 && (
                  <p className="page-edit-english">
                    <span className="hint">{t('english')}:</span> {now.english.slice(0, 8).join(', ')}
                  </p>
                )}
                {on.has('bg') ? (
                  <>
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
                    {accepted && groups.length > 0 && (
                      <div className="bg-groups">
                        <span>{t('bgLabels')}</span>
                        <ul className="bg-labels">
                          {groups.map((g) => (
                            <li key={g.id}>
                              <span className="bg-label-en">
                                <b>{g.en}</b>
                              </span>
                              <input
                                className="assoc-text"
                                lang="bg"
                                maxLength={40}
                                value={labels[g.id] ?? g.bg ?? ''}
                                aria-label={g.en}
                                onChange={(e) => setLabels({ ...labels, [g.id]: e.target.value })}
                              />
                              <span className="bg-label-note hint">{g.note ?? t('noNote')}</span>
                              <input
                                className="assoc-text bg-note-input"
                                lang="bg"
                                maxLength={200}
                                value={notesBg[g.id] ?? g.noteBg ?? ''}
                                placeholder={t('noteBg')}
                                aria-label={`${g.en}: ${t('noteBg')}`}
                                onChange={(e) => setNotesBg({ ...notesBg, [g.id]: e.target.value })}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : now.bg.length ? (
                  <ValueView type="bg" value={now.bg} />
                ) : (
                  <p className="hint">{t('noBg')}</p>
                )}
              </>,
            )}
          </>
        )
      }
    </EditShell>
  )
}

const NONE = new Set<number>()

/** The groups, read-only, each with how many words are in it and the first few. */
function GroupsSummary({ groups, board, start, t }: { groups: MeaningGroup[]; board: BoardWord[]; start: Placements; t: T }) {
  const lang = useLang()
  return (
    <ul className="page-edit-groups">
      {[...groups.map((g) => g.id), CATCH_ALL].map((id) => {
        const words = board.filter((w) => start[w.id] === id)
        if (id === CATCH_ALL && !words.length) return null
        return (
          <li key={id}>
            <b>{groupLabel(id, groups, lang)}</b> <span className="hint">{t('words', { n: words.length })}</span>
            {words.length > 0 && (
              <span className="page-edit-words" lang="ja">
                {' '}
                {words.slice(0, 8).map((w) => w.headword).join('、')}
                {words.length > 8 && '…'}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const FORM_ROWS = ['old', 'new', 'formOf', 'positional', 'forms', 'looksLike', 'lookalikeOf', 'variants'] as const

/** The forms recorded now, read-only, so a change starts from what is there. */
function FormsNow({ forms, t }: { forms: FormsResponse | null; t: T }) {
  const rows = forms ? FORM_ROWS.filter((k) => forms[k].length > 0) : []
  if (!rows.length) return <p className="hint">{t('noForms')}</p>
  return (
    <dl className="page-edit-forms">
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

interface WordNow {
  word: Word
  kanji: { char: string; senses: MeaningGroup[] | null; group: string | null }[]
  bg: string[]
}

function WordEditDialog({ id, headword, onClose, onSignIn }: { id: number; headword: string; onClose: () => void; onSignIn?: () => void }) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  const [now, setNow] = useState<WordNow | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [picks, setPicks] = useState<Record<string, string | null>>({})
  const [bg, setBg] = useState<string[]>([])
  const [report, setReport] = useState('')

  useEffect(() => {
    if (!user) return
    let stale = false
    api.pageWord(id).then(
      (p) => {
        if (stale) return
        const n: WordNow = { word: p.word, kanji: p.kanji, bg: p.word.senses.map((s) => s.glossBg ?? '') }
        setNow(n)
        setPicks(Object.fromEntries(p.kanji.map((k) => [k.char, k.group])))
        setBg(n.bg)
      },
      (e) => !stale && setLoadError(e),
    )
    return () => {
      stale = true
    }
  }, [id, user])

  function reset(section: string) {
    if (!now) return
    if (section === 'groups') setPicks(Object.fromEntries(now.kanji.map((k) => [k.char, k.group])))
    if (section === 'bg') setBg(now.bg)
    if (section === 'en') setReport('')
  }

  const changes: Change[] = []
  if (now) {
    if (report.trim()) changes.push({ key: 'en', section: 'en', type: 'en_report', subject: `word:${id}`, value: report.trim() })
    for (const k of now.kanji) {
      const pick = picks[k.char]
      if (k.senses && pick && pick !== k.group)
        changes.push({ key: `ws:${k.char}`, section: 'groups', type: 'word_sense', subject: `${k.char}|${id}`, value: pick })
    }
    const clean = bg.map((g) => g.trim())
    if (!same(clean, now.bg)) changes.push({ key: 'bg', section: 'bg', type: 'bg', subject: `word:${id}`, value: clean })
  }
  const grouped = now?.kanji.filter((k) => k.senses) ?? []

  return (
    <EditShell of={headword} ready={!!now} loadError={loadError} changes={changes} onReset={reset} onClose={onClose} onSignIn={onSignIn}>
      {({ on, section }) =>
        now && (
          <>
            {section(
              'groups',
              t('s_groups'),
              !now.kanji.length ? (
                <p className="hint">{t('noKanji')}</p>
              ) : (
                <div className="page-edit-word-groups">
                  {now.kanji.map((k) => (
                    <div key={k.char} className="page-edit-word-kanji">
                      <span className="page-edit-char" lang="ja">
                        {k.char}
                      </span>
                      {!k.senses ? (
                        <span className="hint">{t('noGroupsFor', { char: k.char })}</span>
                      ) : on.has('groups') ? (
                        <ValueEditor type="word_sense" value={picks[k.char]} onChange={(v) => setPicks({ ...picks, [k.char]: v as string })} groups={k.senses} />
                      ) : k.group ? (
                        <b>{groupLabel(k.group, k.senses, lang)}</b>
                      ) : (
                        <span className="hint">{t('notPlaced')}</span>
                      )}
                    </div>
                  ))}
                </div>
              ),
              grouped.length > 0,
            )}
            {section(
              'en',
              t('s_en'),
              on.has('en') ? (
                <label className="review-field">
                  <span>{t('enLabel')}</span>
                  <textarea className="assoc-text" rows={4} maxLength={1000} value={report} autoFocus onChange={(e) => setReport(e.target.value)} />
                </label>
              ) : (
                <p className="hint">{t('enHint')}</p>
              ),
              true,
              { title: t('whyNot'), text: t('whyNotText') },
            )}
            {section(
              'bg',
              t('s_bg'),
              on.has('bg') ? (
                <div className="review-field">
                  <span className="hint">{t('wordBgHint')}</span>
                  <ol className="bg-senses">
                    {now.word.senses.map((s, i) => (
                      <li key={i} className="bg-sense">
                        <div className="bg-en">
                          {s.pos.length > 0 && <span className="bg-pos">{s.pos.join(', ')}</span>}
                          {s.gloss}
                        </div>
                        <input
                          className="assoc-text bg-input"
                          lang="bg"
                          value={bg[i] ?? ''}
                          aria-label={`${t('s_bg')} ${i + 1}`}
                          onChange={(e) => setBg(bg.map((x, j) => (j === i ? e.target.value : x)))}
                        />
                      </li>
                    ))}
                  </ol>
                </div>
              ) : now.bg.some(Boolean) ? (
                <ol className="page-edit-word-bg">
                  {now.word.senses.map((s, i) => (
                    <li key={i}>
                      <span className="hint">{s.gloss.split(';')[0]}</span> — <span lang="bg">{now.bg[i] || '—'}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="hint">{t('noBg')}</p>
              ),
            )}
          </>
        )
      }
    </EditShell>
  )
}
