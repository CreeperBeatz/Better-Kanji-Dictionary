/** The controls that sit over the stage in both views: trail, level filter, view switch. */

import type { ContainerFilter } from './graph/KanjiGraph'

export type StageView = 'focus' | 'map'

const FILTERS: { value: ContainerFilter; label: string; focus: string; map: string }[] = [
  { value: 'all', label: 'all', focus: 'every character that contains this one', map: 'every character, 13k' },
  {
    value: 'common',
    label: 'common',
    focus: 'only characters with a newspaper frequency rank',
    map: 'the 2,501 newspaper-ranked characters and their parts',
  },
  // Widest first, like all and common before them.
  { value: 1, label: 'N1', focus: 'N1 and easier — the whole JLPT set', map: 'the whole JLPT set and its parts' },
  { value: 2, label: 'N2', focus: 'N2 and easier', map: 'N2 and easier, and their parts' },
  { value: 3, label: 'N3', focus: 'N3 and easier', map: 'N3 and easier, and their parts' },
  { value: 4, label: 'N4', focus: 'N5 and N4', map: 'N5 and N4, and their parts' },
  { value: 5, label: 'N5', focus: 'N5', map: 'N5 and the parts it is built from' },
]

export function LevelFilter({
  filter,
  view,
  note,
  onFilter,
}: {
  filter: ContainerFilter
  view: StageView
  note?: string
  onFilter: (f: ContainerFilter) => void
}) {
  return (
    <div
      className="filter"
      role="group"
      aria-label={view === 'map' ? 'Which characters the map shows' : 'Which containing characters to show'}
    >
      {FILTERS.map((f) => (
        <button
          key={String(f.value)}
          data-on={filter === f.value}
          title={view === 'map' ? f.map : f.focus}
          onClick={() => onFilter(f.value)}
        >
          {f.label}
        </button>
      ))}
      {note && <span className="filter-count">{note}</span>}
    </div>
  )
}

interface RecentProps {
  recent: string[]
  /** The character open now, if any. */
  current: string | null
  onPick: (char: string) => void
}

/** The Recent tab: everything opened, newest first. Opening one leaves the list as it is. */
export function RecentGrid({ recent, current, onPick, onClear }: RecentProps & { onClear: () => void }) {
  const newest = [...recent].reverse()
  return (
    <section className="rail-section">
      <h2>Recently opened</h2>
      <div className="recent-grid">
        {newest.map((c) => (
          <button
            key={c}
            className="recent-glyph"
            onClick={() => onPick(c)}
            aria-current={c === current ? 'page' : undefined}
          >
            {c}
          </button>
        ))}
      </div>
      {recent.length > 1 && (
        <p className="assoc-actions">
          <button className="clear" onClick={onClear}>
            clear the list
          </button>
        </p>
      )}
    </section>
  )
}

export function ViewSwitch({ view, onView }: { view: StageView; onView: (v: StageView) => void }) {
  return (
    <div className="view-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={view === 'focus'} onClick={() => onView('focus')} title="One character, what it is made of and what it builds (F)">
        Focus
      </button>
      <button role="tab" aria-selected={view === 'map'} onClick={() => onView('map')} title="Every character at this level, to wander around in (M)">
        Map
      </button>
    </div>
  )
}
