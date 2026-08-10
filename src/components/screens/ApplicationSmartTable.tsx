import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Mail,
  Plus,
  Table2,
  Trash2,
} from 'lucide-react'
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  useTransition,
} from 'react'
import { formatDate } from '../../appModel'
import {
  applicationStatusOrder,
  type ApplicationRecord,
  type ApplicationStatus,
} from '../../data/applications'
import { localeForLanguage } from '../../i18n'
import { statusCssSlug, statusLabel } from '../../statusLabels'
import { hasExplorerSelectionModifier, useExplorerSelection } from '../hooks/useExplorerSelection'
import { useI18n } from '../hooks/useI18n'
import { AnimatedCheckmark } from '../shared/AnimatedCheckmark'
import { DeadlineBadge } from '../shared/DeadlineBadge'
import {
  ExplorerContextMenu,
  type ExplorerContextMenuItem,
  type ExplorerContextMenuState,
} from '../shared/ExplorerContextMenu'
import {
  ExplorerSelectionBar,
  type ExplorerSelectionAction,
} from '../shared/ExplorerSelectionBar'
import { SchoolLogoMark } from '../shared/SchoolLogo'
import { Select, type SelectOption } from '../shared/Select'
import { TableCell, TableColGroup, TableHeaderCell } from '../shared/TableColumnChrome'
import { useTableColumnMenu } from '../shared/useTableColumnMenu'
import type { TableColumnDef } from '../shared/useTableColumns'
import { UserAvatar } from '../shared/UserAvatar'
import {
  applicationPriorityBand,
  type ApplicationPipelineScope,
  type TeamKanbanStudent,
} from './applicationPipelineModel'
import { useApplicationTableStickyHeader } from './applicationTableStickyHeader'

type ApplicationTableSortField =
  | 'application'
  | 'student'
  | 'professor'
  | 'status'
  | 'deadline'
  | 'progress'
  | 'priority'

type ApplicationTableSort = {
  field: ApplicationTableSortField
  direction: 'asc' | 'desc'
}

type ApplicationTableRow = {
  application: ApplicationRecord
  student?: TeamKanbanStudent
}

const SORT_STORAGE_PREFIX = 'phd-atlas:application-pipeline-sort:v1:'
const DESKTOP_INITIAL_ROW_COUNT = 12
const DESKTOP_ROW_BATCH_SIZE = 12
const MOBILE_INITIAL_ROW_COUNT = 8
const MOBILE_ROW_BATCH_SIZE = 8
const TABLE_ROW_ENTRANCE_MS = 320
const TABLE_ROW_STAGGER_MS = 9
const TABLE_ROW_STAGGER_LIMIT = DESKTOP_ROW_BATCH_SIZE - 1

function useCompactTableViewport() {
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 820px)').matches
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 820px)')
    const sync = () => setCompact(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])

  return compact
}

function ApplicationTableCheckbox({
  checked,
  mixed = false,
  label,
  inputRef,
  onClick,
}: {
  checked: boolean
  mixed?: boolean
  label: string
  inputRef?: Ref<HTMLInputElement>
  onClick: (event: MouseEvent<HTMLInputElement>) => void
}) {
  return (
    <label
      className={`application-table-checkbox${checked ? ' is-checked' : ''}${mixed ? ' is-mixed' : ''}`}
      title={label}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        readOnly
        aria-label={label}
        aria-checked={mixed ? 'mixed' : checked}
        onClick={onClick}
      />
      <AnimatedCheckmark checked={checked} variant="square" size={18} />
      <span className="application-table-checkbox-mixed" aria-hidden="true" />
    </label>
  )
}

function preventNativeShiftRangeSelection(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || !event.shiftKey) return
  event.preventDefault()
  window.getSelection()?.removeAllRanges()
}

function ApplicationTableStatusEditor({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: ApplicationStatus
  options: readonly SelectOption<ApplicationStatus>[]
  ariaLabel: string
  onChange: (value: ApplicationStatus) => void
}) {
  const [editing, setEditing] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedOption = options.find((option) => option.value === value)

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) return
    setEditing(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
  }, [])

  if (editing) {
    return (
      <Select
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={ariaLabel}
        size="small"
        openOnMount
        onOpenChange={handleOpenChange}
      />
    )
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      className="custom-select-trigger application-table-status-trigger"
      aria-haspopup="listbox"
      aria-expanded="false"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown') return
        event.preventDefault()
        setEditing(true)
      }}
    >
      <span>{selectedOption?.label ?? value}</span>
      <ChevronDown size={13} aria-hidden="true" className="custom-select-chevron" />
    </button>
  )
}

function isApplicationTableSortField(value: unknown): value is ApplicationTableSortField {
  return [
    'application',
    'student',
    'professor',
    'status',
    'deadline',
    'progress',
    'priority',
  ].includes(String(value))
}

function readSort(scope: ApplicationPipelineScope): ApplicationTableSort {
  if (typeof window === 'undefined') return { field: 'deadline', direction: 'asc' }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${SORT_STORAGE_PREFIX}${scope}`) ?? 'null') as Partial<ApplicationTableSort> | null
    if (
      parsed
      && isApplicationTableSortField(parsed.field)
      && (parsed.direction === 'asc' || parsed.direction === 'desc')
    ) {
      return { field: parsed.field, direction: parsed.direction }
    }
  } catch {
    // A malformed preference should never block the table.
  }
  return { field: 'deadline', direction: 'asc' }
}

function writeSort(scope: ApplicationPipelineScope, sort: ApplicationTableSort) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${SORT_STORAGE_PREFIX}${scope}`, JSON.stringify(sort))
  } catch {
    // Ignore private-mode and quota failures.
  }
}

function useVisibleRowReflow() {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const capturedPositionsRef = useRef<Map<string, number> | null>(null)
  const activeAnimationsRef = useRef<Map<string, Animation>>(new Map())

  const capturePositions = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      capturedPositionsRef.current = null
      return
    }

    const rows = Array.from(body.querySelectorAll<HTMLElement>('[data-pipeline-row-id]'))
    const positions = new Map<string, number>()
    for (const row of rows) {
      const id = row.dataset.pipelineRowId
      if (!id) continue
      const top = row.getBoundingClientRect().top
      if (Number.isFinite(top)) positions.set(id, top)
    }
    capturedPositionsRef.current = positions
  }, [])

  useLayoutEffect(() => {
    const previousPositions = capturedPositionsRef.current
    capturedPositionsRef.current = null
    const body = bodyRef.current
    if (!body || !previousPositions) return

    const rows = Array.from(body.querySelectorAll<HTMLElement>('[data-pipeline-row-id]'))
    const measurements = rows.map((row) => {
      const id = row.dataset.pipelineRowId ?? ''
      return {
        row,
        id,
        previousTop: previousPositions.get(id),
        currentTop: row.getBoundingClientRect().top,
      }
    })

    for (const { row, id, previousTop, currentTop } of measurements) {
      if (!id || previousTop === undefined || !Number.isFinite(currentTop)) continue
      const delta = previousTop - currentTop
      if (Math.abs(delta) < 1 || typeof row.animate !== 'function' || row.classList.contains('is-entering')) {
        continue
      }

      activeAnimationsRef.current.get(id)?.cancel()
      const animation = row.animate(
        [
          { transform: `translate3d(0, ${delta}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      )
      activeAnimationsRef.current.set(id, animation)
      void animation.finished
        .catch(() => undefined)
        .then(() => {
          if (activeAnimationsRef.current.get(id) === animation) {
            activeAnimationsRef.current.delete(id)
          }
        })
    }
  })

  useEffect(() => () => {
    for (const animation of activeAnimationsRef.current.values()) animation.cancel()
    activeAnimationsRef.current.clear()
  }, [])

  return { bodyRef, capturePositions }
}

function SortHeaderButton({
  field,
  label,
  sort,
  onSort,
}: {
  field: ApplicationTableSortField
  label: string
  sort: ApplicationTableSort
  onSort: (field: ApplicationTableSortField) => void
}) {
  const active = sort.field === field
  const DirectionIcon = active && sort.direction === 'desc' ? ArrowDown : ArrowUp
  return (
    <button
      type="button"
      className={`application-table-sort${active ? ' is-active' : ''}`}
      onClick={() => onSort(field)}
      title={label}
    >
      <span>{label}</span>
      <DirectionIcon size={12} aria-hidden="true" />
    </button>
  )
}

function priorityDisplayLabel(
  priority: number,
  tx: (path: string, fallback?: string) => string,
) {
  const band = applicationPriorityBand(priority)
  if (band === 'high') return tx('settings.priorityHigh')
  if (band === 'medium') return tx('settings.priorityMedium')
  return tx('settings.priorityLow')
}

export type ApplicationSmartTableProps = {
  applications: ApplicationRecord[]
  teamStudents?: TeamKanbanStudent[]
  customApplicationStatuses?: readonly ApplicationStatus[]
  onStatusChange: (id: string, status: ApplicationStatus) => void
  onSelect: (id: string) => void
  onPrefetch?: (id?: string) => void
  onOpenInNewPage?: (id: string) => void
  onOpenMany?: (ids: string[]) => void
  onExportApplication?: (id: string) => void
  onExportMany?: (ids: string[]) => void
  onCopy?: (value: string, label: string) => void
  onDeleteApplication?: (id: string) => void
  onDeleteMany?: (ids: string[]) => void
  onNew?: () => void
  onNewForStudent?: (studentId: string) => void
}

export function ApplicationSmartTable({
  applications,
  teamStudents,
  customApplicationStatuses,
  onStatusChange,
  onSelect,
  onPrefetch,
  onOpenInNewPage,
  onOpenMany,
  onExportApplication,
  onExportMany,
  onCopy,
  onDeleteApplication,
  onDeleteMany,
  onNew,
  onNewForStudent,
}: ApplicationSmartTableProps) {
  const { tx, format, lang } = useI18n()
  const scope: ApplicationPipelineScope = teamStudents ? 'team' : 'personal'
  const compactViewport = useCompactTableViewport()
  const initialRowCount = compactViewport ? MOBILE_INITIAL_ROW_COUNT : DESKTOP_INITIAL_ROW_COUNT
  const rowBatchSize = compactViewport ? MOBILE_ROW_BATCH_SIZE : DESKTOP_ROW_BATCH_SIZE
  const [sort, setSort] = useState<ApplicationTableSort>(() => readSort(scope))
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [visibleRowCount, setVisibleRowCount] = useState(initialRowCount)
  const [isAppendingRows, startAppendingRows] = useTransition()
  const [isLoadingMoreRows, setIsLoadingMoreRows] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const tableShellRef = useRef<HTMLDivElement>(null)
  const tableHeadRef = useRef<HTMLTableSectionElement>(null)
  const residentToolsRef = useRef<HTMLDivElement>(null)
  const loadMoreMarkerRef = useRef<HTMLDivElement>(null)
  const observerAppendFrameRef = useRef<number | null>(null)
  const loadMoreBusyRef = useRef(false)
  const progressiveLoadArmedRef = useRef(false)

  useEffect(() => {
    writeSort(scope, sort)
  }, [scope, sort])

  const rows = useMemo<ApplicationTableRow[]>(() => {
    if (!teamStudents) return applications.map((application) => ({ application }))
    const seen = new Set<string>()
    const nextRows: ApplicationTableRow[] = []
    for (const student of teamStudents) {
      for (const application of student.applications) {
        if (seen.has(application.id)) continue
        seen.add(application.id)
        nextRows.push({ application, student })
      }
    }
    return nextRows
  }, [applications, teamStudents])

  useApplicationTableStickyHeader({
    active: rows.length > 0,
    compactViewport,
    headerRef: tableHeadRef,
    residentToolsRef,
    shellRef: tableShellRef,
  })

  const statusOrder = useMemo(
    () => applicationStatusOrder(
      customApplicationStatuses ?? [],
      rows.map(({ application }) => application.status),
    ),
    [customApplicationStatuses, rows],
  )
  const statusRank = useMemo(
    () => new Map(statusOrder.map((status, index) => [status, index])),
    [statusOrder],
  )
  const statusOptions = useMemo<SelectOption<ApplicationStatus>[]>(
    () => statusOrder.map((status) => ({ value: status, label: statusLabel(status, tx) })),
    [statusOrder, tx],
  )

  const columns = useMemo<TableColumnDef[]>(() => {
    const next: TableColumnDef[] = [
      {
        id: 'select',
        label: tx('kanban.tableSelect'),
        defaultWidth: 44,
        minWidth: 44,
        maxWidth: 44,
        hideable: false,
        resizable: false,
      },
      {
        id: 'application',
        label: tx('kanban.tableApplication'),
        defaultWidth: 260,
        minWidth: 210,
        maxWidth: 420,
        hideable: false,
      },
    ]
    if (teamStudents) {
      next.push({
        id: 'student',
        label: tx('kanban.tableStudent'),
        defaultWidth: 176,
        minWidth: 138,
        maxWidth: 300,
      })
    }
    next.push(
      {
        id: 'professor',
        label: tx('kanban.tableProfessor'),
        defaultWidth: 176,
        minWidth: 136,
        maxWidth: 320,
      },
      {
        id: 'status',
        label: tx('kanban.tableStatus'),
        defaultWidth: 148,
        minWidth: 126,
        maxWidth: 210,
      },
      {
        id: 'deadline',
        label: tx('kanban.tableDeadline'),
        defaultWidth: 150,
        minWidth: 128,
        maxWidth: 220,
      },
      {
        id: 'progress',
        label: tx('kanban.tableProgress'),
        defaultWidth: 154,
        minWidth: 126,
        maxWidth: 230,
      },
      {
        id: 'priority',
        label: tx('kanban.tablePriority'),
        defaultWidth: 108,
        minWidth: 92,
        maxWidth: 160,
      },
      {
        id: 'actions',
        label: tx('table.actions'),
        defaultWidth: 84,
        minWidth: 78,
        maxWidth: 112,
        hideable: false,
        resizable: false,
      },
    )
    return next
  }, [teamStudents, tx])
  const columnMenu = useTableColumnMenu(`application-pipeline-${scope}-v1`, columns)
  const compactSortOptions = useMemo<SelectOption<ApplicationTableSortField>[]>(() => (
    columns
      .filter((column) => !['select', 'actions'].includes(column.id))
      .map((column) => ({
        value: column.id as ApplicationTableSortField,
        label: column.label,
      }))
  ), [columns])

  const sortedRows = useMemo(() => {
    const collator = new Intl.Collator(localeForLanguage(lang), {
      numeric: true,
      sensitivity: 'base',
    })
    const multiplier = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((left, right) => {
      const leftApplication = left.application
      const rightApplication = right.application
      let difference = 0
      if (sort.field === 'application') {
        difference = collator.compare(leftApplication.school.name, rightApplication.school.name)
      } else if (sort.field === 'student') {
        difference = collator.compare(left.student?.name ?? '', right.student?.name ?? '')
      } else if (sort.field === 'professor') {
        difference = collator.compare(leftApplication.professor.english, rightApplication.professor.english)
      } else if (sort.field === 'status') {
        difference = (statusRank.get(leftApplication.status) ?? 999) - (statusRank.get(rightApplication.status) ?? 999)
      } else if (sort.field === 'deadline') {
        difference = (leftApplication.deadline || '9999-12-31').localeCompare(rightApplication.deadline || '9999-12-31')
      } else if (sort.field === 'progress') {
        difference = leftApplication.progress - rightApplication.progress
      } else {
        difference = leftApplication.priority - rightApplication.priority
      }
      if (difference === 0) difference = collator.compare(leftApplication.school.name, rightApplication.school.name)
      return difference * multiplier
    })
  }, [lang, rows, sort, statusRank])

  const sortedIds = useMemo(
    () => sortedRows.map(({ application }) => application.id),
    [sortedRows],
  )
  const [rowEntrance, setRowEntrance] = useState(() => ({
    token: 0,
    ids: [] as string[],
  }))
  const visibleRows = useMemo(
    () => sortedRows.slice(0, visibleRowCount),
    [sortedRows, visibleRowCount],
  )
  const hasMoreRows = visibleRowCount < sortedRows.length
  const remainingRowCount = Math.max(0, sortedRows.length - visibleRowCount)
  const rowEntranceIndex = useMemo(
    () => new Map(rowEntrance.ids.map((id, index) => [id, index])),
    [rowEntrance.ids],
  )
  const selection = useExplorerSelection(sortedIds)
  const allSelected = sortedIds.length > 0 && selection.selectedCount === sortedIds.length
  const someSelected = selection.selectedCount > 0 && !allSelected
  const {
    bodyRef: tableBodyRef,
    capturePositions: captureVisibleRowPositions,
  } = useVisibleRowReflow()

  useEffect(() => {
    setVisibleRowCount((current) => (
      Math.min(sortedRows.length, Math.max(current, initialRowCount))
    ))
  }, [initialRowCount, sortedRows.length])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const loadMoreRows = useCallback(() => {
    if (!hasMoreRows || loadMoreBusyRef.current) return
    if (observerAppendFrameRef.current !== null) {
      window.cancelAnimationFrame(observerAppendFrameRef.current)
      observerAppendFrameRef.current = null
    }
    const nextVisibleRowCount = Math.min(sortedRows.length, visibleRowCount + rowBatchSize)
    const enteringIds = sortedRows
      .slice(visibleRowCount, nextVisibleRowCount)
      .map(({ application }) => application.id)
    if (enteringIds.length === 0) return

    loadMoreBusyRef.current = true
    setIsLoadingMoreRows(true)
    startAppendingRows(() => {
      setRowEntrance((current) => ({
        token: current.token + 1,
        ids: enteringIds,
      }))
      setVisibleRowCount(nextVisibleRowCount)
    })
  }, [hasMoreRows, rowBatchSize, sortedRows, visibleRowCount])

  const scheduleObservedLoadMoreRows = useCallback(() => {
    if (!hasMoreRows || loadMoreBusyRef.current || observerAppendFrameRef.current !== null) return
    observerAppendFrameRef.current = window.requestAnimationFrame(() => {
      observerAppendFrameRef.current = null
      loadMoreRows()
    })
  }, [hasMoreRows, loadMoreRows])

  useEffect(() => {
    const marker = loadMoreMarkerRef.current
    if (!marker || !hasMoreRows || typeof IntersectionObserver !== 'function') return
    const workspaceScrollRoot = compactViewport
      ? null
      : tableShellRef.current?.closest('.kanban-workspace') ?? null
    const scrollTarget: Window | Element = workspaceScrollRoot ?? window
    const preloadDistance = compactViewport ? 180 : 260
    const armProgressiveLoading = () => {
      if (progressiveLoadArmedRef.current) return
      progressiveLoadArmedRef.current = true
      const markerTop = marker.getBoundingClientRect().top
      const viewportBottom = workspaceScrollRoot
        ? workspaceScrollRoot.getBoundingClientRect().bottom
        : window.innerHeight
      if (markerTop <= viewportBottom + preloadDistance) scheduleObservedLoadMoreRows()
    }
    const initialScrollTop = workspaceScrollRoot?.scrollTop ?? window.scrollY
    if (initialScrollTop > 1) progressiveLoadArmedRef.current = true
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          progressiveLoadArmedRef.current
          && entries.some((entry) => entry.isIntersecting)
        ) scheduleObservedLoadMoreRows()
      },
      {
        root: workspaceScrollRoot,
        rootMargin: `0px 0px ${preloadDistance}px`,
        threshold: 0.01,
      },
    )
    scrollTarget.addEventListener('scroll', armProgressiveLoading, { passive: true })
    observer.observe(marker)
    return () => {
      scrollTarget.removeEventListener('scroll', armProgressiveLoading)
      observer.disconnect()
      if (observerAppendFrameRef.current !== null) {
        window.cancelAnimationFrame(observerAppendFrameRef.current)
        observerAppendFrameRef.current = null
      }
    }
  }, [compactViewport, hasMoreRows, scheduleObservedLoadMoreRows, tableShellRef])

  const finishRowEntrance = useCallback((token: number) => {
    setRowEntrance((current) => (
      current.token === token && current.ids.length > 0
        ? { ...current, ids: [] }
        : current
    ))
  }, [])

  useEffect(() => {
    if (rowEntrance.ids.length === 0) return
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finalStaggerIndex = Math.min(
      rowEntrance.ids.length - 1,
      TABLE_ROW_STAGGER_LIMIT,
    )
    const releaseDelay = reduceMotion
      ? 0
      : TABLE_ROW_ENTRANCE_MS + (finalStaggerIndex * TABLE_ROW_STAGGER_MS) + 32
    const timer = window.setTimeout(
      () => {
        finishRowEntrance(rowEntrance.token)
        loadMoreBusyRef.current = false
        setIsLoadingMoreRows(false)
      },
      releaseDelay,
    )
    return () => window.clearTimeout(timer)
  }, [finishRowEntrance, rowEntrance])

  function changeSort(field: ApplicationTableSortField) {
    captureVisibleRowPositions()
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function ariaSort(field: ApplicationTableSortField) {
    if (sort.field !== field) return 'none' as const
    return sort.direction === 'asc' ? 'ascending' as const : 'descending' as const
  }

  function changeApplicationStatus(applicationId: string, status: ApplicationStatus) {
    if (sort.field === 'status') captureVisibleRowPositions()
    onStatusChange(applicationId, status)
  }

  function openRowContextMenu(event: MouseEvent<HTMLElement>, row: ApplicationTableRow) {
    event.preventDefault()
    event.stopPropagation()
    const { application, student } = row
    const triggerBounds = event.currentTarget.getBoundingClientRect()
    const menuX = event.clientX || Math.max(8, triggerBounds.right - 8)
    const menuY = event.clientY || triggerBounds.bottom
    selection.ensureSelectedForContext(application.id)
    const items: ExplorerContextMenuItem[] = [
      {
        id: 'open',
        label: tx('explorer.open'),
        icon: <FolderOpen size={14} aria-hidden="true" />,
        shortcut: 'Enter',
        onSelect: () => onSelect(application.id),
      },
      {
        id: 'open-new-page',
        label: tx('explorer.openInNewPage'),
        icon: <ExternalLink size={14} aria-hidden="true" />,
        disabled: !onOpenInNewPage,
        onSelect: () => onOpenInNewPage?.(application.id),
      },
      {
        id: 'export-json',
        label: tx('explorer.exportApplicationJson'),
        icon: <Download size={14} aria-hidden="true" />,
        disabled: !onExportApplication,
        onSelect: () => onExportApplication?.(application.id),
      },
      {
        id: 'copy-school',
        label: tx('explorer.copySchool'),
        icon: <Copy size={14} aria-hidden="true" />,
        disabled: !onCopy,
        onSelect: () => onCopy?.(application.school.name, tx('inspector.copySchool')),
      },
      {
        id: 'copy-program',
        label: tx('explorer.copyProgram'),
        icon: <Copy size={14} aria-hidden="true" />,
        disabled: !onCopy,
        onSelect: () => onCopy?.(application.program, tx('inspector.copyProgram')),
      },
      {
        id: 'copy-professor',
        label: tx('explorer.copyProfessor'),
        icon: <Copy size={14} aria-hidden="true" />,
        disabled: !onCopy || !application.professor.english.trim(),
        onSelect: () => onCopy?.(application.professor.english, tx('inspector.copyProfessor')),
      },
      {
        id: 'copy-email',
        label: tx('explorer.copyEmail'),
        icon: <Mail size={14} aria-hidden="true" />,
        disabled: !onCopy || !application.professor.email.trim(),
        onSelect: () => onCopy?.(application.professor.email, tx('inspector.copyEmail')),
      },
      {
        id: 'move-to',
        label: tx('kanban.moveTo'),
        icon: <ArrowRight size={14} aria-hidden="true" />,
        submenu: {
          title: tx('kanban.moveTo'),
          backLabel: tx('explorer.back'),
          items: statusOrder
            .filter((status) => status !== application.status)
            .map((status) => ({
              id: `move-${status}`,
              label: statusLabel(status, tx),
              icon: <ArrowRight size={14} aria-hidden="true" />,
              onSelect: () => changeApplicationStatus(application.id, status),
            })),
        },
      },
      {
        id: 'new-for-student',
        label: tx('team.teacherCreateForStudent'),
        icon: <Plus size={14} aria-hidden="true" />,
        disabled: !student || student.canCreateApplication === false || !onNewForStudent,
        onSelect: () => {
          if (student) onNewForStudent?.(student.id)
        },
      },
      {
        id: 'delete',
        label: tx('explorer.delete'),
        icon: <Trash2 size={14} aria-hidden="true" />,
        disabled: !onDeleteApplication,
        tone: 'danger',
        onSelect: () => onDeleteApplication?.(application.id),
      },
    ]
    setContextMenu({
      x: menuX,
      y: menuY,
      title: application.school.name,
      subtitle: application.program,
      items: items.filter((item) => (
        (item.id !== 'new-for-student' || Boolean(teamStudents))
        && (item.id !== 'export-json' || Boolean(onExportApplication))
        && (item.id !== 'delete' || Boolean(onDeleteApplication))
      )),
    })
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, applicationId: string) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(applicationId)
      if (selection.selectedCount > 0) startTransition(selection.clearSelection)
    }
  }

  function moveSelected(status: ApplicationStatus | '') {
    if (!status) return
    if (sort.field === 'status') captureVisibleRowPositions()
    const applicationById = new Map(rows.map(({ application }) => [application.id, application]))
    for (const id of selection.selectedIdList) {
      const application = applicationById.get(id)
      if (application && application.status !== status) onStatusChange(id, status)
    }
    selection.clearSelection()
  }

  const visibleTableWidth = columnMenu.api.visibleColumns.reduce(
    (total, column) => total + columnMenu.api.widthOf(column.id),
    0,
  )
  const tableStyle = {
    width: `${visibleTableWidth}px`,
    minWidth: '100%',
    '--application-table-select-width': `${columnMenu.api.widthOf('select')}px`,
  } as CSSProperties

  if (rows.length === 0) {
    return (
      <div className="application-pipeline-view application-smart-table-view is-empty">
        <div className="application-table-empty">
          <Table2 size={28} aria-hidden="true" />
          <div>
            <strong>{tx('kanban.tableEmptyTitle')}</strong>
            <span>{tx('kanban.tableEmptyDescription')}</span>
          </div>
          {onNew ? (
            <button type="button" className="primary-action" onClick={onNew}>
              <Plus size={15} aria-hidden="true" />
              <span>{tx('workspace.new')}</span>
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const selectionActions: ExplorerSelectionAction[] = [
    {
      id: 'open',
      label: tx('explorer.open'),
      icon: <FolderOpen size={13} aria-hidden="true" />,
      disabled: selection.selectedCount !== 1,
      onClick: () => {
        const [id] = selection.selectedIdList
        if (id) onSelect(id)
      },
    },
  ]
  if (onOpenMany) {
    selectionActions.push({
      id: 'open-tabs',
      label: tx('explorer.openInTabs'),
      icon: <ExternalLink size={13} aria-hidden="true" />,
      disabled: selection.selectedCount < 2,
      onClick: () => onOpenMany(selection.selectedIdList),
    })
  }
  if (onExportMany) {
    selectionActions.push({
      id: 'export-json',
      label: tx('explorer.exportSelectedJson'),
      icon: <Download size={13} aria-hidden="true" />,
      onClick: () => onExportMany(selection.selectedIdList),
    })
  }
  if (onDeleteMany) {
    selectionActions.push({
      id: 'delete',
      label: tx('explorer.deleteSelected'),
      icon: <Trash2 size={13} aria-hidden="true" />,
      tone: 'danger',
      onClick: () => {
        onDeleteMany(selection.selectedIdList)
        selection.clearSelection()
      },
    })
  }

  const toolbarNode = (
    <div className="application-table-toolbar">
      <div className="application-table-toolbar-copy">
        <strong>{format(tx('kanban.tableRows'), { count: sortedRows.length })}</strong>
        <span>{tx('kanban.tableHint')}</span>
      </div>
      <div className="application-table-tools">
        {compactViewport ? (
          <div className="application-table-mobile-sort">
            <Select<ApplicationTableSortField>
              value={sort.field}
              options={compactSortOptions}
              onChange={(field) => {
                captureVisibleRowPositions()
                setSort((current) => ({ ...current, field }))
              }}
              ariaLabel={tx('workspace.sortBy')}
              size="small"
            />
            <button
              type="button"
              className="application-table-tool-button is-direction"
              onClick={() => {
                captureVisibleRowPositions()
                setSort((current) => ({
                  ...current,
                  direction: current.direction === 'asc' ? 'desc' : 'asc',
                }))
              }}
              title={tx('workspace.sortBy')}
              aria-label={tx('workspace.sortBy')}
            >
              {sort.direction === 'asc'
                ? <ArrowUp size={14} aria-hidden="true" />
                : <ArrowDown size={14} aria-hidden="true" />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="application-table-tool-button"
            onClick={(event) => columnMenu.openMenu(event, tx('table.columns'))}
            onContextMenu={(event) => columnMenu.openMenu(event, tx('table.columns'))}
            title={tx('table.columns')}
            aria-label={tx('table.columns')}
            aria-expanded={Boolean(columnMenu.menu)}
          >
            <Columns3 size={14} aria-hidden="true" />
            <span>{tx('table.columns')}</span>
            {columnMenu.api.hidden.length > 0 ? (
              <b aria-label={format(tx('kanban.hiddenColumns'), { count: columnMenu.api.hidden.length })}>
                {columnMenu.api.hidden.length}
              </b>
            ) : null}
          </button>
        )}
        {onNew ? (
          <button type="button" className="application-table-new-button primary-action" onClick={onNew}>
            <Plus size={14} aria-hidden="true" />
            <span>{tx('workspace.new')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )

  const selectionBarNode = (
    <ExplorerSelectionBar
      visible={selection.selectedCount > 0}
      label={format(tx('explorer.selectedCount'), { count: selection.selectedCount })}
      clearLabel={tx('explorer.clearSelection')}
      placement="viewport-bottom"
      viewportAnchorRef={tableShellRef}
      className="application-table-selection-dock"
      leadingContent={(
        <Select<ApplicationStatus | ''>
          value=""
          options={statusOptions}
          onChange={moveSelected}
          placeholder={tx('kanban.moveSelected')}
          ariaLabel={tx('kanban.moveSelected')}
          size="small"
        />
      )}
      onClear={selection.clearSelection}
      actions={selectionActions}
    />
  )

  const isLoadMoreBusy = isLoadingMoreRows || isAppendingRows
  const loadMoreLabel = format(tx('kanban.showMore'), {
    count: Math.min(rowBatchSize, remainingRowCount),
  })
  const loadMoreNode = hasMoreRows ? (
    <div
      ref={loadMoreMarkerRef}
      className={`application-table-load-more${isLoadMoreBusy ? ' is-loading' : ''}`}
      aria-busy={isLoadMoreBusy || undefined}
    >
      <button
        type="button"
        onClick={() => {
          progressiveLoadArmedRef.current = true
          loadMoreRows()
        }}
        disabled={isLoadMoreBusy}
        aria-label={isLoadMoreBusy ? tx('working') : loadMoreLabel}
      >
        <span className="application-table-load-more-icon" aria-hidden="true">
          <Plus size={13} className="application-table-load-more-icon-idle" />
          <LoaderCircle size={13} className="application-table-load-more-icon-busy" />
        </span>
        <span className="application-table-load-more-label" aria-hidden="true">
          <span className="application-table-load-more-copy application-table-load-more-copy-idle">
            {loadMoreLabel}
          </span>
          <span className="application-table-load-more-copy application-table-load-more-copy-busy">
            {tx('working')}
          </span>
        </span>
      </button>
    </div>
  ) : null

  return (
    <div className={`application-pipeline-view application-smart-table-view${compactViewport ? ' is-compact' : ''}`}>
      <div ref={residentToolsRef} className="application-table-sticky-tools">
        {toolbarNode}
      </div>

      {selectionBarNode}

      <div ref={tableShellRef} className="atlas-table-shell application-smart-table-shell">
        <table className="atlas-table application-smart-table" style={tableStyle}>
          <TableColGroup columns={columns} api={columnMenu.api} />
          <thead
            ref={tableHeadRef}
            onContextMenu={(event) => columnMenu.openMenu(event, tx('table.columns'))}
          >
            <tr>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'select')!}
                api={columnMenu.api}
                className="application-table-select-cell is-sticky"
              >
                <ApplicationTableCheckbox
                  inputRef={selectAllRef}
                  checked={allSelected}
                  mixed={someSelected}
                  label={tx('kanban.tableSelectAll')}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (allSelected) selection.clearSelection()
                    else selection.setMany(sortedIds)
                  }}
                />
              </TableHeaderCell>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'application')!}
                api={columnMenu.api}
                className="application-table-identity-cell is-sticky"
                aria-sort={ariaSort('application')}
              >
                <SortHeaderButton
                  field="application"
                  label={tx('kanban.tableApplication')}
                  sort={sort}
                  onSort={changeSort}
                />
              </TableHeaderCell>
              {teamStudents ? (
                <TableHeaderCell
                  column={columns.find((column) => column.id === 'student')!}
                  api={columnMenu.api}
                  aria-sort={ariaSort('student')}
                >
                  <SortHeaderButton
                    field="student"
                    label={tx('kanban.tableStudent')}
                    sort={sort}
                    onSort={changeSort}
                  />
                </TableHeaderCell>
              ) : null}
              <TableHeaderCell
                column={columns.find((column) => column.id === 'professor')!}
                api={columnMenu.api}
                aria-sort={ariaSort('professor')}
              >
                <SortHeaderButton
                  field="professor"
                  label={tx('kanban.tableProfessor')}
                  sort={sort}
                  onSort={changeSort}
                />
              </TableHeaderCell>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'status')!}
                api={columnMenu.api}
                aria-sort={ariaSort('status')}
              >
                <SortHeaderButton
                  field="status"
                  label={tx('kanban.tableStatus')}
                  sort={sort}
                  onSort={changeSort}
                />
              </TableHeaderCell>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'deadline')!}
                api={columnMenu.api}
                aria-sort={ariaSort('deadline')}
              >
                <SortHeaderButton
                  field="deadline"
                  label={tx('kanban.tableDeadline')}
                  sort={sort}
                  onSort={changeSort}
                />
              </TableHeaderCell>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'progress')!}
                api={columnMenu.api}
                aria-sort={ariaSort('progress')}
              >
                <SortHeaderButton
                  field="progress"
                  label={tx('kanban.tableProgress')}
                  sort={sort}
                  onSort={changeSort}
                />
              </TableHeaderCell>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'priority')!}
                api={columnMenu.api}
                aria-sort={ariaSort('priority')}
              >
                <SortHeaderButton
                  field="priority"
                  label={tx('kanban.tablePriority')}
                  sort={sort}
                  onSort={changeSort}
                />
              </TableHeaderCell>
              <TableHeaderCell
                column={columns.find((column) => column.id === 'actions')!}
                api={columnMenu.api}
              >
                <span className="application-table-actions-label">{tx('table.actions')}</span>
              </TableHeaderCell>
            </tr>
          </thead>
          <tbody ref={tableBodyRef}>
            {visibleRows.map((row, index) => {
              const { application, student } = row
              const selected = selection.selectedIds.has(application.id)
              const priorityBand = applicationPriorityBand(application.priority)
              const entranceIndex = rowEntranceIndex.get(application.id)
              const entering = entranceIndex !== undefined
              return (
                <Fragment key={application.id}>
                  <tr
                    className={`${selected ? 'is-selected ' : ''}${entering ? 'is-entering' : ''}`.trim() || undefined}
                    data-pipeline-row-id={application.id}
                    style={{
                      '--application-table-row-index': Math.min(
                        entranceIndex ?? (index % rowBatchSize),
                        TABLE_ROW_STAGGER_LIMIT,
                      ),
                    } as CSSProperties}
                    tabIndex={0}
                    aria-selected={selected}
                    onPointerEnter={() => onPrefetch?.(application.id)}
                    onFocus={() => onPrefetch?.(application.id)}
                    onMouseDown={preventNativeShiftRangeSelection}
                    onClick={(event) => {
                      if (hasExplorerSelectionModifier(event)) {
                        selection.applyGesture(application.id, event)
                        return
                      }
                      onSelect(application.id)
                      if (selection.selectedCount > 0) startTransition(selection.clearSelection)
                    }}
                    onContextMenu={(event) => openRowContextMenu(event, row)}
                    onKeyDown={(event) => handleRowKeyDown(event, application.id)}
                  >
                  <TableCell
                    columnId="select"
                    api={columnMenu.api}
                    className="application-table-select-cell is-sticky"
                    dataLabel={tx('kanban.tableSelect')}
                  >
                    <ApplicationTableCheckbox
                      checked={selected}
                      label={format(tx('kanban.tableSelectApplication'), {
                        name: application.school.name,
                      })}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (event.shiftKey) {
                          selection.selectRange(application.id, event.ctrlKey || event.metaKey)
                        } else {
                          selection.toggle(application.id)
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell
                    columnId="application"
                    api={columnMenu.api}
                    className="application-table-identity-cell is-sticky"
                    dataLabel={tx('kanban.tableApplication')}
                  >
                    <div className="application-table-identity">
                      <SchoolLogoMark
                        schoolName={application.school.name}
                        logo={application.school.logo}
                        variant="list"
                      />
                      <span>
                        <strong>{application.school.name}</strong>
                        <em>{application.program}</em>
                      </span>
                    </div>
                  </TableCell>
                  {teamStudents ? (
                    <TableCell
                      columnId="student"
                      api={columnMenu.api}
                      dataLabel={tx('kanban.tableStudent')}
                    >
                      {student ? (
                        <div className="application-table-student">
                          <UserAvatar
                            avatarUrl={student.avatarUrl}
                            name={student.name}
                            email={student.email}
                          />
                          <span>
                            <strong>{student.name}</strong>
                            <em>{student.advisorName || tx('workspace.unassignedAdvisor')}</em>
                          </span>
                        </div>
                      ) : '—'}
                    </TableCell>
                  ) : null}
                  <TableCell
                    columnId="professor"
                    api={columnMenu.api}
                    dataLabel={tx('kanban.tableProfessor')}
                  >
                    <span className="application-table-professor">
                      <strong>{application.professor.english || '—'}</strong>
                      <em>{application.professor.email || '—'}</em>
                    </span>
                  </TableCell>
                  <TableCell
                    columnId="status"
                    api={columnMenu.api}
                    dataLabel={tx('kanban.tableStatus')}
                  >
                    <div
                      className={`application-table-status status-${statusCssSlug(application.status)}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ApplicationTableStatusEditor
                        value={application.status}
                        options={statusOptions}
                        onChange={(status) => changeApplicationStatus(application.id, status)}
                        ariaLabel={format(tx('kanban.tableChangeStatus'), {
                          name: application.school.name,
                        })}
                      />
                    </div>
                  </TableCell>
                  <TableCell
                    columnId="deadline"
                    api={columnMenu.api}
                    dataLabel={tx('kanban.tableDeadline')}
                  >
                    <span className="application-table-deadline">
                      <time dateTime={application.deadline || undefined}>
                        {formatDate(application.deadline, lang)}
                      </time>
                      <DeadlineBadge deadline={application.deadline} compact />
                    </span>
                  </TableCell>
                  <TableCell
                    columnId="progress"
                    api={columnMenu.api}
                    dataLabel={tx('kanban.tableProgress')}
                  >
                    <span className="application-table-progress">
                      <span aria-hidden="true">
                        <i style={{ width: `${Math.min(100, Math.max(0, application.progress))}%` }} />
                      </span>
                      <strong>{application.progress}%</strong>
                    </span>
                  </TableCell>
                  <TableCell
                    columnId="priority"
                    api={columnMenu.api}
                    dataLabel={tx('kanban.tablePriority')}
                  >
                    <span className={`application-table-priority priority-${priorityBand}`}>
                      <i aria-hidden="true" />
                      <span>{priorityDisplayLabel(application.priority, tx)}</span>
                    </span>
                  </TableCell>
                  <TableCell
                    columnId="actions"
                    api={columnMenu.api}
                    className="application-table-actions-cell"
                    dataLabel={tx('table.actions')}
                  >
                    <span className="application-table-row-actions">
                      <button
                        type="button"
                        className="application-table-open-action"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect(application.id)
                        }}
                        title={tx('explorer.open')}
                        aria-label={format(tx('kanban.tableOpenApplication'), {
                          name: application.school.name,
                        })}
                      >
                        <span>{tx('explorer.open')}</span>
                        <ArrowRight size={12} aria-hidden="true" />
                      </button>
                    </span>
                  </TableCell>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {loadMoreNode}
      </div>
      {columnMenu.menuNode}
      <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  )
}
