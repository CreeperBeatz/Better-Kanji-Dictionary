/**
 * The review queue: open items, worst first, one at a time, with what the
 * reviewer needs to judge each -- the glyphs, what would change upstream,
 * the old form, the word and its glosses.
 *
 * Keyboard: a or Enter accepts (or saves the edit), r rejects, s skips,
 * j / k move, and for a word's meaning 1-9 picks a group and decides at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { FontStrip } from '../detail/FontStrip'
import { CATCH_ALL, strokesOk, ValueEditor, ValueView } from './editors'
import { finalizeBoard, MeaningsBoard } from './MeaningsBoard'
import { BgCard } from './BgCard'
import { clearDraft, readDraft, writeDraft } from './drafts'
import { queueRouteInUrl, replaceQueueRoute } from './route'

const S = strings(
  {
    all: 'all',
    t_decomposition: 'parts',
    t_form_link: 'forms',
    t_kanji_senses: 'meanings',
    t_word_sense: 'word meanings',
    t_bg: 'Bulgarian',
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
    skip: 'skip',
    keys: 'a accept · r reject · s skip · j/k next/previous',
    keysWord: '1–9 pick and decide · r reject · s skip · j/k next/previous',
    removed: 'Loses as a part',
    added: 'Gains as a part',
    lost: 'No longer a prerequisite',
    gained: 'New prerequisites',
    newEdge: 'This adds a containment edge: the order moves.',
    containers: '{n} kanji contain it ({joyo} jōyō), all affected:',
    notes: '{n} public notes mention a part it would lose:',
    oldForm: 'Old form',
    oldHint: 'Evidence for the story, not for the parts: judge the parts by the shape written today.',
    kanjidic: 'KANJIDIC',
    curated: 'Kanji Alive',
    readings: 'Readings',
    word: 'The word',
    pickHint: 'Pick what {char} contributes to the word, not what the word means overall.',
    left: '{n} waiting',
    confidence: 'model confidence {n}',
  },
  {
    all: 'всички',
    t_decomposition: 'части',
    t_form_link: 'форми',
    t_kanji_senses: 'значения',
    t_word_sense: 'значения в думи',
    t_bg: 'български',
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
    skip: 'пропуснете',
    keys: 'a приемане · r отхвърляне · s пропускане · j/k следващо/предишно',
    keysWord: '1–9 избор и решение · r отхвърляне · s пропускане · j/k следващо/предишно',
    removed: 'Губи като част',
    added: 'Получава като част',
    lost: 'Вече не е предпоставка',
    gained: 'Нови предпоставки',
    newEdge: 'Това добавя ребро на съдържане: редът се мести.',
    containers: '{n} кандзи го съдържат ({joyo} джойо), всички засегнати:',
    notes: '{n} публични бележки споменават част, която би изчезнала:',
    oldForm: 'Стара форма',
    oldHint: 'Доказателство за историята, не за частите: частите се съдят по днешната форма.',
    kanjidic: 'KANJIDIC',
    curated: 'Kanji Alive',
    readings: 'Четения',
    word: 'Думата',
    pickHint: 'Изберете какво внася {char} в думата, а не какво значи думата като цяло.',
    left: '{n} чакат',
    confidence: 'увереност на модела {n}',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
const TYPES: TaskType[] = ['decomposition', 'form_link', 'kanji_senses', 'word_sense', 'bg']
const ORIGINS: Origin[] = ['proposal', 'suggestion']
const LIVE_ON_PAGE: TaskType[] = ['decomposition', 'form_link', 'bg']

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

type Placements = Record<number, string | null>

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
          const one = await api.reviewItem(id).catch(() => null)
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
    if (!item) return
    let stale = false
    api.reviewItem(item.id).then(
      (d) => {
        if (stale) return
        setDetail(d)
        if (d.type === 'kanji_senses' && d.context.board) {
          const ids = new Set(((d.proposed ?? d.current ?? []) as MeaningGroup[]).map((g) => g.id))
          const p: Placements = {}
          for (const w of d.context.board) p[w.id] = w.group && (w.group === CATCH_ALL || ids.has(w.group)) ? w.group : null
          setPlacements(readDraft(d.id)?.placements ?? p)
          setPlacedFrom(p)
        }
      },
      (e) => !stale && setProblem(errorText(e, lang)),
    )
    return () => {
      stale = true
    }
  }, [item?.id])

  const decide = useCallback(
    async (action: 'accept' | 'edit' | 'reject' | 'skip', value?: TaskValue, words?: Placements, skip?: Placements) => {
      if (!item || busy) return
      setBusy(true)
      setProblem(null)
      try {
        await api.decide(item.id, action, value, reason.trim() || undefined, words, skip)
        if (action !== 'skip') clearDraft(item.id)
        if ((action === 'accept' || action === 'edit') && LIVE_ON_PAGE.includes(item.type)) dataChanged()
        if (action !== 'skip') onDecided?.()
        setItems((list) => list && list.filter((i) => i.id !== item.id))
        setTotal((n) => n - 1)
        if (!showSkipped) setTypes((c) => ({ ...c, [item.type]: Math.max(0, (c[item.type] ?? 1) - 1) }))
        if (action === 'skip' && !showSkipped) setSkippedN((n) => n + 1)
        if (action !== 'skip' && showSkipped) setSkippedN((n) => Math.max(0, n - 1))
        setAt((i) => Math.max(0, Math.min(i, (items?.length ?? 1) - 2)))
      } catch (e) {
        setProblem(errorText(e, lang))
      } finally {
        setBusy(false)
      }
    },
    [item, busy, reason, items, lang, onDecided, showSkipped],
  )

  const groups: MeaningGroup[] | null | undefined = detail?.context.senses
  // Nothing proposed (a cost-ranked check): leaving it as it is is a rejection of any change.
  const open = item?.proposed === null
  const board = item?.type === 'kanji_senses'
  const moved = board && !same(placements, placedFrom)
  const edited = item ? moved || (open ? !same(draft, item.current) : !same(draft, item.proposed)) : false
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
      if (item.proposed === null) {
        if (same(value, item.current)) return decide('reject')
        return item.type === 'decomposition' && !strokesOk(value, lang) ? undefined : decide('edit', value)
      }
      if (same(value, item.proposed)) return decide('accept')
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
    })
  }, [item, detail, draft, reason, placements, placedFrom, board, skipped])

  const skip = useCallback((ids: number[], on: boolean) => {
    setSkipped((s) => {
      const n = new Set(s)
      for (const id of ids) {
        if (on) n.add(id)
        else n.delete(id)
      }
      return n
    })
  }, [])
  const isFollowUp = (i: QueueItem) => i.type === 'kanji_senses' && !!(i.evidence as { words?: unknown } | null)?.words

  const place = useCallback((ids: number[], to: string | null) => {
    setPlacements((p) => {
      const n = { ...p }
      for (const id of ids) n[id] = to
      return n
    })
  }, [])

  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || !item) return
    if (e.key === 'a' || e.key === 'Enter') decideDraft()
    else if (e.key === 'r' && item.type !== 'bg') decide('reject')
    else if (e.key === 's') decide('skip')
    else if (e.key === 'j' || e.key === 'ArrowDown') setAt((i) => Math.min(i + 1, (items?.length ?? 1) - 1))
    else if (e.key === 'k' || e.key === 'ArrowUp') setAt((i) => Math.max(i - 1, 0))
    else if (item.type === 'word_sense' && /^[1-9]$/.test(e.key) && groups) {
      const ids = [...groups.map((g) => g.id), CATCH_ALL]
      const pick = ids[Number(e.key) - 1]
      if (pick) decideDraft(pick)
    } else return
    e.preventDefault()
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const subjectGlyphs = (i: QueueItem) => {
    const [a] = i.subject.split('|')
    const b = i.type === 'bg' ? i.subject.split(':')[1] : i.subject.split('|')[1]
    if (i.type === 'form_link') return `${a} · ${b}`
    if (i.type === 'word_sense') return a
    if (i.type === 'bg') return i.label ?? b ?? i.subject.split(':')[1]
    return a
  }

  return (
    <div className="queue">
      <nav className="overlay-tabs queue-filters">
        <button data-on={!type} data-empty={TYPES.every((k) => types[k] === 0) || undefined} onClick={() => setType(undefined)}>
          {t('all')}
        </button>
        {TYPES.map((k) => (
          <button key={k} data-on={type === k} data-empty={types[k] === 0 || undefined} onClick={() => setType(k)}>
            {t(`t_${k}` as Key)}
          </button>
        ))}
        <span className="overlay-tab-rule" />
        <button data-on={!origin} onClick={() => setOrigin(undefined)}>
          {t('all')}
        </button>
        {ORIGINS.map((o) => (
          <button key={o} data-on={origin === o} onClick={() => setOrigin(o)}>
            {t(`o_${o}` as Key)}
          </button>
        ))}
        <span className="overlay-tab-rule" />
        <button
          data-on={showSkipped}
          data-empty={(!showSkipped && skippedN === 0) || undefined}
          title={t('skippedTitle')}
          onClick={() => setShowSkipped((v) => !v)}
        >
          {t('skippedTab')} {skippedN > 0 && <span className="queue-count">{skippedN}</span>}
        </button>
        <span className="tally queue-left">{items && t('left', { n: total })}</span>
      </nav>

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

          {item && (
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
                </div>
              </header>

              <div className="queue-judge">
              {!board && item.type !== 'bg' && (
              <dl className="queue-compare">
                <dt>{t('now')}</dt>
                <dd>
                  <ValueView type={item.type} value={item.current} groups={groups} />
                </dd>
                <dt>{t('proposed')}</dt>
                <dd>
                  {open ? <span className="hint">{t('noProposal')}</span> : <ValueView type={item.type} value={item.proposed} groups={groups} />}
                </dd>
              </dl>
              )}

              {detail && item.type !== 'bg' && <Evidence detail={detail} onKanji={onKanji} />}
              </div>

              <div className="queue-decide">
              <div className="queue-edit">
                {item.type === 'bg' ? (
                  detail?.id === item.id ? (
                    <BgCard detail={detail} value={(draft ?? []) as string[]} onChange={setDraft} />
                  ) : (
                    <p className="hint">{t('loading')}</p>
                  )
                ) : board ? (
                  detail?.context.board ? (
                    <MeaningsBoard
                      key={item.id}
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
                ) : (
                  <>
                    {item.type !== 'word_sense' && <h4>{t('yourValue')}</h4>}
                    <ValueEditor
                      type={item.type}
                      value={draft}
                      onChange={setDraft}
                      groups={groups}
                      char={item.subject.split('|')[0]}
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
                <button className="account-submit" disabled={busy} onClick={() => decideDraft()}>
                  {edited ? t('saveEdit') : open ? t('keep') : t('accept')}
                </button>
                {/* A translation is fixed or kept; rejecting one would close it with nothing done. */}
                {item.type !== 'bg' && (
                  <button className="clear" disabled={busy} onClick={() => decide('reject')}>
                    {t('reject')}
                  </button>
                )}
                <button className="clear" disabled={busy} onClick={() => decide('skip')}>
                  {t('skip')}
                </button>
                <span className="hint queue-keys">{t(item.type === 'word_sense' ? 'keysWord' : 'keys')}</span>
              </div>
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  )
}

/** What the item is judged by, per type. */
function Evidence({ detail, onKanji }: { detail: ItemDetail; onKanji?: (char: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const glyphs = (chars: string[]) => (
    <span className="review-parts" lang="ja">
      {chars.map((c) =>
        onKanji ? (
          <button key={c} className="review-part" onClick={() => onKanji(c)}>
            {c}
          </button>
        ) : (
          <span key={c} className="review-part">
            {c}
          </span>
        ),
      )}
    </span>
  )

  if (detail.type === 'decomposition') {
    const imp = detail.impact
    const old = detail.context.forms?.old ?? []
    return (
      <div className="queue-evidence">
        {old.length > 0 && (
          <p title={t('oldHint')}>
            <span className="hint">{t('oldForm')}: </span>
            {glyphs(old.map((o) => o.char))} {old[0].note && <span className="hint">{old[0].note}</span>}
          </p>
        )}
        {imp && (
          <>
            {imp.newEdge && <p className="queue-warn">{t('newEdge')}</p>}
            <dl className="queue-compare">
              {imp.removed.length > 0 && (
                <>
                  <dt>{t('removed')}</dt>
                  <dd>{glyphs(imp.removed)}</dd>
                </>
              )}
              {imp.added.length > 0 && (
                <>
                  <dt>{t('added')}</dt>
                  <dd>{glyphs(imp.added)}</dd>
                </>
              )}
              {imp.lost.length > 0 && (
                <>
                  <dt>{t('lost')}</dt>
                  <dd>{glyphs(imp.lost)}</dd>
                </>
              )}
              {imp.gained.length > 0 && (
                <>
                  <dt>{t('gained')}</dt>
                  <dd>{glyphs(imp.gained)}</dd>
                </>
              )}
            </dl>
            {imp.containers > 0 && (
              <p>
                <span className="hint">{t('containers', { n: imp.containers, joyo: imp.containersJoyo })} </span>
                {glyphs(imp.topContainers)}
              </p>
            )}
            {imp.notesTotal > 0 && (
              <div>
                <p className="queue-warn">{t('notes', { n: imp.notesTotal })}</p>
                <ul className="queue-notes">
                  {imp.notes.map((n) => (
                    <li key={n.id}>
                      <span lang="ja">{n.char}</span> <span className="hint">{n.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (detail.type === 'form_link') {
    const [a, b] = detail.subject.split('|')
    return (
      <div className="queue-evidence queue-fonts">
        <FontStrip char={a} />
        <FontStrip char={b} />
      </div>
    )
  }

  const c = detail.context
  return (
    <div className="queue-evidence">
      <dl className="queue-compare">
        {c.curated && (
          <>
            <dt>{t('curated')}</dt>
            <dd>{c.curated}</dd>
          </>
        )}
        {c.kanjidic && c.kanjidic.length > 0 && (
          <>
            <dt>{t('kanjidic')}</dt>
            <dd>{c.kanjidic.join(', ')}</dd>
          </>
        )}
        {(c.on?.length || c.kun?.length) && (
          <>
            <dt>{t('readings')}</dt>
            <dd lang="ja">{[...(c.on ?? []), ...(c.kun ?? [])].join('、')}</dd>
          </>
        )}
      </dl>
      {detail.type === 'word_sense' && c.word && (
        <div className="queue-word">
          <p>
            <span className="queue-word-head" lang="ja">
              {c.word.headword}
            </span>{' '}
            <span lang="ja">{c.word.reading}</span>
          </p>
          <ol>
            {c.word.senses.slice(0, 4).map((s, i) => (
              <li key={i}>{lang === 'bg' && s.glossBg ? s.glossBg : s.gloss}</li>
            ))}
          </ol>
          <p className="hint">{t('pickHint', { char: c.char ?? '' })}</p>
        </div>
      )}
    </div>
  )
}
