// Usage: node scripts/fold-frames-check.mjs [base=http://localhost:8000] -- frame by frame, in
// Chromium and WebKit (an iPhone's engine): a meaning card shutting never shows its body again
// once it is going (the one-frame flicker at the end), and opening never jumps.
import { chromium, webkit } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await engine.launch()
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: name === 'chromium', hasTouch: true })
  await p.goto(`${BASE}/kanji/%E4%B8%8A`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.meaning')
  await p.waitForTimeout(800)
  const card = p.locator('.kanji-page .meaning').nth(1)
  await card.scrollIntoViewIfNeeded()
  // Each frame: how tall the card is, and how much of its body shows.
  const watch = () =>
    card.evaluate(
      (c) =>
        new Promise((done) => {
          const seen = []
          const t0 = performance.now()
          const tick = () => {
            const body = c.querySelector('.meaning-body')
            seen.push([Math.round(c.getBoundingClientRect().height), body ? Math.round(body.getBoundingClientRect().height * Number(getComputedStyle(body).opacity)) : -1])
            if (performance.now() - t0 < 500) requestAnimationFrame(tick)
            else done(seen)
          }
          requestAnimationFrame(tick)
        }),
    )
  const shutting = watch()
  await card.locator('.meaning-toggle').click()
  const shut = await shutting
  const heights = shut.map((f) => f[0])
  // A flicker: the card taller again after it got shorter.
  const back = heights.findIndex((h, i) => i > 0 && h > heights[i - 1] + 1)
  console.log(name.padEnd(9), 'shut, card height by frame', heights.join(' '), back < 0 ? '| never grows back' : `| GROWS BACK at frame ${back}`)
  const opening = watch()
  await card.locator('.meaning-toggle').click()
  const open = (await opening).map((f) => f[0])
  const drop = open.findIndex((h, i) => i > 0 && h < open[i - 1] - 1)
  console.log(name.padEnd(9), 'open, card height by frame', open.join(' '), drop < 0 ? '| never shrinks back' : `| SHRINKS BACK at frame ${drop}`)
  await b.close()
}
