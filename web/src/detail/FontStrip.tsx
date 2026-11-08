/**
 * The character as it is printed and as it is written by hand, side by side:
 * mincho, the face of books, and the textbook face (教科書体) schools teach
 * handwriting from, where 令 心 北 糸 木 stop looking alike. Gothic and the
 * like keep mincho's skeleton (the Agency for Cultural Affairs' guide to the
 * Jōyō table prints them as one shape), so they are not shown. Then its old
 * form (國 for 国), and where an older JIS standard printed it differently --
 * 葛 辻 遡 謎 before 2004 -- that shape too, from the font that carries it.
 *
 * The textbook font is loaded only once the strip is on screen, and a face is
 * shown only when it really has the character: a missing glyph would fall
 * back to some other font and show a lie under its label. The old JIS shapes
 * are outlines from the server (pipeline/fonts.py), since they share a code
 * point with today's and a font keeping them is hundreds of KB.
 */
import { useEffect, useRef, useState } from 'react'
import { api, type FontsResponse, type FormItem } from '../api'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { warmKanji } from '../warm'

const S = strings(
  {
    mincho: 'mincho',
    textbook: 'textbook',
    minchoTip: 'Shippori Mincho: the serif face of books and newspapers',
    textbookTip: 'Klee One: close to the textbook face (教科書体) schools teach handwriting from',
    oldForm: 'old form',
    oldFormTip: 'Its form before the post-war reform (旧字体)',
    printedTip: 'Its old printed shape (旧字体). Unicode keeps it as U+{code}, the same character as {char}, so it has no page of its own.',
    ivsTip: 'Its old printed shape (旧字体), drawn in Noto Serif JP. Unicode gives it no character of its own, only a variant of {char}.',
    notAPage: '{char} has no page of its own',
    old: '{face}, JIS {years}',
    oldTip: 'How JIS X 0208 ({years}) printed it in {face}. Today’s shape is the first {face} in the row.',
  },
  {
    mincho: 'минчо',
    textbook: 'учебник',
    minchoTip: 'Shippori Mincho: шрифтът със серифи на книгите и вестниците',
    textbookTip: 'Klee One: близо до учебния шрифт (教科書体), по който училищата учат почерк',
    oldForm: 'стара форма',
    oldFormTip: 'Формата му преди следвоенната реформа (旧字体)',
    printedTip: 'Старата му печатна форма (旧字体). Unicode я пази като U+{code}, същия знак като {char}, затова няма собствена страница.',
    ivsTip: 'Старата му печатна форма (旧字体), в шрифта Noto Serif JP. Unicode не ѝ дава отделен знак, а само вариант на {char}.',
    notAPage: '{char} няма собствена страница',
    old: '{face}, JIS {years}',
    oldTip: 'Как JIS X 0208 ({years}) го печата в {face}. Днешната форма е първото {face} в реда.',
  },
)

const FACES = ['mincho', 'textbook'] as const
type Face = (typeof FACES)[number]
const FAMILY: Record<Face, string> = {
  mincho: 'Shippori Mincho',
  textbook: 'Klee One',
}
const isFace = (f: string): f is Face => (FACES as readonly string[]).includes(f)
// Google Fonts slices CJK faces by unicode-range, so only the slice holding
// the character is fetched, as for the faces the page itself uses.
const LAZY_CSS = 'https://fonts.googleapis.com/css2?family=Klee+One&display=swap'
const YEARS: Record<string, string> = { jp78: '1978', jp83: '1983', jp90: '1990' }

function loadLazyFonts() {
  if (document.querySelector(`link[href="${LAZY_CSS}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = LAZY_CSS
  document.head.appendChild(link)
}

/**
 * What is already known, by character: a page come back to draws its strip
 * at once, as tall as it was, instead of growing again under the reader.
 */
const knownFonts = new Map<string, FontsResponse>()
const drawable = new Set<string>()

/** True once `family` can draw `char`: false offline, or when the font lacks it. */
function useFontReady(family: string, char: string, wanted: boolean): boolean {
  const key = `${family}|${char}`
  const [ready, setReady] = useState(() => drawable.has(key))
  useEffect(() => {
    setReady(drawable.has(key))
    if (!wanted || drawable.has(key)) return
    let stale = false
    // The stylesheet may still be on its way; give it a moment, then ask again.
    const ask = (tries: number) =>
      document.fonts.load(`40px "${family}"`, char).then(
        (faces) => {
          if (stale) return
          if (faces.length) {
            drawable.add(key)
            setReady(true)
          }
          else if (tries > 0) setTimeout(() => ask(tries - 1), 400)
        },
        () => {},
      )
    ask(8)
    return () => {
      stale = true
    }
  }, [key, family, char, wanted])
  return ready
}

/**
 * The kanji in mincho and the textbook face, then its old forms (`oldForms`,
 * from the forms; each opens its own page if it has one), then the shapes
 * old JIS printed.
 */
export function FontStrip({ char, oldForms = [], onKanji }: { char: string; oldForms?: FormItem[]; onKanji: (char: string) => void }) {
  const lang = useLang()
  const t = S(lang)
  const ref = useRef<HTMLUListElement>(null)
  const [seen, setSeen] = useState(() => knownFonts.has(char))
  // Asked for already, as opening the page does (App.tsx warm): there at once.
  const [info, setInfo] = useState<FontsResponse | null>(() => knownFonts.get(char) ?? api.fonts.peek(char) ?? null)

  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    if (!seen) return
    loadLazyFonts()
    let stale = false
    const known = knownFonts.get(char) ?? api.fonts.peek(char)
    setInfo(known ?? null)
    if (known) return
    api.fonts(char).then(
      (d) => {
        knownFonts.set(char, d)
        if (!stale) setInfo(d)
      },
      // Offline or an old server: mincho, the page's own face, is still there.
      () => !stale && setInfo({ char, faces: ['mincho'], old: [] }),
    )
    return () => {
      stale = true
    }
  }, [seen, char])

  // Mincho is the page's own face, so it is there from the start; the
  // textbook face has its place as soon as the kanji is known to be in it,
  // and its glyph comes into it when its font has loaded -- so nothing moves
  // as it comes.
  const has = (f: Face) => f === 'mincho' || (info?.faces.includes(f) ?? false)
  const textbook = useFontReady(FAMILY.textbook, char, seen && has('textbook'))
  const ready = (f: Face) => (f === 'textbook' ? textbook : true)
  const shown = FACES.filter(has)

  // Old printed shapes Unicode keeps as compatibility ideographs (館 for 館):
  // the same character, so drawn from the server's outline -- as text,
  // normalizing or a phone's own font would draw today's shape instead. Some
  // have no code point at all, only a variation sequence (道 with two dots):
  // those come from Noto Serif JP, the one font here that has them.
  const isPrinted = (f: string) => f === 'compat' || f === 'ivs'
  const printed = (info?.old ?? []).filter((o) => isPrinted(o.feature) && isFace(o.face))
  // An old form that is such an ideograph (侮 for 侮) is that shape: shown once, drawn.
  const forms = printed.length ? oldForms.filter((i) => i.char.normalize('NFC') === i.char) : oldForms

  // One cell per distinct old JIS outline: 1978 and 1983 often agree, and one
  // may be the printed shape above. The server still knows other faces' old
  // shapes; only the two shown here count.
  const old: { face: Face; years: string[]; em: number; d: string }[] = []
  for (const o of info?.old ?? []) {
    if (!isFace(o.face) || isPrinted(o.feature) || printed.some((p) => p.face === o.face && p.old === o.old)) continue
    const same = old.find((x) => x.face === o.face && x.d === o.old)
    if (same) same.years.push(YEARS[o.feature])
    else old.push({ face: o.face, years: [YEARS[o.feature]], em: o.em, d: o.old })
  }

  // Mincho alone says nothing the page does not; the empty list still watches for the screen.
  if (shown.length + forms.length + printed.length + old.length < 2) return <ul className="font-strip" ref={ref} />

  return (
    <ul className="font-strip" ref={ref}>
      {shown.map((f) => (
        <li key={f} title={t(`${f}Tip`)} data-wait={!ready(f) || undefined}>
          <span className="font-strip-glyph" style={{ fontFamily: `'${FAMILY[f]}'` }} lang="ja">
            {char}
          </span>
          <span className="font-strip-label">{t(f)}</span>
        </li>
      ))}
      {forms.map((i) => {
        const inner = (
          <>
            <span className="font-strip-glyph" lang="ja">
              {i.char}
            </span>
            <span className="font-strip-label">{t('oldForm')}</span>
          </>
        )
        const meaning = meaningsOf(i, lang).value[0]
        return (
          <li key={`form-${i.char}`} className="font-strip-form">
            {i.known ? (
              <button {...warmKanji(i.char)} onClick={() => onKanji(i.char)} title={meaning ? `${t('oldFormTip')} · ${meaning}` : t('oldFormTip')}>
                {inner}
              </button>
            ) : (
              <span title={`${t('oldFormTip')} · ${t('notAPage', { char: i.char })}`}>{inner}</span>
            )}
          </li>
        )
      })}
      {printed.map((o) => {
        return (
          <li key={`printed-${o.face}-${o.feature}`} title={o.feature === 'ivs' ? t('ivsTip', { char }) : t('printedTip', { code: o.code ?? '', char })}>
            <svg className="font-strip-glyph" viewBox={`0 0 ${o.em} ${o.em}`} role="img" aria-label={`${char} ${t('oldForm')}`}>
              <path d={o.old} />
            </svg>
            <span className="font-strip-label">{t('oldForm')}</span>
          </li>
        )
      })}
      {old.map((o) => {
        const years = o.years.join('–')
        return (
          <li key={`${o.face}${years}`} title={t('oldTip', { years, face: t(o.face) })}>
            <svg className="font-strip-glyph" viewBox={`0 0 ${o.em} ${o.em}`} role="img" aria-label={`${char} JIS ${years}`}>
              <path d={o.d} />
            </svg>
            <span className="font-strip-label">{t('old', { face: t(o.face), years })}</span>
          </li>
        )
      })}
    </ul>
  )
}
