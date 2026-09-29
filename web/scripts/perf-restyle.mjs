// Usage: KANJI=木 node scripts/perf-restyle.mjs [base=http://localhost:8000] [assoc|components|dict|comp-from-dict] [cpuThrottle=4] [stacks]
// One phone tab turn as a timeline: style recalcs with their element counts, view-transition phases,
// frame gaps; with `stacks`, which invalidation caused each recalc, by phase (click, update, end).
import { chromium, devices } from 'playwright'
const BASE = process.argv[2] ?? 'http://localhost:8000'
const MODE = process.argv[3] ?? 'components'
const RATE = Number(process.argv[4] ?? 4)
const STACKS = process.argv[5] === 'stacks'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en' })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function tapEl(loc) {
  const b = await loc.boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] })
  await wait(50)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const tab = (name) => page.locator('.phone-tabs button', { hasText: name })
await page.goto(BASE + '/kanji/' + encodeURIComponent(process.env.KANJI ?? '永'), { waitUntil: 'networkidle' })
await wait(1000)
let target
if (MODE === 'components') { await tapEl(tab('Associations')); target = 'Components' }
if (MODE === 'assoc') { target = 'Associations' }
if (MODE === 'dict') { await tapEl(tab('Components')); target = 'Dictionary' }
if (MODE === 'comp-from-dict') { target = 'Components' }
await wait(1200)
console.log('graph nodes', await page.evaluate(() => document.querySelectorAll('.graph-svg .node').length), 'svg elements', await page.evaluate(() => document.querySelector('.graph-svg')?.getElementsByTagName('*').length), 'all', await page.evaluate(() => document.getElementsByTagName('*').length))
const cats = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink', 'v8.execute']
if (STACKS) cats.push('disabled-by-default-devtools.timeline.stack', 'disabled-by-default-devtools.timeline.invalidationTracking')
await browser.startTracing(page, { categories: cats })
await tapEl(tab(target))
await wait(1000)
const buf = await browser.stopTracing()
const { traceEvents } = JSON.parse(buf.toString())
const xs = traceEvents.filter((e) => e.ph === 'X' && e.dur).sort((a, b) => a.ts - b.ts)
const t0 = xs.find((e) => e.name === 'EventDispatch' && /touchend/.test(e.args?.data?.type ?? ''))?.ts ?? xs[0].ts
console.log('--- timeline (ms from touchend), events >= 2ms')
const seen = new Set()
for (const e of xs) {
  const d = e.dur / 1000
  if (d < 2 || (e.ts - t0) / 1000 > 520) continue
  if ((e.ts - t0) / 1000 > 100 && d < 6) continue
  if (['LocalFrameView::RunStyleAndLayoutLifecyclePhases', 'LocalFrameView::UpdateStyleAndLayout', 'Blink.Style.UpdateTime', 'Document::updateStyle', 'Document::recalcStyle', 'Blink.Paint.UpdateTime', 'Blink.CompositingCommit.UpdateTime'].includes(e.name)) continue
  let extra = ''
  if (e.name === 'UpdateLayoutTree') extra = ' elements=' + e.args?.elementCount
  if (e.name === 'Layout') extra = ' dirty=' + e.args?.beginData?.dirtyObjects + '/' + e.args?.beginData?.totalObjects
  if (e.name === 'EventDispatch') extra = ' ' + e.args?.data?.type
  if (e.name === 'FunctionCall') extra = ' ' + (e.args?.data?.functionName ?? '') + ' ' + String(e.args?.data?.url ?? '').split('/').pop() + ':' + (e.args?.data?.lineNumber ?? '')
  console.log(String(((e.ts - t0) / 1000).toFixed(1)).padStart(7), String(d.toFixed(1)).padStart(6), e.name + extra)
  if (STACKS && (e.name === 'UpdateLayoutTree' || e.name === 'Layout') && e.args?.beginData?.stackTrace) {
    for (const f of e.args.beginData.stackTrace.slice(0, 6)) console.log('             at', f.functionName, String(f.url).split('/').pop() + ':' + f.lineNumber)
  }
}
if (STACKS) {
  console.log('--- style invalidations (reason: count)')
  const inv = new Map()
  for (const e of traceEvents) {
    if (e.name !== 'StyleRecalcInvalidationTracking' && e.name !== 'StyleInvalidatorInvalidationTracking' && e.name !== 'ScheduleStyleInvalidationTracking') continue
    if ((e.ts - t0) / 1000 > 700 || e.ts < t0 - 1000) continue
    const d = e.args?.data ?? {}
    const at = (e.ts - t0) / 1000
    const bucket = at < 35 ? 'A:click' : at < 200 ? 'B:update' : 'C:end'
    const k = bucket + ' ' + e.name.replace('Tracking', '') + ' ' + (d.reason ?? '') + ' ' + (d.changedAttribute ?? d.changedClass ?? d.changedPseudo ?? '') + ' ' + (d.selectorPart ?? '') + ' @' + (d.nodeName ?? '') + (d.subtree ? ' subtree' : '')
    inv.set(k, (inv.get(k) ?? 0) + 1)
  }
  for (const [k, v] of [...inv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(String(v).padStart(5), k)
}
const frames = traceEvents.filter((e) => e.name === 'DrawFrame').map((e) => e.ts).sort((a, b) => a - b)
const gaps = []
for (let i = 1; i < frames.length; i++) gaps.push(Math.round((frames[i] - frames[i - 1]) / 1000))
console.log('frame gaps ms', gaps.filter((g) => g > 0).slice(0, 40).join(' '))
await browser.close()
