/**
 * A Bulgarian card: the machine translation of one word (a gloss per sense,
 * beside the English) or one kanji (its meanings), to confirm or correct.
 * The answer is the list itself; the queue accepts it unchanged or saves the
 * edit, and what is saved shows on the site at once (server/bg_overlay.py).
 */
import type { ReactNode } from 'react'
import type { BookGloss, BookKeyword, ItemDetail, MeaningGroup, Sense } from '../api'
import { BookGlossPanel, BookKeywordPanel } from './BookEvidence'
import { strings, useLang } from '../i18n'
import { CATCH_ALL, KanjiFacts } from './editors'

const S = strings(
  {
    bulgarian: 'Bulgarian',
    machine: 'machine translation',
    meanings: 'Bulgarian meanings',
    meaningsHint: 'One meaning per field, short: what the kanji means, as the English says it.',
    add: 'add a meaning',
    remove: 'remove',
    hint: 'Check each Bulgarian gloss against the English beside it. Fix what is wrong or unnatural; leave what is right.',
    groups: 'Its meaning groups: give each its Bulgarian label',
    groupsHint: 'Short, natural Bulgarian for what the group stands for, and its note in Bulgarian. The meanings above can start from them.',
    noteBg: 'the note in Bulgarian',
    noNote: 'no English note',
    fromGroups: 'fill from the group labels below',
    inGroups: 'What its kanji bring here',
    noMeaning: 'brings no meaning to this word',
    notPlaced: 'not placed in a group',
    latin: 'Has Latin letters. Correct for a name or an abbreviation (NHK). In a Bulgarian word (граничa), search does not find it.',
  },
  {
    bulgarian: 'Български',
    machine: 'машинен превод',
    meanings: 'Значения на български',
    meaningsHint: 'По едно кратко значение в поле: какво значи канджито, както го казва английският.',
    add: 'добавете значение',
    remove: 'махнете',
    hint: 'Сверете всеки български превод с английския до него. Поправете грешното или неестественото; оставете вярното.',
    groups: 'Групите му значения: дайте на всяка български етикет',
    groupsHint: 'Кратко, естествено на български, какво обхваща групата, и бележката ѝ на български. Значенията по-горе могат да тръгнат от тях.',
    noteBg: 'бележката на български',
    noNote: 'няма английска бележка',
    fromGroups: 'попълнете от етикетите на групите по-долу',
    inGroups: 'Какво внасят канджитата му тук',
    noMeaning: 'не внася значение в тази дума',
    notPlaced: 'не е разпределена в група',
    latin: 'Има латински букви. Вярно е за име или съкращение (NHK). В българска дума (граничa) търсенето не я намира.',
  },
)

export function BgCard({
  detail,
  value,
  onChange,
  labels,
  onLabels,
  notes,
  onNotes,
}: {
  detail: ItemDetail
  value: string[]
  onChange: (v: string[]) => void
  /** A kanji card: its groups' Bulgarian labels, by group id. */
  labels: Record<string, string>
  onLabels: (l: Record<string, string>) => void
  /** And their Bulgarian notes, beside the English ones. */
  notes: Record<string, string>
  onNotes: (n: Record<string, string>) => void
}) {
  const lang = useLang()
  const t = S(lang)
  const c = detail.context
  const built = c.built ?? []
  // What Dani's print dictionaries give (pipeline/book_sources.py): a kanji's keyword, a word's glosses.
  const book = detail.evidence?.book

  if (detail.subject.startsWith('word:') && c.word) {
    const w = c.word
    return (
      <div className="bg-card">
        <p className="bg-head" lang="ja">
          {w.reading}
        </p>
        {c.groups && c.groups.length > 0 && (
          <div className="bg-groups">
            <span className="hint">{t('inGroups')}</span>
            <ul>
              {c.groups.map((g) => (
                <li key={g.char}>
                  <span className="bg-group-char" lang="ja">
                    {g.char}
                  </span>{' '}
                  {g.group === CATCH_ALL ? (
                    <span className="hint">{t('noMeaning')}</span>
                  ) : g.en ? (
                    <>
                      <b>{g.en}</b> {g.bg && <span lang="bg">· {g.bg}</span>}
                    </>
                  ) : (
                    <span className="hint">{t('notPlaced')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="hint">{t('hint')}</p>
        <BgSenses senses={w.senses} value={value} onChange={onChange} built={built} />
        {Array.isArray(book) && book.length > 0 && <BookGlossPanel views={book as BookGloss[]} value={value} onChange={onChange} />}
      </div>
    )
  }

  // a kanji
  return (
    <div className="bg-card">
      <dl className="queue-compare">
        <KanjiFacts context={c} />
        <dt>{t('machine')}</dt>
        <dd lang="bg">{built.join(', ')}</dd>
      </dl>
      <BgMeanings
        value={value}
        onChange={onChange}
        title={t('meanings')}
        name={t('meanings')}
        add={t('add')}
        tools={
          Object.values(labels).some((l) => l.trim()) && (
            <button
              type="button"
              className="clear"
              onClick={() => onChange(c.senses!.map((g) => (labels[g.id] ?? '').trim()).filter(Boolean).slice(0, 12))}
            >
              {t('fromGroups')}
            </button>
          )
        }
      />
      {book != null && <BookKeywordPanel view={book as BookKeyword} value={value} onChange={onChange} />}
      {c.senses && c.senses.length > 0 && (
        <BgLabels
          groups={c.senses}
          labels={labels}
          onLabels={onLabels}
          notes={notes}
          onNotes={onNotes}
          title={t('groups')}
          hint={t('groupsHint')}
          marks
        />
      )}
    </div>
  )
}

// The card's editors, which a page's Edit dialog (PageEdit.tsx) uses too.

/** A warning under Bulgarian with a Latin letter in it: only a warning, as NHK is right. */
function LatinWarn({ text }: { text: string }) {
  const t = S(useLang())
  return /[A-Za-z]/.test(text) ? <span className="queue-warn bg-latin">{t('latin')}</span> : null
}

/** A word's glosses, one per sense beside its English; with `built`, one that differs from the machine translation says what it was. */
export function BgSenses({
  senses,
  value,
  onChange,
  built,
}: {
  senses: Sense[]
  value: string[]
  onChange: (v: string[]) => void
  built?: string[]
}) {
  const t = S(useLang())
  return (
    <ol className="bg-senses">
      {senses.map((s, i) => {
        const changed = !!built && (value[i] ?? '') !== (built[i] ?? '')
        return (
          <li key={i} className="bg-sense" data-changed={changed || undefined}>
            <div className="bg-en">
              {s.pos.length > 0 && <span className="bg-pos">{s.pos.join(', ')}</span>}
              {s.gloss}
            </div>
            <input
              className="assoc-text bg-input"
              lang="bg"
              value={value[i] ?? ''}
              aria-label={`${t('bulgarian')} ${i + 1}`}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <LatinWarn text={value[i] ?? ''} />
            {changed && (
              <span className="bg-was hint">
                {t('machine')}: {built[i]}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** A kanji's Bulgarian meanings, a short field each; `tools` go beside the add button. */
export function BgMeanings({
  value,
  onChange,
  title,
  name,
  add,
  tools,
}: {
  value: string[]
  onChange: (v: string[]) => void
  title?: string
  /** What each field is, numbered for its label. */
  name: string
  /** The add button's words. */
  add: string
  tools?: ReactNode
}) {
  const t = S(useLang())
  const room = value.length < 12
  return (
    <div className="review-field">
      {title && <span>{title}</span>}
      <span className="hint">{t('meaningsHint')}</span>
      <div className="bg-meanings">
        {value.map((m, i) => (
          <span key={i} className="bg-meaning">
            <input
              className="assoc-text"
              lang="bg"
              value={m}
              maxLength={60}
              aria-label={`${name} ${i + 1}`}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button type="button" className="clear" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              {t('remove')}
            </button>
          </span>
        ))}
      </div>
      <LatinWarn text={value.join(' ')} />
      {(room || tools !== undefined) && (
        <span className="bg-meaning-tools">
          {room && (
            <button type="button" className="clear" onClick={() => onChange([...value, ''])}>
              + {add}
            </button>
          )}
          {tools}
        </span>
      )}
    </div>
  )
}

/** A kanji's groups, each with its Bulgarian label and note beside the English; `marks` outlines one that differs from the group's. */
export function BgLabels({
  groups,
  labels,
  onLabels,
  notes,
  onNotes,
  title,
  hint,
  marks = false,
}: {
  groups: MeaningGroup[]
  labels: Record<string, string>
  onLabels: (l: Record<string, string>) => void
  notes: Record<string, string>
  onNotes: (n: Record<string, string>) => void
  title: string
  hint?: string
  marks?: boolean
}) {
  const t = S(useLang())
  return (
    <div className="bg-groups">
      <span>{title}</span>
      {hint && <span className="hint">{hint}</span>}
      <ul className="bg-labels">
        {groups.map((g) => (
          <li key={g.id} data-changed={(marks && (labels[g.id] ?? '') !== (g.bg ?? '')) || undefined}>
            <span className="bg-label-en">
              <b>{g.en}</b>
            </span>
            <input
              className="assoc-text"
              lang="bg"
              maxLength={40}
              value={labels[g.id] ?? ''}
              aria-label={g.en}
              onChange={(e) => onLabels({ ...labels, [g.id]: e.target.value })}
            />
            <span className="bg-label-note hint">{g.note ?? t('noNote')}</span>
            <input
              className="assoc-text bg-note-input"
              lang="bg"
              maxLength={200}
              value={notes[g.id] ?? ''}
              placeholder={t('noteBg')}
              aria-label={`${g.en}: ${t('noteBg')}`}
              data-changed={(marks && (notes[g.id] ?? '') !== (g.noteBg ?? '')) || undefined}
              onChange={(e) => onNotes({ ...notes, [g.id]: e.target.value })}
            />
            <LatinWarn text={`${labels[g.id] ?? ''} ${notes[g.id] ?? ''}`} />
          </li>
        ))}
      </ul>
    </div>
  )
}
