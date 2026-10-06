/**
 * One card per character: what it is built from, how it relates to other
 * characters, and -- for a part with no meaning in the dictionary -- what it
 * is. These were three stages; they are one card now, because the answers
 * depend on each other (a shape and a "form of" can't both be right) and a
 * reviewer thinks about one character at a time.
 *
 * Each step is a short list of answers, each saying what it does: "use the
 * proposal", "keep it as it is", "no parts", "something else". Nothing is
 * a bare "reject" that may mean either way (五 段 為 were closed that way with
 * their wrong parts still live). The card is saved as one decision per item,
 * in one go (server/review.py decide_card).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, dataChanged, type CardDecision, type CharacterCard as Card, type FormLink, type Impact, type ItemDetail, type PartMeaning, type TaskValue } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { typing, useKey } from '../keys'
import { FontStrip } from '../detail/FontStrip'
import { DictLinks } from './DictLinks'
import { KanjiFacts, PartMeaningView, PartTiles, strokesOk, ValueEditor } from './editors'
import { FormEvidence, ImpactView, PartEvidence, PartsEvidence, UsedIn } from './Evidence'
import { useLinkSentence } from './KindsInfo'
import { ReportButton } from './ReportButton'
import { same } from './board'
import { clearDraft, readDraft, writeDraft } from './drafts'

const S = strings(
  {
    kind: 'character',
    from: 'from {source}',
    loading: 'loading',
    q_parts: 'What is {char} built from, as written today?',
    q_parts_hint: 'Each part must do a job in it: meaning, sound, or a kanji written for that position. A lookalike is not a part.',
    q_forms: 'How is {char} related to these characters?',
    q_forms_hint: 'A form link never changes parts. “A form of” lends its meaning to every kanji with the part: check the lists.',
    q_meaning: '{char} has no meaning in the dictionary. What is it?',
    q_meaning_hint: 'A real character with its own meaning, a shape several old parts merged into (a name, not a meaning), or a form of a kanji (step above).',
    useProposal: 'Use the proposal',
    useDraft: 'Use the AI draft',
    keepNow: 'Keep it as it is',
    atomic: 'No parts: it is learned as one piece',
    other: 'Something else:',
    noParts: 'no parts',
    noLink: 'no link',
    draftSays: 'AI draft',
    confidence: 'confidence {n}',
    lookalikes: 'only look alike',
    flagged: 'Why this card',
    changes: 'What this changes',
    noChange: 'Nothing changes.',
    linkProposed: 'Use the proposal',
    linkNow: 'Leave it as it is',
    linkOther: 'Something else',
    draftVerdict: 'the part’s AI draft says: {v}',
    v_keep: 'keep it',
    v_reject: 'it is wrong',
    m_proposed: 'Use the proposal',
    m_other: 'My own version',
    m_form: 'It is a form of a kanji (the link above lends its meaning)',
    m_none: 'Leave it with no meaning for now',
    conflict: 'A shape and “a form of” can’t both be right: the shape would win and the form of would lend nothing. Leave the form link as it is, or say it is a form of a kanji below.',
    summary: 'Saving will:',
    s_parts_keep: 'keep {char}’s parts as they are',
    s_parts: 'give {char} the parts {parts}',
    s_atomic: 'make {char} a single piece, with no parts',
    s_link: 'set: {sentence}',
    s_link_keep: 'leave {pair} as it is',
    s_meaning: 'show on {char}’s page: {what}',
    s_meaning_keep: 'leave {char} with no meaning of its own',
    s_meaning_form: 'let {char} borrow the meaning of what it is a form of',
    reason: 'Reason (optional)',
    save: 'save',
    skip: 'skip',
    reset: 'reset card',
    resetTitle: 'Throw away what you chose on this card and start again',
    confirmReset: 'Throw away what you chose on this card?',
    keys: 'a save · s skip · j/k next/previous',
  },
  {
    kind: 'знак',
    from: 'от {source}',
    loading: 'зареждане',
    q_parts: 'От какво е построен {char}, както се пише днес?',
    q_parts_hint: 'Всяка част трябва да върши работа в него: значение, звук или канджи, написано за това място. Нещо, което само прилича, не е част.',
    q_forms: 'Как е свързан {char} с тези знаци?',
    q_forms_hint: 'Връзка между форми никога не променя частите. „Форма на“ заема значението си на всяко канджи с частта: проверете списъците.',
    q_meaning: '{char} няма значение в речника. Какво е?',
    q_meaning_hint: 'Истински знак със свое значение, форма, в която са се слели няколко стари части (име, не значение), или форма на канджи (стъпката по-горе).',
    useProposal: 'Използвайте предложението',
    useDraft: 'Използвайте черновата на ИИ',
    keepNow: 'Оставете го както е',
    atomic: 'Без части: учи се като едно цяло',
    other: 'Нещо друго:',
    noParts: 'без части',
    noLink: 'няма връзка',
    draftSays: 'Чернова на ИИ',
    confidence: 'увереност {n}',
    lookalikes: 'само приличат',
    flagged: 'Защо е тази карта',
    changes: 'Какво променя',
    noChange: 'Нищо не се променя.',
    linkProposed: 'Използвайте предложението',
    linkNow: 'Оставете както е',
    linkOther: 'Нещо друго',
    draftVerdict: 'черновата на ИИ за частта казва: {v}',
    v_keep: 'запазете',
    v_reject: 'грешно е',
    m_proposed: 'Използвайте предложението',
    m_other: 'Моя версия',
    m_form: 'Форма е на канджи (връзката по-горе заема значението му)',
    m_none: 'Оставете го без значение засега',
    conflict: 'Форма без значение и „форма на“ не могат да са верни заедно: формата печели и „форма на“ не заема нищо. Оставете връзката както е или кажете по-долу, че е форма на канджи.',
    summary: 'Записът ще:',
    s_parts_keep: 'запази частите на {char} както са',
    s_parts: 'даде на {char} частите {parts}',
    s_atomic: 'направи {char} едно цяло, без части',
    s_link: 'зададе: {sentence}',
    s_link_keep: 'остави {pair} както е',
    s_meaning: 'покаже на страницата на {char}: {what}',
    s_meaning_keep: 'остави {char} без свое значение',
    s_meaning_form: 'остави {char} да заема значението на това, чиято форма е',
    reason: 'Причина (по желание)',
    save: 'запишете',
    skip: 'пропуснете',
    reset: 'нулирайте картата',
    resetTitle: 'Изхвърлете избраното на тази карта и започнете отначало',
    confirmReset: 'Да се изхвърли ли избраното на тази карта?',
    keys: 'a запис · s пропускане · j/k следващо/предишно',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

/** The AI's view of a character's parts (pipeline/decomp_drafts.py), on its items' evidence. */
interface Draft {
  parts: string[]
  verdict: 'keep' | 'change'
  why: string
  confidence: number
  lookalikes?: string[]
  flags?: string[]
}

interface PartsOption {
  key: string
  parts: string[]
  /** The item whose proposal this is, if one. */
  item?: ItemDetail
}

interface Work {
  parts?: { pick: string; custom: string[] }
  forms: Record<string, { pick: 'proposed' | 'now' | 'other'; value: FormLink }>
  meaning?: { pick: 'proposed' | 'other' | 'form' | 'none'; value: PartMeaning }
  reason: string
}

const setOf = (a: string[]) => [...a].sort().join('')

/** The parts answers on offer: each distinct proposal, the AI draft if it says something new, today's, none. */
function partsOptions(items: ItemDetail[], now: string[], draft: Draft | null): PartsOption[] {
  const out: PartsOption[] = []
  const seen = new Set<string>([setOf(now)])
  for (const i of items) {
    const p = i.proposed as string[] | null
    if (!p || seen.has(setOf(p))) continue
    seen.add(setOf(p))
    out.push({ key: `p:${i.id}`, parts: p, item: i })
  }
  if (draft && !seen.has(setOf(draft.parts))) {
    seen.add(setOf(draft.parts))
    out.push({ key: 'draft', parts: draft.parts })
  }
  out.push({ key: 'now', parts: now })
  if (!seen.has('')) out.push({ key: 'atomic', parts: [] })
  return out
}

/** Where the card starts: the AI draft's answer when it gave one, else the first proposal, else as it is. */
function startWork(card: Card): Work {
  const parts = card.items.filter((i) => i.type === 'decomposition')
  const forms = card.items.filter((i) => i.type === 'form_link')
  const meaning = card.items.find((i) => i.type === 'part_meaning')
  const draft = draftOf(parts)
  const options = partsOptions(parts, card.context.parts, draft)
  const byDraft = draft && options.find((o) => setOf(o.parts) === setOf(draft.parts))
  const work: Work = { forms: {}, reason: '' }
  if (parts.length) work.parts = { pick: (byDraft ?? options[0]).key, custom: card.context.parts }
  for (const f of forms) work.forms[f.id] = { pick: 'proposed', value: (f.proposed as FormLink) ?? { kind: 'none', note: null } }
  if (meaning) work.meaning = { pick: 'proposed', value: meaning.proposed as PartMeaning }
  return work
}

function draftOf(items: ItemDetail[]): Draft | null {
  for (const i of items) {
    const d = i.evidence?.draft as Draft | undefined
    if (d) return d
  }
  return null
}

/** The X of a link X|Y as it reads: X is a form of Y; reversed, Y is a form of X. */
const linkSubjectChar = (subject: string, v: FormLink) => subject.split('|')[v.reverse ? 1 : 0]

export function CharacterCard({ id, char, onDone, onKanji }: { id: string; char: string; onDone: (skipped: boolean) => void; onKanji?: (c: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const sentence = useLinkSentence()
  const [card, setCard] = useState<Card | null>(null)
  const [work, setWork] = useState<Work | null>(null)
  const [start, setStart] = useState<Work | null>(null)
  const [impact, setImpact] = useState<Impact | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setCard(null)
    setWork(null)
    setProblem(null)
    api.reviewCharacter(char).then(
      (c) => {
        if (stale) return
        const s = startWork(c)
        setCard(c)
        setStart(s)
        setWork((readDraft(id)?.card as Work | undefined) ?? s)
      },
      (e) => !stale && setProblem(errorText(e, lang)),
    )
    return () => {
      stale = true
    }
  }, [id, char])

  // Kept in the browser until decided, like any card's work.
  useEffect(() => {
    if (work && start) writeDraft(id, { card: same(work, start) ? undefined : work })
  }, [id, work, start])

  const partsItems = useMemo(() => card?.items.filter((i) => i.type === 'decomposition') ?? [], [card])
  const formItems = useMemo(() => card?.items.filter((i) => i.type === 'form_link') ?? [], [card])
  const meaningItem = card?.items.find((i) => i.type === 'part_meaning')
  const now = card?.context.parts ?? []
  const draft = draftOf(partsItems)
  const options = useMemo(() => (card ? partsOptions(partsItems, card.context.parts, draft) : []), [card, partsItems, draft])

  // The parts the chosen answer gives.
  const chosen: string[] | null = !work?.parts
    ? null
    : work.parts.pick === 'other'
      ? work.parts.custom
      : (options.find((o) => o.key === work.parts!.pick)?.parts ?? now)
  const partsChange = chosen !== null && !same(chosen, now)

  // What the chosen parts would change upstream.
  const chosenKey = chosen?.join('') ?? ''
  useEffect(() => {
    setImpact(null)
    if (!partsChange || !chosen) return
    let stale = false
    api.reviewImpact(char, chosen).then(
      (i) => !stale && setImpact(i),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [char, chosenKey, partsChange])

  // Each form link and the part's meaning, resolved to what they would be.
  const formValue = (f: ItemDetail): FormLink | null => {
    const w = work?.forms[f.id]
    if (!w || w.pick === 'now') return null
    return w.pick === 'proposed' ? (f.proposed as FormLink) : w.value
  }
  const meaningValue: PartMeaning | null =
    work?.meaning && (work.meaning.pick === 'proposed' || work.meaning.pick === 'other')
      ? work.meaning.pick === 'proposed'
        ? (meaningItem?.proposed as PartMeaning)
        : work.meaning.value
      : null
  const conflict =
    meaningValue?.kind === 'shape' &&
    formItems.some((f) => {
      const v = formValue(f)
      return v?.kind === 'form_of' && linkSubjectChar(f.subject, v) === char
    })

  const decisions = useCallback((): CardDecision[] | null => {
    if (!card || !work) return null
    const out: CardDecision[] = []
    if (work.parts && chosen) {
      const pick = work.parts.pick
      if (!partsChange) partsItems.forEach((i) => out.push({ item: i.id, action: 'keep' }))
      else {
        // One item carries the answer: the proposal picked, else the first; the rest were not chosen.
        const carrier = pick.startsWith('p:') ? pick.slice(2) : partsItems[0].id
        for (const i of partsItems) {
          if (i.id !== carrier) out.push({ item: i.id, action: 'reject' })
          else if (same(i.proposed, chosen)) out.push({ item: i.id, action: 'accept' })
          else out.push({ item: i.id, action: 'edit', value: chosen })
        }
      }
    }
    for (const f of formItems) {
      const v = formValue(f)
      if (!v || same(v, f.current)) out.push({ item: f.id, action: 'keep' })
      else if (same(v, f.proposed)) out.push({ item: f.id, action: 'accept' })
      else out.push({ item: f.id, action: 'edit', value: v as TaskValue })
    }
    if (meaningItem && work.meaning) {
      const p = work.meaning.pick
      if (p === 'form') out.push({ item: meaningItem.id, action: 'reject' })
      else if (p === 'none') out.push({ item: meaningItem.id, action: 'keep' })
      else if (same(meaningValue, meaningItem.proposed)) out.push({ item: meaningItem.id, action: 'accept' })
      else out.push({ item: meaningItem.id, action: 'edit', value: meaningValue })
    }
    return out
  }, [card, work, chosen, partsChange, partsItems, formItems, meaningItem, meaningValue])

  async function send(skip: boolean) {
    if (!card || !work || busy) return
    const list = skip ? card.items.map((i) => ({ item: i.id, action: 'skip' as const })) : decisions()
    if (!list) return
    if (!skip && partsChange && !strokesOk(chosen, lang)) return
    setBusy(true)
    setProblem(null)
    try {
      await api.decideCharacter(char, list, skip ? undefined : work.reason.trim() || undefined)
      if (!skip) {
        clearDraft(id)
        if (list.some((d) => d.action === 'accept' || d.action === 'edit')) dataChanged()
      }
      onDone(skip)
    } catch (e) {
      setProblem(errorText(e, lang))
    } finally {
      setBusy(false)
    }
  }

  const changed = !!work && !!start && !same(work, start)
  function reset() {
    if (!start || !window.confirm(t('confirmReset'))) return
    clearDraft(id)
    setWork(start)
  }

  useKey((e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'a' || e.key === 'Enter') {
      if (!conflict) send(false)
    } else if (e.key === 's') send(true)
    else return
    e.preventDefault()
  })

  if (!card || !work) return <p className="hint">{problem ?? t('loading')}</p>
  const sources = [...new Set(card.items.map((i) => i.source))].join(', ')
  const steps = [partsItems.length > 0, formItems.length > 0, !!meaningItem].filter(Boolean).length
  let step = 0
  const num = () => (steps > 1 ? `${++step} · ` : '')
  const tiles = (p: string[]) => (p.length ? <PartTiles chars={p} onKanji={onKanji} /> : <span className="hint">{t('noParts')}</span>)
  const setParts = (patch: Partial<NonNullable<Work['parts']>>) => setWork({ ...work, parts: { ...work.parts!, ...patch } })
  const setForm = (fid: string, patch: Partial<Work['forms'][string]>) => setWork({ ...work, forms: { ...work.forms, [fid]: { ...work.forms[fid], ...patch } } })
  const setMeaning = (patch: Partial<NonNullable<Work['meaning']>>) => setWork({ ...work, meaning: { ...work.meaning!, ...patch } })
  const verdicts = (meaningItem?.evidence?.formLinks ?? {}) as Record<string, 'keep' | 'reject'>

  // What saving would do, in a sentence each.
  const summary: string[] = []
  if (work.parts && chosen)
    summary.push(!partsChange ? t('s_parts_keep', { char }) : chosen.length ? t('s_parts', { char, parts: chosen.join(' ') }) : t('s_atomic', { char }))
  for (const f of formItems) {
    const v = formValue(f)
    summary.push(v && !same(v, f.current) ? t('s_link', { sentence: sentence(v.kind, f.subject, v.reverse) }) : t('s_link_keep', { pair: f.subject.replace('|', ' · ') }))
  }
  if (meaningItem && work.meaning) {
    const p = work.meaning.pick
    summary.push(
      p === 'none' ? t('s_meaning_keep', { char }) : p === 'form' ? t('s_meaning_form', { char }) : t('s_meaning', { char, what: meaningValue?.en ?? '' }),
    )
  }

  return (
    <article className="queue-item char-card">
      <header className="queue-head">
        <span className="queue-big" lang="ja">
          {char}
        </span>
        <div>
          <p className="queue-meta">
            {t('kind')} · {t('from', { source: sources })}
          </p>
          <ReportButton subject={`kanji:${char}`} from={id} />
        </div>
        <div className="queue-dict">
          <DictLinks type="decomposition" subject={char} />
        </div>
      </header>

      <div className="queue-judge">
        <div className="queue-evidence">
          <FontStrip char={char} />
          <dl className="queue-compare">
            <KanjiFacts context={card.context} />
          </dl>
          {!meaningItem && card.context.users && Array.isArray(card.context.users) && <UsedIn chars={card.context.users} onKanji={onKanji} />}
        </div>
        {meaningItem && <PartEvidence detail={meaningItem} onKanji={onKanji} />}
      </div>

      <div className="queue-decide">
        {work.parts && (
          <section className="card-step">
            <h4>
              {num()}
              {t('q_parts', { char })}
            </h4>
            <p className="hint">{t('q_parts_hint')}</p>
            {draft && (
              <div className="card-draft" data-unsure={draft.confidence < 0.6 || undefined}>
                <p>
                  <b>{t('draftSays')}</b> <span className="hint">({t('confidence', { n: draft.confidence })})</span>: {tiles(draft.parts)}
                </p>
                <p className="card-draft-why">{draft.why}</p>
                {!!draft.lookalikes?.length && (
                  <p className="hint">
                    <span lang="ja">{draft.lookalikes.join(' ')}</span> {t('lookalikes')}
                  </p>
                )}
                {!!draft.flags?.length && (
                  <p className="hint">
                    {t('flagged')}: {draft.flags.join('; ')}
                  </p>
                )}
              </div>
            )}
            <div className="card-options" role="radiogroup">
              {options.map((o) => (
                <label key={o.key} className="card-option" data-on={work.parts!.pick === o.key || undefined}>
                  <input type="radio" name={`parts-${id}`} checked={work.parts!.pick === o.key} onChange={() => setParts({ pick: o.key })} />
                  <span className="card-option-label">
                    {o.key === 'now' ? t('keepNow') : o.key === 'atomic' ? t('atomic') : o.key === 'draft' || o.item?.source.startsWith('ai:') ? t('useDraft') : t('useProposal')}
                    {o.key !== 'atomic' && <>: {tiles(o.parts)}</>}
                    {o.item && <span className="hint"> · {o.item.source}</span>}
                    {o.item?.reason && !o.item.source.startsWith('ai:') && <span className="hint card-option-why">{o.item.reason}</span>}
                  </span>
                </label>
              ))}
              <label className="card-option" data-on={work.parts.pick === 'other' || undefined}>
                <input type="radio" name={`parts-${id}`} checked={work.parts.pick === 'other'} onChange={() => setParts({ pick: 'other' })} />
                <span className="card-option-label">{t('other')}</span>
              </label>
              {work.parts.pick === 'other' && (
                <ValueEditor type="decomposition" value={work.parts.custom} onChange={(v) => setParts({ custom: v as string[] })} />
              )}
            </div>
            <PartsEvidence detail={partsItems[0]} onKanji={onKanji} onUse={(v) => setParts({ pick: 'other', custom: v as string[] })} impact={false} />
            <div className="card-changes">
              <h5>{t('changes')}</h5>
              {!partsChange ? <p className="hint">{t('noChange')}</p> : impact ? <ImpactView imp={impact} onKanji={onKanji} /> : <p className="hint">{t('loading')}</p>}
            </div>
          </section>
        )}

        {formItems.length > 0 && (
          <section className="card-step">
            <h4>
              {num()}
              {t('q_forms', { char })}
            </h4>
            <p className="hint">{t('q_forms_hint')}</p>
            {formItems.map((f) => {
              const w = work.forms[f.id]
              const proposed = f.proposed as FormLink | null
              const current = f.current as FormLink | null
              return (
                <div key={f.id} className="card-link">
                  <div className="card-options" role="radiogroup">
                    {proposed && (
                      <label className="card-option" data-on={w.pick === 'proposed' || undefined}>
                        <input type="radio" name={`f-${f.id}`} checked={w.pick === 'proposed'} onChange={() => setForm(f.id, { pick: 'proposed' })} />
                        <span className="card-option-label">
                          {t('linkProposed')}: <b lang="ja">{sentence(proposed.kind, f.subject, proposed.reverse)}</b>
                          <span className="hint"> · {f.source}</span>
                          {proposed.note && <span className="hint card-option-why">{proposed.note}</span>}
                          {verdicts[f.subject] && <span className="queue-verdict" data-verdict={verdicts[f.subject]}> {t('draftVerdict', { v: t(`v_${verdicts[f.subject]}` as Key) })}</span>}
                        </span>
                      </label>
                    )}
                    <label className="card-option" data-on={w.pick === 'now' || undefined}>
                      <input type="radio" name={`f-${f.id}`} checked={w.pick === 'now'} onChange={() => setForm(f.id, { pick: 'now' })} />
                      <span className="card-option-label">
                        {t('linkNow')}:{' '}
                        <span lang="ja">{current && current.kind !== 'none' ? sentence(current.kind, f.subject, current.reverse) : `${f.subject.replace('|', ' · ')}: ${t('noLink')}`}</span>
                      </span>
                    </label>
                    <label className="card-option" data-on={w.pick === 'other' || undefined}>
                      <input type="radio" name={`f-${f.id}`} checked={w.pick === 'other'} onChange={() => setForm(f.id, { pick: 'other' })} />
                      <span className="card-option-label">{t('linkOther')}</span>
                    </label>
                    {w.pick === 'other' && (
                      <ValueEditor type="form_link" value={w.value} onChange={(v) => setForm(f.id, { value: v as FormLink })} subject={f.subject} />
                    )}
                  </div>
                  <FormEvidence detail={f} onKanji={onKanji} />
                </div>
              )
            })}
          </section>
        )}

        {meaningItem && work.meaning && (
          <section className="card-step">
            <h4>
              {num()}
              {t('q_meaning', { char })}
            </h4>
            <p className="hint">{t('q_meaning_hint')}</p>
            <div className="card-options" role="radiogroup">
              <label className="card-option" data-on={work.meaning.pick === 'proposed' || undefined}>
                <input type="radio" name={`m-${id}`} checked={work.meaning.pick === 'proposed'} onChange={() => setMeaning({ pick: 'proposed' })} />
                <span className="card-option-label">
                  {t('m_proposed')}: <PartMeaningView value={meaningItem.proposed as PartMeaning} />
                </span>
              </label>
              <label className="card-option" data-on={work.meaning.pick === 'other' || undefined}>
                <input type="radio" name={`m-${id}`} checked={work.meaning.pick === 'other'} onChange={() => setMeaning({ pick: 'other' })} />
                <span className="card-option-label">{t('m_other')}</span>
              </label>
              {work.meaning.pick === 'other' && (
                <ValueEditor type="part_meaning" value={work.meaning.value} onChange={(v) => setMeaning({ value: v as PartMeaning })} />
              )}
              <label className="card-option" data-on={work.meaning.pick === 'form' || undefined}>
                <input type="radio" name={`m-${id}`} checked={work.meaning.pick === 'form'} onChange={() => setMeaning({ pick: 'form' })} />
                <span className="card-option-label">{t('m_form')}</span>
              </label>
              <label className="card-option" data-on={work.meaning.pick === 'none' || undefined}>
                <input type="radio" name={`m-${id}`} checked={work.meaning.pick === 'none'} onChange={() => setMeaning({ pick: 'none' })} />
                <span className="card-option-label">{t('m_none')}</span>
              </label>
            </div>
          </section>
        )}

        {conflict && <p className="queue-warn">{t('conflict')}</p>}

        <div className="card-summary">
          <h5>{t('summary')}</h5>
          <ul>
            {summary.map((s, i) => (
              <li key={i} lang="ja">
                {s}
              </li>
            ))}
          </ul>
        </div>

        <label className="review-field">
          <span>{t('reason')}</span>
          <input className="assoc-text" value={work.reason} maxLength={500} onChange={(e) => setWork({ ...work, reason: e.target.value })} />
        </label>
        {problem && <p className="account-problem">{problem}</p>}
        <div className="queue-actions">
          <button className="account-submit" disabled={busy || conflict} onClick={() => send(false)}>
            {t('save')}
          </button>
          <button className="clear" disabled={busy} onClick={() => send(true)}>
            {t('skip')}
          </button>
          <button className="clear queue-reset" disabled={busy || !changed} title={t('resetTitle')} onClick={reset}>
            {t('reset')}
          </button>
          <span className="hint queue-keys">{t('keys')}</span>
        </div>
      </div>
    </article>
  )
}
