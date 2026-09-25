/**
 * The pixel eraser: a circle that takes away whatever of the drawing is
 * inside it, as a paint program's eraser does, where Excalidraw's own eraser
 * takes whole elements.
 *
 * Nothing in the scene is pixels but its pictures, so each kind of element is
 * erased its own way (see erase.ts for the cutting):
 *
 *   - pictures have their pixels made transparent;
 *   - pen strokes, and straight lines and arrows, are cut into pieces, which
 *     stay strokes and lines;
 *   - text touched is deleted whole: half a word is no use;
 *   - anything else -- shapes, curved or elbow lines, anything turned -- is
 *     made a picture of itself first, and erased as one. It can no longer be
 *     restyled after that.
 *
 * While the pointer is down the erased circles are only painted over in the
 * paper's colour; the scene changes when it comes up, so a stroke of the
 * eraser is one step to undo.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaptureUpdateAction, convertToExcalidrawElements, exportToCanvas, getCommonBounds, newElementWith } from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  FileId,
} from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { strings, useLang } from '../../i18n'
import { erasePath, touchesBox, type Circle, type Piece } from './erase'
import { cropOf, pixelMatrix, type Pt } from './geometry'
import { loadImage, newFileId } from './PixelTools'

const S = strings(
  {
    size: 'Size',
    sizeTitle: 'How big the eraser is ([ and ])',
    hint: 'Drag over what to erase',
    erasing: 'Erasing…',
  },
  {
    size: 'Размер',
    sizeTitle: 'Колко голяма е гумата ([ и ])',
    hint: 'Плъзнете върху това, което да изтриете',
    erasing: 'Изтриване…',
  },
)

const MIN = 4
const MAX = 160

/** How far ink reaches either side of the points it is drawn through. */
function inkReach(el: ExcalidrawElement): number {
  // A pen stroke is drawn 4.25 stroke widths across at full pressure, a
  // good deal less at the pressure most strokes have.
  return el.type === 'freedraw' ? el.strokeWidth * 1.6 : el.strokeWidth / 2
}

const random = () => Math.floor(Math.random() * 2 ** 31)

/** A copy of `el` as an element of its own. */
function fresh<T extends ExcalidrawElement>(el: T, updates: Partial<T>): T {
  return { ...newElementWith(el, updates as never), id: newFileId(), seed: random(), versionNonce: random(), boundElements: null, index: null } as T
}

/** A piece of a stroke or line, as an element: the first keeps the original's id. */
function pieceOf<T extends ExcalidrawFreeDrawElement | ExcalidrawLinearElement>(el: T, piece: Piece, first: boolean): T {
  const p0 = piece.pts[0]
  const xs = piece.pts.map((p) => p.x)
  const ys = piece.pts.map((p) => p.y)
  const points = piece.pts.map((p) => [p.x - p0.x, p.y - p0.y]) as unknown as T['points']
  const updates: Record<string, unknown> = {
    x: p0.x,
    y: p0.y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
  if (el.type === 'freedraw') {
    updates.pressures = piece.pressures ?? []
    updates.lastCommittedPoint = (points as readonly unknown[])[points.length - 1]
  } else {
    updates.lastCommittedPoint = null
    updates.startArrowhead = piece.start ? (el as ExcalidrawLinearElement).startArrowhead : null
    updates.endArrowhead = piece.end ? (el as ExcalidrawLinearElement).endArrowhead : null
    updates.startBinding = piece.start ? (el as ExcalidrawLinearElement).startBinding : null
    updates.endBinding = piece.end ? (el as ExcalidrawLinearElement).endBinding : null
  }
  return first ? (newElementWith(el, updates as never) as T) : fresh(el, updates as Partial<T>)
}

function blank(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** The circles on a canvas, through `m` from the scene to its pixels. */
function maskOf(w: number, h: number, m: DOMMatrix, circles: Circle[], clip?: { x: number; y: number; width: number; height: number }) {
  const mask = blank(w, h)
  const g = mask.getContext('2d')!
  if (clip) {
    g.beginPath()
    g.rect(clip.x, clip.y, clip.width, clip.height)
    g.clip()
  }
  g.setTransform(m)
  g.beginPath()
  for (const c of circles) {
    g.moveTo(c.x + c.r, c.y)
    g.arc(c.x, c.y, c.r, 0, Math.PI * 2)
  }
  g.fill()
  return mask
}

/** `src` with the mask's pixels made transparent, or null if none of them had anything. */
function erased(src: CanvasImageSource, w: number, h: number, mask: HTMLCanvasElement): HTMLCanvasElement | null {
  const probe = blank(w, h)
  const p = probe.getContext('2d')!
  p.drawImage(mask, 0, 0)
  p.globalCompositeOperation = 'source-in'
  p.drawImage(src, 0, 0, w, h)
  const alpha = p.getImageData(0, 0, probe.width, probe.height).data
  let any = false
  for (let i = 3; i < alpha.length; i += 4) {
    if (alpha[i]) {
      any = true
      break
    }
  }
  if (!any) return null
  const out = blank(w, h)
  const g = out.getContext('2d')!
  g.drawImage(src, 0, 0, w, h)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(mask, 0, 0)
  return out
}

function fileOf(c: HTMLCanvasElement): BinaryFileData {
  return { id: newFileId(), mimeType: 'image/png', dataURL: c.toDataURL('image/png') as BinaryFileData['dataURL'], created: Date.now() }
}

/**
 * A picture of the element, placed where it stands. Dark mode shows pictures
 * through an inverting filter of their own (see Excalidraw's
 * IMAGE_INVERT_FILTER), so the picture is made through its inverse, to look
 * as the element did.
 */
async function pictureOf(el: ExcalidrawElement, files: BinaryFiles, zoom: number) {
  const [x0, y0, x1, y1] = getCommonBounds([el])
  const pad = el.strokeWidth * 2 + 8
  const w = x1 - x0 + pad * 2
  const h = y1 - y0 + pad * 2
  const scale = Math.min(Math.max(2, zoom * (window.devicePixelRatio || 1)), 4, 4096 / w, 4096 / h)
  const drawn = await exportToCanvas({
    elements: [el],
    files,
    appState: { exportBackground: false, exportWithDarkMode: false, viewBackgroundColor: 'transparent' },
    exportPadding: pad,
    getDimensions: (cw: number, ch: number) => ({ width: cw * scale, height: ch * scale, scale }),
  })
  const out = blank(drawn.width, drawn.height)
  const g = out.getContext('2d')!
  g.filter = 'saturate(0.8) hue-rotate(180deg) invert(100%)'
  g.drawImage(drawn, 0, 0)
  return { canvas: out, x: x0 - pad, y: y0 - pad, scale }
}

/** Whether the eraser can cut this element as it is, keeping it a stroke or line. */
function cuttable(el: ExcalidrawElement): el is ExcalidrawFreeDrawElement | ExcalidrawLinearElement {
  if (el.angle) return false
  if (el.type === 'freedraw') return true
  if (el.type !== 'line' && el.type !== 'arrow') return false
  const line = el as ExcalidrawLinearElement
  if ('elbowed' in line && line.elbowed) return false
  // A curve is drawn through its points, not along them.
  if (line.roundness && line.points.length > 2) return false
  // A closed, filled line is an area.
  const [a, b] = [line.points[0], line.points[line.points.length - 1]]
  const closed = line.points.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1
  return !(closed && line.backgroundColor !== 'transparent')
}

interface Outcome {
  /** What each touched element becomes, by its id. */
  replace: Map<string, ExcalidrawElement[]>
  files: BinaryFileData[]
  /** Elements turned into pictures, whose text and arrows let go of them. */
  pictured: Set<string>
}

async function eraseScene(api: ExcalidrawImperativeAPI, circles: Circle[], appState: AppState): Promise<Outcome> {
  const out: Outcome = { replace: new Map(), files: [], pictured: new Set() }
  const files = api.getFiles()
  const reach = Math.max(...circles.map((c) => c.r))
  const bx0 = Math.min(...circles.map((c) => c.x)) - reach
  const by0 = Math.min(...circles.map((c) => c.y)) - reach
  const bx1 = Math.max(...circles.map((c) => c.x)) + reach
  const by1 = Math.max(...circles.map((c) => c.y)) + reach

  for (const el of api.getSceneElements()) {
    if (el.locked) continue
    const [x0, y0, x1, y1] = getCommonBounds([el])
    const ink = inkReach(el)
    if (x1 + ink < bx0 || x0 - ink > bx1 || y1 + ink < by0 || y0 - ink > by1) continue

    if (el.type === 'text') {
      if (touchesBox(el.x, el.y, el.width, el.height, el.angle, circles)) {
        out.replace.set(el.id, [newElementWith(el, { isDeleted: true })])
      }
      continue
    }

    if (cuttable(el)) {
      const pts: Pt[] = el.points.map(([x, y]) => ({ x: el.x + x, y: el.y + y }))
      const pressures = el.type === 'freedraw' && !el.simulatePressure && el.pressures.length === pts.length ? [...el.pressures] : null
      const pieces = erasePath(pts, pressures, circles, ink)
      if (!pieces) continue
      out.replace.set(el.id, pieces.length ? pieces.map((p, i) => pieceOf(el, p, i === 0)) : [newElementWith(el, { isDeleted: true })])
      continue
    }

    if (el.type === 'image') {
      const file = el.fileId && files[el.fileId]
      if (!file) continue
      const img = await loadImage(file.dataURL).catch(() => null)
      if (!img) continue
      const w = img.naturalWidth
      const h = img.naturalHeight
      const toPixels = pixelMatrix(el, w, h, 1, 0, 0).inverse()
      const done = erased(img, w, h, maskOf(w, h, toPixels, circles, cropOf(el, w, h)))
      if (!done) continue
      const f = fileOf(done)
      out.files.push(f)
      out.replace.set(el.id, [newElementWith(el as ExcalidrawImageElement, { fileId: f.id as FileId })])
      continue
    }

    if (el.type === 'frame' || el.type === 'magicframe' || el.type === 'embeddable' || el.type === 'iframe' || el.type === 'selection') continue

    // Anything else is made a picture, and erased as one.
    const pic = await pictureOf(el, files, appState.zoom.value)
    const { canvas, x, y, scale } = pic
    const toPixels = new DOMMatrix().scaleSelf(scale, scale).translateSelf(-x, -y)
    const done = erased(canvas, canvas.width, canvas.height, maskOf(canvas.width, canvas.height, toPixels, circles))
    if (!done) continue
    const f = fileOf(done)
    out.files.push(f)
    const [image] = convertToExcalidrawElements([
      { type: 'image', fileId: f.id as FileId, status: 'saved', x, y, width: canvas.width / scale, height: canvas.height / scale },
    ])
    out.replace.set(el.id, [newElementWith(el, { isDeleted: true }), { ...image, groupIds: el.groupIds, frameId: el.frameId } as ExcalidrawElement])
    out.pictured.add(el.id)
  }
  return out
}

/** Text and arrows bound to an element that is now a picture let go of it. */
function unbound(el: ExcalidrawElement, pictured: Set<string>): ExcalidrawElement {
  if (el.type === 'text' && el.containerId && pictured.has(el.containerId)) return newElementWith(el, { containerId: null })
  if (el.type === 'arrow' || el.type === 'line') {
    const line = el as ExcalidrawLinearElement
    const start = line.startBinding && pictured.has(line.startBinding.elementId)
    const end = line.endBinding && pictured.has(line.endBinding.elementId)
    if (start || end) {
      return newElementWith(line, { startBinding: start ? null : line.startBinding, endBinding: end ? null : line.endBinding })
    }
  }
  return el
}

interface Props {
  api: ExcalidrawImperativeAPI
  /** Where Excalidraw is mounted; the overlay goes inside its container. */
  host: HTMLElement
  on: boolean
}

export function PixelEraser({ api, host, on }: Props) {
  const t = S(useLang())
  const container = host.querySelector<HTMLElement>('.excalidraw-container')
  const overlay = useRef<HTMLCanvasElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(20)
  const [busy, setBusy] = useState(false)
  const stroke = useRef<Circle[] | null>(null)
  const last = useRef<Pt | null>(null)

  // [ and ] make it smaller and bigger, as in paint programs.
  useEffect(() => {
    if (!on) return
    function onKey(e: KeyboardEvent) {
      const at = e.target as HTMLElement | null
      if (at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)) return
      if (e.key !== '[' && e.key !== ']') return
      e.preventDefault()
      e.stopPropagation()
      setSize((s) => {
        const step = s < 20 ? 2 : s < 60 ? 5 : 10
        return Math.min(MAX, Math.max(MIN, s + (e.key === ']' ? step : -step)))
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [on])

  useEffect(() => {
    if (ring.current) {
      ring.current.style.width = ring.current.style.height = `${size}px`
    }
  }, [size, on])

  if (!container || !on) return null

  function local(e: React.PointerEvent): Pt {
    const r = overlay.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function moveRing(p: Pt | null) {
    const el = ring.current
    if (!el) return
    el.style.display = p ? 'block' : 'none'
    if (p) el.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`
  }

  /** One circle of the stroke, kept in the scene and painted over on screen. */
  function stamp(p: Pt) {
    const st = api.getAppState()
    const z = st.zoom.value
    stroke.current!.push({ x: p.x / z - st.scrollX, y: p.y / z - st.scrollY, r: size / 2 / z })
    const cv = preview.current!
    const dpr = window.devicePixelRatio || 1
    const g = cv.getContext('2d')!
    // The preview is drawn through the same dark-mode filter as the scene,
    // so the scene's own background colour is the paper's.
    g.fillStyle = st.viewBackgroundColor === 'transparent' ? '#ffffff' : st.viewBackgroundColor
    g.beginPath()
    g.arc(p.x * dpr, p.y * dpr, (size / 2) * dpr, 0, Math.PI * 2)
    g.fill()
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || busy) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const cv = preview.current!
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(container!.clientWidth * dpr)
    cv.height = Math.round(container!.clientHeight * dpr)
    const p = local(e)
    stroke.current = []
    last.current = p
    stamp(p)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = local(e)
    moveRing(p)
    const from = last.current
    if (!stroke.current || !from) return
    // Circles a quarter of their size apart, so a fast stroke leaves no gaps.
    const d = Math.hypot(p.x - from.x, p.y - from.y)
    const step = Math.max(1, size / 4)
    if (d < step) return
    const n = Math.floor(d / step)
    for (let i = 1; i <= n; i++) {
      stamp({ x: from.x + ((p.x - from.x) * i) / n, y: from.y + ((p.y - from.y) * i) / n })
    }
    last.current = p
  }

  async function up() {
    const circles = stroke.current
    stroke.current = null
    last.current = null
    if (!circles?.length) return
    setBusy(true)
    try {
      const { replace, files, pictured } = await eraseScene(api, circles, api.getAppState())
      if (replace.size) {
        // A new picture shows as Excalidraw's placeholder until it has
        // decoded it, so until then the preview holds the scene as it was,
        // with the circles over it.
        if (files.length) freeze(circles)
        const elements = api.getSceneElementsIncludingDeleted().flatMap((el) => (replace.get(el.id) ?? [el]).map((e) => unbound(e, pictured)))
        api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
        if (files.length) {
          // After the scene has them: Excalidraw only loads the files its
          // elements use.
          api.addFiles(files)
          await Promise.all(files.map((f) => loadImage(f.dataURL).catch(() => null)))
        }
      }
    } finally {
      // Cleared once the scene has been drawn with the change, not before.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const cv = preview.current
          cv?.getContext('2d')!.clearRect(0, 0, cv.width, cv.height)
          setBusy(false)
        }),
      )
    }
  }

  /** The scene as Excalidraw last drew it, copied into the preview, and the circles over it. */
  function freeze(circles: Circle[]) {
    const scene = container!.querySelector<HTMLCanvasElement>('canvas.excalidraw__canvas.static')
    const cv = preview.current
    if (!scene || !cv) return
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, cv.width, cv.height)
    g.drawImage(scene, 0, 0, cv.width, cv.height)
    const st = api.getAppState()
    const k = st.zoom.value * (cv.width / container!.clientWidth)
    g.fillStyle = st.viewBackgroundColor === 'transparent' ? '#ffffff' : st.viewBackgroundColor
    g.beginPath()
    for (const c of circles) {
      const x = (c.x + st.scrollX) * k
      const y = (c.y + st.scrollY) * k
      g.moveTo(x + c.r * k, y)
      g.arc(x, y, c.r * k, 0, Math.PI * 2)
    }
    g.fill()
  }

  return createPortal(
    <>
      <canvas ref={preview} className="px-erase-preview" aria-hidden />
      <canvas
        ref={overlay}
        className="px-overlay"
        data-tool="erase"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => moveRing(null)}
      />
      <div ref={ring} className="px-erase-ring" aria-hidden />
      <div className="px-bar" role="toolbar">
        <label className="px-tolerance" title={t('sizeTitle')}>
          <span>{t('size')}</span>
          <input type="range" min={MIN} max={MAX} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          <span className="px-size">{size}</span>
        </label>
        <span className="px-hint">{busy ? t('erasing') : t('hint')}</span>
      </div>
    </>,
    container,
  )
}
