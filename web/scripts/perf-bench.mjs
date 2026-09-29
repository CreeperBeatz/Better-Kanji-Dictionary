// Usage: node scripts/perf-bench.mjs [base=http://localhost:5173] [cpuThrottle=4] [reduce]
// Phone-layout jank benchmark under CPU throttling. Prints long tasks and dropped frames per step.
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const RATE = Number(process.argv[3] ?? 4)
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en' })
await ctx.addInitScript(() => {
  const p = { long: [], frames: [] }
  window.__perf = p
  new PerformanceObserver((l) => l.getEntries().forEach((e) => p.long.push(e.duration))).observe({ type: 'longtask', buffered: true })
  let last = performance.now()
  const tick = (t) => {
    p.frames.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const page = await ctx.newPage()
if (process.argv[4] === 'reduce') await page.emulateMedia({ reducedMotion: 'reduce' })
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function touch(type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
}
async function tapAt(x, y) {
  await touch('touchStart', x, y)
  await wait(50)
  await touch('touchEnd')
}
async function tapEl(loc) {
  const b = await loc.boundingBox()
  await tapAt(b.x + b.width / 2, b.y + b.height / 2)
}
async function swipe(x0, y0, x1, y1, ms = 300) {
  const steps = Math.round(ms / 16)
  await touch('touchStart', x0, y0)
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
    await wait(16)
  }
  await touch('touchEnd')
}
const rows = []
async function measure(name, fn, settle = 900) {
  await page.evaluate(() => {
    window.__perf.long = []
    window.__perf.frames = []
  })
  try {
    await fn()
  } catch (e) {
    rows.push({ step: name, 'long tasks': 'skipped: ' + String(e).slice(0, 60) })
    return
  }
  await wait(settle)
  const p = await page.evaluate(() => window.__perf)
  const frames = p.frames
  const dropped = frames.filter((f) => f > 34).length
  const worst = Math.max(0, ...frames)
  rows.push({
    step: name,
    'long tasks': p.long.length,
    'long ms': Math.round(p.long.reduce((a, b) => a + b, 0)),
    'worst task': Math.round(Math.max(0, ...p.long)),
    'frames>34ms': dropped,
    'worst frame': Math.round(worst),
  })
}

await measure('load /', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
}, 500)
await measure('type water', async () => {
  await page.locator('.search-input').tap()
  await page.keyboard.type('water', { delay: 120 })
}, 1200)
await measure('open kanji', async () => {
  await page.locator('.search-input').evaluate((el) => el.blur())
  await tapEl(page.locator('.kanji-hit').first())
})
await measure('tab: associations', async () => {
  await tapEl(page.locator('.phone-tabs button', { hasText: 'Associations' }))
})
await measure('tab: components', async () => {
  await tapEl(page.locator('.phone-tabs button', { hasText: 'Components' }))
})
await measure('unlock + pan graph', async () => {
  await tapEl(page.locator('.graph-lock'))
  await wait(300)
  await swipe(100, 500, 320, 560, 320)
}, 600)
await measure('pinch-free zoom button x3', async () => {
  for (let i = 0; i < 3; i++) {
    await tapEl(page.locator('.map-zoom button').nth(2))
    await wait(120)
  }
}, 700)
await measure('lock + swipe to assoc', async () => {
  await tapEl(page.locator('.graph-lock'))
  await wait(300)
  await swipe(100, 500, 330, 500, 250)
})
await measure('tab: dictionary', async () => {
  await tapEl(page.locator('.phone-tabs button', { hasText: 'Dictionary' }))
})
await measure('open word from page', async () => {
  const row = page.locator('.vocab-row').first()
  await row.waitFor({ timeout: 3000 })
  await row.scrollIntoViewIfNeeded()
  await tapEl(row)
})
await measure('back', async () => {
  await page.goBack()
})
await measure('back to search', async () => {
  await page.goBack()
})
await measure('open account dialog', async () => {
  await tapEl(page.locator('.searchbar .profile-button'))
})
await measure('close account dialog', async () => {
  await page.keyboard.press('Escape')
})
await measure('open draw pad', async () => {
  await tapEl(page.locator('.searchbar-tool').first())
})
await measure('to map', async () => {
  await page.keyboard.press('Escape')
  await wait(300)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await wait(400)
  const m = page.locator('button', { hasText: /map/i }).first()
  if (await m.count()) await tapEl(m)
}, 2500)
await measure('pan map', async () => {
  await swipe(100, 700, 300, 900, 320)
}, 600)

console.table(rows)
console.log('nav timing', await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0]
  return n ? { domInteractive: Math.round(n.domInteractive), load: Math.round(n.loadEventEnd) } : null
}))
await browser.close()
