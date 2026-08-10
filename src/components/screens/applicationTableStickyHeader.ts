import { useLayoutEffect, type RefObject } from 'react'

export type ApplicationTableStickyHeaderGeometry = {
  naturalTop: number
  stickyBoundary: number
  tableHeight: number
  headerHeight: number
}

export function resolveApplicationTableStickyHeaderOffset({
  naturalTop,
  stickyBoundary,
  tableHeight,
  headerHeight,
}: ApplicationTableStickyHeaderGeometry) {
  const maxOffset = Math.max(0, tableHeight - headerHeight)
  return Math.min(maxOffset, Math.max(0, stickyBoundary - naturalTop))
}

export function useApplicationTableStickyHeader({
  active,
  compactViewport,
  headerRef,
  residentToolsRef,
  shellRef,
}: {
  active: boolean
  compactViewport: boolean
  headerRef: RefObject<HTMLTableSectionElement | null>
  residentToolsRef: RefObject<HTMLDivElement | null>
  shellRef: RefObject<HTMLDivElement | null>
}) {
  useLayoutEffect(() => {
    if (!active) return
    const header = headerRef.current
    const shell = shellRef.current
    const stickyTools = residentToolsRef.current
    const table = header?.closest('table')
    if (!header || !shell || !stickyTools || !table) return

    const workspace = compactViewport
      ? null
      : shell.closest<HTMLElement>('.kanban-workspace')
    const scrollTarget: Window | HTMLElement = workspace ?? window
    let frame: number | null = null
    let stuck = false
    let appliedOffset = 0

    const sync = () => {
      frame = null
      const rootTop = workspace?.getBoundingClientRect().top ?? 0
      const stickyBoundary = Math.max(rootTop, stickyTools.getBoundingClientRect().bottom)
      const offset = resolveApplicationTableStickyHeaderOffset({
        naturalTop: header.getBoundingClientRect().top - appliedOffset,
        stickyBoundary,
        tableHeight: table.offsetHeight,
        headerHeight: header.offsetHeight,
      })
      const pixelRatio = window.devicePixelRatio || 1
      const roundedOffset = Math.round(offset * pixelRatio) / pixelRatio
      appliedOffset = roundedOffset
      header.style.setProperty('--application-table-header-offset', `${roundedOffset}px`)

      const nextStuck = roundedOffset > 0
      if (nextStuck === stuck) return
      stuck = nextStuck
      header.toggleAttribute('data-stuck', stuck)
    }

    const scheduleSync = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(sync)
    }

    scrollTarget.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleSync)
      : null
    resizeObserver?.observe(table)
    resizeObserver?.observe(header)
    resizeObserver?.observe(stickyTools)
    if (workspace) resizeObserver?.observe(workspace)
    sync()

    return () => {
      scrollTarget.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      resizeObserver?.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      header.style.removeProperty('--application-table-header-offset')
      header.removeAttribute('data-stuck')
    }
  }, [active, compactViewport, headerRef, residentToolsRef, shellRef])
}
