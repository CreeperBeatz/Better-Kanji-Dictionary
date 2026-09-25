/**
 * One dictionary entry in the rail, the way a pocket dictionary lays it out:
 * the word, its reading and accent, every sense, and then the kanji it is
 * written with -- each of which opens that character.
 */

import { useEffect, useState } from 'react'
import { api, type Word, type WordEntry } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { tagLabel } from '../i18n/grammar'
import { local } from '../local/local'
import { Pitch } from '../search/Pitch'
import { Valency } from '../search/Valency'

const S = strings(
  {
    amongFrequent: 'among the {n} most frequent words',
    common: 'common word',
    failed: 'This entry could not be loaded.',
    looking: 'looking',
    entryFor: 'Dictionary entry for {word}',
    open: 'Open {char}',
    notTranslated: 'not yet translated',
    machine: 'Bulgarian glosses are machine-translated',
    alsoWritten: 'also written',
    writtenWith: 'Written with',
    inSentence: 'In a sentence',
    needsConnection: 'Example sentences need a connection.',
    restFailed: 'The rest of this entry could not be loaded.',
  },
  {
    amongFrequent: 'сред {n}-те най-чести думи',
    common: 'честа дума',
    failed: 'Тази статия не можа да се зареди.',
    looking: 'зареждане',
    entryFor: 'Речникова статия за {word}',
    open: 'Отворете {char}',
    notTranslated: 'още не е преведено',
    machine: 'Българските значения са машинен превод',
    alsoWritten: 'пише се и',
    writtenWith: 'Пише се с',
    inSentence: 'В изречение',
    needsConnection: 'Примерните изречения изискват връзка с интернет.',
    restFailed: 'Останалата част от статията не можа да се зареди.',
  },
)

interface Props {
  id: number
  /** What the list already knew about the word, so the head renders at once. */
  word?: Word
  /** The kanji the word was opened from, if it was, to mark among its kanji. */
  from?: string
  onPick: (char: string) => void
  /** False where the head is drawn above the tabs instead, as on a phone. */
  head?: boolean
}

const KANJI = /[㐀-䶿一-鿿]/

/** JMdict nf buckets are 500 words wide. */
function rankOf(w: Word, lang: Lang): string | null {
  const t = S(lang)
  if (w.nf) return t('amongFrequent', { n: (w.nf * 500).toLocaleString(lang) })
  return w.common ? t('common') : null
}

/** A kanji's meaning in one line: Bulgarian when there is one, else the curated English. */
function kanjiMeaning(k: WordEntry['kanji'][number], lang: Lang): string {
  const m = meaningsOf(k, lang)
  if (!m.fallback && lang === 'bg') return m.value.slice(0, 3).join(', ')
  return k.curated ?? k.meanings.slice(0, 3).join(', ').toLowerCase()
}

/** Mark the word where it occurs in an example, so the eye lands on it. */
function Example({ text, hit }: { text: string; hit: [number, number] | null }) {
  if (!hit) return <>{text}</>
  return (
    <>
      {text.slice(0, hit[0])}
      <mark>{text.slice(hit[0], hit[1])}</mark>
      {text.slice(hit[1])}
    </>
  )
}

/**
 * The word, its reading and accent, and how common it is: the top of its
 * page. On a phone, where it stays above both tabs, it is `brief`: how common
 * the word is goes with the dictionary entry, and its first sense sits beside
 * it, as a kanji's meanings do.
 */
export function WordHead({ word: w, onPick, brief }: { word: Word; onPick: (char: string) => void; brief?: boolean }) {
  const lang = useLang()
  const t = S(lang)
  const rank = brief ? null : rankOf(w, lang)
  const head = (
    <>
      <h2 className="entry-head">
        {[...w.headword].map((ch, i) =>
          KANJI.test(ch) ? (
            <button key={i} className="entry-char" onClick={() => onPick(ch)} title={t('open', { char: ch })}>
              {ch}
            </button>
          ) : (
            <span key={i}>{ch}</span>
          ),
        )}
      </h2>
      <p className="entry-reading">
        {w.pitch ? <Pitch reading={w.reading} pitch={w.pitch} /> : w.reading}
        <Valency word={w} alone />
        {rank && <span className="entry-rank">{rank}</span>}
      </p>
    </>
  )
  if (!brief) return head
  const [lead, ...rest] = w.senses.length ? glossOf(w.senses[0], lang).value.split(';').map((g) => g.trim()) : []
  return (
    <div className="word-head">
      <div>{head}</div>
      {lead && (
        <p className="detail-meanings">
          {lead}
          {rest.length > 0 && <span className="rest">; {rest.join('; ')}</span>}
        </p>
      )}
    </div>
  )
}

export function WordPanel({ id, word, from, onPick, head = true }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [entry, setEntry] = useState<WordEntry | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stale = false
    setEntry(null)
    setFailed(false)
    // The device has everything but the example sentences, and answers
    // first; the server's full entry replaces it when it comes.
    local.wordEntry(id)?.then(
      (d) => !stale && d && setEntry((e) => e ?? d),
      () => {},
    )
    api.word(id).then(
      (d) => !stale && setEntry(d),
      () => !stale && setFailed(true),
    )
    return () => {
      stale = true
    }
  }, [id])

  const w = entry?.word ?? word
  if (!w) {
    return (
      <section className="rail-section word-panel">
        <p className="hint">{failed ? t('failed') : t('looking')}</p>
      </section>
    )
  }
  const others = w.forms.filter((f) => f.text !== w.headword && f.text !== w.reading)
  const glosses = w.senses.map((s) => glossOf(s, lang))
  const machine = lang === 'bg' && glosses.some((g) => !g.fallback)
  const rank = head ? null : rankOf(w, lang)

  return (
    <section className="rail-section word-panel" aria-label={t('entryFor', { word: w.headword })}>
      {head && <WordHead word={w} onPick={onPick} />}
      {rank && <p className="entry-rank entry-rank-line">{rank}</p>}

      <ol className="entry-senses">
        {w.senses.map((s, i) => (
          <li key={i}>
            {/* Part of speech only where it changes, as a printed dictionary does. */}
            {(s.pos.length > 0 || s.misc.length > 0) &&
              (i === 0 || s.pos.join() !== w.senses[i - 1].pos.join() || s.misc.length > 0) && (
                <p className="entry-pos">
                  {[...s.pos, ...s.misc].map((code, j) => {
                    const tag = tagLabel(code, lang)
                    return (
                      <span key={j}>
                        {j > 0 && ' · '}
                        <abbr title={tag.full}>{tag.short}</abbr>
                      </span>
                    )
                  })}
                </p>
              )}
            <p className="entry-gloss">
              {glosses[i].value.split(';').join('; ')}
              {glosses[i].fallback && (
                <span className="entry-fallback" title={t('notTranslated')}>
                  EN
                </span>
              )}
            </p>
          </li>
        ))}
      </ol>
      {machine && <p className="entry-machine">{t('machine')}</p>}

      {others.length > 0 && (
        <p className="entry-forms">
          <span>{t('alsoWritten')}</span>{' '}
          {others.map((f, i) => (
            <span key={i} className="entry-form" data-rare={f.rare || undefined}>
              {f.text}
            </span>
          ))}
        </p>
      )}

      {entry && entry.kanji.length > 0 && (
        <div className="entry-kanji">
          <h3>{t('writtenWith')}</h3>
          <ul>
            {entry.kanji.map((k) => (
              <li key={k.char}>
                <button
                  className="entry-kanji-glyph"
                  data-current={k.char === from || undefined}
                  onClick={() => onPick(k.char)}
                  title={t('open', { char: k.char })}
                >
                  {k.char}
                </button>
                <div>
                  <p className="entry-kanji-meaning">
                    {kanjiMeaning(k, lang)}
                    {k.jlpt && <span className="entry-kanji-level">N{k.jlpt}</span>}
                  </p>
                  <p className="entry-kanji-yomi">
                    {[...k.onYomi.slice(0, 2), ...k.kunYomi.slice(0, 2)].join('  ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry && entry.examples.length > 0 && (
        <div className="entry-examples">
          <h3>{t('inSentence')}</h3>
          <ul>
            {entry.examples.map((ex, i) => (
              <li key={i}>
                <Example text={ex.text} hit={ex.hit} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed && (
        <p className="hint">
          {entry ? t('needsConnection') : t('restFailed')}
        </p>
      )}
    </section>
  )
}
