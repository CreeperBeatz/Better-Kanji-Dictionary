import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type GraphResponse, type KanjiNode, type KanjiReadings, type ReadingInfo, type Word, type WordsWithResponse } from '../api'
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
import { Valency } from '../search/Valency'
import { Readings, SpecialReadings } from './Readings'
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
    strokes: 'Strokes',
    gradeLabel: 'Grade',
    gradeSchool: '{n}, elementary school',
    gradeSecondary: 'secondary school',
    gradeNames: 'name kanji (jinmeiyō)',
    radical: 'Radical',
    radicalNo: 'no. {n}',
    onThisPage: 'On this page',
    readings: 'Readings',
    writing: 'Writing',
    words: 'Words',
    special: 'Special readings',
    similar: 'Similar',
    appearsInside_one: 'Appears inside {b} jōyō character.',
    appearsInside_other: 'Appears inside {b} jōyō characters.',
    wordsUsing: 'Words using {char}',
    notInGroup: 'Not in a group',
    catchAll: 'No meaning of its own',
    allWords: 'See all words with {char} →',
    hidden: '{n} hidden, see all words',
    formOf: 'a form of {char}',
    shape: 'a shape: “{name}”',
    shapeNone: 'no meaning of its own',
    openEntry: 'Open this entry',
  },
  {
    grade: 'учи се в {n} клас',
    joyo: 'джойо, средно училище',
    bound: 'свързана форма, не е самостоятелен йероглиф',
    outside: 'извън списъка джойо',
    noMeaning: 'няма записано значение',
    seeComponents: 'Компоненти',
    seeComponentsTitle: 'Покажете от какво е изграден {char} и в какво участва',
    strokes: 'Черти',
    gradeLabel: 'Клас',
    gradeSchool: '{n}, начално училище',
    gradeSecondary: 'средно училище',
    gradeNames: 'канджи за имена (джинмейо)',
    radical: 'Ключ',
    radicalNo: '№ {n}',
    onThisPage: 'На тази страница',
    readings: 'Четения',
    writing: 'Писане',
    words: 'Думи',
    special: 'Особени четения',
    similar: 'Подобни',
    appearsInside_one: 'Среща се в {b} йероглиф джойо.',
    appearsInside_other: 'Среща се в {b} йероглифа джойо.',
    wordsUsing: 'Думи с {char}',
    notInGroup: 'Извън групите',
    catchAll: 'Без собствено значение',
    allWords: 'Всички думи с {char} →',
    hidden: '{n} скрити, вижте всички думи',
    formOf: 'форма на {char}',
    shape: 'форма: „{name}“',
    shapeNone: 'няма свое значение',
    openEntry: 'Отворете тази статия',
  },
)

/**
 * What the panel needs of a character: the device can answer it by itself
 * from the offline pack, so the panel fills in before the graph arrives, and
 * without a connection.
 */
export type DetailData = Pick<GraphResponse, 'focus' | 'strokes'>

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
// Once the kanji's meanings are grouped: at most this many key words under each.
const GROUP_WORDS = 8
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
  // A reviewed part meaning (server/review.py), or a shape's name: before anything borrowed.
  const part = own.length === 0 ? forms?.part : null
  const borrowed = own.length === 0 && !part ? forms?.meaning : null
  const lent = borrowed ? meaningsOf(borrowed, lang).value : []
  const partLabel = part && ((lang === 'bg' && part.bg) || part.en)
  const partNote = part && ((lang === 'bg' && part.noteBg) || part.note)
  return (
    <div className="detail-head">
      <span className="detail-glyph">{node.char}</span>
      <div>
        <p className="detail-meanings">
          {part ? (
            part.kind === 'shape' ? (
              <>
                {t('shape', { name: partLabel ?? '' })}
                <span className="rest"> {t('shapeNone')}</span>
              </>
            ) : (
              partLabel
            )
          ) : borrowed ? (
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
        {partNote && <p className="detail-part-note">{partNote}</p>}
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
  // Its readings with their words, special readings and radical. Offline, only
  // the word each reading forms, from the device: `full` false.
  const [readings, setReadings] = useState<{ char: string; data: KanjiReadings; full: boolean } | null>(null)
  const similar = useSimilar(data.focus.char, isCommon(data.focus))
  const forms = useForms(data.focus.char)
  const page = useRef<HTMLElement>(null)

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

  // Each reading with the word it forms (あ.げる on 上 is 上げる) and the words read that way.
  useEffect(() => {
    let stale = false
    const char = data.focus.char
    api.kanjiReadings(char).then(
      (d) => !stale && setReadings({ char, data: d, full: true }),
      () =>
        api.readingWords(char).then(
          (d) => {
            if (stale) return
            const info: Record<string, ReadingInfo> = {}
            for (const [r, w] of Object.entries(d.words)) info[r.replace(/^-+|-+$/g, '')] = { formed: w, common: 0, examples: [] }
            setReadings({ char, data: { char, readings: info, special: [], radical: null }, full: false })
          },
          () => {},
        ),
    )
    return () => {
      stale = true
    }
  }, [data.focus.char])

  // Hovering a node previews it without disturbing the graph; the focus is what
  // you see when nothing is under the cursor.
  const n = hovered ?? data.focus
  const isPreview = hovered !== null && hovered.char !== data.focus.char

  const here = readings?.char === n.char ? readings : null
  const special = readings?.char === data.focus.char ? readings.data.special : []
  const specialIds = new Set(special.map((w) => w.id))
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
    const shown = keyWords(ws, specialIds, GROUP_WORDS)
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
        {open && <ul>{shown.map(vocabRow)}</ul>}
        {open && onWordsWith && n > shown.length && (
          <button className="clear vocab-hidden" onClick={() => onWordsWith(data.focus.char)}>
            {t('hidden', { n: n - shown.length })}
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

  const grade = gradeOf(n.grade, t)
  const radical = here?.data.radical
  const radicalMeaning = radical && meaningsOf({ meanings: realMeanings(radical.meanings), meaningsBg: radical.meaningsBg }, lang).value[0]
  const hasWords = vocabReady && (groups.length > 0 || words.length > 0)
  const hasSimilar = !!similar && similar.mean.length + similar.look.length + similar.read.length > 0
  // The page's parts, for the links at its top: only those it has.
  const sections: [Section, boolean][] = [
    ['readings', n.onYomi.length + n.kunYomi.length > 0],
    ['writing', true],
    ['words', hasWords],
    ['special', special.length > 0],
    ['similar', hasSimilar],
  ]
  const goTo = (id: Section) => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    page.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  return (
    <section className="rail-section kanji-page" ref={page}>
      {onComponents && !isPreview && (
        <button className="see-components" onClick={onComponents} title={t('seeComponentsTitle', { char: n.char })}>
          {t('seeComponents')}
        </button>
      )}

      {!isPreview && (
        <nav className="page-sections" aria-label={t('onThisPage')}>
          {sections
            .filter(([, shown]) => shown)
            .map(([id]) => (
              <button key={id} className="clear" onClick={() => goTo(id)}>
                {t(id)}
              </button>
            ))}
        </nav>
      )}

      <dl className="facts">
        {n.strokes != null && (
          <>
            <dt>{t('strokes')}</dt>
            <dd>{n.strokes}</dd>
          </>
        )}
        {grade && (
          <>
            <dt>{t('gradeLabel')}</dt>
            <dd>{grade}</dd>
          </>
        )}
        {radical && (
          <>
            <dt>{t('radical')}</dt>
            <dd>
              {radical.char === n.char ? (
                <span className="facts-radical" lang="ja">
                  {radical.char}
                </span>
              ) : (
                <button className="yomi-link facts-radical" lang="ja" onClick={() => onKanji(radical.char)}>
                  {radical.char}
                </button>
              )}{' '}
              {t('radicalNo', { n: radical.number })}
              {radicalMeaning && `, ${radicalMeaning}`}
            </dd>
          </>
        )}
      </dl>

      {(n.fanout ?? 0) > 0 && (
        <p className="fanout-line">
          {t.node(plural(t, 'appearsInside', n.fanout ?? 0), { b: <b>{n.fanout}</b> })}
        </p>
      )}

      <div data-section="readings">
        <Readings on={n.onYomi} kun={n.kunYomi} info={here?.data.readings ?? null} full={here?.full ?? false} onWord={onWord} />
      </div>

      {!isPreview && (
        <div data-section="writing">
          <StrokeOrder char={data.focus.char} strokes={data.strokes} />
          <FontStrip char={data.focus.char} />
          {forms && <Forms data={forms} onKanji={onKanji} />}
        </div>
      )}

      {!isPreview && hasWords && (
        <div className="vocab" data-section="words">
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
            <ul>{keyWords(words, specialIds, PAGE_WORDS).map(vocabRow)}</ul>
          )}
        </div>
      )}

      {!isPreview && special.length > 0 && (
        <div data-section="special">
          <SpecialReadings words={special} row={vocabRow} />
        </div>
      )}

      {/* After the words: what it is confused with -- meaning first, then
          shape, then reading, which is the rarest question to have. */}
      {!isPreview && hasSimilar && (
        <div data-section="similar">
          <Related kind="mean" items={similar.mean} onKanji={onKanji} />
          <LooksLike items={similar.look} onKanji={onKanji} />
          <Related kind="read" items={similar.read} onKanji={onKanji} />
        </div>
      )}

      {!isPreview && <KanjiEditButton char={data.focus.char} onSignIn={onSignIn} />}
    </section>
  )
}

type Section = 'readings' | 'writing' | 'words' | 'special' | 'similar'

/**
 * The words worth showing on the page, at most `max`: common, and either on
 * the N5-N2 lists or among the 4,000 most frequent (nf08). So a group shows
 * as many as it has that matter. One with none of those shows its most common
 * word. Special readings have their own place.
 */
function keyWords(ws: Word[], special: Set<number>, max: number): Word[] {
  const left = ws.filter((w) => !special.has(w.id))
  const key = left.filter((w) => w.common && ((w.jlpt != null && w.jlpt >= 2) || (w.nf != null && w.nf <= 8)))
  return (key.length ? key : left.slice(0, 1)).slice(0, max)
}

/** KANJIDIC's grade: 1-6 the school year, 8 the rest of the jōyō, 9 and 10 name kanji. */
function gradeOf(grade: number | null, t: ReturnType<typeof S>): string | null {
  if (grade == null) return null
  if (grade <= 6) return t('gradeSchool', { n: grade })
  if (grade === 8) return t('gradeSecondary')
  return t('gradeNames')
}

/** The plural form's key for `n`, so a sentence with markup in it can go through t.node. */
function plural(t: ReturnType<typeof S>, key: 'appearsInside', n: number) {
  return `${key}_${new Intl.PluralRules(t.lang).select(n) === 'one' ? 'one' : 'other'}` as const
}
