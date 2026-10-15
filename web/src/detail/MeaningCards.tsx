/**
 * A kanji's meanings, readings and words as one unit. Each meaning is a card:
 * what it is, then its words by how they read the kanji -- the kun words,
 * then the on words -- each word saying its own reading, so no reading is
 * named twice. An on reading the meaning has in only a word or two is faded
 * at the end of its on words; its special readings are its exceptions. Then
 * the kanji close to it in meaning (≈), and the kanji easy to mix up on one
 * of its readings (!), with the 異字同訓 card that tells them apart, open.
 *
 * A few words each way, not all: "more words" has the rest. Each card's
 * title holds to the top while the card is read, so the page says where
 * you are without reading back. A card folds to its title and what it
 * says, its words and the rest under it; "fold all" makes every card that
 * way, and is remembered.
 *
 * First its Readings, every one at a glance (a rare one, in no common word,
 * faded). Then its Meanings, opening with how they follow from each other,
 * then the cards. Below them:
 * words where the kanji is there for its sound, the special readings, and
 * mix-ups on readings no meaning has. The words in no meaning group are not
 * here: "all words" has them.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { reducedMotion } from '../media'
import type { CloseKanji, KanjiLite, KanjiMeaning, KanjiPage, MixUp, UsageCard, Word } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { focusMeaningNext, meaningAnchor, takeMeaningFocus } from './meaningFocus'
import { ReadingsLine, SpecialReadings } from './Readings'
import { warmKanji } from '../warm'

/** At most this many kun words, and on words, on a meaning's card. */
const LANE_WORDS = 3

/** Remembers "fold all": '1' while every card is folded. */
const FOLD_KEY = 'meanings-folded'

function rememberedFold(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Up to `n` of the lists' items, taken a round at a time, so that each list
 * gives one before any gives two -- every on reading keeps a word -- and
 * back in their lists' order.
 */
function fewest<T>(lists: T[][], n: number): T[] {
  const take = lists.map(() => 0)
  let left = Math.max(n, lists.length)
  for (let round = 0; left > 0; round++) {
    let any = false
    lists.forEach((l, i) => {
      if (left > 0 && l.length > round) {
        take[i]++
        left--
        any = true
      }
    })
    if (!any) break
  }
  return lists.flatMap((l, i) => l.slice(0, take[i]))
}

const S = strings(
  {
    meanings: 'Meanings',
    foldAll: 'Fold all',
    openAll: 'Open all',
    on: 'On',
    kun: 'Kun',
    exceptions: 'Exceptions',
    exceptionsHint: 'read as one word, not kanji by kanji',
    similar: 'Synonyms',
    withMeaning: 'With the meaning: {m}',
    openAt: 'Open {char} at this meaning',
    mixups: 'Easy to mix up',
    mixupsHint: 'Other kanji with the same kun reading.',
    more_one: '{n} more word',
    more_other: '{n} more words',
    sound: 'For its sound only',
    soundHint: 'In these words the kanji brings no meaning.',
  },
  {
    meanings: 'Значения',
    foldAll: 'Свийте всички',
    openAll: 'Разгънете всички',
    on: 'Он',
    kun: 'Кун',
    exceptions: 'Изключения',
    exceptionsHint: 'четат се като цяла дума, не канджи по канджи',
    similar: 'Синоними',
    withMeaning: 'Със значение: {m}',
    openAt: 'Отворете {char} на това значение',
    mixups: 'Лесно се бъркат',
    mixupsHint: 'Други канджи със същото кун четене.',
    more_one: 'още {n} дума',
    more_other: 'още {n} думи',
    sound: 'Само заради звука',
    soundHint: 'В тези думи канджито не внася значение.',
  },
)

export function Meanings({
  page,
  self,
  onYomi,
  kunYomi,
  onKanji,
  onWordsWith,
  row,
}: {
  page: KanjiPage
  /** The page's kanji and what it means, for the mix-ups to name it beside the others. */
  self: KanjiLite
  onYomi: string[]
  kunYomi: string[]
  onKanji: (c: string) => void
  onWordsWith?: () => void
  /** The page's word row, so words look the same everywhere on it. */
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const link = (lang === 'bg' && page.linkBg) || page.link
  const [allFolded, setAllFolded] = useState(rememberedFold)
  // The cards turned the other way from all of them, on this kanji's page.
  const [turned, setTurned] = useState<{ char: string; ids: ReadonlySet<string> }>({ char: page.char, ids: new Set() })
  const ids = turned.char === page.char ? turned.ids : new Set<string>()
  const isOpen = (id: string) => allFolded === ids.has(id)
  const turn = (id: string, open: boolean) =>
    setTurned((was) => {
      const next = new Set(was.char === page.char ? was.ids : [])
      if (open === allFolded) next.add(id)
      else next.delete(id)
      return { char: page.char, ids: next }
    })
  const foldAll = (fold: boolean) => {
    setAllFolded(fold)
    setTurned({ char: page.char, ids: new Set() })
    try {
      if (fold) localStorage.setItem(FOLD_KEY, '1')
      else localStorage.removeItem(FOLD_KEY)
    } catch {
      // not remembered, which is fine
    }
  }

  // Opened from a "synonyms" row: that meaning opens, comes into view and glows a moment.
  useEffect(() => {
    const id = takeMeaningFocus(page.char)
    if (!id) return
    turn(id, true)
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(meaningAnchor(id))
      if (!card) return
      card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
      card.classList.remove('meaning-flash')
      void card.offsetWidth // so the glow starts again on a second visit
      card.classList.add('meaning-flash')
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per kanji
  }, [page.char])

  return (
    <div className="meanings">
      <ReadingsLine on={onYomi} kun={kunYomi} info={page.readings} />
      <h3 className="meanings-title">
        {t('meanings')}
        {page.meanings.length > 1 && (
          <button className="clear meanings-fold" onClick={() => foldAll(!allFolded)}>
            {t(allFolded ? 'openAll' : 'foldAll')}
          </button>
        )}
      </h3>
      {/* How they follow from each other, above them; the page opens with the kanji's gist (DetailPanel). */}
      {link && <p className="meanings-link">{link}</p>}

      {page.meanings.map((m, i) => (
        <Meaning
          key={m.id}
          m={m}
          n={i + 1}
          open={isOpen(m.id)}
          onToggle={() => turn(m.id, !isOpen(m.id))}
          self={self}
          onKanji={onKanji} onWordsWith={onWordsWith} row={row} />
      ))}

      {page.soundOnly && (
        <div className="meaning meaning-plain">
          <h4>{t('sound')}</h4>
          <p className="hint">{t('soundHint')}</p>
          <ul className="meaning-words">{page.soundOnly.words.map(row)}</ul>
        </div>
      )}

      <SpecialReadings words={page.special} row={row} />

      {page.mixups.length > 0 && (
        <div className="meaning-mixups">
          {page.mixups.map((x) => (
            <MixUpLine key={x.reading} x={x} self={self} onKanji={onKanji} />
          ))}
        </div>
      )}
    </div>
  )
}

function Meaning({
  m,
  n,
  open,
  onToggle,
  self,
  onKanji,
  onWordsWith,
  row,
}: {
  m: KanjiMeaning
  n: number
  /** Its words and the rest shown; folded, only its title and what it says. */
  open: boolean
  onToggle: () => void
  self: KanjiLite
  onKanji: (c: string) => void
  onWordsWith?: () => void
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const label = (lang === 'bg' && m.bg) || m.en
  const about = (lang === 'bg' && m.aboutBg) || m.about
  return (
    <article className="meaning" id={meaningAnchor(m.id)} data-folded={!open || undefined}>
      {/* Held to the top while the card is read: where you are. The whole of it folds the card. */}
      <header>
        <h4>
          <button className="meaning-toggle" aria-expanded={open} onClick={onToggle}>
            <span className="meaning-n">{n}</span>
            <span className="meaning-label">{label}</span>
            <svg className="meaning-caret" viewBox="0 0 12 12" aria-hidden>
              <path d="M4 2.5 7.5 6 4 9.5" />
            </svg>
          </button>
        </h4>
      </header>
      {about && <p className="meaning-about">{about}</p>}
      {open && <MeaningBody m={m} self={self} onKanji={onKanji} onWordsWith={onWordsWith} row={row} />}
    </article>
  )
}

/** A meaning's words by how they read the kanji, its synonyms and its mix-ups: what folds away. */
function MeaningBody({
  m,
  self,
  onKanji,
  onWordsWith,
  row,
}: {
  m: KanjiMeaning
  self: KanjiLite
  onKanji: (c: string) => void
  onWordsWith?: () => void
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const kun = m.kun?.words.slice(0, LANE_WORDS) ?? []
  const on = fewest(
    m.on.map((o) => o.words),
    LANE_WORDS,
  )
  // One word for a reading it has only now and then.
  const now = m.also.flatMap((a) => a.words.slice(0, 1))
  const more = m.total - kun.length - on.length - now.length - m.exceptions.length
  return (
    <>

      {/* Its words by how they read the kanji; each word says its own reading. */}
      {kun.length > 0 && (
        <div className="lane">
          <p className="lane-kind">{t('kun')}</p>
          <ul className="meaning-words">{kun.map(row)}</ul>
        </div>
      )}
      {on.length + now.length > 0 && (
        <div className="lane">
          <p className="lane-kind">{t('on')}</p>
          <ul className="meaning-words">{on.map(row)}</ul>
          {/* A reading it has in only a word or two: faded, so it does not read as a rule. */}
          {now.length > 0 && <ul className="meaning-words lane-now">{now.map(row)}</ul>}
        </div>
      )}
      {m.exceptions.length > 0 && (
        <div className="lane">
          <p className="lane-kind" title={t('exceptionsHint')}>
            {t('exceptions')}
          </p>
          <ul className="meaning-words">{m.exceptions.map(row)}</ul>
        </div>
      )}
      {more > 0 && onWordsWith && (
        <button className="clear meaning-more" onClick={onWordsWith}>
          {t.plural('more', more)} →
        </button>
      )}
      {m.similar.length > 0 && (
        <section className="aside-block meaning-similar">
          <AsideTitle icon="≈">{t('similar')}</AsideTitle>
          <ul>
            {m.similar.map((k) => (
              <CloseRow key={k.char} k={k} lang={lang} onKanji={onKanji} />
            ))}
          </ul>
        </section>
      )}
      {m.mixups.map((x) => (
        <MixUpLine key={x.reading} x={x} self={self} onKanji={onKanji} />
      ))}
    </>
  )
}

/**
 * 典 · Code · With the meaning: ceremony -- the kanji, its keyword, and the
 * meaning of it that is close to this one. The row opens the kanji at that meaning.
 */
function CloseRow({ k, lang, onKanji }: { k: CloseKanji; lang: Lang; onKanji: (c: string) => void }) {
  const t = S(lang)
  const keyword = meaningsOf(k, lang).value[0]
  const sense = k.sense && ((lang === 'bg' && k.sense.bg) || k.sense.en)
  return (
    <li>
      <button
        className="close-row"
        title={t('openAt', { char: k.char })}
        onClick={() => {
          if (k.sense) focusMeaningNext(k.char, k.sense.id)
          onKanji(k.char)
        }}
      >
        <span className="close-kanji" lang="ja">
          {k.char}
        </span>
        <span className="close-keyword">{keyword}</span>
        {sense && <span className="close-sense">{t('withMeaning', { m: sense })}</span>}
      </button>
    </li>
  )
}

/** A side block's title: its icon, then what it is -- ≈ synonyms, ! easy to mix up. */
function AsideTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="aside-title">
      <span className="aside-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </p>
  )
}

/**
 * (!) Easy to mix up: this kanji and the others with the same reading, one
 * item each -- the spelling, how it reads, the kanji's meaning on that
 * reading (揚: "raise, hoist", not its keyword) -- and, where the 異字同訓
 * card has them, what each is for and an example. A heading opens its
 * kanji; the page's own is marked, not a link.
 */
function MixUpLine({ x, self, onKanji }: { x: MixUp; self: KanjiLite; onKanji: (c: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const me = { ...self, sense: x.self }
  const items: { spelling: string; k: MixUp['kanji'][number] | undefined; spelled?: UsageCard['spellings'][number] }[] = x.usage
    ? x.usage.spellings.map((s) => ({
        spelling: s.kanji,
        k: s.kanji.includes(self.char) ? me : x.kanji.find((k) => s.kanji.includes(k.char)),
        spelled: s,
      }))
    : [me, ...x.kanji].map((k) => ({ spelling: k.char, k }))
  return (
    <section className="aside-block mixup" title={t('mixupsHint')}>
      <AsideTitle icon="!">{t('mixups')}</AsideTitle>
      <ul className="usage-spellings">
        {items.map(({ spelling, k, spelled }) => {
          const own = k?.char === self.char
          // Its meaning on this reading; the keyword where it has no meanings drawn up.
          const keyword = k && ((k.sense && ((lang === 'bg' && k.sense.bg) || k.sense.en)) || meaningsOf(k, lang).value[0])
          const head = (
            <>
              <span className="usage-spelling" lang="ja">
                {spelling}
              </span>
              <span className="usage-reading" lang="ja">
                {x.usage ? readingOf(spelling, x.usage.reading) : x.reading}
              </span>
              {keyword && <span className="usage-keyword">{keyword}</span>}
            </>
          )
          return (
            <li key={spelling} data-self={own || undefined}>
              {k && !own ? (
                <button className="usage-head" {...warmKanji(k.char)} onClick={() => onKanji(k.char)}>
                  {head}
                </button>
              ) : (
                <p className="usage-head">{head}</p>
              )}
              {spelled && <p className="spelling-def">{(lang === 'bg' && spelled.defBg) || spelled.defEn || spelled.def}</p>}
              {spelled?.examples.slice(0, 1).map((e) => (
                <p key={e.ja} className="usage-example">
                  <span lang="ja">{e.ja.replace(/\*/g, '')}</span> <span className="hint">{(lang === 'bg' && e.bg) || e.en}</span>
                </p>
              ))}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * How a spelling reads, of a card's readings: 揚がる・揚げる of あがる・あげる
 * is あがる・あげる, 上る of のぼる is のぼる -- each part by its okurigana.
 */
function readingOf(spelling: string, reading: string): string {
  const readings = reading.split('・')
  const parts = spelling.split('・').map((part) => {
    const okuri = part.match(/[ぁ-ゟ]*$/)?.[0] ?? ''
    return readings.find((r) => r.endsWith(okuri)) ?? readings[0]
  })
  return [...new Set(parts)].join('・')
}
