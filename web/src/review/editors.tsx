/**
 * Showing and editing the value of each task type (server/review.py), shared
 * by the review queue and the "suggest a change" dialog.
 *
 *   decomposition  the direct parts, as typed characters
 *   form_link      a kind and a note
 *   kanji_senses   2 to 6 meaning groups, each an id and a label in en and bg
 *   word_sense     one of the kanji's groups, or the catch-all
 */
import { type FormKind, type MeaningGroup, type TaskType, type TaskValue } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    atomic: 'no parts (atomic)',
    sourceData: 'as the source data has it',
    noneYet: 'none yet',
    parts: 'Parts, as characters',
    partsHint: 'Type or paste the direct parts in writing order: 生月. Leave empty for a character with no parts.',
    kind: 'Relation',
    k_positional: 'the same part in another position',
    k_old: 'its old form',
    k_form_of: 'is a form of (lends its meaning)',
    k_looks_like: 'looks like (a mnemonic only)',
    k_none: 'no relation',
    note: 'Note',
    noteHint: 'For “a form of”, say where it comes from: the old form, or a reference.',
    groups: 'Meaning groups',
    groupsHint: '2 to 6, by what the kanji does in words. Sound-only and fixed spellings go to the catch-all, which always exists.',
    id: 'id',
    en: 'English',
    bg: 'Bulgarian',
    addGroup: 'add a group',
    remove: 'remove',
    catchAll: 'sound / fixed spelling',
    noGroups: 'This kanji has no accepted meaning groups yet.',
  },
  {
    atomic: 'без части (неделим)',
    sourceData: 'както е в изходните данни',
    noneYet: 'още няма',
    parts: 'Части, като знаци',
    partsHint: 'Напишете или поставете преките части по реда на писане: 生月. Оставете празно за знак без части.',
    kind: 'Връзка',
    k_positional: 'същата част в друга позиция',
    k_old: 'старата му форма',
    k_form_of: 'е форма на (заема значението му)',
    k_looks_like: 'прилича на (само мнемоника)',
    k_none: 'няма връзка',
    note: 'Бележка',
    noteHint: 'За „форма на“ кажете откъде идва: старата форма или справочник.',
    groups: 'Групи значения',
    groupsHint: 'От 2 до 6, според това какво прави кандзито в думите. Само звук и устойчиви изписвания отиват в общата група, която винаги съществува.',
    id: 'код',
    en: 'английски',
    bg: 'български',
    addGroup: 'добавете група',
    remove: 'махнете',
    catchAll: 'звук / устойчиво изписване',
    noGroups: 'Това кандзи още няма приети групи значения.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
export const FORM_KINDS: FormKind[] = ['positional', 'old', 'form_of', 'looks_like', 'none']
export const CATCH_ALL = 'catch-all'

export function groupLabel(id: string, groups: MeaningGroup[] | null | undefined, lang: 'en' | 'bg'): string {
  if (id === CATCH_ALL) return S(lang)('catchAll')
  const g = groups?.find((x) => x.id === id)
  return g ? (lang === 'bg' && g.bg) || g.en : id
}

/** A value, read-only. */
export function ValueView({ type, value, groups }: { type: TaskType; value: TaskValue; groups?: MeaningGroup[] | null }) {
  const lang = useLang()
  const t = S(lang)
  if (value === null || value === undefined)
    return <span className="hint">{t(type === 'decomposition' || type === 'form_link' ? 'sourceData' : 'noneYet')}</span>
  if (type === 'decomposition') {
    const parts = value as string[]
    return parts.length ? (
      <span className="review-parts" lang="ja">
        {parts.map((c, i) => (
          <span key={i} className="review-part">
            {c}
          </span>
        ))}
      </span>
    ) : (
      <span className="hint">{t('atomic')}</span>
    )
  }
  if (type === 'form_link') {
    const v = value as { kind: FormKind; note: string | null }
    return (
      <span>
        {t(`k_${v.kind}` as Key)}
        {v.note && <span className="hint"> — {v.note}</span>}
      </span>
    )
  }
  if (type === 'kanji_senses') {
    return (
      <ol className="review-groups">
        {(value as MeaningGroup[]).map((g) => (
          <li key={g.id}>
            <b>{lang === 'bg' && g.bg ? g.bg : g.en}</b> <span className="hint">{g.id}</span>
            {g.note && <span className="hint"> — {g.note}</span>}
          </li>
        ))}
      </ol>
    )
  }
  return <span>{groupLabel(value as string, groups, lang)}</span>
}

interface EditorProps {
  type: TaskType
  value: TaskValue
  onChange: (v: TaskValue) => void
  /** word_sense: the kanji's groups to pick from. */
  groups?: MeaningGroup[] | null
  /** kanji_senses: the kanji, to prefix new ids. */
  char?: string
  autoFocus?: boolean
}

export function ValueEditor({ type, value, onChange, groups, char, autoFocus }: EditorProps) {
  const lang = useLang()
  const t = S(lang)

  if (type === 'decomposition') {
    const text = ((value as string[] | null) ?? []).join('')
    return (
      <label className="review-field">
        <span>{t('parts')}</span>
        <input
          className="assoc-text review-parts-input"
          lang="ja"
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => onChange([...e.target.value.replace(/\s|[,、・]/g, '')])}
        />
        <span className="hint">{t('partsHint')}</span>
      </label>
    )
  }

  if (type === 'form_link') {
    const v = (value as { kind: FormKind; note: string | null } | null) ?? { kind: 'looks_like', note: null }
    return (
      <>
        <label className="review-field">
          <span>{t('kind')}</span>
          <select className="assoc-text" value={v.kind} autoFocus={autoFocus} onChange={(e) => onChange({ ...v, kind: e.target.value as FormKind })}>
            {FORM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`k_${k}` as Key)}
              </option>
            ))}
          </select>
        </label>
        <label className="review-field">
          <span>{t('note')}</span>
          <input className="assoc-text" maxLength={300} value={v.note ?? ''} onChange={(e) => onChange({ ...v, note: e.target.value })} />
          <span className="hint">{t('noteHint')}</span>
        </label>
      </>
    )
  }

  if (type === 'kanji_senses') {
    const list = (value as MeaningGroup[] | null) ?? []
    const set = (i: number, patch: Partial<MeaningGroup>) => onChange(list.map((g, j) => (j === i ? { ...g, ...patch } : g)))
    const short = (id: string) => (char && id.startsWith(`${char}.`) ? id.slice(char.length + 1) : id)
    return (
      <div className="review-field">
        <span>{t('groups')}</span>
        <span className="hint">{t('groupsHint')}</span>
        <table className="review-senses">
          <thead>
            <tr>
              <th>{t('id')}</th>
              <th>{t('en')}</th>
              <th>{t('bg')}</th>
              <th>{t('note')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((g, i) => (
              <tr key={i}>
                <td>
                  <input className="assoc-text" value={short(g.id)} onChange={(e) => set(i, { id: e.target.value })} size={8} />
                </td>
                <td>
                  <input className="assoc-text" value={g.en} autoFocus={autoFocus && i === 0} onChange={(e) => set(i, { en: e.target.value })} />
                </td>
                <td>
                  <input className="assoc-text" value={g.bg ?? ''} onChange={(e) => set(i, { bg: e.target.value })} />
                </td>
                <td>
                  <input className="assoc-text" value={g.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} />
                </td>
                <td>
                  <button className="clear" onClick={() => onChange(list.filter((_, j) => j !== i))}>
                    {t('remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length < 6 && (
          <button className="clear" onClick={() => onChange([...list, { id: `g${list.length + 1}`, en: '', bg: null, note: null }])}>
            {t('addGroup')}
          </button>
        )}
      </div>
    )
  }

  // word_sense
  if (!groups?.length) return <p className="hint">{t('noGroups')}</p>
  return (
    <div className="review-pick" role="radiogroup">
      {[...groups.map((g) => g.id), CATCH_ALL].map((id, i) => (
        <button key={id} role="radio" aria-checked={value === id} data-on={value === id} onClick={() => onChange(id)}>
          <kbd>{i + 1}</kbd> {groupLabel(id, groups, lang)}
        </button>
      ))}
    </div>
  )
}
