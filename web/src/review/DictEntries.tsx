/**
 * The other dictionaries' entries as they are drawn from their transcriptions
 * (server/dictionaries.py): on a meanings card (DictionariesPanel.tsx), with
 * where each sense's words are on the board and only a few words a sense;
 * whole in the dictionary tab (BookViewer.tsx), its digital view.
 */
import type { ReactNode } from 'react'
import type { DictSense, DictWord, KanjiDictionaries } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    japanOnly: 'Senses used only in Japan (国訓)',
    kangorinOnly: 'Only its Japan-only senses are transcribed; the scan has the whole entry.',
    classes: 'The book’s marks for the kanji: 常 jōyō, 教1–6 the school grade it is taught in, 人 a name kanji, 国字 made in Japan',
    strokes: '{n} strokes',
  },
  {
    japanOnly: 'Значения само в Япония (国訓)',
    kangorinOnly: 'Преписани са само значенията му само в Япония; сканираната страница има цялата статия.',
    classes: 'Знаците на книгата за канджито: 常 джойо, 教1–6 класът, в който се учи, 人 канджи за имена, 国字 създадено в Япония',
    strokes: '{n} черти',
  },
)

/** **bold** and *italic* (Kodansha's field labels: *phys*) as the transcriptions mark them; the pictures of old glyphs ([img:金文]) are not here. */
export function rich(text: string): ReactNode[] {
  return text
    .replace(/\[img:[^\]]*\]/g, '')
    .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/)
    .map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.length > 2 && p.startsWith('*') && p.endsWith('*') ? <i key={i}>{p.slice(1, -1)}</i> : p,
    )
}

/** A sense number as Kodansha prints it: ❶ … ⓴ black, or ① … ⑳ outlined. */
const circled = (n: number, outlined = false) =>
  n < 1 || n > 20
    ? `(${n})`
    : outlined
      ? String.fromCharCode(0x245f + n)
      : n <= 10
        ? String.fromCharCode(0x2775 + n)
        : String.fromCharCode(0x24ea + n - 10)

/** How a word of the entry stands on a meanings card: not on its board (faint), or in another group than its sense's other words (amber). */
export interface WordMark {
  off?: boolean
  away?: boolean
  title?: string
}

/** At most `limit` of a sense's words, in the book's order: the amber ones always, then those on the board, then the rest. */
function pick(ws: DictWord[], limit: number | undefined, mark?: (w: DictWord) => WordMark): DictWord[] {
  if (limit == null || ws.length <= limit) return ws
  const keep = new Set(ws.flatMap((w, i) => (mark?.(w).away ? [i] : [])))
  for (const onBoardOnly of [true, false])
    ws.forEach((w, i) => {
      if (keep.size < limit && !keep.has(i) && (!onBoardOnly || !mark?.(w).off)) keep.add(i)
    })
  return ws.filter((_, i) => keep.has(i))
}

/**
 * Kodansha's entry laid out as the book prints it: the headword with its
 * number and ▶CORE meaning and readings; boxed section labels; each sense
 * number ❶ with its letters ⓐ ⓑ, then the compounds of each letter, the
 * letter in italics before the first. On a card, `chip` says which group a
 * sense's words are in now, `mark` how each word stands, and `limit` cuts
 * each sense to a few words, with `more` under a block that lost some.
 */
export function KodanshaEntry({
  char,
  k,
  mark,
  chip,
  limit,
  more,
}: {
  char: string
  k: NonNullable<KanjiDictionaries['kodansha']>
  mark?: (w: DictWord) => WordMark
  chip?: (s: DictSense) => ReactNode
  limit?: number
  more?: (hidden: number) => ReactNode
}) {
  const t = S(useLang())
  const blocks = (senses: DictSense[]) => {
    const out: { num: number | null; senses: DictSense[] }[] = []
    for (const s of senses) {
      const num = /^\d+/.exec(s.n)?.[0]
      const last = out[out.length - 1]
      if (last && num && last.num === Number(num)) last.senses.push(s)
      else out.push({ num: num ? Number(num) : null, senses: [s] })
    }
    return out
  }
  const letter = (n: string) => /[a-z]$/.exec(n)?.[0] ?? null
  const word = (w: DictWord, lmark: string | null, key: string) => {
    const m = mark?.(w) ?? {}
    return (
      <div key={key} className="kd-w" data-off={m.off || undefined} data-away={m.away || undefined} title={m.title}>
        <i className="kd-wl">{lmark}</i>
        <span className="kd-ja" lang="ja">
          {w.ja}
        </span>{' '}
        <span className="kd-kana" lang="ja">
          {w.reading}
        </span>{' '}
        {w.gloss}
      </div>
    )
  }
  const cut = (all: number, shown: number) => (all > shown && more ? <div className="kd-more">{more(all - shown)}</div> : null)
  // Compounds' senses are in black circles (❶ ⓐ), a kun word's in outlined ones (① ⓐ), as the book does.
  const senseBlocks = (senses: DictSense[], outlined = false) =>
    blocks(senses).map((b, bi) => {
      const lettered = b.senses.filter((s) => letter(s.n) && s.words?.length).length > 1
      const shown = b.senses.map((s) => pick(s.words ?? [], limit, mark))
      return (
        <div key={bi} className="kd-block" data-outlined={outlined || undefined}>
          {b.senses.map((s, i) => (
            <p key={s.key} className="kd-sense" data-first={i === 0 || undefined}>
              <span className="kd-marks">
                {i === 0 && b.num != null && <span className="kd-num">{circled(b.num, outlined)}</span>}
                {letter(s.n) && <span className="kd-let">{letter(s.n)}</span>}
              </span>
              <span className="kd-text">{rich(s.text)}</span>
              {chip?.(s)}
            </p>
          ))}
          {b.senses.flatMap((s, si) => shown[si].map((w, i) => word(w, lettered && i === 0 ? letter(s.n) : null, `${s.key}:${i}`)))}
          {cut(
            b.senses.reduce((n, s) => n + (s.words?.length ?? 0), 0),
            shown.reduce((n, ws) => n + ws.length, 0),
          )}
        </div>
      )
    })
  const special = pick(k.special, limit, mark)
  return (
    <div className="kd-entry">
      <div className="kd-top">
        <div className="kd-left">
          <div className="kd-glyph" lang="ja">
            {char}
          </div>
          <div className="kd-no">{k.no}</div>
          {k.skip && <div className="kd-skip">■{k.skip}</div>}
        </div>
        <div className="kd-right">
          <div className="kd-core">▶{k.core.join(' ')}</div>
          <div className="kd-read" lang="ja">
            {[...k.on, ...k.kunReadings].join('  ')}
          </div>
          <div className="kd-facts">{[k.grade, k.strokes && t('strokes', { n: k.strokes }), k.unicode].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {k.senses.length > 0 && (
        <>
          <span className="kd-box">COMPOUNDS</span>
          {senseBlocks(k.senses)}
        </>
      )}
      {k.independent.length > 0 && (
        <>
          <span className="kd-box">INDEPENDENT</span>
          {k.independent.map((h, i) => (
            <p key={i} className="kd-sense" data-first>
              <b className="kd-hw" lang="ja">
                【{h.kana} {h.head}】
              </b>{' '}
              {h.text && <span className="kd-text">{rich(h.text)}</span>}
            </p>
          ))}
        </>
      )}
      {k.kun.length > 0 && (
        <>
          <span className="kd-box">KUN</span>
          {k.kun.map((h, i) => (
            <div key={i} className="kd-kunh">
              <p className="kd-sense" data-first>
                <b className="kd-hw" lang="ja">
                  【{h.kana} {h.head}】
                </b>{' '}
                {h.text && <span className="kd-text">{rich(h.text)}</span>}
              </p>
              {senseBlocks(h.senses.length === 1 && !h.senses[0].n ? [{ ...h.senses[0], text: '' }] : h.senses, true)}
            </div>
          ))}
        </>
      )}
      {k.special.length > 0 && (
        <>
          <span className="kd-box">SPECIAL READINGS</span>
          <div className="kd-block">
            {special.map((w, i) => word(w, null, String(i)))}
            {cut(k.special.length, special.length)}
          </div>
        </>
      )}
    </div>
  )
}

/** 新漢語林's line: the old form it prints beside the headword, and its class marks (常, 教1 ...). */
export function KangorinMarks({ g }: { g: NonNullable<KanjiDictionaries['kangorin']> }) {
  const t = S(useLang())
  if (!g.old && !g.classes.length) return null
  return (
    <span className="dict-core" lang="ja" title={t('classes')}>
      {g.old && `〖${g.old}〗 `}
      {g.classes.join(' ')}
    </span>
  )
}

/** 新漢語林 as far as it is transcribed: only its Japan-only senses (server/dictionaries.py _kangorin_view). `whole`: say so. */
export function KangorinSenses({ g, whole = false }: { g: NonNullable<KanjiDictionaries['kangorin']>; whole?: boolean }) {
  const t = S(useLang())
  return (
    <div className="dict-paper">
      {whole && <p className="dict-note">{t('kangorinOnly')}</p>}
      <h5>{t('japanOnly')}</h5>
      <ol className="dict-senses">
        {g.senses.map((s) => (
          <li key={s.key} className="dict-sense">
            <span className="dict-japan">国</span>
            <span className="dict-text">{rich(s.text)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Wiktionary's senses (English). */
export function WiktionaryList({ entries }: { entries: NonNullable<KanjiDictionaries['wiktionary']> }) {
  return (
    <div className="dict-paper">
      <ul className="dict-senses">
        {entries.map((e, i) => (
          <li key={i} className="dict-sense">
            <span className="dict-n">{e.pos}</span>
            {e.readings.length > 0 && <span className="dict-kana">{e.readings.join(', ')}</span>}{' '}
            <span className="dict-text">{e.glosses.join('; ')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
