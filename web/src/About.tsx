/**
 * Credits, in the account dialog rather than on screen.
 *
 * They are not optional: EDRDG requires acknowledgement visible wherever its
 * dictionary content is shown, and KanjiVG requires a credit and a link --
 * which it earns twice over, since the handwriting lookup matches against its
 * stroke data. The profile button is on screen in every view, so they stay
 * one click away without spending the rail on them.
 */

import { strings, useLang } from './i18n'

const S = strings(
  {
    summary: 'About Better Kanji Dictionary · built on',
    edrdg: 'words, character data, radicals',
    kanjivg: 'stroke order, and handwriting lookup',
    decomp: 'decomposition',
    kanjium: 'pitch accent',
    tatoeba: 'example sentences',
    kanjialive: 'curated meanings',
    jlpt: 'JLPT levels of words',
    bulgarian: 'Bulgarian glosses and kanji meanings, machine-translated by Claude from the English',
    wiktionary: 'translation tables, as hints for the Bulgarian',
    btbwn: 'Bulgarian words for shared concepts, as hints',
    wnja: 'Japanese words for shared concepts, as hints',
    hint: "Meanings are KANJIDIC's own, shown in full rather than reduced to one keyword. No WaniKani, Heisig or jpdb content — all closed, and any of them would rule out sharing this.",
  },
  {
    summary: 'За Better Kanji Dictionary · изграден върху',
    edrdg: 'думи, данни за йероглифите, радикали',
    kanjivg: 'ред на чертите и търсене чрез рисуване',
    decomp: 'разлагане на части',
    kanjium: 'тонално ударение',
    tatoeba: 'примерни изречения',
    kanjialive: 'подбрани значения',
    jlpt: 'нива от JLPT на думите',
    bulgarian: 'българските значения на думи и йероглифи, машинно преведени от английски от Claude',
    wiktionary: 'таблици с преводи, като подсказки за българския',
    btbwn: 'български думи за общи понятия, като подсказки',
    wnja: 'японски думи за общи понятия, като подсказки',
    hint: 'Значенията на йероглифите са тези на KANJIDIC, показани изцяло, а не сведени до една ключова дума; българските са машинен превод и още не са пълни. Няма съдържание от WaniKani, Heisig или jpdb — всички са затворени и всяко от тях би попречило това да се споделя.',
  },
)

type What = Parameters<ReturnType<typeof S>>[0]

const SOURCES: { name: string; what: What; href: string; licence: string }[] = [
  { name: 'JMdict, KANJIDIC, KRADFILE', what: 'edrdg', href: 'https://www.edrdg.org/', licence: 'CC BY-SA 4.0 · EDRDG' },
  { name: 'KanjiVG', what: 'kanjivg', href: 'https://kanjivg.tagaini.net/', licence: 'CC BY-SA 3.0 · Ulrich Apel' },
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
]

/** The sources and their licences, shown in the account dialog. */
export function Credits() {
  const t = S(useLang())
  return (
    <details className="account-about">
      <summary>{t('summary')}</summary>
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
    </details>
  )
}
