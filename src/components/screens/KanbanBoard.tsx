import {
  Activity,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  GripVertical,
  LayoutGrid,
  ListChecks,
  Mail,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react'
import {
  applicationStatusOrder,
  type ApplicationRecord,
  type ApplicationStatus,
} from '../../data/applications'
import { daysUntil } from '../../appModel'
import { statusCssSlug, statusLabel } from '../../statusLabels'
import { DeadlineBadge } from '../shared/DeadlineBadge'
import { StatusPill } from '../shared/StatusPill'
import { UserAvatar } from '../shared/UserAvatar'
import { InfoTooltip } from '../shared/InfoTooltip'
import { ProjectFooter } from '../shared/ProjectFooter'
import { useI18n } from '../hooks/useI18n'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { ApplicationPipelineViewSwitch } from './ApplicationPipelineViewSwitch'
import { ApplicationSmartTable } from './ApplicationSmartTable'
import {
  applicationPriorityBand,
  type ApplicationPipelineScope,
  type ApplicationPipelineViewMode,
  type TeamKanbanStudent,
} from './applicationPipelineModel'

export type { TeamKanbanStudent } from './applicationPipelineModel'

interface KanbanBoardProps {
  applications: ApplicationRecord[]
  customApplicationStatuses?: readonly ApplicationStatus[]
  onStatusChange: (id: string, status: ApplicationStatus) => void
  onSelect: (id: string) => void
  onPrefetch?: () => void
  onOpenInNewPage?: (id: string) => void
  onOpenMany?: (ids: string[]) => void
  onExportApplication?: (id: string) => void
  onExportMany?: (ids: string[]) => void
  onCopy?: (value: string, label: string) => void
  onDeleteApplication?: (id: string) => void
  onDeleteMany?: (ids: string[]) => void
  onNew?: () => void
  teamStudents?: TeamKanbanStudent[]
  onNewForStudent?: (studentId: string) => void
}

const KANBAN_COLUMN_INITIAL_COUNT = 4
const KANBAN_COLUMN_COMPACT_INITIAL_COUNT = 8
const KANBAN_COLUMN_BATCH_SIZE = 8
const TEAM_STUDENT_PREVIEW_COUNT = 3
const terminalStatuses = new Set<ApplicationStatus>(['Accepted', 'Rejected', 'Waitlist'])
const PIPELINE_VIEW_STORAGE_PREFIX = 'phd-atlas:application-pipeline-view:v1:'

function readPipelineView(scope: ApplicationPipelineScope): ApplicationPipelineViewMode {
  if (typeof window === 'undefined') return 'board'
  try {
    return window.localStorage.getItem(`${PIPELINE_VIEW_STORAGE_PREFIX}${scope}`) === 'table'
      ? 'table'
      : 'board'
  } catch {
    return 'board'
  }
}

function writePipelineView(scope: ApplicationPipelineScope, view: ApplicationPipelineViewMode) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${PIPELINE_VIEW_STORAGE_PREFIX}${scope}`, view)
  } catch {
    // Ignore private-mode and quota failures.
  }
}

type TeamStudentBoardState = 'missing' | 'risk' | 'due' | 'steady'

function applicationNeedsAttention(application: ApplicationRecord): boolean {
  if (terminalStatuses.has(application.status)) return false
  const due = daysUntil(application.deadline)
  return due < 0 || due <= 30 || (
    (application.status === 'Draft' || application.status === 'Preparing') &&
    application.progress < 40
  )
}

function teamStudentBoardState(applications: ApplicationRecord[]): TeamStudentBoardState {
  if (applications.length === 0) return 'missing'
  const activeApplications = applications.filter((application) => !terminalStatuses.has(application.status))
  if (activeApplications.some((application) => {
    const due = daysUntil(application.deadline)
    return due < 0 || (
      (application.status === 'Draft' || application.status === 'Preparing') &&
      application.progress < 40
    )
  })) return 'risk'
  if (activeApplications.some((application) => {
    const due = daysUntil(application.deadline)
    return due >= 0 && due <= 30
  })) return 'due'
  return 'steady'
}

function teamStudentStateLabelKey(state: TeamStudentBoardState): string {
  if (state === 'missing') return 'team.teacherStudentStateMissing'
  if (state === 'risk') return 'team.teacherStudentStateRisk'
  if (state === 'due') return 'team.teacherStudentStateDue'
  return 'team.teacherStudentStateSteady'
}

function teamStudentStateScore(state: TeamStudentBoardState): number {
  if (state === 'risk') return 0
  if (state === 'due') return 1
  if (state === 'missing') return 2
  return 3
}

function TeamStudentKanbanBoard({
  students,
  onSelect,
  onPrefetch,
  onNewForStudent,
  onOpenInNewPage,
  onCopy,
  customApplicationStatuses,
}: {
  students: TeamKanbanStudent[]
  onSelect: (id: string) => void
  onPrefetch?: () => void
  onNewForStudent?: (studentId: string) => void
  onOpenInNewPage?: (id: string) => void
  onCopy?: (value: string, label: string) => void
  customApplicationStatuses?: readonly ApplicationStatus[]
}) {
  const { tx, format } = useI18n()
  const [expandedStudentIds, setExpandedStudentIds] = useState<Set<string>>(() => new Set())
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const statusOrder = useMemo(() => applicationStatusOrder(
    customApplicationStatuses ?? [],
    students.flatMap((student) => student.allApplications.map((application) => application.status)),
  ), [customApplicationStatuses, students])

  const boardData = useMemo(() => {
    const rows = students.map((student) => {
      const allApplications = student.allApplications
      const state = teamStudentBoardState(allApplications)
      const averageProgress = allApplications.length
        ? Math.round(allApplications.reduce((sum, application) => sum + application.progress, 0) / allApplications.length)
        : 0
      const dueSoonCount = allApplications.filter((application) => {
        if (terminalStatuses.has(application.status)) return false
        const due = daysUntil(application.deadline)
        return due >= 0 && due <= 30
      }).length
      const attentionCount = allApplications.filter(applicationNeedsAttention).length
      const statusCounts = Object.fromEntries(
        statusOrder.map((status) => [
          status,
          allApplications.filter((application) => application.status === status).length,
        ]),
      ) as Record<ApplicationStatus, number>
      const visibleApplications = [...student.applications].sort((left, right) => {
        const attentionDifference = Number(applicationNeedsAttention(right)) - Number(applicationNeedsAttention(left))
        if (attentionDifference !== 0) return attentionDifference
        return left.deadline.localeCompare(right.deadline)
      })

      return {
        ...student,
        state,
        averageProgress,
        dueSoonCount,
        attentionCount,
        statusCounts,
        visibleApplications,
      }
    }).sort((left, right) => {
      const stateDifference = teamStudentStateScore(left.state) - teamStudentStateScore(right.state)
      if (stateDifference !== 0) return stateDifference
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    return { rows }
  }, [statusOrder, students])
  const masonryGridRef = useRef<HTMLDivElement | null>(null)
  const masonryLayoutKey = boardData.rows.map((student) => student.id).join('\u0001')

  useLayoutEffect(() => {
    const grid = masonryGridRef.current
    if (!grid) return undefined

    const gridStyle = window.getComputedStyle(grid)
    const visualGap = Number.parseFloat(gridStyle.getPropertyValue('--team-kanban-card-gap')) || 12
    const rowUnit = Number.parseFloat(gridStyle.getPropertyValue('--team-kanban-masonry-row-unit')) || 1
    const trackGap = Number.parseFloat(gridStyle.getPropertyValue('--team-kanban-masonry-track-gap')) || 1
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.team-kanban-student'))

    const applyMeasurements = (measurements: Array<{ card: HTMLElement; height: number }>) => {
      const visibleMeasurements = measurements.filter(({ height }) => height > 0)
      if (visibleMeasurements.length === 0) return

      for (const { card, height } of visibleMeasurements) {
        const span = Math.max(1, Math.ceil((height + visualGap) / (rowUnit + trackGap)))
        const nextValue = String(span)
        if (card.style.getPropertyValue('--team-kanban-masonry-span') !== nextValue) {
          card.style.setProperty('--team-kanban-masonry-span', nextValue)
        }
      }
      grid.classList.add('is-masonry-ready')
    }

    const measureCards = (targets: HTMLElement[]) => {
      applyMeasurements(targets.map((card) => ({
        card,
        height: card.getBoundingClientRect().height,
      })))
    }

    const hasCompleteCachedLayout = grid.classList.contains('is-masonry-ready')
      && cards.every((card) => card.style.getPropertyValue('--team-kanban-masonry-span'))
    if (!hasCompleteCachedLayout) measureCards(cards)

    if (typeof ResizeObserver !== 'function') {
      const updateAllCards = () => measureCards(cards)
      window.addEventListener('resize', updateAllCards)
      return () => {
        window.removeEventListener('resize', updateAllCards)
      }
    }

    const resizeObserver = new ResizeObserver((entries) => {
      applyMeasurements(entries.map((entry) => {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize
        return {
          card: entry.target as HTMLElement,
          height: borderBox?.blockSize ?? entry.contentRect.height,
        }
      }))
    })
    cards.forEach((card) => resizeObserver.observe(card))

    return () => {
      resizeObserver.disconnect()
    }
  }, [masonryLayoutKey])

  function toggleStudent(studentId: string) {
    setExpandedStudentIds((current) => {
      const next = new Set(current)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function openApplicationContextMenu(event: MouseEvent<HTMLElement>, application: ApplicationRecord) {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: application.school.name,
      subtitle: application.program,
      items: [
        {
          id: 'open',
          label: tx('explorer.open'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          shortcut: 'Enter',
          accessKey: 'o',
          onSelect: () => onSelect(application.id),
        },
        {
          id: 'open-new-page',
          label: tx('explorer.openInNewPage'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          shortcut: 'N',
          accessKey: 'n',
          disabled: !onOpenInNewPage,
          onSelect: () => onOpenInNewPage?.(application.id),
        },
        {
          id: 'copy-school',
          label: tx('explorer.copySchool'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !onCopy,
          onSelect: () => onCopy?.(application.school.name, tx('inspector.copySchool')),
        },
        {
          id: 'copy-program',
          label: tx('explorer.copyProgram'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'P',
          accessKey: 'p',
          disabled: !onCopy,
          onSelect: () => onCopy?.(application.program, tx('inspector.copyProgram')),
        },
        {
          id: 'copy-professor',
          label: tx('explorer.copyProfessor'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'R',
          accessKey: 'r',
          disabled: !application.professor.english.trim() || !onCopy,
          onSelect: () => onCopy?.(application.professor.english, tx('inspector.copyProfessor')),
        },
        {
          id: 'copy-email',
          label: tx('explorer.copyEmail'),
          icon: <Mail size={14} aria-hidden="true" />,
          shortcut: 'M',
          accessKey: 'm',
          disabled: !application.professor.email.trim() || !onCopy,
          onSelect: () => onCopy?.(application.professor.email, tx('inspector.copyEmail')),
        },
      ],
    })
  }

  function handleApplicationKeyDown(event: KeyboardEvent<HTMLButtonElement>, application: ApplicationRecord) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(application.id)
      return
    }
    if (event.key.toLowerCase() === 'n' && onOpenInNewPage) {
      event.preventDefault()
      onOpenInNewPage(application.id)
    }
  }

  return (
    <section className="application-pipeline-view application-pipeline-board-view team-kanban-workspace" aria-label={tx('kanban.boardView')}>
      {boardData.rows.length === 0 ? (
        <div className="kanban-empty-state team-kanban-empty-state">
          <UsersRound size={28} aria-hidden="true" />
          <div className="kanban-empty-copy">
            <strong>{tx('team.teacherNoFilteredStudents')}</strong>
            <span>{tx('team.teacherNoFilteredStudentsDesc')}</span>
          </div>
        </div>
      ) : (
        <div ref={masonryGridRef} className="team-kanban-grid">
          {boardData.rows.map((student) => {
            const expanded = expandedStudentIds.has(student.id)
            const visibleApplications = expanded
              ? student.visibleApplications
              : student.visibleApplications.slice(0, TEAM_STUDENT_PREVIEW_COUNT)
            const remainingCount = Math.max(0, student.visibleApplications.length - TEAM_STUDENT_PREVIEW_COUNT)
            const totalApplications = student.allApplications.length
            const hasFilteredApplications = student.applications.length !== totalApplications

            return (
              <article key={student.id} className={`team-kanban-student state-${student.state}`}>
                <header className="team-kanban-student-header">
                  <UserAvatar
                    avatarUrl={student.avatarUrl}
                    name={student.name}
                    email={student.email}
                    className="team-kanban-student-avatar"
                  />
                  <span className="team-kanban-student-identity">
                    <strong>{student.name}</strong>
                    <em>{format(tx('team.teacherFocusSubtitle'), {
                      email: student.email || tx('team.noLinkedEmail'),
                      teacher: student.advisorName || tx('workspace.unassignedAdvisor'),
                    })}</em>
                  </span>
                  <span className="team-kanban-student-actions">
                    <span className={`team-kanban-state state-${student.state}`}>
                      {tx(teamStudentStateLabelKey(student.state))}
                    </span>
                    {onNewForStudent && student.canCreateApplication !== false ? (
                      <button
                        type="button"
                        className="team-kanban-create-button"
                        onClick={() => onNewForStudent(student.id)}
                        title={tx('team.teacherCreateForStudent')}
                        aria-label={tx('team.teacherCreateForStudent')}
                      >
                        <Plus size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </header>

                <div className="team-kanban-metrics" aria-label={tx('team.studentMetricsLabel')}>
                  <span>
                    <strong>{totalApplications}</strong>
                    <em>{tx('team.metricApplications')}</em>
                  </span>
                  <span>
                    <strong>{student.averageProgress}%</strong>
                    <em>{tx('team.metricProgress')}</em>
                  </span>
                  <span className={student.attentionCount > 0 ? 'is-attention' : ''}>
                    <strong>{student.attentionCount}</strong>
                    <em>{tx('team.metricRisk')}</em>
                  </span>
                  <span>
                    <strong>{student.dueSoonCount}</strong>
                    <em>{tx('team.metricDue')}</em>
                  </span>
                </div>

                <div className="team-kanban-status-overview">
                  <div className={`team-kanban-status-track${totalApplications === 0 ? ' is-empty' : ''}`} aria-hidden="true">
                    {statusOrder.map((status) => {
                      const count = student.statusCounts[status]
                      if (count === 0) return null
                      return (
                        <span
                          key={status}
                          className={`team-kanban-status-segment ${statusCssSlug(status)}`}
                          style={{ flexGrow: count }}
                        />
                      )
                    })}
                  </div>
                  {totalApplications > 0 ? (
                    <div className="team-kanban-status-legend">
                      {statusOrder.map((status) => {
                        const count = student.statusCounts[status]
                        if (count === 0) return null
                        return (
                          <span key={status} className={`team-kanban-status-key ${statusCssSlug(status)}`}>
                            <i aria-hidden="true" />
                            {statusLabel(status, tx)}
                            <b>{count}</b>
                          </span>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="team-kanban-application-section">
                  {hasFilteredApplications ? (
                    <p className="team-kanban-filter-summary">
                      {format(tx('team.teacherSelectedStudentAppsDesc'), {
                        count: student.applications.length,
                        total: totalApplications,
                      })}
                    </p>
                  ) : null}
                  {student.visibleApplications.length === 0 ? (
                    <div className="team-kanban-student-empty">
                      <GraduationCap size={17} aria-hidden="true" />
                      <span>
                        <strong>
                          {totalApplications === 0
                            ? tx('team.teacherStudentNoApplications')
                            : tx('team.teacherStudentNoFilteredApplications')}
                        </strong>
                        <em>
                          {totalApplications === 0
                            ? tx('team.teacherStudentNoApplicationsDesc')
                            : tx('team.teacherStudentNoFilteredApplicationsDesc')}
                        </em>
                      </span>
                      {totalApplications === 0 && onNewForStudent && student.canCreateApplication !== false ? (
                        <button
                          type="button"
                          className="quiet-action compact-action"
                          onClick={() => onNewForStudent(student.id)}
                        >
                          <Plus size={12} aria-hidden="true" />
                          {tx('team.teacherActionCreateFirstCta')}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="team-kanban-application-list">
                      {visibleApplications.map((application) => (
                        <button
                          key={application.id}
                          type="button"
                          className="team-kanban-application-row"
                          onPointerDown={onPrefetch}
                          onPointerEnter={onPrefetch}
                          onFocus={onPrefetch}
                          onClick={() => onSelect(application.id)}
                          onContextMenu={(event) => openApplicationContextMenu(event, application)}
                          onKeyDown={(event) => handleApplicationKeyDown(event, application)}
                        >
                          <span className="team-kanban-application-copy">
                            <strong>{application.school.name}</strong>
                            <em>{application.program} · {application.professor.english}</em>
                          </span>
                          <span className="team-kanban-application-state">
                            <StatusPill status={application.status} />
                            <span className="team-kanban-row-meta">
                              <DeadlineBadge deadline={application.deadline} compact />
                              <small>{application.progress}%</small>
                            </span>
                          </span>
                          <ArrowRight size={13} aria-hidden="true" />
                        </button>
                      ))}
                      {remainingCount > 0 ? (
                        <button
                          type="button"
                          className="team-kanban-disclosure"
                          onClick={() => toggleStudent(student.id)}
                          aria-expanded={expanded}
                        >
                          <span>
                            {expanded
                              ? tx('explorer.collapseSelected')
                              : format(tx('kanban.showMore'), { count: remainingCount })}
                          </span>
                          <ChevronDown size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  )
}

function PersonalKanbanBoard({
  applications,
  onStatusChange,
  onSelect,
  onPrefetch,
  onOpenInNewPage,
  onExportApplication,
  onCopy,
  onDeleteApplication,
  onNew,
  customApplicationStatuses,
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
  const statusChoices = useMemo(
    () => applicationStatusOrder(
      customApplicationStatuses ?? [],
      applications.map((application) => application.status),
    ),
    [applications, customApplicationStatuses],
  )
  const columnStatusOrder = useMemo(
    () => applicationStatusOrder(applications.map((application) => application.status)),
    [applications],
  )
  const statusGroups = useMemo(() => ([
    {
      key: 'active' as const,
      statuses: columnStatusOrder.filter((status) => !terminalStatuses.has(status)),
    },
    {
      key: 'decision' as const,
      statuses: columnStatusOrder.filter((status) => terminalStatuses.has(status)),
    },
  ]), [columnStatusOrder])

  const boardData = useMemo(() => {
    const buckets = Object.fromEntries(
      columnStatusOrder.map((status) => [status, [] as ApplicationRecord[]]),
    ) as Record<ApplicationStatus, ApplicationRecord[]>
    const applicationIds: string[] = []
    for (const application of applications) {
      buckets[application.status].push(application)
      applicationIds.push(application.id)
    }
    const groupedColumns = statusGroups.map((group) => ({
      ...group,
      items: group.statuses.flatMap((status) => buckets[status]),
      columns: group.statuses.map((status) => ({ status, items: buckets[status] })),
    }))
    return {
      groupedColumns,
      datasetKey: applicationIds.join('\u0001'),
    }
  }, [applications, columnStatusOrder, statusGroups])
  const visibilityKey = `${boardData.datasetKey}:${compactViewport ? 'compact' : 'desktop'}`
  const visibleCounts = visibilityState.key === visibilityKey ? visibilityState.counts : {}

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

  function handleRevealAnimationEnd(status: ApplicationStatus, revealIndex: number, batchSize: number) {
    if (revealIndex !== batchSize - 1) return
    setRevealState((current) => (current?.status === status ? null : current))
  }

  function moveApplicationByOffset(app: ApplicationRecord, offset: -1 | 1) {
    const currentIndex = statusChoices.indexOf(app.status)
    if (currentIndex === -1) return
    const nextStatus = statusChoices[currentIndex + offset]
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
    const statusItems = statusChoices
      .filter((status) => status !== app.status)
      .map((status) => ({
        id: `move-${status}`,
        label: statusLabel(status, tx),
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
        {
          id: 'move-to',
          label: tx('kanban.moveTo'),
          icon: <ArrowRight size={14} aria-hidden="true" />,
          submenu: {
            title: tx('kanban.moveTo'),
            backLabel: tx('kanban.moveTo'),
            items: statusItems,
          },
        },
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
    <section className="application-pipeline-view application-pipeline-board-view" aria-label={tx('kanban.boardView')}>
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
              <span>{tx('workspace.new')}</span>
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
                        className="kanban-column-body"
                        role="region"
                        aria-label={statusLabel(col.status, tx)}
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
                                    <span className={`kanban-priority kanban-priority-${applicationPriorityBand(app.priority)}`}>
                                      {format(tx('kanban.priorityValue'), { value: app.priority })}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                            {remainingCount > 0 ? (
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

const MemoizedApplicationSmartTable = memo(ApplicationSmartTable)
const MemoizedTeamStudentKanbanBoard = memo(TeamStudentKanbanBoard)
const MemoizedPersonalKanbanBoard = memo(PersonalKanbanBoard)

export function KanbanBoard(props: KanbanBoardProps) {
  const { tx, format } = useI18n()
  const scope: ApplicationPipelineScope = props.teamStudents ? 'team' : 'personal'
  const [viewModes, setViewModes] = useState<Record<ApplicationPipelineScope, ApplicationPipelineViewMode>>(
    () => ({
      personal: readPipelineView('personal'),
      team: readPipelineView('team'),
    }),
  )
  const viewMode = viewModes[scope]
  const controlsId = `application-pipeline-${scope}-view`

  useEffect(() => {
    writePipelineView(scope, viewMode)
  }, [scope, viewMode])

  const summary = useMemo(() => {
    if (props.teamStudents) {
      const applicationsById = new Map<string, ApplicationRecord>()
      for (const student of props.teamStudents) {
        for (const application of student.allApplications) {
          applicationsById.set(application.id, application)
        }
      }
      const allApplications = [...applicationsById.values()]
      return {
        total: allApplications.length,
        active: 0,
        decisions: 0,
        urgent: allApplications.filter((application) => {
          if (terminalStatuses.has(application.status)) return false
          const due = daysUntil(application.deadline)
          return due >= 0 && due <= 30
        }).length,
        attention: allApplications.filter(applicationNeedsAttention).length,
        students: props.teamStudents.length,
      }
    }

    let active = 0
    let decisions = 0
    let urgent = 0
    for (const application of props.applications) {
      if (terminalStatuses.has(application.status)) decisions += 1
      else active += 1
      const due = daysUntil(application.deadline)
      if (!terminalStatuses.has(application.status) && due >= 0 && due <= 30) urgent += 1
    }
    return {
      total: props.applications.length,
      active,
      decisions,
      urgent,
      attention: 0,
      students: 0,
    }
  }, [props.applications, props.teamStudents])

  const changePipelineView = (nextView: ApplicationPipelineViewMode) => {
    setViewModes((current) => (
      current[scope] === nextView ? current : { ...current, [scope]: nextView }
    ))
  }
  const tableMode = viewMode === 'table'
  const teamMode = Boolean(props.teamStudents)

  return (
    <section
      className={`kanban-workspace application-pipeline-workspace${teamMode ? ' team-application-pipeline-workspace' : ''}`}
      data-pipeline-view={viewMode}
      aria-label={tx(tableMode ? 'kanban.tableView' : 'kanban.boardView')}
    >
      <div className={`kanban-hero${teamMode ? ' team-kanban-hero' : ''}`}>
        <div className="kanban-hero-info">
          <div className="application-pipeline-heading-stack" data-view={viewMode}>
            {(['board', 'table'] as const).map((headingView) => {
              const tableHeading = headingView === 'table'
              const activeHeading = headingView === viewMode
              return (
                <div
                  key={headingView}
                  className="application-pipeline-heading-copy"
                  data-heading-view={headingView}
                  aria-hidden={!activeHeading}
                  inert={activeHeading ? undefined : true}
                >
                  {teamMode ? (
                    <>
                      <span className="eyebrow">
                        {tx(tableHeading ? 'kanban.teamTableEyebrow' : 'team.teacherApplicationsEyebrow')}
                      </span>
                      <div className="team-kanban-title-row">
                        <h2>{tx(tableHeading ? 'kanban.teamTableTitle' : 'team.teacherApplicationsTitle')}</h2>
                        <InfoTooltip
                          className="team-kanban-help"
                          content={tx(tableHeading ? 'kanban.teamTableSubtitle' : 'team.teacherApplicationsDesc')}
                          label={tx(tableHeading ? 'kanban.teamTableSubtitle' : 'team.teacherApplicationsDesc')}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="eyebrow">{tx(tableHeading ? 'kanban.tableEyebrow' : 'kanban.eyebrow')}</span>
                      <h2>{tx(tableHeading ? 'kanban.tableTitle' : 'kanban.title')}</h2>
                      <p>{tx(tableHeading ? 'kanban.tableSubtitle' : 'kanban.subtitle')}</p>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {props.onNew && props.applications.length > 0 ? (
          <button type="button" className="kanban-mobile-new primary-action" onClick={props.onNew}>
            <Plus size={17} aria-hidden="true" />
            <span>{tx('workspace.new')}</span>
          </button>
        ) : null}

        <div className="application-pipeline-hero-tools">
          <ApplicationPipelineViewSwitch
            value={viewMode}
            onChange={changePipelineView}
            label={tx('kanban.viewMode')}
            boardLabel={tx('kanban.board')}
            tableLabel={tx('kanban.table')}
            scope={scope}
            controlsId={controlsId}
          />
          <div
            className="kanban-summary"
            aria-label={tx(teamMode ? 'team.studentMetricsLabel' : 'kanban.summary')}
          >
            {teamMode ? (
              <>
                <span>
                  <UsersRound size={13} aria-hidden="true" />
                  {format(tx('team.teacherStudentsTitle'), { count: summary.students })}
                </span>
                <span>
                  <LayoutGrid size={13} aria-hidden="true" />
                  {format(tx('kanban.totalCount'), { count: summary.total })}
                </span>
                <span>
                  <AlertTriangle size={13} aria-hidden="true" />
                  {format(tx('team.teacherWorkbenchRisk'), { count: summary.attention })}
                </span>
                <span>
                  <CalendarClock size={13} aria-hidden="true" />
                  {format(tx('team.teacherWorkbenchDue'), { count: summary.urgent })}
                </span>
              </>
            ) : (
              <>
                <span>
                  <LayoutGrid size={13} aria-hidden="true" />
                  {format(tx('kanban.totalCount'), { count: summary.total })}
                </span>
                <span>
                  <ListChecks size={13} aria-hidden="true" />
                  {format(tx('kanban.activeCount'), { count: summary.active })}
                </span>
                <span>
                  <ArrowRight size={13} aria-hidden="true" />
                  {format(tx('kanban.decisionCount'), { count: summary.decisions })}
                </span>
                <span>
                  <CalendarClock size={13} aria-hidden="true" />
                  {format(tx('kanban.urgentCount'), { count: summary.urgent })}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        id={controlsId}
        className="application-pipeline-view-stage"
        data-view={viewMode}
        data-pipeline-scope={scope}
      >
        <span
          className="application-pipeline-transition-veil"
          data-application-pipeline-transition-veil
          aria-hidden="true"
        />
        <Activity mode={tableMode ? 'visible' : 'hidden'}>
          <div className="application-pipeline-view-slot" data-pipeline-view-slot="table">
            <MemoizedApplicationSmartTable key={scope} {...props} />
          </div>
        </Activity>
        <Activity mode={tableMode ? 'hidden' : 'visible'}>
          <div className="application-pipeline-view-slot" data-pipeline-view-slot="board">
            {props.teamStudents ? (
              <MemoizedTeamStudentKanbanBoard
                students={props.teamStudents}
                onSelect={props.onSelect}
                onPrefetch={props.onPrefetch}
                onNewForStudent={props.onNewForStudent}
                onOpenInNewPage={props.onOpenInNewPage}
                onCopy={props.onCopy}
                customApplicationStatuses={props.customApplicationStatuses}
              />
            ) : (
              <MemoizedPersonalKanbanBoard {...props} />
            )}
          </div>
        </Activity>
      </div>
      <ProjectFooter />
    </section>
  )
}
