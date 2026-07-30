import {
  Fragment,
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

let cachedModalHost: HTMLElement | null = null
type ModalPortalState = 'preparing' | 'ready'
type ModalPortalChildProps = {
  'data-modal-portal-state'?: ModalPortalState
}

function getModalHost() {
  // A public/auth route can open a portal before the signed-in shell exists.
  // Keep the body fallback temporary so later dialogs still use the shell's
  // scoped theme and stacking context after navigation.
  if (cachedModalHost?.isConnected && cachedModalHost !== document.body) return cachedModalHost
  cachedModalHost = document.querySelector<HTMLElement>('.atlas-shell, .admin-shell') ?? document.body
  return cachedModalHost
}

export function ModalPortal({ children }: { children: ReactNode }) {
  const [portalState, setPortalState] = useState<ModalPortalState>('preparing')

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setPortalState('ready')
      return undefined
    }

    const frame = window.requestAnimationFrame(() => setPortalState('ready'))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  if (typeof document === 'undefined') return null

  const portalChildren = isValidElement<ModalPortalChildProps>(children) && children.type !== Fragment
    ? cloneElement(children, { 'data-modal-portal-state': portalState })
    : children

  return createPortal(portalChildren, getModalHost())
}
