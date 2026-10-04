/**
 * How far review has got, across the top of the review screen: tasks done of
 * all tasks, and the share of the N5-N2 kanji that are fully verified. A
 * click opens the same per stage: parts, forms, meanings, word meanings.
 */
import { useEffect, useState } from 'react'
import { api, type ReviewProgress, type TaskType } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    tasks: '{done} of {total} review tasks done',
    verified: '{pct} of the dictionary verified',
    verifiedLong: '{n} of {total} N5–N2 kanji verified: nothing open on their parts or forms, meanings accepted, every word placed.',
    stages: 'Show progress per stage',
    s_decomposition: 'Parts',
    s_form_link: 'Forms',
    s_kanji_senses: 'Meanings',
    s_word_sense: 'Word meanings',
    of: '{done} of {total}',
    meaningsCover: '{n} of {total} N5–N2 kanji have accepted meanings',
  },
  {
    tasks: '{done} от {total} задачи за преглед са готови',
    verified: '{pct} от речника е проверен',
    verifiedLong: '{n} от {total} кандзи от N5–N2 са проверени: нищо отворено за частите или формите им, значенията са приети, всяка дума е разпределена.',
    stages: 'Покажете напредъка по етапи',
    s_decomposition: 'Части',
    s_form_link: 'Форми',
    s_kanji_senses: 'Значения',
    s_word_sense: 'Значения в думи',
    of: '{done} от {total}',
    meaningsCover: '{n} от {total} кандзи от N5–N2 имат приети значения',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
const STAGES: TaskType[] = ['decomposition', 'form_link', 'kanji_senses', 'word_sense']

function pct(done: number, total: number, digits = 1): string {
  if (!total) return '0%'
  const p = (100 * done) / total
  return `${p > 0 && p < 0.1 ? '<0.1' : p.toFixed(p === 100 || p === 0 ? 0 : digits)}%`
}

function Bar({ done, total }: { done: number; total: number }) {
  return (
    <span className="progress-bar" aria-hidden>
      <span style={{ width: total ? `${(100 * done) / total}%` : 0 }} />
    </span>
  )
}

/** `version` changes after each decision, to count again. */
export function Progress({ version }: { version: number }) {
  const lang = useLang()
  const t = S(lang)
  const [data, setData] = useState<ReviewProgress | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let stale = false
    api.reviewProgress().then(
      (d) => !stale && setData(d),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [version])

  if (!data) return <div className="progress" />
  const n = (x: number) => x.toLocaleString(lang === 'bg' ? 'bg-BG' : 'en-GB')
  return (
    <div className="progress" data-open={open || undefined}>
      <button className="progress-sum" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('stages')}>
        <Bar done={data.tasks.done} total={data.tasks.total} />
        <span>
          {t('tasks', { done: n(data.tasks.done), total: n(data.tasks.total) })} · <b>{pct(data.tasks.done, data.tasks.total)}</b>
        </span>
        <span className="progress-verified" title={t('verifiedLong', { n: n(data.kanji.verified), total: n(data.kanji.total) })}>
          {t('verified', { pct: pct(data.kanji.verified, data.kanji.total) })}
        </span>
        <span className="progress-caret" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="progress-stages">
          {STAGES.map((k) => {
            const s = data.stages[k]
            return (
              <div key={k} className="progress-stage">
                <span className="progress-stage-name">{t(`s_${k}` as Key)}</span>
                <Bar done={s.done} total={s.total} />
                <span className="progress-stage-n">
                  {t('of', { done: n(s.done), total: n(s.total) })} · {pct(s.done, s.total)}
                </span>
              </div>
            )
          })}
          <p className="hint">{t('verifiedLong', { n: n(data.kanji.verified), total: n(data.kanji.total) })}</p>
          <p className="hint">{t('meaningsCover', { n: n(data.meanings.accepted), total: n(data.meanings.total) })}</p>
        </div>
      )}
    </div>
  )
}
