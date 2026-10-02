/**
 * The character in several fonts side by side: print (mincho, gothic) beside
 * handwriting shapes (a textbook face, a brush face), where 令 心 北 糸 木
 * stop looking alike. Then, where an older JIS standard drew it differently
 * -- 葛 辻 遡 謎 before 2004 -- that shape too, from the font that carries it.
 *
 * The two handwriting fonts are loaded only once the strip is on screen, and
 * a face is shown only when it really has the character: a missing glyph
 * would fall back to some other font and show a lie under its label. The old
 * shapes are outlines from the server (pipeline/fonts.py), since they share a
 * code point with today's and a font keeping them is hundreds of KB.
 */
import { useEffect, useRef, useState } from 'react'
import { api, type FontsResponse } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    title: 'In other fonts',
    mincho: 'mincho',
    gothic: 'gothic',
    textbook: 'textbook',
    brush: 'brush',
    minchoTip: 'Shippori Mincho: the serif face of books and newspapers',
    gothicTip: 'Zen Kaku Gothic New: the sans-serif face of signs and screens',
    textbookTip: 'Klee One: close to the textbook face (教科書体) schools teach handwriting from',
    brushTip: 'Yuji Syuku: written with a brush',
    oldTitle: 'Older printed shapes',
    oldHint: 'The same character as earlier JIS standards printed it. Today’s shape is the mincho above.',
    old: '{face}, JIS {years}',
    oldTip: 'How JIS X 0208 ({years}) drew it in {face}',
  },
  {
    title: 'В други шрифтове',
    mincho: 'минчо',
    gothic: 'готик',
    textbook: 'учебник',
    brush: 'четка',
    minchoTip: 'Shippori Mincho: шрифтът със серифи на книгите и вестниците',
    gothicTip: 'Zen Kaku Gothic New: шрифтът без серифи на табелите и екраните',
    textbookTip: 'Klee One: близо до учебния шрифт (教科書体), по който училищата учат почерк',
    brushTip: 'Yuji Syuku: писан с четка',
    oldTitle: 'По-стари печатни форми',
    oldHint: 'Същият знак, както са го печатали по-старите стандарти JIS. Днешната форма е минчото горе.',
    old: '{face}, JIS {years}',
    oldTip: 'Как JIS X 0208 ({years}) го рисува в {face}',
  },
)

const FACES = ['mincho', 'gothic', 'textbook', 'brush'] as const
type Face = (typeof FACES)[number]
const FAMILY: Record<Face, string> = {
  mincho: 'Shippori Mincho',
  gothic: 'Zen Kaku Gothic New',
  textbook: 'Klee One',
  brush: 'Yuji Syuku',
}
// Google Fonts slices CJK faces by unicode-range, so only the slice holding
// the character is fetched, as for the two faces the page itself uses.
const LAZY_CSS = 'https://fonts.googleapis.com/css2?family=Klee+One&family=Yuji+Syuku&display=swap'
const YEARS: Record<string, string> = { jp78: '1978', jp83: '1983', jp90: '1990' }

function loadLazyFonts() {
  if (document.querySelector(`link[href="${LAZY_CSS}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = LAZY_CSS
  document.head.appendChild(link)
}

/** True once `family` can draw `char`: false offline, or when the font lacks it. */
function useFontReady(family: string, char: string, wanted: boolean): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    if (!wanted) return
    let stale = false
    // The stylesheet may still be on its way; give it a moment, then ask again.
    const ask = (tries: number) =>
      document.fonts.load(`40px "${family}"`, char).then(
        (faces) => {
          if (stale) return
          if (faces.length) setReady(true)
          else if (tries > 0) setTimeout(() => ask(tries - 1), 400)
        },
        () => {},
      )
    ask(8)
    return () => {
      stale = true
    }
  }, [family, char, wanted])
  return ready
}

export function FontStrip({ char }: { char: string }) {
  const t = S(useLang())
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  const [info, setInfo] = useState<FontsResponse | null>(null)

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
    setInfo(null)
    api.fonts(char).then(
      (d) => !stale && setInfo(d),
      // Offline or an old server: the two faces the page already has are still worth showing.
      () => !stale && setInfo({ char, faces: ['mincho', 'gothic'], old: [] }),
    )
    return () => {
      stale = true
    }
  }, [seen, char])

  const has = (f: Face) => info?.faces.includes(f) ?? false
  const textbook = useFontReady(FAMILY.textbook, char, seen && has('textbook'))
  const brush = useFontReady(FAMILY.brush, char, seen && has('brush'))
  const shown = FACES.filter((f) => has(f) && (f === 'textbook' ? textbook : f === 'brush' ? brush : true))

  // One cell per distinct old outline: 1978 and 1983 often agree.
  const old: { face: Face; years: string[]; em: number; d: string }[] = []
  for (const o of info?.old ?? []) {
    const same = old.find((x) => x.face === o.face && x.d === o.old)
    if (same) same.years.push(YEARS[o.feature])
    else old.push({ face: o.face as Face, years: [YEARS[o.feature]], em: o.em, d: o.old })
  }

  return (
    <div className="font-strip" ref={ref}>
      {shown.length > 1 && (
        <>
          <h3>{t('title')}</h3>
          <ul>
            {shown.map((f) => (
              <li key={f} title={t(`${f}Tip`)}>
                <span className="font-strip-glyph" style={{ fontFamily: `'${FAMILY[f]}'` }} lang="ja">
                  {char}
                </span>
                <span className="font-strip-label">{t(f)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {old.length > 0 && (
        <>
          <h3 title={t('oldHint')}>{t('oldTitle')}</h3>
          <ul>
            {old.map((o) => {
              const years = o.years.join('–')
              return (
                <li key={`${o.face}${years}`} title={t('oldTip', { years, face: FAMILY[o.face] })}>
                  <svg className="font-strip-glyph" viewBox={`0 0 ${o.em} ${o.em}`} role="img" aria-label={`${char} JIS ${years}`}>
                    <path d={o.d} />
                  </svg>
                  <span className="font-strip-label">{t('old', { face: t(o.face), years })}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
