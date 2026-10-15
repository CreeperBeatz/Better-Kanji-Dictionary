import { useEffect, useState } from 'react'
import { api, type GraphResponse, type KanjiNode, type KanjiPage, type ReadingInfo, type Word } from '../api'
import { getLang, strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { plainReading } from '../local/japanese'
import { local } from '../local/local'
import { KanjiMeta } from './HeadMeta'
import { realMeanings } from './meanings'
import { KanjiEditButton } from '../review/PageEdit'
import { FontStrip } from './FontStrip'
import { Forms, useForms } from './Forms'
import { StrokeOrder } from './StrokeOrder'
import { LooksLike, Related, useSimilar } from '../similar/SimilarRows'
import { isCommon } from '../similar/why'
import { Valency } from '../search/Valency'
import { MarkedReading } from '../search/MarkedReading'
import { Readings, SpecialReadings } from './Readings'
import { Meanings } from './MeaningCards'
import { warmWord } from '../warm'

const S = strings(
  {
    grade: 'learned in grade {n}',
    joyo: 'jōyō, secondary school',
    bound: 'bound form, not a standalone character',
    outside: 'outside the jōyō list',
    noMeaning: 'no recorded meaning',
    seeComponents: 'Components',
    heroAi: 'AI summary',
    seeComponentsTitle: 'Show what {char} is built from, and what it is part of',
    statistics: 'Statistics',
    strokes: 'Strokes',
    frequency: 'Frequency',
    inNewspapers: 'rank {n} of 2,500 in newspapers',
    level: 'Level',
    gradeLabel: 'Grade',
    gradeSchool: '{n}, elementary school',
    gradeSecondary: 'secondary school',
    gradeNames: 'name kanji (jinmeiyō)',
    radical: 'Radical',
    isRadical: 'one of the 214 radicals, no. {n}',
    appearsInside_one: 'Appears inside {b} jōyō character.',
    appearsInside_other: 'Appears inside {b} jōyō characters.',
    wordsUsing: 'Words using {char}',
    allWords: 'See all words with {char} →',
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
    heroAi: 'Обобщение от ИИ',
    seeComponentsTitle: 'Покажете от какво е изграден {char} и в какво участва',
    statistics: 'Статистика',
    strokes: 'Черти',
    frequency: 'Честота',
    inNewspapers: 'място {n} от 2500 във вестниците',
    level: 'Ниво',
    gradeLabel: 'Клас',
    gradeSchool: '{n}, начално училище',
    gradeSecondary: 'средно училище',
    gradeNames: 'канджи за имена (джинмейо)',
    radical: 'Ключ',
    isRadical: 'един от 214-те ключа, № {n}',
    appearsInside_one: 'Среща се в {b} йероглиф джойо.',
    appearsInside_other: 'Среща се в {b} йероглифа джойо.',
    wordsUsing: 'Думи с {char}',
    allWords: 'Всички думи с {char} →',
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
  /** The way to its associations, beside the statistics' title (a phone's). */
  notes?: React.ReactNode
}

// With no meaning groups, the page shows this many key words; the rest are a search away.
const PAGE_WORDS = 8

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

export function DetailPanel({ data, hovered, onWord, onKanji, onComponents, onSignIn, onWordsWith, notes }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [words, setWords] = useState<Word[]>([])
  // Its meanings with their readings and words, special readings and radical.
  // Offline, only the word each reading forms, from the device: `full` false.
  // Known already, it is there at once, as on a page come back to.
  const [page, setPage] = useState<{ char: string; data: KanjiPage; full: boolean } | null>(() => {
    const known = api.kanjiPage.peek(data.focus.char)
    return known ? { char: data.focus.char, data: known, full: true } : null
  })
  // The same page from the offline pack: at once, but as of the pack's build.
  const [onDevice, setOnDevice] = useState<KanjiPage | null>(null)
  const similar = useSimilar(data.focus.char, isCommon(data.focus))
  const forms = useForms(data.focus.char)

  // Both follow the focus, not the hover -- otherwise they would thrash as the
  // cursor crosses the graph. The plain list of words is for a kanji with no
  // meaning groups, so it is asked for only then.
  useEffect(() => {
    let stale = false
    const char = data.focus.char
    setWords([])
    const plainWords = () =>
      api.wordsFor(char).then(
        (d) => !stale && setWords(d.words),
        () => {},
      )
    local.kanjiPage(char)?.then(
      (d) => !stale && setOnDevice(d),
      () => {},
    )
    api.kanjiPage(char).then(
      (d) => {
        if (stale) return
        setPage({ char, data: d, full: true })
        if (d.meanings.length === 0) plainWords()
      },
      () => {
        plainWords()
        api.readingWords(char).then(
          (d) => {
            if (stale) return
            const readings: Record<string, ReadingInfo> = {}
            for (const [r, w] of Object.entries(d.words)) readings[plainReading(r)] = { formed: w, common: 0, examples: [] }
            const empty = { meanings: [], hero: null, heroBg: null, link: null, linkBg: null, mixups: [], soundOnly: null, special: [], radical: null }
            setPage({ char, data: { char, readings, ...empty }, full: false })
          },
          () => {},
        )
      },
    )
    return () => {
      stale = true
    }
  }, [data.focus.char])

  // Hovering a node previews it without disturbing the graph; the focus is what
  // you see when nothing is under the cursor.
  const n = hovered ?? data.focus
  const isPreview = hovered !== null && hovered.char !== data.focus.char

  // A page already fetched is drawn at once: a phone puts the panel away with
  // every other tab, and its overview coming in late pushed the page down.
  // The server's page, else the device's, else the readings alone.
  const kept = api.kanjiPage.peek(n.char)
  const mine = page?.char === n.char ? page : null
  const here = kept
    ? { char: n.char, data: kept, full: true }
    : mine?.full
      ? mine
      : onDevice?.char === n.char
        ? { char: n.char, data: onDevice, full: true }
        : mine
  const unit = !isPreview && here && here.data.meanings.length > 0 ? here.data : null
  const special = here?.data.special ?? []
  const vocabRow = (w: Word) => (
    <li key={`${w.id}-${w.headword}`}>
      <button className="vocab-row" {...warmWord(w.id)} onClick={() => onWord(w)} title={t('openEntry')}>
        <span className="vocab-word">{w.headword}</span>
        <span className="vocab-reading">
          <MarkedReading reading={w.reading} mark={w.mark} />
        </span>
        <span className="vocab-gloss">{w.senses[0] && glossOf(w.senses[0], lang).value.split(';')[0]}</span>
        <Valency word={w} />
      </button>
    </li>
  )

  const grade = gradeOf(n.grade, t)
  // A radical says so, with its number; a kanji that only contains one does not:
  // its parts are on the graph.
  const radical = here?.data.radical?.char === n.char ? here.data.radical : null
  // What the meanings already say is not said again below: kanji close in
  // meaning sit in their meaning, and kanji with the same reading under "easy to mix up".
  const saysSimilar = !!unit?.meanings.some((m) => m.similar.length > 0)
  const saysMixups = !!unit && (unit.mixups.length > 0 || unit.meanings.some((m) => m.mixups.length > 0))
  const mean = similar && !saysSimilar ? similar.mean : []
  const read = similar && !saysMixups ? similar.read : []
  const hero = unit && ((lang === 'bg' && unit.heroBg) || unit.hero)

  return (
    <section className="rail-section kanji-page">
      {onComponents && !isPreview && (
        <button className="see-components" onClick={onComponents} title={t('seeComponentsTitle', { char: n.char })}>
          {t('seeComponents')}
        </button>
      )}

      {/* The kanji's gist, then the numbers, then how it looks in print and by hand, then how it is written. */}
      {hero && (
        <>
          <p className="kanji-hero">{hero}</p>
          <p className="kanji-hero-note">{t('heroAi')}</p>
        </>
      )}
      {notes ? (
        <div className="facts-title-row">
          <h3 className="facts-title">{t('statistics')}</h3>
          {notes}
        </div>
      ) : (
        <h3 className="facts-title">{t('statistics')}</h3>
      )}
      <dl className="facts">
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
        {n.jlpt != null && (
          <>
            <dt>{t('level')}</dt>
            <dd>JLPT N{n.jlpt}</dd>
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
            <dd>{t('isRadical', { n: radical.number })}</dd>
          </>
        )}
      </dl>

      {(n.fanout ?? 0) > 0 && (
        <p className="fanout-line">
          {t.node(plural(t, 'appearsInside', n.fanout ?? 0), { b: <b>{n.fanout}</b> })}
        </p>
      )}

      {!isPreview && (
        <>
          <FontStrip char={data.focus.char} part="fonts" />
          <StrokeOrder char={data.focus.char} strokes={data.strokes} />
        </>
      )}

      <div>
        {unit ? (
          <Meanings
            page={unit}
            self={data.focus}
            onYomi={n.onYomi}
            kunYomi={n.kunYomi}
            onKanji={onKanji}
            onWordsWith={onWordsWith && (() => onWordsWith(data.focus.char))}
            row={vocabRow}
          />
        ) : (
          // No meaning groups (yet), offline, or a preview: the readings, then the plain list.
          <>
            <Readings on={n.onYomi} kun={n.kunYomi} info={here?.data.readings ?? null} full={here?.full ?? false} onWord={onWord} />
            {!isPreview && words.length > 0 && (
              <div className="vocab">
                <div className="vocab-head">
                  <h3>{t('wordsUsing', { char: data.focus.char })}</h3>
                  {onWordsWith && (
                    <button className="clear vocab-all" onClick={() => onWordsWith(data.focus.char)}>
                      {t('allWords', { char: data.focus.char })}
                    </button>
                  )}
                </div>
                <ul>{keyWords(words, new Set(special.map((w) => w.id)), PAGE_WORDS).map(vocabRow)}</ul>
              </div>
            )}
            {!isPreview && <SpecialReadings words={special} row={vocabRow} />}
          </>
        )}
        {unit && onWordsWith && (
          <button className="clear vocab-all meanings-all" onClick={() => onWordsWith(data.focus.char)}>
            {t('allWords', { char: data.focus.char })}
          </button>
        )}
      </div>

      {!isPreview && (
        <>
          {forms && <Forms data={forms} onKanji={onKanji} />}
          <FontStrip char={data.focus.char} part="old" />
          {similar && <LooksLike items={similar.look} onKanji={onKanji} />}
        </>
      )}

      {/* What the meanings did not say already: kanji of similar meaning, then
          of the same reading, which is the rarest question to have. */}
      {!isPreview && mean.length + read.length > 0 && (
        <div>
          <Related kind="mean" items={mean} onKanji={onKanji} />
          <Related kind="read" items={read} onKanji={onKanji} />
        </div>
      )}

      {!isPreview && <KanjiEditButton char={data.focus.char} onSignIn={onSignIn} />}
    </section>
  )
}

/**
 * The words worth showing on the page, at most `max`: common, and either on
 * the N5-N2 lists or among the 4,000 most frequent (nf08); else the commonest.
 * The server picks a meaning's words the same way (search._key_word).
 * Special readings have their own place.
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
