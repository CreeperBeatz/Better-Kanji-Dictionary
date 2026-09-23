/**
 * The pages a search puts at the bottom of the rail's stack: what a query
 * found, a whole JLPT level, and -- with nothing typed -- the way in to both.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../account/auth'
import {
  api,
  ApiError,
  type KanjiNode,
  type SearchOrder,
  type SearchResponse,
  type SearchSort,
  type SemanticResponse,
  type Word,
} from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { inflectionLabel } from '../i18n/grammar'
import type { Level } from '../nav'
import { Pitch } from './Pitch'

export const LEVELS: Level[] = [5, 4, 3, 2, 1]

const S = strings(
  {
    common: 'common',
    commonTitle: 'JMdict marks this as a common word',
    uncommon: 'uncommon',
    commonOnly: 'Common words only',
    commonOnlyTitle: 'Leave out words JMdict does not mark as common',
    sortBy: 'Sort by',
    sortNews: 'Newspaper rank',
    sortNewsTitle: 'Sort by how often newspapers use the word',
    sortJlpt: 'JLPT',
    sortJlptTitle: 'Sort by JLPT level',
    newsAsc: 'Ascending: the most frequent first',
    newsDesc: 'Descending: the least frequent first',
    jlptAsc: 'Ascending: N5 first',
    jlptDesc: 'Descending: N1 first',
    jlpt: 'On the JLPT N{n} vocabulary list (Jonathan Waller, a community reconstruction)',
    news: 'top {n}',
    newsTitle: 'Newspaper frequency: among the {n} most frequent words (JMdict nf{b} of 48)',
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
    semantic: 'Semantic search',
    semanticAsking: 'Searching by meaning…',
    semanticNothing: 'Semantic search found nothing either.',
    semanticUnavailable: 'Semantic search is not available right now.',
    semanticSignIn: 'Sign in to search by meaning.',
  },
  {
    common: 'честа',
    commonTitle: 'JMdict отбелязва думата като честа',
    uncommon: 'рядка',
    commonOnly: 'Само чести думи',
    commonOnlyTitle: 'Без думите, които JMdict не отбелязва като чести',
    sortBy: 'Подреждане по',
    sortNews: 'Вестници',
    sortNewsTitle: 'Подреждане по това колко често думата се среща във вестниците',
    sortJlpt: 'JLPT',
    sortJlptTitle: 'Подреждане по ниво от JLPT',
    newsAsc: 'Възходящо: първо най-честите',
    newsDesc: 'Низходящо: първо най-редките',
    jlptAsc: 'Възходящо: първо N5',
    jlptDesc: 'Низходящо: първо N1',
    jlpt: 'В списъка с думи за JLPT N{n} (Джонатан Уолър, реконструкция на общността)',
    news: 'топ {n}',
    newsTitle: 'Честота във вестниците: сред {n} най-чести думи (JMdict nf{b} от 48)',
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
    semantic: 'Семантично търсене',
    semanticAsking: 'Търсене по смисъл…',
    semanticNothing: 'И семантичното търсене не откри нищо.',
    semanticUnavailable: 'Семантичното търсене не е достъпно в момента.',
    semanticSignIn: 'Влезте, за да търсите по смисъл.',
  },
)

// What each query found, so going back to it draws at once, scrolled where it was.
// Keyed by language too: in Bulgarian, Latin can also be read as shlyokavitsa.
const found = new Map<string, SearchResponse>()
const levels = new Map<Level, { kanji: KanjiNode[]; components: KanjiNode[] }>()

const keyOf = (lang: Lang, common: boolean, sort: string, q: string) =>
  `${lang}${common ? ' common' : ''} ${sort} ${q}`

// The sort, as "news:asc": what to order equally good matches by, and which way.
const SORT_KEY = 'betterrtk:searchSort'

const ORDER_LABEL = {
  news: { asc: 'newsAsc', desc: 'newsDesc' },
  jlpt: { asc: 'jlptAsc', desc: 'jlptDesc' },
} as const

function savedSort(): [SearchSort, SearchOrder] {
  const [sort, order] = (localStorage.getItem(SORT_KEY) ?? '').split(':')
  return [sort === 'jlpt' ? 'jlpt' : 'news', order === 'desc' ? 'desc' : 'asc']
}

// Common words only is the default, so what is stored is the choice to see them all.
const ALL_WORDS_KEY = 'betterrtk:allWords'

/** JMdict nf buckets are 500 words wide: nf12 is the top 6,000. */
function newsRank(nf: number): string {
  const n = nf * 500
  return n < 1000 ? String(n) : `${n / 1000}k`
}

function remember(key: string, r: SearchResponse) {
  found.set(key, r)
  if (found.size > 60) found.delete(found.keys().next().value!)
}

function WordRow({ w, onWord, why }: { w: Word; onWord: (w: Word) => void; why?: string | null }) {
  const lang = useLang()
  const t = S(lang)
  // The whole card opens the entry; its kanji are one tap further, on the entry's page.
  return (
    <li className="word">
      <button className="word-card" onClick={() => onWord(w)} title={t('open')}>
        <span className="word-head">
          <span className="word-forms">{w.headword}</span>
          {w.pitch ? <Pitch reading={w.reading} pitch={w.pitch} /> : <span className="word-reading">{w.reading}</span>}
          <span className="word-common" data-common={w.common || undefined} title={w.common ? t('commonTitle') : undefined}>
            {w.common ? t('common') : t('uncommon')}
          </span>
        </span>
        {w.inflection && w.inflection.length > 0 && (
          <span className="word-inflection">{w.inflection.map((r) => inflectionLabel(r, lang)).join(', ')}</span>
        )}
        <span className="word-foot">
          <span className="word-gloss">
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
          </span>
          {(w.jlpt || w.nf) && (
            <span className="word-meta">
              {w.nf && (
                <span className="word-news" title={t('newsTitle', { n: (w.nf * 500).toLocaleString(lang), b: w.nf })}>
                  {t('news', { n: newsRank(w.nf) })}
                </span>
              )}
              {w.jlpt && (
                <span className="word-jlpt" data-level={w.jlpt} title={t('jlpt', { n: w.jlpt })}>
                  N{w.jlpt}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      {why && <p className="semantic-why">{why}</p>}
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
  const [common, setCommon] = useState(() => localStorage.getItem(ALL_WORDS_KEY) !== '1')
  const [[sort, order], setSort] = useState(savedSort)
  const key = keyOf(lang, common, `${sort}:${order}`, term)
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
      api.search(term, lang, { common, sort, order }).then(
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
  }, [term, lang, common, sort, order, key])

  function pickSort(next: SearchSort, nextOrder: SearchOrder) {
    localStorage.setItem(SORT_KEY, `${next}:${nextOrder}`)
    setSort([next, nextOrder])
  }

  function toggleCommon() {
    setCommon((on) => {
      if (on) localStorage.setItem(ALL_WORDS_KEY, '1')
      else localStorage.removeItem(ALL_WORDS_KEY)
      return !on
    })
  }

  if (!term) return <HomePage onLevel={onLevel} />

  const reading = result?.interpretation?.reading
  const empty = !!result && !busy && result.words.length === 0 && result.kanji.length === 0
  // The query the dictionary answered with nothing -- the one on screen, not the
  // one being typed, so the model is only asked once the dictionary has had its
  // say, and its answer stays up while the next query is on its way.
  const unmatched = result && result.words.length === 0 && result.kanji.length === 0 ? result.query : null
  const nothing = <p className="hint">{t('nothing', { q: term })}</p>
  const alternatives = result?.alternatives ?? []

  // The last answer stays up while the next one is on its way, so the list
  // does not blink on every key.
  return (
    <section className="rail-section search-page" aria-label={t('resultsFor', { q: term })} aria-busy={busy}>
      {/* How the query was read on the left, the filter on the right, one line. */}
      {/* How to order what was found, and whether to show only common words. */}
      <div className="search-tools">
        <div className="search-sort" role="group" aria-label={t('sortBy')}>
          <button
            aria-pressed={sort === 'news'}
            data-on={sort === 'news' || undefined}
            onClick={() => pickSort('news', order)}
            title={t('sortNewsTitle')}
          >
            {t('sortNews')}
          </button>
          <button
            aria-pressed={sort === 'jlpt'}
            data-on={sort === 'jlpt' || undefined}
            onClick={() => pickSort('jlpt', order)}
            title={t('sortJlptTitle')}
          >
            {t('sortJlpt')}
          </button>
          <button
            className="search-sort-order"
            onClick={() => pickSort(sort, order === 'asc' ? 'desc' : 'asc')}
            title={t(ORDER_LABEL[sort][order])}
            aria-label={t(ORDER_LABEL[sort][order])}
          >
            {order === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <button
          className="search-filter"
          aria-pressed={common}
          data-on={common || undefined}
          onClick={toggleCommon}
          title={t('commonOnlyTitle')}
        >
          {t('commonOnly')}
        </button>
      </div>
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
            <WordRow key={w.id} w={w} onWord={onWord} />
          ))}
        </ol>
      )}
      {/* When semantic search takes over, it says what it found instead; it
          hands the line back when it will not run (signed out, offline, off). */}
      {unmatched && isSentence(unmatched) ? (
        <Semantic q={unmatched} onKanji={onKanji} onWord={onWord} nothing={empty ? nothing : null} />
      ) : (
        empty && nothing
      )}
      {!result && busy && <p className="hint">{t('looking')}</p>}
    </section>
  )
}

/** Long enough to be a description rather than a word half typed. */
function isSentence(q: string): boolean {
  return q.length >= 8 || q.split(/\s+/).length >= 2
}

// What semantic search said for each query, so going back to one does not ask again.
const understood = new Map<string, SemanticResponse>()

// How long typing must pause before the model is asked. Each call costs money
// and takes seconds, so not on every key.
const SEMANTIC_PAUSE = 700

type SemanticState =
  | { kind: 'waiting' }
  | { kind: 'done'; answer: SemanticResponse }
  | { kind: 'unavailable' }
  | { kind: 'off' }

/**
 * What a language model takes a query to mean, for when the dictionary found
 * nothing: signed-in users only, and online only -- the device has no model.
 */
function Semantic({
  q,
  onKanji,
  onWord,
  nothing,
}: {
  q: string
  onKanji: (c: string) => void
  onWord: (w: Word) => void
  /** The dictionary's "nothing matched", shown only when semantic search will not run. */
  nothing: ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const { user, ready } = useAuth()
  const key = `${lang} ${q}`
  const [state, setState] = useState<SemanticState>(() => {
    const known = understood.get(key)
    return known ? { kind: 'done', answer: known } : { kind: 'waiting' }
  })

  useEffect(() => {
    const known = understood.get(key)
    if (known) {
      setState({ kind: 'done', answer: known })
      return
    }
    setState({ kind: 'waiting' })
    if (!user || !navigator.onLine) return
    let stale = false
    const timer = setTimeout(() => {
      api.semantic(q, lang).then(
        (answer) => {
          understood.set(key, answer)
          if (understood.size > 60) understood.delete(understood.keys().next().value!)
          if (!stale) setState({ kind: 'done', answer })
        },
        (e) => {
          // Not set up at all: say nothing. Set up but failing -- the spend cap,
          // OpenRouter down -- say so, once, and let the search stand as it is.
          if (!stale) setState({ kind: e instanceof ApiError && e.code === 'semantic_off' ? 'off' : 'unavailable' })
        },
      )
    }, SEMANTIC_PAUSE)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [key, q, lang, user])

  if (!ready || state.kind === 'off') return nothing
  if (!user)
    return (
      <>
        {nothing}
        <p className="hint semantic-invite">{t('semanticSignIn')}</p>
      </>
    )
  if (state.kind === 'waiting' && !navigator.onLine) return nothing

  const answer = state.kind === 'done' ? state.answer : null
  const explained = answer?.kanji.some((k) => k.why)
  return (
    <section className="semantic" aria-busy={state.kind === 'waiting'}>
      <h3 className="semantic-label">
        <span className="semantic-mark" aria-hidden="true">
          ✦
        </span>
        {t('semantic')}
      </h3>
      {state.kind === 'waiting' && <p className="hint semantic-asking">{t('semanticAsking')}</p>}
      {state.kind === 'unavailable' && <p className="hint">{t('semanticUnavailable')}</p>}
      {answer?.note && <p className="semantic-note">{answer.note}</p>}
      {answer && answer.kanji.length > 0 && explained && (
        <ul className="semantic-kanji">
          {answer.kanji.map((k) => (
            <li key={k.char}>
              <KanjiChip k={k} onKanji={onKanji} />
              {k.why && <p className="semantic-why">{k.why}</p>}
            </li>
          ))}
        </ul>
      )}
      {answer && answer.kanji.length > 0 && !explained && (
        <div className="kanji-hits">
          {answer.kanji.map((k) => (
            <KanjiChip key={k.char} k={k} onKanji={onKanji} />
          ))}
        </div>
      )}
      {answer && answer.words.length > 0 && (
        <ol className="words">
          {answer.words.map((w) => (
            <WordRow key={w.id} w={w} onWord={onWord} why={w.why} />
          ))}
        </ol>
      )}
      {answer && answer.kanji.length === 0 && answer.words.length === 0 && (
        <p className="hint">{t('semanticNothing')}</p>
      )}
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
