import type { Page } from './nav'

/**
 * Marks a link to a kanji's page or a word's: with a mouse, what that page
 * shows is asked for as the pointer rests on it, so a click finds it here
 * and the page comes whole at once (App.tsx).
 */
export const warmKanji = (char: string) => ({ 'data-warm': `k:${char}` })
export const warmWord = (id: number) => ({ 'data-warm': `w:${id}` })

/** The page a mark is for. */
export function warmPage(mark: string): Page | null {
  const v = mark.slice(2)
  if (mark.startsWith('k:') && v) return { kind: 'kanji', char: v }
  if (mark.startsWith('w:') && Number(v) > 0) return { kind: 'word', id: Number(v) }
  return null
}
