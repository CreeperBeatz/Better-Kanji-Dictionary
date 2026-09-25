/**
 * Excalidraw's toolbar, regrouped: its rectangle, diamond and ellipse become
 * one Shapes button, its image button becomes a Picture button (upload, or
 * search online), and the picture-selection tools join them as a third. Each
 * group opens a row under the toolbar to pick from; a group taken up without
 * picking works as its first tool.
 *
 * Excalidraw has no API for its toolbar, so this works on its markup: the
 * grouped tools are hidden by CSS (sketch-theme.css), the groups are portalled
 * into the same row and put in place with `order`, and the tools that stay
 * are renumbered 1-9 in the order they now stand -- their labels and titles
 * edited in place, their number keys caught before Excalidraw sees them.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { strings, useLang } from '../i18n'
import type { PixelTool } from './pixels/PixelTools'

const S = strings(
  {
    shapes: 'Shapes',
    picture: 'Picture',
    upload: 'Upload',
    uploadTitle: 'Upload a picture from this device',
    search: 'Search online',
    searchTitle: 'Find a picture to draw with',
    select: 'Select part of a picture',
    lasso: 'Lasso',
    lassoTitle: 'Lasso: select part of a picture by drawing around it',
    box: 'Box',
    boxTitle: 'Box select: select a rectangle of a picture',
    wand: 'Magic wand',
    wandTitle: 'Magic wand: select a colour in a picture',
    subject: 'Background remover',
    subjectTitle: 'Background remover: select what a picture shows, without its background',
  },
  {
    shapes: 'Фигури',
    picture: 'Картина',
    upload: 'Качване',
    uploadTitle: 'Качете картина от това устройство',
    search: 'Търсене онлайн',
    searchTitle: 'Намерете картина, с която да рисувате',
    select: 'Избор на част от картина',
    lasso: 'Ласо',
    lassoTitle: 'Ласо: изберете част от картина, като я оградите',
    box: 'Правоъгълник',
    boxTitle: 'Правоъгълна селекция: изберете правоъгълник от картина',
    wand: 'Магическа пръчка',
    wandTitle: 'Магическа пръчка: изберете цвят в картина',
    subject: 'Премахване на фона',
    subjectTitle: 'Премахване на фона: изберете какво показва картина, без фона ѝ',
  },
)

const SHAPES = ['rectangle', 'diamond', 'ellipse'] as const
type Shape = (typeof SHAPES)[number]
const PIXELS: PixelTool[] = ['lasso', 'box', 'wand', 'subject']

/** The Excalidraw tools that stay in the row, by the number that now picks them. */
const RENUMBERED = { arrow: '3', line: '4', freedraw: '5', text: '6', eraser: '8' } as const
const BY_KEY: Record<string, keyof typeof RENUMBERED> = { 3: 'arrow', 4: 'line', 5: 'freedraw', 6: 'text', 8: 'eraser' }

type Group = 'shapes' | 'picture' | 'select'

const icon = (d: string) => (
  <svg className="sk-own" viewBox="0 0 20 20" aria-hidden>
    <path d={d} />
  </svg>
)

const PIXEL_ICONS: Record<PixelTool, React.ReactNode> = {
  lasso: icon('M10 4c4 0 7 1.8 7 4.2S14 12.5 10 12.5 3 10.6 3 8.2 6 4 10 4Zm-5.6 7.3C3.5 13 4 15.4 6.2 16.3'),
  box: icon('M3 3h3M9 3h2M14 3h3v3M17 9v2M17 14v3h-3M11 17H9M6 17H3v-3M3 11V9M3 6V3'),
  wand: icon('M3.5 16.5l9-9M11 6l3 3M14.5 2.5v2M17.5 5.5h-2M16.6 3.4l-1.4 1.4M9 3.5v1.5M4 9h1.5'),
  subject: icon('M10 3.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM5 16.5c0-3.3 2.2-5.6 5-5.6s5 2.3 5 5.6M2.5 6V2.5H6M14 2.5h3.5V6M17.5 14v3.5H14M6 17.5H2.5V14'),
}
const SEARCH_ICON = icon('M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM12.6 12.6 17 17M6 10l1.6-2 1.4 1.5 1-1 1.5 1.5')

/** Excalidraw's own icon and name for a tool it has hidden, read off its markup. */
interface Borrowed {
  svg: string
  label: string
}

const inputOf = (root: ParentNode, tool: string) => root.querySelector<HTMLInputElement>(`input[data-testid="toolbar-${tool}"]`)

function borrow(root: ParentNode, tool: string): Borrowed | null {
  const input = inputOf(root, tool)
  const svg = input?.parentElement?.querySelector('.ToolIcon__icon svg')
  return input && svg ? { svg: svg.outerHTML, label: input.getAttribute('aria-label') ?? tool } : null
}

/** A tool's number put right in the label Excalidraw shows and in its title. */
function renumber(root: ParentNode) {
  for (const [tool, n] of Object.entries(RENUMBERED)) {
    const input = inputOf(root, tool)
    const label = input?.parentElement
    if (!input || !label) continue
    const key = label.querySelector('.ToolIcon__keybinding')
    if (key && key.textContent !== n) key.textContent = n
    const title = label.getAttribute('title')
    if (title && !title.endsWith(n)) label.setAttribute('title', title.replace(/\d$/, n))
    const keys = input.getAttribute('aria-keyshortcuts')
    if (keys && !keys.endsWith(n)) input.setAttribute('aria-keyshortcuts', keys.replace(/\d$/, n))
  }
}

const typing = (at: EventTarget | null) =>
  at instanceof HTMLElement && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)

interface ButtonProps {
  checked: boolean
  title: string
  onPick: (pointer: string) => void
  children: React.ReactNode
  keyLabel?: string
  className?: string
  label?: string
}

/** A button in Excalidraw's own markup, so its stylesheet dresses it like the rest. */
function ToolButton({ checked, title, onPick, children, keyLabel, className, label }: ButtonProps) {
  const pointer = useRef('mouse')
  return (
    <label className={`ToolIcon Shape ${className ?? ''}`} title={title} onPointerDown={(e) => (pointer.current = e.pointerType)}>
      <input
        className="ToolIcon_type_radio ToolIcon_size_medium"
        type="radio"
        aria-label={title}
        checked={checked}
        readOnly
        onClick={() => onPick(pointer.current)}
      />
      <div className="ToolIcon__icon">
        {children}
        {keyLabel && <span className="ToolIcon__keybinding">{keyLabel}</span>}
      </div>
      {label && <span className="sk-item-label">{label}</span>}
    </label>
  )
}

const Svg = ({ html }: { html?: string }) => (html ? <span className="sk-svg" dangerouslySetInnerHTML={{ __html: html }} /> : null)

interface Props {
  api: ExcalidrawImperativeAPI
  /** Where Excalidraw is mounted. */
  host: HTMLElement
  tool: PixelTool | null
  onTool: (t: PixelTool | null) => void
  finding: boolean
  onFinding: (on: boolean) => void
}

export function ToolGroups({ api, host, tool, onTool, finding, onFinding }: Props) {
  const t = S(useLang())
  const [row, setRow] = useState<HTMLElement | null>(null)
  const [slot] = useState(() => {
    const el = document.createElement('div')
    el.className = 'sk-slot'
    return el
  })
  const [borrowed, setBorrowed] = useState<Partial<Record<Shape | 'image', Borrowed>>>({})
  const [active, setActive] = useState(() => api.getAppState().activeTool.type)
  const [pictureOpen, setPictureOpen] = useState(false)
  const container = host.querySelector<HTMLElement>('.excalidraw-container')

  // Excalidraw rebuilds its toolbar when it changes layout (a phone turned,
  // a window narrowed), so the groups follow it into whichever row it has now.
  useEffect(() => {
    function attach() {
      const selection = inputOf(host, 'selection')?.parentElement?.parentElement ?? null
      if (selection && slot.parentElement !== selection) selection.appendChild(slot)
      setRow((cur) => (cur === selection ? cur : selection))
      renumber(host)
      setBorrowed((cur) => {
        if (cur.rectangle && cur.image) return cur
        const next: typeof cur = {}
        for (const tool of [...SHAPES, 'image'] as const) next[tool] = borrow(host, tool) ?? undefined
        return next
      })
    }
    attach()
    const watch = new MutationObserver(attach)
    watch.observe(host, { childList: true, subtree: true })
    return () => {
      watch.disconnect()
      slot.remove()
    }
  }, [host, slot])

  useEffect(
    () =>
      api.onChange((_, appState) => {
        const type = appState.activeTool.type
        setActive(type)
        // Picking any other tool puts the picture row away.
        if (type !== 'selection' && type !== 'image') setPictureOpen(false)
      }),
    [api],
  )

  // A click on the drawing puts the picture row away too.
  useEffect(() => {
    if (!container) return
    const down = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement) setPictureOpen(false)
    }
    container.addEventListener('pointerdown', down, true)
    return () => container.removeEventListener('pointerdown', down, true)
  }, [container])

  const shape = (SHAPES as readonly string[]).includes(active) ? (active as Shape) : null

  const pickShape = useCallback(
    (s: Shape) => {
      setPictureOpen(false)
      api.setActiveTool({ type: s })
    },
    [api],
  )
  const pickShapes = useCallback(() => {
    if (!shape) pickShape(SHAPES[0])
  }, [shape, pickShape])
  // Picture only opens its row: uploading opens a file dialog, which should
  // not come up unasked.
  const pickPicture = useCallback(() => {
    if (pictureOpen || finding) {
      setPictureOpen(false)
      onFinding(false)
      return
    }
    onTool(null)
    if (active !== 'selection') api.setActiveTool({ type: 'selection' })
    setPictureOpen(true)
  }, [api, active, pictureOpen, finding, onTool, onFinding])
  const pickSelect = useCallback(() => {
    setPictureOpen(false)
    if (!tool) onTool(PIXELS[0])
  }, [tool, onTool])

  // The number keys, in the order the toolbar now stands.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      const st = api.getAppState()
      if (st.openDialog || st.newElement || st.selectionElement || st.selectedElementsAreBeingDragged || st.editingTextElement) return
      const k = e.key
      if (k === '2') pickShapes()
      else if (k === '7') pickPicture()
      else if (k === '9') pickSelect()
      else if (BY_KEY[k]) {
        setPictureOpen(false)
        api.setActiveTool({ type: BY_KEY[k] })
      } else if (k !== '0') return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [api, pickShapes, pickPicture, pickSelect])

  const open: Group | null = tool ? 'select' : pictureOpen || finding || active === 'image' ? 'picture' : shape ? 'shapes' : null

  // The row of choices sits under the toolbar, below its group's button.
  const buttons = useRef<Record<Group, HTMLDivElement | null>>({ shapes: null, picture: null, select: null })
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !container || !row) return
    function place() {
      const button = buttons.current[open!]
      const island = row!.closest('.App-toolbar')
      if (!button || !island || !menu.current) return
      const box = container!.getBoundingClientRect()
      const b = button.getBoundingClientRect()
      const i = island.getBoundingClientRect()
      const w = menu.current.offsetWidth
      // Kept within the toolbar's width where it fits, clear of what stands
      // beside the toolbar on a phone.
      const lo = w <= i.width ? i.left : box.left + 8
      const hi = w <= i.width ? i.right : box.right - 8
      const left = Math.min(Math.max(lo, b.left + b.width / 2 - w / 2), hi - w) - box.left
      setAt({ top: i.bottom - box.top + 6, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, container, row, shape, tool])

  if (!row || !container) return null

  const shown = shape ?? SHAPES[0]
  const pixel = tool ?? PIXELS[0]

  return (
    <>
      {createPortal(
        <>
          <div className="sk-group" data-group="shapes" ref={(el) => void (buttons.current.shapes = el)}>
            <ToolButton checked={!!shape} title={`${t('shapes')} — 2`} keyLabel="2" onPick={pickShapes}>
              <Svg html={borrowed[shown]?.svg} />
            </ToolButton>
          </div>
          <div className="sk-group" data-group="picture" ref={(el) => void (buttons.current.picture = el)}>
            <ToolButton checked={open === 'picture'} title={`${t('picture')} — 7`} keyLabel="7" onPick={pickPicture}>
              <Svg html={borrowed.image?.svg} />
            </ToolButton>
          </div>
          <div className="sk-group" data-group="select" ref={(el) => void (buttons.current.select = el)}>
            <ToolButton checked={!!tool} title={`${t('select')} — 9`} keyLabel="9" onPick={pickSelect}>
              {PIXEL_ICONS[pixel]}
            </ToolButton>
          </div>
        </>,
        slot,
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            className="sk-menu"
            role="toolbar"
            style={at ? { top: at.top, left: at.left } : { visibility: 'hidden' }}
          >
            {open === 'shapes' &&
              SHAPES.map((s) => (
                <ToolButton key={s} checked={shape === s} title={borrowed[s]?.label ?? s} onPick={() => pickShape(s)}>
                  <Svg html={borrowed[s]?.svg} />
                </ToolButton>
              ))}
            {open === 'picture' && (
              <>
                <ToolButton
                  checked={active === 'image'}
                  title={t('uploadTitle')}
                  label={t('upload')}
                  onPick={(pointer) => {
                    setPictureOpen(false)
                    onFinding(false)
                    api.setActiveTool({ type: 'image', insertOnCanvasDirectly: pointer !== 'mouse' })
                  }}
                >
                  <Svg html={borrowed.image?.svg} />
                </ToolButton>
                <ToolButton
                  checked={finding}
                  title={t('searchTitle')}
                  label={t('search')}
                  onPick={() => {
                    setPictureOpen(false)
                    onFinding(!finding)
                  }}
                >
                  {SEARCH_ICON}
                </ToolButton>
              </>
            )}
            {open === 'select' &&
              PIXELS.map((p) => (
                <ToolButton key={p} checked={tool === p} title={t(`${p}Title`)} label={t(p)} onPick={() => onTool(p)}>
                  {PIXEL_ICONS[p]}
                </ToolButton>
              ))}
          </div>,
          container,
        )}
    </>
  )
}
