/**
 * The lookup worker: owns the offline pack -- downloading it, keeping it in
 * IndexedDB, and answering queries from it -- off the main thread, so neither
 * a 20 MB download nor a search over 250,000 glosses can stutter the page.
 */

import { Engine, type KanjiPack } from './engine'
import { Db, type InstalledPack, type Progress } from './idb'
import { INITIAL, type FromWorker, type Method, type OfflineStatus, type ToWorker } from './protocol'

interface Manifest {
  version: string
  built: string
  files: { name: string; bytes: number; gz: number }[]
}

const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
}

let base = ''
let db: Db | null = null
let engine: Engine | null = null
let status: OfflineStatus = { ...INITIAL }
let syncing: Promise<void> | null = null
let abort: AbortController | null = null
// Everything but `init` waits until the database is open.
let markOpened: () => void = () => {}
const opened: Promise<void> = new Promise((resolve) => (markOpened = resolve))

function setStatus(patch: Partial<OfflineStatus>): void {
  status = { ...status, ...patch }
  ctx.postMessage({ type: 'status', status })
}

// OfflineSetting translates these by their exact wording, and the two
// download failures below by their shape: change them there too.
function message(e: unknown): string {
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'there is not enough storage on this device'
  if (e instanceof TypeError) return 'the connection dropped'
  return e instanceof Error ? e.message : String(e)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ loading

async function load(version: string): Promise<Engine> {
  const index = await db!.get<ArrayBuffer>('files', `${version}/index.bin`)
  const kanji = await db!.get<string>('files', `${version}/kanji.json`)
  if (!index || !kanji) throw new Error('the pack on this device is incomplete')
  return new Engine(index, JSON.parse(kanji) as KanjiPack, db!.entries())
}

async function init(auto: boolean): Promise<void> {
  try {
    db = await Db.open()
  } catch {
    setStatus({ state: 'unsupported' })
    markOpened()
    return
  }
  markOpened()

  const installed = await db.get<InstalledPack>('meta', 'pack')
  if (!installed) setStatus({ state: 'off' })
  if (installed) {
    setStatus({ state: 'loading', version: installed.version, built: installed.built, gz: installed.gz })
    try {
      engine = await load(installed.version)
      setStatus({ state: 'ready', version: installed.version, built: installed.built, gz: installed.gz })
    } catch (e) {
      // Whatever broke it, the fix is fetching it again.
      await db.delete('meta', 'pack')
      setStatus({ state: 'off', error: message(e) })
    }
  }
  const unfinished = await db.get<Progress>('meta', 'progress')
  if (installed || unfinished || auto) void sync()
}

// ------------------------------------------------------------------ downloading

async function manifest(signal: AbortSignal): Promise<Manifest> {
  // 503 means the server is still building the pack; it takes a minute on the Pi.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/offline/manifest`, { signal, cache: 'no-store' })
    if (res.ok) return res.json()
    if (res.status !== 503 || attempt >= 12) throw new Error(`the server could not offer the dictionary (${res.status})`)
    await sleep(15_000)
  }
}

class PackChanged extends Error {}

/** One file, streamed so progress moves as it arrives, then filed away. */
async function fetchFile(m: Manifest, name: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  const res = await fetch(`${base}/api/offline/${m.version}/${name}`, { signal })
  if (res.status === 404) throw new PackChanged()
  if (!res.ok || !res.body) throw new Error(`downloading ${name} failed (${res.status})`)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    onBytes(size)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.length
  }
  chunks.length = 0

  if (name.endsWith('.bin')) {
    await db!.put('files', `${m.version}/${name}`, bytes.buffer)
    return
  }
  const text = new TextDecoder().decode(bytes)
  if (name === 'kanji.json') {
    JSON.parse(text) // fail here, not on the next start
    await db!.put('files', `${m.version}/${name}`, text)
  } else if (name === 'strokes.json') {
    const strokes = Object.entries(JSON.parse(text) as Record<string, string[]>)
    for (let i = 0; i < strokes.length; i += 2000) await db!.putMany('strokes', strokes.slice(i, i + 2000))
  } else if (name.startsWith('words-')) {
    const words = JSON.parse(text) as [number, ...unknown[]][]
    await db!.putMany('words', words.map((w) => [w[0], w]))
  }
}

// What makes search work goes first, stroke diagrams last.
function rank(name: string): number {
  if (name === 'index.bin') return 0
  if (name === 'kanji.json') return 1
  if (name === 'strokes.json') return 3
  return 2
}

function sync(): Promise<void> {
  if (!db || status.state === 'unsupported') return Promise.resolve()
  if (syncing) return syncing
  const controller = (abort = new AbortController())
  // One download per device, not per tab: a second tab waits, then finds the
  // pack already there and only loads it.
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  const job = locks
    ? locks.request('bkd-offline-download', { signal: controller.signal }, () => run(controller.signal))
    : run(controller.signal)
  syncing = job.catch(() => {}).finally(() => {
    syncing = null
    abort = null
  })
  return syncing
}

async function run(signal: AbortSignal, retried = false): Promise<void> {
  try {
    if (!engine) setStatus({ state: 'downloading', progress: 0, error: null })
    const m = await manifest(signal)
    const gz = m.files.reduce((n, f) => n + f.gz, 0)

    const installed = await db!.get<InstalledPack>('meta', 'pack')
    if (installed?.version === m.version) {
      // Installed by another tab while this one waited for the lock.
      if (!engine) {
        engine = await load(m.version)
        setStatus({ state: 'ready', progress: null, version: m.version, built: installed.built, gz: installed.gz, error: null })
      }
      return
    }

    setStatus(engine ? { updating: true, progress: 0 } : { state: 'downloading', progress: 0, gz, error: null })

    let progress = await db!.get<Progress>('meta', 'progress')
    if (progress?.version !== m.version) progress = { version: m.version, done: [] }

    const total = m.files.reduce((n, f) => n + f.bytes, 0)
    let done = m.files.filter((f) => progress!.done.includes(f.name)).reduce((n, f) => n + f.bytes, 0)
    let shown = -1
    const report = (n: number) => {
      const p = Math.min(1, (done + n) / total)
      if (Math.floor(p * 100) === shown) return
      shown = Math.floor(p * 100)
      setStatus({ progress: p })
    }

    for (const f of [...m.files].sort((a, b) => rank(a.name) - rank(b.name))) {
      if (progress.done.includes(f.name)) continue
      if (signal.aborted) throw new DOMException('stopped', 'AbortError')
      await fetchFile(m, f.name, signal, report)
      done += f.bytes
      progress.done.push(f.name)
      await db!.put('meta', 'progress', progress)
    }

    const pack: InstalledPack = { version: m.version, built: m.built, gz, installed: new Date().toISOString() }
    const next = await load(m.version)
    await db!.put('meta', 'pack', pack)
    await db!.delete('meta', 'progress')
    engine = next
    for (const key of await db!.keys('files')) {
      if (!String(key).startsWith(`${m.version}/`)) await db!.delete('files', key)
    }
    setStatus({ state: 'ready', updating: false, progress: null, version: m.version, built: m.built, gz, error: null })
  } catch (e) {
    if (e instanceof PackChanged && !retried) return run(signal, true)
    if (e instanceof DOMException && e.name === 'AbortError') return
    // With a pack installed, a failed update changes nothing you can see:
    // the next start tries again.
    if (engine) setStatus({ updating: false, progress: null })
    else setStatus({ state: 'error', progress: null, error: message(e) })
  }
}

async function check(): Promise<void> {
  if (status.gz !== null || status.state === 'unsupported') return
  try {
    const res = await fetch(`${base}/api/offline/manifest`, { cache: 'no-store' })
    if (!res.ok) return
    const m = (await res.json()) as Manifest
    if (status.gz === null) setStatus({ gz: m.files.reduce((n, f) => n + f.gz, 0) })
  } catch {
    // offline, or the server is busy: the size is just not shown
  }
}

async function remove(): Promise<void> {
  abort?.abort()
  await syncing?.catch(() => {})
  engine = null
  db?.close()
  db = null
  await Db.destroy()
  db = await Db.open()
  setStatus({ ...INITIAL, gz: status.gz })
}

// ------------------------------------------------------------------ queries

async function call(method: Method, args: unknown[]): Promise<unknown> {
  const e = engine
  if (!e) throw new Error('offline lookup is not ready')
  switch (method) {
    case 'search':
      return e.search(args[0] as string, 30, (args[1] as string) ?? 'en')
    case 'recognize':
      return { candidates: e.recognize(args[0] as number[][][]), strokes: (args[0] as unknown[]).length }
    case 'recognizerReady': {
      const r = e.recognition()
      return { chars: r.count, buckets: r.bucketCount }
    }
    case 'radicals':
      return e.radicals()
    case 'searchByRadicals':
      return e.searchByRadicals(args[0] as string[])
    case 'byLevel': {
      const level = e.byLevel(args[0] as number)
      if (!level) throw new Error('no such level')
      return level
    }
    case 'wordsFor':
      return e.wordsFor(args[0] as string)
    case 'kanji':
      return e.kanji(args[0] as string)
    case 'wordEntry':
      return e.wordEntry(args[0] as number)
  }
}

ctx.onmessage = (ev) => {
  const msg = ev.data
  switch (msg.type) {
    case 'init':
      base = msg.base
      void init(msg.auto)
      return
    case 'download':
      void opened.then(() => {
        if (status.state === 'off' || status.state === 'error') void sync()
      })
      return
    case 'sync':
      void opened.then(async () => {
        if (engine || (await db?.get('meta', 'progress'))) void sync()
      })
      return
    case 'check':
      void opened.then(check)
      return
    case 'remove':
      void opened.then(remove)
      return
    case 'call':
      call(msg.method, msg.args).then(
        (value) => ctx.postMessage({ type: 'result', id: msg.id, ok: true, value }),
        (err) => ctx.postMessage({ type: 'result', id: msg.id, ok: false, error: message(err) }),
      )
      return
  }
}
