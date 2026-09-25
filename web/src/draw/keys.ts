import { useEffect, useRef } from 'react'

/** Whether a key goes to a text field, where shortcuts should leave it be. */
export function typing(at: EventTarget | null): boolean {
  return at instanceof HTMLElement && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)
}

/**
 * Keys caught before Excalidraw (and the browser) see them, while `on`, and
 * never while typing. The handler returns true for a key it has taken.
 */
export function useCaptureKeys(on: boolean, handler: (e: KeyboardEvent) => boolean | void) {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!on) return
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || !latest.current(e)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [on])
}

/** Ctrl+D, or Cmd+D on a Mac. */
export const isCtrlD = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'd'
