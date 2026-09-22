import { useEffect, useRef, useState } from 'react'
import { logout, requestLink, setAvatar, updateProfile, useAuth } from './auth'
import { Credits } from '../About'
import { Avatar, squareAvatar } from './Avatar'
import { GoogleButton } from './GoogleButton'

/** Top-right of the stage: your picture, or a silhouette that opens sign-in. */
export function ProfileButton({ onOpen }: { onOpen: () => void }) {
  const { user, ready, syncing } = useAuth()
  const label = syncing
    ? "Moving this browser's notes into your account"
    : user
      ? `${user.name} (@${user.username}) — profile`
      : 'Log in'
  return (
    <button
      className="profile-button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      data-busy={syncing || !ready || undefined}
    >
      <Avatar author={user} size={28} />
    </button>
  )
}

type Sent = { email: string; devLink: string | null }

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

/** Mounted only while open, so each opening starts from a clean form. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, error } = useAuth()
  const [email, setEmail] = useState('')
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
      setProblem(message(err, 'could not send the link'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel account-panel" role="dialog" aria-modal="true" aria-label="Account">
        {user ? (
          <Profile onClose={onClose} />
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
              Continue with Google, or we email you a link; there is no password. Notes you wrote in
              this browser move into your account, as private notes.
            </p>
            <GoogleButton onError={setProblem} />
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
        <Credits />
      </div>
    </div>
  )
}

const USERNAME = /^[a-z0-9_-]{3,24}$/

function Profile({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  if (!user) return null

  const cleanName = name.trim()
  const cleanUsername = username.trim().toLowerCase().replace(/^@/, '')
  const changed = cleanName !== user.name || cleanUsername !== user.username
  const usernameOk = USERNAME.test(cleanUsername)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!changed || !cleanName || !usernameOk || !user) return
    setBusy(true)
    setProblem(null)
    try {
      await updateProfile({
        ...(cleanName !== user.name && { name: cleanName }),
        ...(cleanUsername !== user.username && { username: cleanUsername }),
      })
      setSaved(true)
    } catch (err) {
      setProblem(message(err, 'could not save your profile'))
    } finally {
      setBusy(false)
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setProblem(null)
    try {
      await setAvatar(await squareAvatar(file))
    } catch (err) {
      setProblem(message(err, 'could not use that picture'))
    } finally {
      setBusy(false)
    }
  }

  async function removePicture() {
    setBusy(true)
    setProblem(null)
    try {
      await setAvatar(null)
    } catch (err) {
      setProblem(message(err, 'could not remove the picture'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="profile-head">
        <button
          className="profile-picture"
          onClick={() => picker.current?.click()}
          disabled={busy}
          title="Change your picture"
        >
          <Avatar author={user} size={72} />
          <span className="profile-picture-edit">change</span>
        </button>
        <div className="profile-who">
          <strong>{user.name}</strong>
          <span>@{user.username}</span>
          <span className="profile-email">{user.email}</span>
        </div>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
      </div>
      <p className="assoc-actions profile-picture-actions">
        <button className="clear" onClick={() => picker.current?.click()} disabled={busy}>
          {user.avatar ? 'change picture' : 'add a picture'}
        </button>
        {user.avatar && (
          <button className="clear" onClick={removePicture} disabled={busy}>
            remove picture
          </button>
        )}
      </p>

      <form className="account-form profile-form" onSubmit={save}>
        <label htmlFor="account-name">Name</label>
        <input
          id="account-name"
          className="assoc-text"
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value)
            setSaved(false)
          }}
        />
        <label htmlFor="account-username">Username</label>
        <div className="profile-handle">
          <span aria-hidden="true">@</span>
          <input
            id="account-username"
            className="assoc-text"
            value={username}
            maxLength={25}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setUsername(e.target.value)
              setSaved(false)
            }}
          />
        </div>
        {!usernameOk && cleanUsername && (
          <p className="profile-rule">3 to 24 letters, digits, _ or -</p>
        )}
        <div className="account-row profile-save">
          <span className="tally">{saved && !changed ? 'saved' : ''}</span>
          <button className="account-submit" disabled={busy || !changed || !cleanName || !usernameOk}>
            save
          </button>
        </div>
      </form>

      <p className="hint">
        Your name, username and picture show beside your public notes and replies. Your email is
        never shown. Notes are private unless you mark one public.
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
  )
}
