import { useEffect, useState } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from '../api'
import { StrokeOrder } from './StrokeOrder'

interface Props {
  data: GraphResponse
  hovered: KanjiNode | null
  onPick: (char: string) => void
}

function levelOf(n: KanjiNode): string | null {
  if (n.jlpt) return `JLPT N${n.jlpt}`
  if (n.grade && n.grade <= 6) return `learned in grade ${n.grade}`
  if (n.joyo) return 'jōyō, secondary school'
  if (!n.inKanjidic) return 'bound form, not a standalone character'
  return 'outside the jōyō list'
}

export function DetailPanel({ data, hovered, onPick }: Props) {
  const [words, setWords] = useState<Word[]>([])

  // Vocabulary follows the focus, not the hover -- otherwise it would thrash
  // as the cursor crosses the graph.
  useEffect(() => {
    let stale = false
    setWords([])
    api.wordsFor(data.focus.char).then(
      (d) => !stale && setWords(d.words),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [data.focus.char])

  // Hovering a node previews it without disturbing the graph; the focus is what
  // you see when nothing is under the cursor.
  const n = hovered ?? data.focus
  const isPreview = hovered !== null && hovered.char !== data.focus.char

  const [lead, ...rest] = n.meanings
  const level = levelOf(n)

  return (
    <section className="rail-section">
      <div className="detail-head">
        <span className="detail-glyph">{n.char}</span>
        <div>
          <p className="detail-meanings">
            {lead ?? 'no recorded meaning'}
            {rest.length > 0 && <span className="rest"> {rest.slice(0, 5).join(', ')}</span>}
          </p>
        </div>
      </div>

      <dl className="facts">
        {n.onYomi.length > 0 && (
          <>
            <dt>On</dt>
            <dd className="yomi">{n.onYomi.slice(0, 4).join('  ')}</dd>
          </>
        )}
        {n.kunYomi.length > 0 && (
          <>
            <dt>Kun</dt>
            <dd className="yomi">{n.kunYomi.slice(0, 4).join('  ')}</dd>
          </>
        )}
        {n.strokes != null && (
          <>
            <dt>Strokes</dt>
            <dd>{n.strokes}</dd>
          </>
        )}
        {n.freq != null && (
          <>
            <dt>Frequency</dt>
            <dd>{n.freq} in newspapers</dd>
          </>
        )}
        {level && (
          <>
            <dt>Level</dt>
            <dd>{level}</dd>
          </>
        )}
      </dl>

      {(n.fanout ?? 0) > 0 && (
        <p className="fanout-line">
          Appears inside <b>{n.fanout}</b> jōyō {n.fanout === 1 ? 'character' : 'characters'}.
        </p>
      )}

      {!isPreview && <StrokeOrder char={data.focus.char} strokes={data.strokes} />}

      {!isPreview && words.length > 0 && (
        <div className="vocab">
          <h3>Words using {data.focus.char}</h3>
          <ul>
            {words.slice(0, 8).map((w) => (
              <li key={w.id}>
                <button className="vocab-word" onClick={() => onPick(data.focus.char)}>
                  {w.headword}
                </button>
                <span className="vocab-reading">{w.reading}</span>
                <span className="vocab-gloss">{w.senses[0]?.gloss.split(';')[0]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isPreview && (
        <p className="fanout-line">
          Built from <b>{data.counts.components}</b>{' '}
          {data.counts.components === 1 ? 'part' : 'parts'}
          {data.counts.maxDepth > 1 && ` across ${data.counts.maxDepth} levels`}.
          {data.counts.containers > 0 && (
            <>
              {' '}
              Contained by <b>{data.counts.containers}</b>, of which{' '}
              <b>{data.counts.containersJoyo}</b> are jōyō.
            </>
          )}
        </p>
      )}
    </section>
  )
}
