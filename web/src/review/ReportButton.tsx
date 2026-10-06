/**
 * "Something else is wrong?" on every review card: a mistake the card can't
 * fix (the English, a reading, a level, a part's meaning on another card) is
 * sent as a report, which a reviewer checks under Reports. It changes
 * nothing on the site by itself.
 */
import { useState } from 'react'
import { api, type Report } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { ReportEditor } from './editors'

const S = strings(
  {
    open: 'Something else is wrong?',
    title: 'Report a mistake this card can’t fix: it goes to the Reports stage for a reviewer to check',
    send: 'send the report',
    cancel: 'cancel',
    sent: 'Sent. A reviewer will check it under Reports.',
  },
  {
    open: 'Нещо друго не е наред?',
    title: 'Съобщете за грешка, която тази карта не може да поправи: отива в етапа „Доклади“ за проверка от рецензент',
    send: 'изпратете доклада',
    cancel: 'отказ',
    sent: 'Изпратено. Рецензент ще го провери в „Доклади“.',
  },
)

/** `subject`: word:123 or kanji:生; `from`: the card it was sent from, for the reviewer. */
export function ReportButton({ subject, from }: { subject: string; from?: string }) {
  const lang = useLang()
  const t = S(lang)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (sent) return <p className="hint report-sent">{t('sent')}</p>
  if (!open)
    return (
      <button type="button" className="clear report-open" title={t('title')} onClick={() => setOpen(true)}>
        {t('open')}
      </button>
    )

  async function send() {
    if (!value?.text.trim()) return
    setBusy(true)
    setProblem(null)
    try {
      await api.suggest('report', subject, { ...value, text: value.text.trim() }, value.text.trim(), undefined, from)
      setSent(true)
    } catch (e) {
      setProblem(errorText(e, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="report-form">
      <ReportEditor value={value} onChange={setValue} subject={subject} autoFocus />
      {problem && <p className="account-problem">{problem}</p>}
      <p className="report-actions">
        <button type="button" className="account-submit" disabled={busy || !value?.text.trim()} onClick={send}>
          {t('send')}
        </button>
        <button type="button" className="clear" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </p>
    </div>
  )
}
