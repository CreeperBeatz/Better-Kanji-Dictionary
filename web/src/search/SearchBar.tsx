/**
 * The search box: at the top of the rail on a desktop, along the bottom edge
 * of a phone where the thumb is. It is a real input rather than a button that
 * opens one, because a phone only raises its keyboard for a tap that lands on
 * an input.
 *
 * Drawing and radicals type into it, a character at a time, so a word you can
 * read but not type is built up the same way as one you can.
 */

import { useState } from 'react'
import { DrawPad } from '../draw/DrawPad'
import { RadicalPicker } from './RadicalPicker'

type Tool = 'draw' | 'radicals'

interface Props {
  q: string
  onType: (q: string) => void
  /**
   * Focusing the box goes to the search page. True when that meant leaving
   * another page, in which case the text is selected, ready to be replaced.
   */
  onFocus: () => boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}

const coarse = () => window.matchMedia('(pointer: coarse)').matches

export function SearchBar({ q, onType, onFocus, inputRef }: Props) {
  const [tool, setTool] = useState<Tool | null>(null)

  function toggle(t: Tool) {
    setTool((cur) => (cur === t ? null : t))
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
              // Enter is done typing: put the keyboard away to show the results.
              if (e.key === 'Enter' && coarse()) e.currentTarget.blur()
            }}
            placeholder="English, Japanese or romaji"
            aria-label="Search"
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
              aria-label="Clear the search"
              title="Clear"
            >
              ×
            </button>
          )}
          {!q && !coarse() && <kbd className="searchbar-kbd">/</kbd>}
        </div>
        <button
          className="searchbar-tool"
          data-on={tool === 'draw' || undefined}
          aria-pressed={tool === 'draw'}
          onClick={() => toggle('draw')}
          title="Draw a character"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 17c2-.4 3.2-1.2 4.3-2.3L16.5 5.5a1.8 1.8 0 0 0-2.5-2.5L4.8 12.2C3.7 13.3 3.2 14.8 3 17Z" />
          </svg>
          <span>Draw</span>
        </button>
        <button
          className="searchbar-tool"
          data-on={tool === 'radicals' || undefined}
          aria-pressed={tool === 'radicals'}
          onClick={() => toggle('radicals')}
          title="Pick a character by its parts"
        >
          <span className="searchbar-tool-glyph" aria-hidden>
            部
          </span>
          <span>Radicals</span>
        </button>
      </div>

      {tool && (
        <div className="searchtools">
          {tool === 'draw' && <DrawPad onPick={pick} />}
          {tool === 'radicals' && <RadicalPicker onPick={pick} />}
          <button className="searchtools-close clear" onClick={() => setTool(null)}>
            done
          </button>
        </div>
      )}
    </div>
  )
}
