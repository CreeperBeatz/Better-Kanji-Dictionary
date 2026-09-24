/*
 * Better Kanji Dictionary's service worker: the app opens with no connection.
 *
 * Built from web/sw.template.js by the plugin in vite.config.ts, which fills
 * in the build's version and the files the first screen needs. Each build is
 * a new worker, so a deploy replaces the cached app in one step.
 *
 * What is cached:
 *   the shell      index.html and the entry's scripts and styles, at install
 *   /assets/*      everything else the app loads later, the first time it is used
 *   fonts          Google Fonts, so the page looks the same offline
 *   /api/*         never -- the offline dictionary lives in IndexedDB, not here
 */

const VERSION = '__VERSION__'
const SHELL = __SHELL__
const SHELL_CACHE = `shell-${VERSION}`
const RUNTIME_CACHE = `runtime-${VERSION}`
const FONT_CACHE = 'fonts'

// On a slow connection the cached page is better than waiting for the network.
const NAVIGATION_TIMEOUT = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, FONT_CACHE])
  event.waitUntil(
    caches
      .keys()
      // models-* are downloaded by the pages themselves, and outlive a release.
      .then((names) => Promise.all(names.filter((n) => !keep.has(n) && !n.startsWith('models-')).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE))
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(page(req))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    // Hashed names: a file under one name never changes.
    event.respondWith(cacheFirst(req))
    return
  }
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE))
})

/** Every path is the same single-page app, so any navigation can be served the cached shell. */
async function page(req) {
  const cache = await caches.open(SHELL_CACHE)
  const network = fetch(req).then((res) => {
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) cache.put('/', res.clone())
    return res
  })
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT))
  try {
    const res = await Promise.race([network, timeout])
    if (res) return res
  } catch {
    // offline: fall through to the cached shell
  }
  const cached = await cache.match('/', ANY)
  if (cached) return cached
  return network
}

// The server varies on Origin (CORS) and Accept-Encoding, and a module script
// is requested with an Origin that the precache's own requests did not send.
// A hashed file is the same file whoever asks, so Vary is beside the point.
const ANY = { ignoreVary: true }

async function cacheFirst(req) {
  const hit = await caches.match(req, ANY)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    const cache = await caches.open(RUNTIME_CACHE)
    cache.put(req, res.clone())
  }
  return res
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req, ANY)
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
      return res
    })
    .catch(() => undefined)
  if (hit) return hit
  const res = await fresh
  return res || Response.error()
}
