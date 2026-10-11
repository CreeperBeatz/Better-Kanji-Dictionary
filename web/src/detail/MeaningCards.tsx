/**
 * A kanji's meanings, readings and words as one unit. Each meaning is a card:
 * what it is, then its words by how they read the kanji -- the kun words (its
 * kun readings with okurigana set apart and が or を), then one part per on
 * reading it has as a rule, in katakana. A reading it has in only a word or
 * two is a faded "also"; its special readings are its exceptions. Then the
 * kanji close to it in meaning, and the kanji easy to mix up on one of its
 * readings, with the 異字同訓 card that tells them apart.
 *
 * Above the cards: how the meanings follow from each other, and every reading
 * with the numbers of the meanings it is a rule in (ガク 1, ラク 2 3), which
 * lead to them. A rare reading, in no common word, is faded. Below them:
 * words where the kanji is there for its sound, the special readings, and
 * mix-ups on readings no meaning has. The words in no meaning group are not
 * here: "all words" has them.
 */
import type { ReactNode } from 'react'
import type { KanjiLite, KanjiMeaning, KanjiPage, MixUp, ReadingInfo, UsageCard, Word } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { ValencyMark } from '../search/Valency'
import { ReadingKana, SpecialReadings } from './Readings'

const S = strings(
  {
    title: 'Meanings and readings',
    on: 'On',
    kun: 'Kun',
    rare: 'Rare: no common word has this reading.',
    toMeaning: 'Go to meaning {n}',
    also: 'Also',
    exception: 'Exception',
    exceptionHint: 'read as one word, not kanji by kanji',
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
    rare: 'Рядко: нито една честа дума няма това четене.',
    toMeaning: 'Към значение {n}',
    also: 'Също',
    exception: 'Изключение',
    exceptionHint: 'чете се като цяла дума, не канджи по канджи',
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

const plain = (r: string) => r.replace(/^-+|-+$/g, '')

export function Meanings({
  page,
  onYomi,
  kunYomi,
  info,
  onWord,
  onKanji,
  onWordsWith,
  row,
}: {
  page: KanjiPage
  onYomi: string[]
  kunYomi: string[]
  info: Record<string, ReadingInfo>
  onWord: (w: Word) => void
  onKanji: (c: string) => void
  onWordsWith?: () => void
  /** The page's word row, so words look the same everywhere on it. */
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const on = new Set(onYomi.map(plain))
  const link = (lang === 'bg' && page.linkBg) || page.link
  const number = new Map(page.meanings.map((m, i) => [m.id, i + 1]))

  return (
    <div className="meanings">
      <h3>{t('title')}</h3>
      {link && <p className="meanings-link">{link}</p>}

      <div className="reading-index">
        {[
          ['on', onYomi],
          ['kun', kunYomi],
        ].map(
          ([kind, list]) =>
            list.length > 0 && (
              <p key={kind as string}>
                <span className="reading-kind">{t(kind as 'on' | 'kun')}</span>
                {[...new Set((list as string[]).map(plain))].map((r) => {
                  const rare = !info[r]?.common
                  // The meanings it is a rule in, by their numbers: ガク 1, ラク 2 3.
                  const where = page.map[r] ?? []
                  return (
                    <span key={r} className="reading-entry" data-rare={rare || undefined} title={rare ? t('rare') : undefined}>
                      <span className="reading-chip" lang="ja">
                        <ReadingKana r={r} on={kind === 'on'} />
                      </span>
                      {where.map((id) => (
                        <button key={id} className="reading-to" title={t('toMeaning', { n: number.get(id) ?? 0 })} onClick={() => scrollToMeaning(id)}>
                          {number.get(id)}
                        </button>
                      ))}
                    </span>
                  )
                })}
              </p>
            ),
        )}
      </div>

      {page.meanings.map((m, i) => (
        <Meaning key={m.id} m={m} n={i + 1} on={on} info={info} onWord={onWord} onKanji={onKanji} onWordsWith={onWordsWith} row={row} />
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

const meaningAnchor = (id: string) => `meaning-${id}`

function scrollToMeaning(id: string) {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById(meaningAnchor(id))?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}

function Meaning({
  m,
  n,
  on,
  info,
  onWord,
  onKanji,
  onWordsWith,
  row,
}: {
  m: KanjiMeaning
  n: number
  on: Set<string>
  info: Record<string, ReadingInfo>
  onWord: (w: Word) => void
  onKanji: (c: string) => void
  onWordsWith?: () => void
  row: (w: Word) => ReactNode
}) {
  const lang = useLang()
  const t = S(lang)
  const label = (lang === 'bg' && m.bg) || m.en
  const about = (lang === 'bg' && m.aboutBg) || m.about
  const shown = (m.kun?.words.length ?? 0) + m.on.reduce((k, o) => k + o.words.length, 0)
  const more = m.total - shown - m.exceptions.length
  return (
    <article className="meaning" id={meaningAnchor(m.id)}>
      <header>
        <span className="meaning-n">{n}</span>
        <h4>{label}</h4>
      </header>
      {about && <p className="meaning-about">{about}</p>}

      {/* Its words by how they read the kanji: in Japanese, then each Chinese reading it has as a rule. */}
      {m.kun && (
        <div className="lane">
          <p className="lane-head">
            <span className="lane-kind">{t('kun')}</span>
            <span className="lane-readings" lang="ja">
              {m.kun.readings.map((r) => {
                const formed = info[r]?.formed
                return (
                  <span key={r} className="meaning-reading">
                    {formed ? (
                      <button className="yomi-link" onClick={() => onWord(formed)}>
                        <ReadingKana r={r} on={false} />
                      </button>
                    ) : (
                      <ReadingKana r={r} on={false} />
                    )}
                    {formed && <ValencyMark word={formed} />}
                  </span>
                )
              })}
            </span>
          </p>
          <ul className="meaning-words">{m.kun.words.map(row)}</ul>
        </div>
      )}
      {m.on.map((o) => (
        <div key={o.reading} className="lane">
          <p className="lane-head">
            <span className="lane-kind">{t('on')}</span>
            <span className="lane-readings" lang="ja">
              <ReadingKana r={o.reading} on={on.has(o.reading)} />
            </span>
          </p>
          <ul className="meaning-words">{o.words.map(row)}</ul>
        </div>
      ))}
      {/* Now and then, not as a rule: faded, so it does not read as one. */}
      {m.also.map((a) => (
        <p key={a.reading} className="lane-also">
          {t('also')}{' '}
          <span lang="ja">
            <ReadingKana r={a.reading} on={on.has(a.reading)} />
          </span>
          {': '}
          {a.words.map((w, i) => (
            <span key={w.id}>
              {i > 0 && ', '}
              <button className="reading-example" lang="ja" onClick={() => onWord(w)} title={w.reading}>
                {w.headword}
              </button>
            </span>
          ))}
        </p>
      ))}
      {m.exceptions.length > 0 && (
        <div className="lane lane-exceptions">
          <p className="lane-head">
            <span className="lane-kind">{t('exception')}</span>
            <span className="hint">{t('exceptionHint')}</span>
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
