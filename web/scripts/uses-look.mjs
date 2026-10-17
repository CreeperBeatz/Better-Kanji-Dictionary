// Usage: node scripts/meaning-cards-look.mjs [chars] [tag] -- full-length shots of each kanji's
// meanings unit, phone and desktop, against ${process.env.BASE ?? "http://localhost:8000"}, into C:/tmp/shots.
import { chromium } from 'playwright'
const [chars = '上生', tag = 'now'] = process.argv.slice(2)
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 7000 }, true], ['desk', { width: 1400, height: 7000 }, false]]) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const c of chars) {
    await page.goto(`${process.env.BASE ?? "http://localhost:8000"}/kanji/${encodeURIComponent(c)}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.meanings .meaning', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(800)
    const box = page.locator('.meanings').first()
    if (!(await box.count())) { console.log(c, name, 'no .meanings'); continue }
    await box.screenshot({ path: `${SHOTS}/${tag}-${name}-${c}.png` })
    console.log(c, name, 'cards', await page.locator('.meaning').count(), 'words', await page.locator('.meaning .meaning-words > *').count())
  }
  await page.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
