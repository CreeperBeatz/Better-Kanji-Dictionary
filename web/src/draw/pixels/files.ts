/** Pictures in and out of Excalidraw's files. */

import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = fail
    img.src = src
  })
}

export function newFileId(): FileId {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '') as FileId
}

/** A canvas as a new PNG file for Excalidraw. */
export function fileOf(c: HTMLCanvasElement): BinaryFileData {
  return { id: newFileId(), mimeType: 'image/png', dataURL: c.toDataURL('image/png') as BinaryFileData['dataURL'], created: Date.now() }
}

/**
 * The scene changed, with the new files it uses, as one step to undo.
 * Excalidraw only loads the files of elements already in the scene, so they
 * are added after the elements -- before, a new picture shows as its
 * placeholder until a later refresh catches up.
 */
export function commit<K extends keyof AppState>(
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
  files: BinaryFileData[],
  appState?: Pick<AppState, K>,
) {
  api.updateScene({ elements, appState, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  if (files.length) api.addFiles(files)
}
