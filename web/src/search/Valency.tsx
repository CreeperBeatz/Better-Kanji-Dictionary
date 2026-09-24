import type { Word } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    vi: 'Intransitive: something happens, marked with が',
    vt: 'Transitive: done to something, marked with を',
    both: 'Both intransitive, with が, and transitive, with を',
    suru: 'A noun that becomes a verb with する: {word}する',
  },
  {
    vi: 'Непреходен: нещо става, отбелязва се с が',
    vt: 'Преходен: върши се на нещо, отбелязва се с を',
    both: 'И непреходен, с が, и преходен, с を',
    suru: 'Съществително, което става глагол със する: {word}する',
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
 * が for an intransitive verb, を for a transitive one, and before them する
 * for a noun that is a verb with する -- where its が or を comes from. The
 * particles' slot is there on every row, empty for words that are not verbs,
 * so a column of them lines up; する only takes room to its left.
 */
export function Valency({ word }: { word: Word }) {
  const t = S(useLang())
  const kind = transitivity(word)
  const suru = word.senses.some((s) => s.pos.includes('vs'))
  return (
    <span className="verb-marks">
      {suru && (
        <span className="suru" title={t('suru', { word: word.headword })}>
          する
        </span>
      )}
      <span
        className="valency"
        role={kind ? 'img' : undefined}
        title={kind ? t(kind) : undefined}
        aria-label={kind ? t(kind) : undefined}
      >
        {(kind === 'vi' || kind === 'both') && <span data-v="vi">が</span>}
        {(kind === 'vt' || kind === 'both') && <span data-v="vt">を</span>}
      </span>
    </span>
  )
}
