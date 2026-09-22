import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from './api'
import { KanjiGraph, keeps, type ContainerFilter } from './graph/KanjiGraph'
import { KanjiMap } from './map/KanjiMap'
import { scopeOf } from './map/mapData'
import { SearchOverlay } from './search/SearchOverlay'
import { Associations } from './detail/Associations'
import { AccountDialog, ProfileButton } from './account/Account'
import { clearAuthError, startAuth, useAuth } from './account/auth'
import { DetailPanel } from './detail/DetailPanel'
import { WordPanel } from './detail/WordPanel'
import { RailResizer, useRailWidth } from './RailResizer'
import { LevelFilter, RecentGrid, ViewSwitch, type StageView } from './StageControls'
import { useRecent } from './recent'

const START = '言'
const VIEW_KEY = 'betterrtk:view'

// Matches the narrow layout in theme.css.
const MOBILE = '(max-width: 900px)'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

const RAIL_TAB_KEY = 'betterrtk:railTab'
type RailTab = 'kanji' | 'associations' | 'recent'

function initialRailTab(): RailTab {
  try {
    const saved = localStorage.getItem(RAIL_TAB_KEY)
    return saved === 'associations' || saved === 'recent' ? saved : 'kanji'
  } catch {
    return 'kanji'
  }
}

// The selected character lives in the URL, so it can be linked to and the
// browser's back button walks between characters.
const KANJI_PATH = /^\/kanji\/([^/]+)\/?$/
const TITLE = document.title

function kanjiInUrl(): string | null {
  const m = window.location.pathname.match(KANJI_PATH)
  if (!m) return null
  try {
    const c = decodeURIComponent(m[1])
    return [...c].length === 1 ? c : null
  } catch {
    return null
  }
}

function urlFor(char: string | null): string {
  return char ? `/kanji/${encodeURIComponent(char)}` : '/'
}

// A desktop opens on the whole common map with nothing picked, to wander in;
// a phone opens on the character and view it was left on. A link to a
// character opens on that character either way, in the focus view.
const openedOnPhone = window.matchMedia(MOBILE).matches
const linked = kanjiInUrl()

function initialView(): StageView {
  if (linked) return 'focus'
  if (!openedOnPhone) return 'map'
  try {
    return localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'focus'
  } catch {
    return 'focus'
  }
}

export function App() {
  // Every character you have opened, listed in the Recent tab.
  const { recent, focus, visit, back, clear: clearRecent } = useRecent(START, linked)
  // Clicking empty map clears the selection; the recent list is kept, so it
  // or any pick brings a character back.
  const [selected, setSelected] = useState(openedOnPhone || linked !== null)
  const [data, setData] = useState<GraphResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  // How to read the graph or map, behind the (i) rather than always on screen.
  const [legendOpen, setLegendOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const { error: authError } = useAuth()
  // A sign-in link that did not work says why, where you would try again.
  const accountShown = accountOpen || authError !== null
  const [filter, setFilter] = useState<ContainerFilter>(openedOnPhone ? 'all' : 'common')
  const [view, setViewState] = useState<StageView>(initialView)
  // The map is expensive to lay out, so once opened it stays mounted and keeps
  // its camera while the focus view is showing.
  const [mapOpened, setMapOpened] = useState(view === 'map')
  // A word open in the rail, and the kanji it was opened from.
  const [word, setWord] = useState<{ word: Word; from: string } | null>(null)
  const [railWidth, setRailWidth] = useRailWidth()
  const [railTab, setRailTab] = useState<RailTab>(initialRailTab)
  const [assocCount, setAssocCount] = useState(0)

  // On a phone the rail and the stage cannot both have room, so one fills the
  // screen at a time and Focus and Map join the rail's tabs.
  const mobile = useMediaQuery(MOBILE)
  const [pane, setPane] = useState<'rail' | 'stage'>('rail')
  const onStage = mobile && pane === 'stage'

  const chooseRailTab = useCallback((t: RailTab) => {
    setRailTab(t)
    setPane('rail')
    try {
      localStorage.setItem(RAIL_TAB_KEY, t)
    } catch {
      // not remembered, which is fine
    }
  }, [])

  const setView = useCallback((v: StageView) => {
    setViewState(v)
    setPane('stage')
    if (v === 'map') setMapOpened(true)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // not remembered, which is fine
    }
  }, [])


  // Opening a character is a new history entry; the first one only records
  // where the app opened, so Back still leaves it.
  const urlSynced = useRef(false)
  useEffect(() => {
    const path = urlFor(selected ? focus : null)
    document.title = selected ? `${focus} · ${TITLE}` : TITLE
    if (window.location.pathname === path) {
      urlSynced.current = true
      return
    }
    const url = path + window.location.search + window.location.hash
    if (urlSynced.current) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    urlSynced.current = true
  }, [focus, selected])

  // Back and forward: whatever the URL now names is what is selected.
  useEffect(() => {
    function onPop() {
      const c = kanjiInUrl()
      setHovered(null)
      setWord(null)
      if (c) {
        visit(c)
        setSelected(true)
      } else {
        setSelected(false)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [visit])

  // Picks up a sign-in link in the URL, or a session saved from last time.
  useEffect(() => {
    startAuth()
  }, [])

  useEffect(() => {
    let stale = false
    api.kanji(focus).then(
      (d) => {
        if (stale) return
        setData(d)
        setError(null)
      },
      (e) => !stale && setError(String(e.message ?? e)),
    )
    return () => {
      stale = true
    }
  }, [focus])

  // `via` is the container a peek skipped through (言 -> 語 -> X), which counts
  // as visited too.
  const drill = useCallback(
    (char: string, via?: string) => {
      setHovered(null)
      setWord(null)
      setSelected(true)
      if (via && via !== char) visit(via, char)
      else visit(char)
    },
    [visit],
  )

  const openRecent = useCallback(
    (char: string) => {
      drill(char)
      // From the Recent tab, the character is what you came for.
      setRailTab((t) => (t === 'recent' ? 'kanji' : t))
    },
    [drill],
  )

  const deselect = useCallback(() => {
    setHovered(null)
    setWord(null)
    setSelected(false)
  }, [])

  // A word shows where the kanji's details do.
  const openWord = useCallback(
    (w: Word) => {
      setWord({ word: w, from: focus })
      setRailTab('kanji')
      setPane('rail')
    },
    [focus],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      // Slash and ctrl/cmd-K are what people already reach for.
      if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('.overlay')) return
      if (e.key === 'Escape') setLegendOpen(false)
      if (e.key === 'm' || e.key === 'M') setView('map')
      if (e.key === 'f' || e.key === 'F') setView('focus')
      // Backspace walks back -- first out of an open word, then to the
      // character before this one in the recent list. Escape is left to
      // whichever overlay is open.
      if (e.key === 'Backspace') {
        e.preventDefault()
        setWord((w) => {
          if (!w) {
            setSelected(true)
            back()
          }
          return null
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, back])

  const closeAccount = useCallback(() => {
    setAccountOpen(false)
    clearAuthError()
  }, [])

  const hoveredNode: KanjiNode | null = useMemo(() => {
    if (!data || !hovered) return null
    if (hovered === data.focus.char) return data.focus
    return (
      data.containers.find((n) => n.char === hovered) ??
      data.components.nodes.find((n) => n.char === hovered) ??
      null
    )
  }, [data, hovered])

  const dimmed = searchOpen || accountShown

  return (
    <div className="shell">
      <div
        className="shell-grid"
        data-dimmed={dimmed || undefined}
        data-pane={mobile ? pane : undefined}
        style={{ '--rail': `${railWidth}px` } as React.CSSProperties}
      >
        <aside className="rail">
          <div className="rail-section rail-top">
            <div className="rail-search-row">
              <button className="search-trigger" onClick={() => setSearchOpen(true)}>
                <span>Search, or browse a level</span>
                <kbd>/</kbd>
              </button>
              {mobile && <ProfileButton onOpen={() => setAccountOpen(true)} />}
            </div>
            <div className="rail-tabs" role="tablist" aria-label="Side panel">
              {selected && data && (
                <>
                  <button
                    role="tab"
                    aria-selected={!onStage && railTab === 'kanji'}
                    onClick={() => chooseRailTab('kanji')}
                  >
                    {data.focus.char} <span>kanji</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={!onStage && railTab === 'associations'}
                    onClick={() => chooseRailTab('associations')}
                  >
                    Associations
                    {assocCount > 0 && <span className="rail-tab-count">{assocCount}</span>}
                  </button>
                </>
              )}
              {mobile && (
                <>
                  <button role="tab" aria-selected={onStage && view === 'focus'} onClick={() => setView('focus')}>
                    Focus
                  </button>
                  <button role="tab" aria-selected={onStage && view === 'map'} onClick={() => setView('map')}>
                    Map
                  </button>
                </>
              )}
              <button role="tab" aria-selected={!onStage && railTab === 'recent'} onClick={() => chooseRailTab('recent')}>
                Recent
              </button>
            </div>
          </div>

          {railTab === 'recent' ? (
            <RecentGrid recent={recent} current={selected ? focus : null} onPick={openRecent} onClear={clearRecent} />
          ) : !selected ? (
            <section className="rail-section">
              <p className="hint">Select a kanji</p>
            </section>
          ) : (
            <>
              {/* Kept mounted while hidden, so an unsent association and the
                  count on its tab survive switching tabs. */}
              {data && (
                <div hidden={railTab !== 'associations'}>
                  <Associations
                    char={data.focus.char}
                    onPick={drill}
                    onSignIn={() => setAccountOpen(true)}
                    onCount={setAssocCount}
                  />
                </div>
              )}
              {railTab === 'kanji' &&
                (word ? (
                  <WordPanel
                    word={word.word}
                    from={word.from}
                    onBack={() => setWord(null)}
                    onPick={(c) => (c === focus ? setWord(null) : drill(c))}
                  />
                ) : (
                  data && <DetailPanel data={data} hovered={hoveredNode} onWord={openWord} />
                ))}
            </>
          )}
          {/* "Its parts" -- the decomposition editor and review queue -- is
              hidden for now. src/review/DecompPanel.tsx and the /api/decomp
              routes are untouched, so putting it back is one line. */}
        </aside>
        <RailResizer width={railWidth} onWidth={setRailWidth} />

        <main className="stage">
          {error && (
            <div className="stage-empty">
              <p>
                {error}
                <br />
                <span className="hint">
                  Start the server with{' '}
                  <code>.venv/Scripts/uvicorn server.app:app --port 8000</code>
                </span>
              </p>
            </div>
          )}

          {!error && !selected && view === 'focus' && (
            <div className="stage-empty">
              <p className="hint">Select a kanji</p>
            </div>
          )}

          {!error && data && selected && view === 'focus' && (
            <KanjiGraph data={data} filter={filter} onDrill={drill} onHover={setHovered} legend={legendOpen} />
          )}

          {!error && mapOpened && (
            <div className="map-host" hidden={view !== 'map'}>
              <KanjiMap
                scope={scopeOf(filter)}
                focus={selected ? focus : null}
                focusNode={selected ? (data?.focus ?? null) : null}
                onSelect={drill}
                onDeselect={deselect}
                onOpen={() => setView('focus')}
                onScope={setFilter}
                legend={legendOpen && view === 'map'}
              />
            </div>
          )}

          {!error && (
            <>
              {/* On a phone the tabs above do this. */}
              {!mobile && <ViewSwitch view={view} onView={setView} />}
            </>
          )}

          <div className="stage-corner">
            {!error && (
              <LevelFilter
                filter={filter}
                view={view}
                onFilter={setFilter}
                note={view === 'focus' && data && selected ? containerNote(data, filter) : undefined}
              />
            )}
            {/* On a phone it sits beside the search instead, where it is always on screen. */}
            {!mobile && <ProfileButton onOpen={() => setAccountOpen(true)} />}
          </div>

          <button
            className="info-button"
            onClick={() => setLegendOpen((o) => !o)}
            aria-expanded={legendOpen}
            aria-controls="stage-legend"
            title={legendOpen ? 'Hide the legend' : `How to read the ${view === 'map' ? 'map' : 'graph'}`}
            aria-label="Legend"
          >
            i
          </button>
        </main>
      </div>

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={drill}
        onWord={openWord}
      />
      {accountShown && <AccountDialog onClose={closeAccount} />}
    </div>
  )
}

function containerNote(data: GraphResponse, filter: ContainerFilter): string {
  const shown = data.containers.filter(keeps(filter)).length
  const hidden = data.containers.length - shown
  return `${shown} above${hidden > 0 ? `, ${hidden} hidden` : ''}`
}
