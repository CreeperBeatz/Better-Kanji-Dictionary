/**
 * Typed client for the Better Kanji Dictionary server.
 *
 * Lookups -- search, drawing, radicals, levels -- are answered on the device
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
}

export interface RadicalGroup {
  strokeCount: number
  radicals: { radical: string; kanjiCount: number }[]
}

export interface RadicalSearchResponse {
  selected: string[]
  kanji: string[]
  available: string[]
  total: number
  truncated?: boolean
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

export interface User extends Author {
  email: string
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

export interface ReviewItem {
  char: string
  freq: number | null
  strokes: number | null
  parts: number
  score: number
  reasons: string[]
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
 */
function kept<K, T>(ask: (k: K) => Promise<T>, size = 40): (k: K) => Promise<T> {
  const answers = new Map<K, Promise<T>>()
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

  word: kept((id: number) => get<WordEntry>(`/api/search/word/${id}`)),

  radicals: () =>
    localFirst(local.radicals(), () => get<{ groups: RadicalGroup[]; total: number }>('/api/radicals')),

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

  imageUrl: (name: string) => `${BASE}/api/assoc/image/${encodeURIComponent(name)}`,

  reviewQueue: (limit = 40) =>
    get<{ total: number; fixed: number; items: ReviewItem[] }>('/api/decomp/review', [
      ['limit', String(limit)],
    ]),

  setDecomposition: (char: string, components: string[]) =>
    send<{ char: string; components: string[] }>(
      `/api/decomp/${encodeURIComponent(char)}`,
      'PUT',
      { components },
    ),

  clearDecomposition: (char: string) =>
    send<{ char: string; cleared: boolean }>(`/api/decomp/${encodeURIComponent(char)}`, 'DELETE'),

  /** `also`: other recognisers' picks, returned with the same metadata; they do not change the ranking. */
  recognize: (strokes: [number, number][][], also: string[] = []) =>
    localFirst(local.recognize(strokes, also), () =>
      send<RecognizeResponse>('/api/recognize', 'POST', { strokes, also }),
    ),

  /** Builds the reference index ahead of time, so the first stroke is not slow. */
  recognizerReady: () =>
    localFirst(local.recognizerReady(), () => get<{ chars: number; buckets: number }>('/api/recognize/ready')),

  searchByRadicals: (radicals: string[]) =>
    localFirst(local.searchByRadicals(radicals), () =>
      get<RadicalSearchResponse>(
        '/api/radicals/search',
        radicals.map((r) => ['r', r] as [string, string]),
      ),
    ),
}

export { ApiError }
