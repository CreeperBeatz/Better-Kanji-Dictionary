/**
 * A kanji's meaning groups with its words under them, to review both at once.
 *
 * Each group is a box: its labels (English, Bulgarian, a note) and the words
 * it holds, with readings and glosses. Words move by drag and drop, or, on a
 * phone, by a long press where the browser maps it to the menu; tapping
 * selects several for the menu to move at once. The catch-all
 * (the kanji brings no meaning to the word) is always there; "not in a group" holds the words
 * no group claims. Only words in the labeling scope are on the board: common,
 * or with a newspaper rank or a JLPT level (server/review.py `_on_board`).
 * The rest are a separate task, later.
 *
 * The board only edits; the queue decides. `finalizeBoard` (review/board.ts)
 * turns it into what the server takes: the groups with their final ids, and
 * word id -> group id.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { type BoardWord, type KanjiDictionaries, type MeaningGroup } from '../api'
import { strings, useLang } from '../i18n'
import { useKey } from '../keys'
import { newsRank } from '../search/Results'
import { toggled, withIds } from '../sets'
import type { Placements } from './board'
import { elsewhere } from './dictMatch'
import { readDraft, writeDraft } from './drafts'
import { CATCH_ALL } from './editors'

const S = strings(
  {
    groups: 'Meaning groups',
    groupsHint: '1 to 6, by what the kanji does in words. Drag words between groups, or right-click a word (or a selection of several) to pick its group.',
    tickHint: 'Tick each word as you check it: the card can be accepted once every word in the groups is ticked.',
    allConfirmed: 'every word confirmed',
    en: 'English label',
    note: 'Note',
    remove: 'remove group',
    addGroup: 'add a group',
    catchAll: 'The kanji brings no meaning to the word',
    catchAllHint: 'for sound-only spellings (ateji: 合羽 カッパ, 珈琲), whole-word spellings the separate kanji don’t explain (生姜, 百合, 生憎) and wordplay (米寿: 米 as 八十八)',
    none: 'Not in a group',
    noneHint: 'common or ranked words no group claims; rarer words are not labelled here',
    clearPick: 'clear selection',
    picked: '{n} selected',
    empty: 'no words',
    confirmWord: 'Confirm: this word belongs here',
    confirmed: 'confirmed',
    nConfirmed: '{n} confirmed',
    moveTo: 'Move to',
    moveMany: 'Move {n} selected to',
    unnamed: '(unnamed group)',
    confirmOne: 'Confirm: it belongs here',
    confirmMany: 'Confirm {n} selected',
    unconfirmOne: 'Take back the confirmation',
    unconfirmMany: 'Take back {n} confirmations',
    skip: 'Not sure: leave for later',
    skipMany: 'Not sure: leave {n} for later',
    unskip: 'Decide it now after all',
    skippedTag: 'not sure',
    skippedTitle: 'Left for later: on submit it comes back at the end of the queue',
    skippedNote: '{n} words left for later: when you submit, they come back together at the end of the queue.',
    followUp: 'Left for later: only the words skipped last time. The groups are already decided.',
    oneWord: 'One word to place: move {word} to the group it belongs in. The groups are decided; the other words show what each holds.',
    unsure: 'the drafting model was unsure here',
    sure: 'ticked from the start: two drafting runs put it here, both sure. Untick it if it is wrong.',
    nSure: '{n} words start ticked: two drafting runs agreed on them, both sure. Glance over them; untick any that is wrong.',
    words: '{n} words',
    common: 'common',
    uncommon: 'uncommon',
    commonTitle: 'JMdict marks it as common',
    uncommonTitle: 'JMdict does not mark it as common',
    news: 'top {n}',
    newsTitle: 'Newspaper frequency: among the {n} most frequent words (JMdict nf{b} of 48)',
    jlpt: 'On the JLPT N{n} vocabulary list',
    collapse: 'collapse',
    expand: 'expand',
    dictKodansha: 'Kodansha puts it under {sense}',
    dictKangorin: '新漢語林 gives it as an example of {sense}',
    dictTsalta: 'In Цалта’s kanji book: {gloss}',
    dictElsewhere: 'Most of this sense’s other words are in another group. It does not start ticked.',
  },
  {
    groups: 'Групи значения',
    groupsHint: 'От 1 до 6, според това какво прави канджито в думите. Плъзгайте думите между групите или щракнете с десния бутон върху дума (или върху няколко избрани), за да им изберете група.',
    tickHint: 'Отмятайте всяка дума, щом я проверите: картата може да се приеме, когато всички думи в групите са отметнати.',
    allConfirmed: 'всички думи са потвърдени',
    en: 'Английски етикет',
    note: 'Бележка',
    remove: 'махнете групата',
    addGroup: 'добавете група',
    catchAll: 'Канджито не внася значение в думата',
    catchAllHint: 'за изписвания само по звук (атеджи: 合羽 カッパ, 珈琲), изписвания на цяла дума, които отделните канджи не обясняват (生姜, 百合, 生憎), и игра на знаци (米寿: 米 като 八十八)',
    none: 'Извън групите',
    noneHint: 'чести или класирани думи, които никоя група не взима; редките думи не се разпределят тук',
    clearPick: 'изчистете избора',
    picked: 'избрани: {n}',
    empty: 'няма думи',
    confirmWord: 'Потвърдете: думата е на мястото си',
    confirmed: 'потвърдени',
    nConfirmed: 'потвърдени: {n}',
    moveTo: 'Преместете в',
    moveMany: 'Преместете {n} избрани в',
    unnamed: '(група без име)',
    confirmOne: 'Потвърдете: на мястото си е',
    confirmMany: 'Потвърдете {n} избрани',
    unconfirmOne: 'Отменете потвърждението',
    unconfirmMany: 'Отменете {n} потвърждения',
    skip: 'Не съм сигурен: оставете за по-късно',
    skipMany: 'Не съм сигурен: оставете {n} за по-късно',
    unskip: 'Все пак решете сега',
    skippedTag: 'не съм сигурен',
    skippedTitle: 'Оставена за по-късно: при изпращане се връща в края на опашката',
    skippedNote: 'Оставени за по-късно думи: {n}. При изпращане се връщат заедно в края на опашката.',
    followUp: 'Оставени за по-късно: само пропуснатите миналия път думи. Групите вече са решени.',
    oneWord: 'Една дума за подреждане: преместете {word} в групата, към която принадлежи. Групите са решени; другите думи показват какво съдържа всяка.',
    unsure: 'моделът не беше сигурен тук',
    sure: 'отметната от начало: две чернови я сложиха тук, и двете сигурни. Махнете отметката, ако е грешно.',
    nSure: '{n} думи започват отметнати: две чернови са съгласни за тях, и двете сигурни. Прегледайте ги; махнете отметката на грешните.',
    words: '{n} думи',
    common: 'чести',
    uncommon: 'редки',
    commonTitle: 'JMdict я отбелязва като честа',
    uncommonTitle: 'JMdict не я отбелязва като честа',
    news: 'топ {n}',
    newsTitle: 'Честота във вестниците: сред {n} най-чести думи (JMdict nf{b} от 48)',
    jlpt: 'В речника за JLPT N{n}',
    collapse: 'свийте',
    expand: 'разгънете',
    dictKodansha: 'Kodansha я слага под {sense}',
    dictKangorin: '新漢語林 я дава като пример за {sense}',
    dictTsalta: 'В книгата на Цалта: {gloss}',
    dictElsewhere: 'Повечето други думи от това значение са в друга група. Не започва отметната.',
  },
)

type Bucket = string | null

const isUnsure = (w: BoardWord) => w.agree === false || (typeof w.confidence === 'number' && w.confidence < 0.8)

/**
 * As the server lists them (server/review.py word_order): newspaper frequency
 * (nf 1 is the top 500), then JLPT (N5 first), then the grade of the word's
 * hardest kanji. Words with neither a newspaper rank nor a JLPT level sink.
 */
function byNews(a: BoardWord, b: BoardWord): number {
  const jlpt = (w: BoardWord) => (w.jlpt ? 6 - w.jlpt : 99)
  return (
    (a.nf ?? 99) - (b.nf ?? 99) ||
    jlpt(a) - jlpt(b) ||
    (a.grade ?? 99) - (b.grade ?? 99) ||
    a.headword.length - b.headword.length ||
    a.id - b.id
  )
}

/** Mounted once per item (keyed by it), so its state starts from what was kept for that item. */
export function MeaningsBoard({
  cacheKey,
  char,
  groups,
  onGroups,
  words,
  placements,
  onPlace,
  skipped,
  onSkip,
  followUp = false,
  onWork,
  onUnconfirmed,
  plain = false,
  only,
  dicts,
}: {
  /** The item, to keep the board's own state under in the browser until it is decided. */
  cacheKey: string
  char: string
  groups: MeaningGroup[]
  onGroups: (g: MeaningGroup[]) => void
  /** The board's words: the kanji's common or ranked words, and any already placed. */
  words: BoardWord[]
  placements: Placements
  onPlace: (ids: number[], to: Bucket) => void
  /** Words the reviewer is not sure of; on submit they come back as a follow-up. */
  skipped: Set<number>
  onSkip: (ids: number[], on: boolean) => void
  /** A follow-up of skipped words: the groups are decided, only the words are placed. */
  followUp?: boolean
  /** Told whether the board holds work of its own (confirmed words, folded boxes), for the reset button. */
  onWork?: (has: boolean) => void
  /**
   * Told how many words in the groups (and the no-meaning box) are not yet
   * confirmed: the card is accepted only once every one is. Words left for
   * later and words in no group don't count.
   */
  onUnconfirmed?: (n: number) => void
  /** On a page, not in the queue: no ticks to confirm words, nothing to leave for later. */
  plain?: boolean
  /**
   * One word to place: the groups are fixed, only this word moves, and the
   * others stay in sight for what each group holds.
   */
  only?: number
  /** Other dictionaries' entries (review/dictMatch.ts): their badges on the words; a word one places elsewhere starts unticked. */
  dicts?: KanjiDictionaries | null
}) {
  const lang = useLang()
  const t = S(lang)
  const [kept] = useState(() => readDraft(cacheKey)?.board)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [over, setOver] = useState<string | undefined>()
  // Collapsed boxes, by bucket id.
  const [shut, setShut] = useState<Set<string>>(new Set(kept?.shut))
  // Confirmation, a reviewer's checklist while working: the words checked.
  // Confirmed words move into a "confirmed" part of their box, open unless folded.
  // A word both drafting runs put where it is, both sure, starts ticked: the
  // reviewer looks at the rest, and unticks a ticked one that is wrong.
  const [preTicked] = useState(() => {
    if (plain || only !== undefined) return new Set<number>()
    const off = dicts ? elsewhere(dicts, words, placements, groups) : new Map<number, string[]>()
    return new Set(
      words.filter((w) => w.sure && w.group !== null && (w.id in placements ? placements[w.id] : w.group) === w.group && !off.has(w.id)).map((w) => w.id),
    )
  })
  // Where the dictionaries put each word, against where it is now.
  const away = useMemo(() => (dicts ? elsewhere(dicts, words, placements, groups) : new Map<number, string[]>()), [dicts, words, placements, groups])
  const [okWords, setOkWords] = useState<Set<number>>(() => (kept ? new Set(kept.okWords) : new Set(preTicked)))
  const [shutOk, setShutOk] = useState<Set<string>>(new Set(kept?.shutOk))
  // The right-click menu: where it opens and which words it moves.
  const [menu, setMenu] = useState<{ x: number; y: number; ids: number[]; from: Bucket } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return
      setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    menuRef.current?.querySelector('button')?.focus()
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  // Escape closes the menu, not the review screen behind it.
  useKey(
    (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMenu(null)
    },
    { on: !!menu, capture: true },
  )

  useEffect(() => {
    const asStarted = okWords.size === preTicked.size && [...okWords].every((id) => preTicked.has(id))
    const empty = asStarted && !shutOk.size && !shut.size
    writeDraft(cacheKey, {
      board: empty ? undefined : { okWords: [...okWords], shutOk: [...shutOk], shut: [...shut] },
    })
    onWork?.(!empty)
  }, [cacheKey, okWords, shutOk, shut, onWork, preTicked])

  // Words by bucket, each sorted by newspaper rank, JLPT, then grade.
  const byBucket = useMemo(() => {
    const m = new Map<Bucket, BoardWord[]>()
    for (const w of words) {
      const b = w.id in placements ? placements[w.id] : w.group
      const key = b && (b === CATCH_ALL || groups.some((g) => g.id === b)) ? b : null
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(w)
    }
    for (const list of m.values()) list.sort(byNews)
    return m
  }, [words, placements, groups])

  // What still needs a tick before the card can be accepted. Only in the queue, and not for one word.
  const checks = !plain && only === undefined
  const unconfirmed = useMemo(() => {
    if (!checks) return 0
    let n = 0
    for (const [key, list] of byBucket) {
      if (key === null) continue
      for (const w of list) if (!okWords.has(w.id) && !skipped.has(w.id)) n++
    }
    return n
  }, [checks, byBucket, okWords, skipped])
  useEffect(() => onUnconfirmed?.(unconfirmed), [unconfirmed, onUnconfirmed])

  // A word that moves is no longer confirmed: it was confirmed where it was.
  const unconfirm = (ids: number[]) => setOkWords((s) => (ids.some((id) => s.has(id)) ? withIds(s, ids, false) : s))
  const setConfirmed = (ids: number[], on: boolean) => setOkWords((s) => withIds(s, ids, on))

  function move(to: Bucket, ids?: number[]) {
    const list = ids ?? [...picked]
    if (!list.length) return
    onPlace(list, to)
    unconfirm(list)
    if (list.some((id) => skipped.has(id))) onSkip(list, false)
    setPicked(new Set())
  }

  const setGroup = (i: number, patch: Partial<MeaningGroup>) => onGroups(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)))
  function removeGroup(i: number) {
    const id = groups[i].id
    const inIt = (byBucket.get(id) ?? []).map((w) => w.id)
    if (inIt.length) onPlace(inIt, null)
    unconfirm(inIt)
    onGroups(groups.filter((_, j) => j !== i))
  }
  function addGroup() {
    let n = 1
    while (groups.some((g) => g.id === `${char}.new${n}`)) n++
    onGroups([...groups, { id: `${char}.new${n}`, en: '', bg: null, note: null }])
  }

  const gloss = (w: BoardWord) => (lang === 'bg' && w.glossBg) || w.gloss

  function card(w: BoardWord, from: Bucket) {
    // With one word to place, the others are only there to be seen.
    if (only !== undefined && w.id !== only) return contextCard(w)
    const unsure = isUnsure(w)
    const isSkipped = skipped.has(w.id)
    const ok = okWords.has(w.id)
    return (
      <li
        key={w.id}
        className="board-word"
        data-picked={picked.has(w.id) || undefined}
        data-unsure={unsure || undefined}
        data-ok={ok || undefined}
        data-skipped={isSkipped || undefined}
        data-focus={w.id === only || undefined}
        draggable
        onDragStart={(e) => {
          const ids = picked.has(w.id) ? [...picked] : [w.id]
          e.dataTransfer.setData('text/plain', ids.join(','))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => setPicked((p) => toggled(p, w.id))}
        onContextMenu={(e) => {
          e.preventDefault()
          const ids = picked.has(w.id) ? [...picked] : [w.id]
          setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 280), ids, from })
        }}
        data-sure={(ok && preTicked.has(w.id)) || undefined}
        data-elsewhere={away.has(w.id) || undefined}
        title={unsure ? t('unsure') : ok && preTicked.has(w.id) ? t('sure') : undefined}
      >
        <span className="board-head" lang="ja">
          {!plain && (
            <label className="board-check" title={t('confirmWord')} data-off={isSkipped || undefined} onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={ok}
                disabled={isSkipped}
                aria-label={t('confirmWord')}
                onChange={() => setOkWords((s) => toggled(s, w.id))}
              />
            </label>
          )}
          {w.headword}
        </span>
        <span className="board-reading" lang="ja">
          {w.reading}
        </span>
        <span className="board-marks">
          {w.nf && (
            <span className="word-news" title={t('newsTitle', { n: (w.nf * 500).toLocaleString(lang), b: w.nf })}>
              {t('news', { n: newsRank(w.nf) })}
            </span>
          )}
          {w.jlpt && (
            <span className="word-jlpt" data-level={w.jlpt} title={t('jlpt', { n: w.jlpt })}>
              N{w.jlpt}
            </span>
          )}
          {isSkipped && (
            <span className="board-skipped" title={t('skippedTitle')}>
              {t('skippedTag')}
            </span>
          )}
          <span className="word-common" data-common={w.common || undefined} title={t(w.common ? 'commonTitle' : 'uncommonTitle')}>
            {t(w.common ? 'common' : 'uncommon')}
          </span>
        </span>
        <span className="board-gloss">{gloss(w)}</span>
        {dicts && dictBadges(w)}
      </li>
    )
  }

  // Where each dictionary puts the word: Kodansha's sense, 新漢語林's, Цалта's gloss.
  function dictBadges(w: BoardWord) {
    const tags = dicts?.words[String(w.id)]
    if (!tags?.length) return null
    const off = away.get(w.id) ?? []
    return (
      <span className="board-dicts">
        {tags.map((tag) => {
          const wrong = off.includes(`${tag.src}|${tag.key}`)
          const what =
            tag.src === 'kodansha'
              ? t('dictKodansha', { sense: tag.label })
              : tag.src === 'kangorin'
                ? t('dictKangorin', { sense: tag.label })
                : t('dictTsalta', { gloss: tag.label })
          return (
            <span key={`${tag.src}|${tag.key}`} className="board-dict" data-src={tag.src} data-off={wrong || undefined} title={wrong ? `${what}. ${t('dictElsewhere')}` : what}>
              {tag.src === 'kodansha' ? `K ${tag.label}` : tag.src === 'kangorin' ? `漢 ${tag.label}` : 'Ц'}
            </span>
          )
        })}
      </span>
    )
  }

  function contextCard(w: BoardWord) {
    return (
      <li key={w.id} className="board-word" data-context>
        <span className="board-head" lang="ja">
          {w.headword}
        </span>
        <span className="board-reading" lang="ja">
          {w.reading}
        </span>
        <span className="board-gloss">{gloss(w)}</span>
      </li>
    )
  }

  // The menu's confirming and leaving for later, in the queue only. Each item
  // closes the menu and, but for "decide it now", clears the selection.
  function menuChecks(ids: number[]) {
    const then = (run: () => void, unpick = true) => () => {
      run()
      if (unpick) setPicked(new Set())
      setMenu(null)
    }
    // A word left for later is not confirmed.
    const ok = ids.filter((id) => !okWords.has(id) && !skipped.has(id))
    return (
      <>
        <hr />
        {ids.every((id) => okWords.has(id)) ? (
          <button role="menuitem" onClick={then(() => setConfirmed(ids, false))}>
            {ids.length > 1 ? t('unconfirmMany', { n: ids.length }) : t('unconfirmOne')}
          </button>
        ) : (
          <button role="menuitem" className="board-menu-ok" disabled={!ok.length} onClick={then(() => setConfirmed(ok, true))}>
            {ids.length === 1 ? t('confirmOne') : t('confirmMany', { n: ok.length })}
          </button>
        )}
        {ids.every((id) => skipped.has(id)) ? (
          <button role="menuitem" onClick={then(() => onSkip(ids, false), false)}>
            {t('unskip')}
          </button>
        ) : (
          <button
            role="menuitem"
            className="board-menu-skip"
            onClick={then(() => {
              onSkip(ids, true)
              unconfirm(ids)
            })}
          >
            {ids.length > 1 ? t('skipMany', { n: ids.length }) : t('skip')}
          </button>
        )}
      </>
    )
  }

  // The word to place, in sight when the board opens.
  const boardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (only !== undefined) boardRef.current?.querySelector('[data-focus]')?.scrollIntoView({ block: 'nearest' })
  }, [only])
  const onlyWord = only !== undefined ? words.find((w) => w.id === only) : undefined

  function bucket(key: Bucket, head: React.ReactNode, extra?: React.ReactNode) {
    const all = byBucket.get(key) ?? []
    const id = key ?? '∅'
    const done = all.filter((w) => okWords.has(w.id))
    const list = all.filter((w) => !okWords.has(w.id))
    // A group or the no-meaning box with every word ticked (words left for later aside).
    const complete = checks && key !== null && all.length > 0 && list.every((w) => skipped.has(w.id))
    return (
      <section
        key={id}
        className="board-group"
        data-kind={key === null ? 'none' : key === CATCH_ALL ? 'catch-all' : 'group'}
        data-over={over === id || undefined}
        data-complete={complete || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (over !== id) setOver(id)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setOver(undefined)
          const ids = e.dataTransfer
            .getData('text/plain')
            .split(',')
            .map(Number)
            .filter((n) => Number.isFinite(n) && n > 0)
          move(key, ids)
        }}
      >
        <header className="board-group-head">
          <button className="board-caret" onClick={() => setShut((s) => toggled(s, id))} aria-expanded={!shut.has(id)} title={t(shut.has(id) ? 'expand' : 'collapse')}>
            {shut.has(id) ? '▸' : '▾'}
          </button>
          {head}
          <span className="hint board-count">
            {t('words', { n: all.length.toLocaleString(lang) })}
            {complete ? ` · ✓ ${t('allConfirmed')}` : done.length > 0 && ` · ${t('nConfirmed', { n: done.length })}`}
          </span>
        </header>
        {!shut.has(id) && (
          <>
            {all.length === 0 && <p className="hint board-empty">{t('empty')}</p>}
            {done.length > 0 && (
              <div className="board-part board-done">
                <button className="board-done-toggle" onClick={() => setShutOk((s) => toggled(s, id))} aria-expanded={!shutOk.has(id)}>
                  {shutOk.has(id) ? '▸' : '▾'} {t('confirmed')} <span className="hint">{done.length}</span>
                </button>
                {!shutOk.has(id) && <ul className="board-words">{done.map((w) => card(w, key))}</ul>}
              </div>
            )}
            {[true, false].map((common) => {
              const part = list.filter((w) => w.common === common)
              if (!part.length) return null
              return (
                <div key={String(common)} className="board-part">
                  <h5>
                    {t(common ? 'common' : 'uncommon')} <span className="hint">{part.length}</span>
                  </h5>
                  <ul className="board-words">{part.map((w) => card(w, key))}</ul>
                </div>
              )
            })}
          </>
        )}
        {!shut.has(id) && extra}
      </section>
    )
  }

  return (
    <div className="board" ref={boardRef} data-only={only !== undefined || undefined}>
      <div className="board-top">
        <h4>{t('groups')}</h4>
        <span className="hint">
          {t('groupsHint')}
          {checks && ` ${t('tickHint')}`}
        </span>
        {/* Always laid out, only hidden, so picking a word never moves the page. */}
        <span className="board-picked" data-none={picked.size === 0 || undefined} aria-hidden={picked.size === 0 || undefined}>
          {t('picked', { n: Math.max(picked.size, 1) })}{' '}
          <button className="clear" onClick={() => setPicked(new Set())} tabIndex={picked.size === 0 ? -1 : undefined}>
            {t('clearPick')}
          </button>
        </span>
      </div>
      {followUp && <p className="board-followup">{t('followUp')}</p>}
      {onlyWord && <p className="board-followup">{t('oneWord', { word: onlyWord.headword })}</p>}
      {skipped.size > 0 && <p className="board-skipnote">{t('skippedNote', { n: skipped.size })}</p>}
      {preTicked.size > 0 && <p className="hint board-surenote">{t('nSure', { n: preTicked.size })}</p>}
      {groups.map((g, i) =>
        bucket(
          g.id,
          followUp || only !== undefined ? (
            <div className="board-fixed">
              <b>{g.en}</b>
            </div>
          ) : (
          <div className="board-labels">
            <span className="board-num">{i + 1}</span>
            <input className="assoc-text board-en" value={g.en} placeholder={t('en')} aria-label={t('en')} maxLength={40} onChange={(e) => setGroup(i, { en: e.target.value })} />
            <input className="assoc-text board-note" value={g.note ?? ''} placeholder={t('note')} aria-label={t('note')} maxLength={200} onChange={(e) => setGroup(i, { note: e.target.value || null })} />
            <button className="clear" onClick={() => removeGroup(i)}>
              {t('remove')}
            </button>
          </div>
          ),
        ),
      )}
      {!followUp && only === undefined && groups.length < 6 && (
        <button className="clear board-add" onClick={addGroup}>
          + {t('addGroup')}
        </button>
      )}
      {bucket(
        CATCH_ALL,
        <div className="board-fixed">
          <b>{t('catchAll')}</b> <span className="hint">{t('catchAllHint')}</span>
        </div>,
      )}
      {bucket(
        null,
        <div className="board-fixed">
          <b>{t('none')}</b> <span className="hint">{t('noneHint')}</span>
        </div>,
      )}
      {menu && (
        <div ref={menuRef} className="board-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <p className="board-menu-title">{menu.ids.length > 1 ? t('moveMany', { n: menu.ids.length }) : t('moveTo')}</p>
          {[
            ...groups.map((g) => [g.id, g.en.trim() || t('unnamed')] as [Bucket, string]),
            [CATCH_ALL, t('catchAll')] as [Bucket, string],
            [null, t('none')] as [Bucket, string],
          ].map(([to, label]) => (
            <button
              key={to ?? '∅'}
              role="menuitem"
              data-here={to === menu.from || undefined}
              disabled={menu.ids.length === 1 && to === menu.from}
              onClick={() => {
                move(to, menu.ids)
                setMenu(null)
              }}
            >
              {label}
            </button>
          ))}
          {!plain && menuChecks(menu.ids)}
        </div>
      )}
    </div>
  )
}
