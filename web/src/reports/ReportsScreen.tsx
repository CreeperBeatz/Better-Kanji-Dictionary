/**
 * The admin's screen at /reports: every report, newest first, each linking
 * to the kanji or word it is about. Here the admin reads them and sets what
 * became of them. Checking and fixing happen in Claude Code
 * (python -m server.reports export / close), not here.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Author, type ReportStatus, type UserReport } from '../api'
import { useAuth } from '../account/auth'
import { Avatar } from '../account/Avatar'
import { localeOf, strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { typing, useKey } from '../keys'
import { ReportPicture, StatusChip, subjectUrl } from './parts'

export const STATUSES: ReportStatus[] = ['open', 'fixed', 'not_a_mistake', 'duplicate']
// Rows asked for at a time; the server gives up to 500 in one answer.
const PAGE = 200
const MAX_PAGE = 500

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
    general: 'no page',
    context: 'Sent from',
    reply: 'Reply the reporter sees (optional)',
    save: 'save',
    saved: 'saved',
    closed: 'set {date}',
    status: 'Status',
    openPage: 'Open the page it was sent from',
    more: 'show more ({n})',
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
    general: 'без страница',
    context: 'Изпратен от',
    reply: 'Отговор, който подателят вижда (по желание)',
    save: 'запазете',
    saved: 'запазено',
    closed: 'зададено {date}',
    status: 'Състояние',
    openPage: 'Отворете страницата, от която е изпратен',
    more: 'покажете още ({n})',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
type People = Record<string, Author & { email: string }>

/** A path on this site, never another host: the browser reads //x and /\x as hosts. */
function sitePath(url: string | undefined): url is string {
  if (!url?.startsWith('/')) return false
  try {
    return new URL(url, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

export function ReportsScreen({ onClose }: { onClose: () => void }) {
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
    // Not from a field: Escape in the reply box must not close the screen and lose what was typed.
    if (e.key !== 'Escape' || e.defaultPrevented || typing(e.target)) return
    e.preventDefault()
    onClose()
  })

  // Only the latest load's answer is shown: a slower one for a tab left already is dropped.
  const asked = useRef(0)
  // How many rows are shown, so a reload after a save keeps the pages loaded with "show more".
  const shown = useRef(0)
  const langRef = useRef(lang)
  useEffect(() => {
    shown.current = rows?.length ?? 0
    langRef.current = lang
  })
  const fetchRows = useCallback(
    (offset: number, limit: number, done: (d: Awaited<ReturnType<typeof api.reports>>) => void) => {
      if (!admin) return
      const n = ++asked.current
      api.reports(status ?? undefined, offset, limit).then(
        (d) => {
          if (n !== asked.current) return
          setProblem(null)
          setCounts(d.counts)
          done(d)
        },
        (e) => n === asked.current && setProblem(errorText(e, langRef.current)),
      )
    },
    [admin, status],
  )
  const load = useCallback(
    () =>
      fetchRows(0, Math.min(MAX_PAGE, Math.max(PAGE, shown.current)), (d) => {
        setRows(d.items)
        setPeople(d.people)
      }),
    [fetchRows],
  )
  const more = () =>
    fetchRows(shown.current, PAGE, (d) => {
      setRows((rs) => [...(rs ?? []), ...d.items])
      setPeople((p) => ({ ...p, ...d.people }))
    })
  useEffect(load, [load])

  // Anyone else who lands on /reports just gets the dictionary, with no word that the
  // screen exists. While the account loads, nothing is drawn.
  useEffect(() => {
    if (ready && !admin) onClose()
  }, [ready, admin, onClose])
  if (!admin) return null

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null
  const tabs: (ReportStatus | null)[] = [...STATUSES, null]
  // How many this tab holds in all; the list shows them a page at a time.
  const wanted = status ? (counts?.[status] ?? null) : total
  return (
    <div className="overlay workbench-screen">
      <div className="overlay-panel workbench" role="dialog" aria-modal="true" aria-label={t('title')}>
        <header className="workbench-head">
          <nav className="overlay-tabs" role="tablist">
            {tabs.map((s) => (
              <button
                key={s ?? 'all'}
                role="tab"
                aria-selected={status === s}
                data-on={status === s}
                onClick={() => {
                  if (s === status) return
                  // The new tab's rows, not the last tab's, under it while they load.
                  setRows(null)
                  setProblem(null)
                  setStatus(s)
                }}
              >
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
          {rows && wanted !== null && rows.length < wanted && (
            <button className="discussion-more" onClick={more}>
              {t('more', { n: wanted - rows.length })}
            </button>
          )}
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
  // A reload brought a different status or reply (set in Claude Code, say): show that, so a
  // save does not quietly put back what the row was first drawn with.
  const [drawn, setDrawn] = useState({ status: r.status, reply: r.reply })
  if (drawn.status !== r.status || drawn.reply !== r.reply) {
    setDrawn({ status: r.status, reply: r.reply })
    setStatus(r.status)
    setReply(r.reply ?? '')
  }
  const changed = status !== r.status || reply.trim() !== (r.reply ?? '')
  const when = (iso: string) => new Date(iso).toLocaleString(localeOf(lang), { dateStyle: 'medium', timeStyle: 'short' })
  const url = subjectUrl(r.subject)
  // The page as the reporter had it open (their own address), else the subject's page.
  // The reporter sends it, so only a path on this site: //host or /\host would leave it.
  const sentFrom = r.context?.url
  const page = (sitePath(sentFrom) ? sentFrom : null) ?? url
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
        {page && (
          <p className="report-open">
            <a className="clear" href={page} target="_blank" rel="noopener">
              {t('openPage')} →
            </a>
          </p>
        )}
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
          <select
            className="assoc-text report-status-pick"
            aria-label={t('status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ReportStatus)
              setSaved(false)
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`s_${s}` as Key)}
              </option>
            ))}
          </select>
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
