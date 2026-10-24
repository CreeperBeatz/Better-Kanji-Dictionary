/**
 * One dictionary entry in the rail, the way a pocket dictionary lays it out:
 * the word, its reading and accent, every way to write it, every sense, and
 * then the kanji it is written with -- each of which opens that character.
 *
 * Each sense is a card, as each meaning of a kanji is, numbered: smaller,
 * and always open. Under its glosses, what sits beside it, as beside a
 * kanji's meaning (detail/Close.tsx): ! the words read the same that are easy
 * to mix up with it, ≈ its synonyms, and ↔ its opposites -- each with how it
 * differs and how this word does, each row opening that word at its sense.
 */

import { useEffect, useState } from 'react'
import { api, type RelatedWord, type SenseNote, type Word, type WordEntry } from '../api'
import { reducedMotion } from '../media'
import { AsideTitle, CloseRow } from './Close'
import { Spellings } from './Spellings'
import { bringToTop, focusMeaningNext, takeMeaningFocus } from './meaningFocus'
import { strings, useLang, type Lang } from '../i18n'
import { glossOf, meaningsOf } from '../i18n/content'
import { tagLabel } from '../i18n/grammar'
import { local } from '../local/local'
import { Pitch } from '../search/Pitch'
import { transitivity } from '../search/transitivity'
import { Valency } from '../search/Valency'
import { WordMeta } from './HeadMeta'
import { WordEditButton } from '../review/PageEdit'
import { warmKanji, warmWord } from '../warm'

const S = strings(
  {
    amongFrequent: 'among the {n} most frequent words',
    common: 'common word',
    failed: 'This entry could not be loaded.',
    looking: 'looking',
    entryFor: 'Dictionary entry for {word}',
    open: 'Open {char}',
    notTranslated: 'not yet translated',
    machine: 'Bulgarian glosses are machine-translated',
    writtenWith: 'Written with',
    inSentence: 'In a sentence',
    needsConnection: 'Example sentences need a connection.',
    restFailed: 'The rest of this entry could not be loaded.',
    pairVt: 'Transitive pair',
    pairVi: 'Intransitive pair',
    pairTitle: 'Open {word}',
    synonyms: 'Synonyms',
    opposites: 'Opposites',
    mixups: 'Easy to mix up',
    mixupsHint: 'Other words easy to confuse with this one: read the same, or one English word for both.',
    pairs: 'Pairs',
    pairsHint: 'Words that go with this one, without being its opposite.',
    politeForms: 'Polite forms',
    politeHint: 'The same act or thing in another register.',
    plain: 'plain',
    polite: 'polite',
    honorific: 'honorific',
    humble: 'humble',
    withMeaning: 'With the meaning: {m}',
    openAt: 'Open {word} at this meaning',
    main: 'main',
    secondary: 'secondary',
    rare: 'rare',
    mainTitle: 'A main meaning: learn the word by it',
    secondaryTitle: 'Met regularly, after the main meanings',
    rareTitle: 'Seldom met',
    drafted: 'An example written for this meaning, not from a corpus',
  },
  {
    amongFrequent: 'сред {n}-те най-чести думи',
    common: 'честа дума',
    failed: 'Тази статия не можа да се зареди.',
    looking: 'зареждане',
    entryFor: 'Речникова статия за {word}',
    open: 'Отворете {char}',
    notTranslated: 'още не е преведено',
    machine: 'Българските значения са машинен превод',
    writtenWith: 'Пише се с',
    inSentence: 'В изречение',
    needsConnection: 'Примерните изречения изискват връзка с интернет.',
    restFailed: 'Останалата част от статията не можа да се зареди.',
    pairVt: 'Преходен вариант',
    pairVi: 'Непреходен вариант',
    pairTitle: 'Отворете {word}',
    synonyms: 'Синоними',
    opposites: 'Антоними',
    mixups: 'Лесно се бъркат',
    mixupsHint: 'Други думи, които лесно се бъркат с тази: със същото четене или с една и съща дума на английски.',
    pairs: 'Двойки',
    pairsHint: 'Думи, които вървят с тази, без да са ѝ противоположни.',
    politeForms: 'Учтиви форми',
    politeHint: 'Същото действие или нещо в друг стил на учтивост.',
    plain: 'обикновена',
    polite: 'учтива',
    honorific: 'почтителна',
    humble: 'скромна',
    withMeaning: 'Със значение: {m}',
    openAt: 'Отворете {word} на това значение',
    main: 'основно',
    secondary: 'второстепенно',
    rare: 'рядко',
    mainTitle: 'Основно значение: думата се учи по него',
    secondaryTitle: 'Среща се редовно, след основните значения',
    rareTitle: 'Среща се рядко',
    drafted: 'Пример, написан за това значение, не от корпус',
  },
)

/** Where a word's sense is on its page, for a row on another word's to bring it into view. */
const senseAnchor = (id: number, n: number) => `sense-${id}-${n}`
/** The key a word's page takes its sense to show by (meaningFocus), apart from a kanji's. */
const focusKey = (id: number) => `word:${id}`

interface Props {
  id: number
  /** What the list already knew about the word, so the head renders at once. */
  word?: Word
  /** The kanji the word was opened from, if it was, to mark among its kanji. */
  from?: string
  onPick: (char: string) => void
  onWord: (w: Word) => void
  /** Opens sign-in, for someone signed out who wants to suggest a change. */
  onSignIn?: () => void
  /** The way to its associations, beside how common it is (a phone's). */
  notes?: React.ReactNode
}

const KANJI = /[㐀-䶿一-鿿]/

const REGISTERS = ['plain', 'polite', 'honorific', 'humble'] as const
type Register = (typeof REGISTERS)[number]

/** JMdict nf buckets are 500 words wide. */
function rankOf(w: Word, lang: Lang): string | null {
  const t = S(lang)
  if (w.nf) return t('amongFrequent', { n: (w.nf * 500).toLocaleString(lang) })
  return w.common ? t('common') : null
}

/** A kanji's meaning in one line: Bulgarian when there is one, else the curated English. */
function kanjiMeaning(k: WordEntry['kanji'][number], lang: Lang): string {
  const m = meaningsOf(k, lang)
  if (!m.fallback && lang === 'bg') return m.value.slice(0, 3).join(', ')
  return k.curated ?? k.meanings.slice(0, 3).join(', ').toLowerCase()
}

/** Mark the word where it occurs in an example, so the eye lands on it. */
function Example({ text, hit }: { text: string; hit: [number, number] | null }) {
  if (!hit) return <>{text}</>
  return (
    <>
      {text.slice(0, hit[0])}
      <mark>{text.slice(hit[0], hit[1])}</mark>
      {text.slice(hit[1])}
    </>
  )
}

/**
 * The word, its reading, accent and が/を, and its first sense beside it, as
 * a kanji's meanings are: the top of its page, above both tabs. How common
 * the word is goes with the dictionary entry.
 */
export function WordHead({ word: w, onPick }: { word: Word; onPick: (char: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const [lead, ...rest] = w.senses.length ? glossOf(w.senses[0], lang).value.split(';').map((g) => g.trim()) : []
  // From five characters (電子計算機, アイスクリーム) the word wants the row: its sense goes under it.
  return (
    <div className="word-head" data-long={[...w.headword].length >= 5 || undefined}>
      <div>
        <h2 className="entry-head">
          {[...w.headword].map((ch, i) =>
            KANJI.test(ch) ? (
              <button key={i} className="entry-char" {...warmKanji(ch)} onClick={() => onPick(ch)} title={t('open', { char: ch })}>
                {ch}
              </button>
            ) : (
              <span key={i}>{ch}</span>
            ),
          )}
        </h2>
        <p className="entry-reading">
          {w.pitch ? <Pitch reading={w.reading} pitch={w.pitch} /> : w.reading}
          <Valency word={w} alone />
        </p>
      </div>
      {lead && (
        <p className="detail-meanings">
          {lead}
          {rest.length > 0 && <span className="rest">; {rest.join('; ')}</span>}
        </p>
      )}
      <WordMeta word={w} />
    </div>
  )
}

/** The example's 【word】 marked, as the word is in an entry's sentences. */
function NoteExample({ ja }: { ja: string }) {
  const m = /^(.*?)【(.*?)】(.*)$/.exec(ja)
  if (!m) return <>{ja}</>
  return (
    <>
      {m[1]}
      <mark>{m[2]}</mark>
      {m[3]}
    </>
  )
}

/**
 * What the sense is, once, under its glosses: its nuance -- where and how the
 * word is used in it -- and an example. The synonym rows below say how each
 * other word differs from this.
 */
function SenseNoteView({ note, lang }: { note: SenseNote; lang: Lang }) {
  const t = S(lang)
  const bg = lang === 'bg' ? note.nuanceBg : undefined
  const en =
    lang === 'bg' && !bg ? (
      <span className="entry-fallback" title={t('notTranslated')}>
        EN
      </span>
    ) : null
  return (
    <div className="sense-note">
      <p className="sense-nuance">
        {bg ?? note.nuance}
        {en}
      </p>
      {note.ex && (
        <p className="sense-example" title={note.ex.src === 'd' ? t('drafted') : undefined}>
          <span lang="ja" className="sense-example-ja">
            <NoteExample ja={note.ex.ja} />
          </span>
          <span className="sense-example-en">{(lang === 'bg' && note.ex.bg) || note.ex.en}</span>
        </p>
      )}
    </div>
  )
}

/** A sense in a line: its first glosses. */
function senseLine(w: Word, n: number, lang: Lang): string | null {
  const s = w.senses[n]
  return s ? glossOf(s, lang).value.split(';').slice(0, 2).join(';') : null
}

/**
 * What sits beside one sense: ! words easy to mix up, ≈ synonyms, ↔ opposites,
 * & pairs, 敬 polite forms, in the blocks a kanji's meaning has them in. On a
 * Bulgarian page a line is in Bulgarian where translated; one that is not yet
 * says so, as an untranslated gloss does.
 */
function SenseAside({
  word,
  sense,
  related,
  lang,
  onWord,
}: {
  word: Word
  sense: number
  related: RelatedWord[]
  lang: Lang
  onWord: (w: Word) => void
}) {
  const t = S(lang)
  if (!related.length) return null
  const open = (r: RelatedWord) => {
    focusMeaningNext(focusKey(r.word.id), String((r.otherSense ?? 1) - 1))
    onWord(r.word)
  }
  const en = (
    <span className="entry-fallback" title={t('notTranslated')}>
      EN
    </span>
  )
  // A line in the page's language: on a Bulgarian page its Bulgarian, else the English marked EN.
  const said = (line: string | null, bg?: string | null) =>
    lang === 'bg' && bg ? { text: bg, mark: null } : { text: line, mark: lang === 'bg' && line ? en : null }
  const rows = (kind: RelatedWord['kind']) =>
    related
      .filter((r) => r.kind === kind)
      .map((r) => {
        const m = senseLine(r.word, (r.otherSense ?? 1) - 1, lang)
        const l = said(r.line, r.lineBg)
        return (
          <CloseRow
            key={r.word.id}
            glyph={r.word.headword}
            sub={r.word.reading}
            sense={m && t('withMeaning', { m })}
            line={l.text}
            lineMark={l.mark}
            title={t('openAt', { word: r.word.headword })}
            warm={warmWord(r.word.id)}
            onOpen={() => open(r)}
          />
        )
      })
  const mix = related.filter((r) => r.kind === 'mix')
  // When to write this word, as each other one's line says when to write that one.
  const ownMix = [...new Map(mix.filter((r) => r.ownLine).map((r) => [r.ownLine, said(r.ownLine, r.ownLineBg)])).values()]
  const syn = rows('syn')
  const ant = rows('ant')
  const pair = rows('pair')
  // A polite counterpart's line is its register: honorific, humble, polite or plain.
  const polite = related
    .filter((r) => r.kind === 'polite')
    .map((r) => (
      <CloseRow
        key={r.word.id}
        glyph={r.word.headword}
        sub={r.word.reading}
        sense={r.otherSense ? t('withMeaning', { m: senseLine(r.word, r.otherSense - 1, lang) ?? '' }) : null}
        line={r.line && REGISTERS.includes(r.line as Register) ? t(r.line as Register) : null}
        title={t('openAt', { word: r.word.headword })}
        warm={warmWord(r.word.id)}
        onOpen={() => open(r)}
      />
    ))
  return (
    <>
      {mix.length > 0 && (
        <section className="aside-block mixup" title={t('mixupsHint')}>
          <AsideTitle icon="!">{t('mixups')}</AsideTitle>
          <ul className="usage-spellings">
            <li data-self>
              <p className="usage-head">
                <span className="usage-spelling" lang="ja">
                  {word.headword}
                </span>
                <span className="usage-reading" lang="ja">
                  {word.reading}
                </span>
                <span className="usage-keyword">{senseLine(word, sense, lang)}</span>
              </p>
              {ownMix.map((l) => (
                <p key={l.text} className="spelling-def">
                  {l.text}
                  {l.mark}
                </p>
              ))}
            </li>
            {mix.map((r) => (
              <li key={r.word.id}>
                <button className="usage-head" title={t('openAt', { word: r.word.headword })} {...warmWord(r.word.id)} onClick={() => open(r)}>
                  <span className="usage-spelling" lang="ja">
                    {r.word.headword}
                  </span>
                  <span className="usage-reading" lang="ja">
                    {r.word.reading}
                  </span>
                  <span className="usage-keyword">{senseLine(r.word, (r.otherSense ?? 1) - 1, lang)}</span>
                </button>
                {r.line && (
                  <p className="spelling-def">
                    {said(r.line, r.lineBg).text}
                    {said(r.line, r.lineBg).mark}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {syn.length > 0 && (
        <section className="aside-block meaning-similar">
          <AsideTitle icon="≈">{t('synonyms')}</AsideTitle>
          <ul>{syn}</ul>
        </section>
      )}
      {ant.length > 0 && (
        <section className="aside-block meaning-similar opposites">
          <AsideTitle icon="↔">{t('opposites')}</AsideTitle>
          <ul>{ant}</ul>
        </section>
      )}
      {pair.length > 0 && (
        <section className="aside-block meaning-similar pairs" title={t('pairsHint')}>
          <AsideTitle icon="&">{t('pairs')}</AsideTitle>
          <ul>{pair}</ul>
        </section>
      )}
      {polite.length > 0 && (
        <section className="aside-block meaning-similar polite" title={t('politeHint')}>
          <AsideTitle icon="敬">{t('politeForms')}</AsideTitle>
          <ul>{polite}</ul>
        </section>
      )}
    </>
  )
}

export function WordPanel({ id, word, from, onPick, onWord, onSignIn, notes }: Props) {
  const lang = useLang()
  const t = S(lang)
  // Known already, it is there at once, as on a page come back to.
  const [entry, setEntry] = useState<WordEntry | null>(() => api.word.peek(id) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stale = false
    setEntry(api.word.peek(id) ?? null)
    setFailed(false)
    // The device has everything but the example sentences, and answers
    // first; the server's full entry replaces it when it comes.
    local.wordEntry(id)?.then(
      (d) => !stale && d && setEntry((e) => e ?? d),
      () => {},
    )
    api.word(id).then(
      (d) => !stale && setEntry(d),
      () => !stale && setFailed(true),
    )
    return () => {
      stale = true
    }
  }, [id])

  // Opened from a row on another word's page: its matching sense comes into view and glows a moment.
  useEffect(() => {
    const n = takeMeaningFocus(focusKey(id))
    if (n === null) return
    return bringToTop(senseAnchor(id, Number(n)), !reducedMotion(), (el) => {
      el.classList.remove('sense-flash')
      void el.offsetWidth // so the glow starts again on a second visit
      el.classList.add('sense-flash')
    })
  }, [id])

  const w = entry?.word ?? word
  if (!w) {
    return (
      <section className="rail-section word-panel">
        <p className="hint">{failed ? t('failed') : t('looking')}</p>
      </section>
    )
  }
  const glosses = w.senses.map((s) => glossOf(s, lang))
  // The main meanings on top, then the ones met later, then the rare; each keeps
  // JMdict's number, which the synonym rows and a kanji's words name it by.
  const RANK = { main: 0, secondary: 1, rare: 2 }
  const order = w.senses
    .map((_, i) => i)
    .sort((a, b) => RANK[entry?.senseNotes?.[a]?.rank ?? 'secondary'] - RANK[entry?.senseNotes?.[b]?.rank ?? 'secondary'] || a - b)
  const machine = lang === 'bg' && glosses.some((g) => !g.fallback)
  const rank = rankOf(w, lang)

  return (
    <section className="rail-section word-panel" aria-label={t('entryFor', { word: w.headword })}>
      {notes ? (
        <div className="entry-rank-row">
          {rank ? <p className="entry-rank entry-rank-line">{rank}</p> : <span />}
          {notes}
        </div>
      ) : (
        rank && <p className="entry-rank entry-rank-line">{rank}</p>
      )}

      <Spellings
        word={w}
        kanji={{ open: entry?.spelling?.open ?? [], old: entry?.spelling?.old ?? {}, onPick }}
        related={{ forms: entry?.related?.filter((r) => r.sense < 0) ?? [], onWord }}
      />

      {/* The verb's other half: 開ける for 開く, and the other way. */}
      {entry && entry.pairs.length > 0 && (
        <p className="entry-pairs">
          <span>{t(transitivity(entry.pairs[0]) === 'vt' ? 'pairVt' : 'pairVi')}</span>
          {entry.pairs.map((p) => (
            <button key={p.id} className="entry-pair" {...warmWord(p.id)} onClick={() => onWord(p)} title={t('pairTitle', { word: p.headword })}>
              <span className="entry-pair-word">{p.headword}</span>
              <span className="entry-pair-reading">{p.reading}</span>
              <Valency word={p} alone />
            </button>
          ))}
        </p>
      )}

      <ol className="entry-senses">
        {order.map((i, k) => {
          const s = w.senses[i]
          const prev = k > 0 ? w.senses[order[k - 1]] : null
          const [lead, ...rest] = glosses[i].value.split(';').map((g) => g.trim())
          const note = entry?.senseNotes?.[i]
          return (
            <li key={i} id={senseAnchor(w.id, i)} className="meaning sense-card" data-rank={note?.rank}>
              {/* Its number and glosses, as a kanji meaning's title: the first gloss leads. */}
              <header>
                <span className="meaning-n">{i + 1}</span>
                <p className="entry-gloss">
                  <span className="sense-lead">{lead}</span>
                  {rest.length > 0 && <span className="rest">; {rest.join('; ')}</span>}
                  {glosses[i].fallback && (
                    <span className="entry-fallback" title={t('notTranslated')}>
                      EN
                    </span>
                  )}
                </p>
                {/* Part of speech only where it changes, as a printed dictionary does. */}
                {(s.pos.length > 0 || s.misc.length > 0) &&
                  (!prev || s.pos.join() !== prev.pos.join() || s.misc.length > 0) && (
                    <p className="entry-pos">
                      {[...s.pos, ...s.misc].map((code, j) => {
                        const tag = tagLabel(code, lang)
                        return (
                          <span key={j}>
                            {j > 0 && ' · '}
                            <abbr title={tag.full}>{tag.short}</abbr>
                          </span>
                        )
                      })}
                    </p>
                  )}
                {/* How soon a learner meets it. Its place is kept, so the glosses line up. */}
                <span className="sense-rank" title={note ? t(`${note.rank}Title`) : undefined}>
                  {note && note.rank !== 'secondary' && t(note.rank)}
                </span>
              </header>
              {note && <SenseNoteView note={note} lang={lang} />}
              {entry?.related && (
                <SenseAside word={w} sense={i} related={entry.related.filter((r) => r.sense === i)} lang={lang} onWord={onWord} />
              )}
            </li>
          )
        })}
      </ol>
      {machine && <p className="entry-machine">{t('machine')}</p>}

      {entry && entry.kanji.length > 0 && (
        <div className="entry-kanji">
          <h3>{t('writtenWith')}</h3>
          <ul>
            {entry.kanji.map((k) => (
              <li key={k.char}>
                <button
                  className="entry-kanji-glyph"
                  data-current={k.char === from || undefined}
                  {...warmKanji(k.char)}
                  onClick={() => onPick(k.char)}
                  title={t('open', { char: k.char })}
                >
                  {k.char}
                </button>
                <div>
                  <p className="entry-kanji-meaning">
                    {kanjiMeaning(k, lang)}
                    {k.jlpt && <span className="entry-kanji-level">N{k.jlpt}</span>}
                  </p>
                  <p className="entry-kanji-yomi">
                    {[...k.onYomi.slice(0, 2), ...k.kunYomi.slice(0, 2)].join('  ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry && entry.examples.length > 0 && (
        <div className="entry-examples">
          <h3>{t('inSentence')}</h3>
          <ul>
            {entry.examples.map((ex, i) => (
              <li key={i}>
                <Example text={ex.text} hit={ex.hit} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed && (
        <p className="hint">
          {entry ? t('needsConnection') : t('restFailed')}
        </p>
      )}

      {!failed && <WordEditButton id={w.id} headword={w.headword} onSignIn={onSignIn} />}
    </section>
  )
}
