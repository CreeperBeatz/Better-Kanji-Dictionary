/**
 * What you have looked up lately, newest first and each once: queries typed,
 * characters and words opened, however they were reached -- a search, the
 * graph, the map. The empty search lists them under the JLPT levels.
 *
 * Opening one again moves it to the front. Kept in this browser.
 */

import { useSyncExternalStore } from 'react'
import type { Word } from './api'

const KEY = 'betterrtk:history'
// The Recent tab's list, from before this: characters only, oldest first.
const OLD_KEY = 'betterrtk:recent'
const MAX = 60
// A search that grows into a longer one within this long was on its way
// there -- "wat" paused on, then "water" -- so the longer one takes its place.
const REFINE_MS = 2 * 60_000

export type Visit =
  | { kind: 'search'; q: string; at: number }
  /** The meanings are there once the character's details have been seen. */
  | { kind: 'kanji'; char: string; meanings?: string[]; meaningsBg?: string[] | null }
  | { kind: 'word'; word: Word }

const same = (a: Visit, b: Visit) =>
  a.kind === b.kind &&
  (a.kind === 'search'
    ? a.q === (b as typeof a).q
    : a.kind === 'kanji'
      ? a.char === (b as typeof a).char
      : a.word.id === (b as typeof a).word.id)

function load(): Visit[] {
  try {
    const got = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { items?: unknown } | null
    if (got && Array.isArray(got.items)) return got.items as Visit[]
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as { recent?: unknown } | null
    if (old && Array.isArray(old.recent)) {
      localStorage.removeItem(OLD_KEY)
      return old.recent
        .filter((c): c is string => typeof c === 'string')
        .reverse()
        .map((char) => ({ kind: 'kanji', char }))
    }
  } catch {
    // nothing usable saved
  }
  return []
}

let items = load()
const listeners = new Set<() => void>()

function put(v: Visit, drop: (x: Visit) => boolean = () => false) {
  items = [v, ...items.filter((x) => !same(x, v) && !drop(x))].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify({ items }))
  } catch {
    // not remembered, which is fine
  }
  listeners.forEach((l) => l())
}

export function rememberSearch(text: string) {
  const q = text.trim()
  if (!q) return
  const now = Date.now()
  const last = items[0]
  const refines = last?.kind === 'search' && now - last.at < REFINE_MS && q.toLowerCase().startsWith(last.q.toLowerCase())
  put({ kind: 'search', q, at: now }, (x) => refines && x === last)
}

/** A query that was just the thing now opened, which would only list it twice. */
const typed =
  (...texts: string[]) =>
  (x: Visit) =>
    x.kind === 'search' && texts.includes(x.q)

export function rememberKanji(char: string, k?: { meanings: string[]; meaningsBg?: string[] | null }) {
  // Seen again without its details (the graph, before they arrive): keep the meanings it had.
  const had = items.find((x) => x.kind === 'kanji' && x.char === char) as Extract<Visit, { kind: 'kanji' }> | undefined
  const meanings = k ? { meanings: k.meanings, meaningsBg: k.meaningsBg } : had && { meanings: had.meanings, meaningsBg: had.meaningsBg }
  put({ kind: 'kanji', char, ...meanings }, typed(char))
}

export function rememberWord(w: Word) {
  // The deinflection is about the query it was found by, not the word.
  put({ kind: 'word', word: { ...w, inflection: undefined } }, typed(w.headword, w.reading))
}

export function clearHistory() {
  items = []
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to forget
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHistory(): Visit[] {
  return useSyncExternalStore(subscribe, () => items)
}
