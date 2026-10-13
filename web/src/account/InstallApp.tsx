/** In the account dialog: the app onto the home screen, or the desktop. */
import { strings, useLang } from '../i18n'
import { openInstallGuide } from '../install/InstallGuide'
import { install, onPhone, useInstall } from './install'

const S = strings(
  {
    phone: 'Install on home screen',
    desktop: 'Install on desktop',
    hint: 'It opens like an app, in its own window, and keeps the dictionary for use without a connection.',
  },
  {
    phone: 'Инсталирайте на началния екран',
    desktop: 'Инсталирайте на компютъра',
    hint: 'Отваря се като приложение, в свой прозорец, и пази речника за използване без връзка.',
  },
)

export function InstallApp() {
  const t = S(useLang())
  const how = useInstall()
  if (!how) return null
  return (
    <section className="account-install">
      {/* iOS has no install dialog of its own: the guide shows the way by hand. */}
      <button className="account-submit" onClick={() => (how === 'prompt' ? install() : openInstallGuide())}>
        {t(onPhone ? 'phone' : 'desktop')}
      </button>
      <p className="hint">{t('hint')}</p>
    </section>
  )
}
