// Usage: node scripts/review-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// A user suggests new parts for 青 from its page; the admin accepts it in the
// queue with the keyboard; the page shows the new parts; the admin reverts it.
// Also opens the meaning items that tests/seed_review.py puts in the queue.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function signedIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${email}: ${e}`))
  page.on('console', (m) => m.type() === 'error' && !/avatar/.test(m.text()) && errors.push(`${email}: ${m.text()}`))
  const res = await fetch(`${BASE}/api/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email }),
  }).then((r) => r.json())
  await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' })
  await wait(600)
  return page
}

const user = await signedIn(`learner${Date.now()}@example.com`)
await user.goto(`${BASE}/kanji/${encodeURIComponent('青')}`, { waitUntil: 'networkidle' })
await wait(800)
await user.locator('.fanout-line .suggest-link').last().click()
await wait(400)
await user.fill('.review-parts-input', '生月')
await user.fill('.suggest-panel textarea', 'The old form 靑 is 生 over 丹; 生 gives the reading セイ.')
await user.screenshot({ path: `${SHOTS}/review-1-suggest.png` })
await user.locator('.suggest-panel .account-submit').click()
await wait(600)
console.log('user told it was sent:', (await user.locator('.suggest-panel').textContent()).includes('reviewer will look'))

const admin = await signedIn('admin@example.com')
await admin.goto(`${BASE}/kanji/${encodeURIComponent('青')}?review=1`, { waitUntil: 'networkidle' })
await wait(1200)
console.log('queue items:', await admin.locator('.queue-list li').count())
const first = (await admin.locator('.queue-list li').first().textContent()).trim()
console.log('first item:', first)
await admin.screenshot({ path: `${SHOTS}/review-2-queue.png` })
// Pick the suggestion for 青 and accept it with the keyboard.
await admin.locator('.queue-list li', { hasText: '青' }).first().click()
await wait(800)
await admin.screenshot({ path: `${SHOTS}/review-3-item.png` })
await admin.keyboard.press('a')
await wait(900)
await admin.keyboard.press('Escape')
await wait(1500)
const parts = await admin.locator('.graph-svg .node[data-kind="component"] text').allTextContents()
console.log('graph components of 青 now:', parts.join(' '))

await admin.goto(`${BASE}/?review=1`, { waitUntil: 'networkidle' })
await wait(800)
await admin.locator('.workbench .overlay-tabs button', { hasText: 'History' }).first().click()
await wait(700)
console.log('history rows:', await admin.locator('.decisions li').count())
await admin.screenshot({ path: `${SHOTS}/review-4-history.png` })
admin.once('dialog', (d) => d.accept())
await admin.locator('.decisions li button', { hasText: 'revert' }).first().click()
await wait(900)
console.log('after revert, reverted rows:', await admin.locator('.decisions li[data-reverted]').count())

// Seeded meaning items, if tests/seed_review.py ran.
await admin.locator('.workbench .overlay-tabs button', { hasText: 'Queue' }).first().click()
await wait(600)
const meanings = admin.locator('.queue-filters button', { hasText: /^meanings$/ })
if (await meanings.count()) {
  await meanings.click()
  await wait(800)
  if (await admin.locator('.queue-list li').count()) {
    await admin.locator('.queue-list li').first().click()
    await wait(900)
    await admin.screenshot({ path: `${SHOTS}/review-5-senses.png` })
  }
}
console.log('errors', errors)
await browser.close()
