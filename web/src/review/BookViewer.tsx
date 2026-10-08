/**
 * The dictionary tab (Dani, 2026-10-08): the other dictionaries in a tab of
 * their own, for reviewers with two screens -- the definitions on one, the
 * card being labelled on the other.
 *
 * At the top, pick 1. the kanji and 2. the dictionary (Kodansha, 新漢語林,
 * Цалта's kanji book, Wiktionary), and whether to see it digital (the
 * transcription drawn as the book prints it, whole, nothing folded) or
 * scanned (the printed page, with page turning and zoom: BookEvidence.tsx
 * PageScan). Each dictionary offers what it has: Wiktionary is only digital,
 * and of 新漢語林 only the Japan-only senses are transcribed.
 *
 * Its address is /review/dictionary?char=生&book=kodansha&view=scan. The
 * "Open in dictionary" links (review/dictLink.tsx) all open it in one named
 * tab, so a later link shows its kanji here; what a link does not name stays
 * as the tab had it (Kodansha's scan at first). Reviewers and the admin only:
 * the server refuses the dictionaries to anyone else.
 */
import { useEffect, useState } from 'react'
import { api, type KanjiDictionaries } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { LangSwitch } from '../i18n/LangSwitch'
import { KanjiEntry, PageScan } from './BookEvidence'
import { KangorinMarks, KangorinSenses, KodanshaEntry, WiktionaryList } from './DictEntries'
import type { DictBook, DictView } from './dictLink'

const S = strings(
  {
    heading: 'Dictionaries',
    kanji: '1. Kanji',
    kanjiHint: 'type or paste a kanji',
    recent: 'opened here before',
    book: '2. Dictionary',
    kodansha: 'Kodansha',
    kangorin: '新漢語林',
    kanji_book: 'Цалта’s kanji book',
    wiktionary: 'Wiktionary',
    notIn: 'not in it',
    digital: 'digital',
    scan: 'scanned',
    noDigital: 'Not transcribed: only the scan.',
    noScan: 'No scan: only digital.',
    pick: 'Type a kanji above, or open one from a card’s “Open in dictionary”.',
    missing: '{char} is not in {book} here. Pick another dictionary.',
    entry: 'entry № {no}',
    pages: 'entry № {no}, on page {pages}',
    pagesMany: 'entry № {no}, on pages {pages}',
    loading: 'loading…',
  },
  {
    heading: 'Речници',
    kanji: '1. Канджи',
    kanjiHint: 'напишете или поставете канджи',
    recent: 'отваряни тук',
    book: '2. Речник',
    kodansha: 'Kodansha',
    kangorin: '新漢語林',
    kanji_book: 'Канджи речникът на Цалта',
    wiktionary: 'Уикиречник',
    notIn: 'няма го',
    digital: 'дигитален',
    scan: 'сканиран',
    noDigital: 'Не е преписан: само сканирана страница.',
    noScan: 'Няма сканирана страница: само дигитален.',
    pick: 'Напишете канджи горе или го отворете от „Отвори в речника“ на карта.',
    missing: '{char} го няма в {book} тук. Изберете друг речник.',
    entry: 'статия № {no}',
    pages: 'статия № {no}, на страница {pages}',
    pagesMany: 'статия № {no}, на страници {pages}',
    loading: 'зарежда се…',
  },
)

const BOOKS: DictBook[] = ['kodansha', 'kangorin', 'kanji', 'wiktionary']
const VIEWS: DictView[] = ['digital', 'scan']
const LAST_BOOK = 'betterrtk:dictionary-book'
const LAST_VIEW = 'betterrtk:dictionary-view'
const RECENT = 'betterrtk:dictionary-recent'
const isKanji = (c: string) => /^[㐀-鿿豈-﫿]$/.test(c)
const isBook = (b: string | null): b is DictBook => !!b && (BOOKS as string[]).includes(b)
const isView = (v: string | null): v is DictView => !!v && (VIEWS as string[]).includes(v)

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]')
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && isKanji(c)).slice(0, 16) : []
  } catch {
    return []
  }
}

/** What a dictionary has for the kanji: its entry number, a transcription to draw, scanned pages. */
function holdings(d: KanjiDictionaries, b: DictBook): { no: number | null; digital: boolean; pages: number[] } {
  if (b === 'kodansha') return { no: d.kodansha?.no ?? null, digital: !!d.kodansha, pages: d.kodansha?.pages ?? [] }
  if (b === 'kangorin') return { no: d.kangorin?.no ?? null, digital: !!d.kangorin?.senses.length, pages: d.kangorin?.pages ?? [] }
  if (b === 'kanji') return { no: d.tsalta?.no ?? null, digital: !!d.tsalta, pages: d.tsalta?.pages ?? [] }
  return { no: null, digital: !!d.wiktionary?.length, pages: [] }
}

export default function BookViewer() {
  const lang = useLang()
  const t = S(lang)
  const [char, setChar] = useState(() => {
    const c = new URLSearchParams(window.location.search).get('char') ?? ''
    return isKanji(c) ? c : ''
  })
  const [book, setBook] = useState<DictBook>(() => {
    const b = new URLSearchParams(window.location.search).get('book')
    const last = sessionStorage.getItem(LAST_BOOK)
    return isBook(b) ? b : isBook(last) ? last : 'kodansha'
  })
  const [view, setView] = useState<DictView>(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    const last = sessionStorage.getItem(LAST_VIEW)
    return isView(v) ? v : isView(last) ? last : 'scan'
  })
  const [draft, setDraft] = useState('')
  const [recent, setRecent] = useState(readRecent)
  const [found, setFound] = useState<{ char: string; dicts: KanjiDictionaries | null; problem: string | null } | null>(null)

  // The address, the tab's title and the kanji opened before follow the choice.
  useEffect(() => {
    const tt = S(lang)
    sessionStorage.setItem(LAST_BOOK, book)
    sessionStorage.setItem(LAST_VIEW, view)
    const q = new URLSearchParams(char ? { char, book, view } : { book, view })
    window.history.replaceState(null, '', `/review/dictionary?${q}`)
    document.title = char ? `${char} · ${tt(book === 'kanji' ? 'kanji_book' : book)}` : tt('heading')
    if (char) {
      const next = [char, ...readRecent().filter((c) => c !== char)].slice(0, 16)
      localStorage.setItem(RECENT, JSON.stringify(next))
      setRecent(next)
    }
  }, [char, book, view, lang])

  useEffect(() => {
    if (!char) return
    let live = true
    api.reviewDictionaries(char).then(
      (dicts) => live && setFound({ char, dicts, problem: null }),
      (e) => live && setFound({ char, dicts: null, problem: errorText(e, lang) }),
    )
    return () => {
      live = false
    }
  }, [char, lang])

  function take(value: string) {
    const k = [...value].filter(isKanji).pop()
    if (k) {
      setChar(k)
      setDraft('')
    } else setDraft(value)
  }

  const here = found?.char === char ? found : null
  const d = here?.dicts ?? null
  const has = d ? holdings(d, book) : null
  // The view asked for, unless this dictionary has only the other one.
  const shown: DictView | null = !has ? null : view === 'scan' ? (has.pages.length ? 'scan' : has.digital ? 'digital' : null) : has.digital ? 'digital' : has.pages.length ? 'scan' : null
  const name = (b: DictBook) => t(b === 'kanji' ? 'kanji_book' : b)
  const where =
    has?.no != null
      ? shown === 'scan' && has.pages.length
        ? t(has.pages.length > 1 ? 'pagesMany' : 'pages', {
            no: has.no,
            pages: has.pages.length > 1 ? `${has.pages[0]}–${has.pages[has.pages.length - 1]}` : has.pages[0],
          })
        : t('entry', { no: has.no })
      : null

  let body: React.ReactNode
  if (!char) body = <p className="hint">{t('pick')}</p>
  else if (!here) body = <p className="hint">{t('loading')}</p>
  else if (here.problem) body = <p className="account-problem">{here.problem}</p>
  else if (!d || !has || !shown) body = <p className="hint">{t('missing', { char, book: name(book) })}</p>
  else if (shown === 'scan')
    body = <PageScan key={`${char}:${book}`} book={book as 'kodansha' | 'kangorin' | 'kanji'} page={has.pages[0]} extra={where && <span className="hint dv-entry">{where}</span>} />
  else
    body = (
      <div className="dv-digital">
        {where && <p className="hint dv-entry">{where}</p>}
        {book === 'kodansha' && d.kodansha && <KodanshaEntry char={char} k={d.kodansha} />}
        {book === 'kangorin' && d.kangorin && (
          <>
            <KangorinMarks g={d.kangorin} />
            <KangorinSenses g={d.kangorin} whole />
          </>
        )}
        {book === 'kanji' && d.tsalta && <KanjiEntry src={d.tsalta} words="all" />}
        {book === 'wiktionary' && d.wiktionary && <WiktionaryList entries={d.wiktionary} />}
      </div>
    )

  return (
    <div className="dict-viewer">
      <header className="dv-bar">
        <div className="dv-field">
          <span className="dv-step">{t('kanji')}</span>
          <span className="dv-char" lang="ja">
            {char || '・'}
          </span>
          <input
            className="assoc-text dv-input"
            lang="ja"
            value={draft}
            placeholder={t('kanjiHint')}
            aria-label={t('kanji')}
            onChange={(e) => ((e.nativeEvent as InputEvent).isComposing ? setDraft(e.target.value) : take(e.target.value))}
            onCompositionEnd={(e) => take(e.currentTarget.value)}
          />
          {recent.length > 1 && (
            <span className="dv-recent" aria-label={t('recent')} title={t('recent')}>
              {recent
                .filter((c) => c !== char)
                .map((c) => (
                  <button key={c} type="button" className="search-filter" lang="ja" onClick={() => setChar(c)}>
                    {c}
                  </button>
                ))}
            </span>
          )}
        </div>
        <div className="dv-field">
          <span className="dv-step">{t('book')}</span>
          {BOOKS.map((b) => {
            const h = d ? holdings(d, b) : null
            const none = !!h && !h.digital && !h.pages.length
            return (
              <button
                key={b}
                type="button"
                className="search-filter"
                data-on={book === b || undefined}
                aria-pressed={book === b}
                disabled={none}
                onClick={() => setBook(b)}
              >
                {name(b)}
                {none && <span className="hint"> · {t('notIn')}</span>}
              </button>
            )
          })}
          <span className="dv-views" role="group">
            {VIEWS.map((v) => {
              const off = !!has && (v === 'scan' ? !has.pages.length : !has.digital)
              return (
                <button
                  key={v}
                  type="button"
                  className="search-filter"
                  data-on={shown === v || undefined}
                  aria-pressed={shown === v}
                  disabled={off}
                  title={off ? t(v === 'scan' ? 'noScan' : 'noDigital') : undefined}
                  onClick={() => setView(v)}
                >
                  {t(v)}
                </button>
              )
            })}
          </span>
        </div>
        <LangSwitch />
      </header>
      <main className="dv-page">{body}</main>
    </div>
  )
}
