/**
 * Typed client for the Better Kanji Dictionary server.
 *
 * Lookups -- search, drawing, levels -- are answered on the device
 * instead when the offline pack is there (see local/), and fall back to the
 * server when it is not, or when the device's answer fails.
 */

import { sessionToken } from './account/session'
import { local } from './local/local'

// A production build is served by the API server itself, so it talks to its own origin.
const BASE = import.meta.env.VITE_API ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')

export interface KanjiNode {
  char: string
  strokes: number | null
  grade: number | null
  freq: number | null
  jlpt: number | null
  joyo: boolean
  inKanjidic: boolean
  meanings: string[]
  /** Bulgarian meanings, when translated. */
  meaningsBg: string[] | null
  onYomi: string[]
  kunYomi: string[]
  fanout: number | null
  depth?: number
  /** On containers: whether anything above, however far up, is newspaper-ranked. */
  upFreq?: boolean
  /** On containers: the easiest JLPT level above, however far up (5 is easiest). */
  upJlpt?: number | null
  /** On containers: the other form of the focus it is built from -- 糹 for 細 under 糸. */
  form?: string
  /** On components: the kanji this part is a form of, its root -- 水 for 氵. */
  root?: KanjiNode
  /** On components: a piece found only through a visual split (十 under 土), never a part. */
  visual?: boolean
}

/** Where a decomposition comes from (server/decomp_sources.py); `bkd` is this dictionary's own. */
export type PartsSource = 'kanjivg' | 'ids' | 'tsalta' | 'cjk-decomp' | 'topokanji' | 'bkd' | 'sonnet' | 'opus'

/** One source's split of a character, in the graph's own characters; [] = one piece. */
export interface SourceSplit {
  source: PartsSource
  parts: string[]
}

export interface PartsFrom {
  /** The sources that split it as it is split now: bkd when none does. */
  by: PartsSource[]
  splits: SourceSplit[]
}

export interface GraphResponse {
  focus: KanjiNode
  /** SVG path data in writing order, on KanjiVG's 109x109 canvas. */
  strokes: string[]
  containers: KanjiNode[]
  components: {
    nodes: KanjiNode[]
    /** `visual`: how a character kept whole looks (土 to 十), not what it is made of. */
    edges: { parent: string; child: string; visual?: boolean }[]
  }
  /** Which sources split it the way it is split now; absent offline or with an older database. */
  partsFrom?: PartsFrom | null
  counts: {
    containers: number
    containersJoyo: number
    components: number
    maxDepth: number
  }
}

/**
 * Why two kanji are listed together, as the data says it: words written with
 * either (早い・速い) or a kun reading in common, for a shared reading; English
 * meanings in common, for a near-synonym.
 */
export type SimilarWhy = { words: string[] } | { kun: string } | { gloss: string[] }

/**
 * What looks like a character, what competes with it for a reading, what
 * means much the same, and its other forms; closest first. A pair is under
 * `read` or `mean`, never both.
 */
export interface SimilarResponse {
  char: string
  look: (KanjiNode & { score: number })[]
  read: (KanjiNode & { score: number; why: SimilarWhy | null })[]
  mean: (KanjiNode & { score: number; why: SimilarWhy | null })[]
  variant: (KanjiNode & { score: number })[]
}

/** Which of the font strip's faces have a character, and its older JIS shapes as outlines. */
export interface FontsResponse {
  char: string
  faces: string[]
  /** `old` is SVG path data on a 0 0 em em box, y down. */
  /** `compat`: an old printed shape Unicode keeps as a compatibility ideograph, `code` its code point (FA2C).
   *  `ivs`: one that is only a variation sequence, drawn by Noto Serif JP, `code` the selector (E0101). */
  old: { face: string; feature: 'jp78' | 'jp83' | 'jp90' | 'compat' | 'ivs'; em: number; old: string; code?: string }[]
  /** The character in faces too big to load (semi-cursive brush), as SVG path data on 0 0 em em. Absent from an old server. */
  drawn?: { face: string; em: number; d: string }[]
}

/** A character linked to another as one of its forms (server/forms.py). */
export interface FormItem {
  char: string
  /** Whether it has a page of its own; an old form like 靑 often does not. */
  known: boolean
  meanings: string[]
  meaningsBg: string[] | null
  note: string | null
  /** unihan | curated | review:<decision id> */
  source: string
}

/** Read as "the <row> of char": its old form, the forms it takes in other positions, ... */
export interface FormsResponse {
  char: string
  /** A bound part with no meaning of its own borrows the meaning of what it is a form of. */
  meaning: { from: string; meanings: string[]; meaningsBg: string[] | null } | null
  /** A part's reviewed meaning, or the name of a shape that has none of its own (丷). */
  part: PartMeaning | null
  old: FormItem[]
  new: FormItem[]
  positional: FormItem[]
  formOf: FormItem[]
  forms: FormItem[]
  looksLike: FormItem[]
  lookalikeOf: FormItem[]
  /** A separate character for the same thing: 隹 for 鳥. */
  kin: FormItem[]
  variants: FormItem[]
}

/** One map scope, column-wise: index i across every array is one character. */
export interface MapResponse {
  scope: string
  chars: string[]
  freq: (number | null)[]
  jlpt: (number | null)[]
  joyo: (0 | 1)[]
  strokes: (number | null)[]
  meaning: string[]
  /** The first Bulgarian meaning, or "" when there is none. */
  meaningBg: string[]
  /** flat x,y per kanji, in the meaning map's own units */
  xy: number[]
  /** cluster id per kanji, -1 = in none */
  cluster: number[]
  /** near: a digit per cluster, how near it is to this one: 3 itself, 2 near, 1 related, 0 not */
  clusters: { en: string; bg: string; near: string }[]
}

export interface WordEntry {
  word: Word
  kanji: (KanjiNode & { curated: string | null })[]
  /** `hit` is the [start, end) of the word itself, inflected as it appears; `en`, Tatoeba's English; `bg`, ours. */
  examples: { text: string; hit: [number, number] | null; en?: string | null; bg?: string | null }[]
  /** The verb going the other way, が for を: 開ける for 開く; likeliest first. */
  pairs: Word[]
  /** Its synonyms, opposites and words read the same, sense by sense; missing from the device's copy. */
  related?: RelatedWord[]
  /** One per sense: how soon a learner meets it, its nuance, an example; missing from the device's copy. */
  senseNotes?: SenseNote[] | null
  /** Senses JMdict keeps to other readings (r) or spellings (k) than the headword's, by sense index. */
  senseOnly?: Record<string, { r?: string[]; k?: string[] }> | null
  /** The kanji of its spellings: which have a page, and which are old forms (學 -> 学); missing from the device's copy. */
  spelling?: { open: string[]; old: Record<string, string> }
}

/** What one sense of a word is (pipeline/sense_notes.py). */
export interface SenseNote {
  /** main: the meanings to learn the word by; secondary: met later; rare: barely met. */
  rank: 'main' | 'secondary' | 'rare'
  nuance: string
  /** The nuance in Bulgarian, where translated. */
  nuanceBg?: string
  /** The word in it in 【】; src t = a Tatoeba sentence, d = written for it; bg, its Bulgarian. */
  ex: { ja: string; en: string; src: 't' | 'd'; bg?: string } | null
}

/** A word close to one sense of another, and how (server/synonyms.py). */
export interface RelatedWord {
  /** Which of the word's senses, from 0; -1 for a short, older or spoken form of the whole word. */
  sense: number
  /**
   * ≈ a synonym, ↔ an opposite, ! easy to mix up, a pair (祖父 / 祖母), a polite
   * counterpart (仰る / 言う); of the whole word: its short form (short), what it is
   * the short form of (shortOf), its older form (older), what it is an older form of,
   * its spoken form (spoken: やっぱり on やはり), what it is a spoken form of.
   */
  kind: 'syn' | 'ant' | 'mix' | 'pair' | 'polite' | 'short' | 'shortOf' | 'older' | 'olderOf' | 'spoken' | 'spokenOf'
  word: Word
  /** The other word's sense that matches, from 1; null for a form of the whole word. */
  otherSense: number | null
  /** How it differs, or when to write it (English only for now); polite: the other's register. */
  line: string | null
  /** The same of the page's own word, beside it; polite: its own register. */
  ownLine: string | null
  /** mix: read the same (sound) or one English word for two (meaning). */
  why?: 'sound' | 'meaning'
  /** The two lines in Bulgarian, where translated. */
  lineBg?: string | null
  ownLineBg?: string | null
}

export interface Sense {
  pos: string[]
  misc: string[]
  gloss: string
  /** The Bulgarian glosses, "; "-joined like `gloss`, or null when not yet translated. */
  glossBg: string | null
}

export interface Word {
  id: number
  headword: string
  reading: string
  common: boolean
  nf: number | null
  /** Jonathan Waller's JLPT list the word is on, 5 = N5; a soft signal, as for kanji. */
  jlpt: number | null
  pitch: string | null
  senses: Sense[]
  /** The senses' indexes in our order (main, secondary, rare), which the site numbers them
   *  by (web/src/senses.ts); absent where it is JMdict's own. */
  order?: number[]
  /** `old`: the spelling in old kanji (學校 for 学校); missing from the device's copy. */
  /** seldom: JMdict marks another form of its kind common, not this one (消耗's しょうこう). */
  forms: { text: string; kana: boolean; rare: boolean; seldom?: boolean; old?: boolean }[]
  inflection?: string[]
  /** On a kanji's page: which kana of `reading` are that kanji's, [from, to): じょう in じょうしょう. */
  mark?: [number, number] | null
  /** In all the words with a kanji: how the word reads it -- kun, on, or a special reading (今日 きょう). */
  lane?: 'kun' | 'on' | 'special'
  /** And the reading it gives the kanji (じょう); none for a special reading. */
  as?: string | null
  /** On a kanji's page and in its words: one of its meaning's best examples, the words to know it by. */
  star?: boolean
  /** Under a meaning: the sense of the word that has it (its index, from 0), where not the
   *  first in `order` -- 焼く under "bake" is "to roast; to grill; to bake". */
  senseAt?: number
  /** Under a meaning that is not the word's main one: that main one (焼く: "burn"). */
  alsoOf?: { id: string; en: string | null; bg: string | null }
}

/** One of a kanji's readings on its page (server: search.kanji_readings). */
export interface ReadingInfo {
  /** The word the reading forms on its own: 上げる for あ.げる. */
  formed: Word | null
  /** How many common words read the kanji this way; none marks a rare reading. */
  common: number
  /** The commonest of them, JLPT words first, the formed word left out. */
  examples: Word[]
}

/** A kanji named on another's page: easy to mix up with it, or close in meaning. */
export interface KanjiLite {
  char: string
  meanings: string[]
  meaningsBg: string[] | null
}

/** A kanji close to one meaning of another, and which of its own meanings that is. */
export interface CloseKanji extends KanjiLite {
  sense: { id: string; en: string | null; bg: string | null } | null
  /** How it differs from the page's kanji in this meaning, where drafted. */
  nuance?: { en: string; bg: string | null } | null
}

/** Kanji easy to mix up on a kun reading they share, and the usage card that tells them apart, if any. */
export interface MixUp {
  /** As a word reads it: あげる; a usage card's may be two, あがる・あげる. */
  reading: string
  /** The page's kanji's meaning on that reading; missing in a pack from before it. */
  self?: CloseKanji['sense']
  /** Each with its meaning on that reading. */
  /** `note`: when to write which, where no usage card tells them apart. */
  kanji: (KanjiLite & { sense?: CloseKanji['sense']; note?: { en: string; bg: string | null } | null })[]
  usage: UsageCard | null
}

/** One meaning of a kanji on its page, with all that goes with it. */
export interface KanjiMeaning {
  id: string
  en: string | null
  bg: string | null
  about: string | null
  aboutBg: string | null
  /** All its common words. */
  total: number
  /** Its words that read the kanji in Japanese: 上げる, 値上げ. */
  kun: { words: Word[] } | null
  /** One part per on reading it has as a rule, the most used first: ジョウ, 上昇 向上. */
  on: { reading: string; words: Word[] }[]
  /** On readings it has in only a word or two: 重 チョウ in 重複. */
  also: { reading: string; words: Word[] }[]
  /** Its special readings: 上手 じょうず under higher. */
  exceptions: Word[]
  /** Kanji close to it in meaning: 昇, 登 for "go up". */
  similar: CloseKanji[]
  /** Kanji easy to mix up on one of its readings: 挙げる, 揚げる beside 上げる. */
  mixups: MixUp[]
  /** The patterns it builds words in, each with a few words: 〜人 "a person from …", 日本人 村人. */
  uses?: MeaningUse[]
}

/** A way a kanji builds words with one of its meanings (a suffix, a counter, a set phrase). */
export interface MeaningUse {
  id: string
  en: string
  bg: string | null
  about?: string
  aboutBg?: string
  words: Word[]
}

/** A kanji's meanings, readings and words, as its page shows them (server: search.kanji_page). */
export interface KanjiPage {
  char: string
  meanings: KanjiMeaning[]
  /** Its gist, the line the page opens with. */
  hero: string | null
  heroBg: string | null
  /** How its meanings follow from each other. */
  link: string | null
  linkBg: string | null
  /** Kanji easy to mix up on a reading no meaning has. */
  mixups: MixUp[]
  /** Words where it is there for its sound: 上海. */
  soundOnly: { words: Word[] } | null
  /** By the reading with its dashes dropped: あ.げる, じょう. */
  readings: Record<string, ReadingInfo>
  /** Words that read it in a way of their own: 今日 きょう under 今. One word each. */
  special: Word[]
  /** KANJIDIC's classical radical, by its Kangxi number. */
  radical: { char: string; number: number } | null
}

export interface KanjiHit {
  char: string
  meanings: string[]
  meaningsBg: string[] | null
  curated: string | null
  freq: number | null
  jlpt: number | null
  joyo: boolean
  strokes: number | null
  fanout: number
}

/** What equally good matches are ordered by: newspaper rank or JLPT level. */
export type SearchSort = 'news' | 'jlpt'
/** asc: the basic end first -- the top of the newspaper list, N5. */
export type SearchOrder = 'asc' | 'desc'

export interface SearchOptions {
  /** Only the words JMdict marks as common. */
  common: boolean
  sort: SearchSort
  order: SearchOrder
  /** How many words: 30, and 30 more for each "more". */
  limit?: number
}

export interface SearchResponse {
  query: string
  /**
   * How the query was read: romaji (with its kana `reading`), english, or
   * bulgarian (with `reading` when it was typed in Latin letters).
   */
  interpretation: { kind: string; reading?: string } | null
  /** Another reading that would also have found words: tapping it searches `query`. */
  alternatives: { kind: string; query: string }[]
  kanji: KanjiHit[]
  words: Word[]
  total: number
}

/**
 * What a language model took a query to mean, when the dictionary found nothing:
 * the model's order, only what the dictionary has, each with the model's
 * note on why where it gave one, and its note over them all.
 */
export interface SemanticResponse {
  query: string
  note: string | null
  kanji: (KanjiHit & { why: string | null })[]
  words: (Word & { why: string | null })[]
}

/** What the semantic search stream says, in order: thinking, then results as the model names them, then done. */
export type SemanticEvent =
  | { type: 'thinking' }
  | { type: 'kanji'; kanji: KanjiHit & { why: string | null } }
  | { type: 'word'; word: Word & { why: string | null } }
  | { type: 'note'; note: string }
  | { type: 'done' }
  | { type: 'error'; code: string }

export interface Association {
  id: string
  char: string
  author: string
  authorName?: string
  /** Markdown. */
  text: string
  images: string[]
  /** The images that are drawings and have a scene to reopen. */
  drawings?: string[]
  /** Private notes are shown only to their author. */
  visibility: Visibility
  adoptedFrom: string | null
  created: string
  updated: string
}

export type Visibility = 'private' | 'public'

/** What others see of an account: never its email. */
export interface Author {
  id: string
  /** Display name, free text. */
  name: string
  /** Unique handle, shown as @username. */
  username: string | null
  /** File name of the profile picture, or null for the initial. */
  avatar: string | null
}

export type Role = 'user' | 'admin'

export interface User extends Author {
  email: string
  /** Admin is the site's owner; everyone else is a user (no reviewers since 2026-11-02). */
  role: Role
}

/** A note as the associations tab shows it: yours, or someone's public one. */
export interface PublicNote {
  id: string
  char: string
  author: Author
  text: string
  images: string[]
  /** The images that are drawings and have a scene to reopen. */
  drawings: string[]
  visibility: Visibility
  created: string
  updated: string
  likes: number
  liked: boolean
  /** How many replies there are, not the replies themselves. */
  replies: number
  mine: boolean
}

export interface Reply {
  id: string
  assoc: string
  author: Author
  text: string
  created: string
  mine: boolean
}

export interface Page<T> {
  total: number
  offset: number
  items: T[]
}

export type NoteSort = 'liked' | 'new'

/** `mine` is every note of yours on the character; the page is everyone else's public ones. */
export interface NotesPage extends Page<PublicNote> {
  mine: PublicNote[]
}

export interface AssociationView {
  char: string
  own: Association[]
  components: { char: string; notes: Association[] }[]
}

export type PartKind = 'meaning' | 'shape'

/**
 * What a part with no meaning in the dictionary is (server/review.py): a
 * real character with a meaning of its own (劦, joint effort), or a shape
 * several old parts merged into, with a name and no meaning (丷).
 */
export interface PartMeaning {
  kind: PartKind
  /** The meaning, or the shape's name. */
  en: string
  bg: string | null
  /** For a shape: what it comes from in which kanji. */
  note: string | null
  noteBg: string | null
}

/** One meaning group of a kanji, as the words it is used in divide it. */
export interface MeaningGroup {
  /** `生.life`: the kanji, a dot, a short id. */
  id: string
  en: string
  bg: string | null
  /** What the kanji does in this group's words, a sentence or two; its Bulgarian is set on the Bulgarian card. */
  about?: string
  aboutBg?: string
  /** The 2-3 words that show the group best (word ids, placed in it). */
  examples?: number[]
  /** Kanji of the same meaning in this group. */
  similar?: string[]
}

/** A kanji easy to mix up with another: they share a kun reading. */
export interface Mixup {
  char: string
  reading: string
}

/** A kanji's extras (server/review.py kanji_extras): decided on its meanings card, their Bulgarian on its Bulgarian card. */
export interface KanjiExtras {
  /** Its gist, the line its page opens with. */
  hero?: string | null
  heroBg?: string | null
  /** How its groups connect. */
  link: string | null
  linkBg: string | null
  mixups: Mixup[]
}

/** Which kanji to write for a shared kun reading: Bunkacho's report, translated. */
export interface UsageCard {
  reading: string
  no: number | null
  spellings: {
    kanji: string
    def: string | null
    defEn: string | null
    defBg: string | null
    examples: { ja: string; kana: string | null; en: string | null; bg: string | null }[]
  }[]
  notes: { ja: string | null; en: string | null; bg: string | null }[]
}

/**
 * What each type's value is: parts, a link, meaning groups, one group's id, or
 * for Bulgarian a list -- a word's gloss per sense, or a kanji's meanings --
 * or a usage card's lines.
 */

/**
 * What one of Dani's print dictionaries says, put on a review card as evidence
 * (pipeline/book_sources.py): Цалта's kanji book (`kanji`, numbered entries)
 * or Иванов's Bulgarian-Japanese dictionary (`bg-ja`). `unsure`: what the
 * transcribing agent was not sure it read right -- the page's scan settles it.
 */

/** Every word with a kanji: by accepted meaning group, then the ones not placed yet, a page at a time. */
export interface WordsWithResponse {
  char: string
  senses: MeaningGroup[] | null
  /** The kanji's reviewed extras, and whether it was made in Japan. */
  extras?: KanjiExtras | null
  kokuji?: boolean
  /** One per accepted group, the catch-all (`catch-all`) last when it has words. */
  groups: (MeaningGroup & { words: Word[] })[]
  rest: { total: number; offset: number; words: Word[] }
  /** What is the AI's open draft, not reviewed yet: the groups, how many placed words, the extras. */
  draft?: { senses: boolean; words: number; extras: boolean }
}

/** One handwriting candidate. `score` is 0-100 agreement, not a probability. */
export interface DrawCandidate {
  char: string
  score: number
  /** Stroke count of the matched reference -- differs from yours on a near miss. */
  strokes: number
  freq: number | null
  meanings: string[]
  meaningsBg: string[] | null
}

export interface RecognizeResponse {
  candidates: DrawCandidate[]
  strokes: number
  also: DrawCandidate[]
}

export type ReportStatus = 'open' | 'fixed' | 'not_a_mistake' | 'duplicate'

/** What the page says about itself when a report is sent; the server adds the data version. */
export interface ReportContext {
  url?: string
  lang?: string
  screen?: string
  from?: string
  view?: string
}

export interface ReportFile {
  name: string
  type: string
  bytes: number
}

export interface MyReport {
  id: string
  created: string
  subject: string | null
  /** The subject as people read it: the kanji, or the word's headword. */
  label?: string
  text: string
  files: ReportFile[]
  status: ReportStatus
  reply: string | null
  closed_at: string | null
}

export interface UserReport extends MyReport {
  by: string
  context: ReportContext & { data?: string; commit?: string }
  closed_by: string | null
}

/**
 * A request the server refused. `message` is its English `detail`; `code`, when
 * the server sends one, is what web/src/i18n/errors.ts translates, with
 * `params` filling in the numbers.
 */
class ApiError extends Error {
  status: number
  code?: string
  params?: Record<string, string | number>

  constructor(status: number, message: string, code?: string, params?: Record<string, string | number>) {
    super(message)
    this.status = status
    this.code = code
    this.params = params
  }
}

/** The ApiError a failed response describes; `fallback` names it when the body says nothing. */
async function refusal(res: Response, fallback?: { message: string; code: string }): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  if (body.detail) return new ApiError(res.status, body.detail, body.code, body.params)
  if (fallback) return new ApiError(res.status, fallback.message, fallback.code)
  return new ApiError(res.status, body.error ?? res.statusText)
}

function authHeaders(): Record<string, string> {
  const token = sessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string, params?: [string, string][]): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  for (const [k, v] of params ?? []) url.searchParams.append(k, v)
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw await refusal(res)
  return res.json()
}

/**
 * Answers that do not change while the app is open, kept: two parts of the
 * page asking at once -- a word's head and its panel, a picked character's
 * page and then its graph -- share one request. A failure is asked again.
 */

function kept<K, T>(ask: (k: K) => Promise<T>, size = 40): ((k: K) => Promise<T>) & { peek: (k: K) => T | undefined } {
  const answers = new Map<K, Promise<T>>()
  // The answers that have come, to draw at once: a promise is only read a render late.
  const settled = new Map<K, T>()
  const ask_ = (k: K) => {
    let p = answers.get(k)
    if (p) answers.delete(k) // to the back of the queue, as used just now
    else {
      const asked = ask(k)
      asked.then(
        (v) => answers.get(k) === asked && settled.set(k, v),
        () => answers.get(k) === asked && answers.delete(k),
      )
      p = asked
    }
    answers.set(k, p)
    if (answers.size > size) {
      const oldest = answers.keys().next().value!
      answers.delete(oldest)
      settled.delete(oldest)
    }
    return p
  }
  return Object.assign(ask_, { peek: (k: K) => settled.get(k) })
}

/** The device's answer if it has one, the server's otherwise. */
function localFirst<T>(fromDevice: Promise<T> | null, fromServer: () => Promise<T>): Promise<T> {
  return fromDevice ? fromDevice.catch(fromServer) : fromServer()
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? authHeaders() : { ...authHeaders(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await refusal(res)
  return res.json()
}

const similarCache = new Map<string, Promise<SimilarResponse>>()
const similarSettled = new Map<string, SimilarResponse>()

export type ImageKind = 'all' | 'photo' | 'illustration' | 'vector'

export interface ImageHit {
  id: number
  thumb: string
  preview: string
  width: number
  height: number
  tags: string
  user: string
  page: string
}

export interface GifHit {
  id: string
  /** The GIF a note shows, on KLIPY's servers. */
  url: string
  thumb: string
  width: number
  height: number
  title: string
}

/**
 * A note's picture that is a GIF on KLIPY's servers, not a file of ours:
 * KLIPY does not allow copies (server/routes/gifs.py).
 */
export const isGifUrl = (name: string) => /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//.test(name)

export const api = {
  kanji: kept((char: string) => get<GraphResponse>(`/api/kanji/${encodeURIComponent(char)}`)),

  /** Direct containers of several characters, for the hover peek. */
  containersOf: (chars: string[]) =>
    get<Record<string, { total: number; containers: KanjiNode[] }>>(
      '/api/kanji/containers',
      chars.map((c) => ['c', c] as [string, string]),
    ),

  map: (scope: string) => get<MapResponse>(`/api/map/${encodeURIComponent(scope)}`),

  /** Kept for the session: a character's page is opened again and again. */
  similar: Object.assign(
    (char: string): Promise<SimilarResponse> => {
      let p = similarCache.get(char)
      if (!p) {
        p = get<SimilarResponse>(`/api/kanji/${encodeURIComponent(char)}/similar`)
        p.then(
          (d) => similarSettled.set(char, d),
          () => similarCache.delete(char),
        )
        similarCache.set(char, p)
      }
      return p
    },
    { peek: (char: string) => similarSettled.get(char) },
  ),

  forms: kept((char: string) => get<FormsResponse>(`/api/kanji/${encodeURIComponent(char)}/forms`)),

  fonts: kept((char: string) => get<FontsResponse>(`/api/kanji/${encodeURIComponent(char)}/fonts`)),

  word: kept((id: number) => get<WordEntry>(`/api/search/word/${id}`)),

  // NFC, as the dictionary is: 館 (U+FA2C) pasted from an old document is 館.
  search: (raw: string, lang: string, o: SearchOptions) => {
    const q = raw.normalize('NFC')
    return localFirst(local.search(q, lang, o), () =>
      get<SearchResponse>('/api/search', [
        ['q', q],
        ['lang', lang],
        ['common', o.common ? '1' : '0'],
        ['sort', o.sort],
        ['order', o.order],
        ['limit', String(o.limit ?? 30)],
      ]),
    )
  },

  /**
   * Semantic search, streamed: `onEvent` hears each result as the model names
   * it. Always the server's -- the device has no model to ask -- and only for a
   * signed-in user. Resolves when the stream ends, whether or not it said done.
   */
  semantic: async (q: string, lang: string, onEvent: (e: SemanticEvent) => void, signal: AbortSignal) => {
    const url = new URL(BASE + '/api/search/semantic', window.location.origin)
    url.searchParams.set('q', q)
    url.searchParams.set('lang', lang)
    const res = await fetch(url, { headers: authHeaders(), signal })
    if (!res.ok) throw await refusal(res)
    // Server-sent events: `data: {json}` blocks, a blank line after each.
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += value
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        for (const line of block.split('\n')) if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)))
      }
    }
  },

  wordsFor: (char: string) =>
    localFirst(local.wordsFor(char), () =>
      get<{ char: string; words: Word[] }>(`/api/search/words-for/${encodeURIComponent(char)}`),
    ),

  wordsWith: (char: string, common: boolean, offset = 0, limit = 50) =>
    get<WordsWithResponse>(`/api/search/words-with/${encodeURIComponent(char)}`, [
      ['common', common ? 'true' : 'false'],
      ['offset', String(offset)],
      ['limit', String(limit)],
    ]),

  /**
   * The first of every word with a kanji, kept, for the list to show at once:
   * `key` is `char|common|limit` (see WordsWith).
   */
  wordsWithFirst: kept((key: string) => {
    const [char, common, limit] = key.split('|')
    return get<WordsWithResponse>(`/api/search/words-with/${encodeURIComponent(char)}`, [
      ['common', common],
      ['offset', '0'],
      ['limit', limit],
    ])
  }),

  /** A kanji page's meanings, readings and words, and its radical. */
  kanjiPage: kept((char: string) => get<KanjiPage>(`/api/search/kanji-page/${encodeURIComponent(char)}`)),

  /** For each of a character's readings, the word it forms -- 上げる for あ.げる on 上. */
  readingWords: (char: string) =>
    localFirst(local.readingWords(char), () =>
      get<{ char: string; words: Record<string, Word> }>(`/api/search/reading-words/${encodeURIComponent(char)}`),
    ),

  byLevel: (level: 1 | 2 | 3 | 4 | 5) =>
    localFirst(local.byLevel(level), () =>
      get<{ level: number; kanji: KanjiNode[]; components: KanjiNode[]; counts: { kanji: number; components: number } }>(
        `/api/kanji/by-level/${level}`,
      ),
    ),

  associations: (char: string) =>
    get<AssociationView>(`/api/assoc/for/${encodeURIComponent(char)}`),

  postAssociation: (char: string, text: string, images: string[], visibility: Visibility) =>
    send<Association>(`/api/assoc/for/${encodeURIComponent(char)}`, 'POST', { text, images, visibility }),

  /** The text with the characters of `subject` (the kanji or word as written) marked after the words standing for them. */
  kanjify: (subject: string, text: string) => send<{ text: string }>('/api/assoc/kanjify', 'POST', { subject, text }),

  editAssociation: (id: string, patch: { text?: string; images?: string[]; visibility?: Visibility }) =>
    send<Association>(`/api/assoc/${encodeURIComponent(id)}`, 'PATCH', patch),

  deleteAssociation: (id: string) =>
    send<{ id: string; deleted: boolean }>(`/api/assoc/${encodeURIComponent(id)}`, 'DELETE'),

  uploadImage: async (file: Blob, filename: string) => {
    const form = new FormData()
    form.append('file', file, filename)
    const res = await fetch(BASE + '/api/assoc/image', { method: 'POST', body: form, headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'upload failed', code: 'upload_failed' })
    return (await res.json()) as { name: string; url: string }
  },

  uploadDrawing: async (png: Blob, scene: string) => {
    const form = new FormData()
    form.append('png', png, 'drawing.png')
    form.append('scene', new Blob([scene], { type: 'application/json' }), 'drawing.excalidraw')
    const res = await fetch(BASE + '/api/assoc/drawing', { method: 'POST', body: form, headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'saving the drawing failed', code: 'drawing_failed' })
    return (await res.json()) as { name: string; url: string }
  },

  /** Pictures to draw with, from Pixabay through the server. */
  searchImages: (q: string, lang: string, kind: ImageKind, page: number) =>
    get<{ total: number; page: number; hits: ImageHit[] }>('/api/images/search', [
      ['q', q],
      ['lang', lang],
      ['kind', kind],
      ['page', String(page)],
    ]),

  /** GIFs for a note, from KLIPY through the server; an empty query is what is popular. */
  searchGifs: (q: string, lang: string, pos: string) =>
    get<{ hits: GifHit[]; next: string }>('/api/gifs/search', [
      ['q', q],
      ['lang', lang],
      ['pos', pos],
    ]),

  /** A picture from the search, full size, from our own origin so a canvas can read it. */
  fetchImage: async (id: number) => {
    const res = await fetch(`${BASE}/api/images/pixabay/${id}`, { headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'that picture could not be fetched', code: 'picture_unfetched' })
    return res.blob()
  },

  scene: (name: string) => get<Record<string, unknown>>(`/api/assoc/scene/${encodeURIComponent(name)}`),

  /** `lang` picks the language of the email. */
  requestLogin: (email: string, lang: string) =>
    send<{ sent: boolean; devLink: string | null }>('/api/auth/request', 'POST', { email, lang }),

  verifyLogin: (token: string) =>
    send<{ session: string; user: User }>('/api/auth/verify', 'POST', { token }),

  authConfig: () => get<{ googleClientId: string | null }>('/api/auth/config'),

  googleLogin: (credential: string) =>
    send<{ session: string; user: User }>('/api/auth/google', 'POST', { credential }),

  me: () => get<{ user: User | null }>('/api/auth/me'),

  updateProfile: (patch: { name?: string; username?: string }) =>
    send<{ user: User }>('/api/auth/me', 'PATCH', patch),

  uploadAvatar: async (file: Blob, filename: string) => {
    const form = new FormData()
    form.append('file', file, filename)
    const res = await fetch(BASE + '/api/auth/avatar', { method: 'POST', body: form, headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'uploading the picture failed', code: 'avatar_failed' })
    return (await res.json()) as { user: User }
  },

  removeAvatar: () => send<{ user: User }>('/api/auth/avatar', 'DELETE'),

  avatarUrl: (name: string) => `${BASE}/api/auth/avatar/${encodeURIComponent(name)}`,

  notesFor: (char: string, sort: NoteSort, offset = 0, limit = 10) =>
    get<NotesPage>(`/api/comments/for/${encodeURIComponent(char)}`, [
      ['offset', String(offset)],
      ['limit', String(limit)],
      ['sort', sort],
    ]),

  like: (assocId: string, liked: boolean) =>
    send<{ id: string; likes: number; liked: boolean }>(
      `/api/comments/like/${encodeURIComponent(assocId)}`,
      'PUT',
      { liked },
    ),

  replies: (assocId: string, offset = 0, limit = 5) =>
    get<Page<Reply>>(`/api/comments/replies/${encodeURIComponent(assocId)}`, [
      ['offset', String(offset)],
      ['limit', String(limit)],
    ]),

  reply: (assocId: string, text: string) =>
    send<Reply>(`/api/comments/replies/${encodeURIComponent(assocId)}`, 'POST', { text }),

  deleteReply: (replyId: string) =>
    send<{ id: string; deleted: boolean }>(`/api/comments/reply/${encodeURIComponent(replyId)}`, 'DELETE'),

  logout: () => send<{ ok: boolean }>('/api/auth/logout', 'POST'),

  /** A note's picture: one of ours by name, or a GIF straight from KLIPY. */
  imageUrl: (name: string) => (isGifUrl(name) ? name : `${BASE}/api/assoc/image/${encodeURIComponent(name)}`),

  /** A report from a signed-in user: what is wrong, in their words, and up to 3 pictures. */
  sendReport: async (text: string, subject: string | null, context: ReportContext, files: File[]) => {
    const form = new FormData()
    form.append('text', text)
    if (subject) form.append('subject', subject)
    form.append('context', JSON.stringify(context))
    for (const f of files) form.append('files', f, f.name)
    const res = await fetch(BASE + '/api/reports', { method: 'POST', body: form, headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'could not send the report', code: 'report_failed' })
    return (await res.json()) as { id: string; status: ReportStatus }
  },

  /** Your own reports and what became of them. */
  myReports: () => get<{ items: MyReport[] }>('/api/reports/mine'),

  /** The admin's list, newest first; `status` narrows it. */
  reports: (status?: ReportStatus, offset = 0, limit = 200) =>
    get<{ items: UserReport[]; people: Record<string, Author & { email: string }>; counts: Record<ReportStatus, number> }>(
      '/api/reports',
      [...(status ? ([['status', status]] as [string, string][]) : []), ['offset', String(offset)], ['limit', String(limit)]],
    ),

  /** How many reports are open: the owner's badge. */
  openReports: () => get<{ open: number }>('/api/reports/open-count'),

  setReportStatus: (id: string, status: ReportStatus, reply: string | null) =>
    send<{ report: UserReport }>(`/api/reports/${encodeURIComponent(id)}/status`, 'POST', { status, reply }),

  /** A report's picture as a blob: it needs the session, which an <img> can't send. */
  reportFile: async (id: string, name: string) => {
    const res = await fetch(`${BASE}/api/reports/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, { headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'that picture could not be fetched', code: 'report_file_missing' })
    return res.blob()
  },

  /** `also`: other recognisers' picks, returned with the same metadata; they do not change the ranking. */
  recognize: (strokes: [number, number][][], also: string[] = []) =>
    localFirst(local.recognize(strokes, also), () =>
      send<RecognizeResponse>('/api/recognize', 'POST', { strokes, also }),
    ),

  /** Builds the reference index ahead of time, so the first stroke is not slow. */
  recognizerReady: () =>
    localFirst(local.recognizerReady(), () => get<{ chars: number; buckets: number }>('/api/recognize/ready')),
}

export { ApiError }
