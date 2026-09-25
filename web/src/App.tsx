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
import { DetailPanel, KanjiHead, type DetailData } from './detail/DetailPanel'
import { local } from './local/local'
import { WordHead, WordPanel } from './detail/WordPanel'
import { clampShare, RAIL_MIN, RailResizer, SplitResizer, STAGE_MIN, useRailWidth, useSearchShare } from './RailResizer'
import { LevelFilter, type StageView } from './StageControls'
import { MapCard } from './map/MapCard'
import { WordKanji } from './graph/WordKanji'
import { rememberKanji, rememberSearch, rememberWord } from './history'
import { pageInUrl, useNav, type Page, type Stack } from './nav'

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
 * On a phone a page's tabs sit along the bottom, and the keyboard must push
 * them up rather than cover what is being typed over. Android resizes the page for the keyboard (see the
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

/**
 * How far a quick flick goes sideways across a page to turn to the next tab.
 * Slower, it takes a third of the way across.
 */
const SWIPE = 40
/** How far a page at its top is pulled down to go to the search. */
const PULL = 80
const HAN = /[㐀-䶿一-鿿]/

/**
 * Whether a touch starting here is the element's own to use sideways: typing,
 * drawing, or a row that scrolls across.
 */
function movesItself(el: Element | null, within: Element): boolean {
  for (let at = el; at && at !== within; at = at.parentElement) {
    if (at.matches('input, textarea, canvas, [contenteditable], .excalidraw')) return true
    const x = getComputedStyle(at).overflowX
    if ((x === 'auto' || x === 'scroll') && at.scrollWidth > at.clientWidth + 1) return true
  }
  return false
}

function searchBarOf(input: HTMLInputElement | null): HTMLElement | null {
  return input?.closest('.searchbar') ?? null
}

/**
 * Slides a pane sideways from one offset to another. It ends back in its
 * place, since a transform left on it would trap the fixed overlays inside it.
 */
function slide(el: HTMLElement, from: number, to: number, ms: number) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
    duration: still ? 0 : ms,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  })
}

/**
 * A still copy of a pane laid over it, for it to leave the screen by while
 * the pane itself already shows what replaces it. It sits beside the pane, so
 * the same rules style it, and stays visible when the pane is hidden. A pane
 * inside a box that scrolls is copied as far as the box shows it.
 */
function ghostOf(el: HTMLElement, within?: HTMLElement): HTMLElement {
  const whole = el.getBoundingClientRect()
  const box = within?.getBoundingClientRect()
  const top = box ? Math.max(whole.top, box.top) : whole.top
  const bottom = box ? Math.min(whole.bottom, box.bottom) : whole.bottom
  const r = { left: whole.left, top, width: whole.width, height: Math.max(0, bottom - top) }
  const g = el.cloneNode(true) as HTMLElement
  g.removeAttribute('id')
  g.dataset.ghost = ''
  g.setAttribute('aria-hidden', 'true')
  g.inert = true
  Object.assign(g.style, {
    position: 'fixed',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: '0',
    overflow: 'hidden',
    visibility: 'visible',
    pointerEvents: 'none',
    zIndex: '4',
  })
  el.after(g)
  // Over the pane even if something above it moves fixed boxes, and
  // scrolled as it was, once it is in the page to scroll.
  const at = g.getBoundingClientRect()
  g.style.left = `${2 * r.left - at.left}px`
  g.style.top = `${2 * r.top - at.top}px`
  g.scrollTop = el.scrollTop + (top - whole.top)
  return g
}

// Opening the app afresh lands on the whole common map, to wander in, on a
// desktop; on a phone, on the search, with the map a tap away. A link to a
// character or a word opens on its focus view; a link to anything else, on a
// desktop, beside the map.
// Picking a character, on the map or from a list, goes to its focus view.
const openedOnPhone = window.matchMedia(MOBILE).matches
const linkedPage = pageInUrl()
const linked = linkedPage?.kind === 'kanji' ? linkedPage.char : null

function initialView(): StageView {
  if (linked || linkedPage?.kind === 'word') return 'focus'
  return openedOnPhone ? 'focus' : 'map'
}

/**
 * What the graph centres on for this stack: the nearest character, or the one
 * the graph was on when that character was picked there -- or the kanji of a
 * word picked to be shown.
 */
function centreIn(stack: Stack): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i]
    if (p.kind === 'kanji') return p.centre ?? p.char
    if (p.kind === 'word' && p.centre) return p.centre
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
  const { stack, stage, push, reset, replaceTop, openOver, rebase, pop, enterStage, leaveStage } = useNav(scroller)
  const top = stack[stack.length - 1]
  const root = stack[0]
  const under = stack.length > 1 ? stack[stack.length - 2] : null

  // The character the graph and map show. It follows the stack's nearest
  // character -- or the one a character was picked on the graph from, or a
  // word's kanji (below) -- and stays put while the stack has none (a search).
  // Clicking empty map clears it.
  const stackCentre = centreIn(stack)
  const [focus, setFocus] = useState<string | null>(stackCentre)
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
  // Going from one node to the next, the graph says "nothing" for a moment in
  // between; waiting that out keeps the page from flashing back to the focus.
  const hoverOut = useRef<number | null>(null)
  const hoverGraph = useCallback((char: string | null) => {
    if (hoverOut.current !== null) {
      clearTimeout(hoverOut.current)
      hoverOut.current = null
    }
    if (char) setHovered(char)
    else
      hoverOut.current = window.setTimeout(() => {
        hoverOut.current = null
        setHovered(null)
      }, 120)
  }, [])
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
  // screen at a time: the graph is a page's Components tab, the map is gone to
  // from the search.
  const mobile = useMediaQuery(MOBILE)
  // Which one is a step in history, so back from the graph is the page again.
  const pane = mobile && stage ? 'stage' : 'rail'
  const onStage = pane === 'stage'
  // Back or forward onto a step that shows the graph or the map shows that one.
  useEffect(() => {
    if (!mobile || !stage) return
    setViewState(stage)
    if (stage === 'map') setMapOpened(true)
  }, [mobile, stage])
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
  // The map wants the room the search column takes, so while it is up the
  // column is folded away -- not as a choice, just for the map -- and is back
  // as it was on leaving it. The app opening on the map counts too.
  const [mapFolded, setMapFolded] = useState(() => view === 'map')
  useEffect(() => {
    if (view !== 'map') setMapFolded(false)
  }, [view])
  const split = room && splitPref && !mapFolded
  const chooseSplit = useCallback((on: boolean) => {
    setMapFolded(false)
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

  const chooseRailTab = useCallback(
    (t: RailTab) => {
      setRailTab(t)
      leaveStage('back')
      try {
        localStorage.setItem(RAIL_TAB_KEY, t)
      } catch {
        // not remembered, which is fine
      }
    },
    [leaveStage],
  )

  const toDictionary = useCallback(() => {
    setRailTab('dictionary')
    leaveStage('replace')
  }, [leaveStage])

  const setView = useCallback(
    (v: StageView) => {
      setViewState(v)
      if (mobile) enterStage(v)
      if (v === 'map') setMapOpened(true)
    },
    [mobile, enterStage],
  )

  // A character picked on the map is previewed over it, not opened.
  const [mapCard, setMapCard] = useState<string | null>(null)
  useEffect(() => {
    if (view !== 'map') setMapCard(null)
  }, [view])

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

  // A character picked on the graph is open while the graph stays centred on
  // another, so its page fetches its own.
  const pageKanji = top.kind === 'kanji' ? top.char : null
  const [pageData, setPageData] = useState<DetailData | null>(null)
  const [pageOnDevice, setPageOnDevice] = useState<DetailData | null>(null)
  useEffect(() => {
    if (!pageKanji || pageKanji === focus) return
    let stale = false
    local.kanji(pageKanji)?.then(
      (d) => !stale && setPageOnDevice(d),
      () => {},
    )
    api.kanji(pageKanji).then(
      (d) => !stale && setPageData(d),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [pageKanji, focus])

  // A word opened from a link comes with nothing but its id; the head above
  // its associations wants what it is.
  const pageWordId = top.kind === 'word' && !top.word ? top.id : null
  const [pageWord, setPageWord] = useState<Word | null>(null)
  useEffect(() => {
    if (pageWordId === null) return
    let stale = false
    local.wordEntry(pageWordId)?.then(
      (d) => !stale && d && setPageWord((w) => (w?.id === pageWordId ? w : d.word)),
      () => {},
    )
    api.word(pageWordId).then(
      (d) => !stale && setPageWord(d.word),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [pageWordId])

  // A word's graph is of one of its kanji at a time: the one picked over the
  // graph, else the one the graph is on already -- 強 stays on going to 勉強 --
  // else the one whose page it was opened from, else its first.
  const topWord = top.kind === 'word' ? (top.word ?? (pageWord?.id === top.id ? pageWord : undefined)) : undefined
  const wordKanji = topWord ? [...new Set([...topWord.headword].filter((c) => HAN.test(c)))] : []
  const inWord = (c: string | null | undefined): c is string => !!c && wordKanji.includes(c)
  const wordCentre =
    top.kind === 'word' && wordKanji.length > 0
      ? inWord(top.centre)
        ? top.centre
        : inWord(focus)
          ? focus
          : under?.kind === 'kanji' && inWord(under.char)
            ? under.char
            : wordKanji[0]
      : null
  // One effect for both, so going back from a word to the page under it puts
  // the graph back on that page's character.
  const centre = wordCentre ?? stackCentre
  useEffect(() => {
    if (centre) setFocus(centre)
  }, [centre])
  // A word without kanji, linked to, has no graph: the map, on a desktop.
  const kanaOnly = topWord !== undefined && wordKanji.length === 0
  useEffect(() => {
    if (kanaOnly && !mobile && !focus && view === 'focus') setView('map')
    // Only as the word arrives; the view is the user's after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kanaOnly])
  const showWordKanji = useCallback(
    (char: string) => {
      if (top.kind !== 'word') return
      setHovered(null)
      setFocus(char)
      replaceTop({ ...top, centre: char })
    },
    [top, replaceTop],
  )

  /** What the rail has on a character: the graph's, or the page's own. */
  const detailOf = (char: string): DetailData | null =>
    char === focus
      ? detail
      : pageData?.focus.char === char
        ? pageData
        : pageOnDevice?.focus.char === char
          ? pageOnDevice
          : null

  // A character seen in the dictionary from the map starts the stack again from it.
  const drill = useCallback(
    (char: string) => {
      setHovered(null)
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
  const shown = top.kind === 'kanji' ? (detailOf(top.char)?.focus ?? null) : null
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
      leaveStage('replace')
      setViewState('focus')
      keepSearch()
      if (under?.kind === 'kanji' && under.char === char) pop()
      else push({ kind: 'kanji', char })
    },
    [under, push, pop, keepSearch, leaveStage],
  )

  // A word, like a character, goes to its graph -- of its kanji -- when it has one.
  const openWord = useCallback(
    (w: Word) => {
      toDictionary()
      keepSearch()
      if (HAN.test(w.headword)) setViewState('focus')
      push({ kind: 'word', id: w.id, word: w })
    },
    [push, toDictionary, keepSearch],
  )

  // A pick on the decomposition graph opens on top of the page, and the graph
  // stays centred where it was. Picks in a row take each other's place, so
  // back from any of them is the character in the middle, and back from that
  // is wherever it was come to from. `via` is the container a peek skipped
  // through, which counts as visited.
  const graphOpen = useCallback(
    (char: string, via?: string) => {
      setHovered(null)
      leaveStage('replace')
      if (via && via !== char) rememberKanji(via)
      const page: Page = char === focus || !focus ? { kind: 'kanji', char } : { kind: 'kanji', char, centre: focus }
      const picked = top.kind === 'kanji' && top.centre !== undefined && top.centre === focus
      if (under?.kind === 'kanji' && under.char === char && (under.centre ?? under.char) === focus) pop()
      else if (picked) {
        if (top.char === char) return
        replaceTop(page)
        if (scroller.current) scroller.current.scrollTop = 0
      } else push(page)
    },
    [top, under, push, pop, replaceTop, focus, leaveStage],
  )

  // Recentring on a character on the graph opens it too, or takes the
  // centre it was opened with off it when it is open already.
  const graphRecentre = useCallback(
    (char: string, via?: string) => {
      setHovered(null)
      if (via && via !== char) rememberKanji(via)
      setFocus(char)
      if (top.kind === 'kanji' && top.char === char) replaceTop({ kind: 'kanji', char })
      else if (under?.kind === 'kanji' && under.char === char && !under.centre) pop()
      // On a phone the graph stays up: this was done on it.
      else push({ kind: 'kanji', char }, true)
    },
    [top, under, push, pop, replaceTop],
  )

  // From the map's card: the character in the dictionary, and its graph.
  const seeInDictionary = useCallback(
    (char: string) => {
      setMapCard(null)
      // Opening it puts the page up, on a phone.
      drill(char)
      if (mobile) {
        setViewState('focus')
        leaveStage('replace')
      } else setView('focus')
    },
    [drill, mobile, setView, leaveStage],
  )

  // Out to the map from the search, with the search column folded away for it.
  const browseMap = useCallback(() => {
    setMapFolded(true)
    setView('map')
  }, [setView])

  // A pick from the search column replaces what is open beside it.
  const listKanji = useCallback(
    (char: string) => {
      setHovered(null)
      setViewState('focus')
      rememberSearch(q)
      openOver({ kind: 'search', q }, { kind: 'kanji', char })
    },
    [q, openOver],
  )
  const listWord = useCallback(
    (w: Word) => {
      if (HAN.test(w.headword)) setViewState('focus')
      rememberSearch(q)
      openOver({ kind: 'search', q }, { kind: 'word', id: w.id, word: w })
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

  // Going into the box leaves the page up, so a slip of the finger costs
  // nothing: only typing starts a search. Off the search, what it holds is
  // selected, for a new one to replace.
  const focusSearch = useCallback(() => !split && top.kind !== 'search', [split, top])

  // Enter on what the box already holds goes to that search, back down the
  // stack if that is where it is.
  const toSearch = useCallback(() => {
    if (split || top.kind === 'search') return
    toDictionary()
    if (root.kind === 'search' && root.q === q) pop(stack.length - 1)
    else reset({ kind: 'search', q })
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

  // A preview is usually shorter than the page, which pulls the scroll up;
  // back on the page, it is where it was. The scroll is followed while the
  // page is showing, and the jump a preview causes is not.
  const cardPreview = shownTop?.kind === 'kanji' && hoveredNode !== null && hoveredNode.char !== shownTop.char
  const pageScroll = useRef(0)
  const inPreview = useRef(false)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const follow = () => {
      if (!inPreview.current) pageScroll.current = el.scrollTop
    }
    el.addEventListener('scroll', follow, { passive: true })
    return () => el.removeEventListener('scroll', follow)
  }, [])
  useLayoutEffect(() => {
    const was = inPreview.current
    inPreview.current = cardPreview
    if (was && !cardPreview && scroller.current) scroller.current.scrollTop = pageScroll.current
  }, [cardPreview])

  function page(p: Page) {
    switch (p.kind) {
      case 'search':
        return (
          <SearchPage
            q={p.q}
            onKanji={openKanji}
            onWord={openWord}
            onSearch={type}
            asked={asked}
            onAsk={setAsked}
            onMap={browseMap}
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
      case 'kanji': {
        const d = detailOf(p.char)
        return d ? (
          <DetailPanel
            data={d}
            hovered={hoveredNode}
            onWord={openWord}
            onKanji={openKanji}
            onComponents={!mobile && view !== 'focus' ? () => setView('focus') : undefined}
          />
        ) : null
      }
    }
  }

  // Kanji and words carry associations; searches and levels do not, so
  // there the tab steps aside and the page shows.
  const subject =
    shownTop?.kind === 'kanji'
      ? { key: shownTop.char, label: shownTop.char }
      : shownTop?.kind === 'word'
        ? { key: `word:${shownTop.id}`, label: shownTop.word?.headword ?? t('thisWord') }
        : null
  const tab: RailTab = railTab === 'associations' && !subject ? 'dictionary' : railTab
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

  const shownWord =
    shownTop?.kind === 'word' ? (shownTop.word ?? (pageWord?.id === shownTop.id ? pageWord : undefined)) : undefined

  // The page's head is one, above both tabs, and stays where it is as they
  // turn beneath it: a kanji as it looks and what it means, a word with its
  // reading and first sense. Associations are for the page, not for what is
  // hovered on the graph, so only the dictionary's head previews that.
  function pageHead() {
    if (shownTop?.kind === 'kanji') {
      const node = (tab === 'dictionary' && hoveredNode) || detailOf(shownTop.char)?.focus
      return (
        <section className="rail-section">
          {node ? (
            <KanjiHead node={node} />
          ) : (
            <div className="detail-head">
              <span className="detail-glyph">{shownTop.char}</span>
            </div>
          )}
        </section>
      )
    }
    if (shownTop?.kind === 'word') {
      return (
        <section className="rail-section word-panel">
          {shownWord ? (
            <WordHead word={shownWord} onPick={openKanji} />
          ) : (
            <h2 className="entry-head">{subject?.label}</h2>
          )}
        </section>
      )
    }
    return null
  }

  // On a phone a page's tabs are Dictionary, Associations and Components:
  // for a word, those of the kanji its graph is of.
  const componentsOf = shownTop?.kind === 'kanji' ? shownTop.char : shownTop?.kind === 'word' ? wordCentre : null
  // Back from the graph is the dictionary, whichever tab it was gone to from.
  function showComponents() {
    setRailTab('dictionary')
    setView('focus')
  }
  type PhoneTab = RailTab | 'components'
  const phoneTab: PhoneTab = onStage && view === 'focus' ? 'components' : tab
  const phoneTabs: PhoneTab[] = componentsOf ? ['dictionary', 'associations', 'components'] : ['dictionary', 'associations']
  function toPhoneTab(to: PhoneTab) {
    if (to === 'components') showComponents()
    else chooseRailTab(to)
  }

  // Swiping across a page goes to the tab beside it: the page follows the
  // finger, and let go far enough or fast enough it carries on off the screen
  // and the next tab slides in from the other side. Between Dictionary and
  // Associations only what is under the head moves; to or from the graph,
  // the whole screen. On the graph a swipe moves the graph, so there it is
  // the tabs, or back, that return.
  const stageRef = useRef<HTMLElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLElement>(null)
  /** The tabs' mark, drawn `by` of a tab from its place: it follows a swipe. */
  function dragMark(by: number | null) {
    const nav = tabsRef.current
    if (!nav) return
    nav.toggleAttribute('data-dragging', by !== null)
    if (by === null) nav.style.removeProperty('--drag')
    else nav.style.setProperty('--drag', String(by))
  }
  /** Whether turning to this tab moves the whole screen, not just the pane. */
  function wholeTo(to: PhoneTab | undefined) {
    return to === 'components' || phoneTab === 'components' || !paneRef.current
  }
  function moverTo(to: PhoneTab | undefined): HTMLElement | null {
    if (phoneTab === 'components') return stageRef.current
    return wholeTo(to) ? scroller.current : paneRef.current
  }
  const swipe = useRef<{
    x: number
    y: number
    /**
     * Turning to the tab beside, or pulling the page down for the search;
     * decided once the finger has gone far enough to tell.
     */
    mode: 'turn' | 'pull' | null
    /** Whether the page has tabs to turn to. */
    turns: boolean
    /** Whether the page was at its top, so a pull down is not a scroll. */
    atTop: boolean
    last: { x: number; at: number }
    /** Sideways speed, px/ms. */
    v: number
    /** What follows the finger: the pane, or the whole page. */
    moved: HTMLElement | null
  } | null>(null)
  // The tab turned from, as a still copy, and where it goes as the tab turned
  // to comes in beside it: for the effect below, once that one is showing.
  // Side by side all the way, so there is never an empty screen between them.
  const turning = useRef<{ ghost: HTMLElement; at: number; to: number; ms: number; whole: boolean } | null>(null)
  function turn(to: PhoneTab, at: number, ms: number) {
    const whole = wholeTo(to)
    const from = moverTo(to)
    if (!from) return toPhoneTab(to)
    turning.current?.ghost.remove()
    from.style.transform = ''
    const side = phoneTabs.indexOf(to) > phoneTabs.indexOf(phoneTab) ? -1 : 1
    const ghost = whole ? ghostOf(from) : ghostOf(from, scroller.current ?? undefined)
    const how = { ghost, at, to: side * from.clientWidth, ms, whole }
    // Where the finger left it, until the turn starts.
    how.ghost.style.transform = `translateX(${at}px)`
    turning.current = how
    toPhoneTab(to)
    // Should the tab not turn after all, the copy does not stay over the page.
    window.setTimeout(() => {
      if (turning.current !== how) return
      turning.current = null
      how.ghost.remove()
    }, 800)
  }
  function besideTab(dx: number): PhoneTab | undefined {
    return phoneTabs[phoneTabs.indexOf(phoneTab) + (dx < 0 ? 1 : -1)]
  }
  function swipeStart(e: React.TouchEvent) {
    swipe.current = null
    if (!mobile || e.touches.length !== 1) return
    if (movesItself(e.target as Element, e.currentTarget)) return
    // A page still sliding in is where it is going.
    scroller.current?.getAnimations({ subtree: true }).forEach((a) => a.finish())
    document.querySelectorAll('[data-ghost]').forEach((g) => g.remove())
    const touch = e.touches[0]
    swipe.current = {
      x: touch.clientX,
      y: touch.clientY,
      mode: null,
      turns: subject !== null,
      // The tabs along the bottom turn too, but do not pull.
      atTop: e.currentTarget === scroller.current && e.currentTarget.scrollTop <= 0,
      last: { x: touch.clientX, at: e.timeStamp },
      v: 0,
      moved: null,
    }
  }
  function swipeMove(e: React.TouchEvent) {
    const s = swipe.current
    if (!s || !scroller.current) return
    if (e.touches.length !== 1) return swipeCancel()
    const touch = e.touches[0]
    const dx = touch.clientX - s.x
    const dy = touch.clientY - s.y
    if (s.mode === null) {
      if (Math.hypot(dx, dy) < 10) return
      if (Math.abs(dx) > 1.5 * Math.abs(dy)) s.mode = s.turns ? 'turn' : null
      else if (dy > 0 && s.atTop) s.mode = 'pull'
      // Anything else is the page scrolling, which is the browser's.
      if (s.mode === null) {
        swipe.current = null
        return
      }
    }
    if (s.mode === 'pull') {
      // The search lights up once letting go would open it.
      searchBarOf(inputRef.current)?.toggleAttribute('data-pulled', dy > PULL)
      return
    }
    const dt = e.timeStamp - s.last.at
    if (dt > 0) s.v = 0.7 * ((touch.clientX - s.last.x) / dt) + 0.3 * s.v
    s.last = { x: touch.clientX, at: e.timeStamp }
    // Past the last tab the page gives a little, and comes back.
    const next = besideTab(dx)
    const el = moverTo(next)
    if (!el) return
    if (s.moved && s.moved !== el) s.moved.style.transform = ''
    s.moved = el
    el.style.transform = `translateX(${next ? dx : dx / 4}px)`
    dragMark(next ? Math.max(-1, Math.min(1, -dx / el.clientWidth)) : 0)
  }
  function swipeEnd(e: React.TouchEvent) {
    const s = swipe.current
    swipe.current = null
    const el = s?.moved
    if (s?.mode === 'pull') {
      searchBarOf(inputRef.current)?.removeAttribute('data-pulled')
      if (e.changedTouches[0].clientY - s.y > PULL) typeOver()
      return
    }
    if (s?.mode !== 'turn' || !el) return
    dragMark(null)
    const dx = e.changedTouches[0].clientX - s.x
    const next = besideTab(dx)
    const at = next ? dx : dx / 4
    el.style.transform = ''
    const flung = Math.abs(s.v) > 0.4 && Math.sign(s.v) === Math.sign(dx) && Math.abs(dx) > SWIPE
    if (!next || !(flung || Math.abs(dx) > el.clientWidth / 3)) {
      slide(el, at, 0, 220)
      return
    }
    // Off the screen at the speed it was thrown, the next tab right behind it.
    const out = dx < 0 ? -el.clientWidth : el.clientWidth
    turn(next, at, Math.min(280, Math.max(140, Math.abs(out - at) / Math.max(Math.abs(s.v), 1.5))))
  }
  function swipeCancel() {
    const s = swipe.current
    swipe.current = null
    const el = s?.moved
    searchBarOf(inputRef.current)?.removeAttribute('data-pulled')
    if (s?.mode !== 'turn' || !el) return
    dragMark(null)
    const at = new DOMMatrix(getComputedStyle(el).transform).m41
    el.style.transform = ''
    slide(el, at, 0, 220)
  }
  // Pulled down, the page brings up the search: the keyboard comes up with
  // what was searched last selected, so typing starts a new search, Enter
  // goes back to the old one, and putting the keyboard away leaves the page as
  // it was. Called from the touch itself, as phones only raise the keyboard
  // for focus given in answer to a touch.
  function typeOver() {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(0, input.value.length)
  }
  // A tab tapped turns the same way, from where the page stands.
  function tapPhoneTab(to: PhoneTab) {
    if (to !== phoneTab) turn(to, 0, 260)
  }
  useLayoutEffect(() => {
    const how = turning.current
    turning.current = null
    if (!how) return
    const el = phoneTab === 'components' ? stageRef.current : how.whole ? scroller.current : paneRef.current
    // The tab turned to starts at its top, under the head, if the page was
    // scrolled past it.
    const sc = scroller.current
    if (!how.whole && el && sc) {
      const under = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      if (sc.scrollTop > under) sc.scrollTop = under
    }
    if (el) slide(el, how.at - how.to, 0, how.ms)
    slide(how.ghost, how.at, how.to, how.ms).onfinish = () => how.ghost.remove()
  }, [phoneTab])

  const searchBar = (
    <SearchBar
      q={q}
      onType={type}
      onFocus={focusSearch}
      onSubmit={() => {
        toSearch()
        setAsked(q.trim())
        rememberSearch(q)
      }}
      inputRef={inputRef}
      after={
        // On a phone the search is along the top, and who you are at its end.
        mobile ? (
          <ProfileButton onOpen={signIn} />
        ) : (
          room && (
          <button
            className="searchbar-tool split-toggle"
            aria-pressed={split}
            onClick={() => chooseSplit(!split)}
            title={t(split ? 'hideSearch' : 'showSearch')}
          >
            <SplitIcon open={split} />
          </button>
          )
        )
      }
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
        {/* Split, the search box runs across the tops of both columns. */}
        {split && (
          <div className="split-head" ref={searchHeadRef}>
            {searchBar}
          </div>
        )}
        {split && (
          <aside className="search-column">
            <div className="search-column-body">
              <SearchPage
                q={q}
                onKanji={listKanji}
                onWord={listWord}
                onSearch={type}
                asked={asked}
                onAsk={setAsked}
                onMap={browseMap}
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
          {!mobile && subject && (
            <div className="rail-head">
              <div className="rail-tabs" role="tablist" aria-label={t('sidePanel')}>
                <button role="tab" aria-selected={tab === 'dictionary'} onClick={() => chooseRailTab('dictionary')}>
                  {t('dictionary')}
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'associations'}
                  onClick={() => chooseRailTab('associations')}
                >
                  {t('associations')}
                  {assocCount > 0 && <span className="rail-tab-count">{assocCount}</span>}
                </button>
              </div>
            </div>
          )}

          <div
            className="rail-body"
            ref={scroller}
            onTouchStart={swipeStart}
            onTouchMove={swipeMove}
            onTouchEnd={swipeEnd}
            onTouchCancel={swipeCancel}
          >
            {shownUnder && (
              <div className="rail-crumb">
                <button className="back-link rail-back" onClick={() => pop()} title={t('back')}>
                  <span aria-hidden>←</span> {t.node('backTo', { page: nameOf(shownUnder, t) })}
                </button>
              </div>
            )}
            {subject && <div className="page-head">{pageHead()}</div>}
            <div className="tab-pane" ref={paneRef}>
              {tab === 'dictionary' &&
                (shownTop ? (
                  page(shownTop)
                ) : (
                  <p className="hint rail-section">{t('pickResult')}</p>
                ))}
              {/* Kept mounted while hidden, so the count on its tab is there
                  before the tab is opened. */}
              {subject && (
                <div hidden={tab !== 'associations'}>
                  {associations(subject)}
                </div>
              )}
            </div>
          </div>
          {mobile && subject && !(onStage && view === 'map') && (
            <nav
              className="phone-tabs"
              role="tablist"
              aria-label={t('sidePanel')}
              ref={tabsRef}
              style={{ '--n': phoneTabs.length, '--at': phoneTabs.indexOf(phoneTab) } as React.CSSProperties}
              onTouchStart={swipeStart}
              onTouchMove={swipeMove}
              onTouchEnd={swipeEnd}
              onTouchCancel={swipeCancel}
            >
              <span className="phone-tab-mark" aria-hidden />
              {phoneTabs.map((p) => (
                <button key={p} role="tab" aria-selected={phoneTab === p} onClick={() => tapPhoneTab(p)}>
                  {t(p === 'components' ? 'focus' : p)}
                  {p === 'associations' && assocCount > 0 && <span className="rail-tab-count">{assocCount}</span>}
                </button>
              ))}
            </nav>
          )}
          {/* "Its parts" -- the decomposition editor and review queue -- is
              hidden for now. src/review/DecompPanel.tsx and the /api/decomp
              routes are untouched, so putting it back is one line. */}
        </aside>
        {split && <SplitResizer share={searchShare} total={2 * railShown} onShare={setSearchShare} />}
        <RailResizer width={railShown} onWidth={setRailWidth} columns={split ? 2 : 1} />

        <main className="stage" ref={stageRef}>
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
            <KanjiGraph
              data={data}
              filter={filter}
              open={shownTop?.kind === 'kanji' ? shownTop.char : null}
              onOpen={graphOpen}
              onRecentre={graphRecentre}
              onHover={hoverGraph}
              legend={legendOpen}
            />
          )}

          {!error && mapOpened && (
            <div className="map-host" hidden={view !== 'map'}>
              <KanjiMap
                scope={scopeOf(filter)}
                focus={mapCard ?? focus}
                focusNode={!mapCard && selected && data?.focus.char === focus ? data.focus : null}
                onSelect={setMapCard}
                onDeselect={() => (mapCard ? setMapCard(null) : deselect())}
                onOpen={seeInDictionary}
                card={
                  mapCard && (
                    <MapCard
                      char={mapCard}
                      onOpen={() => seeInDictionary(mapCard)}
                      onClose={() => setMapCard(null)}
                    />
                  )
                }
                onScope={setFilter}
                legend={legendOpen && view === 'map'}
              />
            </div>
          )}

          {!error && selected && view === 'focus' && topWord && wordKanji.length > 1 && (
            <WordKanji word={topWord.headword} current={focus} onPick={showWordKanji} />
          )}

          <div className="stage-top">
            <div className="stage-corner">
              {!error && (
                <LevelFilter filter={filter} view={view} onFilter={setFilter} />
              )}
              {/* On a phone it sits at the end of the search bar instead, always on screen. */}
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
