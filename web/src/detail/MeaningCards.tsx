/**
 * A kanji's meanings, readings and words as one unit. Each meaning is a card:
 * what it is, then its words by how they read the kanji -- the kun words,
 * then the on words -- each word saying its own reading, so no reading is
 * named twice. An on reading the meaning has in only a word or two is faded
 * at the end of its on words; its special readings are its exceptions. Then
 * the kanji close to it in meaning, and the kanji easy to mix up on one of
 * its readings, with the 異字同訓 card that tells them apart.
 *
 * First its Readings, every one at a glance (a rare one, in no common word,
 * faded). Then its Meanings, opening with how they follow from each other,
 * then the cards. Below them:
 * words where the kanji is there for its sound, the special readings, and
 * mix-ups on readings no meaning has. The words in no meaning group are not
 * here: "all words" has them.
 */
import { useEffect, type ReactNode } from 'react'
import type { CloseKanji, KanjiLite, KanjiMeaning, KanjiPage, MixUp, UsageCard, Word } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { focusMeaningNext, meaningAnchor, takeMeaningFocus } from './meaningFocus'
import { ReadingKana, SpecialReadings } from './Readings'

const S = strings(
  {
    readings: 'Readings',
    meanings: 'Meanings',
    on: 'On',
    kun: 'Kun',
    rare: 'Rare: no common word has this reading.',
    exceptions: 'Exceptions',
    exceptionsHint: 'read as one word, not kanji by kanji',
    similar: 'Close in meaning',
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
    readings: 'Четения',
    meanings: 'Значения',
    on: 'Он',
    kun: 'Кун',
    rare: 'Рядко: нито една честа дума няма това четене.',
    exceptions: 'Изключения',
    exceptionsHint: 'четат се като цяла дума, не канджи по канджи',
    similar: 'Близки по значение',
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

const plain = (r: string) => r.replace(/^-+|-+$/g, '')

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
  // Opened from a "close in meaning" row: that meaning comes into view and glows a moment.
  useEffect(() => {
    const id = takeMeaningFocus(page.char)
    const card = id && document.getElementById(meaningAnchor(id))
    if (!card) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
    card.classList.remove('meaning-flash')
    void card.offsetWidth // so the glow starts again on a second visit
    card.classList.add('meaning-flash')
  }, [page.char])

  return (
    <div className="meanings">
      <h3>{t('readings')}</h3>
      <div className="meanings-readings">
        {(
          [
            ['on', onYomi],
            ['kun', kunYomi],
          ] as const
        ).map(
          ([kind, list]) =>
            list.length > 0 && (
              <p key={kind}>
                <span className="lane-kind">{t(kind)}</span>
                {[...new Set(list.map(plain))].map((r) => {
                  const rare = !page.readings[r]?.common
                  return (
                    <span key={r} className="reading-chip" lang="ja" data-rare={rare || undefined} title={rare ? t('rare') : undefined}>
                      <ReadingKana r={r} on={kind === 'on'} />
                    </span>
                  )
                })}
              </p>
            ),
        )}
      </div>
      {/* The meanings, opening with how they follow from each other. */}
      <h3 className="meanings-title">{t('meanings')}</h3>
      {link && <p className="meanings-link">{link}</p>}

      {page.meanings.map((m, i) => (
        <Meaning key={m.id} m={m} n={i + 1} onKanji={onKanji} onWordsWith={onWordsWith} row={row} />
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
          <h4>{t('mixups')}</h4>
          <p className="hint">{t('mixupsHint')}</p>
          {page.mixups.map((x) => (
            <MixUpLine key={x.reading} x={x} onKanji={onKanji} />
          ))}
        </div>
      )}
    </div>
  )
}

function Meaning({
  m,
  n,
  onKanji,
  onWordsWith,
  row,
}: {
  m: KanjiMeaning
  n: number
  onKanji: (c: string) => void
  onWordsWith?: () => void
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const label = (lang === 'bg' && m.bg) || m.en
  const about = (lang === 'bg' && m.aboutBg) || m.about
  const on = m.on.flatMap((o) => o.words)
  const now = m.also.flatMap((a) => a.words)
  const more = m.total - (m.kun?.words.length ?? 0) - on.length - now.length - m.exceptions.length
  return (
    <article className="meaning" id={meaningAnchor(m.id)}>
      <header>
        <span className="meaning-n">{n}</span>
        <h4>{label}</h4>
      </header>
      {about && <p className="meaning-about">{about}</p>}

      {/* Its words by how they read the kanji; each word says its own reading. */}
      {m.kun && (
        <div className="lane">
          <p className="lane-kind">{t('kun')}</p>
          <ul className="meaning-words">{m.kun.words.map(row)}</ul>
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
          {t(more === 1 ? 'more_one' : 'more_other', { n: more })} →
        </button>
      )}
      {(m.similar.length > 0 || m.mixups.length > 0) && (
        <footer>
          {m.similar.length > 0 && (
            <div className="meaning-similar">
              <p className="meaning-aside">{t('similar')}</p>
              <ul>
                {m.similar.map((k) => (
                  <CloseRow key={k.char} k={k} lang={lang} onKanji={onKanji} />
                ))}
              </ul>
            </div>
          )}
          {m.mixups.map((x) => (
            <MixUpLine key={x.reading} x={x} onKanji={onKanji} label />
          ))}
        </footer>
      )}
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
    <button className="kanji-chip" onClick={() => onKanji(k.char)} title={meaning}>
      <span lang="ja">{k.char}</span>
      {meaning && <span className="kanji-chip-meaning">{meaning}</span>}
    </button>
  )
}

/** あげる: 挙 raise, 揚 hoist -- and, folded, the card that says which one to write. */
function MixUpLine({ x, onKanji, label = false }: { x: MixUp; onKanji: (c: string) => void; label?: boolean }) {
  const lang = useLang()
  const t = S(lang)
  return (
    <div className="mixup">
      <p>
        {label && <span className="meaning-aside">{t('mixups')}</span>}
        <span className="mixup-reading" lang="ja">
          {x.reading}
        </span>
        {x.kanji.map((k) => (
          <KanjiChip key={k.char} k={k} lang={lang} onKanji={onKanji} />
        ))}
      </p>
      {x.usage && (
        <details className="usage">
          <summary>{t('tellApart')}</summary>
          <Usage card={x.usage} lang={lang} />
          <p className="hint">{t('usageSource')}</p>
        </details>
      )}
    </div>
  )
}

/** Each spelling with what it is for and an example or two, in the page's language. */
function Usage({ card, lang }: { card: UsageCard; lang: Lang }) {
  return (
    <dl className="usage-spellings">
      {card.spellings.map((s) => (
        <div key={s.kanji}>
          <dt lang="ja">{s.kanji}</dt>
          <dd>
            <p>{(lang === 'bg' && s.defBg) || s.defEn || s.def}</p>
            {s.examples.slice(0, 2).map((e) => (
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
