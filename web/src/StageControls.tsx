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
  { value: 5, label: 'N5', focus: 'N5', map: 'N5 and the parts it is built from' },
  { value: 4, label: 'N4', focus: 'N5 and N4', map: 'N5 and N4, and their parts' },
  { value: 3, label: 'N3', focus: 'N3 and easier', map: 'N3 and easier, and their parts' },
  { value: 2, label: 'N2', focus: 'N2 and easier', map: 'N2 and easier, and their parts' },
  { value: 1, label: 'N1', focus: 'N1 and easier — the whole JLPT set', map: 'the whole JLPT set and its parts' },
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

export function Trail({ trail, onPop }: { trail: string[]; onPop: (index: number) => void }) {
  if (trail.length < 2) return null
  return (
    <nav className="trail" aria-label="Where you came from">
      {trail.map((c, i) => (
        <button
          key={`${c}-${i}`}
          onClick={() => onPop(i)}
          disabled={i === trail.length - 1}
          aria-current={i === trail.length - 1 ? 'page' : undefined}
        >
          {c}
        </button>
      ))}
    </nav>
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
