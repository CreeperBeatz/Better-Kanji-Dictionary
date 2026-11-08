/**
 * Search, handwriting and levels, answered on the device from the
 * offline pack -- the same questions the server's routes answer, in the same
 * shapes, so the UI cannot tell which one it asked.
 *
 * `search` follows server/routes/search.py step for step, down to which rows
 * a LIMIT cuts off and how ties fall: the point is that a query finds the same
 * words here as there. Only the indexes live in memory; entries are read from
 * the store for the handful of results actually shown.
 */

import type {
  KanjiPage,
  SearchOrder,
  SearchSort,
  DrawCandidate,
  KanjiHit,
  KanjiNode,
  SearchResponse,
  Word,
  WordEntry,
} from '../api'
import { bestReading, hasCyrillic, isLatinQuery, normalize as bgNormalize, spelling, stem as bgStem, terms as bgTerms, words as bgWords } from './bulgarian'
import { FtsIndex, phrasesOf, tokenize, type Phrase } from './fts'
import {
  deinflect, hasJapanese, isKana, katakanaToHiragana, plainReading, posMatches, pySplit, pyStrip, romajiPartial, romajiSpellings, romajiToKana,
  type Candidate,
} from './japanese'
import { Recognizer, MAX_RESULTS, STROKE_WINDOW } from './recognize'
import { compareCodePoints, readSections, SortedStrings, starts } from './sections'
import { Vocabulary } from './spelling'

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
  levels: Record<string, LevelResponse>
  wordsFor: Record<string, number[]>
  /** Per kanji, the ids of the common words that have it after their first character. Older packs lack it. */
  inner?: Record<string, number[]>
}

/** id, headword, reading, common, nf, pitch, senses [pos, misc, gloss, glossBg], forms [text, kana, rare], jlpt, verb pair ids,
 *  the senses in our order (null where JMdict's) */
export type RawWord = [
  number, string, string, number, number | null, string | null,
  [string | null, string | null, string, (string | null)?][], [string, number, number, number?][], (number | null)?, number[]?,
  (number[] | null)?,
]

/** Where the entries and stroke paths are kept: IndexedDB in the app, memory in tests. */
export interface EntryStore {
  words(ids: number[]): Promise<Map<number, RawWord>>
  strokes(char: string): Promise<string[] | null>
  /** A kanji's page from pages.json, each word as {"$w": id} plus what the page changed in it. Null before packs had pages. */
  page(char: string): Promise<unknown>
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
    forms: r[7].map(([text, kana, rare, seldom]) => ({ text, kana: !!kana, rare: !!rare, ...(seldom ? { seldom: true } : {}) })),
    // Absent from rows stored before words carried a level.
    jlpt: r[8] ?? null,
    ...(r[10] ? { order: r[10] } : {}),
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

/**
 * How well a gloss item matched, lower first. 0-7 an item that is the query
 * exactly as written, by where it stands (the entry's first item, another in
 * the first sense, a later sense; bare before qualified); 8-15 the same for an
 * item that only shares the query's stems (водя for вода); 16 and 17 an item
 * that merely mentions them, in the first sense or later.
 */
function bgTier(exact: boolean, sameSpelling: boolean, place: number): number {
  if (!exact) return 16 + (place >= 4 ? 1 : 0)
  return place + (sameSpelling ? 0 : 8)
}

/** The server's Bulgarian query: every stem a quoted phrase of its own. */
function bgPhrases(stems: string[]): Phrase[] {
  return phrasesOf(stems)
}

/** The last word of an English or Bulgarian query also finds longer words once it has this many letters (server PREFIX_MIN). */
const PREFIX_MIN = 3
const longEnough = (w: string) => [...w].length >= PREFIX_MIN

/** The last Bulgarian word as typed (normalised, not stemmed), when long enough to stand for longer words: the server's `_bg_prefix`. */
function bgPrefix(text: string): string | null {
  const ws = bgWords(bgNormalize(text))
  return ws.length && longEnough(ws[ws.length - 1]) ? ws[ws.length - 1] : null
}

/** The server's `_corrections`: what `q` likely meant, best first, when one of its words is not in the index. */
function corrections(q: string, english: () => Vocabulary, bulgarian: () => Vocabulary): string[] {
  let words: string[]
  let fix: (w: string) => string[]
  if (hasCyrillic(q) && !hasJapanese(q)) {
    const vocab = bulgarian()
    words = bgWords(bgNormalize(q))
    fix = (w) => {
      const st = bgStem(w)
      return vocab.suggest(st).map((g) => (w.startsWith(st) ? g + [...w].slice([...st].length).join('') : g))
    }
  } else if (/^[A-Za-z]+( [A-Za-z]+)*$/.test(pySplit(q).join(' '))) {
    const vocab = english()
    words = pySplit(q.toLowerCase())
    fix = (w) => vocab.suggest(w)
  } else {
    return []
  }
  const guesses = words.map(fix)
  const wrong = guesses.flatMap((g, i) => (g.length ? [i] : []))
  if (!wrong.length) return []
  if (wrong.length === 1) {
    const i = wrong[0]
    return guesses[i].map((g) => [...words.slice(0, i), g, ...words.slice(i + 1)].join(' '))
  }
  return [words.map((w, i) => guesses[i][0] ?? w).join(' ')]
}

/** Python's dict.fromkeys over a list: first occurrences, in order. */
function distinct(xs: number[]): number[] {
  return [...new Set(xs)]
}

function compareKeys(a: number[], b: number[]): number {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]
  return 0
}

/** The (written, kana) a word read this way would have, likeliest first: the server's `reading_forms`. */
function readingForms(char: string, reading: string, on: boolean): [string, string][] {
  const r = plainReading(reading)
  if (!on) {
    const dot = r.indexOf('.')
    const [stem, okuri] = dot < 0 ? [r, ''] : [r.slice(0, dot), r.slice(dot + 1)]
    return [[char + okuri, stem + okuri]]
  }
  const kana = katakanaToHiragana(r)
  const out: [string, string][] = [[char, kana], [char + 'する', kana + 'する']]
  if (kana.endsWith('つ') || kana.endsWith('ち')) out.push([char + 'する', kana.slice(0, -1) + 'っする'])
  out.push([char + 'じる', kana + 'じる'], [char + 'ずる', kana + 'ずる'])
  return out
}

// Words in Latin or Cyrillic letters. Japanese among two or more of them is a
// question about it, for Search by meaning, not a word to look up
// (server/routes/search.py, is_question).
const WORD = /[A-Za-z\u0400-\u04FF]+/g

function isQuestion(q: string): boolean {
  return hasJapanese(q) && (q.match(WORD) ?? []).length >= 2
}

export class Engine {
  private readonly store: EntryStore
  private readonly pack: KanjiPack

  // words, by index; ids ascending, so index order is id order
  private readonly ids: Uint32Array
  private readonly common: Uint8Array
  private readonly nf: Uint8Array
  private readonly jlpt: Uint8Array
  private readonly hwlen: Uint8Array
  private readonly pos: Uint8Array

  // every form, sorted, with the words written that way
  private readonly forms: SortedStrings
  private readonly formWstart: Uint32Array
  private readonly formWord: Uint32Array

  private readonly gloss: FtsIndex
  private readonly glossWord: Uint32Array
  private readonly glossN: Uint8Array
  private readonly glossPlace: Uint8Array
  private readonly kfts: FtsIndex
  private readonly kftsChar: Uint32Array
  // Bulgarian glosses and kanji meanings, indexed by stem
  private readonly bgGloss: FtsIndex
  private readonly bgGlossWord: Uint32Array
  private readonly bgGlossN: Uint8Array
  private readonly bgGlossPlace: Uint8Array
  private readonly bgGlossSpelled: Uint32Array
  private readonly bgKfts: FtsIndex
  private readonly bgKftsChar: Uint32Array

  private readonly kanjiAt = new Map<string, number>()
  /** reading -> char -> how it is read that way; see `kanjiByReading`. */
  private readonly readings = new Map<string, Map<string, number>>()
  private recognizer: Recognizer | null = null

  constructor(index: ArrayBuffer, pack: KanjiPack, store: EntryStore) {
    this.store = store
    this.pack = pack
    const s = readSections(index)

    this.ids = s.u32('word.id')
    this.common = s.u8('word.common')
    this.nf = s.u8('word.nf')
    this.jlpt = s.u8('word.jlpt')
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
    this.glossN = s.u8('gloss.docn')
    this.glossPlace = s.u8('gloss.docplace')
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
    this.bgGlossN = s.u8('bggloss.docn')
    this.bgGlossPlace = s.u8('bggloss.docplace')
    this.bgGlossSpelled = s.u32('bggloss.docspelled')
    this.bgKfts = new FtsIndex(
      new SortedStrings(s.text('bgkfts.term'), starts(s.u8('bgkfts.tlen'))),
      s.u32('bgkfts.pstart'), s.u32('bgkfts.doc'), s.u8('bgkfts.tf'), s.u8('bgkfts.pos'), s.u16('bgkfts.doclen'),
    )
    this.bgKftsChar = s.u32('bgkfts.docchar')

    pack.kanji.forEach((r, i) => this.kanjiAt.set(r[0], i))
    const addReading = (reading: string, char: string, tier: number) => {
      if (!reading) return
      let at = this.readings.get(reading)
      if (!at) this.readings.set(reading, (at = new Map()))
      at.set(char, Math.min(tier, at.get(char) ?? tier))
    }
    for (const r of pack.kanji) {
      if (!(r[0] >= '一' && r[0] <= '鿿')) continue
      for (const k of r[9]) {
        const kun = k.replaceAll('-', '')
        addReading(kun.replaceAll('.', ''), r[0], 0)
        if (kun.includes('.')) addReading(kun.split('.')[0], r[0], 1)
      }
      for (const on of r[8]) addReading(katakanaToHiragana(on.replaceAll('-', '')), r[0], 2)
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

  /**
   * Where a word goes among words that matched equally well: by newspaper
   * rank or JLPT level, ascending the basic end first (top 500, N5). Words
   * without one go last either way; the other measure, commonness and length
   * break ties. The server's `_order`.
   */
  private orderKey(i: number, sort: SearchSort, desc: boolean): number[] {
    const nf = this.nf[i]
    const lv = this.jlpt[i]
    const news = [nf ? 0 : 1, nf]
    const level = [lv ? 0 : 1, -lv]
    const common = this.common[i] ? 0 : 1
    if (sort === 'jlpt') return [level[0], desc ? -level[1] : level[1], ...news, common, this.hwlen[i]]
    return [news[0], desc ? -news[1] : news[1], ...level, common, this.hwlen[i]]
  }

  /** The kana a romaji query stands for, or ''; with long-vowel marks, the spelling the most frequent word has. The server's `_romaji_reading`. */
  private romajiReading(q: string): string {
    const readings = [...new Set(romajiSpellings(pyStrip(q)).map(romajiToKana))].filter(Boolean)
    if (readings.length > 1) {
      // The spelling the most frequent word has (tōri is とおり for 通り, not とうり for 党利).
      const found = readings.map((r) => new Set(this.byForm(deinflect(r).map((c) => c.text), 5)))
      const [best] = this.inOrder(new Set(found.flatMap((ws) => [...ws])), 'news', false, 1)
      if (best !== undefined) return readings[found.findIndex((ws) => ws.has(best))]
    }
    return readings[0] ?? ''
  }

  /** The first `n` of `words` in the order asked for (`orderKey`), then by id. */
  private inOrder(words: Iterable<number>, sort: SearchSort, desc: boolean, n: number): number[] {
    return [...words]
      .map((w) => [w, ...this.orderKey(w, sort, desc), this.ids[w]])
      .sort((a, b) => {
        for (let k = 1; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]
        return 0
      })
      .slice(0, n)
      .map((r) => r[0])
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

  /**
   * Words whose Bulgarian glosses hold every stem of `text`, best match
   * first, and how well each matched (lower is better, see `bgTier`).
   */
  private bulgarianWords(text: string, limit: number): [number[], Map<number, number>] {
    const stems = bgTerms(text)
    if (!stems.length) return [[], new Map()]
    const docs = this.bgGloss.search(bgPhrases(stems), limit * 8)
    const spelled = spelling(text)
    const tiers = new Map<number, number>()
    for (const d of docs) {
      const w = this.bgGlossWord[d]
      const tier = bgTier(this.bgGlossN[d] === stems.length, this.bgGlossSpelled[d] === spelled, this.bgGlossPlace[d])
      tiers.set(w, Math.min(tier, tiers.get(w) ?? tier))
    }
    const ids = distinct(docs.map((d) => this.bgGlossWord[d]))
    // Then glosses with a longer word starting with the last one as typed:
    // сло finds слон. After every other match (18, 19).
    const last = bgPrefix(text)
    if (last) {
      for (const d of this.bgGloss.search(phrasesOf([...stems.slice(0, -1), last], true), limit * 8)) {
        const w = this.bgGlossWord[d]
        if (!tiers.has(w)) {
          ids.push(w)
          tiers.set(w, 18 + (this.bgGlossPlace[d] >= 4 ? 1 : 0))
        }
      }
    }
    return [ids, tiers]
  }

  /**
   * Words whose English glosses hold every word of `text`, best match first,
   * and how each matched: the server's `_english_words` -- whole words (0-3),
   * then glosses with only a longer word starting with the last one (4-7).
   */
  private englishWords(text: string, limit: number, prefix = true): [number[], Map<number, number>] {
    const safe = pySplit(text.replaceAll('"', ' '))
    if (!safe.length) return [[], new Map()]
    const tokens = tokenize(safe.join(' '))
    const wanted = tokens.length - (tokens.length > 1 && tokens[0] === 'to' ? 1 : 0)
    const ids: number[] = []
    const tiers = new Map<number, number>()
    const passes: [Phrase[], number][] = [[phrasesOf(safe), 0]]
    if (prefix && longEnough(safe[safe.length - 1])) passes.push([phrasesOf(safe, true), 4])
    for (const [phrases, base] of passes) {
      for (const d of this.gloss.search(phrases, limit * 8)) {
        const w = this.glossWord[d]
        const tier = base + (this.glossN[d] === wanted ? 0 : 2) + this.glossPlace[d]
        const had = tiers.get(w)
        if (had === undefined) ids.push(w)
        tiers.set(w, Math.min(tier, had ?? tier))
      }
    }
    return [ids, tiers]
  }

  private vocab: { en?: Vocabulary; bg?: Vocabulary } = {}

  async search(
    input: string, limit = 30, lang = 'en', common = false, sort: SearchSort = 'news', order: SearchOrder = 'asc',
  ): Promise<SearchResponse> {
    // As the server: the query as typed, and when that finds nothing at all, its likeliest spelling.
    const out = await this.searchOnce(input, limit, lang, common, sort, order)
    if (out.words.length || out.kanji.length) return out
    const fixes = corrections(
      out.query,
      () => (this.vocab.en ??= new Vocabulary(this.gloss.vocabulary(), true)),
      () => (this.vocab.bg ??= new Vocabulary(this.bgGloss.vocabulary(), false)),
    )
    if (!fixes.length) return out
    const again = await this.searchOnce(fixes[0], limit, lang, common, sort, order)
    if (!again.words.length && !again.kanji.length) return out
    return {
      ...again,
      query: out.query,
      corrected: fixes[0],
      alternatives: [...again.alternatives, ...fixes.slice(1).map((f) => ({ kind: 'spelling', query: f }))],
    }
  }

  private async searchOnce(
    input: string, limit: number, lang: string, common: boolean, sort: SearchSort, order: SearchOrder,
  ): Promise<SearchResponse> {
    const q = pyStrip(input)
    if (!q) return { query: q, interpretation: null, alternatives: [], kanji: [], words: [], total: 0 }
    if (isQuestion(q)) {
      return { query: q, interpretation: { kind: 'question' }, alternatives: [], kanji: [], words: [], total: 0 }
    }

    let wordIdx: number[] = []
    let interpretation: SearchResponse['interpretation'] = null
    const alternatives: SearchResponse['alternatives'] = []
    const inflections = new Map<number, string[]>()
    let bgStems: string[] | null = null // set when the words were found in Bulgarian
    let bgText = '' // and the Bulgarian they were found by
    let bgTiers = new Map<number, number>() // and how well each one matched
    let enTiers: Map<number, number> | null = null // set, the same way, for an English search
    let jpTiers = new Map<number, number>() // one kanji: common words with it first, then further in, then the rest

    const japanese = hasJapanese(q)
    const cyrillic = !japanese && hasCyrillic(q)
    let kanaGuess = japanese || cyrillic ? '' : this.romajiReading(q)
    const latinBg = lang === 'bg' && !japanese && !cyrillic && isLatinQuery(q)

    if (cyrillic) {
      bgStems = bgTerms(q)
      bgText = q
      const [found, tiers] = this.bulgarianWords(q, limit)
      wordIdx = found
      bgTiers = tiers
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
      const romaji = kanaGuess
      if (latinBg) {
        const reading = this.shlyokavitsa(q)
        const [found, tiers] = reading ? this.bulgarianWords(reading, limit) : [[], new Map()]
        if (wordIdx.length && found.length) {
          // Romaji won, but the Bulgarian reading is one tap away.
          alternatives.push({ kind: 'bulgarian', query: reading! })
        } else if (found.length) {
          wordIdx = found
          bgTiers = tiers
          bgStems = bgTerms(reading!)
          bgText = reading!
          interpretation = { kind: 'bulgarian', reading: reading! }
          kanaGuess = ''
        }
      }
      let englishFirst = false
      if (!japanese && !wordIdx.length) {
        kanaGuess = '' // romaji reading found nothing, fall through to English
        interpretation = null
        // Romaji that is no word -- house, read ほうせ -- is English when
        // English has the word itself, before any word starting with ほうせ.
        englishFirst = bgStems === null && this.englishWords(q, limit, false)[0].length > 0
      }

      // Prefix match tops up short result sets, so typing 時 still suggests 時間:
      // the first of every word starting with it in the order asked for, not
      // the first few in character order, which left 日本語 and 日記 out of 日.
      if (bgStems === null && !englishFirst && wordIdx.length < limit) {
        const lo = this.forms.lowerBound(target)
        const hi = this.forms.lowerBound(target + '￿')
        const present = new Set(wordIdx)
        const found = new Set<number>()
        for (let f = lo; f < hi; f++) {
          for (const w of this.wordsOfForm(f)) if (!present.has(w) && (!common || this.common[w])) found.add(w)
        }
        wordIdx.push(...this.inOrder(found, sort, order === 'desc', limit * 6))
        if (!japanese && wordIdx.length && interpretation === null) {
          // Romaji still being typed (tabe for 食べる) is still romaji.
          interpretation = { kind: 'romaji', reading: romaji }
          kanaGuess = romaji
        }
      }

      // One kanji: after the common words that start with it, the common words
      // that have it further in (技術, 芸術 for 術), then the rare ones that start with it.
      if (bgStems === null && [...target].length === 1 && japanese && !isKana(target)) {
        const present = new Set(wordIdx)
        const further = [...new Set((this.pack.inner?.[target] ?? []).map((id) => this.indexOfId(id)))].filter((w) => w >= 0 && !present.has(w))
        const inner = this.inOrder(further, sort, order === 'desc', limit * 6)
        const first = wordIdx.filter((w) => this.common[w])
        const rest = wordIdx.filter((w) => !this.common[w])
        wordIdx = [...first, ...inner, ...rest]
        jpTiers = new Map<number, number>([...first.map((w) => [w, 0] as const), ...inner.map((w) => [w, 1] as const), ...rest.map((w) => [w, 2] as const)])
      }
    } else if (latinBg) {
      // Latin that cannot be romaji (4ovek, voda) is Bulgarian before English.
      const reading = this.shlyokavitsa(q)
      const [found, tiers] = reading ? this.bulgarianWords(reading, limit) : [[], new Map()]
      if (found.length) {
        wordIdx = found
        bgTiers = tiers
        bgStems = bgTerms(reading!)
        bgText = reading!
        interpretation = { kind: 'bulgarian', reading: reading! }
      }
    }

    if (!wordIdx.length && !japanese && bgStems === null) {
      // English gloss search: whole words first, then the last word's longer forms.
      if (pyStrip(q.replaceAll('"', ' '))) {
        ;[wordIdx, enTiers] = this.englishWords(q, limit)
        interpretation = { kind: 'english' }
      }
    }

    // Romaji cut off inside a syllable -- tabem, benky -- once English has
    // nothing for it: every word starting with what it could become.
    const partial = !wordIdx.length && !japanese && bgStems === null ? romajiPartial(q) : null
    if (partial) {
      const [base, cut, tails] = partial
      const found = new Set<number>()
      for (const t of tails) {
        const lo = this.forms.lowerBound(base + t)
        const hi = this.forms.lowerBound(base + t + '\uffff')
        for (let f = lo; f < hi; f++) for (const w of this.wordsOfForm(f)) if (!common || this.common[w]) found.add(w)
      }
      const rows = this.inOrder(found, sort, order === 'desc', limit * 6)
      if (rows.length) {
        wordIdx = rows
        interpretation = { kind: 'romaji', reading: base + cut }
      }
    }

    // A view over what was found: the query is read the same way either way.
    if (common) wordIdx = wordIdx.filter((i) => this.common[i])

    // The server fetches these by id -- so they come back in id order -- and
    // then sorts by rank, stably -- a Bulgarian search by how well each matched first.
    const pool = [...new Set(wordIdx.slice(0, limit * 4))].sort((a, b) => a - b)
    // An English one likewise; among equal matches, the order asked for.
    const tiers = enTiers ?? (jpTiers.size ? jpTiers : bgTiers)
    const ranked = pool
      .map((i) => [i, tiers.get(i) ?? 0, ...this.orderKey(i, sort, order === 'desc')])
      .sort((a, b) => {
        for (let k = 1; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]
        return a[0] - b[0]
      })
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
      kanji: this.searchKanji(q, japanese, kanaGuess, bgStems, bgStems ? bgPrefix(bgText) : null),
      words,
      total: pool.length,
    }
  }

  private searchKanji(q: string, japanese: boolean, kanaGuess: string, bgStems: string[] | null, bgLast: string | null): KanjiHit[] {
    let chars: string[] = []
    let tiers = new Map<string, number>()
    const longer = new Set<string>() // found only by a longer word starting with the last one

    // Whole words first, then what only the last word's longer forms find: the server's `by_meaning`.
    const byMeaning = (index: FtsIndex, charOf: Uint32Array, words: string[], last: string | null): string[] => {
      const found: string[] = []
      for (const d of index.search(phrasesOf(words), 80)) {
        const k = charOf[d]
        if (k !== NO_INDEX) found.push(this.pack.kanji[k][0])
      }
      if (last && longEnough(last)) {
        const have = new Set(found)
        for (const d of index.search(phrasesOf([...words.slice(0, -1), last], true), 80)) {
          const k = charOf[d]
          if (k === NO_INDEX) continue
          const c = this.pack.kanji[k][0]
          if (!have.has(c)) {
            longer.add(c)
            found.push(c)
          }
        }
      }
      return found
    }
    if (japanese) chars = [...new Set([...q])].filter(isCjk)

    // Kana, typed or read from romaji, finds the characters read that way:
    // a kun'yomi that is the whole word, a kun'yomi's stem, then an on'yomi.
    const reading = kanaGuess || (japanese && !chars.length && isKana(q) ? katakanaToHiragana(q) : '')
    if (reading && bgStems === null) {
      tiers = this.readings.get(reading) ?? new Map()
      chars = [...tiers.keys()]
    }

    if (bgStems !== null) {
      if (bgStems.length) chars = byMeaning(this.bgKfts, this.bgKftsChar, bgStems, bgLast)
    } else if (!chars.length && !japanese && !kanaGuess) {
      const safe = pySplit(q.replaceAll('"', ' '))
      if (safe.length) chars = byMeaning(this.kfts, this.kftsChar, safe, safe[safe.length - 1])
    }
    if (!chars.length) return []

    // The server's `char IN (...)` comes back in char order, then sorts stably.
    const rows = [...new Set(chars)]
      .map((c) => this.row(c))
      .filter((r): r is KanjiRow => r !== undefined)
      .sort((a, b) => compareCodePoints(a[0], b[0]))
    rows.sort(
      (a, b) =>
        (longer.has(a[0]) ? 1 : 0) - (longer.has(b[0]) ? 1 : 0) ||
        (a[5] ? 0 : 1) - (b[5] ? 0 : 1) ||
        (tiers.get(a[0]) ?? 0) - (tiers.get(b[0]) ?? 0) ||
        (a[3] ?? 9999) - (b[3] ?? 9999),
    )
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

  /** For each of the character's readings, the word it forms: the server's `reading_words`. */
  async readingWords(char: string): Promise<{ char: string; words: Record<string, Word> }> {
    const r = [...char].length === 1 ? this.row(char) : undefined
    if (!r) return { char, words: {} }
    const readings: [string, boolean][] = [...r[8].map((y) => [y, true] as [string, boolean]), ...r[9].map((y) => [y, false] as [string, boolean])]

    const found: [string, string, number, number][] = [] // reading, written, rank, word index
    for (const [reading, on] of readings) {
      readingForms(char, reading, on).forEach(([written, kana], rank) => {
        const a = this.forms.indexOf(written)
        const b = this.forms.indexOf(kana)
        if (a < 0 || b < 0) return
        const reads = new Set(this.wordsOfForm(b))
        for (const w of this.wordsOfForm(a)) if (reads.has(w)) found.push([reading, written, rank, w])
      })
    }
    const words = new Map((await this.fetchWords([...new Set(found.map((f) => f[3]))])).map((w) => [w.id, w]))
    const key = ([, written, rank, w]: (typeof found)[number]): number[] => {
      const nf = this.nf[w]
      return [this.common[w] ? 0 : 1, words.get(this.ids[w])?.headword === written ? 0 : 1, nf ? 0 : 1, nf, rank, this.ids[w]]
    }
    const best = new Map<string, (typeof found)[number]>()
    for (const f of found) {
      const was = best.get(f[0])
      if (!was || compareKeys(key(f), key(was)) < 0) best.set(f[0], f)
    }
    const out: Record<string, Word> = {}
    for (const [reading, f] of best) {
      const w = words.get(this.ids[f[3]])
      if (w) out[reading] = w
    }
    return { char, words: out }
  }

  /** What the rail shows for a character before its graph arrives. */
  async kanji(char: string): Promise<{ focus: KanjiNode; strokes: string[] } | null> {
    const r = this.row(char)
    if (!r) return null
    return { focus: toNode(r), strokes: (await this.store.strokes(char)) ?? [] }
  }

  /**
   * The kanji's page as the server's `kanji_page` answered it when the pack was
   * built, with its words filled back in. Null when the pack has none for it.
   */
  async kanjiPage(char: string): Promise<KanjiPage | null> {
    const page = await this.store.page(char)
    if (!page) return null
    const ids = new Set<number>()
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(collect)
      else if (v && typeof v === 'object') {
        if ('$w' in v) ids.add((v as { $w: number }).$w)
        else Object.values(v).forEach(collect)
      }
    }
    collect(page)
    const words = await this.store.words([...ids])
    // A word the store lacks would leave a hole in the page: the server's, then.
    if (words.size < ids.size) return null
    const fill = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(fill)
      if (!v || typeof v !== 'object') return v
      if ('$w' in v) {
        const { $w, ...changed } = v as { $w: number }
        return { ...toWord(words.get($w)!), ...changed }
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
    }
    return fill(page) as KanjiPage
  }

  /** A dictionary entry without its example sentences, which stay on the server. */
  async wordEntry(id: number): Promise<WordEntry | null> {
    if (this.indexOfId(id) < 0) return null
    const raw = (await this.store.words([id])).get(id)
    if (!raw) return null
    const word = toWord(raw)
    const chars = [...new Set([...word.headword])].filter((c) => isCjk(c) || (c >= '㐀' && c <= '䶿'))
    const kanji = chars.flatMap((c) => {
      const r = this.row(c)
      return r ? [{ ...toNode(r), curated: r[11] }] : []
    })
    // Absent from rows stored before words carried their verb pairs.
    const pairs = await this.fetchWords((raw[9] ?? []).map((p) => this.indexOfId(p)).filter((p) => p >= 0))
    return { word, kanji, examples: [], pairs }
  }

  byLevel(level: number): LevelResponse | null {
    return this.pack.levels[String(level)] ?? null
  }

  recognize(strokes: number[][][], window = STROKE_WINDOW, limit = MAX_RESULTS): DrawCandidate[] {
    return this.recognition().recognise(strokes, Math.max(0, Math.min(6, window)), Math.max(1, Math.min(60, limit)))
  }

  describe(chars: string[]): DrawCandidate[] {
    return this.recognition().describe(chars)
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
