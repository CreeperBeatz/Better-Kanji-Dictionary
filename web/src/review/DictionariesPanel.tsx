/**
 * Other dictionaries on a meanings card, above the board: Kodansha's senses
 * with the words it lists under each, 新漢語林's 字義, Цалта's entry and
 * Wiktionary's senses, plus a link to 漢字ペディア (the 漢検漢字辞典, free
 * to read, never copied).
 *
 * Each sense says which group its words on the board are in now
 * (review/dictMatch.ts), so a sense with no group of its own, or one whose
 * words are split between groups, stands out. It follows the board live.
 * Reviewers and the admin only; a server without the dictionaries' files
 * shows only what it has.
 */
import { useMemo, type ReactNode } from 'react'
import type { BoardWord, BookRef, DictSense, DictWord, KanjiDictionaries, MeaningGroup } from '../api'
import { strings, useLang } from '../i18n'
import type { Placements } from './board'
import { KanjiEntry, OpenBook } from './BookEvidence'
import { elsewhere, senseStats, type Bucket, type SenseStat } from './dictMatch'
import { CATCH_ALL } from './editors'

const S = strings(
  {
    title: 'Other dictionaries',
    hint: 'Each sense shows the group its words on the board are in now. Amber: its words are split between groups. A sense with no word on the board shows none.',
    elsewhere: '{n} words on the board are in another group than the rest of their dictionary sense (amber on the board).',
    elsewhere1: '1 word on the board is in another group than the rest of its dictionary sense (amber on the board).',
    kanjipedia: '漢字ペディア (漢検漢字辞典)',
    openDict: 'open in dictionary',
    kanjipediaTitle: 'The 漢検漢字辞典 on kanjipedia.jp, in a new tab: its numbered meanings, each with example words',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    core: 'core meaning',
    coreLabel: 'core:',
    classes: 'The book’s marks for the kanji: 常 jōyō, 教1–6 the school grade it is taught in, 人 a name kanji, 国字 made in Japan',
    onSenses: 'compounds by sense',
    kun: 'kun words',
    special: 'special readings',
    kangorin: '新漢語林',
    japan: 'Japan-only sense',
    japanOnly: 'Senses used only in Japan (国訓)',
    wiktionary: 'Wiktionary (English)',
    none: 'not on the board',
    split: 'split',
    catchAll: 'no meaning',
    noGroup: 'not in a group',
    unnamed: '(unnamed)',
    of: '{k} of {n}',
    notOnBoard: 'not on the board',
    fromBook: 'From the book',
    from: 'From',
    tsalta: 'Цалта’s kanji book',
    nSplit: '{n} senses split',
    nSplit1: '1 sense split',
    nSplitTitle: 'Senses of this dictionary whose words on the board are in more than one group. Open it: their chips are amber.',
  },
  {
    title: 'Други речници',
    hint: 'Всяко значение показва групата, в която са думите му на дъската сега. Кехлибарено: думите му са разделени между групи. Значение без дума на дъската не показва група.',
    elsewhere: '{n} думи на дъската са в друга група от останалите думи на значението си в речника (кехлибарени на дъската).',
    elsewhere1: '1 дума на дъската е в друга група от останалите думи на значението си в речника (кехлибарена на дъската).',
    kanjipedia: '漢字ペディア (漢検漢字辞典)',
    openDict: 'отвори в речника',
    kanjipediaTitle: '漢検漢字辞典 на kanjipedia.jp, в нов раздел: номерираните значения, всяко с примерни думи',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    core: 'основно значение',
    coreLabel: 'основно:',
    classes: 'Знаците на книгата за канджито: 常 джойо, 教1–6 класът, в който се учи, 人 канджи за имена, 国字 създадено в Япония',
    onSenses: 'сложни думи по значение',
    kun: 'кун думи',
    special: 'особени четения',
    kangorin: '新漢語林',
    japan: 'значение само в Япония',
    japanOnly: 'Значения само в Япония (国訓)',
    wiktionary: 'Уикиречник (английски)',
    none: 'не е на дъската',
    split: 'разделено',
    catchAll: 'без значение',
    noGroup: 'без група',
    unnamed: '(без име)',
    of: '{k} от {n}',
    notOnBoard: 'не е на дъската',
    fromBook: 'От книгата',
    from: 'От',
    tsalta: 'Канджи речникът на Цалта',
    nSplit: '{n} значения разделени',
    nSplit1: '1 значение разделено',
    nSplitTitle: 'Значения от този речник, чиито думи на дъската са в повече от една група. Отворете го: техните етикети са кехлибарени.',
  },
)

/** **bold** and *italic* (Kodansha's field labels: *phys*) as the transcriptions mark them; the pictures of old glyphs ([img:金文]) are not here. */
function rich(text: string): ReactNode[] {
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

export function DictionariesPanel({
  dicts,
  words,
  placements,
  groups,
}: {
  dicts: KanjiDictionaries
  words: BoardWord[]
  placements: Placements
  groups: MeaningGroup[]
}) {
  const lang = useLang()
  const t = S(lang)
  const stats = useMemo(() => senseStats(dicts, words, placements, groups), [dicts, words, placements, groups])
  const away = useMemo(() => elsewhere(dicts, words, placements, groups), [dicts, words, placements, groups])
  const onBoard = useMemo(() => new Set(words.map((w) => w.id)), [words])

  const label = (b: Bucket) => {
    if (b === CATCH_ALL) return t('catchAll')
    if (b === null) return t('noGroup')
    const i = groups.findIndex((g) => g.id === b)
    return i < 0 ? t('noGroup') : `${i + 1} ${groups[i].en.trim() || t('unnamed')}`
  }

  /** Where a sense's words on the board are: one group, or split. */
  function chip(src: string, key: string) {
    const s: SenseStat | undefined = stats.get(`${src}|${key}`)
    if (!s) return <span className="dict-chip" data-none>{t('none')}</span>
    const ranked = [...s.counts.entries()].sort((a, b) => b[1] - a[1])
    if (ranked.length === 1)
      return (
        <span className="dict-chip" title={t('of', { k: s.total, n: s.total })}>
          → {label(ranked[0][0])}
        </span>
      )
    return (
      <span className="dict-chip" data-split title={t('split')}>
        → {ranked.map(([b, n]) => `${label(b)} (${n})`).join(' · ')}
      </span>
    )
  }

  /**
   * Kodansha's entry laid out as the book prints it: the headword with its
   * number and ▶CORE meaning and readings; boxed section labels; each sense
   * number ❶ with its letters ⓐ ⓑ, then the compounds of each letter, the
   * letter in italics before the first. Each sense also says which group its
   * words are in now.
   */
  function kodanshaEntry(k: NonNullable<KanjiDictionaries['kodansha']>) {
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
    const word = (w: DictWord, mark: string | null, key: string) => (
      <div
        key={key}
        className="kd-w"
        data-off={!(w.id != null && onBoard.has(w.id)) || undefined}
        data-away={(w.id != null && away.has(w.id)) || undefined}
        title={w.id != null && onBoard.has(w.id) ? undefined : t('notOnBoard')}
      >
        <i className="kd-wl">{mark}</i>
        <span className="kd-ja" lang="ja">
          {w.ja}
        </span>{' '}
        <span className="kd-kana" lang="ja">
          {w.reading}
        </span>{' '}
        {w.gloss}
      </div>
    )
    // Compounds' senses are in black circles (❶ ⓐ), a kun word's in outlined ones (① ⓐ), as the book does.
    const senseBlocks = (senses: DictSense[], outlined = false) =>
      blocks(senses).map((b, bi) => {
        const lettered = b.senses.filter((s) => letter(s.n) && s.words?.length).length > 1
        return (
          <div key={bi} className="kd-block" data-outlined={outlined || undefined}>
            {b.senses.map((s, i) => (
              <p key={s.key} className="kd-sense" data-first={i === 0 || undefined}>
                <span className="kd-marks">
                  {i === 0 && b.num != null && <span className="kd-num">{circled(b.num, outlined)}</span>}
                  {letter(s.n) && <span className="kd-let">{letter(s.n)}</span>}
                </span>
                <span className="kd-text">{rich(s.text)}</span>
                {(s.words?.length || stats.has(`kodansha|${s.key}`)) && chip('kodansha', s.key)}
              </p>
            ))}
            {b.senses.flatMap((s) => (s.words ?? []).map((w, i) => word(w, lettered && i === 0 ? letter(s.n) : null, `${s.key}:${i}`)))}
          </div>
        )
      })
    return (
      <div className="kd-entry">
        <div className="kd-top">
          <div className="kd-left">
            <div className="kd-glyph" lang="ja">
              {dicts.char}
            </div>
            <div className="kd-no">{k.no}</div>
            {k.skip && <div className="kd-skip">■{k.skip}</div>}
          </div>
          <div className="kd-right">
            <div className="kd-core">▶{k.core.join(' ')}</div>
            <div className="kd-read" lang="ja">
              {[...k.on, ...k.kunReadings].join('  ')}
            </div>
            <div className="kd-facts">{[k.grade, k.strokes && `${k.strokes} strokes`, k.unicode].filter(Boolean).join(' · ')}</div>
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
            <div className="kd-block">{k.special.map((w, i) => word(w, null, String(i)))}</div>
          </>
        )}
      </div>
    )
  }

  const k = dicts.kodansha
  const g = dicts.kangorin
  // How many of a dictionary's senses have their words split between groups: shown while it is folded.
  const splitIn = (src: string) => [...stats].filter(([key, st]) => key.startsWith(`${src}|`) && st.counts.size > 1).length

  // 新漢語林's line: the old form it prints beside the headword, and its class marks (常, 教1 ...).
  const kangorinMarks = (g: NonNullable<KanjiDictionaries['kangorin']>) =>
    (g.old || g.classes.length > 0) && (
      <span className="dict-core" lang="ja" title={t('classes')}>
        {g.old && `〖${g.old}〗 `}
        {g.classes.join(' ')}
      </span>
    )

  /** A dictionary folded to one line, as the books are cited elsewhere: which book, its entry, its pages. */
  function head(src: string, name: string, no: number | null | undefined, book: BookRef['book'] | null, pages: number[], extra?: ReactNode) {
    const n = splitIn(src)
    return (
      <summary className="book-head dict-sum">
        <span className="book-from">{t(book ? 'fromBook' : 'from')}:</span> <span className="book-name">{name}</span>
        {no != null && <> · №{no}</>}
        {book && <OpenBook book={book} pages={pages} />}
        {extra}
        {n > 0 && (
          <span className="dict-split-n" title={t('nSplitTitle')}>
            {n === 1 ? t('nSplit1') : t('nSplit', { n })}
          </span>
        )}
      </summary>
    )
  }

  return (
    <section className="dicts">
      <header className="dicts-head">
        <h4>{t('title')}</h4>
        <p className="hint">{t('hint')}</p>
        {away.size > 0 && <p className="dicts-away">{away.size === 1 ? t('elsewhere1') : t('elsewhere', { n: away.size })}</p>}
      </header>
      <div className="dicts-list">
        {k && (
          <details className="dict" data-src="kodansha">
            {head('kodansha', t('kodansha'), k.no, 'kodansha', k.pages, <span className="dict-core" title={t('core')}>
                {t('coreLabel')} {k.core.join(' · ')}
              </span>)}
            {kodanshaEntry(k)}
          </details>
        )}
        {/* 新漢語林: its pages, and only its Japan-only senses (server/dictionaries.py _kangorin_view). */}
        {g &&
          (g.senses.length ? (
            <details className="dict" data-src="kangorin">
              {head('kangorin', t('kangorin'), g.no, 'kangorin', g.pages, kangorinMarks(g))}
              <div className="dict-paper">
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
            </details>
          ) : (
            <p className="book-head dict-sum dict-link">
              <span className="book-from">{t('fromBook')}:</span> <span className="book-name">{t('kangorin')}</span> · №{g.no}
              <OpenBook book="kangorin" pages={g.pages} />
              {kangorinMarks(g)}
            </p>
          ))}
        {/* Read on its own site, never copied: a line with a link, nothing to unfold. */}
        <p className="book-head dict-sum dict-link">
          <span className="book-from">{t('from')}:</span> <span className="book-name">{t('kanjipedia')}</span>
          <a className="clear book-page" href={dicts.kanjipedia} target="_blank" rel="noopener" title={t('kanjipediaTitle')}>
            {t('openDict')} ↗
          </a>
        </p>
        {dicts.tsalta && (
          <details className="dict" data-src="tsalta">
            {head('tsalta', t('tsalta'), dicts.tsalta.no, 'kanji', dicts.tsalta.pages)}
            <KanjiEntry src={dicts.tsalta} words="all" />
          </details>
        )}
        {dicts.wiktionary && dicts.wiktionary.length > 0 && (
          <details className="dict" data-src="wiktionary">
            {head('wiktionary', t('wiktionary'), null, null, [])}
            <div className="dict-paper">
              <ul className="dict-senses">
                {dicts.wiktionary.map((e, i) => (
                  <li key={i} className="dict-sense">
                    <span className="dict-n">{e.pos}</span>
                    {e.readings.length > 0 && <span className="dict-kana">{e.readings.join(', ')}</span>}{' '}
                    <span className="dict-text">{e.glosses.join('; ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    </section>
  )
}
