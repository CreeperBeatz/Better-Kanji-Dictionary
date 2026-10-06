// Usage: node scripts/character-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// With a copy of the queue in the sandbox: the characters stage lists one card
// per character; a card asks its steps in words, shows the AI draft with its
// proof and what the chosen answer changes; saving one makes it live; the
// report button sends a report; the meanings board starts with agreed words
// ticked.
import { chromium } from 'playwright'
import { signedIn as signIn } from './session.mjs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = await signIn(browser, BASE, 'admin@example.com', errors, { viewport: { width: 1300, height: 1000 } })

await admin.goto(`${BASE}/review/queue/characters`, { waitUntil: 'networkidle' })
await wait(2000)
const first = (await admin.locator('.char-card .queue-big').textContent()).trim()
console.log('first card:', first)
console.log('steps:', await admin.locator('.char-card .card-step h4').allTextContents())
console.log('options:', await admin.locator('.char-card .card-option').allTextContents().then((t) => t.map((s) => s.slice(0, 60))))
console.log('draft:', (await admin.locator('.card-draft').first().textContent().catch(() => '(none)')).slice(0, 160))
console.log('summary:', await admin.locator('.card-summary li').allTextContents())
await wait(800)
console.log('changes:', (await admin.locator('.card-changes').textContent()).slice(0, 160))
await admin.screenshot({ path: `${SHOTS}/char-1-card.png`, fullPage: true })

const startAt = await admin.locator('.char-card .card-option').evaluateAll((els) => els.findIndex((e) => e.hasAttribute('data-on')))
// Keep it as it is: the summary says so and nothing changes.
await admin.locator('.card-option', { hasText: /Keep it as it is/ }).first().click()
await wait(300)
console.log('after keep:', await admin.locator('.card-summary li').first().textContent(), '|', (await admin.locator('.card-changes').textContent()).slice(0, 60))

// Back to the draft's answer, and save it.
await admin.locator('.char-card .card-option').nth(startAt).click()
await wait(200)
await admin.locator('.char-card .account-submit').click()
await wait(1500)
const next = (await admin.locator('.char-card .queue-big').textContent()).trim()
console.log('saved; next card:', next)
const parts = await admin.evaluate(async (c) => (await fetch(`/api/kanji/${encodeURIComponent(c)}`).then((r) => r.json())).components?.nodes?.filter((n) => n.depth === 1).map((n) => n.char), first)
console.log(`${first} parts now:`, parts)

// A card with a form link and a part meaning.
await admin.goto(`${BASE}/review/queue/characters/${encodeURIComponent('char:丷')}`, { waitUntil: 'networkidle' })
await wait(2000)
console.log('丷 steps:', await admin.locator('.char-card .card-step h4').allTextContents())
await admin.screenshot({ path: `${SHOTS}/char-2-part.png`, fullPage: true })
// A shape plus a form of: refused before saving.
await admin.locator('.card-option', { hasText: /Use the proposal: 丷 is a form of/ }).first().click().catch(() => {})
await wait(300)
console.log('conflict shown:', await admin.locator('.queue-warn', { hasText: /can’t both be right/ }).count(), 'save disabled:', await admin.locator('.char-card .account-submit').isDisabled())

// Report from a card.
await admin.locator('.report-open').first().click()
await admin.locator('.report-form textarea').fill('the readings miss an old one')
await admin.locator('.report-form select').selectOption('readings')
await admin.locator('.report-form .account-submit').click()
await wait(800)
console.log('report:', await admin.locator('.report-sent').textContent().catch(() => '(not sent)'))
await admin.goto(`${BASE}/review/queue/reports`, { waitUntil: 'networkidle' })
await wait(1500)
console.log('reports stage:', (await admin.locator('.queue-item .review-report').first().textContent().catch(() => '(none)')).slice(0, 100))

// The meanings board: agreed words start ticked.
await admin.goto(`${BASE}/review/queue/meanings`, { waitUntil: 'networkidle' })
await wait(2500)
console.log('pre-ticked note:', await admin.locator('.board-surenote').textContent().catch(() => '(none)'))
console.log('ticked words:', await admin.locator('.board-word[data-sure]').count(), 'of', await admin.locator('.board-word').count())
console.log('accept button:', await admin.locator('.queue-actions .account-submit').textContent(), await admin.locator('.queue-blocked').textContent().catch(() => ''))
await admin.screenshot({ path: `${SHOTS}/char-3-board.png` })

console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
