/**
 * What you have looked up lately: searches, characters and words, each newest
 * first and each once. The empty search lists them under the JLPT levels.
 *
 * Opening one again moves it to the front. Kept in this browser.
 */

import { useSyncExternalStore } from 'react'
import type { Word } from './api'

const KEY = 'betterrtk:history'
// The Recent tab's list, from before this: characters only, oldest first.
const OLD_KEY = 'betterrtk:recent'
const MAX = { searches: 30, kanji: 60, words: 30 }
// A search that grows into a longer one within this long was on its way
// there -- "wat" paused on, then "water" -- so the longer one takes its place.
const REFINE_MS = 2 * 60_000

export interface History {
  searches: { q: string; at: number }[]
  kanji: string[]
  words: Word[]
}

const EMPTY: History = { searches: [], kanji: [], words: [] }

function load(): History {
  try {
    const got = JSON.parse(localStorage.getItem(KEY) ?? 'null') as History | null
    if (got && Array.isArray(got.searches) && Array.isArray(got.kanji) && Array.isArray(got.words)) return got
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as { recent?: unknown } | null
    if (old && Array.isArray(old.recent)) {
      const kanji = old.recent.filter((c): c is string => typeof c === 'string').reverse()
      localStorage.removeItem(OLD_KEY)
      return { ...EMPTY, kanji }
    }
  } catch {
    // nothing usable saved
  }
  return EMPTY
}

let state = load()
const listeners = new Set<() => void>()

function update(next: (h: History) => History) {
  state = next(state)
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // not remembered, which is fine
  }
  listeners.forEach((l) => l())
}

export function rememberSearch(text: string) {
  const q = text.trim()
  if (!q) return
  update((h) => {
    const now = Date.now()
    const [last, ...rest] = h.searches
    const refined =
      last && now - last.at < REFINE_MS && q.toLowerCase().startsWith(last.q.toLowerCase()) ? rest : h.searches
    const searches = [{ q, at: now }, ...refined.filter((s) => s.q !== q)].slice(0, MAX.searches)
    return { ...h, searches }
  })
}

export function rememberKanji(...chars: string[]) {
  update((h) => {
    let kanji = h.kanji
    for (const c of chars) kanji = [c, ...kanji.filter((k) => k !== c)]
    return { ...h, kanji: kanji.slice(0, MAX.kanji) }
  })
}

export function rememberWord(w: Word) {
  // The deinflection is about the query it was found by, not the word.
  const word = { ...w, inflection: undefined }
  update((h) => ({ ...h, words: [word, ...h.words.filter((x) => x.id !== w.id)].slice(0, MAX.words) }))
}

export function clearHistory() {
  update(() => EMPTY)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHistory(): History {
  return useSyncExternalStore(subscribe, () => state)
}
