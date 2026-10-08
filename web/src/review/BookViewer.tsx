/**
 * The dictionary tab (Dani, 2026-10-08): the print dictionaries' scanned
 * pages, in a tab of their own, for reviewers with two screens -- the
 * definitions on one, the card being labelled on the other.
 *
 * At the top, pick 1. the kanji and 2. the dictionary (Kodansha, 新漢語林,
 * Цалта's kanji book); below, the scanned page of its entry, with page turning
 * and zoom (BookEvidence.tsx PageScan). The scans, never the transcription.
 *
 * Its address is /review/dictionary?char=生&book=kodansha. The "Open in
 * dictionary" links (review/dictLink.tsx) all open it in one named tab, so a
 * later link shows its kanji here. A link without a book keeps the
 * dictionary this tab showed last; Kodansha at first. Reviewers and the admin
 * only: the server refuses the pages to anyone else.
 */
import { useEffect, useState } from 'react'
import { api, type BookPages } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { LangSwitch } from '../i18n/LangSwitch'
import { PageScan } from './BookEvidence'
import type { DictBook } from './dictLink'

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
    notIn: 'not in it',
    pick: 'Type a kanji above, or open one from a card’s “Open in dictionary”.',
    missing: '{char} is not in {book} here. Pick another dictionary.',
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
    notIn: 'няма го',
    pick: 'Напишете канджи горе или го отворете от „Отвори в речника“ на карта.',
    missing: '{char} го няма в {book} тук. Изберете друг речник.',
    pages: 'статия № {no}, на страница {pages}',
    pagesMany: 'статия № {no}, на страници {pages}',
    loading: 'зарежда се…',
  },
)

const BOOKS: DictBook[] = ['kodansha', 'kangorin', 'kanji']
const LAST_BOOK = 'betterrtk:dictionary-book'
const RECENT = 'betterrtk:dictionary-recent'
const isKanji = (c: string) => /^[㐀-鿿豈-﫿]$/.test(c)
const isBook = (b: string | null): b is DictBook => !!b && (BOOKS as string[]).includes(b)

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]')
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && isKanji(c)).slice(0, 16) : []
  } catch {
    return []
  }
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
  const [draft, setDraft] = useState('')
  const [recent, setRecent] = useState(readRecent)
  const [found, setFound] = useState<{ char: string; pages: BookPages | null; problem: string | null } | null>(null)

  // The address, the tab's title and the kanji opened before follow the choice.
  useEffect(() => {
    const tt = S(lang)
    sessionStorage.setItem(LAST_BOOK, book)
    const q = new URLSearchParams(char ? { char, book } : { book })
    window.history.replaceState(null, '', `/review/dictionary?${q}`)
    document.title = char ? `${char} · ${tt(book === 'kanji' ? 'kanji_book' : book)}` : tt('heading')
    if (char) {
      const next = [char, ...readRecent().filter((c) => c !== char)].slice(0, 16)
      localStorage.setItem(RECENT, JSON.stringify(next))
      setRecent(next)
    }
  }, [char, book, lang])

  useEffect(() => {
    if (!char) return
    let live = true
    api.reviewBookPages(char).then(
      (pages) => live && setFound({ char, pages, problem: null }),
      (e) => live && setFound({ char, pages: null, problem: errorText(e, lang) }),
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
  const entry = here?.pages?.[book] ?? null
  const name = (b: DictBook) => t(b === 'kanji' ? 'kanji_book' : b)

  let body: React.ReactNode
  if (!char) body = <p className="hint">{t('pick')}</p>
  else if (!here) body = <p className="hint">{t('loading')}</p>
  else if (here.problem) body = <p className="account-problem">{here.problem}</p>
  else if (!entry) body = <p className="hint">{t('missing', { char, book: name(book) })}</p>
  else
    body = (
      <PageScan
        key={`${char}:${book}`}
        book={book}
        page={entry.pages[0]}
        extra={
          <span className="hint dv-entry">
            {t(entry.pages.length > 1 ? 'pagesMany' : 'pages', {
              no: entry.no ?? '?',
              pages: entry.pages.length > 1 ? `${entry.pages[0]}–${entry.pages[entry.pages.length - 1]}` : entry.pages[0],
            })}
          </span>
        }
      />
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
            const has = here?.pages?.[b]
            return (
              <button
                key={b}
                type="button"
                className="search-filter"
                data-on={book === b || undefined}
                aria-pressed={book === b}
                disabled={!!here?.pages && !has}
                onClick={() => setBook(b)}
              >
                {name(b)}
                {here?.pages && !has && <span className="hint"> · {t('notIn')}</span>}
              </button>
            )
          })}
        </div>
        <LangSwitch />
      </header>
      <main className="dv-page">{body}</main>
    </div>
  )
}
