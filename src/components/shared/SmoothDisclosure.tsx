import { useId, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { CollapsiblePanel } from './CollapsiblePanel'

export type SmoothDisclosureProps = {
  summary: ReactNode
  children: ReactNode
  indicator?: ReactNode
  className?: string
  summaryClassName?: string
  bodyClassName?: string
  panelClassName?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  id?: string
  keepMounted?: boolean
}

/**
 * Accessible disclosure with a real enter/exit lifecycle.
 *
 * Native `<details>` removes its content box from layout immediately in the
 * browsers we support, so neighbouring sections jump. This keeps the content
 * mounted and delegates the unknown-height interpolation to CollapsiblePanel.
 */
export function SmoothDisclosure({
  summary,
  children,
  indicator,
  className,
  summaryClassName,
  bodyClassName,
  panelClassName,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  id,
  keepMounted = true,
}: SmoothDisclosureProps) {
  const generatedId = useId()
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? internalOpen
  const panelId = id ?? `smooth-disclosure-${generatedId.replace(/:/g, '')}`

  const toggle = () => {
    const next = !open
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section className={clsx('smooth-disclosure', className)} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className={clsx('smooth-disclosure-summary', summaryClassName)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {summary}
        {indicator ? <span className="smooth-disclosure-indicator" aria-hidden="true">{indicator}</span> : null}
      </button>
      <CollapsiblePanel
        open={open}
        id={panelId}
        className={clsx('smooth-disclosure-panel', panelClassName)}
        innerClassName={bodyClassName}
        openMs={380}
        closeMs={320}
        keepMounted={keepMounted}
      >
        {children}
      </CollapsiblePanel>
    </section>
  )
}
