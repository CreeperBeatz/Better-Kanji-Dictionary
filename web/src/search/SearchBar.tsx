/**
 * The search box: at the top of the rail on a desktop, and along the top of
 * a phone, with the profile at its end. It is a real input rather than a button that
 * opens one, because a phone only raises its keyboard for a tap that lands on
 * an input.
 *
 * Drawing and radicals type into it, a character at a time, so a word you can
 * read but not type is built up the same way as one you can.
 */

import { useEffect, useRef, useState } from 'react'
import { DrawPad } from '../draw/DrawPad'
import { strings, useLang } from '../i18n'
import { RadicalPicker } from './RadicalPicker'

type Tool = 'draw' | 'radicals'

const S = strings(
  {
    placeholder: 'English, Japanese or romaji',
    search: 'Search',
    clearSearch: 'Clear the search',
    clear: 'Clear',
    drawTitle: 'Draw a character',
    draw: 'Draw',
    radicalsTitle: 'Pick a character by its parts',
    radicals: 'Radicals',
    done: 'done',
    close: 'Close',
  },
  {
    placeholder: 'японски, български или ромаджи',
    search: 'Търсене',
    clearSearch: 'Изчистете търсенето',
    clear: 'Изчистете',
    drawTitle: 'Нарисувайте йероглиф',
    draw: 'Рисуване',
    radicalsTitle: 'Изберете йероглиф по частите му',
    radicals: 'Радикали',
    done: 'готово',
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
  const [tool, setTool] = useState<Tool | null>(null)
  const t = S(useLang())
  const drawRef = useRef<HTMLDivElement>(null)
  const drawButton = useRef<HTMLButtonElement>(null)

  // The draw pad is a popup: a press anywhere outside it, or Escape, puts it
  // away. Its own button is left to toggle it.
  useEffect(() => {
    if (tool !== 'draw') return
    function onDown(e: PointerEvent) {
      const at = e.target as Node
      if (drawRef.current?.contains(at) || drawButton.current?.contains(at)) return
      setTool(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTool(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [tool])

  function toggle(which: Tool) {
    setTool((cur) => (cur === which ? null : which))
    // The keyboard and the pad cannot share a phone screen.
    if (coarse()) inputRef.current?.blur()
  }

  // A pick types the character and puts the tool away, so the results show.
  function pick(ch: string) {
    onType(q + ch)
    setTool(null)
  }

  return (
    <div className="searchbar" data-tool={tool ?? undefined}>
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
              if (coarse()) setTool(null)
              if (onFocus()) e.currentTarget.select()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setTool(null)
                e.currentTarget.blur()
              }
              // Enter is done typing: put the keyboard away to show the results,
              // and ask semantic search if the dictionary found nothing.
              if (e.key === 'Enter') {
                onSubmit()
                if (coarse()) e.currentTarget.blur()
              }
            }}
            placeholder={t('placeholder')}
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
                if (!tool) inputRef.current?.focus()
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
          data-on={tool === 'draw' || undefined}
          aria-pressed={tool === 'draw'}
          onClick={() => toggle('draw')}
          title={t('drawTitle')}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 17c2-.4 3.2-1.2 4.3-2.3L16.5 5.5a1.8 1.8 0 0 0-2.5-2.5L4.8 12.2C3.7 13.3 3.2 14.8 3 17Z" />
          </svg>
          <span>{t('draw')}</span>
        </button>
        <button
          className="searchbar-tool"
          data-on={tool === 'radicals' || undefined}
          aria-pressed={tool === 'radicals'}
          onClick={() => toggle('radicals')}
          title={t('radicalsTitle')}
        >
          <span className="searchbar-tool-glyph" aria-hidden>
            部
          </span>
          <span>{t('radicals')}</span>
        </button>
        {after}
      </div>

      {tool === 'draw' && (
        <div ref={drawRef} className="drawpop" role="dialog" aria-label={t('drawTitle')}>
          <div className="drawpop-head">
            <h2>{t('drawTitle')}</h2>
            <button className="account-x" onClick={() => setTool(null)} aria-label={t('close')} title={t('close')}>
              ×
            </button>
          </div>
          <DrawPad onPick={pick} />
        </div>
      )}

      {tool === 'radicals' && (
        <div className="searchtools">
          <RadicalPicker onPick={pick} />
          <button className="searchtools-close clear" onClick={() => setTool(null)}>
            {t('done')}
          </button>
        </div>
      )}
    </div>
  )
}
