/**
 * The offline pack's home in IndexedDB.
 *
 *   meta     'pack' -> the installed pack; 'progress' -> a download underway
 *   files    '<version>/<name>' -> index.bin (ArrayBuffer), kanji.json (text)
 *   words    JMdict id -> RawWord
 *   strokes  char -> SVG paths
 *
 * Entries and strokes are not versioned: ids are stable across JMdict
 * releases, so a new pack overwrites them in place while the old index keeps
 * answering, and a word that has since left the dictionary just goes unused.
 */

import type { EntryStore, RawWord } from './engine'

const NAME = 'bkd-offline'
const STORES = ['meta', 'files', 'words', 'strokes'] as const
type StoreName = (typeof STORES)[number]

export interface InstalledPack {
  version: string
  built: string
  /** What was downloaded, compressed. */
  gz: number
  installed: string
}

export interface Progress {
  version: string
  done: string[]
}

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export class Db {
  private readonly db: IDBDatabase

  private constructor(db: IDBDatabase) {
    this.db = db
    // Another tab deleting or upgrading the database should not be blocked by this one.
    db.onversionchange = () => db.close()
  }

  static async open(): Promise<Db> {
    const req = indexedDB.open(NAME, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    return new Db(await promised(req))
  }

  static async destroy(): Promise<void> {
    await promised(indexedDB.deleteDatabase(NAME))
  }

  close(): void {
    this.db.close()
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return promised(this.db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>
  }

  async put(store: StoreName, key: IDBValidKey, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    await finished(tx)
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    await finished(tx)
  }

  async keys(store: StoreName): Promise<IDBValidKey[]> {
    return promised(this.db.transaction(store).objectStore(store).getAllKeys())
  }

  /** Many records in one transaction, which is what makes 218,000 of them affordable. */
  async putMany(store: StoreName, entries: [IDBValidKey, unknown][]): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    for (const [k, v] of entries) os.put(v, k)
    await finished(tx)
  }

  async getMany<T>(store: StoreName, keys: IDBValidKey[]): Promise<Map<IDBValidKey, T>> {
    const out = new Map<IDBValidKey, T>()
    if (!keys.length) return out
    const tx = this.db.transaction(store)
    const os = tx.objectStore(store)
    for (const k of keys) {
      const req = os.get(k)
      req.onsuccess = () => {
        if (req.result !== undefined) out.set(k, req.result as T)
      }
    }
    await finished(tx)
    return out
  }

  entries(): EntryStore {
    return {
      words: (ids) => this.getMany<RawWord>('words', ids) as Promise<Map<number, RawWord>>,
      strokes: (char) => this.get<string[]>('strokes', char).then((v) => v ?? null),
    }
  }
}
