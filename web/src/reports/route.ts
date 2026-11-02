/**
 * The owner's reports screen has an address of its own: /reports. Old review
 * addresses (/review, /review/queue/..., /review/history) land there too.
 * It is a history entry on top of whatever page was open, so back closes it.
 * The rail's own history entries (nav.ts) carry on underneath: the entry
 * keeps their state and adds `reports: true`.
 */

const PATH = /^\/(?:reports|review)(?:\/[^?]*)?\/?$/

/** The address names the reports screen. */
export function reportsInUrl(): boolean {
  return PATH.test(window.location.pathname)
}

/** This history entry is the reports screen's. */
export function reportsInState(state: unknown): boolean {
  return !!(state as { reports?: unknown } | null)?.reports
}

// Whether the entry being shown is the reports entry, and the one before the last
// back or forward. Listening from the module's load means it runs before the
// app's own listeners, so they can ask `leftReports()`.
let onReports = reportsInState(window.history.state)
let wasReports = onReports
window.addEventListener('popstate', (e) => {
  wasReports = onReports
  onReports = reportsInState(e.state)
})

/** This back or forward came out of the reports screen. */
export function leftReports(): boolean {
  return wasReports && !onReports
}

export function pushReports() {
  onReports = true
  window.history.pushState({ ...(window.history.state ?? {}), reports: true }, '', '/reports')
}

export function replaceReports() {
  onReports = true
  window.history.replaceState({ ...(window.history.state ?? {}), reports: true }, '', '/reports')
}

/** Leave the reports entry in place for the page under it, when there is no entry to go back to. */
export function dropReports(to: string) {
  const state = { ...(window.history.state ?? {}) }
  delete state.reports
  onReports = false
  window.history.replaceState(state, '', to)
}
