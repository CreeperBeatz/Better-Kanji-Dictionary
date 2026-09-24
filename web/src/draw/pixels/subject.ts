/**
 * "What is this a picture of": a soft mask over its subject, found by the
 * model in subject.worker.ts. The worker, the runtime and the model are all
 * fetched the first time it is asked, not before.
 */

import type { FromWorker, ToWorker } from './subject.worker'

/** The square the model sees, as subject.worker.ts has it. */
const SIDE = 1024

export type Progress = { kind: 'loading'; share: number } | { kind: 'running' }

let worker: Worker | null = null
let next = 0

/**
 * A mask the size of the picture, its alpha how surely each pixel is part of
 * the subject. `onProgress` hears of the model downloading, the first time,
 * and then of it running.
 */
export function subjectMask(img: CanvasImageSource, w: number, h: number, onProgress?: (p: Progress) => void): Promise<HTMLCanvasElement> {
  worker ??= new Worker(new URL('./subject.worker.ts', import.meta.url), { type: 'module' })
  const id = ++next
  const square = document.createElement('canvas')
  square.width = square.height = SIDE
  const g = square.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, SIDE, SIDE)
  const rgba = g.getImageData(0, 0, SIDE, SIDE).data.buffer

  const w0 = worker
  return new Promise((ok, fail) => {
    function on(e: MessageEvent<FromWorker>) {
      const m = e.data
      if (m.kind === 'loading') onProgress?.({ kind: 'loading', share: m.loaded / m.total })
      else if (m.kind === 'running') onProgress?.({ kind: 'running' })
      else if (m.id === id) {
        w0.removeEventListener('message', on)
        if (m.kind === 'failed') fail(new Error(m.message))
        else ok(toMask(new Uint8ClampedArray(m.alpha), w, h))
      }
    }
    w0.addEventListener('message', on)
    w0.postMessage({ id, rgba } satisfies ToWorker, [rgba])
  })
}

/** The model's square of confidences, stretched back over the picture. */
function toMask(alpha: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const sq = document.createElement('canvas')
  sq.width = sq.height = SIDE
  const data = new ImageData(SIDE, SIDE)
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
