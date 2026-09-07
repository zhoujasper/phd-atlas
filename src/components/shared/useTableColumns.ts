import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'

export type TableColumnDef = {
  id: string
  label: string
  defaultWidth: number
  minWidth?: number
  maxWidth?: number
  /** Defaults to true. When false the column cannot be hidden. */
  hideable?: boolean
  /** Defaults to true. */
  resizable?: boolean
}

export type TableColumnPrefs = {
  widths: Record<string, number>
  hidden: string[]
}

const PREFS_PREFIX = 'phd-atlas-table-cols:'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readPrefs(storageKey: string): TableColumnPrefs | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${PREFS_PREFIX}${storageKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TableColumnPrefs>
    return {
      widths: parsed.widths && typeof parsed.widths === 'object' ? parsed.widths : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

function writePrefs(storageKey: string, prefs: TableColumnPrefs) {
  if (typeof window === 'undefined') return
  try {
    const key = `${PREFS_PREFIX}${storageKey}`
    const serialized = JSON.stringify(prefs)
    if (window.localStorage.getItem(key) !== serialized) window.localStorage.setItem(key, serialized)
  } catch {
    // Ignore quota / private mode failures.
  }
}

function buildWidths(columns: TableColumnDef[], stored?: Record<string, number>) {
  const next: Record<string, number> = {}
  for (const column of columns) {
    const min = column.minWidth ?? 72
    const max = column.maxWidth ?? 560
    const raw = stored?.[column.id]
    next[column.id] = Number.isFinite(raw) ? clamp(Number(raw), min, max) : column.defaultWidth
  }
  return next
}

function buildHidden(columns: TableColumnDef[], stored?: string[]) {
  const hideableIds = new Set(columns.filter((column) => column.hideable !== false).map((column) => column.id))
  const alwaysVisible = columns.filter((column) => column.hideable === false).map((column) => column.id)
  const hidden = [...new Set((stored ?? []).filter((id) => hideableIds.has(id)))]
  // Never hide every column — keep at least one visible.
  const visibleCount = columns.length - hidden.length
  if (visibleCount <= 0 && columns[0]) {
    return hidden.filter((id) => id !== columns[0].id)
  }
  // Always-visible columns cannot stay hidden.
  return hidden.filter((id) => !alwaysVisible.includes(id))
}

export function useTableColumns(storageKey: string, columns: TableColumnDef[]) {
  const columnsKey = JSON.stringify(columns.map(({ id, defaultWidth, minWidth, maxWidth, hideable, resizable }) => (
    [id, defaultWidth, minWidth, maxWidth, hideable, resizable]
  )))
  const scopeKey = JSON.stringify([storageKey, columnsKey])
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const resizeCleanupRef = useRef<((updateState?: boolean) => void) | null>(null)
  const [loadedScope, setLoadedScope] = useState(scopeKey)

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const stored = readPrefs(storageKey)
    return buildWidths(columns, stored?.widths)
  })
  const [hidden, setHidden] = useState<string[]>(() => {
    const stored = readPrefs(storageKey)
    return buildHidden(columns, stored?.hidden)
  })
  const widthsRef = useRef(widths)
  const hiddenRef = useRef(hidden)
  widthsRef.current = widths
  hiddenRef.current = hidden

  useEffect(() => () => resizeCleanupRef.current?.(false), [scopeKey])

  // Re-sync when column definitions change (new table versions).
  useEffect(() => {
    const stored = readPrefs(storageKey)
    setWidths(buildWidths(columnsRef.current, stored?.widths))
    setHidden(buildHidden(columnsRef.current, stored?.hidden))
    setLoadedScope(scopeKey)
  }, [storageKey, scopeKey])

  useEffect(() => {
    if (resizeCleanupRef.current || loadedScope !== scopeKey) return
    writePrefs(storageKey, { widths, hidden })
  }, [storageKey, widths, hidden, loadedScope, scopeKey])

  const isVisible = useCallback((id: string) => !hidden.includes(id), [hidden])

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.includes(column.id)),
    [columns, hidden],
  )

  const widthOf = useCallback((id: string) => {
    const column = columnsRef.current.find((item) => item.id === id)
    return widths[id] ?? column?.defaultWidth ?? 120
  }, [widths])

  const colStyle = useCallback((id: string): CSSProperties => {
    const visible = isVisible(id)
    const width = widthOf(id)
    if (!visible) {
      return {
        width: 0,
        minWidth: 0,
        maxWidth: 0,
        padding: 0,
        borderWidth: 0,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }
    }
    return {
      width,
      minWidth: width,
      maxWidth: width,
    }
  }, [isVisible, widthOf])

  const toggleVisible = useCallback((id: string) => {
    const column = columnsRef.current.find((item) => item.id === id)
    if (!column || column.hideable === false) return
    setHidden((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      // Keep at least one column visible.
      if (current.length >= columnsRef.current.length - 1) return current
      return [...current, id]
    })
  }, [])

  const showAll = useCallback(() => setHidden([]), [])

  const reset = useCallback(() => {
    setWidths(buildWidths(columnsRef.current))
    setHidden([])
  }, [])

  const beginResize = useCallback((id: string, event: ReactMouseEvent | MouseEvent) => {
    const column = columnsRef.current.find((item) => item.id === id)
    if (!column || column.resizable === false) return
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const startX = 'clientX' in event ? event.clientX : 0
    const startWidth = widthOf(id)
    const min = column.minWidth ?? 72
    const max = column.maxWidth ?? 560
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    let finalWidth = startWidth
    let frame: number | null = null
    let finished = false

    const applyWidth = () => {
      frame = null
      setWidths((current) => current[id] === finalWidth ? current : { ...current, [id]: finalWidth })
    }

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      finalWidth = clamp(startWidth + delta, min, max)
      if (frame === null) frame = window.requestAnimationFrame(applyWidth)
    }
    const finish = (updateState = true) => {
      if (finished) return
      finished = true
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = null
      resizeCleanupRef.current = null
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      // Persist the last pointer position even if mouseup beats the paint or
      // navigation unmounts the table. No storage writes run during movement.
      writePrefs(storageKey, { widths: { ...widthsRef.current, [id]: finalWidth }, hidden: hiddenRef.current })
      if (updateState) applyWidth()
    }
    const onUp = () => finish()
    resizeCleanupRef.current = finish
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }, [storageKey, widthOf])

  return {
    columns,
    visibleColumns,
    hidden,
    widths,
    isVisible,
    widthOf,
    colStyle,
    toggleVisible,
    showAll,
    reset,
    beginResize,
    setWidth: (id: string, width: number) => {
      if (!Number.isFinite(width)) return
      const column = columnsRef.current.find((item) => item.id === id)
      if (!column) return
      const min = column.minWidth ?? 72
      const max = column.maxWidth ?? 560
      setWidths((current) => ({ ...current, [id]: clamp(width, min, max) }))
    },
  }
}

export type TableColumnsApi = ReturnType<typeof useTableColumns>
