// Usage: node scripts/onboarding-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// A new reviewer opens review mode: the start guide pops up by itself, turns
// with the keys, closes with Esc, opens again from the handbook, and a card's
// handbook link lands on its section. The contents follow the scroll. Then a phone.
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
console.log('first visit: guide open over', new URL(r.url()).pathname, await r.locator('.onb-panel').count())
await r.screenshot({ path: `${SHOTS}/onb-1-welcome.png` })
await r.keyboard.press('ArrowRight')
await r.keyboard.press('ArrowRight')
await wait(400)
await r.screenshot({ path: `${SHOTS}/onb-2-stages.png` })
await r.locator('.onb-stage', { hasText: 'Meanings' }).click()
await wait(400)
console.log('stage tile opens:', await r.locator('.onb-card h2').textContent())
await r.screenshot({ path: `${SHOTS}/onb-3-meanings.png` })
await r.keyboard.press('Escape')
await wait(300)
console.log('Esc closes the guide only:', (await r.locator('.onb-panel').count()) === 0 && (await r.locator('.workbench').count()) === 1)

await r.locator('.workbench .overlay-tabs button', { hasText: 'Handbook' }).click()
await wait(700)
await r.screenshot({ path: `${SHOTS}/onb-4-handbook.png` })
await r.locator('.handbook-guide').click()
await wait(400)
await r.locator('.onb-dots button[title="Parts"]').click()
await wait(300)
await r.locator('.onb-more').click()
await wait(900)
console.log('handbook link closes the guide and lands on:', await r.locator('.handbook-toc-list > li[data-on] > a').first().textContent(), (await r.locator('.onb-panel').count()) === 0)
await r.locator('.handbook-toc .handbook-toc-start button').click()
await wait(300)
await r.locator('.onb-dots button').last().click()
await wait(300)
await r.screenshot({ path: `${SHOTS}/onb-5-last.png` })
await r.locator('.onb-finish .account-submit').click()
await wait(600)
console.log('last card opens the queue:', new URL(r.url()).pathname)
await r.locator('.workbench .overlay-tabs button', { hasText: 'Handbook' }).click()
await wait(500)
await r.locator('.handbook-toc-list a', { hasText: '従: the old form picks the grouping' }).first().click()
await wait(1200)
console.log('contents now mark:', await r.locator('.handbook-toc-list ol li[data-on] a').first().textContent())

// A second visit does not open the guide.
await r.goto(`${BASE}/review`, { waitUntil: 'networkidle' })
await wait(800)
console.log('second visit: guide open?', (await r.locator('.onb-panel').count()) > 0)

const phone = await reviewer({ width: 390, height: 844 })
await phone.goto(`${BASE}/review`, { waitUntil: 'networkidle' })
await wait(900)
for (let i = 0; i < 3; i++) await phone.locator('.onb-nav .account-submit').click()
await wait(400)
await phone.screenshot({ path: `${SHOTS}/onb-6-phone-parts.png` })
await phone.locator('.onb-panel .account-x').click()
await wait(300)
await phone.locator('.workbench .overlay-tabs button', { hasText: 'Handbook' }).click()
await wait(700)
await phone.screenshot({ path: `${SHOTS}/onb-7-phone-handbook.png` })

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors')
await browser.close()
