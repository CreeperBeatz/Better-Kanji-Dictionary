import { useEffect, useRef, useState } from 'react'
import { logout, requestLink, setAvatar, updateProfile, useAuth } from './auth'
import { Credits } from '../About'
import { strings, useLang, type Lang } from '../i18n'
import { errorText } from '../i18n/errors'
import { LangSwitch } from '../i18n/LangSwitch'
import { OfflineSetting } from '../local/OfflineSetting'
import { Avatar, squareAvatar } from './Avatar'
import { GoogleButton } from './GoogleButton'

const S = strings(
  {
    moving: "Moving this browser's notes into your account",
    profileOf: '{name} (@{username}) — profile',
    logIn: 'Log in',
    account: 'Account',
    checkEmail: 'Check your email',
    linkSent: 'A sign-in link is on its way to {email}. It works once and lasts 15 minutes.',
    devLink: 'No mail is set up on this server, so here is the link instead:',
    openLink: 'open sign-in link',
    otherAddress: 'use another address',
    close: 'close',
    logInHint:
      'Continue with Google, or we email you a link; there is no password. Notes you wrote in this browser move into your account, as private notes.',
    sending: 'sending',
    sendLink: 'send link',
    language: 'Language',
    cannotSend: 'could not send the link',
    cannotSave: 'could not save your profile',
    cannotUsePicture: 'could not use that picture',
    cannotRemovePicture: 'could not remove the picture',
    changePictureTitle: 'Change your picture',
    change: 'change',
    changePicture: 'change picture',
    addPicture: 'add a picture',
    removePicture: 'remove picture',
    name: 'Name',
    username: 'Username',
    usernameRule: '3 to 24 letters, digits, _ or -',
    saved: 'saved',
    save: 'save',
    profileHint:
      'Your name, username and picture show beside your public notes and replies. Your email is never shown. Notes are private unless you mark one public.',
    logOut: 'log out',
  },
  {
    moving: 'Бележките от този браузър се преместват в профила ви',
    profileOf: '{name} (@{username}) — профил',
    logIn: 'Вход',
    account: 'Профил',
    checkEmail: 'Проверете имейла си',
    linkSent: 'Връзка за вход пътува към {email}. Работи веднъж и важи 15 минути.',
    devLink: 'На този сървър няма настроена поща, затова ето връзката направо:',
    openLink: 'отворете връзката за вход',
    otherAddress: 'използвайте друг адрес',
    close: 'затворете',
    logInHint:
      'Продължете с Google или ще ви изпратим връзка по имейл; парола няма. Бележките, писани в този браузър, се преместват в профила ви като лични бележки.',
    sending: 'изпращане',
    sendLink: 'изпратете връзка',
    language: 'Език',
    cannotSend: 'връзката не можа да бъде изпратена',
    cannotSave: 'профилът не можа да бъде запазен',
    cannotUsePicture: 'тази снимка не може да се използва',
    cannotRemovePicture: 'снимката не можа да бъде премахната',
    changePictureTitle: 'Сменете снимката си',
    change: 'сменете',
    changePicture: 'сменете снимката',
    addPicture: 'добавете снимка',
    removePicture: 'премахнете снимката',
    name: 'Име',
    username: 'Потребителско име',
    usernameRule: 'от 3 до 24 букви, цифри, _ или -',
    saved: 'запазено',
    save: 'запазете',
    profileHint:
      'Името, потребителското име и снимката ви се виждат до публичните ви бележки и отговори. Имейлът ви не се показва никога. Бележките са лични, освен ако не отбележите някоя като публична.',
    logOut: 'изход',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

/** Top-right of the stage: your picture, or a silhouette that opens sign-in. */
export function ProfileButton({ onOpen }: { onOpen: () => void }) {
  const t = S(useLang())
  const { user, ready, syncing } = useAuth()
  const label = syncing
    ? t('moving')
    : user
      ? t('profileOf', { name: user.name, username: user.username ?? '' })
      : t('logIn')
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

function message(err: unknown, fallback: Key, lang: Lang) {
  return err instanceof Error ? errorText(err, lang) : S(lang)(fallback)
}

/** Mounted only while open, so each opening starts from a clean form. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const lang = useLang()
  const t = S(lang)
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
      setProblem(message(err, 'cannotSend', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel account-panel" role="dialog" aria-modal="true" aria-label={t('account')}>
        {user ? (
          <Profile onClose={onClose} />
        ) : sent ? (
          <>
            <h2>{t('checkEmail')}</h2>
            <p className="hint">{t('linkSent', { email: sent.email })}</p>
            {sent.devLink && (
              <p className="account-dev">
                {t('devLink')} <a href={sent.devLink}>{t('openLink')}</a>
              </p>
            )}
            <p className="assoc-actions">
              <button className="clear" onClick={() => setSent(null)}>
                {t('otherAddress')}
              </button>
              <button className="clear" onClick={onClose}>
                {t('close')}
              </button>
            </p>
          </>
        ) : (
          <>
            <h2>{t('logIn')}</h2>
            <p className="hint">{t('logInHint')}</p>
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
                  {busy ? t('sending') : t('sendLink')}
                </button>
              </div>
            </form>
            {(problem || error) && <p className="account-problem">{problem ?? error}</p>}
            <p className="assoc-actions">
              <button className="clear" onClick={onClose}>
                {t('close')}
              </button>
            </p>
          </>
        )}
        <p className="account-language">
          <span>{t('language')}</span>
          <LangSwitch />
        </p>
        <OfflineSetting />
        <Credits />
      </div>
    </div>
  )
}

const USERNAME = /^[a-z0-9_-]{3,24}$/

function Profile({ onClose }: { onClose: () => void }) {
  const lang = useLang()
  const t = S(lang)
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
      setProblem(message(err, 'cannotSave', lang))
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
      setProblem(message(err, 'cannotUsePicture', lang))
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
      setProblem(message(err, 'cannotRemovePicture', lang))
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
          title={t('changePictureTitle')}
        >
          <Avatar author={user} size={72} />
          <span className="profile-picture-edit">{t('change')}</span>
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
          {user.avatar ? t('changePicture') : t('addPicture')}
        </button>
        {user.avatar && (
          <button className="clear" onClick={removePicture} disabled={busy}>
            {t('removePicture')}
          </button>
        )}
      </p>

      <form className="account-form profile-form" onSubmit={save}>
        <label htmlFor="account-name">{t('name')}</label>
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
        <label htmlFor="account-username">{t('username')}</label>
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
        {!usernameOk && cleanUsername && <p className="profile-rule">{t('usernameRule')}</p>}
        <div className="account-row profile-save">
          <span className="tally">{saved && !changed ? t('saved') : ''}</span>
          <button className="account-submit" disabled={busy || !changed || !cleanName || !usernameOk}>
            {t('save')}
          </button>
        </div>
      </form>

      <p className="hint">{t('profileHint')}</p>
      {problem && <p className="account-problem">{problem}</p>}
      <p className="assoc-actions">
        <button
          className="clear"
          onClick={async () => {
            await logout()
            onClose()
          }}
        >
          {t('logOut')}
        </button>
        <button className="clear" onClick={onClose}>
          {t('close')}
        </button>
      </p>
    </>
  )
}
