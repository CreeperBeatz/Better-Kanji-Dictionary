import type { Word } from '../api'
import { strings, useLang } from '../i18n'
import { transitivity, type Transitivity } from './transitivity'

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

/**
 * が for an intransitive verb, を for a transitive one, and before them する
 * for a noun that is a verb with する -- where its が or を comes from. The
 * particles' slot is there on every row, empty for words that are not verbs,
 * so a column of them lines up; する only takes room to its left. `alone`,
 * out of a column, a word that is not a verb has nothing.
 */
export function Valency({ word, alone }: { word: Word; alone?: boolean }) {
  const t = S(useLang())
  const kind = transitivity(word)
  const suru = word.senses.some((s) => s.pos.includes('vs'))
  if (alone && !kind && !suru) return null
  return (
    <span className="verb-marks">
      {suru && (
        <span className="suru" title={t('suru', { word: word.headword })}>
          する
        </span>
      )}
      <Particles kind={kind} />
    </span>
  )
}

/**
 * Just the が or を, smaller, for beside a reading in running text -- あ.く が,
 * あ.ける を on 開 -- where a word that is not a verb simply has none.
 */
export function ValencyMark({ word }: { word: Word }) {
  const kind = transitivity(word)
  return kind ? <Particles kind={kind} small /> : null
}

function Particles({ kind, small }: { kind: Transitivity | null; small?: boolean }) {
  const t = S(useLang())
  return (
    <span
      className={small ? 'valency valency-small' : 'valency'}
      role={kind ? 'img' : undefined}
      title={kind ? t(kind) : undefined}
      aria-label={kind ? t(kind) : undefined}
    >
      {(kind === 'vi' || kind === 'both') && <span data-v="vi">が</span>}
      {(kind === 'vt' || kind === 'both') && <span data-v="vt">を</span>}
    </span>
  )
}
