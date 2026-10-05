// Usage: node scripts/confirm-check.mjs [base]  (against tests/sandbox.py with tests/load_sandbox.py, default http://127.0.0.1:8010)
// A meanings card can't be accepted until every word in its groups is
// confirmed; confirmed words stay in sight, in an open "confirmed" part.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && !/avatar/.test(m.text()) && errors.push(m.text()))
const res = await fetch(`${BASE}/api/auth/request`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: 'admin@example.com' }),
}).then((r) => r.json())
await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' })
await page.goto(`${BASE}/review/queue/meanings`, { waitUntil: 'networkidle' })
await wait(1500)

const accept = page.locator('.queue-actions .account-submit')
const counted = '.board-group:is([data-kind="group"], [data-kind="catch-all"])'
const open = () => page.locator(`${counted} .board-word:not([data-ok]):not([data-skipped]) .board-check input`)
console.log('words to confirm:', await open().count(), '| accept disabled:', await accept.isDisabled())
console.log('says:', await page.locator('.queue-blocked').textContent())
await page.screenshot({ path: `${SHOTS}/confirm-1-blocked.png` })

await page.keyboard.press('a')
await wait(400)
console.log('the a key does nothing while blocked:', (await page.locator('.queue-blocked').count()) === 1)

// Tick one, then see it stays in sight.
await open().first().evaluate((el) => el.click())
await wait(200)
console.log('confirmed part open by default:', await page.locator('.board-done .board-words').first().isVisible())
await page.screenshot({ path: `${SHOTS}/confirm-2-one.png` })

for (let n = await open().count(); n > 0; n = await open().count()) await open().first().evaluate((el) => el.click())
await wait(300)
console.log('after ticking all, accept disabled:', await accept.isDisabled(), '| note shown:', await page.locator('.queue-blocked').count())
console.log('complete boxes:', await page.locator('.board-group[data-complete]').count())
await page.screenshot({ path: `${SHOTS}/confirm-3-done.png` })

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors')
await browser.close()
