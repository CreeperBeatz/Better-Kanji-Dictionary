import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { signInWithGoogle } from './auth'

/**
 * Google's own "Continue with Google" button. It renders nothing until the
 * server says it has a client id, so a server without one just offers email.
 * The button hands back a signed ID token, which the server checks and trades
 * for a session like an email link.
 */

interface GoogleId {
  initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup' }): void
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

let ready: Promise<string | null> | null = null

/** The client id once Google's script has loaded, or null when sign-in with Google is off. */
function loadGoogle(): Promise<string | null> {
  ready ??= api
    .authConfig()
    .then(({ googleClientId }) => {
      if (!googleClientId) return null
      return new Promise<string | null>((resolve) => {
        const script = document.createElement('script')
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.onload = () => resolve(googleClientId)
        // Blocked by an extension, or offline: email still works.
        script.onerror = () => resolve(null)
        document.head.appendChild(script)
      })
    })
    .catch(() => {
      ready = null
      return null
    })
  return ready
}

export function GoogleButton({ onError }: { onError: (message: string | null) => void }) {
  const slot = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadGoogle().then((clientId) => {
      const el = slot.current
      if (cancelled || !clientId || !el || !window.google) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: ({ credential }) => {
          onError(null)
          signInWithGoogle(credential).catch((e) =>
            onError(e instanceof Error ? e.message : 'signing in with Google failed'),
          )
        },
      })
      window.google.accounts.id.renderButton(el, {
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        // The rest of the app is English; Google would otherwise follow the browser's language.
        locale: 'en',
        // The rest of the app is English; Google would otherwise follow the browser's language.
        locale: 'en',
        width: Math.min(el.clientWidth || 320, 400),
      })
      setShown(true)
    })
    return () => {
      cancelled = true
    }
  }, [onError])

  return (
    <>
      <div ref={slot} className="google-slot" hidden={!shown} />
      {shown && <p className="account-or">or by email</p>}
    </>
  )
}
