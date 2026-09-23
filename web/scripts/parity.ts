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
import type { SearchResponse } from '../src/api'

interface Golden {
  search: { q: string; lang: string; out: SearchResponse }[]
  bulgarian: { text: string; normalized: string; terms: string[]; spelling: number; candidates: string[] }[]
  draw: { char: string; strokes: number[][][]; out: { char: string }[] }[]
  radicals: { r: string[]; out: { kanji: string[]; available: string[]; total: number } }[]
  wordsFor: { char: string; out: number[] }[]
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
const store: EntryStore = {
  words: async (ids) => new Map(ids.flatMap((id) => (words.has(id) ? [[id, words.get(id)!]] : []))),
  strokes: async (c) => strokes[c] ?? null,
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
for (const { q, lang, out } of golden.search) {
  const s = performance.now()
  const got = await engine.search(q, 30, lang)
  searchMs += performance.now() - s
  const shape = (r: SearchResponse) => ({
    interpretation: r.interpretation,
    alternatives: r.alternatives,
    kanji: r.kanji.map((k) => k.char),
    words: r.words.map((w) => w.id),
    inflection: r.words.map((w) => w.inflection ?? null),
    total: r.total,
  })
  if (!same(shape(out), shape(got))) note('search', `${JSON.stringify(q)} (${lang})`, shape(out), shape(got))
  else if (!same(out, got)) note('search entry', `${JSON.stringify(q)} (${lang})`, out, got)
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

let radOk = 0
for (const { r, out } of golden.radicals) {
  const got = engine.searchByRadicals(r)
  const pick = (x: { kanji: string[]; available: string[]; total: number }) => [x.kanji, x.available, x.total]
  if (same(pick(out), pick(got))) radOk++
  else note('radicals', r.join(''), pick(out), pick(got))
}
console.log(`radicals: ${radOk}/${golden.radicals.length} identical`)

let wfOk = 0
for (const { char, out } of golden.wordsFor) {
  const got = (await engine.wordsFor(char)).words.map((w) => w.id)
  if (same(out, got)) wfOk++
  else note('words-for', char, out, got)
}
console.log(`words-for: ${wfOk}/${golden.wordsFor.length} identical`)

for (const f of failures.slice(0, 40)) console.log(f)
if (failures.length > 40) console.log(`... and ${failures.length - 40} more`)
process.exit(failures.length ? 1 : 0)
