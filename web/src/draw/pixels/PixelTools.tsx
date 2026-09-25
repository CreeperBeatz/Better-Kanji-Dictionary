/**
 * Selecting part of a picture in the drawing, the way a paint program does:
 * around it with the lasso, a box, or by colour with the magic wand -- and
 * then erasing it, keeping only it, or lifting it out as a picture of its own.
 *
 * Excalidraw only knows whole elements, so this is a canvas of our own laid
 * over its canvas while one of these tools is in hand. It takes the pointer,
 * finds the picture under it, and keeps the selection in that picture's own
 * pixels, so it stays put as the view is panned and zoomed or the picture is
 * moved. A change to the pixels is a new file for the element, which
 * Excalidraw's undo takes back like any other edit.
 *
 * Taking Excalidraw's tool out of hand, and giving it back, is the editor's
 * (SketchEditor.tsx), for the pixel eraser shares the slot.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { strings, useLang } from '../../i18n'
import { isCtrlD, useCaptureKeys } from '../keys'
import { commit, fileOf, loadImage } from './files'
import { cropOf, onImage, pixelMatrix, pixelToScene, sceneToPixel, viewToScene, type Pt } from './geometry'
import { blank, bounds, erase, extract, invert, keptTo, pixelsOf, polygonMask, wandMask } from './mask'
import { onSubjectProgress, subjectMask, warmSubject } from './subject'

export type PixelTool = 'lasso' | 'box' | 'wand' | 'subject'

const S = strings(
  {
    lassoHint: 'Draw around part of a picture',
    boxHint: 'Drag a box over part of a picture',
    wandHint: 'Click a colour in a picture',
    subjectHint: 'Click a picture to select what it shows, without its background',
    notOnPicture: 'That is not on a picture',
    fetchingModel: 'Fetching the model, the first time only: {n}%',
    finding: 'Finding the subject…',
    subjectFailed: 'The subject could not be found: {why}',
    tolerance: 'Tolerance',
    toleranceTitle: 'How different a colour can be and still be picked up',
    erase: 'Erase',
    eraseTitle: 'Make the selected part transparent (Delete)',
    keep: 'Keep only this',
    keepTitle: 'Erase everything else in the picture',
    cut: 'Cut out',
    cutTitle: 'Lift the selected part out as a picture of its own',
    copy: 'Copy out',
    copyTitle: 'Copy the selected part as a picture of its own',
    invert: 'Invert',
    invertTitle: 'Select everything else instead',
    deselect: 'Deselect',
    deselectTitle: 'Clear the selection (Ctrl+D)',
  },
  {
    lassoHint: 'Оградете част от картина',
    boxHint: 'Плъзнете правоъгълник върху част от картина',
    wandHint: 'Щракнете върху цвят в картина',
    subjectHint: 'Щракнете върху картина, за да изберете какво показва, без фона',
    notOnPicture: 'Това не е върху картина',
    fetchingModel: 'Изтегляне на модела, само първия път: {n}%',
    finding: 'Търсене на обекта…',
    subjectFailed: 'Обектът не можа да бъде намерен: {why}',
    tolerance: 'Допуск',
    toleranceTitle: 'Колко може да се различава цветът и пак да бъде избран',
    erase: 'Изтриване',
    eraseTitle: 'Направете избраното прозрачно (Delete)',
    keep: 'Само това',
    keepTitle: 'Изтрийте всичко останало в картината',
    cut: 'Изрязване',
    cutTitle: 'Отделете избраното като самостоятелна картина',
    copy: 'Копиране',
    copyTitle: 'Копирайте избраното като самостоятелна картина',
    invert: 'Обръщане',
    invertTitle: 'Изберете всичко останало',
    deselect: 'Без селекция',
    deselectTitle: 'Премахнете селекцията (Ctrl+D)',
  },
)

/** A picture in the scene, with its pixels to hand. */
interface Picture {
  id: string
  fileId: string
  img: HTMLImageElement
  w: number
  h: number
}

interface Selection {
  pic: Picture
  mask: HTMLCanvasElement
}

type Drag = { kind: 'lasso'; pts: Pt[] } | { kind: 'box'; a: Pt; b: Pt }

interface Props {
  api: ExcalidrawImperativeAPI
  /** Where Excalidraw is mounted; the overlay goes inside its container. */
  host: HTMLElement
  tool: PixelTool | null
  /** Told whether there is a selection, which takes Escape and Ctrl+D while there is. */
  onSelection: (has: boolean) => void
}

const INK = '#7e9cc6'

function imageAt(api: ExcalidrawImperativeAPI, p: Pt): ExcalidrawImageElement | null {
  const files = api.getFiles()
  const els = api.getSceneElements()
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i]
    if (el.type === 'image' && el.fileId && files[el.fileId] && !el.locked && onImage(el, p)) return el
  }
  return null
}

function elementOf(api: ExcalidrawImperativeAPI, id: string): ExcalidrawImageElement | null {
  const el = api.getSceneElements().find((e) => e.id === id)
  return el && el.type === 'image' ? el : null
}

/** Diagonal stripes for the selection's edge, which march as they are shifted. */
function antsPattern(g: CanvasRenderingContext2D): CanvasPattern {
  const c = blank(8, 8)
  const t = c.getContext('2d')!
  t.fillStyle = '#12100e'
  t.fillRect(0, 0, 8, 8)
  t.strokeStyle = '#ede6da'
  t.lineWidth = 2.5
  t.beginPath()
  for (let k = -8; k <= 16; k += 8) {
    t.moveTo(k, 8)
    t.lineTo(k + 8, 0)
  }
  t.stroke()
  return g.createPattern(c, 'repeat')!
}

/**
 * The selection as it shows on screen, and its edge, drawn once for a view of
 * it: the ants' march only refills the edge.
 */
interface Edge {
  mask: HTMLCanvasElement
  el: ExcalidrawImageElement
  view: string
  fill: HTMLCanvasElement
  ring: HTMLCanvasElement
  ants: HTMLCanvasElement
  pattern: CanvasPattern
}

export function PixelTools({ api, host, tool, onSelection }: Props) {
  const t = S(useLang())
  const container = host.querySelector<HTMLElement>('.excalidraw-container')
  const overlay = useRef<HTMLCanvasElement>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const selRef = useRef(sel)
  selRef.current = sel
  const [tolerance, setTolerance] = useState(32)
  const [note, setNote] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const images = useRef(new Map<string, Promise<HTMLImageElement>>())
  const pixels = useRef(new Map<string, ImageData>())
  const subjects = useRef(new Map<string, Promise<HTMLCanvasElement>>())
  const busy = useRef(false)
  const march = useRef(0)
  const edge = useRef<Edge | null>(null)

  const pictureOf = useCallback(
    async (el: ExcalidrawImageElement): Promise<Picture | null> => {
      const file = el.fileId && api.getFiles()[el.fileId]
      if (!file) return null
      let p = images.current.get(file.id)
      if (!p) {
        // Each edit is a new file, so what is cached for pictures no longer
        // in the scene goes before anything is added.
        const used = new Set(api.getSceneElements().flatMap((e) => (e.type === 'image' && e.fileId ? [e.fileId as string] : [])))
        for (const cache of [images.current, pixels.current, subjects.current]) {
          for (const id of cache.keys()) if (!used.has(id)) cache.delete(id)
        }
        p = loadImage(file.dataURL)
        images.current.set(file.id, p)
      }
      try {
        const img = await p
        return { id: el.id, fileId: file.id, img, w: img.naturalWidth, h: img.naturalHeight }
      } catch {
        images.current.delete(file.id)
        return null
      }
    },
    [api],
  )

  // --- drawing -----------------------------------------------------------

  const paint = useCallback(() => {
    const cv = overlay.current
    if (!cv || !container) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(container.clientWidth * dpr)
    const H = Math.round(container.clientHeight * dpr)
    if (cv.width !== W || cv.height !== H) {
      cv.width = W
      cv.height = H
    }
    const g = cv.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, W, H)
    const st = api.getAppState()
    const zoom = st.zoom.value
    const toScreen = new DOMMatrix().scaleSelf(dpr * zoom, dpr * zoom).translateSelf(st.scrollX, st.scrollY)

    const s = selRef.current
    const el = s && elementOf(api, s.pic.id)
    if (s && el) {
      const view = `${W} ${H} ${zoom} ${st.scrollX} ${st.scrollY}`
      let e = edge.current
      if (!e || e.mask !== s.mask || e.el !== el || e.view !== view) {
        // The selection drawn where it shows, then its edge found by shifting
        // it a pixel each way and cutting the original out of the result.
        const fill = blank(W, H)
        const f = fill.getContext('2d')!
        f.setTransform(new DOMMatrix().scaleSelf(dpr, dpr).multiplySelf(pixelMatrix(el, s.pic.w, s.pic.h, zoom, st.scrollX, st.scrollY)))
        f.drawImage(s.mask, 0, 0)
        f.setTransform(1, 0, 0, 1, 0, 0)
        const ring = blank(W, H)
        const r = ring.getContext('2d')!
        const d = Math.max(1, Math.round(dpr))
        for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) r.drawImage(fill, dx, dy)
        r.globalCompositeOperation = 'destination-out'
        r.drawImage(fill, 0, 0)
        f.globalCompositeOperation = 'source-in'
        f.fillStyle = INK
        f.fillRect(0, 0, W, H)
        const ants = e?.ants.width === W && e.ants.height === H ? e.ants : blank(W, H)
        e = edge.current = { mask: s.mask, el, view, fill, ring, ants, pattern: e?.pattern ?? antsPattern(ants.getContext('2d')!) }
      }
      const a = e.ants.getContext('2d')!
      a.globalCompositeOperation = 'copy'
      a.drawImage(e.ring, 0, 0)
      a.globalCompositeOperation = 'source-in'
      e.pattern.setTransform(new DOMMatrix().translateSelf(march.current, 0))
      a.fillStyle = e.pattern
      a.fillRect(0, 0, W, H)
      g.globalAlpha = 0.3
      g.drawImage(e.fill, 0, 0)
      g.globalAlpha = 1
      g.drawImage(e.ants, 0, 0)
    } else {
      edge.current = null
    }

    const dr = drag.current
    if (dr) {
      g.setTransform(toScreen)
      g.beginPath()
      if (dr.kind === 'lasso') dr.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      else g.rect(dr.a.x, dr.a.y, dr.b.x - dr.a.x, dr.b.y - dr.a.y)
      if (dr.kind === 'box') g.closePath()
      g.lineWidth = 1.5 / zoom
      g.strokeStyle = '#12100e'
      g.setLineDash([])
      g.stroke()
      g.strokeStyle = '#ede6da'
      g.setLineDash([5 / zoom, 4 / zoom])
      g.stroke()
      g.setLineDash([])
    }
  }, [api, container])

  const frame = useRef(0)
  const repaint = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      paint()
    })
  }, [paint])

  useEffect(repaint, [sel, tool, repaint])

  // The view moves, or the picture does: the selection goes with it. If the
  // picture is gone, or has other pixels now (undo), the selection is too.
  useEffect(() => {
    if (!tool) return
    return api.onChange((elements, _, files) => {
      const s = selRef.current
      if (s) {
        const el = elements.find((e) => e.id === s.pic.id) as ExcalidrawImageElement | undefined
        if (!el || el.isDeleted || el.fileId !== s.pic.fileId || !files[s.pic.fileId]) setSel(null)
      }
      repaint()
    })
  }, [api, tool, repaint])

  useEffect(() => onSelection(!!sel), [sel, onSelection])

  useEffect(() => {
    if (!sel) return
    const id = window.setInterval(() => {
      march.current = (march.current + 1) % 8
      repaint()
    }, 110)
    return () => clearInterval(id)
  }, [sel, repaint])

  // The subject tool fetches and sets up its model as soon as it is picked,
  // saying how the download is going the first time.
  const [fetching, setFetching] = useState<number | null>(null)
  useEffect(() => {
    if (tool !== 'subject') return
    const off = onSubjectProgress((p) => setFetching(p.kind === 'loading' && p.share < 1 ? p.share : null))
    warmSubject()
    return () => {
      off()
      setFetching(null)
    }
  }, [tool])

  // Putting the tool down drops the selection.
  useEffect(() => {
    setNote(null)
    if (!tool) {
      setSel(null)
      drag.current = null
    }
  }, [tool])

  // --- the pointer -------------------------------------------------------

  function scenePoint(e: React.PointerEvent): Pt {
    const r = overlay.current!.getBoundingClientRect()
    return viewToScene(api.getAppState(), { x: e.clientX - r.left, y: e.clientY - r.top })
  }

  /** Each selection replaces the one before; an empty one is none. */
  function select(pic: Picture, mask: HTMLCanvasElement) {
    setSel(bounds(mask) ? { pic, mask } : null)
  }

  async function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || !tool) return
    e.preventDefault()
    const p = scenePoint(e)
    setNote(null)
    if (tool === 'wand') {
      const el = imageAt(api, p)
      if (!el) {
        setNote(t('notOnPicture'))
        return
      }
      const pic = await pictureOf(el)
      if (!pic) return
      let data = pixels.current.get(pic.fileId)
      if (!data) {
        data = pixelsOf(pic.img, pic.w, pic.h)
        pixels.current.set(pic.fileId, data)
      }
      select(pic, wandMask(data, sceneToPixel(el, pic.w, pic.h, p), tolerance, cropOf(el, pic.w, pic.h)))
      return
    }
    if (tool === 'subject') {
      const el = imageAt(api, p)
      if (!el) {
        setNote(t('notOnPicture'))
        return
      }
      if (busy.current) return
      const pic = await pictureOf(el)
      if (!pic) return
      let found = subjects.current.get(pic.fileId)
      if (!found) {
        found = subjectMask(pic.img, pic.w, pic.h)
        subjects.current.set(pic.fileId, found)
        found.catch(() => subjects.current.delete(pic.fileId))
      }
      busy.current = true
      setNote(t('finding'))
      try {
        // Kept to what the element shows, as the other tools' selections are.
        const mask = keptTo(await found, cropOf(el, pic.w, pic.h))
        setNote(null)
        select(pic, mask)
      } catch (err) {
        setNote(t('subjectFailed', { why: err instanceof Error ? err.message : String(err) }))
      } finally {
        busy.current = false
      }
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = tool === 'lasso' ? { kind: 'lasso', pts: [p] } : { kind: 'box', a: p, b: p }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const dr = drag.current
    if (!dr) return
    const p = scenePoint(e)
    if (dr.kind === 'box') dr.b = p
    else {
      const last = dr.pts[dr.pts.length - 1]
      const zoom = api.getAppState().zoom.value
      if (Math.hypot(p.x - last.x, p.y - last.y) * zoom < 2) return
      dr.pts.push(p)
    }
    repaint()
  }

  async function up() {
    const dr = drag.current
    drag.current = null
    if (!dr) return
    repaint()
    const shape =
      dr.kind === 'lasso'
        ? dr.pts
        : [dr.a, { x: dr.b.x, y: dr.a.y }, dr.b, { x: dr.a.x, y: dr.b.y }]
    const zoom = api.getAppState().zoom.value
    const xs = shape.map((p) => p.x)
    const ys = shape.map((p) => p.y)
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * zoom
    // A click rather than a drag: deselect, as paint programs do.
    if (span < 4) {
      setSel(null)
      return
    }
    // The picture: the top one under the middle of the shape, or under any
    // point of it.
    const mid = { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length }
    let el = imageAt(api, mid)
    for (const p of shape) el ??= imageAt(api, p)
    if (!el) {
      setNote(t('notOnPicture'))
      return
    }
    const pic = await pictureOf(el)
    if (!pic) return
    const pts = shape.map((p) => sceneToPixel(el, pic.w, pic.h, p))
    select(pic, polygonMask(pic.w, pic.h, pts, cropOf(el, pic.w, pic.h)))
  }

  // --- what can be done with a selection ---------------------------------

  /** The scene with the picture's pixels replaced by `file`'s, if given. */
  function withPixels(el: ExcalidrawImageElement, file: BinaryFileData | null): ExcalidrawElement[] {
    return api.getSceneElementsIncludingDeleted().map((e) => (file && e.id === el.id ? newElementWith(el, { fileId: file.id }) : e))
  }

  function apply(kind: 'erase' | 'keep' | 'cut' | 'copy') {
    const s = selRef.current
    const el = s && elementOf(api, s.pic.id)
    if (!s || !el) return
    const { pic } = s
    const crop = cropOf(el, pic.w, pic.h)
    if (kind === 'erase' || kind === 'keep') {
      const file = fileOf(erase(pic.img, pic.w, pic.h, kind === 'erase' ? s.mask : invert(s.mask, crop)))
      commit(api, withPixels(el, file), [file])
      setSel(null)
      return
    }
    const box = bounds(s.mask)
    if (!box) return
    const piece = fileOf(extract(pic.img, pic.w, pic.h, s.mask, box))
    const centre = pixelToScene(el, pic.w, pic.h, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    const width = (box.width * el.width) / crop.width
    const height = (box.height * el.height) / crop.height
    const [lifted] = convertToExcalidrawElements([
      {
        type: 'image',
        fileId: piece.id,
        status: 'saved',
        x: centre.x - width / 2,
        y: centre.y - height / 2,
        width,
        height,
        angle: el.angle,
        scale: el.scale,
      },
    ])
    const cutOut = kind === 'cut' ? fileOf(erase(pic.img, pic.w, pic.h, s.mask)) : null
    // The piece comes out selected, with Excalidraw's own tool back in hand
    // (which puts this one down), ready to be dragged away.
    api.setActiveTool({ type: 'selection' })
    commit(api, [...withPixels(el, cutOut), lifted], cutOut ? [cutOut, piece] : [piece], { selectedElementIds: { [lifted.id]: true } })
  }

  function flip() {
    const s = selRef.current
    const el = s && elementOf(api, s.pic.id)
    if (s && el) select(s.pic, invert(s.mask, cropOf(el, s.pic.w, s.pic.h)))
  }

  // While there is a selection, Delete erases it, and Ctrl+D and Escape
  // deselect, before Excalidraw (or the browser, for Ctrl+D) can take them.
  useCaptureKeys(!!sel, (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') apply('erase')
    else if (isCtrlD(e) || e.key === 'Escape') setSel(null)
    else return false
    return true
  })

  if (!container || !tool) return null

  const hint =
    note ??
    (fetching !== null ? t('fetchingModel', { n: Math.floor(fetching * 100) }) : sel ? null : t(`${tool}Hint`))

  return createPortal(
    <>
      <canvas
        ref={overlay}
        className="px-overlay"
        data-tool={tool}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null
          repaint()
        }}
      />
      <div className="px-bar" role="toolbar">
        {tool === 'wand' && (
          <label className="px-slider" title={t('toleranceTitle')}>
            <span>{t('tolerance')}</span>
            <input type="range" min={0} max={128} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
          </label>
        )}
        {hint ? (
          <span className="px-hint">{hint}</span>
        ) : (
          <>
            <button className="px-act" onClick={() => apply('erase')} title={t('eraseTitle')}>
              {t('erase')}
            </button>
            <button className="px-act" onClick={() => apply('keep')} title={t('keepTitle')}>
              {t('keep')}
            </button>
            <button className="px-act" onClick={() => apply('cut')} title={t('cutTitle')}>
              {t('cut')}
            </button>
            <button className="px-act" onClick={() => apply('copy')} title={t('copyTitle')}>
              {t('copy')}
            </button>
            <button className="px-act" onClick={flip} title={t('invertTitle')}>
              {t('invert')}
            </button>
            <button className="px-act" onClick={() => setSel(null)} title={t('deselectTitle')}>
              {t('deselect')}
            </button>
          </>
        )}
      </div>
    </>,
    container,
  )
}
