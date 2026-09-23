/**
 * On the kanji page: what the character is easily confused with -- by shape,
 * by reading, by meaning -- and its other written forms. Reading and meaning
 * are kept apart because they are different mistakes: writing 速 for はやい
 * when 早 was meant is not the same as mixing up 側 and 横. The Similar view
 * shows the same lists at length; these are the first few of each.
 */

import { useEffect, useState } from 'react'
import { api, type KanjiNode, type SimilarResponse } from '../api'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { isCommon, whyText } from './why'

const S = strings(
  {
    looksLike: 'Looks like',
    readsLike: 'Same reading',
    meansLike: 'Similar meaning',
    otherForms: 'Other forms',
    showAll: 'Similar',
    showAllTitle: 'Everything that looks like {char}, shares a reading with it or means much the same, around it',
  },
  {
    looksLike: 'Прилича на',
    readsLike: 'Същото четене',
    meansLike: 'Сходно значение',
    otherForms: 'Други форми',
    showAll: 'Подобни',
    showAllTitle: 'Всичко, което прилича на {char}, се чете като него или означава почти същото, около него',
  },
)

const LOOKS = 8
const READS = 4
const MEANS = 4

interface Props {
  char: string
  /** Whether the character itself is common; see isCommon. */
  common: boolean
  onKanji: (char: string) => void
  /** Opens the Similar view; left out when it is already on screen. */
  onShowAll?: () => void
}

export function SimilarRows({ char, common, onKanji, onShowAll }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState<SimilarResponse | null>(null)

  useEffect(() => {
    let stale = false
    api.similar(char).then(
      (d) => !stale && setData(d),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [char])

  if (!data || data.char !== char) return null

  // A common character's neighbours are kept to common ones, the ones you
  // will actually meet; a rare one's may be anything.
  const keep = (n: KanjiNode) => !common || isCommon(n)
  const looks = data.look.filter(keep).slice(0, LOOKS)
  const reads = data.read.filter(keep).slice(0, READS)
  const means = data.mean.filter(keep).slice(0, MEANS)
  const variants = data.variant

  if (!looks.length && !reads.length && !means.length && !variants.length) return null

  const title = (n: KanjiNode) => {
    const m = meaningsOf(n, lang).value.slice(0, 3).join(', ')
    return m ? `${n.char} — ${m}` : n.char
  }

  return (
    <div className="similar-rows">
      {looks.length > 0 && (
        <>
          <h3>
            {t('looksLike')}
            {onShowAll && (
              <button className="similar-all" onClick={onShowAll} title={t('showAllTitle', { char })}>
                {t('showAll')} →
              </button>
            )}
          </h3>
          <div className="similar-glyphs">
            {looks.map((n) => (
              <button key={n.char} className="similar-glyph" onClick={() => onKanji(n.char)} title={title(n)}>
                {n.char}
              </button>
            ))}
          </div>
        </>
      )}

      <Related title={t('readsLike')} items={reads} onKanji={onKanji} label={title} />
      <Related title={t('meansLike')} items={means} onKanji={onKanji} label={title} />

      {variants.length > 0 && (
        <p className="similar-forms">
          {t('otherForms')}{' '}
          {variants.map((n) => (
            <button key={n.char} className="similar-glyph small" onClick={() => onKanji(n.char)} title={title(n)}>
              {n.char}
            </button>
          ))}
        </p>
      )}
    </div>
  )
}

/** A heading and its rows, each a kanji, its meaning, and why it is listed. */
function Related({
  title,
  items,
  onKanji,
  label,
}: {
  title: string
  items: SimilarResponse['mean']
  onKanji: (char: string) => void
  label: (n: KanjiNode) => string
}) {
  const lang = useLang()
  if (!items.length) return null
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((n) => {
          const why = whyText(n.why, lang)
          return (
            <li key={n.char}>
              <button className="vocab-row similar-row" onClick={() => onKanji(n.char)} title={label(n)}>
                <span className="vocab-word">{n.char}</span>
                <span className="vocab-gloss">{meaningsOf(n, lang).value.slice(0, 2).join(', ')}</span>
                {why && (
                  <span className="similar-why" lang={n.why && !('gloss' in n.why) ? 'ja' : undefined}>
                    {why}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
