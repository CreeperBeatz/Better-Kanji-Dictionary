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
import { api, dataChanged, type PartsSource, type CardDecision, type CharacterCard as Card, type FormLink, type Impact, type ItemDetail, type KanjiDictionaries, type PartMeaning, type TaskValue } from '../api'
import { strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { typing, useKey } from '../keys'
import { FontStrip } from '../detail/FontStrip'
import { DictLinks } from './DictLinks'
import { askIfStale } from './stale'
import { KanjiFacts, PartMeaningView, PartTiles, strokesOk, ValueEditor } from './editors'
import { FormEvidence, ImpactView, PartEvidence, PartsEvidence, UsedIn } from './Evidence'
import { SourceChips, SourceNotes } from '../detail/PartsSource'
import { KindsInfoButton, KindsTable, useKindsInfo, useLinkSentence } from './KindsInfo'
import { ReportButton } from './ReportButton'
import { CardFooter, CardHead, ReviewCard } from './Card'
import { DictionariesPanel } from './DictionariesPanel'
import { Stage } from './Stage'
import { FormSource } from '../detail/Forms'
import { ResearchButton } from './ResearchButton'
import { same } from './board'
import { draftOf, partsOptions, setOf } from './cardOptions'
import { checkDraft, clearDraft, fingerprint, readDraft, writeDraft } from './drafts'

const S = strings(
  {
    loading: 'loading…',
    q_parts: 'What is {char} built from, as written today?',
    q_parts_hint: 'Base kanji stay whole. Otherwise take the split the sources give (the labels say which); history only when none helps; your own only when nothing else works.',
    q_forms: 'How is {char} related to these characters?',
    q_forms_hint: 'A form link never changes parts. “A form of” lends its meaning to every kanji with the part: check the lists.',
    q_meaning: '{char} has no meaning in the dictionary. What is it?',
    q_meaning_hint: 'A real character with its own meaning, a shape several old parts merged into (a name, not a meaning), or a form of a kanji (step above).',
    useProposal: 'Use the proposal',
    useDraft: 'Use the draft',
    sameAsNow: 'as it is now',
    edit: 'Edit',
    editTitle: 'Change the draft: the parts field opens with what it says',
    keepNow: 'Keep it as it is',
    atomic: 'No parts: it is learned as one piece',
    other: 'Something else',
    noParts: 'no parts',
    noLink: 'no link',
    confidence: 'model confidence {n}',
    lookalikes: 'only look alike',
    flagged: 'Why this card',
    changes: 'What this changes',
    noChange: 'Nothing changes.',
    linkProposed: 'Use the proposal',
    linkNow: 'Keep it as it is',
    linkOther: 'Something else',
    draftVerdict: 'the part’s draft says: {v}',
    v_keep: 'keep it',
    v_reject: 'it is wrong',
    m_proposed: 'Use the proposal',
    m_other: 'Something else',
    m_form: 'It is a form of a kanji (the link above lends its meaning)',
    m_none: 'Leave it with no meaning for now',
    conflict: 'A shape and “a form of” can’t both be right: the shape would win and the form of would lend nothing. Leave the form link as it is, or say it is a form of a kanji below.',
    s_parts_keep: 'keep {char}’s parts as they are',
    s_parts: 'give {char} the parts {parts}',
    s_atomic: 'make {char} a single piece, with no parts',
    s_link: 'set: {sentence}',
    s_link_keep: 'keep {pair} as it is',
    s_meaning: 'show on {char}’s page: {what}',
    s_meaning_keep: 'leave {char} with no meaning of its own',
    s_meaning_form: 'let {char} borrow the meaning of what it is a form of',
    save: 'save',
    oldForm: 'Old form',
    newForm: 'Today’s form',
    pickFirst: 'Pick an answer for each question first. Nothing is picked where the draft was unsure or nothing is proposed.',
    skip: 'skip',
    reset: 'reset card',
    resetTitle: 'Throw away what you chose on this card and start again',
    confirmReset: 'Throw away what you chose on this card?',
    workDropped: 'The proposal changed after you began this card. Your unsaved work on it was thrown away.',
  },
  {
    loading: 'зарежда се…',
    q_parts: 'От какво е построен {char}, както се пише днес?',
    q_parts_hint: 'Основните канджи остават цели. Иначе вземете делението от източниците (етикетите казват кои); историята само ако те не помагат; свое само ако нищо друго не става.',
    q_forms: 'Как е свързан {char} с тези знаци?',
    q_forms_hint: 'Връзка между форми никога не променя частите. „Форма на“ заема значението си на всяко канджи с частта: проверете списъците.',
    q_meaning: '{char} няма значение в речника. Какво е?',
    q_meaning_hint: 'Истински знак със свое значение, форма, в която са се слели няколко стари части (име, не значение), или форма на канджи (стъпката по-горе).',
    useProposal: 'Използвайте предложението',
    useDraft: 'Използвайте черновата',
    sameAsNow: 'както е сега',
    edit: 'Промяна',
    editTitle: 'Променете черновата: полето за части се отваря с нейния отговор',
    keepNow: 'Оставете го както е',
    atomic: 'Без части: учи се като едно цяло',
    other: 'Нещо друго',
    noParts: 'без части',
    noLink: 'няма връзка',
    confidence: 'увереност на модела {n}',
    lookalikes: 'само приличат',
    flagged: 'Защо е тази карта',
    changes: 'Какво променя',
    noChange: 'Нищо не се променя.',
    linkProposed: 'Използвайте предложението',
    linkNow: 'Оставете го както е',
    linkOther: 'Нещо друго',
    draftVerdict: 'черновата за частта казва: {v}',
    v_keep: 'запазете',
    v_reject: 'грешно е',
    m_proposed: 'Използвайте предложението',
    m_other: 'Нещо друго',
    m_form: 'Форма е на канджи (връзката по-горе заема значението му)',
    m_none: 'Оставете го без значение засега',
    conflict: 'Форма без значение и „форма на“ не могат да са верни заедно: формата печели и „форма на“ не заема нищо. Оставете връзката както е или кажете по-долу, че е форма на канджи.',
    s_parts_keep: 'запази частите на {char} както са',
    s_parts: 'даде на {char} частите {parts}',
    s_atomic: 'направи {char} едно цяло, без части',
    s_link: 'зададе: {sentence}',
    s_link_keep: 'оставете {pair} както е',
    s_meaning: 'покаже на страницата на {char}: {what}',
    s_meaning_keep: 'остави {char} без свое значение',
    s_meaning_form: 'остави {char} да заема значението на това, чиято форма е',
    save: 'запишете',
    oldForm: 'Стара форма',
    newForm: 'Днешна форма',
    pickFirst: 'Първо изберете отговор на всеки въпрос. Нищо не е избрано, където черновата не е сигурна или няма предложение.',
    skip: 'пропуснете',
    reset: 'нулирайте картата',
    resetTitle: 'Изхвърлете избраното на тази карта и започнете отначало',
    confirmReset: 'Да се изхвърли ли избраното на тази карта?',
    workDropped: 'Предложението се промени, след като започнахте тази карта. Незапазената ви работа по нея е изхвърлена.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

interface Work {
  parts?: { pick: string; custom: string[] }
  /** '' = nothing picked yet: an unsure draft, or a link check with nothing proposed. */
  forms: Record<string, { pick: '' | 'proposed' | 'now' | 'other'; value: FormLink }>
  meaning?: { pick: 'proposed' | 'other' | 'form' | 'none'; value: PartMeaning }
  reason: string
}

/** Below this the draft is a guess: the card starts with nothing picked, so the reviewer reads before saving. */
const UNSURE = 0.6

/**
 * Where the card starts: the draft when there is one, else the first proposal,
 * else as it is. An unsure draft, or a link check with nothing proposed, starts
 * with nothing picked, so a tired reviewer cannot save it unread.
 */
function startWork(card: Card): Work {
  const parts = card.items.filter((i) => i.type === 'decomposition')
  const forms = card.items.filter((i) => i.type === 'form_link')
  const meaning = card.items.find((i) => i.type === 'part_meaning')
  const draft = draftOf(parts)
  const options = partsOptions(parts, card.context.parts, draft)
  const work: Work = { forms: {}, reason: '' }
  if (parts.length)
    work.parts = { pick: draft ? (draft.confidence < UNSURE ? '' : 'draft') : options[0].key, custom: draft?.parts ?? card.context.parts }
  for (const f of forms)
    work.forms[f.id] = { pick: f.proposed ? 'proposed' : '', value: (f.proposed as FormLink) ?? (f.current as FormLink | null) ?? { kind: 'none', note: null } }
  if (meaning) work.meaning = { pick: 'proposed', value: meaning.proposed as PartMeaning }
  return work
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
  // Other dictionaries' entries for the character, on top of the card as on a meanings card.
  const [dicts, setDicts] = useState<KanjiDictionaries | null>(null)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState(false)
  // The (i) beside the forms and the meaning questions: what each choice means and changes.
  const [formsInfo, toggleFormsInfo] = useKindsInfo()
  const [partInfo, togglePartInfo] = useKindsInfo()
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.reviewDictionaries(char).then(
      (d) => live && setDicts(d),
      () => live && setDicts(null),
    )
    return () => {
      live = false
    }
  }, [char])

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
        // Work begun on other proposals (a redraft) is thrown away, and the card says so;
        // work kept from an older card layout whose answer is gone starts afresh.
        if (checkDraft(id, fingerprint(c.items.map((i) => [i.id, i.proposed])))) setProblem(t('workDropped'))
        const kept = readDraft(id)?.card as Work | undefined
        const keys = new Set(['', 'other', ...partsOptions(c.items.filter((i) => i.type === 'decomposition'), c.context.parts, draftOf(c.items)).map((o) => o.key)])
        setWork(kept && (!kept.parts || keys.has(kept.parts.pick)) ? kept : s)
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
  const chosen: string[] | null = !work?.parts || work.parts.pick === ''
    ? null
    : work.parts.pick === 'other'
      ? work.parts.custom
      : (options.find((o) => o.key === work.parts!.pick)?.parts ?? now)
  // A question with nothing picked yet: saving waits for it.
  const unpicked = !!work && (work.parts?.pick === '' || Object.values(work.forms).some((f) => f.pick === ''))
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
    if (!w || w.pick === 'now' || w.pick === '') return null
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
        // The item whose proposal it is carries the answer (an accept); else the first, as an edit.
        const carrier = pick.startsWith('p:') ? pick.slice(2) : (partsItems.find((i) => i.proposed && setOf(i.proposed as string[]) === setOf(chosen))?.id ?? partsItems[0].id)
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
    if (!skip && unpicked) return
    if (!skip && partsChange && !strokesOk(chosen, lang)) return
    setBusy(true)
    setProblem(null)
    try {
      const why = skip ? undefined : work.reason.trim() || undefined
      await askIfStale((staleOk) => api.decideCharacter(char, list, why, staleOk), lang)
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
    if (e.key === 's') send(true)
    else return
    e.preventDefault()
  })

  if (!card || !work) return <p className="hint">{problem ?? t('loading')}</p>
  // The item whose evidence carries the kanji book's split, for "use this split".
  const bookParts = partsItems.find((i) => i.evidence?.book != null)
  // Each kind of question has its own number on every card -- 1 parts, 2 relations, 3 a part's
  // meaning -- so the number says what is asked, as the handbook's chapters do, whichever a card has.
  const tiles = (p: string[]) => (p.length ? <PartTiles chars={p} onKanji={onKanji} /> : <span className="hint">{t('noParts')}</span>)
  const setParts = (patch: Partial<NonNullable<Work['parts']>>) => setWork({ ...work, parts: { ...work.parts!, ...patch } })
  const setForm = (fid: string, patch: Partial<Work['forms'][string]>) => setWork({ ...work, forms: { ...work.forms, [fid]: { ...work.forms[fid], ...patch } } })
  const setMeaning = (patch: Partial<NonNullable<Work['meaning']>>) => setWork({ ...work, meaning: { ...work.meaning!, ...patch } })
  const verdicts = (meaningItem?.evidence?.formLinks ?? {}) as Record<string, 'keep' | 'reject'>
  // Which sources give a split: KanjiVG, IDS, the kanji book, cjk-decomp …
  const splitKey = (p: string[]) => [...p].sort().join('')
  const givenBy = (p: string[]) => card.context.splits.filter((s) => splitKey(s.parts) === splitKey(p)).map((s) => s.source)

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
    <ReviewCard
      className="char-card"
      head={
        <CardHead
          glyph={char}
          notes={
            <>
              {/* Old forms come from an official list: shown, not asked. A doubt is a report. */}
              {[...(card.context.forms?.old ?? []).map((f) => ['old', f] as const), ...(card.context.forms?.new ?? []).map((f) => ['new', f] as const)].map(([k, f]) => (
                <p key={k + f.char} className="hint card-old-form">
                  {t(k === 'old' ? 'oldForm' : 'newForm')}: <span lang="ja">{f.char}</span> <FormSource source={f.source} />
                </p>
              ))}
              <ReportButton subject={`kanji:${char}`} from={id} />
            </>
          }
          actions={
            <>
              <ResearchButton card={card} />
              <DictLinks type="decomposition" subject={char} />
            </>
          }
        />
      }
      dicts={dicts && (dicts.kodansha || dicts.tsalta) ? <DictionariesPanel dicts={dicts} /> : undefined}
    >
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

        {work.parts && (
          <Stage n={1} title={t('q_parts', { char })}>
            <p className="hint">{t('q_parts_hint')}</p>
            <div className="card-options" role="radiogroup">
              {options.map((o) => {
                const isDraft = o.key === 'draft'
                const by = givenBy(o.parts)
                const chips = isDraft ? (['sonnet', ...by] as PartsSource[]) : by
                const editing = isDraft && work.parts!.pick === 'other'
                return (
                  <div key={o.key} className="card-option-wrap">
                    <label className="card-option" data-on={work.parts!.pick === o.key || editing || undefined} data-unsure={(isDraft && draft!.confidence < 0.6) || undefined}>
                      {isDraft && !editing && (
                        <button
                          type="button"
                          className="clear card-edit"
                          title={t('editTitle')}
                          onClick={(e) => {
                            e.preventDefault()
                            setParts({ pick: 'other', custom: draft!.parts })
                          }}
                        >
                          {t('edit')}
                        </button>
                      )}
                      <input type="radio" name={`parts-${id}`} checked={work.parts!.pick === o.key || editing} onChange={() => setParts({ pick: o.key })} />
                      <span className="card-option-label">
                        {o.key === 'now' ? t('keepNow') : o.key === 'atomic' ? t('atomic') : isDraft ? t('useDraft') : t('useProposal')}
                        {isDraft && setOf(o.parts) === setOf(now) && <span className="hint"> ({t('sameAsNow')})</span>}
                        {o.key !== 'atomic' && <>: {tiles(o.parts)}</>}
                        {chips.length > 0 && <SourceChips by={chips} onOpen={() => setNotes((n) => !n)} />}
                        {o.item?.reason && <span className="hint card-option-why">{o.item.reason}</span>}
                        {isDraft && (
                          <span className="card-draft">
                            <span className="hint">{t('confidence', { n: draft!.confidence })}</span> {draft!.why}
                            {!!draft!.lookalikes?.length && (
                              <span className="hint">
                                {' '}
                                · <span lang="ja">{draft!.lookalikes.join(' ')}</span> {t('lookalikes')}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </label>
                    {editing && <ValueEditor type="decomposition" value={work.parts!.custom} onChange={(v) => setParts({ custom: v as string[] })} />}
                  </div>
                )
              })}
              {!draft && (
                <>
                  <label className="card-option" data-on={work.parts.pick === 'other' || undefined}>
                    <input type="radio" name={`parts-${id}`} checked={work.parts.pick === 'other'} onChange={() => setParts({ pick: 'other' })} />
                    <span className="card-option-label">{t('other')}</span>
                  </label>
                  {work.parts.pick === 'other' && (
                    <ValueEditor type="decomposition" value={work.parts.custom} onChange={(v) => setParts({ custom: v as string[] })} />
                  )}
                </>
              )}
            </div>
            {!!draft?.flags?.length && (
              <p className="hint card-flags">
                {t('flagged')}: {draft.flags.join('; ')}
              </p>
            )}
            {notes && <SourceNotes splits={card.context.splits} now={now} />}
            <PartsEvidence detail={bookParts ?? partsItems[0]} oldForm={false} onKanji={onKanji} onUse={(v) => setParts({ pick: 'other', custom: v as string[] })} impact={false} />
            <div className="card-changes">
              <h5>{t('changes')}</h5>
              {!partsChange ? <p className="hint">{t('noChange')}</p> : impact ? <ImpactView imp={impact} onKanji={onKanji} /> : <p className="hint">{t('loading')}</p>}
            </div>
          </Stage>
        )}

        {formItems.length > 0 && (
          <Stage n={2} title={t('q_forms', { char })} extra={<KindsInfoButton open={formsInfo} onToggle={toggleFormsInfo} />}>
            {formsInfo && <KindsTable of="form" />}
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
          </Stage>
        )}

        {meaningItem && work.meaning && (
          <Stage n={3} title={t('q_meaning', { char })} extra={<KindsInfoButton open={partInfo} onToggle={togglePartInfo} />}>
            {partInfo && <KindsTable of="part" />}
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
          </Stage>
        )}

        {conflict && <p className="queue-warn">{t('conflict')}</p>}

        <CardFooter
          key={id}
          summary={summary}
          reason={work.reason}
          onReason={(r) => setWork({ ...work, reason: r })}
          problem={problem}
          before={unpicked && <p className="hint card-pick-first">{t('pickFirst')}</p>}
          actions={
            <>
              <button className="account-submit" disabled={busy || conflict || unpicked} title={unpicked ? t('pickFirst') : undefined} onClick={() => send(false)}>
                {t('save')}
              </button>
              <button className="clear" disabled={busy} onClick={() => send(true)}>
                {t('skip')}
              </button>
              <button className="clear queue-reset" disabled={busy || !changed} title={t('resetTitle')} onClick={reset}>
                {t('reset')}
              </button>
            </>
          }
        />
    </ReviewCard>
  )
}
