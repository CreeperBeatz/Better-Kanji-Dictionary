import { strings, useLang } from '../i18n'

const S = strings({ label: 'pitch accent {p}' }, { label: 'тонално ударение {p}' })

/** Pitch accent as a contour over the reading: 0 = heiban, n = drop after mora n. */
export function Pitch({ reading, pitch }: { reading: string; pitch: string }) {
  const t = S(useLang())
  const drop = Number(pitch.split(',')[0])
  if (Number.isNaN(drop)) return null

  const mora: string[] = []
  for (const ch of reading) {
    if ('ゃゅょぁぃぅぇぉャュョァィゥェォ'.includes(ch) && mora.length) {
      mora[mora.length - 1] += ch
    } else {
      mora.push(ch)
    }
  }

  return (
    <span className="pitch" aria-label={t('label', { p: pitch })}>
      {mora.map((m, i) => {
        const n = i + 1
        const high = drop === 0 ? n > 1 : n <= drop && !(drop === 1 && n > 1)
        return (
          <span key={i} className="mora" data-high={high} data-drop={drop !== 0 && n === drop}>
            {m}
          </span>
        )
      })}
    </span>
  )
}
