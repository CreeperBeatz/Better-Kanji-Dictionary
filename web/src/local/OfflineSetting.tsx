/**
 * Offline lookup, in the account dialog: whether the dictionary is on this
 * device, the download while it runs, and the switch to fetch or drop it.
 * An installed app fetches it by itself; this is where a browser tab can ask.
 */

import { useEffect } from 'react'
import { checkOffline, downloadOffline, removeOffline, runningInstalled, useOffline } from './local'

function megabytes(bytes: number | null): string | null {
  return bytes ? `${Math.round(bytes / 1e6)} MB` : null
}

function day(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function percent(p: number | null): string {
  return `${Math.floor((p ?? 0) * 100)}%`
}

export function OfflineSetting() {
  const s = useOffline()

  // The size is worth knowing before saying yes to it.
  useEffect(() => {
    if (s.state === 'off' || s.state === 'error') checkOffline()
  }, [s.state])

  if (s.state === 'unsupported') return null
  const size = megabytes(s.gz)

  return (
    <section className="offline" aria-label="Offline lookup">
      <h3>Offline lookup</h3>

      {s.state === 'ready' && (
        <>
          <p className="hint">
            Search, drawing and radicals answer on this device, with or without a connection.
            The graph and notes still need one.
          </p>
          <p className="offline-meta">
            {[size, day(s.built) && `dictionary of ${day(s.built)}`].filter(Boolean).join(' · ')}
            {s.updating && <span> · updating {percent(s.progress)}</span>}
          </p>
          <p className="assoc-actions">
            <button className="clear" onClick={removeOffline}>
              remove from this device
            </button>
          </p>
        </>
      )}

      {s.state === 'loading' && <p className="hint">Opening the dictionary on this device.</p>}

      {s.state === 'downloading' && (
        <>
          <p className="hint">
            Downloading the dictionary{size && `, ${size}`}. Until it is done, lookups go to the
            server as usual.
          </p>
          <div className="offline-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((s.progress ?? 0) * 100)}>
            <span style={{ width: percent(s.progress) }} />
          </div>
          <p className="offline-meta">{percent(s.progress)}</p>
        </>
      )}

      {(s.state === 'off' || s.state === 'error') && (
        <>
          <p className="hint">
            Keep the dictionary on this device, so search, drawing and radicals answer instantly and
            work without a connection.{size && ` ${size}, downloaded once.`}
            {!runningInstalled() && ' Installing the app to your home screen does this by itself.'}
          </p>
          {s.error && <p className="account-problem">The download stopped: {s.error}.</p>}
          <p className="assoc-actions">
            <button className="account-submit" onClick={downloadOffline}>
              {s.error ? 'try again' : 'download'}
            </button>
          </p>
        </>
      )}
    </section>
  )
}
