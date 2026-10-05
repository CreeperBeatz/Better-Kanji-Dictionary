/**
 * A dialog over the page: its panel on a backdrop, with a × in the corner. A
 * press on the backdrop closes it, and so does Escape, unless `escape` is
 * false: then whatever opened it decides what Escape closes.
 */
import type { ComponentProps, ReactNode } from 'react'
import { strings, useLang } from './i18n'
import { useKey } from './keys'

const S = strings({ close: 'close' }, { close: 'затворете' })

interface Props extends Omit<ComponentProps<'div'>, 'className' | 'role'> {
  /** The backdrop's classes beside `overlay`. */
  className?: string
  /** The panel's beside `overlay-panel`; the rest of the props go to the panel too. */
  panel: string
  label: string
  onClose: () => void
  escape?: boolean
  /** The ×'s tooltip, when it says more than "close". */
  closeTitle?: string
  children: ReactNode
}

export function Overlay({ className, panel, label, onClose, escape = true, closeTitle, children, ...rest }: Props) {
  const t = S(useLang())
  useKey(
    (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        onClose()
      }
    },
    { on: escape },
  )
  return (
    <div className={className ? `overlay ${className}` : 'overlay'} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div {...rest} className={`overlay-panel ${panel}`} role="dialog" aria-modal="true" aria-label={label}>
        <button className="account-x" onClick={onClose} aria-label={t('close')} title={closeTitle ?? t('close')}>
          ×
        </button>
        {children}
      </div>
    </div>
  )
}
