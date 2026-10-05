import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { api, onDataChanged, type GraphResponse, type KanjiNode, type Word } from './api'
import { KanjiGraph, type ContainerFilter } from './graph/KanjiGraph'
import { scopeOf } from './map/mapData'
import { SearchBar } from './search/SearchBar'
import { LevelPage, SearchPage } from './search/Results'
import { unscope } from './search/view'
import { Associations } from './detail/Associations'
import { AccountDialog, ProfileButton, type WorkbenchTab } from './account/Account'
import { Workbench } from './review/Workbench'
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
import { pageInUrl, samePage, urlOf, useNav, type Page, type Stack } from './nav'
import { dropReview, pushReview, replaceReview, reviewTabInState, reviewTabInUrl } from './review/route'
import { MOBILE, matches, reducedMotion, useMediaQuery } from './media'

// Wanted only once the map is opened, so loaded then.
const KanjiMap = lazy(() => import('./map/KanjiMap').then((m) => ({ default: m.KanjiMap })))

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
    searchTab: 'Search',
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
    searchTab: 'Търсене',
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

// Read once per resize, not once per render: asking the window its width
// while the page is mid-change makes the browser lay it all out to answer.
let windowWidth = window.innerWidth
function useWindowWidth(): number {
  return useSyncExternalStore(
    (onChange) => {
      const onResize = () => {
        windowWidth = window.innerWidth
        onChange()
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    },
    () => windowWidth,
  )
}

/**
 * A function whose identity never changes but which always does what the
 * latest render says. Children that are memoised keep still while the App
 * re-renders around them -- as it does on every keystroke of a search.
 */
function useStable<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...a: A) => ref.current(...a), [])
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
// On a phone a page's tabs sit along the bottom: Search, left of Dictionary,
// is the search the page was opened from, and Components is the graph.
type PhoneTab = 'search' | RailTab | 'components'
const PHONE_TABS: PhoneTab[] = ['search', 'dictionary', 'associations', 'components']
/** How a page changes on a phone: to another page, or to another of its tabs. */
type NavKind = 'forward' | 'back' | 'tab-forward' | 'tab-back'
/** What slides as a tab turns: the whole screen, or only what is under the page's head. */
type TurnScope = 'whole' | 'pane'

/**
 * The review screen, when the address names it: /review, /review/history ...
 * The older `?admin=1` (in the owner's email) and `?review=1` become those.
 * The entry is marked now, before the rail writes its own (nav.ts).
 */
function initialWorkbench(): WorkbenchTab | null {
  const url = new URL(window.location.href)
  const legacy = url.searchParams.has('admin') ? 'people' : url.searchParams.has('review') ? 'queue' : null
  const tab = reviewTabInUrl() ?? legacy
  if (tab) replaceReview(tab)
  return tab
}

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

/**
 * Focuses the search box so a phone raises its keyboard. Put away by hand,
 * the keyboard leaves the box focused, and focusing it again does nothing;
 * a blur first makes it a new focus, which does.
 */
function raiseKeyboard(input: HTMLInputElement) {
  if (document.activeElement === input) input.blur()
  input.focus({ preventScroll: true })
}

/**
 * Scrolls `el` to `to` and holds it there while the page fills in beneath --
 * a list's later rows come in a spare moment after the first -- until it gets
 * there, a few seconds have gone by, or a finger takes over.
 */
function holdScroll(el: HTMLElement, to: number) {
  const until = performance.now() + 3000
  let stopped = false
  const stop = () => (stopped = true)
  el.addEventListener('touchstart', stop, { once: true, passive: true })
  el.addEventListener('wheel', stop, { once: true, passive: true })
  const step = () => {
    if (stopped) return
    el.scrollTop = to
    if (Math.abs(el.scrollTop - to) > 1 && performance.now() < until) return requestAnimationFrame(step)
    el.removeEventListener('touchstart', stop)
    el.removeEventListener('wheel', stop)
  }
  step()
}

function searchBarOf(input: HTMLInputElement | null): HTMLElement | null {
  return input?.closest('.searchbar') ?? null
}

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * Slides a pane sideways from one offset to another. It ends back in its
 * place, since a transform left on it would trap the fixed overlays inside it.
 */
function slide(el: HTMLElement, from: number, to: number, ms: number) {
  return el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
    duration: reducedMotion() ? 0 : ms,
    easing: EASE,
  })
}

/** How long a page takes to slide in or out. */
const PAGE_MS = 300
/** How long a tab tapped takes to turn. */
const TAP_TURN_MS = 260

/** Whether pages slide at all: on a phone, unless the system asks for less motion. */
const pagesSlide = () => matches(MOBILE) && !reducedMotion()
/** Whether the browser animates a change itself, photographing the page it leaves. */
const hasViewTransitions = () => typeof document.startViewTransition === 'function'

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
  // A canvas clones blank: the map is painted over into its copy.
  const canvases = el.querySelectorAll('canvas')
  g.querySelectorAll('canvas').forEach((c, i) => {
    const from = canvases[i]
    if (!from || !from.width || !from.height) return
    c.width = from.width
    c.height = from.height
    try {
      c.getContext('2d')?.drawImage(from, 0, 0)
    } catch {
      // a tainted or lost canvas stays blank
    }
  })
  // Rows out of sight are not copied: below, they are left out; above, a
  // blank of their height stands in, so the copy scrolls to the same place.
  const rows = '.rail-section, .word, .comment, .vocab-row'
  const from = el.querySelectorAll(rows)
  const into = g.querySelectorAll(rows)
  from.forEach((row, i) => {
    const b = row.getBoundingClientRect()
    const copy = into[i]
    if (!copy || !copy.parentNode) return
    if (b.top > r.top + r.height + 24) copy.remove()
    else if (b.bottom < r.top - 24) {
      const blank = document.createElement('div')
      blank.style.height = `${b.height}px`
      copy.replaceWith(blank)
    }
  })
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
const openedOnPhone = matches(MOBILE)
const linkedPage = pageInUrl()
const linked = linkedPage?.kind === 'kanji' ? linkedPage.char : null

// A desktop opens on the map, so its code is fetched alongside the app's
// first render rather than after it.
if (!openedOnPhone && !linked && linkedPage?.kind !== 'word') void import('./map/KanjiMap')

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

/** A kanji or a word, as picked from a list. */
type Picked = { kind: 'kanji'; char: string } | { kind: 'word'; id: number; word: Word }
const kanjiPage = (char: string): Picked => ({ kind: 'kanji', char })
const wordPage = (w: Word): Picked => ({ kind: 'word', id: w.id, word: w })

/** What a search's results mark as open: the page, if it is one of them. */
function openIn(p: Page | undefined) {
  if (p?.kind === 'kanji') return { kanji: p.char }
  if (p?.kind === 'word') return { word: p.id }
  return undefined
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
  // Filled in below: what to do as back or forward arrives, before the page changes.
  const beforePop = useRef<((e: PopStateEvent, apply: () => void) => boolean) | null>(null)
  const { stack, stage, push, reset, replaceTop, openOver, rebase, pop, enterStage, leaveStage } = useNav(
    scroller,
    beforePop,
  )
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

  // While a page slides in, nothing heavy lands on it: what arrives mid-slide
  // -- the character's details, its graph -- waits for the end, so the slide
  // itself keeps every frame. `slideEnd` is when the current one is over.
  const slideEnd = useRef(0)
  const heldUp = useRef<(() => void)[]>([])
  const afterSlide = useCallback((fn: () => void) => {
    if (performance.now() >= slideEnd.current) fn()
    else heldUp.current.push(fn)
  }, [])
  function startSliding(ms: number) {
    const until = performance.now() + ms + 40
    if (until <= slideEnd.current) return
    slideEnd.current = until
    window.setTimeout(() => {
      if (performance.now() < slideEnd.current) return
      const fns = heldUp.current
      heldUp.current = []
      fns.forEach((f) => f())
    }, ms + 50)
  }

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
  // On a phone the graph is locked until asked: it neither pans nor zooms, so
  // a swipe across it turns the tab. Every visit to Components starts locked.
  const [graphLocked, setGraphLocked] = useState(true)
  const [accountOpen, setAccountOpen] = useState(false)
  // The review screen; the admin's email links straight to its People tab.
  const [workbench, setWorkbench] = useState<WorkbenchTab | null>(initialWorkbench)
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
  // On a phone the search is a tab of the page too: the page it was turned to
  // from, so going anywhere else leaves it. Compared as a page, not an object:
  // leaving the graph for it comes back through history, as a copy.
  const [searchOver, setSearchOver] = useState<Page | null>(null)
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
  useEffect(() => {
    if (!onStage) setGraphLocked(true)
  }, [onStage])
  // The pane turned from is off the screen, not invisible, so what had the
  // focus in it -- the note being written, say -- would keep the keyboard up
  // over the graph unless it is let go of.
  useEffect(() => {
    if (!mobile) return
    const hidden = onStage ? scroller.current : stageRef.current
    const active = document.activeElement
    if (active instanceof HTMLElement && hidden?.contains(active)) active.blur()
  }, [mobile, onStage])

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

  // A reviewer's edit (a decomposition, a form) went live: load the page again.
  const [dataVersion, setDataVersion] = useState(0)
  useEffect(() => onDataChanged(() => setDataVersion((v) => v + 1)), [])

  useEffect(() => {
    if (!focus) return
    let stale = false
    local.kanji(focus)?.then(
      (d) => afterSlide(() => !stale && setOnDevice(d)),
      () => {},
    )
    api.kanji(focus).then(
      (d) =>
        afterSlide(() => {
          if (stale) return
          setData(d)
          setError(null)
        }),
      // fetch rejects with a TypeError only when the request never got an answer.
      (e) => !stale && setError(e instanceof TypeError ? OFFLINE : String(e.message ?? e)),
    )
    return () => {
      stale = true
    }
  }, [focus, afterSlide, dataVersion])

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
      (d) => afterSlide(() => !stale && setPageOnDevice(d)),
      () => {},
    )
    api.kanji(pageKanji).then(
      (d) => afterSlide(() => !stale && setPageData(d)),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [pageKanji, focus, afterSlide, dataVersion])

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
  const drill = useStable(
    (char: string) => {
      setHovered(null)
      setFocus(char)
      reset({ kind: 'kanji', char })
    },
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
  // Where the search was scrolled to when it was last left, on the search
  // page or in a page's Search tab: the tab opens there again.
  const searchAt = useRef<{ q: string; top: number } | null>(null)
  function keepSearchScroll(q: string) {
    if (scroller.current) searchAt.current = { q, top: scroller.current.scrollTop }
  }
  function keepSearch() {
    if (top.kind !== 'search') return
    rememberSearch(top.q)
    keepSearchScroll(top.q)
  }

  // Opening a character from a page puts it on top -- unless it is the page
  // just below, as when a word's kanji is the one it was opened from. The tab
  // stays, so a part opened from the associations shows its associations.
  const openKanji = useStable(
    (char: string) => {
      setHovered(null)
      keepSearch()
      const back = under?.kind === 'kanji' && under.char === char
      const go = () => {
        leaveStage('replace')
        setViewState('focus')
        if (back) pop()
        else push({ kind: 'kanji', char })
      }
      // Back through history animates from the popstate it causes.
      if (back) go()
      else animateNav('forward', go)
    },
  )

  // A word, like a character, goes to its graph -- of its kanji -- when it has one.
  const openWord = useStable(
    (w: Word) => {
      keepSearch()
      animateNav('forward', () => {
        toDictionary()
        if (HAN.test(w.headword)) setViewState('focus')
        push(wordPage(w))
      })
    },
  )

  // A pick on the decomposition graph opens on top of the page, and the graph
  // stays centred where it was. Picks in a row take each other's place, so
  // back from any of them is the character in the middle, and back from that
  // is wherever it was come to from. `via` is the container a peek skipped
  // through, which counts as visited.
  const graphOpen = useStable(
    (char: string, via?: string) => {
      setHovered(null)
      if (via && via !== char) rememberKanji(via)
      if (mobile) {
        // On a phone the graph is not beside the page, so seeing a character
        // in the dictionary makes it the graph's centre too: back on
        // Components, the graph is of the character whose page this is.
        const back = under?.kind === 'kanji' && under.char === char && !under.centre
        const go = () => {
          leaveStage('replace')
          setFocus(char)
          if (back) pop()
          else if (top.kind === 'kanji' && top.char === char) replaceTop({ kind: 'kanji', char })
          else push({ kind: 'kanji', char })
        }
        if (back) go()
        else animateNav('forward', go)
        return
      }
      const page: Page = char === focus || !focus ? { kind: 'kanji', char } : { kind: 'kanji', char, centre: focus }
      const picked = top.kind === 'kanji' && top.centre !== undefined && top.centre === focus
      leaveStage('replace')
      if (under?.kind === 'kanji' && under.char === char && (under.centre ?? under.char) === focus) pop()
      else if (picked) {
        if (top.char === char) return
        replaceTop(page)
        if (scroller.current) scroller.current.scrollTop = 0
      } else push(page)
    },
  )

  // Recentring on a character on the graph opens it too, or takes the
  // centre it was opened with off it when it is open already.
  const graphRecentre = useStable(
    (char: string, via?: string) => {
      setHovered(null)
      if (via && via !== char) rememberKanji(via)
      setFocus(char)
      if (top.kind === 'kanji' && top.char === char) replaceTop({ kind: 'kanji', char })
      else if (under?.kind === 'kanji' && under.char === char && !under.centre) pop()
      // On a phone the graph stays up: this was done on it.
      else push({ kind: 'kanji', char }, true)
    },
  )

  // From the map's card: the character in the dictionary, and its graph.
  const seeInDictionary = useStable(
    (char: string) => {
      setMapCard(null)
      animateNav('forward', () => {
        // Opening it puts the page up, on a phone.
        drill(char)
        if (mobile) {
          setViewState('focus')
          leaveStage('replace')
        } else setView('focus')
      })
    },
  )

  // Out to the map from the search, with the search column folded away for it.
  const browseMap = useCallback(() => {
    setMapFolded(true)
    setView('map')
  }, [setView])

  // A pick from the search column replaces what is open beside it.
  function openOverSearch(p: Picked) {
    setHovered(null)
    if (p.kind === 'kanji' || HAN.test(p.word.headword)) setViewState('focus')
    rememberSearch(q)
    openOver({ kind: 'search', q }, p)
  }
  const listKanji = useStable((char: string) => openOverSearch(kanjiPage(char)))
  const listWord = useStable((w: Word) => openOverSearch(wordPage(w)))

  const deselect = useStable(() => {
    setHovered(null)
    setFocus(null)
    if (top.kind === 'kanji') reset({ kind: 'search', q })
  })

  // Typing is a search: the first key starts a new stack, the rest change it.
  const type = useCallback(
    (typed: string) => {
      // *生*, the old way to see 生 by meaning, becomes 生 with the switch on.
      const text = unscope(typed)
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

  // Back -- the browser's, or the app's -- to the search brings the keyboard
  // up with it, ready for the next word. Phones raise the keyboard for focus
  // given as a gesture is answered, so it is asked at once.
  const cameBack = useRef(0)
  const goBack = useStable(() => {
    cameBack.current = performance.now()
    pop()
  })

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
        goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, goBack])

  const closeAccount = useCallback(() => {
    setAccountOpen(false)
    clearAuthError()
  }, [])
  const signIn = useCallback(() => setAccountOpen(true), [])
  // The review screen is a history entry of its own (review/route.ts). One
  // pushed this visit is closed with back; one the visit opened on is replaced.
  const pushedReview = useRef(false)
  const openWorkbench = useCallback((tab: WorkbenchTab) => {
    setAccountOpen(false)
    if (reviewTabInState(window.history.state)) replaceReview(tab)
    else {
      pushReview(tab)
      pushedReview.current = true
    }
    setWorkbench(tab)
  }, [])
  const workbenchTab = useCallback((tab: WorkbenchTab) => {
    replaceReview(tab)
    setWorkbench(tab)
  }, [])
  const stackTop = stack[stack.length - 1]
  const closeWorkbench = useCallback(() => {
    if (pushedReview.current && reviewTabInState(window.history.state)) {
      pushedReview.current = false
      window.history.back()
    } else dropReview(urlOf(stackTop))
    setWorkbench(null)
  }, [stackTop])
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setWorkbench(reviewTabInState(e.state))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
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
            onWord={openWord}
            onSignIn={signIn}
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
            onSignIn={signIn}
            onSearch={type}
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
  // The tab not showing is mounted for its count, but only once the page has
  // come to rest: comments rendered behind a page sliding in cost it frames.
  const subjectKey = subject?.key ?? null
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    if (!subjectKey) return
    const t = window.setTimeout(() => setSettled(subjectKey), mobile ? PAGE_MS + 160 : 0)
    return () => clearTimeout(t)
  }, [subjectKey, mobile])
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

  // Components on a phone is the graph of the page's kanji: for a word, of
  // the one its graph is on.
  const componentsOf = shownTop?.kind === 'kanji' ? shownTop.char : shownTop?.kind === 'word' ? wordCentre : null
  // Back from the graph is the dictionary, whichever tab it was gone to from.
  function showComponents() {
    setRailTab('dictionary')
    setView('focus')
  }
  // The Search tab shows the search with the page marked in it, and the page
  // still there to turn back to.
  const searchShown = mobile && !onStage && subject !== null && searchOver !== null && samePage(searchOver, top)
  // The search itself, and a level's list, have the tabs too, with only Search
  // to be had: they are there before a page is opened, not brought by it.
  const phoneTab: PhoneTab =
    onStage && view === 'focus' ? 'components' : searchShown || subject === null ? 'search' : tab
  // Where the page was scrolled to, for coming back to it from the search.
  const pageAt = useRef(0)
  function leaveSearchTab() {
    if (phoneTab === 'search') keepSearchScroll(q)
  }
  function toPhoneTab(to: PhoneTab) {
    leaveSearchTab()
    if (to === 'search') {
      // From the graph, which the page is not drawn behind, it is at its top.
      pageAt.current = phoneTab === 'components' ? 0 : (scroller.current?.scrollTop ?? 0)
      setSearchOver(top)
      return leaveStage('back')
    }
    setSearchOver(null)
    if (to === 'components') showComponents()
    else chooseRailTab(to)
  }
  // A pick in the search tab: the page already open turns back to; another
  // opens over the search, as a pick in the search column does.
  function openFromSearchTab(p: Picked) {
    if (samePage(p, top)) return tapPhoneTab('dictionary')
    leaveSearchTab()
    animateNav('forward', () => {
      setSearchOver(null)
      toDictionary()
      openOverSearch(p)
    })
  }
  const searchTabKanji = useStable((char: string) => openFromSearchTab(kanjiPage(char)))
  const searchTabWord = useStable((w: Word) => openFromSearchTab(wordPage(w)))
  // The search page itself: a swipe from the left there raises the keyboard.
  const onSearchPage = mobile && !onStage && top.kind === 'search'

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
  /**
   * Whether turning to this tab moves the whole screen, not just the pane:
   * the graph and the search have no page head to stay put above them.
   */
  function wholeTo(to: PhoneTab | undefined) {
    const headless = (p: PhoneTab | undefined) => p === 'components' || p === 'search'
    return headless(to) || headless(phoneTab) || !paneRef.current
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
    const side = PHONE_TABS.indexOf(to) > PHONE_TABS.indexOf(phoneTab) ? -1 : 1
    // From a standstill -- a tap on a tab -- the turn is a view transition
    // where there are any, with nothing to copy. Leaving the graph goes
    // through history, so the popstate is where that transition starts.
    if (at === 0 && pagesSlide() && hasViewTransitions()) {
      const kind = side < 0 ? 'tab-forward' : 'tab-back'
      const scope = whole ? 'whole' : 'pane'
      if (phoneTab !== 'components') return animateNav(kind, () => toPhoneTab(to), scope)
      pendingTurn.current = { kind, scope }
      return toPhoneTab(to)
    }
    turning.current?.ghost.remove()
    from.style.transform = ''
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
  // A tab with nothing to show is greyed out, not taken away, so the tabs
  // never move about: all but Search on the search itself or a level's list,
  // Components for a word with no kanji.
  function tabOff(p: PhoneTab) {
    return p !== 'search' && (subject === null || (p === 'components' && !componentsOf))
  }
  function besideTab(dx: number): PhoneTab | undefined {
    if (onSearchPage) return undefined
    const next = PHONE_TABS[PHONE_TABS.indexOf(phoneTab) + (dx < 0 ? 1 : -1)]
    return next && tabOff(next) ? undefined : next
  }
  // The search has nothing to its left: a swipe that way opens the box, as a
  // pull down does.
  function swipeOpensSearch(dx: number) {
    return dx > 0 && (onSearchPage || phoneTab === 'search')
  }
  function swipeStart(e: React.TouchEvent) {
    swipe.current = null
    if (!mobile || e.touches.length !== 1) return
    // On the graph only while it is locked: free, a finger moves the graph.
    if (e.currentTarget === stageRef.current && (view !== 'focus' || !graphLocked)) return
    if (movesItself(e.target as Element, e.currentTarget)) return
    // A page still sliding in is where it is going.
    scroller.current?.getAnimations({ subtree: true }).forEach((a) => a.finish())
    document.querySelectorAll('[data-ghost]').forEach((g) => g.remove())
    const touch = e.touches[0]
    swipe.current = {
      x: touch.clientX,
      y: touch.clientY,
      mode: null,
      turns: subject !== null || onSearchPage,
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
    searchBarOf(inputRef.current)?.toggleAttribute('data-pulled', swipeOpensSearch(dx) && dx > PULL)
  }
  function swipeEnd(e: React.TouchEvent) {
    const s = swipe.current
    swipe.current = null
    searchBarOf(inputRef.current)?.removeAttribute('data-pulled')
    const el = s?.moved
    if (s?.mode === 'pull') {
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
      if (swipeOpensSearch(dx) && (flung || dx > PULL)) typeOver()
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
    raiseKeyboard(input)
    input.setSelectionRange(0, input.value.length)
  }
  // A tab tapped turns the same way, from where the page stands.
  function tapPhoneTab(to: PhoneTab) {
    if (to !== phoneTab) turn(to, 0, TAP_TURN_MS)
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
    startSliding(how.ms)
    if (el) slide(el, how.at - how.to, 0, how.ms)
    slide(how.ghost, how.at, how.to, how.ms).onfinish = () => how.ghost.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneTab])
  // The search opens where it was left, or else at its top with the open
  // page's entry in sight; back on the page, it is where it was left too.
  const lastTab = useRef(phoneTab)
  useLayoutEffect(() => {
    const was = lastTab.current
    lastTab.current = phoneTab
    const sc = scroller.current
    if (!sc) return
    if (phoneTab === 'search') {
      const left = searchAt.current
      if (left && left.q === q) return holdScroll(sc, left.top)
      sc.scrollTop = 0
      sc.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    } else if (was === 'search') sc.scrollTop = pageAt.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneTab])

  // Going to a page slides it in from the right over the one it was opened
  // from, which slips a little to the left beneath it; going back, the page
  // slides off to the right and the one under it comes back from the left.
  // The tabs along the bottom come and go with the page they belong to. The
  // pane being left is copied before it changes, as a tab turn is.
  const navAnim = useRef<{ ghosts: HTMLElement[]; tabs: HTMLElement | null; dir: 'forward' | 'back' } | null>(null)
  const lastN = useRef<number | undefined>(undefined)
  useEffect(() => {
    lastN.current = (window.history.state as { n?: number } | null)?.n
  })
  // Read through a ref: the callbacks that call this were made on earlier
  // renders, and the pane showing may have changed since.
  const onStageRef = useRef(onStage)
  onStageRef.current = onStage
  // A tab turn away from the graph, waiting for the popstate that makes it.
  const pendingTurn = useRef<{ kind: NavKind; scope: TurnScope } | null>(null)
  /**
   * Make the change `go` with the page sliding: as a view transition where
   * the browser has them -- it photographs the old page itself, which costs
   * nothing next to copying it -- and by a copy of the page elsewhere.
   */
  function animateNav(kind: NavKind, go: () => void, scope: TurnScope = 'whole') {
    if (!pagesSlide() || navAnim.current || turning.current) return go()
    if (hasViewTransitions()) {
      const html = document.documentElement
      html.dataset.nav = kind
      html.dataset.turn = scope
      startSliding(PAGE_MS)
      const t = document.startViewTransition(() => flushSync(go))
      t.finished.finally(() => {
        delete html.dataset.nav
        delete html.dataset.turn
      })
      return
    }
    if (kind === 'forward' || kind === 'back') leaveBy(kind)
    go()
  }
  function leaveBy(dir: 'forward' | 'back') {
    document.querySelectorAll('[data-ghost]').forEach((g) => g.remove())
    const from = onStageRef.current ? stageRef.current : scroller.current
    const ghosts: HTMLElement[] = []
    if (from) ghosts.push(ghostOf(from))
    const tabs = tabsRef.current ? ghostOf(tabsRef.current) : null
    const how = { ghosts, tabs, dir }
    navAnim.current = how
    // Should nothing change after all, the copies do not stay over the page.
    window.setTimeout(() => {
      if (navAnim.current !== how) return
      navAnim.current = null
      how.ghosts.forEach((g) => g.remove())
      how.tabs?.remove()
    }, 800)
  }
  useLayoutEffect(() => {
    const how = navAnim.current
    if (!how) return
    navAnim.current = null
    const to = onStage ? stageRef.current : scroller.current
    const w = to?.clientWidth ?? window.innerWidth
    const fwd = how.dir === 'forward'
    startSliding(PAGE_MS)
    if (to) {
      // The page going was taller when the tabs are arriving with this one:
      // no more of it shows than the room this one has.
      const room = to.getBoundingClientRect().height
      for (const g of how.ghosts) if (g.offsetHeight > room) g.style.height = `${room}px`
      // The page coming in is over the one going, forward; under it, back.
      to.style.zIndex = fwd ? '5' : ''
      slide(to, fwd ? w : -w * 0.3, 0, PAGE_MS).onfinish = () => to.style.removeProperty('z-index')
    }
    // The tabs stay put between two pages that both have them; they come in
    // with a page that has them, and leave with one that had.
    const nav = tabsRef.current
    if (nav && how.tabs) how.tabs.remove()
    else if (nav) slide(nav, w, 0, PAGE_MS)
    else if (how.tabs) how.ghosts.push(how.tabs)
    for (const g of how.ghosts) {
      g.style.zIndex = fwd ? '1' : '6'
      const a = g.animate(
        [
          { transform: 'translateX(0)', opacity: 1 },
          { transform: `translateX(${fwd ? -w * 0.3 : w}px)`, opacity: fwd ? 0.5 : 1 },
        ],
        { duration: PAGE_MS, easing: EASE },
      )
      a.onfinish = () => g.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, pane, onStage])

  // Back and forward slide the page as the app's own steps do: a tab turn
  // away from the graph as that turn, anything else the way history went.
  beforePop.current = (e: PopStateEvent, apply: () => void) => {
    cameBack.current = performance.now()
    if (turning.current) return false
    const turn = pendingTurn.current
    pendingTurn.current = null
    const n = (e.state as { n?: number } | null)?.n
    const forward = n !== undefined && lastN.current !== undefined && n > lastN.current
    if (turn) animateNav(turn.kind, apply, turn.scope)
    else animateNav(forward ? 'forward' : 'back', apply)
    return true
  }
  // Back on the search, the keyboard comes up (see `cameBack`).
  useEffect(() => {
    if (!cameBack.current || performance.now() - cameBack.current > 400) return
    cameBack.current = 0
    if (mobile && !onStage && top.kind === 'search' && inputRef.current) raiseKeyboard(inputRef.current)
  }, [top, onStage, mobile])

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
                open={openIn(picked)}
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
            aria-hidden={mobile && onStage ? true : undefined}
            onTouchStart={swipeStart}
            onTouchMove={swipeMove}
            onTouchEnd={swipeEnd}
            onTouchCancel={swipeCancel}
          >
            {shownUnder && !searchShown && (
              <div className="rail-crumb">
                <button className="back-link rail-back" onClick={goBack} title={t('back')}>
                  <span aria-hidden>←</span> {t.node('backTo', { page: nameOf(shownUnder, t) })}
                </button>
              </div>
            )}
            {subject && !searchShown && <div className="page-head">{pageHead()}</div>}
            <div className="tab-pane" ref={paneRef}>
              {/* Behind the graph on a phone the page is not on the screen, and
                  is not rendered: laid out unseen, it would cost the graph
                  frames each time its centre moved. */}
              {searchShown && (
                <SearchPage
                  q={q}
                  onKanji={searchTabKanji}
                  onWord={searchTabWord}
                  onSearch={type}
                  asked={asked}
                  onAsk={setAsked}
                  onMap={browseMap}
                  open={openIn(top)}
                />
              )}
              {tab === 'dictionary' &&
                !onStage &&
                !searchShown &&
                (shownTop ? (
                  page(shownTop)
                ) : (
                  <p className="hint rail-section">{t('pickResult')}</p>
                ))}
              {/* Kept mounted while hidden, so the count on its tab is there
                  before the tab is opened. */}
              {subject && (tab === 'associations' || settled === subject.key) && (
                <div hidden={tab !== 'associations' || searchShown}>
                  {associations(subject)}
                </div>
              )}
            </div>
          </div>
          {mobile && !(onStage && view === 'map') && (
            <nav
              className="phone-tabs"
              role="tablist"
              aria-label={t('sidePanel')}
              ref={tabsRef}
              style={{ '--n': PHONE_TABS.length, '--at': PHONE_TABS.indexOf(phoneTab) } as React.CSSProperties}
              onTouchStart={swipeStart}
              onTouchMove={swipeMove}
              onTouchEnd={swipeEnd}
              onTouchCancel={swipeCancel}
            >
              <span className="phone-tab-mark" aria-hidden />
              {PHONE_TABS.map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={phoneTab === p}
                  disabled={tabOff(p)}
                  onClick={() => tapPhoneTab(p)}
                >
                  <span className="phone-tab-icon">
                    <PhoneTabIcon tab={p} />
                    {p === 'associations' && subject && assocCount > 0 && <span className="rail-tab-count">{assocCount}</span>}
                  </span>
                  {t(p === 'components' ? 'focus' : p === 'search' ? 'searchTab' : p)}
                </button>
              ))}
            </nav>
          )}
        </aside>
        {split && <SplitResizer share={searchShare} total={2 * railShown} onShare={setSearchShare} />}
        <RailResizer width={railShown} onWidth={setRailWidth} columns={split ? 2 : 1} />

        <main
          className="stage"
          ref={stageRef}
          aria-hidden={mobile && !onStage ? true : undefined}
          onTouchStart={swipeStart}
          onTouchMove={swipeMove}
          onTouchEnd={swipeEnd}
          onTouchCancel={swipeCancel}
        >
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
              locked={mobile && graphLocked}
              onLock={mobile ? setGraphLocked : undefined}
            />
          )}

          {!error && mapOpened && (
            <div className="map-host" hidden={view !== 'map'}>
              <Suspense fallback={null}>
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
              </Suspense>
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

      {accountShown && <AccountDialog onClose={closeAccount} onWorkbench={openWorkbench} />}
      {workbench && (
        <Workbench
          tab={workbench}
          onTab={workbenchTab}
          onClose={closeWorkbench}
          onKanji={(c) => {
            // Over the review entry, so back comes back to the review screen.
            setWorkbench(null)
            openKanji(c)
          }}
        />
      )}
    </div>
  )
}

/** The phone's bottom tabs, each over its name: the icons keep the tabs evenly spaced whatever the names' lengths. */
function PhoneTabIcon({ tab }: { tab: PhoneTab }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      {tab === 'search' && (
        <>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.3 10.3l3.7 3.7" />
        </>
      )}
      {tab === 'dictionary' && (
        <>
          <path d="M8 4.2C6.6 3.2 4.6 2.8 2 3v9.5c2.6-.2 4.6.2 6 1.2 1.4-1 3.4-1.4 6-1.2V3c-2.6-.2-4.6.2-6 1.2z" />
          <path d="M8 4.2v9.5" />
        </>
      )}
      {tab === 'associations' && <path d="M3.5 2.75h9a1.75 1.75 0 0 1 1.75 1.75v5.5a1.75 1.75 0 0 1-1.75 1.75H7.5L4.5 14v-2.25h-1A1.75 1.75 0 0 1 1.75 10V4.5A1.75 1.75 0 0 1 3.5 2.75z" />}
      {tab === 'components' && (
        <>
          <path d="M7.1 5.2 4.4 10.3M8.9 5.2l2.7 5.1" />
          <circle cx="8" cy="3.6" r="1.85" />
          <circle cx="3.6" cy="12" r="1.85" />
          <circle cx="12.4" cy="12" r="1.85" />
        </>
      )}
    </svg>
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
