/**
 * How far review has got. A slim bar in the review screen's top bar (desktop
 * only): tasks done of all tasks, and the share of the kanji in scope fully
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
    verifiedLong: '{n} of {total} kanji verified (every kanji with a JLPT level, jōyō or a newspaper rank): nothing open on their parts or forms, meanings accepted, every word placed.',
    open: 'Open the progress page',
    stages: 'By stage',
    s_decomposition: 'Parts',
    s_form_link: 'Forms',
    s_kanji_senses: 'Meanings',
    s_bg: 'Bulgarian translations',
    s_en_report: 'Reports',
    d_decomposition: 'which parts each character visibly contains',
    d_form_link: 'how bound shapes relate to the kanji they come from',
    d_kanji_senses: 'one per kanji: its groups, with its words placed on the board; and the odd single word (a suggestion, or one whose group changed)',
    d_bg: 'the machine-translated Bulgarian: one card per word, one per kanji',
    d_en_report: 'reports that a word’s English (from JMdict) is wrong; real mistakes go to JMdict',
    of: '{done} of {total}',
    left: '{n} left',
    dictionary: 'The dictionary',
    meaningsCover: '{n} of {total} kanji have accepted meanings',
    wordsCover: '{n} of {total} drafted words placed in a group (decided with their kanji’s meanings)',
    loading: 'loading',
  },
  {
    title: 'Напредък',
    tasks: '{done} от {total} задачи за преглед са готови',
    tasksShort: '{done} / {total} задачи',
    verified: '{pct} от речника е проверен',
    verifiedShort: '{pct} проверени',
    verifiedLong: '{n} от {total} канджи са проверени (всички с ниво от JLPT, джойо или място във вестниците): нищо отворено за частите или формите им, значенията са приети, всяка дума е разпределена.',
    open: 'Отворете страницата с напредъка',
    stages: 'По етапи',
    s_decomposition: 'Части',
    s_form_link: 'Форми',
    s_kanji_senses: 'Значения',
    s_bg: 'Преводи на български',
    s_en_report: 'Доклади',
    d_decomposition: 'кои части съдържа видимо всеки знак',
    d_form_link: 'как свързаните форми се отнасят към канджито, от което идват',
    d_kanji_senses: 'по една за канджи: групите му, с думите, разпределени на дъската; и по някоя отделна дума (предложение или дума, чиято група се е променила)',
    d_bg: 'машинно преведеният български: по една карта за дума и за канджи',
    d_en_report: 'доклади, че английският на дума (от JMdict) е грешен; истинските грешки отиват в JMdict',
    of: '{done} от {total}',
    left: 'остават {n}',
    dictionary: 'Речникът',
    meaningsCover: '{n} от {total} канджи имат приети значения',
    wordsCover: '{n} от {total} чернови думи са разпределени в група (решават се със значенията на канджито си)',
    loading: 'зареждане',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]
// As in the queue: a single word's meaning is counted under meanings, with its kanji's card.
const STAGES: TaskType[] = ['decomposition', 'form_link', 'kanji_senses', 'bg', 'en_report']

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
        <p className="hint">{t('wordsCover', { n: n(data.words.done), total: n(data.words.total) })}</p>
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
            const one = data.stages[k]
            const words = k === 'kanji_senses' ? data.stages.word_sense : undefined
            const s = words ? { done: one.done + words.done, total: one.total + words.total } : one
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
