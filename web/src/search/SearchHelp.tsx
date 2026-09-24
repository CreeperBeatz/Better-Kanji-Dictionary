/**
 * What the search does beyond looking a word up, for whoever is still
 * finding their way: a quiet link on the empty search, and a popup that says
 * it in a few lines, with examples that type themselves in.
 *
 * Every example is one the dictionary finds nothing for, so trying it lands
 * on the "Search by meaning" button rather than on ordinary results.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    learn: 'Learn what our search can do',
    title: 'What the search can do',
    describeTitle: 'Describe what you mean',
    describe: 'A feeling, a situation, something you half remember: it finds the words for it.',
    describeEx1: 'the feeling of missing the old days',
    describeEx2: 'a gift you bring back from a trip',
    apartTitle: 'Tell close kanji apart',
    apart: 'Ask which one fits, and a short note explains the difference.',
    apartEx: 'atsui for weather or for tea?',
    explainTitle: 'Ask for explanations',
    explain: 'Wonder why a word is written with the kanji it is? Ask, and it explains what they bring to it.',
    explainEx1: 'why is tegami written with hand and paper?',
    explainEx2: 'why is Monday the day of the moon?',
    partsTitle: 'Describe a kanji by its parts',
    parts:
      "Can't type it or draw it? Say what it is made of and where the parts sit. Every answer is checked against how the kanji is really built.",
    partsEx1: 'sun beside moon',
    partsEx2: 'water on the left of blue',
    how: 'These start when the dictionary finds nothing word for word: press Enter, or ✦ Search by meaning. Each suggestion says why it fits. Sign in to use them.',
    tryIt: 'Tap an example to try it.',
    alsoTitle: 'And the smaller things',
    alsoDraw: 'Draw a kanji (✎) or pick it by its parts (部). Both type into the box, so you can build a word one kanji at a time.',
    alsoInflect: 'Conjugations are undone: 食べたくなかった finds 食べる, and says what the ending did.',
    alsoBg: 'With the interface in Bulgarian, Bulgarian typed in Latin letters works too.',
    alsoKey: 'Press / from anywhere to jump to the search.',
    close: 'Close',
  },
  {
    learn: 'Вижте какво може търсачката',
    title: 'Какво може търсачката',
    describeTitle: 'Опишете какво имате предвид',
    describe: 'Чувство, ситуация, нещо полузабравено: тя намира думите за него.',
    describeEx1: 'чувството, че ти липсват старите дни',
    describeEx2: 'подарък, който носиш от пътуване',
    apartTitle: 'Различете близки йероглифи',
    apart: 'Попитайте кой пасва и кратка бележка обяснява разликата.',
    apartEx: 'атсуи за времето или за чая?',
    explainTitle: 'Питайте за обяснения',
    explain: 'Чудите се защо една дума се пише с точно тези йероглифи? Попитайте и тя ще обясни какво носи всеки от тях.',
    explainEx1: 'защо тегами се пише с ръка и хартия?',
    explainEx2: 'защо понеделник е денят на луната?',
    partsTitle: 'Опишете йероглиф по частите му',
    parts:
      'Не можете да го напишете или нарисувате? Кажете от какво е съставен и къде стоят частите. Всеки отговор се проверява спрямо истинския строеж на йероглифа.',
    partsEx1: 'слънце до луна',
    partsEx2: 'вода отляво на синьо',
    how: 'Това се включва, когато речникът не намери нищо дума по дума: натиснете Enter или ✦ Търсене по смисъл. Всяко предложение казва защо пасва. Трябва да сте влезли в профила си.',
    tryIt: 'Докоснете пример, за да го изпробвате.',
    alsoTitle: 'И по-дребните неща',
    alsoDraw: 'Нарисувайте йероглиф (✎) или го изберете по частите му (部). И двете пишат в търсачката, така че можете да съставите дума йероглиф по йероглиф.',
    alsoInflect: 'Спреженията се разпознават: 食べたくなかった намира 食べる и казва какво е направило окончанието.',
    alsoBg: 'Можете да търсите и на латиница: шльокавицата се разчита като български.',
    alsoKey: 'Натиснете / отвсякъде, за да отидете в търсачката.',
    close: 'Затворете',
  },
)

type T = ReturnType<typeof S>

// For Bulgarian speakers whatever the interface language, so said in
// Bulgarian either way: Cyrillic is searched as Bulgarian in both.
const IN_BULGARIAN = 'Ако не си спомняш за думата на Английски, може да я потърсиш и на Български'
const IN_BULGARIAN_EX = 'пеперуда'

/** The link on the empty search, and the popup it opens. */
export function SearchHelp({ onTry }: { onTry: (q: string) => void }) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="search-help-link" onClick={() => setOpen(true)}>
        {t('learn')}
      </button>
      {open && (
        <HelpPopup
          t={t}
          onClose={() => setOpen(false)}
          onTry={(q) => {
            setOpen(false)
            onTry(q)
          }}
        />
      )}
    </>
  )
}

function HelpPopup({ t, onClose, onTry }: { t: T; onClose: () => void; onTry: (q: string) => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const feature = (title: string, text: string, examples: string[]) => (
    <section className="help-feature">
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="help-examples">
        {examples.map((q) => (
          <button key={q} onClick={() => onTry(q)}>
            {q}
          </button>
        ))}
      </div>
    </section>
  )

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="overlay-panel help-panel" role="dialog" aria-modal="true" aria-label={t('title')}>
        <button className="account-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
          ×
        </button>
        <div className="help-body">
          {feature(t('describeTitle'), t('describe'), [t('describeEx1'), t('describeEx2')])}
          {feature(t('apartTitle'), t('apart'), [t('apartEx')])}
          {feature(t('explainTitle'), t('explain'), [t('explainEx1'), t('explainEx2')])}
          {feature(t('partsTitle'), t('parts'), [t('partsEx1'), t('partsEx2')])}
          <p className="help-how">
            {t('how')} {t('tryIt')}
          </p>
          <section className="help-feature help-bg" lang="bg">
            <p>{IN_BULGARIAN}</p>
            <div className="help-examples">
              <button onClick={() => onTry(IN_BULGARIAN_EX)}>{IN_BULGARIAN_EX}</button>
            </div>
          </section>
          <h3 className="help-also-title">{t('alsoTitle')}</h3>
          <ul className="help-also">
            <li>{t('alsoDraw')}</li>
            <li>{t('alsoInflect')}</li>
            <li>{t('alsoBg')}</li>
            <li>{t('alsoKey')}</li>
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  )
}
