/**
 * "Open in dictionary": what a review item is about -- the kanji, the word,
 * both kanji of a form link -- opened in a new tab, so the queue stays where
 * it is.
 */

import type { TaskType } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    open: 'Open in dictionary',
    openOne: 'Open {what} in the dictionary, in a new tab',
    theWord: 'the word',
  },
  {
    open: 'Отвори в речника',
    openOne: 'Отворете {what} в речника, в нов раздел',
    theWord: 'думата',
  },
)

interface Target {
  href: string
  /** What it is, as shown: the kanji, or the word's headword. */
  glyph: string | null
}

const kanji = (c: string): Target => ({ href: `/kanji/${encodeURIComponent(c)}`, glyph: c })
const word = (id: string, headword?: string): Target => ({ href: `/word/${id}`, glyph: headword ?? null })

/** The dictionary pages an item is about, the main one first. */
export function dictTargets(type: TaskType, subject: string, label?: string): Target[] {
  if (type === 'bg' || type === 'en_report') {
    const [kind, rest] = subject.split(':')
    if (!rest) return []
    return kind === 'word' ? [word(rest, label)] : [kanji(rest)]
  }
  const [a, b] = subject.split('|')
  if (type === 'form_link') return b ? [kanji(a), kanji(b)] : [kanji(a)]
  if (type === 'word_sense') return b ? [word(b, label), kanji(a)] : [kanji(a)]
  return [kanji(a)]
}

/** The button(s) on a queue item: one, or one per kanji or word when there are several. */
export function DictLinks({ type, subject, label }: { type: TaskType; subject: string; label?: string }) {
  const t = S(useLang())
  const targets = dictTargets(type, subject, label)
  if (!targets.length) return null
  const title = (g: string | null) => t('openOne', { what: g ?? t('theWord') })
  if (targets.length === 1)
    return (
      <a className="dict-open" href={targets[0].href} target="_blank" rel="noopener" title={title(targets[0].glyph)}>
        {t('open')} <span aria-hidden>↗</span>
      </a>
    )
  return (
    <span className="dict-open-many">
      <span className="hint">{t('open')}:</span>
      {targets.map((x) => (
        <a key={x.href} className="dict-open" href={x.href} target="_blank" rel="noopener" title={title(x.glyph)} lang="ja">
          {x.glyph ?? t('theWord')} <span aria-hidden>↗</span>
        </a>
      ))}
    </span>
  )
}

/** In a list of decisions: the subject itself opens it, in a new tab. */
export function DictSubject({ type, subject, children }: { type: TaskType; subject: string; children: React.ReactNode }) {
  const t = S(useLang())
  const [main] = dictTargets(type, subject)
  if (!main) return <>{children}</>
  return (
    <a className="dict-subject" href={main.href} target="_blank" rel="noopener" title={t('openOne', { what: main.glyph ?? t('theWord') })}>
      {children}
    </a>
  )
}
