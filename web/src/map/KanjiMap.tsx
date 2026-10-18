/**
 * The map: every character in a scope at once, to wander around in.
 *
 * Canvas, not SVG -- the widest scope is 13k nodes and 27k edges, far past
 * what the DOM keeps interactive. Drawing is on demand (only when the camera,
 * the layout or the hover changes), and detail follows zoom the way a street
 * map's does: from far out, only the large characters -- the frequent ones and
 * the parts many others share -- carry a glyph, and the rest are points of
 * light that resolve into characters as you get close.
 *
 * Links are drawn only for the selected and the hovered character. Stroking
 * all 27k every frame was most of the cost of a pan, and as a haze they said
 * little; as spokes from one character they say everything.
 *
 * Clicking a character flies to it and makes it the focus; clicking the focus
 * again opens it in the focus view. Clicking empty space clears the focus.
 *
 * By meaning, each cluster of kanji has its own colour and a name, the way a
 * map names countries from far out and towns up close: zoomed out the map
 * shows its regions' names, zoomed in its clusters'.
 */

import { interpolateZoom } from 'd3-interpolate'
import { quadtree, type Quadtree } from 'd3-quadtree'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import type { KanjiNode } from '../api'
import type { ContainerFilter } from '../graph/KanjiGraph'
import { strings, useLang, type Translate } from '../i18n'
import { mapMeaning } from '../i18n/content'
import type { LayoutMessage, LayoutRequest } from './layout.worker'
import { GlyphAtlas, type SpriteStyle } from './glyphs'
import { cachedLayout, loadMap, storeLayout, type Arrange, type MapData, type Scope } from './mapData'

/** Press this long on a touch screen to see a character, as hovering does. */
const HOLD_DELAY = 450

interface Props {
  scope: Scope
  by: Arrange
  /** Switch arrangement, offered when the focus is a part, which only the parts map has. */
  onArrange: (by: Arrange) => void
  /** null when nothing is selected */
  focus: string | null
  focusNode: KanjiNode | null
  onSelect: (char: string) => void
  onDeselect: () => void
  onOpen: (char: string) => void
  onScope: (f: ContainerFilter) => void
  /** Show how to read the map, opened from the (i). */
  legend: boolean
  /** Floats over the focus node, following it as the map moves. */
  card?: React.ReactNode
}

interface Camera {
  x: number
  y: number
  k: number
}

/** A glyph appears once its node is this many pixels across in radius... */
const LABEL_FROM = 5.5
/** ...and is fully opaque by this one. */
const LABEL_FULL = 8.5
/** Flying to a character zooms in at least this far, so it can be read. */
const READABLE_RADIUS = 13
/** How many of the focus's neighbours are always drawn as legible glyphs. */
const NEAR_LIMIT = 48
const GLYPH_PX = 64
/** Milliseconds a frame may spend rendering the sprites it found missing, once its drawing is done. */
const SPRITE_MS = 4
/** Past this point in a frame, a node without a sprite gets its plate live but no glyph until the next. */
const LIVE_UNTIL_MS = 14
/** Distant nodes are batched by colour and by this many steps of opacity. */
const ALPHA_STEPS = 12
const TAU = Math.PI * 2
const MINCHO = '"Shippori Mincho", "Yu Mincho", "Hiragino Mincho ProN", serif'
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif'
/**
 * Which names show follows how big a typical kanji is on screen (its radius in
 * px), not the zoom: N5's 80 kanji are legible at a zoom where the full map's
 * are dots. Region names while kanji are dots, gone by REGIONS_UNTIL...
 */
const REGIONS_FULL = 3
const REGIONS_UNTIL = 5
/** ...cluster names from there, until the glyphs alone are easy to read. */
const CLUSTERS_FROM = 3.5
const CLUSTERS_FULL = 5
const CLUSTERS_FADE = 22
const CLUSTERS_UNTIL = 32
/** A cluster needs this many kanji on the map to be named there, a region this many. */
const CLUSTER_NAMED = 3
const REGION_NAMED = 8

/** A light colour per cluster, readable on the dark plates; neighbours differ by the golden angle. */
function groupColour(k: number): string {
  return `hsl(${Math.round((k * 137.508) % 360)} 52% 72%)`
}

// The last finished layout seeds the next scope, so switching N4 -> N3 grows
// the map around where things already were instead of reshuffling it.
let lastLayout: { data: MapData; pos: Float32Array } | null = null

function palette() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    paper: v('--paper'),
    paperDim: v('--paper-dim'),
    muted: v('--muted'),
    faint: v('--faint'),
    rule: v('--rule'),
    ruleBright: v('--rule-bright'),
    ai: v('--ai'),
    aiDeep: v('--ai-deep'),
    shu: v('--shu'),
    sumi: v('--sumi'),
  }
}

function spriteStyles(c: ReturnType<typeof palette>) {
  const base = { plate: c.sumi, font: MINCHO }
  return {
    paper: { ...base, key: 'paper', stroke: c.rule, glyph: c.paper } as SpriteStyle,
    muted: { ...base, key: 'muted', stroke: c.rule, glyph: c.muted } as SpriteStyle,
    part: { ...base, key: 'part', stroke: c.aiDeep, glyph: c.ai } as SpriteStyle,
  }
}

const atlas = new GlyphAtlas()
let fontLoaded = false

const S = strings(
  {
    joyo: 'jōyō',
    part: 'part',
    rare: 'rare',
    scopeCommon: 'common',
    scopeAll: 'full',
    none: 'no recorded meaning',
    component: 'component',
    clickOpen: '{level} · click to open',
    fetching: 'Fetching the map',
    laying: 'Laying out {n} characters',
    error: 'The map could not be loaded.',
    absent: '{c} is not on the {scope} map',
    showOn: 'show on {scope}',
    zoom: 'Zoom',
    recentreOn: 'Recentre on {c}',
    recentreKey: 'Recentre on {c} (C)',
    recentre: 'Recentre',
    nothing: 'Nothing selected',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    whole: 'Show the whole map',
    counts: '{n} characters, {e} links',
    legendSize: 'larger is more frequent, or a part more characters share',
    legendNear: 'nearby characters share a part; ones that share none sit in rows below',
    legendClick: 'click to select and see its links, click again to open,',
    legendEmpty: 'click empty space to deselect',
    legendSizeMeaning: 'larger is more frequent',
    legendNearMeaning: 'nearby kanji mean related things; a colour is a group of them, named as you zoom',
    showParts: 'show on the parts map',
  },
  {
    joyo: 'джойо',
    part: 'част',
    rare: 'рядък',
    scopeCommon: 'чести',
    scopeAll: 'пълна',
    none: 'няма записано значение',
    component: 'част',
    clickOpen: '{level} · кликнете, за да отворите',
    fetching: 'Картата се зарежда',
    laying: 'Подреждат се {n} йероглифа',
    error: 'Картата не можа да се зареди.',
    absent: '{c} го няма на картата „{scope}“',
    showOn: 'покажете на „{scope}“',
    zoom: 'Мащаб',
    recentreOn: 'Центрирайте върху {c}',
    recentreKey: 'Центрирайте върху {c} (C)',
    recentre: 'Центрирайте',
    nothing: 'Нищо не е избрано',
    zoomIn: 'Приближете',
    zoomOut: 'Отдалечете',
    whole: 'Покажете цялата карта',
    counts: '{n} йероглифа, {e} връзки',
    legendSize: 'по-големият е по-чест или е част, споделена от повече йероглифи',
    legendNear: 'близките йероглифи имат обща част; тези без общи части са на редове отдолу',
    legendClick: 'кликнете, за да изберете и видите връзките, кликнете пак, за да отворите,',
    legendEmpty: 'кликнете в празно, за да отмените избора',
    legendSizeMeaning: 'по-големият е по-чест',
    legendNearMeaning: 'близките канджи имат сродни значения; цветът е група от тях, с име при приближаване',
    showParts: 'покажете на картата по части',
  },
)
type T = Translate<Parameters<ReturnType<typeof S>>[0]>

function levelLabel(d: MapData, i: number, t: T): string {
  const j = d.jlpt[i]
  if (j) return `N${j}`
  if (d.joyo[i]) return t('joyo')
  return d.fanout[i] > 0 ? t('part') : t('rare')
}

/** The narrowest scope a character appears in, for the "not on this map" hint. */
function homeScope(n: KanjiNode | null): ContainerFilter {
  if (n?.jlpt) return n.jlpt as ContainerFilter
  if (n?.freq) return 'common'
  return 'all'
}

function scopeName(scope: Scope, t: T): string {
  if (scope === 'common') return t('scopeCommon')
  if (scope === 'all') return t('scopeAll')
  return `N${scope}`
}

function createState() {
  return {
    data: null as MapData | null,
    pos: null as Float32Array | null,
    cam: { x: 0, y: 0, k: 1 } as Camera,
    w: 0,
    h: 0,
    dpr: 1,
    hover: -1,
    focus: -1,
    focusChar: '',
    userMoved: false,
    /** false until the camera has been pointed at anything */
    placed: false,
    anim: null as null | { start: number; dur: number; at: (t: number) => Camera },
    tree: null as Quadtree<number> | null,
    raf: 0,
    colors: null as ReturnType<typeof palette> | null,
    styles: null as ReturnType<typeof spriteStyles> | null,
    maxSize: 1,
    near: new Set<number>(),
    nearOf: -1,
    nearData: null as MapData | null,
    look: null as Look | null,
    lookOf: null as MapData | null,
    /** By meaning: the names, placed for the current layout. */
    labels: [] as Label[],
    labelsOf: null as Float32Array | null,
    /** the median node radius, which label detail is measured against */
    medSize: 1,
    lang: 'en' as 'en' | 'bg',
    /** scratch lists for the batched dot pass, one per colour × opacity step */
    bins: Array.from({ length: 3 * ALPHA_STEPS }, () => [] as number[]),
    /** cancels the idle sprite prewarm, if one is running */
    warm: null as null | (() => void),
    /** what floats over the focus node -- the card a pick opens -- placed each frame */
    card: null as HTMLDivElement | null,
    cardWatch: null as ResizeObserver | null,
  }
}

/** The gap between a node and the card over it, and between the card and the map's edge. */
const CARD_GAP = 12
const CARD_MARGIN = 8

/**
 * Puts the card over the focus node, centred above it -- or below, when there
 * is no room above -- and inside the map; hidden while the node is off it.
 */
function placeCard(s: MapState, ox: number, oy: number, k: number) {
  const el = s.card
  const d = s.data
  const pos = s.pos
  if (!el) return
  if (!d || !pos || s.focus < 0) {
    el.style.visibility = 'hidden'
    return
  }
  const x = pos[2 * s.focus] * k + ox
  const y = pos[2 * s.focus + 1] * k + oy
  if (x < 0 || x > s.w || y < 0 || y > s.h) {
    el.style.visibility = 'hidden'
    return
  }
  const r = d.size[s.focus] * k
  const cw = el.offsetWidth
  const ch = el.offsetHeight
  const left = Math.min(s.w - cw - CARD_MARGIN, Math.max(CARD_MARGIN, x - cw / 2))
  const above = y - r - CARD_GAP - ch
  const top = above >= CARD_MARGIN ? above : Math.min(s.h - ch - CARD_MARGIN, y + r + CARD_GAP)
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  el.style.visibility = 'visible'
}

type MapState = ReturnType<typeof createState>

/**
 * How each node is coloured: a class per node, indexing `colors` (dots) and
 * `styles` (sprites). By parts: 0 jōyō target, 1 other target, 2 part. By
 * meaning: 0 in no cluster, 1 + its cluster otherwise.
 */
interface Look {
  cls: Uint16Array
  colors: string[]
  styles: SpriteStyle[]
}

function looks(s: MapState, d: MapData): Look {
  if (s.lookOf === d && s.look) return s.look
  const c = (s.colors ??= palette())
  const st = (s.styles ??= spriteStyles(c))
  const cls = new Uint16Array(d.n)
  let look: Look
  if (d.cluster) {
    const groups = d.clusters.map((_, k) => groupColour(k))
    look = {
      cls,
      colors: [c.paper, ...groups],
      styles: [st.paper, ...groups.map((g, k) => ({ key: `g${k}`, plate: c.sumi, stroke: c.rule, glyph: g, font: MINCHO }))],
    }
    for (let i = 0; i < d.n; i++) cls[i] = d.cluster[i] >= 0 ? d.cluster[i] + 1 : 0
  } else {
    look = { cls, colors: [c.paper, c.muted, c.ai], styles: [st.paper, st.muted, st.part] }
    for (let i = 0; i < d.n; i++) cls[i] = d.target[i] ? (d.joyo[i] ? 0 : 1) : 2
  }
  s.look = look
  s.lookOf = d
  if (s.bins.length < look.colors.length * ALPHA_STEPS) {
    s.bins = Array.from({ length: look.colors.length * ALPHA_STEPS }, () => [] as number[])
  }
  return look
}

/** A region's or cluster's name, at its most central kanji. */
interface Label {
  region: boolean
  /** kanji of it on this map: the bigger names win a clash */
  n: number
  x: number
  y: number
  en: string
  bg: string
  color: string
}

/**
 * Each name goes on its group's medoid -- the member nearest all the others --
 * rather than the centroid, which for a group in two pieces lands in neither.
 */
function placeLabels(d: MapData, pos: Float32Array, c: ReturnType<typeof palette>): Label[] {
  if (!d.cluster) return []
  const byCluster = new Map<number, number[]>()
  const byRegion = new Map<number, number[]>()
  for (let i = 0; i < d.n; i++) {
    const k = d.cluster[i]
    if (k < 0) continue
    const r = d.clusters[k].region
    if (!byCluster.has(k)) byCluster.set(k, [])
    if (!byRegion.has(r)) byRegion.set(r, [])
    byCluster.get(k)!.push(i)
    byRegion.get(r)!.push(i)
  }
  const medoid = (ids: number[]) => {
    let best = ids[0]
    let bestSum = Infinity
    for (const a of ids) {
      let sum = 0
      for (const b of ids) sum += Math.hypot(pos[2 * a] - pos[2 * b], pos[2 * a + 1] - pos[2 * b + 1])
      if (sum < bestSum) {
        bestSum = sum
        best = a
      }
    }
    return best
  }
  const out: Label[] = []
  for (const [r, ids] of byRegion) {
    if (ids.length < REGION_NAMED) continue
    const m = medoid(ids)
    out.push({ region: true, n: ids.length, x: pos[2 * m], y: pos[2 * m + 1], ...d.regions[r], color: c.paper })
  }
  for (const [k, ids] of byCluster) {
    if (ids.length < CLUSTER_NAMED) continue
    const m = medoid(ids)
    const { en, bg } = d.clusters[k]
    out.push({ region: false, n: ids.length, x: pos[2 * m], y: pos[2 * m + 1], en, bg, color: groupColour(k) })
  }
  return out.sort((a, b) => b.n - a.n)
}

/** The names that fit at this zoom, biggest groups first, none over another. */
function drawLabels(s: MapState, ctx: CanvasRenderingContext2D, ox: number, oy: number, k: number) {
  const d = s.data
  const pos = s.pos
  const c = s.colors
  if (!d?.cluster || !pos || !c) return
  if (s.labelsOf !== pos) {
    s.labels = placeLabels(d, pos, c)
    s.labelsOf = pos
  }
  const z = s.medSize * k
  const ramp = (v: number, from: number, to: number) => Math.max(0, Math.min(1, (v - from) / (to - from)))
  const regionAlpha = 1 - ramp(z, REGIONS_FULL, REGIONS_UNTIL)
  const clusterAlpha = ramp(z, CLUSTERS_FROM, CLUSTERS_FULL) * (1 - ramp(z, CLUSTERS_FADE, CLUSTERS_UNTIL))
  const taken: [number, number, number, number][] = []
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const l of s.labels) {
    const alpha = l.region ? regionAlpha : clusterAlpha
    if (alpha < 0.02) continue
    const x = l.x * k + ox
    const y = l.y * k + oy
    if (x < -200 || x > s.w + 200 || y < -40 || y > s.h + 40) continue
    const name = s.lang === 'bg' ? l.bg : l.en
    const text = l.region ? name.toUpperCase() : name
    ctx.font = l.region ? `600 13px ${SANS}` : `500 12.5px ${SANS}`
    const w = ctx.measureText(text).width + 8
    const h = l.region ? 20 : 18
    const box: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
    if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue
    taken.push(box)
    ctx.globalAlpha = alpha
    ctx.lineWidth = 4
    ctx.strokeStyle = c.sumi
    ctx.strokeText(text, x, y)
    ctx.fillStyle = l.color
    ctx.fillText(text, x, y)
  }
  ctx.globalAlpha = 1
}

function stopPrewarm(s: MapState) {
  s.warm?.()
  s.warm = null
}

/**
 * Render a tiny sprite for every character in the scope while the page is
 * idle, largest first, so that zooming in finds them ready. Needs the data,
 * not the layout, so it runs while the worker is still laying the map out.
 */
function startPrewarm(s: MapState) {
  stopPrewarm(s)
  const d = s.data
  if (!d || !fontLoaded) return
  const { cls, styles: styleOf } = looks(s, d)
  const order = Array.from({ length: d.n }, (_, i) => i)
    .sort((a, b) => d.size[b] - d.size[a])
    .slice(0, atlas.capacity)
  let at = 0
  const idle = (fn: () => void) => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(fn, { timeout: 250 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(fn, 16)
    return () => clearTimeout(id)
  }
  const step = () => {
    s.warm = null
    const until = performance.now() + 6
    while (at < order.length && performance.now() < until) {
      const i = order[at++]
      if (!atlas.prewarm(d.chars[i], styleOf[cls[i]])) return
    }
    if (at < order.length) s.warm = idle(step)
  }
  s.warm = idle(step)
}

/** Draw one frame; true while a camera flight still needs more. */
function drawFrame(s: MapState, canvas: HTMLCanvasElement | null): boolean {
  const ctx = canvas?.getContext('2d')
  const d = s.data
  const pos = s.pos
  if (!canvas || !ctx) return false
  const frameStart = performance.now()
  const c = (s.colors ??= palette())
  const { w, h, dpr } = s

  if (s.anim) {
    const t = Math.min(1, (performance.now() - s.anim.start) / s.anim.dur)
    // easeInOutCubic: van Wijk's path already shapes the zoom; this shapes pace.
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    s.cam = s.anim.at(e)
    if (t >= 1) s.anim = null
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (!d || !pos) return false

  const { k } = s.cam
  const ox = w / 2 - s.cam.x * k
  const oy = h / 2 - s.cam.y * k
  placeCard(s, ox, oy, k)
  const pad = s.maxSize * k + 20
  const inView = (i: number) => {
    const x = pos[2 * i] * k + ox
    const y = pos[2 * i + 1] * k + oy
    return x > -pad && x < w + pad && y > -pad && y < h + pad
  }

  const f = s.focus
  const hv = s.hover

  // --- the focus's own edges: parts in indigo, users in paper.
  const spokes = (i: number, alpha: number, width: number) => {
    const x = pos[2 * i] * k + ox
    const y = pos[2 * i + 1] * k + oy
    ctx.lineWidth = width
    ctx.globalAlpha = alpha
    ctx.strokeStyle = c.aiDeep
    ctx.beginPath()
    for (let m = d.partsAt[i]; m < d.partsAt[i + 1]; m++) {
      const j = d.partsIdx[m]
      ctx.moveTo(x, y)
      ctx.lineTo(pos[2 * j] * k + ox, pos[2 * j + 1] * k + oy)
    }
    ctx.stroke()
    ctx.strokeStyle = c.ruleBright
    ctx.beginPath()
    for (let m = d.usersAt[i]; m < d.usersAt[i + 1]; m++) {
      const j = d.usersIdx[m]
      ctx.moveTo(x, y)
      ctx.lineTo(pos[2 * j] * k + ox, pos[2 * j + 1] * k + oy)
    }
    ctx.stroke()
  }
  if (f >= 0) spokes(f, 0.9, 1.3)
  if (hv >= 0 && hv !== f) spokes(hv, 0.7, 1)

  // Neighbours of the focus are drawn legibly whatever the zoom: that is
  // the part of the map you are standing in. A hub like 口 has a thousand, so
  // only the most important are promoted.
  if (s.nearOf !== f || s.nearData !== d) {
    const all: number[] = []
    if (f >= 0) {
      for (let m = d.partsAt[f]; m < d.partsAt[f + 1]; m++) all.push(d.partsIdx[m])
      for (let m = d.usersAt[f]; m < d.usersAt[f + 1]; m++) all.push(d.usersIdx[m])
    }
    all.sort((a, b) => d.size[b] - d.size[a])
    s.near = new Set(all.slice(0, NEAR_LIMIT))
    s.nearOf = f
    s.nearData = d
  }
  const near = s.near

  const { cls, colors, styles: styleOf } = looks(s, d)

  // --- distant nodes as points, gathered into a handful of paths by colour
  // and (stepped) opacity, so the pass costs a few dozen fills rather than
  // one per node. Across the band where a glyph fades in, its dot fades out,
  // so nothing pops from one to the other while zooming.
  const bins = s.bins
  for (const b of bins) b.length = 0
  for (let i = 0; i < d.n; i++) {
    const r = d.size[i] * k
    if (r >= LABEL_FULL || i === f || near.has(i) || !inView(i)) continue
    const fade = r <= LABEL_FROM ? 1 : (LABEL_FULL - r) / (LABEL_FULL - LABEL_FROM)
    const alpha = (0.28 + 0.6 * Math.min(1, r / LABEL_FROM)) * fade
    const q = Math.min(ALPHA_STEPS - 1, Math.floor(alpha * ALPHA_STEPS))
    bins[cls[i] * ALPHA_STEPS + q].push(i)
  }
  for (let b = 0; b < bins.length; b++) {
    const list = bins[b]
    if (!list.length) continue
    ctx.fillStyle = colors[Math.floor(b / ALPHA_STEPS)]
    ctx.globalAlpha = ((b % ALPHA_STEPS) + 0.5) / ALPHA_STEPS
    ctx.beginPath()
    for (const i of list) {
      const r = d.size[i] * k
      const x = pos[2 * i] * k + ox
      const y = pos[2 * i + 1] * k + oy
      if (r < 1.4) ctx.rect(x - 0.7, y - 0.7, 1.4, 1.4)
      else {
        ctx.moveTo(x + r * 0.55, y)
        ctx.arc(x, y, r * 0.55, 0, TAU)
      }
    }
    ctx.fill()
  }

  // --- near nodes as plates and glyphs, least important first so the big
  // ones land on top.
  // Every node but the focus comes from the sprite atlas: fillText at a new
  // scale re-rasterises the glyph, which made every zoom frame redo them all.
  // A node whose sprite is not rendered yet is drawn live this frame rather
  // than left out, so a zoom never shows a gap that fills in later.
  const livePlate = (i: number, x: number, y: number, r: number, plate: string, stroke: string, glyphColor: string | null) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fillStyle = plate
    ctx.fill()
    ctx.lineWidth = Math.max(0.3, r / 22)
    ctx.strokeStyle = stroke
    ctx.stroke()
    if (glyphColor === null) return
    const sc = (r * 1.28) / GLYPH_PX
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * x, dpr * (y + r * 0.04))
    ctx.fillStyle = glyphColor
    ctx.fillText(d.chars[i], 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const glyph = (i: number, x: number, y: number, r: number, alpha: number) => {
    ctx.globalAlpha = alpha
    const style = styleOf[cls[i]]
    if (!atlas.draw(ctx, d.chars[i], style, x, y, r, dpr)) {
      // Text is the costly part; past the frame's budget the plate alone
      // holds the place and the glyph lands on the next frame.
      const withText = performance.now() - frameStart < LIVE_UNTIL_MS
      livePlate(i, x, y, r, style.plate, style.stroke, withText ? style.glyph : null)
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${GLYPH_PX}px ${MINCHO}`
  atlas.beginFrame()
  for (let i = 0; i < d.n; i++) {
    const r = d.size[i] * k
    if (r < LABEL_FROM || i === f || near.has(i) || !inView(i)) continue
    const a = Math.min(1, (r - LABEL_FROM) / (LABEL_FULL - LABEL_FROM))
    if (a < 0.02) continue
    glyph(i, pos[2 * i] * k + ox, pos[2 * i + 1] * k + oy, r, a)
  }
  for (const i of near) {
    if (!inView(i)) continue
    glyph(i, pos[2 * i] * k + ox, pos[2 * i + 1] * k + oy, Math.max(d.size[i] * k, 9), 1)
  }

  drawLabels(s, ctx, ox, oy, k)

  // --- the focus: a vermilion seal, as in the focus view.
  if (f >= 0 && inView(f)) {
    const x = pos[2 * f] * k + ox
    const y = pos[2 * f + 1] * k + oy
    const r = Math.max(d.size[f] * k, 18)
    const glow = ctx.createRadialGradient(x, y, r, x, y, r * 3.2)
    glow.addColorStop(0, 'rgba(208, 69, 43, 0.16)')
    glow.addColorStop(1, 'rgba(208, 69, 43, 0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = glow
    ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4)
    // The focus alone is drawn live in the heavier weight.
    ctx.font = `600 ${GLYPH_PX}px ${MINCHO}`
    livePlate(f, x, y, r, c.sumi, d.target[f] ? c.rule : c.aiDeep, colors[cls[f]])
    ctx.strokeStyle = c.shu
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, r + Math.max(4, r * 0.16), 0, Math.PI * 2)
    ctx.stroke()
  }

  if (hv >= 0 && hv !== f && inView(hv)) {
    const x = pos[2 * hv] * k + ox
    const y = pos[2 * hv + 1] * k + oy
    const r = Math.max(d.size[hv] * k, near.has(hv) ? 9 : 3)
    ctx.globalAlpha = 1
    ctx.strokeStyle = c.paperDim
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, r + 3, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Sprites this frame lacked are rendered now that all drawing is done, and
  // the frame after picks them up.
  atlas.endFrame(SPRITE_MS)
  return s.anim !== null || atlas.pending > 0
}

/** Memoised: the App re-renders far more often than anything here changes. */
export const KanjiMap = memo(KanjiMapView)

function KanjiMapView({ scope, by, onArrange, focus, focusNode, onSelect, onDeselect, onOpen, onScope, legend, card }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'fetch' | 'layout' | 'ready' | 'error'>('fetch')
  const [counts, setCounts] = useState<{ nodes: number; edges: number } | null>(null)
  const [present, setPresent] = useState(true)
  const lang = useLang()
  const t = S(lang)
  const num = (n: number) => n.toLocaleString(lang === 'bg' ? 'bg-BG' : undefined)
  // The tooltip is written outside React, from event handlers bound once.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  // Everything the draw loop reads lives in one mutable bag, so a pan or a
  // hover never goes through React.
  const s = useRef(createState()).current
  s.lang = lang === 'bg' ? 'bg' : 'en'

  // ------------------------------------------------------------------ drawing



  const request = useMemo(() => {
    const frame = () => {
      s.raf = 0
      if (drawFrame(s, canvasRef.current)) s.raf = requestAnimationFrame(frame)
    }
    return () => {
      if (!s.raf) s.raf = requestAnimationFrame(frame)
    }
  }, [s])

  // The card is placed again whenever its size changes -- its readings
  // arriving, the language changing -- as well as whenever the map moves.
  const cardRef = useCallback(
    (el: HTMLDivElement | null) => {
      s.cardWatch?.disconnect()
      s.cardWatch = null
      s.card = el
      if (!el) return
      s.cardWatch = new ResizeObserver(() => request())
      s.cardWatch.observe(el)
    },
    [s, request],
  )

  // ------------------------------------------------------------------ camera

  const bounds = useCallback(() => {
    const pos = s.pos
    if (!pos) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < pos.length; i += 2) {
      const x = pos[i]
      const y = pos[i + 1]
      if (Number.isNaN(x)) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 }
  }, [s])

  const fitCamera = useCallback((): Camera | null => {
    const b = bounds()
    if (!b || !s.w) return null
    const k = Math.min(s.w / (b.x1 - b.x0 + 60), s.h / (b.y1 - b.y0 + 60))
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, k }
  }, [bounds, s])

  const flyTo = useCallback(
    (to: Camera) => {
      const from = s.cam
      // Hidden behind the focus view the map is 0 px wide, and a flight
      // measured in 0 px widths is 0/0 -- the camera went NaN and the map
      // stayed blank. With nothing to watch, just be there.
      const w = s.w
      if (!w || !isFinite(from.k) || !isFinite(from.x) || !isFinite(from.y)) {
        s.anim = null
        s.cam = to
        request()
        return
      }
      const zi = interpolateZoom([from.x, from.y, w / from.k], [to.x, to.y, w / to.k])
      s.anim = {
        start: performance.now(),
        dur: Math.max(380, Math.min(1400, zi.duration * 0.75)),
        // The width is captured: the map can be hidden mid-flight.
        at: (t) => {
          const [x, y, width] = zi(t)
          return { x, y, k: w / width }
        },
      }
      request()
    },
    [s, request],
  )

  /** Centre a character, keeping the zoom unless it is too far out to read it. */
  const centreOn = useCallback(
    (i: number, instant = false) => {
      const d = s.data
      const pos = s.pos
      if (!d || !pos) return
      const k = Math.max(s.cam.k, READABLE_RADIUS / d.size[i])
      const to = { x: pos[2 * i], y: pos[2 * i + 1], k: Math.min(k, 8) }
      if (instant) {
        s.cam = to
        request()
      } else flyTo(to)
    },
    [s, flyTo, request],
  )

  const zoomBy = useCallback(
    (factor: number, px = s.w / 2, py = s.h / 2) => {
      const fit = fitCamera()
      const minK = fit ? fit.k * 0.5 : 0.05
      const cam = s.cam
      const k = Math.max(minK, Math.min(10, cam.k * factor))
      // Keep the world point under (px, py) where it is.
      const wx = cam.x + (px - s.w / 2) / cam.k
      const wy = cam.y + (py - s.h / 2) / cam.k
      s.cam = { k, x: wx - (px - s.w / 2) / k, y: wy - (py - s.h / 2) / k }
      s.anim = null
      s.userMoved = true
      request()
    },
    [s, fitCamera, request],
  )

  // ------------------------------------------------------------------ data

  useEffect(() => {
    let cancelled = false
    let worker: Worker | null = null
    setPhase('fetch')
    setPresent(true)

    const settle = (d: MapData, pos: Float32Array) => {
      s.pos = pos
      s.tree = null
      // Arriving from nowhere, start from the whole map and fly in from there.
      if (!s.placed) {
        const fit = fitCamera()
        if (fit) {
          s.cam = fit
          s.placed = true
        }
      }
      lastLayout = { data: d, pos }
      setPhase('ready')
      const i = d.index.get(s.focusChar) ?? -1
      s.focus = i
      setPresent(i >= 0 || !s.focusChar)
      if (i >= 0) centreOn(i)
      else {
        const fit = fitCamera()
        if (fit) flyTo(fit)
      }
    }

    loadMap(scope, by).then(
      (d) => {
        if (cancelled) return
        // The other arrangement's camera means nothing here: start from the whole map.
        if (s.data && s.data.by !== d.by) s.placed = false
        s.data = d
        s.hover = -1
        s.focus = -1
        s.maxSize = d.size.reduce((a, b) => Math.max(a, b), 1)
        s.medSize = d.size.slice().sort()[d.n >> 1] ?? 1
        setCounts({ nodes: d.n, edges: d.edges.length / 2 })
        startPrewarm(s)

        const cached = cachedLayout(d)
        if (cached) {
          settle(d, cached)
          return
        }

        const seed = new Float32Array(2 * d.n).fill(NaN)
        if (lastLayout && lastLayout.data.by === d.by) {
          const prev = lastLayout
          for (let i = 0; i < d.n; i++) {
            const j = prev.data.index.get(d.chars[i])
            if (j !== undefined) {
              seed[2 * i] = prev.pos[2 * j]
              seed[2 * i + 1] = prev.pos[2 * j + 1]
            }
          }
        }

        setPhase('layout')
        s.userMoved = false
        worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent<LayoutMessage>) => {
          if (cancelled) return
          s.pos = e.data.positions
          s.tree = null
          if (e.data.kind === 'done') {
            storeLayout(d, e.data.positions)
            worker?.terminate()
            worker = null
            settle(d, e.data.positions)
            return
          }
          // Follow the forming map until the user takes the camera.
          if (!s.userMoved) {
            const fit = fitCamera()
            if (fit) {
              s.cam = fit
              s.placed = true
            }
          }
          request()
        }
        const similar = d.similar.slice()
        const homes = d.home?.slice()
        const req: LayoutRequest = { id: 1, n: d.n, edges: d.edges.slice(), size: d.size.slice(), seed, similar, homes }
        const moved = [req.edges.buffer, req.size.buffer, req.seed.buffer, similar.buffer]
        worker.postMessage(req, homes ? [...moved, homes.buffer] : moved)
      },
      () => !cancelled && setPhase('error'),
    )

    return () => {
      cancelled = true
      worker?.terminate()
      stopPrewarm(s)
    }
  }, [scope, by, s, centreOn, fitCamera, flyTo, request])

  // The focus can change from anywhere -- search, breadcrumb, a word's kanji.
  useEffect(() => {
    s.focusChar = focus ?? ''
    const d = s.data
    if (!d || !s.pos || phase !== 'ready') return
    const i = focus ? (d.index.get(focus) ?? -1) : -1
    s.focus = i
    setPresent(i >= 0 || !focus)
    if (i >= 0) centreOn(i)
    else request()
  }, [focus, phase, s, centreOn, request])

  useEffect(() => request(), [lang, request])

  // ------------------------------------------------------------------ canvas size

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect()
      s.dpr = window.devicePixelRatio || 1
      s.w = r.width
      s.h = r.height
      canvas.width = Math.round(r.width * s.dpr)
      canvas.height = Math.round(r.height * s.dpr)
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      // Shown for the first time since loading while hidden: frame it now.
      if (s.w && s.pos && !s.placed) {
        const fit = fitCamera()
        if (fit) {
          s.cam = fit
          s.placed = true
          if (s.focus >= 0) centreOn(s.focus, true)
        }
      }
      request()
    })
    ro.observe(wrap)
    // Canvas text does not wait for web fonts; redraw once Mincho is in.
    document.fonts?.load(`${GLYPH_PX}px "Shippori Mincho"`, '字').then(() => {
      if (fontLoaded) return
      fontLoaded = true
      // Sprites rendered before the font arrived are in the fallback face.
      atlas.clear()
      startPrewarm(s)
      request()
    }, () => {})
    return () => {
      ro.disconnect()
      if (s.raf) cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [s, request, fitCamera, centreOn])

  // ------------------------------------------------------------------ input

  const pick = useCallback(
    (px: number, py: number): number => {
      const d = s.data
      const pos = s.pos
      if (!d || !pos) return -1
      if (!s.tree) {
        s.tree = quadtree<number>()
          .x((i) => pos[2 * i])
          .y((i) => pos[2 * i + 1])
          .addAll(Array.from({ length: d.n }, (_, i) => i))
      }
      const { k } = s.cam
      const wx = s.cam.x + (px - s.w / 2) / k
      const wy = s.cam.y + (py - s.h / 2) / k
      const i = s.tree.find(wx, wy, (s.maxSize * k + 10) / k)
      if (i === undefined) return -1
      const dist = Math.hypot(pos[2 * i] - wx, pos[2 * i + 1] - wy) * k
      return dist <= Math.max(d.size[i] * k, 8) + 2 ? i : -1
    },
    [s],
  )

  const setHover = useCallback(
    (i: number, px: number, py: number, aboveFinger = false) => {
      const tip = tipRef.current
      const d = s.data
      if (i !== s.hover) {
        s.hover = i
        request()
      }
      if (!tip || !d) return
      if (i < 0) {
        tip.hidden = true
        return
      }
      tip.hidden = false
      // Under a finger the tip goes above it, where it can be seen.
      tip.style.transform = aboveFinger
        ? `translate(${px}px, ${py - 28}px) translate(-50%, -100%)`
        : `translate(${px + 14}px, ${py + 12}px)`
      const tt = tRef.current
      const meaning = mapMeaning(d, i, tt.lang).value || (d.target[i] ? tt('none') : tt('component'))
      tip.innerHTML = ''
      const g = document.createElement('b')
      g.textContent = d.chars[i]
      const m = document.createElement('span')
      m.textContent = meaning
      const l = document.createElement('em')
      const k = d.cluster ? d.cluster[i] : -1
      const level = k >= 0 ? `${levelLabel(d, i, tt)} · ${d.clusters[k][tt.lang === 'bg' ? 'bg' : 'en']}` : levelLabel(d, i, tt)
      l.textContent = i === s.focus ? tt('clickOpen', { level }) : level
      tip.append(g, m, l)
    },
    [s, request],
  )

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    x: number
    y: number
    moved: number
    pinch: number | null
    /** Pressed and held on a touch screen: showing the tip instead of panning. */
    held: boolean
    timer?: number
  } | null>(null)

  function local(e: React.PointerEvent | React.WheelEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    canvasRef.current?.setPointerCapture(e.pointerId)
    const [x, y] = local(e)
    pointers.current.set(e.pointerId, { x, y })
    if (pointers.current.size === 1) {
      const g: NonNullable<typeof gesture.current> = { x, y, moved: 0, pinch: null, held: false }
      gesture.current = g
      // Touch has no hover: pressing and holding shows what hovering would.
      if (e.pointerType === 'touch') {
        g.timer = window.setTimeout(() => {
          const i = pick(x, y)
          if (gesture.current !== g || g.moved > 4 || i < 0) return
          g.held = true
          setHover(i, x, y, true)
        }, HOLD_DELAY)
      }
    } else if (gesture.current) {
      clearTimeout(gesture.current.timer)
      const [a, b] = [...pointers.current.values()]
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y)
      gesture.current.moved = 99 // a pinch is never a click
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const [x, y] = local(e)
    const g = gesture.current
    const prev = pointers.current.get(e.pointerId)
    if (!g || !prev) {
      setHover(pick(x, y), x, y)
      return
    }
    pointers.current.set(e.pointerId, { x, y })

    // While held, sliding the finger reads whatever is under it.
    if (g.held) {
      setHover(pick(x, y), x, y, true)
      return
    }

    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomBy(dist / g.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2)
      g.pinch = dist
      return
    }

    const dx = x - prev.x
    const dy = y - prev.y
    g.moved += Math.abs(dx) + Math.abs(dy)
    if (g.moved > 4) {
      clearTimeout(g.timer)
      s.cam = { ...s.cam, x: s.cam.x - dx / s.cam.k, y: s.cam.y - dy / s.cam.k }
      s.anim = null
      s.userMoved = true
      setHover(-1, x, y)
      request()
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const [x, y] = local(e)
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) return
    gesture.current = null
    if (g) clearTimeout(g.timer)
    // Letting go of a hold only hides the tip.
    if (g?.held) {
      setHover(-1, x, y)
      return
    }
    if (!g || g.moved > 4) return
    const i = pick(x, y)
    const d = s.data
    if (!d) return
    if (i < 0) {
      if (s.focus >= 0 || s.focusChar) onDeselect()
      return
    }
    if (i === s.focus) onOpen(d.chars[i])
    else onSelect(d.chars[i])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (!wrapRef.current?.offsetParent) return // map hidden behind the focus view
      if ((e.key === 'c' || e.key === 'C') && s.focus >= 0) centreOn(s.focus)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, centreOn])

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const home = homeScope(focusNode?.char === focus ? focusNode : null)

  return (
    <div className="map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => !gesture.current && setHover(-1, ...local(e))}
        // A long press would otherwise open the browser's own menu.
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="map-tip" ref={tipRef} hidden />
      {card && (
        <div className="map-card-anchor" ref={cardRef}>
          {card}
        </div>
      )}

      {phase !== 'ready' && (
        <p className="map-status" role="status">
          {phase === 'fetch' && t('fetching')}
          {phase === 'layout' && counts && t('laying', { n: num(counts.nodes) })}
          {phase === 'error' && t('error')}
          {phase !== 'error' && <span className="map-status-dots" aria-hidden />}
        </p>
      )}

      {phase === 'ready' && !present && (
        <p className="map-status map-absent">
          {t.node('absent', { c: <span className="map-absent-glyph">{focus}</span>, scope: scopeName(scope, t) })}
          {String(home) !== scope && (
            <button onClick={() => onScope(home)}>{t('showOn', { scope: scopeName(String(home) as Scope, t) })}</button>
          )}
          {by === 'meaning' && <button onClick={() => onArrange('parts')}>{t('showParts')}</button>}
        </p>
      )}

      <div className="map-zoom" role="group" aria-label={t('zoom')}>
        <button
          onClick={() => s.focus >= 0 && centreOn(s.focus)}
          disabled={!focus || !present || phase !== 'ready'}
          aria-label={focus ? t('recentreOn', { c: focus }) : t('recentre')}
          title={focus ? t('recentreKey', { c: focus }) : t('nothing')}
        >
          ◎
        </button>
        <button onClick={() => zoomBy(1.6)} aria-label={t('zoomIn')} title={t('zoomIn')}>
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label={t('zoomOut')} title={t('zoomOut')}>
          −
        </button>
        <button
          onClick={() => {
            const fit = fitCamera()
            if (fit) flyTo(fit)
          }}
          aria-label={t('whole')}
          title={t('whole')}
        >
          ⤢
        </button>
      </div>

      {legend && (
        <p className="legend" id="stage-legend">
          {counts && t('counts', { n: num(counts.nodes), e: num(counts.edges) })}
          <br />
          {t(by === 'meaning' ? 'legendSizeMeaning' : 'legendSize')}
          <br />
          {t(by === 'meaning' ? 'legendNearMeaning' : 'legendNear')}
          <br />
          {t('legendClick')}
          <br />
          {t('legendEmpty')}
        </p>
      )}
    </div>
  )
}
