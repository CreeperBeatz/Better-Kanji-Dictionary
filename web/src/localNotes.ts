/**
 * Signed-out notes, kept in this browser only.
 *
 * IndexedDB rather than localStorage because notes carry images and drawings,
 * which are blobs and can run to megabytes. Nothing here is sent anywhere
 * until you sign in, when `account/auth.ts` moves it all into your account
 * and clears it from here.
 *
 * A character can hold several notes, like posts, so they are keyed by id and
 * indexed by character. Version 1 kept one note per character; opening the
 * database moves those across.
 *
 * Images are named `local-<uuid>.<ext>`, so a note can hold them in the same
 * `images` list as a server note and anything showing them can tell which is
 * which. A drawing is an image stored with its Excalidraw scene beside it.
 */

export interface LocalNote {
  id: string
  char: string
  text: string
  images: string[]
  created: string
  updated: string
}

interface LocalImage {
  name: string
  blob: Blob
  scene?: string
}

const DB = 'betterrtk-notes'
const LEGACY = 'notes'
const POSTS = 'posts'
const IMAGES = 'images'

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = (e) => {
      const conn = req.result
      if (e.oldVersion < 1) {
        conn.createObjectStore(LEGACY, { keyPath: 'char' })
        conn.createObjectStore(IMAGES, { keyPath: 'name' })
      }
      if (e.oldVersion < 2) {
        const posts = conn.createObjectStore(POSTS, { keyPath: 'id' })
        posts.createIndex('char', 'char')
        const legacy = req.transaction!.objectStore(LEGACY)
        legacy.openCursor().onsuccess = (ev) => {
          const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result
          if (!cursor) return
          const old = cursor.value as { char: string; text: string; images: string[]; updated: string }
          posts.put({ id: crypto.randomUUID(), ...old, created: old.updated } satisfies LocalNote)
          cursor.delete()
          cursor.continue()
        }
      }
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

/** This character's notes, newest first. */
export async function notesFor(char: string): Promise<LocalNote[]> {
  const found = await run<LocalNote[]>(POSTS, 'readonly', (s) => s.index('char').getAll(char))
  return found.sort((a, b) => b.created.localeCompare(a.created))
}

export function allNotes(): Promise<LocalNote[]> {
  return run<LocalNote[]>(POSTS, 'readonly', (s) => s.getAll())
}

function getNote(id: string): Promise<LocalNote | undefined> {
  return run<LocalNote | undefined>(POSTS, 'readonly', (s) => s.get(id))
}

export async function createNote(char: string, text: string, images: string[]): Promise<LocalNote> {
  const now = new Date().toISOString()
  const note: LocalNote = { id: crypto.randomUUID(), char, text, images, created: now, updated: now }
  await run(POSTS, 'readwrite', (s) => s.put(note))
  return note
}

/** Change a note's text and images; images it let go of are deleted. */
export async function updateNote(id: string, text: string, images: string[]) {
  const before = await getNote(id)
  if (!before) return
  await run(POSTS, 'readwrite', (s) => s.put({ ...before, text, images, updated: new Date().toISOString() }))
  for (const name of before.images) if (!images.includes(name)) await deleteImage(name)
}

/** Delete a note and the images it held. */
export async function deleteNote(id: string) {
  const before = await getNote(id)
  await run(POSTS, 'readwrite', (s) => s.delete(id))
  for (const name of before?.images ?? []) await deleteImage(name)
}

/** Forget a note without touching its images -- for after they have been moved. */
export function forgetNote(id: string) {
  return run(POSTS, 'readwrite', (s) => s.delete(id))
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
