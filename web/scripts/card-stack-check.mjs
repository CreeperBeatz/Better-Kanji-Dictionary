// Usage: node scripts/card-stack-check.mjs [base=http://localhost:8000] [shots dir]
// Phone card stack: copies of the cards under the open one lie behind it, their
// tops showing (none on the first card, over the search); pull down = back, the
// card under it coming forward into the open card's place; a tap on a rim goes
// back to that card; pull down on the first card = the keyboard.
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:8000'
const SHOTS = process.argv[3]
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
  await loc.scrollIntoViewIfNeeded()
  await wait(300)
  const b = await loc.boundingBox()
  await tapAt(b.x + b.width / 2, b.y + b.height / 2)
}
async function swipe(x0, y0, x1, y1, steps = 12, rest = 200) {
  await touch('touchStart', x0, y0)
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
    await wait(16)
  }
  await touch('touchMove', x1, y1)
  await wait(rest)
  await touch('touchEnd')
}
const out = (k, v) => console.log(k.padEnd(34), v)
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` })
const where = () => page.evaluate(() => decodeURIComponent(location.pathname + location.search))
const rim = () => page.locator('.rail-body:not([data-ghost]) .stack-rim').last()
const near = () => rim().getAttribute('aria-label').catch(() => null)
// The open card, not the copies of the ones under it.
const card = () => page.locator('.rail-body:not([data-ghost]) .page-card:not([data-copy])')
const nearest = () => page.locator('.stack-copies > .page-card').last()
const layers = () => page.locator('.phone-tabs .tab-layer').count()
const barShown = () => page.locator('.rail-body:not([data-ghost]) .page-head[data-collapsed]').count()
const edges = () => page.locator('.rail-body:not([data-ghost]) .stack-rim').count()
const copies = () => page.locator('.stack-copies > .page-card').count()

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await wait(600)
await page.locator('.searchbar input').fill('明')
await wait(900)
await tapEl(page.locator('.kanji-hit').first())
await wait(900)
out('opened from search', await where())
out('edges / near', `${await edges()} / ${await near()}`)
await shot('1-depth1')

// A word from the kanji's page, then a kanji in that word.
// A word with another kanji in it, to go on to that one.
const two = await page
  .locator('.page-card .vocab-word')
  .evaluateAll((ws) => ws.findIndex((w) => (w.textContent.match(/[一-鿿]/g) ?? []).length >= 2))
await tapEl(page.locator('.page-card .vocab-row').nth(two))
await wait(160)
await shot('2a-rising')
await wait(800)
out('word opened', await where())
out('edges / near / tab layers', `${await edges()} / ${await near()} / ${await layers()}`)
await shot('2-depth2')
await tapEl(page.locator('.page-card .entry-char', { hasNotText: '明' }).first())
await wait(900)
out('kanji in word opened', await where())
out('edges / near / tab layers', `${await edges()} / ${await near()} / ${await layers()}`)
out('new card: bar hidden at top', await barShown())
await page.locator('.rail-body:not([data-ghost])').evaluate((e) => (e.scrollTop = 700))
await wait(400)
out('scrolled: bar shown', await barShown())
await shot('3b-scrolled-bar')
await shot('3-depth3')

await page.locator('.rail-body:not([data-ghost])').evaluate((e) => (e.scrollTop = 0))
await wait(200)
out('copies under / rims', `${await copies()} / ${await edges()}`)
const restBefore = await nearest().evaluate((e) => e.style.transform)
// Pulled part way and held: the card follows, the one under it comes forward.
await touch('touchStart', 200, 330)
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', 200, 330 + i * 15)
  await wait(16)
}
await wait(100)
const restAt = restBefore
out('card follows finger', await card().evaluate((e) => e.style.transform))
out('card under comes forward', `${restAt} -> ${await nearest().evaluate((e) => e.style.transform)}`)
out('nothing fades', await page.locator('.stack-copies > .page-card').evaluateAll((es) => es.every((e) => getComputedStyle(e).opacity === '1')))
await shot('4-pulling')
await touch('touchEnd')
await wait(90)
await shot('4b-dropping')
await wait(900)
out('copies left / page quiet', `${await copies()} / ${await card().getAttribute('data-quiet')}`)
out('pull down -> back', await where())
out('card transform cleared', JSON.stringify(await card().evaluate((e) => e.style.transform)))
out('edges / near', `${await edges()} / ${await near()}`)

// A short pull comes back without going anywhere.
const before = await where()
await swipe(200, 330, 200, 370)
await wait(600)
out('short pull stays', (await where()) === before)

await page.locator('.rail-body:not([data-ghost])').evaluate((e) => (e.scrollTop = 0))
await tapEl(rim())
await wait(120)
await shot('5a-tap-back')
await wait(800)
out('first card: edges / tab layers', `${await edges()} / ${await layers()}`)
out('back lands at the top', await page.locator('.rail-body:not([data-ghost])').evaluate((e) => e.scrollTop))
await shot('5b-returned')
await page.locator('.rail-body:not([data-ghost])').evaluate((e) => (e.scrollTop = 700))
await wait(400)
out('scrolled: search gone, head folded', `${await page.locator('.searchbar').evaluate((b) => b.style.transform)} / ${await barShown()}`)
await tapEl(page.locator('.rail-body:not([data-ghost]) .page-head'))
await wait(900)
out('bar tap -> top', await page.locator('.rail-body:not([data-ghost])').evaluate((e) => e.scrollTop))
out('tap near -> back', await where())
await page.locator('.rail-body:not([data-ghost])').evaluate((e) => (e.scrollTop = 0))
await wait(200)
await touch('touchStart', 200, 330)
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', 200, 330 + i * 18)
  await wait(16)
}
await wait(100)
out('first card gives, no stack', await copies())
await shot('6-pull-first-card')
await touch('touchEnd')
await wait(900)
out('first card pull -> keyboard', `${await where()} / ${await page.evaluate(() => document.activeElement?.tagName)}`)

// A page opened from a link has only a new search under it.
await page.goto(BASE + '/kanji/%E6%97%A5', { waitUntil: 'networkidle' })
await wait(800)
out('link: edges / near', `${await edges()} / ${await near()}`)
await shot('7-link')
await swipe(200, 330, 200, 520)
await wait(700)
out('link pull -> stays, search up', `${await where()} / ${await page.evaluate(() => document.activeElement?.tagName)}`)
out('link card back in place', JSON.stringify(await card().evaluate((e) => e.style.transform)))

out('errors', errors.length ? errors.join('\n') : 'none')
await browser.close()
