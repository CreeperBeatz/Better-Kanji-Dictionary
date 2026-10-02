// Usage: node scripts/forms-check.mjs [base]  -- the Forms block and borrowed meanings on a few pages.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
for (const c of ['龶', '青', '亻', '王', '売']) {
  await page.goto(`${BASE}/kanji/${encodeURIComponent(c)}`, { waitUntil: 'networkidle' })
  await wait(800)
  const head = (await page.locator('.detail-meanings').first().textContent())?.trim()
  const rows = await page.locator('.forms-row dt').allTextContents()
  console.log(c, '| head:', head, '| rows:', rows.join(' / '))
  const f = page.locator('.forms')
  if (await f.count()) await f.screenshot({ path: `${SHOTS}/forms-${c.codePointAt(0).toString(16)}.png` })
}
console.log('errors', errors)
await browser.close()
