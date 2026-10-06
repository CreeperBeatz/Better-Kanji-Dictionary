// Usage: node scripts/parts-check.mjs [base]  (against tests/sandbox.py, default http://127.0.0.1:8010)
// After `python pipeline/part_drafts.py load --review-dir <sandbox>/review`:
// a form link card shows both characters in their fonts with the rated kanji
// each is in, and its (i) explains each kind; a part meaning card shows its
// kanji with their old forms; accepting a shape puts it on the part's page;
// the handbook shows the kinds tables.
import { chromium } from 'playwright'
import { signedIn as signIn } from './session.mjs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = await signIn(browser, BASE, 'admin@example.com', errors, { viewport: { width: 1300, height: 1000 } })

await admin.goto(`${BASE}/review/queue/forms`, { waitUntil: 'networkidle' })
await wait(1500)
console.log('form card sides:', await admin.locator('.queue-side').count())
console.log('font strips:', await admin.locator('.queue-side .font-strip, .queue-side [class*="font"]').count())
console.log('kanji lists:', await admin.locator('.queue-used').allTextContents().then((t) => t.map((s) => s.slice(0, 40))))
await admin.screenshot({ path: `${SHOTS}/parts-1-form-card.png`, fullPage: true })
await admin.locator('.queue-edit .page-edit-info').first().click()
await wait(300)
console.log('kinds rows:', await admin.locator('.queue-edit .kinds-info tbody tr').count())
await admin.screenshot({ path: `${SHOTS}/parts-2-form-info.png`, fullPage: true })
await admin.locator('.queue-edit .page-edit-info').first().click()
await admin.selectOption('#form-kind', 'old')
const before = await admin.locator('#form-kind option:checked').textContent()
await admin.locator('.review-swap').click()
const after = await admin.locator('#form-kind option:checked').textContent()
console.log('old form reads:', before, '| swapped:', after)
await admin.screenshot({ path: `${SHOTS}/parts-2b-form-swap.png` })

await admin.goto(`${BASE}/review/queue/part-meanings`, { waitUntil: 'networkidle' })
await wait(1500)
const head = (await admin.locator('.queue-big').first().textContent()).trim()
console.log('first part card:', head)
console.log('old forms shown:', await admin.locator('.queue-used-was').count())
await admin.screenshot({ path: `${SHOTS}/parts-3-part-card.png`, fullPage: true })
await admin.keyboard.press('a')
await wait(1000)
await admin.goto(`${BASE}/kanji/${encodeURIComponent(head)}`, { waitUntil: 'networkidle' })
await wait(1500)
console.log('page head:', (await admin.locator('.detail-meanings').first().textContent()).trim())
console.log('page note:', (await admin.locator('.detail-part-note').first().textContent().catch(() => '(none)')).trim())
await admin.screenshot({ path: `${SHOTS}/parts-4-page.png` })

await admin.goto(`${BASE}/review/handbook`, { waitUntil: 'networkidle' })
await wait(1200)
console.log('handbook kinds tables:', await admin.locator('.handbook .kinds-info').count())
await admin.locator('#hb-part-meanings').scrollIntoViewIfNeeded()
await wait(300)
await admin.screenshot({ path: `${SHOTS}/parts-5-handbook.png` })

console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
