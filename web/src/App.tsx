import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from './api'
import { KanjiGraph, keeps, type ContainerFilter } from './graph/KanjiGraph'
import { KanjiMap } from './map/KanjiMap'
import { scopeOf } from './map/mapData'
import { SearchBar } from './search/SearchBar'
import { LevelPage, SearchPage } from './search/Results'
import { Associations } from './detail/Associations'
import { AccountDialog, ProfileButton } from './account/Account'
import { LangSwitch } from './i18n/LangSwitch'
import { strings, useLang, type Translate } from './i18n'
import { clearAuthError, startAuth, useAuth } from './account/auth'
import { DetailPanel, type DetailData } from './detail/DetailPanel'
import { local } from './local/local'
import { WordPanel } from './detail/WordPanel'
import { RailResizer, useRailWidth } from './RailResizer'
import { LevelFilter, RecentGrid, ViewSwitch, type StageView } from './StageControls'
import { useRecent } from './recent'
import { pageInUrl, useNav, type Level, type Page, type Stack } from './nav'

const START = '言'

// What a failed graph fetch says when the network, not the server, is why:
// a marker, shown in the interface language.
const OFFLINE = 'offline'

const S = strings(
  {
    offline: 'The graph needs a connection.',
    offlineHint: "Search, drawing and each character's details work without one.",
    startServer: 'Start the server with',
    selectKanji: 'Select a kanji',
    sidePanel: 'Side panel',
    dictionary: 'Dictionary',
    associations: 'Associations',
    focus: 'Focus',
    map: 'Map',
    recent: 'Recent',
    back: 'Back (Backspace)',
    backTo: 'back to {page}',
    theWord: 'the word',
    search: 'search',
    thisWord: 'this word',
    hideLegend: 'Hide the legend',
    howMap: 'How to read the map',
    howGraph: 'How to read the graph',
    legend: 'Legend',
    above: '{n} above',
    aboveHidden: '{n} above, {h} hidden',
  },
  {
    offline: 'Графът има нужда от връзка.',
    offlineHint: 'Търсенето, рисуването и подробностите за всеки йероглиф работят и без нея.',
    startServer: 'Стартирайте сървъра с',
    selectKanji: 'Изберете йероглиф',
    sidePanel: 'Страничен панел',
    dictionary: 'Речник',
    associations: 'Асоциации',
    focus: 'Фокус',
    map: 'Карта',
    recent: 'Скорошни',
    back: 'Назад (Backspace)',
    backTo: 'назад към {page}',
    theWord: 'думата',
    search: 'търсенето',
    thisWord: 'тази дума',
    hideLegend: 'Скрийте легендата',
    howMap: 'Как се чете картата',
    howGraph: 'Как се чете графът',
    legend: 'Легенда',
    above: '{n} отгоре',
    aboveHidden: '{n} отгоре, {h} скрити',
  },
)
type T = Translate<Parameters<ReturnType<typeof S>>[0]>
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

/**
 * On a phone the search sits along the bottom, and the keyboard must push it
 * up rather than cover it. Android resizes the page for the keyboard (see the
 * viewport tag); iOS does not, so the app is sized to what is still visible.
 */
function useVisibleHeight(enabled: boolean) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!enabled || !vv) return
    const root = document.documentElement
    function fit() {
      // A pinch zoom shrinks the visible area too; that is not the keyboard.
      if (!vv || Math.abs(vv.scale - 1) > 0.01) return
      root.style.setProperty('--app-h', `${vv.height}px`)
      root.style.setProperty('--app-top', `${vv.offsetTop}px`)
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
      root.style.removeProperty('--app-h')
      root.style.removeProperty('--app-top')
    }
  }, [enabled])
}

const RAIL_TAB_KEY = 'betterrtk:railTab'
type RailTab = 'dictionary' | 'associations' | 'recent'

function initialRailTab(): RailTab {
  try {
    const saved = localStorage.getItem(RAIL_TAB_KEY)
    return saved === 'associations' || saved === 'recent' ? saved : 'dictionary'
  } catch {
    return 'dictionary'
  }
}

const TITLE = document.title

// A link to a character opens on it in the focus view. Otherwise a desktop
// opens on the whole common map, to wander in, and a phone on the view it was
// left on.
const openedOnPhone = window.matchMedia(MOBILE).matches
const linkedPage = pageInUrl()
const linked = linkedPage?.kind === 'kanji' ? linkedPage.char : null

function initialView(): StageView {
  if (linked) return 'focus'
  if (!openedOnPhone) return 'map'
  try {
    return localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'focus'
  } catch {
    return 'focus'
  }
}

/** The character nearest the top of the stack: the one the graph shows. */
function kanjiIn(stack: Stack): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i]
    if (p.kind === 'kanji') return p.char
  }
  return null
}

/** How a page is named in "back to ...". */
function nameOf(p: Page, t: T) {
  if (p.kind === 'kanji') return <span className="back-glyph">{p.char}</span>
  if (p.kind === 'word') return <span className="back-glyph">{p.word?.headword ?? t('theWord')}</span>
  if (p.kind === 'level') return <>N{p.level}</>
  if (!p.q) return <>{t('search')}</>
  return t.lang === 'bg' ? <>„{p.q}“</> : <>“{p.q}”</>
}

function titleOf(p: Page): string {
  if (p.kind === 'kanji') return `${p.char} · ${TITLE}`
  if (p.kind === 'word' && p.word) return `${p.word.headword} · ${TITLE}`
  if (p.kind === 'level') return `N${p.level} · ${TITLE}`
  if (p.kind === 'search' && p.q) return `${p.q} · ${TITLE}`
  return TITLE
}

export function App() {
  const t = S(useLang())
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { stack, push, reset, replaceTop, pop } = useNav(scroller)
  const top = stack[stack.length - 1]
  const root = stack[0]
  const under = stack.length > 1 ? stack[stack.length - 2] : null

  // Every character you have opened, listed in the Recent tab.
  const { recent, visit, clear: clearRecent } = useRecent(START, linked)

  // The character the graph and map show. It follows the stack's nearest
  // character, and stays put while the stack has none (a search, a word
  // opened from it). Clicking empty map clears it.
  const stackKanji = kanjiIn(stack)
  const [focus, setFocus] = useState<string | null>(stackKanji)
  useEffect(() => {
    if (stackKanji) setFocus(stackKanji)
  }, [stackKanji])
  useEffect(() => {
    if (focus) visit(focus)
  }, [focus, visit])
  const selected = focus !== null

  // The search box's text. It is the bottom page's query while that is a
  // search, and is left as it was when a pick on the graph starts a new stack.
  const [q, setQ] = useState(root.kind === 'search' ? root.q : '')
  useEffect(() => {
    if (root.kind === 'search') setQ(root.q)
  }, [root])

  const [data, setData] = useState<GraphResponse | null>(null)
  // The character's own details from the offline pack, which arrive before the graph.
  const [onDevice, setOnDevice] = useState<DetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
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
  const [railWidth, setRailWidth] = useRailWidth()
  const [railTab, setRailTab] = useState<RailTab>(initialRailTab)
  const [assocCount, setAssocCount] = useState(0)

  // On a phone the rail and the stage cannot both have room, so one fills the
  // screen at a time and Focus and Map join the rail's tabs.
  const mobile = useMediaQuery(MOBILE)
  const [pane, setPane] = useState<'rail' | 'stage'>('rail')
  const onStage = mobile && pane === 'stage'
  useVisibleHeight(mobile)

  const chooseRailTab = useCallback((t: RailTab) => {
    setRailTab(t)
    setPane('rail')
    try {
      localStorage.setItem(RAIL_TAB_KEY, t)
    } catch {
      // not remembered, which is fine
    }
  }, [])

  const toDictionary = useCallback(() => {
    setRailTab('dictionary')
    setPane('rail')
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

  useEffect(() => {
    document.title = titleOf(top)
  }, [top])

  // Picks up a sign-in link in the URL, or a session saved from last time.
  useEffect(() => {
    startAuth()
  }, [])

  useEffect(() => {
    if (!focus) return
    let stale = false
    local.kanji(focus)?.then(
      (d) => !stale && setOnDevice(d),
      () => {},
    )
    api.kanji(focus).then(
      (d) => {
        if (stale) return
        setData(d)
        setError(null)
      },
      // fetch rejects with a TypeError only when the request never got an answer.
      (e) => !stale && setError(e instanceof TypeError ? OFFLINE : String(e.message ?? e)),
    )
    return () => {
      stale = true
    }
  }, [focus])

  // The rail shows the graph's data once it is for this character, and the
  // device's until then -- or instead, when there is no connection.
  const detail: DetailData | null =
    data?.focus.char === focus ? data : onDevice?.focus.char === focus ? onDevice : null

  // A pick on the graph or map starts the stack again from that character.
  // `via` is the container a peek skipped through (言 -> 語 -> X), which counts
  // as visited too.
  const drill = useCallback(
    (char: string, via?: string) => {
      setHovered(null)
      if (via && via !== char) visit(via, char)
      setFocus(char)
      reset({ kind: 'kanji', char })
    },
    [visit, reset],
  )

  const openRecent = useCallback(
    (char: string) => {
      drill(char)
      setRailTab('dictionary')
    },
    [drill],
  )

  // Opening a character from a page puts it on top -- unless it is the page
  // just below, as when a word's kanji is the one it was opened from. The tab
  // stays, so a part opened from the associations shows its associations.
  const openKanji = useCallback(
    (char: string) => {
      setHovered(null)
      setPane('rail')
      if (under?.kind === 'kanji' && under.char === char) pop()
      else push({ kind: 'kanji', char })
    },
    [under, push, pop],
  )

  const openWord = useCallback(
    (w: Word) => {
      toDictionary()
      push({ kind: 'word', id: w.id, word: w })
    },
    [push, toDictionary],
  )

  const openLevel = useCallback((level: Level) => push({ kind: 'level', level }), [push])

  const deselect = useCallback(() => {
    setHovered(null)
    setFocus(null)
    if (top.kind === 'kanji') reset({ kind: 'search', q })
  }, [top, q, reset])

  // Typing is a search: the first key starts a new stack, the rest change it.
  const type = useCallback(
    (text: string) => {
      setQ(text)
      toDictionary()
      const page: Page = { kind: 'search', q: text }
      if (stack.length === 1 && stack[0].kind === 'search') replaceTop(page)
      else reset(page)
    },
    [stack, replaceTop, reset, toDictionary],
  )

  // Going into the box goes to the search it holds, back down the stack if
  // that is where it is.
  const focusSearch = useCallback(() => {
    toDictionary()
    if (top.kind === 'search') return false
    if (root.kind === 'search' && root.q === q) pop(stack.length - 1)
    else reset({ kind: 'search', q })
    return true
  }, [top, root, q, stack.length, pop, reset, toDictionary])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      // Slash and ctrl/cmd-K are what people already reach for.
      if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('.overlay')) return
      if (e.key === 'Escape') setLegendOpen(false)
      if (e.key === 'm' || e.key === 'M') setView('map')
      if (e.key === 'f' || e.key === 'F') setView('focus')
      // Backspace goes back a page. Escape is left to whichever overlay is open.
      if (e.key === 'Backspace') {
        e.preventDefault()
        pop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, pop])

  const closeAccount = useCallback(() => {
    setAccountOpen(false)
    clearAuthError()
  }, [])
  const signIn = useCallback(() => setAccountOpen(true), [])

  const hoveredNode: KanjiNode | null = useMemo(() => {
    if (!data || !hovered) return null
    if (hovered === data.focus.char) return data.focus
    return (
      data.containers.find((n) => n.char === hovered) ??
      data.components.nodes.find((n) => n.char === hovered) ??
      null
    )
  }, [data, hovered])

  function page(p: Page) {
    switch (p.kind) {
      case 'search':
        return <SearchPage q={p.q} onKanji={openKanji} onWord={openWord} onLevel={openLevel} onSearch={type} />
      case 'level':
        return <LevelPage level={p.level} onKanji={openKanji} />
      case 'word':
        return (
          <WordPanel
            key={p.id}
            id={p.id}
            word={p.word}
            from={under?.kind === 'kanji' ? under.char : undefined}
            onPick={openKanji}
          />
        )
      case 'kanji':
        return detail && detail.focus.char === p.char ? (
          <DetailPanel data={detail} hovered={hoveredNode} onWord={openWord} />
        ) : (
          <section className="rail-section">
            <div className="detail-head">
              <span className="detail-glyph">{p.char}</span>
            </div>
          </section>
        )
    }
  }

  // Kanji and words carry associations; searches and levels do not, so
  // there the tab steps aside and the page shows.
  const subject =
    top.kind === 'kanji'
      ? { key: top.char, label: top.char }
      : top.kind === 'word'
        ? { key: `word:${top.id}`, label: top.word?.headword ?? t('thisWord') }
        : null
  const tab: RailTab = railTab === 'associations' && !subject ? 'dictionary' : railTab
  const inDictionary = !onStage && tab === 'dictionary'
  // What the page on top is, as written, named above every tab it has.
  const current = top.kind === 'kanji' ? top.char : top.kind === 'word' ? top.word?.headword : undefined

  return (
    <div className="shell">
      <div
        className="shell-grid"
        data-dimmed={accountShown || undefined}
        data-pane={mobile ? pane : undefined}
        style={{ '--rail': `${railWidth}px` } as React.CSSProperties}
      >
        <aside className="rail">
          <SearchBar
            q={q}
            onType={type}
            onFocus={focusSearch}
            inputRef={inputRef}
          />
          <div className="rail-head">
            <div className="rail-tabs" role="tablist" aria-label={t('sidePanel')}>
              <button role="tab" aria-selected={inDictionary} onClick={() => chooseRailTab('dictionary')}>
                {t('dictionary')}
              </button>
              {subject && (
                <button
                  role="tab"
                  aria-selected={!onStage && tab === 'associations'}
                  onClick={() => chooseRailTab('associations')}
                >
                  {t('associations')}
                  {assocCount > 0 && <span className="rail-tab-count">{assocCount}</span>}
                </button>
              )}
              {mobile && (
                <>
                  <button role="tab" aria-selected={onStage && view === 'focus'} onClick={() => setView('focus')}>
                    {t('focus')}
                  </button>
                  <button role="tab" aria-selected={onStage && view === 'map'} onClick={() => setView('map')}>
                    {t('map')}
                  </button>
                </>
              )}
              <button role="tab" aria-selected={!onStage && tab === 'recent'} onClick={() => chooseRailTab('recent')}>
                {t('recent')}
              </button>
            </div>
            {mobile && <LangSwitch />}
            {mobile && <ProfileButton onOpen={signIn} />}
          </div>

          <div className="rail-body" ref={scroller}>
            {tab === 'recent' ? (
              <RecentGrid recent={recent} current={focus} onPick={openRecent} onClear={clearRecent} />
            ) : (
              <>
                {(under || current) && (
                  <div className="rail-crumb">
                    {under ? (
                      <button className="back-link rail-back" onClick={() => pop()} title={t('back')}>
                        <span aria-hidden>←</span> {t.node('backTo', { page: nameOf(under, t) })}
                      </button>
                    ) : (
                      <span />
                    )}
                    {current && (
                      <span className="rail-current" lang="ja">
                        {current}
                      </span>
                    )}
                  </div>
                )}
                {tab === 'dictionary' && page(top)}
              </>
            )}
            {/* Kept mounted while hidden, so the count on its tab is there
                before the tab is opened. */}
            {subject && (
              <div hidden={tab !== 'associations'}>
                <Associations
                  key={subject.key}
                  subject={subject.key}
                  label={subject.label}
                  onPick={openKanji}
                  onSignIn={signIn}
                  onCount={setAssocCount}
                />
              </div>
            )}
          </div>
          {/* "Its parts" -- the decomposition editor and review queue -- is
              hidden for now. src/review/DecompPanel.tsx and the /api/decomp
              routes are untouched, so putting it back is one line. */}
        </aside>
        <RailResizer width={railWidth} onWidth={setRailWidth} />

        <main className="stage">
          {error && selected && (
            <div className="stage-empty">
              <p>
                {error === OFFLINE ? t('offline') : error}
                <br />
                {error === OFFLINE ? (
                  <span className="hint">{t('offlineHint')}</span>
                ) : (
                  <span className="hint">
                    {t('startServer')}{' '}
                    <code>.venv/Scripts/uvicorn server.app:app --port 8000</code>
                  </span>
                )}
              </p>
            </div>
          )}

          {!selected && view === 'focus' && (
            <div className="stage-empty">
              <p className="hint">{t('selectKanji')}</p>
            </div>
          )}

          {!error && data && selected && view === 'focus' && (
            <KanjiGraph data={data} filter={filter} onDrill={drill} onHover={setHovered} legend={legendOpen} />
          )}

          {!error && mapOpened && (
            <div className="map-host" hidden={view !== 'map'}>
              <KanjiMap
                scope={scopeOf(filter)}
                focus={focus}
                focusNode={selected && data?.focus.char === focus ? data.focus : null}
                onSelect={drill}
                onDeselect={deselect}
                onOpen={() => setView('focus')}
                onScope={setFilter}
                legend={legendOpen && view === 'map'}
              />
            </div>
          )}

          {/* On a phone the tabs above do this. */}
          {!error && !mobile && <ViewSwitch view={view} onView={setView} />}

          <div className="stage-corner">
            {!error && (
              <LevelFilter
                filter={filter}
                view={view}
                onFilter={setFilter}
                note={view === 'focus' && data && selected ? containerNote(data, filter, t) : undefined}
              />
            )}
            {/* On a phone they sit beside the tabs instead, where they are always on screen. */}
            {!mobile && <LangSwitch />}
            {!mobile && <ProfileButton onOpen={signIn} />}
          </div>

          <button
            className="info-button"
            onClick={() => setLegendOpen((o) => !o)}
            aria-expanded={legendOpen}
            aria-controls="stage-legend"
            title={legendOpen ? t('hideLegend') : t(view === 'map' ? 'howMap' : 'howGraph')}
            aria-label={t('legend')}
          >
            i
          </button>
        </main>
      </div>

      {accountShown && <AccountDialog onClose={closeAccount} />}
    </div>
  )
}

function containerNote(data: GraphResponse, filter: ContainerFilter, t: T): string {
  const shown = data.containers.filter(keeps(filter)).length
  const hidden = data.containers.length - shown
  return hidden > 0 ? t('aboveHidden', { n: shown, h: hidden }) : t('above', { n: shown })
}
