import { useEffect, useState } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from '../api'
import { getLang, strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { StrokeOrder } from './StrokeOrder'
import { LooksLike, OtherForms, Related, useSimilar } from '../similar/SimilarRows'
import { isCommon } from '../similar/why'
import { Valency } from '../search/Valency'

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
    openReading: 'Open {word}, read {reading}',
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
    openReading: 'Отворете {word}, четено {reading}',
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
  /** Opens a near-synonym, lookalike or same-reading kanji from the page. */
  onKanji: (char: string) => void
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

/** A character as it looks, and what it means: the top of its page, above both tabs. */
export function KanjiHead({ node }: { node: KanjiNode }) {
  const lang = useLang()
  const t = S(lang)
  const [lead, ...rest] = meaningsOf(node, lang).value
  return (
    <div className="detail-head">
      <span className="detail-glyph">{node.char}</span>
      <div>
        <p className="detail-meanings">
          {lead ?? t('noMeaning')}
          {rest.length > 0 && <span className="rest"> {rest.slice(0, 5).join(', ')}</span>}
        </p>
      </div>
    </div>
  )
}

export function DetailPanel({ data, hovered, onWord, onKanji, onComponents }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [words, setWords] = useState<Word[]>([])
  const [byReading, setByReading] = useState<{ char: string; words: Record<string, Word> } | null>(null)
  const similar = useSimilar(data.focus.char, isCommon(data.focus))

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

  // Each reading opens the word it forms: あ.げる on 上 is 上げる.
  useEffect(() => {
    let stale = false
    api.readingWords(data.focus.char).then(
      (d) => !stale && setByReading(d),
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

  const formed = byReading?.char === n.char ? byReading.words : {}
  // Every reading, since the verbs tend to come last; one for a prefix or
  // suffix form and the plain one -- うえ, -うえ -- linked to whichever forms a word.
  const readings = (list: string[]) => {
    const plain = new Map<string, Word | undefined>()
    for (const r of list) {
      const p = r.replace(/^-+|-+$/g, '')
      plain.set(p, plain.get(p) ?? formed[r])
    }
    return [...plain].map(([r, w]) => (
      <span key={r}>
        {w ? (
          <button className="yomi-link" onClick={() => onWord(w)} title={t('openReading', { word: w.headword, reading: w.reading })}>
            {r}
          </button>
        ) : (
          r
        )}
      </span>
    ))
  }

  const level = levelOf(n, lang)
  const counts = data.counts

  return (
    <section className="rail-section">
      {onComponents && !isPreview && (
        <button className="see-components" onClick={onComponents} title={t('seeComponentsTitle', { char: n.char })}>
          {t('seeComponents')}
        </button>
      )}

      <dl className="facts">
        {n.onYomi.length > 0 && (
          <>
            <dt>{t('on')}</dt>
            <dd className="yomi">{readings(n.onYomi)}</dd>
          </>
        )}
        {n.kunYomi.length > 0 && (
          <>
            <dt>{t('kun')}</dt>
            <dd className="yomi">{readings(n.kunYomi)}</dd>
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
                  <Valency word={w} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* After the words: what it is confused with -- meaning first, then
          shape, then reading, which is the rarest question to have. */}
      {!isPreview && similar && (
        <>
          <Related kind="mean" items={similar.mean} onKanji={onKanji} />
          <LooksLike items={similar.look} onKanji={onKanji} />
          <Related kind="read" items={similar.read} onKanji={onKanji} />
          <OtherForms items={similar.variant} onKanji={onKanji} />
        </>
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
