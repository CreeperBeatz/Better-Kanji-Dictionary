/**
 * What Dani's two print dictionaries say about a card (pipeline/book_sources.py).
 * A kanji book entry is drawn the way the typeset books draw it (the PDFs in
 * Documents/JapaneseDictionaries/out), from the transcription the server
 * keeps (server/books.py). The printed page's scan is the last resort, for
 * when the drawn entry looks wrong: a button opens it in a popup, and only
 * reviewers and the admin can fetch it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  api,
  type BookGloss,
  type BookKeyword,
  type BookOld,
  type BookPartView,
  type BookRef,
  type BookSplit,
  type KanjiBookEntry,
} from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { typing, useKey } from '../keys'
import { Overlay } from '../Overlay'

const S = strings(
  {
    kanji: 'Цалта’s kanji book',
    'bg-ja': 'Иванов’s Bulgarian–Japanese dictionary',
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    kangorin: '新漢語林',
    pdfPage: 'page {n}',
    fromBook: 'From the book',
    page: 'printed page {n}',
    pageHint: 'The scan of the printed page: for when what is drawn here looks wrong',
    pageTitle: '{book}, page {n}',
    openBook: 'open the printed page',
    prev: 'Previous page (←)',
    next: 'Next page (→)',
    zoomIn: 'Zoom in (+)',
    zoomOut: 'Zoom out (−)',
    fit: 'The whole page (0)',
    whole: 'whole page',
    noPage: 'There is no page here.',
    loading: 'loading…',
    zoom: 'Click to zoom; Ctrl+wheel or + − for more. Drag to move around the page; click again for the whole page.',
    unsure: 'The transcription may be wrong here',
    shared: 'This spelling fits more than one word: the book may mean another of them.',
    ourParts: 'In our parts',
    sameNow: 'the same as now',
    sameProposed: 'the same as the proposal',
    use: 'use this split',
    oldForm: 'Gives {old} as its old form',
    names: 'Its Bulgarian names in the book',
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
    kodansha: 'Kodansha Kanji Learner’s Dictionary',
    kangorin: '新漢語林',
    pdfPage: 'с. {n}',
    fromBook: 'От книгата',
    page: 'отпечатана с. {n}',
    pageHint: 'Сканираната страница: за когато нарисуваното тук изглежда грешно',
    pageTitle: '{book}, страница {n}',
    openBook: 'отворете отпечатаната страница',
    prev: 'Предишна страница (←)',
    next: 'Следваща страница (→)',
    zoomIn: 'Увеличи (+)',
    zoomOut: 'Намали (−)',
    fit: 'Цялата страница (0)',
    whole: 'цялата страница',
    noPage: 'Тук няма страница.',
    loading: 'зарежда се…',
    zoom: 'Щракнете за увеличение; Ctrl+колелце или + − за повече. Плъзнете, за да се движите по страницата; щракнете отново за цялата страница.',
    unsure: 'Преписът тук може да е грешен',
    shared: 'Този запис пасва на повече от една дума: книгата може да има предвид друга от тях.',
    ourParts: 'В нашите части',
    sameNow: 'същото като сега',
    sameProposed: 'същото като предложението',
    use: 'вземете това разделяне',
    oldForm: 'Дава {old} като старата му форма',
    names: 'Българските ѝ имена в книгата',
    keyword: 'ключова дума',
    alt: 'второ значение',
    inList: 'вече е в списъка',
    add: '+ добавете',
    addTo: '+{n}',
    addToHint: 'добавете към значение {n}',
  },
)

/** Fetched once a session: cards of one page or entry reuse it. */
function once<T>(cache: Map<string, Promise<T>>, key: string, get: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = get()
    p.catch(() => cache.delete(key)) // a failure is asked again next time
    cache.set(key, p)
  }
  return p
}

const scans = new Map<string, Promise<string>>()
const entries = new Map<string, Promise<KanjiBookEntry>>()

/** A promise's value once it is in, or the error's text. */
function useFetched<T>(key: string, get: () => Promise<T>, cache: Map<string, Promise<T>>): { value: T | null; problem: string | null } {
  const lang = useLang()
  const [state, setState] = useState<{ key: string; value: T | null; problem: string | null }>({ key, value: null, problem: null })
  useEffect(() => {
    let live = true
    once(cache, key, get).then(
      (value) => live && setState({ key, value, problem: null }),
      (e) => live && setState({ key, value: null, problem: errorText(e, lang) }),
    )
    return () => {
      live = false
    }
    // `get` is the same request for the same key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lang])
  return state.key === key ? state : { value: null, problem: null }
}

const ZOOM_MAX = 6 // times the page's width when it fits
const ZOOM_STEP = 1.25

/**
 * A book's scanned page, from the entry's first page: ← → (or the arrow keys)
 * turn the pages; a click zooms in on the point clicked and a second click
 * shows the whole page again; − + (Ctrl+wheel, the - + 0 keys) zoom from the
 * whole page up to six times its width, and the page is dragged to move
 * around it. It has
 * the keyboard (but for a field being typed in); Escape calls `onEscape`.
 * In the popup below, and in the dictionary tab (review/BookViewer.tsx).
 */
export function PageScan({ book, page, onEscape, extra }: { book: BookRef['book']; page: number; onEscape?: () => void; extra?: ReactNode }) {
  const t = S(useLang())
  const [n, setN] = useState(page)
  // 1: the whole page in view; more: that many times the width it has then.
  const [zoom, setZoom] = useState(1)
  const [fitW, setFitW] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // A press on the page: a drag once it moves, else a click.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  // The point clicked, as a share of the picture and where it is in the box, to keep under the pointer as it zooms.
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null)
  const { value: url, problem } = useFetched(`${book}/${n}`, () => api.reviewBookPage(book, n).then((b) => URL.createObjectURL(b)), scans)
  const zoomTo = (z: number) => setZoom(Math.min(ZOOM_MAX, Math.max(1, Math.round(z * 100) / 100)))
  const turn = (d: number) => setN((p) => Math.max(1, p + d))
  // Heard before the review screen's own keys: Escape closes the page, not review mode, and
  // a card's shortcuts (s skips) do nothing behind it.
  useKey(
    (e) => {
      if (typing(e.target)) return
      e.stopPropagation()
      const keys: Record<string, () => void> = {
        ...(onEscape ? { Escape: onEscape } : {}),
        ArrowLeft: () => turn(-1),
        ArrowRight: () => turn(1),
        '+': () => zoomTo(zoom * ZOOM_STEP),
        '=': () => zoomTo(zoom * ZOOM_STEP),
        '-': () => zoomTo(zoom / ZOOM_STEP),
        '0': () => zoomTo(1),
      }
      const run = keys[e.key]
      if (run) {
        e.preventDefault()
        run()
      }
    },
    { capture: true },
  )
  // Ctrl+wheel zooms (the browser's own page zoom stays off while the popup is open).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(1, z * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [url])

  useLayoutEffect(() => {
    const a = anchor.current
    const img = box.current?.querySelector('img')
    anchor.current = null
    if (!a || !img || !box.current) return
    box.current.scrollLeft = img.offsetLeft + a.fx * img.offsetWidth - a.x
    box.current.scrollTop = img.offsetTop + a.fy * img.offsetHeight - a.y
  }, [zoom])

  function clicked(e: React.PointerEvent) {
    const img = box.current?.querySelector('img')
    if (!img || !box.current) return
    if (zoom > 1) return zoomTo(1)
    const r = img.getBoundingClientRect()
    const b = box.current.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
    anchor.current = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, x: e.clientX - b.left, y: e.clientY - b.top }
    zoomTo(2)
  }

  const title = t('pageTitle', { book: t(book), n })
  return (
    <>
      <div className="book-popup-bar">
        <button type="button" className="book-turn" onClick={() => turn(-1)} disabled={n <= 1} title={t('prev')} aria-label={t('prev')}>
          ←
        </button>
        <span className="book-popup-title">{title}</span>
        <button type="button" className="book-turn" onClick={() => turn(1)} title={t('next')} aria-label={t('next')}>
          →
        </button>
        {extra}
        <span className="book-zoom">
          <button type="button" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= 1} title={t('zoomOut')} aria-label={t('zoomOut')}>
            −
          </button>
          <button type="button" className="book-zoom-n" onClick={() => zoomTo(1)} title={t('fit')}>
            {zoom === 1 ? t('whole') : `${Math.round(zoom * 100)}%`}
          </button>
          <button type="button" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} title={t('zoomIn')} aria-label={t('zoomIn')}>
            +
          </button>
        </span>
      </div>
      {problem ? (
        <p className="hint">{n !== page ? t('noPage') : problem}</p>
      ) : !url ? (
        <p className="hint">{t('loading')}</p>
      ) : (
        <div
          ref={box}
          className="book-scan"
          data-zoom={zoom > 1 || undefined}
          title={t('zoom')}
          onPointerDown={(e) => {
            if (e.button !== 0 || !box.current) return
            drag.current = { x: e.clientX, y: e.clientY, left: box.current.scrollLeft, top: box.current.scrollTop, moved: false }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || !box.current) return
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true
            if (zoom === 1) return
            box.current.scrollLeft = d.left - (e.clientX - d.x)
            box.current.scrollTop = d.top - (e.clientY - d.y)
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            if (d && !d.moved) clicked(e)
          }}
          onPointerCancel={() => (drag.current = null)}
        >
          <img
            src={url}
            alt={title}
            draggable={false}
            style={zoom > 1 && fitW ? { width: fitW * zoom } : undefined}
            onLoad={(e) => zoom === 1 && setFitW(e.currentTarget.clientWidth)}
          />
        </div>
      )}
    </>
  )
}

/** A book's page in a popup over the review screen. */
export function PagePopup({ book, page, onClose }: { book: BookRef['book']; page: number; onClose: () => void }) {
  const t = S(useLang())
  return (
    <Overlay className="book-popup" panel="book-popup-panel" label={t(book)} onClose={onClose} escape={false} closeTitle="Esc">
      <PageScan book={book} page={page} onEscape={onClose} />
    </Overlay>
  )
}

/** One button for a book: its page in the popup, from the first page the entry is on. */
export function OpenBook({ book, pages, label }: { book: BookRef['book']; pages: number[]; label?: string }) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  if (!pages.length) return null
  return (
    <>
      <button
        type="button"
        className="clear book-page"
        title={t('pageHint')}
        onClick={(e) => {
          e.preventDefault() // inside a folded entry's line: the page, without unfolding it
          setOpen(true)
        }}
      >
        {label ?? t('openBook')} ↗
      </button>
      {open && createPortal(<PagePopup book={book} page={pages[0]} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

/** *x* in the book's notes is its italics. */
function noteText(note: string): ReactNode[] {
  return note.split(/\*(.+?)\*/g).map((s, i) => (i % 2 ? <i key={i}>{s}</i> : s))
}

/**
 * A kanji book entry as the book draws it: number, keyword, parts, level; the
 * kanji, its readings, old form, frequency, strokes and radical; its words;
 * its note. `words`: all of them with the note, none (the head only), or the
 * one a word card is about.
 */
export function KanjiEntry({ src, words }: { src: BookRef; words: 'all' | 'none' | string }) {
  const key = src.no != null ? `no:${src.no}` : `char:${src.char ?? ''}`
  const { value: e, problem } = useFetched(key, () => api.reviewBookEntry(src.no ?? null, src.char ?? null), entries)
  const t = S(useLang())
  if (problem) return <p className="hint">{problem}</p>
  if (!e) return <p className="hint">{t('loading')}</p>
  const glyph = e.kanji ?? e.char
  const meta = [
    e.old_form && `舊${e.old_form}`,
    e.freq && `F${e.freq}`,
    e.strokes && `画${e.strokes}`,
    (e.radical?.char || e.radical?.no) && `${e.radical?.char ?? ''}${e.radical?.no ?? ''}`,
  ].filter(Boolean)
  const shown = words === 'all' ? (e.words ?? []) : words === 'none' ? [] : (e.words ?? []).filter((w) => w.ja === words)
  return (
    <div className="book-entry" lang="bg" data-grapheme={e.type === 'grapheme' || undefined}>
      <div className="be-head">
        {e.no != null && <span className="be-no">{e.no}.</span>}
        <span className="be-kw">{e.keyword ?? e.name}</span>
        {e.alt_meaning && <span className="be-alt">{e.alt_meaning}</span>}
        <span className="be-parts">
          {e.parts.map((p, i) => (
            <span key={i}>
              {i > 0 && ' + '}
              {p.char ? (
                <span className="be-pc" lang="ja">
                  {p.char}
                </span>
              ) : (
                <i>[{p.glyph_desc ?? '?'}]</i>
              )}{' '}
              {p.name}
            </span>
          ))}
        </span>
        {e.level && <span className="be-lvl">[{e.level}]</span>}
      </div>
      {words !== 'none' && (
        <div className="be-cols">
          <div className="be-glyph" lang="ja">
            {glyph ?? <i className="be-desc">{e.glyph_desc}</i>}
          </div>
          <div className="be-main">
            {e.type === 'kanji' && (
              <div className="be-info">
                <span>{[...(e.kun ?? []), ...(e.on ?? [])].join('  ')}</span>
                <span className="be-meta" lang="ja">
                  {meta.join(' ')}
                </span>
              </div>
            )}
            {shown.length > 0 && (
              <div className="be-words" data-one={words !== 'all' || undefined}>
                {shown.map((w, i) => (
                  <div key={i} className="be-w">
                    <span className="be-ja" lang="ja">
                      {w.ja}
                    </span>
                    <span>
                      <b>
                        {w.romaji}
                        {w.star && '★'}
                      </b>{' '}
                      {w.bg}
                      {w.jlpt && <span className="be-jl"> {w.jlpt}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {words === 'all' && e.type === 'grapheme' && e.note && <div className="be-note">{noteText(e.note)}</div>}
          </div>
        </div>
      )}
      {words === 'all' && e.type === 'kanji' && e.note && <div className="be-note">{noteText(e.note)}</div>}
    </div>
  )
}

/**
 * Which book and entry, the entry itself (the kanji book's, drawn), the card's
 * use of it, what the agent was unsure of, and the printed page in a popup.
 * `entry`: how much of a kanji book entry to draw (KanjiEntry's `words`).
 */
export function BookSource({ src, entry = 'all', children }: { src: BookRef; entry?: 'all' | 'none' | string; children?: ReactNode }) {
  const t = S(useLang())
  return (
    <div className="book-src">
      <p className="book-head">
        <span className="book-from">{t('fromBook')}:</span> <span className="book-name">{t(src.book)}</span>
        {src.no != null && <> · №{src.no}</>}
        <OpenBook book={src.book} pages={src.pages} />
      </p>
      {src.book === 'kanji' && (src.no != null || src.char) && <KanjiEntry src={src} words={entry} />}
      {children}
      {src.unsure && src.unsure.length > 0 && (
        <p className="queue-warn book-unsure">
          {t('unsure')}: {src.unsure.join('; ')}
        </p>
      )}
    </div>
  )
}

const sameSet = (a: string[] | null | undefined, b: string[] | null | undefined) =>
  !!a && !!b && a.length === b.length && a.every((c) => b.includes(c))

/** A decomposition card: the kanji book's entry, its split in our parts, and a way to take it as the answer. */
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
    <BookSource src={view} entry="none">
      {split && (
        <p className="book-use">
          <span className="hint">{t('ourParts')}: </span>
          <span lang="ja" className="book-ja">
            {split.join(' ')}
          </span>
          {sameSet(split, current) ? (
            <span className="hint"> · {t('sameNow')}</span>
          ) : sameSet(split, proposed) ? (
            <span className="hint"> · {t('sameProposed')}</span>
          ) : (
            onUse && (
              <button type="button" className="clear" onClick={() => onUse(split)}>
                {t('use')}
              </button>
            )
          )}
        </p>
      )}
    </BookSource>
  )
}

/** A form link card: the kanji book's entry, with the old form it gives. */
export function BookOldView({ view }: { view: BookOld }) {
  const t = S(useLang())
  return (
    <BookSource src={view} entry="none">
      <p className="book-use" lang="ja">
        {t('oldForm', { old: view.old })}
      </p>
    </BookSource>
  )
}

/** A part meaning card: the part's own entry in the kanji book, and the kanji the book names it in. */
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
      {view.entry && <BookSource src={view.entry} entry="none" />}
      {view.seen.map((s) => (
        <BookSource key={`${s.no}`} src={s} entry="none" />
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

/** A kanji's Bulgarian card: the entry, then its keyword and second meaning to add with a click. */
export function BookKeywordPanel({ view, value, onChange }: { view: BookKeyword; value: string[]; onChange: (v: string[]) => void }) {
  const t = S(useLang())
  const have = new Set(value.map(norm))
  const room = value.length < 12
  const add = (m: string) => onChange([...value.filter((v) => v.trim()), m])
  const row = (label: string, text: string) => (
    <p className="book-use">
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

/**
 * A word's Bulgarian card: each book's gloss of it -- the kanji book's as the
 * word's line in its kanji's entry, the dictionary's as its printed line -- and
 * each term to add to a sense with a click.
 */
export function BookGlossPanel({ views, value, onChange }: { views: BookGloss[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = S(useLang())
  const has = (term: string) => value.some((g) => g.split(';').some((x) => norm(x) === norm(term)))
  const addTo = (i: number, term: string) =>
    onChange(value.map((g, j) => (j !== i ? g : g.trim() ? `${g.trim()}; ${term}` : term)))
  return (
    <div className="book-glosses">
      {views.map((v, k) => (
        <BookSource key={k} src={v} entry={v.ja}>
          {v.book === 'bg-ja' && (
            <p className="book-line" lang="bg">
              {v.bg} <i className="bl-rm">{v.romaji}</i>{' '}
              <span lang="ja" className="bl-ja">
                {v.ja}
              </span>
              {v.notes && v.notes.length > 0 && <> ({v.notes.join('; ')})</>}
            </p>
          )}
          <p className="book-use">
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
          </p>
          {v.shared && <p className="hint">{t('shared')}</p>}
        </BookSource>
      ))}
    </div>
  )
}
