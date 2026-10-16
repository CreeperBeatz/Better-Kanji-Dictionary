import { scrollerOf } from './fold'

/**
 * A meaning to bring into view once its kanji's page shows it: a "close in
 * meaning" row opens 典 at its "ceremony", not at its top. Set as the row
 * opens the kanji, taken by that kanji's page once its meanings are drawn.
 */
let pending: { char: string; id: string } | null = null

export function focusMeaningNext(char: string, id: string) {
  pending = { char, id }
}

/** The meaning of `char` to bring into view, once; null when there is none. */
export function takeMeaningFocus(char: string): string | null {
  if (pending?.char !== char) return null
  const { id } = pending
  pending = null
  return id
}

/**
 * A meaning to open all the words at: "all 53 words" on a card opens the
 * kanji's words at that card, not at their top. Set as the card opens them,
 * read by the words' page as it draws, and let go of once it has drawn. `n`
 * counts the asks, so a page already showing the kanji's words sees a new one.
 */
let pendingWords: { char: string; id: string; n: number } | null = null
let asks = 0

export function focusWordsNext(char: string, id: string) {
  pendingWords = { char, id, n: ++asks }
}

/** The meaning of `char` to open all its words at, and which ask it is; null when there is none. */
export function peekWordsFocus(char: string): { id: string; n: number } | null {
  return pendingWords?.char === char ? pendingWords : null
}

export function takeWordsFocus(char: string) {
  if (pendingWords?.char === char) pendingWords = null
}

/** Where a meaning's card is on its page. */
export const meaningAnchor = (id: string) => `meaning-${id}`

/** How long a card brought into view keeps to its place as the page settles, in ms. */
const SETTLE_MS = 1500

/**
 * Brings a card into view with its top at the top of the screen, under the
 * folded page head (its scroll-margin, theme.css), to be read from its
 * start. The page may still be settling as it goes: on a phone rising into
 * place, its later parts still coming in (the scroll would stop short, at
 * the end the page had then). So while it settles, where the card's top
 * should be is measured again each frame, and the scroll aimed there anew
 * when that moves. A finger, wheel or key of the reader's stops it.
 * Returns a cancel.
 */
export function bringToTop(id: string, smooth: boolean, then?: (el: HTMLElement) => void): () => void {
  let frame = 0
  let stop = () => cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const el = document.getElementById(id)
    const sc = el && scrollerOf(el)
    if (!el || !sc) return
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
    const until = performance.now() + SETTLE_MS
    let aim = NaN
    const step = () => {
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - margin
      const to = Math.max(0, Math.min(top, sc.scrollHeight - sc.clientHeight))
      if (!(Math.abs(to - aim) < 1)) {
        aim = to
        sc.scrollTo({ top: to, behavior: smooth ? 'smooth' : 'auto' })
      }
      if (performance.now() < until) frame = requestAnimationFrame(step)
    }
    const quit = () => {
      cancelAnimationFrame(frame)
      for (const k of HANDS) sc.removeEventListener(k, quit)
    }
    for (const k of HANDS) sc.addEventListener(k, quit, { passive: true })
    stop = quit
    step()
    then?.(el)
  })
  return () => stop()
}

/** What a reader does to scroll for themselves. */
const HANDS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
