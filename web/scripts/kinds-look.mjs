// Usage: node scripts/kinds-look.mjs [ids] [tag] -- shots of word pages with the new kinds
// (& Pairs, 敬 Polite forms, Easy to mix up by meaning, short / older forms in the spellings
// row), phone and desktop, against BASE (http://localhost:8000), into C:/tmp/shots.
import { chromium } from 'playwright'
const [ids = '1396840,1587040,1050720,1242420,1352130', tag = 'kinds'] = process.argv.slice(2)
const BASE = process.env.BASE ?? 'http://localhost:8000'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 2400 }, true], ['desk', { width: 1400, height: 1600 }, false]]) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const id of ids.split(',')) {
    await page.goto(`${BASE}/word/${id}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.sense-card, .meaning', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${SHOTS}/${tag}-${name}-${id}.png`, fullPage: true })
    const blocks = await page.locator('.aside-title').allInnerTexts()
    const forms = await page.locator('.entry-form-word').allInnerTexts()
    console.log(id, name, 'blocks', blocks.join(' | '), 'forms', forms.join(' '))
  }
  await page.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
