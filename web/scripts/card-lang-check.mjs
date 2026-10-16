// Usage: node scripts/card-lang-check.mjs [base=http://localhost:8000] [shots=C:/tmp/shots]
// One language for the app: on a phone, Dictionary held down opens a menu whose one item
// turns the app, interface
// and dictionary, to the other language -- the same setting as the profile's switch,
// remembered; T does it on a desktop.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const SHOTS = process.argv[3] ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const HEAD = '.card-slot > .page-card > .page-head .detail-meanings'
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '')
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.meaning')
  await page.waitForTimeout(500)
  const state = async () => JSON.stringify({ head: await text(page, HEAD), ui: await text(page, '.facts-title') })
  console.log(name, 'start           ', await state(), '| label in head', await page.locator('.card-lang').count())
  if (mobile) {
    const cdp = await ctx.newCDPSession(page)
    const tab = page.locator('.phone-tabs > button').nth(1)
    const hold = async (ms) => {
      const bb = await tab.boundingBox()
      const pt = [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
      await page.waitForTimeout(ms)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(400)
    }
    const tapAt = async (loc) => {
      const bb = await loc.boundingBox()
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2)
      await page.waitForTimeout(400)
    }
    const menu = () => page.locator('.tab-menu').count()
    await hold(80)
    console.log(name, 'tap             -> menu', await menu())
    // The switch over the tab, tap and hold both ways: scripts/tab-hold-check.mjs.
    await hold(650)
    console.log(name, 'held            -> menu', await menu(), JSON.stringify(await text(page, '.tab-menu')))
    await page.screenshot({ path: `${SHOTS}/dict-${name}-tab-menu.png`, clip: { x: 0, y: viewport.height - 160, width: viewport.width, height: 160 } })
    await tapAt(page.locator('.tab-menu-item'))
    await page.waitForTimeout(200)
    console.log(name, 'picked          -> menu', await menu(), await state())
    await tapAt(page.locator('.phone-tabs > button').nth(0))
    console.log(name, 'search tab      ', JSON.stringify((await text(page, '.vocab-gloss, .word-gloss, .recent-gloss, .kanji-hit')).slice(0, 60)))
    await page.goto(`${BASE}/word/1588410`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    console.log(name, 'reload, a word  ', JSON.stringify(await text(page, HEAD)))
    await hold(650)
    console.log(name, 'held again      -> ', JSON.stringify(await text(page, '.tab-menu')))
    await tapAt(page.locator('.tab-menu-item'))
    await page.waitForTimeout(200)
    console.log(name, 'picked          -> ', JSON.stringify(await text(page, HEAD)))
    await cdp.detach()
  } else {
    await page.keyboard.press('t')
    await page.waitForTimeout(200)
    console.log(name, 'T               ', await state())
    await page.goto(`${BASE}/word/1588410`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    console.log(name, 'reload, a word  ', JSON.stringify(await text(page, HEAD)))
    // The profile's switch is the same setting: from Bulgarian, one tap is English again.
    await page.locator('.profile-button').first().click()
    await page.locator('.lang-switch').first().click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    console.log(name, 'profile switch  ', JSON.stringify(await text(page, HEAD)), JSON.stringify(await text(page, '.entry-rank-line')))
  }
  await ctx.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
