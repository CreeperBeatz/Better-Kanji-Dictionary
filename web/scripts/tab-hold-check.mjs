// Usage: node scripts/tab-hold-check.mjs [base=http://localhost:8000]
// The phone's Dictionary tab under its unseen switch (App.tsx holdSwitch), both ways:
//  android -- the Vibration API: held 450 ms, the menu opens at once (with a buzz);
//  ios     -- no Vibration API: held, the tab rises; at the lift the switch is left on, so
//             WebKit clicks it (and ticks), and that click opens the menu -- replayed here,
//             as Chromium sends no click after a long press. A tap: the switch is off by the
//             lift (no click, no tick) and the tab is gone to. A swipe: off, no menu.
import { chromium } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const browser = await chromium.launch()
const errors = []
for (const mode of ['android', 'ios']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  if (mode === 'ios') await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.meaning')
  // What the switch is at each lift, once the app has had it (after React, before the browser's own).
  await page.evaluate(() => window.addEventListener('touchend', (e) => (window.__lift = e.target.disabled), false))
  const cdp = await ctx.newCDPSession(page)
  const tabs = page.locator('.phone-tabs > button')
  const at = async (i) => {
    const bb = await tabs.nth(i).boundingBox()
    return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }
  }
  const touch = async (pt, ms, to) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] })
    if (to) for (let k = 1; k <= 5; k++) {
      await page.waitForTimeout(ms / 5)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x + ((to.x - pt.x) * k) / 5, y: pt.y }] })
    }
    else await page.waitForTimeout(ms)
  }
  const lift = async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(80)
  }
  const selected = () => page.evaluate(() => [...document.querySelectorAll('.phone-tabs > button')].findIndex((b) => b.getAttribute('aria-selected') === 'true'))
  const menu = () => page.locator('.tab-menu').count()
  const dict = await at(1)
  console.log(mode, 'on the tab      ', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.tagName + (e.hasAttribute('switch') ? '[switch]' : '') }, [dict.x, dict.y]))
  // A tap on Dictionary from Components: the tab, no menu, the switch off by the lift.
  await tabs.nth(2).click()
  await page.waitForTimeout(500)
  await touch(dict, 80)
  await lift()
  await page.waitForTimeout(400)
  console.log(mode, 'tap             tab', await selected(), '| menu', await menu(), '| switch off at lift', await page.evaluate(() => window.__lift))
  // Held.
  await page.waitForTimeout(450)
  await touch(dict, 300)
  const pressed = await tabs.nth(1).getAttribute('data-press')
  await page.waitForTimeout(350)
  console.log(mode, 'holding         at 300ms', pressed, '| at 650ms', await tabs.nth(1).getAttribute('data-press'), '| menu', await menu())
  await lift()
  const off = await page.evaluate(() => window.__lift)
  if (mode === 'ios') await page.evaluate(() => document.querySelector('.tab-hold-switch').click()) // WebKit's click on the lift
  await page.waitForTimeout(250)
  console.log(mode, 'lifted          switch off at lift', off, '| menu', await menu(), JSON.stringify(await page.locator('.tab-menu').innerText().catch(() => '')), '| tab', await selected())
  await page.locator('.tab-menu-item').tap().catch(() => {})
  await page.waitForTimeout(400)
  console.log(mode, 'picked          menu', await menu(), '| ui', JSON.stringify(await page.locator('.facts-title').first().innerText()))
  // A swipe that starts on Dictionary: no menu, switch off.
  await page.waitForTimeout(450)
  const search = await at(0)
  await touch(dict, 300, search)
  await page.waitForTimeout(500)
  await lift()
  await page.waitForTimeout(400)
  console.log(mode, 'swipe           menu', await menu(), '| switch off at lift', await page.evaluate(() => window.__lift), '| tab', await selected())
  await cdp.detach()
  await ctx.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
