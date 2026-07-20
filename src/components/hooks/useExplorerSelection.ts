import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'

type ExplorerMouseEvent = MouseEvent<HTMLElement>

export function hasExplorerSelectionModifier(event: ExplorerMouseEvent) {
  return event.ctrlKey || event.metaKey || event.shiftKey
}

export function useExplorerSelection(ids: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)

  const idSet = useMemo(() => new Set(ids), [ids])

  useEffect(() => {
    setSelectedIds((current) => {
      let changed = false
      const next = new Set<string>()
      current.forEach((id) => {
        if (idSet.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      })
      return changed ? next : current
    })
    setAnchorId((current) => (current && idSet.has(current) ? current : null))
  }, [idSet])

  const selectedIdList = useMemo(() => ids.filter((id) => selectedIds.has(id)), [ids, selectedIds])

  const clearSelection = useCallback(() => {
    setSelectedIds((current) => (current.size === 0 ? current : new Set()))
    setAnchorId((current) => (current === null ? current : null))
  }, [])

  const selectOnly = useCallback((id: string) => {
    setSelectedIds((current) => (current.size === 1 && current.has(id) ? current : new Set([id])))
    setAnchorId((current) => (current === id ? current : id))
  }, [])

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchorId(id)
  }, [])

  const selectRange = useCallback((id: string, append = false) => {
    setSelectedIds((current) => {
      const start = anchorId ? ids.indexOf(anchorId) : -1
      const end = ids.indexOf(id)
      if (end === -1) return current
      if (start === -1) return new Set([id])
      const [from, to] = start < end ? [start, end] : [end, start]
      const next = append ? new Set(current) : new Set<string>()
      ids.slice(from, to + 1).forEach((rangeId) => next.add(rangeId))
      return next
    })
    setAnchorId((current) => (current && idSet.has(current) ? current : id))
  }, [anchorId, idSet, ids])

  const applyGesture = useCallback((id: string, event: ExplorerMouseEvent) => {
    if (event.shiftKey) {
      selectRange(id, event.ctrlKey || event.metaKey)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      toggle(id)
      return
    }
    selectOnly(id)
  }, [selectOnly, selectRange, toggle])

  const ensureSelectedForContext = useCallback((id: string) => {
    if (selectedIds.has(id)) return
    selectOnly(id)
  }, [selectOnly, selectedIds])

  const setMany = useCallback((nextIds: string[]) => {
    setSelectedIds(new Set(nextIds.filter((id) => idSet.has(id))))
    setAnchorId(nextIds.find((id) => idSet.has(id)) ?? null)
  }, [idSet])

  return {
    selectedIds,
    selectedIdList,
    selectedCount: selectedIdList.length,
    clearSelection,
    selectOnly,
    toggle,
    selectRange,
    applyGesture,
    ensureSelectedForContext,
    setMany,
  }
}
