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
import { strings, useLang } from '../i18n'
import { CommentCard } from './CommentCard'
import { Composer, savedAttachments } from './Composer'
import { Note } from './NoteContent'

const S = strings(
  {
    you: 'You',
    tabLabel: 'Associations for {label}',
    askWord: 'How do you remember {label}?',
    askKanji: 'What does {label} look like to you?',
    fromKanji: 'From its kanji',
    fromParts: 'From its parts',
    yours: 'Yours',
    fromOthers: 'From others',
    sort: 'Sort',
    mostLiked: 'most liked',
    newest: 'newest',
    failed: 'Could not load what others wrote.',
    empty: 'Nobody has shared one for {label} yet. Post yours as public and it shows here for others to read, like and reply to.',
    loading: 'loading',
    showMore: 'show more ({n})',
  },
  {
    you: 'Вие',
    tabLabel: 'Асоциации за {label}',
    askWord: 'Как запомняте {label}?',
    askKanji: 'На какво ви прилича {label}?',
    fromKanji: 'От йероглифите ѝ',
    fromParts: 'От частите му',
    yours: 'Вашите',
    fromOthers: 'От други',
    sort: 'Подреждане',
    mostLiked: 'най-харесвани',
    newest: 'най-нови',
    failed: 'Не успяхме да заредим какво са написали другите.',
    empty: 'Още никой не е споделил асоциация за {label}. Публикувайте своята като публична и тя ще се появи тук, за да я четат, харесват и да ѝ отговарят другите.',
    loading: 'зареждане',
    showMore: 'покажете още ({n})',
  },
)

const PAGE = 10
const SORT_KEY = 'betterrtk:sort'

// What was last fetched for a subject, so hovering the same kanji on the
// graph again -- or coming back to its page -- shows it without asking. Kept
// a minute; anything written, edited, deleted or liked here forgets it.
const FRESH_MS = 60_000
interface Fetched {
  at: number
  mine: PublicNote[]
  others: PublicNote[]
  total: number
}
const fetched = new Map<string, Fetched>()
const partsFetched = new Map<string, { at: number; parts: { char: string; texts: string[] }[] }>()

function fresh<T extends { at: number }>(m: Map<string, T>, key: string): T | undefined {
  const got = m.get(key)
  return got && Date.now() - got.at < FRESH_MS ? got : undefined
}

/** Drops what is kept for a subject, after something here has changed. */
function forget(char: string) {
  for (const key of fetched.keys()) if (key.endsWith(` ${char}`)) fetched.delete(key)
  // A note on this subject also shows under whatever is built from it.
  partsFetched.clear()
}

interface Props {
  /** A character, or a word as `word:<id>`. */
  subject: string
  /** How the subject is written, for the page. */
  label: string
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
function localView(n: LocalNote, drawings: string[], you: string): PublicNote {
  return {
    id: n.id,
    char: n.char,
    author: { id: 'local', name: you, username: null, avatar: null },
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
 * The associations tab, for a character or a word: write one like a comment, then yours (private before
 * public) and everyone else's public ones, most liked or newest first.
 *
 * Signed out, your associations live in this browser (localNotes.ts) and move
 * into your account when you log in. Others' public ones come from the server
 * either way.
 */
export function Associations({ subject, label, onPick, onSignIn, onCount }: Props) {
  const char = subject
  const isWord = subject.startsWith('word:')
  const { user, ready, syncing } = useAuth()
  const t = S(useLang())
  const you = t('you')
  const me = user?.id ?? null
  const [sort, setSortState] = useState<NoteSort>(rememberedSort)
  const kept = fresh(fetched, `${me ?? 'local'} ${sort} ${PAGE} ${char}`)
  const [mine, setMine] = useState<PublicNote[]>(kept?.mine ?? [])
  const [others, setOthers] = useState<PublicNote[]>(kept?.others ?? [])
  const [total, setTotal] = useState(kept?.total ?? 0)
  const [shown, setShown] = useState(PAGE)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [parts, setParts] = useState(() => fresh(partsFetched, `${me ?? 'local'} ${char}`)?.parts ?? [])
  const reload = useCallback(() => {
    forget(char)
    setVersion((v) => v + 1)
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
    const key = `${me ?? 'local'} ${sort} ${shown} ${char}`
    const known = fresh(fetched, key)
    if (known) {
      setMine(known.mine)
      setOthers(known.others)
      setTotal(known.total)
      setFailed(false)
      setLoading(false)
      return
    }
    let stale = false
    setLoading(true)
    ;(async () => {
      const page = await api.notesFor(char, sort, 0, shown).catch(() => null)
      let own: PublicNote[] = page?.mine ?? []
      if (!me) {
        const local = await notesFor(char).catch(() => [])
        own = await Promise.all(
          local.map(async (n) => localView(n, await drawingsAmong(n.images).catch(() => []), you)),
        )
      }
      if (stale) return
      if (page) fetched.set(key, { at: Date.now(), mine: own, others: page.items, total: page.total })
      setMine(own)
      setOthers(page?.items ?? [])
      setTotal(page?.total ?? 0)
      setFailed(page === null)
      setLoading(false)
    })()
    return () => {
      stale = true
    }
  }, [char, me, ready, syncing, sort, shown, version, you])

  // What you wrote on this character's parts, so a mnemonic can build on them.
  useEffect(() => {
    if (!ready || syncing) return
    const key = `${me ?? 'local'} ${char}`
    const known = fresh(partsFetched, key)
    if (known) {
      setParts(known.parts)
      return
    }
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
      const got = found.map((p) => ({ ...p, texts: p.texts.filter((x) => x.trim()) }))
      if (d) partsFetched.set(key, { at: Date.now(), parts: got })
      if (!stale) setParts(got)
    })()
    return () => {
      stale = true
    }
  }, [char, me, ready, syncing, version])

  useEffect(() => onCount(mine.length + total), [mine.length, total, onCount])

  const patch = useCallback(
    (id: string, change: Partial<PublicNote>) => {
      forget(char)
      const apply = (ns: PublicNote[]) => ns.map((n) => (n.id === id ? { ...n, ...change } : n))
      setOthers(apply)
      setMine(apply)
    },
    [char],
  )

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
    <section className="rail-section assoc-tab" aria-label={t('tabLabel', { label })}>
      <Composer
        key={char}
        label={label}
        placeholder={t(isWord ? 'askWord' : 'askKanji', { label })}
        author={user}
        draftKey={char}
        onSubmit={post}
        onSignIn={onSignIn}
      />

      {noted.length > 0 && (
        <div className="assoc-parts">
          <h3>{t(isWord ? 'fromKanji' : 'fromParts')}</h3>
          {noted.map((p) => (
            <div key={p.char} className="assoc-part">
              <button className="assoc-part-glyph" onClick={() => onPick(p.char)}>
                {p.char}
              </button>
              <div>
                {p.texts.map((text, i) => (
                  <Note key={i} text={text} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <div className="assoc-group">
          <h3>
            {t('yours')}
            <span className="discussion-count">{mine.length}</span>
          </h3>
          {mine.map((n) =>
            editing === n.id ? (
              <Composer
                key={n.id}
                label={label}
                author={user}
                initial={{
                  text: n.text,
                  attachments: savedAttachments(n.images, n.drawings),
                  visibility: n.visibility,
                }}
                onSubmit={(text, i, v) => saveEdit(n, text, i, v)}
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
            {t('fromOthers')}
            {total > 0 && <span className="discussion-count">{total}</span>}
          </h3>
          {total > 1 && (
            <span className="assoc-sort" role="radiogroup" aria-label={t('sort')}>
              {(
                [
                  ['liked', t('mostLiked')],
                  ['new', t('newest')],
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
          <p className="discussion-empty">{t('failed')}</p>
        ) : others.length === 0 && !loading ? (
          <p className="discussion-empty">{t('empty', { label })}</p>
        ) : (
          others.map((n) => (
            <CommentCard key={n.id} note={n} signedIn={me !== null} onSignIn={onSignIn} onChange={patch} />
          ))
        )}

        {others.length < total && (
          <button className="discussion-more" disabled={loading} onClick={() => setShown((s) => s + PAGE)}>
            {loading ? t('loading') : t('showMore', { n: total - others.length })}
          </button>
        )}
      </div>
    </section>
  )
}
