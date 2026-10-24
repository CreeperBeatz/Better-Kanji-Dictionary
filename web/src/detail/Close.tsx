/**
 * What sits beside a meaning, the same on a kanji's page and a word's: a
 * side block under its title and icon (≈ synonyms, ↔ opposites, ! easy to
 * mix up), and in it one row for each kanji or word close to this one.
 */
import type { ReactNode } from 'react'

/** A side block's title: its icon, then what it is -- ≈ synonyms, ! easy to mix up. */
export function AsideTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="aside-title">
      <span className="aside-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </p>
  )
}

/**
 * 典 · Code · With the meaning: ceremony, and under it how it differs -- the
 * kanji or word, its keyword or reading, the meaning of it that is close to
 * this one, and the line. What the page's own kanji or word is in the meaning,
 * its card says once, above. The whole row is one button that opens the other.
 */
export function CloseRow({
  glyph,
  sub,
  sense,
  line,
  lineMark,
  title,
  onOpen,
  warm,
}: {
  glyph: string
  sub?: string | null
  sense?: string | null
  line?: string | null
  /** Beside the line, as a word's English line is marked "EN" on a Bulgarian page. */
  lineMark?: ReactNode
  title: string
  onOpen: () => void
  /** Prefetch handlers, so what it opens is there by the time it opens. */
  warm?: object
}) {
  return (
    <li>
      <button className="close-row" title={title} {...warm} onClick={onOpen}>
        <span className="close-kanji" lang="ja">
          {glyph}
        </span>
        <span className="close-keyword" lang={sub && /[぀-ヿ]/.test(sub) ? 'ja' : undefined}>
          {sub}
        </span>
        {sense ? <span className="close-sense">{sense}</span> : <span />}
        {line && (
          <span className="close-line">
            {line}
            {lineMark}
          </span>
        )}
      </button>
    </li>
  )
}
