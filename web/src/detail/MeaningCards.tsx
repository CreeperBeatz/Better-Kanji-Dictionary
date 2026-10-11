/**
 * A kanji's meanings, readings and words as one unit. Each meaning is a card:
 * what it is, then its words by how they read the kanji -- the kun words,
 * then the on words -- each word saying its own reading, so no reading is
 * named twice. An on reading the meaning has in only a word or two is faded
 * at the end of its on words; its special readings are its exceptions. Then
 * the kanji close to it in meaning, and the kanji easy to mix up on one of
 * its readings, with the 異字同訓 card that tells them apart.
 *
 * Above the cards: how the meanings follow from each other. Below them:
 * words where the kanji is there for its sound, the special readings, and
 * mix-ups on readings no meaning has. The words in no meaning group are not
 * here: "all words" has them.
 */
import type { ReactNode } from 'react'
import type { KanjiLite, KanjiMeaning, KanjiPage, MixUp, UsageCard, Word } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { SpecialReadings } from './Readings'

const S = strings(
  {
    title: 'Meanings and readings',
    on: 'On',
    kun: 'Kun',
    exceptions: 'Exceptions',
    exceptionsHint: 'read as one word, not kanji by kanji',
    similar: 'Close in meaning',
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
    title: 'Значения и четения',
    on: 'Он',
    kun: 'Кун',
    exceptions: 'Изключения',
    exceptionsHint: 'четат се като цяла дума, не канджи по канджи',
    similar: 'Близки по значение',
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
  onKanji,
  onWordsWith,
  row,
}: {
  page: KanjiPage
  onKanji: (c: string) => void
  onWordsWith?: () => void
  /** The page's word row, so words look the same everywhere on it. */
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const link = (lang === 'bg' && page.linkBg) || page.link

  return (
    <div className="meanings">
      <h3>{t('title')}</h3>
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
    <article className="meaning">
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
            <p className="meaning-similar">
              <span className="meaning-aside">{t('similar')}</span>
              {m.similar.map((k) => (
                <KanjiChip key={k.char} k={k} lang={lang} onKanji={onKanji} />
              ))}
            </p>
          )}
          {m.mixups.map((x) => (
            <MixUpLine key={x.reading} x={x} onKanji={onKanji} label />
          ))}
        </footer>
      )}
    </article>
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
