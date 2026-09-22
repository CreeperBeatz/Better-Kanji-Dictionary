/**
 * The characters you have looked at, oldest first, each once.
 *
 * Opening one again leaves the list as it is, so it reads as a stable history
 * rather than a stack that reshuffles under your finger. Kept in this browser,
 * with the character you were on, so a reload picks up where you left off.
 */

import { useCallback, useState } from 'react'

const KEY = 'betterrtk:recent'
const MAX = 60

interface Saved {
  recent: string[]
  focus: string
}

function load(start: string, linked: string | null): Saved {
  let saved: Saved = { recent: [start], focus: start }
  try {
    const got = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    if (got && Array.isArray(got.recent) && typeof got.focus === 'string') saved = got
  } catch {
    // nothing usable saved
  }
  // A link to a character opens on it, and it joins the list like any visit.
  if (linked) {
    const recent = saved.recent.includes(linked) ? saved.recent : [...saved.recent, linked].slice(-MAX)
    saved = { recent, focus: linked }
  }
  return saved
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // not remembered, which is fine
  }
}

/** `linked` is a character named in the URL, which wins over the saved one. */
export function useRecent(start: string, linked: string | null) {
  const [state, setState] = useState(() => load(start, linked))

  const update = useCallback((next: (s: Saved) => Saved) => {
    setState((s) => {
      const n = next(s)
      save(n)
      return n
    })
  }, [])

  /** Go to a character, adding it (and anything passed through) to the end if new. */
  const visit = useCallback(
    (...chars: string[]) =>
      update((s) => {
        const recent = [...s.recent]
        for (const c of chars) if (!recent.includes(c)) recent.push(c)
        return { recent: recent.slice(-MAX), focus: chars[chars.length - 1] ?? s.focus }
      }),
    [update],
  )

  /** The one before the current character, for Backspace. */
  const back = useCallback(
    () =>
      update((s) => {
        const i = s.recent.indexOf(s.focus)
        return i > 0 ? { ...s, focus: s.recent[i - 1] } : s
      }),
    [update],
  )

  const clear = useCallback(() => update((s) => ({ recent: [s.focus], focus: s.focus })), [update])

  return { recent: state.recent, focus: state.focus, visit, back, clear }
}
