import { strings, useLang } from '../i18n'

const S = strings({ label: 'pitch accent {p}' }, { label: 'тонално ударение {p}' })

/** Pitch accent as a contour over the reading: 0 = heiban, n = drop after mora n. */
/** `mark`: the kana of one kanji, [from, to) -- the morae among them are marked, as MarkedReading does. */
export function Pitch({ reading, pitch, mark }: { reading: string; pitch: string; mark?: [number, number] | null }) {
  const t = S(useLang())
  const drop = Number(pitch.split(',')[0])
  if (Number.isNaN(drop)) return null

  const mora: string[] = []
  // Where each mora starts in the reading, for the mark.
  const at: number[] = []
  let i = 0
  for (const ch of reading) {
    if ('ゃゅょぁぃぅぇぉャュョァィゥェォ'.includes(ch) && mora.length) {
      mora[mora.length - 1] += ch
    } else {
      mora.push(ch)
      at.push(i)
    }
    i += ch.length
  }

  return (
    <span className="pitch" aria-label={t('label', { p: pitch })}>
      {mora.map((m, i) => {
        const n = i + 1
        const high = drop === 0 ? n > 1 : n <= drop && !(drop === 1 && n > 1)
        return (
          <span
            key={i}
            className={mark && at[i] >= mark[0] && at[i] < mark[1] ? 'mora reading-here' : 'mora'}
            data-high={high}
            data-drop={drop !== 0 && n === drop}
          >
            {m}
          </span>
        )
      })}
    </span>
  )
}
