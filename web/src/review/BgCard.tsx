/**
 * A Bulgarian card: the machine translation of one word (a gloss per sense,
 * beside the English) or one kanji (its meanings), to confirm or correct.
 * The answer is the list itself; the queue accepts it unchanged or saves the
 * edit, and what is saved shows on the site at once (server/bg_overlay.py).
 */
import type { ItemDetail } from '../api'
import { strings, useLang } from '../i18n'
import { CATCH_ALL } from './editors'

const S = strings(
  {
    english: 'English',
    bulgarian: 'Bulgarian',
    machine: 'machine translation',
    changed: 'changed',
    kanjidic: 'KANJIDIC',
    curated: 'Kanji Alive',
    readings: 'Readings',
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
  },
  {
    english: 'Английски',
    bulgarian: 'Български',
    machine: 'машинен превод',
    changed: 'променено',
    kanjidic: 'KANJIDIC',
    curated: 'Kanji Alive',
    readings: 'Четения',
    meanings: 'Значения на български',
    meaningsHint: 'По едно кратко значение в поле: какво значи кандзито, както го казва английският.',
    add: 'добавете значение',
    remove: 'махнете',
    hint: 'Сверете всеки български превод с английския до него. Поправете грешното или неестественото; оставете вярното.',
    groups: 'Групите му значения: дайте на всяка български етикет',
    groupsHint: 'Кратко, естествено на български, какво обхваща групата, и бележката ѝ на български. Значенията по-горе могат да тръгнат от тях.',
    noteBg: 'бележката на български',
    noNote: 'няма английска бележка',
    fromGroups: 'попълнете от етикетите на групите по-долу',
    inGroups: 'Какво внасят кандзитата му тук',
    noMeaning: 'не внася значение в тази дума',
    notPlaced: 'не е разпределена в група',
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
  const set = (i: number, v: string) => onChange(value.map((x, j) => (j === i ? v : x)))

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
        <ol className="bg-senses">
          {w.senses.map((s, i) => (
            <li key={i} className="bg-sense" data-changed={(value[i] ?? '') !== (built[i] ?? '') || undefined}>
              <div className="bg-en">
                {s.pos.length > 0 && <span className="bg-pos">{s.pos.join(', ')}</span>}
                {s.gloss}
              </div>
              <input
                className="assoc-text bg-input"
                lang="bg"
                value={value[i] ?? ''}
                aria-label={`${t('bulgarian')} ${i + 1}`}
                onChange={(e) => set(i, e.target.value)}
              />
              {(value[i] ?? '') !== (built[i] ?? '') && (
                <span className="bg-was hint">
                  {t('machine')}: {built[i]}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  // a kanji
  return (
    <div className="bg-card">
      <dl className="queue-compare">
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
        {(c.on?.length || c.kun?.length) && (
          <>
            <dt>{t('readings')}</dt>
            <dd lang="ja">{[...(c.on ?? []), ...(c.kun ?? [])].join('、')}</dd>
          </>
        )}
        <dt>{t('machine')}</dt>
        <dd lang="bg">{built.join(', ')}</dd>
      </dl>
      <div className="review-field">
        <span>{t('meanings')}</span>
        <span className="hint">{t('meaningsHint')}</span>
        <div className="bg-meanings">
          {value.map((m, i) => (
            <span key={i} className="bg-meaning">
              <input className="assoc-text" lang="bg" value={m} maxLength={60} aria-label={`${t('meanings')} ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
              <button className="clear" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                {t('remove')}
              </button>
            </span>
          ))}
        </div>
        <span className="bg-meaning-tools">
          {value.length < 12 && (
            <button className="clear" onClick={() => onChange([...value, ''])}>
              + {t('add')}
            </button>
          )}
            {Object.values(labels).some((l) => l.trim()) && (
              <button
                className="clear"
                onClick={() => onChange(c.senses!.map((g) => (labels[g.id] ?? '').trim()).filter(Boolean).slice(0, 12))}
              >
                {t('fromGroups')}
              </button>
            )}
        </span>
      </div>
      {c.senses && c.senses.length > 0 && (
        <div className="bg-groups">
          <span>{t('groups')}</span>
          <span className="hint">{t('groupsHint')}</span>
          <ul className="bg-labels">
            {c.senses.map((g) => (
              <li key={g.id} data-changed={(labels[g.id] ?? '') !== (g.bg ?? '') || undefined}>
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
                  data-changed={(notes[g.id] ?? '') !== (g.noteBg ?? '') || undefined}
                  onChange={(e) => onNotes({ ...notes, [g.id]: e.target.value })}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
