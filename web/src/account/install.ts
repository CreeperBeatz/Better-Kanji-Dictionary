/**
 * Installing the app: on Android and in desktop Chrome or Edge the browser
 * offers it with `beforeinstallprompt`, kept here for a button to call; iOS
 * has no such event, only Share > Add to Home Screen, which the button explains.
 * Imported by main.tsx, so the event is caught however early it comes.
 */
import { useSyncExternalStore } from 'react'
import { runningInstalled } from '../local/local'

type InstallPrompt = Event & { prompt: () => Promise<void> }

let offer: InstallPrompt | null = null
let installed = runningInstalled()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

window.addEventListener('beforeinstallprompt', (e) => {
  offer = e as InstallPrompt
  changed()
})
window.addEventListener('appinstalled', () => {
  offer = null
  installed = true
  changed()
})

/** iPhone and iPad, the iPad asking for the desktop site included. */
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
/** A phone or tablet, whose home screen it goes on, rather than a desktop. */
export const onPhone = isIOS || /Android/.test(navigator.userAgent)

/**
 * How this browser installs the app: 'prompt', its own dialog; 'ios', by hand;
 * null when it is installed already or this browser cannot (Firefox).
 */
export function useInstall(): 'prompt' | 'ios' | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => (installed ? null : offer ? 'prompt' : isIOS ? 'ios' : null),
  )
}

/** The browser's own install dialog; the offer is spent either way. */
export async function install() {
  const o = offer
  if (!o) return
  offer = null
  changed()
  await o.prompt()
}
