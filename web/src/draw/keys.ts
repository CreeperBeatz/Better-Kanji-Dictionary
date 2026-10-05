import { typing, useKey } from '../keys'

/**
 * Keys caught before Excalidraw (and the browser) see them, while `on`, and
 * never while typing. The handler returns true for a key it has taken.
 */
export function useCaptureKeys(on: boolean, handler: (e: KeyboardEvent) => boolean | void) {
  useKey(
    (e) => {
      if (typing(e.target) || !handler(e)) return
      e.preventDefault()
      e.stopPropagation()
    },
    { on, capture: true },
  )
}

/** Ctrl+D, or Cmd+D on a Mac. */
export const isCtrlD = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'd'
