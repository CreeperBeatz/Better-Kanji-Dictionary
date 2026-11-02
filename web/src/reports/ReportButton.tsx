/**
 * "Report a problem" at the bottom of a kanji's page and a word's card: the
 * one way to say the data is wrong (Dani, 2026-11-02). Free text and up to 3
 * pictures; the page, the language and the screen go with it by themselves.
 * Signed-in users only. A report changes nothing on the site: we check
 * every one and fix the pattern behind it (TASK-reports-first.md).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useAuth } from '../account/auth'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { Overlay } from '../Overlay'

const MAX_TEXT = 4000
const MAX_FILES = 3
const MAX_MB = 5
const TYPES = ['image/png', 'image/jpeg', 'image/webp']

const S = strings(
  {
    open: 'Report a problem',
    title: 'Report a problem with {x}',
    titlePlain: 'Report a problem',
    hint: 'Say what is wrong and where you saw it. If you know the right answer, say how you know it.',
    example: 'For example: "The second meaning group mixes two meanings: 生む and 生える."',
    text: 'What is wrong?',
    pictures: 'Pictures (optional)',
    addPictures: '+ add a picture',
    pasteHint: 'You can also paste a screenshot into the text box.',
    remove: 'remove',
    tooMany: 'Up to {n} pictures.',
    tooBig: '{name} is bigger than {n} MB.',
    badType: '{name} is not a PNG, JPEG or WebP picture.',
    send: 'send the report',
    sending: 'sending…',
    cancel: 'cancel',
    sentTitle: 'Thank you',
    sent: 'We check every report. When we fix it, or decide it is not a mistake, you see it under "Your reports" in your account.',
    close: 'close',
    signIn: 'Sign in to report a problem. We need to know who sent a report, so we can answer you.',
    logIn: 'log in',
  },
  {
    open: 'Съобщете за проблем',
    title: 'Съобщете за проблем с {x}',
    titlePlain: 'Съобщете за проблем',
    hint: 'Кажете какво не е наред и къде го видяхте. Ако знаете верния отговор, кажете откъде го знаете.',
    example: 'Например: „Втората група значения смесва две значения: 生む и 生える.“',
    text: 'Какво не е наред?',
    pictures: 'Снимки (по желание)',
    addPictures: '+ добавете снимка',
    pasteHint: 'Можете и да поставите екранна снимка в полето за текст.',
    remove: 'махнете',
    tooMany: 'До {n} снимки.',
    tooBig: '{name} е по-голяма от {n} MB.',
    badType: '{name} не е снимка PNG, JPEG или WebP.',
    send: 'изпратете доклада',
    sending: 'изпращане…',
    cancel: 'отказ',
    sentTitle: 'Благодарим ви',
    sent: 'Проверяваме всеки доклад. Когато го поправим или решим, че не е грешка, ще го видите в „Вашите доклади“ в профила си.',
    close: 'затворете',
    signIn: 'Влезте, за да съобщите за проблем. Трябва да знаем кой е изпратил доклада, за да ви отговорим.',
    logIn: 'вход',
  },
)

/** `subject`: kanji:生 or word:123; `of`: how the dialog names it; `from`: which part of the app, for us. */
export function ReportButton({ subject, of, from, onSignIn }: { subject: string; of: string; from: string; onSignIn?: () => void }) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  return (
    <p className="page-edit">
      <button className="clear page-edit-link" onClick={() => setOpen(true)}>
        {t('open')}
      </button>
      {/* On the body: a page in the rail is a box of its own (it slides), which would clip a fixed overlay. */}
      {open &&
        createPortal(
          <ReportDialog
            subject={subject}
            of={of}
            from={from}
            onClose={() => setOpen(false)}
            onSignIn={
              onSignIn &&
              (() => {
                setOpen(false)
                onSignIn()
              })
            }
          />,
          document.body,
        )}
    </p>
  )
}

function ReportDialog({
  subject,
  of,
  from,
  onClose,
  onSignIn,
}: {
  subject: string | null
  of?: string
  from: string
  onClose: () => void
  onSignIn?: () => void
}) {
  const lang = useLang()
  const t = S(lang)
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const title = of ? t('title', { x: of }) : t('titlePlain')

  function add(list: Iterable<File>) {
    const next = [...files]
    for (const f of list) {
      if (!TYPES.includes(f.type)) return setProblem(t('badType', { name: f.name || 'picture' }))
      if (f.size > MAX_MB * 1024 * 1024) return setProblem(t('tooBig', { name: f.name || 'picture', n: MAX_MB }))
      if (next.length >= MAX_FILES) return setProblem(t('tooMany', { n: MAX_FILES }))
      next.push(f)
    }
    setProblem(null)
    setFiles(next)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setProblem(null)
    try {
      await api.sendReport(text.trim(), subject, {
        url: window.location.pathname + window.location.search,
        lang,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        from,
      }, files)
      setSent(true)
    } catch (err) {
      setProblem(errorText(err, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay panel="account-panel report-panel" label={title} onClose={onClose}>
      {sent ? (
        <>
          <h2>{t('sentTitle')}</h2>
          <p className="hint">{t('sent')}</p>
          <p className="assoc-actions">
            <button className="account-submit" onClick={onClose} autoFocus>
              {t('close')}
            </button>
          </p>
        </>
      ) : !user ? (
        <>
          <h2>{title}</h2>
          <p className="hint">{t('signIn')}</p>
          {onSignIn && (
            <p className="assoc-actions">
              <button className="account-submit" onClick={onSignIn}>
                {t('logIn')}
              </button>
            </p>
          )}
        </>
      ) : (
        <form className="account-form report-form" onSubmit={submit}>
          <h2 lang={of ? 'ja' : undefined}>{title}</h2>
          <p className="hint">{t('hint')}</p>
          <p className="hint report-example">{t('example')}</p>
          <label htmlFor="report-text">{t('text')}</label>
          <textarea
            id="report-text"
            className="assoc-text"
            rows={6}
            autoFocus
            maxLength={MAX_TEXT}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pics = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
              if (pics.length) {
                e.preventDefault()
                add(pics)
              }
            }}
          />
          <span className="tally report-count">{text.length > MAX_TEXT * 0.8 ? `${text.length} / ${MAX_TEXT}` : ''}</span>

          <span className="report-label">{t('pictures')}</span>
          <div className="report-files">
            {files.map((f, i) => (
              <Thumb key={i} file={f} label={t('remove')} onRemove={() => setFiles(files.filter((_, k) => k !== i))} />
            ))}
            {files.length < MAX_FILES && (
              <button type="button" className="clear report-add" onClick={() => picker.current?.click()}>
                {t('addPictures')}
              </button>
            )}
            <input
              ref={picker}
              type="file"
              accept={TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) add(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          <p className="hint report-paste">{t('pasteHint')}</p>

          {problem && <p className="account-problem">{problem}</p>}
          <div className="account-row profile-save">
            <button type="button" className="clear" onClick={onClose}>
              {t('cancel')}
            </button>
            <button className="account-submit" disabled={busy || !text.trim()}>
              {busy ? t('sending') : t('send')}
            </button>
          </div>
        </form>
      )}
    </Overlay>
  )
}

function Thumb({ file, label, onRemove }: { file: File; label: string; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return (
    <span className="report-thumb">
      {url && <img src={url} alt={file.name} />}
      <button type="button" className="report-thumb-x" onClick={onRemove} aria-label={label} title={label}>
        ×
      </button>
    </span>
  )
}
