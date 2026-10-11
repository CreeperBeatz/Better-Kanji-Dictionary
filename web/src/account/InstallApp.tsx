/** In the account dialog: the app onto the home screen, or the desktop. */
import { useState } from 'react'
import { strings, useLang } from '../i18n'
import { install, onPhone, useInstall } from './install'

const S = strings(
  {
    phone: 'Install on home screen',
    desktop: 'Install on desktop',
    hint: 'It opens like an app, in its own window, and keeps the dictionary for use without a connection.',
    iosSteps: 'In Safari, tap Share, then Add to Home Screen.',
  },
  {
    phone: 'Инсталирайте на началния екран',
    desktop: 'Инсталирайте на компютъра',
    hint: 'Отваря се като приложение, в свой прозорец, и пази речника за използване без връзка.',
    iosSteps: 'В Safari натиснете „Споделяне“, после „Добавяне към началния екран“.',
  },
)

export function InstallApp() {
  const t = S(useLang())
  const how = useInstall()
  const [steps, setSteps] = useState(false)
  if (!how) return null
  return (
    <section className="account-install">
      <button className="account-submit" onClick={() => (how === 'prompt' ? install() : setSteps(true))}>
        {t(onPhone ? 'phone' : 'desktop')}
      </button>
      <p className="hint">{steps ? t('iosSteps') : t('hint')}</p>
    </section>
  )
}
