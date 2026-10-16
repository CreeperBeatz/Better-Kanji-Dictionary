// Usage: node scripts/synonym-jump-check.mjs [base=http://localhost:8000]
// A card brought into view comes with its top at the top of the screen, to be read from its
// start, however tall it is and however the page settles (meaningFocus.ts bringToTop), on a
// phone (after the page has risen) and on a desktop:
//  - a synonym row ("≈ close in meaning") opens the other kanji at that meaning, its top just
//    under the folded page head (44px);
//  - "All N words →" on a meaning opens the kanji's words at that meaning's card.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const browser = await chromium.launch()
const errors = []
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  let tried = 0
  for (const c of '見言会生上大手明日時行') {
    await page.goto(`${BASE}/kanji/${encodeURIComponent(c)}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.meaning', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(400)
    const rows = page.locator('.card-slot > .page-card .close-row')
    const n = await rows.count()
    for (let i = 0; i < n && tried < 3; i++) {
      const row = rows.nth(i)
      if (!(await row.locator('.close-sense').count())) continue // no meaning to open at
      tried++
      const label = (await row.innerText()).replace(/\s+/g, ' ')
      await row.scrollIntoViewIfNeeded()
      const bb = await row.boundingBox()
      if (mobile) await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2)
      else await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
      await page.waitForSelector('.meaning-flash', { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(1200)
      const r = await page.evaluate(() => {
        const card = document.querySelector('.card-slot > .page-card .meaning-flash')
        const head = document.querySelector('.card-slot > .page-card > .page-head')
        if (!card) return null
        const sc = (() => {
          for (let n = card.parentElement; n; n = n.parentElement) {
            const y = getComputedStyle(n).overflowY
            if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n
          }
        })()
        const top = sc.getBoundingClientRect().top
        const b = card.getBoundingClientRect()
        return { cardTop: Math.round(b.top - top), headBottom: Math.round(head.getBoundingClientRect().bottom - top), cardH: Math.round(b.height), screen: sc.clientHeight, end: sc.scrollHeight - sc.clientHeight - sc.scrollTop < 2 }
      })
      console.log(name, c, '->', label.slice(0, 40), '|', r ? `card top ${r.cardTop}px below the screen top, head ends at ${r.headBottom}; card ${r.cardH}px tall, screen ${r.screen}${r.end ? ', page at its end' : ''}` : 'no card flashed')
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
      break
    }
    if (tried >= 3) break
  }
  // "All N words": 日's first meaning, shown out to its last "show more".
  await page.goto(`${BASE}/kanji/${encodeURIComponent('日')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.meaning')
  const more = page.locator('.card-slot > .page-card .meanings .meaning').first().locator('.meaning-more')
  for (let i = 0; i < 5 && !/→/.test(await more.innerText().catch(() => '→')); i++) {
    await more.click()
    await page.waitForTimeout(250)
  }
  const label = await more.innerText().catch(() => '')
  const bb = await more.boundingBox()
  if (bb) {
    if (mobile) await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2)
    else await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.waitForTimeout(2500)
    const r = await page.evaluate(() => {
      const card = document.querySelector('[id^="words-"]')
      if (!card) return null
      let sc = card.parentElement
      while (sc && !(['auto', 'scroll'].includes(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement
      return { id: card.id, top: Math.round(card.getBoundingClientRect().top - sc.getBoundingClientRect().top), margin: getComputedStyle(card).scrollMarginTop, end: sc.scrollHeight - sc.clientHeight - sc.scrollTop < 2 }
    })
    console.log(name, '日 ->', JSON.stringify(label), '|', r ? `${r.id} top ${r.top}px below the screen top (margin ${r.margin})${r.end ? ', page at its end' : ''}` : 'no card')
  } else console.log(name, '日: no "all words" button')
  await ctx.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
