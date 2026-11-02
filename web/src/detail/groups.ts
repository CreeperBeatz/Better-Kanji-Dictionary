/** A kanji's meaning groups: the catch-all's id, and a group's label in the interface language. */
import type { MeaningGroup } from '../api'
import { strings } from '../i18n'

const S = strings({ catchAll: 'the kanji brings no meaning to the word' }, { catchAll: 'канджито не внася значение в думата' })

export const CATCH_ALL = 'catch-all'

export function groupLabel(id: string, groups: MeaningGroup[] | null | undefined, lang: 'en' | 'bg'): string {
  if (id === CATCH_ALL) return S(lang)('catchAll')
  const g = groups?.find((x) => x.id === id)
  return g ? (lang === 'bg' && g.bg) || g.en : id
}
