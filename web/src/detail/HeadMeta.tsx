/**
 * How much a character or word is worth learning, down the right of the top
 * of its page as down a search result: common or not at the top; newspaper
 * rank and JLPT level, in its colour, at the bottom.
 */

import type { KanjiNode, Word } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    common: 'common',
    uncommon: 'uncommon',
    commonWordTitle: 'JMdict marks this as a common word',
    joyoTitle: 'On the jōyō list, the kanji taught for everyday use',
    notJoyoTitle: 'Not on the jōyō list, the kanji taught for everyday use',
    news: 'top {n}',
    kanjiNewsTitle: 'Newspaper frequency: number {n} of the 2,500 most used kanji',
    wordNewsTitle: 'Newspaper frequency: among the {n} most frequent words',
    jlpt: 'JLPT N{n}',
  },
  {
    common: 'честа',
    uncommon: 'рядка',
    commonWordTitle: 'JMdict отбелязва думата като честа',
    joyoTitle: 'В списъка джойо, йероглифите за всекидневна употреба',
    notJoyoTitle: 'Не е в списъка джойо с йероглифи за всекидневна употреба',
    news: 'топ {n}',
    kanjiNewsTitle: 'Честота във вестниците: № {n} от 2500-те най-използвани йероглифа',
    wordNewsTitle: 'Честота във вестниците: сред {n}-те най-чести думи',
    jlpt: 'JLPT N{n}',
  },
)

interface Meta {
  common: boolean
  commonTitle: string
  news: string | null
  newsTitle: string
  jlpt: number | null
}

function HeadMeta({ m }: { m: Meta }) {
  const t = S(useLang())
  return (
    <div className="head-meta">
      <span className="word-common" data-common={m.common || undefined} title={m.commonTitle}>
        {m.common ? t('common') : t('uncommon')}
      </span>
      {(m.news || m.jlpt) && (
        <span className="word-meta">
          {m.news && (
            <span className="word-news" title={m.newsTitle}>
              {t('news', { n: m.news })}
            </span>
          )}
          {m.jlpt && (
            <span className="word-jlpt" data-level={m.jlpt} title={t('jlpt', { n: m.jlpt })}>
              N{m.jlpt}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

/** A kanji is common when it is jōyō; its newspaper rank is KANJIDIC's, 1 to 2,500. */
export function KanjiMeta({ node: n }: { node: KanjiNode }) {
  const t = S(useLang())
  return (
    <HeadMeta
      m={{
        common: n.joyo,
        commonTitle: t(n.joyo ? 'joyoTitle' : 'notJoyoTitle'),
        news: n.freq != null ? String(n.freq) : null,
        newsTitle: n.freq != null ? t('kanjiNewsTitle', { n: n.freq }) : '',
        jlpt: n.jlpt,
      }}
    />
  )
}

/** JMdict's nf buckets are 500 words wide: nf12 is the top 6,000, "top 6k". */
export function WordMeta({ word: w }: { word: Word }) {
  const lang = useLang()
  const t = S(lang)
  const n = w.nf ? w.nf * 500 : 0
  return (
    <HeadMeta
      m={{
        common: w.common,
        commonTitle: t('commonWordTitle'),
        news: n ? (n < 1000 ? String(n) : `${n / 1000}k`) : null,
        newsTitle: n ? t('wordNewsTitle', { n: n.toLocaleString(lang) }) : '',
        jlpt: w.jlpt,
      }}
    />
  )
}
