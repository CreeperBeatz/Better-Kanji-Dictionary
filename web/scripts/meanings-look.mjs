// Usage: node scripts/meanings-look.mjs <char> [shot] -- a screenshot of a kanji's meanings card on the dev frontend
// (npm run dev, VITE_API=http://127.0.0.1:8010) against tests/sandbox.py on 8010, signed in as the sandbox's admin.
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
const API = process.env.API ?? 'http://127.0.0.1:8010'
const WEB = process.env.WEB ?? 'http://localhost:5173'
const EMAIL = process.env.EMAIL ?? 'dani.matev123@gmail.com'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const SANDBOX = process.env.SANDBOX ?? `${process.env.USERPROFILE}/bkd-meanings-sandbox`
const [char = '生', shot = 'meanings'] = process.argv.slice(2)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const res = await fetch(`${API}/api/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WEB }, body: JSON.stringify({ email: EMAIL }) }).then((r) => r.json())
await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, WEB), { waitUntil: 'networkidle' })
const db = new DatabaseSync(`${SANDBOX}/review/review.db`, { readOnly: true })
const TYPE = process.env.TYPE ?? 'kanji_senses'
const it = db.prepare("SELECT id FROM item WHERE type = ? AND subject = ? AND status = 'open'").get(TYPE, char)
if (!it) throw new Error(`no open meanings item for ${char}`)
await page.goto(`${WEB}/review/queue/${TYPE === 'bg' ? 'bulgarian' : 'meanings'}/${it.id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true })
// OPEN=<n>: unfold the first n dictionaries; PAGE=1: open the first one's page popup.
if (process.env.OPEN) {
  const sums = page.locator('.dict-sum')
  // OPEN_SRC=kangorin: unfold that dictionary only.
  if (process.env.OPEN_SRC) await page.locator(`details.dict[data-src="${process.env.OPEN_SRC}"] > .dict-sum`).click({ position: { x: 5, y: 8 } })
  else for (let i = 0; i < Number(process.env.OPEN); i++) await sums.nth(i).click({ position: { x: 5, y: 8 } })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${shot}-open.png` })
}
if (process.env.PAGE) {
  // The first dictionary's page: then the next page (→) and zoomed in (+ + +).
  await page.locator('.dict-sum .book-page').first().click()
  await page.waitForSelector('.book-popup .book-scan img', { timeout: 20000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/${shot}-page.png` })
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1500)
  for (let i = 0; i < 4; i++) await page.keyboard.press('+')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${shot}-page-next-zoom.png` })
  console.log('popup title:', await page.locator('.book-popup-title').textContent(), '| zoom:', await page.locator('.book-zoom-n').textContent())
  await page.keyboard.press('Escape')
  console.log('details still folded after the popup:', await page.locator('details.dict[open]').count())
}
// AT=<selector>: a second shot with that part of the card scrolled into view.
if (process.env.AT) {
  await page.locator(process.env.AT).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${shot}-at.png` })
}
// RESEARCH=1: press "Research in Claude" and print the prompt it would open.
if (process.env.RESEARCH) {
  await page.evaluate(() => { window.open = (u) => { window.__opened = u; return null } })
  await page.getByRole('button', { name: /Research in Claude/ }).first().click()
  const url = await page.evaluate(() => window.__opened)
  const q = new URL(url).searchParams.get('q')
  console.log(`--- url ${url.length} chars${q ? '' : ' (too long: opens empty, prompt copied)'}`)
  const prompt = q ?? (await page.evaluate(() => navigator.clipboard.readText()))
  console.log(`--- prompt ${prompt.length} chars, ${encodeURIComponent(prompt).length} encoded`)
  console.log(prompt)
}
console.log(`${SHOTS}/${shot}.png`, errors.length ? errors : 'no errors')
await browser.close()
