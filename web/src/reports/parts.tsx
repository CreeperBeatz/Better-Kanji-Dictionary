/** What the reports screen and "Your reports" share. */
import { useEffect, useState } from 'react'
import { api, type ReportFile, type ReportStatus } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    open: 'open',
    fixed: 'fixed',
    not_a_mistake: 'not a mistake',
    duplicate: 'duplicate',
    full: 'open the picture in full size',
  },
  {
    open: 'отворен',
    fixed: 'поправен',
    not_a_mistake: 'не е грешка',
    duplicate: 'повторение',
    full: 'отворете снимката в пълен размер',
  },
)

/** Where a report's subject lives on the site: kanji:生 -> /kanji/生, word:123 -> /word/123. */
export function subjectUrl(subject: string | null): string | null {
  if (subject?.startsWith('kanji:')) return `/kanji/${encodeURIComponent(subject.slice(6))}`
  if (subject?.startsWith('word:')) return `/word/${subject.slice(5)}`
  return null
}

export function StatusChip({ status }: { status: ReportStatus }) {
  const t = S(useLang())
  return (
    <span className="report-status" data-status={status}>
      {t(status)}
    </span>
  )
}

/** A report's picture: fetched with the session (an <img> can't send it), opened full size in a new tab. */
export function ReportPicture({ id, file }: { id: string; file: ReportFile }) {
  const t = S(useLang())
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    let stale = false
    api.reportFile(id, file.name).then(
      (b) => {
        if (stale) return
        u = URL.createObjectURL(b)
        setUrl(u)
      },
      () => {},
    )
    return () => {
      stale = true
      if (u) URL.revokeObjectURL(u)
    }
  }, [id, file.name])
  return (
    <a className="report-thumb" href={url ?? undefined} target="_blank" rel="noopener" title={t('full')}>
      {url ? <img src={url} alt="" /> : <span className="report-thumb-wait" />}
    </a>
  )
}
