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
 * this one, and the line; then the page's own kanji or word and how it
 * differs in turn, so the two can be weighed. The whole row is one button
 * that opens the other.
 */
export function CloseRow({
  glyph,
  sub,
  sense,
  line,
  lineMark,
  own,
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
  /** The page's own kanji or word, and how it differs from this one. */
  own?: { glyph: string; line: string | null | undefined }
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
        {own?.line && (
          <span className="close-own">
            <span className="close-own-glyph" lang="ja">
              {own.glyph}
            </span>
            <span>
              {own.line}
              {lineMark}
            </span>
          </span>
        )}
      </button>
    </li>
  )
}
