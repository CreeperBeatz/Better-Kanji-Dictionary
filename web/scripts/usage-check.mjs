// Usage: node scripts/usage-check.mjs -- "which kanji" and where its parts went (Dani, 2026-10-08), on the dev
// frontend (npm run dev, VITE_API=http://127.0.0.1:8010) against tests/sandbox.py on 8010 holding a copy of the queue
// with the usage cards' Bulgarian loaded (python -m server.review load-bg). It ACCEPTS the あう usage card in the
// sandbox, to open its Bulgarian card: never point it at the real queue.
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
const API = process.env.API ?? 'http://127.0.0.1:8010'
const WEB = process.env.WEB ?? 'http://localhost:5173'
const EMAIL = process.env.EMAIL ?? 'dani.matev123@gmail.com'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const SANDBOX = process.env.SANDBOX ?? `${process.env.USERPROFILE}/bkd-steps-sandbox`
if (!SANDBOX.includes('sandbox')) throw new Error('a sandbox only: this script decides a card')
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const res = await fetch(`${API}/api/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WEB }, body: JSON.stringify({ email: EMAIL }) }).then((r) => r.json())
await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, WEB), { waitUntil: 'networkidle' })
const db = new DatabaseSync(`${SANDBOX}/review/review.db`, { readOnly: true })
const idOf = (type, subject) => db.prepare('SELECT id FROM item WHERE type = ? AND subject = ? ORDER BY seq DESC').get(type, subject)?.id

let failed = 0
const check = (name, ok, got = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got})`}`)
  if (!ok) failed++
}

// 1. The meanings card: 会's pairs with 合 and 遭 (あう) are Bunkacho's, explained, not asked.
await page.goto(`${WEB}/review/queue/meanings/${idOf('kanji_senses', '会')}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.review-step[data-n="3"]')
const step3 = page.locator('.review-step[data-n="3"]')
const row = (c) => step3.locator('.step-row', { has: page.locator('.step-char', { hasText: c }) }).first()
for (const c of ['合', '遭']) {
  check(`会 · ${c}: explained by the あう usage card, no choice`, (await row(c).locator('.step-explained').count()) === 1 && (await row(c).locator('.step-picks').count()) === 0)
}
check('the link opens that usage card', (await row('合').locator('.step-explained a').getAttribute('href')) === `/review/queue/usage/${idOf('usage', 'あう')}`)
check('会 · 遇: Kodansha only, still asked', (await row('遇').locator('.step-picks button').count()) === 2)
await step3.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${SHOTS}/usage-step3.png` })

// 2. The usage card: English only; the reading is text, ✎ corrects it.
await page.goto(`${WEB}/review/queue/usage/${idOf('usage', 'あう')}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.usage-card')
check('no Bulgarian on the usage card', (await page.locator('.usage-card [lang="bg"]').count()) === 0)
check('no "Your answer", no source line', !(await page.locator('.queue-item').textContent()).includes('Your answer') && (await page.locator('.queue-head .queue-meta').count()) === 0)
check('the reading is text', (await page.locator('.usage-kana').count()) > 0 && (await page.locator('.usage-kana-input').count()) === 0)
await page.locator('.usage-kana-edit').first().click()
check('✎ opens it to correct', (await page.locator('.usage-kana-input').count()) === 1)
await page.screenshot({ path: `${SHOTS}/usage-card.png` })

// 3. Its Bulgarian card waits for the English; accepted (in the sandbox), it is in the queue, line for line.
const bgId = idOf('bg', 'usage:あう')
await page.goto(`${WEB}/review/queue/bulgarian/${bgId}`, { waitUntil: 'networkidle' })
check('before the English is accepted, it waits', (await page.locator('.bg-usage').count()) === 0)
await page.goto(`${WEB}/review/queue/usage/${idOf('usage', 'あう')}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.usage-card')
await page.locator('.usage-kana-edit').first().waitFor()
await page.locator('.queue-actions .account-submit').click()
await page.waitForTimeout(1500)
await page.goto(`${WEB}/review/queue/bulgarian/${bgId}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.bg-usage', { timeout: 15000 })
const lines = page.locator('.bg-usage-line')
check('the Bulgarian card shows every line, with its Japanese and English', (await lines.count()) >= 5 && (await lines.first().locator('.usage-ja').textContent()).length > 0)
const first = lines.first().locator('.bg-input')
await first.fill('Хора се срещат лице в лице.')
check('a changed line is outlined', (await lines.first().getAttribute('data-changed')) === 'true')
await page.screenshot({ path: `${SHOTS}/usage-bg.png` })

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(failed ? `${failed} failed` : 'all good')
await browser.close()
process.exit(failed ? 1 : 0)
