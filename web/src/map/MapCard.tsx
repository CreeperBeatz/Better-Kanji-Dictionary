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
    close: 'Close',
    on: 'On',
    kun: 'Kun',
    strokes: '{n} strokes',
  },
  {
    open: 'Вижте в речника',
    close: 'Затворете',
    on: 'Он',
    kun: 'Кун',
    strokes: '{n} черти',
  },
)

export function MapCard({ char, onOpen, onClose }: { char: string; onOpen: () => void; onClose: () => void }) {
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
      <button className="see-components map-card-open" onClick={onOpen}>
        {t('open')}
      </button>
    </div>
  )
}
