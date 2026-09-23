/** The controls that sit over the stage in both views: trail, level filter, view switch. */

import type { ContainerFilter } from './graph/KanjiGraph'
import { strings, useLang } from './i18n'

export type StageView = 'focus' | 'map'

const S = strings(
  {
    all: 'all',
    common: 'common',
    allFocus: 'every character that contains this one',
    allMap: 'every character, 13k',
    commonFocus: 'only characters with a newspaper frequency rank',
    commonMap: 'the 2,501 newspaper-ranked characters and their parts',
    n1Focus: 'N1 and easier — the whole JLPT set',
    n1Map: 'the whole JLPT set and its parts',
    n2Focus: 'N2 and easier',
    n2Map: 'N2 and easier, and their parts',
    n3Focus: 'N3 and easier',
    n3Map: 'N3 and easier, and their parts',
    n4Focus: 'N5 and N4',
    n4Map: 'N5 and N4, and their parts',
    n5Focus: 'N5',
    n5Map: 'N5 and the parts it is built from',
    filterMap: 'Which characters the map shows',
    filterFocus: 'Which containing characters to show',
    recent: 'Recently opened',
    clearList: 'clear the list',
    view: 'View',
    focus: 'Focus',
    focusTitle: 'One character, what it is made of and what it builds (F)',
    map: 'Map',
    mapTitle: 'Every character at this level, to wander around in (M)',
  },
  {
    all: 'всички',
    common: 'чести',
    allFocus: 'всеки йероглиф, който съдържа този',
    allMap: 'всички йероглифи, 13 хил.',
    commonFocus: 'само йероглифи с честота във вестниците',
    commonMap: '2501-те най-чести във вестниците йероглифа и частите им',
    n1Focus: 'N1 и по-лесни — целият набор за JLPT',
    n1Map: 'целият набор за JLPT и частите му',
    n2Focus: 'N2 и по-лесни',
    n2Map: 'N2 и по-лесни, с частите им',
    n3Focus: 'N3 и по-лесни',
    n3Map: 'N3 и по-лесни, с частите им',
    n4Focus: 'N5 и N4',
    n4Map: 'N5 и N4, с частите им',
    n5Focus: 'N5',
    n5Map: 'N5 и частите, от които е изграден',
    filterMap: 'Кои йероглифи показва картата',
    filterFocus: 'Кои съдържащи йероглифи да се показват',
    recent: 'Последно отваряни',
    clearList: 'изчистете списъка',
    view: 'Изглед',
    focus: 'Фокус',
    focusTitle: 'Един йероглиф — от какво е съставен и какво изгражда (F)',
    map: 'Карта',
    mapTitle: 'Всички йероглифи от това ниво, за разходка (M)',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

const FILTERS: { value: ContainerFilter; label: Key | string; focus: Key; map: Key }[] = [
  { value: 'all', label: 'all', focus: 'allFocus', map: 'allMap' },
  { value: 'common', label: 'common', focus: 'commonFocus', map: 'commonMap' },
  // Widest first, like all and common before them.
  { value: 1, label: 'N1', focus: 'n1Focus', map: 'n1Map' },
  { value: 2, label: 'N2', focus: 'n2Focus', map: 'n2Map' },
  { value: 3, label: 'N3', focus: 'n3Focus', map: 'n3Map' },
  { value: 4, label: 'N4', focus: 'n4Focus', map: 'n4Map' },
  { value: 5, label: 'N5', focus: 'n5Focus', map: 'n5Map' },
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
  const t = S(useLang())
  return (
    <div className="filter" role="group" aria-label={t(view === 'map' ? 'filterMap' : 'filterFocus')}>
      {FILTERS.map((f) => (
        <button
          key={String(f.value)}
          data-on={filter === f.value}
          title={t(view === 'map' ? f.map : f.focus)}
          onClick={() => onFilter(f.value)}
        >
          {typeof f.value === 'number' ? f.label : t(f.label as Key)}
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
  const t = S(useLang())
  const newest = [...recent].reverse()
  return (
    <section className="rail-section">
      <h2>{t('recent')}</h2>
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
            {t('clearList')}
          </button>
        </p>
      )}
    </section>
  )
}

export function ViewSwitch({ view, onView }: { view: StageView; onView: (v: StageView) => void }) {
  const t = S(useLang())
  return (
    <div className="view-switch" role="tablist" aria-label={t('view')}>
      <button role="tab" aria-selected={view === 'focus'} onClick={() => onView('focus')} title={t('focusTitle')}>
        {t('focus')}
      </button>
      <button role="tab" aria-selected={view === 'map'} onClick={() => onView('map')} title={t('mapTitle')}>
        {t('map')}
      </button>
    </div>
  )
}
