/**
 * The search for `*生*`: every word written with one kanji, divided by the
 * meaning the kanji carries in each word -- 生活 and 生まれる under "life",
 * 生野菜 under "raw", 生憎 under "sound / fixed spelling" -- once reviewers have
 * accepted the kanji's meaning groups and placed the word. The kanji page
 * shows only the most common few and opens this for the rest.
 *
 * Words not placed yet follow the groups, common first, a page at a time;
 * before any group is accepted they are the whole list. Offline, the device
 * knows only the kanji's most common words, so those are shown, and said to be.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { api, type MeaningGroup, type Word, type WordsWithResponse } from '../api'
import { useAuth } from '../account/auth'
import { strings, useLang } from '../i18n'
import { SuggestDialog, SuggestLink, type SuggestTarget } from '../review/Suggest'
import { CATCH_ALL, groupLabel } from '../review/editors'

const S = strings(
  {
    title: 'Words with {char}',
    count: '{n} words',
    byMeaning: 'Divided by the meaning {char} has in each word.',
    notYet: 'The meanings of {char} are not reviewed yet, so its words are in one list, the most common first.',
    others: 'Not placed in a meaning yet',
    more: 'more',
    openKanji: 'open {char}',
    offline: 'Offline: only the most common words.',
    loading: 'looking',
    wrongGroup: 'wrong meaning?',
    wrongGroupTitle: 'Suggest which meaning of {char} this word uses',
  },
  {
    title: 'Думи с {char}',
    count: '{n} думи',
    byMeaning: 'Разделени по значението, което {char} има във всяка дума.',
    notYet: 'Значенията на {char} още не са прегледани, затова думите са в един списък, най-честите първо.',
    others: 'Още неразпределени по значение',
    more: 'още',
    openKanji: 'отворете {char}',
    offline: 'Без връзка: само най-честите думи.',
    loading: 'търсене',
    wrongGroup: 'грешно значение?',
    wrongGroupTitle: 'Предложете кое значение на {char} използва думата',
  },
)

const PAGE = 50

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
  const { user } = useAuth()
  const [data, setData] = useState<WordsWithResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [suggest, setSuggest] = useState<SuggestTarget | null>(null)
  const [more, setMore] = useState(false)

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
  const moveLink = (w: Word, current: string) => (
    <button
      className="clear word-move"
      title={t('wrongGroupTitle', { char })}
      onClick={() => setSuggest({ type: 'word_sense', subject: `${char}|${w.id}`, value: current, groups: senses })}
    >
      {t('wrongGroup')}
    </button>
  )

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

      {data?.groups.map((g) => (
        <div key={g.id} className="meaning-group">
          <h3>
            {groupLabel(g.id, senses, lang)}
            {g.note && <span className="hint"> — {g.note}</span>}
            {g.id !== CATCH_ALL && senses && (
              <SuggestLink onOpen={() => setSuggest({ type: 'kanji_senses', subject: char, value: senses })} />
            )}
          </h3>
          <ol className="words">{g.words.map((w) => row(w, user ? moveLink(w, g.id) : undefined))}</ol>
        </div>
      ))}

      {data && data.rest.words.length > 0 && (
        <div className="meaning-group">
          {data.groups.length > 0 && <h3>{t('others')}</h3>}
          <ol className="words">
            {data.rest.words.map((w) => row(w, senses && user ? moveLink(w, CATCH_ALL) : undefined))}
          </ol>
          {!offline && data.rest.words.length < data.rest.total && (
            <button className="clear words-more" disabled={more} onClick={loadMore}>
              {t('more')} ({data.rest.total - data.rest.words.length})
            </button>
          )}
        </div>
      )}

      {suggest && <SuggestDialog target={suggest} onClose={() => setSuggest(null)} />}
    </section>
  )
}
