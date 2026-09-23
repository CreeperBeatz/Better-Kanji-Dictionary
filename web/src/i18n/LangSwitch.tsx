/** The EN · БГ switch: one tap flips the interface and the dictionary's glosses. */

import { setLang, strings, useLang } from '.'

const S = strings(
  { label: 'Interface language: English. Switch to Bulgarian' },
  { label: 'Език на интерфейса: български. Превключете на английски' },
)

export function LangSwitch() {
  const lang = useLang()
  const t = S(lang)
  return (
    <button
      className="lang-switch"
      onClick={() => setLang(lang === 'en' ? 'bg' : 'en')}
      title={t('label')}
      aria-label={t('label')}
    >
      <span data-on={lang === 'en' || undefined}>EN</span>
      <span aria-hidden="true">·</span>
      <span data-on={lang === 'bg' || undefined} lang="bg">
        БГ
      </span>
    </button>
  )
}
