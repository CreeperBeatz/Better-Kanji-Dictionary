// Usage: node scripts/card-scroll-check.mjs [base=http://localhost:8000]
// Phone card stack, back: the card right under the open one comes back where
// it was left, scrolled; one further down comes back at its top. Also the
// stars on a kanji's meaning cards (the best examples), within the first words.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const wait = (ms) => p.waitForTimeout(ms)
const at = () => decodeURI(new URL(p.url()).pathname)
const scrollTop = () => p.locator('.rail-body').evaluate((el) => Math.round(el.scrollTop))
const line = (k, v) => console.log(k.padEnd(34), v)

await p.goto(`${BASE}/kanji/%E4%B8%8A`, { waitUntil: 'networkidle' })
await p.waitForSelector('.meaning')
await wait(800)
const cards = await p.locator('.kanji-page .meaning').evaluateAll((els) =>
  els.filter((e) => e.querySelector('.meaning-label')).map((e) => `${[...e.querySelectorAll('.vocab-star')].filter((s) => s.textContent).length}/${e.querySelectorAll('.meaning-words > li').length}`),
)
line('stars / words shown per card', cards.join(' '))

const row = p.locator('.kanji-page .meaning').nth(2).locator('.vocab-row').first()
await row.scrollIntoViewIfNeeded()
await wait(400)
const left = await scrollTop()
await row.click()
await wait(1500)
line('opened', `${at()} at ${await scrollTop()}`)
await p.goBack()
await wait(1500)
line('back: where it was left', `${at()} at ${await scrollTop()} (left at ${left})`)

await row.click()
await wait(1500)
await p.locator('.rail-body').evaluate((el) => (el.scrollTop = 150))
await wait(400)
const wordLeft = await scrollTop()
await p.locator('.entry-kanji-glyph:not([data-current])').first().click()
await wait(1500)
line('two deep', at())
await p.goBack()
await wait(1500)
line('back: the card under, as left', `${at()} at ${await scrollTop()} (left at ${wordLeft})`)
await p.goBack()
await wait(1500)
line('back: further down, at its top', `${at()} at ${await scrollTop()}`)
line('errors', errors.length ? errors : 'none')
await b.close()
