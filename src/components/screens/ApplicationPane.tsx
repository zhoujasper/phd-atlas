import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  ArchiveRestore,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  Columns,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Inbox,
  Lock,
  Mail,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { ApplicationTrashItem } from '../../api/phdApi'
import {
  applicationStatusOrder,
  type ApplicationRecord,
  type ApplicationStatus,
} from '../../data/applications'
import type { SortField, SortKey } from '../../appModel'
import { daysUntil, deadlineUrgency } from '../../appModel'
import { localeForLanguage } from '../../i18n'
import { SAFE_RELOAD_FLUSH_EVENT } from '../../safeReload'
import { statusCssSlug, statusLabel } from '../../statusLabels'
import { StatusPill } from '../shared/StatusPill'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { hasExplorerSelectionModifier, useExplorerSelection } from '../hooks/useExplorerSelection'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { ExplorerSelectionBar } from '../shared/ExplorerSelectionBar'
import { SchoolLogoMark } from '../shared/SchoolLogo'
import { InlinePresence } from '../shared/InlinePresence'

const APPLICATIONS_INITIAL_BATCH_SIZE = 10
const APPLICATIONS_BATCH_SIZE = 10
const APPLICATIONS_LOAD_AHEAD_PX = 220
const APPLICATION_SELECTION_MOTION_FALLBACK_MS = 320
const APPLICATION_SELECTION_SURFACE_HEIGHT = 46

function isJsdomRuntime() {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
}

type TeamApplicationRelation = {
  studentName: string
  advisorName?: string | null
}

function sortApplications(apps: ApplicationRecord[], key: SortKey, locale: string): ApplicationRecord[] {
  const sorted = [...apps]
  const { field, direction } = parseSortKey(key)
  const multiplier = direction === 'asc' ? 1 : -1
  switch (field) {
    case 'deadline':
      return sorted.sort((a, b) => a.deadline.localeCompare(b.deadline) * multiplier)
    case 'name':
      return sorted.sort((a, b) => a.school.name.localeCompare(b.school.name, locale, { numeric: true, sensitivity: 'base' }) * multiplier)
    case 'status':
      return sorted.sort((a, b) => a.status.localeCompare(b.status, locale, { sensitivity: 'base' }) * multiplier)
    case 'priority':
      return sorted.sort((a, b) => (a.priority - b.priority) * multiplier)
    case 'progress':
      return sorted.sort((a, b) => (a.progress - b.progress) * multiplier)
    default:
      return sorted
  }
}

function parseSortKey(key: SortKey): { field: SortField; direction: 'asc' | 'desc' } {
  const [field, explicitDirection] = String(key).split(':') as [SortField, 'asc' | 'desc' | undefined]
  const defaultDirection = field === 'priority' || field === 'progress' ? 'desc' : 'asc'
  return { field, direction: explicitDirection ?? defaultDirection }
}

function buildSortKey(field: SortField, direction: 'asc' | 'desc'): SortKey {
  return `${field}:${direction}` as SortKey
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select'
  )
}

function isActivationControlTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'button' ||
    tag === 'a' ||
    target.closest('[role="button"], [role="menuitem"]') !== null
  )
}

function ApplicationSearchField({
  query,
  onQuery,
  label,
  placeholder,
  shortcut,
}: {
  query: string
  onQuery: (value: string) => void
  label: string
  placeholder: string
  shortcut: string
}) {
  const [value, setValue] = useState(query)
  const timerRef = useRef<number | null>(null)
  const pendingLocalValueRef = useRef<string | null>(null)
  const onQueryRef = useRef(onQuery)
  onQueryRef.current = onQuery

  const commitValue = useCallback((nextValue: string, urgent = false) => {
    const commit = () => onQueryRef.current(nextValue)
    if (urgent) commit()
    else startTransition(commit)
  }, [])

  const scheduleCommit = useCallback((nextValue: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      commitValue(nextValue)
    }, 90)
  }, [commitValue])

  const flushCommit = useCallback((urgent = false) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    const pendingValue = pendingLocalValueRef.current
    if (pendingValue === null) return
    commitValue(pendingValue, urgent)
  }, [commitValue])

  useEffect(() => {
    // A delayed parent echo must not overwrite a newer local keystroke. Once
    // the parent acknowledges the latest draft, both layers converge again.
    if (pendingLocalValueRef.current !== null && query !== pendingLocalValueRef.current) return
    pendingLocalValueRef.current = null
    setValue(query)
  }, [query])
  useEffect(() => {
    const handleSafeReloadFlush = () => flushCommit(true)
    window.addEventListener(SAFE_RELOAD_FLUSH_EVENT, handleSafeReloadFlush)
    return () => {
      window.removeEventListener(SAFE_RELOAD_FLUSH_EVENT, handleSafeReloadFlush)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [flushCommit])

  return (
    <label className="search-field" data-tour="application-tools">
      <Search size={15} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value
          pendingLocalValueRef.current = nextValue
          setValue(nextValue)
          scheduleCommit(nextValue)
        }}
        onBlur={() => flushCommit()}
        placeholder={placeholder}
      />
      <span className="search-shortcut" aria-hidden="true">{shortcut}</span>
    </label>
  )
}

type ApplicationPaneProps = {
  applications: ApplicationRecord[]
  totalApplicationCount: number
  applicationLimit: number
  isPro: boolean
  selectedId: string | null
  query: string
  statusFilters: ApplicationStatus[]
  sort: SortKey
  onQuery: (value: string) => void
  onStatusFilters: (value: ApplicationStatus[]) => void
  onSort: (key: SortKey) => void
  onSelect: (id: string) => void
  onPrefetch?: (id?: string) => void
  onPrefetchBoard?: () => void
  // Omitted in the team-scoped browser — no one creates an application on a teammate's behalf.
  onNew?: () => void
  onUpgrade: () => void
  onShowBoard?: () => void
  boardActive?: boolean
  onOpenMany?: (ids: string[]) => void
  onExportMany?: (ids: string[]) => void
  trashItems?: ApplicationTrashItem[]
  trashCount?: number
  trashEnabled?: boolean
  /** Records retained briefly so destructive actions can exit without a list jump. */
  removingApplicationIds?: ReadonlySet<string>
  removingTrashItemIds?: ReadonlySet<string>
  // False only for surfaces that intentionally omit the account-owned recycle bin.
  showTrash?: boolean
  onRestoreTrash?: (item: ApplicationTrashItem) => void
  onDeleteTrash?: (item: ApplicationTrashItem) => void
  onEmptyTrash?: () => void
  onCopyApplication?: (value: string, label: string) => void
  onDeleteMany?: (ids: string[]) => void
  // applicationId -> owner display name, populated only when this pane is showing the
  // team-scoped list (multiple owners); absent in the personal application pane.
  ownerNames?: Record<string, string>
  // userId -> owner display name for Team recycle-bin rows. The current user is
  // intentionally omitted so a student's own deleted rows stay visually calm.
  trashOwnerNames?: Record<string, string>
  // Team-scoped browser only — lets an institution admin/teacher narrow the list to one
  // teammate at a time. Omitted (or a single entry) hides the filter row entirely.
  ownerFilterOptions?: Array<{ id: string; name: string; count?: number; advisorName?: string | null; role?: string | null }>
  ownerFilter?: string | null
  onOwnerFilter?: (ownerId: string | null) => void
  teamRelations?: Record<string, TeamApplicationRelation>
  // Application ids the viewer can only read, not edit — shows a small read-only
  // badge on the row so it's clear before opening.
  readOnlyIds?: Set<string>
  eyebrow?: string
  title?: string
  style?: CSSProperties
  collapsed?: boolean
  resizeHandle?: ReactNode
  // The session token participates in the render boundary so deferred UI never
  // invokes an action that closed over a superseded session.
  actionVersion?: string
}

export function ApplicationPane({
  applications,
  totalApplicationCount,
  applicationLimit,
  isPro,
  selectedId,
  query,
  statusFilters,
  sort,
  onQuery,
  onStatusFilters,
  onSort,
  onSelect,
  onPrefetch,
  onPrefetchBoard,
  onNew,
  onUpgrade,
  onShowBoard,
  boardActive = false,
  onOpenMany,
  onExportMany,
  trashItems = [],
  trashCount = 0,
  trashEnabled = false,
  removingApplicationIds,
  removingTrashItemIds,
  showTrash = true,
  onRestoreTrash,
  onDeleteTrash,
  onEmptyTrash,
  onCopyApplication,
  onDeleteMany,
  ownerNames,
  trashOwnerNames,
  ownerFilterOptions,
  ownerFilter,
  onOwnerFilter,
  teamRelations,
  readOnlyIds,
  eyebrow,
  title,
  style,
  collapsed = false,
  resizeHandle,
}: ApplicationPaneProps) {
  const { tx, format, lang } = useI18n()
  const filterStatusOrder = useMemo<Array<ApplicationStatus | 'All'>>(
    () => [
      'All',
      ...applicationStatusOrder(
        applications.map((application) => application.status),
        statusFilters,
      ),
    ],
    [applications, statusFilters],
  )
  const [visibleApplicationCount, setVisibleApplicationCount] = useState(
    () => Math.min(applications.length, APPLICATIONS_INITIAL_BATCH_SIZE),
  )
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [ownerPickerQuery, setOwnerPickerQuery] = useState('')
  const ownerPickerRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<HTMLElement | null>(null)
  const applicationListRef = useRef<HTMLDivElement | null>(null)
  const loadMoreMarkerRef = useRef<HTMLSpanElement | null>(null)
  const applicationSelectionSliderRef = useRef<HTMLSpanElement | null>(null)
  const applicationRowRefs = useRef(new Map<string, HTMLButtonElement>())
  const applicationRowGeometryRef = useRef(new Map<string, { top: number; height: number }>())
  const committedSelectionRef = useRef(selectedId)
  const optimisticSelectionRef = useRef<string | null>(null)
  const optimisticSelectionTimerRef = useRef<number | null>(null)
  const selectionMotionTimerRef = useRef<number | null>(null)
  const selectionMotionReleaseFramesRef = useRef<{ first: number; second: number } | null>(null)
  const { exiting: ownerPickerExiting, requestClose: requestOwnerPickerClose } = useAnimatedClose(
    ownerPickerOpen,
    () => {
      setOwnerPickerOpen(false)
      setOwnerPickerQuery('')
    },
  )

  const sortOptions: Array<{ field: SortField; label: string }> = [
    { field: 'deadline', label: tx('workspace.sortDeadline') },
    { field: 'name', label: tx('workspace.sortName') },
    { field: 'status', label: tx('workspace.sortStatus') },
    { field: 'priority', label: tx('workspace.sortPriority') },
    { field: 'progress', label: tx('workspace.sortProgress') },
  ]

  const locale = localeForLanguage(lang)
  const sorted = useMemo(() => sortApplications(applications, sort, locale), [applications, locale, sort])
  const activeSort = parseSortKey(sort)
  const visibleApplications = useMemo(
    () => sorted.slice(0, visibleApplicationCount),
    [sorted, visibleApplicationCount],
  )
  const visibleApplicationKey = visibleApplications.map((application) => application.id).join('|')
  const limitReached = !isPro && totalApplicationCount >= applicationLimit
  const hasMoreApplications = visibleApplicationCount < sorted.length
  const sortedApplicationIds = useMemo(() => sorted.map((application) => application.id), [sorted])
  const selection = useExplorerSelection(sortedApplicationIds)
  const selectedApplications = useMemo(
    () => sorted.filter((application) => selection.selectedIds.has(application.id)),
    [selection.selectedIds, sorted],
  )
  const selectedOwnerOption = ownerFilterOptions?.find((option) => option.id === ownerFilter) ?? null
  const filteredOwnerOptions = useMemo(() => {
    const needle = ownerPickerQuery.trim().toLowerCase()
    if (!ownerFilterOptions) return []
    if (!needle) return ownerFilterOptions
    return ownerFilterOptions.filter((option) => option.name.toLowerCase().includes(needle))
  }, [ownerFilterOptions, ownerPickerQuery])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const loadMoreApplications = useCallback(() => {
    if (!hasMoreApplications) return
    startTransition(() => {
      setVisibleApplicationCount((current) => Math.min(sorted.length, current + APPLICATIONS_BATCH_SIZE))
    })
  }, [hasMoreApplications, sorted.length])

  const loadMoreApplicationsIfNearEnd = useCallback(() => {
    if (!hasMoreApplications) return
    const list = applicationListRef.current
    const marker = loadMoreMarkerRef.current
    const listRemaining = list
      ? list.scrollHeight - list.scrollTop - list.clientHeight
      : Number.POSITIVE_INFINITY
    const markerRemaining = marker
      ? marker.getBoundingClientRect().top - window.innerHeight
      : Number.POSITIVE_INFINITY
    if (Math.min(listRemaining, markerRemaining) <= APPLICATIONS_LOAD_AHEAD_PX) {
      loadMoreApplications()
    }
  }, [hasMoreApplications, loadMoreApplications])

  useEffect(() => {
    if (!hasMoreApplications) return undefined
    const marker = loadMoreMarkerRef.current
    if (!marker || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreApplications()
      },
      { rootMargin: `0px 0px ${APPLICATIONS_LOAD_AHEAD_PX}px` },
    )
    observer.observe(marker)
    return () => observer.disconnect()
  }, [hasMoreApplications, loadMoreApplications])

  useEffect(() => {
    if (typeof IntersectionObserver !== 'undefined') return undefined
    const list = applicationListRef.current
    const pane = paneRef.current
    const handleScroll = () => loadMoreApplicationsIfNearEnd()
    list?.addEventListener('scroll', handleScroll, { passive: true })
    pane?.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      list?.removeEventListener('scroll', handleScroll)
      pane?.removeEventListener('scroll', handleScroll)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [loadMoreApplicationsIfNearEnd])

  const cancelSelectionSliderMotionRelease = useCallback(() => {
    const scheduled = selectionMotionReleaseFramesRef.current
    if (!scheduled) return
    if (scheduled.first) window.cancelAnimationFrame(scheduled.first)
    if (scheduled.second) window.cancelAnimationFrame(scheduled.second)
    selectionMotionReleaseFramesRef.current = null
  }, [])

  const finishSelectionSliderMotion = useCallback(() => {
    if (selectionMotionTimerRef.current !== null) {
      window.clearTimeout(selectionMotionTimerRef.current)
      selectionMotionTimerRef.current = null
    }
    cancelSelectionSliderMotionRelease()
    applicationSelectionSliderRef.current?.classList.remove('is-moving')
  }, [cancelSelectionSliderMotionRelease])

  const scheduleSelectionSliderMotionFinish = useCallback(() => {
    if (selectionMotionTimerRef.current !== null) {
      window.clearTimeout(selectionMotionTimerRef.current)
      selectionMotionTimerRef.current = null
    }
    cancelSelectionSliderMotionRelease()

    const release = () => {
      applicationSelectionSliderRef.current?.classList.remove('is-moving')
    }
    if (isJsdomRuntime() || typeof window.requestAnimationFrame !== 'function') {
      release()
      return
    }

    // Keep the promoted layer through one complete post-transition paint.
    // Releasing it on transitionend (or at the exact CSS duration) can demote
    // the layer during its final raster frame and produce a visible arrival
    // hitch. Two frames make the first settled frame paint before cleanup.
    const scheduled = { first: 0, second: 0 }
    selectionMotionReleaseFramesRef.current = scheduled
    scheduled.first = window.requestAnimationFrame(() => {
      if (selectionMotionReleaseFramesRef.current !== scheduled) return
      scheduled.first = 0
      scheduled.second = window.requestAnimationFrame(() => {
        if (selectionMotionReleaseFramesRef.current !== scheduled) return
        selectionMotionReleaseFramesRef.current = null
        release()
      })
    })
  }, [cancelSelectionSliderMotionRelease])

  const measureApplicationRows = useCallback(() => {
    const geometry = applicationRowGeometryRef.current
    const currentIds = new Set(applicationRowRefs.current.keys())
    for (const id of geometry.keys()) {
      if (!currentIds.has(id)) geometry.delete(id)
    }
    for (const [id, row] of applicationRowRefs.current) {
      geometry.set(id, {
        top: row.offsetTop,
        height: row.offsetHeight || 46,
      })
    }
  }, [])

  const positionSelectionSlider = useCallback((
    targetId: string | null,
    targetRow?: HTMLButtonElement | null,
  ) => {
    const list = applicationListRef.current
    const slider = applicationSelectionSliderRef.current
    const row = targetRow ?? (targetId ? applicationRowRefs.current.get(targetId) : null)
    if (!list || !slider || !row) {
      finishSelectionSliderMotion()
      slider?.classList.remove('is-visible')
      list?.classList.remove('has-selection-slider')
      return
    }

    // Geometry is prepared after layout/resize. Pointer feedback can therefore
    // remain write-only in normal browsers instead of forcing the entire
    // dossier workspace to synchronously flush layout on press.
    const cachedGeometry = targetId
      ? applicationRowGeometryRef.current.get(targetId)
      : undefined
    const nextTop = cachedGeometry && !isJsdomRuntime()
      ? cachedGeometry.top
      : row.offsetTop
    const nextHeight = cachedGeometry && !isJsdomRuntime()
      ? cachedGeometry.height
      : row.offsetHeight || 46
    const nextTopValue = `${nextTop}px`
    const nextHeightValue = `${nextHeight}px`
    const nextScaleY = nextHeight / APPLICATION_SELECTION_SURFACE_HEIGHT
    const shouldAnimate = slider.classList.contains('is-visible')
      && (
        slider.style.getPropertyValue('--application-selection-y') !== nextTopValue
        || slider.style.getPropertyValue('--application-selection-height') !== nextHeightValue
      )

    if (shouldAnimate) {
      if (selectionMotionTimerRef.current !== null) {
        window.clearTimeout(selectionMotionTimerRef.current)
      }
      cancelSelectionSliderMotionRelease()
      slider.classList.add('is-moving')
      selectionMotionTimerRef.current = window.setTimeout(
        scheduleSelectionSliderMotionFinish,
        APPLICATION_SELECTION_MOTION_FALLBACK_MS,
      )
    }
    slider.style.setProperty('--application-selection-y', nextTopValue)
    slider.style.setProperty('--application-selection-height', nextHeightValue)
    slider.style.setProperty('--application-selection-scale-y', String(nextScaleY))
    slider.classList.add('is-visible')
    list.classList.add('has-selection-slider')
  }, [
    cancelSelectionSliderMotionRelease,
    finishSelectionSliderMotion,
    scheduleSelectionSliderMotionFinish,
  ])

  const syncSelectionSlider = useCallback(() => {
    positionSelectionSlider(optimisticSelectionRef.current ?? committedSelectionRef.current)
  }, [positionSelectionSlider])

  const primeApplicationSelection = useCallback((
    id: string,
    row: HTMLButtonElement,
  ) => {
    optimisticSelectionRef.current = id
    positionSelectionSlider(id, row)

    if (optimisticSelectionTimerRef.current !== null) {
      window.clearTimeout(optimisticSelectionTimerRef.current)
    }
    // Navigation guards can reject a requested record change. If that happens,
    // return the transient slider to the durable selection without a React render.
    optimisticSelectionTimerRef.current = window.setTimeout(() => {
      optimisticSelectionTimerRef.current = null
      if (optimisticSelectionRef.current !== id) return
      optimisticSelectionRef.current = null
      positionSelectionSlider(committedSelectionRef.current)
    }, 700)
  }, [positionSelectionSlider])

  const openApplication = useCallback((id: string, row: HTMLButtonElement) => {
    if (optimisticSelectionRef.current !== id) {
      primeApplicationSelection(id, row)
    }
    onSelect(id)
  }, [onSelect, primeApplicationSelection])

  useLayoutEffect(() => {
    measureApplicationRows()
    syncSelectionSlider()

    const list = applicationListRef.current
    if (!list || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(() => {
      measureApplicationRows()
      syncSelectionSlider()
    })
    observer.observe(list)
    applicationRowRefs.current.forEach((applicationRow) => observer.observe(applicationRow))
    return () => observer.disconnect()
  }, [measureApplicationRows, syncSelectionSlider, visibleApplicationKey])

  useLayoutEffect(() => {
    const selectionChanged = committedSelectionRef.current !== selectedId
    committedSelectionRef.current = selectedId
    if (selectionChanged || optimisticSelectionRef.current === selectedId) {
      optimisticSelectionRef.current = null
      if (optimisticSelectionTimerRef.current !== null) {
        window.clearTimeout(optimisticSelectionTimerRef.current)
        optimisticSelectionTimerRef.current = null
      }
    }
    syncSelectionSlider()
  }, [selectedId, syncSelectionSlider])

  useEffect(() => () => {
    if (optimisticSelectionTimerRef.current !== null) {
      window.clearTimeout(optimisticSelectionTimerRef.current)
    }
    finishSelectionSliderMotion()
  }, [finishSelectionSliderMotion])

  const toggleStatusFilter = useCallback((item: ApplicationStatus | 'All') => {
    if (item === 'All') {
      onStatusFilters([])
      return
    }
    onStatusFilters(
      statusFilters.includes(item)
        ? statusFilters.filter((status) => status !== item)
        : [...statusFilters, item],
    )
  }, [onStatusFilters, statusFilters])

  const deleteApplications = useCallback((ids: string[]) => {
    if (!ids.length || !onDeleteMany) return
    onDeleteMany(ids)
    selection.clearSelection()
  }, [onDeleteMany, selection])

  useEffect(() => {
    if (collapsed) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const targetInPane = Boolean(target && paneRef.current?.contains(target))
      const focusInPane = Boolean(activeElement && paneRef.current?.contains(activeElement))
      if (!targetInPane && !focusInPane && selection.selectedCount === 0) return

      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey

      if (mod && key === 'a' && sortedApplicationIds.length > 0) {
        event.preventDefault()
        selection.setMany(sortedApplicationIds)
        return
      }

      if (event.key === 'Escape' && selection.selectedCount > 0) {
        event.preventDefault()
        selection.clearSelection()
        return
      }

      if (event.key === 'Enter' && selection.selectedCount === 1) {
        if (isActivationControlTarget(event.target)) return
        const [id] = selection.selectedIdList
        if (!id) return
        const row = applicationRowRefs.current.get(id)
        if (!row) return
        event.preventDefault()
        openApplication(id, row)
        return
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.selectedCount > 0 && onDeleteMany) {
        event.preventDefault()
        deleteApplications(selection.selectedIdList)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    collapsed,
    deleteApplications,
    onDeleteMany,
    openApplication,
    selection,
    selection.selectedCount,
    selection.selectedIdList,
    sortedApplicationIds,
  ])

  const formatTrashDate = useCallback((value: string | null | undefined) => {
    if (!value) return tx('trash.never')
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  }, [locale, tx])

  const openApplicationContextMenu = useCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    application: ApplicationRecord,
  ) => {
    event.preventDefault()
    const isAlreadySelected = selection.selectedIds.has(application.id)
    const targets = isAlreadySelected && selectedApplications.length > 0
      ? selectedApplications
      : [application]
    if (!isAlreadySelected) selection.selectOnly(application.id)
    const targetIds = targets.map((item) => item.id)

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: targets.length === 1
        ? targets[0].school.name
        : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.applicationMenuHint'),
      items: [
        {
          id: 'open',
          label: tx('explorer.open'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          disabled: targets.length !== 1,
          shortcut: 'O',
          accessKey: 'o',
          onSelect: () => onSelect(targets[0].id),
        },
        {
          id: 'open-tabs',
          label: targets.length === 1 ? tx('explorer.openInNewPage') : tx('explorer.openSelectedInNewPages'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          shortcut: 'N',
          accessKey: 'n',
          disabled: !onOpenMany,
          onSelect: () => onOpenMany?.(targetIds),
        },
        {
          id: 'export-json',
          label: targets.length === 1 ? tx('explorer.exportApplicationJson') : tx('explorer.exportSelectedJson'),
          icon: <Download size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          disabled: !onExportMany,
          onSelect: () => onExportMany?.(targetIds),
        },
        {
          id: 'copy-school',
          label: tx('explorer.copySchool'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: targets.length !== 1 || !onCopyApplication,
          onSelect: () => onCopyApplication?.(targets[0].school.name, tx('inspector.copySchool')),
        },
        {
          id: 'copy-program',
          label: tx('explorer.copyProgram'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'P',
          accessKey: 'p',
          disabled: targets.length !== 1 || !onCopyApplication,
          onSelect: () => onCopyApplication?.(targets[0].program, tx('inspector.copyProgram')),
        },
        {
          id: 'copy-professor',
          label: tx('explorer.copyProfessor'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'R',
          accessKey: 'r',
          disabled: targets.length !== 1 || !onCopyApplication,
          onSelect: () => onCopyApplication?.(targets[0].professor.english, tx('inspector.copyProfessor')),
        },
        {
          id: 'copy-email',
          label: tx('explorer.copyEmail'),
          icon: <Mail size={14} aria-hidden="true" />,
          shortcut: 'M',
          accessKey: 'm',
          disabled: targets.length !== 1 || !onCopyApplication,
          onSelect: () => onCopyApplication?.(targets[0].professor.email, tx('inspector.copyEmail')),
        },
        {
          id: 'delete',
          label: targets.length === 1 ? tx('explorer.delete') : tx('explorer.deleteSelected'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          shortcut: 'Delete',
          accessKey: 'delete',
          disabled: !onDeleteMany,
          tone: 'danger',
          onSelect: () => deleteApplications(targetIds),
        },
      ],
    })
  }, [deleteApplications, format, onCopyApplication, onDeleteMany, onExportMany, onOpenMany, onSelect, selectedApplications, selection, tx])

  useEffect(() => {
    setVisibleApplicationCount((current) => Math.min(
      sorted.length,
      Math.max(current, Math.min(sorted.length, APPLICATIONS_INITIAL_BATCH_SIZE)),
    ))
  }, [sorted.length])

  useEffect(() => {
    setVisibleApplicationCount(Math.min(sorted.length, APPLICATIONS_INITIAL_BATCH_SIZE))
  }, [ownerFilter, query, sort, sorted.length, statusFilters])

  useEffect(() => {
    if (!selectedId) return
    const selectedIndex = sorted.findIndex((application) => application.id === selectedId)
    if (selectedIndex < 0) return
    setVisibleApplicationCount((current) => Math.min(sorted.length, Math.max(current, selectedIndex + 1)))
  }, [selectedId, sorted])

  useEffect(() => {
    if (!ownerPickerOpen) return
    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as Node | null
      if (target && ownerPickerRef.current?.contains(target)) return
      requestOwnerPickerClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') requestOwnerPickerClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [ownerPickerOpen, requestOwnerPickerClose])

  return (
    <section
      ref={paneRef}
      className="application-pane"
      aria-label={tx('workspace.applicationList')}
      aria-hidden={collapsed || undefined}
      inert={collapsed ? true : undefined}
      style={style}
    >
      <div className="pane-topline">
        <div>
          <span className="eyebrow">{eyebrow ?? tx('workspace.eyebrow')}</span>
          <h1>{title ?? tx('workspace.title')}</h1>
        </div>
      </div>

      <ApplicationSearchField
        query={query}
        onQuery={onQuery}
        label={tx('workspace.searchApplications')}
        placeholder={tx('workspace.search')}
        shortcut={tx('workspace.searchShortcut')}
      />

      <div className="status-filter" aria-label={tx('workspace.statusFilter')}>
        {filterStatusOrder.map((item) => {
          const active = item === 'All' ? statusFilters.length === 0 : statusFilters.includes(item)
          return (
            <button
              key={item}
              type="button"
              className={active ? 'active' : ''}
              aria-pressed={active}
              onClick={() => toggleStatusFilter(item)}
            >
              <span>{statusLabel(item, tx)}</span>
            </button>
          )
        })}
      </div>

      {ownerFilterOptions && ownerFilterOptions.length > 1 ? (
        <div className={`owner-picker ${ownerPickerOpen ? 'open' : ''} ${ownerPickerExiting ? 'exiting' : ''}`} ref={ownerPickerRef}>
          <button
            type="button"
            className="owner-picker-trigger"
            aria-haspopup="listbox"
            aria-expanded={ownerPickerOpen}
            aria-label={tx('workspace.ownerFilter')}
            onClick={() => {
              if (ownerPickerOpen) {
                requestOwnerPickerClose()
                return
              }
              setOwnerPickerQuery('')
              setOwnerPickerOpen(true)
            }}
          >
            <Users size={14} aria-hidden="true" />
            <span>
              <small>{tx('workspace.ownerFilter')}</small>
              <strong>{selectedOwnerOption?.name ?? tx('workspace.ownerFilterAll')}</strong>
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {ownerPickerOpen ? (
            <div className="owner-picker-menu">
              <div className="owner-picker-menu-surface" role="listbox" aria-label={tx('workspace.ownerFilter')}>
                <div className="owner-picker-menu-content">
                  <label className="owner-picker-search">
                    <Search size={13} aria-hidden="true" />
                    <span className="sr-only">{tx('workspace.ownerFilterSearch')}</span>
                    <input
                      autoFocus
                      value={ownerPickerQuery}
                      onChange={(event) => setOwnerPickerQuery(event.target.value)}
                      placeholder={tx('workspace.ownerFilterSearch')}
                    />
                    {ownerPickerQuery ? (
                      <button type="button" onClick={() => setOwnerPickerQuery('')} aria-label={tx('workspace.ownerFilterClear')}>
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </label>
                  <div className="owner-picker-list">
                    <button
                      type="button"
                      className={!ownerFilter ? 'active' : ''}
                      role="option"
                      aria-selected={!ownerFilter}
                      onClick={() => {
                        onOwnerFilter?.(null)
                        requestOwnerPickerClose()
                      }}
                    >
                      <span>
                        <strong>{tx('workspace.ownerFilterAll')}</strong>
                        <em>{format(tx('workspace.ownerFilterAllDesc'), { count: ownerFilterOptions.length })}</em>
                      </span>
                      {!ownerFilter ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                    {filteredOwnerOptions.length === 0 ? (
                      <div className="owner-picker-empty">{tx('workspace.ownerFilterNoMatch')}</div>
                    ) : filteredOwnerOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={ownerFilter === option.id ? 'active' : ''}
                        role="option"
                        aria-selected={ownerFilter === option.id}
                        onClick={() => {
                          onOwnerFilter?.(option.id)
                          requestOwnerPickerClose()
                        }}
                      >
                        <span>
                          <strong>{option.name}</strong>
                          <em>
                            {option.advisorName
                              ? format(tx('workspace.ownerFilterAdvisorDesc'), { advisor: option.advisorName, count: option.count ?? 0 })
                              : format(tx('workspace.ownerFilterApplicationDesc'), { count: option.count ?? 0 })}
                          </em>
                        </span>
                        {ownerFilter === option.id ? <Check size={13} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sort-list" aria-label={tx('workspace.sortBy')}>
        {sortOptions.map(({ field, label }) => {
          const active = activeSort.field === field
          const nextDirection = active && activeSort.direction === 'asc' ? 'desc' : 'asc'
          const DirectionIcon = active ? (activeSort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowDownUp
          return (
            <button
              key={field}
              type="button"
              className={`sort-chip ${active ? 'active' : ''}`}
              aria-pressed={active}
              title={label}
              onClick={() => onSort(buildSortKey(field, nextDirection))}
            >
              <span>{label}</span>
              <DirectionIcon size={11} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div className="list-count">
        <span>{format(tx('workspace.records'), { count: applications.length })}</span>
        <div className="list-count-actions">
          {onShowBoard ? (
            <InlinePresence
              present={!boardActive}
              className="application-board-action-presence"
              durationMs={220}
              parentGap="1px"
              layout="instant"
            >
              <button
                type="button"
                className="application-board-button"
                onClick={onShowBoard}
                onPointerDown={(event) => {
                  if (event.button === 0) onPrefetchBoard?.()
                }}
                onPointerEnter={onPrefetchBoard}
                onFocus={onPrefetchBoard}
                aria-label={tx('kanban.boardView')}
                title={tx('kanban.boardView')}
              >
                <Columns size={12} aria-hidden="true" />
                <span>{tx('kanban.board')}</span>
              </button>
            </InlinePresence>
          ) : null}
          {onNew ? (
            <button
              type="button"
              className={`application-create-button${limitReached ? ' application-new-locked' : ''}`}
              onClick={limitReached ? onUpgrade : onNew}
              aria-label={limitReached ? tx('workspace.upgradeToCreate') : tx('workspace.new')}
              title={limitReached ? tx('workspace.upgradeToCreate') : tx('workspace.new')}
            >
              {limitReached ? <Lock size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
              {limitReached ? tx('workspace.pro') : tx('workspace.new')}
            </button>
          ) : null}
        </div>
      </div>

      <ExplorerSelectionBar
        visible={selection.selectedCount > 0}
        label={format(tx('explorer.selectedCount'), { count: selection.selectedCount })}
        clearLabel={tx('explorer.clearSelection')}
        onClear={selection.clearSelection}
        actions={[
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
          {
            id: 'open-tabs',
            label: tx('explorer.openInTabs'),
            icon: <ExternalLink size={13} aria-hidden="true" />,
            disabled: selection.selectedCount < 2 || !onOpenMany,
            onClick: () => onOpenMany?.(selection.selectedIdList),
          },
          {
            id: 'export-json',
            label: tx('explorer.exportSelectedJson'),
            icon: <Download size={13} aria-hidden="true" />,
            disabled: !onExportMany,
            onClick: () => onExportMany?.(selection.selectedIdList),
          },
          {
            id: 'delete',
            label: tx('explorer.deleteSelected'),
            icon: <Trash2 size={13} aria-hidden="true" />,
            disabled: !onDeleteMany,
            tone: 'danger',
            onClick: () => deleteApplications(selection.selectedIdList),
          },
        ]}
      />

      {sorted.length === 0 ? (
        <div className="empty-list application-list-empty">
          <Inbox size={32} aria-hidden="true" />
          <span>{tx('workspace.noMatch')}</span>
        </div>
      ) : (
        <div className="application-list-shell">
          <div
            ref={applicationListRef}
            className="application-list"
            data-loaded-count={visibleApplications.length}
            data-total-count={sorted.length}
            onScroll={loadMoreApplicationsIfNearEnd}
          >
            <span
              ref={applicationSelectionSliderRef}
              className="application-selection-slider"
              aria-hidden="true"
              onTransitionEnd={(event) => {
                if (event.propertyName === 'transform') scheduleSelectionSliderMotionFinish()
              }}
            />
            {visibleApplications.map((application, index) => {
              const due = daysUntil(application.deadline)
              const urgency = deadlineUrgency(due)
              const isSelected = selectedId === application.id
              const isExplorerSelected = selection.selectedIds.has(application.id)
              const isRemoving = Boolean(removingApplicationIds?.has(application.id))
              const relation = teamRelations?.[application.id]
              const teacherNames = relation
                ? relation.advisorName || tx('workspace.unassignedAdvisor')
                : ''

              return (
                <button
                  key={application.id}
                  ref={(node) => {
                    if (node) applicationRowRefs.current.set(application.id, node)
                    else {
                      applicationRowRefs.current.delete(application.id)
                      applicationRowGeometryRef.current.delete(application.id)
                    }
                  }}
                  type="button"
                  className={`application-line${relation ? ' has-team-context' : ''}${isSelected ? ' selected' : ''}${isExplorerSelected ? ' explorer-selected' : ''}${isRemoving ? ' is-removing' : ''}`}
                  style={{ '--page-item-index': index } as CSSProperties}
                  data-tour={isSelected ? 'selected-application-row' : undefined}
                  aria-selected={isExplorerSelected}
                  aria-busy={isRemoving || undefined}
                  onPointerDown={(event) => {
                    onPrefetch?.(application.id)
                    if (event.button === 0 && !hasExplorerSelectionModifier(event)) {
                      primeApplicationSelection(application.id, event.currentTarget)
                    }
                  }}
                  onPointerEnter={() => onPrefetch?.(application.id)}
                  onFocus={() => onPrefetch?.(application.id)}
                  onClick={(event) => {
                    if (hasExplorerSelectionModifier(event)) {
                      selection.applyGesture(application.id, event)
                      return
                    }
                    selection.clearSelection()
                    openApplication(application.id, event.currentTarget)
                  }}
                  onContextMenu={(event) => openApplicationContextMenu(event, application)}
                  title={`${application.school.name} — ${application.professor.english}`}
                >
                  <span
                    className={`line-status status-${statusCssSlug(application.status)}`}
                    aria-hidden="true"
                  />
                  <SchoolLogoMark
                    schoolName={application.school.name}
                    logo={application.school.logo}
                    variant="list"
                  />
                  <span className="line-main">
                    <strong>{application.school.name}</strong>
                    {relation ? (
                      <span className="team-line-context">
                        <small>
                          {tx('workspace.advisorLabel')}
                          <span aria-hidden="true">:</span>
                        </small>
                        <b title={teacherNames}>{teacherNames}</b>
                        <small>
                          {tx('workspace.studentLabel')}
                          <span aria-hidden="true">:</span>
                        </small>
                        <b title={relation.studentName}>{relation.studentName}</b>
                      </span>
                    ) : null}
                    <em>
                      {application.program} · {application.professor.english}
                      {!relation && ownerNames?.[application.id] ? ` · ${ownerNames[application.id]}` : ''}
                    </em>
                  </span>
                  <span className="line-side">
                    <span className="line-side-top">
                      {readOnlyIds?.has(application.id) ? (
                        <span className="line-readonly-badge" title={tx('dossier.readOnlyBadge')}>
                          <Eye size={11} aria-hidden="true" />
                        </span>
                      ) : null}
                      <StatusPill status={application.status} />
                    </span>
                    <small className={`deadline-days ${urgency === 'urgent' ? 'urgent' : ''}`}>
                      {!application.deadline
                        ? '—'
                        : due === 0
                        ? tx('workspace.today')
                        : due > 0
                          ? format(tx('workspace.dayShort'), { count: due })
                        : format(tx('workspace.daysPast'), { count: Math.abs(due) })}
                    </small>
                  </span>
                  <span className="line-selection-mark" aria-hidden="true">
                    <Check size={14} />
                  </span>
                </button>
              )
            })}
            {hasMoreApplications ? (
              <span
                ref={loadMoreMarkerRef}
                className="application-list-load-marker"
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
      )}
      {showTrash ? (
      <div className={`application-trash-dock ${trashOpen ? 'open' : ''}`}>
        <button
          type="button"
          className={`application-trash-toggle ${trashEnabled ? '' : 'locked'}`}
          onClick={() => {
            if (!trashEnabled) {
              onUpgrade()
              return
            }
            setTrashOpen((open) => !open)
          }}
          aria-expanded={trashEnabled ? trashOpen : undefined}
          aria-disabled={!trashEnabled}
        >
          <span className="application-trash-icon" aria-hidden="true">
            <Trash2 size={14} />
            {!trashEnabled ? <Lock size={9} className="application-trash-lock" /> : null}
          </span>
          <span>{tx('trash.title')}</span>
          <em>{trashEnabled ? format(tx('trash.count'), { count: trashCount }) : tx('proOnly')}</em>
        </button>
        {trashEnabled ? (
          <CollapsiblePanel
            open={trashOpen}
            className="application-trash-panel"
            collapseMs={380}
            keepMounted
          >
            <div className="application-trash-head">
              <div>
                <span className="eyebrow">{tx('trash.eyebrow')}</span>
                <strong>{tx('trash.recoverDeleted')}</strong>
              </div>
              <button type="button" className="quiet-action compact-action" onClick={onEmptyTrash} disabled={trashItems.length === 0}>
                <Trash2 size={12} aria-hidden="true" /> {tx('trash.empty')}
              </button>
            </div>
            {trashItems.length === 0 ? (
              <div className="application-trash-empty">
                <Inbox size={16} aria-hidden="true" />
                <span>{tx('trash.emptyState')}</span>
              </div>
            ) : (
              <div className="application-trash-list">
                {trashItems.slice(0, 5).map((item) => {
                  const isRemoving = Boolean(removingTrashItemIds?.has(item.id))
                  const trashOwnerName = item.application.ownerId
                    ? trashOwnerNames?.[item.application.ownerId]
                    : undefined
                  return (
                  <div key={item.id} className={`application-trash-item${isRemoving ? ' is-removing' : ''}`} aria-busy={isRemoving || undefined}>
                    <span
                      className={`line-status status-${statusCssSlug(item.application.status)}`}
                      aria-hidden="true"
                    />
                    <span className="application-trash-copy">
                      <strong>{item.application.school.name}</strong>
                      <em>{trashOwnerName ? `${trashOwnerName} · ` : ''}{item.application.program} · {item.application.professor.english}</em>
                      <small><Clock3 size={11} aria-hidden="true" /> {formatTrashDate(item.expiresAt)}</small>
                    </span>
                    <span className="application-trash-actions">
                      <button type="button" onClick={() => onRestoreTrash?.(item)} title={tx('trash.restore')} aria-label={tx('trash.restore')} disabled={isRemoving}>
                        <ArchiveRestore size={13} aria-hidden="true" />
                      </button>
                      <button type="button" className="danger" onClick={() => onDeleteTrash?.(item)} title={tx('trash.deleteForever')} aria-label={tx('trash.deleteForever')} disabled={isRemoving}>
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  )
                })}
              </div>
            )}
          </CollapsiblePanel>
        ) : null}
      </div>
      ) : null}
      {resizeHandle}
      <ExplorerContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </section>
  )
}
