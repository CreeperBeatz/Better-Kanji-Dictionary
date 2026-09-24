import type { Word } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    vi: 'Intransitive: something happens, marked with が',
    vt: 'Transitive: done to something, marked with を',
    both: 'Both intransitive, with が, and transitive, with を',
  },
  {
    vi: 'Непреходен: нещо става, отбелязва се с が',
    vt: 'Преходен: върши се на нещо, отбелязва се с を',
    both: 'И непреходен, с が, и преходен, с を',
  },
)

type Transitivity = 'vi' | 'vt' | 'both'

/**
 * Whether a verb takes が or を, as its first sense that says so has it: a
 * handful of later senses going the other way -- 上げる, used of vomiting --
 * is not what the verb is learned as.
 */
function transitivity(w: Word): Transitivity | null {
  for (const s of w.senses) {
    const vi = s.pos.includes('vi')
    const vt = s.pos.includes('vt')
    if (vi && vt) return 'both'
    if (vi) return 'vi'
    if (vt) return 'vt'
  }
  return null
}

/**
 * が for an intransitive verb, を for a transitive one. The slot is there on
 * every row, empty for words that are not verbs, so a column of them lines up.
 */
export function Valency({ word }: { word: Word }) {
  const t = S(useLang())
  const kind = transitivity(word)
  return (
    <span
      className="valency"
      role={kind ? 'img' : undefined}
      title={kind ? t(kind) : undefined}
      aria-label={kind ? t(kind) : undefined}
    >
      {(kind === 'vi' || kind === 'both') && <span data-v="vi">が</span>}
      {(kind === 'vt' || kind === 'both') && <span data-v="vt">を</span>}
    </span>
  )
}
