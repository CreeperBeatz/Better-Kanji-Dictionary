/**
 * The rail as a stack of pages, the way a phone app goes back.
 *
 * The bottom page is where you started: a search, or a character picked on
 * the graph or map. Opening something from a page puts it on top -- a result,
 * a kanji inside a word, a word in a kanji's list -- and back takes it off.
 * Searching, or picking on the graph, starts a new stack.
 *
 * Every step is a browser history entry, so Android's back button and iOS's
 * swipe walk the stack too, and the URL names the page on top so it can be
 * linked to. The stack is also kept in this browser, so opening the app lands
 * on the search you left.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Word } from './api'

export type Level = 1 | 2 | 3 | 4 | 5

export type Page =
  | { kind: 'search'; q: string }
  | { kind: 'level'; level: Level }
  | { kind: 'kanji'; char: string }
  /** `word` is what the list already knew, so the head shows at once. */
  | { kind: 'word'; id: number; word?: Word }

export type Stack = Page[]

/**
 * What each history entry holds. `depth` counts the entries straight behind
 * this one that are this stack with fewer pages on top, so back can be the
 * browser's own back -- or, where there are none (the stack came from storage),
 * a replacement.
 */
interface Entry {
  stack: Stack
  depth: number
  /** The rail's scroll when you left the page, to put it back on return. */
  scroll?: number
}

const KEY = 'betterrtk:stack'
const MAX = 40
const HOME: Page = { kind: 'search', q: '' }
const KANJI_PATH = /^\/kanji\/([^/]+)\/?$/
const WORD_PATH = /^\/word\/(\d+)\/?$/
const LEVEL_PATH = /^\/level\/([1-5])\/?$/

export function samePage(a: Page, b: Page): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'search':
      return a.q === (b as typeof a).q
    case 'level':
      return a.level === (b as typeof a).level
    case 'kanji':
      return a.char === (b as typeof a).char
    case 'word':
      return a.id === (b as typeof a).id
  }
}

function sameStack(a: Stack, b: Stack): boolean {
  return a.length === b.length && a.every((p, i) => samePage(p, b[i]))
}

/** The page's own path; any other query parameters in the URL are kept. */
export function urlOf(p: Page): string {
  const params = new URLSearchParams(window.location.search)
  params.delete('q')
  let path = '/'
  if (p.kind === 'kanji') path = `/kanji/${encodeURIComponent(p.char)}`
  else if (p.kind === 'word') path = `/word/${p.id}`
  else if (p.kind === 'level') path = `/level/${p.level}`
  else if (p.q) {
    path = '/search'
    params.set('q', p.q)
  }
  const query = params.toString()
  return path + (query ? `?${query}` : '') + window.location.hash
}

export function pageInUrl(): Page | null {
  const path = window.location.pathname
  try {
    const k = path.match(KANJI_PATH)
    if (k) {
      const c = decodeURIComponent(k[1])
      return [...c].length === 1 ? { kind: 'kanji', char: c } : null
    }
  } catch {
    return null
  }
  const w = path.match(WORD_PATH)
  if (w) return { kind: 'word', id: Number(w[1]) }
  const l = path.match(LEVEL_PATH)
  if (l) return { kind: 'level', level: Number(l[1]) as Level }
  if (path === '/search' || path === '/search/') {
    return { kind: 'search', q: new URLSearchParams(window.location.search).get('q') ?? '' }
  }
  return null
}

function isStack(s: unknown): s is Stack {
  return Array.isArray(s) && s.length > 0 && s.every((p) => p && typeof p === 'object' && 'kind' in p)
}

function saved(): Stack | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return isStack(s) ? s : null
  } catch {
    return null
  }
}

function save(stack: Stack) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stack))
  } catch {
    // not remembered, which is fine
  }
}

/**
 * Where the app opens: the entry a reload left in history, else the page the
 * URL names, else the stack from last time, else an empty search.
 */
function opening(): Entry {
  const state = window.history.state as Entry | null
  const linked = pageInUrl()
  if (state && isStack(state.stack) && (!linked || samePage(linked, state.stack[state.stack.length - 1]))) {
    return { stack: state.stack, depth: Math.min(state.depth ?? 0, state.stack.length - 1) }
  }
  if (linked) return { stack: [linked], depth: 0 }
  return { stack: saved() ?? [HOME], depth: 0 }
}

function write(entry: Entry, how: 'push' | 'replace') {
  const top = entry.stack[entry.stack.length - 1]
  try {
    if (how === 'push') window.history.pushState(entry, '', urlOf(top))
    else window.history.replaceState(entry, '', urlOf(top))
  } catch {
    // Safari refuses too many history calls in a burst; the next one catches up.
  }
}

/** The pages to restore a scroll position to, once they have drawn. */
function restoreScroll(el: HTMLElement | null, to: number) {
  if (!el) return
  // Lists fill in over a frame or two; try again as they do.
  el.scrollTop = to
  requestAnimationFrame(() => (el.scrollTop = to))
  setTimeout(() => (el.scrollTop = to), 120)
}

export function useNav(scroller: React.RefObject<HTMLElement | null>) {
  const [entry, setEntry] = useState<Entry>(opening)
  const current = useRef(entry)
  current.current = entry
  // Typing replaces the entry on every key; the URL catches up after a pause.
  const pendingReplace = useRef<number | null>(null)

  useEffect(() => {
    write(current.current, 'replace')
    // Once: record where the app opened, under whatever URL that was.
  }, [])

  useEffect(() => save(entry.stack.slice(-MAX)), [entry.stack])

  const flush = useCallback(() => {
    if (pendingReplace.current === null) return
    clearTimeout(pendingReplace.current)
    pendingReplace.current = null
    write(current.current, 'replace')
  }, [])

  /** Leave the page on top for a new one, remembering where it was scrolled. */
  const go = useCallback(
    (next: Entry) => {
      flush()
      write({ ...current.current, scroll: scroller.current?.scrollTop ?? 0 }, 'replace')
      write(next, 'push')
      current.current = next
      setEntry(next)
      if (scroller.current) scroller.current.scrollTop = 0
    },
    [flush, scroller],
  )

  /** Open a page on top of this one. */
  const push = useCallback(
    (p: Page) => {
      const { stack, depth } = current.current
      if (samePage(stack[stack.length - 1], p)) return
      go({ stack: [...stack, p].slice(-MAX), depth: Math.min(depth + 1, MAX - 1) })
    },
    [go],
  )

  /** Start a new stack from this page. */
  const reset = useCallback(
    (p: Page) => {
      if (sameStack(current.current.stack, [p])) return
      go({ stack: [p], depth: 0 })
    },
    [go],
  )

  /**
   * Open a page straight over `base`, whatever was above it: a result picked
   * from the search column, which replaces the entry beside it.
   */
  const openOver = useCallback(
    (base: Page, p: Page) => {
      const { stack } = current.current
      if (sameStack(stack, [base, p])) return
      go({ stack: [base, p], depth: stack.length === 1 && samePage(stack[0], base) ? 1 : 0 })
    },
    [go],
  )

  /**
   * Put a list -- a search, or a JLPT level -- under the pages open now, or
   * change the one there, in place: typing in the search column, or picking a
   * level in it, which leaves the entry beside it alone.
   */
  const rebase = useCallback((p: Page) => {
    const { stack } = current.current
    const above = stack[0].kind === 'search' || stack[0].kind === 'level' ? stack.slice(1) : stack
    const next = { stack: [p, ...above].slice(-MAX), depth: 0 }
    current.current = next
    setEntry(next)
    if (pendingReplace.current !== null) clearTimeout(pendingReplace.current)
    pendingReplace.current = window.setTimeout(() => {
      pendingReplace.current = null
      write(current.current, 'replace')
    }, 300)
  }, [])

  /** Change the page on top in place -- a search as it is typed. */
  const replaceTop = useCallback((p: Page) => {
    const { stack, depth } = current.current
    const next = { stack: [...stack.slice(0, -1), p], depth }
    current.current = next
    setEntry(next)
    if (pendingReplace.current !== null) clearTimeout(pendingReplace.current)
    pendingReplace.current = window.setTimeout(() => {
      pendingReplace.current = null
      write(current.current, 'replace')
    }, 300)
  }, [])

  /** Take `n` pages off the top, through history where it has them. */
  const pop = useCallback(
    (n = 1) => {
      const { stack, depth } = current.current
      const k = Math.min(n, stack.length - 1)
      if (k <= 0) return
      flush()
      if (depth >= k) {
        window.history.go(-k)
        return
      }
      const next = { stack: stack.slice(0, -k), depth: 0 }
      current.current = next
      setEntry(next)
      write(next, 'replace')
      if (scroller.current) scroller.current.scrollTop = 0
    },
    [flush, scroller],
  )

  // Back and forward, from the app or the browser.
  useEffect(() => {
    function onPop(e: PopStateEvent) {
      if (pendingReplace.current !== null) {
        clearTimeout(pendingReplace.current)
        pendingReplace.current = null
      }
      const state = e.state as Entry | null
      const linked = pageInUrl()
      const next: Entry =
        state && isStack(state.stack) ? state : { stack: [linked ?? HOME], depth: 0 }
      current.current = next
      setEntry(next)
      restoreScroll(scroller.current, next.scroll ?? 0)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [scroller])

  return { stack: entry.stack, push, reset, replaceTop, openOver, rebase, pop }
}
