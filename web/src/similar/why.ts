/**
 * For the kanji page's rows: how a near-synonym's reason is put into words,
 * and which neighbours a level keeps.
 */

import type { KanjiNode, SimilarWhy } from '../api'
import { strings, type Lang } from '../i18n'

const S = strings({ both: 'both: {gloss}' }, { both: 'и двата: {gloss}' })

/**
 * The reason, or null. Words that take either kanji (早い・速い) and the kun
 * reading they share (あたたかい; shown under "Same reading", so the reading
 * alone says it) are Japanese, and read the same in both languages;
 * shared English glosses are not shown in Bulgarian, where the neighbour's own
 * Bulgarian meaning beside it says more.
 */
export function whyText(why: SimilarWhy | null, lang: Lang): string | null {
  if (!why) return null
  const t = S(lang)
  if ('words' in why) return why.words.join('  ')
  if ('kun' in why) return why.kun
  return lang === 'en' ? t('both', { gloss: why.gloss.join(', ') }) : null
}

/** Newspaper-ranked, on a JLPT list or jōyō: what "common" means for a neighbour. */
export function isCommon(n: Pick<KanjiNode, 'freq' | 'jlpt' | 'joyo'>): boolean {
  return n.freq !== null || n.jlpt !== null || n.joyo
}
