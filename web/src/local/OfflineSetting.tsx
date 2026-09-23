/**
 * Offline lookup, in the account dialog: whether the dictionary is on this
 * device, the download while it runs, and the switch to fetch or drop it.
 * An installed app fetches it by itself; this is where a browser tab can ask.
 */

import { useEffect } from 'react'
import { strings, useLang, type Lang } from '../i18n'
import { checkOffline, downloadOffline, removeOffline, runningInstalled, useOffline } from './local'

const S = strings(
  {
    title: 'Offline lookup',
    readyHint:
      'Search, drawing and radicals answer on this device, with or without a connection. The graph and notes still need one.',
    dictionaryOf: 'dictionary of {date}',
    updating: 'updating {percent}',
    remove: 'remove from this device',
    opening: 'Opening the dictionary on this device.',
    downloading: 'Downloading the dictionary. Until it is done, lookups go to the server as usual.',
    downloadingSize: 'Downloading the dictionary, {size}. Until it is done, lookups go to the server as usual.',
    offHint:
      'Keep the dictionary on this device, so search, drawing and radicals answer instantly and work without a connection.',
    offSize: '{size}, downloaded once.',
    install: 'Installing the app to your home screen does this by itself.',
    stopped: 'The download stopped: {error}.',
    tryAgain: 'try again',
    download: 'download',
    // What the lookup worker says went wrong, in its own English
    noStorage: 'there is not enough storage on this device',
    dropped: 'the connection dropped',
    incomplete: 'the pack on this device is incomplete',
    notOffered: 'the server could not offer the dictionary ({status})',
    fileFailed: 'downloading {file} failed ({status})',
  },
  {
    title: 'Търсене без връзка',
    readyHint:
      'Търсенето, рисуването и радикалите работят на това устройство, със или без връзка. Графът и бележките все още имат нужда от нея.',
    dictionaryOf: 'речник от {date}',
    updating: 'обновяване {percent}',
    remove: 'премахнете от това устройство',
    opening: 'Речникът се отваря на това устройство.',
    downloading: 'Речникът се изтегля. Докато не приключи, търсенето минава през сървъра както обикновено.',
    downloadingSize:
      'Речникът се изтегля, {size}. Докато не приключи, търсенето минава през сървъра както обикновено.',
    offHint:
      'Запазете речника на това устройство, за да отговарят търсенето, рисуването и радикалите веднага и без връзка.',
    offSize: '{size}, изтегля се веднъж.',
    install: 'Ако инсталирате приложението на началния екран, това става от само себе си.',
    stopped: 'Изтеглянето спря: {error}.',
    tryAgain: 'опитайте пак',
    download: 'изтеглете',
    noStorage: 'на това устройство няма достатъчно място',
    dropped: 'връзката прекъсна',
    incomplete: 'речникът на това устройство е непълен',
    notOffered: 'сървърът не можа да предложи речника ({status})',
    fileFailed: 'изтеглянето на {file} не успя ({status})',
  },
)

function megabytes(bytes: number | null): string | null {
  return bytes ? `${Math.round(bytes / 1e6)} MB` : null
}

function day(iso: string | null, lang: Lang): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })
}

function percent(p: number | null): string {
  return `${Math.floor((p ?? 0) * 100)}%`
}

/** The worker's English, in the interface language when it is one it is known to say. */
function reason(error: string, t: ReturnType<typeof S>): string {
  if (error === 'there is not enough storage on this device') return t('noStorage')
  if (error === 'the connection dropped') return t('dropped')
  if (error === 'the pack on this device is incomplete') return t('incomplete')
  let m = /^the server could not offer the dictionary \((\d+)\)$/.exec(error)
  if (m) return t('notOffered', { status: m[1] })
  m = /^downloading (\S+) failed \((\d+)\)$/.exec(error)
  if (m) return t('fileFailed', { file: m[1], status: m[2] })
  return error
}

export function OfflineSetting() {
  const lang = useLang()
  const t = S(lang)
  const s = useOffline()

  // The size is worth knowing before saying yes to it.
  useEffect(() => {
    if (s.state === 'off' || s.state === 'error') checkOffline()
  }, [s.state])

  if (s.state === 'unsupported') return null
  const size = megabytes(s.gz)
  const built = day(s.built, lang)

  return (
    <section className="offline" aria-label={t('title')}>
      <h3>{t('title')}</h3>

      {s.state === 'ready' && (
        <>
          <p className="hint">{t('readyHint')}</p>
          <p className="offline-meta">
            {[size, built && t('dictionaryOf', { date: built })].filter(Boolean).join(' · ')}
            {s.updating && <span> · {t('updating', { percent: percent(s.progress) })}</span>}
          </p>
          <p className="assoc-actions">
            <button className="clear" onClick={removeOffline}>
              {t('remove')}
            </button>
          </p>
        </>
      )}

      {s.state === 'loading' && <p className="hint">{t('opening')}</p>}

      {s.state === 'downloading' && (
        <>
          <p className="hint">{size ? t('downloadingSize', { size }) : t('downloading')}</p>
          <div className="offline-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((s.progress ?? 0) * 100)}>
            <span style={{ width: percent(s.progress) }} />
          </div>
          <p className="offline-meta">{percent(s.progress)}</p>
        </>
      )}

      {(s.state === 'off' || s.state === 'error') && (
        <>
          <p className="hint">
            {t('offHint')}
            {size && ` ${t('offSize', { size })}`}
            {!runningInstalled() && ` ${t('install')}`}
          </p>
          {s.error && <p className="account-problem">{t('stopped', { error: reason(s.error, t) })}</p>}
          <p className="assoc-actions">
            <button className="account-submit" onClick={downloadOffline}>
              {s.error ? t('tryAgain') : t('download')}
            </button>
          </p>
        </>
      )}
    </section>
  )
}
