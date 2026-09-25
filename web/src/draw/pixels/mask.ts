/**
 * A selection of a picture's pixels, kept as a canvas the size of the picture
 * whose alpha is how much of each pixel is selected -- so a lasso's edge can
 * be soft, and inverting is compositing.
 */

import type { Pt } from './geometry'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function blank(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function ctx(c: HTMLCanvasElement) {
  return c.getContext('2d', { willReadFrequently: true })!
}

/** A shape drawn in the picture's pixels, kept to the part the element shows. */
export function polygonMask(w: number, h: number, pts: Pt[], within: Rect): HTMLCanvasElement {
  const c = blank(w, h)
  const g = ctx(c)
  g.beginPath()
  g.rect(within.x, within.y, within.width, within.height)
  g.clip()
  g.beginPath()
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
  g.closePath()
  g.fillStyle = '#fff'
  g.fill()
  return c
}

/**
 * The magic wand: every pixel reached from the one clicked without crossing
 * one further than `tolerance` (0-255, on any channel) from its colour.
 * Fully transparent pixels all count as the same colour.
 */
export function wandMask(src: ImageData, at: Pt, tolerance: number, within: Rect): HTMLCanvasElement {
  const { width: w, height: h, data } = src
  const x0 = Math.max(0, Math.floor(within.x))
  const y0 = Math.max(0, Math.floor(within.y))
  const x1 = Math.min(w, Math.ceil(within.x + within.width))
  const y1 = Math.min(h, Math.ceil(within.y + within.height))
  const sx = Math.floor(at.x)
  const sy = Math.floor(at.y)
  const c = blank(w, h)
  if (sx < x0 || sy < y0 || sx >= x1 || sy >= y1) return c

  const s = (sy * w + sx) * 4
  const [r, g, b, a] = [data[s], data[s + 1], data[s + 2], data[s + 3]]
  const like = (i: number) => {
    const o = i * 4
    const oa = data[o + 3]
    if (a < 8 && oa < 8) return true
    return (
      Math.abs(oa - a) <= tolerance &&
      Math.abs(data[o] - r) <= tolerance &&
      Math.abs(data[o + 1] - g) <= tolerance &&
      Math.abs(data[o + 2] - b) <= tolerance
    )
  }

  const seen = new Uint8Array(w * h)
  const out = new ImageData(w, h)
  const stack = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    let x = stack.pop()!
    // Run left to the start of this stretch, then fill it rightwards, noting
    // where the rows above and below start stretches of their own.
    while (x > x0 && !seen[y * w + x - 1] && like(y * w + x - 1)) x--
    let up = false
    let down = false
    for (; x < x1; x++) {
      const i = y * w + x
      if (seen[i] || !like(i)) break
      seen[i] = 1
      out.data[i * 4 + 3] = 255
      if (y > y0) {
        const u = i - w
        const go = !seen[u] && like(u)
        if (go && !up) stack.push(x, y - 1)
        up = go
      }
      if (y < y1 - 1) {
        const d = i + w
        const go = !seen[d] && like(d)
        if (go && !down) stack.push(x, y + 1)
        down = go
      }
    }
  }
  ctx(c).putImageData(out, 0, 0)
  return c
}

/** Everything the element shows that was not selected. */
export function invert(mask: HTMLCanvasElement, within: Rect): HTMLCanvasElement {
  const c = blank(mask.width, mask.height)
  const g = ctx(c)
  g.fillStyle = '#fff'
  g.fillRect(within.x, within.y, within.width, within.height)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(mask, 0, 0)
  return c
}

/** The smallest rectangle holding every selected pixel, or null if there are none. */
export function bounds(mask: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = mask
  const a = ctx(mask).getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (a[(row + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/** The picture with the selected pixels made transparent. */
export function erase(img: CanvasImageSource, w: number, h: number, mask: HTMLCanvasElement): HTMLCanvasElement {
  const c = blank(w, h)
  const g = ctx(c)
  g.drawImage(img, 0, 0, w, h)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(mask, 0, 0)
  return c
}

/** Just the selected pixels, in a picture the size of the selection. */
export function extract(img: CanvasImageSource, w: number, h: number, mask: HTMLCanvasElement, box: Rect): HTMLCanvasElement {
  const c = blank(box.width, box.height)
  const g = ctx(c)
  g.drawImage(img, -box.x, -box.y, w, h)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(mask, -box.x, -box.y)
  return c
}

export function pixelsOf(img: CanvasImageSource, w: number, h: number): ImageData {
  const c = blank(w, h)
  const g = ctx(c)
  g.drawImage(img, 0, 0, w, h)
  return g.getImageData(0, 0, w, h)
}
