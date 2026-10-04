/**
 * The review screen has an address of its own: /review, /review/history, ...
 * It is a history entry on top of whatever page was open, so back closes it
 * and back from a kanji opened out of it lands in it again. The rail's own
 * history entries (nav.ts) carry on underneath: the review entry keeps their
 * state and adds `review`.
 */
import type { WorkbenchTab } from '../account/Account'

const TABS: WorkbenchTab[] = ['queue', 'history', 'auto', 'people', 'handbook']
const PATH = /^\/review(?:\/([a-z]+))?\/?$/

export function reviewPath(tab: WorkbenchTab): string {
  return tab === 'queue' ? '/review' : `/review/${tab}`
}

/** The tab the address names, or null when it is not a review address. */
export function reviewTabInUrl(): WorkbenchTab | null {
  const m = window.location.pathname.match(PATH)
  if (!m) return null
  const tab = (m[1] ?? 'queue') as WorkbenchTab
  return TABS.includes(tab) ? tab : 'queue'
}

/** The review tab this history entry holds, if it is a review entry. */
export function reviewTabInState(state: unknown): WorkbenchTab | null {
  const tab = (state as { review?: WorkbenchTab } | null)?.review
  return tab && TABS.includes(tab) ? tab : null
}

// Whether the entry being shown is a review entry, and the one before the last
// back or forward. Listening from the module's load means it runs before the
// app's own listeners, so they can ask `leftReview()`.
let onReview = !!reviewTabInState(window.history.state)
let wasReview = onReview
window.addEventListener('popstate', (e) => {
  wasReview = onReview
  onReview = !!reviewTabInState(e.state)
})

/** This back or forward came out of the review screen. */
export function leftReview(): boolean {
  return wasReview && !onReview
}

export function pushReview(tab: WorkbenchTab) {
  onReview = true
  window.history.pushState({ ...(window.history.state ?? {}), review: tab }, '', reviewPath(tab))
}

export function replaceReview(tab: WorkbenchTab) {
  onReview = true
  window.history.replaceState({ ...(window.history.state ?? {}), review: tab }, '', reviewPath(tab))
}

/** Leave the review entry in place for the page under it, when there is no entry to go back to. */
export function dropReview(to: string) {
  const state = { ...(window.history.state ?? {}) }
  delete state.review
  onReview = false
  window.history.replaceState(state, '', to)
}
