/**
 * What Dani's two print dictionaries say about a card (pipeline/book_sources.py),
 * with the printed page a click away. The books were transcribed by an AI, so
 * anything taken from them is checked against the page's scan, which only
 * reviewers and the admin can open (server/books.py).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { api, type BookGloss, type BookKeyword, type BookOld, type BookPartView, type BookRef, type BookSplit } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'

const S = strings(
  {
    kanji: 'Цалта’s kanji book',
    'bg-ja': 'Иванов’s Bulgarian–Japanese dictionary',
    page: 'p. {n}',
    pageHint: 'The printed page: check what was read from it',
    loading: 'loading the page…',
    zoom: 'Click to zoom in or out',
    unsure: 'The transcription may be wrong here',
    shared: 'This spelling fits more than one word: the book may mean another of them.',
    splits: 'Splits it as',
    sameNow: 'the same as now',
    sameProposed: 'the same as the proposal',
    use: 'use this split',
    noChar: 'no character for this part',
    oldForm: 'Gives {old} as its old form',
    names: 'Bulgarian names',
    itsEntry: 'Its own entry',
    namedIn: 'Named in',
    keyword: 'keyword',
    alt: 'second meaning',
    inList: 'already in the list',
    add: '+ add',
    addTo: '+{n}',
    addToHint: 'add to sense {n}',
  },
  {
    kanji: 'Канджи речникът на Цалта',
    'bg-ja': 'Българско-японският речник на Иванов',
    page: 'с. {n}',
    pageHint: 'Отпечатаната страница: сверете прочетеното от нея',
    loading: 'страницата се зарежда…',
    zoom: 'Щракнете, за да увеличите или намалите',
    unsure: 'Преписът тук може да е грешен',
    shared: 'Този запис пасва на повече от една дума: книгата може да има предвид друга от тях.',
    splits: 'Разделя го на',
    sameNow: 'същото като сега',
    sameProposed: 'същото като предложението',
    use: 'вземете това разделяне',
    noChar: 'няма знак за тази част',
    oldForm: 'Дава {old} като старата му форма',
    names: 'Български имена',
    itsEntry: 'Собствената ѝ статия',
    namedIn: 'Наречена така в',
    keyword: 'ключова дума',
    alt: 'второ значение',
    inList: 'вече е в списъка',
    add: '+ добавете',
    addTo: '+{n}',
    addToHint: 'добавете към значение {n}',
  },
)

// A page's scan, fetched once a session: flipping between cards of one page reuses it.
const scans = new Map<string, Promise<string>>()

function scan(book: BookRef['book'], page: number): Promise<string> {
  const key = `${book}/${page}`
  let p = scans.get(key)
  if (!p) {
    p = api.reviewBookPage(book, page).then((blob) => URL.createObjectURL(blob))
    p.catch(() => scans.delete(key)) // a failure is asked again next time
    scans.set(key, p)
  }
  return p
}

function PageScan({ book, page }: { book: BookRef['book']; page: number }) {
  const lang = useLang()
  const t = S(lang)
  const [url, setUrl] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    let live = true
    scan(book, page).then(
      (u) => live && setUrl(u),
      (e) => live && setProblem(errorText(e, lang)),
    )
    return () => {
      live = false
    }
  }, [book, page, lang])
  if (problem) return <p className="hint">{problem}</p>
  if (!url) return <p className="hint">{t('loading')}</p>
  return (
    <div className="book-scan" data-zoom={zoom || undefined}>
      <img src={url} alt={t('page', { n: page })} title={t('zoom')} onClick={() => setZoom((z) => !z)} />
    </div>
  )
}

/** Which book and entry, its pages (each opens its scan), what the agent was unsure of, and the book's view. */
export function BookSource({ src, children }: { src: BookRef; children?: ReactNode }) {
  const t = S(useLang())
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="book-src">
      <p className="book-head">
        <span className="book-name">{t(src.book)}</span>
        {src.no != null && <> · №{src.no}</>}
        {src.pages.map((p) => (
          <button
            key={p}
            type="button"
            className="clear book-page"
            data-on={open === p || undefined}
            title={t('pageHint')}
            onClick={() => setOpen((o) => (o === p ? null : p))}
          >
            {t('page', { n: p })}
          </button>
        ))}
      </p>
      {children}
      {src.unsure && src.unsure.length > 0 && (
        <p className="queue-warn book-unsure">
          {t('unsure')}: {src.unsure.join('; ')}
        </p>
      )}
      {open !== null && <PageScan key={open} book={src.book} page={open} />}
    </div>
  )
}

const sameSet = (a: string[] | null | undefined, b: string[] | null | undefined) =>
  !!a && !!b && a.length === b.length && a.every((c) => b.includes(c))

/** A decomposition card: how the kanji book splits the kanji, and a way to take it as the answer. */
export function BookSplitView({
  view,
  current,
  proposed,
  onUse,
}: {
  view: BookSplit
  current: string[] | null
  proposed: string[] | null
  onUse?: (parts: string[]) => void
}) {
  const t = S(useLang())
  const split = view.split
  return (
    <BookSource src={view}>
      <p className="book-parts">
        <span className="hint">{t('splits')} </span>
        {view.parts.map((p, i) => (
          <span key={i} className="book-part">
            <span lang="ja" className="book-part-char">
              {p.char ?? '?'}
            </span>{' '}
            <span lang="bg">{p.name}</span>
            {!p.char && <span className="hint"> ({p.glyph_desc || t('noChar')})</span>}
          </span>
        ))}
        {sameSet(split, current) ? (
          <span className="hint"> · {t('sameNow')}</span>
        ) : sameSet(split, proposed) ? (
          <span className="hint"> · {t('sameProposed')}</span>
        ) : (
          split &&
          onUse && (
            <button type="button" className="clear" onClick={() => onUse(split)}>
              {t('use')}
            </button>
          )
        )}
      </p>
    </BookSource>
  )
}

/** A form link card: the old form the kanji book gives. */
export function BookOldView({ view }: { view: BookOld }) {
  const t = S(useLang())
  return (
    <BookSource src={view}>
      <p lang="ja">{t('oldForm', { old: view.old })}</p>
    </BookSource>
  )
}

/** A part meaning card: what the kanji book calls the part, in its own entry and in the kanji it names it in. */
export function BookPartPanel({ view }: { view: BookPartView }) {
  const t = S(useLang())
  return (
    <div className="book-part-panel">
      {view.names.length > 0 && (
        <p>
          <span className="hint">{t('names')}: </span>
          <span lang="bg">{view.names.map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ')}</span>
        </p>
      )}
      {view.entry && (
        <BookSource src={view.entry}>
          <p>
            <span className="hint">{t('itsEntry')}: </span>
            {view.entry.name && <b lang="bg">{view.entry.name}</b>}
            {view.entry.note && <span lang="bg"> — {view.entry.note}</span>}
          </p>
        </BookSource>
      )}
      {view.seen.map((s) => (
        <BookSource key={`${s.no}`} src={s}>
          <p>
            <span className="hint">{t('namedIn')} </span>
            <span lang="ja">{s.char}</span>: <span lang="bg">{s.name}</span>
          </p>
        </BookSource>
      ))}
    </div>
  )
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The separate terms of a printed gloss: "плантация, поле (за зеленчуци)" is two. */
function terms(gloss: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of gloss) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** A term, ticked when the list has it already, else with a button for each place it can go. */
function Term({ term, has, targets }: { term: string; has: boolean; targets: { label: string; title?: string; add: () => void }[] }) {
  const t = S(useLang())
  return (
    <span className="book-term" data-has={has || undefined}>
      <span lang="bg">{term}</span>
      {has ? (
        <span className="book-has" title={t('inList')}>
          {' '}
          ✓
        </span>
      ) : (
        targets.map((x) => (
          <button key={x.label} type="button" className="clear book-add" title={x.title} onClick={x.add}>
            {x.label}
          </button>
        ))
      )}
    </span>
  )
}

/** A kanji's Bulgarian card: the book's keyword and second meaning, each added to the meanings with a click. */
export function BookKeywordPanel({ view, value, onChange }: { view: BookKeyword; value: string[]; onChange: (v: string[]) => void }) {
  const t = S(useLang())
  const have = new Set(value.map(norm))
  const room = value.length < 12
  const add = (m: string) => onChange([...value.filter((v) => v.trim()), m])
  const row = (label: string, text: string) => (
    <p>
      <span className="hint">{label}: </span>
      {terms(text).map((m) => (
        <Term key={m} term={m} has={have.has(norm(m))} targets={room ? [{ label: t('add'), add: () => add(m) }] : []} />
      ))}
    </p>
  )
  return (
    <BookSource src={view}>
      {row(t('keyword'), view.keyword)}
      {view.alt && row(t('alt'), view.alt)}
    </BookSource>
  )
}

/** A word's Bulgarian card: every gloss either book gives the word, each term added to a sense with a click. */
export function BookGlossPanel({ views, value, onChange }: { views: BookGloss[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = S(useLang())
  const has = (term: string) => value.some((g) => g.split(';').some((x) => norm(x) === norm(term)))
  const addTo = (i: number, term: string) =>
    onChange(value.map((g, j) => (j !== i ? g : g.trim() ? `${g.trim()}; ${term}` : term)))
  return (
    <div className="book-glosses">
      {views.map((v, k) => (
        <BookSource key={k} src={v}>
          <p>
            <span lang="ja" className="book-ja">
              {v.ja}
            </span>{' '}
            {v.romaji && <span className="hint">{v.romaji} </span>}
            {terms(v.bg).map((term) => (
              <Term
                key={term}
                term={term}
                has={has(term)}
                targets={
                  value.length === 1
                    ? [{ label: t('add'), add: () => addTo(0, term) }]
                    : value.map((_, i) => ({ label: t('addTo', { n: i + 1 }), title: t('addToHint', { n: i + 1 }), add: () => addTo(i, term) }))
                }
              />
            ))}
            {v.notes && v.notes.length > 0 && <span className="hint" lang="bg"> ({v.notes.join('; ')})</span>}
          </p>
          {v.shared && <p className="hint">{t('shared')}</p>}
        </BookSource>
      ))}
    </div>
  )
}
