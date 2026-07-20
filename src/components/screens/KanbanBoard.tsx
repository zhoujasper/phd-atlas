import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
  type WheelEvent,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  ArrowRight,
  CalendarClock,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  GripVertical,
  LayoutGrid,
  ListChecks,
  Mail,
  Plus,
  Trash2,
} from 'lucide-react'
import type { ApplicationRecord, ApplicationStatus } from '../../data/applications'
import { daysUntil } from '../../appModel'
import { statusLabel } from '../../statusLabels'
import { DeadlineBadge } from '../shared/DeadlineBadge'
import { useI18n } from '../hooks/useI18n'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'

const KANBAN_GROUPS: Array<{
  key: 'active' | 'decision'
  statuses: ApplicationStatus[]
}> = [
  { key: 'active', statuses: ['Draft', 'Preparing', 'Submitted', 'Interview'] },
  { key: 'decision', statuses: ['Accepted', 'Rejected', 'Waitlist'] },
]

interface KanbanBoardProps {
  applications: ApplicationRecord[]
  onStatusChange: (id: string, status: ApplicationStatus) => void
  onSelect: (id: string) => void
  onPrefetch?: () => void
  onOpenInNewPage?: (id: string) => void
  onExportApplication?: (id: string) => void
  onCopy?: (value: string, label: string) => void
  onDeleteApplication?: (id: string) => void
  onNew?: () => void
}

function priorityLabel(p: number): 'high' | 'medium' | 'low' {
  if (p >= 80) return 'high'
  if (p >= 50) return 'medium'
  return 'low'
}

const kanbanStatusOrder: ApplicationStatus[] = ['Draft', 'Preparing', 'Submitted', 'Interview', 'Accepted', 'Rejected', 'Waitlist']
const KANBAN_COLUMN_INITIAL_COUNT = 4
const KANBAN_COLUMN_COMPACT_INITIAL_COUNT = 8
const KANBAN_COLUMN_BATCH_SIZE = 8

export function KanbanBoard({
  applications,
  onStatusChange,
  onSelect,
  onPrefetch,
  onOpenInNewPage,
  onExportApplication,
  onCopy,
  onDeleteApplication,
  onNew,
}: KanbanBoardProps) {
  const { tx, format } = useI18n()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<ApplicationStatus | null>(null)
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [compactViewport, setCompactViewport] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches
  ))
  const [visibilityState, setVisibilityState] = useState<{
    key: string
    counts: Partial<Record<ApplicationStatus, number>>
  }>({ key: '', counts: {} })
  const [revealState, setRevealState] = useState<{
    status: ApplicationStatus
    fromIndex: number
  } | null>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 820px)')
    const update = () => setCompactViewport(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  const initialColumnCount = compactViewport
    ? KANBAN_COLUMN_COMPACT_INITIAL_COUNT
    : KANBAN_COLUMN_INITIAL_COUNT

  const boardData = useMemo(() => {
    const buckets = Object.fromEntries(
      kanbanStatusOrder.map((status) => [status, [] as ApplicationRecord[]]),
    ) as Record<ApplicationStatus, ApplicationRecord[]>
    const applicationIds: string[] = []
    let urgentCount = 0
    for (const application of applications) {
      buckets[application.status].push(application)
      applicationIds.push(application.id)
      const due = daysUntil(application.deadline)
      if (due >= 0 && due <= 30) urgentCount += 1
    }
    const groupedColumns = KANBAN_GROUPS.map((group) => ({
      ...group,
      items: group.statuses.flatMap((status) => buckets[status]),
      columns: group.statuses.map((status) => ({ status, items: buckets[status] })),
    }))
    return {
      groupedColumns,
      urgentCount,
      datasetKey: applicationIds.join('\u0001'),
    }
  }, [applications])
  const visibilityKey = `${boardData.datasetKey}:${compactViewport ? 'compact' : 'desktop'}`
  const visibleCounts = visibilityState.key === visibilityKey ? visibilityState.counts : {}
  const activeCount = boardData.groupedColumns.find((group) => group.key === 'active')?.items.length ?? 0
  const decisionCount = boardData.groupedColumns.find((group) => group.key === 'decision')?.items.length ?? 0

  // Drop in-flight reveal styling when the underlying dataset or density mode changes.
  useEffect(() => {
    setRevealState(null)
  }, [visibilityKey])

  function handleDragStart(e: DragEvent<HTMLDivElement>, id: string) {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragEnd() {
    setDraggedId(null)
    setDragOverColumn(null)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, status: ApplicationStatus) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverColumn !== status) {
      setDragOverColumn(status)
    }
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOverColumn(null)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, status: ApplicationStatus) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    setDraggedId(null)
    setDragOverColumn(null)
    const app = applications.find((a) => a.id === id)
    if (app && app.status !== status) {
      onStatusChange(id, status)
    }
  }

  function showMoreApplications(status: ApplicationStatus, total: number) {
    const counts = visibilityState.key === visibilityKey ? visibilityState.counts : {}
    const fromIndex = counts[status] ?? initialColumnCount
    const nextCount = Math.min(total, fromIndex + KANBAN_COLUMN_BATCH_SIZE)
    if (nextCount <= fromIndex) return

    setRevealState({ status, fromIndex })
    setVisibilityState({
      key: visibilityKey,
      counts: {
        ...counts,
        [status]: nextCount,
      },
    })
  }

  function revealWhenNearColumnEnd(
    status: ApplicationStatus,
    total: number,
    target: HTMLDivElement,
    direction: number,
  ) {
    if (direction <= 0) return
    const distanceFromEnd = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceFromEnd <= 72) showMoreApplications(status, total)
  }

  function handleColumnScroll(event: UIEvent<HTMLDivElement>, status: ApplicationStatus, total: number) {
    revealWhenNearColumnEnd(status, total, event.currentTarget, 1)
  }

  function handleColumnWheel(event: WheelEvent<HTMLDivElement>, status: ApplicationStatus, total: number) {
    revealWhenNearColumnEnd(status, total, event.currentTarget, event.deltaY)
  }

  function handleRevealAnimationEnd(status: ApplicationStatus, revealIndex: number, batchSize: number) {
    if (revealIndex !== batchSize - 1) return
    setRevealState((current) => (current?.status === status ? null : current))
  }

  function moveApplicationByOffset(app: ApplicationRecord, offset: -1 | 1) {
    const currentIndex = kanbanStatusOrder.indexOf(app.status)
    if (currentIndex === -1) return
    const nextStatus = kanbanStatusOrder[currentIndex + offset]
    if (!nextStatus || nextStatus === app.status) return
    onStatusChange(app.id, nextStatus)
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, app: ApplicationRecord) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(app.id)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveApplicationByOffset(app, -1)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveApplicationByOffset(app, 1)
    }
  }

  function openCardContextMenu(event: MouseEvent<HTMLElement>, app: ApplicationRecord) {
    event.preventDefault()
    const statusItems = kanbanStatusOrder
      .filter((status) => status !== app.status)
      .map((status) => ({
        id: `move-${status}`,
        label: format(tx('kanban.moveToStatus'), { status: statusLabel(status, tx) }),
        icon: <ArrowRight size={14} aria-hidden="true" />,
        onSelect: () => onStatusChange(app.id, status),
      }))

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: app.school.name,
      subtitle: app.program,
      items: [
        {
          id: 'open',
          label: tx('explorer.open'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          shortcut: 'Enter',
          onSelect: () => onSelect(app.id),
        },
        {
          id: 'open-new-page',
          label: tx('explorer.openInNewPage'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          disabled: !onOpenInNewPage,
          onSelect: () => onOpenInNewPage?.(app.id),
        },
        {
          id: 'export-json',
          label: tx('explorer.exportApplicationJson'),
          icon: <Download size={14} aria-hidden="true" />,
          disabled: !onExportApplication,
          onSelect: () => onExportApplication?.(app.id),
        },
        {
          id: 'copy-school',
          label: tx('explorer.copySchool'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(app.school.name, tx('inspector.copySchool')),
        },
        {
          id: 'copy-program',
          label: tx('explorer.copyProgram'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(app.program, tx('inspector.copyProgram')),
        },
        {
          id: 'copy-professor',
          label: tx('explorer.copyProfessor'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !app.professor.english.trim() || !onCopy,
          onSelect: () => onCopy?.(app.professor.english, tx('inspector.copyProfessor')),
        },
        {
          id: 'copy-email',
          label: tx('explorer.copyEmail'),
          icon: <Mail size={14} aria-hidden="true" />,
          disabled: !app.professor.email.trim() || !onCopy,
          onSelect: () => onCopy?.(app.professor.email, tx('inspector.copyEmail')),
        },
        ...statusItems,
        {
          id: 'delete',
          label: tx('explorer.delete'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          disabled: !onDeleteApplication,
          tone: 'danger',
          onSelect: () => onDeleteApplication?.(app.id),
        },
      ],
    })
  }

  return (
    <section className="kanban-workspace" aria-label={tx('kanban.boardView')}>
      <div className="kanban-hero">
        <div className="kanban-hero-info">
          <span className="eyebrow">{tx('kanban.eyebrow')}</span>
          <h2>{tx('kanban.title')}</h2>
          <p>{tx('kanban.subtitle')}</p>
        </div>
        {onNew && applications.length > 0 ? (
          <button type="button" className="kanban-mobile-new primary-action" onClick={onNew}>
            <Plus size={17} aria-hidden="true" />
            <span>{tx('workspace.new')}</span>
          </button>
        ) : null}
        <div className="kanban-summary" aria-label={tx('kanban.summary')}>
          <span>
            <LayoutGrid size={13} aria-hidden="true" />
            {format(tx('kanban.totalCount'), { count: applications.length })}
          </span>
          <span>
            <ListChecks size={13} aria-hidden="true" />
            {format(tx('kanban.activeCount'), { count: activeCount })}
          </span>
          <span>
            <ArrowRight size={13} aria-hidden="true" />
            {format(tx('kanban.decisionCount'), { count: decisionCount })}
          </span>
          <span>
            <CalendarClock size={13} aria-hidden="true" />
            {format(tx('kanban.urgentCount'), { count: boardData.urgentCount })}
          </span>
        </div>
      </div>

      {applications.length === 0 ? (
        <div className="kanban-empty-state">
          <LayoutGrid size={28} aria-hidden="true" />
          <div className="kanban-empty-copy">
            <strong>{tx('kanban.emptyTitle')}</strong>
            <span>{tx('kanban.emptyDescription')}</span>
          </div>
          {onNew ? (
            <button type="button" className="kanban-empty-action primary-action" onClick={onNew}>
              <Plus size={16} aria-hidden="true" />
              <span>{tx('dashboard.newApplication')}</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="kanban-board">
          {boardData.groupedColumns.map((group) => (
            <section key={group.key} className="kanban-group" aria-label={tx(`kanban.${group.key}Group`)}>
              <div className="kanban-group-header">
                <div>
                  <span className="eyebrow">{tx(`kanban.${group.key}Eyebrow`)}</span>
                  <h3>{tx(`kanban.${group.key}Group`)}</h3>
                </div>
                <span className="kanban-count-badge">{group.items.length}</span>
              </div>
              <div className="kanban-column-grid">
                {group.columns.map((col) => {
                  const visibleCount = visibleCounts[col.status] ?? initialColumnCount
                  const visibleItems = col.items.slice(0, visibleCount)
                  const remainingCount = Math.max(0, col.items.length - visibleItems.length)
                  const columnReveal = revealState?.status === col.status ? revealState : null
                  const revealBatchSize = columnReveal
                    ? Math.max(0, visibleItems.length - columnReveal.fromIndex)
                    : 0
                  return (
                    <div
                      key={col.status}
                      className={`kanban-column${dragOverColumn === col.status ? ' drag-over' : ''}`}
                      onDragOver={(e) => handleDragOver(e, col.status)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, col.status)}
                    >
                      <div className="kanban-column-header">
                        <span>{statusLabel(col.status, tx)}</span>
                        <span className="count">{col.items.length}</span>
                      </div>
                      <div
                        className={`kanban-column-body${col.items.length > initialColumnCount ? ' is-scrollable' : ''}`}
                        role="region"
                        aria-label={statusLabel(col.status, tx)}
                        tabIndex={col.items.length > initialColumnCount ? 0 : undefined}
                        onScroll={(event) => handleColumnScroll(event, col.status, col.items.length)}
                        onWheel={(event) => handleColumnWheel(event, col.status, col.items.length)}
                      >
                        {col.items.length === 0 ? (
                          <div className="kanban-empty-slot">
                            <GripVertical size={14} aria-hidden="true" />
                            <span>{tx('kanban.empty')}</span>
                          </div>
                        ) : (
                          <>
                            {visibleItems.map((app, itemIndex) => {
                              const isRevealing = Boolean(
                                columnReveal && itemIndex >= columnReveal.fromIndex,
                              )
                              const revealIndex = isRevealing && columnReveal
                                ? itemIndex - columnReveal.fromIndex
                                : 0
                              const revealStyle = isRevealing
                                ? ({ '--reveal-index': revealIndex } as CSSProperties)
                                : undefined
                              return (
                                <div
                                  key={app.id}
                                  className={`kanban-card${draggedId === app.id ? ' dragging' : ''}${isRevealing ? ' is-revealing' : ''}`}
                                  style={revealStyle}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, app.id)}
                                  onDragEnd={handleDragEnd}
                                  onPointerDown={onPrefetch}
                                  onPointerEnter={onPrefetch}
                                  onFocus={onPrefetch}
                                  onClick={() => onSelect(app.id)}
                                  onContextMenu={(event) => openCardContextMenu(event, app)}
                                  role="button"
                                  tabIndex={0}
                                  aria-posinset={itemIndex + 1}
                                  aria-setsize={col.items.length}
                                  onKeyDown={(event) => handleCardKeyDown(event, app)}
                                  onAnimationEnd={(event) => {
                                    if (!isRevealing) return
                                    if (event.target !== event.currentTarget) return
                                    handleRevealAnimationEnd(col.status, revealIndex, revealBatchSize)
                                  }}
                                >
                                  <div className="kanban-card-head">
                                    <div>
                                      <div className="kanban-card-name">{app.school.name}</div>
                                      <div className="kanban-card-program">{app.program}</div>
                                    </div>
                                    <GripVertical size={14} aria-hidden="true" />
                                  </div>
                                  <div className="kanban-card-professor">{app.professor.english}</div>
                                  <div className="kanban-card-meta">
                                    <DeadlineBadge deadline={app.deadline} compact />
                                    <span className={`kanban-priority kanban-priority-${priorityLabel(app.priority)}`}>
                                      {format(tx('kanban.priorityValue'), { value: app.priority })}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                            {compactViewport && remainingCount > 0 ? (
                              <button
                                type="button"
                                className={`kanban-load-more${columnReveal ? ' is-settling' : ''}`}
                                onClick={() => showMoreApplications(col.status, col.items.length)}
                                aria-label={format(tx('kanban.showMore'), { count: Math.min(KANBAN_COLUMN_BATCH_SIZE, remainingCount) })}
                              >
                                <Plus size={13} aria-hidden="true" />
                                <span>{format(tx('kanban.showMore'), { count: Math.min(KANBAN_COLUMN_BATCH_SIZE, remainingCount) })}</span>
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  )
}
