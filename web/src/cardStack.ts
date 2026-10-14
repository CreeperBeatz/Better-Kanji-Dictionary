/**
 * On a phone, the open page is a card lying on the cards opened before it.
 * Each of those is a copy of its page, at its top, behind the open card: a
 * little narrower the further down it lies, its head folded into a line
 * (App.tsx folds heads by --p). What shows above the open card is the top of
 * each: the nearest card's folded line, a rim of the ones under it.
 *
 * Taking cards off moves them as things, without fading anything: the open
 * card falls off the bottom, the card under it comes forward -- wider, into
 * the open card's place, its head unfolding -- and the ones under that move
 * up a place. At the end the page itself takes the place of its copy, in
 * the same spot. Every position comes from `rest` and `open`, so the stack
 * App draws when it is still and the one moved here agree.
 */

/** How tall a card's head is folded into a line. */
export const LINE = 44
/** How much of each card further down shows above the one on it. */
const RIM = 8
/** Room above the deepest card shown. */
const PAD = 8
/** How many cards under the open one show at all. */
const SHOWN = 3

/** A card under the open one: its copy, its head, how far the head folds up, and its top edge. */
export interface Under {
  el: HTMLElement
  head: HTMLElement | null
  fold: number
  edge: HTMLElement | null
}

/** Where a card lies: moved down `y`, at `s` of its width, its head folded `p`. */
export interface Place {
  y: number
  s: number
  p: number
  /** How far it has become the first card, which lies flat on the search. */
  flat: number
}

/** How tall the cards under the open one stand above it, `m` of them. */
export function stackHeight(m: number): number {
  return m === 0 ? 0 : PAD + RIM * (Math.min(m, SHOWN) - 1) + LINE
}

/** Where the rims show, bottom first: for App's taps on them. */
export function rims(m: number): { top: number; height: number }[] {
  const shown = Math.min(m, SHOWN)
  return Array.from({ length: shown }, (_, k) => ({ top: PAD + RIM * k, height: k === shown - 1 ? LINE : RIM }))
}

/** The `i`-th of `m` cards under the open one (0 the bottom), at rest. Its folded line is its top. */
export function rest(m: number, i: number, fold: number): Place {
  const shown = Math.min(m, SHOWN)
  // The ones below those shown lie under the bottom one shown.
  const k = Math.max(0, i - (m - shown))
  const s = 1 - 0.04 * (shown - k)
  return { y: PAD + RIM * k - s * fold, s, p: 1, flat: 0 }
}

/** The open card's place, with `m` cards under it. */
function open(m: number): Place {
  return { y: stackHeight(m), s: 1, p: 0, flat: m === 0 ? 1 : 0 }
}

function mix(a: Place, b: Place, t: number): Place {
  const at = (x: number, y: number) => x + (y - x) * t
  return { y: at(a.y, b.y), s: at(a.s, b.s), p: at(a.p, b.p), flat: at(a.flat, b.flat) }
}

/**
 * Puts a card where `at` says. Folded, what shows of it starts at its line,
 * so it is cut there, with the rounded top and the edge a card has; as it
 * unfolds, the cut goes up to its own top. Becoming the first card, it lies
 * down flat as it comes: its top squares, its edge and shadow go, and it
 * takes the page's colour. Only the card, its head and its edge change, and
 * nothing inherits from them: no layout, little restyling.
 */
export function put(u: Under, at: Place) {
  const cut = (u.fold * at.p).toFixed(1)
  const r = `${(14 * (1 - at.flat)).toFixed(1)}px`
  u.el.style.transform = `translateY(${at.y}px) scale(${at.s})`
  // Unfolded, nothing is cut, and its shadow shows as the open card's does.
  u.el.style.clipPath = at.p > 0 ? `inset(${cut}px 0 0 0 round ${r} ${r} 0 0)` : ''
  u.head?.style.setProperty('--p', at.p.toFixed(3))
  if (u.edge) u.edge.style.transform = `translateY(${cut}px)`
  if (at.flat === 0 && !u.el.style.background) return
  const f = (at.flat * 100).toFixed(1)
  const ground = `color-mix(in srgb, var(--sumi-sunk) ${f}%, var(--sumi))`
  u.el.style.borderRadius = `${r} ${r} 0 0`
  u.el.style.background = ground
  u.el.style.boxShadow = `0 -10px 28px rgb(0 0 0 / ${(0.55 * (1 - at.flat)).toFixed(3)})`
  if (u.head) {
    u.head.style.borderRadius = `${r} ${r} 0 0`
    u.head.style.background = ground
  }
  if (u.edge) {
    u.edge.style.borderRadius = `${r} ${r} 0 0`
    u.edge.style.borderTopColor = `color-mix(in srgb, transparent ${f}%, var(--rule-bright))`
  }
}

/** The rounded edge along the top of what shows of a card under the open one (see `put`). */
function withEdge(g: HTMLElement): HTMLElement {
  const edge = document.createElement('div')
  edge.className = 'copy-edge'
  g.append(edge)
  return g
}

/** A card's move: from where it lies to where it goes. */
export interface Move {
  u: Under
  from: Place
  to: Place
}

/**
 * The cards under the open one as `k` cards come off, the open one with them
 * (it moves by itself, in App): the ones over the card gone back to fall with
 * it, that card comes into the open card's place, and the ones under it each
 * move up as many places. `h` is how far down falling is.
 */
export function comeOff(unders: Under[], k: number, h: number): Move[] {
  const m = unders.length
  return unders.map((u, i) => {
    const from = rest(m, i, u.fold)
    if (i > m - k) return { u, from, to: { ...from, y: from.y + h } }
    if (i === m - k) return { u, from, to: open(m - k) }
    return { u, from, to: rest(m - k, i, u.fold) }
  })
}

/** All of `moves`, `t` of the way. */
export function moveTo(moves: Move[], t: number) {
  for (const m of moves) put(m.u, mix(m.from, m.to, t))
}

/**
 * Calls `step` once a frame for `ms` with how far along it is, eased out
 * (fast, then settling), then `done`. One clock for the card and the cards
 * under it, so they move as one. Returns a way to stop it.
 */
export function run(ms: number, step: (e: number) => void, done: () => void): () => void {
  if (ms <= 0) {
    step(1)
    done()
    return () => {}
  }
  const start = performance.now()
  let frame = requestAnimationFrame(function tick(now) {
    const x = Math.min(1, (now - start) / ms)
    step(1 - (1 - x) ** 3)
    if (x < 1) frame = requestAnimationFrame(tick)
    else done()
  })
  return () => cancelAnimationFrame(frame)
}

/** How long a fall of `way` px takes, thrown at `speed` px/ms: the ease starts at 3x its mean speed. */
export function fallTime(way: number, speed: number): number {
  return Math.min(360, Math.max(200, (3 * way) / Math.max(speed, 1.2)))
}

const ROWS = '.rail-section, .word, .comment, .vocab-row'

/**
 * A copy of the open card as it is at its top, to lie under the next one:
 * what is below the first screen is left out, and its head is unfolded.
 */
export function copyCard(card: HTMLElement, screen: number): HTMLElement {
  const g = card.cloneNode(true) as HTMLElement
  const top = card.getBoundingClientRect().top
  // Not the head's: it is sticky, and where the page was scrolled, it stands
  // as far down the card as the card went up.
  const into = g.querySelectorAll(ROWS)
  card.querySelectorAll(ROWS).forEach((row, i) => {
    if (!row.closest('.page-head') && row.getBoundingClientRect().top - top > screen + 24) into[i]?.remove()
  })
  g.dataset.copy = ''
  g.dataset.stacked = ''
  g.removeAttribute('data-moving')
  g.removeAttribute('data-quiet')
  g.style.transform = ''
  g.setAttribute('aria-hidden', 'true')
  g.inert = true
  g.querySelector('.page-head')?.removeAttribute('data-collapsed')
  return withEdge(g)
}

/** For a page no copy was kept of -- one opened from a link, say -- a card with its name. */
export function blankCard(name: string): HTMLElement {
  const g = document.createElement('div')
  g.className = 'page-card'
  g.dataset.copy = ''
  g.dataset.stacked = ''
  g.setAttribute('aria-hidden', 'true')
  const line = document.createElement('div')
  line.className = 'page-head card-name'
  line.textContent = name
  g.append(line)
  return withEdge(g)
}

/** For a page no copy was kept of but there is a page to draw: a card App draws it in. */
export function liveCard(): HTMLElement {
  const g = document.createElement('div')
  g.className = 'page-card'
  g.dataset.copy = ''
  g.dataset.stacked = ''
  g.setAttribute('aria-hidden', 'true')
  g.inert = true
  return withEdge(g)
}

/** A card put in the stack: its head, and how far that folds up to leave its line on top. */
export function underOf(el: HTMLElement): Under {
  const head = el.querySelector<HTMLElement>('.page-head')
  const edge = el.querySelector<HTMLElement>(':scope > .copy-edge')
  return { el, head, edge, fold: Math.max(0, (head?.offsetHeight ?? LINE) - LINE) }
}
