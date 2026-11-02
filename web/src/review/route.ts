/**
 * The owner's reports screen has an address of its own: /reports. Old review
 * addresses (/review, /review/queue/..., /review/history) land there too.
 * It is a history entry on top of whatever page was open, so back closes it
 * and back from a kanji opened out of it lands in it again. The rail's own
 * history entries (nav.ts) carry on underneath: the entry keeps their state
 * and adds `review`.
 */
import type { WorkbenchTab } from '../account/Account'

const PATH = /^\/(?:reports|review)(?:\/[^?]*)?\/?$/

/** The tab the address names, or null when it is not the reports address. */
export function reviewTabInUrl(): WorkbenchTab | null {
  return PATH.test(window.location.pathname) ? 'reports' : null
}

/** The tab this history entry holds, if it is the reports entry. */
export function reviewTabInState(state: unknown): WorkbenchTab | null {
  return (state as { review?: unknown } | null)?.review ? 'reports' : null
}

// Whether the entry being shown is the reports entry, and the one before the last
// back or forward. Listening from the module's load means it runs before the
// app's own listeners, so they can ask `leftReview()`.
let onReview = !!reviewTabInState(window.history.state)
let wasReview = onReview
window.addEventListener('popstate', (e) => {
  wasReview = onReview
  onReview = !!reviewTabInState(e.state)
})

/** This back or forward came out of the reports screen. */
export function leftReview(): boolean {
  return wasReview && !onReview
}

export function pushReview(tab: WorkbenchTab) {
  onReview = true
  window.history.pushState({ ...(window.history.state ?? {}), review: tab }, '', '/reports')
}

export function replaceReview(tab: WorkbenchTab) {
  onReview = true
  window.history.replaceState({ ...(window.history.state ?? {}), review: tab }, '', '/reports')
}

/** Leave the reports entry in place for the page under it, when there is no entry to go back to. */
export function dropReview(to: string) {
  const state = { ...(window.history.state ?? {}) }
  delete state.review
  onReview = false
  window.history.replaceState(state, '', to)
}
