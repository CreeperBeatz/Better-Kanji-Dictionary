/**
 * The admin's screen at /reports: every report, newest first, each linking
 * to the kanji or word it is about. Here the admin reads them and sets what
 * became of them. Checking and fixing happen in Claude Code
 * (python -m server.reports export / close), not here.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type Author, type ReportStatus, type UserReport } from '../api'
import { useAuth } from '../account/auth'
import { Avatar } from '../account/Avatar'
import { localeOf, strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { useKey } from '../keys'
import { ReportPicture, StatusChip, subjectUrl } from './parts'

export const STATUSES: ReportStatus[] = ['open', 'fixed', 'not_a_mistake', 'duplicate']

const S = strings(
  {
    title: 'Reports',
    hint: 'Users send these from the kanji and word pages. We check them and fix them in Claude Code. Here you read them and set their status.',
    exit: 'Close',
    all: 'All',
    s_open: 'Open',
    s_fixed: 'Fixed',
    s_not_a_mistake: 'Not a mistake',
    s_duplicate: 'Duplicate',
    none: 'No reports here.',
    loading: 'loading…',
    gateTitle: 'Reports',
    gateSignedOut: 'This screen is for the site’s owner. Sign in to open it.',
    gateUser: 'This screen is for the site’s owner.',
    signIn: 'Sign in',
    back: 'Back to the dictionary',
    general: 'no page',
    context: 'Sent from',
    reply: 'Reply the reporter sees (optional)',
    save: 'save',
    saved: 'saved',
    closed: 'set {date}',
  },
  {
    title: 'Доклади',
    hint: 'Потребителите ги изпращат от страниците на канджи и думи. Проверяваме ги и ги поправяме в Claude Code. Тук ги четете и им задавате състояние.',
    exit: 'Затворете',
    all: 'Всички',
    s_open: 'Отворени',
    s_fixed: 'Поправени',
    s_not_a_mistake: 'Не е грешка',
    s_duplicate: 'Повторение',
    none: 'Тук няма доклади.',
    loading: 'зарежда се…',
    gateTitle: 'Доклади',
    gateSignedOut: 'Този екран е за собственика на сайта. Влезте, за да го отворите.',
    gateUser: 'Този екран е за собственика на сайта.',
    signIn: 'Вход',
    back: 'Обратно към речника',
    general: 'без страница',
    context: 'Изпратен от',
    reply: 'Отговор, който подателят вижда (по желание)',
    save: 'запазете',
    saved: 'запазено',
    closed: 'зададено {date}',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
type People = Record<string, Author & { email: string }>

export function ReportsScreen({ onClose, onSignIn }: { onClose: () => void; onSignIn?: () => void }) {
  const lang = useLang()
  const t = S(lang)
  const { user, ready } = useAuth()
  const [status, setStatus] = useState<ReportStatus | null>('open')
  const [rows, setRows] = useState<UserReport[] | null>(null)
  const [people, setPeople] = useState<People>({})
  const [counts, setCounts] = useState<Record<ReportStatus, number> | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const admin = user?.role === 'admin'

  useKey((e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    onClose()
  })

  const load = useCallback(() => {
    if (!admin) return
    api.reports(status ?? undefined).then(
      (d) => {
        setRows(d.items)
        setPeople(d.people)
        setCounts(d.counts)
      },
      (e) => setProblem(errorText(e, lang)),
    )
  }, [admin, status, lang])
  useEffect(load, [load])

  if (!ready || !admin)
    return (
      <div className="overlay workbench-screen">
        <div className="overlay-panel workbench workbench-gate" role="dialog" aria-modal="true" aria-label={t('gateTitle')}>
          {!ready ? (
            <p className="hint">{t('loading')}</p>
          ) : (
            <>
              <h2>{t('gateTitle')}</h2>
              <p>{t(user ? 'gateUser' : 'gateSignedOut')}</p>
              <p className="workbench-gate-actions">
                {!user && onSignIn && (
                  <button className="account-submit" onClick={onSignIn}>
                    {t('signIn')}
                  </button>
                )}
                <button className="clear" onClick={onClose}>
                  {t('back')}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    )

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null
  const tabs: (ReportStatus | null)[] = [...STATUSES, null]
  return (
    <div className="overlay workbench-screen">
      <div className="overlay-panel workbench" role="dialog" aria-modal="true" aria-label={t('title')}>
        <header className="workbench-head">
          <nav className="overlay-tabs" role="tablist">
            {tabs.map((s) => (
              <button key={s ?? 'all'} role="tab" aria-selected={status === s} data-on={status === s} onClick={() => setStatus(s)}>
                {s ? t(`s_${s}` as Key) : t('all')}
                <span className="reports-count">{s ? (counts?.[s] ?? '') : (total ?? '')}</span>
              </button>
            ))}
          </nav>
          <div className="workbench-mode">
            <button className="workbench-exit" onClick={onClose} title="Esc">
              {t('exit')}
            </button>
          </div>
        </header>
        <div className="workbench-body reports-body">
          <p className="hint reports-hint">{t('hint')}</p>
          {problem && <p className="account-problem">{problem}</p>}
          {rows === null && !problem && <p className="hint">{t('loading')}</p>}
          {rows?.length === 0 && <p className="hint">{t('none')}</p>}
          <ul className="reports-list">
            {rows?.map((r) => (
              <ReportRow key={r.id} report={r} who={people[r.by]} onChanged={load} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function ReportRow({ report: r, who, onChanged }: { report: UserReport; who?: Author & { email: string }; onChanged: () => void }) {
  const lang = useLang()
  const t = S(lang)
  const [status, setStatus] = useState<ReportStatus>(r.status)
  const [reply, setReply] = useState(r.reply ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const changed = status !== r.status || reply.trim() !== (r.reply ?? '')
  const when = (iso: string) => new Date(iso).toLocaleString(localeOf(lang), { dateStyle: 'medium', timeStyle: 'short' })
  const url = subjectUrl(r.subject)
  const ctx = Object.entries(r.context ?? {}).filter(([, v]) => v)

  async function save() {
    setBusy(true)
    setProblem(null)
    try {
      await api.setReportStatus(r.id, status, reply.trim() || null)
      setSaved(true)
      onChanged()
    } catch (e) {
      setProblem(errorText(e, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="report-row" data-status={r.status}>
      <div className="report-subject" data-long={[...(r.label ?? r.subject ?? '')].length > 1 || undefined}>
        {url ? (
          <a href={url} target="_blank" rel="noopener" lang="ja" title={r.subject ?? undefined}>
            {r.label ?? r.subject}
          </a>
        ) : (
          <span className="hint">{t('general')}</span>
        )}
      </div>
      <div className="report-main">
        <p className="report-meta">
          {who && <Avatar author={who} size={20} />}
          <strong>{who?.name ?? r.by}</strong>
          {who?.username && <span className="hint">@{who.username}</span>}
          {who?.email && <span className="hint">{who.email}</span>}
          <span className="hint">· {when(r.created)}</span>
          <StatusChip status={r.status} />
        </p>
        <p className="report-text">{r.text}</p>
        {r.files.length > 0 && (
          <div className="report-files">
            {r.files.map((f) => (
              <ReportPicture key={f.name} id={r.id} file={f} />
            ))}
          </div>
        )}
        {ctx.length > 0 && (
          <details className="report-context">
            <summary>{t('context')}</summary>
            <dl>
              {ctx.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        <div className="report-actions">
          <div className="report-statuses" role="radiogroup">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                data-on={status === s || undefined}
                onClick={() => {
                  setStatus(s)
                  setSaved(false)
                }}
              >
                {t(`s_${s}` as Key)}
              </button>
            ))}
          </div>
          <textarea
            className="assoc-text report-reply"
            rows={2}
            placeholder={t('reply')}
            aria-label={t('reply')}
            maxLength={1000}
            value={reply}
            onChange={(e) => {
              setReply(e.target.value)
              setSaved(false)
            }}
          />
          <button className="account-submit" disabled={busy || !changed} onClick={save}>
            {t('save')}
          </button>
          <span className="tally">{saved && !changed ? t('saved') : r.closed_at ? t('closed', { date: when(r.closed_at) }) : ''}</span>
        </div>
        {problem && <p className="account-problem">{problem}</p>}
      </div>
    </li>
  )
}
