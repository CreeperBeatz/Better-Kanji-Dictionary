// Usage: node scripts/font-strip-check.mjs [base]  -- the font strip on a few kanji pages.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
for (const c of ['葛', '心', '亻']) {
  await page.goto(`${BASE}/kanji/${encodeURIComponent(c)}`, { waitUntil: 'networkidle' })
  await page.locator('.font-strip').scrollIntoViewIfNeeded()
  await wait(2500)
  const cells = await page.locator('.font-strip li').count()
  console.log(c, 'cells', cells, 'labels', (await page.locator('.font-strip-label').allTextContents()).join(' | '))
  await page.locator('.font-strip').screenshot({ path: `${SHOTS}/fonts-${c.codePointAt(0).toString(16)}.png` }).catch((e) => console.log('no shot', String(e).slice(0, 80)))
}
console.log('errors', errors)
await browser.close()
