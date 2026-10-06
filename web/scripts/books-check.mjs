// Usage: SANDBOX=<sandbox dir> node scripts/books-check.mjs [base]  (against tests/sandbox.py --dir <sandbox dir>)
// After tests/load_sandbox.py with the print dictionaries beside the repo
// (pipeline/book_sources.py): each kind of card shows what the books say, a
// card opens its page's scan by itself, "use this split" fills the answer, and a book's
// term goes into a Bulgarian card with a click.
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { call, signedIn as signIn } from './session.mjs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? 'C:/tmp/shots'
const browser = await chromium.launch()
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = await signIn(browser, BASE, 'admin@example.com', errors, { viewport: { width: 1300, height: 1000 } })
await admin.goto(`${BASE}/review`, { waitUntil: 'networkidle' })

/** The first open item of a type the test wants, found through the API as the page would. */
async function find(type, want) {
  const q = await call(admin, `/api/review/queue?type=${type}&limit=200`)
  return q.items.find(want)
}

async function open(slug, item) {
  await admin.goto(`${BASE}/review/queue/${slug}/${item.id}`, { waitUntil: 'networkidle' })
  await wait(1200)
}

/** The card opens its entry's first page by itself. */
async function pageOpens(shot) {
  await admin.waitForSelector('.book-scan img', { timeout: 10000 })
  await wait(300)
  const w = await admin.locator('.book-scan img').first().evaluate((img) => img.naturalWidth)
  console.log('  scan loaded, natural width:', w)
  await admin.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true })
}

console.log('a decomposition the book proposes')
const fresh = await find('decomposition', (i) => i.source === 'tsalta-diff')
await open('parts', fresh)
console.log('  book panel:', (await admin.locator('.book-src').first().textContent()).slice(0, 120))
await pageOpens('books-1-decomp-new')

console.log('an existing decomposition item with the book beside it')
const beside = await find('decomposition', (i) => i.source !== 'tsalta-diff' && i.evidence?.book?.split && i.proposed &&
  [...i.evidence.book.split].sort().join('') !== [...i.proposed].sort().join('') &&
  [...i.evidence.book.split].sort().join('') !== [...(i.current ?? [])].sort().join(''))
await open('parts', beside)
const use = admin.getByRole('button', { name: 'use this split' })
console.log('  ', beside.subject, 'proposed', beside.proposed.join(''), 'book', beside.evidence.book.split.join(''), '| use button:', await use.count())
await use.click()
await wait(300)
console.log('  answer after use:', await admin.locator('.queue-edit input.assoc-text').first().inputValue())
await admin.screenshot({ path: `${SHOTS}/books-2-decomp-beside.png`, fullPage: true })

console.log('an old form from the book')
const old = await find('form_link', (i) => i.source === 'tsalta')
await open('forms', old)
console.log('  ', old.subject, '|', (await admin.locator('.book-src').first().textContent()).slice(0, 100))
await admin.screenshot({ path: `${SHOTS}/books-3-old-form.png`, fullPage: true })

console.log('a part meaning with the book names')
const part = await find('part_meaning', (i) => i.evidence?.book)
await open('part-meanings', part)
console.log('  ', part.subject, '|', (await admin.locator('.book-part-panel').first().textContent()).slice(0, 140))
await admin.screenshot({ path: `${SHOTS}/books-4-part.png`, fullPage: true })

console.log('a kanji Bulgarian card: the keyword is added with a click')
const kb = await find('bg', (i) => i.subject.startsWith('kanji:') && i.evidence?.book &&
  !i.proposed.some((m) => m.toLowerCase() === i.evidence.book.keyword))
if (kb) {
  await open('bulgarian', kb)
  const before = await admin.locator('.bg-meaning input').count()
  await admin.locator('.book-src .book-add').first().click()
  await wait(200)
  const after = await admin.locator('.bg-meaning input').evaluateAll((els) => els.map((e) => e.value))
  console.log('  ', kb.subject, 'keyword', kb.evidence.book.keyword, '| fields', before, '->', after.length, after.at(-1))
  await admin.screenshot({ path: `${SHOTS}/books-5-kanji-bg.png`, fullPage: true })
} else console.log('  (the first 200 kanji cards all have the keyword already)')

console.log('a word Bulgarian card: a book term goes into a sense')
// Word cards come after every kanji card, past what one queue page holds: found in the sandbox's store.
const store = new DatabaseSync(`${process.env.SANDBOX}/review/review.db`, { readOnly: true })
const wb = store
  .prepare("SELECT body FROM item WHERE type = 'bg' AND status = 'open' AND subject LIKE 'word:%' AND body LIKE '%\"book\":[%' LIMIT 400")
  .all()
  .map((r) => JSON.parse(r.body))
  .find((i) => i.proposed.length > 1 && i.evidence.book.some((g) => !i.proposed.join(';').includes(g.bg.split(',')[0].trim())))
await open('bulgarian', wb)
const add = admin.locator('.book-term:not([data-has]) .book-add').first()
if (await add.count()) {
  const term = await add.locator('xpath=..').locator('span[lang="bg"]').first().textContent()
  await add.click()
  await wait(200)
  const first = await admin.locator('.bg-input').first().inputValue()
  console.log('  ', wb.subject, '| added', term, '| sense 1 now:', first)
} else console.log('  ', wb.subject, '| every book term is already in the glosses')
await pageOpens('books-6-word-bg')

const user = await signIn(browser, BASE, 'someone@example.com', errors)
const res = await user.evaluate(() =>
  fetch('/api/review/book/kanji/61', { headers: { Authorization: `Bearer ${localStorage.getItem('betterrtk:session')}` } }).then((r) => r.status),
)
console.log('a plain user asking for a page gets', res)

console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
