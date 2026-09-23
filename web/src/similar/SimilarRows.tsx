/**
 * On the kanji page: what the character is easily confused with -- by
 * meaning, by shape, by reading -- and its other written forms. Reading and
 * meaning are kept apart because they are different mistakes: writing 速 for
 * はやい when 早 was meant is not the same as mixing up 側 and 横.
 *
 * The page places each block itself (after the words that use the character),
 * so this is a hook for the lists and one component per block.
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
  },
  {
    looksLike: 'Прилича на',
    readsLike: 'Същото четене',
    meansLike: 'Сходно значение',
    otherForms: 'Други форми',
  },
)

const LOOKS = 8
const READS = 4
const MEANS = 4

export type Similar = Omit<SimilarResponse, 'char'>

/**
 * The first few of each list for `char`, or null until they arrive (or if
 * they never do: the lists come from the server, and offline the page simply
 * goes without them). A common character's neighbours are kept to common
 * ones, the ones you will actually meet; a rare one's may be anything.
 */
export function useSimilar(char: string, common: boolean): Similar | null {
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
  const keep = (n: KanjiNode) => !common || isCommon(n)
  return {
    look: data.look.filter(keep).slice(0, LOOKS),
    read: data.read.filter(keep).slice(0, READS),
    mean: data.mean.filter(keep).slice(0, MEANS),
    variant: data.variant,
  }
}

function useTitle() {
  const lang = useLang()
  return (n: KanjiNode) => {
    const m = meaningsOf(n, lang).value.slice(0, 3).join(', ')
    return m ? `${n.char} - ${m}` : n.char
  }
}

interface Block {
  items: KanjiNode[]
  onKanji: (char: string) => void
}

export function LooksLike({ items, onKanji }: Block) {
  const t = S(useLang())
  const title = useTitle()
  if (!items.length) return null
  return (
    <div className="similar-rows">
      <h3>{t('looksLike')}</h3>
      <div className="similar-glyphs">
        {items.map((n) => (
          <button key={n.char} className="similar-glyph" onClick={() => onKanji(n.char)} title={title(n)}>
            {n.char}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Same reading or similar meaning: each a kanji, its meaning, and why it is listed. */
export function Related({
  kind,
  items,
  onKanji,
}: {
  kind: 'read' | 'mean'
  items: Similar['mean']
  onKanji: (char: string) => void
}) {
  const lang = useLang()
  const t = S(lang)
  const title = useTitle()
  if (!items.length) return null
  return (
    <div className="similar-rows">
      <h3>{t(kind === 'read' ? 'readsLike' : 'meansLike')}</h3>
      <ul>
        {items.map((n) => {
          const why = whyText(n.why, lang)
          return (
            <li key={n.char}>
              <button className="vocab-row similar-row" onClick={() => onKanji(n.char)} title={title(n)}>
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
    </div>
  )
}

export function OtherForms({ items, onKanji }: Block) {
  const t = S(useLang())
  const title = useTitle()
  if (!items.length) return null
  return (
    <p className="similar-forms">
      {t('otherForms')}{' '}
      {items.map((n) => (
        <button key={n.char} className="similar-glyph small" onClick={() => onKanji(n.char)} title={title(n)}>
          {n.char}
        </button>
      ))}
    </p>
  )
}
