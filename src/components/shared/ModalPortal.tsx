import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

let cachedModalHost: HTMLElement | null = null

function getModalHost() {
  // A public/auth route can open a portal before the signed-in shell exists.
  // Keep the body fallback temporary so later dialogs still use the shell's
  // scoped theme and stacking context after navigation.
  if (cachedModalHost?.isConnected && cachedModalHost !== document.body) return cachedModalHost
  cachedModalHost = document.querySelector<HTMLElement>('.atlas-shell, .admin-shell') ?? document.body
  return cachedModalHost
}

export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null

  return createPortal(children, getModalHost())
}
