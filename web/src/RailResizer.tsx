/**
 * The rail's right edge, dragged to make it wider or narrower (desktop only;
 * on a narrow screen the rail sits above the stage and this is hidden).
 * The width is remembered per browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { strings, useLang } from './i18n'

const S = strings(
  {
    resize: 'Resize the side panel',
    split: 'Move the split between the search and the dictionary',
    hint: 'Drag to resize, double-click to reset',
  },
  {
    resize: 'Променете ширината на страничния панел',
    split: 'Преместете границата между търсенето и речника',
    hint: 'Плъзнете, за да промените ширината; двоен клик я връща',
  },
)

const KEY = 'betterrtk:rail'
export const RAIL_DEFAULT = 384
// Room for all three tabs (Associations with a count) and the Focus / Map
// switch in one row, in either language.
export const RAIL_MIN = 380
const RAIL_MAX = 760
// However wide the rail, the stage keeps at least this much.
export const STAGE_MIN = 360

function clamp(px: number): number {
  const max = Math.max(RAIL_MIN, Math.min(RAIL_MAX, window.innerWidth - STAGE_MIN))
  return Math.round(Math.min(max, Math.max(RAIL_MIN, px)))
}

function remembered(): number {
  try {
    const saved = Number(localStorage.getItem(KEY))
    return saved ? clamp(saved) : RAIL_DEFAULT
  } catch {
    return RAIL_DEFAULT
  }
}

function remember(px: number) {
  try {
    localStorage.setItem(KEY, String(px))
  } catch {
    // not remembered, which is fine
  }
}

export function useRailWidth() {
  const [width, setWidth] = useState(remembered)

  // A window made smaller should not leave the stage squeezed to nothing.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const set = useCallback((px: number, persist: boolean) => {
    const next = clamp(px)
    setWidth(next)
    if (persist) remember(next)
  }, [])

  return [width, set] as const
}

/**
 * `columns` is how many rail-wide columns the edge closes: two when the search
 * has its own, which then share each move, so each takes half of it.
 */
export function RailResizer({
  width,
  onWidth,
  columns = 1,
}: {
  width: number
  onWidth: (px: number, persist: boolean) => void
  columns?: number
}) {
  const drag = useRef<{ startX: number; startW: number; last: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const t = S(useLang())

  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('rail-resizing')
    return () => document.body.classList.remove('rail-resizing')
  }, [dragging])

  return (
    <div
      className="rail-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize')}
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title={t('hint')}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { startX: e.clientX, startW: width, last: width }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.last = d.startW + (e.clientX - d.startX) / columns
        onWidth(d.last, false)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        onWidth(d.last, true)
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={() => onWidth(RAIL_DEFAULT, true)}
      onKeyDown={(e) => {
        const step = (e.shiftKey ? 64 : 16) / columns
        if (e.key === 'ArrowLeft') onWidth(width - step, true)
        else if (e.key === 'ArrowRight') onWidth(width + step, true)
        else if (e.key === 'Home') onWidth(RAIL_MIN, true)
        else if (e.key === 'End') onWidth(RAIL_MAX, true)
        else return
        e.preventDefault()
      }}
    />
  )
}

const SHARE_KEY = 'betterrtk:searchShare'
export const SHARE_DEFAULT = 0.45
// However the two columns split, neither gets narrower than this.
const SEARCH_MIN = 240
const ENTRY_MIN = 340

export function clampShare(share: number, total: number): number {
  const lo = Math.min(SEARCH_MIN / total, SHARE_DEFAULT)
  const hi = Math.max(1 - ENTRY_MIN / total, SHARE_DEFAULT)
  return Math.min(hi, Math.max(lo, share))
}

/** The search column's share of the two, remembered per browser. */
export function useSearchShare() {
  const [share, setShare] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SHARE_KEY))
      return saved > 0 && saved < 1 ? saved : SHARE_DEFAULT
    } catch {
      return SHARE_DEFAULT
    }
  })
  const set = useCallback((next: number, persist: boolean) => {
    setShare(next)
    if (!persist) return
    try {
      localStorage.setItem(SHARE_KEY, String(next))
    } catch {
      // not remembered, which is fine
    }
  }, [])
  return [share, set] as const
}

/**
 * The edge between the search column and the dictionary. It moves only the
 * split between them; the two together stay as wide as they were.
 */
export function SplitResizer({
  share,
  total,
  onShare,
}: {
  share: number
  total: number
  onShare: (share: number, persist: boolean) => void
}) {
  const drag = useRef<{ startX: number; startPx: number; last: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const t = S(useLang())
  const shown = clampShare(share, total)

  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('rail-resizing')
    return () => document.body.classList.remove('rail-resizing')
  }, [dragging])

  const to = (next: number, persist: boolean) => onShare(clampShare(next, total), persist)

  return (
    <div
      className="rail-resizer split-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('split')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      tabIndex={0}
      title={t('hint')}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { startX: e.clientX, startPx: shown * total, last: shown }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.last = clampShare((d.startPx + e.clientX - d.startX) / total, total)
        onShare(d.last, false)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        onShare(d.last, true)
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={() => to(SHARE_DEFAULT, true)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.08 : 0.02
        if (e.key === 'ArrowLeft') to(shown - step, true)
        else if (e.key === 'ArrowRight') to(shown + step, true)
        else return
        e.preventDefault()
      }}
    />
  )
}
