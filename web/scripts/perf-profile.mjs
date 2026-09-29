// Usage: node scripts/perf-profile.mjs [base] [load|type|open|tab|components|map] [cpuThrottle]
// CPU-profile one interaction on the phone layout and print the hottest functions by self time.
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const STEP = process.argv[3] ?? 'type'
const RATE = Number(process.argv[4] ?? 4)
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en' })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function touch(type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
}
async function tapEl(loc) {
  const b = await loc.boundingBox()
  await touch('touchStart', b.x + b.width / 2, b.y + b.height / 2)
  await wait(50)
  await touch('touchEnd')
}

async function profile(fn, settle = 1200) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
  await fn()
  await wait(settle)
  const { profile } = await cdp.send('Profiler.stop')
  // Self time per node = sample count * interval. Attribute to function + url:line.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  const dt = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i])
    const f = n.callFrame
    const url = f.url.replace(BASE, '').replace(/\?.*$/, '')
    const key = `${f.functionName || '(anon)'}  ${url}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000)
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28)
  console.log(`total sampled ${Math.round(total)} ms`)
  for (const [k, v] of top) console.log(String(Math.round(v)).padStart(6), 'ms ', k)
  // Also: by file.
  const byFile = new Map()
  for (const [k, v] of self) {
    const file = k.split('  ')[1].replace(/:\d+$/, '')
    byFile.set(file, (byFile.get(file) ?? 0) + v)
  }
  console.log('--- by file')
  for (const [k, v] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String(Math.round(v)).padStart(6), 'ms ', k)
}

if (STEP === 'load') {
  await profile(async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  }, 500)
} else {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await wait(500)
}
if (STEP === 'type') {
  await profile(async () => {
    await page.locator('.search-input').tap()
    await page.keyboard.type('water', { delay: 150 })
  })
}
if (STEP === 'open' || STEP === 'tab') {
  await page.locator('.search-input').tap()
  await page.keyboard.type('water', { delay: 60 })
  await wait(1500)
  await page.locator('.search-input').evaluate((el) => el.blur())
  if (STEP === 'open') {
    await profile(async () => {
      await tapEl(page.locator('.kanji-hit').first())
    })
  } else {
    await tapEl(page.locator('.kanji-hit').first())
    await wait(1500)
    await profile(async () => {
      await tapEl(page.locator('.phone-tabs button', { hasText: 'Associations' }))
    }, 800)
  }
}
if (STEP === 'components') {
  await page.goto(BASE + '/kanji/%E6%B0%B8', { waitUntil: 'networkidle' })
  await wait(1000)
  await tapEl(page.locator('.phone-tabs button', { hasText: 'Associations' }))
  await wait(1200)
  await profile(async () => {
    await tapEl(page.locator('.phone-tabs button', { hasText: 'Components' }))
  }, 800)
}
if (STEP === 'map') {
  await profile(async () => {
    const m = page.locator('button', { hasText: /map/i }).first()
    await tapEl(m)
  }, 2500)
}
await browser.close()
