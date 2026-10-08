/**
 * "Open in dictionary": a kanji's page in the print dictionaries, in the
 * dictionary tab (review/BookViewer.tsx). Every link targets the same named
 * tab: the first opens it, the next ones show their kanji in it, so a
 * reviewer can keep it on a second screen while labelling on the first.
 */
import type { BookRef } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    open: 'Open in dictionary',
    title: '{char} in the print dictionaries (Kodansha first), in a tab of their own',
    titleBook: '{char} in {book}, in the dictionary tab',
  },
  {
    open: 'Отвори в речника',
    title: '{char} в печатните речници (първо Kodansha), в отделен раздел',
    titleBook: '{char} в {book}, в раздела с речниците',
  },
)

/** The tab's name: every link opens or reuses this one tab. */
export const DICTIONARY_TAB = 'bkd-dictionary'

export type DictBook = Extract<BookRef['book'], 'kodansha' | 'kangorin' | 'kanji'>

export function dictionaryHref(char: string, book?: DictBook): string {
  const q = new URLSearchParams({ char })
  if (book) q.set('book', book)
  return `/review/dictionary?${q}`
}

/** The link. Without `book`, the tab shows the dictionary it showed last (Kodansha at first). */
export function DictionaryLink({ char, book, bookName, label, className }: { char: string; book?: DictBook; bookName?: string; label?: string; className?: string }) {
  const t = S(useLang())
  const href = dictionaryHref(char, book)
  return (
    <a
      className={`clear book-page dict-tab${className ? ` ${className}` : ''}`}
      href={href}
      target={DICTIONARY_TAB}
      title={book && bookName ? t('titleBook', { char, book: bookName }) : t('title', { char })}
      onClick={(e) => {
        // Inside a <summary>, a plain click would also fold or unfold it.
        e.preventDefault()
        e.stopPropagation()
        window.open(href, DICTIONARY_TAB)
      }}
    >
      {label ?? t('open')} ↗
    </a>
  )
}
