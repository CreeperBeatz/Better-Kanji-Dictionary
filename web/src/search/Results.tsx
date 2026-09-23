/**
 * The pages a search puts at the bottom of the rail's stack: what a query
 * found, a whole JLPT level, and -- with nothing typed -- the way in to both.
 */

import { useEffect, useState } from 'react'
import { api, type KanjiNode, type SearchResponse, type Word } from '../api'
import type { Level } from '../nav'
import { Pitch } from './Pitch'

export const LEVELS: Level[] = [5, 4, 3, 2, 1]

// What each query found, so going back to it draws at once, scrolled where it was.
const found = new Map<string, SearchResponse>()
const levels = new Map<Level, { kanji: KanjiNode[]; components: KanjiNode[] }>()

function remember(q: string, r: SearchResponse) {
  found.set(q, r)
  if (found.size > 60) found.delete(found.keys().next().value!)
}

function WordRow({ w, onKanji, onWord }: { w: Word; onKanji: (c: string) => void; onWord: (w: Word) => void }) {
  return (
    <li className="word">
      <p className="word-head">
        <span className="word-forms">
          {[...w.headword].map((ch, i) =>
            ch >= '一' && ch <= '鿿' ? (
              <button key={i} className="word-char" onClick={() => onKanji(ch)} title={ch}>
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
      {w.inflection && w.inflection.length > 0 && <p className="word-inflection">{w.inflection.join(', ')}</p>}
      {/* The kanji above open the character; the rest of the row opens the entry. */}
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

function KanjiChip({ k, onKanji }: { k: ChipKanji; onKanji: (c: string) => void }) {
  return (
    <button className="kanji-hit" onClick={() => onKanji(k.char)} title={k.meanings.slice(0, 3).join(', ')}>
      <span className="kanji-hit-glyph">{k.char}</span>
      <span className="kanji-hit-meaning">
        {k.meanings[0] ?? ''}
        {(k.fanout ?? 0) > 0 && <span className="kanji-hit-fanout">in {k.fanout}</span>}
      </span>
    </button>
  )
}

interface SearchProps {
  q: string
  onKanji: (char: string) => void
  onWord: (word: Word) => void
  onLevel: (level: Level) => void
}

export function SearchPage({ q, onKanji, onWord, onLevel }: SearchProps) {
  const term = q.trim()
  const [result, setResult] = useState<SearchResponse | null>(() => found.get(term) ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!term) {
      setResult(null)
      setBusy(false)
      return
    }
    const known = found.get(term)
    if (known) {
      setResult(known)
      setBusy(false)
      return
    }
    let stale = false
    setBusy(true)
    const t = setTimeout(() => {
      api.search(term).then(
        (d) => {
          remember(term, d)
          if (!stale) (setResult(d), setBusy(false))
        },
        () => !stale && setBusy(false),
      )
    }, 140)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [term])

  if (!term) return <HomePage onLevel={onLevel} />

  // The last answer stays up while the next one is on its way, so the list
  // does not blink on every key.
  return (
    <section className="rail-section search-page" aria-label={`Results for ${term}`} aria-busy={busy}>
      {result?.interpretation?.kind === 'romaji' && (
        <p className="hint reading-note">read as {result.interpretation.reading}</p>
      )}
      {result && result.kanji.length > 0 && (
        <div className="kanji-hits">
          {result.kanji.map((k) => (
            <KanjiChip key={k.char} k={k} onKanji={onKanji} />
          ))}
        </div>
      )}
      {result && result.words.length > 0 && (
        <ol className="words">
          {result.words.map((w) => (
            <WordRow key={w.id} w={w} onKanji={onKanji} onWord={onWord} />
          ))}
        </ol>
      )}
      {result && result.words.length === 0 && result.kanji.length === 0 && !busy && (
        <p className="hint">Nothing matched {term}.</p>
      )}
      {!result && busy && <p className="hint">looking</p>}
    </section>
  )
}

function HomePage({ onLevel }: { onLevel: (level: Level) => void }) {
  return (
    <section className="rail-section search-home">
      <p className="hint">
        Search by meaning, reading or character. Draw it if you cannot type it, or pick it apart by
        radical; either one types into the search, so you can build a word a character at a time.
      </p>
      <h3 className="overlay-group">Browse a JLPT level</h3>
      <div className="level-links">
        {LEVELS.map((n) => (
          <button key={n} onClick={() => onLevel(n)}>
            N{n}
          </button>
        ))}
      </div>
    </section>
  )
}

export function LevelPage({ level, onKanji }: { level: Level; onKanji: (char: string) => void }) {
  const [data, setData] = useState(() => levels.get(level) ?? null)

  useEffect(() => {
    const known = levels.get(level)
    if (known) {
      setData(known)
      return
    }
    let stale = false
    setData(null)
    api.byLevel(level).then(
      (d) => {
        const got = { kanji: d.kanji, components: d.components }
        levels.set(level, got)
        if (!stale) setData(got)
      },
      () => {},
    )
    return () => {
      stale = true
    }
  }, [level])

  return (
    <section className="rail-section">
      <h3 className="overlay-group">
        N{level} <span className="strokes-count">{data?.kanji.length ?? ''}</span>
      </h3>
      {!data && <p className="hint">looking</p>}
      {data && (
        <div className="level-grid">
          {data.kanji.map((k) => (
            <button key={k.char} className="level-cell" onClick={() => onKanji(k.char)} title={k.meanings.slice(0, 3).join(', ')}>
              {k.char}
            </button>
          ))}
        </div>
      )}

      {data && data.components.length > 0 && (
        <>
          <h3 className="overlay-group">
            Parts they are built from <span className="strokes-count">{data.components.length}</span>
          </h3>
          <p className="hint">These carry no JLPT level of their own, but N{level} cannot be written without them.</p>
          <div className="level-grid">
            {data.components.map((k) => (
              <button
                key={k.char}
                className="level-cell"
                data-faint="true"
                onClick={() => onKanji(k.char)}
                title={k.meanings.slice(0, 3).join(', ') || 'bound form'}
              >
                {k.char}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
