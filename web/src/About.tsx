/**
 * Credits, a button in the account dialog that opens them in a popup of their
 * own, rather than on screen.
 *
 * They are not optional: EDRDG requires acknowledgement visible wherever its
 * dictionary content is shown, and KanjiVG requires a credit and a link --
 * which it earns twice over, since the handwriting lookup matches against its
 * stroke data. DaKanji, the handwriting model, asks for a credit in its own
 * words. The profile button is on screen in every view, so they stay
 * one click away without spending the rail on them.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { strings, useLang } from './i18n'

const S = strings(
  {
    about: 'About Better Kanji Dictionary',
    builtOn: 'Built on',
    close: 'Close',
    edrdg: 'words, character data, radicals',
    kanjivg: 'stroke order, and handwriting lookup',
    dakanji: 'Character recognition powered by machine learning from Dariyooo (DaAppLab)',
    rmbg: 'selecting the subject of a picture in a drawing',
    decomp: 'decomposition',
    kanjidata: 'JLPT levels, frequency and school grade of kanji',
    kanjium: 'pitch accent; lookalike and near-synonym kanji',
    tatoeba: 'example sentences',
    kanjialive: 'curated meanings',
    jlpt: 'JLPT levels of words',
    bulgarian: 'Bulgarian glosses and kanji meanings, machine-translated by Claude from the English',
    wiktionary: 'translation tables, as hints for the Bulgarian',
    btbwn: 'Bulgarian words for shared concepts, as hints',
    wnja: 'Japanese words for shared concepts: hints for the Bulgarian, and kanji of similar meaning',
    unihan: 'variant forms of a character',
    noto: 'every character drawn in print, to find the ones that look alike',
    yencken: 'kanji that people confuse, picked by native and non-native readers',
    ijidokun: 'kanji that share a reading, and when to write which',
    hint: "Meanings are KANJIDIC's own, shown in full rather than reduced to one keyword. No WaniKani, Heisig or jpdb content - all closed, and any of them would rule out sharing this.",
  },
  {
    about: 'За Better Kanji Dictionary',
    builtOn: 'Изграден върху',
    close: 'Затворете',
    edrdg: 'думи, данни за йероглифите, радикали',
    kanjivg: 'ред на чертите и търсене чрез рисуване',
    // The wording the model's author asks for; kept in English in both.
    dakanji: 'Character recognition powered by machine learning from Dariyooo (DaAppLab)',
    rmbg: 'избиране на обекта в картина при рисуване',
    decomp: 'разлагане на части',
    kanjidata: 'нива от JLPT, честота и учебна година на йероглифите',
    kanjium: 'тонално ударение; приличащи си и близки по значение йероглифи',
    tatoeba: 'примерни изречения',
    kanjialive: 'подбрани значения',
    jlpt: 'нива от JLPT на думите',
    bulgarian: 'българските значения на думи и йероглифи, машинно преведени от английски от Claude',
    wiktionary: 'таблици с преводи, като подсказки за българския',
    btbwn: 'български думи за общи понятия, като подсказки',
    wnja: 'японски думи за общи понятия: подсказки за българския и йероглифи с близко значение',
    unihan: 'варианти на един и същ йероглиф',
    noto: 'всеки йероглиф, изписан печатно, за да се намерят приличащите си',
    yencken: 'йероглифи, които хората бъркат, посочени от японци и чужденци',
    ijidokun: 'йероглифи с общо четене и кога кой се пише',
    hint: 'Значенията на йероглифите са тези на KANJIDIC, показани изцяло, а не сведени до една ключова дума; българските са машинен превод и още не са пълни. Няма съдържание от WaniKani, Heisig или jpdb - всички са затворени и всяко от тях би попречило това да се споделя.',
  },
)

type What = Parameters<ReturnType<typeof S>>[0]

const SOURCES: { name: string; what: What; href: string; licence: string }[] = [
  { name: 'JMdict, KANJIDIC, KRADFILE', what: 'edrdg', href: 'https://www.edrdg.org/', licence: 'CC BY-SA 4.0 · EDRDG' },
  { name: 'KanjiVG', what: 'kanjivg', href: 'https://kanjivg.tagaini.net/', licence: 'CC BY-SA 3.0 · Ulrich Apel' },
  {
    name: 'DaKanji',
    what: 'dakanji',
    href: 'https://github.com/CaptainDario/DaKanji-Single-Kanji-Recognition',
    licence: 'MIT · trained on the ETL Character Database (AIST) and KanjiVG',
  },
  {
    name: 'RMBG-1.4',
    what: 'rmbg',
    href: 'https://huggingface.co/briaai/RMBG-1.4',
    licence: 'Bria RMBG-1.4 licence, non-commercial use · BRIA AI',
  },
  {
    name: 'kanji-data',
    what: 'kanjidata',
    href: 'https://github.com/davidluzgouveia/kanji-data',
    licence: 'MIT · David Gouveia, from KANJIDIC and JLPT lists',
  },
  { name: 'cjk-decomp', what: 'decomp', href: 'https://github.com/scriptin/topokanji', licence: 'via topokanji' },
  { name: 'kanjium', what: 'kanjium', href: 'https://github.com/mifunetoshiro/kanjium', licence: 'CC BY-SA 4.0' },
  { name: 'Tatoeba', what: 'tatoeba', href: 'https://tatoeba.org/', licence: 'CC BY 2.0 FR' },
  { name: 'Kanji Alive', what: 'kanjialive', href: 'https://github.com/kanjialive/kanji-data-media', licence: 'CC BY 4.0' },
  {
    name: 'JLPT vocabulary lists',
    what: 'jlpt',
    href: 'http://www.tanos.co.uk/jlpt/',
    licence: 'CC BY · Jonathan Waller, JMdict ids by stephenmk',
  },
  {
    name: 'Bulgarian glosses and kanji meanings',
    what: 'bulgarian',
    href: 'https://www.edrdg.org/edrdg/licence.html',
    licence: 'CC BY-SA 4.0 · derived from EDRDG data',
  },
  { name: 'English Wiktionary', what: 'wiktionary', href: 'https://en.wiktionary.org/', licence: 'CC BY-SA 4.0' },
  { name: 'BulTreeBank Wordnet (BTB-WN)', what: 'btbwn', href: 'http://www.bultreebank.org/', licence: 'CC BY 3.0' },
  { name: 'Japanese WordNet', what: 'wnja', href: 'https://bond-lab.github.io/wnja/', licence: '© 2009–2010 NICT' },
  { name: 'Unihan', what: 'unihan', href: 'https://www.unicode.org/charts/unihan.html', licence: 'Unicode licence' },
  { name: 'Noto Sans JP, Noto Serif JP', what: 'noto', href: 'https://fonts.google.com/noto', licence: 'OFL 1.1 · Google' },
  {
    name: 'Kanji confusion data',
    what: 'yencken',
    href: 'https://lars.yencken.org/datasets/kanji-confusion/',
    licence: 'CC BY 3.0 · Lars Yencken',
  },
  {
    name: '「異字同訓」の漢字の使い分け例',
    what: 'ijidokun',
    href: 'https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/ijidokun_140221.pdf',
    licence: 'Agency for Cultural Affairs, 2014',
  },
]

/** The button in the account dialog that opens the credits. */
export function Credits() {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  return (
    <div className="account-about">
      <button className="account-about-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t('about')}
      </button>
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * The sources and their licences, over the account dialog. Escape and a click
 * outside close this one only, so the account dialog is still there under it.
 */
function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = S(useLang())

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // captured first, so the account dialog stays open
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      className="overlay about-overlay"
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="overlay-panel about-panel" role="dialog" aria-modal="true" aria-label={t('about')}>
        <button className="account-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
          ×
        </button>
        <h2>{t('about')}</h2>
        <div className="about-body">
          <h3>{t('builtOn')}</h3>
          <ul className="about-list">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noreferrer noopener">
                  {s.name}
                </a>
                <span>{t(s.what)}</span>
                <span className="about-licence">{s.licence}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
