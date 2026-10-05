/** Keyboard shortcuts, shared by the review screen and the draw pad. */
import { useEffect, useRef } from 'react'

/** Whether a key goes to a field, where shortcuts should leave it be. */
export function typing(at: EventTarget | null): boolean {
  return (
    at instanceof HTMLElement &&
    (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.tagName === 'SELECT' || at.isContentEditable)
  )
}

/**
 * A keydown listener on the window while `on`, calling the latest `handler`,
 * so it can use this render's state without listening again. `capture` hears
 * the key before anything listening the usual way.
 */
export function useKey(handler: (e: KeyboardEvent) => void, { on = true, capture = false } = {}) {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => latest.current(e)
    window.addEventListener('keydown', onKey, capture)
    return () => window.removeEventListener('keydown', onKey, capture)
  }, [on, capture])
}
