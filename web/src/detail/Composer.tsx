import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { api, type Author, type Visibility } from '../api'
import { Avatar } from '../account/Avatar'
import { getLang, strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { getImage, isLocalImage, putImage } from '../localNotes'
import { NoteImage } from './NoteContent'
import { GifPicker } from './GifPicker'

const S = strings(
  {
    postFailed: 'could not post that',
    yourAssociation: 'Your association',
    askKanji: 'What does {label} look like to you?',
    edit: 'edit',
    remove: 'remove',
    attachTitle: 'Upload a picture (or paste or drop one)',
    upload: 'upload',
    drawTitle: 'Draw it in Excalidraw',
    draw: 'draw',
    gifTitle: 'Add a GIF from KLIPY',
    kanjifyTitle: 'Leave [] after a word to have its kanji put in.',
    whoSees: 'Who can see this',
    private: 'private',
    public: 'public',
    privateTitle: 'Only you see it',
    publicTitle: 'Everyone sees it, under your name',
    localTitle: 'Kept in this browser until you log in; log in to share it',
    inBrowser: 'in this browser',
    logIn: 'log in',
    cancel: 'cancel',
    saving: 'saving',
    posting: 'posting',
    save: 'save',
    post: 'post',
  },
  {
    postFailed: 'не успяхме да го публикуваме',
    yourAssociation: 'Вашата асоциация',
    askKanji: 'На какво ви прилича {label}?',
    edit: 'редактирайте',
    remove: 'махнете',
    attachTitle: 'Качете картинка (или я поставете, или я пуснете тук)',
    upload: 'качване',
    drawTitle: 'Нарисувайте го в Excalidraw',
    draw: 'рисуване',
    gifTitle: 'Добавете GIF от KLIPY',
    kanjifyTitle: 'Оставете [] след дума, за да се попълни канджито ѝ.',
    whoSees: 'Кой може да вижда това',
    private: 'лична',
    public: 'публична',
    privateTitle: 'Само вие я виждате',
    publicTitle: 'Всички я виждат, под вашето име',
    localTitle: 'Пази се в този браузър, докато не влезете; влезте, за да я споделите',
    inBrowser: 'в този браузър',
    logIn: 'влезте',
    cancel: 'откажете',
    saving: 'запазване',
    posting: 'публикуване',
    save: 'запазете',
    post: 'публикувайте',
  },
)

const SketchEditor = lazy(() => import('../draw/SketchEditor'))

/**
 * A picture on a note being written. Pictures already saved are referred to by
 * name; new ones stay in the browser as blobs until the note is posted, so an
 * abandoned draft never leaves files behind on the server.
 */
export type Attachment =
  | { key: string; kind: 'saved'; name: string; drawing: boolean }
  | { key: string; kind: 'new'; blob: Blob; scene?: string; url: string }

export interface Draft {
  text: string
  attachments: Attachment[]
  visibility: Visibility
}

interface Props {
  /** How the character or word is written, for the drawing's title. */
  label: string
  /** What the empty box asks; a new post's only. */
  placeholder?: string
  /** Who is writing; null when signed out. */
  author: Author | null
  /** An existing note to edit; absent for a new post. */
  initial?: Draft
  /** Where an unsent new post is kept, so moving between characters keeps it. */
  draftKey?: string
  /** Stores the pictures and saves the note; resolves once it is saved. */
  onSubmit: (text: string, images: string[], visibility: Visibility) => Promise<void>
  onCancel?: () => void
  onSignIn: () => void
}

// Unsent posts, per character, for as long as the page is open.
const drafts = new Map<string, Draft>()

let counter = 0
const key = () => `a${++counter}`

export function savedAttachments(images: string[], drawings: string[]): Attachment[] {
  return images.map((name) => ({ key: key(), kind: 'saved', name, drawing: drawings.includes(name) }))
}

function newAttachment(blob: Blob, scene?: string): Attachment {
  return { key: key(), kind: 'new', blob, scene, url: URL.createObjectURL(blob) }
}

function release(a: Attachment) {
  if (a.kind === 'new') URL.revokeObjectURL(a.url)
}

const EMPTY: Draft = { text: '', attachments: [], visibility: 'public' }

export function Composer({ label, placeholder, author, initial, draftKey, onSubmit, onCancel, onSignIn }: Props) {
  const t = S(useLang())
  const signedIn = author !== null
  const start = initial ?? (draftKey ? drafts.get(draftKey) : undefined) ?? EMPTY
  const [text, setText] = useState(start.text)
  const [attachments, setAttachments] = useState<Attachment[]>(start.attachments)
  const [visibility, setVisibility] = useState<Visibility>(start.visibility)
  const [focused, setFocused] = useState(Boolean(initial))
  const [sending, setSending] = useState(false)
  // null: none; '' : ours ("could not post that"), shown in the language of the moment; else the server's words
  const [problem, setProblem] = useState<string | null>(null)
  // Which picture the drawing editor is open on: a new drawing, or one to replace.
  const [sketching, setSketching] = useState<{ replace: string | null; scene?: Record<string, unknown> } | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [gifs, setGifs] = useState(false)
  const [kanjifying, setKanjifying] = useState(false)

  useEffect(() => {
    if (draftKey) drafts.set(draftKey, { text, attachments, visibility })
  }, [draftKey, text, attachments, visibility])

  const empty = !text.trim() && attachments.length === 0
  // Typing in the GIF search takes the focus from the text, and must not fold it away.
  const open = focused || !empty || gifs

  function add(blob: Blob, scene?: string) {
    setAttachments((as) => [...as, newAttachment(blob, scene)])
  }

  // A GIF is kept by its address on KLIPY, like a picture already saved.
  function addGif(url: string) {
    setAttachments((as) => [...as, { key: key(), kind: 'saved', name: url, drawing: false }])
    setGifs(false)
    setFocused(true)
  }

  function remove(k: string) {
    setAttachments((as) => {
      const gone = as.find((a) => a.key === k)
      if (gone) release(gone)
      return as.filter((a) => a.key !== k)
    })
  }

  async function editDrawing(a: Attachment) {
    let scene: Record<string, unknown> | null = null
    if (a.kind === 'new') scene = a.scene ? JSON.parse(a.scene) : null
    else if (isLocalImage(a.name)) {
      const saved = (await getImage(a.name))?.scene
      scene = saved ? JSON.parse(saved) : null
    } else scene = await api.scene(a.name).catch(() => null)
    setSketching({ replace: a.key, scene: scene ?? undefined })
  }

  async function saveDrawing(png: Blob, scene: string) {
    const replace = sketching?.replace
    const fresh = newAttachment(png, scene)
    // An edited drawing takes its old one's place rather than joining the end.
    setAttachments((as) => {
      const old = as.find((a) => a.key === replace)
      if (!old) return [...as, fresh]
      release(old)
      return as.map((a) => (a.key === replace ? fresh : a))
    })
    setSketching(null)
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    const blob = item?.getAsFile()
    if (blob) {
      e.preventDefault()
      add(blob)
    }
  }

  function onDrop(e: React.DragEvent) {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      files.forEach((f) => add(f))
      setFocused(true)
    }
  }

  async function store(a: Attachment): Promise<string> {
    if (a.kind === 'saved') return a.name
    if (!signedIn) return putImage(a.blob, a.scene)
    const res = a.scene
      ? await api.uploadDrawing(a.blob, a.scene)
      : await api.uploadImage(a.blob, `picture.${a.blob.type.split('/')[1] || 'png'}`)
    return res.name
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (empty || sending) return
    setSending(true)
    setProblem(null)
    try {
      const names: string[] = []
      for (const a of attachments) names.push(await store(a))
      await onSubmit(text.trim(), names, signedIn ? visibility : 'private')
      attachments.forEach(release)
      if (draftKey) drafts.delete(draftKey)
      if (!initial) {
        setText('')
        setAttachments([])
        setFocused(false)
      }
    } catch (err) {
      setProblem(err instanceof Error ? errorText(err, getLang()) : '')
    } finally {
      setSending(false)
    }
  }

  async function kanjify() {
    if (!signedIn) return onSignIn()
    setKanjifying(true)
    setProblem(null)
    try {
      const { text: marked } = await api.kanjify(label, text)
      // The text box takes typing again first: what comes next is typed into it.
      flushSync(() => setKanjifying(false))
      // Put in as if typed, so that Ctrl+Z takes it back: a value set from
      // React is not on the text box's undo stack.
      const el = box.current
      if (el && marked !== text) {
        el.focus()
        el.select()
        if (!document.execCommand('insertText', false, marked)) setText(marked)
      }
    } catch (err) {
      setKanjifying(false)
      setProblem(err instanceof Error ? errorText(err, getLang()) : '')
    }
  }

  return (
    <form
      className="composer"
      data-open={open || undefined}
      onSubmit={submit}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="composer-main">
        <Avatar author={author} size={28} />
        <textarea
          ref={box}
          className="composer-text"
          value={text}
          placeholder={initial ? t('yourAssociation') : (placeholder ?? t('askKanji', { label }))}
          autoFocus={Boolean(initial)}
          rows={open ? Math.min(14, Math.max(3, text.split('\n').length + 1)) : 1}
          onChange={(e) => setText(e.target.value)}
          readOnly={kanjifying}
          onFocus={() => setFocused(true)}
          onBlur={() => empty && !initial && setFocused(false)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            if (e.key === 'Escape') {
              if (onCancel) onCancel()
              else e.currentTarget.blur()
            }
          }}
        />
      </div>

      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((a) => {
            const drawing = a.kind === 'new' ? Boolean(a.scene) : a.drawing
            return (
              <figure key={a.key}>
                {a.kind === 'new' ? <img src={a.url} alt="" /> : <NoteImage name={a.name} />}
                <figcaption>
                  {drawing && (
                    <button type="button" className="clear" onClick={() => editDrawing(a)}>
                      {t('edit')}
                    </button>
                  )}
                  <button type="button" className="clear" onClick={() => remove(a.key)}>
                    {t('remove')}
                  </button>
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}

      {open && (
        // Pressing a button here must not blur the text first: an empty
        // composer folds away on blur, taking the button with it.
        <div className="composer-bar" onMouseDown={(e) => e.preventDefault()}>
          <button
            type="button"
            className="composer-tool"
            onClick={() => picker.current?.click()}
            title={t('attachTitle')}
          >
            <PictureIcon />
            <span>{t('upload')}</span>
          </button>
          <button
            type="button"
            className="composer-tool"
            onClick={() => setSketching({ replace: null })}
            title={t('drawTitle')}
          >
            <PenIcon />
            <span>{t('draw')}</span>
          </button>
          <button
            type="button"
            className="composer-tool"
            data-on={gifs || undefined}
            aria-pressed={gifs}
            onClick={() => setGifs((g) => !g)}
            title={t('gifTitle')}
          >
            <GifIcon />
            <span>GIF</span>
          </button>
          <button
            type="button"
            className="composer-tool"
            disabled={!text.trim() || kanjifying}
            onClick={kanjify}
            title={t('kanjifyTitle')}
          >
            <KanjifyIcon />
            <span>Kanjify</span>
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              ;[...(e.target.files ?? [])].forEach((f) => add(f))
              e.target.value = ''
            }}
          />

          <span className="composer-send">
            {signedIn ? (
              <span className="assoc-visibility" role="radiogroup" aria-label={t('whoSees')}>
                {(['private', 'public'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={visibility === v}
                    data-on={visibility === v || undefined}
                    onClick={() => setVisibility(v)}
                    title={t(v === 'private' ? 'privateTitle' : 'publicTitle')}
                  >
                    {t(v)}
                  </button>
                ))}
              </span>
            ) : (
              <span className="composer-local" title={t('localTitle')}>
                {t('inBrowser')} ·{' '}
                <button type="button" className="clear" onClick={onSignIn}>
                  {t('logIn')}
                </button>
              </span>
            )}

            {onCancel && (
              <button type="button" className="clear" onClick={onCancel}>
                {t('cancel')}
              </button>
            )}
            <button className="composer-post" disabled={empty || sending}>
              {t(sending ? (initial ? 'saving' : 'posting') : initial ? 'save' : 'post')}
            </button>
          </span>
        </div>
      )}
      {gifs && <GifPicker onPick={(h) => addGif(h.url)} onClose={() => setGifs(false)} />}
      {problem !== null && <p className="account-problem">{problem || t('postFailed')}</p>}

      {sketching && (
        <Suspense fallback={<div className="sketch-overlay" />}>
          <SketchEditor
            char={label}
            scene={sketching.scene}
            onSave={saveDrawing}
            onClose={() => setSketching(null)}
          />
        </Suspense>
      )}
    </form>
  )
}

function PictureIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1.8" fill="currentColor" />
      <path d="M4 18l5.5-5.5 4 4 2.5-2.5L20 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function GifIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 10H8a1.5 1.5 0 00-1.5 1.5v1A1.5 1.5 0 008 14h1.5v-2H8.5M12.5 10v4M15 14v-4h3M15 12h2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function KanjifyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M6 4H3.5v16H6M18 4h2.5v16H18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <text x="12" y="16.2" fontSize="11" textAnchor="middle" fill="currentColor">
        字
      </text>
    </svg>
  )
}

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5 4 20z M13.5 7l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
