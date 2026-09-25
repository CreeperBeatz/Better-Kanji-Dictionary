/**
 * Pictures to draw with, searched on Pixabay from inside the drawing: a
 * picked one lands in the middle of the view, sized to sit in it, ready to
 * be cut out with the picture tools.
 */

import { useEffect, useRef, useState } from 'react'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { api as server, type ImageHit, type ImageKind } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { commit, loadImage } from './pixels/files'
import { viewToScene } from './pixels/geometry'

const S = strings(
  {
    title: 'Find a picture',
    placeholder: 'What to look for',
    close: 'Close',
    all: 'All',
    photo: 'Photos',
    illustration: 'Illustrations',
    vector: 'Vectors',
    looking: 'looking',
    nothing: 'No pictures for that.',
    more: 'More',
    adding: 'adding',
    from: 'Pictures from {pixabay}',
    open: 'Add this picture',
  },
  {
    title: 'Намерете картина',
    placeholder: 'Какво да се търси',
    close: 'Затворете',
    all: 'Всички',
    photo: 'Снимки',
    illustration: 'Илюстрации',
    vector: 'Вектори',
    looking: 'търсене',
    nothing: 'Няма картини за това.',
    more: 'Още',
    adding: 'добавяне',
    from: 'Картини от {pixabay}',
    open: 'Добавете тази картина',
  },
)

const KINDS: ImageKind[] = ['all', 'photo', 'illustration', 'vector']

interface Props {
  api: ExcalidrawImperativeAPI
  onClose: () => void
}

/**
 * Pixabay reads a query in the language it is told, whatever the interface is
 * in: Cyrillic is Bulgarian, anything else English.
 */
const langOf = (q: string) => (/\p{Script=Cyrillic}/u.test(q) ? 'bg' : 'en')

function dataUrlOf(b: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as string)
    r.onerror = () => fail(r.error)
    r.readAsDataURL(b)
  })
}

export function ImageSearch({ api, onClose }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<ImageKind>('all')
  const [hits, setHits] = useState<ImageHit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [looking, setLooking] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  // A pause in typing, or another kind, asks again from the first page.
  useEffect(() => {
    const query = q.trim()
    const key = `${query}\n${kind}`
    if (!query) {
      setHits([])
      setTotal(0)
      asked.current = key
      return
    }
    const id = window.setTimeout(() => {
      asked.current = key
      setLooking(true)
      setError(null)
      server.searchImages(query, langOf(query), kind, 1).then(
        (r) => {
          if (asked.current !== key) return
          setHits(r.hits)
          setTotal(r.total)
          setPage(1)
          setLooking(false)
        },
        (e) => {
          if (asked.current !== key) return
          setError(errorText(e, lang))
          setLooking(false)
        },
      )
    }, 450)
    return () => clearTimeout(id)
  }, [q, kind, lang])

  function more() {
    const key = asked.current
    setLooking(true)
    server.searchImages(q.trim(), langOf(q), kind, page + 1).then(
      (r) => {
        if (asked.current !== key) return
        setHits((h) => [...h, ...r.hits.filter((x) => !h.some((y) => y.id === x.id))])
        setPage(r.page)
        setLooking(false)
      },
      (e) => {
        setError(errorText(e, lang))
        setLooking(false)
      },
    )
  }

  async function add(hit: ImageHit) {
    if (adding !== null) return
    setAdding(hit.id)
    setError(null)
    try {
      const blob = await server.fetchImage(hit.id)
      const dataURL = await dataUrlOf(blob)
      const img = await loadImage(dataURL)
      const fileId = `pixabay-${hit.id}` as FileId
      const file: BinaryFileData = { id: fileId, mimeType: blob.type as BinaryFileData['mimeType'], dataURL: dataURL as DataURL, created: Date.now() }
      // In the middle of what is on screen, half as big as the view at most.
      const st = api.getAppState()
      const room = (Math.min(st.width, st.height) * 0.5) / st.zoom.value
      const k = Math.min(1, room / Math.max(img.naturalWidth, img.naturalHeight))
      const width = img.naturalWidth * k
      const height = img.naturalHeight * k
      const mid = viewToScene(st, { x: st.width / 2, y: st.height / 2 })
      const [el] = convertToExcalidrawElements([
        { type: 'image', fileId, status: 'saved', x: mid.x - width / 2, y: mid.y - height / 2, width, height },
      ])
      api.setActiveTool({ type: 'selection' })
      commit(api, [...api.getSceneElementsIncludingDeleted(), el], [file], { selectedElementIds: { [el.id]: true } })
      onClose()
    } catch (e) {
      setError(errorText(e, lang))
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="imgsearch" role="dialog" aria-label={t('title')}>
      <div className="imgsearch-head">
        <input
          ref={input}
          type="search"
          className="imgsearch-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onClose()
            }
          }}
          placeholder={t('placeholder')}
          aria-label={t('title')}
          enterKeyHint="search"
          autoComplete="off"
        />
        <button className="account-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
          ×
        </button>
      </div>
      <div className="imgsearch-kinds">
        {KINDS.map((k) => (
          <button key={k} data-on={kind === k || undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t(k)}
          </button>
        ))}
      </div>
      <div className="imgsearch-results">
        {error && <p className="imgsearch-note">{error}</p>}
        {!error && q.trim() && !looking && hits.length === 0 && <p className="imgsearch-note">{t('nothing')}</p>}
        <ul className="imgsearch-grid">
          {hits.map((h) => (
            <li key={h.id}>
              <button onClick={() => add(h)} title={`${t('open')}: ${h.tags}`} data-adding={adding === h.id || undefined} disabled={adding !== null}>
                <img src={h.thumb} alt={h.tags} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
        {looking && <p className="imgsearch-note">{t('looking')}</p>}
        {adding !== null && <p className="imgsearch-note">{t('adding')}</p>}
        {!looking && hits.length > 0 && hits.length < total && (
          <button className="clear imgsearch-more" onClick={more}>
            {t('more')}
          </button>
        )}
      </div>
      <p className="imgsearch-credit">
        {t.node('from', {
          pixabay: (
            <a href="https://pixabay.com/" target="_blank" rel="noreferrer">
              Pixabay
            </a>
          ),
        })}
      </p>
    </div>
  )
}
