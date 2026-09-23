/**
 * The page's side of offline lookup: starts the worker, keeps its status for
 * React, and offers each lookup as a promise -- or null while the pack is not
 * on this device, which is api.ts's cue to ask the server instead.
 *
 * The download starts by itself when the app runs installed (from the home
 * screen, or as a desktop app), since that is someone who means to keep it.
 * In a browser tab it waits to be asked, from the account dialog.
 */

import { useSyncExternalStore } from 'react'
import type {
  DrawCandidate,
  KanjiNode,
  RadicalGroup,
  RadicalSearchResponse,
  SearchResponse,
  Word,
  WordEntry,
} from '../api'
import type { LevelResponse } from './engine'
import { INITIAL, type FromWorker, type Method, type OfflineStatus, type ToWorker } from './protocol'

const BASE = import.meta.env.VITE_API ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')

// Longer than any real query takes; a worker that has died should not leave
// the search box saying "looking" for ever.
const CALL_TIMEOUT = 8000

// Reading an installed pack back takes a moment; lookups made meanwhile wait
// this long for it before trying the server.
const LOADING_WAIT = 10_000

// Set while a pack is installed, so the page knows at once -- before the
// worker has opened IndexedDB -- that lookups should wait for the device.
const INSTALLED_KEY = 'betterrtk:offline'

let worker: Worker | null = null
let status: OfflineStatus = { ...INITIAL }
const listeners = new Set<() => void>()
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>()
let nextId = 1

function setStatus(next: OfflineStatus): void {
  status = next
  try {
    if (next.state === 'ready') localStorage.setItem(INSTALLED_KEY, '1')
    else if (next.state === 'off' || next.state === 'unsupported') localStorage.removeItem(INSTALLED_KEY)
  } catch {
    // not remembered: the first lookups after a start go to the server
  }
  for (const l of listeners) l()
}

function installedBefore(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1'
  } catch {
    return false
  }
}

function post(msg: ToWorker): void {
  worker?.postMessage(msg)
}

/** Running as an installed app rather than in a browser tab. */
export function runningInstalled(): boolean {
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
  return (
    modes.some((m) => window.matchMedia(`(display-mode: ${m})`).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Ask the browser not to evict the pack under storage pressure. */
function persist(): void {
  navigator.storage?.persist?.().catch(() => {})
}

function fail(reason: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
    pending.delete(id)
  }
}

export function startOffline(): void {
  if (worker) return
  if (typeof Worker === 'undefined' || typeof indexedDB === 'undefined') {
    setStatus({ ...INITIAL, state: 'unsupported' })
    return
  }
  try {
    worker = new Worker(new URL('./lookup.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    setStatus({ ...INITIAL, state: 'unsupported' })
    return
  }
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'status') {
      setStatus(msg.status)
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.value)
    else p.reject(new Error(msg.error))
  }
  worker.onerror = () => {
    // Everything falls back to the server; the page carries on.
    worker?.terminate()
    worker = null
    fail('the lookup worker stopped')
    setStatus({ ...INITIAL, state: 'unsupported' })
  }

  if (installedBefore()) setStatus({ ...INITIAL, state: 'loading' })
  const auto = runningInstalled()
  if (auto) persist()
  post({ type: 'init', base: BASE, auto })

  // Chrome and Edge say when the app is installed; Safari does not, which is
  // why the first installed start also counts (`auto` above).
  window.addEventListener('appinstalled', () => downloadOffline())
  window.addEventListener('online', () => post({ type: 'sync' }))
}

export function downloadOffline(): void {
  persist()
  post({ type: 'download' })
}

export function removeOffline(): void {
  fail('offline lookup was removed')
  post({ type: 'remove' })
}

/** Fetch the download's size, for offering it. */
export function checkOffline(): void {
  post({ type: 'check' })
}

export function useOffline(): OfflineStatus {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => status,
  )
}

/** Resolves once the pack has loaded; rejects if it will not. */
function loaded(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(done, LOADING_WAIT)
    function done() {
      if (status.state === 'loading' && worker) return
      listeners.delete(done)
      clearTimeout(timer)
      if (status.state === 'ready') resolve()
      else reject(new Error('offline lookup did not load'))
    }
    listeners.add(done)
  })
}

function call<T>(method: Method, ...args: unknown[]): Promise<T> | null {
  if (!worker) return null
  if (status.state === 'loading') return loaded().then(() => send<T>(method, args))
  if (status.state !== 'ready') return null
  return send<T>(method, args)
}

function send<T>(method: Method, args: unknown[]): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('offline lookup timed out'))
    }, CALL_TIMEOUT)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    post({ type: 'call', id, method, args })
  })
}

/** Each lookup on the device, or null when it has to be the server's. */
export const local = {
  search: (q: string, lang: string) => call<SearchResponse>('search', q, lang),
  recognize: (strokes: [number, number][][]) =>
    call<{ candidates: DrawCandidate[]; strokes: number }>('recognize', strokes),
  recognizerReady: () => call<{ chars: number; buckets: number }>('recognizerReady'),
  radicals: () => call<{ groups: RadicalGroup[]; total: number }>('radicals'),
  searchByRadicals: (radicals: string[]) => call<RadicalSearchResponse>('searchByRadicals', radicals),
  byLevel: (level: number) => call<LevelResponse>('byLevel', level),
  wordsFor: (char: string) => call<{ char: string; words: Word[] }>('wordsFor', char),
  kanji: (char: string) => call<{ focus: KanjiNode; strokes: string[] } | null>('kanji', char),
  wordEntry: (id: number) => call<WordEntry | null>('wordEntry', id),
}
