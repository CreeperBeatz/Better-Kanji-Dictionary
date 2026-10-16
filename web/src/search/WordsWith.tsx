/**
 * Every word written with one kanji, divided by the
 * meaning the kanji carries in each word -- 生活 and 生まれる under "life",
 * 生野菜 under "raw", 生憎 under "brings no meaning" -- once reviewers have
 * accepted the kanji's meaning groups and placed the word. The kanji page
 * shows only the most common few and opens this for the rest.
 *
 * Each meaning is a card as on the kanji's page, with the same number: its
 * words by how they read the kanji, kun, on, then the special readings. Opened
 * from one card's "all words", that card is open and in view, the others folded.
 *
 * Words not placed yet follow the groups, common first, a page at a time;
 * before any group is accepted they are the whole list. Offline, the device
 * knows only the kanji's most common words, so those are shown, and said to be.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { api, type MeaningGroup, type Word, type WordsWithResponse } from '../api'
import { useFold } from '../detail/fold'
import { share } from '../detail/lanes'
import { bringToTop, peekWordsFocus, takeWordsFocus } from '../detail/meaningFocus'
import { WordLanes } from '../detail/WordLanes'
import { strings, useLang } from '../i18n'
import { reducedMotion } from '../media'
import { CATCH_ALL, groupLabel } from '../review/editors'
import { toggled } from '../sets'
import { warmKanji } from '../warm'

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
    noMeaningHint: 'за изписвания само по звук (атеджи: 合羽 カッパ, 珈琲), изписвания на цяла дума, които отделните канджи не обясняват (生姜, 百合, 生憎), и игра на знаци (米寿: 米 като 八十八)',
  },
)

// Words shown per card at first, and how many more each "more" shows.
const FIRST = 20
const MORE = 20
// The words in no group: the first page asked for, then a page a "more".
const REST_FIRST = 8
const REST = 'rest'

/** What the list asks for first, kept by the api: for opening it whole (App.tsx warm). */
export function wordsWithKey(char: string, common: boolean): string {
  return `${char}|${common ? 'true' : 'false'}|${REST_FIRST}`
}

/**
 * How a kanji's word cards stand: the card it was opened at, if any (that one
 * open, the others folded), which ask that was, the cards turned from how they
 * start, and how many words each shows.
 */
interface View {
  char: string
  at: string | null
  n: number
  turned: Set<string>
  shown: Record<string, number>
}

/** Each kanji's, while the app is open. */
const viewOf = new Map<string, View>()

/** Where a meaning's card is in the words. */
const cardAnchor = (id: string) => `words-${id}`

/**
 * A group's words by lane: kun, the on readings each in a list of its own,
 * the readings most of its words have first, and the special readings. The
 * starred words, the meaning's best examples, lead each. Null when the words
 * say no lane: a database from before the readings stage.
 */
function lanesOf(list: Word[]): { kun: Word[]; ons: Word[][]; special: Word[] } | null {
  if (!list.some((w) => w.lane)) return null
  const words = [...list.filter((w) => w.star), ...list.filter((w) => !w.star)]
  const by = new Map<string, Word[]>()
  for (const w of words) {
    if (w.lane === 'kun' || w.lane === 'special') continue
    const key = w.as ?? ''
    by.set(key, [...(by.get(key) ?? []), w])
  }
  return {
    kun: words.filter((w) => w.lane === 'kun'),
    ons: [...by.values()].sort((a, b) => b.length - a.length),
    special: words.filter((w) => w.lane === 'special'),
  }
}

/** A card: its number, title and count, a caret; what it says under it; its words, folded away. */
function Card({
  id,
  n,
  label,
  count,
  about,
  open,
  onToggle,
  dashed = false,
  children,
}: {
  id: string
  /** The meaning's number, as on the kanji's page; none on the cards that are not a meaning. */
  n?: number
  label: ReactNode
  count: number
  about?: ReactNode
  open: boolean
  onToggle: () => void
  /** The words in no group: not a meaning. */
  dashed?: boolean
  children: ReactNode
}) {
  // Its words open and shut as a movement (detail/fold.ts); folded once shut.
  const { shown, card, body } = useFold(open)
  return (
    <article className="meaning" id={cardAnchor(id)} data-folded={!shown || undefined} data-dashed={dashed || undefined} ref={card}>
      <header>
        <h3>
          <button className="meaning-toggle" aria-expanded={open} onClick={onToggle}>
            {n !== undefined && <span className="meaning-n">{n}</span>}
            <span className="meaning-label">{label}</span>
            <span className="meaning-count">{count}</span>
            <svg className="meaning-caret" viewBox="0 0 12 12" aria-hidden>
              <path d="M4 2.5 7.5 6 4 9.5" />
            </svg>
          </button>
        </h3>
      </header>
      {about}
      {shown && (
        <div className="meaning-body" ref={body}>
          {children}
        </div>
      )}
    </article>
  )
}

export function WordsWith({
  char,
  common,
  onKanji,
  row,
  tools,
  back,
}: {
  char: string
  common: boolean
  onKanji: (c: string) => void
  /** The search's own row, so the words look as they do in any other search. */
  row: (w: Word, extra?: ReactNode) => ReactNode
  /** The common-only control, as on a search. */
  tools: ReactNode
  /** The way back to the search's results. */
  back?: ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  // Asked for already, as opening its card does: there at once.
  const [data, setData] = useState<WordsWithResponse | null>(() => api.wordsWithFirst.peek(wordsWithKey(char, common)) ?? null)
  const [offline, setOffline] = useState(false)
  const [more, setMore] = useState(false)
  // How the cards stand, kept for the kanji so back finds them as they were
  // left. The card to open at is read as the page draws (peek) and let go of
  // after (take), so a second draw finds it too; a new ask starts them over.
  const asked = peekWordsFocus(char)
  const start = (): View => (!asked && viewOf.get(char)) || { char, at: asked?.id ?? null, n: asked?.n ?? 0, turned: new Set(), shown: {} }
  const [view, setView] = useState(start)
  if (view.char !== char || (asked && asked.n !== view.n)) setView(start())
  useEffect(() => takeWordsFocus(char))
  const change = (next: View) => {
    viewOf.set(char, next)
    setView(next)
  }
  const at = view.char === char ? view.at : null
  const isOpen = (id: string) => (at ? id === at : true) !== view.turned.has(id)
  const toggle = (id: string) => change({ ...view, turned: toggled(view.turned, id) })

  useEffect(() => {
    let stale = false
    setOffline(false)
    const known = api.wordsWithFirst.peek(wordsWithKey(char, common))
    if (known) {
      setData(known)
      return
    }
    setData(null)
    api.wordsWithFirst(wordsWithKey(char, common)).then(
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

  // The card it was opened at comes into view, once its words are there.
  const ready = !!data && data.groups.some((g) => g.id === at)
  useEffect(() => {
    if (!ready || !at) return
    return bringToTop(cardAnchor(at), !reducedMotion())
  }, [ready, at, view.n])

  async function loadMore() {
    if (!data) return
    setMore(true)
    try {
      const next = await api.wordsWith(char, common, data.rest.words.length, MORE)
      setData((d) => d && { ...d, rest: { ...next.rest, words: [...d.rest.words, ...next.rest.words] } })
    } finally {
      setMore(false)
    }
  }

  const senses: MeaningGroup[] | null = data?.senses ?? null
  const total = data ? data.groups.reduce((n, g) => n + g.words.length, 0) + data.rest.total : 0
  // Each meaning's number, as the kanji's page has it: the catch-all is not one.
  const number = new Map((senses ?? []).filter((s) => s.id !== CATCH_ALL).map((s, i) => [s.id, i + 1]))

  /** A card's words: by lane where the words say theirs, else one list; a page at a time. */
  function words(id: string, list: Word[]) {
    const n = view.shown[id] ?? FIRST
    const lanes = lanesOf(list)
    const moreButton = (left: number) =>
      left > 0 && (
        <button className="clear words-more" onClick={() => change({ ...view, shown: { ...view.shown, [id]: n + MORE } })}>
          {t('more')} ({left})
        </button>
      )
    if (!lanes) {
      return (
        <>
          <ol className="words">{list.slice(0, n).map((w) => row(w))}</ol>
          {moreButton(list.length - n)}
        </>
      )
    }
    const lists = [lanes.kun, ...lanes.ons]
    const [kun, ...ons] = share(
      lists,
      n,
      lists.map((l) => l.filter((w) => w.star).length),
    )
    const on = ons.flat()
    return (
      <>
        <WordLanes kun={kun} on={on} exceptions={lanes.special} row={(w) => row(w)} />
        {moreButton(list.length - lanes.special.length - kun.length - on.length)}
      </>
    )
  }

  return (
    <section className="rail-section search-page words-with" aria-label={t('title', { char })} aria-busy={!data}>
      {back}
      <header className="words-with-head">
        <button className="words-with-kanji" {...warmKanji(char)} onClick={() => onKanji(char)} title={t('openKanji', { char })} lang="ja">
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
        const about = (lang === 'bg' && g.aboutBg) || g.about
        const catchAll = g.id === CATCH_ALL
        return (
          <Card
            key={g.id}
            id={g.id}
            n={number.get(g.id)}
            label={catchAll ? t('noMeaning', { char }) : groupLabel(g.id, senses, lang)}
            count={g.words.length}
            about={
              catchAll ? (
                <p className="meaning-about hint">{t('noMeaningHint')}</p>
              ) : (
                about && <p className="meaning-about">{about}</p>
              )
            }
            open={isOpen(g.id)}
            onToggle={() => toggle(g.id)}
          >
            {words(g.id, g.words)}
          </Card>
        )
      })}

      {/* After the groups, even empty: the end of the list. With no groups, the one list there is. */}
      {data && data.groups.length > 0 && (
        <Card id={REST} label={t('others')} count={data.rest.total} open={isOpen(REST)} onToggle={() => toggle(REST)} dashed>
          <RestWords data={data} offline={offline} more={more} onMore={loadMore} row={row} label={t('more')} />
        </Card>
      )}
      {data && data.groups.length === 0 && data.rest.words.length > 0 && (
        <RestWords data={data} offline={offline} more={more} onMore={loadMore} row={row} label={t('more')} />
      )}
    </section>
  )
}

/** The words in no group, common first, a page at a time from the server. */
function RestWords({
  data,
  offline,
  more,
  onMore,
  row,
  label,
}: {
  data: WordsWithResponse
  offline: boolean
  more: boolean
  onMore: () => void
  row: (w: Word) => ReactNode
  label: string
}) {
  return (
    <>
      <ol className="words">{data.rest.words.map((w) => row(w))}</ol>
      {!offline && data.rest.words.length < data.rest.total && (
        <button className="clear words-more" disabled={more} onClick={onMore}>
          {label} ({data.rest.total - data.rest.words.length})
        </button>
      )}
    </>
  )
}
