/**
 * How far review has got. A slim bar in the review screen's top bar (desktop
 * only): tasks done of all tasks, and the share of the N5-N2 kanji fully
 * verified. It opens the Progress tab, which has the same per stage: parts,
 * forms, meanings, word meanings.
 */
import { useEffect, useState } from 'react'
import { api, type ReviewProgress, type TaskType } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    title: 'Progress',
    tasks: '{done} of {total} review tasks done',
    tasksShort: '{done} / {total} tasks',
    verified: '{pct} of the dictionary verified',
    verifiedShort: '{pct} verified',
    verifiedLong: '{n} of {total} N5–N2 kanji verified: nothing open on their parts or forms, meanings accepted, every word placed.',
    open: 'Open the progress page',
    stages: 'By stage',
    s_decomposition: 'Parts',
    s_form_link: 'Forms',
    s_kanji_senses: 'Meanings',
    s_word_sense: 'Word meanings',
    d_decomposition: 'which parts each character visibly contains',
    d_form_link: 'how bound shapes relate to the kanji they come from',
    d_kanji_senses: 'the meaning groups of each kanji',
    d_word_sense: 'which group each word is in',
    of: '{done} of {total}',
    left: '{n} left',
    dictionary: 'The dictionary',
    meaningsCover: '{n} of {total} N5–N2 kanji have accepted meanings',
    loading: 'loading',
  },
  {
    title: 'Напредък',
    tasks: '{done} от {total} задачи за преглед са готови',
    tasksShort: '{done} / {total} задачи',
    verified: '{pct} от речника е проверен',
    verifiedShort: '{pct} проверени',
    verifiedLong: '{n} от {total} кандзи от N5–N2 са проверени: нищо отворено за частите или формите им, значенията са приети, всяка дума е разпределена.',
    open: 'Отворете страницата с напредъка',
    stages: 'По етапи',
    s_decomposition: 'Части',
    s_form_link: 'Форми',
    s_kanji_senses: 'Значения',
    s_word_sense: 'Значения в думи',
    d_decomposition: 'кои части съдържа видимо всеки знак',
    d_form_link: 'как свързаните форми се отнасят към кандзито, от което идват',
    d_kanji_senses: 'групите значения на всяко кандзи',
    d_word_sense: 'в коя група е всяка дума',
    of: '{done} от {total}',
    left: 'остават {n}',
    dictionary: 'Речникът',
    meaningsCover: '{n} от {total} кандзи от N5–N2 имат приети значения',
    loading: 'зареждане',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
const STAGES: TaskType[] = ['decomposition', 'form_link', 'kanji_senses', 'word_sense']

function pct(done: number, total: number): string {
  if (!total) return '0%'
  const p = (100 * done) / total
  return `${p > 0 && p < 0.1 ? '<0.1' : p.toFixed(p === 100 || p === 0 ? 0 : 1)}%`
}

function Bar({ done, total }: { done: number; total: number }) {
  return (
    <span className="progress-bar" aria-hidden>
      <span style={{ width: total ? `${(100 * done) / total}%` : 0 }} />
    </span>
  )
}

/** The counts, asked again whenever `version` changes (after each decision). */
export function useProgress(version: number): ReviewProgress | null {
  const [data, setData] = useState<ReviewProgress | null>(null)
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
  return data
}

function useNumber() {
  const lang = useLang()
  return (x: number) => x.toLocaleString(lang === 'bg' ? 'bg-BG' : 'en-GB')
}

/** The bar in the top bar; a click opens the Progress tab. */
export function ProgressMini({ data, onOpen }: { data: ReviewProgress | null; onOpen: () => void }) {
  const t = S(useLang())
  const n = useNumber()
  if (!data) return <span className="progress-mini" />
  return (
    <button className="progress-mini" onClick={onOpen} title={t('open')}>
      <Bar done={data.tasks.done} total={data.tasks.total} />
      <span>
        {t('tasksShort', { done: n(data.tasks.done), total: n(data.tasks.total) })} · <b>{pct(data.tasks.done, data.tasks.total)}</b>
      </span>
      <span className="progress-mini-verified">{t('verifiedShort', { pct: pct(data.kanji.verified, data.kanji.total) })}</span>
    </button>
  )
}

/** The Progress tab. */
export function ProgressPage({ data }: { data: ReviewProgress | null }) {
  const t = S(useLang())
  const n = useNumber()
  if (!data) return <p className="hint">{t('loading')}</p>
  return (
    <div className="progress-page">
      <section className="progress-card">
        <h3>{t('dictionary')}</h3>
        <p className="progress-big">
          <b>{pct(data.kanji.verified, data.kanji.total)}</b> {t('verified', { pct: '' }).trim()}
        </p>
        <Bar done={data.kanji.verified} total={data.kanji.total} />
        <p className="hint">{t('verifiedLong', { n: n(data.kanji.verified), total: n(data.kanji.total) })}</p>
        <p className="hint">{t('meaningsCover', { n: n(data.meanings.accepted), total: n(data.meanings.total) })}</p>
      </section>

      <section className="progress-card">
        <h3>{t('tasks', { done: n(data.tasks.done), total: n(data.tasks.total) })}</h3>
        <p className="progress-big">
          <b>{pct(data.tasks.done, data.tasks.total)}</b>
        </p>
        <Bar done={data.tasks.done} total={data.tasks.total} />
      </section>

      <section className="progress-card">
        <h3>{t('stages')}</h3>
        <div className="progress-stages">
          {STAGES.map((k) => {
            const s = data.stages[k]
            return (
              <div key={k} className="progress-stage">
                <div className="progress-stage-name">
                  <b>{t(`s_${k}` as Key)}</b>
                  <span className="hint">{t(`d_${k}` as Key)}</span>
                </div>
                <Bar done={s.done} total={s.total} />
                <span className="progress-stage-n">
                  {t('of', { done: n(s.done), total: n(s.total) })} · <b>{pct(s.done, s.total)}</b>
                  <span className="hint"> · {t('left', { n: n(s.total - s.done) })}</span>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
