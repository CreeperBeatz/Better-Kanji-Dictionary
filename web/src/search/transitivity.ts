import type { Word } from '../api'

export type Transitivity = 'vi' | 'vt' | 'both'

/**
 * Whether a verb takes が or を, as its first sense that says so has it: a
 * handful of later senses going the other way -- 上げる, used of vomiting --
 * is not what the verb is learned as.
 */
export function transitivity(w: Word): Transitivity | null {
  for (const s of w.senses) {
    const vi = s.pos.includes('vi')
    const vt = s.pos.includes('vt')
    if (vi && vt) return 'both'
    if (vi) return 'vi'
    if (vt) return 'vt'
  }
  return null
}
