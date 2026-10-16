/**
 * A meaning's words by how they read the kanji, on its card: the kun words,
 * then the on words -- a reading the meaning has only now and then faded at
 * their end -- then its exceptions, the special readings. Each word says its
 * own reading, so a lane's label names none. On a kanji's page and in all
 * its words alike.
 */
import type { ReactNode } from 'react'
import type { Word } from '../api'
import { strings, useLang } from '../i18n'

const S = strings(
  {
    on: 'On',
    kun: 'Kun',
    exceptions: 'Exceptions',
    exceptionsHint: 'read as one word, not kanji by kanji',
  },
  {
    on: 'Он',
    kun: 'Кун',
    exceptions: 'Изключения',
    exceptionsHint: 'четат се като цяла дума, не канджи по канджи',
  },
)

export function WordLanes({
  kun,
  on,
  now = [],
  exceptions,
  row,
}: {
  kun: Word[]
  on: Word[]
  /** On words of a reading it has only now and then: faded, so they do not read as a rule. */
  now?: Word[]
  exceptions: Word[]
  row: (w: Word) => ReactNode
}) {
  const t = S(useLang())
  return (
    <>
      {kun.length > 0 && (
        <div className="lane">
          <p className="lane-kind">{t('kun')}</p>
          <ul className="meaning-words">{kun.map(row)}</ul>
        </div>
      )}
      {on.length + now.length > 0 && (
        <div className="lane">
          <p className="lane-kind">{t('on')}</p>
          <ul className="meaning-words">{on.map(row)}</ul>
          {now.length > 0 && <ul className="meaning-words lane-now">{now.map(row)}</ul>}
        </div>
      )}
      {exceptions.length > 0 && (
        <div className="lane">
          <p className="lane-kind" title={t('exceptionsHint')}>
            {t('exceptions')}
          </p>
          <ul className="meaning-words">{exceptions.map(row)}</ul>
        </div>
      )}
    </>
  )
}
