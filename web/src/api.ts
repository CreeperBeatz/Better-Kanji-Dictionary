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
  old: FormItem[]
  new: FormItem[]
  positional: FormItem[]
  formOf: FormItem[]
  forms: FormItem[]
  looksLike: FormItem[]
  lookalikeOf: FormItem[]
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

export type TaskType = 'decomposition' | 'form_link' | 'kanji_senses' | 'word_sense'
export type Origin = 'proposal' | 'suggestion'
export type FormKind = 'positional' | 'old' | 'form_of' | 'looks_like' | 'none'

/** One meaning group of a kanji, as the words it is used in divide it. */
export interface MeaningGroup {
  /** `生.life`: the kanji, a dot, a short id. */
  id: string
  en: string
  bg: string | null
  note: string | null
}

/** What each type's value is: parts, a link, meaning groups, or one group's id. */
export type TaskValue = string[] | { kind: FormKind; note: string | null } | MeaningGroup[] | string | null

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
  status: 'open' | 'auto-accepted' | 'accepted' | 'edited' | 'rejected'
  created: string
  createdBy: Author | null
  decidedBy: Author | null
  confidence?: number
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
  action: 'accept' | 'edit' | 'reject' | 'direct' | 'auto' | 'revert' | 'reopen'
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
}

export interface ReviewProgress {
  tasks: { done: number; total: number }
  stages: Record<TaskType, { done: number; total: number }>
  /** N5-N2 kanji with nothing open on their parts, forms, meanings or words. */
  kanji: { verified: number; total: number }
  meanings: { accepted: number; total: number }
}

export interface HistoryFilter {
  all?: boolean
  by?: string
  from?: string
  to?: string
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
    /** kanji_senses: its common words (and any placed), each in its group now. */
    board?: BoardWord[]
    /** kanji_senses: how many rarer words are in no group; `api.restWords` pages through them. */
    restTotal?: number
  }
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

  reviewQueueItems: (type?: TaskType, origin?: Origin, limit = 60) =>
    get<{ total: number; items: QueueItem[] }>('/api/review/queue', [
      ...(type ? [['type', type] as [string, string]] : []),
      ...(origin ? [['origin', origin] as [string, string]] : []),
      ['limit', String(limit)],
    ]),

  reviewCounts: () => get<{ items: Record<string, Record<string, number>>; decisions: number }>('/api/review/counts'),

  reviewItem: (id: string) => get<ItemDetail>(`/api/review/items/${encodeURIComponent(id)}`),

  /**
   * `words`, for a kanji's meanings: word id -> group id or null, as left on the
   * board. `skip`: the words left for later, with where they sat; they come back
   * as a follow-up item at the end of the queue.
   */
  decide: (
    id: string,
    action: 'accept' | 'edit' | 'reject' | 'skip',
    value?: TaskValue,
    reason?: string,
    words?: Record<number, string | null>,
    skip?: Record<number, string | null>,
  ) => send<{ item: QueueItem }>(`/api/review/items/${encodeURIComponent(id)}/decide`, 'POST', { action, value, reason, words, skip }),

  restWords: (char: string, offset = 0, limit = 100) =>
    get<{ total: number; offset: number; words: BoardWord[] }>(`/api/review/words/${encodeURIComponent(char)}`, [
      ['offset', String(offset)],
      ['limit', String(limit)],
    ]),

  reviewProgress: () => get<ReviewProgress>('/api/review/progress'),

  /** A reviewer's own change, live at once. */
  reviewEdit: (type: TaskType, subject: string, value: TaskValue, reason?: string) =>
    send<Decision | { unchanged: true }>('/api/review/edit', 'POST', { type, subject, value, reason }),

  /** From a user, queued for a reviewer; from a reviewer, made. */
  suggest: (type: TaskType, subject: string, value: TaskValue, reason: string) =>
    send<{ applied: boolean; item?: { id: string; status: string } }>('/api/review/suggest', 'POST', { type, subject, value, reason }),

  impact: (char: string, parts: string[]) => send<Impact>('/api/review/impact', 'POST', { char, parts }),

  reviewHistory: (f: HistoryFilter = {}, limit = 200) =>
    get<{ items: Decision[]; people: Author[] }>('/api/review/history', [
      ['all', f.all ? 'true' : 'false'],
      ...(f.by ? [['by', f.by] as [string, string]] : []),
      ...(f.from ? [['from', f.from] as [string, string]] : []),
      ...(f.to ? [['to', f.to] as [string, string]] : []),
      ['limit', String(limit)],
    ]),

  autoAccepted: () => get<{ items: Decision[] }>('/api/review/auto'),

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
