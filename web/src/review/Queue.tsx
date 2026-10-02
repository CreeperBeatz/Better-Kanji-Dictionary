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
import { CATCH_ALL, ValueEditor, ValueView } from './editors'

const S = strings(
  {
    all: 'all',
    t_decomposition: 'parts',
    t_form_link: 'forms',
    t_kanji_senses: 'meanings',
    t_word_sense: 'word meanings',
    o_proposal: 'proposals',
    o_suggestion: 'suggestions',
    proposalFrom: 'proposal · {source}',
    suggestionBy: 'suggestion by {who}',
    nothing: 'Nothing waiting here.',
    loading: 'loading',
    now: 'Now',
    proposed: 'Proposed',
    yourValue: 'Your answer',
    reason: 'Reason (optional)',
    accept: 'accept',
    saveEdit: 'save my answer',
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
    drafts: 'Drafted words per group',
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
    o_proposal: 'предложения от данни',
    o_suggestion: 'предложения от хора',
    proposalFrom: 'от данни · {source}',
    suggestionBy: 'предложено от {who}',
    nothing: 'Тук нищо не чака.',
    loading: 'зареждане',
    now: 'Сега',
    proposed: 'Предложено',
    yourValue: 'Вашият отговор',
    reason: 'Причина (по желание)',
    accept: 'приемете',
    saveEdit: 'запазете моя отговор',
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
    drafts: 'Чернови думи по групи',
    word: 'Думата',
    pickHint: 'Изберете какво внася {char} в думата, а не какво значи думата като цяло.',
    left: '{n} чакат',
    confidence: 'увереност на модела {n}',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
const TYPES: TaskType[] = ['decomposition', 'form_link', 'kanji_senses', 'word_sense']
const ORIGINS: Origin[] = ['proposal', 'suggestion']
const LIVE_ON_PAGE: TaskType[] = ['decomposition', 'form_link']

const same = (a: TaskValue, b: TaskValue) => JSON.stringify(a) === JSON.stringify(b)

function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function Queue({ onKanji }: { onKanji?: (char: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const [type, setType] = useState<TaskType | undefined>()
  const [origin, setOrigin] = useState<Origin | undefined>()
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [at, setAt] = useState(0)
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [draft, setDraft] = useState<TaskValue>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(() => {
    setItems(null)
    api.reviewQueueItems(type, origin).then(
      (d) => {
        setItems(d.items)
        setTotal(d.total)
        setAt(0)
      },
      (e) => setProblem(errorText(e, lang)),
    )
  }, [type, origin, lang])
  useEffect(load, [load])

  const item = items?.[at] ?? null
  useEffect(() => {
    setDetail(null)
    setProblem(null)
    setReason('')
    if (!item) return
    setDraft(item.proposed ?? item.current)
    let stale = false
    api.reviewItem(item.id).then(
      (d) => !stale && setDetail(d),
      (e) => !stale && setProblem(errorText(e, lang)),
    )
    return () => {
      stale = true
    }
  }, [item?.id])

  const decide = useCallback(
    async (action: 'accept' | 'edit' | 'reject' | 'skip', value?: TaskValue) => {
      if (!item || busy) return
      setBusy(true)
      setProblem(null)
      try {
        await api.decide(item.id, action, value, reason.trim() || undefined)
        if ((action === 'accept' || action === 'edit') && LIVE_ON_PAGE.includes(item.type)) dataChanged()
        setItems((list) => list && list.filter((i) => i.id !== item.id))
        setTotal((n) => n - 1)
        setAt((i) => Math.max(0, Math.min(i, (items?.length ?? 1) - 2)))
      } catch (e) {
        setProblem(errorText(e, lang))
      } finally {
        setBusy(false)
      }
    },
    [item, busy, reason, items, lang],
  )

  const groups: MeaningGroup[] | null | undefined = detail?.context.senses
  const edited = item ? !same(draft, item.proposed) : false
  const decideDraft = useCallback(
    (value: TaskValue = draft) => (item && same(value, item.proposed) ? decide('accept') : decide('edit', value)),
    [item, draft, decide],
  )

  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || !item) return
    if (e.key === 'a' || e.key === 'Enter') decideDraft()
    else if (e.key === 'r') decide('reject')
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
    const [a, b] = i.subject.split('|')
    if (i.type === 'form_link') return `${a} · ${b}`
    if (i.type === 'word_sense') return a
    return a
  }

  return (
    <div className="queue">
      <nav className="overlay-tabs queue-filters">
        <button data-on={!type} onClick={() => setType(undefined)}>
          {t('all')}
        </button>
        {TYPES.map((k) => (
          <button key={k} data-on={type === k} onClick={() => setType(k)}>
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
        <span className="tally queue-left">{items && t('left', { n: total })}</span>
      </nav>

      {items === null && <p className="hint">{problem ?? t('loading')}</p>}
      {items !== null && items.length === 0 && <p className="hint">{t('nothing')}</p>}

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
                    {t(`t_${i.type}` as Key)} · {i.origin === 'suggestion' ? t('o_suggestion') : i.source}
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

              <dl className="queue-compare">
                <dt>{t('now')}</dt>
                <dd>
                  <ValueView type={item.type} value={item.current} groups={groups} />
                </dd>
                <dt>{t('proposed')}</dt>
                <dd>
                  <ValueView type={item.type} value={item.proposed} groups={groups} />
                </dd>
              </dl>

              {detail && <Evidence detail={detail} onKanji={onKanji} />}

              <div className="queue-edit">
                {item.type !== 'word_sense' && <h4>{t('yourValue')}</h4>}
                <ValueEditor
                  type={item.type}
                  value={draft}
                  onChange={setDraft}
                  groups={groups}
                  char={item.subject.split('|')[0]}
                />
                <label className="review-field">
                  <span>{t('reason')}</span>
                  <input className="assoc-text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                </label>
              </div>

              {problem && <p className="account-problem">{problem}</p>}
              <div className="queue-actions">
                <button className="account-submit" disabled={busy} onClick={() => decideDraft()}>
                  {edited ? t('saveEdit') : t('accept')}
                </button>
                <button className="clear" disabled={busy} onClick={() => decide('reject')}>
                  {t('reject')}
                </button>
                <button className="clear" disabled={busy} onClick={() => decide('skip')}>
                  {t('skip')}
                </button>
                <span className="hint queue-keys">{t(item.type === 'word_sense' ? 'keysWord' : 'keys')}</span>
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
      {detail.type === 'kanji_senses' && c.drafts && c.drafts.length > 0 && (
        <div>
          <h4>{t('drafts')}</h4>
          <ul className="queue-drafts">
            {Object.entries(
              c.drafts.reduce<Record<string, typeof c.drafts>>((acc, d) => {
                ;(acc[d.proposed ?? '?'] ??= []).push(d)
                return acc
              }, {}),
            ).map(([g, ws]) => (
              <li key={g}>
                <b>{g}</b>{' '}
                {ws.slice(0, 6).map((w) => (
                  <span key={w.word} className="queue-draft" title={w.gloss} lang="ja">
                    {w.word}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
