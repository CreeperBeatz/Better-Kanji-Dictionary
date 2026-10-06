/**
 * Where a character's parts come from. There is no official decomposition of
 * Japanese kanji, so each split names the sources that give it -- KanjiVG,
 * IDS, the kanji book, cjk-decomp -- or BKD, this dictionary's own, when none
 * does (server/decomp_sources.py). A label opens a note on every source and
 * how each splits the character.
 */
import { useState } from 'react'
import type { PartsFrom, PartsSource, SourceSplit } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    splitBy: 'Split as',
    by: 'by',
    whole: 'one piece',
    details: 'Where this comes from',
    hide: 'hide',
    agrees: 'splits it like this',
    differs: 'splits it',
    n_kanjivg: 'KanjiVG',
    n_ids: 'IDS',
    n_tsalta: 'Цалта',
    'n_cjk-decomp': 'cjk-decomp',
    n_topokanji: 'topokanji',
    n_bkd: 'BKD',
    n_sonnet: 'Sonnet',
    d_sonnet: 'A draft by Claude Sonnet, an AI model, with its reasoning. A reviewer decides; once accepted, the page credits a split no source gives to BKD.',
    d_kanjivg: 'Stroke-order data drawn for Japanese kanji, each grouped into its components. Open data (CC BY-SA).',
    d_ids: 'BabelStone’s Ideographic Description Sequences: how each character is laid out from components. Mostly Chinese shapes; the Japanese one where it differs.',
    d_tsalta: 'Цалта’s kanji book (print, in Bulgarian), as the book splits each kanji.',
    'd_cjk-decomp': 'An open decomposition of Chinese characters: what this dictionary’s graph was first built from.',
    d_topokanji: 'Corrections from topokanji, a kanji learning-order project. Its splits serve an order more than a shape.',
    d_bkd: 'Better Kanji Dictionary’s own: no source splits it this way. Set by hand, or decided by a reviewer.',
  },
  {
    splitBy: 'Разделен като',
    by: 'според',
    whole: 'едно цяло',
    details: 'Откъде идва това',
    hide: 'скрийте',
    agrees: 'го разделя така',
    differs: 'го разделя',
    n_kanjivg: 'KanjiVG',
    n_ids: 'IDS',
    n_tsalta: 'Цалта',
    'n_cjk-decomp': 'cjk-decomp',
    n_topokanji: 'topokanji',
    n_bkd: 'BKD',
    n_sonnet: 'Sonnet',
    d_sonnet: 'Чернова от Claude Sonnet, модел с изкуствен интелект, с мотивите си. Рецензент решава; щом е приета, страницата приписва на BKD деление, което никой източник не дава.',
    d_kanjivg: 'Данни за реда на чертите на японските канджи, всяко групирано на компонентите си. Отворени данни (CC BY-SA).',
    d_ids: 'Описанията на BabelStone (IDS): как всеки знак е подреден от компоненти. Предимно китайски форми; японската, където се различава.',
    d_tsalta: 'Книгата за канджи на Цалта (печатна, на български), както тя разделя всяко канджи.',
    'd_cjk-decomp': 'Отворено разлагане на китайските знаци: от него е построен първоначално графът на този речник.',
    d_topokanji: 'Поправки от topokanji, проект за ред на учене на канджи. Деленията му служат на реда повече, отколкото на формата.',
    d_bkd: 'Собственото на Better Kanji Dictionary: никой източник не го разделя така. Зададено ръчно или решено от рецензент.',
  },
)

type Key = Parameters<ReturnType<typeof S>>[0]

/** A source's short name, as the labels show it. */
export function useSourceName(): (s: PartsSource) => string {
  const t = S(useLang())
  return (s) => t(`n_${s}` as Key)
}

/** Small labels for the sources; each opens the notes when pressed. */
export function SourceChips({ by, onOpen }: { by: PartsSource[]; onOpen?: () => void }) {
  const t = S(useLang())
  return (
    <span className="source-chips">
      {by.map((s) => (
        <button key={s} type="button" className="source-chip" data-source={s} title={t(`d_${s}` as Key)} onClick={onOpen}>
          {t(`n_${s}` as Key)}
        </button>
      ))}
    </span>
  )
}

/** What each source is, and how each splits this character; the ones that split it as now are marked. */
export function SourceNotes({ splits, now }: { splits: SourceSplit[]; now: string[] }) {
  const t = S(useLang())
  const key = (p: string[]) => [...p].sort().join('')
  const agree = new Set(splits.filter((s) => key(s.parts) === key(now)).map((s) => s.source))
  const shown: PartsSource[] = [...new Set<PartsSource>([...splits.map((s) => s.source), ...(agree.size ? [] : (['bkd'] as PartsSource[]))])]
  return (
    <dl className="source-notes">
      {shown.map((s) => {
        const split = splits.find((x) => x.source === s)
        return (
          <div key={s} data-agrees={agree.has(s) || s === 'bkd' || undefined}>
            <dt>
              {t(`n_${s}` as Key)}
              {split && (
                <span className="source-split">
                  {' '}
                  {agree.has(s) ? t('agrees') : t('differs')}:{' '}
                  <span lang="ja">{split.parts.length ? split.parts.join(' + ') : t('whole')}</span>
                </span>
              )}
            </dt>
            <dd>{t(`d_${s}` as Key)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/** The kanji page's line: "Split as 日 + 青 by KanjiVG · IDS", the notes behind it. */
export function PartsSourceLine({ from, parts }: { from: PartsFrom; parts: string[] }) {
  const t = S(useLang())
  const [open, setOpen] = useState(false)
  return (
    <div className="parts-from">
      <p>
        {t('splitBy')} <span lang="ja">{parts.length ? parts.join(' + ') : t('whole')}</span> {t('by')}{' '}
        <SourceChips by={from.by} onOpen={() => setOpen((o) => !o)} />{' '}
        <button type="button" className="clear parts-from-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t('hide') : t('details')}
        </button>
      </p>
      {open && <SourceNotes splits={from.splits} now={parts} />}
    </div>
  )
}
