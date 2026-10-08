// Usage: node scripts/steps-check.mjs -- the meanings card's steps 2 and 3 on 国 (review/Extras.tsx), on the dev
// frontend (npm run dev, VITE_API=http://127.0.0.1:8010) against tests/sandbox.py on 8010 holding a copy of the queue.
// Puts 邦 in two groups and takes it out of all; the overall box in step 1; 生's mix-ups in step 3; nothing is submitted.
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
const API = process.env.API ?? 'http://127.0.0.1:8010'
const WEB = process.env.WEB ?? 'http://localhost:5173'
const EMAIL = process.env.EMAIL ?? 'dani.matev123@gmail.com'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const SANDBOX = process.env.SANDBOX ?? `${process.env.USERPROFILE}/bkd-steps-sandbox`
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const res = await fetch(`${API}/api/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WEB }, body: JSON.stringify({ email: EMAIL }) }).then((r) => r.json())
await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, WEB), { waitUntil: 'networkidle' })
const db = new DatabaseSync(`${SANDBOX}/review/review.db`, { readOnly: true })
const it = db.prepare("SELECT id FROM item WHERE type = 'kanji_senses' AND subject = '国' AND status = 'open'").get()
await page.goto(`${WEB}/review/queue/meanings/${it.id}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.board-step')

let failed = 0
const check = (name, ok, got = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got})`}`)
  if (!ok) failed++
}
const step2 = page.locator('.board-step').nth(0)
const step3 = page.locator('.board-step').nth(1)
// 邦's first row: Kodansha lists it under two senses, so two rows share one state.
const hou = step2.locator('.step-row', { has: page.locator('.step-char', { hasText: '邦' }) })
const pressed = async (row) => row.first().locator('button[aria-pressed="true"]').allTextContents()

check('2 and 3 are numbered steps', (await step2.locator('h4').textContent()).startsWith('2.') && (await step3.locator('h4').textContent()).startsWith('3. Kanji easy to mix up'))
check('the overall box is in step 1, above the groups', await page.locator('.board > .board-overall + .board-group, .board > .board-overall ~ .board-group').count() > 0
  && (await page.locator('.board-overall textarea').inputValue()).length > 0)
check('国 has no mix-ups: step 3 says so', (await step3.textContent()).includes('Nothing to check'))
check('no step asks about etymology', !(await page.locator('.queue-edit').textContent()).match(/How it was built|Original meaning/i))
check('邦 is listed under each of its Kodansha senses', (await hou.count()) === 2, await hou.count())
check('the sense lines carry no ** marks', !(await step2.locator('h5').allTextContents()).some((x) => x.includes('**')))
check('the province sense lists 藩', (await step2.locator('.step-sense', { hasText: 'province' }).locator('.step-char').allTextContents()).includes('藩'))

// The draft has 邦 in country and Japan already.
await hou.first().getByRole('button', { name: /not the same/ }).click()
check('"not the same" takes it out of every group', JSON.stringify(await pressed(hou)) === JSON.stringify(['not the same meaning']), await pressed(hou))
await hou.first().getByRole('button', { name: /^1\./ }).click()
await hou.first().getByRole('button', { name: /^4\./ }).click()
const two = await pressed(hou)
check('邦 can be in two groups at once', two.length === 2 && two[0].startsWith('1.') && two[1].startsWith('4.'), two)
check('its other row shows the same', JSON.stringify(await hou.nth(1).locator('button[aria-pressed="true"]').allTextContents()) === JSON.stringify(two))
await page.keyboard.press('Enter') // on the focused pick: presses it (out of group 4), never accepts the card
check('Enter on a pick presses the pick, not accept', (await page.locator('.board-step').count()) === 2 && (await pressed(hou)).length === 1, await pressed(hou))

const hanRow = step2.locator('.step-row', { has: page.locator('.step-char', { hasText: '藩' }) }).first()
await hanRow.getByRole('button', { name: /^2\./ }).click()
check('藩 goes into a group', (await pressed(hanRow))[0]?.startsWith('2.'), await pressed(hanRow))


await step2.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${SHOTS}/steps-check.png` })

// The board: a group has no note and does not fold as a whole; its parts (confirmed, common, uncommon) do.
const first = page.locator('.board-group[data-kind="group"]').first()
check('no group has a note field', (await page.locator('.board-note').count()) === 0)
check('a group has no fold control of its own', (await page.locator('.board-caret').count()) === 0)
const toggles = first.locator('.board-part-toggle')
const names = (await toggles.allTextContents()).map((x) => x.replace(/[▸▾\d\s]+/g, ' ').trim().toLowerCase())
check('its parts each fold', names.length >= 2 && names.some((x) => x.startsWith('confirmed')) && names.some((x) => x.startsWith('common')), names)
const common = first.locator('.board-part', { has: page.locator('.board-part-toggle', { hasText: /^[▸▾] common/i }) })
const before = await common.locator('.board-word').count()
await common.locator('.board-part-toggle').click()
check('common words fold away', before > 0 && (await common.locator('.board-word').count()) === 0, before)
check('the confirmed words stay', (await first.locator('.board-done .board-word').count()) > 0)
await common.locator('.board-part-toggle').click()
check('and come back', (await common.locator('.board-word').count()) === before)
await first.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${SHOTS}/steps-board.png` })
// 生: いきる is 生きる or 活きる. 活 starts kept; "not worth showing" drops it.
const sei = db.prepare("SELECT id FROM item WHERE type = 'kanji_senses' AND subject = '生' AND status = 'open'").get()
await page.goto(`${WEB}/review/queue/meanings/${sei.id}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.board-step')
const mix = page.locator('.board-step').nth(1)
const ikiru = mix.locator('.step-sense', { hasText: 'いきる' })
check('生\'s mix-ups are listed by the shared reading', (await ikiru.locator('h5').textContent()).includes('生 · 活'), await ikiru.locator('h5').textContent())
const katsu = ikiru.locator('.step-row', { has: page.locator('.step-char', { hasText: '活' }) })
check('活 starts kept', (await katsu.locator('button[aria-pressed="true"]').textContent()).startsWith('easy to mix up'))
await katsu.getByRole('button', { name: 'not worth showing' }).click()
check('"not worth showing" drops it', (await katsu.locator('button[aria-pressed="true"]').textContent()) === 'not worth showing')
await mix.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${SHOTS}/steps-mixups.png` })
check('no page errors', errors.length === 0, errors.join(' | '))
console.log(failed ? `${failed} failed` : 'all good')
await browser.close()
process.exit(failed ? 1 : 0)
