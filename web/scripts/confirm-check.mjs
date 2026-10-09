// Usage: node scripts/confirm-check.mjs [base]  (against tests/sandbox.py with tests/load_sandbox.py, default http://127.0.0.1:8010)
// A meanings card can't be accepted until every word in its groups is
// confirmed; confirmed words move to a "confirmed" part, folded until opened.
import { chromium } from 'playwright'
import { signedIn } from './session.mjs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const page = await signedIn(browser, BASE, process.env.EMAIL ?? 'admin@example.com', errors, { viewport: { width: 1400, height: 950 }, settle: 0, label: '' })
await page.goto(`${BASE}/review/queue/meanings`, { waitUntil: 'networkidle' })
await wait(1500)

const accept = page.locator('.queue-actions .account-submit')
const counted = '.board-group:is([data-kind="group"], [data-kind="catch-all"])'
const open = () => page.locator(`${counted} .board-word:not([data-ok]):not([data-skipped])`)
// Right-click a word (or the selection it is in), then Confirm.
async function confirm(word) {
  // Scrolled into view first: a scroll's event comes a frame later, and would close the menu just opened.
  await word.scrollIntoViewIfNeeded()
  await wait(100)
  await word.click({ button: 'right' })
  await page.locator('.board-menu .board-menu-ok').click()
  await wait(200)
}
console.log('words to confirm:', await open().count(), '| accept disabled:', await accept.isDisabled())
console.log('says:', await page.locator('.queue-blocked').textContent())
await page.screenshot({ path: `${SHOTS}/confirm-1-blocked.png` })

await page.keyboard.press('a')
await wait(400)
console.log('the a key does nothing while blocked:', (await page.locator('.queue-blocked').count()) === 1)

// Confirm one, then see it stays in sight.
await confirm(open().first())
console.log('confirmed part folded by default:', (await page.locator('.board-done .board-words').count()) === 0)
await page.screenshot({ path: `${SHOTS}/confirm-2-one.png` })

// The word's page, in a new tab.
const link = open().first().locator('.board-open')
console.log('word link:', await link.getAttribute('href'), await link.getAttribute('target'))

// The menu on a word at the bottom of the screen: all of it on the screen, and a scroll inside it keeps it open.
await page.setViewportSize({ width: 1400, height: 420 })
const low = open().last()
await low.evaluate((el) => el.scrollIntoView({ block: 'end' }))
await low.click({ button: 'right', position: { x: 20, y: 10 } })
const menu = page.locator('.board-menu')
const r = await menu.boundingBox()
console.log('menu on screen:', r.y >= 0 && r.y + r.height <= 420, `(top ${Math.round(r.y)}, height ${Math.round(r.height)})`)
await menu.evaluate((el) => {
  el.scrollTop = 40
  el.dispatchEvent(new Event('scroll'))
})
await wait(100)
console.log('scroll inside keeps it open:', (await menu.count()) === 1)
await page.mouse.wheel(0, 100)
await page.mouse.click(5, 5)
await wait(100)
console.log('click outside closes it:', (await menu.count()) === 0)
await page.setViewportSize({ width: 1400, height: 950 })

// Select every word left, then confirm them all at once.
for (const w of await open().all()) await w.click()
await confirm(page.locator('.board-word[data-picked]').first())
await wait(300)
console.log('after confirming all, accept disabled:', await accept.isDisabled(), '| note shown:', await page.locator('.queue-blocked').count())
console.log('complete boxes:', await page.locator('.board-group[data-complete]').count())
await page.screenshot({ path: `${SHOTS}/confirm-3-done.png` })

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors')
await browser.close()
