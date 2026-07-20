import { Columns3, Eye, EyeOff, RotateCcw } from 'lucide-react'
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type ThHTMLAttributes,
} from 'react'
import { useI18n } from '../hooks/useI18n'
import {
  ExplorerContextMenu,
  type ExplorerContextMenuItem,
  type ExplorerContextMenuState,
} from './ExplorerContextMenu'
import {
  useTableColumns,
  type TableColumnDef,
  type TableColumnsApi,
} from './useTableColumns'

export function TableColGroup({
  columns,
  api,
}: {
  columns: TableColumnDef[]
  api: TableColumnsApi
}) {
  return (
    <colgroup>
      {columns.map((column) => {
        const visible = api.isVisible(column.id)
        const width = api.widthOf(column.id)
        return (
          <col
            key={column.id}
            data-column={column.id}
            className={visible ? undefined : 'atlas-table-col-hidden'}
            style={{
              width: visible ? width : 0,
              transition: 'width var(--duration) var(--ease-out)',
            }}
          />
        )
      })}
    </colgroup>
  )
}

export function TableHeaderCell({
  column,
  api,
  children,
  className = '',
  scope = 'col',
  style,
  ...rest
}: {
  column: TableColumnDef
  api: TableColumnsApi
  children: ReactNode
  className?: string
  scope?: 'col' | 'row'
  style?: CSSProperties
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, 'scope' | 'style' | 'className' | 'children'>) {
  const { tx, format } = useI18n()
  const visible = api.isVisible(column.id)
  return (
    <th
      {...rest}
      scope={scope}
      data-column={column.id}
      className={[
        'atlas-table-th',
        visible ? '' : 'is-col-hidden',
        className,
      ].filter(Boolean).join(' ')}
      style={{ ...api.colStyle(column.id), ...style }}
      aria-hidden={!visible}
    >
      <div className="atlas-table-th-inner">
        <div className="atlas-table-th-label">{children}</div>
        {column.resizable !== false && visible ? (
          <span
            className="atlas-table-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={format(tx('table.resizeColumn'), { column: column.label })}
            onMouseDown={(event) => api.beginResize(column.id, event)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              api.setWidth(column.id, column.defaultWidth)
            }}
          />
        ) : null}
      </div>
    </th>
  )
}

export function TableCell({
  columnId,
  api,
  children,
  className = '',
  dataLabel,
  style,
}: {
  columnId: string
  api: TableColumnsApi
  children?: ReactNode
  className?: string
  dataLabel?: string
  style?: CSSProperties
}) {
  const visible = api.isVisible(columnId)
  return (
    <td
      data-column={columnId}
      data-label={dataLabel}
      className={[
        'atlas-table-td',
        visible ? '' : 'is-col-hidden',
        className,
      ].filter(Boolean).join(' ')}
      style={{ ...api.colStyle(columnId), ...style }}
      aria-hidden={!visible}
    >
      {visible ? children : null}
    </td>
  )
}

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
