// Usage: node scripts/gate-check.mjs -- a meanings card's accept waits for its steps (review/Stage.tsx), and no key
// accepts a card. On the dev frontend (VITE_API=http://127.0.0.1:8010) against tests/sandbox.py on 8010 holding a
// copy of the queue, as steps-check.mjs. Ticks every word on 国 and 生 and presses "Done"; nothing is submitted.
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
const API = process.env.API ?? 'http://127.0.0.1:8010'
const WEB = process.env.WEB ?? 'http://localhost:5173'
const EMAIL = process.env.EMAIL ?? 'dani.matev123@gmail.com'
const SANDBOX = process.env.SANDBOX ?? `${process.env.USERPROFILE}/bkd-steps-sandbox`
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.stack).split(/\r?\n/).filter((l) => l.includes('/src/')).slice(0, 8).join(' <- ') || String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
let decided = 0
page.on('request', (r) => r.method() === 'POST' && r.url().includes('/decide') && decided++)
const res = await fetch(`${API}/api/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WEB }, body: JSON.stringify({ email: EMAIL }) }).then((r) => r.json())
await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, WEB), { waitUntil: 'networkidle' })
const db = new DatabaseSync(`${SANDBOX}/review/review.db`, { readOnly: true })

let failed = 0
const check = (name, ok, got = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got})`}`)
  if (!ok) failed++
}
const accept = page.locator('.queue-actions .account-submit')
const hint = async () => ((await page.locator('.queue-blocked').count()) ? await page.locator('.queue-blocked').textContent() : '')

async function open(char) {
  const it = db.prepare("SELECT id FROM item WHERE type = 'kanji_senses' AND subject = ? AND status = 'open'").get(char)
  await page.goto(`${WEB}/review/queue/meanings/${it.id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.review-step[data-n="2"]')
}
async function tickAll() {
  // The tick's input is styled away; a click on it in the page is what a click on the tick does.
  // A few at a time, as a person would: hundreds of clicks in one task nest React's updates.
  for (let i = 0; i < 200; i++) {
    const n = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.board-check input:not(:checked):not(:disabled)')].slice(0, 5)
      for (const b of boxes) b.click()
      return boxes.length
    })
    if (!n) return
    await page.waitForTimeout(30)
  }
}

console.log('国: no mix-ups, so only step 2 waits')
await open('国')
check('words first', (await hint()).startsWith('Confirm every word'), await hint())
await tickAll()
check('then step 2', (await hint()).includes('step 2') && !(await hint()).includes('3'), await hint())
check('accept is greyed', await accept.isDisabled())
await page.locator('.review-step[data-n="2"] .review-step-done').click()
check('after "Done", nothing waits', (await hint()) === '' && (await accept.isEnabled()), await hint())
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('a')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check('a and Enter accept nothing', decided === 0 && (await accept.isEnabled()), decided)

console.log('生: steps 2 and 3 wait')
await open('生')
await tickAll()
check('both steps wait', (await hint()).includes('step 2, 3'), await hint())
await page.locator('.review-step[data-n="3"] .review-step-done').click()
check('step 3 done, step 2 still waits', (await hint()).includes('step 2') && !(await hint()).includes('3'), await hint())
await page.locator('.review-step[data-n="2"] .review-step-done').click()
check('both done: accept is open', (await hint()) === '' && (await accept.isEnabled()), await hint())
await page.locator('.review-step[data-n="2"] .review-step-toggle').click()
check('opening a step again keeps it checked', (await hint()) === '')

console.log('work kept in the browser')
const kokuItem = db.prepare("SELECT id FROM item WHERE type = 'kanji_senses' AND subject = '国' AND status = 'open'").get().id
const seiItem = db.prepare("SELECT id FROM item WHERE type = 'kanji_senses' AND subject = '生' AND status = 'open'").get().id
const key = (id) => `betterrtk:review-draft:${id}`
await page.evaluate(([a, b]) => {
  localStorage.setItem(a, JSON.stringify({ reason: 'begun on an older proposal', base: 'not-this-one', at: Date.now() }))
  localStorage.setItem(b, JSON.stringify({ reason: 'kept before fingerprints', at: Date.now() }))
}, [key(kokuItem), key(seiItem)])
await open('国')
check('work begun on another proposal is thrown away', (await page.evaluate((k) => localStorage.getItem(k), key(kokuItem))) === null)
check('and the card says so', (await page.locator('.queue-item').textContent()).includes('The proposal changed after you began this card'))
await open('生')
const legacy = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), key(seiItem))) ?? 'null')
check('work from before fingerprints is kept', legacy?.reason === 'kept before fingerprints', JSON.stringify(legacy))
check('without a notice', !(await page.locator('.queue-item').textContent()).includes('The proposal changed'))

check('nothing was submitted', decided === 0, decided)
check('no page errors', errors.length === 0, errors.join(' | '))
console.log(failed ? `${failed} failed` : 'all good')
await browser.close()
process.exit(failed ? 1 : 0)
