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
    newHere: 'New here?',
    learn: 'Learn what our search can do',
    title: 'What the search can do',
    lead: 'It looks up English, kana, kanji and romaji like any dictionary. It can also think along with you.',
    describeTitle: 'Describe what you mean',
    describe: 'A feeling, a situation, something you half remember: it finds the words for it.',
    describeEx1: 'the feeling of missing the old days',
    describeEx2: 'a gift you bring back from a trip',
    apartTitle: 'Tell close kanji apart',
    apart: 'Ask which one fits, and a short note explains the difference.',
    apartEx: 'atsui: 暑い, 熱い or 厚い?',
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
    alsoBg: 'Switch the interface to Bulgarian to search in Bulgarian too, even typed in Latin letters.',
    alsoKey: 'Press / from anywhere to jump to the search.',
    close: 'Close',
  },
  {
    newHere: 'Нови сте тук?',
    learn: 'Вижте какво може търсачката',
    title: 'Какво може търсачката',
    lead: 'Търси на английски, български, кана, канджи и ромаджи като всеки речник. Може и да мисли заедно с вас.',
    describeTitle: 'Опишете какво имате предвид',
    describe: 'Чувство, ситуация, нещо полузабравено: тя намира думите за него.',
    describeEx1: 'чувството, че ти липсват старите дни',
    describeEx2: 'подарък, който носиш от пътуване',
    apartTitle: 'Различете близки йероглифи',
    apart: 'Попитайте кой пасва и кратка бележка обяснява разликата.',
    apartEx: 'атсуи: 暑い, 熱い или 厚い?',
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

/** The link on the empty search, and the popup it opens. */
export function SearchHelp({ onTry }: { onTry: (q: string) => void }) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  return (
    <>
      <p className="search-help">
        {t('newHere')}{' '}
        <button className="search-help-link" onClick={() => setOpen(true)}>
          {t('learn')}
        </button>
      </p>
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
        <h2>{t('title')}</h2>
        <div className="help-body">
          <p className="help-lead">{t('lead')}</p>
          {feature(t('describeTitle'), t('describe'), [t('describeEx1'), t('describeEx2')])}
          {feature(t('apartTitle'), t('apart'), [t('apartEx')])}
          {feature(t('partsTitle'), t('parts'), [t('partsEx1'), t('partsEx2')])}
          <p className="help-how">
            {t('how')} {t('tryIt')}
          </p>
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
