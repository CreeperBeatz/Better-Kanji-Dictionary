// Usage: node scripts/offline-pages-check.mjs -- do kanji pages come from the device?
// Against the dev frontend (npm run dev) and the API on 8000. Installs the offline pack in a
// fresh browser, then opens kanji pages three ways: with the server slow (the device's copy
// must show first), with the server gone (the device's copy must be the page), and as usual
// (the server's copy must match the device's). Then publishes a pack that differs from it
// only in pages.json: the device must fetch that file alone. The worker's requests are not
// Playwright's to see, so that is read from the API's access log: SERVER_LOG=<its file>.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { chromium } from 'playwright'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const PAGE_API = '**/api/search/kanji-page/**'
const OFFLINE = process.env.OFFLINE ?? '../data/offline'
const SERVER_LOG = process.env.SERVER_LOG
// The app's own instance of local.ts: Vite adds ?t= to a file edited since it started.
const LOCAL = () => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/local/local.ts'))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
// The requests this check blocks on purpose are not errors.
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()))
let failed = 0
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed++
}

await page.goto(WEB, { waitUntil: 'networkidle' })
// The download the account dialog's button starts, from the same module instance.
await page.evaluate(`import('${await page.evaluate(LOCAL)}').then((m) => m.downloadOffline())`)
const t0 = Date.now()
await page.waitForFunction(() => localStorage.getItem('betterrtk:offline') === '1', null, { timeout: 300_000, polling: 500 })
console.log(`pack installed in ${((Date.now() - t0) / 1000).toFixed(0)} s`)

const open = async (char) => {
  await page.goto(`${WEB}/kanji/${encodeURIComponent(char)}`, { waitUntil: 'domcontentloaded' })
}
const shown = async () => ({
  link: await page.locator('.meanings-link').first().textContent({ timeout: 100 }).catch(() => null),
  cards: await page.locator('.kanji-page .meaning').count(),
})

// 1. The server takes three seconds: the page must not wait for it.
await page.route(PAGE_API, async (route) => {
  await new Promise((r) => setTimeout(r, 3000))
  await route.continue()
})
await open('情')
const s1 = Date.now()
await page.locator('.kanji-page .meaning').first().waitFor({ timeout: 10_000 })
const ms = Date.now() - s1
const early = await shown()
check(ms < 2000 && early.link && early.cards > 0, `slow server: 情 meanings shown after ${ms} ms (${early.cards} cards, line: ${early.link?.slice(0, 50)}…)`)
await page.screenshot({ path: `${SHOTS}/offline-pages-slow.png` })
await page.waitForTimeout(3500)
const late = await shown()
check(late.link === early.link && late.cards === early.cards, 'slow server: its answer, when it came, changed nothing')
await page.unroute(PAGE_API)

// 2. No server for kanji pages at all.
await page.route(PAGE_API, (route) => route.abort())
for (const char of ['上', '生', '今', '畳']) {
  await open(char)
  await page.locator('.kanji-page .meaning').first().waitFor({ timeout: 10_000 }).catch(() => {})
  const s = await shown()
  check(s.cards > 0, `no server: ${char} has ${s.cards} meaning cards${s.link ? ', and its line' : ''}`)
}
await page.screenshot({ path: `${SHOTS}/offline-pages-noserver.png` })
// A character the pack has no page for falls back as before: no crash, its readings.
await open('𩸽')
await page.waitForTimeout(1500)
check((await page.locator('.kanji-page').count()) > 0, 'no server: 𩸽 (no page in the pack) still opens')
await page.unroute(PAGE_API)

// 3. As usual: the server's page is the device's.
const server = await page.evaluate(() => fetch('http://127.0.0.1:8000/api/search/kanji-page/' + encodeURIComponent('情')).then((r) => r.json()))
const device = await page.evaluate(`import('${await page.evaluate(LOCAL)}').then((m) => m.local.kanjiPage('情'))`)
check(JSON.stringify(server.link) === JSON.stringify(device?.link) && server.meanings.length === device?.meanings.length, 'server and device agree on 情')

// 4. A new pack with only the pages changed.
const local = await page.evaluate(LOCAL)
const currentPath = `${OFFLINE}/current.json`
const before = readFileSync(currentPath, 'utf8')
const m = JSON.parse(before)
// New each run: pack files are cached as immutable, so a name used before is not fetched again.
const next = randomBytes(6).toString('hex')
const logFrom = SERVER_LOG ? readFileSync(SERVER_LOG, 'utf8').length : 0
cpSync(`${OFFLINE}/${m.version}`, `${OFFLINE}/${next}`, { recursive: true })
const pages = JSON.parse(gunzipSync(readFileSync(`${OFFLINE}/${next}/pages.json.gz`)).toString('utf8'))
pages['情'].link = 'changed by offline-pages-check'
const raw = Buffer.from(JSON.stringify(pages))
writeFileSync(`${OFFLINE}/${next}/pages.json.gz`, gzipSync(raw))
const sha = createHash('sha256').update(raw).digest('hex').slice(0, 16)
const files = m.files.map((f) => (f.name === 'pages.json' ? { ...f, bytes: raw.length, sha } : f))
try {
  writeFileSync(currentPath, JSON.stringify({ ...m, version: next, files }))
  await page.evaluate(() => window.dispatchEvent(new Event('online'))) // what makes the worker look for a newer pack
  // Polled here: waitForFunction takes a returned promise for a truthy answer.
  const link = () => page.evaluate(`import('${local}').then((l) => l.local.kanjiPage('情')).then((p) => p?.link)`)
  const until = Date.now() + 60_000
  while ((await link()) !== 'changed by offline-pages-check' && Date.now() < until) await page.waitForTimeout(500)
  check((await link()) === 'changed by offline-pages-check', 'update: the device has the new page')
  if (SERVER_LOG) {
    const fetched = [...readFileSync(SERVER_LOG, 'utf8').slice(logFrom).matchAll(new RegExp(`/api/offline/${next}/([a-z0-9.-]+)`, 'g'))].map((x) => x[1])
    check(fetched.join() === 'pages.json', `update: fetched only ${fetched.join(', ') || 'nothing'}`)
  } else console.log('     (no SERVER_LOG: which files the update fetched is not checked)')
  const found = await page.evaluate(`import('${local}').then((l) => l.local.search('water', 'en', { limit: 5 }))`)
  check(found?.words?.length > 0, `update: search still answers on the device (${found?.words?.[0]?.headword})`)
} finally {
  writeFileSync(currentPath, before)
}

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
// Only now: on Windows the server holds a file it sent open while the browser's connection lives.
rmSync(`${OFFLINE}/${next}`, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
process.exit(failed ? 1 : 0)
