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
}

/** Where a decomposition comes from (server/decomp_sources.py); `bkd` is this dictionary's own. */
export type PartsSource = 'kanjivg' | 'ids' | 'tsalta' | 'cjk-decomp' | 'topokanji' | 'bkd' | 'sonnet'

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
    edges: { parent: string; child: string }[]
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
  old: { face: string; feature: 'jp78' | 'jp83' | 'jp90'; em: number; old: string }[]
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
  fanout: number[]
  strokes: (number | null)[]
  meaning: string[]
  /** The first Bulgarian meaning, or "" when there is none. */
  meaningBg: string[]
  /** 1 = in the scope in its own right, 0 = pulled in only as a part */
  target: (0 | 1)[]
  /** flat parent,child index pairs */
  edges: number[]
  /** flat a,b index pairs of lookalikes, each pair once; they pull on the layout */
  similar: number[]
  counts: { nodes: number; targets: number; edges: number }
}

export interface WordEntry {
  word: Word
  kanji: (KanjiNode & { curated: string | null })[]
  /** `hit` is the [start, end) of the word itself, inflected as it appears. */
  examples: { text: string; hit: [number, number] | null }[]
  /** The verb going the other way, が for を: 開ける for 開く; likeliest first. */
  pairs: Word[]
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
  forms: { text: string; kana: boolean; rare: boolean }[]
  inflection?: string[]
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

export type Role = 'user' | 'reviewer' | 'admin'

export interface User extends Author {
  email: string
  /** Admin is the site's owner; reviewers are approved by hand; everyone else is a user. */
  role: Role
  /** Your latest request to become a reviewer, if you made one. */
  contribution: { id: string; status: 'open' | 'approved' | 'declined'; created: string; decided: string | null } | null
}

/** An account as only the admin page sees it. */
export interface PersonCard extends Author {
  email: string
}

export interface AdminPeople {
  requests: { id: string; text: string; created: string; user: PersonCard }[]
  reviewers: (PersonCard & { since: string | null })[]
  log: { user: string; userName: string; before: Role; after: Role; by: string; byName: string; at: string; reason: string | null }[]
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

export type TaskType = 'decomposition' | 'form_link' | 'part_meaning' | 'kanji_senses' | 'word_sense' | 'bg' | 'report' | 'character'
/** What a report is about: a word's or a kanji's (server/review.py REPORT_ABOUT). */
export type ReportAbout = 'english' | 'reading' | 'meanings' | 'readings' | 'levels' | 'parts' | 'forms' | 'similar' | 'strokes' | 'other'
/** Something wrong that no card or edit can fix, in the reporter's words; never live. */
export interface Report {
  about: ReportAbout
  text: string
}
export type Origin = 'proposal' | 'suggestion'
export type FormKind = 'positional' | 'old' | 'form_of' | 'looks_like' | 'kin' | 'none'
export type PartKind = 'meaning' | 'shape'

/**
 * A form link's value. Subject X|Y of a one-way kind reads "Y is the old
 * form of X", "X is a form of Y", "X looks like Y"; `reverse` reads it from Y to X.
 */
export interface FormLink {
  kind: FormKind
  note: string | null
  reverse?: boolean
}

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
  note: string | null
  /** The note in Bulgarian, set on the Bulgarian card. */
  noteBg?: string | null
}

/**
 * What each type's value is: parts, a link, meaning groups, one group's id, or
 * for Bulgarian a list -- a word's gloss per sense, or a kanji's meanings.
 */
export type TaskValue = string[] | FormLink | PartMeaning | MeaningGroup[] | Report | string | null

/** A change waiting in the labeling queue (server/review.py). */
export interface QueueItem {
  id: string
  type: TaskType
  /** 青 · 龶|王 · 生 · 生|1234567 */
  subject: string
  proposed: TaskValue
  /** What the site shows now. */
  current: TaskValue
  source: string
  origin: Origin
  reason: string | null
  evidence: Record<string, unknown> | null
  priority: number
  /** `withdrawn`: its source no longer proposes it (a misread corrected); never a decision. */
  status: 'open' | 'auto-accepted' | 'accepted' | 'edited' | 'kept' | 'rejected' | 'withdrawn'
  created: string
  createdBy: Author | null
  decidedBy: Author | null
  confidence?: number
  /** Bulgarian word cards: the word's headword, for the list. */
  label?: string
  /** A character's card (type `character`): the items on it, and their types. */
  items?: string[]
  kinds?: TaskType[]
}

export interface Impact {
  char: string
  before: string[]
  after: string[]
  removed: string[]
  added: string[]
  /** What the character, and so everything containing it, stops or starts having as a prerequisite. */
  lost: string[]
  gained: string[]
  newEdge: boolean
  containers: number
  containersJoyo: number
  topContainers: string[]
  notes: { id: string; char: string; mentions: string[]; text: string }[]
  notesTotal: number
}

export interface Decision {
  id: string
  action: 'accept' | 'edit' | 'keep' | 'reject' | 'direct' | 'auto' | 'revert' | 'reopen'
  type: TaskType
  subject: string
  before: TaskValue
  after: TaskValue
  by: string
  byCard?: Author | null
  at: string
  item: string | null
  reason: string | null
  supersedes: string | null
  reverted_by: string | null
  /** For a kanji's meanings: how many word placements were decided with it. */
  words?: number
}

/** A word on the meanings board, in the group it is in now (null: in none). */
export interface BoardWord {
  id: number
  headword: string
  reading: string
  common: boolean
  /** JMdict newspaper frequency band, 1-48: among the nf*500 most frequent words. */
  nf: number | null
  /** On the JLPT N{jlpt} list. */
  jlpt: number | null
  /** School grade of its hardest kanji (1-6, 8 jōyō, 9-10 name kanji); null when one has none. */
  grade: number | null
  gloss: string
  glossBg: string | null
  group: string | null
  /** The drafting model's, when it drafted the placement. */
  confidence?: number | null
  /** Whether the two drafting runs agreed. */
  agree?: boolean | null
  /** Both runs agree, both sure: the board starts it ticked. */
  sure?: boolean
}

export interface ReviewProgress {
  tasks: { done: number; total: number }
  stages: Record<TaskType, { done: number; total: number }>
  /** N5-N2 kanji with nothing open on their parts, forms, meanings or words. */
  kanji: { verified: number; total: number }
  meanings: { accepted: number; total: number }
  /** Drafted word placements, decided with their kanji's meanings: not tasks of their own. */
  words: { done: number; total: number }
}

export interface HistoryFilter {
  all?: boolean
  by?: string
  from?: string
  to?: string
}

/** One item's answer on a character's card. */
export interface CardDecision {
  item: string
  action: 'accept' | 'edit' | 'keep' | 'reject' | 'skip'
  value?: TaskValue
}

/** A character's card: every item waiting about it, and what it is now. */
export interface CharacterCard {
  char: string
  items: ItemDetail[]
  context: ItemDetail['context'] & { parts: string[]; splits: SourceSplit[]; book?: BookRef | null }
}

export interface ItemDetail extends QueueItem {
  impact?: Impact
  history: Decision[]
  context: {
    forms?: FormsResponse
    a?: FormsResponse
    b?: FormsResponse
    char?: string
    kanjidic?: string[]
    curated?: string | null
    on?: string[]
    kun?: string[]
    senses?: MeaningGroup[] | null
    word?: Word
    /** Bulgarian: the machine translation the card started from. */
    built?: string[] | null
    /** Bulgarian word cards: for each of its kanji with accepted groups, the group it is in here. */
    groups?: { char: string; group: string | null; en: string | null; bg: string | null }[]
    /** kanji_senses: its common words (and any placed), each in its group now. */
    board?: BoardWord[]
    /**
     * The kanji in scope built from the subject at any depth, most frequent
     * first: for a part's meaning, the part's; for a form link, each side's.
     */
    users?: string[] | { a: string[]; b: string[] }
    /** form_link: each side's own meanings. */
    meanings?: { a: string[]; b: string[] }
    /** part_meaning: the old form of those kanji, where they have one. */
    old?: Record<string, string>
    /** part_meaning: the form links about the part still waiting in the queue. */
    formItems?: { id: string; subject: string; proposed: FormLink | null }[]
  }
}

/**
 * What one of Dani's print dictionaries says, put on a review card as evidence
 * (pipeline/book_sources.py): Цалта's kanji book (`kanji`, numbered entries)
 * or Иванов's Bulgarian-Japanese dictionary (`bg-ja`). `unsure`: what the
 * transcribing agent was not sure it read right -- the page's scan settles it.
 */
/** A word a dictionary lists, matched to the board's JMdict entry when it is there (`id`). */
export interface DictWord {
  ja: string
  reading: string | null
  gloss: string | null
  id?: number | null
}

/** One sense of a dictionary's entry; `key` is what a board word's tag points at. */
export interface DictSense {
  key: string
  /** Its number in the book: 1a, ❷, 国 ... */
  n: string
  text: string
  words?: DictWord[]
}

/** Other dictionaries' view of a kanji (server/dictionaries.py): reviewers and the admin only. */
export interface KanjiDictionaries {
  char: string
  kanjipedia: string
  kodansha?: {
    no: number
    /** The PDF pages the entry is on. */
    pages: number[]
    core: string[]
    on: string[]
    kunReadings: string[]
    grade: string | null
    strokes: number | null
    skip: string | null
    unicode: string | null
    senses: DictSense[]
    kun: { head: string; kana: string | null; text: string | null; senses: DictSense[] }[]
    independent: { head: string; kana: string | null; text: string | null }[]
    special: DictWord[]
  }
  kangorin?: {
    no: number
    pages: number[]
    /** Its old form, printed beside it in 〖〗. */
    old: string | null
    classes: string[]
    joyo: string[]
    /** Only its Japan-only senses (国): the rest of the transcription is too unsure to show. */
    senses: (DictSense & { japan: boolean; examples: string[] })[]
  }
  tsalta?: BookRef | null
  wiktionary?: { pos: string; glosses: string[]; readings: string[] }[]
  /** Board word id -> where each dictionary puts it. */
  words: Record<string, { src: 'kodansha' | 'kangorin' | 'tsalta'; key: string; label: string }[]>
}

export interface BookRef {
  /** Цалта's kanji book, Иванов's dictionary (printed pages); Kodansha, 新漢語林 (PDF pages). */
  book: 'kanji' | 'bg-ja' | 'kodansha' | 'kangorin'
  pages: number[]
  no?: number
  char?: string
  unsure?: string[]
}

/** An entry of the kanji book as transcribed (server/books.py): a numbered kanji, or a grapheme (a part with a name). */
export interface KanjiBookEntry {
  type: 'kanji' | 'grapheme'
  no?: number
  kanji?: string
  char?: string | null
  /** A grapheme's name; a kanji has a keyword. */
  name?: string | null
  glyph_desc?: string | null
  keyword?: string
  alt_meaning?: string | null
  parts: BookPart[]
  /** The book's Kanken level mark: 1-10, ★, ★★. */
  level?: string | null
  kun?: string[]
  on?: string[]
  old_form?: string | null
  freq?: number | null
  strokes?: number | null
  radical?: { char: string | null; no: number | null } | null
  words?: { ja: string; romaji: string | null; star: boolean; bg: string; jlpt: string | null }[]
  note?: string | null
}

/** A part as the kanji book draws it: a character, or a shape described in words when it has none. */
export interface BookPart {
  char: string | null
  name: string | null
  glyph_desc?: string | null
}

/** The kanji book on a decomposition: its parts, and the same split in our graph's nodes when it maps. */
export interface BookSplit extends BookRef {
  parts: BookPart[]
  split: string[] | null
}

/** The kanji book's old form of a kanji. */
export interface BookOld extends BookRef {
  old: string
}

/** The kanji book on a part: its Bulgarian names (with how often), its own entry, where it is named. */
export interface BookPartView {
  names: [string, number][]
  entry: (BookRef & { name: string | null; note: string | null }) | null
  seen: (BookRef & { name: string })[]
}

/** The kanji book's Bulgarian keyword for a kanji, and its second meaning. */
export interface BookKeyword extends BookRef {
  keyword: string
  alt: string | null
}

/** A word's gloss in either book. `shared`: the book's spelling fits other words too (イースト: yeast, east). */
export interface BookGloss extends BookRef {
  bg: string
  ja: string
  romaji: string | null
  notes?: string[]
  shared?: boolean
}

/** Every word with a kanji: by accepted meaning group, then the ones not placed yet, a page at a time. */
export interface WordsWithResponse {
  char: string
  senses: MeaningGroup[] | null
  /** One per accepted group, the catch-all (`catch-all`) last when it has words. */
  groups: (MeaningGroup & { words: Word[] })[]
  rest: { total: number; offset: number; words: Word[] }
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
 * A reviewer's edit is the one exception: dataChanged() empties them all.
 */
const keptCaches: Map<unknown, unknown>[] = []

function kept<K, T>(ask: (k: K) => Promise<T>, size = 40): (k: K) => Promise<T> {
  const answers = new Map<K, Promise<T>>()
  keptCaches.push(answers)
  return (k) => {
    let p = answers.get(k)
    if (p) answers.delete(k) // to the back of the queue, as used just now
    else {
      p = ask(k)
      p.catch(() => answers.get(k) === p && answers.delete(k))
    }
    answers.set(k, p)
    if (answers.size > size) answers.delete(answers.keys().next().value!)
    return p
  }
}

const changeListeners = new Set<() => void>()

/** Something a reviewer changed went live: forget what was kept, and tell whoever shows it. */
export function dataChanged() {
  for (const c of keptCaches) c.clear()
  similarCache.clear()
  for (const l of changeListeners) l()
}

export function onDataChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
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
  similar: (char: string): Promise<SimilarResponse> => {
    let p = similarCache.get(char)
    if (!p) {
      p = get<SimilarResponse>(`/api/kanji/${encodeURIComponent(char)}/similar`)
      p.catch(() => similarCache.delete(char))
      similarCache.set(char, p)
    }
    return p
  },

  forms: kept((char: string) => get<FormsResponse>(`/api/kanji/${encodeURIComponent(char)}/forms`)),

  fonts: kept((char: string) => get<FontsResponse>(`/api/kanji/${encodeURIComponent(char)}/fonts`)),

  word: kept((id: number) => get<WordEntry>(`/api/search/word/${id}`)),

  search: (q: string, lang: string, o: SearchOptions) =>
    localFirst(local.search(q, lang, o), () =>
      get<SearchResponse>('/api/search', [
        ['q', q],
        ['lang', lang],
        ['common', o.common ? '1' : '0'],
        ['sort', o.sort],
        ['order', o.order],
        ['limit', String(o.limit ?? 30)],
      ]),
    ),

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

  /** Ask to become a reviewer; the owner is emailed. */
  contribute: (text: string) => send<{ user: User }>('/api/auth/contribute', 'POST', { text }),

  adminPeople: () => get<AdminPeople>('/api/admin/people'),

  decideRequest: (id: string, approve: boolean) =>
    send<{ request: { id: string; status: string } }>(`/api/admin/requests/${encodeURIComponent(id)}`, 'POST', { approve }),

  revokeReviewer: (userId: string) =>
    send<{ ok: boolean }>(`/api/admin/reviewers/${encodeURIComponent(userId)}/revoke`, 'POST', {}),

  /** A note's picture: one of ours by name, or a GIF straight from KLIPY. */
  imageUrl: (name: string) => (isGifUrl(name) ? name : `${BASE}/api/assoc/image/${encodeURIComponent(name)}`),

  /**
   * Open items. `types`: how many wait per type (greys out empty stages);
   * `skipped`: how many you skipped. With `skipped` true, only those.
   */
  reviewQueueItems: (type?: TaskType, origin?: Origin, skipped = false, limit = 60) =>
    get<{ total: number; items: QueueItem[]; types: Record<TaskType, number>; skipped: number }>('/api/review/queue', [
      ...(type ? [['type', type] as [string, string]] : []),
      ...(origin ? [['origin', origin] as [string, string]] : []),
      ...(skipped ? [['skipped', 'true'] as [string, string]] : []),
      ['limit', String(limit)],
    ]),

  reviewItem: (id: string) => get<ItemDetail>(`/api/review/items/${encodeURIComponent(id)}`),

  /** A character's card: its parts, forms and part-meaning items, and the character's own facts. */
  reviewCharacter: (char: string) => get<CharacterCard>(`/api/review/characters/${encodeURIComponent(char)}`),

  /** Every item on a character's card decided at once; all "skip" leaves the card for later. */
  decideCharacter: (char: string, decisions: CardDecision[], reason?: string) =>
    send<{ items: QueueItem[] }>(`/api/review/characters/${encodeURIComponent(char)}/decide`, 'POST', { decisions, reason }),

  /** An entry of the kanji book, by number (a kanji) or character (a grapheme): reviewers and the admin only. */
  reviewBookEntry: (no: number | null, char: string | null) =>
    get<KanjiBookEntry>('/api/review/book-entry', no != null ? [['no', String(no)]] : [['char', char ?? '']]),

  /** Other dictionaries' entries for a kanji and where they put its board's words: reviewers and the admin only. */
  reviewDictionaries: (char: string) => get<KanjiDictionaries>(`/api/review/dictionaries/${encodeURIComponent(char)}`),

  /** A scanned page a card cites (server/books.py): reviewers and the admin only. */
  reviewBookPage: async (book: BookRef['book'], page: number) => {
    const res = await fetch(`${BASE}/api/review/book/${book}/${page}`, { headers: authHeaders() })
    if (!res.ok) throw await refusal(res, { message: 'that page could not be fetched', code: 'book_page_missing' })
    return res.blob()
  },

  /**
   * `words`, for a kanji's meanings: word id -> group id or null, as left on the
   * board. `skip`: the words left for later, with where they sat; they come back
   * as a follow-up item at the end of the queue.
   */
  decide: (
    id: string,
    action: 'accept' | 'edit' | 'keep' | 'reject' | 'skip',
    value?: TaskValue,
    reason?: string,
    words?: Record<number, string | null>,
    skip?: Record<number, string | null>,
    /** A kanji's Bulgarian card: group id -> the group's Bulgarian label. */
    labels?: Record<string, string>,
    /** Likewise, group id -> the group's Bulgarian note. */
    notes?: Record<string, string>,
  ) => send<{ item: QueueItem }>(`/api/review/items/${encodeURIComponent(id)}/decide`, 'POST', { action, value, reason, words, skip, labels, notes }),

  reviewProgress: () => get<ReviewProgress>('/api/review/progress'),

  /** What giving `char` these parts would change upstream, before anyone decides. */
  reviewImpact: (char: string, parts: string[]) => send<Impact>('/api/review/impact', 'POST', { char, parts }),

  /** A reviewer's own change, live at once. `words`, for a kanji's meanings edited on the page's board: word id -> group. */
  reviewEdit: (type: TaskType, subject: string, value: TaskValue, reason?: string, words?: Record<number, string | null>) =>
    send<Decision | { unchanged: true }>('/api/review/edit', 'POST', { type, subject, value, reason, words }),

  /** From a user, queued for a reviewer; from a reviewer, made. */
  suggest: (type: TaskType, subject: string, value: TaskValue, reason: string, words?: Record<number, string | null>, from?: string) =>
    send<{ applied: boolean; item?: { id: string; status: string } }>('/api/review/suggest', 'POST', { type, subject, value, reason, words, from }),

  /** For a kanji page's Edit / Suggest changes: its groups (or the open draft) and the board's words. */
  pageKanji: (char: string) =>
    get<{ char: string; senses: MeaningGroup[] | null; drafted: boolean; board: BoardWord[] }>(`/api/review/page/kanji/${encodeURIComponent(char)}`),

  /** For a word page's Edit / Suggest changes: each of its kanji's groups and the one it is in. */
  pageWord: (id: number) =>
    get<{ word: Word; kanji: { char: string; senses: MeaningGroup[] | null; group: string | null }[]; bgBuilt: string[] | null }>(
      `/api/review/page/word/${id}`,
    ),

  reviewHistory: (f: HistoryFilter = {}, limit = 200) =>
    get<{ items: Decision[]; people: Author[] }>('/api/review/history', [
      ['all', f.all ? 'true' : 'false'],
      ...(f.by ? [['by', f.by] as [string, string]] : []),
      ...(f.from ? [['from', f.from] as [string, string]] : []),
      ...(f.to ? [['to', f.to] as [string, string]] : []),
      ['limit', String(limit)],
    ]),

  revert: (decisionId: string) => send<{ decision: Decision }>(`/api/review/decisions/${encodeURIComponent(decisionId)}/revert`, 'POST'),

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
