import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api, type GraphResponse, type KanjiNode, type Word } from './api'
import { KanjiGraph, type ContainerFilter } from './graph/KanjiGraph'
import { KanjiMap } from './map/KanjiMap'
import { scopeOf } from './map/mapData'
import { SearchBar } from './search/SearchBar'
import { LevelPage, SearchPage } from './search/Results'
import { Associations } from './detail/Associations'
import { AccountDialog, ProfileButton } from './account/Account'
import { strings, useLang, type Translate } from './i18n'
import { clearAuthError, startAuth, useAuth } from './account/auth'
import { DetailPanel, type DetailData } from './detail/DetailPanel'
import { local } from './local/local'
import { WordPanel } from './detail/WordPanel'
import { clampShare, RAIL_MIN, RailResizer, SplitResizer, STAGE_MIN, useRailWidth, useSearchShare } from './RailResizer'
import { LevelFilter, ViewSwitch, type StageView } from './StageControls'
import { rememberKanji, rememberSearch, rememberWord } from './history'
import { pageInUrl, useNav, type Level, type Page, type Stack } from './nav'

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
    showSearch: 'Show the search beside the dictionary',
    hideSearch: 'Put the search back above the dictionary',
    pickResult: 'Pick a result and it opens here.',
    focus: 'Components',
    map: 'Map',
    back: 'Back (Backspace)',
    backTo: 'back to {page}',
    theWord: 'the word',
    search: 'search',
    thisWord: 'this word',
    hideLegend: 'Hide the legend',
    howMap: 'How to read the map',
    howGraph: 'How to read the graph',
    legend: 'Legend',
  },
  {
    offline: 'Графът има нужда от връзка.',
    offlineHint: 'Търсенето, рисуването и подробностите за всеки йероглиф работят и без нея.',
    startServer: 'Стартирайте сървъра с',
    selectKanji: 'Изберете йероглиф',
    sidePanel: 'Страничен панел',
    dictionary: 'Речник',
    associations: 'Асоциации',
    showSearch: 'Покажете търсенето до речника',
    hideSearch: 'Върнете търсенето над речника',
    pickResult: 'Изберете резултат и той ще се отвори тук.',
    focus: 'Компоненти',
    map: 'Карта',
    back: 'Назад (Backspace)',
    backTo: 'назад към {page}',
    theWord: 'думата',
    search: 'търсенето',
    thisWord: 'тази дума',
    hideLegend: 'Скрийте легендата',
    howMap: 'Как се чете картата',
    howGraph: 'Как се чете графът',
    legend: 'Легенда',
  },
)
type T = Translate<Parameters<ReturnType<typeof S>>[0]>
const VIEW_KEY = 'betterrtk:view'

// Matches the narrow layout in theme.css.
const MOBILE = '(max-width: 900px)'

function useWindowWidth(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('resize', onChange)
      return () => window.removeEventListener('resize', onChange)
    },
    () => window.innerWidth,
  )
}

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
// On a wide enough desktop the search gets a column of its own, left of the
// dictionary, so its results stay in view while one of them is open. The
// rail's edge resizes the two together; the edge between them moves the split.
const SPLIT_KEY = 'betterrtk:searchBeside'
const SPLIT_ROOM = 2 * RAIL_MIN + STAGE_MIN
type RailTab = 'dictionary' | 'associations'

function initialRailTab(): RailTab {
  try {
    const saved = localStorage.getItem(RAIL_TAB_KEY)
    return saved === 'associations' ? saved : 'dictionary'
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
  const { stack, push, reset, replaceTop, openOver, rebase, pop } = useNav(scroller)
  const top = stack[stack.length - 1]
  const root = stack[0]
  const under = stack.length > 1 ? stack[stack.length - 2] : null

  // The character the graph and map show. It follows the stack's nearest
  // character, and stays put while the stack has none (a search, a word
  // opened from it). Clicking empty map clears it.
  const stackKanji = kanjiIn(stack)
  const [focus, setFocus] = useState<string | null>(stackKanji)
  useEffect(() => {
    if (stackKanji) setFocus(stackKanji)
  }, [stackKanji])
  const selected = focus !== null

  // The search box's text. It is the bottom page's query while that is a
  // search, and is left as it was when a pick on the graph starts a new stack.
  const [q, setQ] = useState(root.kind === 'search' ? root.q : '')
  // The query Enter was last pressed on: semantic search runs only when asked.
  const [asked, setAsked] = useState<string | null>(null)
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
  const [filter, setFilter] = useState<ContainerFilter>('common')
  const [view, setViewState] = useState<StageView>(initialView)
  // The map is expensive to lay out, so once opened it stays mounted and keeps
  // its camera while the focus view is showing.
  const [mapOpened, setMapOpened] = useState(view === 'map')
  const [railWidth, setRailWidth] = useRailWidth()
  const [searchShare, setSearchShare] = useSearchShare()
  const [railTab, setRailTab] = useState<RailTab>(initialRailTab)
  const [assocCount, setAssocCount] = useState(0)

  // On a phone the rail and the stage cannot both have room, so one fills the
  // screen at a time and Focus and Map join the rail's tabs.
  const mobile = useMediaQuery(MOBILE)
  const [pane, setPane] = useState<'rail' | 'stage'>('rail')
  const onStage = mobile && pane === 'stage'
  useVisibleHeight(mobile)

  const windowWidth = useWindowWidth()
  const [splitPref, setSplitPref] = useState(() => {
    try {
      return localStorage.getItem(SPLIT_KEY) !== '0'
    } catch {
      return true
    }
  })
  const room = !mobile && windowWidth >= SPLIT_ROOM
  const split = room && splitPref
  const chooseSplit = useCallback((on: boolean) => {
    setSplitPref(on)
    try {
      if (on) localStorage.removeItem(SPLIT_KEY)
      else localStorage.setItem(SPLIT_KEY, '0')
    } catch {
      // not remembered, which is fine
    }
  }, [])
  // Split, the rail's width is kept as the two columns' average, so it means
  // the same either way; the columns give way before the stage does.
  const railShown = split ? Math.round(Math.min(railWidth, (windowWidth - STAGE_MIN) / 2)) : railWidth
  const searchPx = split ? Math.round(2 * railShown * clampShare(searchShare, 2 * railShown)) : 0
  const entryPx = split ? 2 * railShown - searchPx : railShown

  // With the search in its own column, the rail shows what is open above it:
  // the stack without the search at its bottom.
  const entries = split && root.kind === 'search' ? stack.slice(1) : stack
  const shownTop: Page | null = entries.length > 0 ? entries[entries.length - 1] : null
  const shownUnder = entries.length > 1 ? entries[entries.length - 2] : null
  const picked = entries[0]

  // The rail's head is as tall as the search box beside it, so the rule
  // under them runs straight across.
  const searchHeadRef = useRef<HTMLDivElement>(null)
  const [searchH, setSearchH] = useState(0)
  useLayoutEffect(() => {
    const head = searchHeadRef.current
    if (!head || !split) return
    const fit = () => setSearchH(head.offsetHeight)
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(head)
    return () => watch.disconnect()
  }, [split])

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
      if (via && via !== char) rememberKanji(via)
      setFocus(char)
      reset({ kind: 'kanji', char })
    },
    [reset],
  )

  // What is on top goes into the history the empty search lists. A search
  // counts once it has been left to stand a moment, or something was opened
  // from it, so the letters on the way to a word do not.
  useEffect(() => {
    if (top.kind === 'kanji') rememberKanji(top.char)
    else if (top.kind === 'word' && top.word) rememberWord(top.word)
  }, [top])
  const rootQ = root.kind === 'search' ? root.q : ''
  useEffect(() => {
    if (!rootQ.trim()) return
    const timer = setTimeout(() => rememberSearch(rootQ), 1500)
    return () => clearTimeout(timer)
  }, [rootQ])
  // Its meanings join it once they are here, for the list to show.
  const shown = top.kind === 'kanji' && detail?.focus.char === top.char ? detail.focus : null
  useEffect(() => {
    if (shown) rememberKanji(shown.char, shown)
  }, [shown])
  const keepSearch = useCallback(() => {
    if (top.kind === 'search') rememberSearch(top.q)
  }, [top])

  // Opening a character from a page puts it on top -- unless it is the page
  // just below, as when a word's kanji is the one it was opened from. The tab
  // stays, so a part opened from the associations shows its associations.
  const openKanji = useCallback(
    (char: string) => {
      setHovered(null)
      setPane('rail')
      keepSearch()
      if (under?.kind === 'kanji' && under.char === char) pop()
      else push({ kind: 'kanji', char })
    },
    [under, push, pop, keepSearch],
  )

  const openWord = useCallback(
    (w: Word) => {
      toDictionary()
      keepSearch()
      push({ kind: 'word', id: w.id, word: w })
    },
    [push, toDictionary, keepSearch],
  )

  const openLevel = useCallback(
    (level: Level) => {
      keepSearch()
      push({ kind: 'level', level })
    },
    [push, keepSearch],
  )

  // A pick from the search column replaces what is open beside it.
  const listKanji = useCallback(
    (char: string) => {
      setHovered(null)
      rememberSearch(q)
      openOver({ kind: 'search', q }, { kind: 'kanji', char })
    },
    [q, openOver],
  )
  const listWord = useCallback(
    (w: Word) => {
      rememberSearch(q)
      openOver({ kind: 'search', q }, { kind: 'word', id: w.id, word: w })
    },
    [q, openOver],
  )
  const listLevel = useCallback(
    (level: Level) => {
      rememberSearch(q)
      openOver({ kind: 'search', q }, { kind: 'level', level })
    },
    [q, openOver],
  )

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
      // Beside the dictionary, the results change and the open entry stays.
      if (split) rebase(page)
      else if (stack.length === 1 && stack[0].kind === 'search') replaceTop(page)
      else reset(page)
    },
    [split, stack, replaceTop, reset, rebase, toDictionary],
  )

  // Going into the box goes to the search it holds, back down the stack if
  // that is where it is.
  const focusSearch = useCallback(() => {
    toDictionary()
    if (split || top.kind === 'search') return false
    if (root.kind === 'search' && root.q === q) pop(stack.length - 1)
    else reset({ kind: 'search', q })
    return true
  }, [split, top, root, q, stack.length, pop, reset, toDictionary])

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
      if ('dDfF'.includes(e.key)) setView('focus')
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
        return (
          <SearchPage
            q={p.q}
            onKanji={openKanji}
            onWord={openWord}
            onLevel={openLevel}
            onSearch={type}
            asked={asked}
            onAsk={setAsked}
          />
        )
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
          <DetailPanel
            data={detail}
            hovered={hoveredNode}
            onWord={openWord}
            onKanji={openKanji}
            onComponents={mobile || view !== 'focus' ? () => setView('focus') : undefined}
          />
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
  // there the tab steps aside and the page shows. A desktop has room for
  // both, so there they follow the page instead of taking turns with it.
  const subject =
    shownTop?.kind === 'kanji'
      ? { key: shownTop.char, label: shownTop.char }
      : shownTop?.kind === 'word'
        ? { key: `word:${shownTop.id}`, label: shownTop.word?.headword ?? t('thisWord') }
        : null
  const tab: RailTab = railTab === 'associations' && (!subject || !mobile) ? 'dictionary' : railTab
  const inDictionary = !onStage && tab === 'dictionary'
  function associations(s: { key: string; label: string }) {
    return (
      <Associations
        key={s.key}
        subject={s.key}
        label={s.label}
        onPick={openKanji}
        onSignIn={signIn}
        onCount={setAssocCount}
      />
    )
  }

  // What the page on top is, as written, named above every tab it has.
  const current =
    shownTop?.kind === 'kanji' ? shownTop.char : shownTop?.kind === 'word' ? shownTop.word?.headword : undefined

  const searchBar = (
    <SearchBar
      q={q}
      onType={type}
      onFocus={focusSearch}
      onSubmit={() => {
        setAsked(q.trim())
        rememberSearch(q)
      }}
      inputRef={inputRef}
    />
  )

  return (
    <div className="shell">
      <div
        className="shell-grid"
        data-dimmed={accountShown || undefined}
        data-pane={mobile ? pane : undefined}
        data-split={split || undefined}
        style={
          {
            '--rail': `${entryPx}px`,
            '--search': `${searchPx}px`,
            '--search-h': `${searchH}px`,
          } as React.CSSProperties
        }
      >
        {split && (
          <aside className="search-column">
            <div className="search-column-head" ref={searchHeadRef}>
              {searchBar}
            </div>
            <div className="search-column-body">
              <SearchPage
                q={q}
                onKanji={listKanji}
                onWord={listWord}
                onLevel={listLevel}
                onSearch={type}
                asked={asked}
                onAsk={setAsked}
                open={
                  picked?.kind === 'kanji'
                    ? { kanji: picked.char }
                    : picked?.kind === 'word'
                      ? { word: picked.id }
                      : undefined
                }
              />
            </div>
          </aside>
        )}
        <aside className="rail">
          {!split && searchBar}
          <div className="rail-head">
            {room && (
              <button
                className="split-toggle"
                aria-pressed={split}
                onClick={() => chooseSplit(!split)}
                title={t(split ? 'hideSearch' : 'showSearch')}
              >
                <SplitIcon open={split} />
              </button>
            )}
            {/* A phone shows one pane at a time and switches between them here;
                a desktop has them all on screen at once. */}
            {mobile && (
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
                <button role="tab" aria-selected={onStage && view === 'focus'} onClick={() => setView('focus')}>
                  {t('focus')}
                </button>
                <button role="tab" aria-selected={onStage && view === 'map'} onClick={() => setView('map')}>
                  {t('map')}
                </button>
              </div>
            )}
            {/* On a desktop the stage's views sit at the end of the tabs,
                apart from them; on a phone they are tabs themselves. */}
            {!mobile && !error && <ViewSwitch view={view} onView={setView} />}
            {mobile && <ProfileButton onOpen={signIn} />}
          </div>

          <div className="rail-body" ref={scroller}>
            {(shownUnder || current) && (
              <div className="rail-crumb">
                {shownUnder ? (
                  <button className="back-link rail-back" onClick={() => pop()} title={t('back')}>
                    <span aria-hidden>←</span> {t.node('backTo', { page: nameOf(shownUnder, t) })}
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
            {tab === 'dictionary' &&
              (shownTop ? (
                page(shownTop)
              ) : (
                <p className="hint rail-section">{t('pickResult')}</p>
              ))}
            {/* Kept mounted while hidden, so the count on its tab is there
                before the tab is opened. */}
            {subject && mobile && <div hidden={tab !== 'associations'}>{associations(subject)}</div>}
            {subject && !mobile && (
              <section className="assoc-below">
                <h2 className="assoc-below-head">
                  {t('associations')}
                  {assocCount > 0 && <span className="rail-tab-count">{assocCount}</span>}
                </h2>
                {associations(subject)}
              </section>
            )}
          </div>
          {/* "Its parts" -- the decomposition editor and review queue -- is
              hidden for now. src/review/DecompPanel.tsx and the /api/decomp
              routes are untouched, so putting it back is one line. */}
        </aside>
        {split && <SplitResizer share={searchShare} total={2 * railShown} onShare={setSearchShare} />}
        <RailResizer width={railShown} onWidth={setRailWidth} columns={split ? 2 : 1} />

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

          <div className="stage-top">
            <div className="stage-corner">
              {!error && (
                <LevelFilter filter={filter} view={view} onFilter={setFilter} />
              )}
              {/* On a phone it sits beside the tabs instead, where it is always on screen. */}
              {!mobile && <ProfileButton onOpen={signIn} />}
            </div>
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

/** A panel with its left column filled while the search has a column of its own. */
function SplitIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M6 2.75v10.5" />
      {open && <rect className="solid" x="1.75" y="2.75" width="4.25" height="10.5" rx="1.5" />}
    </svg>
  )
}
