/**
 * Showing and editing the value of each task type (server/review.py), shared
 * by the review queue and the "suggest a change" dialog.
 *
 *   decomposition  the direct parts, as typed characters
 *   form_link      a kind and a note
 *   kanji_senses   1 to 6 meaning groups, each an id and a label in en and bg
 *   word_sense     one of the kanji's groups, or the catch-all
 */
import { lazy, Suspense, useState } from 'react'
import { type FormKind, type MeaningGroup, type TaskType, type TaskValue } from '../api'
import { strings, useLang } from '../i18n'

// Not needed until its button is pressed.
const DrawPad = lazy(() => import('../draw/DrawPad').then((m) => ({ default: m.DrawPad })))

const S = strings(
  {
    atomic: 'no parts (atomic)',
    sourceData: 'as the source data has it',
    noneYet: 'none yet',
    parts: 'Parts, as characters',
    partsHint: 'Type or paste the direct parts in writing order: 生月. Leave empty for a character with no parts.',
    draw: 'Draw',
    drawTitle: 'Draw a part; picking it adds it',
    hideDraw: 'Hide drawing',
    confirmStroke: '{parts}: a single stroke. Use it as a part anyway? Only when it means something in this character, like the flame 丶 on 主.',
    kind: 'Relation',
    k_positional: 'the same part in another position',
    k_old: 'its old form',
    k_form_of: 'is a form of (lends its meaning)',
    k_looks_like: 'looks like (a mnemonic only)',
    k_none: 'no relation',
    note: 'Note',
    noteHint: 'For “a form of”, say where it comes from: the old form, or a reference.',
    groups: 'Meaning groups',
    groupsHint: '1 to 6, by what the kanji does in words. Words the kanji brings no meaning to have their own box, which always exists.',
    id: 'id',
    en: 'English',
    bg: 'Bulgarian',
    addGroup: 'add a group',
    remove: 'remove',
    catchAll: 'the kanji brings no meaning to the word',
    noGroups: 'This kanji has no accepted meaning groups yet.',
  },
  {
    atomic: 'без части (неделим)',
    sourceData: 'както е в изходните данни',
    noneYet: 'още няма',
    parts: 'Части, като знаци',
    partsHint: 'Напишете или поставете преките части по реда на писане: 生月. Оставете празно за знак без части.',
    draw: 'Рисуване',
    drawTitle: 'Нарисувайте част; изборът я добавя',
    hideDraw: 'Скрийте рисуването',
    confirmStroke: '{parts}: отделна черта. Да се използва ли все пак като част? Само ако значи нещо в този знак, като пламъка 丶 в 主.',
    kind: 'Връзка',
    k_positional: 'същата част в друга позиция',
    k_old: 'старата му форма',
    k_form_of: 'е форма на (заема значението му)',
    k_looks_like: 'прилича на (само мнемоника)',
    k_none: 'няма връзка',
    note: 'Бележка',
    noteHint: 'За „форма на“ кажете откъде идва: старата форма или справочник.',
    groups: 'Групи значения',
    groupsHint: 'От 1 до 6, според това какво прави канджито в думите. Думите, на които канджито не внася значение, имат своя кутия, която винаги съществува.',
    id: 'код',
    en: 'английски',
    bg: 'български',
    addGroup: 'добавете група',
    remove: 'махнете',
    catchAll: 'канджито не внася значение в думата',
    noGroups: 'Това канджи още няма приети групи значения.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
export const FORM_KINDS: FormKind[] = ['positional', 'old', 'form_of', 'looks_like', 'none']

/**
 * Single strokes (server/review.py STROKES). The server refuses them as parts
 * only from data sources; a person may use one, after saying yes to this.
 */
const STROKES = new Set([...'一丨丶丿乙亅乚㇒㇏'])

/** True when the parts hold no stroke, or the person confirms they mean it. */
export function strokesOk(parts: TaskValue, lang: 'en' | 'bg'): boolean {
  const strokes = Array.isArray(parts) ? (parts as string[]).filter((c) => STROKES.has(c)) : []
  return !strokes.length || window.confirm(S(lang)('confirmStroke', { parts: strokes.join(' ') }))
}
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
  if (type === 'en_report') return <span className="review-report">{value as string}</span>
  if (type === 'bg') {
    return (
      <span lang="bg" className="review-bg">
        {(value as string[]).filter(Boolean).join(' · ')}
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
  /** kanji_senses: a column for each group's Bulgarian label too. */
  withBg?: boolean
}

export function ValueEditor({ type, value, onChange, groups, char, autoFocus, withBg }: EditorProps) {
  const lang = useLang()
  const t = S(lang)

  if (type === 'decomposition') return <PartsEditor value={value as string[] | null} onChange={onChange} autoFocus={autoFocus} />

  if (type === 'en_report')
    return (
      <textarea className="assoc-text" rows={4} maxLength={1000} value={(value as string | null) ?? ''} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    )

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
              {withBg && <th>{t('bg')}</th>}
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
                {withBg && (
                  <td>
                    <input className="assoc-text" lang="bg" maxLength={40} value={g.bg ?? ''} onChange={(e) => set(i, { bg: e.target.value || null })} />
                  </td>
                )}
                <td>
                  <input className="assoc-text" value={g.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} />
                </td>
                <td>
                  <button type="button" className="clear" onClick={() => onChange(list.filter((_, j) => j !== i))}>
                    {t('remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length < 6 && (
          <button type="button" className="clear" onClick={() => onChange([...list, { id: `g${list.length + 1}`, en: '', bg: null, note: null }])}>
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
        <button type="button" key={id} role="radio" aria-checked={value === id} data-on={value === id} onClick={() => onChange(id)}>
          <kbd>{i + 1}</kbd> {groupLabel(id, groups, lang)}
        </button>
      ))}
    </div>
  )
}

/** Parts as typed characters, or drawn: a pick from the pad is added at the end. */
function PartsEditor({ value, onChange, autoFocus }: { value: string[] | null; onChange: (v: TaskValue) => void; autoFocus?: boolean }) {
  const t = S(useLang())
  const [drawing, setDrawing] = useState(false)
  const parts = value ?? []
  return (
    <div className="review-field">
      <span>{t('parts')}</span>
      <div className="review-parts-row">
        <input
          className="assoc-text review-parts-input"
          lang="ja"
          value={parts.join('')}
          autoFocus={autoFocus}
          aria-label={t('parts')}
          onChange={(e) => onChange([...e.target.value.replace(/\s|[,、・]/g, '')])}
        />
        <button type="button" className="searchbar-tool review-draw-toggle" data-on={drawing || undefined} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)} title={t('drawTitle')}>
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 17c2-.4 3.2-1.2 4.3-2.3L16.5 5.5a1.8 1.8 0 0 0-2.5-2.5L4.8 12.2C3.7 13.3 3.2 14.8 3 17Z" />
          </svg>
          <span>{drawing ? t('hideDraw') : t('draw')}</span>
        </button>
      </div>
      <span className="hint">{t('partsHint')}</span>
      {drawing && (
        <div className="review-draw">
          <Suspense fallback={null}>
            <DrawPad onPick={(c) => onChange([...parts.filter((p) => p !== c), c])} />
          </Suspense>
        </div>
      )}
    </div>
  )
}
