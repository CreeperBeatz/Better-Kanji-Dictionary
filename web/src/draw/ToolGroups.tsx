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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { strings, useLang } from '../i18n'
import { useCaptureKeys } from './keys'
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
const PIXELS: PixelTool[] = ['lasso', 'box', 'wand', 'subject']

/** Our tools in Excalidraw's custom slot: the picture tools and the pixel eraser. */
export type Tool = PixelTool | 'erase'

/** The Excalidraw tools that stay in the row, by the number that now picks them. */
const RENUMBERED = { arrow: '3', line: '4', freedraw: '5', text: '6' } as const
const BY_KEY = Object.fromEntries(Object.entries(RENUMBERED).map(([tool, n]) => [n, tool])) as Record<string, keyof typeof RENUMBERED>

type Group = 'shapes' | 'picture' | 'erase' | 'select'

/** Which of Excalidraw's tools in hand keep a group's row open. */
const KEEPS: Record<Group, (type: string) => boolean> = {
  shapes: (type) => (SHAPES as readonly string[]).includes(type),
  picture: (type) => type === 'selection' || type === 'image',
  erase: (type) => type === 'eraser' || type === 'custom',
  select: (type) => type === 'custom',
}

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

const PIXEL_ICONS: Record<PixelTool, React.ReactNode> = {
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

interface ButtonProps {
  checked: boolean
  title: string
  onPick: (pointer: string) => void
  children: React.ReactNode
  keyLabel?: string
  label?: string
}

/** A button in Excalidraw's own markup, so its stylesheet dresses it like the rest. */
function ToolButton({ checked, title, onPick, children, keyLabel, label }: ButtonProps) {
  const pointer = useRef('mouse')
  const titled = keyLabel ? `${title} — ${keyLabel}` : title
  return (
    <label className="ToolIcon Shape" title={titled} onPointerDown={(e) => (pointer.current = e.pointerType)}>
      <input
        className="ToolIcon_type_radio ToolIcon_size_medium"
        type="radio"
        aria-label={titled}
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
  tool: Tool | null
  onTool: (t: Tool | null) => void
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
  // a window narrowed), so the groups follow it into whichever row it has
  // now -- looked for once a frame at most, however much the editor changes.
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
    let frame = 0
    const watch = new MutationObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0
        attach()
      })
    })
    watch.observe(host, { childList: true, subtree: true })
    return () => {
      watch.disconnect()
      cancelAnimationFrame(frame)
      slot.remove()
    }
  }, [host, slot])

  // Taking up a tool that does not belong to the open row -- from another
  // group, Excalidraw's letter keys or its own buttons, or by putting one of
  // ours down -- puts the row away.
  useEffect(() => {
    let was = api.getAppState().activeTool.type
    return api.onChange((_, appState) => {
      const type = appState.activeTool.type
      if (type === was) return
      was = type
      setActive(type)
      setOpen((o) => (o && !KEEPS[o](type) ? null : o))
    })
  }, [api])

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

  /**
   * A group's button: opens its row, or puts it away. Taken up without
   * picking, a group works as its first tool -- except Picture, whose first
   * opens a file dialog, which should not come up unasked.
   */
  function take(group: Group, first: () => void) {
    if (open === group) return setOpen(null)
    first()
    setOpen(group)
  }

  const groups: { id: Group; key: string; title: string; checked: boolean; icon: React.ReactNode; pick: () => void }[] = [
    {
      id: 'shapes',
      key: '2',
      title: t('shapes'),
      checked: !!shape,
      icon: <Svg html={borrowed[shape ?? SHAPES[0]]?.svg} />,
      pick: () => take('shapes', () => shape || api.setActiveTool({ type: SHAPES[0] })),
    },
    {
      id: 'picture',
      key: '7',
      title: t('picture'),
      checked: open === 'picture' || finding || active === 'image',
      icon: <Svg html={borrowed.image?.svg} />,
      pick: () =>
        take('picture', () => {
          onTool(null)
          if (active !== 'selection' && active !== 'image') api.setActiveTool({ type: 'selection' })
        }),
    },
    {
      id: 'erase',
      key: '8',
      title: t('eraser'),
      checked: erasing,
      icon: active === 'eraser' ? OBJECT_ERASER_ICON : <Svg html={borrowed.eraser?.svg} />,
      pick: () => take('erase', () => erasing || onTool('erase')),
    },
    {
      id: 'select',
      key: '9',
      title: t('select'),
      checked: !!picker,
      icon: PIXEL_ICONS[picker ?? PIXELS[0]],
      pick: () => take('select', () => picker || onTool(PIXELS[0])),
    },
  ]

  const rows: Record<Group, () => Item[]> = {
    shapes: () =>
      SHAPES.map((s) => ({
        id: s,
        checked: shape === s,
        title: borrowed[s]?.label ?? s,
        icon: <Svg html={borrowed[s]?.svg} />,
        pick: () => api.setActiveTool({ type: s }),
      })),
    picture: () => [
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
    ],
    erase: () => [
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
    ],
    select: () =>
      PIXELS.map((p) => ({
        id: p,
        checked: tool === p,
        title: t(`${p}Title`),
        label: t(p),
        icon: PIXEL_ICONS[p],
        pick: () => onTool(p),
      })),
  }
  const items = open ? rows[open]() : []

  // The number keys: in an open row, its items; otherwise, or for a number
  // the row does not have (which leaves it), the toolbar, in the order it now
  // stands.
  useCaptureKeys(true, (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[0-9]$/.test(e.key)) return false
    const st = api.getAppState()
    if (st.openDialog || st.newElement || st.selectionElement || st.selectedElementsAreBeingDragged || st.editingTextElement) return false
    const item = items[Number(e.key) - 1]
    if (item) {
      item.pick('mouse')
      return true
    }
    if (items.length) setOpen(null)
    const group = groups.find((g) => g.key === e.key)
    if (group) group.pick()
    else if (BY_KEY[e.key]) api.setActiveTool({ type: BY_KEY[e.key] })
    else return e.key === '0'
    return true
  })

  // The row sits under the toolbar, below its group's button.
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
  }, [open, container, row, shape, tool, active])

  if (!row || !container) return null

  return (
    <>
      {createPortal(
        groups.map((g) => (
          <div key={g.id} className="sk-group" data-group={g.id} ref={(el) => void (buttons.current[g.id] = el)}>
            <ToolButton checked={g.checked} title={g.title} keyLabel={g.key} onPick={g.pick}>
              {g.icon}
            </ToolButton>
          </div>
        )),
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
            {items.map((item, i) => (
              <ToolButton key={item.id} checked={item.checked} title={item.title} label={item.label} keyLabel={String(i + 1)} onPick={item.pick}>
                {item.icon}
              </ToolButton>
            ))}
          </div>,
          container,
        )}
    </>
  )
}
