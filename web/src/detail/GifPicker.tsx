/**
 * GIFs for a note, searched on KLIPY: what is popular until something is
 * typed, then what matches. A picked one joins the note's pictures as its
 * address on KLIPY, which is where readers' browsers fetch it from.
 */

import { useEffect, useRef, useState } from 'react'
import { api, type GifHit } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'

const S = strings(
  {
    // KLIPY asks for its name in the search box.
    placeholder: 'Search KLIPY',
    close: 'Close',
    looking: 'looking',
    nothing: 'No GIFs for that.',
    more: 'More',
    add: 'Add this GIF',
    powered: 'Powered by KLIPY',
  },
  {
    placeholder: 'Търсене в KLIPY',
    close: 'Затворете',
    looking: 'търсене',
    nothing: 'Няма GIF за това.',
    more: 'Още',
    add: 'Добавете този GIF',
    powered: 'Предоставено от KLIPY',
  },
)

/** KLIPY reads a query in the language it is told: Cyrillic is Bulgarian. */
const langOf = (q: string, ui: string) => (q ? (/\p{Script=Cyrillic}/u.test(q) ? 'bg' : 'en') : ui)

interface Props {
  onPick: (hit: GifHit) => void
  onClose: () => void
}

export function GifPicker({ onPick, onClose }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GifHit[]>([])
  const [next, setNext] = useState('')
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  // A pause in typing asks again; nothing typed is what is popular.
  useEffect(() => {
    const query = q.trim()
    const id = window.setTimeout(
      () => {
        asked.current = query
        setLooking(true)
        setError(null)
        api.searchGifs(query, langOf(query, lang), '').then(
          (r) => {
            if (asked.current !== query) return
            setHits(r.hits)
            setNext(r.next)
            setLooking(false)
          },
          (e) => {
            if (asked.current !== query) return
            setError(errorText(e, lang))
            setLooking(false)
          },
        )
      },
      query ? 400 : 0,
    )
    return () => clearTimeout(id)
  }, [q, lang])

  function more() {
    const query = asked.current
    setLooking(true)
    api.searchGifs(query, langOf(query, lang), next).then(
      (r) => {
        if (asked.current !== query) return
        setHits((h) => [...h, ...r.hits.filter((x) => !h.some((y) => y.id === x.id))])
        setNext(r.next)
        setLooking(false)
      },
      (e) => {
        setError(errorText(e, lang))
        setLooking(false)
      },
    )
  }

  return (
    <div className="gifpicker" role="dialog" aria-label={t('placeholder')}>
      <div className="gifpicker-head">
        <input
          ref={input}
          type="search"
          className="gifpicker-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
          }}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          enterKeyHint="search"
          autoComplete="off"
        />
        <button type="button" className="account-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
          ×
        </button>
      </div>
      <div className="gifpicker-results">
        {error && <p className="gifpicker-note">{error}</p>}
        {!error && !looking && q.trim() && hits.length === 0 && <p className="gifpicker-note">{t('nothing')}</p>}
        <ul className="gifpicker-grid">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} title={h.title ? `${t('add')}: ${h.title}` : t('add')}>
                <img src={h.thumb} alt={h.title} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
        {looking && <p className="gifpicker-note">{t('looking')}</p>}
        {!looking && next && hits.length > 0 && (
          <button type="button" className="clear gifpicker-more" onClick={more}>
            {t('more')}
          </button>
        )}
      </div>
      <p className="gifpicker-credit">
        <a href="https://klipy.com/" target="_blank" rel="noreferrer">
          {t('powered')}
        </a>
      </p>
    </div>
  )
}
