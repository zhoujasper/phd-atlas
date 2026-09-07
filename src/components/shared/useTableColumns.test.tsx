import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTableColumns, type TableColumnDef } from './useTableColumns'

const columns: TableColumnDef[] = [
  { id: 'name', label: 'Name', defaultWidth: 160 },
  { id: 'location', label: 'Location', defaultWidth: 120 },
]

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('table column resize lifecycle', () => {
  it('releases global drag listeners and body styles when the table unmounts', () => {
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'text'
    const { result, unmount } = renderHook(() => useTableColumns('unmount', columns))
    act(() => result.current.beginResize('name', new MouseEvent('mousedown', { clientX: 20 })))
    expect(document.body.style.cursor).toBe('col-resize')
    unmount()
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('coalesces pointer movement and avoids synchronous storage writes during a drag', () => {
    const { result } = renderHook(() => useTableColumns('batched', columns))
    const write = vi.spyOn(Storage.prototype, 'setItem')
    act(() => result.current.beginResize('name', new MouseEvent('mousedown', { clientX: 20 })))
    for (let x = 21; x <= 80; x += 1) fireEvent.mouseMove(window, { clientX: x })
    expect(write).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.widthOf('name')).toBe(220)
    fireEvent.mouseUp(window)
    expect(result.current.widthOf('name')).toBe(220)
    expect(JSON.parse(localStorage.getItem('phd-atlas-table-cols:batched')!).widths.name).toBe(220)
    expect(write.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('ends a drag when window focus is lost and ignores later movement', () => {
    const { result } = renderHook(() => useTableColumns('blur', columns))
    act(() => result.current.beginResize('name', new MouseEvent('mousedown', { clientX: 20 })))
    fireEvent.mouseMove(window, { clientX: 70 })
    fireEvent.blur(window)
    fireEvent.mouseMove(window, { clientX: 200 })
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.widthOf('name')).toBe(210)
    expect(document.body.style.cursor).not.toBe('col-resize')
  })

  it('does not let duplicate stored hidden ids disable other visibility controls', () => {
    localStorage.setItem('phd-atlas-table-cols:duplicates', JSON.stringify({ hidden: ['name', 'name'], widths: {} }))
    const { result } = renderHook(() => useTableColumns('duplicates', columns))
    expect(result.current.hidden).toEqual(['name'])
    expect(result.current.visibleColumns.map(({ id }) => id)).toEqual(['location'])
  })

  it('ignores nonfinite programmatic widths', () => {
    const { result } = renderHook(() => useTableColumns('finite', columns))
    act(() => result.current.setWidth('name', Number.NaN))
    expect(result.current.widthOf('name')).toBe(160)
  })
})
