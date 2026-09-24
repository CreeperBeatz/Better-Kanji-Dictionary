import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Author, type PublicNote, type Reply } from '../api'
import { sessionLost, useAuth } from '../account/auth'
import { Avatar } from '../account/Avatar'
import { getLang, strings, useLang, type Lang } from '../i18n'
import { errorText } from '../i18n/errors'
import { Note, NoteImage } from './NoteContent'

const S = strings(
  {
    you: 'You',
    youBadge: 'you',
    likesYours: 'Likes on your association',
    unlike: 'Take back your thumbs up',
    like: 'This association helped',
    logInToLike: 'Log in to give a thumbs up',
    reply: 'reply',
    hideReplies: 'hide replies',
    replies_one: '{n} reply',
    replies_other: '{n} replies',
    browserOnlyTitle: 'Only in this browser until you log in',
    browserOnly: 'in this browser',
    publicTitle: 'Public: everyone sees it. Change it from edit.',
    privateTitle: 'Private: only you see it. Change it from edit.',
    public: 'public',
    private: 'private',
    deleteIt: 'delete it?',
    yes: 'yes',
    no: 'no',
    edit: 'edit',
    delete: 'delete',
    loadRepliesFailed: 'could not load the replies',
    sendFailed: 'could not send the reply',
    deleteFailed: 'could not delete the reply',
    loading: 'loading',
    showMoreOf: 'show {n} more of {total}',
    replyTo: 'Reply to {name}',
    cancel: 'cancel',
    sending: 'sending',
    writeReply: 'write a reply',
    justNow: 'just now',
  },
  {
    you: 'Вие',
    youBadge: 'вие',
    likesYours: 'Харесвания на вашата асоциация',
    unlike: 'Оттеглете палеца нагоре',
    like: 'Тази асоциация помогна',
    logInToLike: 'Влезте, за да дадете палец нагоре',
    reply: 'отговорете',
    hideReplies: 'скрийте отговорите',
    replies_one: '{n} отговор',
    replies_other: '{n} отговора',
    browserOnlyTitle: 'Само в този браузър, докато не влезете',
    browserOnly: 'в този браузър',
    publicTitle: 'Публична: всички я виждат. Променя се от „редактирайте“.',
    privateTitle: 'Лична: само вие я виждате. Променя се от „редактирайте“.',
    public: 'публична',
    private: 'лична',
    deleteIt: 'да се изтрие ли?',
    yes: 'да',
    no: 'не',
    edit: 'редактирайте',
    delete: 'изтрийте',
    loadRepliesFailed: 'отговорите не можаха да се заредят',
    sendFailed: 'отговорът не можа да се изпрати',
    deleteFailed: 'отговорът не можа да се изтрие',
    loading: 'зареждане',
    showMoreOf: 'покажете още {n} от {total}',
    replyTo: 'Отговор на {name}',
    cancel: 'откажете',
    sending: 'изпращане',
    writeReply: 'напишете отговор',
    justNow: 'току-що',
  },
)

/** A problem to show: one of ours, by key, so it follows the language, or the server's own words. */
type Problem = { key: 'loadRepliesFailed' | 'sendFailed' | 'deleteFailed' } | { text: string }

const REPLIES_PAGE = 5

/** Only for your own notes: what the card lets you do to it. */
export interface OwnActions {
  /** Kept in this browser rather than an account: nothing to share or discuss. */
  local: boolean
  onEdit: () => void
  onDelete: () => Promise<void>
}

function Byline({ author, when, mine }: { author: Author | null; when: string; mine: boolean }) {
  const lang = useLang()
  const t = S(lang)
  return (
    <header className="comment-head">
      <Avatar author={author} size={26} />
      <span className="comment-name">{author?.name ?? t('you')}</span>
      {author?.username && <span className="comment-handle">@{author.username}</span>}
      {mine && <span className="comment-you">{t('youBadge')}</span>}
      <time dateTime={when} title={new Date(when).toLocaleString(lang)}>
        {ago(when, lang)}
      </time>
    </header>
  )
}

/**
 * One association, in its own box. Someone else's public note can be liked
 * and replied to; your own can be edited and deleted. Whether yours is public
 * is shown here but changed only from edit, so a stray tap cannot publish it.
 */
export function CommentCard({
  note,
  signedIn,
  own,
  onSignIn,
  onChange,
}: {
  note: PublicNote
  signedIn: boolean
  own?: OwnActions
  onSignIn: () => void
  onChange: (id: string, change: Partial<PublicNote>) => void
}) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  // Stable, since the thread reports its count from an effect.
  const onCount = useCallback((n: number) => onChange(note.id, { replies: n }), [note.id, onChange])
  const shared = note.visibility === 'public' && !own?.local

  async function toggleLike() {
    if (!signedIn) return onSignIn()
    const liked = !note.liked
    // Optimistic: the thumb answers at once, and is put back if the server says no.
    onChange(note.id, { liked, likes: note.likes + (liked ? 1 : -1) })
    try {
      const res = await api.like(note.id, liked)
      onChange(note.id, { liked: res.liked, likes: res.likes })
    } catch (e) {
      onChange(note.id, { liked: note.liked, likes: note.likes })
      if (e instanceof ApiError && e.status === 401) sessionLost()
    }
  }

  function startReply() {
    if (!signedIn) return onSignIn()
    setOpen(true)
    setComposing(true)
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="comment" data-private={(own && !shared) || undefined}>
      <Byline author={own?.local ? null : note.author} when={note.created} mine={Boolean(own)} />
      <div className="comment-body">
        {note.text && <Note text={note.text} />}
        {note.images.length > 0 && (
          <div className="assoc-images">
            {note.images.map((name) => (
              <figure key={name}>
                <NoteImage name={name} zoomable />
              </figure>
            ))}
          </div>
        )}
      </div>
      <footer className="comment-actions">
        {shared && (
          <button
            className="comment-like"
            aria-pressed={note.liked}
            disabled={Boolean(own)}
            onClick={toggleLike}
            title={t(own ? 'likesYours' : signedIn ? (note.liked ? 'unlike' : 'like') : 'logInToLike')}
          >
            <ThumbIcon filled={note.liked} />
            <span>{note.likes}</span>
          </button>
        )}
        {shared && (
          <button className="clear" onClick={startReply}>
            {t('reply')}
          </button>
        )}
        {shared && note.replies > 0 && (
          <button className="clear comment-thread-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? t('hideReplies') : t.plural('replies', note.replies)}
          </button>
        )}

        {own && (
          <span className="comment-own">
            {own.local ? (
              <span className="comment-badge" title={t('browserOnlyTitle')}>
                {t('browserOnly')}
              </span>
            ) : (
              <span
                className="comment-badge"
                data-public={shared || undefined}
                title={t(shared ? 'publicTitle' : 'privateTitle')}
              >
                {t(shared ? 'public' : 'private')}
              </span>
            )}
            {confirming ? (
              <>
                <span className="tally">{t('deleteIt')}</span>
                <button className="clear comment-danger" disabled={busy} onClick={() => act(own.onDelete)}>
                  {t('yes')}
                </button>
                <button className="clear" onClick={() => setConfirming(false)}>
                  {t('no')}
                </button>
              </>
            ) : (
              <>
                <button className="clear" onClick={own.onEdit}>
                  {t('edit')}
                </button>
                <button className="clear" onClick={() => setConfirming(true)}>
                  {t('delete')}
                </button>
              </>
            )}
          </span>
        )}
      </footer>
      {open && shared && (
        <Replies note={note} composing={composing} onComposing={setComposing} onCount={onCount} />
      )}
    </article>
  )
}

function Replies({
  note,
  composing,
  onComposing,
  onCount,
}: {
  note: PublicNote
  composing: boolean
  onComposing: (on: boolean) => void
  onCount: (n: number) => void
}) {
  const { user } = useAuth()
  const t = S(useLang())
  // `older` is a prefix of the thread as the server orders it, so its length is
  // the offset of the next page. Replies sent from here go in `newer` and show
  // at the end straight away, until paging reaches them.
  const [older, setOlder] = useState<Reply[]>([])
  const [newer, setNewer] = useState<Reply[]>([])
  const [total, setTotal] = useState(note.replies)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)

  const loadMore = useCallback(
    async (offset: number) => {
      setLoading(true)
      try {
        const page = await api.replies(note.id, offset, REPLIES_PAGE)
        const ids = new Set(page.items.map((r) => r.id))
        setOlder((prev) => [...prev.slice(0, offset), ...page.items])
        setNewer((prev) => prev.filter((r) => !ids.has(r.id)))
        setTotal(page.total)
      } catch {
        setProblem({ key: 'loadRepliesFailed' })
      } finally {
        setLoading(false)
      }
    },
    [note.id],
  )

  useEffect(() => {
    loadMore(0)
  }, [loadMore])

  useEffect(() => onCount(total), [total, onCount])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setSending(true)
    setProblem(null)
    try {
      const reply = await api.reply(note.id, body)
      setText('')
      onComposing(false)
      // Replies read oldest first, so a new one belongs at the end -- shown
      // straight away even if earlier pages are still unopened.
      setNewer((prev) => [...prev, reply])
      setTotal((n) => n + 1)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) sessionLost()
      setProblem(err instanceof Error ? { text: errorText(err, getLang()) } : { key: 'sendFailed' })
    } finally {
      setSending(false)
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteReply(id)
      // Dropping one from `older` shifts the server's offsets down by one too.
      setOlder((prev) => prev.filter((r) => r.id !== id))
      setNewer((prev) => prev.filter((r) => r.id !== id))
      setTotal((n) => n - 1)
    } catch (err) {
      setProblem(err instanceof Error ? { text: errorText(err, getLang()) } : { key: 'deleteFailed' })
    }
  }

  const unloaded = total - older.length - newer.length
  const reply = (r: Reply) => (
    <div key={r.id} className="reply">
      <Byline author={r.author} when={r.created} mine={r.mine} />
      <div className="comment-body">
        <Note text={r.text} />
      </div>
      {r.mine && (
        <footer className="comment-actions">
          <button className="clear" onClick={() => remove(r.id)}>
            {t('delete')}
          </button>
        </footer>
      )}
    </div>
  )

  return (
    <div className="replies">
      {older.map(reply)}
      {unloaded > 0 && (
        <button className="discussion-more" disabled={loading} onClick={() => loadMore(older.length)}>
          {loading ? t('loading') : t('showMoreOf', { n: Math.min(unloaded, REPLIES_PAGE), total: unloaded })}
        </button>
      )}
      {newer.map(reply)}

      {user && composing ? (
        <form className="reply-form" onSubmit={send}>
          <Avatar author={user} size={22} />
          <textarea
            className="assoc-text"
            value={text}
            autoFocus
            maxLength={2000}
            rows={Math.min(8, Math.max(2, text.split('\n').length))}
            placeholder={t('replyTo', { name: note.author.name })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e)
              if (e.key === 'Escape') onComposing(false)
            }}
          />
          <div className="reply-form-actions">
            <button type="button" className="clear" onClick={() => onComposing(false)}>
              {t('cancel')}
            </button>
            <button className="account-submit" disabled={sending || !text.trim()}>
              {sending ? t('sending') : t('reply')}
            </button>
          </div>
        </form>
      ) : (
        user && (
          <button className="clear reply-start" onClick={() => onComposing(true)}>
            {t('writeReply')}
          </button>
        )
      )}
      {problem && <p className="account-problem">{'key' in problem ? t(problem.key) : problem.text}</p>}
    </div>
  )
}

function ThumbIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M7 10v11H3V10h4Zm2 11V10l4.5-7.5c1.4 0 2.5 1.1 2.5 2.5v3.5h4.3c1.3 0 2.2 1.2 1.9 2.4l-2 7.6c-.2.9-1 1.5-1.9 1.5H9Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]
const relative: Partial<Record<Lang, Intl.RelativeTimeFormat>> = {}

function ago(iso: string, lang: Lang): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  const format = (relative[lang] ??= new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }))
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit)
  }
  return S(lang)('justNow')
}
