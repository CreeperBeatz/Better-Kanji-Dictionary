import { useEffect, useMemo, useState } from 'react'
import { api, type RadicalGroup, type RadicalSearchResponse } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    pick: 'Pick the parts you can see. Combine several to narrow it down.',
    found_one: '{n} character',
    found_other: '{n} characters',
    searching: 'searching',
    startOver: 'start over',
    radicalIn: '{r} - in {n} characters',
  },
  {
    pick: 'Изберете частите, които виждате. Комбинирайте няколко, за да стесните търсенето.',
    found_one: '{n} йероглиф',
    found_other: '{n} йероглифа',
    searching: 'търсене',
    startOver: 'започнете отначало',
    radicalIn: '{r} - в {n} йероглифа',
  },
)

interface Props {
  onPick: (char: string) => void
}

export function RadicalPicker({ onPick }: Props) {
  const [groups, setGroups] = useState<RadicalGroup[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<RadicalSearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const t = S(useLang())

  useEffect(() => {
    api.radicals().then(
      (d) => setGroups(d.groups),
      (e) => setError(String(e.message ?? e)),
    )
  }, [])

  useEffect(() => {
    if (selected.length === 0) {
      setResult(null)
      return
    }
    let stale = false
    api.searchByRadicals(selected).then(
      (d) => !stale && setResult(d),
      (e) => !stale && setError(String(e.message ?? e)),
    )
    return () => {
      stale = true
    }
  }, [selected])

  // Once anything is picked, radicals that appear in no remaining candidate are
  // dead ends -- disable them so you can never build an empty result.
  const live = useMemo(
    () => (result && selected.length ? new Set(result.available) : null),
    [result, selected.length],
  )

  function toggle(radical: string) {
    setSelected((s) => (s.includes(radical) ? s.filter((r) => r !== radical) : [...s, radical]))
  }

  if (error) {
    return <p className="hint">{error}</p>
  }

  return (
    <div>
      {selected.length === 0 ? (
        <p className="hint">{t('pick')}</p>
      ) : (
        <p className="hint">
          <span className="tally">{result ? t.plural('found', result.total) : t('searching')}</span>{' '}
          <button className="clear" onClick={() => setSelected([])}>
            {t('startOver')}
          </button>
        </p>
      )}

      {result && result.kanji.length > 0 && (
        <div className="results">
          {result.kanji.slice(0, 120).map((k) => (
            <button key={k} className="result" onClick={() => onPick(k)} title={k}>
              {k}
            </button>
          ))}
        </div>
      )}

      {groups.map((g) => (
        <div className="radical-strokes" key={g.strokeCount}>
          <span className="count">{g.strokeCount}</span>
          <div className="radical-grid">
            {g.radicals.map((r) => {
              const on = selected.includes(r.radical)
              return (
                <button
                  key={r.radical}
                  className="radical"
                  data-on={on}
                  disabled={!on && live !== null && !live.has(r.radical)}
                  onClick={() => toggle(r.radical)}
                  title={t('radicalIn', { r: r.radical, n: r.kanjiCount })}
                >
                  {r.radical}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
