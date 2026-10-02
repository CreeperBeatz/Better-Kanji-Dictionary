import { useCallback, useEffect, useState } from 'react'
import { api, dataChanged, type AdminPeople, type Decision } from '../api'
import { useAuth } from '../account/auth'
import type { WorkbenchTab } from '../account/Account'
import { Avatar } from '../account/Avatar'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { ValueView } from './editors'
import { Queue } from './Queue'

const S = strings(
  {
    title: 'Review',
    close: 'close',
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
    auto: 'Auto-accepted',
    mine: 'mine',
    everyone: 'everyone’s',
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
    autoHint: 'Accepted by the mechanical rule, not by a person. Spot-check them: if more than a few are wrong, the rule needs tightening.',
  },
  {
    title: 'Преглед',
    close: 'затворете',
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
    auto: 'Приети автоматично',
    mine: 'моите',
    everyone: 'на всички',
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
    autoHint: 'Приети по механичното правило, а не от човек. Проверявайте на случаен принцип: ако повече от няколко са грешни, правилото трябва да се затегне.',
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
    ...(user.role === 'admin' ? ([['auto', 'auto'], ['people', 'people']] as [WorkbenchTab, Key][]) : []),
  ]

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel workbench" role="dialog" aria-modal="true" aria-label={t('title')}>
        <button className="account-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
          ×
        </button>
        <h2>{t('title')}</h2>
        <nav className="overlay-tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => onTab(k)}>
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="workbench-body">
          {tab === 'queue' && <Queue onKanji={onKanji} />}
          {tab === 'history' && <History admin={user.role === 'admin'} />}
          {tab === 'auto' && user.role === 'admin' && <History admin auto />}
          {tab === 'people' && user.role === 'admin' && <People />}
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

/** Decisions, newest first: your own, everyone's for the admin, or the auto-accepted ones. */
function History({ admin, auto = false }: { admin: boolean; auto?: boolean }) {
  const lang = useLang()
  const t = S(lang)
  const [everyone, setEveryone] = useState(auto)
  const [rows, setRows] = useState<Decision[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    const ask = auto ? api.autoAccepted() : api.reviewHistory(everyone)
    ask.then(
      (d) => setRows(d.items),
      (e) => setProblem(errorText(e, lang)),
    )
  }, [auto, everyone, lang])
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
  return (
    <>
      {auto && <p className="hint">{t('autoHint')}</p>}
      {admin && !auto && (
        <nav className="overlay-tabs">
          <button data-on={!everyone} onClick={() => setEveryone(false)}>
            {t('mine')}
          </button>
          <button data-on={everyone} onClick={() => setEveryone(true)}>
            {t('everyone')}
          </button>
        </nav>
      )}
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
