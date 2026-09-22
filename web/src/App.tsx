import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type GraphResponse, type KanjiNode } from './api'
import { KanjiGraph, type ContainerFilter } from './graph/KanjiGraph'
import { SearchOverlay } from './search/SearchOverlay'
import { Associations } from './detail/Associations'
import { About } from './About'
import { DetailPanel } from './detail/DetailPanel'

const START = '言'

export function App() {
  // The trail is the zoom-out path: drilling pushes, the breadcrumb pops.
  const [trail, setTrail] = useState<string[]>([START])
  const [data, setData] = useState<GraphResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [filter, setFilter] = useState<ContainerFilter>('all')

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

  const drill = useCallback((char: string) => {
    setHovered(null)
    setTrail((t) => (t[t.length - 1] === char ? t : [...t, char]))
  }, [])

  const pop = useCallback((index: number) => {
    setHovered(null)
    setTrail((t) => t.slice(0, index + 1))
  }, [])

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
      if (typing) return
      // Backspace walks back out, matching the breadcrumb. Escape is left to
      // whichever overlay is open.
      if (e.key === 'Backspace') {
        e.preventDefault()
        setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

          {data && <DetailPanel data={data} hovered={hoveredNode} onPick={drill} />}
          {data && <Associations char={data.focus.char} onPick={drill} />}
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

          {!error && data && (
            <KanjiGraph
              data={data}
              trail={trail}
              filter={filter}
              onFilter={setFilter}
              onDrill={drill}
              onPop={pop}
              onHover={setHovered}
            />
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

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onPick={drill} />
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}
