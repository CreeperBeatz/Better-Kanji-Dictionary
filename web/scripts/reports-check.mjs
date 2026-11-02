// The reports UI on tests/sandbox.py seeded by tests/seed_reports.py:
//   node scripts/reports-check.mjs [base] [owner email]
// Screenshots go to %TEMP%/bkd-reports/shots.
import { chromium } from 'playwright'
import { signedIn } from './session.mjs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const OWNER = process.argv[3] ?? 'admin@example.com'
const SHOTS = `${process.env.TEMP ?? '/tmp'}/bkd-reports/shots`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const errors = []
const browser = await chromium.launch()

// Signed out: the link is there, the dialog asks to sign in.
{
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  page.on('pageerror', (e) => errors.push(`anon: ${e}`))
  await page.goto(`${BASE}/kanji/${encodeURIComponent('生')}`, { waitUntil: 'networkidle' })
  await wait(800)
  await page.locator('.page-edit-link').first().scrollIntoViewIfNeeded()
  await page.locator('.page-edit-link').first().click()
  await wait(300)
  console.log('signed out dialog:', (await page.locator('.report-panel .hint').first().textContent())?.trim())
  await page.screenshot({ path: `${SHOTS}/1-signed-out.png` })
  await page.close()
}

// A reporter sends one with a picture.
{
  const page = await signedIn(browser, BASE, 'sam@example.com', errors)
  await page.goto(`${BASE}/kanji/${encodeURIComponent('木')}`, { waitUntil: 'networkidle' })
  await wait(800)
  const link = page.locator('.page-edit-link').first()
  console.log('link text:', (await link.textContent())?.trim())
  await link.scrollIntoViewIfNeeded()
  await link.click()
  await page.locator('#report-text').fill('The stroke order animation for 木 draws the left sweep before the vertical line.')
  await page.locator('.report-panel input[type=file]').setInputFiles(`${SHOTS}/1-signed-out.png`)
  await wait(300)
  console.log('thumbnails:', await page.locator('.report-panel .report-thumb').count())
  await page.screenshot({ path: `${SHOTS}/2-dialog.png` })
  await page.locator('.report-panel .account-submit').click()
  await wait(800)
  console.log('after send:', (await page.locator('.report-panel h2').textContent())?.trim())
  await page.screenshot({ path: `${SHOTS}/3-sent.png` })
  await page.keyboard.press('Escape')
  await page.locator('.profile-button').click()
  await wait(800)
  console.log('your reports:', await page.locator('.my-reports-list li').count())
  await page.screenshot({ path: `${SHOTS}/4-account.png` })
  await page.close()
}

// The owner's screen.
{
  const page = await signedIn(browser, BASE, OWNER, errors)
  await page.locator('.profile-button').click()
  await wait(500)
  await page.locator('.account-review').click()
  await wait(1200)
  console.log('url:', new URL(page.url()).pathname, '| rows:', await page.locator('.report-row').count(), '| tabs:', (await page.locator('.overlay-tabs button').allTextContents()).join(' / '))
  await page.screenshot({ path: `${SHOTS}/5-reports.png` })
  await page.screenshot({ path: `${SHOTS}/5-reports-full.png`, fullPage: true })
  const row = page.locator('.report-row').nth(2)
  console.log('open page link:', await row.locator('.report-open a').getAttribute('href'))
  await row.locator('.report-status-pick').selectOption('fixed')
  await row.locator('.report-reply').fill('Thank you. Fixed for 青 and 6 other kanji.')
  await page.screenshot({ path: `${SHOTS}/5b-dropdown.png` })
  await row.locator('.account-submit').click()
  await wait(600)
  console.log('open after save:', await page.locator('.report-row').count())
  await page.locator('.report-row .report-thumb').first().click()
  await wait(400)
  console.log('zoom open:', await page.locator('.image-zoom').count())
  await page.screenshot({ path: `${SHOTS}/5c-zoom.png` })
  await page.keyboard.press('Escape')
  await wait(300)
  console.log('after Escape: zoom', await page.locator('.image-zoom').count(), '| reports screen', await page.locator('.reports-body').count())
  await page.locator('.overlay-tabs button').nth(1).click()
  await wait(600)
  await page.screenshot({ path: `${SHOTS}/6-fixed.png` })
  await page.close()
}

// A phone.
{
  const page = await signedIn(browser, BASE, 'ivan@example.com', errors, { viewport: { width: 390, height: 844 } })
  await page.goto(`${BASE}/kanji/${encodeURIComponent('焼')}`, { waitUntil: 'networkidle' })
  await wait(1000)
  const link = page.locator('.page-edit-link').first()
  await link.scrollIntoViewIfNeeded()
  await link.click()
  await wait(400)
  await page.screenshot({ path: `${SHOTS}/7-phone-dialog.png` })
  await page.close()
}

console.log('errors', errors)
await browser.close()
