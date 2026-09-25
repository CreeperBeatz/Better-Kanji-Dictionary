/**
 * Excalidraw's toolbar, regrouped: its rectangle, diamond and ellipse become
 * one Shapes button, its image button becomes a Picture button (upload, or
 * search online), the pixel eraser shares a button with Excalidraw's, and the
 * picture-selection tools join them as a fourth. Each
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
    eraser: 'Eraser',
    objectEraser: 'Object eraser',
    objectEraserTitle: 'Object eraser: erase whole elements',
    pixelEraser: 'Pixel eraser',
    pixelEraserTitle: 'Pixel eraser: erase only what is inside the circle',
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
    eraser: 'Гума',
    objectEraser: 'Гума за обекти',
    objectEraserTitle: 'Гума за обекти: изтрийте цели елементи',
    pixelEraser: 'Гума за пиксели',
    pixelEraserTitle: 'Гума за пиксели: изтрийте само това, което е в кръга',
  },
)

const SHAPES = ['rectangle', 'diamond', 'ellipse'] as const
type Shape = (typeof SHAPES)[number]
type Picker = Exclude<PixelTool, 'erase'>
const PIXELS: Picker[] = ['lasso', 'box', 'wand', 'subject']

/** The Excalidraw tools that stay in the row, by the number that now picks them. */
const RENUMBERED = { arrow: '3', line: '4', freedraw: '5', text: '6' } as const
const BY_KEY: Record<string, keyof typeof RENUMBERED> = { 3: 'arrow', 4: 'line', 5: 'freedraw', 6: 'text' }

type Group = 'shapes' | 'picture' | 'erase' | 'select'

/** A choice in a group's row. */
interface Item {
  id: string
  checked: boolean
  title: string
  label?: string
  icon: React.ReactNode
  pick: (pointer: string) => void
}

const icon = (d: string) => (
  <svg className="sk-own" viewBox="0 0 20 20" aria-hidden>
    <path d={d} />
  </svg>
)

const PIXEL_ICONS: Record<Picker, React.ReactNode> = {
  lasso: icon('M10 4c4 0 7 1.8 7 4.2S14 12.5 10 12.5 3 10.6 3 8.2 6 4 10 4Zm-5.6 7.3C3.5 13 4 15.4 6.2 16.3'),
  box: icon('M3 3h3M9 3h2M14 3h3v3M17 9v2M17 14v3h-3M11 17H9M6 17H3v-3M3 11V9M3 6V3'),
  wand: icon('M3.5 16.5l9-9M11 6l3 3M14.5 2.5v2M17.5 5.5h-2M16.6 3.4l-1.4 1.4M9 3.5v1.5M4 9h1.5'),
  subject: icon('M10 3.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM5 16.5c0-3.3 2.2-5.6 5-5.6s5 2.3 5 5.6M2.5 6V2.5H6M14 2.5h3.5V6M17.5 14v3.5H14M6 17.5H2.5V14'),
}
// Excalidraw's own eraser icon goes to the pixel eraser, the default; this
// one, whole elements, to its own.
const OBJECT_ERASER_ICON = icon('M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM7.5 7.5h1.5V9H7.5ZM11 7.5h1.5V9H11ZM9.2 11h1.5v1.5H9.2Z')
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
  const [borrowed, setBorrowed] = useState<Partial<Record<Shape | 'image' | 'eraser', Borrowed>>>({})
  const [active, setActive] = useState(() => api.getAppState().activeTool.type)
  // The group whose row is open. While it is, the number keys pick in the
  // row; a click anywhere else puts it away and gives them back to the toolbar.
  const [open, setOpen] = useState<Group | null>(null)
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
        if (cur.rectangle && cur.image && cur.eraser) return cur
        const next: typeof cur = {}
        for (const tool of [...SHAPES, 'image', 'eraser'] as const) next[tool] = borrow(host, tool) ?? undefined
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

  // A tool picked from outside a group (Excalidraw's letter keys, its own
  // buttons) puts that group's row away.
  useEffect(
    () =>
      api.onChange((_, appState) => {
        const type = appState.activeTool.type
        setActive(type)
        setOpen((o) =>
          (o === 'shapes' && !(SHAPES as readonly string[]).includes(type)) ||
          (o === 'picture' && type !== 'selection' && type !== 'image') ||
          (o === 'erase' && type !== 'eraser' && type !== 'custom')
            ? null
            : o,
        )
      }),
    [api],
  )

  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef<Record<Group, HTMLDivElement | null>>({ shapes: null, picture: null, erase: null, select: null })

  useEffect(() => {
    if (!open) return
    const group = open
    const down = (e: PointerEvent) => {
      const at = e.target as Node
      if (!menu.current?.contains(at) && !buttons.current[group]?.contains(at)) setOpen(null)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])

  const shape = (SHAPES as readonly string[]).includes(active) ? (active as Shape) : null
  const picker = tool && tool !== 'erase' ? tool : null
  const erasing = active === 'eraser' || tool === 'erase'
  // The picture tools' row goes when the tool is put down (by Escape, or a
  // cut piece handed back to Excalidraw's selection).
  const shown = (open === 'select' && !picker) || (open === 'erase' && !erasing) ? null : open

  // Each group, taken up without picking, works as its first tool -- except
  // Picture, whose first opens a file dialog, which should not come up unasked.
  const pickShapes = useCallback(() => {
    if (open === 'shapes') return setOpen(null)
    if (!shape) api.setActiveTool({ type: SHAPES[0] })
    setOpen('shapes')
  }, [api, open, shape])
  const pickPicture = useCallback(() => {
    if (open === 'picture') return setOpen(null)
    onTool(null)
    if (active !== 'selection' && active !== 'image') api.setActiveTool({ type: 'selection' })
    setOpen('picture')
  }, [api, open, active, onTool])
  const pickEraser = useCallback(() => {
    if (shown === 'erase') return setOpen(null)
    if (!erasing) onTool('erase')
    setOpen('erase')
  }, [shown, erasing, onTool])
  const pickSelect = useCallback(() => {
    if (shown === 'select') return setOpen(null)
    if (!picker) onTool(PIXELS[0])
    setOpen('select')
  }, [shown, picker, onTool])

  const items: Item[] =
    shown === 'shapes'
      ? SHAPES.map((s) => ({
          id: s,
          checked: shape === s,
          title: borrowed[s]?.label ?? s,
          icon: <Svg html={borrowed[s]?.svg} />,
          pick: () => api.setActiveTool({ type: s }),
        }))
      : shown === 'picture'
        ? [
            {
              id: 'upload',
              checked: active === 'image',
              title: t('uploadTitle'),
              label: t('upload'),
              icon: <Svg html={borrowed.image?.svg} />,
              pick: (pointer) => {
                setOpen(null)
                onFinding(false)
                api.setActiveTool({ type: 'image', insertOnCanvasDirectly: pointer !== 'mouse' })
              },
            },
            {
              id: 'search',
              checked: finding,
              title: t('searchTitle'),
              label: t('search'),
              icon: SEARCH_ICON,
              pick: () => {
                setOpen(null)
                onFinding(!finding)
              },
            },
          ]
        : shown === 'erase'
          ? [
              {
                id: 'pixel',
                checked: tool === 'erase',
                title: t('pixelEraserTitle'),
                label: t('pixelEraser'),
                icon: <Svg html={borrowed.eraser?.svg} />,
                pick: () => onTool('erase'),
              },
              {
                id: 'object',
                checked: active === 'eraser',
                title: t('objectEraserTitle'),
                label: t('objectEraser'),
                icon: OBJECT_ERASER_ICON,
                pick: () => api.setActiveTool({ type: 'eraser' }),
              },
            ]
          : shown === 'select'
          ? PIXELS.map((p) => ({
              id: p,
              checked: tool === p,
              title: t(`${p}Title`),
              label: t(p),
              icon: PIXEL_ICONS[p],
              pick: () => onTool(p),
            }))
          : []

  // The number keys: in an open row, its items; otherwise, or for a number
  // the row does not have (which leaves it), the toolbar, in the order it now
  // stands.
  const inRow = useRef(items)
  useEffect(() => {
    inRow.current = items
  })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !/^[0-9]$/.test(e.key)) return
      const st = api.getAppState()
      if (st.openDialog || st.newElement || st.selectionElement || st.selectedElementsAreBeingDragged || st.editingTextElement) return
      const k = e.key
      const item = inRow.current[Number(k) - 1]
      if (item) item.pick('mouse')
      else {
        if (inRow.current.length) setOpen(null)
        if (k === '2') pickShapes()
        else if (k === '7') pickPicture()
        else if (k === '8') pickEraser()
        else if (k === '9') pickSelect()
        else if (BY_KEY[k]) api.setActiveTool({ type: BY_KEY[k] })
        else if (k !== '0') return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [api, pickShapes, pickPicture, pickEraser, pickSelect])

  // The row sits under the toolbar, below its group's button.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!shown || !container || !row) return
    function place() {
      const button = buttons.current[shown!]
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
  }, [shown, container, row, shape, tool, active])

  if (!row || !container) return null

  const shapeIcon = shape ?? SHAPES[0]
  const pixel = picker ?? PIXELS[0]

  return (
    <>
      {createPortal(
        <>
          <div className="sk-group" data-group="shapes" ref={(el) => void (buttons.current.shapes = el)}>
            <ToolButton checked={!!shape} title={`${t('shapes')} — 2`} keyLabel="2" onPick={pickShapes}>
              <Svg html={borrowed[shapeIcon]?.svg} />
            </ToolButton>
          </div>
          <div className="sk-group" data-group="picture" ref={(el) => void (buttons.current.picture = el)}>
            <ToolButton checked={shown === 'picture' || finding || active === 'image'} title={`${t('picture')} — 7`} keyLabel="7" onPick={pickPicture}>
              <Svg html={borrowed.image?.svg} />
            </ToolButton>
          </div>
          <div className="sk-group" data-group="erase" ref={(el) => void (buttons.current.erase = el)}>
            <ToolButton checked={erasing} title={`${t('eraser')} — 8`} keyLabel="8" onPick={pickEraser}>
              {active === 'eraser' ? OBJECT_ERASER_ICON : <Svg html={borrowed.eraser?.svg} />}
            </ToolButton>
          </div>
          <div className="sk-group" data-group="select" ref={(el) => void (buttons.current.select = el)}>
            <ToolButton checked={!!picker} title={`${t('select')} — 9`} keyLabel="9" onPick={pickSelect}>
              {PIXEL_ICONS[pixel]}
            </ToolButton>
          </div>
        </>,
        slot,
      )}
      {shown &&
        createPortal(
          <div
            ref={menu}
            className="sk-menu"
            role="toolbar"
            style={at ? { top: at.top, left: at.left } : { visibility: 'hidden' }}
          >
            {items.map((item, i) => (
              <ToolButton
                key={item.id}
                checked={item.checked}
                title={`${item.title} — ${i + 1}`}
                label={item.label}
                keyLabel={String(i + 1)}
                onPick={item.pick}
              >
                {item.icon}
              </ToolButton>
            ))}
          </div>,
          container,
        )}
    </>
  )
}
