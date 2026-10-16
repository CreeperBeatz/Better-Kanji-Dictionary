import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { api, onDataChanged, type GraphResponse, type KanjiNode, type Word } from './api'
import { KanjiGraph, type ContainerFilter } from './graph/KanjiGraph'
import { scopeOf } from './map/mapData'
import { SearchBar } from './search/SearchBar'
import { LevelPage, SearchPage, commonOnly } from './search/Results'
import { Associations } from './detail/Associations'
import { AccountDialog, ProfileButton, type WorkbenchTab } from './account/Account'
import { Workbench } from './review/Workbench'
import { getLang, setLang, strings, useLang, type Lang, type Translate } from './i18n'
import { haptic } from './haptics'
import { clearAuthError, startAuth, useAuth } from './account/auth'
import { DetailPanel, KanjiHead, type DetailData } from './detail/DetailPanel'
import { loadNotes } from './detail/NoteContent'
import { wordsWithKey } from './search/WordsWith'
import { local, runningInstalled } from './local/local'
import { InstallGuide } from './install/InstallGuide'
import { WordHead, WordPanel } from './detail/WordPanel'
import { clampShare, RAIL_MIN, RailResizer, SplitResizer, STAGE_MIN, useRailWidth, useSearchShare } from './RailResizer'
import { GraphDetail, LevelFilter, type StageView } from './StageControls'
import { MapCard } from './map/MapCard'
import { WordKanji } from './graph/WordKanji'
import { rememberKanji, rememberSearch, rememberWord } from './history'
import { pageInUrl, samePage, urlOf, useNav, type Page, type Stack } from './nav'
import { dropReview, pushReview, replaceReview, reviewTabInState, reviewTabInUrl } from './review/route'
import { MOBILE, matches, reducedMotion, useMediaQuery } from './media'
import { warmPage } from './warm'
import { isIOS } from './account/install'
import {
  LINE as FOLDED,
  blankCard,
  comeOff,
  copyCard,
  liveCard,
  fallTime,
  moveTo,
  put,
  putOn,
  trimCard,
  rest,
  rims,
  run,
  stackHeight,
  underOf,
  markLeft,
  type Left,
  type Move,
  type Under,
} from './cardStack'

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
    openCards: '{n} cards open',
    wordsWith: 'Words with {c}',
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
    openCards: '{n} отворени карти',
    wordsWith: 'Думи с {c}',
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

/** A setting that is on unless turned off; off is remembered as '0' under `key`. */
function useOnUnlessOff(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0'
    } catch {
      return true
    }
  })
  const choose = useCallback(
    (next: boolean) => {
      setOn(next)
      try {
        if (next) localStorage.removeItem(key)
        else localStorage.setItem(key, '0')
      } catch {
        // not remembered, which is fine
      }
    },
    [key],
  )
  return [on, choose]
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
      // The keyboard is up: iOS keeps the page's height and covers it. The
      // tabs then go, as in an iPhone's own apps, and do not ride up and down
      // on the keyboard's suggestion strip as it changes.
      root.toggleAttribute('data-keyboard', root.clientHeight - vv.height > 150)
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
      root.style.removeProperty('--app-h')
      root.style.removeProperty('--app-top')
      root.removeAttribute('data-keyboard')
    }
  }, [enabled])
}

// On a wide enough desktop the search gets a column of its own, left of the
// dictionary, so its results stay in view while one of them is open. The
// rail's edge resizes the two together; the edge between them moves the split.
const SPLIT_KEY = 'betterrtk:searchBeside'
// '0' when the graph shows visual splits too (expanded); only the parts (simple) otherwise.
const GRAPH_SIMPLE_KEY = 'betterrtk:graphSimple'
const SPLIT_ROOM = 2 * RAIL_MIN + STAGE_MIN
// On a phone a page's tabs sit along the bottom: Search, left of Dictionary,
// is the search the page was opened from, and Components is the graph.
type PhoneTab = 'search' | 'dictionary' | 'associations' | 'components'
// On a phone a page's associations are a card of their own, opened from its
// head (`notes` on the page), not a tab.
const PHONE_TABS: PhoneTab[] = ['search', 'dictionary', 'components']
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

// The page's own name, from index.html. A hot reload runs this again with a
// page's name already in front ("緑 · …"), so only what follows the last dot counts.
const TITLE = document.title.split(' · ').pop()!

/**
 * How far a quick flick goes sideways across a page to turn to the next tab,
 * or down a page at its top to go to the search. Slower, it takes a third of
 * the way across, or PULL down.
 */
const SWIPE = 40
/** How far a page at its top is pulled down, slowly, to go to the search. */
const PULL = 80
const HAN = /[㐀-䶿一-鿿]/

/**
 * In a browser tab, not the installed app. There the keyboard does not come
 * up by itself on the way back to the search: only when it is asked for, by
 * a tap on the box or a pull or swipe that opens it.
 */
const IN_TAB = !runningInstalled()
/**
 * Whether the screen's edges are the system's: on an iPhone, in Safari and
 * installed alike, a swipe in from the left goes back and from the right
 * forward, the page sliding as it goes, and the app leaves them be. Elsewhere
 * only a browser tab gives them away. The app's own swipes start clear of them.
 */
const EDGES_TAKEN = IN_TAB || isIOS
/** How near the screen's side a touch starts for the system to take it. */
const EDGE = 24
const nearEdge = (x: number) => x < EDGE || x > window.innerWidth - EDGE

/**
 * Whether a touch starting here is the element's own to use sideways: typing,
 * drawing, or a row that scrolls across.
 */
function movesItself(el: Element | null, within: Element): boolean {
  for (let at = el; at && at !== within; at = at.parentElement) {
    // Not the switch over the Dictionary tab: it is the tab, to the finger.
    if (at.matches('input:not(.tab-hold-switch), textarea, canvas, [contenteditable], .excalidraw')) return true
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

/** A card with one on top of it: back a little, and dimmed. */
const SUNK = { filter: 'brightness(0.5)' }

/** How long a page takes to slide in or out. */
const PAGE_MS = 300
/** Room above a card in its clipped slot, for its shadow (theme.css .card-slot). */
const SLOT_ROOM = 40
/** How a card comes up: fast, then settling (as the view transition's, theme.css). */
const RISE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** How long a card takes to come up over the page it was opened from. */
const RISE_MS = 400
/** How long a tab tapped takes to turn. */
const TAP_TURN_MS = 260

/** The other language, and each language by its own name, for the Dictionary tab's menu. */
const otherLang = (lang: Lang): Lang => (lang === 'bg' ? 'en' : 'bg')
const LANG_NAME: Record<Lang, string> = { en: 'English', bg: 'Български' }

/** How long a press on Dictionary is held for its menu. */
const HOLD_MS = 450

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

const keepScrollOnBack = () => !matches(MOBILE)

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
  if (p.kind === 'words') return <>{t('wordsWith', { c: p.char })}</>
  if (!p.q) return <>{t('search')}</>
  return t.lang === 'bg' ? <>„{p.q}“</> : <>“{p.q}”</>
}

/** How many pages before the one gone back to the way back names on a desktop; the rest are counted. */
const TRAIL = 2

/** A page's associations, as a card of their own over its dictionary. */
function hasNotes(p: Page | null | undefined): boolean {
  return !!p && (p.kind === 'kanji' || p.kind === 'word') && !!p.notes
}

/** A page's name as plain text, for a label. */
function labelOf(p: Page, t: T): string {
  if (hasNotes(p)) return `${labelOf({ ...p, notes: false } as Page, t)} · ${t('associations')}`
  if (p.kind === 'kanji') return p.char
  if (p.kind === 'word') return p.word?.headword ?? t('theWord')
  if (p.kind === 'level') return `N${p.level}`
  if (p.kind === 'words') return t('wordsWith', { c: p.char })
  return p.q || t('search')
}

/** Where `el` sits inside `within`, laid out, whatever transforms are on it. */
function offsetIn(el: HTMLElement, within: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  let at: HTMLElement | null = el
  while (at && at !== within) {
    x += at.offsetLeft
    y += at.offsetTop
    at = at.offsetParent as HTMLElement | null
  }
  return { x, y }
}

/** How tall a card's character is in its folded line. */
const FOLDED_GLYPH = 26

/** For an Associations that counts for nobody: one drawn under the open card. */
const noCount = () => {}

/** How long a tap waits at most for what the card it opens shows (see `rise`). */
const READY_MS = 300

/** Whether all a page shows at once is here (see `warm`). */
function known(p: Page): boolean {
  if (p.kind === 'word') return !!api.word.peek(p.id)
  if (p.kind === 'words') return !!api.wordsWithFirst.peek(wordsWithKey(p.char, commonOnly()))
  if (p.kind !== 'kanji') return true
  const c = p.char
  return !!(api.kanji.peek(c) && api.kanjiPage.peek(c) && api.forms.peek(c) && api.fonts.peek(c) && api.similar.peek(c))
}

/** How long a mouse rests on a link before what its page shows is asked for (see `warm`). */
const REST_MS = 80

/** How long a page waits at most to show whole, before it shows what it has. */
const WHOLE_MS = 2500

/**
 * Asks for what a page shows at once, where it is not known yet: for a
 * kanji its details, its page, its forms, its faces and its look-alikes
 * (shown only for a common one, but asked for alongside the rest, not after
 * the details say so). Null where there is nothing to wait for.
 */
function warm(p: Page): Promise<unknown> | null {
  if (known(p)) return null
  if (p.kind === 'word') return api.word(p.id)
  if (p.kind === 'words') return api.wordsWithFirst(wordsWithKey(p.char, commonOnly()))
  const c = (p as { char: string }).char
  return Promise.all([
    api.kanji(c),
    api.similar(c),
    api.kanjiPage(c),
    api.forms(c),
    api.fonts(c),
  ])
}

/**
 * Measures a card's head for folding (read by theme.css): the character ends
 * at the line's left, as tall as the line allows, in the middle of it -- the
 * bottom of the head, which is what shows -- its first meaning beside it,
 * and how common it is at the right end. Returns how tall the head is.
 */
function measureFold(head: HTMLElement): number {
  const h = head.offsetHeight
  head.style.setProperty('--head-h', `${h}px`)
  const glyph = head.querySelector<HTMLElement>('.detail-glyph, .entry-head')
  if (!glyph) return h
  const metaLeft = measureMeta(head, h)
  head.removeAttribute('data-cut')
  const { x, y } = offsetIn(glyph, head)
  const gh = glyph.offsetHeight || 1
  const gs = Math.min(1, FOLDED_GLYPH / gh)
  head.style.setProperty('--gs', String(gs))
  head.style.setProperty('--gx', `${16 - x}px`)
  head.style.setProperty('--gy', `${h - FOLDED / 2 - (y + gh / 2)}px`)
  // After the characters themselves: a word's head is as wide as its reading.
  const lead = head.querySelector<HTMLElement>('.detail-meanings')
  if (lead) {
    const chars = glyph.children.length
      ? [...glyph.children].reduce((w, c) => w + (c as HTMLElement).offsetWidth, 0)
      : glyph.offsetWidth
    const at = offsetIn(lead, head)
    const style = getComputedStyle(lead)
    const size = parseFloat(style.fontSize) || 15
    const ms = Math.min(1, 15 / size)
    const lh = parseFloat(style.lineHeight) || size * 1.4
    head.style.setProperty('--ms', String(ms))
    head.style.setProperty('--mx', `${16 + chars * gs + 10 - at.x}px`)
    head.style.setProperty('--my', `${h - FOLDED / 2 - at.y - (lh * ms) / 2}px`)
    // Where it would run under how common it is, it fades out before.
    const over = 16 + chars * gs + 10 + lead.offsetWidth * ms - (metaLeft - META_GAP)
    if (over > 0) {
      head.setAttribute('data-cut', '')
      head.style.setProperty('--mr', `${over / ms}px`)
    }
  }
  return h
}

/** Between the first meaning and how common it is, in a card's folded line. */
const META_GAP = 12

/**
 * How common a card's subject is stays in its folded line, along the right
 * end, in the middle of it: "common" comes down, and the level and rank go
 * up beside it, to its left. Returns where they then start, from the left.
 */
function measureMeta(head: HTMLElement, h: number): number {
  const common = head.querySelector<HTMLElement>('.head-meta > .word-common')
  if (!common) return Infinity
  const mid = h - FOLDED / 2
  const c = offsetIn(common, head)
  head.style.setProperty('--cy', `${mid - c.y - common.offsetHeight / 2}px`)
  const rest = head.querySelector<HTMLElement>('.head-meta > .word-meta')
  if (!rest) return c.x
  const r = offsetIn(rest, head)
  const left = c.x - 8 - rest.offsetWidth
  head.style.setProperty('--wx', `${left - r.x}px`)
  head.style.setProperty('--wy', `${mid - r.y - rest.offsetHeight / 2}px`)
  return left
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
  if (p.kind === 'words') return `${p.char} · ${TITLE}`
  if (p.kind === 'search' && p.q) return `${p.q} · ${TITLE}`
  return TITLE
}

export function App() {
  const t = S(useLang())
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Filled in below: what to do as back or forward arrives, before the page changes.
  const beforePop = useRef<((e: PopStateEvent, apply: () => void, byApp: boolean) => boolean) | null>(null)
  // Back comes to where the page was left. On a phone only to the card right
  // under the open one, whose copy keeps its page down to there (see
  // keepUnder): the ones further down come back at their top.
  const backScroll = useRef<((stack: Stack) => number | null) | null>(null)
  const { stack, stage, depth, push, reset, replaceTop, openOver, rebase, pop, enterStage, leaveStage } = useNav(
    scroller,
    beforePop,
    keepScrollOnBack,
    backScroll,
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
  const [simpleGraph, chooseSimple] = useOnUnlessOff(GRAPH_SIMPLE_KEY)
  const [view, setViewState] = useState<StageView>(initialView)
  // The map is expensive to lay out, so once opened it stays mounted and keeps
  // its camera while the focus view is showing.
  const [mapOpened, setMapOpened] = useState(view === 'map')
  const [railWidth, setRailWidth] = useRailWidth()
  const [searchShare, setSearchShare] = useSearchShare()
  // On a phone the search is a tab of the page too: the page it was turned to
  // from, so going anywhere else leaves it. Compared as a page, not an object:
  // leaving the graph for it comes back through history, as a copy.
  const [searchOver, setSearchOver] = useState<Page | null>(null)
  // How many associations a page has, told by its Associations as they load.
  const [assocCount, setAssocCount] = useState<{ key: string; n: number }>({ key: '', n: 0 })
  const counters = useRef(new Map<string, (n: number) => void>())
  function counterFor(key: string) {
    let f = counters.current.get(key)
    if (!f) {
      f = (n: number) => setAssocCount((c) => (c.key === key && c.n === n ? c : { key, n }))
      counters.current.set(key, f)
    }
    return f
  }

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
  const [splitPref, rememberSplit] = useOnUnlessOff(SPLIT_KEY)
  const room = !mobile && windowWidth >= SPLIT_ROOM
  // The map wants the room the search column takes, so while it is up the
  // column is folded away -- not as a choice, just for the map -- and is back
  // as it was on leaving it. The app opening on the map counts too.
  const [mapFolded, setMapFolded] = useState(() => view === 'map')
  useEffect(() => {
    if (view !== 'map') setMapFolded(false)
  }, [view])
  const split = room && splitPref && !mapFolded
  const chooseSplit = useCallback(
    (on: boolean) => {
      setMapFolded(false)
      rememberSplit(on)
    },
    [rememberSplit],
  )
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
  // Known already -- a page come back to -- it is there at once.
  const detail: DetailData | null =
    data?.focus.char === focus
      ? data
      : onDevice?.focus.char === focus
        ? onDevice
        : focus
          ? (api.kanji.peek(focus) ?? null)
          : null

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
          : (api.kanji.peek(char) ?? null)

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
  // just below, as when a word's kanji is the one it was opened from.
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
      else rise({ kind: 'kanji', char }, go)
    },
  )

  // A word, like a character, goes to its graph -- of its kanji -- when it has one.
  const openWord = useStable(
    (w: Word) => {
      keepSearch()
      rise(wordPage(w), () => {
        leaveStage('replace')
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
        else rise({ kind: 'kanji', char }, go)
        return
      }
      const page: Page = char === focus || !focus ? { kind: 'kanji', char } : { kind: 'kanji', char, centre: focus }
      const picked = top.kind === 'kanji' && top.centre !== undefined && top.centre === focus
      leaveStage('replace')
      if (under?.kind === 'kanji' && under.char === char && (under.centre ?? under.char) === focus) return pop()
      if (picked && top.char === char) return
      rise(page, () => {
        if (!picked) return push(page)
        replaceTop(page)
        if (scroller.current) scroller.current.scrollTop = 0
      })
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
      rise({ kind: 'kanji', char }, () => {
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

  // The search under the pages, as it stands: its query, and its mode.
  const searchBase: Page = root.kind === 'search' ? { ...root, q } : { kind: 'search', q }
  const searchWords = root.kind === 'search' ? root.words : undefined

  // A pick from the search column replaces what is open beside it.
  function openOverSearch(p: Picked) {
    setHovered(null)
    if (p.kind === 'kanji' || HAN.test(p.word.headword)) setViewState('focus')
    rememberSearch(q)
    openOver(searchBase, p)
  }
  const listPick = (p: Picked) => rise(p, () => openOverSearch(p))
  const listKanji = useStable((char: string) => listPick(kanjiPage(char)))
  const listWord = useStable((w: Word) => listPick(wordPage(w)))

  const deselect = useStable(() => {
    setHovered(null)
    setFocus(null)
    if (top.kind === 'kanji') reset(searchBase)
  })

  // Typing is a search: the first key starts a new stack, the rest change it.
  const type = useCallback(
    (text: string) => {
      setQ(text)
      leaveStage('replace')
      const page: Page = { kind: 'search', q: text }
      // Beside the dictionary, the results change and the open entry stays.
      if (split) rebase(page)
      else if (stack.length === 1 && stack[0].kind === 'search') replaceTop(page)
      else reset(page)
    },
    [split, stack, replaceTop, reset, rebase, leaveStage],
  )

  // Going into the box leaves the page up, so a slip of the finger costs
  // nothing: only typing starts a search. Off the search, what it holds is
  // selected, for a new one to replace.
  const focusSearch = useCallback(() => !split && top.kind !== 'search', [split, top])

  // Enter on what the box already holds goes to that search, back down the
  // stack if that is where it is.
  const toSearch = useCallback(() => {
    if (split || top.kind === 'search') return
    leaveStage('replace')
    if (root.kind === 'search' && root.q === q) pop(stack.length - 1)
    else reset({ kind: 'search', q })
  }, [split, top, root, q, stack.length, pop, reset, leaveStage])

  // Back -- the browser's, or the app's -- to the search brings the keyboard
  // up with it, ready for the next word. Phones raise the keyboard for focus
  // given as a gesture is answered, so it is asked at once.
  const cameBack = useRef(0)
  const goBack = useStable(() => {
    cameBack.current = performance.now()
    pop()
  })
  /** A card pulled off: the page under it is in sight already, so nothing slides. */
  const dropped = useRef(false)
  /** Back, by any way: the page was seen already, so it does not arrive again. */
  const returning = useRef(false)
  /** Back to a card under this one, on a phone: it shows its dictionary, however it was left. */
  const toCard = useRef(false)
  // Back `k` pages at once, sliding: as history slides it, when it goes
  // through history, or here when the pages come off in place. `still`: the
  // card has gone already, pulled off, and the page under it is in sight.
  const popBy = useStable((k: number, still: boolean = false) => {
    cameBack.current = performance.now()
    dropped.current = still
    returning.current = true
    toCard.current = true
    if (depth >= k || still) pop(k)
    else animateNav('back', () => pop(k))
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
      // The app in the other language, and back, as the switch in the profile does.
      if (e.key === 't' || e.key === 'T') setLang(otherLang(getLang()))
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

  function page(p: Page, live = false) {
    if (hasNotes(p)) {
      const s = subjectOf(p)
      return s && associations(s, live)
    }
    switch (p.kind) {
      case 'search':
        return (
          <SearchPage
            q={p.q}
            words={p.words}
            onKanji={openKanji}
            onWord={openWord}
            onSearch={type}
            asked={asked}
            onAsk={setAsked}
            onMap={browseMap}
            onWordsWith={showWords}
            railBack={shownUnder !== null}
          />
        )
      case 'level':
        return <LevelPage level={p.level} onKanji={openKanji} />
      case 'words':
        return (
          <SearchPage
            q=""
            words={p.char}
            onKanji={openKanji}
            onWord={openWord}
            onSearch={type}
            asked={asked}
            onAsk={setAsked}
            onMap={browseMap}
            railBack
          />
        )
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
            notes={notesButton(p, live)}
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
            onWordsWith={showWords}
            notes={notesButton(p, live)}
          />
        ) : null
      }
    }
  }

  // Kanji and words carry associations; searches and levels do not, so
  // there the tab steps aside and the page shows.
  function subjectOf(p: Page | null) {
    return p?.kind === 'kanji'
      ? { key: p.char, label: p.char }
      : p?.kind === 'word'
        ? { key: `word:${p.id}`, label: p.word?.headword ?? t('thisWord') }
        : null
  }
  const subject = subjectOf(shownTop)
  // A page the tabs treat as a card: a kanji, a word, or every word with a kanji.
  const carded = subject !== null || shownTop?.kind === 'words'
  const notesCount = subject && assocCount.key === subject.key ? assocCount.n : 0
  const subjectKey = subject?.key ?? null
  // The page shows its dictionary, or its associations when it is their page.
  const notesShown = hasNotes(shownTop)
  // Its associations are mounted under its dictionary too, unseen, for their
  // count, but only once the page has come to rest: comments rendered behind
  // a page sliding in cost it frames.
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    if (!subjectKey) return
    const t = window.setTimeout(() => {
      setSettled(subjectKey)
      // Its associations are a tap away: what draws their notes, ready.
      loadNotes()
    }, mobile ? PAGE_MS + 160 : 0)
    return () => clearTimeout(t)
  }, [subjectKey, mobile])
  function associations(s: { key: string; label: string }, live = false) {
    return (
      <Associations
        key={s.key}
        subject={s.key}
        label={s.label}
        onPick={openKanji}
        onSignIn={signIn}
        onCount={live ? noCount : counterFor(s.key)}
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
      const node = (!notesShown && hoveredNode) || detailOf(shownTop.char)?.focus
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
  // The Search tab shows the search with the page marked in it, and the page
  // still there to turn back to.
  const searchShown = mobile && !onStage && carded && searchOver !== null && samePage(searchOver, top)
  // On a phone the open page is a card: pulled down, it comes off, if it
  // lies on another. The pages opened before it show their edges above it --
  // not the search or level list they were all opened from, which is the
  // table, and which a pull on the first card types over instead.
  const onCard = mobile && !searchShown && shownTop !== null && (shownUnder !== null || shownTop.kind !== 'search')
  const base = entries[0]?.kind === 'search' || entries[0]?.kind === 'level' ? 1 : 0
  const stackUnder = entries.slice(base, -1)
  const stackShown = onCard && stackUnder.length > 0
  const cardRef = useRef<HTMLDivElement>(null)
  // A tap on a card's rim takes the cards over it off, as a pull does.
  function pickUnder(i: number) {
    const k = stackUnder.length - i
    if (!takeOff(k, () => popBy(k, true))) popBy(k)
  }
  // The card left at each step forward, copied as it shows, to lie under the
  // ones opened over it (see cardStack.ts): `at` is where it is in the stack.
  // Not the search: the first card lies on it, not on a card. It is copied
  // when left -- for a new card, or for the graph or the search, which are
  // not drawn over it -- and a copy kept from before stays while it is not on
  // the screen. A card never seen at all -- one gone to on the graph, say --
  // is drawn there live.
  const underCopies = useRef<{ page: Page; at: number; el: HTMLElement; live?: boolean }[]>([])
  function keepUnder() {
    const card = cardRef.current
    const sc = scroller.current
    const page = shownTop
    const at = entries.length - 1
    if (!page) return
    const kept = underCopies.current.filter(
      (u) => u.at < at || (u.at === at && !u.live && samePage(u.page, page)),
    )
    if (!onCard || onStageRef.current || !card || !sc) {
      underCopies.current = kept
      return
    }
    // Down to where it was read, for going on the stack from there (see stackOn)
    // and coming back to it there (cardStack.ts comeOff).
    const top = card.getBoundingClientRect().top - sc.getBoundingClientRect().top
    const past = Math.max(0, -top)
    const el = copyCard(card, sc.clientHeight + past)
    markLeft(el, { top, p: parseFloat(headRef.current?.style.getPropertyValue('--p') || '0') || 0, scroll: sc.scrollTop })
    // Only the card right under the open one comes back where it was left:
    // the ones further down forget, and keep only their top.
    const deeper = kept.filter((u) => u.at < at)
    for (const u of deeper) {
      if (u.el.dataset.left === undefined) continue
      delete u.el.dataset.left
      trimCard(u.el, sc.clientHeight)
    }
    underCopies.current = [...deeper, { page, at, el }]
  }
  /** Where the page at `at` was scrolled when it was left, if it is to come back there: the card right under the open one. */
  function leftScroll(at: number, page: Page | undefined): number | null {
    const c = page && underCopies.current.find((u) => u.at === at && samePage(u.page, page))
    return c?.el.dataset.left ? (JSON.parse(c.el.dataset.left) as Left).scroll : null
  }
  backScroll.current = (to: Stack) => (mobile ? (leftScroll(to.length - 1, to[to.length - 1]) ?? 0) : null)
  /** The copy of the card at `at`, or a live one where none was kept. */
  function cardAt(at: number, page: Page) {
    const kept = underCopies.current.find((c) => c.at === at && samePage(c.page, page))
    if (kept) return kept
    const drawn = page.kind === 'kanji' || page.kind === 'word'
    const live = { page, at, el: drawn ? liveCard() : blankCard(labelOf(page, t)), live: drawn }
    underCopies.current.push(live)
    return live
  }
  // Only while they show: not behind the graph or the search.
  const underCards = stackShown ? stackUnder.map((p, i) => cardAt(base + i, p)) : []
  /** A live card under the open one: its head and its dictionary. */
  function liveUnder(p: Page) {
    const node = p.kind === 'kanji' ? detailOf(p.char)?.focus : undefined
    const head =
      p.kind === 'kanji' ? (
        node ? (
          <KanjiHead node={node} />
        ) : (
          <div className="detail-head">
            <span className="detail-glyph">{p.char}</span>
          </div>
        )
      ) : p.kind === 'word' && p.word ? (
        <WordHead word={p.word} onPick={openKanji} />
      ) : null
    return (
      <>
        <div className="page-head" data-folding="">
          <section className={p.kind === 'word' ? 'rail-section word-panel' : 'rail-section'}>{head}</section>
        </div>
        <div className="tab-pane">{page(p, true)}</div>
      </>
    )
  }
  // The cards under the open one, where they rest. The box holding them is
  // React's but empty to it; what is in it is laid here.
  const copiesRef = useRef<HTMLDivElement>(null)
  const unders = useRef<Under[]>([])
  useLayoutEffect(() => {
    const box = copiesRef.current
    const sc = scroller.current
    unders.current = []
    if (!box || !sc) return
    box.style.height = `${sc.clientHeight - (parseFloat(getComputedStyle(sc).paddingTop) || 0)}px`
    const els = underCards.map((c) => c.el)
    box.replaceChildren(...els)
    // A live card's head is measured as the open card's is, and again as
    // what it shows comes in.
    const heads = underCards.flatMap((c) => {
      const head = c.live ? c.el.querySelector<HTMLElement>(':scope > .page-head') : null
      return head ? [head] : []
    })
    const lay = () => {
      heads.forEach(measureFold)
      unders.current = els.map(underOf)
      unders.current.forEach((u, i) => put(u, rest(els.length, i, u.fold)))
    }
    lay()
    if (!heads.length) return
    const ro = new ResizeObserver(lay)
    heads.forEach((h) => ro.observe(h))
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, stackShown])
  // Scrolling down a card, its head folds into a line along the top: its
  // character shrinks to the line's left with its first meaning beside it,
  // and the rest squeezes away. The head is sticky, as tall as itself less
  // the line, so the line is what stays. --p on it is how far it is folded,
  // 0 to 1 (read by theme.css); the measures it folds by are taken when its
  // size changes.
  const folding = (!mobile || onCard) && (shownTop?.kind === 'kanji' || shownTop?.kind === 'word')
  const headRef = useRef<HTMLDivElement>(null)
  const fold = useRef<{ h: number } | null>(null)
  const foldHead = useStable(() => {
    const sc = scroller.current
    const head = headRef.current
    const card = cardRef.current
    const m = fold.current
    if (!sc || !head || !card || !m) return
    // As the card's top goes past the top of the screen.
    const past = sc.getBoundingClientRect().top - card.getBoundingClientRect().top
    const p = Math.min(1, Math.max(0, past / Math.max(1, m.h - FOLDED)))
    head.style.setProperty('--p', p.toFixed(3))
    head.toggleAttribute('data-collapsed', p >= 1)
  })
  useLayoutEffect(() => {
    const sc = scroller.current
    const head = headRef.current
    fold.current = null
    if (!folding || !sc || !head) return
    const measure = () => {
      fold.current = { h: measureFold(head) }
      foldHead()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(head)
    let frame = 0
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), foldHead()))
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      sc.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
    // Measured again in another language: the head may keep its height
    // while its lines move inside it.
  }, [folding, shownTop, searchShown, onStage, foldHead, t.lang])
  // A page's associations, from beside its first title: a page of their own
  // -- on a phone, a card -- over its dictionary, back from which is the
  // dictionary again.
  const openNotes = useStable(() => {
    if (!shownTop || (shownTop.kind !== 'kanji' && shownTop.kind !== 'word') || shownTop.notes) return
    const p: Page = { ...shownTop, notes: true }
    rise(p, () => push(p))
  })
  // In a page drawn under the open card it is only a picture, with no count.
  function notesButton(p: Page, live: boolean) {
    if (p.kind !== 'kanji' && p.kind !== 'word') return undefined
    // The count's circle is always there; the number comes into it once known.
    const known = !live && subject !== null && assocCount.key === subject.key
    return (
      <button
        className="notes-chip"
        aria-label={known ? `${t('associations')} ${notesCount}` : t('associations')}
        onClick={live ? undefined : openNotes}
      >
        <span className="notes-chip-icon" aria-hidden>
          <PhoneTabIcon tab="associations" />
        </span>
        {t('associations')}
        <span className="notes-chip-count" aria-hidden>
          {known ? notesCount : ''}
        </span>
      </button>
    )
  }
  // A tap on the folded line goes to the card's top, whatever it is on.
  function onHeadTap(e: React.MouseEvent) {
    if (!headRef.current?.hasAttribute('data-collapsed')) return
    e.preventDefault()
    e.stopPropagation()
    toCardTop()
  }
  // On a phone the search bar lies over the top of the page, so it can slide
  // away without the page moving: the page starts as far down as it is tall.
  useLayoutEffect(() => {
    const box = searchBarOf(inputRef.current)
    const grid = box?.closest<HTMLElement>('.shell-grid')
    if (!mobile || !box || !grid) return
    const measure = () => grid.style.setProperty('--bar-h', `${box.offsetHeight}px`)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [mobile])
  function toCardTop() {
    scroller.current?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  // With a mouse, what a page shows is asked for as the pointer rests on a
  // link to it (warm.ts) or on its character on the graph, so the click
  // finds it here and the page comes whole at once.
  useEffect(() => {
    let timer = 0
    let at: Element | null = null
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = e.target instanceof Element ? e.target.closest('[data-warm]') : null
      if (el === at) return
      at = el
      window.clearTimeout(timer)
      const p = el && warmPage(el.getAttribute('data-warm') ?? '')
      if (p) timer = window.setTimeout(() => warm(p)?.catch(() => {}), REST_MS)
    }
    document.addEventListener('pointerover', over, { passive: true })
    return () => {
      document.removeEventListener('pointerover', over)
      window.clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    if (!hovered || mobile) return
    const timer = window.setTimeout(() => warm({ kind: 'kanji', char: hovered })?.catch(() => {}), REST_MS)
    return () => window.clearTimeout(timer)
  }, [hovered, mobile])
  // A card shows whole: until all its page shows at once is here, it has its
  // head and a blank below it, not its parts coming in one by one, each
  // pushing the next down. Once that is here -- or has failed, or after
  // WHOLE_MS, offline say -- it shows what it has.
  const [, setWarmed] = useState(0)
  const released = useRef(new Set<string>())
  const keyOf = (p: Page) =>
    p.kind === 'kanji' ? p.char : p.kind === 'word' ? `word:${p.id}` : p.kind === 'words' ? `words:${p.char}` : ''
  const waiting =
    shownTop !== null && !hasNotes(shownTop) && !known(shownTop) && !released.current.has(keyOf(shownTop))
  useEffect(() => {
    if (!waiting || !shownTop) return
    const key = keyOf(shownTop)
    let done = false
    const show = () => {
      if (done) return
      done = true
      released.current.add(key)
      afterSlide(() => setWarmed((n) => n + 1))
    }
    warm(shownTop)?.then(show, show)
    const timer = window.setTimeout(show, WHOLE_MS)
    return () => {
      done = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, shownTop])
  // The search itself, and a level's list, have the tabs too, with only Search
  // to be had: they are there before a page is opened, not brought by it.
  const phoneTab: PhoneTab =
    onStage && view === 'focus' ? 'components' : searchShown || !carded ? 'search' : 'dictionary'
  // On a phone a card -- its dictionary, its associations, its graph -- has
  // no search over it: the Search tab is the way to it. What shows instead,
  // at the top and on the tabs, is how many cards are open.
  const barOff = mobile && carded && phoneTab !== 'search'
  const openCards = mobile ? entries.length - base : 0
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
    // What lies under a page opened from another tab is this one's
    // dictionary, as it was left.
    keepUnder()
    if (to === 'components') setView('focus')
    else leaveStage('back')
  }
  // A pick in the search tab: the page already open turns back to; another
  // opens over the search, as a pick in the search column does.
  function openFromSearchTab(p: Picked) {
    if (samePage(p, top)) return tapPhoneTab('dictionary')
    leaveSearchTab()
    rise(p, () => {
      setSearchOver(null)
      leaveStage('replace')
      openOverSearch(p)
    })
  }
  // "All words with 日". On a phone, from a card, a card of their own. In the
  // search -- its column beside the card, or the phone's Search tab -- the
  // search turns to them, by meaning, and the card stays where it is. From a
  // kanji's page with one page at a time (one column), they open over the
  // page, so back comes to the kanji before the search. Null turns the search
  // back to its results.
  const showWords = useStable((char: string | null) => {
    const page: Page = char ? { kind: 'search', q, words: char } : { kind: 'search', q }
    setHovered(null)
    if (mobile && char && onCard) {
      const card: Page = { kind: 'words', char }
      return rise(card, () => push(card))
    }
    if (split || searchShown) return rebase(page)
    if (top.kind === 'search') return replaceTop(page)
    push(page)
  })
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
    last: { x: number; y: number; at: number }
    /** Sideways speed, px/ms. */
    v: number
    /** Downward speed, px/ms: a quick flick down opens the search, as one across does. */
    vy: number
    /** What follows the finger: the pane, or the whole page. */
    moved: HTMLElement | null
    /** The open card: a pull down moves it. */
    card: HTMLElement | null
    /** Whether a pull down takes the card off, or brings up the search. */
    back: boolean
    /** How the cards under it move as it is pulled off (cardStack.ts). */
    plan: Move[] | null
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
    return p !== 'search' && (!carded || (p === 'components' && !componentsOf))
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
    if (EDGES_TAKEN && nearEdge(e.touches[0].clientX)) return
    // On the graph only while it is locked: free, a finger moves the graph.
    if (e.currentTarget === stageRef.current && (view !== 'focus' || !graphLocked)) return
    if (movesItself(e.target as Element, e.currentTarget)) return
    // A card still falling off is gone, and the page under it up, for this
    // finger to go on with. A page still sliding in is where it is going --
    // but a card coming up goes on coming, under a finger that scrolls it.
    flight.current?.()
    scroller.current?.getAnimations({ subtree: true }).forEach((a) => a !== riseAnim.current && a.finish())
    document.querySelectorAll('[data-ghost]').forEach((g) => g.remove())
    const touch = e.touches[0]
    swipe.current = {
      x: touch.clientX,
      y: touch.clientY,
      mode: null,
      turns: carded || onSearchPage,
      // The tabs along the bottom turn too, but do not pull.
      // Under a pixel: on a phone the top can rest at a fraction of one.
      atTop: e.currentTarget === scroller.current && e.currentTarget.scrollTop < 1,
      last: { x: touch.clientX, y: touch.clientY, at: e.timeStamp },
      v: 0,
      vy: 0,
      moved: null,
      card: onCard && e.currentTarget === scroller.current ? cardRef.current : null,
      // Only off a card on another card: on the first, the search it was
      // opened from is a tab away, and a pull brings up the keyboard over it.
      back: stackShown,
      plan: null,
    }
    // A pull may follow: the card gets a layer of its own before the finger
    // has moved far enough to tell.
    const s = swipe.current
    if (s.card && s.back && s.atTop && unders.current.length > 0) s.card.dataset.moving = ''
  }
  function swipeMove(e: React.TouchEvent) {
    const s = swipe.current
    if (!s || !scroller.current) return
    if (e.touches.length !== 1) return swipeCancel()
    const touch = e.touches[0]
    const dx = touch.clientX - s.x
    let dy = touch.clientY - s.y
    if (s.mode === null) {
      if (Math.hypot(dx, dy) < 10) return
      if (Math.abs(dx) > 1.5 * Math.abs(dy)) s.mode = s.turns ? 'turn' : null
      else if (dy > 0 && s.atTop) {
        s.mode = 'pull'
        // The card starts moving from here, not with a jump of the way it
        // took to tell a pull from a tap.
        s.y = touch.clientY
        dy = 0
        // The stack as it is now: a card that fell off as this finger came
        // down has gone by now, and the page under it is up.
        finishRise()
        s.card = onCard ? cardRef.current : null
        s.back = stackShown
        s.plan = s.card && s.back && unders.current.length > 0 ? comeOff(unders.current, 1, scroller.current.clientHeight) : null
      }
      if (s.mode === 'turn') finishRise()
      // Anything else is the page scrolling, which is the browser's.
      if (s.mode !== 'pull' && s.card) delete s.card.dataset.moving
      if (s.mode === null) {
        swipe.current = null
        return
      }
    }
    const dt = e.timeStamp - s.last.at
    if (dt > 0) {
      s.v = 0.7 * ((touch.clientX - s.last.x) / dt) + 0.3 * s.v
      s.vy = 0.7 * ((touch.clientY - s.last.y) / dt) + 0.3 * s.vy
    }
    s.last = { x: touch.clientX, y: touch.clientY, at: e.timeStamp }
    if (s.mode === 'pull') {
      // On a stack the card comes down with the finger, and the cards under it
      // move as far towards where they go. The first card only gives a
      // little: under it is the search, which lights up instead.
      const down = Math.max(0, dy)
      if (s.card) {
        s.card.dataset.moving = ''
        s.card.style.transform = `translateY(${s.back ? down : down / 3}px)`
      }
      if (s.plan) moveTo(s.plan, Math.min(1, down / scroller.current.clientHeight))
      else searchBarOf(inputRef.current)?.toggleAttribute('data-pulled', dy > PULL)
      return
    }
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
      const dy = e.changedTouches[0].clientY - s.y
      const down = Math.max(0, dy)
      const far = dy > PULL || (s.vy > 0.4 && dy > SWIPE)
      const plan = s.plan
      if (plan && far && takeOff(1, () => popBy(1, true), { down, vy: s.vy, plan })) return
      if (s.card) settle(s.card, plan, s.back ? down : down / 3)
      // On the first card: the search, typing. The box comes up at once,
      // focused from the touch itself (see typeOver), and its tab after it.
      if (far && !s.back) {
        typeOver()
        toPhoneTab('search')
      }
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
    if (s?.card) settle(s.card, s.plan, new DOMMatrix(getComputedStyle(s.card).transform).m42)
    if (s?.mode !== 'turn' || !el) return
    dragMark(null)
    const at = new DOMMatrix(getComputedStyle(el).transform).m41
    el.style.transform = ''
    slide(el, at, 0, 220)
  }
  /**
   * Takes the open card off and `k - 1` under it, as things: the open card
   * falls off the bottom -- from where a finger left it (`from`), at the speed
   * it was thrown -- and the cards under it move with it to where they go
   * (cardStack.ts). Then `commit` makes the card come back to the open one, in
   * the place its copy came to. False where there is no stack to move.
   */
  function takeOff(k: number, commit: () => void, from?: { down: number; vy: number; plan: Move[] }): boolean {
    const card = cardRef.current
    const sc = scroller.current
    if (!card || !sc || !pagesSlide() || onStageRef.current || unders.current.length < k) return false
    const h = sc.clientHeight
    const plan = from?.plan ?? comeOff(unders.current, k, h, sc.scrollTop)
    const down = from?.down ?? 0
    const t0 = down / h
    card.dataset.moving = ''
    const step = (e: number) => {
      card.style.transform = `translateY(${down + (h - down) * e}px)`
      moveTo(plan, t0 + (1 - t0) * e)
    }
    let over = false
    const end = () => {
      if (over) return
      over = true
      flight.current = null
      commit()
    }
    const stop = run(from ? fallTime(h - down, from.vy) : 380, step, end)
    flight.current = () => {
      stop()
      step(1)
      end()
    }
    // Should the page not change after all, it comes back.
    window.setTimeout(() => {
      if (card.dataset.moving === undefined) return
      dropped.current = false
      settle(card, plan, h)
    }, 1300)
    return true
  }
  /** A card let go of short of going: back up into its place, the cards under it back to theirs. */
  function settle(card: HTMLElement, plan: Move[] | null, down: number) {
    const h = scroller.current?.clientHeight || 1
    const t0 = Math.min(1, down / h)
    const step = (e: number) => {
      card.style.transform = `translateY(${down * (1 - e)}px)`
      if (plan) moveTo(plan, t0 * (1 - e))
    }
    run(reducedMotion() ? 0 : 240, step, () => {
      card.style.transform = ''
      delete card.dataset.moving
      // A card that came back read down its page stood where it was; back in the stack, it rests.
      unders.current.forEach((u, i) => put(u, rest(unders.current.length, i, u.fold)))
    })
  }
  // A pull down at the top is the app's, not the browser's. Chrome would take
  // it as a scroll with nowhere to go, and a touch that ends a scroll is no
  // tap: the box is focused, but the keyboard stays down. A sideways swipe is
  // the app's too: touch-action keeps the page from moving sideways, but not
  // up and down with the finger as it drifts, on a page long enough to scroll.
  // It is claimed from the first move, as a scroll once begun is the browser's.
  // React's touch listeners are passive, so this one is the page's own.
  useEffect(() => {
    const el = scroller.current
    if (!el || !mobile) return
    function claim(e: TouchEvent) {
      const s = swipe.current
      const touch = e.touches[0]
      if (!s || !touch || !e.cancelable) return
      const dx = touch.clientX - s.x
      const dy = touch.clientY - s.y
      if (s.mode === 'turn' || (s.mode === null && s.turns && Math.abs(dx) > Math.abs(dy))) return e.preventDefault()
      if (s.atTop && dy > 0 && dy >= Math.abs(dx)) e.preventDefault()
    }
    el.addEventListener('touchmove', claim, { passive: false })
    return () => el.removeEventListener('touchmove', claim)
  }, [mobile])
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
  function phoneTabButton(p: PhoneTab) {
    return (
      <button
        key={p}
        role="tab"
        aria-selected={phoneTab === p}
        disabled={tabOff(p)}
        data-press={(p === 'dictionary' && holding) || undefined}
        onClick={() => tapPhoneTab(p)}
      >
        <span className="phone-tab-icon">
          <PhoneTabIcon tab={p} />
          {p === 'dictionary' && openCards > 1 && (
            <span className="tab-depth" key={openCards} aria-label={t('openCards', { n: openCards })}>
              {openCards}
            </span>
          )}
        </span>
        {t(p === 'components' ? 'focus' : p === 'search' ? 'searchTab' : p)}
      </button>
    )
  }
  // Dictionary held down opens a menu over it: the app in the other language,
  // the same switch as the profile's.
  const [tabMenu, setTabMenu] = useState(false)
  const tabMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => setTabMenu(false), [subjectKey])
  useEffect(() => {
    if (!tabMenu) return
    const off = (e: PointerEvent) => {
      if (!tabMenuRef.current?.contains(e.target as Node)) setTabMenu(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setTabMenu(false)
    document.addEventListener('pointerdown', off, true)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', off, true)
      window.removeEventListener('keydown', esc)
    }
  }, [tabMenu])
  function pickLang() {
    setTabMenu(false)
    setLang(otherLang(t.lang))
  }
  // The menu opens with a tick in the hand. An iPhone ticks for a switch
  // only (haptics.ts), and not from a timer: as a finger drags its thumb
  // across, or as a lift clicks it (WebKit's CheckboxInputType). So a switch,
  // unseen, lies over the tab and takes its touches. Where the finger is on
  // it is measured on its layout, moves included: held, the switch is kept
  // with the finger at its "off" end; as the menu opens it jumps to have the
  // finger at its "on" end, and the finger's next stir, however slight, is a
  // drag across: the tick. Should the finger not stir, the lift ticks
  // instead (once: the drag already turned it). A tap: the switch is off
  // before WebKit sees the lift, so it neither clicks nor ticks, and the tab
  // is gone to. With the Vibration API (Android) the menu opens buzzing.
  const press = useRef<{
    x: number
    y: number
    timer: number
    ready: boolean
    moved: boolean
    shift: number
    width: number
  } | null>(null)
  const [holding, setHolding] = useState(false)
  // Off until the browser is done with this touch: no click, no tick.
  const quiet = (el: HTMLInputElement) => {
    el.disabled = true
    window.setTimeout(() => (el.disabled = false), 400)
  }
  /** Where along the switch the finger is to be: near its off end, or, once held, its on end. */
  const SWITCH_END = 8
  const pin = (el: HTMLInputElement, x: number) => {
    const p = press.current
    if (!p) return
    const at = p.ready && !p.moved ? p.width - SWITCH_END : SWITCH_END
    // From where it is now, less its own move: the bar slides under a swipe.
    const left = el.getBoundingClientRect().left - p.shift
    p.shift = x - left - at
    el.style.transform = `translateX(${p.shift}px)`
    // Laid out now: WebKit measures the finger on the switch's layout as
    // this touch is handled, without laying it out itself.
    el.getBoundingClientRect()
  }
  const holdSwitch = {
    start(e: React.TouchEvent<HTMLInputElement>) {
      if (e.touches.length !== 1) return
      const el = e.currentTarget
      const { clientX: x, clientY: y } = e.touches[0]
      el.style.transform = ''
      const p = {
        x,
        y,
        ready: false,
        moved: false,
        shift: 0,
        width: el.getBoundingClientRect().width,
        timer: window.setTimeout(() => {
          p.ready = true
          pin(el, p.x)
          haptic()
          setTabMenu(true)
        }, HOLD_MS),
      }
      press.current = p
      pin(el, x)
      setHolding(true)
    },
    // Kept where it was put under a finger that stirs. A swipe along the bar
    // is no hold and ends in no click; the switch stays on while it moves
    // (off, it would get the rest of the swipe no more, nor would the bar).
    move(e: React.TouchEvent<HTMLInputElement>) {
      const p = press.current
      const t0 = e.touches[0]
      if (!p || !t0) return
      if (!p.moved && Math.hypot(t0.clientX - p.x, t0.clientY - p.y) > 10) {
        p.moved = true
        window.clearTimeout(p.timer)
        setHolding(false)
      }
      if (!p.ready || p.moved) p.x = t0.clientX
      pin(e.currentTarget, t0.clientX)
    },
    end(e: React.TouchEvent<HTMLInputElement>) {
      const p = press.current
      const el = e.currentTarget
      press.current = null
      setHolding(false)
      // Back over the tab once WebKit is done with the lift.
      window.setTimeout(() => (el.style.transform = ''), 0)
      if (!p) return
      window.clearTimeout(p.timer)
      if (p.ready && !p.moved && e.type === 'touchend') return
      quiet(el)
      if (!p.ready && !p.moved && e.type === 'touchend') tapPhoneTab('dictionary')
    },
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

  // Going to a page brings it up from the bottom over the one it was opened
  // from, which sinks back a little beneath it, a card on a stack; going
  // back, the page drops off the bottom and the one under it comes forward.
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
  // A card comes up whole: what its page shows is asked for at the tap, and
  // it rises once that is here -- or after READY_MS, whatever has come, so a
  // slow connection never holds the tap up long. What comes later than the
  // rise waits for its end (see `afterSlide`), as before.
  const rising = useRef(false)
  /** The card coming up, and the cards under it moving into place: finished at once when a pull or a turn starts. */
  const riseAnim = useRef<Animation | null>(null)
  const stacking = useRef<(() => void) | null>(null)
  /** A card falling off: finished at once, and the page under it put up, when a finger comes down again. */
  const flight = useRef<(() => void) | null>(null)
  function finishRise() {
    riseAnim.current?.finish()
    stacking.current?.()
  }
  function rise(p: Page, go: () => void) {
    const ready = !mobile || pagesSlide() ? warm(p) : null
    if (!ready) return animateNav('forward', go)
    if (rising.current) return
    rising.current = true
    let done = false
    const start = () => {
      if (done) return
      done = true
      rising.current = false
      animateNav('forward', go)
    }
    ready.then(start, start)
    window.setTimeout(start, READY_MS)
  }
  function animateNav(kind: NavKind, go: () => void, scope: TurnScope = 'whole', flat = false) {
    if (kind === 'forward') keepUnder()
    if (!pagesSlide() || navAnim.current || turning.current) return go()
    // From a card, the new one goes on the stack by moving things, with no
    // view transition: what was on the screen is there already, as the cards
    // under the new one, standing where they stood (see `stackOn`), so there
    // is nothing to photograph. Safari's view transitions also flash, for a
    // frame or three, where the new card comes (WebKit bugs 299091, 300877).
    const sc = scroller.current
    const open = cardRef.current
    if (kind === 'forward' && onCard && !onStageRef.current && sc && open) {
      const was = {
        m: unders.current.length,
        top: open.getBoundingClientRect().top - sc.getBoundingClientRect().top,
        p: parseFloat(headRef.current?.style.getPropertyValue('--p') || '0') || 0,
        scrolled: sc.scrollTop,
      }
      startSliding(RISE_MS)
      flushSync(go)
      const card = cardRef.current
      if (!card) return
      if (unders.current.length === was.m + 1) stackOn(was)
      card.dataset.moving = ''
      const a = card.animate([{ transform: `translateY(${sc.clientHeight}px)` }, { transform: 'none' }], {
        duration: reducedMotion() ? 0 : RISE_MS,
        easing: RISE_EASE,
      })
      riseAnim.current = a
      a.onfinish = () => {
        if (riseAnim.current === a) riseAnim.current = null
        delete card.dataset.moving
      }
      return
    }
    if (hasViewTransitions()) {
      const html = document.documentElement
      html.dataset.nav = kind
      html.dataset.turn = scope
      if (flat) html.dataset.cardFlat = ''
      // Back, the page is one seen already: all of it at once, not held for the slide.
      if (kind !== 'back') startSliding(kind === 'forward' ? RISE_MS : PAGE_MS)
      const t = document.startViewTransition(() => {
        // The card coming up is a picture of its own, on the new side only;
        // the first card comes up flat, as it lies.
        if (kind === 'forward') html.dataset.card = 'coming'
        flushSync(go)
        if (kind === 'forward' && !cardRef.current?.hasAttribute('data-stacked')) html.dataset.cardFlat = ''
      })
      t.finished.finally(() => {
        delete html.dataset.nav
        delete html.dataset.turn
        delete html.dataset.card
        delete html.dataset.cardFlat
      })
      return
    }
    if (kind === 'forward' || kind === 'back') leaveBy(kind)
    go()
  }
  /**
   * A card put on the stack: the new page shows from the first frame, the
   * cards under the new one standing where the old screen had them -- the
   * one it was opened from just as it was, scrolled or not -- and moving to
   * their places as the card comes up (cardStack.ts putOn). Nothing on the
   * screen is ever two pictures fading through each other, which flickers.
   */
  function stackOn(was: { m: number; top: number; p: number; scrolled: number }) {
    const sc = scroller.current
    if (!sc) return
    const { moves, settle } = putOn(unders.current, was.top, was.p, was.scrolled)
    const nearest = unders.current[unders.current.length - 1]
    moveTo(moves, 0)
    let over = false
    const end = () => {
      if (over) return
      over = true
      stacking.current = null
      settle()
      // Down to where it was read, and a screen more: where back brings it.
      if (nearest) trimCard(nearest.el, sc.clientHeight + Math.max(0, -was.top))
    }
    const stop = run(reducedMotion() ? 0 : RISE_MS, (e) => moveTo(moves, e), end)
    stacking.current = () => {
      stop()
      end()
    }
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
    const h = to?.getBoundingClientRect().height ?? window.innerHeight
    const fwd = how.dir === 'forward'
    startSliding(PAGE_MS)
    if (to) {
      // The page going was taller when the tabs are arriving with this one:
      // no more of it shows than the room this one has.
      for (const g of how.ghosts) if (g.offsetHeight > h) g.style.height = `${h}px`
      // The page coming in is over the one going, forward; under it, back.
      to.style.zIndex = fwd ? '5' : ''
      const frames = fwd ? [{ transform: `translateY(${h}px)` }, { transform: 'none' }] : [SUNK, { filter: 'none' }]
      to.animate(frames, { duration: reducedMotion() ? 0 : PAGE_MS, easing: EASE }).onfinish = () =>
        to.style.removeProperty('z-index')
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
        fwd ? [{ filter: 'none' }, SUNK] : [{ transform: 'none' }, { transform: `translateY(${h}px)` }],
        { duration: PAGE_MS, easing: EASE },
      )
      a.onfinish = () => g.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, pane, onStage])

  // A card taken off is a new page now: in its place again. The page that
  // was under it is on the screen already, as its copy, in this same place:
  // it takes the copy's place with nothing arriving, so the two are one.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (card) {
      card.getAnimations().forEach((a) => a.cancel())
      card.style.transform = ''
      delete card.dataset.moving
      card.toggleAttribute('data-quiet', returning.current)
    }
    // Read down when it was left, the page is where its copy stood, before
    // it is drawn: scrolled so, its head folded so.
    const sc = scroller.current
    const scroll = mobile && returning.current ? leftScroll(entries.length - 1, shownTop ?? undefined) : null
    if (scroll !== null && sc) {
      sc.scrollTop = scroll
      foldHead()
    }
    returning.current = false
    dropped.current = false
    if (toCard.current && mobile && stage) leaveStage('replace')
    toCard.current = false
    underCopies.current = underCopies.current.filter((u) => u.at < entries.length - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top])

  // The app's own steps back slide the page: a tab turn away from the graph
  // as that turn, anything else the way history went. The browser's own back
  // and forward slide too, unless the browser has slid the page itself: Chrome
  // says when it has; an iPhone never says, and always has (see `stepBack` in
  // nav.ts), so there they never do.
  beforePop.current = (e: PopStateEvent, apply: () => void, byApp: boolean) => {
    cameBack.current = performance.now()
    const n = (e.state as { n?: number } | null)?.n
    const forward = n !== undefined && lastN.current !== undefined && n > lastN.current
    // A page gone back to was seen already: it does not arrive again.
    returning.current = !forward
    const to = e.state as { stack?: Stack; stage?: StageView } | null
    if (!forward && to?.stack && to.stack.length < stack.length) toCard.current = true
    if (turning.current || dropped.current) return false
    const turn = pendingTurn.current
    pendingTurn.current = null
    const slidAlready = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true
    if (!byApp && (isIOS || slidAlready)) return false
    // Back to a card under this one: the cards come off as they do when pulled.
    if (!turn && !forward && mobile && to?.stack) {
      const at = to.stack.length - 1
      const commit = () => {
        dropped.current = true
        apply()
      }
      if (at >= base && takeOff(entries.length - 1 - at, commit)) return true
    }
    if (turn) animateNav(turn.kind, apply, turn.scope)
    // Back from the first card to the search it lies on: off to the side, as it came.
    else animateNav(forward ? 'forward' : 'back', apply, 'whole', !forward && mobile && to?.stack?.length === 1)
    return true
  }
  // Back on the search, the keyboard comes up (see `cameBack`).
  useEffect(() => {
    if (!cameBack.current || performance.now() - cameBack.current > 400) return
    cameBack.current = 0
    if (mobile && !IN_TAB && !onStage && top.kind === 'search' && inputRef.current) raiseKeyboard(inputRef.current)
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
        data-bar-off={barOff || undefined}
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
                words={searchWords}
                onWordsWith={showWords}
              />
            </div>
          </aside>
        )}
        <aside className="rail">
          {!split && searchBar}

          <div
            className="rail-body"
            ref={scroller}
            aria-hidden={mobile && onStage ? true : undefined}
            onTouchStart={swipeStart}
            onTouchMove={swipeMove}
            onTouchEnd={swipeEnd}
            onTouchCancel={swipeCancel}
          >
            {stackShown && (
              <div className="card-stack" style={{ height: stackHeight(stackUnder.length) }}>
                <div className="stack-copies" ref={copiesRef} />
                {underCards.map((c) => c.live && createPortal(liveUnder(c.page), c.el, `${c.at}`))}
                {rims(stackUnder.length).map((r) => {
                  const i = r.i
                  return (
                    <button
                      key={i}
                      className="stack-rim"
                      style={{ top: r.top, height: r.height }}
                      onClick={() => pickUnder(i)}
                      aria-label={t('backTo', { page: labelOf(stackUnder[i], t) })}
                    />
                  )
                })}
              </div>
            )}
            {/* The way back, and after it, smaller, the pages before that one,
                each a step further back: how deep this page is, as the
                cards' edges show it on a phone. */}
            {!mobile && shownUnder && !searchShown && (
              <div className="rail-crumb">
                <nav className="rail-trail" aria-label={t('back')}>
                  <button className="back-link rail-back" onClick={goBack} title={t('back')}>
                    <span aria-hidden>←</span> {t.node('backTo', { page: nameOf(shownUnder, t) })}
                  </button>
                  {entries
                    .slice(0, -2)
                    .reverse()
                    .slice(0, TRAIL)
                    .map((p, j) => (
                      <button
                        key={j}
                        className="trail-step"
                        onClick={() => popBy(j + 2)}
                        title={t('backTo', { page: labelOf(p, t) })}
                      >
                        <span className="trail-sep" aria-hidden>
                          ‹
                        </span>
                        {nameOf(p, t)}
                      </button>
                    ))}
                  {entries.length - 2 > TRAIL && <span className="trail-more">+{entries.length - 2 - TRAIL}</span>}
                </nav>
              </div>
            )}
            {/* The card's place, which clips it (theme.css): moved down, coming up
                or going, the card adds no room to scroll, which, as it came
                back, would pull a page being scrolled back up. */}
            <div
              className="card-slot"
              // On others, it reaches the bottom of the screen however short
              // the page, so they do not show under its end.
              style={stackShown ? { minHeight: `calc(100% - ${stackHeight(stackUnder.length)}px + ${SLOT_ROOM}px)` } : undefined}
            >
            <div className="page-card" ref={cardRef} data-stacked={stackShown || undefined}>
              {subject && !searchShown && (
                <div className="page-head" ref={headRef} data-folding={folding || undefined} onClickCapture={onHeadTap}>
                  {pageHead()}
                </div>
              )}
              {/* Every word with a kanji: its name along the top, held there,
                  which is the line it shows under the cards opened from it. */}
              {mobile && shownTop?.kind === 'words' && !searchShown && (
                <div className="page-head card-name words-head">{labelOf(shownTop, t)}</div>
              )}
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
                    words={searchWords}
                    onWordsWith={showWords}
                  />
                )}
                {!notesShown &&
                  !onStage &&
                  !searchShown &&
                  (shownTop ? (
                    waiting ? (
                      <div className="page-wait" aria-busy="true" />
                    ) : (
                      page(shownTop)
                    )
                  ) : (
                    <p className="hint rail-section">{t('pickResult')}</p>
                  ))}
                {/* Kept mounted while hidden, so the count on its button is
                    there before they are opened. */}
                {subject && (notesShown || settled === subject.key) && (
                  <div hidden={!notesShown || searchShown}>
                    {associations(subject)}
                  </div>
                )}
              </div>
            </div>
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
              {/* On Dictionary, how many cards are open. */}
              {PHONE_TABS.map((p) => phoneTabButton(p))}
              {/* Over Dictionary, taking its touches: see holdSwitch. */}
              {!tabOff('dictionary') && (
                <input
                  type="checkbox"
                  className="haptic-switch tab-hold-switch"
                  aria-hidden="true"
                  tabIndex={-1}
                  style={{ '--i': PHONE_TABS.indexOf('dictionary') } as React.CSSProperties}
                  {...{ switch: '' }}
                  onTouchStart={holdSwitch.start}
                  onTouchMove={holdSwitch.move}
                  onTouchEnd={holdSwitch.end}
                  onTouchCancel={holdSwitch.end}
                  onContextMenu={(e) => e.preventDefault()}
                />
              )}
              {tabMenu && (
                <div
                  ref={tabMenuRef}
                  className="graph-menu tab-menu"
                  role="menu"
                  style={{ '--i': PHONE_TABS.indexOf('dictionary') } as React.CSSProperties}
                >
                  <button className="tab-menu-item" role="menuitem" lang={otherLang(t.lang)} onClick={pickLang}>
                    <span className="tab-menu-lang" aria-hidden="true">
                      {otherLang(t.lang) === 'bg' ? 'БГ' : 'EN'}
                    </span>
                    {LANG_NAME[otherLang(t.lang)]}
                  </button>
                </div>
              )}
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
              simple={simpleGraph}
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
              {!error && view === 'focus' && <GraphDetail simple={simpleGraph} onSimple={chooseSimple} />}
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

      {workbench && (
        <Workbench
          tab={workbench}
          onTab={workbenchTab}
          onClose={closeWorkbench}
          onSignIn={signIn}
          // A kanji's page in a new tab, so the card being reviewed stays where it is.
          onKanji={(c) => window.open(`/kanji/${encodeURIComponent(c)}`, '_blank', 'noopener')}
        />
      )}
      {/* After the review screen, so signing in from its gate opens above it. */}
      {accountShown && <AccountDialog onClose={closeAccount} onWorkbench={openWorkbench} />}
      <InstallGuide />
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
