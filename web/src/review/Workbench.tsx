import { useCallback, useEffect, useState } from 'react'
import { api, type AdminPeople } from '../api'
import { useAuth } from '../account/auth'
import type { WorkbenchTab } from '../account/Account'
import { Avatar } from '../account/Avatar'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'

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
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

/**
 * The review screen: the labeling queue, your decisions, and for the admin,
 * who reviews. Reviewers and the admin only; the server checks it again.
 */
export function Workbench({ tab, onTab, onClose }: { tab: WorkbenchTab; onTab: (t: WorkbenchTab) => void; onClose: () => void }) {
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
  const tabs: [WorkbenchTab, Key][] = user.role === 'admin' ? [['people', 'people']] : []

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
        <div className="workbench-body">{tab === 'people' && user.role === 'admin' && <People />}</div>
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
