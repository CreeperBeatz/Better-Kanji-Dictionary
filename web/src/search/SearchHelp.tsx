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
import { useAuth } from '../account/auth'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    learn: 'Learn what the search can do',
    title: 'What the search can do',
    describeTitle: 'Describe what you mean',
    describe: 'A feeling, a situation, something you half remember: it finds the words for it.',
    describeEx1: 'the feeling of missing the old days',
    describeEx2: 'a gift you bring back from a trip',
    apartTitle: 'Compare similar kanji',
    apart: 'Ask how two look-alike or same-sounding kanji differ, or which one fits, and a short note explains.',
    apartEx1: "what's the difference between the two kanji for hot?",
    apartEx2: 'atsui for weather or for tea?',
    explainTitle: 'Ask for explanations',
    explain: 'Wonder why a word is written with the kanji it is? Ask, and it explains what they bring to it.',
    explainEx1: 'why is tegami written with hand and paper?',
    explainEx2: 'why is Monday the day of the moon?',
    partsTitle: 'Describe a kanji by its parts',
    parts:
      "Can't type it or draw it? Say what it is made of and where the parts sit. Every answer is checked against how the kanji is really built.",
    partsEx1: 'sun beside moon',
    partsEx2: 'water on the left of blue',
    signIn: 'You must be logged in to use this feature.',
    signInWhy: "It doesn't require a subscription, but we want to avoid misuse.",
    steps: 'Enter a few words and press {enter} or tap {button}.',
    button: 'Search by meaning',
    alsoTitle: 'And the smaller things',
    alsoDraw: 'Draw a kanji (✎) or pick it by its parts (部). Both type into the box, so you can build a word one kanji at a time.',
    alsoInflect: 'Conjugations are undone: 食べたくなかった finds 食べる, and says what the ending did.',
    alsoBg: 'With the interface in Bulgarian, Bulgarian typed in Latin letters works too.',
    alsoKey: 'Press / from anywhere to jump to the search.',
    close: 'Close',
  },
  {
    learn: 'Какво може търсачката',
    title: 'Какво може търсачката',
    describeTitle: 'Опишете какво имате предвид',
    describe: 'Чувство, ситуация, нещо полузабравено: тя намира думите за него.',
    describeEx1: 'чувството, че ти липсват старите дни',
    describeEx2: 'подарък, който носиш от пътуване',
    apartTitle: 'Сравнете сходни йероглифи',
    apart: 'Попитайте с какво се различават два еднакво изглеждащи или звучащи йероглифа, или кой пасва, и кратка бележка ще обясни.',
    apartEx1: 'каква е разликата между двата йероглифа за горещо?',
    apartEx2: 'атсуи за времето или за чая?',
    explainTitle: 'Питайте за обяснения',
    explain: 'Чудите се защо една дума се пише с точно тези йероглифи? Попитайте и тя ще обясни какво носи всеки от тях.',
    explainEx1: 'защо тегами се пише с ръка и хартия?',
    explainEx2: 'защо понеделник е денят на луната?',
    partsTitle: 'Опишете йероглиф по частите му',
    parts:
      'Не можете да го напишете или нарисувате? Кажете от какво е съставен и къде стоят частите. Всеки отговор се проверява спрямо истинския строеж на йероглифа.',
    partsEx1: 'слънце до луна',
    partsEx2: 'вода отляво на синьо',
    signIn: 'Трябва да сте влезли в профила си, за да използвате това.',
    signInWhy: 'Не е нужен абонамент, просто искаме да избегнем злоупотреби.',
    steps: 'Напишете няколко думи и натиснете {enter} или докоснете {button}.',
    button: 'Търсене по смисъл',
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
const IN_BULGARIAN_TITLE = 'Работи и на Български'
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

/** How to reach the features above: signed in, then Enter or the button. */
function HowTo({ t }: { t: T }) {
  const { user } = useAuth()
  return (
    <div className="help-how">
      {!user && (
        <>
          <p className="help-how-lead">
            <svg viewBox="0 0 16 16" aria-hidden>
              <rect x="3" y="7" width="10" height="7" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            {t('signIn')}
          </p>
          <p className="help-how-why">{t('signInWhy')}</p>
        </>
      )}
      <p className="help-how-steps">
        {t.node('steps', {
          enter: <kbd>Enter</kbd>,
          button: (
            <span className="help-how-button">
              <span aria-hidden>✦</span> {t('button')}
            </span>
          ),
        })}
      </p>
    </div>
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
          {feature(t('apartTitle'), t('apart'), [t('apartEx1'), t('apartEx2')])}
          {feature(t('explainTitle'), t('explain'), [t('explainEx1'), t('explainEx2')])}
          {feature(t('partsTitle'), t('parts'), [t('partsEx1'), t('partsEx2')])}
          <section className="help-feature help-bg" lang="bg">
            <h3>{IN_BULGARIAN_TITLE}</h3>
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
          <HowTo t={t} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
