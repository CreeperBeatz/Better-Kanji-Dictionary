/** Messages between the page and the lookup worker. */

export type OfflineState =
  /** No IndexedDB or no workers: everything stays on the server. */
  | 'unsupported'
  /** Nothing on this device, and not fetching it. */
  | 'off'
  /** The first download, before anything works locally. */
  | 'downloading'
  /** A pack is installed and being read; lookups wait for it rather than go to the server. */
  | 'loading'
  /** Lookup answers on the device. An update may be downloading behind it. */
  | 'ready'
  /** The first download failed; the server still answers. */
  | 'error'

export interface OfflineStatus {
  state: OfflineState
  /** 0..1 while a download runs, first or update. */
  progress: number | null
  /** A newer pack is downloading while the installed one answers. */
  updating: boolean
  version: string | null
  built: string | null
  /** The download's size, compressed: the installed pack's, or the one on offer. */
  gz: number | null
  error: string | null
}

export const INITIAL: OfflineStatus = {
  state: 'off',
  progress: null,
  updating: false,
  version: null,
  built: null,
  gz: null,
  error: null,
}

export type Method =
  | 'search'
  | 'recognize'
  | 'recognizerReady'
  | 'radicals'
  | 'searchByRadicals'
  | 'byLevel'
  | 'wordsFor'
  | 'kanji'
  | 'wordEntry'

export type ToWorker =
  /** `auto`: download without being asked, because the app is installed. */
  | { type: 'init'; base: string; auto: boolean }
  | { type: 'download' }
  /** Look for a newer pack, if one is installed or was being fetched. */
  | { type: 'sync' }
  /** Learn the download's size without starting it. */
  | { type: 'check' }
  | { type: 'remove' }
  | { type: 'call'; id: number; method: Method; args: unknown[] }

export type FromWorker =
  | { type: 'status'; status: OfflineStatus }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
