/** Typed client for the local BetterRTK server. */

import { sessionToken } from './account/session'

const BASE = import.meta.env.VITE_API ?? 'http://127.0.0.1:8000'

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

export interface User {
  id: string
  email: string
  /** Shown beside your public notes. */
  name: string
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
  const url = new URL(BASE + path)
  for (const [k, v] of params ?? []) url.searchParams.append(k, v)
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.detail ?? body.error ?? res.statusText)
  }
  return res.json()
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

  radicals: () => get<{ groups: RadicalGroup[]; total: number }>('/api/radicals'),

  search: (q: string) => get<SearchResponse>('/api/search', [['q', q]]),

  wordsFor: (char: string) =>
    get<{ char: string; words: Word[] }>(`/api/search/words-for/${encodeURIComponent(char)}`),

  byLevel: (level: 1 | 2 | 3 | 4 | 5) =>
    get<{ level: number; kanji: KanjiNode[]; components: KanjiNode[]; counts: { kanji: number; components: number } }>(
      `/api/kanji/by-level/${level}`,
    ),

  associations: (char: string) =>
    get<AssociationView>(`/api/assoc/for/${encodeURIComponent(char)}`),

  saveAssociation: (char: string, text: string, images: string[], visibility: Visibility) =>
    send<Association>(`/api/assoc/for/${encodeURIComponent(char)}`, 'PUT', { text, images, visibility }),

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

  me: () => get<{ user: User | null }>('/api/auth/me'),

  rename: (name: string) => send<{ user: User }>('/api/auth/me', 'PATCH', { name }),

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
    send<{ candidates: DrawCandidate[]; strokes: number }>('/api/recognize', 'POST', { strokes }),

  /** Builds the reference index server-side so the first stroke is not slow. */
  recognizerReady: () => get<{ chars: number; buckets: number }>('/api/recognize/ready'),

  searchByRadicals: (radicals: string[]) =>
    get<RadicalSearchResponse>(
      '/api/radicals/search',
      radicals.map((r) => ['r', r] as [string, string]),
    ),
}

export { ApiError }
