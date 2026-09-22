import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type KanjiNode, type SearchResponse, type Word } from '../api'
import { DrawPad } from '../draw/DrawPad'
import { Pitch } from './Pitch'
import { RadicalPicker } from './RadicalPicker'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (char: string) => void
  onWord: (word: Word) => void
}

type Mode = 'search' | 'draw' | 'radicals' | 1 | 2 | 3 | 4 | 5

const LEVELS: (1 | 2 | 3 | 4 | 5)[] = [5, 4, 3, 2, 1]

function WordRow({ w, onPick, onWord }: { w: Word; onPick: (c: string) => void; onWord: (w: Word) => void }) {
  return (
    <li className="word">
      <p className="word-head">
        <span className="word-forms">
          {[...w.headword].map((ch, i) =>
            ch >= '一' && ch <= '鿿' ? (
              <button key={i} className="word-char" onClick={() => onPick(ch)} title={ch}>
                {ch}
              </button>
            ) : (
              <span key={i}>{ch}</span>
            ),
          )}
        </span>
        {w.pitch ? <Pitch reading={w.reading} pitch={w.pitch} /> : <span className="word-reading">{w.reading}</span>}
        {w.common && <span className="word-common" title="common word" />}
      </p>
      {w.inflection && w.inflection.length > 0 && (
        <p className="word-inflection">{w.inflection.join(', ')}</p>
      )}
      {/* The kanji above open the graph; the rest of the row opens the entry. */}
      <button className="word-gloss word-open" onClick={() => onWord(w)} title="Open this entry">
        {w.senses.slice(0, 3).map((s, i) => (
          <span key={i} className="sense">
            {w.senses.length > 1 && <b>{i + 1}</b>}
            {s.gloss}
          </span>
        ))}
      </button>
    </li>
  )
}

interface ChipKanji {
  char: string
  meanings: string[]
  fanout?: number | null
}

function KanjiChip({ k, onPick, faint }: { k: ChipKanji; onPick: (c: string) => void; faint?: boolean }) {
  return (
    <button
      className="kanji-hit"
      data-faint={faint || undefined}
      onClick={() => onPick(k.char)}
      title={k.meanings.slice(0, 3).join(', ')}
    >
      <span className="kanji-hit-glyph">{k.char}</span>
      <span className="kanji-hit-meaning">
        {k.meanings[0] ?? (faint ? 'no dictionary entry' : '')}
        {(k.fanout ?? 0) > 0 && <span className="kanji-hit-fanout">in {k.fanout}</span>}
      </span>
    </button>
  )
}

export function SearchOverlay({ open, onClose, onPick, onWord }: Props) {
  const [mode, setMode] = useState<Mode>('search')
  const [q, setQ] = useState('')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [level, setLevel] = useState<{ kanji: KanjiNode[]; components: KanjiNode[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Text search
  useEffect(() => {
    if (mode !== 'search') return
    const term = q.trim()
    if (!term) {
      setResult(null)
      return
    }
    const mine = ++seq.current
    setBusy(true)
    const t = setTimeout(() => {
      api.search(term).then(
        (d) => mine === seq.current && (setResult(d), setBusy(false)),
        () => mine === seq.current && setBusy(false),
      )
    }, 160)
    return () => clearTimeout(t)
  }, [q, mode])

  // Level browsing
  useEffect(() => {
    if (typeof mode !== 'number') return
    let stale = false
    setBusy(true)
    setLevel(null)
    api.byLevel(mode).then(
      (d) => !stale && (setLevel({ kanji: d.kanji, components: d.components }), setBusy(false)),
      () => !stale && setBusy(false),
    )
    return () => {
      stale = true
    }
  }, [mode])

  const pick = useMemo(
    () => (char: string) => {
      onPick(char)
      onClose()
    },
    [onPick, onClose],
  )

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel" role="dialog" aria-modal="true" aria-label="Find a character">
        <input
          ref={inputRef}
          className="search-input overlay-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setMode('search')
          }}
          placeholder="English, Japanese or romaji"
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
        />

        <div className="overlay-tabs">
          <button data-on={mode === 'search'} onClick={() => setMode('search')}>
            Search
          </button>
          <button data-on={mode === 'draw'} onClick={() => setMode('draw')}>
            Draw
          </button>
          <button data-on={mode === 'radicals'} onClick={() => setMode('radicals')}>
            Radicals
          </button>
          <span className="overlay-tab-rule" />
          {LEVELS.map((n) => (
            <button key={n} data-on={mode === n} onClick={() => setMode(n)}>
              N{n}
            </button>
          ))}
        </div>

        <div className="overlay-body">
          {busy && mode !== 'draw' && mode !== 'radicals' && <p className="hint">looking</p>}

          {mode === 'search' && result && (
            <>
              {result.interpretation?.kind === 'romaji' && (
                <p className="hint reading-note">read as {result.interpretation.reading}</p>
              )}
              {result.kanji.length > 0 && (
                <div className="kanji-hits">
                  {result.kanji.map((k) => (
                    <KanjiChip key={k.char} k={k} onPick={pick} />
                  ))}
                </div>
              )}
              {result.words.length > 0 && (
                <ol className="words">
                  {result.words.map((w) => (
                    <WordRow
                      key={w.id}
                      w={w}
                      onPick={pick}
                      onWord={(word) => {
                        onWord(word)
                        onClose()
                      }}
                    />
                  ))}
                </ol>
              )}
              {result.words.length === 0 && result.kanji.length === 0 && !busy && (
                <p className="hint">Nothing matched.</p>
              )}
            </>
          )}

          {mode === 'draw' && <DrawPad onPick={pick} />}

          {mode === 'radicals' && <RadicalPicker onPick={pick} />}

          {mode === 'search' && !result && !busy && (
            <p className="hint">
              Search by meaning, reading or character. Draw it if you cannot type it, pick it
              apart by radical, or browse a whole JLPT level.
            </p>
          )}

          {typeof mode === 'number' && level && (
            <>
              <h3 className="overlay-group">
                N{mode} <span className="strokes-count">{level.kanji.length}</span>
              </h3>
              <div className="level-grid">
                {level.kanji.map((k) => (
                  <button
                    key={k.char}
                    className="level-cell"
                    onClick={() => pick(k.char)}
                    title={k.meanings.slice(0, 3).join(', ')}
                  >
                    {k.char}
                  </button>
                ))}
              </div>

              {level.components.length > 0 && (
                <>
                  <h3 className="overlay-group">
                    Parts they are built from{' '}
                    <span className="strokes-count">{level.components.length}</span>
                  </h3>
                  <p className="hint">
                    These carry no JLPT level of their own, but N{mode} cannot be written without them.
                  </p>
                  <div className="level-grid">
                    {level.components.map((k) => (
                      <button
                        key={k.char}
                        className="level-cell"
                        data-faint="true"
                        onClick={() => pick(k.char)}
                        title={k.meanings.slice(0, 3).join(', ') || 'bound form'}
                      >
                        {k.char}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
