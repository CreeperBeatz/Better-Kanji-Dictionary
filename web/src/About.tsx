/**
 * Credits, in the account dialog rather than on screen.
 *
 * They are not optional: EDRDG requires acknowledgement visible wherever its
 * dictionary content is shown, and KanjiVG requires a credit and a link --
 * which it earns twice over, since the handwriting lookup matches against its
 * stroke data. The profile button is on screen in every view, so they stay
 * one click away without spending the rail on them.
 */
const SOURCES: { name: string; what: string; href: string; licence: string }[] = [
  { name: 'JMdict, KANJIDIC, KRADFILE', what: 'words, character data, radicals', href: 'https://www.edrdg.org/', licence: 'CC BY-SA 4.0 · EDRDG' },
  { name: 'KanjiVG', what: 'stroke order, and handwriting lookup', href: 'https://kanjivg.tagaini.net/', licence: 'CC BY-SA 3.0 · Ulrich Apel' },
  { name: 'cjk-decomp', what: 'decomposition', href: 'https://github.com/scriptin/topokanji', licence: 'via topokanji' },
  { name: 'kanjium', what: 'pitch accent', href: 'https://github.com/mifunetoshiro/kanjium', licence: 'CC BY-SA 4.0' },
  { name: 'Tatoeba', what: 'example sentences', href: 'https://tatoeba.org/', licence: 'CC BY 2.0 FR' },
  { name: 'Kanji Alive', what: 'curated meanings', href: 'https://github.com/kanjialive/kanji-data-media', licence: 'CC BY 4.0' },
]

/** The sources and their licences, shown in the account dialog. */
export function Credits() {
  return (
    <details className="account-about">
      <summary>About BetterRTK · built on</summary>
      <ul className="about-list">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <a href={s.href} target="_blank" rel="noreferrer noopener">
              {s.name}
            </a>
            <span>{s.what}</span>
            <span className="about-licence">{s.licence}</span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Meanings are KANJIDIC's own, shown in full rather than reduced to one keyword. No
        WaniKani, Heisig or jpdb content — all closed, and any of them would rule out sharing
        this.
      </p>
    </details>
  )
}
