/**
 * Finding what a picture is of, apart from its background: BRIA's RMBG-1.4,
 * run on the device with onnxruntime-web, off the main thread because on the
 * CPU it takes seconds.
 *
 * Model: huggingface.co/briaai/RMBG-1.4, pinned to a revision; the Bria
 * RMBG-1.4 licence allows non-commercial use, which this is. It is 44 MB, so
 * it is fetched only the first time it is asked for, and kept in a cache of
 * its own for the times after.
 */

import type { InferenceSession } from 'onnxruntime-web'
import wasmUrl from 'ort-dist/ort-wasm-simd-threaded.wasm?url'
import glueUrl from 'ort-dist/ort-wasm-simd-threaded.mjs?url'

const MODEL =
  'https://huggingface.co/briaai/RMBG-1.4/resolve/2ceba5a5efaec153162aedea169f76caf9b46cf8/onnx/model_quantized.onnx'
/** Kept by the service worker across its updates; see sw.template.js. */
const CACHE = 'models-v1'
const SIDE = 1024

export type ToWorker = { id: number; rgba: ArrayBuffer }
export type FromWorker =
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'running' }
  | { kind: 'done'; id: number; alpha: ArrayBuffer }
  | { kind: 'failed'; id: number; message: string }

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, { transfer })

async function modelBytes(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null)
  const hit = await cache?.match(MODEL)
  if (hit) return hit.arrayBuffer()
  const res = await fetch(MODEL)
  if (!res.ok || !res.body) throw new Error(`model: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 44_403_226
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    post({ kind: 'loading', loaded, total })
  }
  const bytes = new Uint8Array(loaded)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  await cache?.put(MODEL, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {})
  return bytes.buffer
}

let loading: Promise<{ ort: typeof import('onnxruntime-web'); session: InferenceSession }> | null = null

function load() {
  loading ??= (async () => {
    const ort = await import('onnxruntime-web/wasm')
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: glueUrl }
    // Threads need a cross-origin-isolated page, which this is not.
    ort.env.wasm.numThreads = 1
    const session = await ort.InferenceSession.create(await modelBytes(), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return { ort, session }
  })()
  loading.catch(() => (loading = null))
  return loading
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const { id, rgba } = e.data
  try {
    const { ort, session } = await load()
    post({ kind: 'running' })
    // The picture stretched to a square, each channel centred on zero, as
    // the model was trained.
    const px = new Uint8ClampedArray(rgba)
    const n = SIDE * SIDE
    const input = new Float32Array(3 * n)
    for (let i = 0; i < n; i++) {
      input[i] = px[i * 4] / 255 - 0.5
      input[n + i] = px[i * 4 + 1] / 255 - 0.5
      input[2 * n + i] = px[i * 4 + 2] / 255 - 0.5
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) })
    const m = out[session.outputNames[0]].data as Float32Array
    // Stretched to the full range, as BRIA's own post-processing does.
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < n; i++) {
      if (m[i] < lo) lo = m[i]
      if (m[i] > hi) hi = m[i]
    }
    const span = hi - lo || 1
    const alpha = new Uint8ClampedArray(n)
    for (let i = 0; i < n; i++) alpha[i] = ((m[i] - lo) / span) * 255
    post({ kind: 'done', id, alpha: alpha.buffer }, [alpha.buffer])
  } catch (err) {
    post({ kind: 'failed', id, message: err instanceof Error ? err.message : String(err) })
  }
}
