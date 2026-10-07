/**
 * What a kanji's cards carry beyond its groups (server/review.py, Dani 2026-10-07):
 *
 * - per group: what the kanji does in it (`about`), its best examples, whether
 *   it holds the original meaning, and the kanji that mean the same in it;
 * - per kanji: how it was built (`origin`), how its groups link, and the kanji
 *   it is easy to mix up with (they share a kun reading).
 *
 * The links start as Kodansha's candidates: those our own data backs start
 * ticked. Only what the reviewer leaves ticked is kept; Kodansha's own words
 * (its glosses) are shown here only, to reviewers. The English is decided on
 * the meanings card, the Bulgarian on the kanji's Bulgarian card.
 *
 * Also the usage card: which kanji to write for a shared kun reading, from
 * Bunkacho's report, with its translations to check.
 */
import { useState } from 'react'
import type { KanjiExtras, LinkCandidate, MeaningGroup, Mixup, UsageCard } from '../api'
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
    original: 'original meaning',
    originalTitle: 'Kodansha marks this as the kanji’s original meaning. Untick it if the group is not where that meaning went.',
    examples: 'Best examples',
    examplesHint: 'Star the 2–3 words that show the group best (☆ on a word).',
    similar: 'Same meaning here',
    similarHint: 'Kanji that mean what this group means. Kodansha’s word is in the tooltip.',
    addSimilar: 'add from the others…',
    addKanji: '+ kanji',
    kodansha: 'Kodansha: {gloss}',
    kodanshaSense: 'Kodansha, sense {sense}: {gloss}',
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
    original: 'първоначално значение',
    originalTitle: 'Kodansha отбелязва това като първоначалното значение на канджито. Махнете отметката, ако значението не е отишло в тази група.',
    examples: 'Най-добри примери',
    examplesHint: 'Отбележете със звезда 2–3 думи, които показват групата най-добре (☆ на думата).',
    similar: 'Същото значение тук',
    similarHint: 'Канджи, които значат това, което значи групата. Думата на Kodansha е в подсказката.',
    addSimilar: 'добавете от другите…',
    addKanji: '+ канджи',
    kodansha: 'Kodansha: {gloss}',
    kodanshaSense: 'Kodansha, значение {sense}: {gloss}',
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

/** Inside a group on the meanings board: its about line, original meaning, examples and same-meaning kanji. */
export function GroupExtras({
  char,
  group,
  onChange,
  candidates,
  headwords,
}: {
  char: string
  group: MeaningGroup
  onChange: (patch: Partial<MeaningGroup>) => void
  candidates: Candidates
  /** word id -> headword, for the starred examples. */
  headwords: Map<number, string>
}) {
  const t = S(useLang())
  const offered = candidates.similar?.[group.id] ?? []
  const similar = group.similar ?? []
  const extra = similar.filter((c) => !offered.some((o) => o.char === c))
  const others = (candidates.unplaced ?? []).filter((c) => !similar.includes(c.char))
  const toggle = (c: string) => onChange({ similar: similar.includes(c) ? similar.filter((x) => x !== c) : [...similar, c] })
  return (
    <div className="board-extras">
      <textarea
        className="assoc-text board-about"
        rows={2}
        maxLength={500}
        value={group.about ?? ''}
        placeholder={t('about')}
        aria-label={t('about')}
        onChange={(e) => onChange({ about: e.target.value || undefined })}
      />
      <div className="board-extras-row">
        <label className="board-original" title={t('originalTitle')}>
          <input type="checkbox" checked={!!group.original} onChange={(e) => onChange({ original: e.target.checked || undefined })} /> {t('original')}
        </label>
        <span className="hint" title={t('examplesHint')}>
          {t('examples')}:{' '}
          {(group.examples ?? []).length ? (
            <span lang="ja">{(group.examples ?? []).map((w) => headwords.get(w) ?? w).join('、')}</span>
          ) : (
            t('none')
          )}
        </span>
      </div>
      <div className="board-extras-row link-row" title={t('similarHint')}>
        <span className="hint">{t('similar')}:</span>
        {offered.map((c) => (
          <LinkChip key={c.char} c={c} on={similar.includes(c.char)} onToggle={() => toggle(c.char)} title={t('kodansha', { gloss: c.gloss })} />
        ))}
        {extra.map((c) => (
          <LinkChip key={c} c={{ char: c }} on onToggle={() => toggle(c)} />
        ))}
        {others.length > 0 && (
          <select
            className="link-more"
            value=""
            aria-label={t('addSimilar')}
            onChange={(e) => e.target.value && toggle(e.target.value)}
          >
            <option value="">{t('addSimilar')}</option>
            {others.map((c) => (
              <option key={c.char} value={c.char}>
                {c.char} {c.en ?? ''} · {t('kodanshaSense', { sense: c.sense ?? '?', gloss: c.gloss })}
              </option>
            ))}
          </select>
        )}
        <AddKanji onAdd={(c) => c !== char && !similar.includes(c) && toggle(c)} />
      </div>
    </div>
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
