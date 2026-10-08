/**
 * What a kanji's cards carry beyond its groups (server/review.py, Dani 2026-10-07):
 *
 * - per group: what the kanji does in it (`about`) and its best examples;
 * - the card's steps after the board (Dani, 2026-10-08): 2, the kanji that
 *   mean the same, sorted into the groups step 1 left; 3, optional, the
 *   group holding the original meaning;
 * - per kanji: how it was built (`origin`), how its groups link, and the kanji
 *   it is easy to mix up with (they share a kun reading).
 *
 * The links start as Kodansha's candidates: those our own data backs start
 * in a group (or ticked). Only what the reviewer leaves there is kept;
 * Kodansha's own words (its glosses) are shown here only, to reviewers. The English is decided on
 * the meanings card, the Bulgarian on the kanji's Bulgarian card.
 *
 * Also the usage card: which kanji to write for a shared kun reading, from
 * Bunkacho's report, with its translations to check.
 */
import { useMemo, useState } from 'react'
import type { KanjiDictionaries, KanjiExtras, LinkCandidate, MeaningGroup, Mixup, UsageCard } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    extras: 'About the kanji',
    extrasHint: 'Drafted with the groups; check them like the groups. Shown to learners once accepted.',
    origin: 'How it was built',
    originHint: 'From Wiktionary’s glyph origin only: nothing it does not say.',
    originNone: 'no origin: the source says nothing about how it was built',
    unsure: 'the source calls this uncertain',
    link: 'How its meanings connect',
    linkHint: 'One sentence, in the groups’ order. Empty when they do not connect.',
    kokuji: 'Made in Japan (kokuji): Chinese has no such character.',
    mixups: 'Easy to mix up',
    mixupsHint: 'Kanji that share a kun reading with this one, as Kodansha lists them. Ticked ones are shown to learners. Those Bunkacho or our own lists also have start ticked.',
    none: 'none',
    about: 'What the kanji does in these words',
    examples: 'Learners see these words first',
    examplesHint: 'To change them, tap ☆ on a word below. Pick 2–3 common, clear words.',
    synonyms: '2. Kanji with the same meaning',
    synonymsHint: 'Put each kanji in the group where it means the same as {char}. Learners see the kanji you put in a group. If a kanji fits no group, leave it in “not the same meaning”.',
    synonymsMissing: 'A Kodansha meaning with no group to go in? Go back to step 1 and add the group.',
    synonymsNone: 'Kodansha lists no synonyms for this kanji. You can add one below.',
    kodanshaSense: 'Kodansha {sense}',
    kodanshaNoSense: 'Kodansha',
    added: 'Added by a reviewer',
    mainMeaning: 'its main meaning: {en}',
    notSame: 'not the same meaning',
    addKanji: '+ kanji',
    addSynonym: 'Add a kanji Kodansha does not list:',
    original: '3. Original meaning',
    optional: 'optional',
    originalHint: 'Kodansha marks this meaning as the kanji’s original one: “{text}”. Pick the group that holds it.',
    originalNone: 'Kodansha does not mark an original meaning for this kanji. You can leave this as it is.',
    originalNo: 'No group / Kodansha does not say',
    originalPlain: 'Pick the group that holds the kanji’s original meaning, if you know it. You can leave this as it is.',
    kodansha: 'Kodansha: {gloss}',
    unnamed: '(unnamed group)',
    bgAbout: 'In Bulgarian: what the kanji does in each group',
    bgOrigin: 'How it was built, in Bulgarian',
    bgLink: 'How its meanings connect, in Bulgarian',
    usageHint: 'Bunkacho’s report says which kanji to write for this reading. Check each translation against the Japanese; keep the examples that show the difference best.',
    def: 'Definition',
    examplesUsage: 'Examples',
    notes: 'Notes on borderline cases',
    removeExample: 'remove this example',
  },
  {
    extras: 'За канджито',
    extrasHint: 'Написани заедно с групите; проверете ги като групите. Показват се на учещите, щом се приемат.',
    origin: 'Как е построено',
    originHint: 'Само от произхода на знака в Уикиречника: нищо, което той не казва.',
    originNone: 'няма произход: източникът не казва как е построено',
    unsure: 'източникът го нарича несигурно',
    link: 'Как се свързват значенията',
    linkHint: 'Едно изречение, по реда на групите. Празно, когато не се свързват.',
    kokuji: 'Създадено в Япония (кокуджи): в китайския няма такъв знак.',
    mixups: 'Лесно се бъркат',
    mixupsHint: 'Канджи с общо четене кун с това, както ги дава Kodansha. Отметнатите се показват на учещите. Започват отметнати тези, които са и в списъка на Бункачо или в нашите.',
    none: 'няма',
    about: 'Какво прави канджито в тези думи',
    examples: 'Учещите виждат първо тези думи',
    examplesHint: 'За да ги смените, натиснете ☆ на дума по-долу. Изберете 2–3 чести, ясни думи.',
    synonyms: '2. Канджи със същото значение',
    synonymsHint: 'Сложете всяко канджи в групата, в която значи същото като {char}. Учещите виждат канджите, които сложите в група. Ако едно канджи не пасва на никоя група, оставете го в „не е същото значение“.',
    synonymsMissing: 'Значение от Kodansha, за което няма група? Върнете се на стъпка 1 и добавете групата.',
    synonymsNone: 'Kodansha не дава синоними за това канджи. Можете да добавите по-долу.',
    kodanshaSense: 'Kodansha {sense}',
    kodanshaNoSense: 'Kodansha',
    added: 'Добавени от проверяващ',
    mainMeaning: 'основно значение: {en}',
    notSame: 'не е същото значение',
    addKanji: '+ канджи',
    addSynonym: 'Добавете канджи, което Kodansha не дава:',
    original: '3. Първоначално значение',
    optional: 'по желание',
    originalHint: 'Kodansha отбелязва това значение като първоначалното на канджито: „{text}“. Изберете групата, в която е то.',
    originalNone: 'Kodansha не отбелязва първоначално значение за това канджи. Можете да го оставите така.',
    originalNo: 'Никоя група / Kodansha не казва',
    originalPlain: 'Изберете групата, в която е първоначалното значение на канджито, ако го знаете. Можете да го оставите така.',
    kodansha: 'Kodansha: {gloss}',
    unnamed: '(група без име)',
    bgAbout: 'На български: какво прави канджито във всяка група',
    bgOrigin: 'Как е построено, на български',
    bgLink: 'Как се свързват значенията, на български',
    usageHint: 'Докладът на Бункачо казва кое канджи да се пише за това четене. Сверете всеки превод с японския; оставете примерите, които показват разликата най-добре.',
    def: 'Определение',
    examplesUsage: 'Примери',
    notes: 'Бележки за граничните случаи',
    removeExample: 'махнете този пример',
  },
)

/** Kodansha's candidates for a kanji's card (item evidence, reviewers only). */
export interface Candidates {
  similar?: Record<string, LinkCandidate[]>
  unplaced?: LinkCandidate[]
  mixups?: LinkCandidate[]
}

export const candidatesOf = (evidence: unknown): Candidates => ((evidence as { candidates?: Candidates } | null)?.candidates ?? {})

const isKanji = (c: string) => /^[㐀-鿿豈-﫿]$/.test(c)

/** A ticked or unticked kanji: its glyph and our keyword, Kodansha's word in the tooltip. */
function LinkChip({ c, on, onToggle, title }: { c: { char: string; en?: string | null }; on: boolean; onToggle: () => void; title?: string }) {
  return (
    <button type="button" className="search-filter link-chip" data-on={on || undefined} aria-pressed={on} title={title} onClick={onToggle}>
      <span lang="ja">{c.char}</span>
      {c.en && <span className="link-chip-en">{c.en}</span>}
    </button>
  )
}

/** A small field that takes one kanji and adds it. */
function AddKanji({ onAdd }: { onAdd: (c: string) => void }) {
  const t = S(useLang())
  const [v, setV] = useState('')
  return (
    <input
      className="assoc-text link-add"
      lang="ja"
      value={v}
      placeholder={t('addKanji')}
      aria-label={t('addKanji')}
      maxLength={2}
      onChange={(e) => {
        const c = [...e.target.value].find(isKanji)
        if (c) {
          onAdd(c)
          setV('')
        } else setV(e.target.value)
      }}
    />
  )
}

/** Inside a group on the meanings board: what the kanji does in it, and its best examples (starred on the words). */
export function GroupExtras({
  group,
  onChange,
  headwords,
}: {
  group: MeaningGroup
  onChange: (patch: Partial<MeaningGroup>) => void
  /** word id -> headword, for the starred examples. */
  headwords: Map<number, string>
}) {
  const t = S(useLang())
  const examples = group.examples ?? []
  return (
    <div className="board-extras">
      <label className="board-extras-field">
        <span className="hint">{t('about')}</span>
        <textarea
          className="assoc-text board-about"
          rows={2}
          maxLength={500}
          value={group.about ?? ''}
          onChange={(e) => onChange({ about: e.target.value || undefined })}
        />
      </label>
      <p className="board-extras-row">
        <span className="hint">{t('examples')}:</span>{' '}
        {examples.length ? <span lang="ja">{examples.map((w) => headwords.get(w) ?? w).join('、')}</span> : <span className="hint">{t('none')}</span>}
        <span className="hint"> — {t('examplesHint')}</span>
      </p>
    </div>
  )
}

/** A synonym on the meanings card: Kodansha's word for the shared meaning, and which of its senses it is of. */
interface Synonym {
  char: string
  gloss: string | null
  en: string | null
  sense: string | null
}

/** Kodansha's sense numbers: a synonym of sense 1 is of 1a and 1b too; one of 2a only of 2a. */
const covers = (n: string, sense: string) => sense === n || (sense.startsWith(n) && /^[a-z]+$/.test(sense.slice(n.length)))

/** Kodansha prints its core meanings in capitals: FEUDAL DOMAIN reads as feudal domain. */
const quiet = (s: string) => (/[a-z]/.test(s) ? s : s.toLowerCase())

const ORIGINAL = /\[original meaning[^\]]*\]?/i

/** A Kodansha sense's text as a line: no original-meaning mark, no bold marks. */
const senseLine = (text: string) => text.replace(ORIGINAL, '').replace(/\*\*/g, '').trim()

/** A row of choices: the groups (numbered as on the board), then "none", pressed when no group is. */
function Picks({
  groups,
  on,
  onPick,
  none,
  label,
}: {
  groups: MeaningGroup[]
  on: (id: string) => boolean
  onPick: (id: string | null) => void
  none: string
  label: string
}) {
  const t = S(useLang())
  const empty = !groups.some((g) => on(g.id))
  return (
    <span className="step-picks" role="group" aria-label={label}>
      {groups.map((g, i) => (
        <button key={g.id} type="button" className="search-filter" data-on={on(g.id) || undefined} aria-pressed={on(g.id)} onClick={() => onPick(g.id)}>
          {i + 1}. {g.en.trim() || t('unnamed')}
        </button>
      ))}
      <button type="button" className="search-filter step-none" data-on={empty || undefined} aria-pressed={empty} onClick={() => onPick(null)}>
        {none}
      </button>
    </span>
  )
}

/**
 * Step 2 of a meanings card: Kodansha's synonyms of the kanji, each put in
 * the groups where it means the same (邦 is 国 both as country and as
 * Japan), or in none. One pool for the kanji,
 * sorted into the groups step 1 left, so a group the draft lacked still gets
 * its synonyms. They are listed by Kodansha's sense: a sense whose synonyms
 * fit no group shows a group is missing (国: 藩 領 封 荘, "feudal domain").
 */
export function SynonymsStep({
  char,
  groups,
  onGroups,
  candidates,
  dicts,
}: {
  char: string
  groups: MeaningGroup[]
  onGroups: (g: MeaningGroup[]) => void
  candidates: Candidates
  dicts?: KanjiDictionaries | null
}) {
  const t = S(useLang())
  // Kanji a reviewer added that Kodansha does not list, kept in sight while in no group.
  const [added, setAdded] = useState<string[]>([])
  // The candidates (in scope, one kanji each), a row per Kodansha sense they are listed under, with that sense's word.
  const pool = useMemo(() => {
    const out = new Map<string, Synonym[]>()
    for (const c of [...Object.values(candidates.similar ?? {}).flat(), ...(candidates.unplaced ?? [])]) {
      if (out.has(c.char)) continue
      const listed = (dicts?.kodansha?.synonyms ?? []).filter((x) => x.char === c.char)
      out.set(
        c.char,
        listed.length
          ? listed.map((x) => ({ char: c.char, gloss: quiet(x.gloss), en: c.en, sense: x.n }))
          : [{ char: c.char, gloss: c.gloss ? quiet(c.gloss) : null, en: c.en, sense: c.sense ?? null }],
      )
    }
    return out
  }, [candidates, dicts])
  const bySense = useMemo(() => {
    const m = new Map<string, Synonym[]>()
    for (const s of [...pool.values()].flat()) {
      const k = s.sense ?? ''
      if (!m.has(k)) m.set(k, [])
      if (!m.get(k)!.some((x) => x.char === s.char)) m.get(k)!.push(s)
    }
    // In the book's order; synonyms of no known sense last.
    return [...m].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })))
  }, [pool])
  const senseText = (n: string) =>
    (dicts?.kodansha?.senses ?? [])
      .filter((s) => covers(n, s.n))
      .map((s) => senseLine(s.text))
      .filter(Boolean)
      .join(' · ')
  const extra = [...new Set([...groups.flatMap((g) => g.similar ?? []), ...added])].filter((c) => !pool.has(c))
  const inGroup = (c: string, id: string) => !!groups.find((g) => g.id === id)?.similar?.includes(c)

  /** In or out of one group; `null`: out of every group. */
  function put(c: string, to: string | null) {
    if (!pool.has(c) && !added.includes(c)) setAdded((a) => [...a, c])
    onGroups(
      groups.map((g) => {
        const has = (g.similar ?? []).includes(c)
        if (to === null ? !has : g.id !== to) return g
        const next = has ? (g.similar ?? []).filter((x) => x !== c) : [...(g.similar ?? []), c]
        return { ...g, similar: next.length ? next : undefined }
      }),
    )
  }

  const row = (s: Synonym) => (
    <li key={s.char} className="step-row">
      <span className="step-char" lang="ja">
        {s.char}
      </span>
      <span className="step-gloss">
        {s.gloss}
        {s.en && <span className="hint"> · {t('mainMeaning', { en: s.en })}</span>}
      </span>
      <Picks groups={groups} on={(id) => inGroup(s.char, id)} onPick={(to) => put(s.char, to)} none={t('notSame')} label={s.char} />
    </li>
  )

  return (
    <section className="board-step">
      <h4>{t('synonyms')}</h4>
      <p className="hint">{t('synonymsHint', { char })}</p>
      <p className="hint">{pool.size ? t('synonymsMissing') : t('synonymsNone')}</p>
      {bySense.map(([n, list]) => {
        const text = n ? senseText(n) : ''
        return (
          <div key={n} className="step-sense">
            <h5>
              {n ? t('kodanshaSense', { sense: n }) : t('kodanshaNoSense')}
              {text && <span className="hint"> — {text}</span>}
            </h5>
            <ul className="step-list">{list.map(row)}</ul>
          </div>
        )
      })}
      {extra.length > 0 && (
        <div className="step-sense">
          <h5>{t('added')}</h5>
          <ul className="step-list">{extra.map((c) => row({ char: c, gloss: null, en: null, sense: null }))}</ul>
        </div>
      )}
      <p className="step-add">
        <span className="hint">{t('addSynonym')}</span>{' '}
        <AddKanji onAdd={(c) => c !== char && !pool.has(c) && !added.includes(c) && setAdded((a) => [...a, c])} />
      </p>
    </section>
  )
}

/** Step 3 of a meanings card, optional: the group that holds the kanji's original meaning, as Kodansha marks it. */
export function OriginalStep({
  groups,
  onGroups,
  dicts,
}: {
  groups: MeaningGroup[]
  onGroups: (g: MeaningGroup[]) => void
  dicts?: KanjiDictionaries | null
}) {
  const t = S(useLang())
  const marked = (dicts?.kodansha?.senses ?? []).filter((s) => ORIGINAL.test(s.text))
  const text = marked.map((s) => senseLine(s.text)).filter(Boolean).join(' · ')
  const at = groups.find((g) => g.original)?.id ?? null
  return (
    <section className="board-step">
      <h4>
        {t('original')} <span className="hint">{t('optional')}</span>
      </h4>
      <p className="hint">{!dicts?.kodansha ? t('originalPlain') : marked.length ? t('originalHint', { text }) : t('originalNone')}</p>
      <Picks
        groups={groups}
        on={(id) => id === at}
        onPick={(id) => onGroups(groups.map((g) => ({ ...g, original: g.id === id || undefined })))}
        none={t('originalNo')}
        label={t('original')}
      />
    </section>
  )
}

/** The kanji's own extras on its meanings card: origin, link, kokuji, and the kanji easy to mix up with it. */
export function KanjiExtrasEditor({
  value,
  onChange,
  candidates,
  kokuji,
}: {
  value: KanjiExtras
  onChange: (v: KanjiExtras) => void
  candidates: Candidates
  kokuji: boolean
}) {
  const t = S(useLang())
  const set = (patch: Partial<KanjiExtras>) => onChange({ ...value, ...patch })
  const offered = candidates.mixups ?? []
  const on = (c: string) => value.mixups.some((m) => m.char === c)
  const toggle = (m: Mixup) => set({ mixups: on(m.char) ? value.mixups.filter((x) => x.char !== m.char) : [...value.mixups, m] })
  const extra = value.mixups.filter((m) => !offered.some((o) => o.char === m.char))
  return (
    <section className="extras">
      <h4>{t('extras')}</h4>
      <p className="hint">{t('extrasHint')}</p>
      {kokuji && <p className="extras-kokuji">{t('kokuji')}</p>}
      <label className="review-field">
        <span>
          {t('origin')} <span className="hint">{t('originHint')}</span>
        </span>
        <textarea
          className="assoc-text"
          rows={3}
          maxLength={600}
          value={value.origin ?? ''}
          placeholder={t('originNone')}
          onChange={(e) => set({ origin: e.target.value || null, originSure: e.target.value ? (value.originSure ?? true) : null })}
        />
      </label>
      {value.origin && (
        <label className="board-original">
          <input type="checkbox" checked={value.originSure === false} onChange={(e) => set({ originSure: !e.target.checked })} /> {t('unsure')}
        </label>
      )}
      <label className="review-field">
        <span>
          {t('link')} <span className="hint">{t('linkHint')}</span>
        </span>
        <textarea className="assoc-text" rows={2} maxLength={600} value={value.link ?? ''} onChange={(e) => set({ link: e.target.value || null })} />
      </label>
      <div className="review-field">
        <span>
          {t('mixups')} <span className="hint">{t('mixupsHint')}</span>
        </span>
        <div className="link-row">
          {offered.length === 0 && extra.length === 0 && <span className="hint">{t('none')}</span>}
          {offered.map((c) => (
            <span key={c.char} className="link-mixup">
              <span className="hint" lang="ja">
                {c.reading}
              </span>
              <LinkChip c={c} on={on(c.char)} onToggle={() => toggle({ char: c.char, reading: c.reading ?? '' })} title={t('kodansha', { gloss: c.gloss })} />
            </span>
          ))}
          {extra.map((m) => (
            <span key={m.char} className="link-mixup">
              <span className="hint" lang="ja">
                {m.reading}
              </span>
              <LinkChip c={m} on onToggle={() => toggle(m)} />
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The Bulgarian of a kanji's extras, on its Bulgarian card: each group's about, the origin, the link. */
export function BgExtras({
  groups,
  aboutBg,
  onAboutBg,
  extras,
  onExtras,
}: {
  groups: MeaningGroup[]
  aboutBg: Record<string, string>
  onAboutBg: (v: Record<string, string>) => void
  extras: KanjiExtras | null
  onExtras: (v: KanjiExtras) => void
}) {
  const t = S(useLang())
  const withAbout = groups.filter((g) => g.about)
  return (
    <div className="bg-groups bg-extras">
      {withAbout.length > 0 && (
        <>
          <span>{t('bgAbout')}</span>
          <ul className="bg-labels">
            {withAbout.map((g) => (
              <li key={g.id}>
                <span className="bg-label-en">
                  <b>{g.en}</b>
                </span>
                <span className="hint">{g.about}</span>
                <textarea
                  className="assoc-text"
                  lang="bg"
                  rows={2}
                  maxLength={500}
                  value={aboutBg[g.id] ?? ''}
                  aria-label={`${g.en}: ${t('bgAbout')}`}
                  data-changed={(aboutBg[g.id] ?? '') !== (g.aboutBg ?? '') || undefined}
                  onChange={(e) => onAboutBg({ ...aboutBg, [g.id]: e.target.value })}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {extras?.origin && (
        <label className="review-field">
          <span>{t('bgOrigin')}</span>
          <span className="hint">{extras.origin}</span>
          <textarea className="assoc-text" lang="bg" rows={3} maxLength={600} value={extras.originBg ?? ''} onChange={(e) => onExtras({ ...extras, originBg: e.target.value || null })} />
        </label>
      )}
      {extras?.link && (
        <label className="review-field">
          <span>{t('bgLink')}</span>
          <span className="hint">{extras.link}</span>
          <textarea className="assoc-text" lang="bg" rows={2} maxLength={600} value={extras.linkBg ?? ''} onChange={(e) => onExtras({ ...extras, linkBg: e.target.value || null })} />
        </label>
      )}
    </div>
  )
}

/** A usage card: each spelling's definition and examples, the report's Japanese beside the translations. */
export function UsageEditor({ value, onChange }: { value: UsageCard; onChange: (v: UsageCard) => void }) {
  const t = S(useLang())
  const setSpelling = (i: number, patch: Partial<UsageCard['spellings'][number]>) =>
    onChange({ ...value, spellings: value.spellings.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  return (
    <div className="usage-card">
      <p className="hint">{t('usageHint')}</p>
      {value.spellings.map((s, i) => (
        <section key={i} className="usage-spelling">
          <h4 lang="ja">{s.kanji}</h4>
          <p lang="ja" className="usage-def">
            {s.def}
          </p>
          <label className="review-field">
            <span>{t('def')} · EN</span>
            <input className="assoc-text" value={s.defEn ?? ''} maxLength={300} onChange={(e) => setSpelling(i, { defEn: e.target.value || null })} />
          </label>
          <label className="review-field">
            <span>{t('def')} · BG</span>
            <input className="assoc-text" lang="bg" value={s.defBg ?? ''} maxLength={300} onChange={(e) => setSpelling(i, { defBg: e.target.value || null })} />
          </label>
          <span className="hint">{t('examplesUsage')}</span>
          <ul className="usage-examples">
            {s.examples.map((x, k) => {
              const setEx = (patch: Partial<typeof x>) => setSpelling(i, { examples: s.examples.map((y, m) => (m === k ? { ...y, ...patch } : y)) })
              return (
                <li key={k}>
                  <span lang="ja" className="usage-ja">
                    {x.ja}
                  </span>
                  <input className="assoc-text" lang="ja" value={x.kana ?? ''} maxLength={300} aria-label="kana" onChange={(e) => setEx({ kana: e.target.value || null })} />
                  <input className="assoc-text" value={x.en ?? ''} maxLength={300} aria-label="EN" onChange={(e) => setEx({ en: e.target.value || null })} />
                  <input className="assoc-text" lang="bg" value={x.bg ?? ''} maxLength={300} aria-label="BG" onChange={(e) => setEx({ bg: e.target.value || null })} />
                  <button type="button" className="clear" title={t('removeExample')} onClick={() => setSpelling(i, { examples: s.examples.filter((_, m) => m !== k) })}>
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {value.notes.length > 0 && (
        <section className="usage-notes">
          <h4>{t('notes')}</h4>
          {value.notes.map((n, i) => {
            const setNote = (patch: Partial<typeof n>) => onChange({ ...value, notes: value.notes.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={i} className="usage-note">
                <p lang="ja" className="hint">
                  {n.ja}
                </p>
                <textarea className="assoc-text" rows={2} maxLength={800} value={n.en ?? ''} aria-label="EN" onChange={(e) => setNote({ en: e.target.value || null })} />
                <textarea className="assoc-text" lang="bg" rows={2} maxLength={800} value={n.bg ?? ''} aria-label="BG" onChange={(e) => setNote({ bg: e.target.value || null })} />
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
