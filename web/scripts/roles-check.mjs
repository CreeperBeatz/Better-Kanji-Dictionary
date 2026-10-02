// Usage: node scripts/roles-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// A user asks to review, the admin approves on the People tab, the user then sees the review button.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? '/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function signedIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${email}: ${e}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${email}: ${m.text()}`))
  const res = await fetch(`${BASE}/api/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email }),
  }).then((r) => r.json())
  await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' })
  await wait(800)
  return page
}

const user = await signedIn(`learner${Date.now()}@example.com`)
await user.locator('.profile-button').first().click()
await wait(500)
await user.locator('.account-contribute summary').click()
await user.fill('#account-contribute', 'I teach Japanese at a school in Plovdiv.')
await user.screenshot({ path: `${SHOTS}/roles-1-ask.png` })
await user.locator('.account-contribute .account-submit').click()
await wait(600)
console.log('user sees waiting:', (await user.locator('.account-contribute').textContent()).includes('waiting'))

const admin = await signedIn('admin@example.com')
await admin.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
await wait(800)
console.log('admin people tab requests:', await admin.locator('.workbench .person').count())
await admin.screenshot({ path: `${SHOTS}/roles-2-admin.png` })
await admin.locator('.workbench .person .account-submit').first().click()
await wait(600)
console.log('after approve, reviewers listed:', await admin.locator('.workbench-section').nth(1).locator('.person').count())
await admin.screenshot({ path: `${SHOTS}/roles-3-approved.png` })

await user.reload({ waitUntil: 'networkidle' })
await wait(600)
await user.locator('.profile-button').first().click()
await wait(500)
console.log('user now reviewer:', (await user.locator('.account-contribute').textContent()).includes('reviewer'))
await user.screenshot({ path: `${SHOTS}/roles-4-reviewer.png` })
console.log('errors', errors)
await browser.close()
