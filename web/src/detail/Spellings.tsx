/**
 * Every way to write a word, as a dictionary prints them beside the headword:
 * 古い, 旧い, 故い. The same on its page and on its search card. The headword
 * first; a spelling in old kanji (學校 for 学校) or seldom used says so. Its
 * reading is under the headword, so only other kana (キレイ) are here.
 * After them, other words that are a form of this one: its short form (ＣＭ
 * for コマーシャル) or older form (メーター for メートル), or the full or standard
 * word it is a form of. Each opens that word.
 */
import type { RelatedWord, Word } from '../api'
import { strings, useLang } from '../i18n'
import { warmKanji, warmWord } from '../warm'

const S = strings(
  {
    spellings: 'Written',
    rare: 'rare',
    rareTitle: 'Seldom written so',
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
    spellings: 'Пише се',
    rare: 'рядко',
    rareTitle: 'Рядко се пише така',
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
  const forms = w.forms.filter((f) => f.text !== w.reading)
  const others = (related?.forms ?? []).filter((r) => r.kind in FORM_TAGS)
  if (!forms.some((f) => f.text !== w.headword) && !others.length) return null
  const open = new Set(kanji?.open ?? [])
  const old = kanji?.old ?? {}
  const shown = [...forms.filter((f) => f.text === w.headword), ...forms.filter((f) => f.text !== w.headword)]
  return (
    <span className="entry-spellings">
      <span className="entry-spellings-label">{t('spellings')}</span>
      <span className="entry-spelling-list">
        {shown.map((f) => {
          const tag = f.old ? 'old' : f.rare ? 'rare' : null
          return (
            <span key={f.text} className="entry-spelling" data-main={f.text === w.headword || undefined} data-rare={tag === 'rare' || undefined}>
              <span lang="ja">
                {[...f.text].map((ch, i) => {
                  const title = old[ch] ? t('oldOf', { old: ch, char: old[ch] }) : undefined
                  return kanji && f.text !== w.headword && open.has(ch) ? (
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
                <span className="entry-spelling-tag" title={t(tag === 'old' ? 'oldTitle' : 'rareTitle')}>
                  {t(tag === 'old' ? 'oldKanji' : 'rare')}
                </span>
              )}
            </span>
          )
        })}
        {others.map((r) => (
          <span key={r.word.id} className="entry-spelling">
            <button className="entry-form-word" lang="ja" {...warmWord(r.word.id)} onClick={() => related?.onWord(r.word)} title={t('openWord', { word: r.word.headword })}>
              {r.word.headword}
            </button>
            <span className="entry-spelling-tag">{t(FORM_TAGS[r.kind as keyof typeof FORM_TAGS])}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

/** What the other word is to this one, by the kind of its row. */
const FORM_TAGS = { short: 'short', shortOf: 'shortOf', older: 'older', olderOf: 'olderOf' } as const
