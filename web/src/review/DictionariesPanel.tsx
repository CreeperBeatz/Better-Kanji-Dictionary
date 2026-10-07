/**
 * Other dictionaries on a meanings card, above the board: Kodansha's senses
 * with the words it lists under each, 新漢語林's 字義, Цалта's entry and
 * Wiktionary's senses, plus a link to 漢字ペディア (the 漢検漢字辞典, free
 * to read, never copied).
 *
 * Each sense says which group its words on the board are in now
 * (review/dictMatch.ts), so a sense with no group of its own, or one whose
 * words are split between groups, stands out. It follows the board live.
 * Reviewers and the admin only; a server without the dictionaries' files
 * shows only what it has.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { BoardWord, BookRef, DictSense, DictWord, KanjiDictionaries, MeaningGroup } from '../api'
import { strings, useLang } from '../i18n'
import type { Placements } from './board'
import { KanjiEntry, PagePopup } from './BookEvidence'
import { elsewhere, senseStats, type Bucket, type SenseStat } from './dictMatch'
import { CATCH_ALL } from './editors'

const S = strings(
  {
    title: 'Other dictionaries',
    hint: 'Each sense shows the group its words on the board are in now. Amber: its words are split between groups. A sense with no word on the board shows none.',
    elsewhere: '{n} words on the board are in another group than the rest of their dictionary sense (amber on the board).',
    kanjipedia: '漢字ペディア',
    kanjipediaTitle: 'The 漢検漢字辞典 on kanjipedia.jp, in a new tab: its numbered meanings, each with example words',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    core: 'core meaning',
    onSenses: 'compounds by sense',
    kun: 'kun words',
    special: 'special readings',
    kangorin: '新漢語林',
    japan: 'Japan-only sense',
    kaiji: '解字',
    compounds: '{n} compounds listed',
    wiktionary: 'Wiktionary (English)',
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
    page: 'page {n}',
    printed: 'printed page {n}',
    pageHint: 'The scan of the page, in a popup',
    nSplit: '{n} split',
  },
  {
    title: 'Други речници',
    hint: 'Всяко значение показва групата, в която са думите му на дъската сега. Кехлибарено: думите му са разделени между групи. Значение без дума на дъската не показва група.',
    elsewhere: '{n} думи на дъската са в друга група от останалите думи на значението си в речника (кехлибарени на дъската).',
    kanjipedia: '漢字ペディア',
    kanjipediaTitle: '漢検漢字辞典 на kanjipedia.jp, в нов раздел: номерираните значения, всяко с примерни думи',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    core: 'основно значение',
    onSenses: 'сложни думи по значение',
    kun: 'кун думи',
    special: 'особени четения',
    kangorin: '新漢語林',
    japan: 'значение само в Япония',
    kaiji: '解字',
    compounds: '{n} сложни думи в речника',
    wiktionary: 'Уикиречник (английски)',
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
    page: 'с. {n}',
    printed: 'отпечатана с. {n}',
    pageHint: 'Сканираната страница, в изскачащ прозорец',
    nSplit: '{n} разделени',
  },
)

/** **bold** and *italic* (Kodansha's field labels: *phys*) as the transcriptions mark them; the pictures of old glyphs ([img:金文]) are not here. */
function rich(text: string): ReactNode[] {
  return text
    .replace(/\[img:[^\]]*\]/g, '')
    .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/)
    .map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.length > 2 && p.startsWith('*') && p.endsWith('*') ? <i key={i}>{p.slice(1, -1)}</i> : p,
    )
}

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
  const [page, setPage] = useState<{ book: BookRef['book']; n: number } | null>(null)

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

  function wordList(list: DictWord[] | undefined) {
    if (!list?.length) return null
    return (
      <span className="dict-words" lang="ja">
        {list.map((w, i) => (
          <span
            key={i}
            className="dict-word"
            data-off={!(w.id != null && onBoard.has(w.id)) || undefined}
            data-away={(w.id != null && away.has(w.id)) || undefined}
            title={`${w.reading ?? ''} ${w.gloss ?? ''}${w.id != null && onBoard.has(w.id) ? '' : ` (${t('notOnBoard')})`}`.trim()}
          >
            {w.ja}
          </span>
        ))}
      </span>
    )
  }

  function sense(src: string, s: DictSense, extra?: ReactNode, subs?: { n: string; key: string }[]) {
    // A sense whose words are under its sub-senses (新漢語林's ㋐ ㋑) gets a chip per sub-sense with words.
    const withWords = (subs ?? []).filter((u) => stats.has(`${src}|${u.key}`))
    return (
      <li key={s.key} className="dict-sense">
        {s.n && <span className="dict-n">{s.n}</span>}
        {extra}
        <span className="dict-text">{rich(s.text)}</span>
        {stats.has(`${src}|${s.key}`) || !withWords.length ? chip(src, s.key) : null}
        {withWords.map((u) => (
          <span key={u.key} className="dict-sub">
            {u.n}
            {chip(src, u.key)}
          </span>
        ))}
        {wordList(s.words)}
      </li>
    )
  }

  const k = dicts.kodansha
  const g = dicts.kangorin
  // How many of a dictionary's senses have their words split between groups: shown while it is folded.
  const splitIn = (src: string) => [...stats].filter(([key, st]) => key.startsWith(`${src}|`) && st.counts.size > 1).length

  /** A dictionary folded to one line, as the books are cited elsewhere: which book, its entry, its pages. */
  function head(src: string, name: string, no: number | null | undefined, book: BookRef['book'] | null, pages: number[], extra?: ReactNode) {
    const n = splitIn(src)
    return (
      <summary className="book-head dict-sum">
        <span className="book-from">{t(book ? 'fromBook' : 'from')}:</span> <span className="book-name">{name}</span>
        {no != null && <> · №{no}</>}
        {book &&
          pages.map((p, i) => (
            <button
              key={p}
              type="button"
              className="clear book-page"
              title={t('pageHint')}
              onClick={(e) => {
                e.preventDefault() // the page, without folding or unfolding the entry
                setPage({ book, n: p })
              }}
            >
              {/* An entry over several pages: the first named, the rest just their numbers. */}
              {i === 0 ? t(book === 'kanji' ? 'printed' : 'page', { n: p }) : p} ↗
            </button>
          ))}
        {extra}
        {n > 0 && <span className="dict-split-n">{t('nSplit', { n })}</span>}
      </summary>
    )
  }

  return (
    <section className="dicts">
      <header className="dicts-head">
        <h4>{t('title')}</h4>
        <a className="dict-open" href={dicts.kanjipedia} target="_blank" rel="noopener" title={t('kanjipediaTitle')}>
          {t('kanjipedia')} <span aria-hidden>↗</span>
        </a>
        <p className="hint">{t('hint')}</p>
        {away.size > 0 && <p className="dicts-away">{t('elsewhere', { n: away.size })}</p>}
      </header>
      <div className="dicts-list">
        {k && (
          <details className="dict" data-src="kodansha">
            {head('kodansha', t('kodansha'), k.no, 'kodansha', k.pages, <span className="dict-core">{k.core.join(' · ')}</span>)}
            <div className="dict-paper">
              {k.senses.length > 0 && (
                <>
                  <h5>{t('onSenses')}</h5>
                  <ol className="dict-senses">{k.senses.map((s) => sense('kodansha', s))}</ol>
                </>
              )}
              {k.kun.length > 0 && (
                <>
                  <h5>{t('kun')}</h5>
                  {k.kun.map((h, i) => (
                    <div key={i} className="dict-kun">
                      <p>
                        <span className="dict-head" lang="ja">
                          {h.head}
                        </span>{' '}
                        <span className="dict-kana" lang="ja">
                          {h.kana}
                        </span>{' '}
                        {h.text && <span className="dict-text">{rich(h.text)}</span>}
                      </p>
                      <ol className="dict-senses">{h.senses.map((s) => sense('kodansha', h.senses.length === 1 && !s.n && !s.words?.length ? { ...s, text: '' } : s))}</ol>
                    </div>
                  ))}
                </>
              )}
              {k.special.length > 0 && (
                <>
                  <h5>{t('special')}</h5>
                  {wordList(k.special)}
                </>
              )}
            </div>
          </details>
        )}
        {g && (
          <details className="dict" data-src="kangorin">
            {head(
              'kangorin',
              t('kangorin'),
              g.no,
              'kangorin',
              g.pages,
              (g.old || g.classes.length > 0) && (
                <span className="dict-core" lang="ja">
                  {g.old && `〖${g.old}〗 `}
                  {g.classes.join(' ')}
                </span>
              ),
            )}
            <div className="dict-paper">
              <ol className="dict-senses">
                {g.senses.map((s) => sense('kangorin', s, s.japan ? <span className="dict-japan" title={t('japan')}>国</span> : undefined, s.subs))}
              </ol>
              {g.kaiji && (
                <p className="dict-kaiji">
                  <span className="dict-n">{t('kaiji')}</span> {rich(g.kaiji)}
                </p>
              )}
              {g.compounds > 0 && <p className="dict-note">{t('compounds', { n: g.compounds })}</p>}
            </div>
          </details>
        )}
        {dicts.tsalta && (
          <details className="dict" data-src="tsalta">
            {head('tsalta', t('tsalta'), dicts.tsalta.no, 'kanji', dicts.tsalta.pages)}
            <KanjiEntry src={dicts.tsalta} words="all" />
          </details>
        )}
        {dicts.wiktionary && dicts.wiktionary.length > 0 && (
          <details className="dict" data-src="wiktionary">
            {head('wiktionary', t('wiktionary'), null, null, [])}
            <div className="dict-paper">
              <ul className="dict-senses">
                {dicts.wiktionary.map((e, i) => (
                  <li key={i} className="dict-sense">
                    <span className="dict-n">{e.pos}</span>
                    {e.readings.length > 0 && <span className="dict-kana">{e.readings.join(', ')}</span>}{' '}
                    <span className="dict-text">{e.glosses.join('; ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
      {page && <PagePopup book={page.book} page={page.n} onClose={() => setPage(null)} />}
    </section>
  )
}
