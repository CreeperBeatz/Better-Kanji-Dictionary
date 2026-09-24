/**
 * Where a point in the scene falls on an image's own pixels, and back.
 *
 * Excalidraw draws an image by moving to its centre, turning by its angle,
 * flipping by its scale (±1 on each axis), and then drawing the crop -- a
 * rectangle of the unflipped picture -- across the element's width and height.
 * These undo that, step by step.
 */

import type { ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'

export interface Pt {
  x: number
  y: number
}

/** The part of the picture the element shows, in its pixels. */
export function cropOf(el: ExcalidrawImageElement, natW: number, natH: number) {
  return el.crop ?? { x: 0, y: 0, width: natW, height: natH, naturalWidth: natW, naturalHeight: natH }
}

export function sceneToPixel(el: ExcalidrawImageElement, natW: number, natH: number, p: Pt): Pt {
  const c = cropOf(el, natW, natH)
  const cx = el.x + el.width / 2
  const cy = el.y + el.height / 2
  const cos = Math.cos(-el.angle)
  const sin = Math.sin(-el.angle)
  const dx = p.x - cx
  const dy = p.y - cy
  const u = (dx * cos - dy * sin) * el.scale[0] + el.width / 2
  const v = (dx * sin + dy * cos) * el.scale[1] + el.height / 2
  return { x: c.x + (u * c.width) / el.width, y: c.y + (v * c.height) / el.height }
}

export function pixelToScene(el: ExcalidrawImageElement, natW: number, natH: number, p: Pt): Pt {
  const c = cropOf(el, natW, natH)
  const u = ((p.x - c.x) * el.width) / c.width
  const v = ((p.y - c.y) * el.height) / c.height
  const dx = (u - el.width / 2) * el.scale[0]
  const dy = (v - el.height / 2) * el.scale[1]
  const cos = Math.cos(el.angle)
  const sin = Math.sin(el.angle)
  return { x: el.x + el.width / 2 + dx * cos - dy * sin, y: el.y + el.height / 2 + dx * sin + dy * cos }
}

/** Whether a scene point lands on the element, whatever its angle. */
export function onImage(el: ExcalidrawImageElement, p: Pt): boolean {
  const cos = Math.cos(-el.angle)
  const sin = Math.sin(-el.angle)
  const dx = p.x - (el.x + el.width / 2)
  const dy = p.y - (el.y + el.height / 2)
  return Math.abs(dx * cos - dy * sin) <= el.width / 2 && Math.abs(dx * sin + dy * cos) <= el.height / 2
}

/**
 * The canvas transform that draws the element's pixels where they show, given
 * the scene-to-screen one: pixel (x, y) of the picture lands on screen at
 * `m.transformPoint`.
 */
export function pixelMatrix(el: ExcalidrawImageElement, natW: number, natH: number, zoom: number, scrollX: number, scrollY: number): DOMMatrix {
  const c = cropOf(el, natW, natH)
  return new DOMMatrix()
    .scaleSelf(zoom, zoom)
    .translateSelf(scrollX, scrollY)
    .translateSelf(el.x + el.width / 2, el.y + el.height / 2)
    .rotateSelf((el.angle * 180) / Math.PI)
    .scaleSelf(el.scale[0], el.scale[1])
    .translateSelf(-el.width / 2, -el.height / 2)
    .scaleSelf(el.width / c.width, el.height / c.height)
    .translateSelf(-c.x, -c.y)
}
