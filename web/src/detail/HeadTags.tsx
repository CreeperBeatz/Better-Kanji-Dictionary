/**
 * How much a character or word is worth learning, at the top of its page:
 * its JLPT level, whether it is common, and how high it ranks in newspapers.
 */

import type { KanjiNode, Word } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    jlptTitle: 'JLPT level',
    joyo: 'jōyō',
    joyoTitle: 'On the jōyō list, the kanji taught for everyday use',
    notJoyo: 'not jōyō',
    notJoyoTitle: 'Outside the jōyō list of kanji for everyday use',
    bound: 'bound form',
    boundTitle: 'A form found inside other characters, not a character of its own',
    kanjiRank: '#{n} in newspapers',
    kanjiRankTitle: 'Its place among the 2,500 kanji most used in newspapers',
    common: 'common',
    commonTitle: 'JMdict marks this as a common word',
    wordRank: 'top {n} in newspapers',
    wordRankTitle: 'Among the {n} most frequent words in newspapers',
  },
  {
    jlptTitle: 'Ниво по JLPT',
    joyo: 'джойо',
    joyoTitle: 'В списъка джойо, йероглифите за всекидневна употреба',
    notJoyo: 'не е джойо',
    notJoyoTitle: 'Извън списъка джойо с йероглифи за всекидневна употреба',
    bound: 'свързана форма',
    boundTitle: 'Форма, която се среща в други йероглифи, а не самостоятелен йероглиф',
    kanjiRank: '№ {n} във вестниците',
    kanjiRankTitle: 'Мястото му сред 2500-те най-използвани във вестниците йероглифа',
    common: 'честа',
    commonTitle: 'JMdict отбелязва думата като честа',
    wordRank: 'сред първите {n} във вестниците',
    wordRankTitle: 'Сред {n}-те най-чести думи във вестниците',
  },
)

type Tag = { text: string; title: string; kind?: 'jlpt' | 'off' }

function Tags({ tags }: { tags: Tag[] }) {
  if (!tags.length) return null
  return (
    <p className="head-tags">
      {tags.map((g) => (
        <span key={g.text} className="head-tag" data-kind={g.kind} title={g.title}>
          {g.text}
        </span>
      ))}
    </p>
  )
}

export function KanjiTags({ node: n }: { node: KanjiNode }) {
  const lang = useLang()
  const t = S(lang)
  const tags: Tag[] = []
  if (n.jlpt) tags.push({ text: `N${n.jlpt}`, title: t('jlptTitle'), kind: 'jlpt' })
  if (n.joyo) tags.push({ text: t('joyo'), title: t('joyoTitle') })
  else if (n.inKanjidic) tags.push({ text: t('notJoyo'), title: t('notJoyoTitle'), kind: 'off' })
  else tags.push({ text: t('bound'), title: t('boundTitle'), kind: 'off' })
  if (n.freq != null) tags.push({ text: t('kanjiRank', { n: n.freq }), title: t('kanjiRankTitle') })
  return <Tags tags={tags} />
}

/** JMdict's nf buckets are 500 words wide. */
export function WordTags({ word: w }: { word: Word }) {
  const lang = useLang()
  const t = S(lang)
  const tags: Tag[] = []
  if (w.jlpt) tags.push({ text: `N${w.jlpt}`, title: t('jlptTitle'), kind: 'jlpt' })
  if (w.common) tags.push({ text: t('common'), title: t('commonTitle') })
  if (w.nf) {
    const n = (w.nf * 500).toLocaleString(lang)
    tags.push({ text: t('wordRank', { n }), title: t('wordRankTitle', { n }) })
  }
  return <Tags tags={tags} />
}
