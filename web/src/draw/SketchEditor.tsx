import { useEffect, useRef, useState } from 'react'
import { Excalidraw, exportToBlob, getSceneVersion, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import './sketch-theme.css'
import { getLang, strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { PixelTools, type PixelTool } from './pixels/PixelTools'

const S = strings(
  {
    drawingFor: 'Drawing for {c}',
    closeAsk: 'Close without keeping this drawing?',
    nothing: 'Nothing drawn yet.',
    saving: 'saving',
    cancel: 'cancel',
    done: 'done',
    pictureTools: 'Picture tools',
    lasso: 'Lasso: select part of a picture by drawing around it',
    box: 'Box select: select a rectangle of a picture',
    wand: 'Magic wand: select a colour in a picture',
    subject: 'Select the subject: a picture without its background',
  },
  {
    drawingFor: 'Рисунка за {c}',
    closeAsk: 'Да се затвори ли, без да се запази рисунката?',
    nothing: 'Още нищо не е нарисувано.',
    saving: 'запазване',
    cancel: 'откажете',
    done: 'готово',
    pictureTools: 'Инструменти за картини',
    lasso: 'Ласо: изберете част от картина, като я оградите',
    box: 'Правоъгълна селекция: изберете правоъгълник от картина',
    wand: 'Магическа пръчка: изберете цвят в картина',
    subject: 'Изберете обекта: картина без фона ѝ',
  },
)

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" aria-hidden>
    <path d={d} />
  </svg>
)

const TOOLS: [PixelTool, React.ReactNode][] = [
  ['lasso', icon('M10 4c4 0 7 1.8 7 4.2S14 12.5 10 12.5 3 10.6 3 8.2 6 4 10 4Zm-5.6 7.3C3.5 13 4 15.4 6.2 16.3')],
  ['box', icon('M3 3h3M9 3h2M14 3h3v3M17 9v2M17 14v3h-3M11 17H9M6 17H3v-3M3 11V9M3 6V3')],
  ['wand', icon('M3.5 16.5l9-9M11 6l3 3M14.5 2.5v2M17.5 5.5h-2M16.6 3.4l-1.4 1.4M9 3.5v1.5M4 9h1.5')],
  ['subject', icon('M10 3.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM5 16.5c0-3.3 2.2-5.6 5-5.6s5 2.3 5 5.6M2.5 6V2.5H6M14 2.5h3.5V6M17.5 14v3.5H14M6 17.5H2.5V14')],
]

/** Tells the editor Excalidraw is in its phone layout, for as long as it is. */
function Mobile({ on }: { on: (m: boolean) => void }) {
  useEffect(() => {
    on(true)
    return () => on(false)
  }, [on])
  return null
}

interface Props {
  char: string
  /** A saved scene to carry on from; absent for a new drawing. */
  scene?: Record<string, unknown>
  onSave: (png: Blob, scene: string) => Promise<void>
  onClose: () => void
}

/**
 * Excalidraw in a modal over the blurred app.
 *
 * Kept in its own module and loaded lazily: Excalidraw is by far the heaviest
 * thing in the app, and most visits never draw.
 */
export default function SketchEditor({ char, scene, onSave, onClose }: Props) {
  const lang = useLang()
  const t = S(lang)
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<PixelTool | null>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [mobile, setMobile] = useState(false)
  // What the scene looked like on opening, so closing only asks when
  // something would actually be lost.
  const openedAt = useRef<number | null>(null)

  useEffect(() => {
    if (excalidraw && openedAt.current === null) {
      openedAt.current = getSceneVersion(excalidraw.getSceneElementsIncludingDeleted())
    }
  }, [excalidraw])

  // The page behind should not scroll under the modal.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  function changed() {
    if (!excalidraw) return false
    return getSceneVersion(excalidraw.getSceneElementsIncludingDeleted()) !== openedAt.current
  }

  function close() {
    if (saving) return
    if (changed() && !window.confirm(t('closeAsk'))) return
    onClose()
  }

  async function save() {
    if (!excalidraw) return
    const elements = excalidraw.getSceneElements()
    if (elements.length === 0) {
      setError(t('nothing'))
      return
    }
    if (!changed() && scene) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const appState = excalidraw.getAppState()
      const files = excalidraw.getFiles()
      // Light ink on a transparent ground, so the PNG sits on the dark rail
      // the way it looked on the canvas.
      const png = await exportToBlob({
        elements,
        files,
        mimeType: 'image/png',
        exportPadding: 16,
        appState: { ...appState, exportBackground: false, exportWithDarkMode: true },
      })
      await onSave(png, serializeAsJSON(elements, appState, files, 'local'))
    } catch (e) {
      setError(errorText(e, getLang()))
      setSaving(false)
    }
  }

  const tools = (
    <div className="px-tools" role="group" aria-label={t('pictureTools')}>
      {TOOLS.map(([id, icon]) => (
        <button
          key={id}
          className="px-tool"
          data-on={tool === id || undefined}
          aria-pressed={tool === id}
          onClick={() => setTool((cur) => (cur === id ? null : id))}
          title={t(id)}
          aria-label={t(id)}
        >
          {icon}
        </button>
      ))}
    </div>
  )

  return (
    <div className="sketch-overlay" role="dialog" aria-modal="true" aria-label={t('drawingFor', { c: char })}>
      <div className="sketch-panel">
        <header className="sketch-head">
          <h2>{t.node('drawingFor', { c: <span className="sketch-char">{char}</span> })}</h2>
          <span className="tally">{error ?? (saving ? t('saving') : '')}</span>
          <button className="clear" onClick={close} disabled={saving}>
            {t('cancel')}
          </button>
          <button className="sketch-done" onClick={save} disabled={saving || !excalidraw}>
            {saving ? t('saving') : t('done')}
          </button>
        </header>
        <div className="sketch-canvas" ref={setHost}>
          <Excalidraw
            excalidrawAPI={setExcalidraw}
            // Dark mode shows the scene through an inverting filter, so this
            // near-black is what shows as the app's paper colour.
            initialData={scene ?? { appState: { currentItemStrokeWidth: 2, currentItemStrokeColor: '#0f0700' } }}
            theme="dark"
            langCode={lang === 'bg' ? 'bg-BG' : 'en'}
            autoFocus
            UIOptions={{
              canvasActions: { saveToActiveFile: false, export: false, toggleTheme: false },
            }}
            // Beside the library button on a desktop; on a phone that row is
            // full already, so they stand down the left edge instead.
            renderTopRightUI={(isMobile) => (isMobile ? <Mobile on={setMobile} /> : tools)}
          />
          {mobile && <div className="px-tools-side">{tools}</div>}
          {excalidraw && host && <PixelTools api={excalidraw} host={host} tool={tool} onTool={setTool} />}
        </div>
      </div>
    </div>
  )
}
