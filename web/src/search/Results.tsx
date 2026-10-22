/**
 * The pages a search puts at the bottom of the rail's stack: what a query
 * found, a whole JLPT level, and -- with nothing typed -- the way in to both.
 */

import { useEffect, useRef, useState, type ReactNode, memo, startTransition } from 'react'
import { useAuth } from '../account/auth'
import {
  api,
  ApiError,
  type KanjiNode,
  type SearchOrder,
  type SearchResponse,
  type SearchSort,
  type SemanticEvent,
  type SemanticResponse,
  type Word,
} from '../api'
import { clearHistory, useHistory, type Visit } from '../history'
import { strings, useLang, type Lang } from '../i18n'
import { isCommon } from '../similar/why'
import { ToMap } from '../StageControls'
import { SearchHelp } from './SearchHelp'
import { glossOf, meaningsOf } from '../i18n/content'
import { inflectionLabel } from '../i18n/grammar'
import type { Level } from '../nav'
import { Pitch } from './Pitch'
import { MarkedReading } from './MarkedReading'
import { Valency } from './Valency'
import { WordsWith } from './WordsWith'
import { ReadingKana } from '../detail/Readings'
import { plainReading } from '../local/japanese'
import { InstallNote } from '../install/InstallGuide'
import { warmKanji, warmWord } from '../warm'

export const LEVELS: Level[] = [5, 4, 3, 2, 1]

const S = strings(
  {
    common: 'common',
    commonTitle: 'JMdict marks this as a common word',
    uncommon: 'uncommon',
    commonOnly: 'Common only',
    commonOnlyTitle:
      'Leave out words JMdict does not mark as common, and kanji with no newspaper rank, no JLPT level and not jōyō. A kanji you typed stays.',
    sortBy: 'Sort by',
    sortNews: 'Newspaper rank',
    sortNewsTitle: 'Sort by how often newspapers use the word',
    sortJlpt: 'JLPT',
    sortJlptTitle: 'Sort by JLPT level',
    newsAsc: 'Most frequent first',
    newsDesc: 'Least frequent first',
    jlptAsc: 'N5 first',
    jlptDesc: 'N1 first',
    jlpt: 'On the JLPT N{n} vocabulary list (Jonathan Waller, a community reconstruction)',
    news: 'top {n}',
    star: 'One of the best examples of this meaning',
    newsTitle: 'Newspaper frequency: among the {n} most frequent words (JMdict nf{b} of 48)',
    open: 'Open this entry',
    notTranslated: 'not translated into Bulgarian yet',
    inN: 'in {n}',
    kanjiExpanded: 'Expanded kanji',
    kanjiExpandedTitle: 'Show each kanji as a row, with its readings, meanings, frequency and JLPT level',
    kanjiCommonTitle: 'Jōyō, on the JLPT lists, or among the 2,500 kanji most frequent in newspapers',
    kanjiNewsTitle: 'Newspaper frequency: number {n} of the 2,500 most frequent kanji',
    allWithKanji: 'See all words with {char}',
    backToResults: 'Back to the results for “{q}”',
    backToSearch: 'Back to the search',
    group: 'Group: {name}',
    groupCount: '{n} kanji, the most frequent first',
    groupGone: 'This group is not on the map any more.',
    groupError: 'The group could not be loaded.',
    resultsFor: 'Results for {q}',
    readAs: 'read as {r}',
    alternative: 'in Bulgarian: {q}',
    alternativeTitle: 'Search for {q} in Bulgarian',
    nothing: 'Nothing matched {q}.',
    looking: 'looking',
    more: 'more',
    recentSearches: 'Recent searches',
    clearHistory: 'clear the history',
    browse: 'Browse a JLPT level',
    parts: 'Parts they are built from',
    partsHint: 'These carry no JLPT level of their own, but N{level} cannot be written without them.',
    bound: 'bound form',
    semantic: 'Semantic search',
    semanticAsking: 'Searching by meaning…',
    semanticThinking: 'Thinking…',
    semanticNothing: 'Semantic search found nothing either.',
    semanticUnavailable: 'Semantic search is not available right now.',
    semanticSignIn: 'Sign in to search by meaning.',
    semanticAsk: 'Search by meaning',
    semanticAskTitle: 'Ask semantic search what this could mean (Enter)',
  },
  {
    common: 'честа',
    commonTitle: 'JMdict отбелязва думата като честа',
    uncommon: 'рядка',
    commonOnly: 'Само чести',
    commonOnlyTitle:
      'Без думите, които JMdict не отбелязва като чести, и без канджи без място във вестниците, без ниво JLPT и извън джойо. Канджи, което сте написали, остава.',
    sortBy: 'Подреждане по',
    sortNews: 'Вестници',
    sortNewsTitle: 'Подреждане по това колко често думата се среща във вестниците',
    sortJlpt: 'JLPT',
    sortJlptTitle: 'Подреждане по ниво от JLPT',
    newsAsc: 'Първо най-честите',
    newsDesc: 'Първо най-редките',
    jlptAsc: 'Първо N5',
    jlptDesc: 'Първо N1',
    jlpt: 'В списъка с думи за JLPT N{n} (Джонатан Уолър, реконструкция на общността)',
    news: 'топ {n}',
    star: 'Един от най-добрите примери за това значение',
    newsTitle: 'Честота във вестниците: сред {n} най-чести думи (JMdict nf{b} от 48)',
    open: 'Отворете статията',
    notTranslated: 'още не е преведено на български',
    inN: 'в {n}',
    kanjiExpanded: 'Разгърнати канджи',
    kanjiExpandedTitle: 'Покажете всяко канджи като ред, с четенията, значенията, честотата и нивото по JLPT',
    kanjiCommonTitle: 'Джойо, в списъците за JLPT или сред 2500-те най-чести канджи във вестниците',
    kanjiNewsTitle: 'Честота във вестниците: номер {n} от 2500-те най-чести канджи',
    allWithKanji: 'Всички думи с {char}',
    backToResults: 'Обратно към резултатите за „{q}“',
    backToSearch: 'Обратно към търсенето',
    group: 'Група: {name}',
    groupCount: '{n} канджи, най-честите първо',
    groupGone: 'Тази група вече я няма на картата.',
    groupError: 'Групата не се зареди.',
    resultsFor: 'Резултати за {q}',
    readAs: 'прочетено като {r}',
    alternative: 'на български: {q}',
    alternativeTitle: 'Търсете {q} на български',
    nothing: 'Нищо не отговаря на {q}.',
    looking: 'търсене',
    more: 'още',
    recentSearches: 'Скорошни търсения',
    clearHistory: 'изчистете историята',
    browse: 'Разгледайте ниво от JLPT',
    parts: 'Части, от които са изградени',
    partsHint: 'Те нямат собствено ниво в JLPT, но без тях N{level} не може да се напише.',
    bound: 'свързана форма',
    semantic: 'Семантично търсене',
    semanticAsking: 'Търсене по смисъл…',
    semanticThinking: 'Обмисляне…',
    semanticNothing: 'И семантичното търсене не откри нищо.',
    semanticUnavailable: 'Семантичното търсене не е достъпно в момента.',
    semanticSignIn: 'Влезте, за да търсите по смисъл.',
    semanticAsk: 'Търсене по смисъл',
    semanticAskTitle: 'Попитайте семантичното търсене какво може да означава това (Enter)',
  },
)

// What each query found, so going back to it draws at once, scrolled where it was.
// Keyed by language too: in Bulgarian, Latin can also be read as shlyokavitsa.
const found = new Map<string, SearchResponse>()
const levels = new Map<Level, { kanji: KanjiNode[]; components: KanjiNode[] }>()
// The level open on the empty search, kept across its coming and going.
let shownLevel: Level | null = null

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

const SORTS = [
  { value: 'news', label: 'sortNews', title: 'sortNewsTitle' },
  { value: 'jlpt', label: 'sortJlpt', title: 'sortJlptTitle' },
] as const

/**
 * The sort as one pill naming what it is ordered by; pressing it drops down
 * the choices and the way round. Picking one puts the menu away; turning the
 * order round leaves it open, so the arrow can be seen to change.
 */
function SortPill({
  sort,
  order,
  onPick,
  t,
}: {
  sort: SearchSort
  order: SearchOrder
  onPick: (sort: SearchSort, order: SearchOrder) => void
  t: ReturnType<typeof S>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const arrow = order === 'asc' ? '↑' : '↓'
  const current = SORTS.find((s) => s.value === sort)!
  return (
    <div className="sort-pill" ref={ref}>
      <button
        className="sort-pill-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`${t('sortBy')}: ${t(current.label)}, ${t(ORDER_LABEL[sort][order])}`}
      >
        {t(current.label)} <span aria-hidden>{arrow}</span>
        <span className="sort-pill-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="sort-menu" role="menu" aria-label={t('sortBy')}>
          {SORTS.map((s) => (
            <button
              key={s.value}
              role="menuitemradio"
              aria-checked={sort === s.value}
              data-on={sort === s.value || undefined}
              onClick={() => {
                onPick(s.value, order)
                setOpen(false)
              }}
              title={t(s.title)}
            >
              {t(s.label)}
            </button>
          ))}
          <button
            role="menuitem"
            className="sort-menu-order"
            onClick={() => onPick(sort, order === 'asc' ? 'desc' : 'asc')}
          >
            <span aria-hidden>{arrow}</span> {t(ORDER_LABEL[sort][order])}
          </button>
        </div>
      )}
    </div>
  )
}

// Common only is the default, so what is stored is the choice to see everything.
const ALL_WORDS_KEY = 'betterrtk:allWords'

/** Whether the search shows common words only, as it last did. */
export function commonOnly(): boolean {
  return localStorage.getItem(ALL_WORDS_KEY) !== '1'
}

function useCommon(): [boolean, () => void] {
  const [common, setCommon] = useState(() => localStorage.getItem(ALL_WORDS_KEY) !== '1')
  const toggle = () =>
    setCommon((on) => {
      if (on) localStorage.setItem(ALL_WORDS_KEY, '1')
      else localStorage.removeItem(ALL_WORDS_KEY)
      return !on
    })
  return [common, toggle]
}

function CommonFilter({ on, onToggle, t }: { on: boolean; onToggle: () => void; t: ReturnType<typeof S> }) {
  return (
    <button className="search-filter" aria-pressed={on} data-on={on || undefined} onClick={onToggle} title={t('commonOnlyTitle')}>
      {t('commonOnly')}
    </button>
  )
}

/** JMdict nf buckets are 500 words wide: nf12 is the top 6,000. */
export function newsRank(nf: number): string {
  const n = nf * 500
  return n < 1000 ? String(n) : `${n / 1000}k`
}

function remember(key: string, r: SearchResponse) {
  found.set(key, r)
  if (found.size > 60) found.delete(found.keys().next().value!)
}

/** Memoised: while a new search is on its way the old rows stay as they are. */
const WordRow = memo(WordRowView)

/** The senses a row shows, by number: the first three, or under a meaning one of its later
 *  senses has (焼く under "bake"), that sense first, its number kept. */
function senseOrder(w: Word): number[] {
  const all = w.senses.map((_, i) => i)
  const at = w.senseAt && w.senses[w.senseAt] ? w.senseAt : 0
  return [at, ...all.filter((i) => i !== at)].slice(0, 3)
}

function WordRowView({
  w,
  onWord,
  why,
  open,
  extra,
  starSlot = false,
}: {
  w: Word
  onWord: (w: Word) => void
  /** A place for the star at the end of its head: in a kanji's words, where some have one. */
  starSlot?: boolean
  why?: string | null
  /** Open beside the list right now. */
  open?: boolean
  /** Under the card: a "wrong meaning?" link in the words of one kanji. */
  extra?: ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  // The whole card opens the entry; its kanji are one tap further, on the entry's page.
  return (
    <li className="word">
      <button className="word-card" {...warmWord(w.id)} onClick={() => onWord(w)} title={t('open')} aria-current={open || undefined}>
        <span className="word-head">
          <span className="word-spelling">
            <span className="word-forms">{w.headword}</span>
            {w.pitch ? (
              <Pitch reading={w.reading} pitch={w.pitch} mark={w.mark} />
            ) : (
              <span className="word-reading">
                <MarkedReading reading={w.reading} mark={w.mark} />
              </span>
            )}
          </span>
          <Valency word={w} />
          <span className="word-common" data-common={w.common || undefined} title={w.common ? t('commonTitle') : undefined}>
            {w.common ? t('common') : t('uncommon')}
          </span>
          {/* In a kanji's words: one of its meaning's best examples. Its place
              is kept on every row there, so the rows line up. */}
          {starSlot && (
            <span className="word-star" title={w.star ? t('star') : undefined} aria-label={w.star ? t('star') : undefined}>
              {w.star && '★'}
            </span>
          )}
        </span>
        {w.inflection && w.inflection.length > 0 && (
          <span className="word-inflection">{w.inflection.map((r) => inflectionLabel(r, lang)).join(', ')}</span>
        )}
        <span className="word-foot">
          <span className="word-gloss">
            {senseOrder(w).map((i) => {
              const s = w.senses[i]
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
      {extra}
    </li>
  )
}

interface ChipKanji {
  char: string
  meanings: string[]
  meaningsBg?: string[] | null
  fanout?: number | null
  freq?: number | null
  jlpt?: number | null
  joyo?: boolean
  onYomi?: string[]
  kunYomi?: string[]
}

// '1' when the search shows kanji as rows, like its words; as chips otherwise.
const KANJI_ROWS_KEY = 'betterrtk:kanjiRows'

/** Kanji as rows or chips, kept on the device; every list in the search follows the one switch. */
function useKanjiRows(): [boolean, () => void] {
  const [on, setOn] = useState(() => localStorage.getItem(KANJI_ROWS_KEY) === '1')
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KANJI_ROWS_KEY && setOn(e.newValue === '1')
    const onSwitch = () => setOn(localStorage.getItem(KANJI_ROWS_KEY) === '1')
    window.addEventListener('storage', onStorage)
    window.addEventListener(KANJI_ROWS_KEY, onSwitch)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(KANJI_ROWS_KEY, onSwitch)
    }
  }, [])
  const toggle = () => {
    const next = !on
    localStorage.setItem(KANJI_ROWS_KEY, next ? '1' : '0')
    setOn(next)
    // Another list on screen (the search column beside the rail) follows.
    window.dispatchEvent(new Event(KANJI_ROWS_KEY))
  }
  return [on, toggle]
}

function KanjiRowsSwitch({ on, onToggle, t }: { on: boolean; onToggle: () => void; t: ReturnType<typeof S> }) {
  return (
    <button className="search-filter" aria-pressed={on} data-on={on || undefined} onClick={onToggle} title={t('kanjiExpandedTitle')}>
      {t('kanjiExpanded')}
    </button>
  )
}

/** A search's kanji: chips, or rows like its words. */
function KanjiList({ kanji, rows, onKanji, open }: { kanji: ChipKanji[]; rows: boolean; onKanji: (c: string) => void; open?: string | null }) {
  if (rows)
    return (
      <ol className="words kanji-rows">
        {kanji.map((k) => (
          <KanjiRow key={k.char} k={k} onKanji={onKanji} open={open === k.char} />
        ))}
      </ol>
    )
  return (
    <div className="kanji-hits">
      {kanji.map((k) => (
        <KanjiChip key={k.char} k={k} onKanji={onKanji} open={open === k.char} />
      ))}
    </div>
  )
}

const KanjiRow = memo(KanjiRowView)

/** A kanji as a row, laid out as a word's: readings by it, then common or not; meanings, frequency, level under. */
function KanjiRowView({ k, onKanji, open }: { k: ChipKanji; onKanji: (c: string) => void; open?: boolean }) {
  const lang = useLang()
  const t = S(lang)
  const m = meaningsOf(k, lang)
  const common = isCommon({ freq: k.freq ?? null, jlpt: k.jlpt ?? null, joyo: !!k.joyo })
  // As the kanji's page prints them: on in katakana, kun with its okurigana set apart.
  const on = [...new Set((k.onYomi ?? []).map(plainReading))].slice(0, 3)
  const kun = [...new Set((k.kunYomi ?? []).map(plainReading))].slice(0, 3)
  return (
    <li className="word">
      <button className="word-card kanji-row" {...warmKanji(k.char)} onClick={() => onKanji(k.char)} aria-current={open || undefined}>
        <span className="word-head">
          <span className="word-spelling">
            <span className="word-forms kanji-row-glyph" lang="ja">
              {k.char}
            </span>
            <span className="word-reading kanji-row-readings" lang="ja">
              {on.map((r) => (
                <span key={`on-${r}`} className="kanji-row-on">
                  <ReadingKana r={r} on />
                </span>
              ))}
              {kun.map((r) => (
                <span key={`kun-${r}`} className="kanji-row-kun">
                  <ReadingKana r={r} on={false} />
                </span>
              ))}
            </span>
          </span>
          <span className="word-common" data-common={common || undefined} title={common ? t('kanjiCommonTitle') : undefined}>
            {common ? t('common') : t('uncommon')}
          </span>
        </span>
        <span className="word-foot">
          <span className="word-gloss" data-fallback={m.fallback || undefined}>
            {m.value.slice(0, 4).join(', ')}
          </span>
          {(k.jlpt || k.freq) && (
            <span className="word-meta">
              {k.freq && (
                <span className="word-news" title={t('kanjiNewsTitle', { n: k.freq })}>
                  {t('news', { n: k.freq })}
                </span>
              )}
              {k.jlpt && (
                <span className="word-jlpt" data-level={k.jlpt}>
                  N{k.jlpt}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

const KanjiChip = memo(KanjiChipView)

function KanjiChipView({ k, onKanji, open }: { k: ChipKanji; onKanji: (c: string) => void; open?: boolean }) {
  const lang = useLang()
  const t = S(lang)
  const m = meaningsOf(k, lang)
  return (
    <button
      className="kanji-hit"
      aria-current={open || undefined}
      {...warmKanji(k.char)}
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
  /** Search for something else, as if it had been typed: a suggested reading. */
  onSearch: (q: string) => void
  /** The query semantic search was asked for (Enter), and how to ask for one. */
  asked: string | null
  onAsk: (q: string) => void
  /** What is open beside the list, when the search has a column of its own. */
  open?: { kanji?: string; word?: number }
  /** Shows the map of every character, from the empty search. */
  onMap: () => void
  /** The kanji whose words, by meaning, the search shows in place of its results. */
  words?: string
  /** Turns the search to every word with a kanji, by meaning, or (null) back to its results. */
  onWordsWith?: (char: string | null) => void
  /** The map group (its English name) whose kanji the search shows in place of its results. */
  group?: string
  /** Turns the search to a map group's kanji, or (null) back to its results. */
  onGroup?: (group: string | null) => void
  /** The rail shows a way back above the page (to the kanji the words were opened from): none of its own. */
  railBack?: boolean
}

/** How many words a result shows before the rest are added. */
const FIRST_ROWS = 10
// Words per screen, and how many more each "more" asks for; the server stops at a thousand.
const PAGE = 30
const MOST = 1000

export function SearchPage({
  q,
  onKanji,
  onWord,
  onSearch,
  asked,
  onAsk,
  open,
  onMap,
  words,
  onWordsWith,
  group,
  onGroup,
  railBack,
}: SearchProps) {
  const lang = useLang()
  const t = S(lang)
  const term = q.trim()
  const [common, toggleCommon] = useCommon()
  const [[sort, order], setSort] = useState(savedSort)
  const [kanjiRows, toggleKanjiRows] = useKanjiRows()
  // "more" asks again for 30 more, kept per query, so going back keeps what was opened.
  const base = keyOf(lang, common, `${sort}:${order}`, term)
  const [opened, setOpened] = useState<{ base: string; n: number } | null>(null)
  const limit = opened?.base === base ? opened.n : PAGE
  const key = `${base} #${limit}`
  const [result, setResult] = useState<SearchResponse | null>(() => found.get(key) ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!term || words || group) {
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
      api.search(term, lang, { common, sort, order, limit }).then(
        (d) => {
          remember(key, d)
          // As a transition: the rows are rendered between keystrokes, and a
          // key pressed meanwhile is answered first.
          if (!stale)
            startTransition(() => {
              setResult(d)
              setBusy(false)
            })
        },
        () => !stale && setBusy(false),
      )
    }, 140)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [term, lang, common, sort, order, key, limit, words, group])

  // The first screen of words is put up at once; the rest follow in a spare
  // moment, so a result never costs a keystroke more than a screenful.
  const [allRows, setAllRows] = useState(false)
  useEffect(() => {
    // After a "more" the rows are on screen already; drawing only the first again would jump.
    setAllRows(limit > PAGE)
    if (limit > PAGE || !result || result.words.length <= FIRST_ROWS) return
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 120))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const id = idle(() => startTransition(() => setAllRows(true)), { timeout: 600 })
    return () => cancel(id)
  }, [result, limit])

  function pickSort(next: SearchSort, nextOrder: SearchOrder) {
    localStorage.setItem(SORT_KEY, `${next}:${nextOrder}`)
    setSort([next, nextOrder])
  }

  // Every kanji in one group of the map: the search's own mode.
  if (group)
    return (
      <GroupKanji
        name={group}
        onKanji={onKanji}
        open={open?.kanji}
        rows={kanjiRows}
        onRows={toggleKanjiRows}
        back={
          onGroup &&
          !railBack && (
            <button className="back-link words-with-back" onClick={() => onGroup(null)}>
              <span aria-hidden>←</span> {term ? t('backToResults', { q: term }) : t('backToSearch')}
            </button>
          )
        }
      />
    )

  // Every word with one kanji, by meaning: the search's own mode.
  if (words)
    return (
      <WordsWith
        char={words}
        common={common}
        onKanji={onKanji}
        back={
          onWordsWith &&
          !railBack && (
            <button className="back-link words-with-back" onClick={() => onWordsWith(null)}>
              <span aria-hidden>←</span> {term ? t('backToResults', { q: term }) : t('backToSearch')}
            </button>
          )
        }
        tools={
          <div className="search-tools">
            <span />
            <CommonFilter on={common} onToggle={toggleCommon} t={t} />
          </div>
        }
        row={(w, extra) => <WordRow key={w.id} w={w} onWord={onWord} open={open?.word === w.id} extra={extra} starSlot />}
      />
    )

  if (!term) return <HomePage onKanji={onKanji} onWord={onWord} onSearch={onSearch} onMap={onMap} open={open?.kanji} />

  const tools = (
    <div className="search-tools">
      <SortPill sort={sort} order={order} onPick={pickSort} t={t} />
      <span className="search-switches">
        {(result?.kanji.length ?? 0) > 0 && <KanjiRowsSwitch on={kanjiRows} onToggle={toggleKanjiRows} t={t} />}
        <CommonFilter on={common} onToggle={toggleCommon} t={t} />
      </span>
    </div>
  )
  // Common only leaves out rare kanji as the server leaves out rare words,
  // but never one typed into the box: 翠 searched for is 翠 wanted.
  const kanji = (result?.kanji ?? []).filter((k) => !common || isCommon(k) || term.includes(k.char))
  // The kanji open beside the list, if it is one this search found.
  const openKanji = open?.kanji && kanji.some((k) => k.char === open.kanji) ? open.kanji : null

  const reading = result?.interpretation?.reading
  const empty = !!result && !busy && result.words.length === 0 && kanji.length === 0
  // The query the dictionary answered with nothing -- the one on screen, not the
  // one being typed, so the model is only asked once the dictionary has had its
  // say, and its answer stays up while the next query is on its way.
  const unmatched = result && result.words.length === 0 && kanji.length === 0 ? result.query : null
  // A question has nothing to match word for word; it is for Search by meaning.
  const question = result?.interpretation?.kind === 'question'
  const nothing = question ? null : <p className="hint">{t('nothing', { q: term })}</p>
  const alternatives = result?.alternatives ?? []

  // The last answer stays up while the next one is on its way, so the list
  // does not blink on every key.
  return (
    <section className="rail-section search-page" aria-label={t('resultsFor', { q: term })} aria-busy={busy}>
      {/* How to order what was found, and whether to show only common words and kanji. */}
      {tools}
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
      {kanji.length > 0 && <KanjiList kanji={kanji} rows={kanjiRows} onKanji={onKanji} open={open?.kanji} />}
      {openKanji && onWordsWith && (
        <button className="clear words-with-open" onClick={() => onWordsWith(openKanji)}>
          {t('allWithKanji', { char: openKanji })} →
        </button>
      )}
      {result && result.words.length > 0 && (
        <ol className="words">
          {(allRows ? result.words : result.words.slice(0, FIRST_ROWS)).map((w) => (
            <WordRow key={w.id} w={w} onWord={onWord} open={open?.word === w.id} />
          ))}
        </ol>
      )}
      {result && result.words.length >= limit && limit < MOST && (
        <button className="clear words-more" disabled={busy} onClick={() => setOpened({ base, n: Math.min(limit + PAGE, MOST) })}>
          {busy ? t('looking') : t('more')}
        </button>
      )}
      {/* When semantic search takes over, it says what it found instead; it
          hands the line back when it will not run (signed out, offline, off). */}
      {unmatched ? (
        <Semantic
          q={unmatched}
          asked={asked === unmatched}
          onAsk={() => onAsk(unmatched)}
          onKanji={onKanji}
          onWord={onWord}
          nothing={empty ? nothing : null}
        />
      ) : (
        empty && nothing
      )}
      {!result && busy && <p className="hint">{t('looking')}</p>}
    </section>
  )
}

// What semantic search said for each query, so going back to one does not ask again.
const understood = new Map<string, SemanticResponse>()

/**
 * Where an answer is: idle (not asked for yet), waiting (the request on its way),
 * thinking (the model has it), streaming (results arriving), done -- or
 * unavailable, or off when the server has no model set up at all.
 */
interface SemanticState {
  phase: 'idle' | 'waiting' | 'thinking' | 'streaming' | 'done' | 'unavailable' | 'off'
  answer: SemanticResponse | null
}

/**
 * What a language model takes a query to mean, for when the dictionary found
 * nothing: signed-in users only, online only -- the device has no model -- and
 * only when asked, with Enter or its button, since each answer costs money and
 * takes seconds. An answer already given shows again without asking.
 */
function Semantic({
  q,
  asked,
  onAsk,
  onKanji,
  onWord,
  nothing,
}: {
  q: string
  asked: boolean
  onAsk: () => void
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
    return known ? { phase: 'done', answer: known } : { phase: asked ? 'waiting' : 'idle', answer: null }
  })

  useEffect(() => {
    const known = understood.get(key)
    if (known) {
      setState({ phase: 'done', answer: known })
      return
    }
    if (!asked || !user || !navigator.onLine) {
      setState({ phase: 'idle', answer: null })
      return
    }
    setState({ phase: 'waiting', answer: null })
    const abort = new AbortController()
    let answer: SemanticResponse = { query: q, note: null, kanji: [], words: [] }
    let done = false
    const show = (phase: SemanticState['phase']) => {
      if (!abort.signal.aborted) setState({ phase, answer })
    }

    function onEvent(e: SemanticEvent) {
      if (e.type === 'thinking') show('thinking')
      else if (e.type === 'kanji') {
        answer = { ...answer, kanji: [...answer.kanji, e.kanji] }
        show('streaming')
      } else if (e.type === 'word') {
        answer = { ...answer, words: [...answer.words, e.word] }
        show('streaming')
      } else if (e.type === 'note') {
        answer = { ...answer, note: e.note }
        show('streaming')
      } else if (e.type === 'done') {
        done = true
        understood.set(key, answer)
        if (understood.size > 60) understood.delete(understood.keys().next().value!)
        show('done')
      }
    }

    // What came before a failure stays up; only an answer with nothing in it
    // says semantic search is not available.
    const broke = () => show(answer.kanji.length || answer.words.length ? 'done' : 'unavailable')

    api.semantic(q, lang, onEvent, abort.signal).then(
      () => {
        if (!done) broke()
      },
      (e) => {
        if (abort.signal.aborted) return
        // Not set up at all: say nothing. Set up but failing -- the spend cap,
        // OpenRouter down -- say so, once, and let the search stand as it is.
        if (e instanceof ApiError && e.code === 'semantic_off') show('off')
        else broke()
      },
    )
    return () => abort.abort()
  }, [key, q, lang, user, asked])

  if (!ready || state.phase === 'off') return nothing
  if (!user)
    return (
      <>
        {nothing}
        <p className="hint semantic-invite">{t('semanticSignIn')}</p>
      </>
    )
  if (state.phase === 'idle') {
    if (!navigator.onLine) return nothing
    return (
      <>
        {nothing}
        <button className="semantic-ask" onClick={onAsk} title={t('semanticAskTitle')}>
          <span className="semantic-mark" aria-hidden="true">
            ✦
          </span>
          {t('semanticAsk')}
          <kbd>Enter</kbd>
        </button>
      </>
    )
  }

  const { phase, answer } = state
  const explained = answer?.kanji.some((k) => k.why)
  return (
    <section className="semantic" aria-busy={phase !== 'done' && phase !== 'unavailable'}>
      <h3 className="semantic-label">
        <span className="semantic-mark" aria-hidden="true">
          ✦
        </span>
        {t('semantic')}
      </h3>
      {phase === 'waiting' && <p className="hint semantic-asking">{t('semanticAsking')}</p>}
      {phase === 'thinking' && <p className="hint semantic-asking">{t('semanticThinking')}</p>}
      {phase === 'unavailable' && <p className="hint">{t('semanticUnavailable')}</p>}
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
      {phase === 'done' && answer && answer.kanji.length === 0 && answer.words.length === 0 && (
        <p className="hint">{t('semanticNothing')}</p>
      )}
    </section>
  )
}

// How many the empty search lists; the history keeps more.
const SHOWN = 20

/** A magnifying glass, marking a query among the characters and words. */
function QueryIcon() {
  return (
    <svg className="recent-query-icon" viewBox="0 0 16 16" aria-hidden>
      <circle cx="6.8" cy="6.8" r="4.3" />
      <path d="M10 10l3.6 3.6" />
    </svg>
  )
}

/**
 * With nothing typed: the JLPT levels, then what you looked up lately -- one
 * list, newest first, whether it was typed, opened from a result or picked
 * on the graph.
 */
function HomePage({
  onKanji,
  onWord,
  onSearch,
  onMap,
  open,
}: {
  onKanji: (char: string) => void
  onWord: (word: Word) => void
  onSearch: (q: string) => void
  onMap: () => void
  /** The kanji open beside the search, marked in a level's grid. */
  open?: string
}) {
  const lang = useLang()
  const t = S(lang)
  const history = useHistory()
  // A level is searched in place: its kanji open under the buttons, and stay
  // open while you go into one of them and back.
  const [level, setLevel] = useState<Level | null>(() => shownLevel)
  const pickLevel = (n: Level) => {
    shownLevel = level === n ? null : n
    setLevel(shownLevel)
  }

  function row(v: Visit) {
    switch (v.kind) {
      case 'search':
        return (
          <button onClick={() => onSearch(v.q)}>
            <QueryIcon />
            <span className="recent-query">{v.q}</span>
          </button>
        )
      case 'kanji': {
        const m = v.meanings ? meaningsOf({ meanings: v.meanings, meaningsBg: v.meaningsBg }, lang).value : []
        return (
          <button {...warmKanji(v.char)} onClick={() => onKanji(v.char)}>
            <span className="recent-head" lang="ja">
              {v.char}
            </span>
            <span className="recent-gloss">{m.slice(0, 3).join(', ')}</span>
          </button>
        )
      }
      case 'word': {
        const w = v.word
        return (
          <button {...warmWord(w.id)} onClick={() => onWord(w)}>
            <span className="recent-head" lang="ja">
              {w.headword}
            </span>
            {w.reading !== w.headword && (
              <span className="recent-reading" lang="ja">
                {w.reading}
              </span>
            )}
            {w.senses[0] && <span className="recent-gloss">{glossOf(w.senses[0], lang).value}</span>}
          </button>
        )
      }
    }
  }

  const key = (v: Visit) => (v.kind === 'search' ? `s ${v.q}` : v.kind === 'kanji' ? `k ${v.char}` : `w ${v.word.id}`)

  return (
    <section className="rail-section search-home">
      <InstallNote />
      <div className="search-home-top">
        <ToMap onClick={onMap} />
        <SearchHelp onTry={onSearch} />
      </div>
      <h3 className="overlay-group">{t('browse')}</h3>
      <div className="level-links">
        {LEVELS.map((n) => (
          <button key={n} onClick={() => pickLevel(n)} aria-pressed={level === n} data-on={level === n || undefined}>
            N{n}
          </button>
        ))}
      </div>
      {level && <LevelGrid level={level} onKanji={onKanji} open={open} />}
      {/* With a level's kanji open, they are what is being searched; the history waits. */}
      {!level && history.length > 0 && (
        <>
          <h3 className="overlay-group">{t('recentSearches')}</h3>
          <ul className="recent-list">
            {history.slice(0, SHOWN).map((v) => (
              <li key={key(v)}>{row(v)}</li>
            ))}
          </ul>
          <p className="assoc-actions">
            <button className="clear" onClick={clearHistory}>
              {t('clearHistory')}
            </button>
          </p>
        </>
      )}
    </section>
  )
}

/** A whole JLPT level on a page of its own: where a /level/N link lands. */
export function LevelPage({ level, onKanji }: { level: Level; onKanji: (char: string) => void }) {
  return (
    <section className="rail-section">
      <LevelGrid level={level} onKanji={onKanji} />
    </section>
  )
}

/** A level's kanji, and the parts they are built from. `open` is marked. */
/**
 * Every kanji in one group of the map by meaning (pipeline/meaning_map.py),
 * the most frequent first, as the search's own kanji results: what the map
 * card's group name and a kanji page's group line open.
 */
function GroupKanji({
  name,
  onKanji,
  open,
  back,
  rows,
  onRows,
}: {
  name: string
  onKanji: (char: string) => void
  open?: string
  back?: ReactNode
  rows: boolean
  onRows: () => void
}) {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState(() => api.mapGroup.peek(name) ?? null)
  // 'gone': no group by that name now (the map was rebuilt); 'error': not reached.
  const [failed, setFailed] = useState<null | 'gone' | 'error'>(null)

  useEffect(() => {
    let stale = false
    setFailed(null)
    api.mapGroup(name).then(
      (d) => !stale && setData(d),
      (e: unknown) => !stale && setFailed((e as { status?: number }).status === 404 ? 'gone' : 'error'),
    )
    return () => {
      stale = true
    }
  }, [name])

  const kanji = data?.group.en === name ? data.kanji : []
  const shown = data?.group.en === name ? data.group[lang === 'bg' ? 'bg' : 'en'] : name

  return (
    <section className="rail-section search-page group-kanji" aria-label={t('group', { name: shown })} aria-busy={!data && !failed}>
      {back}
      <header className="words-with-head">
        <div>
          <h2>{t('group', { name: shown })}</h2>
          {kanji.length > 0 && <p className="hint">{t('groupCount', { n: kanji.length })}</p>}
        </div>
      </header>
      {!kanji.length && !failed && <p className="hint">{t('looking')}</p>}
      {failed === 'error' && <p className="hint">{t('groupError')}</p>}
      {failed === 'gone' && <p className="hint">{t('groupGone')}</p>}
      {kanji.length > 0 && (
        <>
          <div className="search-tools">
            <span />
            <KanjiRowsSwitch on={rows} onToggle={onRows} t={t} />
          </div>
          <KanjiList kanji={kanji} rows={rows} onKanji={onKanji} open={open} />
        </>
      )}
    </section>
  )
}

function LevelGrid({ level, onKanji, open }: { level: Level; onKanji: (char: string) => void; open?: string }) {
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
    <div className="level-block">
      <h3 className="overlay-group">
        N{level} <span className="strokes-count">{data?.kanji.length ?? ''}</span>
      </h3>
      {!data && <p className="hint">{t('looking')}</p>}
      {data && (
        <div className="level-grid">
          {data.kanji.map((k) => (
            <button
              key={k.char}
              className="level-cell"
              {...warmKanji(k.char)}
              onClick={() => onKanji(k.char)}
              title={meanings(k)}
              aria-current={open === k.char || undefined}
            >
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
                {...warmKanji(k.char)}
                onClick={() => onKanji(k.char)}
                title={meanings(k) || t('bound')}
              >
                {k.char}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
