/**
 * Every way to write and read a word, as a dictionary prints them beside the
 * headword. On its page, two lines: "Written" 古い, 旧い, 故い (with kana
 * spellings like キレイ, the same sound) and "Read as" しょうもう, しょうこう (other
 * sounds). Each starts with the main one. A word in kana alone has only the
 * first. On a search card one small unlabelled line under the head, without
 * the headword and reading just above it.
 * A spelling in old kanji (學校 for 学校) or seldom used says so. Common forms
 * are white; one JMdict leaves unmarked beside a common one is grey (しょうこう),
 * and one it tags rare greyer still, with the tag.
 * After the spellings, other words that are a form of this one: its short form
 * (ＣＭ for コマーシャル) or older form (メーター for メートル), or the full or
 * standard word it is a form of. Each opens that word.
 */
import type { RelatedWord, Word } from '../api'
import { strings, useLang } from '../i18n'
import { katakanaToHiragana } from '../local/japanese'
import { warmKanji, warmWord } from '../warm'

const S = strings(
  {
    written: 'Written',
    readAs: 'Read as',
    rare: 'rare',
    rareTitle: 'Seldom written so',
    rareReadTitle: 'Seldom read so',
    oldKanji: 'old kanji',
    oldTitle: 'The same spelling in old kanji, as before 1946',
    oldOf: '{old}: the old form of {char}',
    open: 'Open {char}',
    short: 'short form',
    shortOf: 'full form',
    older: 'older form',
    olderOf: 'standard form',
    openWord: 'Open {word}',
  },
  {
    written: 'Пише се',
    readAs: 'Чете се',
    rare: 'рядко',
    rareTitle: 'Рядко се пише така',
    rareReadTitle: 'Рядко се чете така',
    oldKanji: 'стари канджи',
    oldTitle: 'Същото изписване със стари канджи, както преди 1946',
    oldOf: '{old}: старата форма на {char}',
    open: 'Отворете {char}',
    short: 'кратка форма',
    shortOf: 'пълна форма',
    older: 'стара форма',
    olderOf: 'стандартна форма',
    openWord: 'Отворете {word}',
  },
)

type Form = Word['forms'][number]

/**
 * On the word's page (`kanji` given) a kanji of another spelling with a page
 * opens it, and an old one says what it is the old form of; on a search card,
 * itself one button, the spellings are only read.
 */
export function Spellings({
  word: w,
  kanji,
  related,
}: {
  word: Word
  kanji?: { open: string[]; old: Record<string, string>; onPick: (char: string) => void }
  /** Words that are a short or older form of this one, or that it is one of (sense -1). */
  related?: { forms: RelatedWord[]; onWord: (w: Word) => void }
}) {
  const t = S(useLang())
  const others = (related?.forms ?? []).filter((r) => r.kind in FORM_TAGS)
  const open = new Set(kanji?.open ?? [])
  const old = kanji?.old ?? {}
  // A kana form that sounds like the reading is a spelling (キレイ); one that
  // does not is another reading (しょうこう). In a word in kana alone every
  // form is a spelling (ストアー).
  const kanaOnly = !w.forms.some((f) => !f.kana)
  const sound = katakanaToHiragana(w.reading)
  const isReading = (f: Form) => f.kana && !kanaOnly && katakanaToHiragana(f.text) !== sound
  const head = w.forms.find((f) => f.text === w.headword) ?? { text: w.headword, kana: kanaOnly, rare: false }
  const written = [head, ...w.forms.filter((f) => f.text !== w.headword && f.text !== w.reading && !isReading(f))]
  const reading = w.forms.find((f) => f.text === w.reading && f.kana) ?? { text: w.reading, kana: true, rare: false }
  const read = [reading, ...w.forms.filter((f) => f.text !== w.reading && isReading(f))]
  if (written.length < 2 && read.length < 2 && !others.length) return null

  const form = (f: Form, asRead: boolean) => {
    const main = f.text === (asRead ? w.reading : w.headword)
    const tag = f.old ? 'old' : f.rare ? 'rare' : null
    return (
      <span key={f.text} className="entry-spelling" data-rare={tag === 'rare' || undefined} data-seldom={(!tag && !main && f.seldom) || undefined}>
        <span lang="ja">
          {[...f.text].map((ch, i) => {
            const title = old[ch] ? t('oldOf', { old: ch, char: old[ch] }) : undefined
            return kanji && !main && open.has(ch) ? (
              <button key={i} className="entry-char" {...warmKanji(ch)} onClick={() => kanji.onPick(ch)} title={title ?? t('open', { char: ch })}>
                {ch}
              </button>
            ) : (
              <span key={i} className={title && 'entry-old-char'} title={title}>
                {ch}
              </span>
            )
          })}
        </span>
        {tag && (
          <span className="entry-spelling-tag" title={t(tag === 'old' ? 'oldTitle' : asRead ? 'rareReadTitle' : 'rareTitle')}>
            {t(tag === 'old' ? 'oldKanji' : 'rare')}
          </span>
        )}
      </span>
    )
  }
  const formWords = others.map((r) => (
    <span key={r.word.id} className="entry-spelling">
      <button className="entry-form-word" lang="ja" {...warmWord(r.word.id)} onClick={() => related?.onWord(r.word)} title={t('openWord', { word: r.word.headword })}>
        {r.word.headword}
      </button>
      <span className="entry-spelling-tag">{t(FORM_TAGS[r.kind as keyof typeof FORM_TAGS])}</span>
    </span>
  ))

  // A search card has the headword and reading just above, big: there only the others.
  if (!kanji) {
    return (
      <span className="entry-spellings">
        <span className="entry-spelling-list">
          {written.slice(1).map((f) => form(f, false))}
          {read.slice(1).map((f) => form(f, true))}
          {formWords}
        </span>
      </span>
    )
  }
  return (
    <span className="entry-spellings" data-page>
      <span className="entry-spellings-label">{t('written')}</span>
      <span className="entry-spelling-list">
        {written.map((f) => form(f, false))}
        {formWords}
      </span>
      {read.length > 1 && (
        <>
          <span className="entry-spellings-label">{t('readAs')}</span>
          <span className="entry-spelling-list">{read.map((f) => form(f, true))}</span>
        </>
      )}
    </span>
  )
}

/** What the other word is to this one, by the kind of its row. */
const FORM_TAGS = { short: 'short', shortOf: 'shortOf', older: 'older', olderOf: 'olderOf' } as const
