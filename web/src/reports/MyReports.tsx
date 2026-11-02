/** "Your reports" in the account popup: what you sent and what became of it. */
import { useEffect, useState } from 'react'
import { api, type MyReport } from '../api'
import { localeOf, strings, useLang } from '../i18n'
import { ReportPicture, StatusChip, subjectUrl } from './parts'

const S = strings(
  {
    title: 'Your reports',
    none: 'You have not sent a report yet. To send one, use "Report a problem" at the bottom of a kanji or word page.',
    general: 'no page',
    reply: 'Our answer:',
  },
  {
    title: 'Вашите доклади',
    none: 'Още не сте изпратили доклад. За да изпратите, използвайте „Съобщете за проблем“ най-долу на страница на канджи или дума.',
    general: 'без страница',
    reply: 'Нашият отговор:',
  },
)

export function MyReports() {
  const lang = useLang()
  const t = S(lang)
  const [rows, setRows] = useState<MyReport[] | null>(null)
  useEffect(() => {
    let stale = false
    api.myReports().then(
      (d) => !stale && setRows(d.items),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [])
  if (rows === null) return null
  const date = (iso: string) => new Date(iso).toLocaleDateString(localeOf(lang))
  return (
    <details className="account-contribute my-reports" open={rows.some((r) => r.status === 'open') || undefined}>
      <summary>
        {t('title')}
        {rows.length > 0 && <span className="tally"> {rows.length}</span>}
      </summary>
      {rows.length === 0 && <p className="hint">{t('none')}</p>}
      <ul className="my-reports-list">
        {rows.map((r) => {
          const url = subjectUrl(r.subject)
          return (
            <li key={r.id}>
              <p className="report-meta">
                {url ? (
                  <a href={url} lang="ja">
                    {r.label ?? r.subject}
                  </a>
                ) : (
                  <span className="hint">{t('general')}</span>
                )}
                <span className="hint">· {date(r.created)}</span>
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
              {r.reply && (
                <p className="report-reply-shown">
                  <b>{t('reply')}</b> {r.reply}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
