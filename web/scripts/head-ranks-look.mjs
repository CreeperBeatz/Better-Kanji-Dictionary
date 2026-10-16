// Usage: node scripts/head-ranks-look.mjs [tag] -- the head of a kanji's and a word's page,
// open and folded, phone and desktop, against http://localhost:8000, into C:/tmp/shots.
import { chromium } from 'playwright'
const [tag = 'now'] = process.argv.slice(2)
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const pages = [['kanji', '/kanji/' + encodeURIComponent('生')], ['rare', '/kanji/' + encodeURIComponent('丼')], ['word', '/word/1588410'], ['long', '/word/1443420']]
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const shoot = async (label) => {
    await page.waitForSelector('.page-head .head-meta', { timeout: 15000 })
    await page.waitForTimeout(900)
    const card = page.locator('.page-card').first()
    const b = await card.boundingBox()
    await page.screenshot({ path: `${SHOTS}/${tag}-${name}-${label}-open.png`, clip: { x: b.x, y: 0, width: b.width, height: 260 } })
    await page.evaluate(() => {
      const head = document.querySelector('.page-head')
      // A short page (a word's) could not scroll far enough to fold whole.
      document.querySelector('.tab-pane').style.minHeight = '3000px'
      for (let n = head; n; n = n.parentElement) {
        const y = getComputedStyle(n).overflowY
        if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) { n.scrollTop = 600; break }
      }
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/${tag}-${name}-${label}-folded.png`, clip: { x: b.x, y: 0, width: b.width, height: 160 } })
    console.log(name, label, await page.locator('.page-head .head-meta').first().innerText())
  }
  for (const [label, path] of pages) {
    await page.goto('http://localhost:8000' + path, { waitUntil: 'networkidle' })
    await shoot(label)
  }
  await page.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
