/**
 * The review screen has an address of its own: /review, /review/history, ...
 * It is a history entry on top of whatever page was open, so back closes it
 * and back from a kanji opened out of it lands in it again. The rail's own
 * history entries (nav.ts) carry on underneath: the review entry keeps their
 * state and adds `review`.
 *
 * The queue's address names the stage and the item being looked at:
 * /review/queue/meanings/i-0123abcd, /review/queue/all, plus ?origin=suggestion
 * when filtered, so a reload comes back to the same item.
 */
import type { WorkbenchTab } from '../account/Account'
import type { Origin, TaskType } from '../api'

const TABS: WorkbenchTab[] = ['queue', 'history', 'progress', 'people', 'handbook']
const PATH = /^\/review(?:\/([a-z-]+))?(?:\/[^/]*)*\/?$/
const QUEUE_PATH = /^\/review\/queue(?:\/([a-z-]+))?(?:\/([A-Za-z0-9-]+))?\/?$/

const SLUGS: Record<TaskType, string> = {
  decomposition: 'parts',
  form_link: 'forms',
  kanji_senses: 'meanings',
  word_sense: 'word-meanings',
}

export interface QueueRoute {
  type?: TaskType
  origin?: Origin
  /** The item open in the queue. */
  item?: string
}

// Where the queue was, so coming back to its tab from History lands there again.
let lastQueue: QueueRoute = {}

export function queuePath(r: QueueRoute): string {
  const path = `/review/queue/${r.type ? SLUGS[r.type] : 'all'}${r.item ? `/${r.item}` : ''}`
  return r.origin ? `${path}?origin=${r.origin}` : path
}

export function queueRouteInUrl(): QueueRoute {
  const m = window.location.pathname.match(QUEUE_PATH)
  if (!m) return lastQueue
  const type = (Object.keys(SLUGS) as TaskType[]).find((k) => SLUGS[k] === m[1])
  const origin = new URLSearchParams(window.location.search).get('origin')
  return { type, item: m[2], origin: origin === 'proposal' || origin === 'suggestion' ? origin : undefined }
}

/** The queue moved to another stage or item: the address follows, in place. */
export function replaceQueueRoute(r: QueueRoute) {
  lastQueue = r
  if (reviewTabInState(window.history.state) !== 'queue') return
  window.history.replaceState(window.history.state, '', queuePath(r))
}

export function reviewPath(tab: WorkbenchTab): string {
  return tab === 'queue' ? queuePath(lastQueue) : `/review/${tab}`
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
  // Already on this tab (the address may name more, like the queue's item): keep the address.
  const here = reviewTabInUrl() === tab
  window.history.replaceState({ ...(window.history.state ?? {}), review: tab }, '', here ? window.location.pathname + window.location.search : reviewPath(tab))
}

/** Leave the review entry in place for the page under it, when there is no entry to go back to. */
export function dropReview(to: string) {
  const state = { ...(window.history.state ?? {}) }
  delete state.review
  onReview = false
  window.history.replaceState(state, '', to)
}
