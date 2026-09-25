/**
 * "What is this a picture of": a soft mask over its subject, found by the
 * model in subject.worker.ts. The worker, the runtime and the model are all
 * fetched the first time the tool is picked, not before.
 */

import type { FromWorker, Speed, ToWorker } from './subject.worker'

export type Progress = { kind: 'loading'; share: number } | { kind: 'ready' }

/** How fast this device ran the model before, so it need not be timed again. */
const SPEED_KEY = 'betterrtk:subjectSpeed'

function knownSpeed(): Speed | null {
  try {
    const s = JSON.parse(localStorage.getItem(SPEED_KEY) ?? 'null') as Speed | null
    return s && typeof s.ms === 'number' && typeof s.gpu === 'boolean' ? s : null
  } catch {
    return null
  }
}

let worker: Worker | null = null
let next = 0
const listeners = new Set<(p: Progress) => void>()

function theWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./subject.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.kind === 'speed') {
        try {
          localStorage.setItem(SPEED_KEY, JSON.stringify(m.speed))
        } catch {
          // storage refused: timed again next time
        }
      }
      const p: Progress | null =
        m.kind === 'loading' ? { kind: 'loading', share: m.loaded / m.total } : m.kind === 'ready' ? { kind: 'ready' } : null
      if (p) listeners.forEach((f) => f(p))
    })
  }
  return worker
}

/** Hear how the model is coming along: its download, and when it is ready. */
export function onSubjectProgress(f: (p: Progress) => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Fetch and set up the model now, so the first click does not wait for it. */
export function warmSubject(): void {
  theWorker().postMessage({ kind: 'warm', speed: knownSpeed() } satisfies ToWorker)
}

/**
 * A mask the size of the picture, its alpha how surely each pixel is part of
 * the subject.
 */
export async function subjectMask(img: HTMLImageElement, w: number, h: number): Promise<HTMLCanvasElement> {
  const wk = theWorker()
  const id = ++next
  const image = await createImageBitmap(img)
  return new Promise((ok, fail) => {
    function on(e: MessageEvent<FromWorker>) {
      const m = e.data
      if ((m.kind !== 'done' && m.kind !== 'failed') || m.id !== id) return
      wk.removeEventListener('message', on)
      if (m.kind === 'failed') fail(new Error(m.message))
      else ok(toMask(new Uint8ClampedArray(m.alpha), m.side, w, h))
    }
    wk.addEventListener('message', on)
    wk.postMessage({ kind: 'run', id, image } satisfies ToWorker, [image])
  })
}

/** The model's square of confidences, stretched back over the picture. */
function toMask(alpha: Uint8ClampedArray, side: number, w: number, h: number): HTMLCanvasElement {
  const sq = document.createElement('canvas')
  sq.width = sq.height = side
  const data = new ImageData(side, side)
  for (let i = 0; i < alpha.length; i++) {
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = 255
    data.data[i * 4 + 3] = alpha[i]
  }
  sq.getContext('2d')!.putImageData(data, 0, 0)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(sq, 0, 0, w, h)
  return c
}
