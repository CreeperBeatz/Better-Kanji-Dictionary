/**
 * On an iPhone in Safari: a note, once, that the app does more installed.
 * In a tab, Safari keeps its address bar on the screen and takes the swipes
 * from the screen's edges for its own back and forward.
 */

import { useState } from 'react'
import { strings, useLang } from '../i18n'
import { runningInstalled } from '../local/local'
import { isIOS } from '../media'

const S = strings(
  {
    lead: 'Use it as an app.',
    why: 'It opens on the full screen, and every swipe is the app’s.',
    how: 'Tap Share, then “Add to Home Screen”.',
    close: 'Close',
  },
  {
    lead: 'Използвайте го като приложение.',
    why: 'Отваря се на целия екран и всяко плъзгане е за приложението.',
    how: 'Натиснете „Споделяне“, после „Добавяне към начален екран“.',
    close: 'Затвори',
  },
)

const KEY = 'betterrtk:installHintSeen'
const wanted = () => {
  try {
    return isIOS() && !runningInstalled() && !localStorage.getItem(KEY)
  } catch {
    return false
  }
}

export function InstallHint() {
  const t = S(useLang())
  const [shown, setShown] = useState(wanted)
  if (!shown) return null
  function close() {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // storage blocked: it goes for this visit only
    }
    setShown(false)
  }
  return (
    <aside className="install-hint">
      <p>
        <strong>{t('lead')}</strong> {t('why')}
        <br />
        {t('how')}
      </p>
      <button className="install-hint-close" onClick={close} aria-label={t('close')}>
        ×
      </button>
    </aside>
  )
}
