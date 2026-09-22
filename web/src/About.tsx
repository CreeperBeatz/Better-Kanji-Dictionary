import { useEffect } from 'react'

/**
 * Credits, behind an (i) rather than on screen.
 *
 * They are not optional: EDRDG requires acknowledgement visible wherever its
 * dictionary content is shown, and KanjiVG requires a credit and a link --
 * which it earns twice over, since the handwriting lookup matches against its
 * stroke data. A dialog one click away satisfies that without spending the
 * rail on it.
 */
const SOURCES: { name: string; what: string; href: string; licence: string }[] = [
  { name: 'JMdict, KANJIDIC, KRADFILE', what: 'words, character data, radicals', href: 'https://www.edrdg.org/', licence: 'CC BY-SA 4.0 · EDRDG' },
  { name: 'KanjiVG', what: 'stroke order, and handwriting lookup', href: 'https://kanjivg.tagaini.net/', licence: 'CC BY-SA 3.0 · Ulrich Apel' },
  { name: 'cjk-decomp', what: 'decomposition', href: 'https://github.com/scriptin/topokanji', licence: 'via topokanji' },
  { name: 'kanjium', what: 'pitch accent', href: 'https://github.com/mifunetoshiro/kanjium', licence: 'CC BY-SA 4.0' },
  { name: 'Tatoeba', what: 'example sentences', href: 'https://tatoeba.org/', licence: 'CC BY 2.0 FR' },
  { name: 'Kanji Alive', what: 'curated meanings', href: 'https://github.com/kanjialive/kanji-data-media', licence: 'CC BY 4.0' },
]

export function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel about-panel" role="dialog" aria-modal="true" aria-label="Built on">
        <h2>Built on</h2>
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
        <p className="assoc-actions">
          <button className="clear" onClick={onClose}>
            close
          </button>
        </p>
      </div>
    </div>
  )
}
