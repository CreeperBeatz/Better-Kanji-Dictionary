/**
 * Does the device answer as the server does? Run by tests/offline_parity.py,
 * which asks the server's own functions first and hands the answers over:
 *
 *   node parity.mjs <pack dir> <golden.json>
 *
 * Node only, bundled by the Python side; not part of the app.
 */

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { Engine, type EntryStore, type KanjiPack, type RawWord } from '../src/local/engine'
import { normalize, shlyokavitsa, spelling, terms } from '../src/local/bulgarian'
import type { KanjiPage, SearchOrder, SearchResponse, SearchSort } from '../src/api'

interface Golden {
  search: { q: string; lang: string; common: boolean; sort: SearchSort; order: SearchOrder; out: SearchResponse }[]
  bulgarian: { text: string; normalized: string; terms: string[]; spelling: number; candidates: string[] }[]
  draw: { char: string; strokes: number[][][]; out: { char: string }[] }[]
  wordsFor: { char: string; out: number[] }[]
  readingWords: { char: string; out: Record<string, number> }[]
  kanjiPage: { char: string; out: KanjiPage }[]
  describe: { chars: string[]; out: unknown[] }
}

const [dir, goldenPath] = process.argv.slice(2)
const read = (name: string) => gunzipSync(readFileSync(join(dir, `${name}.gz`)))
const manifest = JSON.parse(readFileSync(join(dir, '..', 'current.json'), 'utf8')) as { files: { name: string }[] }

const words = new Map<number, RawWord>()
for (const f of manifest.files) {
  if (!f.name.startsWith('words-')) continue
  for (const w of JSON.parse(read(f.name).toString('utf8')) as RawWord[]) words.set(w[0], w)
}
const strokes = JSON.parse(read('strokes.json').toString('utf8')) as Record<string, string[]>
const pages = JSON.parse(read('pages.json').toString('utf8')) as Record<string, unknown>
const store: EntryStore = {
  words: async (ids) => new Map(ids.flatMap((id) => (words.has(id) ? [[id, words.get(id)!]] : []))),
  strokes: async (c) => strokes[c] ?? null,
  page: async (c) => pages[c] ?? null,
}
const index = read('index.bin')
const buf = index.buffer.slice(index.byteOffset, index.byteOffset + index.byteLength)
const t0 = performance.now()
const engine = new Engine(buf, JSON.parse(read('kanji.json').toString('utf8')) as KanjiPack, store)
console.log(`engine loaded in ${(performance.now() - t0).toFixed(0)} ms`)

const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden
const failures: string[] = []
// Key order is not part of the answer: the server adds `pitch` last.
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canonical(x)]))
      : v
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

function note(kind: string, what: string, want: unknown, got: unknown) {
  failures.push(`${kind} ${what}\n    server: ${JSON.stringify(want)}\n    device: ${JSON.stringify(got)}`)
}

let searchMs = 0
let exact = 0
for (const { q, lang, common, sort, order, out } of golden.search) {
  const s = performance.now()
  const got = await engine.search(q, 30, lang, common, sort, order)
  searchMs += performance.now() - s
  const shape = (r: SearchResponse) => ({
    interpretation: r.interpretation,
    alternatives: r.alternatives,
    kanji: r.kanji.map((k) => k.char),
    words: r.words.map((w) => w.id),
    inflection: r.words.map((w) => w.inflection ?? null),
    total: r.total,
  })
  const what = `${JSON.stringify(q)} (${lang}${common ? ', common' : ''}, ${sort} ${order})`
  if (!same(shape(out), shape(got))) note('search', what, shape(out), shape(got))
  else if (!same(out, got)) note('search entry', what, out, got)
  else exact++
}
console.log(`search: ${exact}/${golden.search.length} identical, ${(searchMs / golden.search.length).toFixed(1)} ms per query`)

let bgOk = 0
for (const b of golden.bulgarian) {
  const got = {
    text: b.text,
    normalized: normalize(b.text),
    terms: terms(b.text),
    spelling: spelling(b.text),
    candidates: shlyokavitsa(b.text).slice(0, b.candidates.length),
  }
  if (same(b, got)) bgOk++
  else note('bulgarian', JSON.stringify(b.text), b, got)
}
console.log(`bulgarian text: ${bgOk}/${golden.bulgarian.length} identical`)

let drawOk = 0
let drawTop = 0
let drawMs = 0
for (const { char, strokes: ink, out } of golden.draw) {
  const s = performance.now()
  const got = engine.recognize(ink)
  drawMs += performance.now() - s
  const a = out.map((c) => c.char)
  const b = got.map((c) => c.char)
  if (same(a, b)) drawOk++
  else note('draw', char, out.map((c) => [c.char, (c as { score?: number }).score]), got.map((c) => [c.char, c.score]))
  if (a[0] === b[0]) drawTop++
}
console.log(
  `draw: ${drawOk}/${golden.draw.length} identical lists, ${drawTop} same first pick, ` +
    `${(drawMs / golden.draw.length).toFixed(1)} ms per drawing`,
)

{
  const { chars, out } = golden.describe
  const got = engine.describe(chars)
  if (!same(out, got)) note('describe', chars.join(''), out, got)
  console.log(`describe: ${same(out, got) ? 'identical' : 'DIFFERENT'} (${out.length} of ${chars.length} described)`)
}

let wfOk = 0
for (const { char, out } of golden.wordsFor) {
  const got = (await engine.wordsFor(char)).words.map((w) => w.id)
  if (same(out, got)) wfOk++
  else note('words-for', char, out, got)
}
console.log(`words-for: ${wfOk}/${golden.wordsFor.length} identical`)

let rwOk = 0
for (const { char, out } of golden.readingWords) {
  const got = Object.fromEntries(Object.entries((await engine.readingWords(char)).words).map(([r, w]) => [r, w.id]))
  const keys = [...new Set([...Object.keys(out), ...Object.keys(got)])].sort()
  if (keys.every((k) => out[k] === got[k])) rwOk++
  else note('reading-words', char, out, got)
}
console.log(`reading-words: ${rwOk}/${golden.readingWords.length} identical`)

/** Where two answers first part: the path, and each side's value there. */
function firstDiff(a: unknown, b: unknown, at = ''): [string, unknown, unknown] {
  if (JSON.stringify(a) === JSON.stringify(b)) return ['', a, b]
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const x = a as Record<string, unknown>
    const y = b as Record<string, unknown>
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) return firstDiff(x[k], y[k], `${at}.${k}`)
    }
  }
  return [at || '.', a, b]
}

// A page the pack lacks must be one with nothing on it: the device answers null and the server is asked.
let kpOk = 0
let kpNone = 0
let kpMs = 0
const empty = (p: KanjiPage) =>
  !p.meanings.length && !p.link && !Object.keys(p.readings).length && !p.special.length && !p.soundOnly && !p.mixups.length
for (const { char, out } of golden.kanjiPage) {
  const s = performance.now()
  const got = await engine.kanjiPage(char)
  kpMs += performance.now() - s
  if (got === null && empty(out)) kpNone++
  else if (same(out, got)) kpOk++
  else {
    const [where, want, have] = firstDiff(canonical(out), canonical(got))
    note('kanji-page', `${char} at ${where}`, want, have)
  }
}
console.log(
  `kanji-page: ${kpOk}/${golden.kanjiPage.length} identical, ${kpNone} empty and not in the pack, ` +
    `${(kpMs / golden.kanjiPage.length).toFixed(1)} ms per page`,
)

for (const f of failures.slice(0, 40)) console.log(f)
if (failures.length > 40) console.log(`... and ${failures.length - 40} more`)
process.exit(failures.length ? 1 : 0)
