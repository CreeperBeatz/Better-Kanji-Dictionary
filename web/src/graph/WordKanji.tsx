import { strings, useLang } from '../i18n'

const S = strings(
  {
    label: 'Kanji of {word}',
    show: 'Show the graph of {char}',
  },
  {
    label: 'Йероглифи в {word}',
    show: 'Покажете графа на {char}',
  },
)

const HAN = /[㐀-䶿一-鿿]/

/**
 * The word a graph is of, over it: each of its kanji picks which one the
 * graph shows, the kana between them left as they are written. The one shown
 * carries the focus's vermilion.
 */
export function WordKanji({ word, current, onPick }: { word: string; current: string | null; onPick: (char: string) => void }) {
  const t = S(useLang())
  return (
    <nav className="word-kanji" aria-label={t('label', { word })}>
      {[...word].map((c, i) =>
        HAN.test(c) ? (
          <button
            key={i}
            className="word-kanji-char"
            aria-pressed={c === current}
            onClick={() => onPick(c)}
            title={t('show', { char: c })}
          >
            {c}
          </button>
        ) : (
          <span key={i} className="word-kanji-kana">
            {c}
          </span>
        ),
      )}
    </nav>
  )
}
