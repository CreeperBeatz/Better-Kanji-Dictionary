import { useEffect, useState } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from '../api'
import { getLang, strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { StrokeOrder } from './StrokeOrder'
import { SimilarRows } from '../similar/SimilarRows'
import { isCommon } from '../similar/why'

const S = strings(
  {
    grade: 'learned in grade {n}',
    joyo: 'jōyō, secondary school',
    bound: 'bound form, not a standalone character',
    outside: 'outside the jōyō list',
    noMeaning: 'no recorded meaning',
    seeComponents: 'Components',
    seeComponentsTitle: 'Show what {char} is built from, and what it is part of',
    on: 'On',
    kun: 'Kun',
    strokes: 'Strokes',
    frequency: 'Frequency',
    inNewspapers: '{n} in newspapers',
    level: 'Level',
    appearsInside_one: 'Appears inside {b} jōyō character.',
    appearsInside_other: 'Appears inside {b} jōyō characters.',
    wordsUsing: 'Words using {char}',
    openEntry: 'Open this entry',
    builtFrom_one: 'Built from {b} part',
    builtFrom_other: 'Built from {b} parts',
    acrossLevels: ' across {n} levels',
    containedBy: 'Contained by {all}, of which {joyo} are jōyō.',
  },
  {
    grade: 'учи се в {n} клас',
    joyo: 'джойо, средно училище',
    bound: 'свързана форма, не е самостоятелен йероглиф',
    outside: 'извън списъка джойо',
    noMeaning: 'няма записано значение',
    seeComponents: 'Компоненти',
    seeComponentsTitle: 'Покажете от какво е изграден {char} и в какво участва',
    on: 'Он',
    kun: 'Кун',
    strokes: 'Черти',
    frequency: 'Честота',
    inNewspapers: 'място {n} във вестниците',
    level: 'Ниво',
    appearsInside_one: 'Среща се в {b} йероглиф джойо.',
    appearsInside_other: 'Среща се в {b} йероглифа джойо.',
    wordsUsing: 'Думи с {char}',
    openEntry: 'Отворете тази статия',
    builtFrom_one: 'Изграден от {b} част',
    builtFrom_other: 'Изграден от {b} части',
    acrossLevels: ' на {n} нива',
    containedBy: 'Съдържа се в {all}, от които {joyo} са джойо.',
  },
)

/**
 * What the panel needs of a character. The counts come with the graph, from
 * the server; the rest the device can answer by itself from the offline pack,
 * so the panel fills in before the graph arrives, and without a connection.
 */
export type DetailData = Pick<GraphResponse, 'focus' | 'strokes'> & { counts?: GraphResponse['counts'] }

interface Props {
  data: DetailData
  hovered: KanjiNode | null
  onWord: (word: Word) => void
  /** Opens a lookalike or near-synonym from the page. */
  onKanji: (char: string) => void
  /** Shows the Similar view; left out when it is already on screen. */
  onSimilar?: () => void
  /** Shows the focus graph, from the map or on a phone; left out when it is already on screen. */
  onComponents?: () => void
}

export function levelOf(n: KanjiNode, lang: Lang = getLang()): string | null {
  const t = S(lang)
  if (n.jlpt) return `JLPT N${n.jlpt}`
  if (n.grade && n.grade <= 6) return t('grade', { n: n.grade })
  if (n.joyo) return t('joyo')
  if (!n.inKanjidic) return t('bound')
  return t('outside')
}

export function DetailPanel({ data, hovered, onWord, onKanji, onSimilar, onComponents }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [words, setWords] = useState<Word[]>([])

  // Vocabulary follows the focus, not the hover -- otherwise it would thrash
  // as the cursor crosses the graph.
  useEffect(() => {
    let stale = false
    setWords([])
    api.wordsFor(data.focus.char).then(
      (d) => !stale && setWords(d.words),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [data.focus.char])

  // Hovering a node previews it without disturbing the graph; the focus is what
  // you see when nothing is under the cursor.
  const n = hovered ?? data.focus
  const isPreview = hovered !== null && hovered.char !== data.focus.char

  const [lead, ...rest] = meaningsOf(n, lang).value
  const level = levelOf(n, lang)
  const counts = data.counts

  return (
    <section className="rail-section">
      <div className="detail-head">
        <span className="detail-glyph">{n.char}</span>
        <div>
          <p className="detail-meanings">
            {lead ?? t('noMeaning')}
            {rest.length > 0 && <span className="rest"> {rest.slice(0, 5).join(', ')}</span>}
          </p>
        </div>
      </div>

      {onComponents && !isPreview && (
        <button className="see-components" onClick={onComponents} title={t('seeComponentsTitle', { char: n.char })}>
          {t('seeComponents')}
        </button>
      )}

      <dl className="facts">
        {n.onYomi.length > 0 && (
          <>
            <dt>{t('on')}</dt>
            <dd className="yomi">{n.onYomi.slice(0, 4).join('  ')}</dd>
          </>
        )}
        {n.kunYomi.length > 0 && (
          <>
            <dt>{t('kun')}</dt>
            <dd className="yomi">{n.kunYomi.slice(0, 4).join('  ')}</dd>
          </>
        )}
        {n.strokes != null && (
          <>
            <dt>{t('strokes')}</dt>
            <dd>{n.strokes}</dd>
          </>
        )}
        {n.freq != null && (
          <>
            <dt>{t('frequency')}</dt>
            <dd>{t('inNewspapers', { n: n.freq })}</dd>
          </>
        )}
        {level && (
          <>
            <dt>{t('level')}</dt>
            <dd>{level}</dd>
          </>
        )}
      </dl>

      {(n.fanout ?? 0) > 0 && (
        <p className="fanout-line">
          {t.node(plural(t, 'appearsInside', n.fanout ?? 0), { b: <b>{n.fanout}</b> })}
        </p>
      )}

      {!isPreview && <StrokeOrder char={data.focus.char} strokes={data.strokes} />}

      {!isPreview && (
        <SimilarRows char={data.focus.char} common={isCommon(data.focus)} onKanji={onKanji} onShowAll={onSimilar} />
      )}

      {!isPreview && words.length > 0 && (
        <div className="vocab">
          <h3>{t('wordsUsing', { char: data.focus.char })}</h3>
          <ul>
            {words.slice(0, 8).map((w) => (
              <li key={w.id}>
                <button className="vocab-row" onClick={() => onWord(w)} title={t('openEntry')}>
                  <span className="vocab-word">{w.headword}</span>
                  <span className="vocab-reading">{w.reading}</span>
                  <span className="vocab-gloss">{w.senses[0] && glossOf(w.senses[0], lang).value.split(';')[0]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isPreview && counts && (
        <p className="fanout-line">
          {t.node(plural(t, 'builtFrom', counts.components), { b: <b>{counts.components}</b> })}
          {counts.maxDepth > 1 && t('acrossLevels', { n: counts.maxDepth })}.
          {counts.containers > 0 && (
            <>
              {' '}
              {t.node('containedBy', { all: <b>{counts.containers}</b>, joyo: <b>{counts.containersJoyo}</b> })}
            </>
          )}
        </p>
      )}
    </section>
  )
}

/** The plural form's key for `n`, so a sentence with markup in it can go through t.node. */
function plural(t: ReturnType<typeof S>, key: 'appearsInside' | 'builtFrom', n: number) {
  return `${key}_${new Intl.PluralRules(t.lang).select(n) === 'one' ? 'one' : 'other'}` as const
}
