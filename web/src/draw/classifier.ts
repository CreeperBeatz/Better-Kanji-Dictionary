/**
 * Handwriting lookup by image: DaKanji v2, a small CNN over 6,507 characters,
 * run on the device with onnxruntime-web.
 *
 * It looks at the ink as a picture, so it sees what the stroke matcher in
 * server/recognize.py cannot -- curves, hooks, where a stroke bends -- and it
 * is indifferent to stroke order and stroke count by construction. What it
 * lacks is the stroke matcher's reach: no side-form radicals (亻 氵 扌 艹 辶 ...)
 * and nothing outside the Kanji Kentei list. So it leads and the matcher fills
 * in behind it; see merge().
 *
 * Model: github.com/CaptainDario/DaKanji-Single-Kanji-Recognition, release
 * v2.0, MIT (./dakanji/LICENSE). Credit asked for and given on the About page.
 *
 * Everything here is loaded on first use -- the runtime alone is megabytes --
 * and served from /assets/ under hashed names, so the service worker keeps it
 * for offline use once the pad has been opened.
 */

import type { InferenceSession } from 'onnxruntime-web'
import modelUrl from './dakanji/char_classifier.onnx?url'
import labelsText from './dakanji/labels.txt?raw'
import wasmUrl from 'ort-dist/ort-wasm-simd-threaded.wasm?url'
import glueUrl from 'ort-dist/ort-wasm-simd-threaded.mjs?url'
import type { DrawCandidate } from '../api'

export interface Guess {
  char: string
  p: number
}

// --- input -------------------------------------------------------------------
//
// The variant Dani rated best in a side-by-side trial against LT8, KanjiCanvas
// and the stroke matcher (the PoC page is in git history, commit 3436ae4):
// the ink redrawn centred in its own square, light on black. The model has no
// crop of its own and was trained on centred scans, and it reads dark-on-white
// as noise -- 十 came back as む.

const INPUT = 128
const MARGIN = 0.12      // of the square, each side
const LINE = 6           // px at 128, whatever size the ink was drawn at
const MIN_SIDE = 0.25    // of the pad: 一 or 丶 must not be blown up to fill the square

function image(strokes: [number, number][][], pad: number): Float32Array {
  const c = document.createElement('canvas')
  c.width = c.height = INPUT
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#000'
  g.fillRect(0, 0, INPUT, INPUT)

  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
  for (const s of strokes) {
    for (const [x, y] of s) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x)
      miny = Math.min(miny, y); maxy = Math.max(maxy, y)
    }
  }
  const side = Math.max(maxx - minx, maxy - miny, pad * MIN_SIDE)
  const scale = (INPUT * (1 - 2 * MARGIN)) / side
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2
  const at = (x: number, y: number): [number, number] => [
    (x - cx) * scale + INPUT / 2,
    (y - cy) * scale + INPUT / 2,
  ]

  g.strokeStyle = '#fff'
  g.lineWidth = LINE
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const s of strokes) {
    if (!s.length) continue
    g.beginPath()
    const [x0, y0] = at(...s[0])
    g.moveTo(x0, y0)
    if (s.length === 1) g.lineTo(x0 + 0.1, y0)
    for (let i = 1; i < s.length; i++) g.lineTo(...at(...s[i]))
    g.stroke()
  }

  const px = g.getImageData(0, 0, INPUT, INPUT).data
  const out = new Float32Array(INPUT * INPUT)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = px[i]
  return out
}

// --- the model ---------------------------------------------------------------

// The model also knows kana. They are dropped for the reason the stroke matcher
// drops them: this is a kanji dictionary, and ロ competing with 口 helps nobody.
const LABELS = [...labelsText.trim()]
const KEEP = LABELS.map((c) => {
  const o = c.codePointAt(0)!
  return !(o >= 0x3040 && o <= 0x30ff)
})

let loading: Promise<{ ort: typeof import('onnxruntime-web'); session: InferenceSession }> | null = null

function load() {
  loading ??= (async () => {
    const ort = await import('onnxruntime-web/wasm')
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: glueUrl }
    // Threads need a cross-origin-isolated page, which this is not, and one
    // thread runs the model in a few milliseconds anyway.
    ort.env.wasm.numThreads = 1
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return { ort, session }
  })()
  // A failed load (offline before the model was ever cached) may succeed later.
  loading.catch(() => (loading = null))
  return loading
}

let cached = false

/**
 * Fetch the runtime and model without starting them, so the service worker
 * holds them: with the offline pack installed, drawing should work offline
 * even if the pad was never opened online. Cache hits after the first time.
 */
export function cacheClassifier(): void {
  if (cached) return
  cached = true
  const retry = () => (cached = false)
  // The runtime's own chunk too: importing it only evaluates its JS.
  import('onnxruntime-web/wasm').catch(retry)
  for (const url of [modelUrl, wasmUrl, glueUrl]) fetch(url).catch(retry)
}

/** Start fetching the runtime and model, so the first stroke does not wait. */
export function warmClassifier(): Promise<unknown> {
  return load()
}

const TOP = 20

export async function classify(strokes: [number, number][][], pad: number): Promise<Guess[]> {
  if (!strokes.some((s) => s.length)) return []
  const { ort, session } = await load()
  const input = new ort.Tensor('float32', image(strokes, pad), [1, 1, INPUT, INPUT])
  const out = await session.run({ image: input })
  const probs = out.probs.data as Float32Array

  const top: Guess[] = []
  for (let i = 0; i < probs.length; i++) {
    if (!KEEP[i] || probs[i] <= 0) continue
    top.push({ char: LABELS[i], p: probs[i] })
  }
  top.sort((a, b) => b.p - a.p)
  return top.slice(0, TOP)
}

// --- merging with the stroke matcher -----------------------------------------

/** Below this the model is guessing; its int8 output is exactly 0 for most classes anyway. */
const FLOOR = 0.02
/**
 * Above this the model is sure, and its guesses all go first. Below it the
 * drawing is often something the model was never taught -- a side-form radical
 * drawn alone, a rare character -- which is exactly where the stroke matcher is
 * strong, so the two lists alternate instead.
 */
const SURE = 0.5
const LIMIT = 12

/**
 * One list out of both recognisers. `known` is the stroke matcher's own output
 * plus metadata for the classifier's picks, so every entry can show its meaning.
 */
export function merge(guesses: Guess[], matched: DrawCandidate[], known: DrawCandidate[]): DrawCandidate[] {
  const meta = new Map(known.map((c) => [c.char, c]))
  const mine = guesses
    .filter((g, i) => i === 0 || g.p >= FLOOR)
    .map((g) => meta.get(g.char) ?? { char: g.char, score: 0, strokes: 0, freq: null, meanings: [], meaningsBg: null })

  const order: DrawCandidate[] = []
  if (mine.length && guesses[0].p >= SURE) {
    order.push(...mine, ...matched)
  } else {
    for (let i = 0; i < Math.max(mine.length, matched.length); i++) {
      if (i < mine.length) order.push(mine[i])
      if (i < matched.length) order.push(matched[i])
    }
  }

  const seen = new Set<string>()
  return order.filter((c) => !seen.has(c.char) && seen.add(c.char)).slice(0, LIMIT)
}
