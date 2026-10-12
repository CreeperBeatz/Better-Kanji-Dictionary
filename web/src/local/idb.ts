/**
 * The offline pack's home in IndexedDB.
 *
 *   meta     'pack' -> the installed pack; 'progress' -> a download underway
 *   files    '<version>/<name>' -> index.bin (ArrayBuffer), kanji.json (text);
 *            '<version>/page/<char>' -> the kanji's page, its words by id
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
  /** Each file's hash: what an update need not fetch again. Absent before packs had them. */
  files?: Record<string, string>
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

  /** Every record but those with keys starting `prefix`. */
  async deleteAllBut(store: StoreName, prefix: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    os.delete(IDBKeyRange.upperBound(prefix, true))
    os.delete(IDBKeyRange.lowerBound(prefix + String.fromCharCode(0xffff), true))
    await finished(tx)
  }

  /** The records with keys starting `from`, again under `to` in their place. */
  async copyPrefix(store: StoreName, from: string, to: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    const range = IDBKeyRange.bound(from, from + String.fromCharCode(0xffff))
    const [keys, values] = await Promise.all([promised(os.getAllKeys(range)), promised(os.getAll(range))])
    keys.forEach((k, i) => os.put(values[i], to + String(k).slice(from.length)))
    await finished(tx)
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

  entries(version: string): EntryStore {
    return {
      words: (ids) => this.getMany<RawWord>('words', ids) as Promise<Map<number, RawWord>>,
      strokes: (char) => this.get<string[]>('strokes', char).then((v) => v ?? null),
      page: (char) => this.get<unknown>('files', `${version}/page/${char}`).then((v) => v ?? null),
    }
  }
}
