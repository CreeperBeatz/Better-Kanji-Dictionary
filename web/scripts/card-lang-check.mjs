// Usage: node scripts/card-lang-check.mjs [base=http://localhost:8000] [shots=C:/tmp/shots]
// The language chip in a card's head turns that card's dictionary content to the
// other language and back (T on a desktop); the interface stays; folded, a tap on it
// does not take the card to its top; the next card opened is in the interface's language.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const SHOTS = process.argv[3] ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '')
const scroller = (page) =>
  page.evaluate(() => {
    for (let n = document.querySelector('.page-head'); n; n = n.parentElement) {
      const y = getComputedStyle(n).overflowY
      if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n.scrollTop
    }
    return -1
  })
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.card-lang:not([disabled])')
  await page.waitForSelector('.meaning')
  await page.waitForTimeout(500)
  const before = { head: await text(page, '.card-slot > .page-card > .page-head .detail-meanings'), card: await text(page, '.meaning header'), ui: await text(page, '.facts-title') }
  await page.locator('.card-slot > .page-card > .page-head .card-lang').click()
  await page.waitForTimeout(200)
  const after = { head: await text(page, '.card-slot > .page-card > .page-head .detail-meanings'), card: await text(page, '.meaning header'), ui: await text(page, '.facts-title') }
  console.log(name, 'kanji before', JSON.stringify(before))
  console.log(name, 'kanji after ', JSON.stringify(after), 'pressed', await page.locator('.card-slot > .page-card > .page-head .card-lang').getAttribute('aria-pressed'))
  await page.screenshot({ path: `${SHOTS}/lang-${name}-kanji-bg.png`, clip: { x: 0, y: 0, width: viewport.width, height: 700 } })
  // Folded: a tap on the chip turns it back, and leaves the card where it is.
  await page.evaluate(() => (document.querySelector('.tab-pane').style.minHeight = '3000px'))
  const b = await page.locator('.page-card').first().boundingBox()
  await page.mouse.move(b.x + b.width / 2, 600)
  if (mobile) await page.evaluate(() => {
    for (let n = document.querySelector('.page-head'); n; n = n.parentElement) {
      const y = getComputedStyle(n).overflowY
      if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) { n.scrollTop = 700; return }
    }
  })
  else for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(50) }
  await page.waitForTimeout(400)
  const at = await scroller(page)
  await page.screenshot({ path: `${SHOTS}/lang-${name}-folded-bg.png`, clip: { x: b.x, y: 0, width: b.width, height: 160 } })
  // At the point, as a finger or mouse would: the locator's click scrolls it into view first.
  const chip = await page.locator('.card-slot > .page-card > .page-head .card-lang').boundingBox()
  if (mobile) await page.touchscreen.tap(chip.x + chip.width / 2, chip.y + chip.height / 2)
  else await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2)
  await page.waitForTimeout(300)
  console.log(name, 'folded tap: scroll', at, '->', await scroller(page), '| head', await text(page, '.card-slot > .page-card > .page-head .detail-meanings'), 'pressed', await page.locator('.card-slot > .page-card > .page-head .card-lang').getAttribute('aria-pressed'))
  if (!mobile) {
    await page.keyboard.press('t')
    await page.waitForTimeout(150)
    console.log(name, 'T ->', await text(page, '.card-slot > .page-card > .page-head .detail-meanings'))
    await page.keyboard.press('t')
    await page.waitForTimeout(150)
    console.log(name, 'T ->', await text(page, '.card-slot > .page-card > .page-head .detail-meanings'))
  }
  if (mobile) {
    // Dictionary held down turns the card; from Components it goes to the
    // card too; a short tap does not turn it.
    const cdp = await ctx.newCDPSession(page)
    const tab = page.locator('.phone-tabs button').filter({ hasText: /Dictionary/ })
    const hold = async (ms) => {
      const bb = await tab.boundingBox()
      const pt = [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
      await page.waitForTimeout(ms)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(400)
    }
    const pressed = () => page.locator('.card-slot > .page-card > .page-head .card-lang').getAttribute('aria-pressed')
    await hold(80)
    console.log(name, 'dictionary tap   -> pressed', await pressed())
    await hold(650)
    console.log(name, 'dictionary held  -> pressed', await pressed(), '| head', await text(page, '.card-slot > .page-card > .page-head .detail-meanings'))
    await page.locator('.phone-tabs button').filter({ hasText: /Components|Graph|Parts/ }).first().click()
    await page.waitForTimeout(500)
    const selected = () => page.locator('.phone-tabs button[aria-selected="true"]').innerText()
    console.log(name, 'on tab', JSON.stringify(await selected()))
    await hold(650)
    console.log(name, 'held from there  -> tab', JSON.stringify(await selected()), 'pressed', await pressed())
    await cdp.detach()
  }
  // A word, flipped; then a kanji opened from it is in the interface's language.
  await page.goto(`${BASE}/word/1588410`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.card-lang:not([disabled])')
  await page.waitForTimeout(400)
  const w0 = await text(page, '.card-slot > .page-card > .page-head .detail-meanings')
  await page.locator('.card-slot > .page-card > .page-head .card-lang').click()
  await page.waitForTimeout(200)
  console.log(name, 'word', JSON.stringify(w0), '->', JSON.stringify(await text(page, '.card-slot > .page-card > .page-head .detail-meanings')), '| machine note', await page.locator('.entry-machine').count())
  await page.screenshot({ path: `${SHOTS}/lang-${name}-word-bg.png`, clip: { x: 0, y: 0, width: viewport.width, height: 700 } })
  await page.locator('.page-head .entry-char').first().click()
  await page.waitForURL(/\/kanji\//)
  await page.waitForTimeout(900)
  console.log(name, 'next card', JSON.stringify(await text(page, '.card-slot > .page-card > .page-head .detail-meanings')), 'pressed', await page.locator('.card-slot > .page-card > .page-head .card-lang').getAttribute('aria-pressed'))
  await ctx.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
