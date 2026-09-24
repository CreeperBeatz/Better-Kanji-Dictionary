/** The controls that sit over the stage in both views: trail, level filter, view switch. */

import { useLayoutEffect, useRef, useState } from 'react'
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
    n1Focus: 'N1 and easier - the whole JLPT set',
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
    view: 'View',
    focus: 'Components',
    focusTitle: 'One character, what it is made of and what it builds (D)',
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
    n1Focus: 'N1 и по-лесни - целият набор за JLPT',
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
    view: 'Изглед',
    focus: 'Компоненти',
    focusTitle: 'Един йероглиф - от какво е съставен и какво изгражда (D)',
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
  onFilter,
}: {
  filter: ContainerFilter
  view: StageView
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
    </div>
  )
}

/** A character with what it is made of and what it builds. */
function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M8 8V3M8 8l-4.5 3.5M8 8l4.5 3.5" />
      <circle cx="8" cy="8" r="2.4" className="solid" />
      <circle cx="8" cy="2.6" r="1.5" />
      <circle cx="3.2" cy="12" r="1.5" />
      <circle cx="12.8" cy="12" r="1.5" />
    </svg>
  )
}

/** A field of characters. */
function MapIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="solid">
      {[3, 8, 13].flatMap((y) => [3, 8, 13].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" />))}
    </svg>
  )
}

/** Labelled whenever the labels fit beside the rest of the row it sits in,
    icons alone when they do not; the labels stay for screen readers and the
    titles on hover either way. */
export function ViewSwitch({ view, onView }: { view: StageView; onView: (v: StageView) => void }) {
  const t = S(useLang())
  const own = useRef<HTMLDivElement>(null)
  // An invisible labelled copy, so the width the labels need is known while
  // they are hidden, and follows the language and the font as they load.
  const labelled = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)

  useLayoutEffect(() => {
    const el = own.current
    const row = el?.parentElement
    const copy = labelled.current
    if (!el || !row || !copy) return
    const check = () => {
      const s = getComputedStyle(row)
      const gap = parseFloat(s.columnGap) || 0
      const room = row.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
      let used = copy.getBoundingClientRect().width
      for (const c of row.children) if (c !== el) used += c.getBoundingClientRect().width + gap
      setFits(used <= room)
    }
    const watch = new ResizeObserver(check)
    watch.observe(row)
    watch.observe(copy)
    for (const c of row.children) if (c !== el) watch.observe(c)
    return () => watch.disconnect()
  }, [])

  const buttons = (live: boolean) => (
    <>
      <button
        role={live ? 'tab' : undefined}
        aria-selected={live ? view === 'focus' : undefined}
        onClick={live ? () => onView('focus') : undefined}
        title={live ? t('focusTitle') : undefined}
        tabIndex={live ? undefined : -1}
      >
        <FocusIcon />
        <span className="view-label">{t('focus')}</span>
      </button>
      <button
        role={live ? 'tab' : undefined}
        aria-selected={live ? view === 'map' : undefined}
        onClick={live ? () => onView('map') : undefined}
        title={live ? t('mapTitle') : undefined}
        tabIndex={live ? undefined : -1}
      >
        <MapIcon />
        <span className="view-label">{t('map')}</span>
      </button>
    </>
  )

  return (
    <div ref={own} className="view-switch" role="tablist" aria-label={t('view')} data-compact={!fits || undefined}>
      {buttons(true)}
      <div ref={labelled} className="view-switch view-switch-measure" aria-hidden inert>
        {buttons(false)}
      </div>
    </div>
  )
}
