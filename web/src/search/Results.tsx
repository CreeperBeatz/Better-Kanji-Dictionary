/**
 * The pages a search puts at the bottom of the rail's stack: what a query
 * found, a whole JLPT level, and -- with nothing typed -- the way in to both.
 */

import { useEffect, useState } from 'react'
import { api, type KanjiNode, type SearchResponse, type Word } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { inflectionLabel } from '../i18n/grammar'
import type { Level } from '../nav'
import { Pitch } from './Pitch'

export const LEVELS: Level[] = [5, 4, 3, 2, 1]

const S = strings(
  {
    common: 'common word',
    open: 'Open this entry',
    notTranslated: 'not translated into Bulgarian yet',
    inN: 'in {n}',
    resultsFor: 'Results for {q}',
    readAs: 'read as {r}',
    alternative: 'in Bulgarian: {q}',
    alternativeTitle: 'Search for {q} in Bulgarian',
    nothing: 'Nothing matched {q}.',
    looking: 'looking',
    home:
      'Search by meaning, reading or character. Draw it if you cannot type it, or pick it apart by ' +
      'radical; either one types into the search, so you can build a word a character at a time.',
    browse: 'Browse a JLPT level',
    parts: 'Parts they are built from',
    partsHint: 'These carry no JLPT level of their own, but N{level} cannot be written without them.',
    bound: 'bound form',
  },
  {
    common: 'честа дума',
    open: 'Отворете статията',
    notTranslated: 'още не е преведено на български',
    inN: 'в {n}',
    resultsFor: 'Резултати за {q}',
    readAs: 'прочетено като {r}',
    alternative: 'на български: {q}',
    alternativeTitle: 'Търсете {q} на български',
    nothing: 'Нищо не отговаря на {q}.',
    looking: 'търсене',
    home:
      'Търсете по значение, четене или йероглиф. Нарисувайте го, ако не можете да го напишете, или го ' +
      'разглобете по радикали; и двете пишат в търсачката, така че можете да съставите дума йероглиф по йероглиф.',
    browse: 'Разгледайте ниво от JLPT',
    parts: 'Части, от които са изградени',
    partsHint: 'Те нямат собствено ниво в JLPT, но без тях N{level} не може да се напише.',
    bound: 'свързана форма',
  },
)

// What each query found, so going back to it draws at once, scrolled where it was.
// Keyed by language too: in Bulgarian, Latin can also be read as shlyokavitsa.
const found = new Map<string, SearchResponse>()
const levels = new Map<Level, { kanji: KanjiNode[]; components: KanjiNode[] }>()

const keyOf = (lang: Lang, q: string) => `${lang} ${q}`

function remember(key: string, r: SearchResponse) {
  found.set(key, r)
  if (found.size > 60) found.delete(found.keys().next().value!)
}

function WordRow({ w, onKanji, onWord }: { w: Word; onKanji: (c: string) => void; onWord: (w: Word) => void }) {
  const lang = useLang()
  const t = S(lang)
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
        {w.common && <span className="word-common" title={t('common')} />}
      </p>
      {w.inflection && w.inflection.length > 0 && (
        <p className="word-inflection">{w.inflection.map((r) => inflectionLabel(r, lang)).join(', ')}</p>
      )}
      {/* The kanji above open the character; the rest of the row opens the entry. */}
      <button className="word-gloss word-open" onClick={() => onWord(w)} title={t('open')}>
        {w.senses.slice(0, 3).map((s, i) => {
          const g = glossOf(s, lang)
          return (
            <span key={i} className="sense" data-fallback={g.fallback || undefined}>
              {w.senses.length > 1 && <b>{i + 1}</b>}
              {g.value}
              {g.fallback && (
                <b className="gloss-fallback" title={t('notTranslated')}>
                  {' '}
                  EN
                </b>
              )}
            </span>
          )
        })}
      </button>
    </li>
  )
}

interface ChipKanji {
  char: string
  meanings: string[]
  meaningsBg?: string[] | null
  fanout?: number | null
}

function KanjiChip({ k, onKanji }: { k: ChipKanji; onKanji: (c: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const m = meaningsOf(k, lang)
  return (
    <button
      className="kanji-hit"
      onClick={() => onKanji(k.char)}
      title={m.value.slice(0, 3).join(', ')}
      data-fallback={m.fallback || undefined}
    >
      <span className="kanji-hit-glyph">{k.char}</span>
      <span className="kanji-hit-meaning">
        {m.value[0] ?? ''}
        {(k.fanout ?? 0) > 0 && <span className="kanji-hit-fanout">{t('inN', { n: k.fanout ?? 0 })}</span>}
      </span>
    </button>
  )
}

interface SearchProps {
  q: string
  onKanji: (char: string) => void
  onWord: (word: Word) => void
  onLevel: (level: Level) => void
  /** Search for something else, as if it had been typed: a suggested reading. */
  onSearch: (q: string) => void
}

export function SearchPage({ q, onKanji, onWord, onLevel, onSearch }: SearchProps) {
  const lang = useLang()
  const t = S(lang)
  const term = q.trim()
  const key = keyOf(lang, term)
  const [result, setResult] = useState<SearchResponse | null>(() => found.get(key) ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!term) {
      setResult(null)
      setBusy(false)
      return
    }
    const known = found.get(key)
    if (known) {
      setResult(known)
      setBusy(false)
      return
    }
    let stale = false
    setBusy(true)
    const timer = setTimeout(() => {
      api.search(term, lang).then(
        (d) => {
          remember(key, d)
          if (!stale) (setResult(d), setBusy(false))
        },
        () => !stale && setBusy(false),
      )
    }, 140)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [term, lang, key])

  if (!term) return <HomePage onLevel={onLevel} />

  const reading = result?.interpretation?.reading
  const alternatives = result?.alternatives ?? []

  // The last answer stays up while the next one is on its way, so the list
  // does not blink on every key.
  return (
    <section className="rail-section search-page" aria-label={t('resultsFor', { q: term })} aria-busy={busy}>
      {(reading || alternatives.length > 0) && (
        <p className="hint reading-note">
          {reading && t('readAs', { r: reading })}
          {alternatives.map((a) => (
            <span key={a.query}>
              {reading && ' · '}
              <button className="clear" onClick={() => onSearch(a.query)} title={t('alternativeTitle', { q: a.query })}>
                {t('alternative', { q: a.query })}
              </button>
            </span>
          ))}
        </p>
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
        <p className="hint">{t('nothing', { q: term })}</p>
      )}
      {!result && busy && <p className="hint">{t('looking')}</p>}
    </section>
  )
}

function HomePage({ onLevel }: { onLevel: (level: Level) => void }) {
  const t = S(useLang())
  return (
    <section className="rail-section search-home">
      <p className="hint">{t('home')}</p>
      <h3 className="overlay-group">{t('browse')}</h3>
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
  const lang = useLang()
  const t = S(lang)
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

  const meanings = (k: KanjiNode) => meaningsOf(k, lang).value.slice(0, 3).join(', ')

  return (
    <section className="rail-section">
      <h3 className="overlay-group">
        N{level} <span className="strokes-count">{data?.kanji.length ?? ''}</span>
      </h3>
      {!data && <p className="hint">{t('looking')}</p>}
      {data && (
        <div className="level-grid">
          {data.kanji.map((k) => (
            <button key={k.char} className="level-cell" onClick={() => onKanji(k.char)} title={meanings(k)}>
              {k.char}
            </button>
          ))}
        </div>
      )}

      {data && data.components.length > 0 && (
        <>
          <h3 className="overlay-group">
            {t('parts')} <span className="strokes-count">{data.components.length}</span>
          </h3>
          <p className="hint">{t('partsHint', { level })}</p>
          <div className="level-grid">
            {data.components.map((k) => (
              <button
                key={k.char}
                className="level-cell"
                data-faint="true"
                onClick={() => onKanji(k.char)}
                title={meanings(k) || t('bound')}
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
