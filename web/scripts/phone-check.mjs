// Usage: node scripts/phone-check.mjs [base=http://localhost:8000]
// Phone behaviour regression check: lock, pan, card, recentre, slides, back-focus, markdown notes.
// The phone graph has only the lock and the recentre button; associations are a card from the page.
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:8000'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en' })
// The install guide would cover the page in a browser tab.
await ctx.addInitScript(() => localStorage.setItem('betterrtk:installGuideSeen', '1'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const cdp = await ctx.newCDPSession(page)
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
async function swipe(x0, y0, x1, y1, steps = 12) {
  await touch('touchStart', x0, y0)
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
    await wait(16)
  }
  // The finger rests before lifting: a lift while moving is a fling, and the
  // emulator spends the next tap on stopping it.
  await touch('touchMove', x1, y1)
  await wait(200)
  await touch('touchEnd')
}
const tf = () => page.locator('.graph-svg > g').first().getAttribute('transform')
const out = (k, v) => console.log(k.padEnd(34), v)

await page.goto(BASE + '/kanji/%E6%B0%B8', { waitUntil: 'networkidle' })
await wait(800)
await page.locator('.phone-tabs button', { hasText: 'Components' }).click()
await wait(700)
out('locked by default', await page.locator('.graph-lock').getAttribute('aria-pressed'))
out('graph buttons locked', await page.locator('.map-zoom button').count())
const t0 = await tf()
await swipe(120, 500, 330, 500)
await wait(700)
out('locked swipe -> tab', await page.locator('.phone-tabs button[aria-selected="true"]').textContent())
await page.locator('.phone-tabs button', { hasText: 'Components' }).click()
await wait(700)
await tapEl(page.locator('.graph-lock'))
await wait(300)
out('graph buttons unlocked', await page.locator('.map-zoom button').count())
const t1 = await tf()
await swipe(120, 500, 330, 560)
await wait(300)
const t2 = await tf()
out('unlocked drag moved graph', t1 !== t2)
await wait(300)
out('transform kept after settle', (await tf()) === t2)
// tap a component node -> card -> see in dictionary recentres
const comp = page.locator('.graph-svg .node:not([data-kind="focus"])').first()
await tapEl(comp)
await wait(400)
out('card open', await page.locator('.hold-card').count())
await tapEl(page.locator('.hold-card .see-components').first())
await wait(900)
out('page glyph', (await page.locator('.page-card:not([data-copy]) .page-head .detail-glyph').first().textContent())?.trim())
await page.locator('.phone-tabs button', { hasText: 'Components' }).click()
await wait(700)
out('graph centre', (await page.locator('.graph-svg .node[data-kind="focus"] text').first().textContent())?.trim())
out('relocked on return', await page.locator('.graph-lock').getAttribute('aria-pressed'))
// associations, a card from the page, render markdown
// A tap at the spot: an unseen switch over Dictionary takes its touches (App.tsx holdSwitch).
{
  const bb = await page.locator('.phone-tabs button', { hasText: 'Dictionary' }).boundingBox()
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2)
}
await wait(900)
await page.locator('.page-card:not([data-copy]) .notes-chip').first().click()
await wait(1200)
out('notes rendered (.md p)', await page.locator('.md p').count())
// back to search focuses input
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.fill('.search-input', 'water')
await wait(1000)
out('word rows', await page.locator('.word').count())
await page.locator('.search-input').evaluate((el) => el.blur())
await tapEl(page.locator('.kanji-hit').first())
await wait(900)
out('opened', page.url().split('/').pop())
await page.goBack()
await wait(800)
out('back focused input (app only; tab: false)', await page.evaluate(() => document.activeElement?.classList.contains('search-input')))
out('ghosts left', await page.locator('[data-ghost]').count())
out('errors', JSON.stringify(errors))
await browser.close()
