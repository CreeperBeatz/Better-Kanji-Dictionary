import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, isGifUrl } from '../api'
import { strings, useLang } from '../i18n'
import { getImage, isLocalImage } from '../localNotes'

const S = strings(
  { zoom: 'Show the image larger', close: 'Close' },
  { zoom: 'Покажете изображението по-голямо', close: 'Затворете' },
)

// The markdown renderer is a fifth of the app's code and is wanted only once
// notes are near, so it loads then: when a page is opened (App.tsx calls
// loadNotes), before its associations are. Once loaded it draws a note at
// once; before, the note reads as plain text for the moment it takes.
let Markdown: (typeof import('./Markdown'))['default'] | null = null
let loading: Promise<unknown> | null = null
export function loadNotes(): Promise<unknown> {
  loading ??= import('./Markdown').then((m) => (Markdown = m.default))
  return loading
}

export function Note({ text }: { text: string }) {
  const [, setLoaded] = useState(Markdown !== null)
  useEffect(() => {
    if (!Markdown) loadNotes().then(() => setLoaded(true))
  }, [])
  return <div className="md">{Markdown ? <Markdown text={text} /> : <Plain text={text} />}</div>
}

function Plain({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </>
  )
}

/**
 * An image from either the server or this browser's own store. `zoomable`
 * ones open larger in a popup when clicked -- on a posted note, not in the
 * composer, where a click is for managing the attachment.
 */
export function NoteImage({ name, zoomable = false }: { name: string; zoomable?: boolean }) {
  const t = S(useLang())
  const [zoomed, setZoomed] = useState(false)
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
  if (!src) return <span className="assoc-image-pending" />
  // A GIF comes from KLIPY, which asks to be named wherever its GIFs are.
  const img = isGifUrl(name) ? (
    <span className="assoc-gif">
      <img src={src} alt="" referrerPolicy="no-referrer" />
      <span className="assoc-gif-credit">KLIPY</span>
    </span>
  ) : (
    <img src={src} alt="" />
  )
  if (!zoomable) return img
  return (
    <>
      <button className="assoc-image-zoom" onClick={() => setZoomed(true)} title={t('zoom')} aria-label={t('zoom')}>
        {img}
      </button>
      {zoomed && <ImageZoom src={src} onClose={() => setZoomed(false)} />}
    </>
  )
}

/** The image as large as the window allows, over everything, with a way out. */
function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  const t = S(useLang())

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // captured first, so nothing under it closes too
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      className="overlay image-zoom"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <img src={src} alt="" />
      <button className="account-x image-zoom-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
        ×
      </button>
    </div>,
    document.body,
  )
}
