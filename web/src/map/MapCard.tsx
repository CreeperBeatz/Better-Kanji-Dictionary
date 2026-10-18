/**
 * A character picked on the map, previewed over it: what it means, how it is
 * read, its level. The map stays where it was; the dictionary is a button away.
 */

import { useEffect, useState } from 'react'
import { api, type KanjiNode } from '../api'
import { levelOf } from '../detail/DetailPanel'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'
import { local } from '../local/local'

const S = strings(
  {
    open: 'See in Dictionary',
    focus: 'Focus',
    focusTitle: 'Light up its group on the map (double-click)',
    close: 'Close',
    on: 'On',
    kun: 'Kun',
    strokes: '{n} strokes',
  },
  {
    open: 'Вижте в речника',
    focus: 'Фокус',
    focusTitle: 'Осветете групата му на картата (двоен клик)',
    close: 'Затворете',
    on: 'Он',
    kun: 'Кун',
    strokes: '{n} черти',
  },
)

/** The map by meaning's light on the character's cluster: whether it is on, and the switch. */
export interface ClusterFocus {
  on: boolean
  toggle: () => void
}

export function MapCard({
  char,
  onOpen,
  onClose,
  focus,
}: {
  char: string
  onOpen: () => void
  onClose: () => void
  /** null when there is no cluster to light: the parts map, or a kanji in none */
  focus?: ClusterFocus | null
}) {
  const lang = useLang()
  const t = S(lang)
  const [node, setNode] = useState<KanjiNode | null>(null)

  // The device answers first when it has the offline pack; the server's
  // answer replaces it when it comes.
  useEffect(() => {
    let stale = false
    setNode(null)
    local.kanji(char)?.then(
      (d) => !stale && d && setNode((n) => n ?? d.focus),
      () => {},
    )
    api.kanji(char).then(
      (d) => !stale && setNode(d.focus),
      () => {},
    )
    return () => {
      stale = true
    }
  }, [char])

  const meanings = node ? meaningsOf(node, lang).value.slice(0, 4) : []
  const level = node ? levelOf(node, lang) : null

  return (
    <div className="map-card" role="dialog" aria-label={char}>
      <button className="map-card-x" onClick={onClose} aria-label={t('close')} title={t('close')}>
        ×
      </button>
      <div className="map-card-head">
        <span className="map-card-glyph" lang="ja">
          {char}
        </span>
        <span className="map-card-meaning">{meanings.join(', ')}</span>
      </div>
      {node && (
        <dl className="map-card-facts">
          {node.onYomi.length > 0 && (
            <>
              <dt>{t('on')}</dt>
              <dd lang="ja">{node.onYomi.join('、')}</dd>
            </>
          )}
          {node.kunYomi.length > 0 && (
            <>
              <dt>{t('kun')}</dt>
              <dd lang="ja">{node.kunYomi.join('、')}</dd>
            </>
          )}
        </dl>
      )}
      {node && (
        <p className="map-card-meta">
          {[level, node.strokes ? t('strokes', { n: node.strokes }) : null].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="map-card-actions">
        <button className="see-components" onClick={onOpen}>
          {t('open')}
        </button>
        {focus && (
          <button className="see-components" data-on={focus.on} aria-pressed={focus.on} title={t('focusTitle')} onClick={focus.toggle}>
            {t('focus')}
          </button>
        )}
      </div>
    </div>
  )
}
