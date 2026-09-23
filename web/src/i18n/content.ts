/**
 * Dictionary content in the interface language.
 *
 * Every entry and character arrives with both its English glosses and, when
 * translated, its Bulgarian ones, so switching language needs no refetch.
 * Bulgarian is machine-translated for now and not complete: where a sense or
 * character has none, the English stands in, and `fallback` says so, so the
 * UI can mark it.
 */

import type { Lang } from '.'

export interface Shown<T> {
  value: T
  /** True when English stands in for a Bulgarian that is not there yet. */
  fallback: boolean
}

/** One sense's glosses, "; "-joined. */
export function glossOf(sense: { gloss: string; glossBg?: string | null }, lang: Lang): Shown<string> {
  if (lang === 'bg' && sense.glossBg) return { value: sense.glossBg, fallback: false }
  return { value: sense.gloss, fallback: lang === 'bg' }
}

/** A character's meanings. KANJIDIC capitalises every word; Bulgarian is lower case already. */
export function meaningsOf(k: { meanings: string[]; meaningsBg?: string[] | null }, lang: Lang): Shown<string[]> {
  if (lang === 'bg' && k.meaningsBg && k.meaningsBg.length) return { value: k.meaningsBg, fallback: false }
  return { value: k.meanings, fallback: lang === 'bg' && k.meanings.length > 0 }
}

/** The map's one-meaning-per-character columns. */
export function mapMeaning(m: { meaning: string[]; meaningBg?: string[] }, i: number, lang: Lang): Shown<string> {
  const bg = lang === 'bg' ? m.meaningBg?.[i] : undefined
  if (bg) return { value: bg, fallback: false }
  return { value: m.meaning[i] ?? '', fallback: lang === 'bg' && !!m.meaning[i] }
}
