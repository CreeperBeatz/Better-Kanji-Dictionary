import { useEffect, useState, type ReactNode } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word, type WordsWithResponse } from '../api'
import { CATCH_ALL, groupLabel } from '../review/editors'
import { getLang, strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { KanjiMeta } from './HeadMeta'
import { realMeanings } from './meanings'
import { KanjiEditButton } from '../review/PageEdit'
import { FontStrip } from './FontStrip'
import { Forms, useForms } from './Forms'
import { StrokeOrder } from './StrokeOrder'
import { LooksLike, Related, useSimilar } from '../similar/SimilarRows'
import { isCommon } from '../similar/why'
import { Valency, ValencyMark } from '../search/Valency'
import { GroupToggle } from '../search/WordsWith'
import { toggled } from '../sets'

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
    notInGroup: 'Not in a group',
    catchAll: 'No meaning of its own',
    allWords: 'See all words with {char} →',
    hidden: '{n} hidden, see all words',
    formOf: 'a form of {char}',
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
    notInGroup: 'Извън групите',
    catchAll: 'Без собствено значение',
    allWords: 'Всички думи с {char} →',
    hidden: '{n} скрити, вижте всички думи',
    formOf: 'форма на {char}',
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
  /** Opens sign-in, for someone signed out who wants to suggest a change. */
  onSignIn?: () => void
  /** Opens every word with the kanji, by meaning: "see all words". */
  onWordsWith?: (char: string) => void
}

// The page shows only the most common few; the rest are a search away, by meaning.
const PAGE_WORDS = 8
// Once the kanji's meanings are grouped: this many common words under each.
const GROUP_WORDS = 5
const REST = 'rest'

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
  // KANJIDIC files a radical's name where a meaning would be ("Radical Number 9");
  // such a part borrows the meaning of the kanji it is a form of, when it is one.
  const own = meaningsOf({ meanings: realMeanings(node.meanings), meaningsBg: node.meaningsBg }, lang).value
  const forms = useForms(node.char, own.length === 0)
  const [lead, ...rest] = own
  const borrowed = own.length === 0 ? forms?.meaning : null
  const lent = borrowed ? meaningsOf(borrowed, lang).value : []
  return (
    <div className="detail-head">
      <span className="detail-glyph">{node.char}</span>
      <div>
        <p className="detail-meanings">
          {borrowed ? (
            <>
              {t('formOf', { char: borrowed.from })}
              {lent.length > 0 && <span className="rest"> {lent.slice(0, 3).join(', ')}</span>}
            </>
          ) : (
            <>
              {lead ?? t('noMeaning')}
              {rest.length > 0 && <span className="rest"> {rest.slice(0, 5).join(', ')}</span>}
            </>
          )}
        </p>
      </div>
      <KanjiMeta node={node} />
    </div>
  )
}

export function DetailPanel({ data, hovered, onWord, onKanji, onComponents, onSignIn, onWordsWith }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [words, setWords] = useState<Word[]>([])
  // Its common words by meaning group, once reviewers have grouped them; null
  // while on the way, and with no groups (or no server) the plain list shows.
  const [grouped, setGrouped] = useState<{ char: string; data: WordsWithResponse | null } | null>(null)
  // The groups folded away, by id; all open on each new kanji.
  const [shut, setShut] = useState<{ char: string; ids: Set<string> }>({ char: '', ids: new Set() })
  const [byReading, setByReading] = useState<{ char: string; words: Record<string, Word> } | null>(null)
  const similar = useSimilar(data.focus.char, isCommon(data.focus))
  const forms = useForms(data.focus.char)

  // Vocabulary follows the focus, not the hover -- otherwise it would thrash
  // as the cursor crosses the graph.
  useEffect(() => {
    let stale = false
    setWords([])
    api.wordsFor(data.focus.char).then(
      (d) => !stale && setWords(d.words),
      () => {},
    )
    const char = data.focus.char
    api.wordsWith(char, true, 0, GROUP_WORDS).then(
      (d) => !stale && setGrouped({ char, data: d }),
      () => !stale && setGrouped({ char, data: null }),
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
  // The words: by group once the kanji has groups, else the plain list -- decided
  // once the groups have answered, so the list does not turn into groups under you.
  const groupedData = grouped?.char === data.focus.char ? grouped.data : null
  const vocabReady = grouped?.char === data.focus.char
  const groups = (groupedData?.groups ?? []).filter((g) => g.words.length > 0)
  const rest = groups.length ? (groupedData?.rest.words ?? []) : []
  const shutHere = shut.char === data.focus.char ? shut.ids : new Set<string>()
  // A group as a box of its own: its title bar folds it, > folded, pointing down open.
  const vocabGroup = (id: string, label: ReactNode, n: number, ws: Word[]) => {
    const open = !shutHere.has(id)
    return (
      <div key={id} className="vocab-group" data-shut={!open || undefined}>
        <h4>
          <GroupToggle
            className="vocab-group-toggle"
            open={open}
            onToggle={() => setShut({ char: data.focus.char, ids: toggled(shutHere, id) })}
            label={label}
            n={n}
          />
        </h4>
        {open && <ul>{ws.slice(0, GROUP_WORDS).map(vocabRow)}</ul>}
        {open && onWordsWith && n > Math.min(GROUP_WORDS, ws.length) && (
          <button className="clear vocab-hidden" onClick={() => onWordsWith(data.focus.char)}>
            {t('hidden', { n: n - Math.min(GROUP_WORDS, ws.length) })}
          </button>
        )}
      </div>
    )
  }
  const vocabRow = (w: Word) => (
    <li key={w.id}>
      <button className="vocab-row" onClick={() => onWord(w)} title={t('openEntry')}>
        <span className="vocab-word">{w.headword}</span>
        <span className="vocab-reading">{w.reading}</span>
        <span className="vocab-gloss">{w.senses[0] && glossOf(w.senses[0], lang).value.split(';')[0]}</span>
        <Valency word={w} />
      </button>
    </li>
  )
  // Every reading, since the verbs tend to come last; one for a prefix or
  // suffix form and the plain one -- うえ, -うえ -- linked to whichever forms a word.
  // A kun reading that is a verb says whether it takes が or を: あ.く, あ.ける.
  const readings = (list: string[], kun = false) => {
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
        {kun && w && <ValencyMark word={w} />}
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
            <dd className="yomi">{readings(n.kunYomi, true)}</dd>
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
      {!isPreview && <FontStrip char={data.focus.char} />}

      {!isPreview && vocabReady && (groups.length > 0 || words.length > 0) && (
        <div className="vocab">
          <div className="vocab-head">
            <h3>{t('wordsUsing', { char: data.focus.char })}</h3>
            {onWordsWith && (
              <button className="clear vocab-all" onClick={() => onWordsWith(data.focus.char)}>
                {t('allWords', { char: data.focus.char })}
              </button>
            )}
          </div>
          {groups.length > 0 ? (
            <>
              {groups.map((g) =>
                vocabGroup(
                  g.id,
                  g.id === CATCH_ALL ? t('catchAll') : groupLabel(g.id, groupedData?.senses ?? null, lang),
                  g.words.length,
                  g.words,
                ),
              )}
              {rest.length > 0 && vocabGroup(REST, t('notInGroup'), groupedData?.rest.total ?? rest.length, rest)}
            </>
          ) : (
            <ul>{words.slice(0, PAGE_WORDS).map(vocabRow)}</ul>
          )}
        </div>
      )}

      {/* After the words: what it is confused with -- meaning first, then
          shape, then reading, which is the rarest question to have. */}
      {!isPreview && similar && (
        <>
          <Related kind="mean" items={similar.mean} onKanji={onKanji} />
          <LooksLike items={similar.look} onKanji={onKanji} />
          <Related kind="read" items={similar.read} onKanji={onKanji} />
        </>
      )}

      {!isPreview && forms && <Forms data={forms} onKanji={onKanji} />}

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

      {!isPreview && <KanjiEditButton char={data.focus.char} onSignIn={onSignIn} />}
    </section>
  )
}

/** The plural form's key for `n`, so a sentence with markup in it can go through t.node. */
function plural(t: ReturnType<typeof S>, key: 'appearsInside' | 'builtFrom', n: number) {
  return `${key}_${new Intl.PluralRules(t.lang).select(n) === 'one' ? 'one' : 'other'}` as const
}
