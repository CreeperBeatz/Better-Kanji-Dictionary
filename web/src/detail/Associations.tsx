import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type NoteSort, type PublicNote, type Visibility } from '../api'
import { sessionLost, useAuth } from '../account/auth'
import {
  createNote,
  deleteNote,
  drawingsAmong,
  notesFor,
  updateNote,
  type LocalNote,
} from '../localNotes'
import { CommentCard } from './CommentCard'
import { Composer, savedAttachments } from './Composer'
import { Note } from './NoteContent'

const PAGE = 10
const SORT_KEY = 'betterrtk:sort'

interface Props {
  char: string
  onPick: (char: string) => void
  onSignIn: () => void
  /** How many associations there are here, yours and others', for the tab. */
  onCount: (n: number) => void
}

function rememberedSort(): NoteSort {
  try {
    return localStorage.getItem(SORT_KEY) === 'new' ? 'new' : 'liked'
  } catch {
    return 'liked'
  }
}

/** A browser-only note, shaped like a server one so the same card shows it. */
function localView(n: LocalNote, drawings: string[]): PublicNote {
  return {
    id: n.id,
    char: n.char,
    author: { id: 'local', name: 'You', username: null, avatar: null },
    text: n.text,
    images: n.images,
    drawings,
    visibility: 'private',
    created: n.created,
    updated: n.updated,
    likes: 0,
    liked: false,
    replies: 0,
    mine: true,
  }
}

/**
 * The associations tab: write one like a comment, then yours (private before
 * public) and everyone else's public ones, most liked or newest first.
 *
 * Signed out, your associations live in this browser (localNotes.ts) and move
 * into your account when you log in. Others' public ones come from the server
 * either way.
 */
export function Associations({ char, onPick, onSignIn, onCount }: Props) {
  const { user, ready, syncing } = useAuth()
  const me = user?.id ?? null
  const [sort, setSortState] = useState<NoteSort>(rememberedSort)
  const [mine, setMine] = useState<PublicNote[]>([])
  const [others, setOthers] = useState<PublicNote[]>([])
  const [total, setTotal] = useState(0)
  const [shown, setShown] = useState(PAGE)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [parts, setParts] = useState<{ char: string; texts: string[] }[]>([])
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    setShown(PAGE)
    setEditing(null)
    setMine([])
    setOthers([])
    setTotal(0)
  }, [char])

  function setSort(s: NoteSort) {
    setSortState(s)
    setShown(PAGE)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      // not remembered, which is fine
    }
  }

  useEffect(() => {
    if (!ready || syncing) return
    let stale = false
    setLoading(true)
    ;(async () => {
      const page = await api.notesFor(char, sort, 0, shown).catch(() => null)
      let own: PublicNote[] = page?.mine ?? []
      if (!me) {
        const local = await notesFor(char).catch(() => [])
        own = await Promise.all(
          local.map(async (n) => localView(n, await drawingsAmong(n.images).catch(() => []))),
        )
      }
      if (stale) return
      setMine(own)
      setOthers(page?.items ?? [])
      setTotal(page?.total ?? 0)
      setFailed(page === null)
      setLoading(false)
    })()
    return () => {
      stale = true
    }
  }, [char, me, ready, syncing, sort, shown, version])

  // What you wrote on this character's parts, so a mnemonic can build on them.
  useEffect(() => {
    if (!ready || syncing) return
    let stale = false
    ;(async () => {
      const d = await api.associations(char).catch(() => null)
      const comps = d?.components ?? []
      const found = me
        ? comps.map((c) => ({ char: c.char, texts: c.notes.map((n) => n.text) }))
        : await Promise.all(
            comps.map(async (c) => ({
              char: c.char,
              texts: (await notesFor(c.char).catch(() => [])).map((n) => n.text),
            })),
          )
      if (!stale) setParts(found.map((p) => ({ ...p, texts: p.texts.filter((t) => t.trim()) })))
    })()
    return () => {
      stale = true
    }
  }, [char, me, ready, syncing, version])

  useEffect(() => onCount(mine.length + total), [mine.length, total, onCount])

  const patch = useCallback((id: string, change: Partial<PublicNote>) => {
    const apply = (ns: PublicNote[]) => ns.map((n) => (n.id === id ? { ...n, ...change } : n))
    setOthers(apply)
    setMine(apply)
  }, [])

  async function post(text: string, images: string[], visibility: Visibility) {
    if (me) {
      try {
        await api.postAssociation(char, text, images, visibility)
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e
        // Signed out under us: keep it in the browser instead, where it is
        // picked up again at the next sign-in.
        await createNote(char, text, images)
        sessionLost()
      }
    } else {
      await createNote(char, text, images)
    }
    reload()
  }

  function ownActions(n: PublicNote) {
    const local = !me
    return {
      local,
      onEdit: () => setEditing(n.id),
      onDelete: async () => {
        if (local) await deleteNote(n.id)
        else await api.deleteAssociation(n.id)
        reload()
      },
    }
  }

  async function saveEdit(n: PublicNote, text: string, images: string[], visibility: Visibility) {
    if (me) await api.editAssociation(n.id, { text, images, visibility })
    else await updateNote(n.id, text, images)
    setEditing(null)
    reload()
  }

  const noted = parts.filter((p) => p.texts.length > 0)

  return (
    <section className="rail-section assoc-tab">
      <Composer key={char} char={char} author={user} draftKey={char} onSubmit={post} onSignIn={onSignIn} />

      {noted.length > 0 && (
        <div className="assoc-parts">
          <h3>From its parts</h3>
          {noted.map((p) => (
            <div key={p.char} className="assoc-part">
              <button className="assoc-part-glyph" onClick={() => onPick(p.char)}>
                {p.char}
              </button>
              <div>
                {p.texts.map((t, i) => (
                  <Note key={i} text={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <div className="assoc-group">
          <h3>
            Yours<span className="discussion-count">{mine.length}</span>
          </h3>
          {mine.map((n) =>
            editing === n.id ? (
              <Composer
                key={n.id}
                char={char}
                author={user}
                initial={{
                  text: n.text,
                  attachments: savedAttachments(n.images, n.drawings),
                  visibility: n.visibility,
                }}
                onSubmit={(t, i, v) => saveEdit(n, t, i, v)}
                onCancel={() => setEditing(null)}
                onSignIn={onSignIn}
              />
            ) : (
              <CommentCard
                key={n.id}
                note={n}
                signedIn={me !== null}
                own={ownActions(n)}
                onSignIn={onSignIn}
                onChange={patch}
              />
            ),
          )}
        </div>
      )}

      <div className="assoc-group">
        <div className="assoc-group-head">
          <h3>
            From others{total > 0 && <span className="discussion-count">{total}</span>}
          </h3>
          {total > 1 && (
            <span className="assoc-sort" role="radiogroup" aria-label="Sort">
              {(
                [
                  ['liked', 'most liked'],
                  ['new', 'newest'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={sort === value}
                  data-on={sort === value || undefined}
                  onClick={() => setSort(value)}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
        </div>

        {failed ? (
          <p className="discussion-empty">Could not load what others wrote.</p>
        ) : others.length === 0 && !loading ? (
          <p className="discussion-empty">
            Nobody has shared one for {char} yet. Post yours as public and it shows here for others
            to read, like and reply to.
          </p>
        ) : (
          others.map((n) => (
            <CommentCard key={n.id} note={n} signedIn={me !== null} onSignIn={onSignIn} onChange={patch} />
          ))
        )}

        {others.length < total && (
          <button className="discussion-more" disabled={loading} onClick={() => setShown((s) => s + PAGE)}>
            {loading ? 'loading' : `show more (${total - others.length})`}
          </button>
        )}
      </div>
    </section>
  )
}
