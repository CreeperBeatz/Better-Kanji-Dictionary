// Usage: node scripts/tab-switch-check.mjs [base=http://localhost:8000]
// Dictionary tapped again, on Dictionary, opens the language menu (App.tsx tabSwitch): an
// unseen switch lies over the tab there only, so an iPhone ticks for the tap (WebKit clicks
// a switch at a touch's lift); android has the Vibration API. Run both ways (ios: none):
// from another tab, a tap on Dictionary goes to it, no menu; on it, a tap opens the menu
// and another shuts it; a tap elsewhere shuts it; a swipe begun on it is no tap -- the
// switch is off by its lift (no click, no tick), no menu, and the bar still turns the tabs.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const browser = await chromium.launch()
const errors = []
for (const mode of ['android', 'ios']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  if (mode === 'ios') await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true }))
  else await ctx.addInitScript(() => (navigator.vibrate = (ms) => ((window.__buzz = (window.__buzz ?? 0) + 1), true)))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.meaning')
  await page.evaluate(() => window.addEventListener('touchend', (e) => (window.__lift = e.target.disabled), false))
  const cdp = await ctx.newCDPSession(page)
  const tabs = page.locator('.phone-tabs > button')
  const at = async (i) => {
    const bb = await tabs.nth(i).boundingBox()
    return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }
  }
  const tap = async (pt) => {
    await page.touchscreen.tap(pt.x, pt.y)
    await page.waitForTimeout(450)
  }
  const selected = () => page.evaluate(() => [...document.querySelectorAll('.phone-tabs > button')].findIndex((b) => b.getAttribute('aria-selected') === 'true'))
  const menu = () => page.locator('.tab-menu').count()
  const under = (pt) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.tagName + (e.hasAttribute('switch') ? '[switch]' : '') }, [pt.x, pt.y])
  const buzz = () => page.evaluate(() => window.__buzz ?? 0)
  const dict = await at(1)
  await tap(await at(2))
  console.log(mode, 'on Components   under Dictionary', await under(dict))
  await tap(dict)
  console.log(mode, 'tap Dictionary  tab', await selected(), '| menu', await menu(), '| under it now', await under(dict))
  await tap(dict)
  console.log(mode, 'tap it again    menu', await menu(), JSON.stringify(await page.locator('.tab-menu').innerText().catch(() => '')), '| buzz', await buzz())
  await tap(dict)
  console.log(mode, 'and again       menu', await menu())
  await tap(dict)
  await tap({ x: 200, y: 300 })
  console.log(mode, 'tap elsewhere   menu', await menu())
  await tap(dict)
  await page.locator('.tab-menu-item').tap()
  await page.waitForTimeout(400)
  console.log(mode, 'picked          menu', await menu(), '| ui', JSON.stringify(await page.locator('.facts-title').first().innerText()))
  // A swipe begun on Dictionary, toward Search.
  const search = await at(0)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [dict] })
  for (let k = 1; k <= 8; k++) {
    await page.waitForTimeout(20)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dict.x + ((search.x - dict.x) * k) / 8, y: dict.y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(700)
  console.log(mode, 'swipe from it   menu', await menu(), '| switch off at lift', await page.evaluate(() => window.__lift), '| tab', await selected())
  await cdp.detach()
  await ctx.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
