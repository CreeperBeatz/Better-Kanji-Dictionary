// Usage: node scripts/fold-check.mjs [base=http://localhost:8000] -- a meaning card folds as a
// movement; shut from its title while read down it, the shut card ends at the top of the screen.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const b = await chromium.launch()
const errors = []
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const p = await b.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await p.goto(`${BASE}/kanji/%E4%B8%8A`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.meaning')
  await p.waitForTimeout(800)
  const card = p.locator('.kanji-page .meaning').first()
  // Read down it: "show more" twice, then into its middle.
  await card.locator('.meaning-more').click()
  await card.locator('.meaning-more').click()
  await p.waitForTimeout(300)
  // Its top well above the screen: about 1,200px down into it.
  await card.evaluate((c) => {
    let sc = c.parentElement
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
    sc.scrollTop += c.getBoundingClientRect().top - sc.getBoundingClientRect().top + 1200
  })
  await p.waitForTimeout(400)
  const pos = () => card.evaluate((c) => ({ card: Math.round(c.getBoundingClientRect().top), head: Math.round(c.querySelector(':scope > header').getBoundingClientRect().top) }))
  const before = await pos()
  console.log(name.padEnd(6), 'read down it: card top', before.card, '| title held at', before.head)
  await card.locator('.meaning-toggle').click()
  const mid = []
  for (let i = 0; i < 3; i++) {
    await p.waitForTimeout(60)
    mid.push(await card.evaluate((c) => Math.round(c.querySelector('.meaning-body')?.getBoundingClientRect().height ?? 0)))
    if (i === 1) await p.screenshot({ path: `C:/tmp/shots/fold-mid-${name}.png` })
  }
  await p.waitForTimeout(400)
  const after = await pos()
  console.log(name.padEnd(6), 'shutting, body height', mid.join(' > '), '| shut:', await card.getAttribute('data-folded'), '| card top', after.card, '(title stood at', before.head + ')')
  await p.screenshot({ path: `C:/tmp/shots/fold-after-${name}.png` })
  await card.locator('.meaning-toggle').click()
  const grow = []
  for (let i = 0; i < 3; i++) {
    await p.waitForTimeout(60)
    grow.push(await card.evaluate((c) => Math.round(c.querySelector('.meaning-body')?.getBoundingClientRect().height ?? 0)))
  }
  await p.waitForTimeout(400)
  console.log(name.padEnd(6), 'opening, body height', grow.join(' < '), '| open:', (await card.getAttribute('data-folded')) === null, '| card top', (await pos()).card)
  await p.close()
}
console.log('errors', errors.length ? errors : 'none')
await b.close()
