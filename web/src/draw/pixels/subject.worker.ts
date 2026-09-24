/**
 * Finding what a picture is of, apart from its background: BRIA's RMBG-1.4,
 * run on the device with onnxruntime-web, off the main thread.
 *
 * It has to answer in a few seconds on any device, so it looks at the picture
 * at the largest size the device can manage in about that: on the GPU
 * (WebGPU) the 1024 px it was trained at, a second or so on a laptop's
 * integrated graphics; on a single CPU thread -- threads need a
 * cross-origin-isolated page, which Google sign-in rules out -- 512 px on a
 * laptop and less on a phone, for a mask that is softer at the edges. How
 * fast the device is, is timed when the tool is picked, remembered, and kept
 * up to date by every run after.
 *
 * The model is pipeline/rmbg_model.py's build, served with the app; BRIA's
 * own int8 file from Hugging Face stands in where that is missing. Either is
 * 44 MB, fetched the first time the tool is picked and kept in a cache of its
 * own after. Licence: Bria RMBG-1.4, non-commercial use.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web'
import wasmUrl from 'ort-dist/ort-wasm-simd-threaded.wasm?url'
import glueUrl from 'ort-dist/ort-wasm-simd-threaded.mjs?url'
import gpuWasmUrl from 'ort-dist/ort-wasm-simd-threaded.jsep.wasm?url'
import gpuGlueUrl from 'ort-dist/ort-wasm-simd-threaded.jsep.mjs?url'

const OURS = '/models/rmbg-1.4-w8.onnx'
/** Fixed at 1024 px and integer-only: the CPU, at full size. */
const BRIAS =
  'https://huggingface.co/briaai/RMBG-1.4/resolve/2ceba5a5efaec153162aedea169f76caf9b46cf8/onnx/model_quantized.onnx'
const SIZE = 44_300_000
/** Kept by the service worker across its updates; see sw.template.js. */
const CACHE = 'models-v1'

/** How long the model may take, in ms, leaving room for the rest within a few seconds. */
const BUDGET = 2000
const GPU_SIDES = [1024, 896, 768, 640, 512]
const CPU_SIDES = [512, 448, 384, 320, 256]

/** A device's speed: ms per million input pixels, on the GPU or the CPU. */
export interface Speed {
  gpu: boolean
  ms: number
}

export type ToWorker = { kind: 'warm'; speed: Speed | null } | { kind: 'run'; id: number; image: ImageBitmap }
export type FromWorker =
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'ready'; gpu: boolean }
  | { kind: 'speed'; speed: Speed }
  | { kind: 'done'; id: number; alpha: ArrayBuffer; side: number }
  | { kind: 'failed'; id: number; message: string }

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, { transfer })

/** The model's bytes, from the cache or else the network, reporting progress. */
async function download(url: string): Promise<ArrayBuffer | null> {
  const cache = await caches.open(CACHE).catch(() => null)
  const hit = await cache?.match(url)
  if (hit) return hit.arrayBuffer()
  const res = await fetch(url)
  // A missing file on our own server comes back as the app's page.
  if (!res.ok || !res.body || (res.headers.get('content-type') ?? '').includes('text/html')) return null
  const total = Number(res.headers.get('content-length')) || SIZE
  const reader = res.body.getReader()
  let buf = new Uint8Array(Math.max(total, 1))
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (loaded + value.length > buf.length) {
      const bigger = new Uint8Array((loaded + value.length) * 2)
      bigger.set(buf.subarray(0, loaded))
      buf = bigger
    }
    buf.set(value, loaded)
    loaded += value.length
    post({ kind: 'loading', loaded, total })
  }
  const body = buf.slice(0, loaded).buffer
  await cache?.put(url, new Response(body, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {})
  return body
}

async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

interface Model {
  ort: typeof import('onnxruntime-web')
  session: InferenceSession
  gpu: boolean
  /** BRIA's own file takes 1024 px and nothing else. */
  fixed: boolean
}

let loading: Promise<Model> | null = null

function load(): Promise<Model> {
  loading ??= (async () => {
    const ours = await download(OURS)
    const bytes = ours ?? (await download(BRIAS))
    if (!bytes) throw new Error('the model could not be fetched')
    if (ours && (await hasGpu())) {
      try {
        const ort = await import('onnxruntime-web/webgpu')
        ort.env.wasm.wasmPaths = { wasm: gpuWasmUrl, mjs: gpuGlueUrl }
        ort.env.wasm.numThreads = 1
        const session = await ort.InferenceSession.create(bytes, {
          executionProviders: ['webgpu'],
          graphOptimizationLevel: 'all',
        })
        return { ort, session, gpu: true, fixed: false }
      } catch (e) {
        console.warn('subject: WebGPU failed, using the CPU', e)
      }
    }
    const ort = await import('onnxruntime-web/wasm')
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: glueUrl }
    ort.env.wasm.numThreads = 1
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return { ort, session, gpu: false, fixed: !ours }
  })()
  loading.catch(() => (loading = null))
  return loading
}

// --- how big a picture the device can take --------------------------------

let speed: number | null = null
/** Sizes run once already: on the GPU the first run at a size compiles its shaders, and is no measure. */
const seen = new Set<number>()

function sideFor(m: Model): number {
  if (m.fixed) return 1024
  const sides = m.gpu ? GPU_SIDES : CPU_SIDES
  if (speed === null) return sides[0]
  const ms = speed
  return sides.find((s) => (ms * s * s) / 1e6 <= BUDGET) ?? sides[sides.length - 1]
}

function timed(m: Model, side: number, ms: number) {
  const first = !seen.has(side)
  seen.add(side)
  if (m.gpu && first) return
  const measured = (ms * 1e6) / (side * side)
  speed = speed === null ? measured : (speed + measured) / 2
  post({ kind: 'speed', speed: { gpu: m.gpu, ms: speed } })
}

/** The picture stretched to the model's square, each channel centred on zero. */
function input(m: Model, image: ImageBitmap | null, side: number): Tensor {
  const n = side * side
  const data = new Float32Array(3 * n)
  if (image) {
    const c = new OffscreenCanvas(side, side)
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(image, 0, 0, side, side)
    const px = g.getImageData(0, 0, side, side).data
    for (let i = 0; i < n; i++) {
      data[i] = px[i * 4] / 255 - 0.5
      data[n + i] = px[i * 4 + 1] / 255 - 0.5
      data[2 * n + i] = px[i * 4 + 2] / 255 - 0.5
    }
  }
  return new m.ort.Tensor('float32', data, [1, 3, side, side])
}

async function run(m: Model, image: ImageBitmap | null, side: number): Promise<Float32Array> {
  const x = input(m, image, side)
  const t = performance.now()
  const out = await m.session.run({ [m.session.inputNames[0]]: x })
  timed(m, side, performance.now() - t)
  return out[m.session.outputNames[0]].data as Float32Array
}

// Picking the tool warms it: fetched, set up, and -- unless this device's
// speed is known from before -- timed on a small picture (the CPU) or run
// twice at full size (the GPU, whose first run compiles its shaders), so the
// first click already knows what size it can afford.
let warmed: Promise<void> | null = null
function warm(known: Speed | null): Promise<void> {
  warmed ??= load().then(async (m) => {
    if (known && known.gpu === m.gpu) speed = known.ms
    if (m.gpu) {
      const side = sideFor(m)
      await run(m, null, side)
      if (speed === null) await run(m, null, side)
    } else if (!m.fixed && speed === null) {
      await run(m, null, CPU_SIDES[CPU_SIDES.length - 1])
    }
    post({ kind: 'ready', gpu: m.gpu })
  })
  warmed.catch(() => (warmed = null))
  return warmed
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.kind === 'warm') {
    warm(msg.speed).catch(() => {})
    return
  }
  try {
    await warm(null)
    const m = await load()
    const side = sideFor(m)
    const out = await run(m, msg.image, side)
    msg.image.close()
    // Stretched to the full range, as BRIA's own post-processing does.
    let lo = Infinity
    let hi = -Infinity
    for (const v of out) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = hi - lo || 1
    const alpha = new Uint8ClampedArray(out.length)
    for (let i = 0; i < out.length; i++) alpha[i] = ((out[i] - lo) / span) * 255
    post({ kind: 'done', id: msg.id, alpha: alpha.buffer, side }, [alpha.buffer])
  } catch (err) {
    post({ kind: 'failed', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
