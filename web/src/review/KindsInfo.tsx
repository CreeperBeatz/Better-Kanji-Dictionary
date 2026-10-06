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

const S = strings(
  {
    info: 'What each choice means, and what it changes',
    hide: 'Hide the explanation',
    kind: 'Choice',
    means: 'Means',
    changes: 'What it changes on the site',
    formNever: 'No form link ever changes a kanji’s parts, the graph’s lines or the study order. Read X as the first character of the card, Y as the second.',
    partNever: 'A part’s meaning never changes its parts, the graph or the study order. It is what the part’s page says it is.',
    k_positional: 'the same part in another position',
    k_old: 'its old form',
    k_form_of: 'is a form of (lends its meaning)',
    k_looks_like: 'looks like (a mnemonic only)',
    k_kin: 'the same thing, drawn differently',
    k_none: 'no relation',
    m_positional: 'X and Y are one part, written differently where it sits: 水 氵, 人 亻, 糸 糹.',
    c_positional: 'Both pages list the other under “In other positions”. In the graph, focusing either one also shows the kanji built from the other (糸 shows 細) — unless the link has a note, which keeps them apart (月 and 肉). Describing a kanji by its parts finds either form by the other’s name.',
    m_old: 'Y is X’s pre-1946 shape: 会 → 會, 青 → 靑.',
    c_old: 'X’s page shows Y as its “Old form”; Y’s page shows X as “Today’s form”. Nothing else: the old shape is evidence for the story, not a part.',
    m_form_of: 'X is Y squashed or moved into a position, with history behind it (the note must say what). One per part; accepting one replaces any other.',
    c_form_of: 'X’s page lists Y under “A form of”, and when X has no meaning of its own, its heading says “a form of Y” with Y’s meanings, everywhere X appears. Y’s page lists X among its squashed forms. Describing a kanji by Y’s name finds X.',
    m_looks_like: 'X looks like Y and learners read it so, but Y is not where it comes from: 龶 looks like 王.',
    c_looks_like: 'X’s page shows Y under “Looks like”, marked as a mnemonic, not its origin; Y’s page lists X under “Mistaken for it”. Describing a kanji by Y’s name finds X. No meaning is lent.',
    m_kin: 'X and Y are the same thing drawn two ways, but neither is inside the other’s kanji: 隹 鳥 (birds).',
    c_kin: 'Both pages show the other under “Related”. Nothing else: the graph never merges them (鳴 does not show under 隹).',
    m_none: 'Nothing worth showing a learner: a Chinese simplified form, a rare variant.',
    c_none: 'Removes every link between X and Y, built or reviewed, both ways. If Unihan pairs them, they still show under “Other variants”.',
    p_meaning: 'its own meaning',
    p_shape: 'a shape with no meaning',
    pm_meaning: 'A real character that brings this meaning to the kanji it is in: 劦 (joint effort) in 協 and 脅.',
    pc_meaning: 'The part’s page heading shows it as the meaning, instead of “no recorded meaning”, and before any meaning lent by a form of. The notes’ kanji brackets read it as the part’s meaning.',
    pm_shape: 'Several unrelated old parts merged into this one shape, so no one meaning is true in all its kanji: 丷 is 八 in 半, grains in 米, hair in 首. The label is a name, not a meaning; the note says what it is in which kanji.',
    pc_shape: 'The heading shows “a shape: <name>”, says it has no meaning of its own, and shows the note. It wins over a “form of” link, which then lends nothing: reject a form of that is only true in a few kanji.',
  },
  {
    info: 'Какво значи всеки избор и какво променя',
    hide: 'Скрийте обяснението',
    kind: 'Избор',
    means: 'Значи',
    changes: 'Какво променя в сайта',
    formNever: 'Връзка между форми никога не променя частите на канджи, линиите в графа или реда на учене. Четете X като първия знак на картата, а Y като втория.',
    partNever: 'Значението на част никога не променя частите ѝ, графа или реда на учене. То е това, което страницата на частта казва, че е тя.',
    k_positional: 'същата част в друга позиция',
    k_old: 'старата му форма',
    k_form_of: 'е форма на (заема значението му)',
    k_looks_like: 'прилича на (само мнемоника)',
    k_kin: 'същото нещо, нарисувано различно',
    k_none: 'няма връзка',
    m_positional: 'X и Y са една част, написана различно според мястото си: 水 氵, 人 亻, 糸 糹.',
    c_positional: 'Двете страници показват другата под „В други позиции“. В графа фокусът върху едната показва и канджитата, построени от другата (糸 показва 細) — освен ако връзката има бележка; тогава остават отделно (月 и 肉). Описание на канджи по частите му намира всяка от двете форми по името на другата.',
    m_old: 'Y е формата на X отпреди 1946 г.: 会 → 會, 青 → 靑.',
    c_old: 'Страницата на X показва Y като „Стара форма“, а страницата на Y показва X като „Днешна форма“. Нищо друго: старата форма е довод за историята, не част.',
    m_form_of: 'X е Y, сбит или преместен на някое място, с история зад това (бележката трябва да каже каква). По една на част; приемането на нова заменя предишната.',
    c_form_of: 'Страницата на X показва Y под „Форма на“, а когато X няма свое значение, заглавието ѝ казва „форма на Y“ със значенията на Y, навсякъде, където се появи X. Страницата на Y показва X сред сбитите си форми. Описание на канджи с името на Y намира X.',
    m_looks_like: 'X прилича на Y и учащите го четат така, но не идва от Y: 龶 прилича на 王.',
    c_looks_like: 'Страницата на X показва Y под „Прилича на“, отбелязано като мнемоника, а не произход; страницата на Y показва X под „Бъркат го с него“. Описание на канджи с името на Y намира X. Значение не се заема.',
    m_kin: 'X и Y са едно и също нещо, нарисувано по два начина, но никое не е в канджитата на другото: 隹 鳥 (птици).',
    c_kin: 'Двете страници показват другата под „Сродни“. Нищо друго: графът никога не ги слива (鳴 не се показва под 隹).',
    m_none: 'Нищо, което си струва да се покаже на учащия: китайска опростена форма, рядък вариант.',
    c_none: 'Премахва всяка връзка между X и Y, вградена или прегледана, в двете посоки. Ако Unihan ги свързва, те пак се показват под „Други варианти“.',
    p_meaning: 'свое значение',
    p_shape: 'форма без значение',
    pm_meaning: 'Истински знак, който внася това значение в канджитата, в които е: 劦 (общо усилие) в 協 и 脅.',
    pc_meaning: 'Заглавието на страницата на частта го показва като значение вместо „няма записано значение“ и преди значение, заето чрез „форма на“. Скобите с канджи в бележките го четат като значение на частта.',
    pm_shape: 'Няколко несвързани стари части са се слели в тази една форма, затова нито едно значение не е вярно във всичките ѝ канджи: 丷 е 八 в 半, зърна в 米, коса в 首. Етикетът е име, не значение; бележката казва какво е тя в кое канджи.',
    pc_shape: 'Заглавието показва „форма: <име>“, казва, че няма свое значение, и показва бележката. Тя има предимство пред връзка „форма на“, която тогава не заема нищо: отхвърлете „форма на“, вярна само в няколко канджи.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
export const FORM_KINDS: FormKind[] = ['positional', 'old', 'form_of', 'looks_like', 'kin', 'none']
export const PART_KINDS: PartKind[] = ['meaning', 'shape']

/** A form link's kind, or a part's, as the editors name it. */
export function useKindLabel(): (kind: FormKind | PartKind) => string {
  const t = S(useLang())
  return (kind) => t((kind === 'meaning' || kind === 'shape' ? `p_${kind}` : `k_${kind}`) as Key)
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
