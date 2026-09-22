import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Author, type PublicNote, type Reply } from '../api'
import { sessionLost, useAuth } from '../account/auth'
import { Avatar } from '../account/Avatar'
import { Note, NoteImage } from './NoteContent'

const REPLIES_PAGE = 5

/** Only for your own notes: what the card lets you do to it. */
export interface OwnActions {
  /** Kept in this browser rather than an account: nothing to share or discuss. */
  local: boolean
  onEdit: () => void
  onDelete: () => Promise<void>
}

function Byline({ author, when, mine }: { author: Author | null; when: string; mine: boolean }) {
  return (
    <header className="comment-head">
      <Avatar author={author} size={26} />
      <span className="comment-name">{author?.name ?? 'You'}</span>
      {author?.username && <span className="comment-handle">@{author.username}</span>}
      {mine && <span className="comment-you">you</span>}
      <time dateTime={when} title={new Date(when).toLocaleString()}>
        {ago(when)}
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
                <NoteImage name={name} />
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
            title={
              own
                ? 'Likes on your association'
                : signedIn
                  ? note.liked
                    ? 'Take back your thumbs up'
                    : 'This association helped'
                  : 'Log in to give a thumbs up'
            }
          >
            <ThumbIcon filled={note.liked} />
            <span>{note.likes}</span>
          </button>
        )}
        {shared && (
          <button className="clear" onClick={startReply}>
            reply
          </button>
        )}
        {shared && note.replies > 0 && (
          <button className="clear comment-thread-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'hide replies' : `${note.replies} ${note.replies === 1 ? 'reply' : 'replies'}`}
          </button>
        )}

        {own && (
          <span className="comment-own">
            {own.local ? (
              <span className="comment-badge" title="Only in this browser until you log in">
                in this browser
              </span>
            ) : (
              <span
                className="comment-badge"
                data-public={shared || undefined}
                title={shared ? 'Public: everyone sees it. Change it from edit.' : 'Private: only you see it. Change it from edit.'}
              >
                {shared ? 'public' : 'private'}
              </span>
            )}
            {confirming ? (
              <>
                <span className="tally">delete it?</span>
                <button className="clear comment-danger" disabled={busy} onClick={() => act(own.onDelete)}>
                  yes
                </button>
                <button className="clear" onClick={() => setConfirming(false)}>
                  no
                </button>
              </>
            ) : (
              <>
                <button className="clear" onClick={own.onEdit}>
                  edit
                </button>
                <button className="clear" onClick={() => setConfirming(true)}>
                  delete
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
  // `older` is a prefix of the thread as the server orders it, so its length is
  // the offset of the next page. Replies sent from here go in `newer` and show
  // at the end straight away, until paging reaches them.
  const [older, setOlder] = useState<Reply[]>([])
  const [newer, setNewer] = useState<Reply[]>([])
  const [total, setTotal] = useState(note.replies)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

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
        setProblem('could not load the replies')
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
      setTotal((t) => t + 1)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) sessionLost()
      setProblem(err instanceof Error ? err.message : 'could not send the reply')
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
      setTotal((t) => t - 1)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'could not delete the reply')
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
            delete
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
          {loading ? 'loading' : `show ${Math.min(unloaded, REPLIES_PAGE)} more of ${unloaded}`}
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
            placeholder={`Reply to ${note.author.name}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e)
              if (e.key === 'Escape') onComposing(false)
            }}
          />
          <div className="reply-form-actions">
            <button type="button" className="clear" onClick={() => onComposing(false)}>
              cancel
            </button>
            <button className="account-submit" disabled={sending || !text.trim()}>
              {sending ? 'sending' : 'reply'}
            </button>
          </div>
        </form>
      ) : (
        user && (
          <button className="clear reply-start" onClick={() => onComposing(true)}>
            write a reply
          </button>
        )
      )}
      {problem && <p className="account-problem">{problem}</p>}
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
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

function ago(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit)
  }
  return 'just now'
}
