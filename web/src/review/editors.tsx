/**
 * Showing and editing the value of each task type (server/review.py), shared
 * by the review queue and the "suggest a change" dialog.
 *
 *   decomposition  the direct parts, as typed characters
 *   form_link      a kind and a note, and which way a one-way kind reads
 *   part_meaning   a meaning, or a shape's name, in en and bg, and a note
 *   kanji_senses   1 to 6 meaning groups, each an id and a label in en and bg
 *   word_sense     one of the kanji's groups, or the catch-all
 *   report         what it is about, and what is wrong, in the reporter's words
 */
import { lazy, Suspense, useState } from 'react'
import {
  type FormKind,
  type FormLink,
  type ItemDetail,
  type MeaningGroup,
  type PartMeaning,
  type Report,
  type ReportAbout,
  type TaskType,
  type TaskValue,
  type UsageCard,
} from '../api'
import { UsageEditor } from './Extras'
import { strings, useLang } from '../i18n'
import { FORM_KINDS, KindsInfoButton, KindsTable, ONE_WAY, PART_KINDS, useKindLabel, useKindsInfo, useLinkSentence } from './KindsInfo'

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
    note: 'Note',
    noteHint: 'For “a form of”, say where it comes from: the old form, or a reference.',
    swap: '⇄ swap',
    swapTitle: 'Read it the other way round',
    partKind: 'This part is',
    partEn: 'English: the meaning, or the shape’s name',
    partEnHint: '1 to 5 words. A shape’s name says what it looks like (“two drops”), never what it means.',
    partBg: 'Bulgarian',
    partNote: 'Note',
    partNoteHint: 'For a shape: what it is in which kanji, with old forms (“八 in 半; grains in 米”). For a meaning: how it works in a kanji or two.',
    partNoteBg: 'Note in Bulgarian',
    shapeNamed: 'a shape: “{name}”',
    noOwnMeaning: 'no meaning of its own',
    en: 'English',
    bg: 'Bulgarian',
    catchAll: 'the kanji brings no meaning to the word',
    noGroups: 'This kanji has no accepted meaning groups yet.',
    kanjidic: 'KANJIDIC',
    curated: 'Kanji Alive',
    readings: 'Readings',
    about: 'What is wrong',
    whatWrong: 'Say what is wrong, and what it should be if you know',
    r_english: 'its English meaning (from JMdict)',
    r_reading: 'its reading',
    r_meanings: 'its English meanings (from KANJIDIC)',
    r_readings: 'its readings',
    r_levels: 'its JLPT level, school grade or frequency',
    r_parts: 'its parts',
    r_forms: 'its forms or old form',
    r_similar: 'its similar kanji',
    r_strokes: 'its stroke order or count',
    r_other: 'something else',
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
    note: 'Бележка',
    noteHint: 'За „форма на“ кажете откъде идва: старата форма или справочник.',
    swap: '⇄ обърнете',
    swapTitle: 'Прочетете го в обратната посока',
    partKind: 'Тази част е',
    partEn: 'Английски: значението или името на формата',
    partEnHint: 'От 1 до 5 думи. Името на форма казва как изглежда („две капки“), никога какво значи.',
    partBg: 'Български',
    partNote: 'Бележка',
    partNoteHint: 'За форма: какво е тя в кое канджи, със старите форми („八 в 半; зърна в 米“). За значение: как работи в едно-две канджи.',
    partNoteBg: 'Бележка на български',
    shapeNamed: 'форма: „{name}“',
    noOwnMeaning: 'няма свое значение',
    en: 'английски',
    bg: 'български',
    catchAll: 'канджито не внася значение в думата',
    noGroups: 'Това канджи още няма приети групи значения.',
    kanjidic: 'KANJIDIC',
    curated: 'Kanji Alive',
    readings: 'Четения',
    about: 'Какво не е наред',
    whatWrong: 'Кажете какво не е наред и какво би трябвало да е, ако знаете',
    r_english: 'английското значение (от JMdict)',
    r_reading: 'четенето',
    r_meanings: 'английските значения (от KANJIDIC)',
    r_readings: 'четенията',
    r_levels: 'нивото по JLPT, класа в училище или честотата',
    r_parts: 'частите',
    r_forms: 'формите или старата форма',
    r_similar: 'сходните канджи',
    r_strokes: 'реда или броя на чертите',
    r_other: 'нещо друго',
  },
)

/**
 * Single strokes (server/review.py STROKES). The server refuses them as parts
 * only from data sources; a person may use one, after saying yes to this.
 */
const STROKES = new Set([...'一丨丶丿乙亅乚㇒㇏'])

type Key = Parameters<ReturnType<typeof S>>[0]

/** What a report may be about, by its subject (server/review.py REPORT_ABOUT). */
export const REPORT_ABOUT: Record<'word' | 'kanji', ReportAbout[]> = {
  word: ['english', 'reading', 'other'],
  kanji: ['meanings', 'readings', 'levels', 'parts', 'forms', 'similar', 'strokes', 'other'],
}

/** A report: what it is about (by `subject`, word:123 or kanji:生) and what is wrong. */
export function ReportEditor({ value, onChange, subject, autoFocus }: { value: Report | null; onChange: (v: Report) => void; subject: string; autoFocus?: boolean }) {
  const t = S(useLang())
  const choices = REPORT_ABOUT[subject.startsWith('word:') ? 'word' : 'kanji']
  const v = value ?? { about: choices[0], text: '' }
  return (
    <>
      <label className="review-field">
        <span>{t('about')}</span>
        <select className="assoc-text" value={v.about} onChange={(e) => onChange({ ...v, about: e.target.value as ReportAbout })}>
          {choices.map((k) => (
            <option key={k} value={k}>
              {t(`r_${k}` as Key)}
            </option>
          ))}
        </select>
      </label>
      <label className="review-field">
        <span>{t('whatWrong')}</span>
        <textarea className="assoc-text" rows={4} maxLength={1000} value={v.text} autoFocus={autoFocus} onChange={(e) => onChange({ ...v, text: e.target.value })} />
      </label>
    </>
  )
}

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

/** What the dictionaries say of a kanji, as rows of a <dl>: what a card on it is judged by. */
export function KanjiFacts({ context: c }: { context: ItemDetail['context'] }) {
  const t = S(useLang())
  return (
    <>
      {c.curated && (
        <>
          <dt>{t('curated')}</dt>
          <dd>{c.curated}</dd>
        </>
      )}
      {c.kanjidic && c.kanjidic.length > 0 && (
        <>
          <dt>{t('kanjidic')}</dt>
          <dd>{c.kanjidic.join(', ')}</dd>
        </>
      )}
      {(c.on?.length || c.kun?.length) ? (
        <>
          <dt>{t('readings')}</dt>
          <dd lang="ja">{[...(c.on ?? []), ...(c.kun ?? [])].join('、')}</dd>
        </>
      ) : null}
    </>
  )
}

/** Characters as tiles, as parts are shown; with `onKanji`, each opens its page. */
export function PartTiles({ chars, onKanji }: { chars: string[]; onKanji?: (char: string) => void }) {
  return (
    <span className="review-parts" lang="ja">
      {chars.map((c, i) =>
        onKanji ? (
          <button key={i} className="review-part" onClick={() => onKanji(c)}>
            {c}
          </button>
        ) : (
          <span key={i} className="review-part">
            {c}
          </span>
        ),
      )}
    </span>
  )
}

/** A value, read-only. `subject`, for a form link: its two characters, so it reads as a sentence. */
export function ValueView({ type, value, groups, subject }: { type: TaskType; value: TaskValue; groups?: MeaningGroup[] | null; subject?: string }) {
  const lang = useLang()
  const t = S(lang)
  const kindLabel = useKindLabel()
  const sentence = useLinkSentence()
  if (value === null || value === undefined)
    return <span className="hint">{t(type === 'decomposition' || type === 'form_link' ? 'sourceData' : 'noneYet')}</span>
  if (type === 'decomposition') {
    const parts = value as string[]
    return parts.length ? <PartTiles chars={parts} /> : <span className="hint">{t('atomic')}</span>
  }
  if (type === 'form_link') {
    const v = value as FormLink
    return (
      <span>
        {subject?.includes('|') ? <span lang="ja">{sentence(v.kind, subject, v.reverse)}</span> : kindLabel(v.kind)}
        {v.note && <span className="hint"> — {v.note}</span>}
      </span>
    )
  }
  if (type === 'part_meaning') return <PartMeaningView value={value as PartMeaning} />
  if (type === 'usage') {
    const u = value as UsageCard
    return (
      <ul className="review-usage">
        {u.spellings.map((s) => (
          <li key={s.kanji}>
            <b lang="ja">{s.kanji}</b> {lang === 'bg' ? s.defBg : s.defEn}
          </li>
        ))}
      </ul>
    )
  }
  if (type === 'report') {
    const r = value as Report
    return (
      <span className="review-report">
        <b>{t(`r_${r.about}` as Key)}</b> — {r.text}
      </span>
    )
  }
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
  autoFocus?: boolean
  /** form_link: X|Y, so each choice reads as a sentence and a one-way one can be turned round. */
  subject?: string
}

export function ValueEditor({ type, value, onChange, groups, autoFocus, subject }: EditorProps) {
  const lang = useLang()
  const t = S(lang)

  if (type === 'decomposition') return <PartsEditor value={value as string[] | null} onChange={onChange} autoFocus={autoFocus} />

  if (type === 'report') return <ReportEditor value={value as Report | null} onChange={onChange} subject={subject ?? ''} autoFocus={autoFocus} />

  if (type === 'form_link') return <FormLinkEditor value={value} onChange={onChange} autoFocus={autoFocus} subject={subject} />
  if (type === 'part_meaning') return <PartMeaningEditor value={value} onChange={onChange} autoFocus={autoFocus} />
  if (type === 'usage') return value ? <UsageEditor value={value as UsageCard} onChange={onChange} /> : null

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

/** `link` read the other way round, or back; `reverse` is only ever there when true. */
function turned(link: FormLink, reverse: boolean): FormLink {
  const { reverse: _, ...rest } = link
  return reverse && ONE_WAY.includes(link.kind) ? { ...rest, reverse: true } : rest
}

/**
 * A form link's kind and note; the (i) by the kind says what each one changes.
 * With the subject, each choice reads as a sentence with the two characters
 * ("寳 is the old form of 宝"), and ⇄ turns a one-way choice round.
 */
function FormLinkEditor({ value, onChange, autoFocus, subject }: { value: TaskValue; onChange: (v: TaskValue) => void; autoFocus?: boolean; subject?: string }) {
  const t = S(useLang())
  const kindLabel = useKindLabel()
  const sentence = useLinkSentence()
  const [info, toggleInfo] = useKindsInfo()
  const v = (value as FormLink | null) ?? { kind: 'looks_like', note: null }
  const reverse = !!v.reverse
  const label = (k: FormKind) => (subject ? sentence(k, subject, reverse) : kindLabel(k))
  return (
    <>
      <div className="review-field">
        <span>
          <label htmlFor="form-kind">{t('kind')}</label>
          <KindsInfoButton open={info} onToggle={toggleInfo} />
        </span>
        {info && <KindsTable of="form" />}
        <div className="review-link-row">
          <select
            id="form-kind"
            className="assoc-text"
            lang={subject ? 'ja' : undefined}
            value={v.kind}
            autoFocus={autoFocus}
            onChange={(e) => onChange(turned({ ...v, kind: e.target.value as FormKind }, reverse))}
          >
            {FORM_KINDS.filter((k) => k !== 'positional' || v.kind === 'positional').map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
          {subject && ONE_WAY.includes(v.kind) && (
            <button type="button" className="clear review-swap" title={t('swapTitle')} aria-pressed={reverse} onClick={() => onChange(turned(v, !reverse))}>
              {t('swap')}
            </button>
          )}
        </div>
      </div>
      <label className="review-field">
        <span>{t('note')}</span>
        <input className="assoc-text" maxLength={300} value={v.note ?? ''} onChange={(e) => onChange({ ...v, note: e.target.value })} />
        <span className="hint">{t('noteHint')}</span>
      </label>
    </>
  )
}

/** What a part is, read-only: its meaning, or a shape's name marked as one. */
export function PartMeaningView({ value: v }: { value: PartMeaning }) {
  const lang = useLang()
  const t = S(lang)
  const label = (lang === 'bg' && v.bg) || v.en
  const note = (lang === 'bg' && v.noteBg) || v.note
  return (
    <span className="review-part-meaning">
      {v.kind === 'shape' ? (
        <>
          {t('shapeNamed', { name: label })} <span className="hint">({t('noOwnMeaning')})</span>
        </>
      ) : (
        <b>{label}</b>
      )}
      {lang !== 'bg' && v.bg && <span className="hint" lang="bg"> · {v.bg}</span>}
      {note && <span className="hint review-part-note">{note}</span>}
    </span>
  )
}

function PartMeaningEditor({ value, onChange, autoFocus }: { value: TaskValue; onChange: (v: TaskValue) => void; autoFocus?: boolean }) {
  const t = S(useLang())
  const kindLabel = useKindLabel()
  const [info, toggleInfo] = useKindsInfo()
  const v = (value as PartMeaning | null) ?? { kind: 'shape', en: '', bg: null, note: null, noteBg: null }
  const set = (patch: Partial<PartMeaning>) => onChange({ ...v, ...patch })
  return (
    <>
      <div className="review-field">
        <span>
          {t('partKind')}
          <KindsInfoButton open={info} onToggle={toggleInfo} />
        </span>
        {info && <KindsTable of="part" />}
        <div className="review-pick" role="radiogroup" aria-label={t('partKind')}>
          {PART_KINDS.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={v.kind === k} data-on={v.kind === k} onClick={() => set({ kind: k })}>
              {kindLabel(k)}
            </button>
          ))}
        </div>
      </div>
      <label className="review-field">
        <span>{t('partEn')}</span>
        <input className="assoc-text" maxLength={40} value={v.en} autoFocus={autoFocus} onChange={(e) => set({ en: e.target.value })} />
        <span className="hint">{t('partEnHint')}</span>
      </label>
      <label className="review-field">
        <span>{t('partBg')}</span>
        <input className="assoc-text" lang="bg" maxLength={40} value={v.bg ?? ''} onChange={(e) => set({ bg: e.target.value || null })} />
      </label>
      <label className="review-field">
        <span>{t('partNote')}</span>
        <textarea className="assoc-text" rows={3} maxLength={400} value={v.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} />
        <span className="hint">{t('partNoteHint')}</span>
      </label>
      <label className="review-field">
        <span>{t('partNoteBg')}</span>
        <textarea className="assoc-text" lang="bg" rows={3} maxLength={400} value={v.noteBg ?? ''} onChange={(e) => set({ noteBg: e.target.value || null })} />
      </label>
    </>
  )
}
