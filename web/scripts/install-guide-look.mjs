// Usage: node scripts/install-guide-look.mjs [base=http://localhost:5174] [outDir=..]
// The install guide as Safari on an iPhone shows it, whole, en + bg:
// install-guide-<lang>.png (the panel unrolled) and install-guide-<lang>-screen.png (first screen).
import { webkit, devices } from 'playwright'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5174'
const OUT = process.argv[3] ?? '..'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await webkit.launch()
for (const lang of ['en', 'bg']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: lang })
  await ctx.addInitScript((l) => localStorage.setItem('betterrtk:lang', l), lang)
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const panel = page.locator('.install-panel')
  await panel.waitFor()
  await page.evaluate(() => document.querySelectorAll('.install-panel img').forEach((i) => (i.loading = 'eager')))
  await wait(800)
  await page.screenshot({ path: path.join(OUT, `install-guide-${lang}-screen.png`) })
  // Unrolled: the panel's own scroll taken off, so one picture holds every step.
  await page.evaluate(() => {
    const p = document.querySelector('.install-panel')
    for (let e = p; e && e !== document.body; e = e.parentElement) {
      e.style.maxHeight = 'none'
      e.style.height = 'auto'
      e.style.overflow = 'visible'
      e.style.position = e === p ? 'relative' : 'static'
      e.style.transform = 'none'
    }
  })
  await wait(500)
  await panel.screenshot({ path: path.join(OUT, `install-guide-${lang}.png`) })
  console.log(lang, 'ok')
  await ctx.close()
}
await browser.close()
