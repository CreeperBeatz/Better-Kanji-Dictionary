/**
 * The review queue: open items, worst first, one at a time, with what the
 * reviewer needs to judge each -- the glyphs, what would change upstream,
 * the old form, the word and its glosses.
 *
 * Keyboard: a or Enter accepts (or saves the edit), r rejects, s skips,
 * j / k move, and for a word's meaning 1-9 picks a group and decides at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DictLinks } from './DictLinks'
import {
  api,
  dataChanged,
  type ItemDetail,
  type MeaningGroup,
  type Origin,
  type QueueItem,
  type TaskType,
  type TaskValue,
} from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { typing, useKey } from '../keys'
import { withIds } from '../sets'
import { CATCH_ALL, strokesOk, ValueEditor, ValueView } from './editors'
import { finalizeBoard, NO_WORDS, placed, same, startPlacements, type Placements } from './board'
import { MeaningsBoard } from './MeaningsBoard'
import { BgCard } from './BgCard'
import { CharacterCard } from './CharacterCard'
import { clearDraft, readDraft, writeDraft } from './drafts'
import { Evidence } from './Evidence'
import { ReportButton } from './ReportButton'
import { queueRouteInUrl, replaceQueueRoute } from './route'

const S = strings(
  {
    all: 'all',
    any: 'any',
    originLabel: 'Where the items came from',
    t_character: 'characters',
    t_decomposition: 'parts',
    t_form_link: 'forms',
    t_part_meaning: 'part meanings',
    t_kanji_senses: 'meanings',
    t_word_sense: 'one word',
    t_bg: 'Bulgarian translations',
    t_report: 'reports',
    reported: 'What is wrong, says the report',
    confirmReport: 'confirm: a real mistake',
    skippedTab: 'skipped',
    skippedTitle: 'The items you skipped, to do now',
    showSkipped: '{n} skipped: show them',
    nothingSkipped: 'Nothing skipped here.',
    backToQueue: 'back to the queue',
    o_proposal: 'proposals',
    o_suggestion: 'suggestions',
    proposalFrom: 'proposal · {source}',
    followUp: 'left for later',
    suggestionBy: 'suggestion by {who}',
    nothing: 'Nothing waiting here.',
    loading: 'loading',
    now: 'Now',
    proposed: 'Proposed',
    yourValue: 'Your answer',
    reason: 'Reason (optional)',
    accept: 'accept',
    saveEdit: 'save my answer',
    keep: 'looks right, keep it',
    noProposal: 'nothing proposed: check it, and edit if it is wrong',
    reject: 'reject',
    reset: 'reset card',
    resetTitle: 'Throw away what you changed on this card and start again from the proposal',
    confirmReset: 'Throw away what you changed on this card?',
    skip: 'skip',
    keys: 'a accept · r reject · s skip · j/k next/previous',
    keysNoReject: 'a accept · s skip · j/k next/previous',
    keysWord: '1–9 pick and decide · r reject · s skip · j/k next/previous',
    left: '{n} waiting',
    confidence: 'model confidence {n}',
    confirmFirst: 'Confirm every word in the groups first: {n} left',
  },
  {
    all: 'всички',
    any: 'всякакви',
    originLabel: 'Откъде са дошли',
    t_character: 'знаци',
    t_decomposition: 'части',
    t_form_link: 'форми',
    t_part_meaning: 'значения на части',
    t_kanji_senses: 'значения',
    t_word_sense: 'една дума',
    t_bg: 'преводи на български',
    t_report: 'доклади',
    reported: 'Какво не е наред според доклада',
    confirmReport: 'потвърдете: истинска грешка',
    skippedTab: 'пропуснати',
    skippedTitle: 'Пропуснатите задачи, за да ги свършите сега',
    showSkipped: 'пропуснати: {n}. Покажете ги',
    nothingSkipped: 'Тук нищо не е пропуснато.',
    backToQueue: 'обратно към опашката',
    o_proposal: 'предложения от данни',
    o_suggestion: 'предложения от хора',
    proposalFrom: 'от данни · {source}',
    followUp: 'оставени за по-късно',
    suggestionBy: 'предложено от {who}',
    nothing: 'Тук нищо не чака.',
    loading: 'зареждане',
    now: 'Сега',
    proposed: 'Предложено',
    yourValue: 'Вашият отговор',
    reason: 'Причина (по желание)',
    accept: 'приемете',
    saveEdit: 'запазете моя отговор',
    keep: 'вярно е, оставете го',
    noProposal: 'нищо не е предложено: проверете и поправете, ако е грешно',
    reject: 'отхвърлете',
    reset: 'нулирайте картата',
    resetTitle: 'Изхвърлете промените по тази карта и започнете отначало от предложението',
    confirmReset: 'Да се изхвърлят ли промените по тази карта?',
    skip: 'пропуснете',
    keys: 'a приемане · r отхвърляне · s пропускане · j/k следващо/предишно',
    keysNoReject: 'a приемане · s пропускане · j/k следващо/предишно',
    keysWord: '1–9 избор и решение · r отхвърляне · s пропускане · j/k следващо/предишно',
    left: '{n} чакат',
    confidence: 'увереност на модела {n}',
    confirmFirst: 'Първо потвърдете всяка дума в групите: остават {n}',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
// A character's parts, forms and part meaning are one card (CharacterCard.tsx); a single
// word's meaning is under meanings, with its kanji's card.
const TYPES: TaskType[] = ['character', 'kanji_senses', 'word_sense', 'bg', 'report']
const STAGES = TYPES.filter((k) => k !== 'word_sense')
const ORIGINS: Origin[] = ['proposal', 'suggestion']
const LIVE_ON_PAGE: TaskType[] = ['bg']

/** What a card is about, for "Something else is wrong?": its word, or its kanji. */
function reportSubject(i: QueueItem): string | null {
  if (i.type === 'report') return null
  if (i.type === 'bg') return i.subject
  if (i.type === 'word_sense') return `word:${i.subject.split('|')[1]}`
  return `kanji:${i.subject.split('|')[0]}`
}

/** A single word's item: the word's id, from its subject 生|1234567. */
const wordOf = (i: QueueItem) => Number(i.subject.split('|')[1])

/**
 * Reject is for what can be wrong as a whole: a report, or anything a person
 * suggested. Meanings and Bulgarian are shaped until right, then accepted, or
 * skipped; a character's card says in words what each answer does.
 */
const canReject = (i: QueueItem) => i.type === 'report' || i.origin === 'suggestion'

/** `onDecided` is told after each decision, so the progress can count again. */
export function Queue({ onKanji, onDecided }: { onKanji?: (char: string) => void; onDecided?: () => void }) {
  const lang = useLang()
  const t = S(lang)
  // The address names the stage, the origin filter and the item (review/route.ts).
  const [route] = useState(queueRouteInUrl)
  const wanted = useRef(route.item)
  const [type, setType] = useState<TaskType | undefined>(route.type)
  const [origin, setOrigin] = useState<Origin | undefined>(route.origin)
  // The items you skipped, instead of the queue; and what waits, per type, for greying out empty stages.
  const [showSkipped, setShowSkipped] = useState(!!route.skipped)
  const [types, setTypes] = useState<Record<string, number>>({})
  const [skippedN, setSkippedN] = useState(0)
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [at, setAt] = useState(0)
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [draft, setDraft] = useState<TaskValue>(null)
  const [reason, setReason] = useState('')
  // A kanji's meanings: where each word on the board is, and where it started.
  const [placements, setPlacements] = useState<Placements>({})
  const [placedFrom, setPlacedFrom] = useState<Placements>({})
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  // The board's own work (confirmed words, folded boxes), and a key to start it afresh.
  const [boardWork, setBoardWork] = useState(false)
  // Words in the groups not yet confirmed: a meanings card is accepted only once there are none.
  const [unconfirmed, setUnconfirmed] = useState(0)
  const [fresh, setFresh] = useState(0)
  // A kanji's Bulgarian card: its groups' Bulgarian labels, and what they were.
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [labelsFrom, setLabelsFrom] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [notesFrom, setNotesFrom] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    setItems(null)
    api.reviewQueueItems(type, origin, showSkipped).then(
      async (d) => {
        // The item the address names, when it is still open: found in the list,
        // or fetched and put first when it sits further down the queue.
        const id = wanted.current
        wanted.current = undefined
        let list = d.items
        let n = id ? list.findIndex((i) => i.id === id) : -1
        if (id && n < 0) {
          // A character's card has no item of its own: its address names the character.
          const one: QueueItem | null = id.startsWith('char:')
            ? { id, type: 'character', subject: id.slice(5), status: 'open', origin: 'proposal', source: '' } as QueueItem
            : await api.reviewItem(id).catch(() => null)
          if (one && one.status === 'open' && (!type || one.type === type) && (!origin || one.origin === origin)) {
            list = [one, ...list]
            n = 0
          }
        }
        setItems(list)
        setTotal(Math.max(d.total, list.length))
        setTypes(d.types)
        setSkippedN(d.skipped)
        setAt(Math.max(0, n))
      },
      (e) => setProblem(errorText(e, lang)),
    )
  }, [type, origin, showSkipped, lang])
  useEffect(load, [load])

  const item = items?.[at] ?? null
  // Reset the draft while rendering, not in an effect: for one render the
  // editor would get the last item's value, and a list of parts handed to the
  // meaning-group editor throws.
  const [draftFor, setDraftFor] = useState<string | null>(null)
  if (item && item.id !== draftFor) {
    // Work left on this item before a reload comes back (review/drafts.ts).
    const kept = readDraft(item.id)
    setDraftFor(item.id)
    setDraft(kept && 'draft' in kept ? (kept.draft ?? null) : (item.proposed ?? item.current))
    setReason(kept?.reason ?? '')
    setSkipped(new Set(kept?.skipped))
  }
  useEffect(() => {
    if (items !== null) replaceQueueRoute({ type, origin, item: item?.id, skipped: showSkipped || undefined })
  }, [type, origin, item?.id, items, showSkipped])
  useEffect(() => {
    setDetail(null)
    setProblem(null)
    setPlacements({})
    setPlacedFrom({})
    setLabels({})
    setLabelsFrom({})
    setNotes({})
    setNotesFrom({})
    setBoardWork(false)
    // A character's card loads its own (CharacterCard.tsx).
    if (!item || item.type === 'character') return
    let stale = false
    api.reviewItem(item.id).then(
      (d) => {
        if (stale) return
        setDetail(d)
        const kept = readDraft(d.id)
        if (d.type === 'bg' && d.context.senses) {
          const l: Record<string, string> = {}
          const n: Record<string, string> = {}
          for (const g of d.context.senses) {
            l[g.id] = g.bg ?? ''
            n[g.id] = g.noteBg ?? ''
          }
          setLabels(kept?.labels ?? l)
          setLabelsFrom(l)
          setNotes(kept?.notes ?? n)
          setNotesFrom(n)
        }
        if (d.type === 'kanji_senses' && d.context.board) {
          const p = startPlacements(d.context.board, (d.proposed ?? d.current) as MeaningGroup[] | null)
          setPlacements(kept?.placements ?? p)
          setPlacedFrom(p)
        }
      },
      (e) => !stale && setProblem(errorText(e, lang)),
    )
    return () => {
      stale = true
    }
  }, [item?.id])

  /** The open item was decided or skipped: off the list, counts follow, on to the next. */
  const advance = useCallback(
    (skipped: boolean) => {
      if (!item) return
      if (!skipped) onDecided?.()
      setItems((list) => list && list.filter((i) => i.id !== item.id))
      setTotal((n) => n - 1)
      if (!showSkipped) setTypes((c) => ({ ...c, [item.type]: Math.max(0, (c[item.type] ?? 1) - 1) }))
      if (skipped && !showSkipped) setSkippedN((n) => n + 1)
      if (!skipped && showSkipped) setSkippedN((n) => Math.max(0, n - 1))
      setAt((i) => Math.max(0, Math.min(i, (items?.length ?? 1) - 2)))
    },
    [item, items, onDecided, showSkipped],
  )

  const decide = useCallback(
    async (action: 'accept' | 'edit' | 'reject' | 'skip', value?: TaskValue, words?: Placements, skip?: Placements) => {
      if (!item || busy) return
      setBusy(true)
      setProblem(null)
      try {
        const withLabels = item.type === 'bg' && Object.keys(labels).length ? labels : undefined
        const withNotes = item.type === 'bg' && Object.keys(notes).length ? notes : undefined
        await api.decide(item.id, action, value, reason.trim() || undefined, words, skip, withLabels, withNotes)
        if (action !== 'skip') clearDraft(item.id)
        if ((action === 'accept' || action === 'edit') && LIVE_ON_PAGE.includes(item.type)) dataChanged()
        advance(action === 'skip')
      } catch (e) {
        setProblem(errorText(e, lang))
      } finally {
        setBusy(false)
      }
    },
    [item, busy, reason, lang, labels, notes, advance],
  )

  const groups: MeaningGroup[] | null | undefined = detail?.context.senses
  // Nothing proposed (a cost-ranked check): leaving it as it is is a rejection of any change.
  const open = item?.proposed === null
  const board = item?.type === 'kanji_senses'
  const moved = board && !same(placements, placedFrom)
  const relabelled = item?.type === 'bg' && (!same(labels, labelsFrom) || !same(notes, notesFrom))
  const edited = !!item && (moved || relabelled || !same(draft, open ? item.current : item.proposed))
  // Anything to throw away: the answer, the reason, words moved or left for later, labels, board ticks.
  const changed = !!item && (edited || !!reason.trim() || skipped.size > 0 || boardWork)
  function reset() {
    if (!item || !window.confirm(t('confirmReset'))) return
    clearDraft(item.id)
    setDraft(item.proposed ?? item.current)
    setReason('')
    setPlacements(placedFrom)
    setSkipped(new Set())
    setLabels(labelsFrom)
    setNotes(notesFrom)
    setBoardWork(false)
    setFresh((n) => n + 1)
  }
  const blocked = board && unconfirmed > 0
  const decideDraft = useCallback(
    (value: TaskValue = draft) => {
      if (!item) return
      if (item.type === 'kanji_senses') {
        // The groups and every word on the board, decided together.
        if (!detail?.context.board) return
        const fin = finalizeBoard(item.subject, (value ?? []) as MeaningGroup[], placements)
        // Words left for later are not decided now; they come back with where they sat.
        const words: Placements = {}
        const skip: Placements = {}
        for (const [id, g] of Object.entries(fin.words)) (skipped.has(Number(id)) ? skip : words)[Number(id)] = g
        const later = Object.keys(skip).length ? skip : undefined
        return same(fin.groups, item.proposed) ? decide('accept', undefined, words, later) : decide('edit', fin.groups, words, later)
      }
      // Left as it was: a check is rejected (nothing to change), a proposal accepted.
      if (same(value, item.proposed === null ? item.current : item.proposed)) return decide(item.proposed === null ? 'reject' : 'accept')
      return item.type === 'decomposition' && !strokesOk(value, lang) ? undefined : decide('edit', value)
    },
    [item, draft, decide, detail, placements, lang, skipped],
  )
  // Keep the work on this item in the browser as it changes; once its detail
  // is in, so a half-loaded item never overwrites what was kept.
  useEffect(() => {
    if (!item || detail?.id !== item.id) return
    const start = item.proposed === null ? item.current : item.proposed
    writeDraft(item.id, {
      draft: same(draft, start) ? undefined : draft,
      reason: reason.trim() ? reason : undefined,
      placements: board && !same(placements, placedFrom) ? placements : undefined,
      skipped: skipped.size ? [...skipped] : undefined,
      labels: item.type === 'bg' && !same(labels, labelsFrom) ? labels : undefined,
      notes: item.type === 'bg' && !same(notes, notesFrom) ? notes : undefined,
    })
  }, [item, detail, draft, reason, placements, placedFrom, board, skipped, labels, labelsFrom, notes, notesFrom])

  const skip = useCallback((ids: number[], on: boolean) => setSkipped((s) => withIds(s, ids, on)), [])
  const isFollowUp = (i: QueueItem) => i.type === 'kanji_senses' && !!(i.evidence as { words?: unknown } | null)?.words

  const place = useCallback((ids: number[], to: string | null) => setPlacements((p) => placed(p, ids, to)), [])

  useKey((e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || !item) return
    // A character's card takes a, Enter and s itself; j and k still move.
    if (item.type === 'character' && !['j', 'k', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    if (e.key === 'a' || e.key === 'Enter') {
      if (!blocked) decideDraft()
    }
    else if (e.key === 'r' && canReject(item)) decide('reject')
    else if (e.key === 's') decide('skip')
    else if (e.key === 'j' || e.key === 'ArrowDown') setAt((i) => Math.min(i + 1, (items?.length ?? 1) - 1))
    else if (e.key === 'k' || e.key === 'ArrowUp') setAt((i) => Math.max(i - 1, 0))
    else if (item.type === 'word_sense' && /^[1-9]$/.test(e.key) && groups) {
      const ids = [...groups.map((g) => g.id), CATCH_ALL]
      const pick = ids[Number(e.key) - 1]
      if (pick) decideDraft(pick)
    } else return
    e.preventDefault()
  })

  const waitingIn = (k: TaskType) => (types[k] ?? 0) + (k === 'kanji_senses' ? (types.word_sense ?? 0) : 0)

  const subjectGlyphs = (i: QueueItem) => {
    const [a] = i.subject.split('|')
    const b = i.type === 'bg' || i.type === 'report' ? i.subject.split(':')[1] : i.subject.split('|')[1]
    if (i.type === 'form_link') return `${a} · ${b}`
    if (i.type === 'word_sense') return i.label ? `${a} · ${i.label}` : a
    if (i.type === 'bg' || i.type === 'report') return i.label ?? b ?? i.subject.split(':')[1]
    return a
  }

  return (
    <div className="queue">
      {/* What to review: any stage, or what you skipped -- then one stage. */}
      <nav className="overlay-tabs queue-filters">
        <button
          data-on={!type && !showSkipped}
          data-empty={(!showSkipped && TYPES.every((k) => types[k] === 0)) || undefined}
          onClick={() => {
            setType(undefined)
            setShowSkipped(false)
          }}
        >
          {t('any')}
        </button>
        <button
          data-on={showSkipped}
          data-empty={(!showSkipped && skippedN === 0) || undefined}
          title={t('skippedTitle')}
          onClick={() => {
            setType(undefined)
            setShowSkipped(true)
          }}
        >
          {t('skippedTab')}
        </button>
        <span className="overlay-tab-rule" />
        {STAGES.map((k) => (
          <button
            key={k}
            data-on={type === k && !showSkipped}
            data-empty={(!showSkipped && waitingIn(k) === 0) || undefined}
            onClick={() => {
              setType(k)
              setShowSkipped(false)
            }}
          >
            {t(`t_${k}` as Key)}
          </button>
        ))}
      </nav>
      {/* Where the items came from: a filter over whichever is chosen above. */}
      <div className="queue-origins" role="group" aria-label={t('originLabel')}>
        <button className="search-filter" data-on={!origin || undefined} aria-pressed={!origin} onClick={() => setOrigin(undefined)}>
          {t('all')}
        </button>
        {ORIGINS.map((o) => (
          <button key={o} className="search-filter" data-on={origin === o || undefined} aria-pressed={origin === o} onClick={() => setOrigin(o)}>
            {t(`o_${o}` as Key)}
          </button>
        ))}
        <span className="tally queue-left">{items && t('left', { n: total })}</span>
      </div>

      {items === null && <p className="hint">{problem ?? t('loading')}</p>}
      {items !== null && items.length === 0 && (
        <p className="hint queue-empty">
          {showSkipped ? t('nothingSkipped') : t('nothing')}{' '}
          {!showSkipped && skippedN > 0 && (
            <button className="clear" onClick={() => setShowSkipped(true)}>
              {t('showSkipped', { n: skippedN })}
            </button>
          )}
          {showSkipped && (
            <button className="clear" onClick={() => setShowSkipped(false)}>
              {t('backToQueue')}
            </button>
          )}
        </p>
      )}

      {items !== null && items.length > 0 && (
        <div className="queue-split">
          <ol className="queue-list">
            {items.map((i, n) => (
              <li key={i.id}>
                <button data-on={n === at} onClick={() => setAt(n)}>
                  <span className="queue-glyph" lang="ja">
                    {subjectGlyphs(i)}
                  </span>
                  <span className="queue-kind">
                    {t(`t_${i.type}` as Key)} · {isFollowUp(i) ? t('followUp') : i.origin === 'suggestion' ? t('o_suggestion') : i.source}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {item?.type === 'character' && (
            <CharacterCard key={item.id} id={item.id} char={item.subject} onDone={advance} onKanji={onKanji} />
          )}
          {item && item.type !== 'character' && (
            <article className="queue-item">
              <header className="queue-head">
                <span className="queue-big" lang="ja">
                  {subjectGlyphs(item)}
                </span>
                <div>
                  <p className="queue-meta">
                    {t(`t_${item.type}` as Key)} ·{' '}
                    {item.origin === 'suggestion'
                      ? t('suggestionBy', { who: item.createdBy ? `@${item.createdBy.username}` : '?' })
                      : t('proposalFrom', { source: item.source })}
                    {typeof item.evidence?.confidence === 'number' && (
                      <span className="hint"> · {t('confidence', { n: Math.round(Number(item.evidence.confidence) * 100) / 100 })}</span>
                    )}
                  </p>
                  {item.reason && <p className="queue-reason">{item.reason}</p>}
                  {reportSubject(item) && <ReportButton key={item.id} subject={reportSubject(item)!} from={item.id} />}
                </div>
                <div className="queue-dict">
                  <DictLinks
                    type={item.type}
                    subject={item.subject}
                    label={(detail?.id === item.id ? detail.context?.word?.headword : undefined) ?? item.label}
                  />
                </div>
              </header>

              <div className="queue-judge">
              {item.type === 'report' ? (
              <dl className="queue-compare">
                <dt>{t('reported')}</dt>
                <dd>
                  <ValueView type={item.type} value={item.proposed} />
                </dd>
              </dl>
              ) : !board && item.type !== 'bg' && (
              <dl className="queue-compare">
                <dt>{t('now')}</dt>
                <dd>
                  <ValueView type={item.type} value={item.current} groups={groups} subject={item.subject} />
                </dd>
                <dt>{t('proposed')}</dt>
                <dd>
                  {open ? <span className="hint">{t('noProposal')}</span> : <ValueView type={item.type} value={item.proposed} groups={groups} subject={item.subject} />}
                </dd>
              </dl>
              )}

              {detail && item.type !== 'bg' && <Evidence detail={detail} onKanji={onKanji} onUse={setDraft} />}
              </div>

              <div className="queue-decide">
              <div className="queue-edit">
                {item.type === 'bg' ? (
                  detail?.id === item.id ? (
                    <BgCard detail={detail} value={(draft ?? []) as string[]} onChange={setDraft} labels={labels} onLabels={setLabels} notes={notes} onNotes={setNotes} />
                  ) : (
                    <p className="hint">{t('loading')}</p>
                  )
                ) : board ? (
                  detail?.context.board ? (
                    <MeaningsBoard
                      key={`${item.id}:${fresh}`}
                      onWork={setBoardWork}
                      onUnconfirmed={setUnconfirmed}
                      cacheKey={item.id}
                      char={item.subject}
                      groups={(draft ?? []) as MeaningGroup[]}
                      onGroups={setDraft}
                      words={detail.context.board}
                      placements={placements}
                      onPlace={place}
                      skipped={skipped}
                      onSkip={skip}
                      followUp={isFollowUp(item)}
                    />
                  ) : (
                    <p className="hint">{t('loading')}</p>
                  )
                ) : item.type === 'word_sense' && detail?.id === item.id && detail.context.board && groups ? (
                  <MeaningsBoard
                    key={`${item.id}:${fresh}`}
                    cacheKey={item.id}
                    char={item.subject.split('|')[0]}
                    groups={groups}
                    onGroups={() => {}}
                    words={detail.context.board}
                    placements={{ [wordOf(item)]: (draft as string | null) ?? null }}
                    onPlace={(ids, to) => {
                      if (to !== null && ids.includes(wordOf(item))) setDraft(to)
                    }}
                    skipped={NO_WORDS}
                    onSkip={() => {}}
                    only={wordOf(item)}
                    plain
                  />
                ) : (
                  <>
                    {item.type !== 'word_sense' && <h4>{t('yourValue')}</h4>}
                    <ValueEditor
                      type={item.type}
                      value={draft}
                      onChange={setDraft}
                      groups={groups}
                      char={item.subject.split('|')[0]}
                      subject={item.subject}
                    />
                  </>
                )}
                <label className="review-field">
                  <span>{t('reason')}</span>
                  <input className="assoc-text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                </label>
              </div>

              {problem && <p className="account-problem">{problem}</p>}
              <div className="queue-actions">
                <button
                  className="account-submit"
                  disabled={busy || blocked}
                  title={blocked ? t('confirmFirst', { n: unconfirmed }) : undefined}
                  onClick={() => decideDraft()}
                >
                  {edited ? t('saveEdit') : open ? t('keep') : item.type === 'report' ? t('confirmReport') : t('accept')}
                </button>
                {canReject(item) && (
                  <button className="clear" disabled={busy} onClick={() => decide('reject')}>
                    {t('reject')}
                  </button>
                )}
                <button className="clear" disabled={busy} onClick={() => decide('skip')}>
                  {t('skip')}
                </button>
                <button className="clear queue-reset" disabled={busy || !changed} title={t('resetTitle')} onClick={reset}>
                  {t('reset')}
                </button>
                {blocked && <span className="hint queue-blocked">{t('confirmFirst', { n: unconfirmed })}</span>}
                <span className="hint queue-keys">
                  {t(item.type === 'word_sense' ? 'keysWord' : canReject(item) ? 'keys' : 'keysNoReject')}
                </span>
              </div>
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  )
}
