import { chromium } from 'playwright'
const browser = await chromium.launch()
const errors = []
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 900 }, true], ['desk', { width: 1400, height: 900 }, false]]) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const c of ['上', '生', '見']) {
    await page.goto(`http://localhost:8000/kanji/${encodeURIComponent(c)}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.meanings-readings', { timeout: 15000 })
    const rows = page.locator('.meanings-readings p')
    const links = await page.locator('.meanings-readings .yomi-link').evaluateAll((b) => b.map((x) => x.textContent + '→' + x.title))
    const plainKun = await rows.nth(1).locator('.reading-chip:not(:has(.yomi-link))').allTextContents()
    console.log(name, c, 'links:', links.join(' | '), '\n   unlinked kun:', plainKun.join(' '))
    if (name === 'desk' || c === '上') await page.locator('.meanings-readings').first().screenshot({ path: `C:/tmp/shots/kun-${name}-${c}.png` })
  }
  // click the first link on 上 and see the word open
  await page.goto(`http://localhost:8000/kanji/${encodeURIComponent('上')}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.meanings-readings .yomi-link')
  const first = page.locator('.meanings-readings .yomi-link').first()
  const t = await first.getAttribute('title')
  await first.click()
  await page.waitForTimeout(1500)
  console.log(name, 'clicked', t, '→ url', page.url())
  await page.screenshot({ path: `C:/tmp/shots/kun-${name}-after-click.png` })
  await page.close()
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
