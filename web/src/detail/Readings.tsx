/**
 * A kanji's readings on its page, one line each: the reading, its okurigana
 * set apart (あ・げる), for a kun reading what the word it forms means and が
 * or を, and the commonest words read that way (以上, 屋上 for じょう). A reading no
 * common word uses is dimmed: シャン on 上 is there, but rare.
 *
 * And its special readings, after the words: whole words read in a way the
 * single kanji don't explain -- 今日 きょう, 大人 おとな, 下手 へた.
 */
import type { ReactNode } from 'react'
import type { ReadingInfo, Word } from '../api'
import { strings, useLang } from '../i18n'
import { glossOf } from '../i18n/content'
import { hiraganaToKatakana, plainReading as plain } from '../local/japanese'
import { ValencyMark } from '../search/Valency'
import { warmWord } from '../warm'

const S = strings(
  {
    title: 'Readings',
    on: 'On',
    kun: 'Kun',
    rare: 'Rare: no common word has this reading.',
    open: 'Open {word}, read {reading}',
    special: 'Special readings',
    specialHint: 'Read as one word, not kanji by kanji.',
  },
  {
    title: 'Четения',
    on: 'Он',
    kun: 'Кун',
    rare: 'Рядко: нито една честа дума няма това четене.',
    open: 'Отворете {word}, четено {reading}',
    special: 'Особени четения',
    specialHint: 'Четат се като цяла дума, не канджи по канджи.',
  },
)

/** A reading as printed: on in katakana, kun with its okurigana set apart (あ・げる). */
export function ReadingKana({ r, on }: { r: string; on: boolean }) {
  if (on) return <>{hiraganaToKatakana(r)}</>
  const [stem, okuri] = r.split('.')
  return (
    <>
      {stem}
      {okuri && <span className="okuri">{okuri}</span>}
    </>
  )
}

/**
 * Every reading at a glance, one line each kind: on, then kun, a rare one
 * faded. Above a kanji's meanings, which give the words.
 */
export function ReadingsLine({ on, kun, info }: { on: string[]; kun: string[]; info: Record<string, ReadingInfo> }) {
  const t = S(useLang())
  return (
    <>
      <h3>{t('title')}</h3>
      <div className="meanings-readings">
        {(
          [
            ['on', on],
            ['kun', kun],
          ] as const
        ).map(
          ([kind, list]) =>
            list.length > 0 && (
              <p key={kind}>
                <span className="lane-kind">{t(kind)}</span>
                {[...new Set(list.map(plain))].map((r) => {
                  const rare = !info[r]?.common
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
    </>
  )
}

export function Readings({
  on,
  kun,
  info,
  full,
  onWord,
}: {
  on: string[]
  kun: string[]
  /** Per reading; null while on the way. */
  info: Record<string, ReadingInfo> | null
  /** Whether `info` counts each reading's words. Offline it has only the word each forms. */
  full: boolean
  onWord: (w: Word) => void
}) {
  const t = S(useLang())
  if (!on.length && !kun.length) return null
  return (
    <div className="readings">
      <h3>{t('title')}</h3>
      {on.length > 0 && <ReadingGroup label={t('on')} list={on} info={info} full={full} onWord={onWord} />}
      {kun.length > 0 && <ReadingGroup label={t('kun')} list={kun} info={info} full={full} onWord={onWord} kun />}
    </div>
  )
}

function ReadingGroup({
  label,
  list,
  info,
  full,
  onWord,
  kun = false,
}: {
  label: string
  list: string[]
  info: Record<string, ReadingInfo> | null
  full: boolean
  onWord: (w: Word) => void
  kun?: boolean
}) {
  const lang = useLang()
  const t = S(lang)
  // うえ and -うえ are one line.
  const readings = [...new Set(list.map(plain))]
  return (
    <div className="reading-group">
      <span className="reading-kind">{label}</span>
      <ul>
        {readings.map((r) => {
          const it = info?.[r]
          const formed = it?.formed ?? null
          const rare = full && !it?.common
          const kana = <ReadingKana r={r} on={!kun} />
          return (
            <li key={r} className="reading-row" data-rare={rare || undefined}>
              <span className="reading-kana" lang="ja" title={rare ? t('rare') : undefined}>
                {formed ? (
                  <button className="yomi-link" {...warmWord(formed.id)} onClick={() => onWord(formed)} title={t('open', { word: formed.headword, reading: formed.reading })}>
                    {kana}
                  </button>
                ) : (
                  kana
                )}
              </span>
              <span className="reading-about">
                {/* An on reading's own word (上 read じょう) rarely means what the kanji does: its words say it. */}
                {kun && formed?.senses[0] && <span className="reading-gloss">{glossOf(formed.senses[0], lang).value.split(';')[0]}</span>}
                {kun && formed && <ValencyMark word={formed} />}
                {it?.examples.map((w) => (
                  <button
                    key={w.id}
                    className="reading-example"
                    lang="ja"
                    {...warmWord(w.id)}
                    onClick={() => onWord(w)}
                    title={t('open', { word: w.headword, reading: w.reading })}
                  >
                    {w.headword}
                  </button>
                ))}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Whole words with a reading of their own, each as the page's word rows show words. */
export function SpecialReadings({ words, row }: { words: Word[]; row: (w: Word) => ReactNode }) {
  const t = S(useLang())
  if (!words.length) return null
  return (
    <div className="vocab special-readings">
      <h3 title={t('specialHint')}>{t('special')}</h3>
      <ul>{words.map(row)}</ul>
    </div>
  )
}
