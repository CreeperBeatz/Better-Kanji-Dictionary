/**
 * Who is signed in, shared across the app.
 *
 * Signing in is by emailed link: the link opens the app with `?login=<token>`,
 * which is traded for a session here. Straight after, every note written while
 * signed out is moved from the browser into the account, before the app is
 * told who you are -- so the first thing it loads already includes them.
 */

import { useSyncExternalStore } from 'react'
import { api, ApiError, type User } from '../api'
import { allNotes, deleteImage, forgetNote, getImage, isLocalImage, type LocalNote } from '../localNotes'
import { sessionToken, setSessionToken } from './session'

export interface AuthState {
  user: User | null
  /** False until any saved session has been checked, so nothing flashes "signed out". */
  ready: boolean
  /** Moving browser notes into the account. */
  syncing: boolean
  /** A sign-in link that failed, to say so once. */
  error: string | null
}

let state: AuthState = { user: null, ready: false, syncing: false, error: null }
const listeners = new Set<() => void>()

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export async function startAuth() {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('login')
  if (token) {
    // The token is single-use; keep it out of history and bookmarks either way.
    url.searchParams.delete('login')
    window.history.replaceState(null, '', url)
    try {
      const { session, user } = await api.verifyLogin(token)
      setSessionToken(session)
      set({ syncing: true })
      await moveLocalNotes()
      set({ user, ready: true, syncing: false })
      return
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : 'signing in failed', syncing: false })
    }
  }

  if (!sessionToken()) {
    set({ ready: true })
    return
  }
  try {
    const { user } = await api.me()
    if (!user) setSessionToken(null)
    set({ user, ready: true })
  } catch {
    // Server unreachable: stay signed in as far as the browser knows, and let
    // the app's own error say the server is down.
    set({ ready: true })
  }
}

export async function requestLink(email: string) {
  return api.requestLogin(email)
}

export async function logout() {
  await api.logout().catch(() => {})
  setSessionToken(null)
  set({ user: null })
}

/** The server no longer knows this session (it expired, or was ended elsewhere). */
export function sessionLost() {
  setSessionToken(null)
  set({ user: null })
}

export async function updateProfile(patch: { name?: string; username?: string }) {
  const { user } = await api.updateProfile(patch)
  set({ user })
}

export async function setAvatar(file: Blob | null) {
  // A browser that cannot encode WebP hands back a PNG instead.
  const name = file?.type === 'image/webp' ? 'avatar.webp' : 'avatar.png'
  const { user } = file ? await api.uploadAvatar(file, name) : await api.removeAvatar()
  set({ user })
}

export function clearAuthError() {
  set({ error: null })
}

/**
 * Upload every signed-out note into the account, each as its own private note
 * beside any the account already has. A note that fails to move stays in the
 * browser to try again next sign-in.
 */
async function moveLocalNotes() {
  let notes: LocalNote[]
  try {
    notes = await allNotes()
  } catch {
    return
  }
  for (const note of notes) {
    try {
      const uploaded: string[] = []
      for (const name of note.images) {
        // Already on the server: a note parked here when a session ran out.
        if (!isLocalImage(name)) {
          uploaded.push(name)
          continue
        }
        const img = await getImage(name)
        if (!img) continue
        const res = img.scene
          ? await api.uploadDrawing(img.blob, img.scene)
          : await api.uploadImage(img.blob, name.replace(/^local-/, ''))
        uploaded.push(res.name)
      }

      // Its pictures may have gone missing from the browser; an empty note is not worth keeping.
      if (note.text.trim() || uploaded.length) {
        await api.postAssociation(note.char, note.text, uploaded, 'private')
      }

      await forgetNote(note.id)
      for (const name of note.images) if (isLocalImage(name)) await deleteImage(name)
    } catch {
      // left in the browser for next time
    }
  }
}
