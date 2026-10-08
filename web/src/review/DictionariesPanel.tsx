/**
 * Other dictionaries on a meanings card, above the board: Kodansha's senses
 * with a few of the words it lists under each, and Цалта's entry, folded at
 * first, set small (Dani, 2026-10-08). The rest -- 新漢語林, Wiktionary, a
 * link to 漢字ペディア -- and every word are in the dictionary tab
 * (BookViewer.tsx), behind the icon by the heading.
 *
 * Each sense says which group its words on the board are in now
 * (review/dictMatch.ts), so a sense with no group of its own, or one whose
 * words are split between groups, stands out. It follows the board live.
 * Reviewers and the admin only; a server without the dictionaries' files
 * shows only what it has.
 */
import { useMemo, type ReactNode } from 'react'
import type { BoardWord, BookRef, DictWord, KanjiDictionaries, MeaningGroup } from '../api'
import { strings, useLang } from '../i18n'
import type { Placements } from './board'
import { KanjiEntry } from './BookEvidence'
import { KodanshaEntry } from './DictEntries'
import { DictionaryLink, type DictBook } from './dictLink'
import { elsewhere, senseStats, type Bucket, type SenseStat } from './dictMatch'
import { CATCH_ALL } from './editors'

const S = strings(
  {
    title: 'Other dictionaries',
    elsewhere: '{n} words on the board are in another group than the rest of their dictionary sense (amber on the board).',
    elsewhere1: '1 word on the board is in another group than the rest of its dictionary sense (amber on the board).',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    core: 'core meaning',
    coreLabel: 'core:',
    onSenses: 'compounds by sense',
    kun: 'kun words',
    special: 'special readings',
    none: 'not on the board',
    split: 'split',
    catchAll: 'no meaning',
    noGroup: 'not in a group',
    unnamed: '(unnamed)',
    of: '{k} of {n}',
    notOnBoard: 'not on the board',
    fromBook: 'From the book',
    from: 'From',
    tsalta: 'Цалта’s kanji book',
    nSplit: '{n} senses split',
    nSplit1: '1 sense split',
    nSplitTitle: 'Senses of this dictionary whose words on the board are in more than one group. Open it: their chips are amber.',
    seeAll: '{n} more words: see all in the dictionary tab',
    seeAll1: '1 more word: see all in the dictionary tab',
  },
  {
    title: 'Други речници',
    elsewhere: '{n} думи на дъската са в друга група от останалите думи на значението си в речника (кехлибарени на дъската).',
    elsewhere1: '1 дума на дъската е в друга група от останалите думи на значението си в речника (кехлибарена на дъската).',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    core: 'основно значение',
    coreLabel: 'основно:',
    onSenses: 'сложни думи по значение',
    kun: 'кун думи',
    special: 'особени четения',
    none: 'не е на дъската',
    split: 'разделено',
    catchAll: 'без значение',
    noGroup: 'без група',
    unnamed: '(без име)',
    of: '{k} от {n}',
    notOnBoard: 'не е на дъската',
    fromBook: 'От книгата',
    from: 'От',
    tsalta: 'Канджи речникът на Цалта',
    nSplit: '{n} значения разделени',
    nSplit1: '1 значение разделено',
    nSplitTitle: 'Значения от този речник, чиито думи на дъската са в повече от една група. Отворете го: техните етикети са кехлибарени.',
    seeAll: 'още {n} думи: вижте всички в раздела с речниците',
    seeAll1: 'още 1 дума: вижте всички в раздела с речниците',
  },
)

/** Kodansha's words a sense on a card (the amber ones always show); the dictionary tab has them all. */
const WORDS_A_SENSE = 2

export function DictionariesPanel({
  dicts,
  words,
  placements,
  groups,
}: {
  dicts: KanjiDictionaries
  words: BoardWord[]
  placements: Placements
  groups: MeaningGroup[]
}) {
  const lang = useLang()
  const t = S(lang)
  const stats = useMemo(() => senseStats(dicts, words, placements, groups), [dicts, words, placements, groups])
  const away = useMemo(() => elsewhere(dicts, words, placements, groups), [dicts, words, placements, groups])
  const onBoard = useMemo(() => new Set(words.map((w) => w.id)), [words])

  const label = (b: Bucket) => {
    if (b === CATCH_ALL) return t('catchAll')
    if (b === null) return t('noGroup')
    const i = groups.findIndex((g) => g.id === b)
    return i < 0 ? t('noGroup') : `${i + 1} ${groups[i].en.trim() || t('unnamed')}`
  }

  /** Where a sense's words on the board are: one group, or split. */
  function chip(src: string, key: string) {
    const s: SenseStat | undefined = stats.get(`${src}|${key}`)
    if (!s) return <span className="dict-chip" data-none>{t('none')}</span>
    const ranked = [...s.counts.entries()].sort((a, b) => b[1] - a[1])
    if (ranked.length === 1)
      return (
        <span className="dict-chip" title={t('of', { k: s.total, n: s.total })}>
          → {label(ranked[0][0])}
        </span>
      )
    return (
      <span className="dict-chip" data-split title={t('split')}>
        → {ranked.map(([b, n]) => `${label(b)} (${n})`).join(' · ')}
      </span>
    )
  }

  const k = dicts.kodansha
  // How many of a dictionary's senses have their words split between groups: shown while it is folded.
  const splitIn = (src: string) => [...stats].filter(([key, st]) => key.startsWith(`${src}|`) && st.counts.size > 1).length

  /** A dictionary folded to one line, as the books are cited elsewhere: which book, its entry, its pages. */
  function head(src: string, name: string, no: number | null | undefined, book: BookRef['book'] | null, pages: number[], extra?: ReactNode) {
    const n = splitIn(src)
    return (
      <summary className="book-head dict-sum">
        <span className="book-from">{t(book ? 'fromBook' : 'from')}:</span> <span className="book-name">{name}</span>
        {no != null && <> · №{no}</>}
        {book && pages.length > 0 && <DictionaryLink char={dicts.char} book={book as DictBook} bookName={name} />}
        {extra}
        {n > 0 && (
          <span className="dict-split-n" title={t('nSplitTitle')}>
            {n === 1 ? t('nSplit1') : t('nSplit', { n })}
          </span>
        )}
      </summary>
    )
  }

  return (
    <section className="dicts dict-night">
      <header className="dicts-head">
        <h4>
          {t('title')} <DictionaryLink char={dicts.char} />
        </h4>
        {away.size > 0 && <p className="dicts-away">{away.size === 1 ? t('elsewhere1') : t('elsewhere', { n: away.size })}</p>}
      </header>
      <div className="dicts-list">
        {k && (
          <details className="dict" data-src="kodansha">
            {head('kodansha', t('kodansha'), k.no, 'kodansha', k.pages, <span className="dict-core" title={t('core')}>
                {t('coreLabel')} {k.core.join(' · ')}
              </span>)}
            <KodanshaEntry
              char={dicts.char}
              k={k}
              limit={WORDS_A_SENSE}
              mark={(w: DictWord) => {
                const on = w.id != null && onBoard.has(w.id)
                return { off: !on, away: w.id != null && away.has(w.id), title: on ? undefined : t('notOnBoard') }
              }}
              chip={(s) => (s.words?.length || stats.has(`kodansha|${s.key}`) ? chip('kodansha', s.key) : null)}
              more={(n) => (
                <DictionaryLink char={dicts.char} book="kodansha" view="digital" className="kd-all" label={t(n === 1 ? 'seeAll1' : 'seeAll', { n })} />
              )}
            />
          </details>
        )}
        {dicts.tsalta && (
          <details className="dict" data-src="tsalta">
            {head('tsalta', t('tsalta'), dicts.tsalta.no, 'kanji', dicts.tsalta.pages)}
            <KanjiEntry src={dicts.tsalta} words="all" />
          </details>
        )}
      </div>
    </section>
  )
}
