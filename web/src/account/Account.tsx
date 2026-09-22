import { useEffect, useState } from 'react'
import { logout, rename, requestLink, useAuth } from './auth'

/** The rail's one line about who you are: a sign-in prompt, or your name. */
export function AccountLine({ onOpen }: { onOpen: () => void }) {
  const { user, ready, syncing } = useAuth()
  if (!ready && !syncing) return null
  return (
    <p className="account-line">
      {syncing ? (
        <span className="tally">moving this browser's notes into your account</span>
      ) : user ? (
        <button className="clear account-who" onClick={onOpen} title={user.email}>
          {user.name}
        </button>
      ) : (
        <button className="clear" onClick={onOpen}>
          log in
        </button>
      )}
    </p>
  )
}

type Sent = { email: string; devLink: string | null }

/** Mounted only while open, so each opening starts from a clean form. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, error } = useAuth()
  const [email, setEmail] = useState('')
  const [name, setName] = useState(user?.name ?? '')
  const [sent, setSent] = useState<Sent | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const res = await requestLink(email.trim())
      setSent({ email: email.trim(), devLink: res.devLink })
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'could not send the link')
    } finally {
      setBusy(false)
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim() === user?.name) return
    setBusy(true)
    try {
      await rename(name.trim())
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'could not rename')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel account-panel" role="dialog" aria-modal="true" aria-label="Account">
        {user ? (
          <>
            <h2>Signed in as {user.email}</h2>
            <form className="account-form" onSubmit={saveName}>
              <label htmlFor="account-name">Name shown on your public notes</label>
              <div className="account-row">
                <input
                  id="account-name"
                  className="assoc-text"
                  value={name}
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="account-submit" disabled={busy || !name.trim() || name.trim() === user.name}>
                  save
                </button>
              </div>
            </form>
            <p className="hint">
              Your notes are private unless you mark one public. Private notes are only ever shown to
              you.
            </p>
            {problem && <p className="account-problem">{problem}</p>}
            <p className="assoc-actions">
              <button
                className="clear"
                onClick={async () => {
                  await logout()
                  onClose()
                }}
              >
                log out
              </button>
              <button className="clear" onClick={onClose}>
                close
              </button>
            </p>
          </>
        ) : sent ? (
          <>
            <h2>Check your email</h2>
            <p className="hint">
              A sign-in link is on its way to {sent.email}. It works once and lasts 15 minutes.
            </p>
            {sent.devLink && (
              <p className="account-dev">
                No mail is set up on this server, so here is the link instead:{' '}
                <a href={sent.devLink}>open sign-in link</a>
              </p>
            )}
            <p className="assoc-actions">
              <button className="clear" onClick={() => setSent(null)}>
                use another address
              </button>
              <button className="clear" onClick={onClose}>
                close
              </button>
            </p>
          </>
        ) : (
          <>
            <h2>Log in</h2>
            <p className="hint">
              We email you a link; there is no password. Notes you wrote in this browser move into
              your account, as private notes.
            </p>
            <form className="account-form" onSubmit={send}>
              <div className="account-row">
                <input
                  className="assoc-text"
                  type="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="account-submit" disabled={busy || !email.trim()}>
                  {busy ? 'sending' : 'send link'}
                </button>
              </div>
            </form>
            {(problem || error) && <p className="account-problem">{problem ?? error}</p>}
            <p className="assoc-actions">
              <button className="clear" onClick={onClose}>
                close
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
