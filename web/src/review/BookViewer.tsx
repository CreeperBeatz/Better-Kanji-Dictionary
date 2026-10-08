/**
 * The dictionary tab (Dani, 2026-10-08): the other dictionaries in a tab of
 * their own, for reviewers with two screens -- the definitions on one, the
 * card being labelled on the other.
 *
 * At the top, pick 1. the kanji and 2. the dictionary (Kodansha, 新漢語林,
 * Цалта's kanji book, Wiktionary, and our own entry, Better Kanji Dictionary;
 * 漢字ペディア is a link to its own site), and whether to see it digital (the
 * transcription drawn as the book prints it, whole, nothing folded) or
 * scanned (the printed page, with page turning and zoom: BookEvidence.tsx
 * PageScan). The digital/scanned choice keeps its place under the
 * dictionaries, shown only where a dictionary has both (Wiktionary and our
 * own entry are only digital; of 新漢語林 only the Japan-only senses are
 * transcribed). Each dictionary opens digital until scanned is picked for it.
 * A and D move to the dictionary before and after.
 *
 * Its address is /review/dictionary?char=生&book=kodansha&view=digital. The
 * "Open in dictionary" links (review/dictLink.tsx) all open it in one named
 * tab, so a later link shows its kanji here; what a link does not name stays
 * as the tab had it (Kodansha at first). Reviewers and the admin only: the
 * server refuses the dictionaries to anyone else.
 */
import { useEffect, useState } from 'react'
import { api, type GraphResponse, type KanjiDictionaries, type WordsWithResponse } from '../api'
import { strings, useLang, type Lang } from '../i18n'
import { errorText } from '../i18n/errors'
import { LangSwitch } from '../i18n/LangSwitch'
import { typing, useKey } from '../keys'
import { KanjiEntry, PageScan } from './BookEvidence'
import { KangorinMarks, KangorinSenses, KodanshaEntry, WiktionaryList } from './DictEntries'
import type { DictBook, DictView } from './dictLink'

const S = strings(
  {
    heading: 'Dictionaries',
    kanji: '1. Kanji',
    kanjiHint: 'type or paste a kanji',
    recent: 'recent',
    book: '2. Dictionary',
    bookKeys: 'A and D move to the dictionary before and after',
    kodansha: 'Kodansha',
    kangorin: '新漢語林',
    kanji_book: 'Цалта’s kanji book',
    wiktionary: 'Wiktionary',
    bkd: 'Better Kanji Dictionary',
    notIn: 'not in it',
    theme: 'Colours',
    themeHint: 'The digital entries on white paper, or in night colours; the scans stay as printed.',
    light: 'light',
    dark: 'dark',
    kanjipediaTitle: 'The 漢検漢字辞典 on kanjipedia.jp, in a new tab: its numbered meanings, each with example words. Read there, never copied.',
    digital: 'digital',
    scan: 'scanned',
    pick: 'Type a kanji above, or open one with the book icon on a card.',
    missing: '{char} is not in {book} here. Pick another dictionary.',
    entry: 'entry № {no}',
    pages: 'entry № {no}, on page {pages}',
    pagesMany: 'entry № {no}, on pages {pages}',
    loading: 'loading…',
    // Our own entry
    onSite: 'Open on the site',
    jlpt: 'JLPT N{n}',
    grade: 'grade {n}',
    strokes: '{n} strokes',
    freq: 'frequency #{n}',
    parts: 'Parts',
    groups: 'Meanings, as reviewed',
    notReviewed: 'Its meanings are not reviewed yet. Its common words:',
    noMeaning: 'the kanji brings no meaning to the word',
    moreWords: '+{n} more',
  },
  {
    heading: 'Речници',
    kanji: '1. Канджи',
    kanjiHint: 'напишете или поставете канджи',
    recent: 'скорошни',
    book: '2. Речник',
    bookKeys: 'A и D минават на речника преди и след',
    kodansha: 'Kodansha',
    kangorin: '新漢語林',
    kanji_book: 'Канджи речникът на Цалта',
    wiktionary: 'Уикиречник',
    bkd: 'Better Kanji Dictionary',
    notIn: 'няма го',
    theme: 'Цветове',
    themeHint: 'Дигиталните статии на бяла хартия или в нощни цветове; сканираните страници остават както са отпечатани.',
    light: 'светло',
    dark: 'тъмно',
    kanjipediaTitle: '漢検漢字辞典 на kanjipedia.jp, в нов раздел: номерираните значения, всяко с примерни думи. Чете се там, никога не се копира.',
    digital: 'дигитален',
    scan: 'сканиран',
    pick: 'Напишете канджи горе или го отворете с иконата книга на карта.',
    missing: '{char} го няма в {book} тук. Изберете друг речник.',
    entry: 'статия № {no}',
    pages: 'статия № {no}, на страница {pages}',
    pagesMany: 'статия № {no}, на страници {pages}',
    loading: 'зарежда се…',
    onSite: 'Отвори в сайта',
    jlpt: 'JLPT N{n}',
    grade: '{n} клас',
    strokes: '{n} черти',
    freq: 'честота №{n}',
    parts: 'Части',
    groups: 'Значения, проверени',
    notReviewed: 'Значенията му още не са проверени. Честите му думи:',
    noMeaning: 'канджито не внася значение в думата',
    moreWords: '+още {n}',
  },
)

const BOOKS: DictBook[] = ['kodansha', 'kangorin', 'kanji', 'wiktionary', 'bkd']
const VIEWS: DictView[] = ['digital', 'scan']
const LAST_BOOK = 'betterrtk:dictionary-book'
// The view per dictionary: digital unless scanned was picked for it.
const VIEW_OF = 'betterrtk:dictionary-views'
const RECENT = 'betterrtk:dictionary-recent'
// The digital entries on paper (light) or in night colours (dark, as on a card); the scans are as printed.
const THEME = 'betterrtk:dictionary-theme'
const WORDS_A_GROUP = 6
const isKanji = (c: string) => /^[㐀-鿿豈-﫿]$/.test(c)
const isBook = (b: string | null): b is DictBook => !!b && (BOOKS as string[]).includes(b)
const isView = (v: string | null): v is DictView => !!v && (VIEWS as string[]).includes(v)

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]')
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && isKanji(c)).slice(0, 16) : []
  } catch {
    return []
  }
}

function readViews(): Partial<Record<DictBook, DictView>> {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_OF) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Our own entry for a kanji: the kanji page's data, and its words by reviewed group. */
interface Own {
  graph: GraphResponse | null
  words: WordsWithResponse | null
}

/** What a dictionary has for the kanji: its entry number, a transcription to draw, scanned pages. */
function holdings(d: KanjiDictionaries | null, own: Own | null, b: DictBook): { no: number | null; digital: boolean; pages: number[] } {
  if (b === 'bkd') return { no: null, digital: !!own?.graph, pages: [] }
  if (!d) return { no: null, digital: false, pages: [] }
  if (b === 'kodansha') return { no: d.kodansha?.no ?? null, digital: !!d.kodansha, pages: d.kodansha?.pages ?? [] }
  if (b === 'kangorin') return { no: d.kangorin?.no ?? null, digital: !!d.kangorin?.senses.length, pages: d.kangorin?.pages ?? [] }
  if (b === 'kanji') return { no: d.tsalta?.no ?? null, digital: !!d.tsalta, pages: d.tsalta?.pages ?? [] }
  return { no: null, digital: !!d.wiktionary?.length, pages: [] }
}

/** Better Kanji Dictionary's own entry: the kanji, its readings and levels, its parts, and its words by reviewed group. */
function OwnEntry({ char, own, lang }: { char: string; own: Own; lang: Lang }) {
  const t = S(lang)
  const g = own.graph!
  const k = g.focus
  const meanings = (lang === 'bg' && k.meaningsBg?.length ? k.meaningsBg : k.meanings).join(', ')
  const nodes = new Map(g.components.nodes.map((n) => [n.char, n]))
  const parts = g.components.edges.filter((e) => e.parent === char).map((e) => e.child)
  const facts = [k.jlpt && t('jlpt', { n: k.jlpt }), k.grade && t('grade', { n: k.grade }), k.strokes && t('strokes', { n: k.strokes }), k.freq && t('freq', { n: k.freq })].filter(Boolean)
  const w = own.words
  const groups = w?.groups ?? []
  const gloss = (x: { senses: { gloss: string; glossBg: string | null }[] }) => (lang === 'bg' && x.senses[0]?.glossBg) || x.senses[0]?.gloss
  const word = (x: WordsWithResponse['rest']['words'][number]) => (
    <li key={x.id}>
      <span lang="ja" className="bkd-w">
        {x.headword}
      </span>{' '}
      <span lang="ja" className="hint">
        {x.reading}
      </span>{' '}
      {gloss(x)}
    </li>
  )
  return (
    <div className="bkd-entry">
      <div className="bkd-top">
        <span className="bkd-glyph" lang="ja">
          {char}
        </span>
        <div>
          <p className="bkd-meanings">{meanings}</p>
          <p lang="ja" className="bkd-readings">
            {[...k.onYomi, ...k.kunYomi].join('、')}
          </p>
          <p className="hint">{facts.join(' · ')}</p>
          <a className="clear book-page" href={`/kanji/${encodeURIComponent(char)}`} target="_blank" rel="noopener">
            {t('onSite')} ↗
          </a>
        </div>
      </div>
      {parts.length > 0 && (
        <p className="bkd-parts">
          <b>{t('parts')}:</b>{' '}
          {parts.map((p) => (
            <span key={p} className="bkd-part">
              <span lang="ja">{p}</span> <span className="hint">{(lang === 'bg' && nodes.get(p)?.meaningsBg?.[0]) || nodes.get(p)?.meanings[0]}</span>
            </span>
          ))}
        </p>
      )}
      {groups.length > 0 ? (
        <>
          <h5>{t('groups')}</h5>
          {groups.map((gr) => (
            <section key={gr.id} className="bkd-group">
              <b>{gr.id === 'catch-all' ? t('noMeaning') : (lang === 'bg' && gr.bg) || gr.en}</b>
              {gr.about && <p className="hint">{(lang === 'bg' && gr.aboutBg) || gr.about}</p>}
              <ul className="bkd-words">{gr.words.slice(0, WORDS_A_GROUP).map(word)}</ul>
              {gr.words.length > WORDS_A_GROUP && <p className="hint">{t('moreWords', { n: gr.words.length - WORDS_A_GROUP })}</p>}
            </section>
          ))}
        </>
      ) : (
        w &&
        w.rest.words.length > 0 && (
          <>
            <p className="hint">{t('notReviewed')}</p>
            <ul className="bkd-words">{w.rest.words.slice(0, 12).map(word)}</ul>
          </>
        )
      )}
    </div>
  )
}

export default function BookViewer() {
  const lang = useLang()
  const t = S(lang)
  const [char, setChar] = useState(() => {
    const c = new URLSearchParams(window.location.search).get('char') ?? ''
    return isKanji(c) ? c : ''
  })
  const [book, setBook] = useState<DictBook>(() => {
    const b = new URLSearchParams(window.location.search).get('book')
    const last = sessionStorage.getItem(LAST_BOOK)
    return isBook(b) ? b : isBook(last) ? last : 'kodansha'
  })
  // Digital for every dictionary until scanned is picked for it; a link may name the view of its dictionary.
  const [views, setViews] = useState<Partial<Record<DictBook, DictView>>>(() => {
    const q = new URLSearchParams(window.location.search)
    const v = q.get('view')
    const b = q.get('book')
    const kept = readViews()
    return isView(v) && isBook(b) ? { ...kept, [b]: v } : kept
  })
  const view: DictView = views[book] ?? 'digital'
  const [dark, setDark] = useState(() => localStorage.getItem(THEME) !== 'light')
  const [draft, setDraft] = useState('')
  const [recent, setRecent] = useState(readRecent)
  const [found, setFound] = useState<{ char: string; dicts: KanjiDictionaries | null; own: Own; problem: string | null } | null>(null)

  // The address, the tab's title and the kanji opened before follow the choice.
  useEffect(() => {
    const tt = S(lang)
    sessionStorage.setItem(LAST_BOOK, book)
    sessionStorage.setItem(VIEW_OF, JSON.stringify(views))
    const q = new URLSearchParams(char ? { char, book, view } : { book, view })
    window.history.replaceState(null, '', `/review/dictionary?${q}`)
    document.title = char ? `${char} · ${tt(book === 'kanji' ? 'kanji_book' : book)}` : tt('heading')
    if (char) {
      const next = [char, ...readRecent().filter((c) => c !== char)].slice(0, 16)
      localStorage.setItem(RECENT, JSON.stringify(next))
      setRecent(next)
    }
  }, [char, book, view, views, lang])

  useEffect(() => {
    if (!char) return
    let live = true
    Promise.all([
      api.reviewDictionaries(char).then(
        (dicts) => ({ dicts, problem: null as string | null }),
        (e) => ({ dicts: null, problem: errorText(e, lang) }),
      ),
      api.kanji(char).catch(() => null),
      api.wordsWith(char, true, 0, 12).catch(() => null),
    ]).then(([d, graph, words]) => live && setFound({ char, dicts: d.dicts, own: { graph, words }, problem: d.dicts || graph ? null : d.problem }))
    return () => {
      live = false
    }
  }, [char, lang])

  function take(value: string) {
    const k = [...value].filter(isKanji).pop()
    if (k) {
      setChar(k)
      setDraft('')
    } else setDraft(value)
  }

  const here = found?.char === char ? found : null
  const d = here?.dicts ?? null
  const own = here?.own ?? null
  const hold = (b: DictBook) => (here ? holdings(d, own, b) : null)
  const has = hold(book)
  const hasAny = (b: DictBook) => {
    const h = hold(b)
    return !h || h.digital || h.pages.length > 0
  }
  // The view picked for this dictionary, unless it has only the other one.
  const shown: DictView | null = !has ? null : view === 'scan' ? (has.pages.length ? 'scan' : has.digital ? 'digital' : null) : has.digital ? 'digital' : has.pages.length ? 'scan' : null
  const name = (b: DictBook) => t(b === 'kanji' ? 'kanji_book' : b)
  const where =
    has?.no != null
      ? shown === 'scan' && has.pages.length
        ? t(has.pages.length > 1 ? 'pagesMany' : 'pages', {
            no: has.no,
            pages: has.pages.length > 1 ? `${has.pages[0]}–${has.pages[has.pages.length - 1]}` : has.pages[0],
          })
        : t('entry', { no: has.no })
      : null

  // A and D: the dictionary before and after, past those without the kanji.
  useKey(
    (e) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const step = e.key === 'a' || e.key === 'A' ? -1 : e.key === 'd' || e.key === 'D' ? 1 : 0
      if (!step) return
      e.preventDefault()
      let i = BOOKS.indexOf(book)
      for (let n = 0; n < BOOKS.length; n++) {
        i = (i + step + BOOKS.length) % BOOKS.length
        if (hasAny(BOOKS[i])) {
          setBook(BOOKS[i])
          return
        }
      }
    },
    { capture: true },
  )

  let body: React.ReactNode
  if (!char) body = <p className="hint">{t('pick')}</p>
  else if (!here) body = <p className="hint">{t('loading')}</p>
  else if (here.problem) body = <p className="account-problem">{here.problem}</p>
  else if (!has || !shown) body = <p className="hint">{t('missing', { char, book: name(book) })}</p>
  else if (shown === 'scan')
    body = <PageScan key={`${char}:${book}`} book={book as 'kodansha' | 'kangorin' | 'kanji'} page={has.pages[0]} extra={where && <span className="hint dv-entry">{where}</span>} />
  else
    body = (
      <div className={`dv-digital${dark ? ' dict-night' : ''}`}>
        {where && <p className="hint dv-entry">{where}</p>}
        {book === 'kodansha' && d?.kodansha && <KodanshaEntry char={char} k={d.kodansha} />}
        {book === 'kangorin' && d?.kangorin && (
          <>
            <KangorinMarks g={d.kangorin} />
            <KangorinSenses g={d.kangorin} whole />
          </>
        )}
        {book === 'kanji' && d?.tsalta && <KanjiEntry src={d.tsalta} words="all" />}
        {book === 'wiktionary' && d?.wiktionary && <WiktionaryList entries={d.wiktionary} />}
        {book === 'bkd' && own?.graph && <OwnEntry char={char} own={own} lang={lang} />}
      </div>
    )
  const choice = !!has?.digital && (has?.pages.length ?? 0) > 0

  return (
    <div className="dict-viewer">
      <header className="dv-bar">
        <div className="dv-field">
          <span className="dv-step">{t('kanji')}</span>
          <span className="dv-char" lang="ja">
            {char || '・'}
          </span>
          <input
            className="assoc-text dv-input"
            lang="ja"
            value={draft}
            placeholder={t('kanjiHint')}
            aria-label={t('kanji')}
            onChange={(e) => ((e.nativeEvent as InputEvent).isComposing ? setDraft(e.target.value) : take(e.target.value))}
            onCompositionEnd={(e) => take(e.currentTarget.value)}
          />
          {recent.length > 1 && (
            <span className="dv-recent" aria-label={t('recent')}>
              <span className="hint">{t('recent')}:</span>
              {recent
                .filter((c) => c !== char)
                .map((c) => (
                  <button key={c} type="button" className="search-filter" lang="ja" onClick={() => setChar(c)}>
                    {c}
                  </button>
                ))}
            </span>
          )}
        </div>
        <div className="dv-field dv-book">
          <span className="dv-step" title={t('bookKeys')}>
            {t('book')}
          </span>
          <div className="dv-choices">
            <div className="dv-books">
              {BOOKS.map((b) => {
                const none = !hasAny(b)
                return (
                  <button
                    key={b}
                    type="button"
                    className="search-filter"
                    data-on={book === b || undefined}
                    aria-pressed={book === b}
                    disabled={none}
                    title={t('bookKeys')}
                    onClick={() => setBook(b)}
                  >
                    {name(b)}
                    {none && <span className="hint"> · {t('notIn')}</span>}
                  </button>
                )
              })}
              {d && (
                <a className="search-filter dv-ext" href={d.kanjipedia} target="_blank" rel="noopener" title={t('kanjipediaTitle')}>
                  漢字ペディア ↗
                </a>
              )}
            </div>
            {/* Its place is always kept, so nothing under it moves; shown only where there is a choice. */}
            <div className="dv-views" role="group" data-none={!choice || undefined} aria-hidden={!choice || undefined}>
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="search-filter"
                  data-on={shown === v || undefined}
                  aria-pressed={shown === v}
                  tabIndex={choice ? undefined : -1}
                  onClick={() => setViews((vs) => ({ ...vs, [book]: v }))}
                >
                  {t(v)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <span className="dv-theme" role="group" aria-label={t('theme')}>
          {[false, true].map((on) => (
            <button
              key={String(on)}
              type="button"
              className="search-filter"
              data-on={dark === on || undefined}
              aria-pressed={dark === on}
              title={t('themeHint')}
              onClick={() => {
                setDark(on)
                localStorage.setItem(THEME, on ? 'dark' : 'light')
              }}
            >
              {t(on ? 'dark' : 'light')}
            </button>
          ))}
        </span>
        <LangSwitch />
      </header>
      <main className="dv-page">{body}</main>
    </div>
  )
}
