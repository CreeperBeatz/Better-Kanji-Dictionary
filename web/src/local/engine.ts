/**
 * Search, handwriting, radicals and levels, answered on the device from the
 * offline pack -- the same questions the server's routes answer, in the same
 * shapes, so the UI cannot tell which one it asked.
 *
 * `search` follows server/routes/search.py step for step, down to which rows
 * a LIMIT cuts off and how ties fall: the point is that a query finds the same
 * words here as there. Only the indexes live in memory; entries are read from
 * the store for the handful of results actually shown.
 */

import type {
  DrawCandidate,
  KanjiHit,
  KanjiNode,
  RadicalGroup,
  RadicalSearchResponse,
  SearchResponse,
  Word,
  WordEntry,
} from '../api'
import { bestReading, hasCyrillic, isLatinQuery, terms as bgTerms } from './bulgarian'
import { FtsIndex, phrasesOf, type Phrase } from './fts'
import { deinflect, hasJapanese, posMatches, pySplit, pyStrip, romajiToKana, type Candidate } from './japanese'
import { Recognizer, MAX_RESULTS, STROKE_WINDOW } from './recognize'
import { compareCodePoints, readSections, SortedStrings, starts } from './sections'

/** char, strokes, grade, freq, jlpt, joyo, inKanjidic, meanings, onYomi, kunYomi, fanout, curated, meaningsBg */
type KanjiRow = [
  string, number | null, number | null, number | null, number | null, number, number,
  string[], string[], string[], number, string | null, (string[] | null)?,
]

export interface LevelResponse {
  level: number
  kanji: KanjiNode[]
  components: KanjiNode[]
  counts: { kanji: number; components: number }
}

export interface KanjiPack {
  kanji: KanjiRow[]
  /** char, stroke feature codes, pen moves between strokes, seams when one is dropped */
  glyphs: [string, number[], number[], number[]][]
  /** (fewer / more strokes) ** LENGTH_POWER for every pair of counts, as the server computes it. */
  strokePower: { size: number; values: number[] }
  radicals: { groups: RadicalGroup[]; total: number }
  kanjiRadicals: Record<string, string[]>
  levels: Record<string, LevelResponse>
  wordsFor: Record<string, number[]>
}

/** id, headword, reading, common, nf, pitch, senses [pos, misc, gloss, glossBg], forms [text, kana, rare] */
export type RawWord = [
  number, string, string, number, number | null, string | null,
  [string | null, string | null, string, (string | null)?][], [string, number, number][],
]

/** Where the entries and stroke paths are kept: IndexedDB in the app, memory in tests. */
export interface EntryStore {
  words(ids: number[]): Promise<Map<number, RawWord>>
  strokes(char: string): Promise<string[] | null>
}

const NO_INDEX = 0xffffffff

function toWord(r: RawWord): Word {
  return {
    id: r[0],
    headword: r[1],
    reading: r[2],
    common: !!r[3],
    nf: r[4],
    pitch: r[5],
    // Rows from a pack before Bulgarian have no fourth field; the words store
    // is not versioned, so they can still be there.
    senses: r[6].map(([pos, misc, gloss, glossBg]) => ({
      pos: pos ? pos.split(',') : [],
      misc: misc ? misc.split(',') : [],
      gloss,
      glossBg: glossBg ?? null,
    })),
    forms: r[7].map(([text, kana, rare]) => ({ text, kana: !!kana, rare: !!rare })),
  }
}

function toNode(r: KanjiRow): KanjiNode {
  return {
    char: r[0],
    strokes: r[1],
    grade: r[2],
    freq: r[3],
    jlpt: r[4],
    joyo: !!r[5],
    inKanjidic: !!r[6],
    meanings: r[7],
    meaningsBg: r[12] ?? null,
    onYomi: r[8],
    kunYomi: r[9],
    fanout: r[10],
  }
}

function isCjk(c: string): boolean {
  return c >= '一' && c <= '鿿'
}

/** The server's Bulgarian query: every stem a quoted phrase of its own. */
function bgPhrases(stems: string[]): Phrase[] {
  return phrasesOf(stems)
}

/** Python's dict.fromkeys over a list: first occurrences, in order. */
function distinct(xs: number[]): number[] {
  return [...new Set(xs)]
}

export class Engine {
  private readonly store: EntryStore
  private readonly pack: KanjiPack

  // words, by index; ids ascending, so index order is id order
  private readonly ids: Uint32Array
  private readonly common: Uint8Array
  private readonly nf: Uint8Array
  private readonly hwlen: Uint8Array
  private readonly pos: Uint8Array

  // every form, sorted, with the words written that way
  private readonly forms: SortedStrings
  private readonly formWstart: Uint32Array
  private readonly formWord: Uint32Array

  private readonly gloss: FtsIndex
  private readonly glossWord: Uint32Array
  private readonly kfts: FtsIndex
  private readonly kftsChar: Uint32Array
  // Bulgarian glosses and kanji meanings, indexed by stem
  private readonly bgGloss: FtsIndex
  private readonly bgGlossWord: Uint32Array
  private readonly bgKfts: FtsIndex
  private readonly bgKftsChar: Uint32Array

  private readonly kanjiAt = new Map<string, number>()
  private readonly byRadical = new Map<string, Set<string>>()
  private recognizer: Recognizer | null = null

  constructor(index: ArrayBuffer, pack: KanjiPack, store: EntryStore) {
    this.store = store
    this.pack = pack
    const s = readSections(index)

    this.ids = s.u32('word.id')
    this.common = s.u8('word.common')
    this.nf = s.u8('word.nf')
    this.hwlen = s.u8('word.len')
    this.pos = s.u8('word.pos')

    this.forms = new SortedStrings(s.text('form.text'), starts(s.u8('form.len')))
    this.formWstart = starts(s.u8('form.count'))
    this.formWord = s.u32('form.word')

    this.gloss = new FtsIndex(
      new SortedStrings(s.text('gloss.term'), starts(s.u8('gloss.tlen'))),
      s.u32('gloss.pstart'), s.u32('gloss.doc'), s.u8('gloss.tf'), s.u8('gloss.pos'), s.u16('gloss.doclen'),
    )
    this.glossWord = s.u32('gloss.docword')
    this.kfts = new FtsIndex(
      new SortedStrings(s.text('kfts.term'), starts(s.u8('kfts.tlen'))),
      s.u32('kfts.pstart'), s.u32('kfts.doc'), s.u8('kfts.tf'), s.u8('kfts.pos'), s.u16('kfts.doclen'),
    )
    this.kftsChar = s.u32('kfts.docchar')
    this.bgGloss = new FtsIndex(
      new SortedStrings(s.text('bggloss.term'), starts(s.u8('bggloss.tlen'))),
      s.u32('bggloss.pstart'), s.u32('bggloss.doc'), s.u8('bggloss.tf'), s.u8('bggloss.pos'), s.u16('bggloss.doclen'),
    )
    this.bgGlossWord = s.u32('bggloss.docword')
    this.bgKfts = new FtsIndex(
      new SortedStrings(s.text('bgkfts.term'), starts(s.u8('bgkfts.tlen'))),
      s.u32('bgkfts.pstart'), s.u32('bgkfts.doc'), s.u8('bgkfts.tf'), s.u8('bgkfts.pos'), s.u16('bgkfts.doclen'),
    )
    this.bgKftsChar = s.u32('bgkfts.docchar')

    pack.kanji.forEach((r, i) => this.kanjiAt.set(r[0], i))
    for (const [kanji, radicals] of Object.entries(pack.kanjiRadicals)) {
      for (const r of radicals) {
        let set = this.byRadical.get(r)
        if (!set) this.byRadical.set(r, (set = new Set()))
        set.add(kanji)
      }
    }
  }

  get wordCount(): number {
    return this.ids.length
  }

  private row(char: string): KanjiRow | undefined {
    const i = this.kanjiAt.get(char)
    return i === undefined ? undefined : this.pack.kanji[i]
  }

  private indexOfId(id: number): number {
    let lo = 0
    let hi = this.ids.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ids[mid] < id) lo = mid + 1
      else hi = mid
    }
    return lo < this.ids.length && this.ids[lo] === id ? lo : -1
  }

  private wordsOfForm(i: number): Uint32Array {
    return this.formWord.subarray(this.formWstart[i], this.formWstart[i + 1])
  }

  private async fetchWords(indices: number[]): Promise<Word[]> {
    const raw = await this.store.words(indices.map((i) => this.ids[i]))
    const out: Word[] = []
    for (const i of indices) {
      const r = raw.get(this.ids[i])
      if (r) out.push(toWord(r))
    }
    return out
  }

  // ------------------------------------------------------------ search

  /**
   * `SELECT DISTINCT word_id, text FROM word_form WHERE text IN (...) LIMIT n`,
   * then ordered by where each text came in `texts`. SQLite walks the IN list
   * in sorted order and the LIMIT cuts there, before the reordering.
   */
  private byForm(texts: string[], limit: number): number[] {
    if (!texts.length) return []
    const order = new Map<string, number>()
    texts.forEach((t, i) => order.set(t, i)) // the last occurrence wins, as in the dict
    const rows: [number, string][] = []
    const sorted = [...new Set(texts)].sort(compareCodePoints)
    outer: for (const t of sorted) {
      const f = this.forms.indexOf(t)
      if (f < 0) continue
      for (const w of this.wordsOfForm(f)) {
        if (rows.length >= limit * 4) break outer
        rows.push([w, t])
      }
    }
    rows.sort((a, b) => (order.get(a[1]) ?? 99) - (order.get(b[1]) ?? 99))
    return rows.map((r) => r[0])
  }

  private rankKey(i: number): [number, number, number] {
    return [this.common[i] ? 0 : 1, this.nf[i] || 99, this.hwlen[i]]
  }

  /** How many Bulgarian glosses and kanji hold a stem: the server's fts5vocab sum. */
  private bgDocs = (stem: string): number => this.bgGloss.docs(stem) + this.bgKfts.docs(stem)

  /** The Cyrillic a Latin query most likely stands for, or null. */
  private shlyokavitsa(q: string): string | null {
    const readings: string[] = []
    for (const word of pySplit(q)) {
      const r = bestReading(word, this.bgDocs)
      if (r === null) return null
      readings.push(r)
    }
    return readings.join(' ') || null
  }

  /** Words whose Bulgarian glosses hold every stem, best match first. */
  private bulgarianWords(stems: string[], limit: number): number[] {
    if (!stems.length) return []
    return distinct(this.bgGloss.search(bgPhrases(stems), limit * 8).map((d) => this.bgGlossWord[d]))
  }

  async search(input: string, limit = 30, lang = 'en'): Promise<SearchResponse> {
    const q = pyStrip(input)
    if (!q) return { query: q, interpretation: null, alternatives: [], kanji: [], words: [], total: 0 }

    let wordIdx: number[] = []
    let interpretation: SearchResponse['interpretation'] = null
    const alternatives: SearchResponse['alternatives'] = []
    const inflections = new Map<number, string[]>()
    let bgStems: string[] | null = null // set when the words were found in Bulgarian

    const japanese = hasJapanese(q)
    const cyrillic = !japanese && hasCyrillic(q)
    let kanaGuess = japanese || cyrillic ? '' : romajiToKana(q)
    const latinBg = lang === 'bg' && !japanese && !cyrillic && isLatinQuery(q)

    if (cyrillic) {
      bgStems = bgTerms(q)
      wordIdx = this.bulgarianWords(bgStems, limit)
      interpretation = { kind: 'bulgarian' }
    }

    if (japanese || kanaGuess) {
      const target = japanese ? q : kanaGuess
      if (kanaGuess) interpretation = { kind: 'romaji', reading: kanaGuess }

      const candidates = deinflect(target)
      const hits = this.byForm(candidates.map((c) => c.text), limit)

      const byText = new Map<string, Candidate[]>()
      for (const c of candidates) {
        const list = byText.get(c.text)
        if (list) list.push(c)
        else byText.set(c.text, [c])
      }
      // Which words have each candidate as one of their forms -- what the
      // server learns by fetching every hit's forms.
      const holders = new Map<string, Set<number>>()
      for (const t of byText.keys()) {
        const f = this.forms.indexOf(t)
        holders.set(t, new Set(f < 0 ? [] : this.wordsOfForm(f)))
      }

      const checked: number[] = []
      for (const w of hits) {
        const matched: Candidate[] = []
        for (const [t, cs] of byText) if (holders.get(t)!.has(w)) matched.push(...cs)
        if (!matched.length) continue
        let ok = matched.filter((c) => !c.reasons.length)
        if (!ok.length) ok = matched.filter((c) => posMatches(this.pos[w], c.types))
        if (ok.length) {
          let best = ok[0]
          for (const c of ok) if (c.reasons.length < best.reasons.length) best = c
          inflections.set(w, best.reasons)
          checked.push(w)
        }
      }

      wordIdx = checked
      if (latinBg) {
        const reading = this.shlyokavitsa(q)
        const found = reading ? this.bulgarianWords(bgTerms(reading), limit) : []
        if (wordIdx.length && found.length) {
          // Romaji won, but the Bulgarian reading is one tap away.
          alternatives.push({ kind: 'bulgarian', query: reading! })
        } else if (found.length) {
          wordIdx = found
          bgStems = bgTerms(reading!)
          interpretation = { kind: 'bulgarian', reading: reading! }
          kanaGuess = ''
        }
      }
      if (!japanese && !wordIdx.length) {
        kanaGuess = '' // romaji reading found nothing, fall through to English
        interpretation = null
      }

      // Prefix match tops up short result sets, so typing 時 still suggests 時間.
      if (bgStems === null && wordIdx.length < limit) {
        const lo = this.forms.lowerBound(target)
        const hi = this.forms.lowerBound(target + '￿')
        const extra: number[] = []
        const distinct = new Set<number>()
        scan: for (let f = lo; f < hi; f++) {
          for (const w of this.wordsOfForm(f)) {
            if (distinct.has(w)) continue
            if (extra.length >= limit * 6) break scan
            distinct.add(w)
            extra.push(w)
          }
        }
        const present = new Set(wordIdx)
        for (const w of extra) {
          if (!present.has(w)) {
            present.add(w)
            wordIdx.push(w)
          }
        }
      }
    } else if (latinBg) {
      // Latin that cannot be romaji (4ovek, voda) is Bulgarian before English.
      const reading = this.shlyokavitsa(q)
      const found = reading ? this.bulgarianWords(bgTerms(reading), limit) : []
      if (found.length) {
        wordIdx = found
        bgStems = bgTerms(reading!)
        interpretation = { kind: 'bulgarian', reading: reading! }
      }
    }

    if (!wordIdx.length && !japanese && bgStems === null) {
      const safe = pyStrip(q.replaceAll('"', ' '))
      if (safe) {
        const seen = new Set<number>()
        for (const d of this.gloss.search(phrasesOf(pySplit(safe)), limit * 8)) {
          const w = this.glossWord[d]
          if (!seen.has(w)) {
            seen.add(w)
            wordIdx.push(w)
          }
        }
        interpretation = { kind: 'english' }
      }
    }

    // The server fetches these by id -- so they come back in id order -- and
    // then sorts by rank, stably.
    const pool = [...new Set(wordIdx.slice(0, limit * 4))].sort((a, b) => a - b)
    const ranked = pool
      .map((i) => [i, ...this.rankKey(i)])
      .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
      .slice(0, limit)
      .map((r) => r[0])

    const words = await this.fetchWords(ranked)
    for (const w of words) {
      const reasons = inflections.get(this.indexOfId(w.id))
      if (reasons && reasons.length) w.inflection = reasons
    }

    return {
      query: q,
      interpretation,
      alternatives,
      kanji: this.searchKanji(q, japanese, kanaGuess, bgStems),
      words,
      total: pool.length,
    }
  }

  private searchKanji(q: string, japanese: boolean, kanaGuess: string, bgStems: string[] | null): KanjiHit[] {
    let chars: string[] = []
    if (japanese) chars = [...new Set([...q])].filter(isCjk)

    if (bgStems !== null) {
      if (bgStems.length) {
        chars = []
        for (const d of this.bgKfts.search(bgPhrases(bgStems), 80)) {
          const k = this.bgKftsChar[d]
          if (k !== NO_INDEX) chars.push(this.pack.kanji[k][0])
        }
      }
    } else if (!chars.length && !japanese && !kanaGuess) {
      const safe = pySplit(q.replaceAll('"', ' '))
      if (safe.length) {
        for (const d of this.kfts.search(phrasesOf(safe), 80)) {
          const k = this.kftsChar[d]
          if (k !== NO_INDEX) chars.push(this.pack.kanji[k][0])
        }
      }
    }
    if (!chars.length) return []

    // The server's `char IN (...)` comes back in char order, then sorts stably.
    const rows = [...new Set(chars)]
      .map((c) => this.row(c))
      .filter((r): r is KanjiRow => r !== undefined)
      .sort((a, b) => compareCodePoints(a[0], b[0]))
    rows.sort((a, b) => (a[5] ? 0 : 1) - (b[5] ? 0 : 1) || (a[3] ?? 9999) - (b[3] ?? 9999))
    return rows.slice(0, 12).map((r) => ({
      char: r[0],
      meanings: r[7],
      meaningsBg: r[12] ?? null,
      curated: r[11],
      freq: r[3],
      jlpt: r[4],
      joyo: !!r[5],
      strokes: r[1],
      fanout: r[10],
    }))
  }

  // ------------------------------------------------------------ the rest

  async wordsFor(char: string): Promise<{ char: string; words: Word[] }> {
    const ids = [...char].length === 1 ? (this.pack.wordsFor[char] ?? []) : []
    return { char, words: await this.fetchWords(ids.map((id) => this.indexOfId(id)).filter((i) => i >= 0)) }
  }

  /** What the rail shows for a character before its graph arrives. */
  async kanji(char: string): Promise<{ focus: KanjiNode; strokes: string[] } | null> {
    const r = this.row(char)
    if (!r) return null
    return { focus: toNode(r), strokes: (await this.store.strokes(char)) ?? [] }
  }

  /** A dictionary entry without its example sentences, which stay on the server. */
  async wordEntry(id: number): Promise<WordEntry | null> {
    const i = this.indexOfId(id)
    if (i < 0) return null
    const [word] = await this.fetchWords([i])
    if (!word) return null
    const chars = [...new Set([...word.headword])].filter((c) => isCjk(c) || (c >= '㐀' && c <= '䶿'))
    const kanji = chars.flatMap((c) => {
      const r = this.row(c)
      return r ? [{ ...toNode(r), curated: r[11] }] : []
    })
    return { word, kanji, examples: [] }
  }

  byLevel(level: number): LevelResponse | null {
    return this.pack.levels[String(level)] ?? null
  }

  radicals(): { groups: RadicalGroup[]; total: number } {
    return this.pack.radicals
  }

  searchByRadicals(r: string[], limit = 400): RadicalSearchResponse {
    if (!r.length) return { selected: [], kanji: [], available: [], total: 0 }
    const radicals = [...new Set(r)]

    let found: string[] | null = null
    for (const rad of radicals) {
      const set = this.byRadical.get(rad)
      if (!set) {
        found = []
        break
      }
      found = found === null ? [...set] : found.filter((k) => set.has(k))
    }
    if (!found || !found.length) return { selected: radicals, kanji: [], available: [], total: 0 }

    // ORDER BY joyo IS NULL, joyo DESC, freq IS NULL, freq, strokes, kanji --
    // where NULL is "not in the kanji table", and sorts first in ASC.
    const key = (k: string) => {
      const row = this.row(k)
      return {
        missing: row ? 0 : 1,
        joyo: row ? row[5] : 0,
        noFreq: row && row[3] !== null ? 0 : 1,
        freq: row?.[3] ?? 0,
        strokes: row?.[1] ?? -Infinity,
      }
    }
    const keyed = found.map((k) => [k, key(k)] as const)
    keyed.sort(
      ([a, x], [b, y]) =>
        x.missing - y.missing ||
        y.joyo - x.joyo ||
        x.noFreq - y.noFreq ||
        x.freq - y.freq ||
        (x.strokes === y.strokes ? 0 : x.strokes < y.strokes ? -1 : 1) ||
        compareCodePoints(a, b),
    )
    const candidates = keyed.map(([k]) => k)

    const available = new Set<string>()
    for (const k of candidates) for (const rad of this.pack.kanjiRadicals[k] ?? []) available.add(rad)

    return {
      selected: radicals,
      kanji: candidates.slice(0, limit),
      available: [...available].sort(compareCodePoints),
      total: candidates.length,
      truncated: candidates.length > limit,
    }
  }

  recognize(strokes: number[][][], window = STROKE_WINDOW, limit = MAX_RESULTS): DrawCandidate[] {
    return this.recognition().recognise(strokes, Math.max(0, Math.min(6, window)), Math.max(1, Math.min(60, limit)))
  }

  recognition(): Recognizer {
    if (!this.recognizer) {
      this.recognizer = new Recognizer(
        this.pack.glyphs,
        (c) => {
          const r = this.row(c)
          return r ? { freq: r[3], meanings: r[7], meaningsBg: r[12] ?? null } : undefined
        },
        this.pack.strokePower,
      )
    }
    return this.recognizer
  }
}
