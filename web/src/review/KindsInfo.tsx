/**
 * What each choice on a form link or a part's meaning means, and what
 * accepting it changes on the site: the kanji page, the graph, search by
 * description, the notes' kanji brackets. One table, shown behind an (i) in
 * the queue and the page's Edit dialog, and open in the handbook.
 *
 * Keep it true to the code: server/forms.py (forms_of, shape_groups,
 * graph_families) and server/kanjify.py read the links.
 */
import { useState } from 'react'
import type { FormKind, PartKind } from '../api'
import { strings, useLang } from '../i18n'

// Written in simple technical English (the style of ASD-STE100): short sentences,
// one fact each, active voice, the same word for the same thing, an example after each rule.
const S = strings(
  {
    info: 'What each choice means and what it changes',
    hide: 'Hide the explanation',
    kind: 'Choice',
    means: 'Meaning',
    changes: 'Result on the site',
    test: 'Test: does X stand alone? If X never stands alone, X is a form of Y. Example: 氵 is always 水 on the left side. If X and Y both stand alone and mean the same thing, select “a separate character for the same thing”. Example: 隹 and 鳥.',
    built: 'A character made of two or more Y is not a form of Y. Y is its part. Example: 林 is two 木. Select “no relation”.',
    formNever: 'A link does not change the parts. A link does not change the study order. Use ⇄ to turn a one-way link around.',
    x_positional: '{x} and {y} are one character in different positions',
    x_old: '{y} is the old form of {x}',
    x_form_of: '{x} is a form of {y} and gets its meaning',
    x_looks_like: '{x} only looks like {y}',
    x_kin: '{x} and {y} are separate characters for the same thing',
    x_none: 'no relation between {x} and {y}',
    partNever: 'This does not change the parts. This does not change the study order.',
    k_positional: 'how it is written in another position',
    k_old: 'its old form',
    k_form_of: 'is a form of (gets its meaning)',
    k_looks_like: 'looks like (memory aid only)',
    k_kin: 'a separate character for the same thing',
    k_none: 'no relation',
    m_positional: 'X and Y are one character. The position changes its shape. Example: 水 becomes 氵 on the left side. For a new link, select “is a form of”.',
    c_positional: 'Each page shows the other one. On the graph, X also shows the kanji that contain Y. A note on the link stops this. Example: 月 and 肉.',
    m_old: 'Y is the shape that X had before 1946. Example: 會 is the old form of 会.',
    c_old: 'The page of X shows Y as its old form. Nothing else changes.',
    m_form_of: 'X is Y with a different shape for its position. Example: 龰 is 止 at the bottom. Write the evidence in the note: the old form or a reference. A part has only one “form of”.',
    c_form_of: 'X has no parts of its own: Y is its root. If X has no meaning, the page of X shows the meaning of Y. The simple graph draws Y where X is written, and Y shows the kanji that contain X. A search for the meaning of Y finds X.',
    m_looks_like: 'X looks like Y. X does not come from Y. The link only helps the learner remember. Example: 龶 looks like 王.',
    c_looks_like: 'The page of X says that X looks like Y. It marks this as a memory aid. X does not get the meaning of Y.',
    m_kin: 'X and Y are two characters. Each one has its own reading. They mean the same thing. Each one can be in the same position in a kanji. Example: 隹 in 雅, 鳥 in 鳴.',
    c_kin: 'Each page shows the other one as related. Nothing else changes.',
    m_none: 'The link does not help a learner. Examples: a Chinese simplified form, a rare variant, a character made of the other one (林 and 木).',
    c_none: 'All links between X and Y go away.',
    p_meaning: 'its own meaning',
    p_shape: 'a shape with no meaning',
    pm_meaning: 'The part is a real character. It gives its meaning to the kanji that contain it. Example: 劦 (joint effort) in 協.',
    pc_meaning: 'The page of the part shows this meaning.',
    pm_shape: 'Different old parts became the same shape. No one meaning is correct for all its kanji. Example: 丷 is grains in 米 and hair in 首. Give the shape a name, not a meaning. Example: “two drops”.',
    pc_shape: 'The page of the part shows “a shape: two drops” and “no meaning of its own”. This has priority over a “form of” link.',
  },
  {
    info: 'Какво значи всеки избор и какво променя',
    hide: 'Скрийте обяснението',
    kind: 'Избор',
    means: 'Значение',
    changes: 'Резултат в сайта',
    test: 'Проверка: стои ли X самостоятелно? Ако X никога не стои сам, X е форма на Y. Пример: 氵 винаги е 水 отляво. Ако X и Y стоят самостоятелно и значат едно и също, изберете „отделен знак за същото нещо“. Пример: 隹 и 鳥.',
    built: 'Знак от два или повече Y не е форма на Y. Y е негова част. Пример: 林 е два 木. Изберете „няма връзка“.',
    formNever: 'Връзката не променя частите. Връзката не променя реда на учене. Използвайте ⇄, за да обърнете еднопосочна връзка.',
    x_positional: '{x} и {y} са един знак в различни позиции',
    x_old: '{y} е старата форма на {x}',
    x_form_of: '{x} е форма на {y} и получава значението му',
    x_looks_like: '{x} само прилича на {y}',
    x_kin: '{x} и {y} са отделни знаци за едно и също нещо',
    x_none: 'няма връзка между {x} и {y}',
    partNever: 'Това не променя частите. Това не променя реда на учене.',
    k_positional: 'как се пише в друга позиция',
    k_old: 'старата му форма',
    k_form_of: 'е форма на (получава значението му)',
    k_looks_like: 'прилича на (само за запомняне)',
    k_kin: 'отделен знак за същото нещо',
    k_none: 'няма връзка',
    m_positional: 'X и Y са един знак. Позицията променя формата му. Пример: 水 става 氵 отляво. За нова връзка изберете „е форма на“.',
    c_positional: 'Всяка страница показва другата. В графа X показва и канджитата, които съдържат Y. Бележка към връзката спира това. Пример: 月 и 肉.',
    m_old: 'Y е формата на X преди 1946 г. Пример: 會 е старата форма на 会.',
    c_old: 'Страницата на X показва Y като стара форма. Нищо друго не се променя.',
    m_form_of: 'X е Y с различна форма за позицията си. Пример: 龰 е 止 отдолу. Напишете доказателството в бележката: старата форма или справочник. Една част има само една „форма на“.',
    c_form_of: 'X няма свои части: Y е коренът му. Ако X няма значение, страницата на X показва значението на Y. Опростеният граф рисува Y там, където е написано X, а Y показва и канджитата, които съдържат X. Търсене по значението на Y намира X.',
    m_looks_like: 'X прилича на Y. X не идва от Y. Връзката само помага за запомнянето. Пример: 龶 прилича на 王.',
    c_looks_like: 'Страницата на X казва, че X прилича на Y. Отбелязва го като помощ за запомняне. X не получава значението на Y.',
    m_kin: 'X и Y са два знака. Всеки има свое четене. Значат едно и също. Всеки може да е на същото място в канджи. Пример: 隹 в 雅, 鳥 в 鳴.',
    c_kin: 'Всяка страница показва другата като сродна. Нищо друго не се променя.',
    m_none: 'Връзката не помага на учащия. Примери: китайска опростена форма, рядък вариант, знак, съставен от другия (林 и 木).',
    c_none: 'Всички връзки между X и Y изчезват.',
    p_meaning: 'свое значение',
    p_shape: 'форма без значение',
    pm_meaning: 'Частта е истински знак. Тя дава значението си на канджитата, които я съдържат. Пример: 劦 (общо усилие) в 協.',
    pc_meaning: 'Страницата на частта показва това значение.',
    pm_shape: 'Различни стари части са станали една и съща форма. Нито едно значение не е вярно за всичките ѝ канджи. Пример: 丷 е зърна в 米 и коса в 首. Дайте на формата име, не значение. Пример: „две капки“.',
    pc_shape: 'Страницата на частта показва „форма: две капки“ и „няма свое значение“. Това има предимство пред връзка „форма на“.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
export const FORM_KINDS: FormKind[] = ['form_of', 'old', 'looks_like', 'kin', 'none', 'positional']
/** The kinds that read one way, and so can be turned round (server/review.py ONE_WAY). */
export const ONE_WAY: FormKind[] = ['old', 'form_of', 'looks_like']
export const PART_KINDS: PartKind[] = ['meaning', 'shape']

/** A form link's kind, or a part's, as the editors name it. */
export function useKindLabel(): (kind: FormKind | PartKind) => string {
  const t = S(useLang())
  return (kind) => t((kind === 'meaning' || kind === 'shape' ? `p_${kind}` : `k_${kind}`) as Key)
}

/**
 * A link as a sentence with its two characters, `subject` X|Y read as the
 * server reads it: 宝|寳 old is "寳 is the old form of 宝"; reversed, the other way.
 */
export function useLinkSentence(): (kind: FormKind, subject: string, reverse?: boolean) => string {
  const t = S(useLang())
  return (kind, subject, reverse) => {
    const [a, b] = subject.split('|')
    const [x, y] = reverse && ONE_WAY.includes(kind) ? [b, a] : [a, b]
    return t(`x_${kind}` as Key, { x: x || '?', y: y || '?' })
  }
}

/** The table itself: each choice, what it means, what it changes. */
export function KindsTable({ of }: { of: 'form' | 'part' }) {
  const t = S(useLang())
  const label = useKindLabel()
  const rows: [FormKind | PartKind, Key, Key][] =
    of === 'form'
      ? FORM_KINDS.map((k) => [k, `m_${k}` as Key, `c_${k}` as Key])
      : PART_KINDS.map((k) => [k, `pm_${k}` as Key, `pc_${k}` as Key])
  return (
    <div className="kinds-info">
      <table>
        <thead>
          <tr>
            <th>{t('kind')}</th>
            <th>{t('means')}</th>
            <th>{t('changes')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, means, changes]) => (
            <tr key={k}>
              <th scope="row">{label(k)}</th>
              <td>{t(means)}</td>
              <td>{t(changes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {of === 'form' && (
        <>
          <p>{t('test')}</p>
          <p>{t('built')}</p>
        </>
      )}
      <p className="hint">{t(of === 'form' ? 'formNever' : 'partNever')}</p>
    </div>
  )
}

/** An (i) beside a field's label; the table opens under the label when pressed. */
export function KindsInfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = S(useLang())
  return (
    <button
      type="button"
      className="page-edit-info"
      aria-expanded={open}
      aria-label={open ? t('hide') : t('info')}
      title={open ? t('hide') : t('info')}
      onClick={(e) => {
        // Inside a <label>: the press must not reach the field.
        e.preventDefault()
        onToggle()
      }}
    >
      i
    </button>
  )
}

/** Its state, for a field that puts the button in its label and the table below it. */
export function useKindsInfo(): [boolean, () => void] {
  const [open, setOpen] = useState(false)
  return [open, () => setOpen((o) => !o)]
}
