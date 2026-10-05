// Usage: node scripts/words-with-check.mjs [base]  (against tests/sandbox.py after tests/seed_review.py)
// The kanji page's short list and its "see all" button; *生* in the search bar,
// first as one list, then divided by meaning once the admin accepts the groups.
import { chromium } from 'playwright'
import { call, logIn } from './session.mjs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))

await logIn(page, BASE, 'admin@example.com')
const api = (path, body) => call(page, path, body)

await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
await wait(800)
console.log('page words:', await page.locator('.vocab li').count())
await page.locator('.vocab-all').click()
await wait(1500)
console.log('search box holds:', await page.locator('.search-input').first().inputValue())
console.log('flat list rows:', await page.locator('.words-with .word').count(), '| note:', (await page.locator('.words-with-head .hint').textContent())?.trim())
await page.screenshot({ path: `${SHOTS}/words-1-flat.png` })

// The admin accepts the drafted groups, then the drafted word meanings.
const q = await api('/api/review/queue?type=kanji_senses')
const senses = q.items.find((i) => i.subject === '生')
if (senses) await api(`/api/review/items/${senses.id}/decide`, { action: 'accept' })
const words = await api('/api/review/queue?type=word_sense')
for (const w of words.items.filter((i) => i.subject.startsWith('生|'))) await api(`/api/review/items/${w.id}/decide`, { action: 'accept' })
console.log('accepted word meanings:', words.items.length)

await page.reload({ waitUntil: 'networkidle' })
await wait(1500)
console.log('groups:', (await page.locator('.meaning-group h3').allTextContents()).map((s) => s.trim()).join(' / '))
await page.screenshot({ path: `${SHOTS}/words-2-grouped.png`, fullPage: false })
console.log('errors', errors)
await browser.close()
