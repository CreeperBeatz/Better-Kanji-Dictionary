import type { KanjiNode } from '../api'
import { levelOf } from '../detail/DetailPanel'

const HALF_WIDTH = 130

/**
 * What a touch screen shows while a character is pressed and held: the same
 * facts a mouse gets by hovering, which on a wide screen land in the rail.
 * Placed above the finger so the finger does not cover it.
 */
export function HoldCard({ node, x, y, width }: { node: KanjiNode; x: number; y: number; width: number }) {
  const [lead, ...rest] = node.meanings
  const left = Math.min(Math.max(x, HALF_WIDTH + 8), Math.max(HALF_WIDTH + 8, width - HALF_WIDTH - 8))
  return (
    <div className="hold-card" style={{ left, top: y - 28 }} role="tooltip">
      <div className="hold-card-head">
        <span className="hold-card-glyph">{node.char}</span>
        <p>
          {lead ?? 'no recorded meaning'}
          {rest.length > 0 && <span> {rest.slice(0, 3).join(', ')}</span>}
        </p>
      </div>
      <dl>
        {node.onYomi.length > 0 && (
          <>
            <dt>On</dt>
            <dd className="yomi">{node.onYomi.slice(0, 3).join('  ')}</dd>
          </>
        )}
        {node.kunYomi.length > 0 && (
          <>
            <dt>Kun</dt>
            <dd className="yomi">{node.kunYomi.slice(0, 3).join('  ')}</dd>
          </>
        )}
        {node.strokes != null && (
          <>
            <dt>Strokes</dt>
            <dd>{node.strokes}</dd>
          </>
        )}
        <dt>Level</dt>
        <dd>{levelOf(node)}</dd>
      </dl>
    </div>
  )
}
