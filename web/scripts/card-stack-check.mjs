// Usage: node scripts/card-stack-check.mjs [base=http://localhost:8000] [shots dir]
// Phone card stack: the edges of the pages under the open one, pull down = back,
// pull down on the last card = the search, a tap on an edge goes back to it.
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
const near = () => page.locator('.stack-near').textContent().catch(() => null)
const edges = () => page.locator('.card-stack > button').count()

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
await wait(900)
out('word opened', await where())
out('edges / near', `${await edges()} / ${await near()}`)
await shot('2-depth2')
await tapEl(page.locator('.page-card .entry-char', { hasNotText: '明' }).first())
await wait(900)
out('kanji in word opened', await where())
out('edges / near', `${await edges()} / ${await near()}`)
await shot('3-depth3')

await page.locator('.rail-body').evaluate((e) => (e.scrollTop = 0))
await wait(200)
// Pulled part way and held: the card follows, the one under it lights up.
await touch('touchStart', 200, 330)
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', 200, 330 + i * 15)
  await wait(16)
}
await wait(100)
out('card follows finger', await page.locator('.page-card').evaluate((e) => e.style.transform))
out('armed', await page.locator('.card-stack').getAttribute('data-armed'))
await shot('4-pulling')
await touch('touchEnd')
await wait(900)
out('pull down -> back', await where())
out('card transform cleared', JSON.stringify(await page.locator('.page-card').evaluate((e) => e.style.transform)))
out('edges / near', `${await edges()} / ${await near()}`)

// A short pull comes back without going anywhere.
const before = await where()
await swipe(200, 330, 200, 370)
await wait(600)
out('short pull stays', (await where()) === before)

await page.locator('.rail-body').evaluate((e) => (e.scrollTop = 0))
await tapEl(page.locator('.stack-near'))
await wait(900)
out('tap near -> back', await where())
await page.locator('.rail-body').evaluate((e) => (e.scrollTop = 0))
await wait(200)
await swipe(200, 330, 200, 520)
await wait(900)
out('pull from depth 1 -> search', await where())
out('input focused', await page.evaluate(() => document.activeElement?.tagName))

// A page opened from a link has only a new search under it.
await page.goto(BASE + '/kanji/%E6%97%A5', { waitUntil: 'networkidle' })
await wait(800)
out('link: edges / near', `${await edges()} / ${await near()}`)
await shot('5-link')
await swipe(200, 330, 200, 520)
await wait(700)
out('link pull -> stays, search up', `${await where()} / ${await page.evaluate(() => document.activeElement?.tagName)}`)
out('link card back in place', JSON.stringify(await page.locator('.page-card').evaluate((e) => e.style.transform)))

out('errors', errors.length ? errors.join('\n') : 'none')
await browser.close()
