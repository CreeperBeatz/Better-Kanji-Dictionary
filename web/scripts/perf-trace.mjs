// Usage: node scripts/perf-trace.mjs [base] [load|type|open|recentre] [cpuThrottle]
// DevTools trace of one phone interaction: where the browser's time goes (style, layout, paint, script).
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:8000'
const STEP = process.argv[3] ?? 'type'
const RATE = Number(process.argv[4] ?? 4)
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en' })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function tapEl(loc) {
  const b = await loc.boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] })
  await wait(50)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function traced(fn, settle = 1200) {
  await browser.startTracing(page, {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'blink', 'v8.execute'],
  })
  await fn()
  await wait(settle)
  const buf = await browser.stopTracing()
  const { traceEvents } = JSON.parse(buf.toString())
  const sum = new Map()
  let forced = 0
  let layoutNodes = 0
  const longFns = []
  for (const e of traceEvents) {
    if (e.ph !== 'X' || !e.dur) continue
    const d = e.dur / 1000
    sum.set(e.name, (sum.get(e.name) ?? 0) + d)
    if (e.name === 'Layout') {
      layoutNodes += e.args?.beginData?.dirtyObjects ?? 0
      if (e.args?.beginData?.stackTrace) forced += d
    }
    if ((e.name === 'FunctionCall' || e.name === 'EventDispatch' || e.name === 'TimerFire' || e.name === 'RunTask') && d > 30) longFns.push([Math.round(d), e.name, JSON.stringify(e.args?.data ?? {}).slice(0, 140)])
  }
  const top = [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  for (const [k, v] of top) console.log(String(Math.round(v)).padStart(6), 'ms ', k)
  console.log('forced (synchronous) layout ms', Math.round(forced), ' dirty layout objects', layoutNodes)
  console.log('--- long tasks > 30ms')
  for (const l of longFns.sort((a, b) => b[0] - a[0]).slice(0, 12)) console.log(...l)
}

if (STEP === 'load') {
  await traced(async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  }, 600)
} else {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await wait(600)
}
if (STEP === 'type') {
  await traced(async () => {
    await page.locator('.search-input').tap()
    await page.keyboard.type('water', { delay: 150 })
  })
}
if (STEP === 'open') {
  await page.locator('.search-input').tap()
  await page.keyboard.type('water', { delay: 60 })
  await wait(1500)
  await page.locator('.search-input').evaluate((el) => el.blur())
  await traced(async () => {
    await tapEl(page.locator('.kanji-hit').first())
  })
}
if (STEP === 'recentre') {
  await page.goto(BASE + '/kanji/%E6%B0%B8', { waitUntil: 'networkidle' })
  await wait(1000)
  await tapEl(page.locator('.phone-tabs button', { hasText: 'Components' }))
  await wait(1200)
  const b = await page.locator('.graph-svg .node:not([data-kind="focus"]) .plate').first().boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] })
  await wait(700)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.locator('.graph-menu button').first().waitFor({ timeout: 3000 })
  await wait(300)
  await traced(async () => {
    await tapEl(page.locator('.graph-menu button').first())
  }, 1400)
}
await browser.close()
