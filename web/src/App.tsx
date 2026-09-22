import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from './api'
import { KanjiGraph, keeps, type ContainerFilter } from './graph/KanjiGraph'
import { KanjiMap } from './map/KanjiMap'
import { scopeOf } from './map/mapData'
import { SearchOverlay } from './search/SearchOverlay'
import { Associations } from './detail/Associations'
import { About } from './About'
import { DetailPanel } from './detail/DetailPanel'
import { WordPanel } from './detail/WordPanel'
import { LevelFilter, Trail, ViewSwitch, type StageView } from './StageControls'

const START = '言'
const VIEW_KEY = 'betterrtk:view'

function initialView(): StageView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'focus'
  } catch {
    return 'focus'
  }
}

export function App() {
  // The trail is the zoom-out path: drilling pushes, the breadcrumb pops.
  const [trail, setTrail] = useState<string[]>([START])
  // Clicking empty map clears the selection; the trail is kept, so the
  // breadcrumb or any pick brings a character back.
  const [selected, setSelected] = useState(true)
  const [data, setData] = useState<GraphResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [filter, setFilter] = useState<ContainerFilter>('all')
  const [view, setViewState] = useState<StageView>(initialView)
  // The map is expensive to lay out, so once opened it stays mounted and keeps
  // its camera while the focus view is showing.
  const [mapOpened, setMapOpened] = useState(view === 'map')
  // A word open in the rail, and the kanji it was opened from.
  const [word, setWord] = useState<{ word: Word; from: string } | null>(null)

  const setView = useCallback((v: StageView) => {
    setViewState(v)
    if (v === 'map') setMapOpened(true)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // not remembered, which is fine
    }
  }, [])

  const focus = trail[trail.length - 1]

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

  // `via` keeps the breadcrumb honest when a peek skips a level: 言 -> 語 -> X.
  const drill = useCallback((char: string, via?: string) => {
    setHovered(null)
    setWord(null)
    setSelected(true)
    setTrail((t) => {
      const next = via && t[t.length - 1] !== via && via !== char ? [...t, via] : t
      return next[next.length - 1] === char ? next : [...next, char]
    })
  }, [])

  const pop = useCallback((index: number) => {
    setHovered(null)
    setWord(null)
    setSelected(true)
    setTrail((t) => t.slice(0, index + 1))
  }, [])

  const deselect = useCallback(() => {
    setHovered(null)
    setWord(null)
    setSelected(false)
  }, [])

  const openWord = useCallback((w: Word) => setWord({ word: w, from: focus }), [focus])

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
      if (e.key === 'm' || e.key === 'M') setView('map')
      if (e.key === 'f' || e.key === 'F') setView('focus')
      // Backspace walks back out, matching the breadcrumb -- first out of an
      // open word, then up the trail. Escape is left to whichever overlay is open.
      if (e.key === 'Backspace') {
        e.preventDefault()
        setWord((w) => {
          if (!w) {
            setSelected(true)
            setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t))
          }
          return null
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  const hoveredNode: KanjiNode | null = useMemo(() => {
    if (!data || !hovered) return null
    if (hovered === data.focus.char) return data.focus
    return (
      data.containers.find((n) => n.char === hovered) ??
      data.components.nodes.find((n) => n.char === hovered) ??
      null
    )
  }, [data, hovered])

  const dimmed = searchOpen || aboutOpen

  return (
    <div className="shell">
      <div className="shell-grid" data-dimmed={dimmed || undefined}>
        <aside className="rail">
          <div className="rail-section rail-top">
            <button className="search-trigger" onClick={() => setSearchOpen(true)}>
              <span>Search, or browse a level</span>
              <kbd>/</kbd>
            </button>
          </div>

          {!selected ? (
            <section className="rail-section">
              <p className="hint">Select a kanji</p>
            </section>
          ) : word ? (
            <WordPanel
              word={word.word}
              from={word.from}
              onBack={() => setWord(null)}
              onPick={(c) => (c === focus ? setWord(null) : drill(c))}
            />
          ) : (
            <>
              {data && <DetailPanel data={data} hovered={hoveredNode} onWord={openWord} />}
              {data && <Associations char={data.focus.char} onPick={drill} />}
            </>
          )}
          {/* "Its parts" -- the decomposition editor and review queue -- is
              hidden for now. src/review/DecompPanel.tsx and the /api/decomp
              routes are untouched, so putting it back is one line. */}
        </aside>

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
            <KanjiGraph data={data} filter={filter} onDrill={drill} onHover={setHovered} />
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
              />
            </div>
          )}

          {!error && (
            <>
              <Trail trail={trail} selected={selected} onPop={pop} />
              <ViewSwitch view={view} onView={setView} />
              <LevelFilter
                filter={filter}
                view={view}
                onFilter={setFilter}
                note={view === 'focus' && data && selected ? containerNote(data, filter) : undefined}
              />
            </>
          )}

          <button
            className="info-button"
            onClick={() => setAboutOpen(true)}
            title="What this is built on"
            aria-label="What this is built on"
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
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}

function containerNote(data: GraphResponse, filter: ContainerFilter): string {
  const shown = data.containers.filter(keeps(filter)).length
  const hidden = data.containers.length - shown
  return `${shown} above${hidden > 0 ? `, ${hidden} hidden` : ''}`
}
