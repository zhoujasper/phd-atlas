import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null

  const host = document.querySelector<HTMLElement>('.atlas-shell, .admin-shell') ?? document.body
  return createPortal(children, host)
}
