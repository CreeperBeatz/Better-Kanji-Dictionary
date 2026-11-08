// Usage: node scripts/search-typos-check.mjs [base]  -- unfinished and misspelled searches, desktop and phone.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const QUERIES = [
  ['en', 'hous'], ['en', 'beutiful'], ['en', 'recieve'], ['en', 'tabem'], ['en', 'house'],
  ['bg', 'ябалка'], ['bg', 'сло'], ['bg', 'учелище'],
]
const browser = await chromium.launch()
const errors = []
for (const [name, viewport] of [['desktop', { width: 1300, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, isMobile: name === 'phone', hasTouch: name === 'phone' })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const [lang, q] of QUERIES) {
    await page.addInitScript((l) => localStorage.setItem('betterrtk:lang', l), lang)
    await page.goto(`${BASE}/search?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.words li, .kanji-hits, .hint', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(600)
    const note = (await page.locator('.reading-note').allTextContents()).join(' / ')
    const first = (await page.locator('.words li').first().textContent().catch(() => '')) ?? ''
    console.log(name, lang, q, '|', note, '|', first.replace(/\s+/g, ' ').slice(0, 50))
    if (name === 'desktop' || q === 'beutiful')
      await page.screenshot({ path: `${SHOTS}/typos-${name}-${encodeURIComponent(q).replaceAll('%', '')}.png` })
  }
  await context.close()
}
console.log('errors', errors)
await browser.close()
