/**
 * On an iPhone or iPad, in a browser: how to put the app on the Home Screen,
 * step by step, for the browser in use -- Safari or Chrome with its own
 * screens, or any other in general terms. It opens by itself on the first
 * visit, and from the search home's note and the account dialog after that. Installed, the app has
 * the whole screen, and the swipes from the screen's edges are the only ones
 * that are not its own.
 */

import { useState, useSyncExternalStore } from 'react'
import { strings, useLang } from '../i18n'
import { runningInstalled } from '../local/local'
import { isIOS } from '../account/install'
import { Overlay } from '../Overlay'
import step1 from './step1.webp'
import step2 from './step2.webp'
import step3 from './step3.webp'
import step4 from './step4.webp'
import step5 from './step5.webp'
import chrome1 from './chrome1.webp'
import chrome2 from './chrome2.webp'
import chrome3 from './chrome3.webp'
import chrome4 from './chrome4.webp'

const S = strings(
  {
    label: 'Install the app',
    title: 'This app is designed to work from your Home Screen',
    why: 'In the browser, you might see some bugs or glitches.',
    s1: 'Tap ••• at the bottom right.',
    s1b: 'No ••• button? Tap Share, then go to step 3.',
    s2: 'Tap Share.',
    s3: 'Tap View More.',
    s4: 'Tap Add to Home Screen.',
    s5: 'Keep Open as Web App on. Tap Add.',
    c1: 'Tap Share, in the address bar.',
    o1: 'Tap Share in your browser.',
    o1b: 'No Share, or no Add to Home Screen after it? Open this page in Safari.',
    o2: 'Tap Add to Home Screen.',
    o3: 'Tap Add.',
    done: 'Then open Better Kanji from your Home Screen.',
    later: 'Not now',
    noteLead: 'This dictionary works better as an app.',
    noteHow: 'Show me how',
    noteClose: 'Close',
  },
  {
    label: 'Инсталиране на приложението',
    title: 'Приложението е направено за работа от началния екран',
    why: 'В браузъра може да видите грешки и проблеми.',
    s1: 'Натиснете ••• долу вдясно.',
    s1b: 'Няма бутон •••? Натиснете „Споделяне“ и продължете от стъпка 3.',
    s2: 'Натиснете „Споделяне“.',
    s3: 'Натиснете „Покажи още“.',
    s4: 'Натиснете „Добавяне към начален екран“.',
    s5: 'Оставете „Отваряне като уеб приложение“ включено. Натиснете „Добави“.',
    c1: 'Натиснете „Споделяне“ в адресната лента.',
    o1: 'Натиснете „Споделяне“ в браузъра.',
    o1b: 'Няма „Споделяне“ или „Добавяне към начален екран“? Отворете страницата в Safari.',
    o2: 'Натиснете „Добавяне към начален екран“.',
    o3: 'Натиснете „Добави“.',
    done: 'После отворете Better Kanji от началния екран.',
    later: 'Не сега',
    noteLead: 'Речникът работи по-добре като приложение.',
    noteHow: 'Покажи как',
    noteClose: 'Затвори',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
type Step = { text: Key; note?: Key; img?: string; h?: number }

/** The browser the steps are for: they differ in where Share is. */
function browser(): 'safari' | 'chrome' | 'other' {
  const ua = navigator.userAgent
  if (/CriOS\//.test(ua)) return 'chrome'
  // Every iOS browser says Safari; the others add a name of their own.
  if (/Safari\//.test(ua) && !/(FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|YaBrowser|Brave)\//.test(ua)) return 'safari'
  return 'other'
}

const STEPS: Record<ReturnType<typeof browser>, Step[]> = {
  safari: [
    { text: 's1', note: 's1b', img: step1, h: 234 },
    { text: 's2', img: step2, h: 748 },
    { text: 's3', img: step3, h: 573 },
    { text: 's4', img: step4, h: 403 },
    { text: 's5', img: step5, h: 488 },
  ],
  // After Share, Chrome's steps are Safari's: the same system screens.
  chrome: [
    { text: 'c1', img: chrome1, h: 195 },
    { text: 's3', img: chrome2, h: 579 },
    { text: 's4', img: chrome3, h: 452 },
    { text: 's5', img: chrome4, h: 488 },
  ],
  other: [{ text: 'o1', note: 'o1b' }, { text: 'o2' }, { text: 'o3' }],
}

const SEEN_KEY = 'betterrtk:installGuideSeen'

/** A browser on an iPhone or iPad, not the app from the Home Screen. */
export const installable = () => isIOS && !runningInstalled()

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null
  } catch {
    return true
  }
}

// Open or shut, for the link on the search home to open it from anywhere.
let open = installable() && !seen()
const listeners = new Set<() => void>()
function setOpen(next: boolean) {
  open = next
  listeners.forEach((l) => l())
}
export const openInstallGuide = () => setOpen(true)

/** The guide itself, mounted once by the app. */
export function InstallGuide() {
  const t = S(useLang())
  const shown = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => open,
  )
  if (!shown) return null
  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // storage blocked: it opens again next visit
    }
    setOpen(false)
  }
  return (
    <Overlay className="install-overlay" panel="account-panel install-panel" label={t('label')} onClose={close}>
      <h2 className="install-title">{t('title')}</h2>
      <p className="install-why">{t('why')}</p>
      <ol className="install-steps">
        {STEPS[browser()].map((s, i) => (
          <li key={s.text}>
            <p>
              <span className="install-n">{i + 1}</span>
              {t(s.text)}
            </p>
            {s.note && <p className="hint install-note">{t(s.note)}</p>}
            {s.img && <img src={s.img} width={600} height={s.h} alt="" loading={i < 2 ? 'eager' : 'lazy'} />}
          </li>
        ))}
      </ol>
      <p className="install-done">{t('done')}</p>
      <button className="install-later" onClick={close}>
        {t('later')}
      </button>
    </Overlay>
  )
}

const NOTE_KEY = 'betterrtk:installHintSeen'

/**
 * On the search home, in a browser on an iPhone: that the app does more
 * installed, with the guide a tap away, until it is closed.
 */
export function InstallNote() {
  const t = S(useLang())
  const [shown, setShown] = useState(() => {
    try {
      return installable() && !localStorage.getItem(NOTE_KEY)
    } catch {
      return false
    }
  })
  if (!shown) return null
  function close() {
    try {
      localStorage.setItem(NOTE_KEY, '1')
    } catch {
      // storage blocked: it goes for this visit only
    }
    setShown(false)
  }
  return (
    <aside className="install-hint">
      <p>
        <strong>{t('noteLead')}</strong>
        <br />
        <button className="install-hint-show" onClick={openInstallGuide}>
          {t('noteHow')}
        </button>
      </p>
      <button className="install-hint-close" onClick={close} aria-label={t('noteClose')}>
        ×
      </button>
    </aside>
  )
}
