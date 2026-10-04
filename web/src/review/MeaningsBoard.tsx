/**
 * A kanji's meaning groups with its words under them, to review both at once.
 *
 * Each group is a box: its labels (English, Bulgarian, a note) and the words
 * it holds, with readings and glosses. Words move by drag and drop, or, on a
 * phone, by tapping them and then "move here" on a group. The catch-all
 * (sound / fixed spelling) is always there; "not in a group" holds the words
 * no group claims, the common ones first and the rarer ones a page at a time.
 *
 * The board only edits; the queue decides. `finalizeBoard` turns it into what
 * the server takes: the groups with their final ids, and word id -> group id.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type BoardWord, type MeaningGroup } from '../api'
import { strings, useLang } from '../i18n'
import { CATCH_ALL } from './editors'

const S = strings(
  {
    groups: 'Meaning groups',
    groupsHint: '2 to 6, by what the kanji does in words. Drag words between groups, or tap words and then “move here”.',
    en: 'English label',
    bg: 'Bulgarian',
    note: 'Note',
    remove: 'remove group',
    addGroup: 'add a group',
    catchAll: 'Sound / fixed spelling',
    catchAllHint: 'ateji and fixed spellings: the kanji brings no meaning',
    none: 'Not in a group',
    noneHint: 'words no group claims; they are left out of the grouped list',
    moveHere: 'move {n} here',
    clearPick: 'clear selection',
    picked: '{n} selected',
    empty: 'no words',
    moreRare: 'show {n} more rare words ({left} not shown)',
    unsure: 'the drafting model was unsure here',
    words: '{n} words',
  },
  {
    groups: 'Групи значения',
    groupsHint: 'От 2 до 6, според това какво прави кандзито в думите. Плъзгайте думите между групите или ги докоснете и после „преместете тук“.',
    en: 'Английски етикет',
    bg: 'Български',
    note: 'Бележка',
    remove: 'махнете групата',
    addGroup: 'добавете група',
    catchAll: 'Звук / устойчиво изписване',
    catchAllHint: 'атеджи и устойчиви изписвания: кандзито не носи значение',
    none: 'Извън групите',
    noneHint: 'думи, които никоя група не взима; не се показват в групирания списък',
    moveHere: 'преместете {n} тук',
    clearPick: 'изчистете избора',
    picked: 'избрани: {n}',
    empty: 'няма думи',
    moreRare: 'покажете още {n} редки думи (непоказани: {left})',
    unsure: 'моделът не беше сигурен тук',
    words: '{n} думи',
  },
)

const RARE_PAGE = 100
type Bucket = string | null

/** Groups with their final ids (new ones named from their English label) and every placement under them. */
export function finalizeBoard(char: string, groups: MeaningGroup[], placements: Record<number, Bucket>) {
  const taken = new Set(groups.filter((g) => !isNew(g.id)).map((g) => g.id))
  const rename: Record<string, string> = {}
  const out = groups.map((g, i) => {
    if (!isNew(g.id)) return g
    const base = g.en.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || `g${i + 1}`
    let id = `${char}.${base}`
    for (let n = 2; taken.has(id); n++) id = `${char}.${base}-${n}`
    taken.add(id)
    rename[g.id] = id
    return { ...g, id }
  })
  // A word left in a group that is gone is in no group.
  const ids = new Set([...out.map((g) => g.id), CATCH_ALL])
  const words: Record<number, Bucket> = {}
  for (const [id, b] of Object.entries(placements)) {
    const to = b && rename[b] ? rename[b] : b
    words[Number(id)] = to && ids.has(to) ? to : null
  }
  return { groups: out, words }
}

const isNew = (id: string) => /\.new\d+$/.test(id)

export function MeaningsBoard({
  char,
  groups,
  onGroups,
  words,
  placements,
  onPlace,
  restTotal,
}: {
  char: string
  groups: MeaningGroup[]
  onGroups: (g: MeaningGroup[]) => void
  /** The board's own words: the kanji's common words and any already placed. */
  words: BoardWord[]
  placements: Record<number, Bucket>
  onPlace: (ids: number[], to: Bucket) => void
  restTotal: number
}) {
  const lang = useLang()
  const t = S(lang)
  const [rare, setRare] = useState<BoardWord[]>([])
  const [rareLeft, setRareLeft] = useState(restTotal)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [over, setOver] = useState<string | undefined>()

  useEffect(() => {
    setRare([])
    setRareLeft(restTotal)
    setPicked(new Set())
  }, [char, restTotal])

  function moreRare() {
    api.restWords(char, rare.length, RARE_PAGE).then(
      (d) => {
        setRare((r) => [...r, ...d.words.filter((w) => !r.some((x) => x.id === w.id))])
        setRareLeft(Math.max(0, d.total - d.offset - d.words.length))
      },
      () => {},
    )
  }

  // Words by bucket, in the order they came: the board's, then the rare ones as loaded.
  const byBucket = useMemo(() => {
    const m = new Map<Bucket, BoardWord[]>()
    for (const w of [...words, ...rare]) {
      const b = w.id in placements ? placements[w.id] : w.group
      const key = b && (b === CATCH_ALL || groups.some((g) => g.id === b)) ? b : null
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(w)
    }
    return m
  }, [words, rare, placements, groups])

  function move(to: Bucket, ids?: number[]) {
    const list = ids ?? [...picked]
    if (!list.length) return
    onPlace(list, to)
    setPicked(new Set())
  }

  function toggle(id: number) {
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const setGroup = (i: number, patch: Partial<MeaningGroup>) => onGroups(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)))
  function removeGroup(i: number) {
    const id = groups[i].id
    const inIt = (byBucket.get(id) ?? []).map((w) => w.id)
    if (inIt.length) onPlace(inIt, null)
    onGroups(groups.filter((_, j) => j !== i))
  }
  function addGroup() {
    let n = 1
    while (groups.some((g) => g.id === `${char}.new${n}`)) n++
    onGroups([...groups, { id: `${char}.new${n}`, en: '', bg: null, note: null }])
  }

  const gloss = (w: BoardWord) => (lang === 'bg' && w.glossBg) || w.gloss

  function bucket(key: Bucket, head: React.ReactNode, extra?: React.ReactNode) {
    const list = byBucket.get(key) ?? []
    const id = key ?? '∅'
    return (
      <section
        key={id}
        className="board-group"
        data-kind={key === null ? 'none' : key === CATCH_ALL ? 'catch-all' : 'group'}
        data-over={over === id || undefined}
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
          {head}
          <span className="hint board-count">{t('words', { n: list.length })}</span>
          {picked.size > 0 && (
            <button className="clear board-move" onClick={() => move(key)}>
              {t('moveHere', { n: picked.size })}
            </button>
          )}
        </header>
        <ul className="board-words">
          {list.length === 0 && <li className="hint board-empty">{t('empty')}</li>}
          {list.map((w) => {
            const unsure = w.agree === false || (typeof w.confidence === 'number' && w.confidence < 0.8)
            return (
              <li
                key={w.id}
                className="board-word"
                data-picked={picked.has(w.id) || undefined}
                data-unsure={unsure || undefined}
                data-common={w.common || undefined}
                draggable
                onDragStart={(e) => {
                  const ids = picked.has(w.id) ? [...picked] : [w.id]
                  e.dataTransfer.setData('text/plain', ids.join(','))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => toggle(w.id)}
                title={unsure ? t('unsure') : undefined}
              >
                <span className="board-head" lang="ja">
                  {w.headword}
                </span>
                <span className="board-reading" lang="ja">
                  {w.reading}
                </span>
                <span className="board-gloss">{gloss(w)}</span>
              </li>
            )
          })}
        </ul>
        {extra}
      </section>
    )
  }

  return (
    <div className="board">
      <div className="board-top">
        <h4>{t('groups')}</h4>
        <span className="hint">{t('groupsHint')}</span>
        {picked.size > 0 && (
          <span className="board-picked">
            {t('picked', { n: picked.size })}{' '}
            <button className="clear" onClick={() => setPicked(new Set())}>
              {t('clearPick')}
            </button>
          </span>
        )}
      </div>
      {groups.map((g, i) =>
        bucket(
          g.id,
          <div className="board-labels">
            <input className="assoc-text board-en" value={g.en} placeholder={t('en')} aria-label={t('en')} maxLength={40} onChange={(e) => setGroup(i, { en: e.target.value })} />
            <input className="assoc-text" value={g.bg ?? ''} placeholder={t('bg')} aria-label={t('bg')} maxLength={40} onChange={(e) => setGroup(i, { bg: e.target.value || null })} />
            <input className="assoc-text board-note" value={g.note ?? ''} placeholder={t('note')} aria-label={t('note')} maxLength={200} onChange={(e) => setGroup(i, { note: e.target.value || null })} />
            <button className="clear" onClick={() => removeGroup(i)}>
              {t('remove')}
            </button>
          </div>,
        ),
      )}
      {groups.length < 6 && (
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
        rareLeft > 0 && (
          <button className="clear board-more" onClick={moreRare}>
            {t('moreRare', { n: Math.min(RARE_PAGE, rareLeft), left: rareLeft })}
          </button>
        ),
      )}
    </div>
  )
}
