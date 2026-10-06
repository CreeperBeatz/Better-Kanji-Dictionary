/**
 * What a review item is judged by, per type: the glyphs, what would change
 * upstream, the old form, the kanji a part is in, the word and its glosses.
 * Shared by the queue's cards and a character's card (CharacterCard.tsx).
 */
import { useState, type ReactNode } from 'react'
import type { BookOld, BookPartView, BookSplit, Impact, ItemDetail, TaskValue } from '../api'
import { strings, useLang } from '../i18n'
import { FontStrip } from '../detail/FontStrip'
import { KanjiFacts, PartTiles } from './editors'
import { useKindLabel } from './KindsInfo'
import { BookOldView, BookPartPanel, BookSplitView } from './BookEvidence'

const S = strings(
  {
    jmdict: 'The English now (JMdict)',
    removed: 'Loses as a part',
    added: 'Gains as a part',
    lost: 'No longer a prerequisite',
    gained: 'New prerequisites',
    newEdge: 'This adds a containment edge: the order moves.',
    containers: '{n} kanji contain it ({joyo} jōyō), all affected:',
    notes: '{n} public notes mention a part it would lose:',
    oldForm: 'Old form',
    oldHint: 'Evidence for the story, not for the parts: judge the parts by the shape written today.',
    pickHint: 'Pick what {char} contributes to the word, not what the word means overall.',
    usedIn: 'In {n} kanji with a rating',
    usedInNone: 'In no kanji with a rating',
    usedInHint: 'Every kanji that is common, jōyō or JLPT-rated and contains it, at any depth; most frequent first.',
    inBoth: '{n} in both',
    showAll: 'show all {n}',
    showFewer: 'show fewer',
    noMeaning: 'no meaning of its own',
    unihan: 'Unihan',
    unihanHint: 'Chinese-centred; often a surname or a place, not what the part does in Japanese kanji.',
    oldForms: 'old forms are shown under each kanji that has one',
  },
  {
    jmdict: 'Английският сега (JMdict)',
    removed: 'Губи като част',
    added: 'Получава като част',
    lost: 'Вече не е предпоставка',
    gained: 'Нови предпоставки',
    newEdge: 'Това добавя ребро на съдържане: редът се мести.',
    containers: '{n} канджи го съдържат ({joyo} джойо), всички засегнати:',
    notes: '{n} публични бележки споменават част, която би изчезнала:',
    oldForm: 'Стара форма',
    oldHint: 'Доказателство за историята, не за частите: частите се съдят по днешната форма.',
    pickHint: 'Изберете какво внася {char} в думата, а не какво значи думата като цяло.',
    usedIn: 'В {n} канджи с оценка',
    usedInNone: 'В нито едно канджи с оценка',
    usedInHint: 'Всяко канджи, което е често срещано, джойо или с ниво от JLPT и го съдържа на каквато и да е дълбочина; най-честите първи.',
    inBoth: '{n} в двете',
    showAll: 'покажете всички {n}',
    showFewer: 'покажете по-малко',
    noMeaning: 'няма свое значение',
    unihan: 'Unihan',
    unihanHint: 'Насочен към китайския; често фамилия или място, а не това, което частта прави в японските канджи.',
    oldForms: 'старите форми са показани под всяко канджи, което има такава',
  },
)

type OnKanji = ((char: string) => void) | undefined

/** What changing a character's parts would do upstream. */
export function ImpactView({ imp, onKanji }: { imp: Impact; onKanji?: OnKanji }) {
  const t = S(useLang())
  const glyphs = (chars: string[]) => <PartTiles chars={chars} onKanji={onKanji} />
  return (
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
  )
}

/** A decomposition: the book's split (which `onUse` takes as the answer), the old form, and the impact. */
/** `oldForm`: false where the old form is shown already (a character's card has it in its head). */
export function PartsEvidence({ detail, onKanji, onUse, impact = true, oldForm = true }: { detail: ItemDetail; onKanji?: OnKanji; onUse?: (v: TaskValue) => void; impact?: boolean; oldForm?: boolean }) {
  const t = S(useLang())
  const book = detail.evidence?.book
  const old = oldForm ? (detail.context.forms?.old ?? []) : []
  return (
    <div className="queue-evidence">
      {book != null && (
        <BookSplitView view={book as BookSplit} current={detail.current as string[] | null} proposed={detail.proposed as string[] | null} onUse={onUse} />
      )}
      {old.length > 0 && (
        <p title={t('oldHint')}>
          <span className="hint">{t('oldForm')}: </span>
          <PartTiles chars={old.map((o) => o.char)} onKanji={onKanji} /> {old[0].note && <span className="hint">{old[0].note}</span>}
        </p>
      )}
      {impact && detail.impact && <ImpactView imp={detail.impact} onKanji={onKanji} />}
    </div>
  )
}

/** A form link: both characters in every font, each with its meanings and the rated kanji it is in. */
export function FormEvidence({ detail, onKanji }: { detail: ItemDetail; onKanji?: OnKanji }) {
  const t = S(useLang())
  const [a, b] = detail.subject.split('|')
  const users = detail.context.users as { a: string[]; b: string[] } | undefined
  const meanings = detail.context.meanings
  const both = users ? users.a.filter((c) => users.b.includes(c)).length : 0
  const book = detail.evidence?.book
  return (
    <div className="queue-evidence">
      <div className="queue-sides">
        {(['a', 'b'] as const).map((k) => (
          <section key={k} className="queue-side">
            <FontStrip char={k === 'a' ? a : b} />
            <p className="queue-side-meaning">{meanings?.[k]?.slice(0, 3).join(', ') || <span className="hint">{t('noMeaning')}</span>}</p>
            {users && <UsedIn chars={users[k]} onKanji={onKanji} />}
          </section>
        ))}
      </div>
      {both > 0 && <p className="hint">{t('inBoth', { n: both })}</p>}
      {book != null && <BookOldView view={book as BookOld} />}
    </div>
  )
}

/** What an item is judged by, per type. `onUse` takes a value the evidence offers (the book's split) as the answer. */
export function Evidence({ detail, onKanji, onUse }: { detail: ItemDetail; onKanji?: OnKanji; onUse?: (v: TaskValue) => void }) {
  const lang = useLang()
  const t = S(lang)
  if (detail.type === 'decomposition') return <PartsEvidence detail={detail} onKanji={onKanji} onUse={onUse} />
  if (detail.type === 'form_link') return <FormEvidence detail={detail} onKanji={onKanji} />
  if (detail.type === 'part_meaning') return <PartEvidence detail={detail} onKanji={onKanji} />

  const c = detail.context
  return (
    <div className="queue-evidence">
      <dl className="queue-compare">
        <KanjiFacts context={c} />
      </dl>
      {detail.type === 'report' && c.word && (
        <div className="queue-word">
          <h4>{t('jmdict')}</h4>
          <p>
            <span className="queue-word-head" lang="ja">
              {c.word.headword}
            </span>{' '}
            <span lang="ja">{c.word.reading}</span>
          </p>
          <ol>
            {c.word.senses.map((s, i) => (
              <li key={i}>
                {s.pos.length > 0 && <span className="hint">{s.pos.join(', ')} </span>}
                {s.gloss}
              </li>
            ))}
          </ol>
        </div>
      )}
      {detail.type === 'report' && c.char && <FontStrip char={c.char} />}
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

/** The kanji in scope a character is in, most frequent first: the first few, then all on request. */
export function UsedIn({ chars, onKanji, old }: { chars: string[]; onKanji?: OnKanji; old?: Record<string, string> }) {
  const t = S(useLang())
  const [all, setAll] = useState(false)
  const FEW = 48
  const shown = all ? chars : chars.slice(0, FEW)
  return (
    <div className="queue-used">
      <p className="hint" title={t('usedInHint')}>
        {chars.length ? t('usedIn', { n: chars.length }) : t('usedInNone')}
      </p>
      {old ? (
        <span className="review-parts queue-used-old" lang="ja">
          {shown.map((c) => (
            <span key={c} className="queue-used-one">
              <button className="review-part" onClick={() => onKanji?.(c)}>
                {c}
              </button>
              {old[c] && <span className="queue-used-was">{old[c]}</span>}
            </span>
          ))}
        </span>
      ) : (
        <PartTiles chars={shown} onKanji={onKanji} />
      )}
      {chars.length > FEW && (
        <button className="clear" onClick={() => setAll((a) => !a)}>
          {all ? t('showFewer') : t('showAll', { n: chars.length })}
        </button>
      )}
    </div>
  )
}

/** A part's meaning is judged by the kanji it is in and what it was in their old forms. */
export function PartEvidence({ detail, onKanji }: { detail: ItemDetail; onKanji?: OnKanji }) {
  const t = S(useLang())
  const kindLabel = useKindLabel()
  const c = detail.context
  const unihan = typeof detail.evidence?.unihan === 'string' ? detail.evidence.unihan : null
  const forms = c.forms
  const row = (label: string, items: { char: string; note: string | null }[] | undefined): ReactNode =>
    items && items.length > 0 ? (
      <>
        <dt>{label}</dt>
        <dd>
          {items.map((i) => (
            <span key={i.char}>
              <span lang="ja">{i.char}</span>
              {i.note && <span className="hint"> {i.note}</span>}{' '}
            </span>
          ))}
        </dd>
      </>
    ) : null
  return (
    <div className="queue-evidence">
      <dl className="queue-compare">
        <KanjiFacts context={c} />
        {unihan && (
          <>
            <dt title={t('unihanHint')}>{t('unihan')}</dt>
            <dd>{unihan}</dd>
          </>
        )}
        {row(kindLabel('form_of'), forms?.formOf)}
        {row(kindLabel('looks_like'), forms?.looksLike)}
        {row(kindLabel('positional'), forms?.positional)}
      </dl>
      {detail.evidence?.book != null && <BookPartPanel view={detail.evidence.book as BookPartView} />}
      {Array.isArray(c.users) && (
        <>
          <UsedIn chars={c.users} onKanji={onKanji} old={c.old ?? {}} />
          {c.old && Object.keys(c.old).length > 0 && <p className="hint">{t('oldForms')}</p>}
        </>
      )}
    </div>
  )
}
