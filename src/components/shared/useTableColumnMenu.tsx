import { Columns3, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useI18n } from '../hooks/useI18n'
import {
  ExplorerContextMenu,
  type ExplorerContextMenuItem,
  type ExplorerContextMenuState,
} from './ExplorerContextMenu'
import { useTableColumns, type TableColumnDef } from './useTableColumns'

/** Hook that also owns the right-click column menu for a table. */
export function useTableColumnMenu(storageKey: string, columns: TableColumnDef[]) {
  const { tx } = useI18n()
  const api = useTableColumns(storageKey, columns)
  const [menu, setMenu] = useState<ExplorerContextMenuState | null>(null)

  const openMenu = useCallback((event: ReactMouseEvent, title?: string) => {
    event.preventDefault()
    event.stopPropagation()
    const items: ExplorerContextMenuItem[] = [
      ...columns.map((column) => {
        const visible = api.isVisible(column.id)
        const locked = column.hideable === false
        return {
          id: `col-${column.id}`,
          label: column.label,
          icon: visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />,
          selected: visible,
          disabled: locked || (visible && api.visibleColumns.length <= 1),
          onSelect: () => api.toggleVisible(column.id),
        } satisfies ExplorerContextMenuItem
      }),
      {
        id: 'show-all',
        label: tx('table.showAllColumns'),
        icon: <Columns3 size={14} aria-hidden="true" />,
        disabled: api.hidden.length === 0,
        onSelect: () => api.showAll(),
      },
      {
        id: 'reset',
        label: tx('table.resetColumns'),
        icon: <RotateCcw size={14} aria-hidden="true" />,
        onSelect: () => api.reset(),
      },
    ]
    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: title ?? tx('table.columns'),
      subtitle: tx('table.columnsHint'),
      items,
    })
  }, [api, columns, tx])

  const menuNode = useMemo(
    () => <ExplorerContextMenu menu={menu} onClose={() => setMenu(null)} />,
    [menu],
  )

  return { api, openMenu, menuNode, menu, setMenu }
}
