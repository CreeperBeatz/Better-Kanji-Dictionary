// Usage: node scripts/dictionary-tab-check.mjs -- the dictionary tab (review/BookViewer.tsx) opened from 生's meanings
// card, on the dev frontend (npm run dev, VITE_API=http://127.0.0.1:8010) against tests/sandbox.py on 8010 holding a
// copy of the queue. Needs the scans (Documents/JapaneseDictionaries). Nothing is submitted.
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
const API = process.env.API ?? 'http://127.0.0.1:8010'
const WEB = process.env.WEB ?? 'http://localhost:5173'
const EMAIL = process.env.EMAIL ?? 'dani.matev123@gmail.com'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const SANDBOX = process.env.SANDBOX ?? `${process.env.USERPROFILE}/bkd-steps-sandbox`
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
const errors = []
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
}
watch(page)
const res = await fetch(`${API}/api/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WEB }, body: JSON.stringify({ email: EMAIL }) }).then((r) => r.json())
await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, WEB), { waitUntil: 'networkidle' })
const db = new DatabaseSync(`${SANDBOX}/review/review.db`, { readOnly: true })
const it = db.prepare("SELECT id FROM item WHERE type = 'kanji_senses' AND subject = '生' AND status = 'open'").get()
await page.goto(`${WEB}/review/queue/meanings/${it.id}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.dicts-head .dict-tab')

let failed = 0
const check = (name, ok, got = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got})`}`)
  if (!ok) failed++
}
const scanIn = async (p) => {
  await p.waitForSelector('.book-scan img', { timeout: 20000 })
  return p.locator('.book-scan img').evaluate((img) => img.complete && img.naturalWidth > 0)
}

check('the card head says "Open on the site"', (await page.locator('.dict-open').first().textContent()).includes('Open on the site'))
const icon = page.locator('.dicts-head .dict-tab')
check('"Open in dictionary" is an icon, named in its tooltip', (await icon.locator('svg').count()) === 1 && (await icon.textContent()).trim() === ''
  && (await icon.getAttribute('title')).startsWith('Open 生 in dictionary'))
// Kodansha on the card: 2 words a sense (amber ones aside), and the way to the rest.
await page.locator('details.dict[data-src="kodansha"] > summary').click({ position: { x: 5, y: 8 } })
const blocks = page.locator('details.dict[data-src="kodansha"] .kd-block')
let most = 0
for (let i = 0; i < (await blocks.count()); i++) {
  const b = blocks.nth(i)
  const senses = await b.locator('.kd-sense').count()
  const plain = await b.locator('.kd-w:not([data-away])').count()
  most = Math.max(most, plain / Math.max(senses, 1))
}
check('the card shows at most 2 words a sense', most <= 2, most)
const seeAll = page.locator('details.dict[data-src="kodansha"] .kd-all').first()
check('a cut sense says there are more', (await seeAll.textContent()).includes('see all in the expanded dictionary'), await seeAll.textContent())
const [tab] = await Promise.all([ctx.waitForEvent('page'), page.locator('.dicts-head .dict-tab').click()])
watch(tab)
await tab.waitForLoadState('networkidle')
check('the panel opens the dictionary tab on 生', new URL(tab.url()).pathname === '/review/dictionary' && new URL(tab.url()).searchParams.get('char') === '生', tab.url())
check('Kodansha has both: the switch shows under the dictionaries', (await tab.locator('.dv-choices > .dv-views button').count()) === 2)
check('Kodansha first', (await tab.locator('.dv-books > button[aria-pressed="true"]').textContent()).startsWith('Kodansha'))
check('its scanned page shows', await scanIn(tab))
check('with the entry and its pages', (await tab.locator('.dv-entry').textContent()).includes('4309'), await tab.locator('.dv-entry').textContent())
check('新漢語林 has no 生 here: its button is off', await tab.getByRole('button', { name: /新漢語林/ }).isDisabled())
await tab.screenshot({ path: `${SHOTS}/dictionary-tab.png` })

await tab.getByRole('button', { name: /Цалта/ }).click()
check('Цалта’s kanji book, its page', (await scanIn(tab)) && new URL(tab.url()).searchParams.get('book') === 'kanji', tab.url())
const title = await tab.locator('.book-popup-title').textContent()
await tab.keyboard.press('ArrowRight')
await tab.waitForTimeout(400)
check('→ turns the page', (await tab.locator('.book-popup-title').textContent()) !== title)

// From step 3: 産 (うまれる). The same tab shows it, still in Цалта's book.
const before = ctx.pages().length
await page.locator('.board-step').nth(1).locator('.step-row', { has: page.locator('.step-char', { hasText: '産' }) }).locator('.dict-tab').click()
await tab.waitForURL(/char=%E7%94%A3|char=産/, { timeout: 15000 })
await tab.waitForLoadState('networkidle')
check('a row’s link reuses the same tab', ctx.pages().length === before, ctx.pages().length)
check('it shows 産', (await tab.locator('.dv-char').textContent()) === '産')
check('in the dictionary picked last', (await tab.locator('.dv-books > button[aria-pressed="true"]').textContent()).startsWith('Цалта'))
check('生 is among those opened before', (await tab.locator('.dv-recent button').allTextContents()).includes('生'))

await tab.locator('.dv-input').fill('国')
await tab.waitForTimeout(600)
check('typing a kanji opens it', (await tab.locator('.dv-char').textContent()) === '国' && (await scanIn(tab)))
await tab.getByRole('button', { name: /新漢語林/ }).click()
check('新漢語林 has 国', await scanIn(tab))
await tab.screenshot({ path: `${SHOTS}/dictionary-tab-kangorin.png` })

// "see all": Kodansha, digital, whole and unfolded.
await seeAll.click()
await tab.waitForURL(/view=digital/, { timeout: 15000 })
await tab.waitForSelector('.dv-digital .kd-entry')
const cardWords = await page.locator('details.dict[data-src="kodansha"] .kd-w').count()
const allWords = await tab.locator('.dv-digital .kd-w').count()
check('"see all" opens Kodansha digital, every word', (await tab.locator('.dv-char').textContent()) === '生' && allWords > cardWords, `${cardWords} on the card, ${allWords} in the tab`)
check('the digital view folds nothing', (await tab.locator('.dv-digital details').count()) === 0)
await tab.screenshot({ path: `${SHOTS}/dictionary-tab-digital.png` })
await tab.getByRole('button', { name: 'scanned' }).click()
check('the switch shows the scan', await scanIn(tab))
await tab.getByRole('button', { name: /Wiktionary/ }).click()
await tab.waitForSelector('.dv-digital .dict-sense')
check('Wiktionary: digital only, so no switch', (await tab.locator('.dv-views').count()) === 0)
check('新漢語林 on 生: not in it', await tab.getByRole('button', { name: /新漢語林/ }).isDisabled())
await page.screenshot({ path: `${SHOTS}/dictionary-card.png` })
check('no page errors', errors.length === 0, errors.join(' | '))
console.log(failed ? `${failed} failed` : 'all good')
await browser.close()
process.exit(failed ? 1 : 0)
