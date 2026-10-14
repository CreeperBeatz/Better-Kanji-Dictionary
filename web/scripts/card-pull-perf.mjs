// Usage: node scripts/card-pull-perf.mjs [base=http://localhost:8000] [cpu throttle=4]
// Frames during a pull-to-go-back on the phone card stack, by phase: the
// first moves (the page under is laid behind the card), the rest of the drag,
// the fall after letting go, and the swap to the page itself.
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:8000'
const RATE = Number(process.argv[3] ?? 4)
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en' })
await ctx.addInitScript(() => localStorage.setItem('betterrtk:installGuideSeen', '1'))
const page = await ctx.newPage()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const cdp = await ctx.newCDPSession(page)
const touch = (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })

await page.goto(BASE + '/kanji/%E6%98%8E', { waitUntil: 'networkidle' })
await wait(800)
const card = '.rail-body:not([data-ghost]) .page-card:not([data-copy])'
for (let round = 0; round < 3; round++) {
  // A word from the page, scrolled part way, as reading does.
  const row = page.locator(`${card} .vocab-row`).nth(3)
  await row.scrollIntoViewIfNeeded()
  await wait(300)
  await row.click()
  await wait(1200)
  await page.locator('.rail-body:not([data-ghost])').evaluate((e) => (e.scrollTop = 0))
  await wait(300)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
  await page.evaluate(() => {
    window.__loaf = []
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        window.__loaf.push({
          start: e.startTime,
          dur: e.duration,
          render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
          style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
          scripts: e.scripts.map((sc) => `${sc.invoker} ${sc.duration.toFixed(0)}ms`).join(', '),
        })
    }).observe({ type: 'long-animation-frame', buffered: false })
    window.__marks = []
    window.__frames = []
    const loop = (t) => {
      window.__frames.push(t)
      if (window.__frames.length < 600) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  const mark = (name) => page.evaluate((n) => window.__marks.push([n, performance.now()]), name)
  await touch('touchStart', 200, 300)
  await mark('start')
  for (let i = 1; i <= 24; i++) {
    await touch('touchMove', 200, 300 + i * 12)
    if (i === 4) await mark('drag')
    await wait(16)
  }
  await mark('release')
  await touch('touchEnd')
  await page.waitForFunction(() => !document.querySelector('.page-card[data-moving]'), null, { timeout: 5000 })
  await mark('swapped')
  await wait(400)
  await mark('end')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const { marks, frames } = await page.evaluate(() => ({ marks: window.__marks, frames: window.__frames }))
  const at = Object.fromEntries(marks)
  const phases = [
    ['first moves', at.start, at.drag],
    ['drag', at.drag, at.release],
    ['fall', at.release, at.swapped],
    ['after swap', at.swapped, at.end],
  ]
  const line = phases.map(([name, a, b]) => {
    const gaps = frames.slice(1).map((t, i) => [frames[i], t - frames[i]]).filter(([t]) => t >= a && t < b).map(([, g]) => g)
    const worst = gaps.length ? Math.max(...gaps) : 0
    const dropped = gaps.filter((g) => g > 25).length
    return `${name}: worst ${worst.toFixed(0)}ms, ${dropped}/${gaps.length} slow`
  })
  console.log(`round ${round + 1} | ${line.join(' | ')} | where ${decodeURIComponent(new URL(page.url()).pathname)}`)
  const loaf = await page.evaluate(() => window.__loaf)
  for (const l of loaf) if (l.start > at.release - 20 && l.start < at.release + 200)
    console.log(`  long frame +${(l.start - at.release).toFixed(0)}ms ${l.dur.toFixed(0)}ms (style+layout ${l.style.toFixed(0)}) ${l.scripts}`)
  // Where the slow frames fall, from letting go.
  const slow = frames.slice(1).map((t, i) => [t, t - frames[i]]).filter(([, g]) => g > 25)
  console.log('  slow frames (ms after release, length):', slow.map(([t, g]) => `${(t - at.release).toFixed(0)}:${g.toFixed(0)}`).join(' '), '| swapped at', (at.swapped - at.release).toFixed(0))
}
await browser.close()
