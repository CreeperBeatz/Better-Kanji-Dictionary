/** Media queries the app asks about, each matched once and kept. */
import { useSyncExternalStore } from 'react'

// Matches the narrow layout in theme.css.
export const MOBILE = '(max-width: 900px)'

const queries = new Map<string, MediaQueryList>()
function mediaQuery(query: string): MediaQueryList {
  let m = queries.get(query)
  if (!m) queries.set(query, (m = window.matchMedia(query)))
  return m
}

/** Whether the query matches now, for code that runs outside a render. */
export function matches(query: string): boolean {
  return mediaQuery(query).matches
}

/** Whether the query matches, re-rendering as that changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = mediaQuery(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => mediaQuery(query).matches,
  )
}

/** An iPhone or iPad. iPadOS calls itself a Mac, but a Mac has no touch screen. */
export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)

/** Whether the system asks for less motion: what would slide is put in place. */
export const reducedMotion = () => matches('(prefers-reduced-motion: reduce)')
