// Usage: BASE=http://localhost:8799 node scripts/sense-order-check.mjs -- senses numbered in our order
// (main, secondary, rare) on the word page, the search rows and a kanji's word rows, phone and desktop.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:8000'
const browser = await chromium.launch()
const errors = []
const fails = []
const expect = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(ok ? 'ok  ' : 'FAIL', what, JSON.stringify(got))
  if (!ok) fails.push(what)
}
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 900 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // 信: JMdict's sense 2 "trust" is its main one, so it leads as 1.
  await page.goto(`${BASE}/word/1580550`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.entry-senses .meaning-n', { timeout: 15000 })
  const ns = await page.locator('.entry-senses .meaning-n').allInnerTexts()
  expect(`${name} 信 word page numbers`, ns, ns.map((_, i) => String(i + 1)))
  expect(`${name} 信 word page lead`, (await page.locator('.entry-senses .sense-lead').first().innerText()).trim(), 'trust')

  // The search row for 信 leads with the same sense, numbered 1.
  await page.goto(`${BASE}/search?q=${encodeURIComponent('信')}`, { waitUntil: 'networkidle' })
  const row = page.locator('.word-gloss').filter({ hasText: 'trust; reliance' }).first()
  await row.waitFor({ timeout: 15000 })
  const first = await row.locator('.sense').first().innerText()
  expect(`${name} 信 search row lead`, first.replace(/\s+/g, ' ').slice(0, 6), '1trust')

  // 生き under 生: the sense that has the meaning is JMdict's first, now its 2nd.
  await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.vocab-row', { timeout: 15000 }).catch(() => {})
  const iki = page.locator('.vocab-row').filter({ has: page.locator('.vocab-word', { hasText: /^生き$/ }) })
  if (await iki.count()) {
    expect(`${name} 生き row number`, await iki.first().locator('.vocab-sense-n').innerText(), '2')
  } else console.log('note', name, '生き not shown as a row (folded card)')
  await page.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
