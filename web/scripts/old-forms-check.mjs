// Usage: node scripts/old-forms-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// The second pass on characters: the old-forms list (ticked rows, untick to
// say what instead, save a page); a link check with nothing proposed and an
// unsure draft both start with nothing picked, and save waits for a pick; a
// base kanji the new pass drafted whole (止).
import { chromium } from 'playwright'
import { signedIn as signIn } from './session.mjs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = await signIn(browser, BASE, 'admin@example.com', errors, { viewport: { width: 1300, height: 1000 } })

await admin.goto(`${BASE}/review/queue/old-forms`, { waitUntil: 'networkidle' })
await wait(2000)
console.log('old forms rows:', await admin.locator('.old-forms-row').count(), '|', (await admin.locator('.old-forms .tally').textContent()))
console.log('first rows:', (await admin.locator('.old-forms-row').allTextContents()).slice(0, 3).map((s) => s.slice(0, 90)))
await admin.locator('.old-forms-row input[type=checkbox]').nth(1).uncheck()
await wait(200)
console.log('instead shown:', await admin.locator('.old-forms-instead').count(), '| save:', await admin.locator('.old-forms .account-submit').textContent())
await admin.screenshot({ path: `${SHOTS}/old-1-list.png` })
await admin.locator('.old-forms-row input[type=checkbox]').nth(1).check()

// A link check: nothing proposed, nothing picked.
await admin.goto(`${BASE}/review/queue/characters/${encodeURIComponent('char:⺮')}`, { waitUntil: 'networkidle' })
await wait(2000)
console.log('⺮ steps:', await admin.locator('.char-card .card-step h4').allTextContents())
console.log('⺮ picked:', await admin.locator('.char-card .card-option[data-on]').count(), '| save disabled:', await admin.locator('.char-card .account-submit').isDisabled(), '|', await admin.locator('.card-pick-first').count())
await admin.screenshot({ path: `${SHOTS}/old-2-linkcheck.png`, fullPage: true })

// An unsure draft.
await admin.goto(`${BASE}/review/queue/characters/${encodeURIComponent('char:並')}`, { waitUntil: 'networkidle' })
await wait(2000)
console.log('並 picked:', await admin.locator('.char-card .card-option[data-on]').count(), '| save disabled:', await admin.locator('.char-card .account-submit').isDisabled())
await admin.locator('.char-card .card-option').first().click()
await wait(200)
console.log('並 after a pick, save disabled:', await admin.locator('.char-card .account-submit').isDisabled())

// A base kanji, drafted whole.
await admin.goto(`${BASE}/review/queue/characters/${encodeURIComponent('char:止')}`, { waitUntil: 'networkidle' })
await wait(2000)
console.log('止 options:', (await admin.locator('.char-card .card-option').allTextContents()).map((s) => s.slice(0, 120)))
await admin.screenshot({ path: `${SHOTS}/old-3-base.png`, fullPage: true })

console.log('errors:', errors.length ? errors : 'none')
await browser.close()
