// Usage: node scripts/mixup-self-look.mjs [base]  -- "easy to mix up": the page's own kanji/word first, framed.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
for (const path of ['/kanji/揚', '/kanji/挙', '/kanji/計']) {
  await page.goto(`${BASE}${encodeURI(path)}`, { waitUntil: 'networkidle' })
  await wait(800)
  const blocks = page.locator('.mixup')
  const n = await blocks.count()
  for (let i = 0; i < n; i++) {
    const b = blocks.nth(i)
    const first = await b.locator('.usage-spellings > li').first().getAttribute('data-self')
    const spellings = (await b.locator('.usage-spelling').allTextContents()).join(' ')
    console.log(path, i, 'self first:', first !== null, spellings)
    if (i === 0) {
      await b.scrollIntoViewIfNeeded()
      await b.screenshot({ path: `${SHOTS}/mixup-${path.codePointAt(path.length - 1).toString(16)}.png` })
    }
  }
}
console.log('errors', errors)
await browser.close()
