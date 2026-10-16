/**
 * A card that folds to its title, as a meaning's does: its body opens and
 * shuts in a short movement, not at once. Shut while read down it -- its
 * title held at the top of the screen -- the page goes back up with it, as
 * far as the card's top was above the title, so the shut card ends where the
 * title stood, at the top of the screen: not some other card.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { run } from '../cardStack'
import { reducedMotion } from '../media'

/** How long a card takes to open or shut, in ms. */
const FOLD_MS = 150

/** The box `el` scrolls in: the nearest one up that scrolls. */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY
    if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

/**
 * For a card that is `open` or not: whether its body is there (it stays
 * while it shuts), and the refs for the card and its body. The first draw
 * stands as it is; each change after moves.
 */
export function useFold(open: boolean) {
  const [shown, setShown] = useState(open)
  // Opening, the body is there from the draw that opens it, to grow from nothing.
  if (open && !shown) setShown(true)
  const card = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const was = useRef(open)
  const stop = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    if (was.current === open) return
    was.current = open
    stop.current?.()
    stop.current = null
    const el = body.current
    if (!el) {
      if (!open) setShown(false)
      return
    }
    const ms = reducedMotion() ? 0 : FOLD_MS
    // From where it stands, should it be moving still. The room under it
    // moves inside the height (the box would not go below it otherwise).
    const from = el.style.height ? el.offsetHeight : open ? 0 : el.offsetHeight
    el.style.paddingBottom = ''
    const to = open ? el.scrollHeight : 0
    el.style.overflow = 'hidden'
    el.style.paddingBottom = '0'
    // Where it starts, before the frame is drawn: a body just put in would
    // show whole for a frame before its first step.
    el.style.height = `${from}px`
    if (open && !el.style.opacity) el.style.opacity = '0'
    if (open) {
      stop.current = run(
        ms,
        (e) => {
          el.style.height = `${from + (to - from) * e}px`
          el.style.opacity = String(e)
        },
        () => {
          // Open, as tall as it is: what it was moving to.
          el.removeAttribute('style')
          stop.current = null
        },
      )
      return
    }
    // Read down it, its title held at the top: the page goes up by as much as
    // the card's top is above the title, as the body goes.
    const box = card.current
    const head = box?.querySelector<HTMLElement>(':scope > header')
    const sc = box && scrollerOf(box)
    const above = box && head ? head.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientTop : 0
    const start = sc?.scrollTop ?? 0
    // The browser would hold what is on the screen in place instead.
    const anchor = (on: boolean) => sc && above > 0.5 && (sc.style.overflowAnchor = on ? '' : 'none')
    anchor(false)
    const halt = run(
      ms,
      (e) => {
        el.style.height = `${from * (1 - e)}px`
        el.style.opacity = String(1 - e)
        if (sc && above > 0.5) sc.scrollTop = start - above * e
      },
      () => {
        // Shut, it goes as it is, nothing in it, in this same frame: given its
        // height back first, it would show whole for the frame before it went.
        stop.current = null
        anchor(true)
        flushSync(() => setShown(false))
      },
    )
    stop.current = () => {
      halt()
      anchor(true)
    }
  }, [open])

  return { shown, card, body }
}
