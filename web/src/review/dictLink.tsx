/**
 * "Open in dictionary": a kanji in the dictionary tab (review/BookViewer.tsx),
 * a new browser tab each time (Dani, 2026-10-08), so several can be open at
 * once.
 */
import { strings, useLang } from '../i18n'

const S = strings(
  {
    title: 'Open {char} in the dictionary tab (Kodansha first)',
    titleBook: 'Open {char} in {book}, in the dictionary tab',
  },
  {
    title: 'Отворете {char} в раздела с речниците (първо Kodansha)',
    titleBook: 'Отворете {char} в {book}, в раздела с речниците',
  },
)

export type DictBook = 'kodansha' | 'kangorin' | 'kanji' | 'wiktionary' | 'bkd'
/** The transcription drawn as the book prints it, or the scanned page. */
export type DictView = 'digital' | 'scan'

export function dictionaryHref(char: string, book?: DictBook, view?: DictView): string {
  const q = new URLSearchParams({ char })
  if (book) q.set('book', book)
  if (view) q.set('view', view)
  return `/review/dictionary?${q}`
}

/** An open book with an arrow out of its corner: "open in dictionary", in a tab of its own. */
function BookIcon() {
  return (
    <svg className="dict-icon" viewBox="0 0 22 16" width="20" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M1.5 4.5C4 3.5 6.5 3.7 9 5v9.5C6.5 13.2 4 13 1.5 14Z" />
      <path d="M9 5c2.5-1.3 5-1.5 7.5-.5V14c-2.5-1-5-.8-7.5.5" />
      <path d="M17 1h4v4M21 1l-4.2 4.2" />
    </svg>
  )
}

/**
 * The link: the book icon, its name in the tooltip; with `label`, that text
 * instead. Without `book` the tab opens on Kodansha; without `view`, digital.
 */
export function DictionaryLink({
  char,
  book,
  view,
  bookName,
  label,
  className,
}: {
  char: string
  book?: DictBook
  view?: DictView
  bookName?: string
  label?: string
  className?: string
}) {
  const t = S(useLang())
  const href = dictionaryHref(char, book, view)
  return (
    <a
      className={`clear dict-tab${label ? ' book-page' : ' dict-tab-icon'}${className ? ` ${className}` : ''}`}
      href={href}
      target="_blank"
      rel="noopener"
      title={book && bookName ? t('titleBook', { char, book: bookName }) : t('title', { char })}
      aria-label={label ? undefined : book && bookName ? t('titleBook', { char, book: bookName }) : t('title', { char })}
      // Inside a <summary>, not a fold or unfold as well.
      onClick={(e) => e.stopPropagation()}
    >
      {label ? `${label} ↗` : <BookIcon />}
    </a>
  )
}

/** The book icon for each kanji: one alone, or each kanji with its own (学生: 学 📖 生 📖). */
export function DictionaryLinks({ chars }: { chars: string[] }) {
  const kanji = [...new Set(chars.filter((c) => /^[㐀-鿿豈-﫿]$/.test(c)))]
  if (kanji.length < 2) return kanji.length ? <DictionaryLink char={kanji[0]} /> : null
  return (
    <span className="dict-tabs">
      {kanji.map((c) => (
        <span key={c} className="dict-tabs-one">
          <span lang="ja">{c}</span>
          <DictionaryLink char={c} />
        </span>
      ))}
    </span>
  )
}
