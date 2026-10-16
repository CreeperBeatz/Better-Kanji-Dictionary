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
