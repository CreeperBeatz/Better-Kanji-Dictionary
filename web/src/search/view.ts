/**
 * How a search for one kanji is shown: as a list, like any search, or by the
 * meaning the kanji has in each word. A switch on that search, kept in this
 * browser like the sort, so the query itself stays just the kanji -- in the
 * box, the address and the history.
 *
 * `*生*`, from before the switch, still works: it is read as 生 by meaning.
 */

import { useSyncExternalStore } from 'react'

const KEY = 'betterrtk:kanjiView'

let byMeaning = localStorage.getItem(KEY) === 'meaning'
const listeners = new Set<() => void>()

export function setByMeaning(on: boolean) {
  if (on === byMeaning) return
  byMeaning = on
  if (on) localStorage.setItem(KEY, 'meaning')
  else localStorage.removeItem(KEY)
  listeners.forEach((l) => l())
}

export function useByMeaning(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => byMeaning,
  )
}

/** The kanji of a `*生*` query, the old way of asking for it by meaning. */
export function scopedKanji(q: string): string | null {
  const m = /^[*＊](\p{Script=Han})[*＊]$/u.exec(q.trim())
  return m ? m[1] : null
}

/** A query that is one kanji, which can be shown by meaning. */
export const oneKanji = (q: string) => /^\p{Script=Han}$/u.test(q.trim())

/** `*生*` as 生 by meaning; any other query as it is. */
export function unscope(q: string): string {
  const char = scopedKanji(q)
  if (!char) return q
  setByMeaning(true)
  return char
}
