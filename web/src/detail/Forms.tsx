/**
 * The forms of a character: its old form (靑 for 青), its forms in other
 * positions (人 亻), what a bound part is a form of (龶 is a squashed 生), and
 * the lookalikes learners use as mnemonics (龶 looks like 王), labelled as
 * such -- a mnemonic is never presented as where a part comes from.
 *
 * None of this is containment: the modern shape decides the graph and the
 * order, the old shape tells the story (TASK-forms-review.md).
 */
import { useEffect, useState } from 'react'
import { api, onDataChanged, type FormItem, type FormsResponse } from '../api'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'

const S = strings(
  {
    title: 'Forms',
    old: 'Old form',
    new: 'Today’s form',
    positional: 'In other positions',
    formOf: 'A form of',
    forms: 'Its squashed or moved forms',
    looksLike: 'Looks like',
    looksLikeHint: 'a mnemonic, not its origin',
    lookalikeOf: 'Mistaken for it',
    variants: 'Other variants',
    notAPage: '{char} has no page of its own',
    noForms: 'No forms recorded yet.',
  },
  {
    title: 'Форми',
    old: 'Стара форма',
    new: 'Днешна форма',
    positional: 'В други позиции',
    formOf: 'Форма на',
    forms: 'Сбитите или преместени форми',
    looksLike: 'Прилича на',
    looksLikeHint: 'мнемоника, а не произход',
    lookalikeOf: 'Бъркат го с него',
    variants: 'Други варианти',
    notAPage: '{char} няма собствена страница',
    noForms: 'Още няма записани форми.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
const ROWS: [keyof Omit<FormsResponse, 'char' | 'meaning'>, Key][] = [
  ['old', 'old'],
  ['new', 'new'],
  ['formOf', 'formOf'],
  ['positional', 'positional'],
  ['forms', 'forms'],
  ['looksLike', 'looksLike'],
  ['lookalikeOf', 'lookalikeOf'],
  ['variants', 'variants'],
]

/** The forms of `char`, or null until they arrive (offline they never do; the page goes without). */
export function useForms(char: string, wanted = true): FormsResponse | null {
  const [data, setData] = useState<FormsResponse | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), [])
  useEffect(() => {
    if (!wanted) return
    let stale = false
    api.forms(char).then(
      (d) => !stale && setData(d),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [char, wanted, version])
  return data?.char === char ? data : null
}

export function Forms({ data, onKanji }: { data: FormsResponse; onKanji: (char: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const rows = ROWS.filter(([k]) => data[k].length > 0)
  // With nothing to show the block is left out; a missing link (龰 is a form
  // of 止) is added from the page's Edit / Suggest changes.
  if (!rows.length) return null

  const glyph = (i: FormItem) => {
    const meaning = meaningsOf(i, lang).value[0]
    return i.known ? (
      <button key={i.char} className="similar-glyph small" onClick={() => onKanji(i.char)} title={meaning ?? i.char} lang="ja">
        {i.char}
      </button>
    ) : (
      <span key={i.char} className="similar-glyph small forms-unknown" title={t('notAPage', { char: i.char })} lang="ja">
        {i.char}
      </span>
    )
  }

  return (
    <div className="forms">
      <h3>
        {t('title')}
      </h3>
      <dl>
        {rows.map(([k, label]) => (
          <div key={k} className="forms-row" data-kind={k}>
            <dt>
              {t(label)}
              {k === 'looksLike' && <span className="forms-hint"> ({t('looksLikeHint')})</span>}
            </dt>
            <dd>
              {data[k].map((i) => (
                <span key={i.char} className="forms-item">
                  {glyph(i)}
                  {(k === 'formOf' || k === 'looksLike') && meaningsOf(i, lang).value[0] && (
                    <span className="forms-meaning">{meaningsOf(i, lang).value[0]}</span>
                  )}
                  {i.note && <span className="forms-note">{i.note}</span>}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** The forms recorded now, read-only and compact, so a change in a page's Edit dialog starts from what is there. */
export function FormsSummary({ forms }: { forms: FormsResponse | null }) {
  const t = S(useLang())
  const rows = forms ? ROWS.filter(([k]) => forms[k].length > 0) : []
  if (!rows.length) return <p className="hint">{t('noForms')}</p>
  return (
    <dl className="page-edit-forms">
      {rows.map(([k, label]) => (
        <div key={k}>
          <dt>{t(label)}</dt>
          <dd lang="ja">
            {forms![k].map((i) => (
              <span key={i.char}>
                {i.char}
                {i.note && <span className="hint"> ({i.note})</span>}{' '}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
