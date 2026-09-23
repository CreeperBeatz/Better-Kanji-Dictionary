/**
 * One dictionary entry in the rail, the way a pocket dictionary lays it out:
 * the word, its reading and accent, every sense, and then the kanji it is
 * written with -- each of which opens that character.
 */

import { useEffect, useState } from 'react'
import { api, type Word, type WordEntry } from '../api'
import { local } from '../local/local'
import { Pitch } from '../search/Pitch'

interface Props {
  id: number
  /** What the list already knew about the word, so the head renders at once. */
  word?: Word
  /** The kanji the word was opened from, if it was, to mark among its kanji. */
  from?: string
  onPick: (char: string) => void
}

const KANJI = /[㐀-䶿一-鿿]/

/** JMdict nf buckets are 500 words wide. */
function rankOf(w: Word): string | null {
  if (w.nf) return `among the ${(w.nf * 500).toLocaleString()} most frequent words`
  return w.common ? 'common word' : null
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

export function WordPanel({ id, word, from, onPick }: Props) {
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
        <p className="hint">{failed ? 'This entry could not be loaded.' : 'looking'}</p>
      </section>
    )
  }
  const rank = rankOf(w)
  const others = w.forms.filter((f) => f.text !== w.headword && f.text !== w.reading)

  return (
    <section className="rail-section word-panel" aria-label={`Dictionary entry for ${w.headword}`}>

      <h2 className="entry-head">
        {[...w.headword].map((ch, i) =>
          KANJI.test(ch) ? (
            <button key={i} className="entry-char" onClick={() => onPick(ch)} title={`Open ${ch}`}>
              {ch}
            </button>
          ) : (
            <span key={i}>{ch}</span>
          ),
        )}
      </h2>
      <p className="entry-reading">
        {w.pitch ? <Pitch reading={w.reading} pitch={w.pitch} /> : w.reading}
        {rank && <span className="entry-rank">{rank}</span>}
      </p>

      <ol className="entry-senses">
        {w.senses.map((s, i) => (
          <li key={i}>
            {/* Part of speech only where it changes, as a printed dictionary does. */}
            {(s.pos.length > 0 || s.misc.length > 0) &&
              (i === 0 || s.pos.join() !== w.senses[i - 1].pos.join() || s.misc.length > 0) && (
                <p className="entry-pos">{[...s.pos, ...s.misc].join(' · ')}</p>
              )}
            <p className="entry-gloss">{s.gloss.split(';').join('; ')}</p>
          </li>
        ))}
      </ol>

      {others.length > 0 && (
        <p className="entry-forms">
          <span>also written</span>{' '}
          {others.map((f, i) => (
            <span key={i} className="entry-form" data-rare={f.rare || undefined}>
              {f.text}
            </span>
          ))}
        </p>
      )}

      {entry && entry.kanji.length > 0 && (
        <div className="entry-kanji">
          <h3>Written with</h3>
          <ul>
            {entry.kanji.map((k) => (
              <li key={k.char}>
                <button
                  className="entry-kanji-glyph"
                  data-current={k.char === from || undefined}
                  onClick={() => onPick(k.char)}
                  title={`Open ${k.char}`}
                >
                  {k.char}
                </button>
                <div>
                  <p className="entry-kanji-meaning">
                    {k.curated ?? k.meanings.slice(0, 3).join(', ').toLowerCase()}
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
          <h3>In a sentence</h3>
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
          {entry ? 'Example sentences need a connection.' : 'The rest of this entry could not be loaded.'}
        </p>
      )}
    </section>
  )
}
