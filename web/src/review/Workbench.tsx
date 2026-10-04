import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, dataChanged, type AdminPeople, type Author, type Decision, type HistoryFilter } from '../api'
import { useAuth } from '../account/auth'
import type { WorkbenchTab } from '../account/Account'
import { Avatar } from '../account/Avatar'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { ValueView } from './editors'
import { ProgressMini, ProgressPage, useProgress } from './Progress'
import { Queue } from './Queue'

const Handbook = lazy(() => import('./Handbook'))

const S = strings(
  {
    people: 'People',
    requests: 'Asking to review',
    noRequests: 'No one is waiting.',
    approve: 'approve',
    decline: 'decline',
    reviewers: 'Reviewers',
    noReviewers: 'No reviewers yet.',
    since: 'since {date}',
    revoke: 'revoke',
    confirmRevoke: 'Stop {name} reviewing? Their past decisions stay.',
    log: 'Changes of role',
    logLine: '{by} made {user} {after} (was {before})',
    loading: 'loading',
    failed: 'could not load this',
    role_user: 'a user',
    role_reviewer: 'a reviewer',
    role_admin: 'admin',
    queue: 'Queue',
    history: 'History',
    noHistory: 'No decisions yet.',
    revert: 'revert',
    reverted: 'reverted',
    confirmRevert: 'Put back the value from before this decision?',
    a_accept: 'accepted',
    a_edit: 'edited',
    a_reject: 'rejected',
    a_direct: 'changed directly',
    a_auto: 'auto-accepted',
    a_revert: 'reverted',
    a_reopen: 'reopened',
    handbook: 'Handbook',
    progress: 'Progress',
    mode: 'Review mode',
    exit: 'Exit',
    reviewer: 'Reviewer',
    anyone: 'everyone',
    me: 'me',
    autoRule: 'the auto rule',
    from: 'From',
    to: 'To',
    clearFilters: 'clear',
    shown: '{n} shown',
    words: '+ {n} words placed',
  },
  {
    people: 'Хора',
    requests: 'Искат да рецензират',
    noRequests: 'Никой не чака.',
    approve: 'одобрете',
    decline: 'откажете',
    reviewers: 'Рецензенти',
    noReviewers: 'Все още няма рецензенти.',
    since: 'от {date}',
    revoke: 'отнемете',
    confirmRevoke: '{name} да спре ли да рецензира? Досегашните решения остават.',
    log: 'Промени на ролите',
    logLine: '{by} направи {user} {after} (беше {before})',
    loading: 'зареждане',
    failed: 'не можа да се зареди',
    role_user: 'потребител',
    role_reviewer: 'рецензент',
    role_admin: 'администратор',
    queue: 'Опашка',
    history: 'История',
    noHistory: 'Още няма решения.',
    revert: 'върнете',
    reverted: 'върнато',
    confirmRevert: 'Да се върне ли стойността отпреди това решение?',
    a_accept: 'прието',
    a_edit: 'редактирано',
    a_reject: 'отхвърлено',
    a_direct: 'променено направо',
    a_auto: 'прието автоматично',
    a_revert: 'върнато',
    a_reopen: 'отворено отново',
    handbook: 'Наръчник',
    progress: 'Напредък',
    mode: 'Режим преглед',
    exit: 'Изход',
    reviewer: 'Рецензент',
    anyone: 'всички',
    me: 'аз',
    autoRule: 'автоматичното правило',
    from: 'От',
    to: 'До',
    clearFilters: 'изчистете',
    shown: 'показани: {n}',
    words: '+ {n} разпределени думи',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

/**
 * The review screen: the labeling queue, your decisions, and for the admin,
 * who reviews. Reviewers and the admin only; the server checks it again.
 */
export function Workbench({
  tab,
  onTab,
  onClose,
  onKanji,
}: {
  tab: WorkbenchTab
  onTab: (t: WorkbenchTab) => void
  onClose: () => void
  onKanji?: (char: string) => void
}) {
  const t = S(useLang())
  const { user } = useAuth()
  const [version, setVersion] = useState(0)
  const decided = useCallback(() => setVersion((v) => v + 1), [])
  const progress = useProgress(version)

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

  if (!user || user.role === 'user') return null
  const tabs: [WorkbenchTab, Key][] = [
    ['queue', 'queue'],
    ['history', 'history'],
    ['progress', 'progress'],
    ...(user.role === 'admin' ? ([['people', 'people']] as [WorkbenchTab, Key][]) : []),
    ['handbook', 'handbook'],
  ]

  // The whole screen: the queue needs the room, and its list and item scroll on their own.
  return (
    <div className="overlay workbench-screen">
      <div className="overlay-panel workbench" role="dialog" aria-modal="true" aria-label={t('mode')}>
        <header className="workbench-head">
          <nav className="overlay-tabs" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => onTab(k)}>
                {t(label)}
              </button>
            ))}
          </nav>
          <ProgressMini data={progress} onOpen={() => onTab('progress')} />
          <div className="workbench-mode">
            <h2>{t('mode')}</h2>
            <button className="workbench-exit" onClick={onClose} title="Esc">
              {t('exit')}
            </button>
          </div>
        </header>
        <div className="workbench-body" data-tab={tab}>
          {tab === 'queue' && <Queue onKanji={onKanji} onDecided={decided} />}
          {tab === 'history' && <History admin={user.role === 'admin'} />}
          {tab === 'progress' && <ProgressPage data={progress} />}
          {tab === 'people' && user.role === 'admin' && <People />}
          {tab === 'handbook' && (
            <Suspense fallback={<p className="hint">{t('loading')}</p>}>
              <Handbook />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  )
}

function People() {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState<AdminPeople | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.adminPeople().then(setData, (e) => setProblem(errorText(e, lang)))
  }, [lang])
  useEffect(load, [load])

  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      await run()
      load()
    } catch (e) {
      setProblem(errorText(e, lang))
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="hint">{problem ?? t('loading')}</p>
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'bg' ? 'bg-BG' : 'en-GB')

  return (
    <>
      {problem && <p className="account-problem">{problem}</p>}
      <section className="workbench-section">
        <h3>{t('requests')}</h3>
        {data.requests.length === 0 && <p className="hint">{t('noRequests')}</p>}
        {data.requests.map((r) => (
          <article key={r.id} className="person">
            <Avatar author={r.user} size={32} />
            <div className="person-who">
              <strong>{r.user.name}</strong> <span>@{r.user.username}</span> <span className="hint">{r.user.email}</span>
              <p className="person-text">{r.text}</p>
              <span className="hint">{date(r.created)}</span>
            </div>
            <div className="person-actions">
              <button className="account-submit" disabled={busy} onClick={() => act(() => api.decideRequest(r.id, true))}>
                {t('approve')}
              </button>
              <button className="clear" disabled={busy} onClick={() => act(() => api.decideRequest(r.id, false))}>
                {t('decline')}
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="workbench-section">
        <h3>{t('reviewers')}</h3>
        {data.reviewers.length === 0 && <p className="hint">{t('noReviewers')}</p>}
        {data.reviewers.map((r) => (
          <article key={r.id} className="person">
            <Avatar author={r} size={32} />
            <div className="person-who">
              <strong>{r.name}</strong> <span>@{r.username}</span> <span className="hint">{r.email}</span>
              {r.since && <span className="hint"> · {t('since', { date: date(r.since) })}</span>}
            </div>
            <div className="person-actions">
              <button
                className="clear"
                disabled={busy}
                onClick={() => window.confirm(t('confirmRevoke', { name: r.name })) && act(() => api.revokeReviewer(r.id))}
              >
                {t('revoke')}
              </button>
            </div>
          </article>
        ))}
      </section>

      {data.log.length > 0 && (
        <section className="workbench-section">
          <h3>{t('log')}</h3>
          <ul className="workbench-log">
            {data.log.map((e, i) => (
              <li key={i}>
                <span className="hint">{date(e.at)}</span>{' '}
                {t('logLine', {
                  by: e.byName,
                  user: e.userName,
                  after: t(`role_${e.after}` as Key),
                  before: t(`role_${e.before}` as Key),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

const CHANGES = new Set(['accept', 'edit', 'direct', 'auto', 'revert', 'reopen'])

/** Decisions, newest first: your own, or everyone's for the admin. */
function History({ admin }: { admin: boolean }) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  // The admin sees everyone's unless narrowed to one person; a reviewer sees their own.
  const [by, setBy] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<Decision[] | null>(null)
  const [people, setPeople] = useState<Author[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    const f: HistoryFilter = { all: admin && !by, by: admin && by ? by : undefined, from: from || undefined, to: to || undefined }
    api.reviewHistory(f).then(
      (d) => {
        setRows(d.items)
        if (d.people.length) setPeople(d.people)
      },
      (e) => setProblem(errorText(e, lang)),
    )
  }, [admin, by, from, to, lang])
  useEffect(load, [load])

  async function revert(d: Decision) {
    if (!window.confirm(t('confirmRevert'))) return
    setProblem(null)
    try {
      await api.revert(d.id)
      if (d.type === 'decomposition' || d.type === 'form_link') dataChanged()
      load()
    } catch (e) {
      setProblem(errorText(e, lang))
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'bg' ? 'bg-BG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
  const filtered = !!(by || from || to)
  const who = (p: Author) => (p.id === 'auto' ? t('autoRule') : p.username ? '@' + p.username : p.name)
  return (
    <>
      <div className="history-filters">
        {admin && (
          <label>
            <span>{t('reviewer')}</span>
            <select className="assoc-text" value={by} onChange={(e) => setBy(e.target.value)}>
              <option value="">{t('anyone')}</option>
              {user && <option value={user.id}>{t('me')}</option>}
              {people
                .filter((p) => p.id !== user?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {who(p)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          <span>{t('from')}</span>
          <input className="assoc-text" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span>{t('to')}</span>
          <input className="assoc-text" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtered && (
          <button
            className="clear"
            onClick={() => {
              setBy('')
              setFrom('')
              setTo('')
            }}
          >
            {t('clearFilters')}
          </button>
        )}
        {rows && <span className="hint history-count">{t('shown', { n: rows.length })}</span>}
      </div>
      {problem && <p className="account-problem">{problem}</p>}
      {rows === null && !problem && <p className="hint">{t('loading')}</p>}
      {rows?.length === 0 && <p className="hint">{t('noHistory')}</p>}
      <ul className="decisions">
        {rows?.map((d) => (
          <li key={d.id} data-reverted={!!d.reverted_by || undefined}>
            <span className="hint">{when(d.at)}</span>{' '}
            <span className="decision-subject" lang="ja">
              {d.subject.split('|')[0]}
            </span>{' '}
            {t(`a_${d.action}` as Key)}
            {d.byCard && <span className="hint"> · @{d.byCard.username ?? d.byCard.name}</span>}
            {CHANGES.has(d.action) && (
              <span className="decision-change">
                <ValueView type={d.type} value={d.before} /> → <ValueView type={d.type} value={d.after} />
              </span>
            )}
            {!!d.words && <span className="hint"> {t('words', { n: d.words })}</span>}
            {d.reason && <span className="hint decision-reason">{d.reason}</span>}
            {admin &&
              CHANGES.has(d.action) &&
              (d.reverted_by ? (
                <span className="hint"> · {t('reverted')}</span>
              ) : (
                <button className="clear" onClick={() => revert(d)}>
                  {t('revert')}
                </button>
              ))}
          </li>
        ))}
      </ul>
    </>
  )
}
