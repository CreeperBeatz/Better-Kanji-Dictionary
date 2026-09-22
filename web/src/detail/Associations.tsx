import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, ApiError, type AssociationView, type Visibility } from '../api'
import { sessionLost, useAuth } from '../account/auth'
import { drawingsAmong, getImage, getNote, isLocalImage, putImage, putNote } from '../localNotes'

const SketchEditor = lazy(() => import('../draw/SketchEditor'))

interface Props {
  char: string
  onPick: (char: string) => void
  onSignIn: () => void
}

/** Which drawing the editor is open on: a new one, or an existing image. */
type Sketching = { image: string | null; scene?: Record<string, unknown> } | null

function Note({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/** An image from either the server or this browser's own store. */
function NoteImage({ name }: { name: string }) {
  const local = isLocalImage(name)
  const [blobUrl, setBlobUrl] = useState<{ name: string; url: string } | null>(null)

  useEffect(() => {
    if (!local) return
    let url: string | null = null
    let stale = false
    getImage(name).then((img) => {
      if (stale || !img) return
      url = URL.createObjectURL(img.blob)
      setBlobUrl({ name, url })
    })
    return () => {
      stale = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [name, local])

  const src = local ? (blobUrl?.name === name ? blobUrl.url : null) : api.imageUrl(name)
  return src ? <img src={src} alt="" /> : <span className="assoc-image-pending" />
}

export function Associations({ char, onPick, onSignIn }: Props) {
  const { user, ready, syncing } = useAuth()
  const me = user?.id ?? null
  const [view, setView] = useState<AssociationView | null>(null)
  const [parts, setParts] = useState<{ char: string; text: string }[]>([])
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [drawings, setDrawings] = useState<string[]>([])
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sketching, setSketching] = useState<Sketching>(null)

  // Signed out, your note and your notes on the parts come from this browser;
  // signed in, from your account. Other people's public notes come from the
  // server either way.
  const load = useCallback(() => {
    if (!ready || syncing) return
    let stale = false
    ;(async () => {
      const d = await api.associations(char).catch(() => null)
      if (stale) return
      setView(d)

      if (me) {
        const mine = d?.own.find((a) => a.author === me)
        setText(mine?.text ?? '')
        setImages(mine?.images ?? [])
        setDrawings(mine?.drawings ?? [])
        setVisibility(mine?.visibility ?? 'private')
        setParts((d?.components ?? []).map((c) => ({ char: c.char, text: c.notes[0]?.text ?? '' })))
      } else {
        const mine = await getNote(char).catch(() => null)
        const found = await Promise.all(
          (d?.components ?? []).map(async (c) => ({
            char: c.char,
            text: (await getNote(c.char).catch(() => null))?.text ?? '',
          })),
        )
        const drawn = await drawingsAmong(mine?.images ?? []).catch(() => [])
        if (stale) return
        setText(mine?.text ?? '')
        setImages(mine?.images ?? [])
        setDrawings(drawn)
        setVisibility('private')
        setParts(found)
      }
      setDirty(false)
    })()
    return () => {
      stale = true
    }
  }, [char, me, ready, syncing])

  useEffect(load, [load])
  useEffect(() => {
    setEditing(false)
    setSketching(null)
  }, [char])

  const save = useCallback(
    async (nextText: string, nextImages: string[], nextVisibility: Visibility) => {
      setSaving(true)
      try {
        if (me) {
          try {
            await api.saveAssociation(char, nextText, nextImages, nextVisibility)
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 401)) throw e
            // Signed out under us: keep the note in the browser instead, where
            // it is picked up again at the next sign-in.
            await putNote(char, nextText, nextImages)
            sessionLost()
            return
          }
        } else {
          await putNote(char, nextText, nextImages)
          setDrawings(await drawingsAmong(nextImages))
        }
        setDirty(false)
        if (me) load()
      } finally {
        setSaving(false)
      }
    },
    [char, me, load],
  )

  // Autosave on a pause rather than a button: notes written mid-study should
  // never be lost to navigating away.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save(text, images, visibility), 900)
    return () => clearTimeout(t)
  }, [dirty, text, images, visibility, save])

  async function storeImage(blob: Blob, filename: string) {
    return me ? (await api.uploadImage(blob, filename)).name : putImage(blob)
  }

  async function storeDrawing(png: Blob, scene: string) {
    return me ? (await api.uploadDrawing(png, scene)).name : putImage(png, scene)
  }

  async function attach(blob: Blob, filename: string) {
    const name = await storeImage(blob, filename)
    const next = [...images, name]
    setImages(next)
    await save(text, next, visibility)
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    if (!item) return
    const blob = item.getAsFile()
    if (blob) {
      e.preventDefault()
      attach(blob, `paste.${blob.type.split('/')[1] || 'png'}`)
    }
  }

  function onDrop(e: React.DragEvent) {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      attach(file, file.name)
    }
  }

  async function saveDrawing(png: Blob, scene: string) {
    const name = await storeDrawing(png, scene)
    // An edited drawing takes its old one's place rather than joining the end.
    const old = sketching?.image
    const next = old && images.includes(old) ? images.map((i) => (i === old ? name : i)) : [...images, name]
    setImages(next)
    setSketching(null)
    await save(text, next, visibility)
  }

  async function openDrawing(name: string) {
    const scene = isLocalImage(name)
      ? JSON.parse((await getImage(name))?.scene ?? 'null')
      : await api.scene(name)
    setSketching({ image: name, scene: scene ?? undefined })
  }

  function removeImage(name: string) {
    const next = images.filter((i) => i !== name)
    setImages(next)
    save(text, next, visibility)
  }

  function chooseVisibility(v: Visibility) {
    if (v === visibility) return
    setVisibility(v)
    // Nothing to save until there is a note; the choice waits for it.
    if (text.trim() || images.length) save(text, images, v)
  }

  const others = view?.own.filter((a) => a.author !== me) ?? []
  const noted = parts.filter((p) => p.text)

  return (
    <section className="rail-section">
      <h2>My association for {char}</h2>

      {editing || !text ? (
        <textarea
          className="assoc-text"
          value={text}
          placeholder={`What does ${char} look like to you? Markdown works.`}
          autoFocus={editing}
          onChange={(e) => {
            setText(e.target.value)
            setDirty(true)
          }}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          rows={Math.min(18, Math.max(5, text.split('\n').length + 1))}
        />
      ) : (
        // Reading is the common case, so a note shows rendered; a click
        // anywhere but a link turns it back into its source.
        <div
          className="assoc-rendered"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a')) setEditing(true)
          }}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          title="Click to edit"
        >
          <Note text={text} />
        </div>
      )}

      <p className="assoc-actions">
        <button className="clear" onClick={() => setSketching({ image: null })}>
          draw one
        </button>
        {text && !editing && (
          <button className="clear" onClick={() => setEditing(true)}>
            edit text
          </button>
        )}
        {me && (
          <span className="assoc-visibility" role="radiogroup" aria-label="Who can see this note">
            {(['private', 'public'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={visibility === v}
                data-on={visibility === v || undefined}
                onClick={() => chooseVisibility(v)}
                title={v === 'private' ? 'Only you see this note' : 'Everyone sees this note, under your name'}
              >
                {v}
              </button>
            ))}
          </span>
        )}
        <span className="tally">
          {saving ? 'saving' : dirty ? 'unsaved' : text || images.length ? 'saved' : 'paste or drop an image'}
        </span>
      </p>

      {ready && !me && !syncing && (
        <p className="assoc-local-note">
          Kept in this browser only.{' '}
          <button className="clear" onClick={onSignIn}>
            Log in
          </button>{' '}
          to save your associations.
        </p>
      )}

      {sketching && (
        <Suspense fallback={<div className="sketch-overlay" />}>
          <SketchEditor
            char={char}
            scene={sketching.scene}
            onSave={saveDrawing}
            onClose={() => setSketching(null)}
          />
        </Suspense>
      )}

      {images.length > 0 && (
        <div className="assoc-images">
          {images.map((name) => (
            <figure key={name}>
              {drawings.includes(name) ? (
                <button className="assoc-drawing" onClick={() => openDrawing(name)} title="Keep drawing">
                  <NoteImage name={name} />
                </button>
              ) : (
                <NoteImage name={name} />
              )}
              <figcaption>
                {drawings.includes(name) && (
                  <button className="clear" onClick={() => openDrawing(name)}>
                    edit
                  </button>
                )}
                <button className="clear" onClick={() => removeImage(name)}>
                  remove
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {noted.length > 0 && (
        <div className="assoc-parts">
          <h3>From its parts</h3>
          {noted.map((c) => (
            <div key={c.char} className="assoc-part">
              <button className="assoc-part-glyph" onClick={() => onPick(c.char)}>
                {c.char}
              </button>
              <Note text={c.text} />
            </div>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="assoc-parts">
          <h3>Other people wrote</h3>
          {others.map((a) => (
            <div key={a.id} className="assoc-part">
              <span className="assoc-author">{a.authorName}</span>
              <div>
                <Note text={a.text} />
                {a.images.length > 0 && (
                  <div className="assoc-images">
                    {a.images.map((name) => (
                      <figure key={name}>
                        <NoteImage name={name} />
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
