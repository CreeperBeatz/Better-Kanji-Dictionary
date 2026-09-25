import { useEffect, useRef, useState } from 'react'
import { Excalidraw, exportToBlob, getSceneVersion, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import './sketch-theme.css'
import { getLang, strings, useLang } from '../i18n'
import { errorText } from '../i18n/errors'
import { PixelTools, type PixelTool } from './pixels/PixelTools'
import { ImageSearch } from './ImageSearch'
import { ToolGroups } from './ToolGroups'

const S = strings(
  {
    drawingFor: 'Drawing for {c}',
    closeAsk: 'Close without keeping this drawing?',
    nothing: 'Nothing drawn yet.',
    saving: 'saving',
    cancel: 'cancel',
    done: 'done',
  },
  {
    drawingFor: 'Рисунка за {c}',
    closeAsk: 'Да се затвори ли, без да се запази рисунката?',
    nothing: 'Още нищо не е нарисувано.',
    saving: 'запазване',
    cancel: 'откажете',
    done: 'готово',
  },
)

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
  const [finding, setFinding] = useState(false)
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

  // Ctrl+D deselects, as in paint programs, rather than duplicating (or
  // bookmarking the page). With a picture tool in hand, PixelTools takes it
  // for the picture's selection.
  useEffect(() => {
    if (!excalidraw || tool) return
    const api = excalidraw
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'd') return
      const at = e.target as HTMLElement | null
      if (at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)) return
      e.preventDefault()
      e.stopPropagation()
      api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null } })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [excalidraw, tool])

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
          />
          {excalidraw && host && (
            <ToolGroups api={excalidraw} host={host} tool={tool} onTool={setTool} finding={finding} onFinding={setFinding} />
          )}
          {excalidraw && finding && <ImageSearch api={excalidraw} onClose={() => setFinding(false)} />}
          {excalidraw && host && <PixelTools api={excalidraw} host={host} tool={tool} onTool={setTool} />}
        </div>
      </div>
    </div>
  )
}
