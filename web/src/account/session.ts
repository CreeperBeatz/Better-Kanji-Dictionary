/**
 * The session token, kept apart from the auth state so api.ts can read it
 * without importing the module that imports api.ts.
 */

const KEY = 'betterrtk:session'

// Mirrors storage, and stands in for it where storage is blocked -- then the
// session simply ends with the tab.
let memory: string | null = null
try {
  memory = localStorage.getItem(KEY)
} catch {
  // storage blocked
}

export function sessionToken(): string | null {
  return memory
}

export function setSessionToken(token: string | null) {
  memory = token
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked
  }
}
