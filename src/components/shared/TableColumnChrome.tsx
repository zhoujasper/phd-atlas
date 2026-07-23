import {
  type CSSProperties,
  type ReactNode,
  type ThHTMLAttributes,
} from 'react'
import { useI18n } from '../hooks/useI18n'
import {
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
