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

/** Where a meaning's card is on its page. */
export const meaningAnchor = (id: string) => `meaning-${id}`
