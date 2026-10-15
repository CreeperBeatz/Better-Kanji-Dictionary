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
 * you are without reading back.
 *
 * First its Readings, every one at a glance (a rare one, in no common word,
 * faded). Then its Meanings, opening with how they follow from each other,
 * then the cards. Below them:
 * words where the kanji is there for its sound, the special readings, and
 * mix-ups on readings no meaning has. The words in no meaning group are not
 * here: "all words" has them.
 */
import { useEffect, type ReactNode } from 'react'
import { reducedMotion } from '../media'
import type { CloseKanji, KanjiLite, KanjiMeaning, KanjiPage, MixUp, UsageCard, Word } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { focusMeaningNext, meaningAnchor, takeMeaningFocus } from './meaningFocus'
import { ReadingsLine, SpecialReadings } from './Readings'
import { warmKanji } from '../warm'

/** At most this many kun words, and on words, on a meaning's card. */
const LANE_WORDS = 3

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
    on: 'On',
    kun: 'Kun',
    exceptions: 'Exceptions',
    exceptionsHint: 'read as one word, not kanji by kanji',
    similar: 'Synonyms',
    withMeaning: 'With the meaning: {m}',
    openAt: 'Open {char} at this meaning',
    mixups: 'Easy to mix up',
    mixupsHint: 'Other kanji with the same kun reading.',
    tellApart: 'Which one to write',
    usageSource: 'From the Agency for Cultural Affairs’ list of kanji that share a reading (異字同訓).',
    more_one: '{n} more word',
    more_other: '{n} more words',
    sound: 'For its sound only',
    soundHint: 'In these words the kanji brings no meaning.',
  },
  {
    meanings: 'Значения',
    on: 'Он',
    kun: 'Кун',
    exceptions: 'Изключения',
    exceptionsHint: 'четат се като цяла дума, не канджи по канджи',
    similar: 'Синоними',
    withMeaning: 'Със значение: {m}',
    openAt: 'Отворете {char} на това значение',
    mixups: 'Лесно се бъркат',
    mixupsHint: 'Други канджи със същото кун четене.',
    tellApart: 'Кое да се пише',
    usageSource: 'От списъка на Агенцията по културата за канджи с еднакво четене (異字同訓).',
    more_one: 'още {n} дума',
    more_other: 'още {n} думи',
    sound: 'Само заради звука',
    soundHint: 'В тези думи канджито не внася значение.',
  },
)

export function Meanings({
  page,
  onYomi,
  kunYomi,
  onKanji,
  onWordsWith,
  row,
}: {
  page: KanjiPage
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
  // Opened from a "synonyms" row: that meaning comes into view and glows a moment.
  useEffect(() => {
    const id = takeMeaningFocus(page.char)
    const card = id && document.getElementById(meaningAnchor(id))
    if (!card) return
    card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
    card.classList.remove('meaning-flash')
    void card.offsetWidth // so the glow starts again on a second visit
    card.classList.add('meaning-flash')
  }, [page.char])

  return (
    <div className="meanings">
      <ReadingsLine on={onYomi} kun={kunYomi} info={page.readings} />
      <h3 className="meanings-title">{t('meanings')}</h3>
      {/* How they follow from each other, above them; the page opens with the kanji's gist (DetailPanel). */}
      {link && <p className="meanings-link">{link}</p>}

      {page.meanings.map((m, i) => (
        <Meaning key={m.id} m={m} n={i + 1} self={page.char} onKanji={onKanji} onWordsWith={onWordsWith} row={row} />
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
            <MixUpLine key={x.reading} x={x} self={page.char} onKanji={onKanji} />
          ))}
        </div>
      )}
    </div>
  )
}

function Meaning({
  m,
  n,
  self,
  onKanji,
  onWordsWith,
  row,
}: {
  m: KanjiMeaning
  n: number
  /** The page's kanji. */
  self: string
  onKanji: (c: string) => void
  onWordsWith?: () => void
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const label = (lang === 'bg' && m.bg) || m.en
  const about = (lang === 'bg' && m.aboutBg) || m.about
  const kun = m.kun?.words.slice(0, LANE_WORDS) ?? []
  const on = fewest(
    m.on.map((o) => o.words),
    LANE_WORDS,
  )
  // One word for a reading it has only now and then.
  const now = m.also.flatMap((a) => a.words.slice(0, 1))
  const more = m.total - kun.length - on.length - now.length - m.exceptions.length
  return (
    <article className="meaning" id={meaningAnchor(m.id)}>
      {/* Held to the top while the card is read: where you are. */}
      <header>
        <span className="meaning-n">{n}</span>
        <h4>{label}</h4>
      </header>
      {about && <p className="meaning-about">{about}</p>}

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
          <p className="lane-kind">
            {t('exceptions')} <span className="hint">{t('exceptionsHint')}</span>
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
    </article>
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

function KanjiChip({ k, lang, onKanji }: { k: KanjiLite; lang: Lang; onKanji: (c: string) => void }) {
  const meaning = meaningsOf(k, lang).value[0]
  return (
    <button className="kanji-chip" {...warmKanji(k.char)} onClick={() => onKanji(k.char)} title={meaning}>
      <span lang="ja">{k.char}</span>
      {meaning && <span className="kanji-chip-meaning">{meaning}</span>}
    </button>
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

/** (!) Easy to mix up · あげる: 挙 raise, 揚 hoist -- and, open, the card that says which one to write. */
function MixUpLine({ x, self, onKanji }: { x: MixUp; self: string; onKanji: (c: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  return (
    <section className="aside-block mixup" title={t('mixupsHint')}>
      <AsideTitle icon="!">
        {t('mixups')}
        <span className="mixup-reading" lang="ja">
          {x.reading}
        </span>
      </AsideTitle>
      <p className="mixup-kanji">
        {x.kanji.map((k) => (
          <KanjiChip key={k.char} k={k} lang={lang} onKanji={onKanji} />
        ))}
      </p>
      {x.usage && (
        <div className="usage">
          <p className="usage-title">{t('tellApart')}</p>
          <Usage card={x.usage} self={self} lang={lang} />
          <p className="hint">{t('usageSource')}</p>
        </div>
      )}
    </section>
  )
}

/** Each spelling with what it is for and an example, in the page's language; the page's own kanji marked. */
function Usage({ card, self, lang }: { card: UsageCard; self: string; lang: Lang }) {
  return (
    <dl className="usage-spellings">
      {card.spellings.map((s) => (
        <div key={s.kanji} data-self={s.kanji.includes(self) || undefined}>
          <dt lang="ja">{s.kanji}</dt>
          <dd>
            <p>{(lang === 'bg' && s.defBg) || s.defEn || s.def}</p>
            {s.examples.slice(0, 1).map((e) => (
              <p key={e.ja} className="usage-example">
                <span lang="ja">{e.ja.replace(/\*/g, '')}</span> <span className="hint">{(lang === 'bg' && e.bg) || e.en}</span>
              </p>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
