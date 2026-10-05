// Usage: node scripts/onboarding-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// A new reviewer opens review mode: the "Start here" cards open by themselves,
// turn with the keys, and a card's handbook link lands on its section. The
// handbook's contents follow the scroll. Then the same on a phone.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function signedIn(email, viewport = { width: 1300, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
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

// The session is a bearer token in localStorage, as the app sends it.
const call = (page, path, body) =>
  page.evaluate(
    ([p, b]) =>
      fetch(p, {
        method: b === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('betterrtk:session')}` },
        body: b === undefined ? undefined : JSON.stringify(b),
      }).then((r) => r.json()),
    [path, body],
  )
const post = call

// Make a reviewer: ask, and the admin approves.
async function reviewer(viewport) {
  const page = await signedIn(`reviewer${Date.now()}@example.com`, viewport)
  await post(page, '/api/auth/contribute', { text: 'I check kanji.' })
  const admin = await signedIn('admin@example.com')
  const people = await call(admin, '/api/admin/people')
  await post(admin, `/api/admin/requests/${encodeURIComponent(people.requests[0].id)}`, { approve: true })
  await admin.context().close()
  return page
}

const r = await reviewer()
await r.goto(`${BASE}/review`, { waitUntil: 'networkidle' })
await wait(900)
console.log('first visit lands on:', new URL(r.url()).pathname)
console.log('cards:', await r.locator('.onb-rail li').count())
await r.screenshot({ path: `${SHOTS}/onb-1-welcome.png` })
await r.keyboard.press('ArrowRight')
await r.keyboard.press('ArrowRight')
await wait(400)
await r.screenshot({ path: `${SHOTS}/onb-2-stages.png` })
await r.locator('.onb-stage', { hasText: 'Meanings' }).click()
await wait(400)
console.log('stage tile opens:', await r.locator('.onb-card h2').textContent())
await r.screenshot({ path: `${SHOTS}/onb-3-meanings.png`, fullPage: true })
await r.locator('.onb-rail button', { hasText: 'What you can do' }).click()
await wait(400)
await r.screenshot({ path: `${SHOTS}/onb-4-tools.png`, fullPage: true })
await r.locator('.onb-rail button', { hasText: 'Parts' }).click()
await wait(300)
await r.locator('.onb-more').click()
await wait(900)
console.log('handbook link lands on:', await r.locator('.handbook-toc-list > li[data-on] > a').first().textContent())
await r.screenshot({ path: `${SHOTS}/onb-5-handbook-parts.png` })
await r.locator('.handbook-toc-list a', { hasText: '従: the old form picks the grouping' }).first().click()
await wait(1200)
console.log('contents now mark:', await r.locator('.handbook-toc-list ol li[data-on] a').first().textContent())
await r.screenshot({ path: `${SHOTS}/onb-6-handbook-cases.png` })

// A second visit goes to the queue as before.
await r.goto(`${BASE}/review`, { waitUntil: 'networkidle' })
await wait(800)
console.log('second visit lands on:', new URL(r.url()).pathname)

const phone = await reviewer({ width: 390, height: 844 })
await phone.goto(`${BASE}/review`, { waitUntil: 'networkidle' })
await wait(900)
await phone.locator('.onb-nav .account-submit').click()
await phone.locator('.onb-nav .account-submit').click()
await phone.locator('.onb-nav .account-submit').click()
await wait(400)
await phone.screenshot({ path: `${SHOTS}/onb-7-phone-parts.png`, fullPage: true })
await phone.locator('.workbench .overlay-tabs button', { hasText: 'Handbook' }).click()
await wait(700)
await phone.locator('.handbook-fold summary').click()
await wait(300)
await phone.screenshot({ path: `${SHOTS}/onb-8-phone-handbook.png` })

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors')
await browser.close()
