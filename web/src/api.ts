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
  onYomi: string[]
  kunYomi: string[]
  fanout: number | null
  depth?: number
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
  /** 1 = in the scope in its own right, 0 = pulled in only as a part */
  target: (0 | 1)[]
  /** flat parent,child index pairs */
  edges: number[]
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
}

export interface Word {
  id: number
  headword: string
  reading: string
  common: boolean
  nf: number | null
  pitch: string | null
  senses: Sense[]
  forms: { text: string; kana: boolean; rare: boolean }[]
  inflection?: string[]
}

export interface KanjiHit {
  char: string
  meanings: string[]
  curated: string | null
  freq: number | null
  jlpt: number | null
  joyo: boolean
  strokes: number | null
  fanout: number
}

export interface SearchResponse {
  query: string
  interpretation: { kind: string; reading?: string } | null
  kanji: KanjiHit[]
  words: Word[]
  total: number
}

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
}

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const token = sessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string, params?: [string, string][]): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  for (const [k, v] of params ?? []) url.searchParams.append(k, v)
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.detail ?? body.error ?? res.statusText)
  }
  return res.json()
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
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new ApiError(res.status, detail.detail ?? res.statusText)
  }
  return res.json()
}

export const api = {
  kanji: (char: string) => get<GraphResponse>(`/api/kanji/${encodeURIComponent(char)}`),

  /** Direct containers of several characters, for the hover peek. */
  containersOf: (chars: string[]) =>
    get<Record<string, { total: number; containers: KanjiNode[] }>>(
      '/api/kanji/containers',
      chars.map((c) => ['c', c] as [string, string]),
    ),

  map: (scope: string) => get<MapResponse>(`/api/map/${encodeURIComponent(scope)}`),

  word: (id: number) => get<WordEntry>(`/api/search/word/${id}`),

  radicals: () =>
    localFirst(local.radicals(), () => get<{ groups: RadicalGroup[]; total: number }>('/api/radicals')),

  search: (q: string) => localFirst(local.search(q), () => get<SearchResponse>('/api/search', [['q', q]])),

  wordsFor: (char: string) =>
    localFirst(local.wordsFor(char), () =>
      get<{ char: string; words: Word[] }>(`/api/search/words-for/${encodeURIComponent(char)}`),
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
    if (!res.ok) throw new ApiError(res.status, 'upload failed')
    return (await res.json()) as { name: string; url: string }
  },

  uploadDrawing: async (png: Blob, scene: string) => {
    const form = new FormData()
    form.append('png', png, 'drawing.png')
    form.append('scene', new Blob([scene], { type: 'application/json' }), 'drawing.excalidraw')
    const res = await fetch(BASE + '/api/assoc/drawing', { method: 'POST', body: form, headers: authHeaders() })
    if (!res.ok) throw new ApiError(res.status, 'saving the drawing failed')
    return (await res.json()) as { name: string; url: string }
  },

  scene: (name: string) => get<Record<string, unknown>>(`/api/assoc/scene/${encodeURIComponent(name)}`),

  requestLogin: (email: string) =>
    send<{ sent: boolean; devLink: string | null }>('/api/auth/request', 'POST', { email }),

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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body.detail ?? 'uploading the picture failed')
    }
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

  recognize: (strokes: [number, number][][]) =>
    localFirst(local.recognize(strokes), () =>
      send<{ candidates: DrawCandidate[]; strokes: number }>('/api/recognize', 'POST', { strokes }),
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
