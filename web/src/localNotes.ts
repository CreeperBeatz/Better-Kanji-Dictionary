/**
 * Signed-out notes, kept in this browser only.
 *
 * IndexedDB rather than localStorage because notes carry images and drawings,
 * which are blobs and can run to megabytes. Nothing here is sent anywhere
 * until you sign in, when `account/auth.ts` moves it all into your account
 * and clears it from here.
 *
 * Images are named `local-<uuid>.<ext>`, so a note can hold them in the same
 * `images` list as a server note and anything showing them can tell which is
 * which. A drawing is an image stored with its Excalidraw scene beside it.
 */

export interface LocalNote {
  char: string
  text: string
  images: string[]
  updated: string
}

interface LocalImage {
  name: string
  blob: Blob
  scene?: string
}

const DB = 'betterrtk-notes'
const NOTES = 'notes'
const IMAGES = 'images'

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(NOTES, { keyPath: 'char' })
      req.result.createObjectStore(IMAGES, { keyPath: 'name' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      opening = null
      reject(req.error)
    }
  })
  return opening
}

async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
  const conn = await db()
  return new Promise<T>((resolve, reject) => {
    const tx = conn.transaction(store, mode)
    const req = op(tx.objectStore(store))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const isLocalImage = (name: string) => name.startsWith('local-')

export async function getNote(char: string): Promise<LocalNote | null> {
  return (await run<LocalNote | undefined>(NOTES, 'readonly', (s) => s.get(char))) ?? null
}

export function allNotes(): Promise<LocalNote[]> {
  return run<LocalNote[]>(NOTES, 'readonly', (s) => s.getAll())
}

/** Save a note, or drop it when empty; images it let go of are deleted. */
export async function putNote(char: string, text: string, images: string[]) {
  const before = await getNote(char)
  if (!text.trim() && images.length === 0) await run(NOTES, 'readwrite', (s) => s.delete(char))
  else await run(NOTES, 'readwrite', (s) => s.put({ char, text, images, updated: new Date().toISOString() }))
  for (const name of before?.images ?? []) {
    if (!images.includes(name)) await deleteImage(name)
  }
}

/** Forget a note without touching its images -- for after they have been moved. */
export function forgetNote(char: string) {
  return run(NOTES, 'readwrite', (s) => s.delete(char))
}

export async function putImage(blob: Blob, scene?: string): Promise<string> {
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const name = `local-${crypto.randomUUID()}.${ext}`
  await run(IMAGES, 'readwrite', (s) => s.put({ name, blob, scene } satisfies LocalImage))
  return name
}

export async function getImage(name: string): Promise<LocalImage | null> {
  return (await run<LocalImage | undefined>(IMAGES, 'readonly', (s) => s.get(name))) ?? null
}

export function deleteImage(name: string) {
  return run(IMAGES, 'readwrite', (s) => s.delete(name))
}

/** Which of these images are drawings, i.e. have a scene to reopen. */
export async function drawingsAmong(images: string[]): Promise<string[]> {
  const found = await Promise.all(images.map(async (n) => ((await getImage(n))?.scene ? n : null)))
  return found.filter((n): n is string => n !== null)
}
