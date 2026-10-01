/**
 * The search box: at the top of the rail on a desktop, and along the top of
 * a phone, with the profile at its end. It is a real input rather than a button that
 * opens one, because a phone only raises its keyboard for a tap that lands on
 * an input.
 *
 * Drawing types into it, a character at a time, so a word you can read but
 * not type is built up the same way as one you can.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { strings, useLang } from '../i18n'
import { MOBILE, useMediaQuery } from '../media'

// Not needed until its button is pressed.
const DrawPad = lazy(() => import('../draw/DrawPad').then((m) => ({ default: m.DrawPad })))

const S = strings(
  {
    placeholder: 'English, Japanese or romaji',
    placeholderPhone: 'English, 日本語 or romaji',
    search: 'Search',
    clearSearch: 'Clear the search',
    clear: 'Clear',
    drawTitle: 'Draw a character',
    draw: 'Draw',
    close: 'Close',
  },
  {
    placeholder: 'японски, български или ромаджи',
    placeholderPhone: 'японски или български',
    search: 'Търсене',
    clearSearch: 'Изчистете търсенето',
    clear: 'Изчистете',
    drawTitle: 'Нарисувайте йероглиф',
    draw: 'Рисуване',
    close: 'Затворете',
  },
)

interface Props {
  q: string
  onType: (q: string) => void
  /**
   * Focusing the box. True when another page is up, in which case the text is
   * selected, ready to be replaced.
   */
  onFocus: () => boolean
  /** Enter, or the search key on a phone's keyboard. */
  onSubmit: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Anything else for the end of the row, after the tools. */
  after?: React.ReactNode
}

const coarse = () => window.matchMedia('(pointer: coarse)').matches

export function SearchBar({ q, onType, onFocus, onSubmit, inputRef, after }: Props) {
  const [drawing, setDrawing] = useState(false)
  const t = S(useLang())
  // The phone's box is narrower than the full placeholder; a shorter one there.
  const phone = useMediaQuery(MOBILE)
  const drawRef = useRef<HTMLDivElement>(null)
  const drawButton = useRef<HTMLButtonElement>(null)

  // The draw pad is a popup: a press anywhere outside it, or Escape, puts it
  // away. Its own button is left to toggle it.
  useEffect(() => {
    if (!drawing) return
    function onDown(e: PointerEvent) {
      const at = e.target as Node
      if (drawRef.current?.contains(at) || drawButton.current?.contains(at)) return
      setDrawing(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawing(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [drawing])

  function toggleDrawing() {
    setDrawing((on) => !on)
    // The keyboard and the pad cannot share a phone screen.
    if (coarse()) inputRef.current?.blur()
  }

  // A pick types the character and puts the pad away, so the results show.
  function pick(ch: string) {
    onType(q + ch)
    setDrawing(false)
  }

  return (
    <div className="searchbar">
      <div className="searchbar-row">
        <div className="searchbar-field">
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => onType(e.target.value)}
            onFocus={(e) => {
              if (coarse()) setDrawing(false)
              if (onFocus()) e.currentTarget.select()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setDrawing(false)
                e.currentTarget.blur()
              }
              // Enter is done typing: put the keyboard away to show the results,
              // and ask semantic search if the dictionary found nothing.
              if (e.key === 'Enter') {
                onSubmit()
                if (coarse()) e.currentTarget.blur()
              }
            }}
            placeholder={t(phone ? 'placeholderPhone' : 'placeholder')}
            aria-label={t('search')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {q && (
            <button
              className="searchbar-clear"
              onClick={() => {
                onType('')
                if (!drawing) inputRef.current?.focus()
              }}
              aria-label={t('clearSearch')}
              title={t('clear')}
            >
              ×
            </button>
          )}
          {!q && !coarse() && <kbd className="searchbar-kbd">/</kbd>}
        </div>
        <button
          ref={drawButton}
          className="searchbar-tool"
          data-on={drawing || undefined}
          aria-pressed={drawing}
          onClick={toggleDrawing}
          title={t('drawTitle')}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 17c2-.4 3.2-1.2 4.3-2.3L16.5 5.5a1.8 1.8 0 0 0-2.5-2.5L4.8 12.2C3.7 13.3 3.2 14.8 3 17Z" />
          </svg>
          <span>{t('draw')}</span>
        </button>
        {after}
      </div>

      {drawing && (
        <div ref={drawRef} className="drawpop" role="dialog" aria-label={t('drawTitle')}>
          <div className="drawpop-head">
            <h2>{t('drawTitle')}</h2>
            <button className="account-x" onClick={() => setDrawing(false)} aria-label={t('close')} title={t('close')}>
              ×
            </button>
          </div>
          <Suspense fallback={null}>
            <DrawPad onPick={pick} />
          </Suspense>
        </div>
      )}
    </div>
  )
}
