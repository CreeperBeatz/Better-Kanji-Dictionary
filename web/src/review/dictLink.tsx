/**
 * "Open in dictionary": a kanji's page in the print dictionaries, in the
 * dictionary tab (review/BookViewer.tsx). Every link targets the same named
 * tab: the first opens it, the next ones show their kanji in it, so a
 * reviewer can keep it on a second screen while labelling on the first.
 */
import { strings, useLang } from '../i18n'

const S = strings(
  {
    title: 'Open {char} in dictionary: the dictionaries’ tab (Kodansha first)',
    titleBook: 'Open {char} in {book}, in the dictionaries’ tab',
  },
  {
    title: 'Отвори {char} в речника: разделът с речниците (първо Kodansha)',
    titleBook: 'Отвори {char} в {book}, в раздела с речниците',
  },
)

/** The tab's name: every link opens or reuses this one tab. */
export const DICTIONARY_TAB = 'bkd-dictionary'

export type DictBook = 'kodansha' | 'kangorin' | 'kanji' | 'wiktionary'
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
 * instead. Without `book` or `view`, the tab shows what it showed last
 * (Kodansha's scan at first).
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
      target={DICTIONARY_TAB}
      title={book && bookName ? t('titleBook', { char, book: bookName }) : t('title', { char })}
      aria-label={label ? undefined : book && bookName ? t('titleBook', { char, book: bookName }) : t('title', { char })}
      onClick={(e) => {
        // Inside a <summary>, a plain click would also fold or unfold it.
        e.preventDefault()
        e.stopPropagation()
        window.open(href, DICTIONARY_TAB)
      }}
    >
      {label ? `${label} ↗` : <BookIcon />}
    </a>
  )
}
