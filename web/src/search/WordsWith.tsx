/**
 * A search for one kanji, by meaning: every word written with it, divided by the
 * meaning the kanji carries in each word -- 生活 and 生まれる under "life",
 * 生野菜 under "raw", 生憎 under "brings no meaning" -- once reviewers have
 * accepted the kanji's meaning groups and placed the word. The kanji page
 * shows only the most common few and opens this for the rest.
 *
 * Words not placed yet follow the groups, common first, a page at a time;
 * before any group is accepted they are the whole list. Offline, the device
 * knows only the kanji's most common words, so those are shown, and said to be.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { api, type MeaningGroup, type Word, type WordsWithResponse } from '../api'
import { strings, useLang } from '../i18n'
import { CATCH_ALL, groupLabel } from '../review/editors'

const S = strings(
  {
    title: 'Words with {char}',
    count: '{n} words',
    byMeaning: 'Divided by the meaning {char} has in each word.',
    notYet: 'The meanings of {char} are not reviewed yet, so its words are in one list, the most common first.',
    others: 'Not in a group',
    more: 'more',
    openKanji: 'open {char}',
    offline: 'Offline: only the most common words.',
    loading: 'looking',
    noMeaning: '{char} brings no meaning to these words',
    noMeaningHint: 'for sound-only spellings (ateji: 合羽 カッパ, 珈琲), whole-word spellings the separate kanji don’t explain (生姜, 百合, 生憎) and wordplay (米寿: 米 as 八十八)',
  },
  {
    title: 'Думи с {char}',
    count: '{n} думи',
    byMeaning: 'Разделени по значението, което {char} има във всяка дума.',
    notYet: 'Значенията на {char} още не са прегледани, затова думите са в един списък, най-честите първо.',
    others: 'Извън групите',
    more: 'още',
    openKanji: 'отворете {char}',
    offline: 'Без връзка: само най-честите думи.',
    loading: 'търсене',
    noMeaning: '{char} не внася значение в тези думи',
    noMeaningHint: 'за изписвания само по звук (атеджи: 合羽 カッパ, 珈琲), изписвания на цяла дума, които отделните кандзи не обясняват (生姜, 百合, 生憎), и игра на знаци (米寿: 米 като 八十八)',
  },
)

// Words shown per group at first, and how many more each "more" shows.
const PAGE = 30
const REST = 'rest'

export function WordsWith({
  char,
  common,
  onKanji,
  row,
  tools,
}: {
  char: string
  common: boolean
  onKanji: (c: string) => void
  /** The search's own row, so the words look as they do in any other search. */
  row: (w: Word, extra?: ReactNode) => ReactNode
  /** The sort and common-only controls, as on any search. */
  tools: ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState<WordsWithResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [more, setMore] = useState(false)
  // Per group: how many words are shown, and whether it is folded.
  const [shown, setShown] = useState<Record<string, number>>({})
  const [shut, setShut] = useState<Set<string>>(new Set())
  useEffect(() => {
    setShown({})
    setShut(new Set())
  }, [char])
  const fold = (id: string) =>
    setShut((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  // The whole title bar folds its group: a chevron, > when folded, pointing down when open.
  const head = (id: string, n: number, label: ReactNode, extra?: ReactNode) => (
    <h3>
      <button className="meaning-group-toggle" aria-expanded={!shut.has(id)} onClick={() => fold(id)}>
        <svg className="meaning-group-caret" viewBox="0 0 12 12" aria-hidden>
          <path d="M4 2.5 7.5 6 4 9.5" />
        </svg>
        <span className="meaning-group-label">{label}</span>
        <span className="hint">{n}</span>
        {extra}
      </button>
    </h3>
  )

  useEffect(() => {
    let stale = false
    setData(null)
    setOffline(false)
    api.wordsWith(char, common, 0, PAGE).then(
      (d) => !stale && setData(d),
      () =>
        // No server: the device's few most common words for the kanji, as one list.
        api.wordsFor(char).then(
          (d) => {
            if (stale) return
            setOffline(true)
            setData({ char, senses: null, groups: [], rest: { total: d.words.length, offset: 0, words: d.words } })
          },
          () => {},
        ),
    )
    return () => {
      stale = true
    }
  }, [char, common])

  async function loadMore() {
    if (!data) return
    setMore(true)
    try {
      const next = await api.wordsWith(char, common, data.rest.words.length, PAGE)
      setData((d) => d && { ...d, rest: { ...next.rest, words: [...d.rest.words, ...next.rest.words] } })
    } finally {
      setMore(false)
    }
  }

  const senses: MeaningGroup[] | null = data?.senses ?? null
  const total = data ? data.groups.reduce((n, g) => n + g.words.length, 0) + data.rest.total : 0

  return (
    <section className="rail-section search-page words-with" aria-label={t('title', { char })} aria-busy={!data}>
      <header className="words-with-head">
        <button className="words-with-kanji" onClick={() => onKanji(char)} title={t('openKanji', { char })} lang="ja">
          {char}
        </button>
        <div>
          <h2>{t('title', { char })}</h2>
          {data && (
            <p className="hint">
              {t('count', { n: total })} · {offline ? t('offline') : senses ? t('byMeaning', { char }) : t('notYet', { char })}
            </p>
          )}

        </div>
      </header>
      {tools}
      {!data && <p className="hint">{t('loading')}</p>}

      {data?.groups.map((g) => {
        const n = shown[g.id] ?? PAGE
        return (
          <div key={g.id} className="meaning-group" data-shut={shut.has(g.id) || undefined}>
            {head(
              g.id,
              g.words.length,
              g.id === CATCH_ALL ? t('noMeaning', { char }) : groupLabel(g.id, senses, lang),
              <>
                {((lang === 'bg' && g.noteBg) || g.note) && <span className="hint">{(lang === 'bg' && g.noteBg) || g.note}</span>}
                {g.id === CATCH_ALL && <span className="hint meaning-group-hint">{t('noMeaningHint')}</span>}
              </>,
            )}
            {!shut.has(g.id) && (
              <>
                <ol className="words">{g.words.slice(0, n).map((w) => row(w))}</ol>
                {g.words.length > n && (
                  <button className="clear words-more" onClick={() => setShown({ ...shown, [g.id]: n + PAGE })}>
                    {t('more')} ({g.words.length - n})
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}

      {/* Always there once there are groups, even empty: the end of the list. */}
      {data && (data.rest.words.length > 0 || data.groups.length > 0) && (
        <div className="meaning-group" data-shut={shut.has(REST) || undefined}>
          {data.groups.length > 0 && head(REST, data.rest.total, t('others'))}
          {!shut.has(REST) && (
            <>
              <ol className="words">
                {data.rest.words.map((w) => row(w))}
              </ol>
              {!offline && data.rest.words.length < data.rest.total && (
                <button className="clear words-more" disabled={more} onClick={loadMore}>
                  {t('more')} ({data.rest.total - data.rest.words.length})
                </button>
              )}
            </>
          )}
        </div>
      )}

    </section>
  )
}
