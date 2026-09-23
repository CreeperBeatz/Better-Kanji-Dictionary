/**
 * Proof of concept: one drawing pad, every handwriting recogniser we could use,
 * side by side. Not part of the app -- open /draw-poc.html on the dev server.
 *
 *  - ours:        server/recognize.py over the API (stroke endpoints, KanjiVG)
 *  - DaKanji v2:  6,507-class int8 CNN, wants light ink on black
 *  - LT8:         3,082-class fp16 ResNet, does its own crop and polarity
 *  - KanjiCanvas: stroke-correspondence matcher in plain JS
 *
 * DaKanji is run twice, on the whole pad and cropped to the ink, because it
 * has no crop of its own and it was trained on centred ETL scans.
 *
 * web/public/models/ is gitignored. It needs:
 *   char_classifier.onnx, char_classifier_labels.txt
 *     -- github.com/CaptainDario/DaKanji-Single-Kanji-Recognition, release v2.0
 *   lt8/model.fp16.onnx, lt8/labels.json
 *     -- huggingface.co/LT8/japanese-handwriting-onnx (not the int8 build: its
 *        own demo notes it misranks confusables like 十/ナ on drawn input)
 *   kanji-canvas.js, kanjicanvas-refpatterns.js -- github.com/asdfjkl/kanjicanvas
 */

declare const ort: any
declare const KanjiCanvas: any

type Point = [number, number]
type Candidate = { char: string; score?: string }
type Result = { list: Candidate[]; ms: number; rankOf?: (c: string) => number | null; note?: string }

const PAD = 320
const API = import.meta.env.VITE_API ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')
const SHOW = 10

const pad = document.getElementById('pad') as HTMLCanvasElement
const ctx = pad.getContext('2d', { willReadFrequently: true })!
const grid = document.getElementById('grid')!
const log = document.getElementById('log')!
const target = document.getElementById('target') as HTMLInputElement
const strokeCount = document.getElementById('strokes')!
const previews = document.getElementById('previews')!

const strokes: Point[][] = []
let current: Point[] | null = null
let seq = 0

// --- the pad ----------------------------------------------------------------

function paint() {
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, PAD, PAD)
  ctx.lineWidth = 14 // what LT8's own demo uses on a 320 pad
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000'
  for (const s of strokes) {
    ctx.beginPath()
    ctx.moveTo(s[0][0], s[0][1])
    for (const p of s.slice(1)) ctx.lineTo(p[0], p[1])
    if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1])
    ctx.stroke()
  }
}

function pos(e: PointerEvent): Point {
  const r = pad.getBoundingClientRect()
  return [((e.clientX - r.left) / r.width) * PAD, ((e.clientY - r.top) / r.height) * PAD]
}

pad.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  pad.setPointerCapture(e.pointerId)
  current = [pos(e)]
  strokes.push(current)
  paint()
})
pad.addEventListener('pointermove', (e) => {
  if (!current) return
  current.push(pos(e))
  paint()
})
const end = () => {
  if (!current) return
  current = null
  run()
}
pad.addEventListener('pointerup', end)
pad.addEventListener('pointercancel', end)

document.getElementById('undo')!.onclick = () => {
  strokes.pop()
  paint()
  run()
}
document.getElementById('clear')!.onclick = () => {
  strokes.length = 0
  paint()
  run()
}
target.addEventListener('input', () => render(lastResults))
paint()

// --- model inputs -------------------------------------------------------------

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d', { willReadFrequently: true })!]
}

function gray(c: CanvasRenderingContext2D, size: number, invert: boolean): Float32Array {
  const px = c.getImageData(0, 0, size, size).data
  const out = new Float32Array(size * size)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    out[j] = invert ? 255 - l : l
  }
  return out
}

/** The whole pad scaled to 128, as LT8's demo does it. */
function padImage(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [c, x] = canvas(128)
  x.fillStyle = '#fff'
  x.fillRect(0, 0, 128, 128)
  x.drawImage(pad, 0, 0, 128, 128)
  return [c, x]
}

/** The ink redrawn centred in a square with a margin, white on black. */
function croppedImage(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const size = 128
  const [c, x] = canvas(size)
  x.fillStyle = '#000'
  x.fillRect(0, 0, size, size)
  const pts = strokes.flat()
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys)
  // A lone horizontal like 一 must not be blown up to fill the square.
  const side = Math.max(maxx - minx, maxy - miny, PAD * 0.25)
  const margin = 0.12 * size
  const scale = (size - 2 * margin) / side
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2
  const t = (p: Point): Point => [(p[0] - cx) * scale + size / 2, (p[1] - cy) * scale + size / 2]
  x.lineWidth = 6
  x.lineCap = 'round'
  x.lineJoin = 'round'
  x.strokeStyle = '#fff'
  for (const s of strokes) {
    x.beginPath()
    const [a, b] = t(s[0])
    x.moveTo(a, b)
    for (const p of s.slice(1)) x.lineTo(...t(p))
    if (s.length === 1) x.lineTo(a + 0.1, b)
    x.stroke()
  }
  return [c, x]
}

function showPreviews(items: [string, HTMLCanvasElement][]) {
  previews.replaceChildren(
    ...items.map(([label, c]) => {
      const f = document.createElement('figure')
      f.append(c, Object.assign(document.createElement('figcaption'), { textContent: label }))
      return f
    }),
  )
}

// --- recognisers --------------------------------------------------------------

type Model = { name: string; detail: string; ready: Promise<unknown>; run: () => Promise<Result> }

function ranked(probs: ArrayLike<number>, labels: string[]) {
  const order = Array.from(probs, (p, i) => [p, i] as [number, number]).sort((a, b) => b[0] - a[0])
  // int8 output rounds most classes to exactly zero; those are label order, not guesses.
  const list = order.slice(0, SHOW).filter(([p], i) => i === 0 || p >= 0.0005).map(([p, i]) => ({ char: labels[i], score: (p * 100).toFixed(1) + '%' }))
  const rankOf = (ch: string) => {
    const r = order.findIndex(([, i]) => labels[i] === ch)
    return r < 0 ? null : r + 1
  }
  return { list, rankOf, has: (ch: string) => labels.includes(ch) }
}

function softmax(a: ArrayLike<number>): Float32Array {
  let m = -Infinity
  for (let i = 0; i < a.length; i++) m = Math.max(m, a[i])
  const e = Float32Array.from(a, (v) => Math.exp(v - m))
  const s = e.reduce((p, c) => p + c, 0)
  return e.map((v) => v / s)
}

async function session(url: string) {
  return ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
}

const dakanji = (async () => {
  const labels = [...(await (await fetch('/models/char_classifier_labels.txt')).text()).trim()]
  return { labels, s: await session('/models/char_classifier.onnx') }
})()

const lt8 = (async () => {
  const labels = ((await (await fetch('/models/lt8/labels.json')).json()) as { char: string }[]).map((e) => e.char)
  return { labels, s: await session('/models/lt8/model.fp16.onnx') }
})()

async function runDaKanji(img: [HTMLCanvasElement, CanvasRenderingContext2D], invert: boolean): Promise<Result> {
  const { labels, s } = await dakanji
  const t0 = performance.now()
  const data = gray(img[1], 128, invert)
  const out = await s.run({ image: new ort.Tensor('float32', data, [1, 1, 128, 128]) })
  const r = ranked(out.probs.data, labels)
  return { list: r.list, ms: performance.now() - t0, rankOf: r.rankOf, note: noteFor(r.has) }
}

function noteFor(has: (ch: string) => boolean) {
  const t = target.value.trim()
  return t && !has(t) ? `${t} is not in this model's labels` : undefined
}

const models: Model[] = [
  {
    name: 'Ours (server/recognize.py)',
    detail: 'stroke endpoints vs KanjiVG, order bonus',
    ready: fetch(API + '/api/recognize/ready'),
    run: async () => {
      const t0 = performance.now()
      const thinned = strokes.map((s) => (s.length > 2 ? [s[0], s[s.length - 1]] : s))
      const res = await fetch(API + '/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes: thinned, limit: 60 }),
      })
      const body = (await res.json()) as { candidates: { char: string; score: number }[] }
      const all = body.candidates
      return {
        list: all.slice(0, SHOW).map((c) => ({ char: c.char, score: c.score.toFixed(1) })),
        ms: performance.now() - t0,
        rankOf: (ch) => {
          const i = all.findIndex((c) => c.char === ch)
          return i < 0 ? null : i + 1
        },
      }
    },
  },
  {
    name: 'DaKanji v2 — cropped to ink',
    detail: '6,507 classes · int8 · 2.2 MB',
    ready: dakanji,
    run: () => runDaKanji(croppedImage(), false),
  },
  {
    name: 'DaKanji v2 — whole pad',
    detail: 'same model, pad inverted, no crop',
    ready: dakanji,
    run: () => runDaKanji(padImage(), true),
  },
  {
    name: 'LT8 japanese-handwriting',
    detail: '3,082 classes · fp16 · 14.5 MB',
    ready: lt8,
    run: async () => {
      const { labels, s } = await lt8
      const t0 = performance.now()
      const data = gray(padImage()[1], 128, false)
      const out = await s.run({ input: new ort.Tensor('float32', data, [1, 1, 128, 128]) })
      const r = ranked(softmax(out.logits.data), labels)
      return { list: r.list, ms: performance.now() - t0, rankOf: r.rankOf, note: noteFor(r.has) }
    },
  },
  {
    name: 'KanjiCanvas',
    detail: `stroke correspondence · ${KanjiCanvas.refPatterns.length} patterns`,
    ready: Promise.resolve(KanjiCanvas.init('kc')),
    run: async () => {
      const t0 = performance.now()
      const k = 256 / PAD
      KanjiCanvas.recordedPattern_kc = strokes.map((s) => s.map(([x, y]) => [x * k, y * k]))
      const text: string = KanjiCanvas.recognize('kc') ?? ''
      const list = text.split(/\s+/).filter(Boolean).map((char) => ({ char }))
      return {
        list,
        ms: performance.now() - t0,
        // It only ever reports its top ten.
        rankOf: (ch) => {
          const i = list.findIndex((c) => c.char === ch)
          return i < 0 ? null : i + 1
        },
      }
    },
  },
]

// --- running and rendering ------------------------------------------------------

let lastResults: (Result | Error | null)[] = models.map(() => null)

function render(results: (Result | Error | null)[]) {
  const t = target.value.trim()
  grid.replaceChildren(
    ...models.map((m, i) => {
      const r = results[i]
      const box = document.createElement('div')
      box.className = 'model'
      const h = document.createElement('h2')
      h.textContent = m.name
      const meta = document.createElement('div')
      meta.className = 'meta'
      const ol = document.createElement('ol')
      if (r instanceof Error) {
        meta.textContent = 'error: ' + r.message
      } else if (r) {
        const bits = [m.detail, `${r.ms.toFixed(0)} ms`]
        meta.textContent = bits.join(' · ')
        if (t && r.rankOf) {
          const rank = r.rankOf(t)
          const span = document.createElement('div')
          span.className = 'rank' + (rank === null || rank > SHOW ? ' miss' : '')
          span.textContent = r.note ?? (rank === null ? `${t}: not found` : `${t}: rank ${rank}`)
          meta.append(span)
        }
        for (const c of r.list) {
          const li = document.createElement('li')
          if (c.char === t) li.className = 'hit'
          li.innerHTML = `<span class="c"></span><span class="s"></span>`
          li.querySelector('.c')!.textContent = c.char
          li.querySelector('.s')!.textContent = c.score ?? ''
          ol.append(li)
        }
      } else {
        meta.textContent = m.detail
      }
      box.append(h, meta, ol)
      return box
    }),
  )
}

async function run() {
  const mine = ++seq
  strokeCount.textContent = strokes.length ? `${strokes.length} strokes` : ''
  if (!strokes.length) {
    lastResults = models.map(() => null)
    render(lastResults)
    previews.replaceChildren()
    return
  }
  showPreviews([
    ['DaKanji crop', croppedImage()[0]],
    ['LT8 / DaKanji pad', padImage()[0]],
  ])
  // Sequentially, so the timings are each model's own and not a race for the CPU.
  const results: (Result | Error | null)[] = models.map(() => null)
  for (let i = 0; i < models.length; i++) {
    try {
      results[i] = await models[i].run()
    } catch (e) {
      results[i] = e as Error
    }
    if (mine !== seq) return
    lastResults = results
    render(results)
  }
}

render(lastResults)
models.forEach((m) =>
  m.ready.then(
    () => (log.textContent += `✓ ${m.name} ready\n`),
    (e) => (log.textContent += `✗ ${m.name}: ${e?.message ?? e}\n`),
  ),
)
