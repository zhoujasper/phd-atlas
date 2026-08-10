import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Columns3,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type {
  DiscoverCatalogMeta,
  DiscoverRankerWeights,
  DiscoverRegion,
  DiscoverUserState,
  RequirementFilterState,
  ScoredDiscoverPi,
  ScoredDiscoverProgram,
} from '../../data/discover'
import { multiApplyLabel, piCategoryLabel, primaryDeadline } from '../../data/discover'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { hasExplorerSelectionModifier, useExplorerSelection } from '../hooks/useExplorerSelection'
import { Select } from './Select'
import { DiscoverMultiSelectOption } from './DiscoverMultiSelect'
import { DiscoverQuickGuide } from './DiscoverQuickGuide'
import { ExplorerContextMenu, type ExplorerContextMenuState } from './ExplorerContextMenu'
import { ExplorerSelectionBar } from './ExplorerSelectionBar'
import { FavoriteBookmarkButton } from './FavoriteBookmarkButton'
import { InlinePresence } from './InlinePresence'
import { InfoTooltip } from './InfoTooltip'
import { ModalPortal } from './ModalPortal'
import { SmoothDisclosure } from './SmoothDisclosure'
import { TableCell, TableColGroup, TableHeaderCell } from './TableColumnChrome'
import { UserAvatar } from './UserAvatar'
import { useTableColumnMenu } from './useTableColumnMenu'
import type { TableColumnDef, TableColumnsApi } from './useTableColumns'
import { DiscreteLevelPicker } from './DiscreteLevelPicker'
import { DISCOVER_EXTERNAL_LINK_PROPS, uniqueDiscoverSourceLinks } from './discoverSourceLinks'

export type DiscoverWorkspaceMode = 'programs' | 'pis' | 'compare'
export type DiscoverProgramSort = 'program' | 'location' | 'match' | 'funding' | 'deadline' | 'advisors' | 'collectedAt'
export type DiscoverSortDirection = 'asc' | 'desc'
type DiscoverPiSort = 'advisor' | 'program' | 'category' | 'hIndex' | 'match'

type WorkspaceFilters = {
  regionFilters: string[]
  minStipend: number
  minMatch: number
  watchedOnly: boolean
  meetFloorOnly: boolean
  showHidden: boolean
  hedgeFilter: 'all' | 'multi' | 'single'
  piCategory: string
  minHIndex: number
  requirements: RequirementFilterState
}

type WorkspaceActions = {
  setMode: (mode: DiscoverWorkspaceMode) => void
  setQuery: (query: string) => void
  toggleFilterRail: () => void
  openMobileFilters: () => void
  closeMobileFilters: () => void
  openResearch: () => void
  selectProgram: (id: string) => void
  selectPi: (id: string) => void
  openInspector: () => void
  closeInspector: () => void
  toggleCompare: (id: string) => void
  addProgramsToCompare: (ids: string[]) => void
  clearCompare: () => void
  requestDeletePrograms: (ids: string[]) => void
  toggleWatch: (id: string) => void
  watchPrograms: (ids: string[]) => void
  toggleProgramHidden: (id: string) => void
  hidePrograms: (ids: string[]) => void
  togglePiHidden: (id: string) => void
  importProgram: (programId: string, piId?: string | null) => void
  updateProgramNote: (id: string, value: string) => void
  saveProgramNote: (id: string) => void
  updatePiNote: (id: string, value: string) => void
  savePiNote: (id: string) => void
  toggleRegion: (region: string) => void
  setMinStipend: (value: number) => void
  setMinMatch: (value: number) => void
  setWatchedOnly: (value: boolean) => void
  setMeetFloorOnly: (value: boolean) => void
  setShowHidden: (value: boolean) => void
  setHedgeFilter: (value: WorkspaceFilters['hedgeFilter']) => void
  setPiCategory: (value: string) => void
  setMinHIndex: (value: number) => void
  toggleRequirement: (key: keyof RequirementFilterState) => void
  setRankerWeight: (key: keyof DiscoverRankerWeights, value: number) => void
  saveRanker: () => void
  clearFilters: () => void
  setProgramSort: (sort: DiscoverProgramSort) => void
  toggleSortDirection: () => void
}

export type DiscoverWorkspaceProps = {
  meta: DiscoverCatalogMeta | null
  state: DiscoverUserState
  mode: DiscoverWorkspaceMode
  modeDirection: 'forward' | 'backward'
  query: string
  catalogProgramCount: number
  programs: ScoredDiscoverProgram[]
  pis: ScoredDiscoverPi[]
  selectedProgram: ScoredDiscoverProgram | null
  selectedPi: ScoredDiscoverPi | null
  comparePrograms: ScoredDiscoverProgram[]
  compareIds: string[]
  scoreByProgramId: Record<string, number>
  filters: WorkspaceFilters
  activeFilterCount: number
  filterRailCollapsed: boolean
  mobileFiltersOpen: boolean
  mobileInspectorOpen: boolean
  inspectorOpen: boolean
  programSort: DiscoverProgramSort
  sortDirection: DiscoverSortDirection
  rankerDraft: DiscoverRankerWeights
  programNoteDrafts: Record<string, string>
  piNoteDrafts: Record<string, string>
  importingId: string | null
  deletingProgramIds: string[]
  researching: boolean
  saving: boolean
  hiddenProgramCount: number
  hiddenPiCount: number
  teamContext?: {
    id: string
    name: string
    email?: string
    avatarUrl?: string | null
    count?: number
    onBack: () => void
  }
  actions: WorkspaceActions
}

const RANKER_FIELDS: Array<{ key: keyof DiscoverRankerWeights; label: string }> = [
  { key: 'fit', label: 'discover.weightFit' },
  { key: 'stipend', label: 'discover.weightStipend' },
  { key: 'advisorDensity', label: 'discover.weightPi' },
  { key: 'topics', label: 'discover.weightTopics' },
  { key: 'city', label: 'discover.weightCity' },
]

const DISCOVER_BATCH_SIZE = 12
const DISCOVER_HIDE_MOTION_MS = 320
const DISCOVER_FILTER_WIDTH_MIN = 196
const DISCOVER_FILTER_WIDTH_MAX = 360

const DISCOVER_INSPECTOR_WIDTH_MIN = 280
const DISCOVER_INSPECTOR_WIDTH_MAX = 480
const DISCOVER_PANE_COLLAPSE_DISTANCE = 52
const DISCOVER_PANE_DRAG_START_DISTANCE = 3
const DISCOVER_LAYOUT_KEY = 'phd-atlas-discover-layout:v1'

type DiscoverLayoutPrefs = {
  filterWidth: number
  inspectorWidth: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function useCompactDiscoverViewport() {
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

export function useProgressiveList<T>(items: T[], resetKey: string, batchSize = DISCOVER_BATCH_SIZE) {
  const [progress, setProgress] = useState(() => ({ resetKey, batchSize, visibleCount: batchSize }))
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Derive the reset during render so a changed query/filter can never paint
  // the old, potentially very large visible count before an effect catches up.
  const visibleCount = progress.resetKey === resetKey && progress.batchSize === batchSize
    ? progress.visibleCount
    : batchSize
  const hasMore = visibleCount < items.length

  const loadMore = useCallback(() => {
    setProgress((current) => {
      const currentCount = current.resetKey === resetKey && current.batchSize === batchSize
        ? current.visibleCount
        : batchSize
      const nextCount = Math.min(items.length, currentCount + batchSize)
      if (current.resetKey === resetKey && current.batchSize === batchSize && current.visibleCount === nextCount) return current
      return { resetKey, batchSize, visibleCount: nextCount }
    })
  }, [batchSize, items.length, resetKey])

  useEffect(() => {
    if (!hasMore) return
    if (typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      loadMore()
    }, { rootMargin: '240px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [batchSize, hasMore, loadMore, resetKey])

  return {
    visibleItems: items.slice(0, visibleCount),
    hasMore,
    remainingCount: Math.max(0, items.length - visibleCount),
    loadMore,
    sentinelRef,
  }
}

function useSmoothHiddenToggle(onToggle: (id: string) => void, onHideMany?: (ids: string[]) => void) {
  const [hidingIds, setHidingIds] = useState<string[]>([])
  const timersRef = useRef<number[]>([])

  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), [])

  const requestToggle = useCallback((id: string, hidden: boolean) => {
    if (hidingIds.includes(id)) return
    if (hidden) {
      onToggle(id)
      return
    }
    setHidingIds((current) => [...current, id])
    timersRef.current.push(window.setTimeout(() => {
      onToggle(id)
      timersRef.current.push(window.setTimeout(() => {
        setHidingIds((current) => current.filter((item) => item !== id))
      }, 1200))
    }, DISCOVER_HIDE_MOTION_MS))
  }, [hidingIds, onToggle])

  const requestHideMany = useCallback((ids: string[]) => {
    const nextIds = ids.filter((id) => !hidingIds.includes(id))
    if (!nextIds.length) return
    setHidingIds((current) => [...new Set([...current, ...nextIds])])
    timersRef.current.push(window.setTimeout(() => {
      if (onHideMany) onHideMany(nextIds)
      else nextIds.forEach(onToggle)
      timersRef.current.push(window.setTimeout(() => {
        setHidingIds((current) => current.filter((item) => !nextIds.includes(item)))
      }, 1200))
    }, DISCOVER_HIDE_MOTION_MS))
  }, [hidingIds, onHideMany, onToggle])

  return { hidingIds, requestToggle, requestHideMany }
}

function useSmoothListReflow<T extends HTMLElement>(layoutKey: string) {
  const containerRef = useRef<T>(null)
  const positionsRef = useRef<Map<string, number>>(new Map())
  const keysRef = useRef<string[]>([])
  const animationsRef = useRef<Map<string, Animation>>(new Map())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (container.offsetParent === null) {
      positionsRef.current = new Map()
      keysRef.current = []
      return
    }

    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rows = Array.from(container.children).filter((child): child is HTMLElement => (
      child instanceof HTMLElement && Boolean(child.dataset.discoverReflowKey)
    ))
    const visibleRows = rows.flatMap((row) => {
      const key = row.dataset.discoverReflowKey
      if (!key || row.offsetHeight <= 0) return []
      return [{ row, key }]
    })
    const nextPositions = new Map<string, number>()
    const nextKeys = visibleRows.map(({ key }) => key)
    const layoutChanged = keysRef.current.length > 0 && (
      keysRef.current.length !== nextKeys.length
      || keysRef.current.some((key, index) => key !== nextKeys[index])
    )

    // Complete the read phase before starting any Web Animations. This keeps a
    // large result reflow to one layout calculation instead of alternating
    // geometry reads with compositor writes for every row.
    const measurements = visibleRows.map(({ row, key }) => {
      const nextTop = row.offsetTop
      nextPositions.set(key, nextTop)

      const previousTop = positionsRef.current.get(key)
      const offsetY = previousTop == null ? 0 : previousTop - nextTop
      return { row, key, offsetY }
    })

    measurements.forEach(({ row, key, offsetY }) => {
      if (!layoutChanged || reduceMotion || Math.abs(offsetY) < 0.5 || typeof row.animate !== 'function') return

      animationsRef.current.get(key)?.cancel()
      row.style.willChange = 'transform'
      const animation = row.animate(
        [
          { transform: `translate3d(0, ${offsetY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
      animationsRef.current.set(key, animation)
      const finish = () => {
        if (animationsRef.current.get(key) !== animation) return
        animationsRef.current.delete(key)
        row.style.removeProperty('will-change')
      }
      animation.onfinish = finish
      animation.oncancel = finish
    })

    positionsRef.current = nextPositions
    keysRef.current = nextKeys
  }, [layoutKey])

  useEffect(() => () => {
    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current.clear()
  }, [])

  return containerRef
}

type AnimatedListPhase = 'stable' | 'entering' | 'exiting'

type AnimatedListEntry<T> = {
  item: T
  phase: AnimatedListPhase
}

function useAnimatedListPresence<T extends { id: string }>(items: T[], skipExitIds: string[] = []) {
  const [entries, setEntries] = useState<AnimatedListEntry<T>[]>(() => items.map((item) => ({ item, phase: 'stable' })))
  const entriesRef = useRef(entries)
  const latestItemsRef = useRef(items)
  const latestSkipExitIdsRef = useRef(skipExitIds)
  const timersRef = useRef<number[]>([])
  const skipExitKey = [...skipExitIds].sort().join('\u001f')
  const itemIdOrderKey = items.map((item) => item.id).join('\u001f')
  const itemIdMembershipKey = [...items].map((item) => item.id).sort().join('\u001f')
  entriesRef.current = entries
  latestItemsRef.current = items
  latestSkipExitIdsRef.current = skipExitIds

  useEffect(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []

    const nextItems = latestItemsRef.current
    const currentEntries = entriesRef.current
    const incomingIds = new Set(nextItems.map((item) => item.id))
    const sameMembership = currentEntries.length === nextItems.length
      && currentEntries.every((entry) => incomingIds.has(entry.item.id) && entry.phase !== 'exiting')

    // A pure sort is already derivable from the current props. Mirror that
    // order into the presence state after paint, but do not schedule the
    // enter/exit timers that are reserved for real membership changes.
    if (sameMembership) {
      const currentById = new Map(currentEntries.map((entry) => [entry.item.id, entry]))
      const orderChanged = currentEntries.some((entry, index) => entry.item.id !== nextItems[index]?.id)
      if (orderChanged) {
        setEntries(nextItems.map((item) => {
          const existing = currentById.get(item.id)
          return { item, phase: existing?.phase === 'entering' ? 'entering' : 'stable' }
        }))
      }
      return undefined
    }

    const skippedIds = new Set(latestSkipExitIdsRef.current)
    setEntries((current) => {
      const currentById = new Map(current.map((entry) => [entry.item.id, entry]))
      const next: AnimatedListEntry<T>[] = nextItems.map((item) => {
        const existing = currentById.get(item.id)
        return {
          item,
          phase: existing?.phase === 'entering' ? 'entering' : existing ? 'stable' : 'entering',
        }
      })

      current.forEach((entry, currentIndex) => {
        if (incomingIds.has(entry.item.id) || skippedIds.has(entry.item.id)) return
        const exitingEntry: AnimatedListEntry<T> = { item: entry.item, phase: 'exiting' }
        const nextAnchor = current.slice(currentIndex + 1).find((candidate) => incomingIds.has(candidate.item.id))
        const anchorIndex = nextAnchor ? next.findIndex((candidate) => candidate.item.id === nextAnchor.item.id) : -1
        if (anchorIndex >= 0) next.splice(anchorIndex, 0, exitingEntry)
        else next.push(exitingEntry)
      })

      return next
    })

    timersRef.current.push(window.setTimeout(() => {
      const latestIds = new Set(latestItemsRef.current.map((item) => item.id))
      setEntries((current) => current.filter((entry) => entry.phase !== 'exiting' || latestIds.has(entry.item.id)))
    }, DISCOVER_HIDE_MOTION_MS))
    timersRef.current.push(window.setTimeout(() => {
      setEntries((current) => current.map((entry) => entry.phase === 'entering' ? { ...entry, phase: 'stable' } : entry))
    }, 420))

    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      timersRef.current = []
    }
  }, [itemIdMembershipKey, itemIdOrderKey, skipExitKey])

  const incomingById = new Map(items.map((item) => [item.id, item]))
  const incomingIds = new Set(incomingById.keys())
  const canRenderIncomingOrder = entries.length === items.length
    && entries.every((entry) => incomingIds.has(entry.item.id) && entry.phase !== 'exiting')
  const phaseById = new Map(entries.map((entry) => [entry.item.id, entry.phase]))
  const renderedEntries = canRenderIncomingOrder
    ? items.map((item) => ({ item, phase: phaseById.get(item.id) ?? 'stable' }))
    : entries.map((entry) => ({
        ...entry,
        item: incomingById.get(entry.item.id) ?? entry.item,
      }))

  return {
    items: renderedEntries.map((entry) => entry.item),
    enteringIds: renderedEntries.filter((entry) => entry.phase === 'entering').map((entry) => entry.item.id),
    exitingIds: renderedEntries.filter((entry) => entry.phase === 'exiting').map((entry) => entry.item.id),
  }
}

function loadDiscoverLayout(): DiscoverLayoutPrefs {
  const fallback = { filterWidth: 230, inspectorWidth: 360 }
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISCOVER_LAYOUT_KEY) || '{}') as Partial<DiscoverLayoutPrefs>
    return {
      filterWidth: clamp(Number(parsed.filterWidth) || fallback.filterWidth, DISCOVER_FILTER_WIDTH_MIN, DISCOVER_FILTER_WIDTH_MAX),
      inspectorWidth: clamp(Number(parsed.inspectorWidth) || fallback.inspectorWidth, DISCOVER_INSPECTOR_WIDTH_MIN, DISCOVER_INSPECTOR_WIDTH_MAX),
    }
  } catch {
    return fallback
  }
}

const MATCH_LEVELS = [0, 50, 60, 70, 80, 90] as const
const RANKER_LEVELS = [0, 10, 15, 20, 30, 40] as const
const H_INDEX_LEVELS = [0, 10, 20, 30, 40, 50] as const

function currency(value: number | null | undefined, code: string, lang: string) {
  if (value == null || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `$${Math.round(value).toLocaleString()}`
  }
}

function dateLabel(value: string | null | undefined, lang: string) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function dateTimeLabel(value: string | null | undefined, lang: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(lang, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function programDeadline(program: ScoredDiscoverProgram) {
  return primaryDeadline(program.requirements)?.date || program.deadlineIso || null
}

function compactUrl(value: string) {
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function isRecruiting(value: string) {
  return /yes|recruit|accept|open|招|招生/i.test(value || '')
}

const REGION_I18N_KEYS: Record<string, string> = {
  US: 'discover.regionUS',
  UK: 'discover.regionUK',
  EU: 'discover.regionEU',
  CA: 'discover.regionCA',
  SG: 'discover.regionSG',
  HK: 'discover.regionHK',
  CN: 'discover.regionCN',
  AU: 'discover.regionAU',
  OTHER: 'discover.regionOther',
  'United States': 'discover.regionUS',
  'United Kingdom': 'discover.regionUK',
  Europe: 'discover.regionEU',
  Canada: 'discover.regionCA',
  Singapore: 'discover.regionSG',
  'Hong Kong': 'discover.regionHK',
  China: 'discover.regionCN',
  Australia: 'discover.regionAU',
  'Global / other regions': 'discover.regionOther',
}

function localizedRegion(value: string, fallback: string, tx: (key: string, fallback?: string) => string) {
  const key = REGION_I18N_KEYS[value]
  return key ? tx(key, fallback) : fallback
}

const PI_CATEGORY_DESCRIPTION_KEYS: Record<ScoredDiscoverPi['category'], string> = {
  rising_star: 'discover.catRisingDescription',
  direction_fit: 'discover.catFitDescription',
  interesting: 'discover.catInterestingDescription',
  famous_but_fits: 'discover.catFamousDescription',
}

function piCategoryDescription(
  category: ScoredDiscoverPi['category'],
  lang: string,
  tx: (key: string, fallback?: string) => string,
) {
  return tx(PI_CATEGORY_DESCRIPTION_KEYS[category], piCategoryLabel(category, lang))
}

function FilterRail({
  meta,
  mode,
  filters,
  activeFilterCount,
  hiddenProgramCount,
  hiddenPiCount,
  rankerDraft,
  mobile,
  collapsed = false,
  onClose,
  actions,
}: {
  meta: DiscoverCatalogMeta | null
  mode: DiscoverWorkspaceMode
  filters: WorkspaceFilters
  activeFilterCount: number
  hiddenProgramCount: number
  hiddenPiCount: number
  rankerDraft: DiscoverRankerWeights
  mobile?: boolean
  collapsed?: boolean
  onClose?: () => void
  actions: WorkspaceActions
}) {
  const { tx } = useI18n()
  const isPi = mode === 'pis'
  return (
    <aside
      className={clsx('discover-filter-rail', mobile && 'is-mobile')}
      aria-label={tx('discover.filtersTitle', 'Filters')}
      aria-hidden={!mobile && collapsed}
      inert={!mobile && collapsed}
    >
      <header className="discover-filter-header">
        <div className="discover-filter-header-title">
          <strong>{tx('discover.filtersTitle', 'Filters')}</strong>
          <InlinePresence present={activeFilterCount > 0} parentGap="6px">
            <span className="discover-count-badge">{activeFilterCount}</span>
          </InlinePresence>
        </div>
        <div className="discover-filter-header-actions">
          <InlinePresence present={activeFilterCount > 0} parentGap="4px" durationMs={280}>
            <button type="button" className="discover-filter-header-clear" onClick={actions.clearFilters}>
              <X size={12} aria-hidden="true" />
              <span>{tx('discover.clearFilters', 'Clear filters')}</span>
            </button>
          </InlinePresence>
          {mobile ? (
            <button type="button" className="discover-icon-btn" onClick={onClose} aria-label={tx('discover.close', 'Close')}>
              <X size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="discover-icon-btn discover-filter-collapse-button"
              onClick={actions.toggleFilterRail}
              aria-label={tx('discover.collapse', 'Collapse')}
              title={tx('discover.collapse', 'Collapse')}
            >
              <ChevronLeft size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="discover-filter-scroll">
        <SmoothDisclosure
          className="discover-filter-group"
          defaultOpen
          summary={tx('discover.region', 'Region')}
          indicator={<ChevronDown size={14} />}
          bodyClassName="discover-filter-options discover-multiselect-list is-rail"
        >
          {(meta?.regions || []).map((region: DiscoverRegion) => (
            <DiscoverMultiSelectOption
              key={region.key}
              compact
              checked={filters.regionFilters.includes(region.key)}
              onChange={() => actions.toggleRegion(region.key)}
              label={localizedRegion(region.key, region.label, tx)}
            />
          ))}
        </SmoothDisclosure>

        {!isPi ? (
          <>
            <SmoothDisclosure
              className="discover-filter-group"
              defaultOpen
              summary={tx('discover.matchAndFunding', 'Match and funding')}
              indicator={<ChevronDown size={14} />}
              bodyClassName="discover-filter-fields"
            >
                <DiscreteLevelPicker
                  label={tx('discover.minMatch', 'Minimum match')}
                  value={filters.minMatch}
                  options={MATCH_LEVELS}
                  suffix="%"
                  onChange={actions.setMinMatch}
                />
                <label>
                  <span>{tx('discover.minStipendShort', 'Minimum annual funding')}</span>
                  <input type="number" min={0} step={1000} value={filters.minStipend || ''} placeholder="0" onChange={(e) => actions.setMinStipend(Number(e.target.value) || 0)} />
                </label>
                <DiscoverMultiSelectOption compact checked={filters.meetFloorOnly} onChange={actions.setMeetFloorOnly} label={tx('discover.meetsFundingFloor', 'Meets my funding floor')} />
                <DiscoverMultiSelectOption compact checked={filters.watchedOnly} onChange={actions.setWatchedOnly} label={tx('discover.watchedOnly', 'Watched only')} />
            </SmoothDisclosure>

            <SmoothDisclosure
              className="discover-filter-group"
              summary={tx('discover.applicationRules', 'Application rules')}
              indicator={<ChevronDown size={14} />}
              bodyClassName="discover-filter-options"
            >
                <DiscoverMultiSelectOption compact checked={filters.requirements.greNotRequired} onChange={() => actions.toggleRequirement('greNotRequired')} label={tx('discover.filterGre', 'GRE not required')} />
                <DiscoverMultiSelectOption compact checked={filters.requirements.feeWaiver} onChange={() => actions.toggleRequirement('feeWaiver')} label={tx('discover.filterWaiver', 'Fee waiver available')} />
                <DiscoverMultiSelectOption compact checked={filters.requirements.multiApplyOnly} onChange={() => actions.toggleRequirement('multiApplyOnly')} label={tx('discover.filterMulti', 'Multiple programs allowed')} />
                <DiscoverMultiSelectOption compact checked={filters.requirements.intlFriendly} onChange={() => actions.toggleRequirement('intlFriendly')} label={tx('discover.filterIntl', 'International students eligible')} />
            </SmoothDisclosure>

            <SmoothDisclosure
              className="discover-filter-group"
              summary={tx('discover.rankingPreferences', 'Ranking preferences')}
              indicator={<ChevronDown size={14} />}
              bodyClassName="discover-filter-fields discover-ranker-fields"
            >
                {RANKER_FIELDS.map((field) => (
                  <DiscreteLevelPicker
                    key={field.key}
                    label={tx(field.label)}
                    value={rankerDraft[field.key]}
                    options={RANKER_LEVELS}
                    onChange={(value) => actions.setRankerWeight(field.key, value)}
                  />
                ))}
                <button type="button" className="discover-inline-action" disabled={false} onClick={actions.saveRanker}>
                  {tx('discover.saveRanking', 'Save ranking')}
                </button>
            </SmoothDisclosure>
          </>
        ) : (
          <SmoothDisclosure
            className="discover-filter-group"
            defaultOpen
            summary={tx('discover.advisorFilters', 'Advisor filters')}
            indicator={<ChevronDown size={14} />}
            bodyClassName="discover-filter-fields"
          >
              <label>
                <span>{tx('discover.piCategory', 'Advisor type')}</span>
                <Select
                  value={filters.piCategory}
                  size="small"
                  ariaLabel={tx('discover.piCategory', 'Advisor type')}
                  options={[
                    { value: 'all', label: tx('discover.allCategories', 'All types') },
                    { value: 'rising_star', label: tx('discover.catRising') },
                    { value: 'direction_fit', label: tx('discover.catFit') },
                    { value: 'interesting', label: tx('discover.catInteresting') },
                    { value: 'famous_but_fits', label: tx('discover.catFamous') },
                  ]}
                  onChange={actions.setPiCategory}
                />
              </label>
              <DiscreteLevelPicker
                label={tx('discover.minHIndex', 'Minimum h-index')}
                value={filters.minHIndex}
                options={H_INDEX_LEVELS}
                onChange={actions.setMinHIndex}
              />
          </SmoothDisclosure>
        )}

        <SmoothDisclosure
          className="discover-filter-group"
          summary={tx('discover.hiddenItems', 'Hidden items')}
          indicator={<ChevronDown size={14} />}
          bodyClassName="discover-filter-options"
        >
          <DiscoverMultiSelectOption compact checked={filters.showHidden} onChange={actions.setShowHidden} label={tx('discover.showHiddenCount', 'Show hidden ({count})').replace('{count}', String(isPi ? hiddenPiCount : hiddenProgramCount))} />
        </SmoothDisclosure>
      </div>
    </aside>
  )
}

function DiscoverSortHeader<T extends string>({
  column,
  api,
  activeSort,
  direction,
  sort,
  onSort,
  children,
  info,
}: {
  column: TableColumnDef
  api: TableColumnsApi
  activeSort: T
  direction: DiscoverSortDirection
  sort: T
  onSort: (sort: T) => void
  children: ReactNode
  info?: { content: string; label: string }
}) {
  const active = activeSort === sort
  return (
    <TableHeaderCell column={column} api={api} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <div className="discover-table-heading">
        <button type="button" className={clsx('discover-table-sort', active && 'is-active')} onClick={() => onSort(sort)}>
          <span>{children}</span>
          <span
            className={clsx('discover-table-sort-icon', active && 'is-visible', direction === 'desc' && 'is-descending')}
            aria-hidden="true"
          >
            <ArrowUp size={12} />
          </span>
        </button>
        {info ? <InfoTooltip className="discover-hindex-tooltip" content={info.content} label={info.label} /> : null}
      </div>
    </TableHeaderCell>
  )
}

function ProgramList({
  programs,
  hasVerifiedCatalog,
  selectedProgram,
  compareIds,
  scoreByProgramId,
  currencyCode,
  importingId,
  deletingProgramIds,
  programSort,
  sortDirection,
  resetKey,
  compactViewport,
  actions,
}: {
  programs: ScoredDiscoverProgram[]
  hasVerifiedCatalog: boolean
  selectedProgram: ScoredDiscoverProgram | null
  compareIds: string[]
  scoreByProgramId: Record<string, number>
  currencyCode: string
  importingId: string | null
  deletingProgramIds: string[]
  programSort: DiscoverProgramSort
  sortDirection: DiscoverSortDirection
  resetKey: string
  compactViewport: boolean
  actions: WorkspaceActions
}) {
  const { tx, lang } = useI18n()
  const [selectionContextMenu, setSelectionContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const columns = useMemo<TableColumnDef[]>(() => [
    { id: 'select', label: tx('discover.selectAllPrograms', 'Select all visible programs'), defaultWidth: 38, minWidth: 38, maxWidth: 38, hideable: false, resizable: false },
    { id: 'program', label: tx('discover.program', 'Program'), defaultWidth: 248, minWidth: 176, hideable: false },
    { id: 'location', label: tx('discover.location', 'Location'), defaultWidth: 148, minWidth: 104 },
    { id: 'match', label: tx('discover.match', 'Match'), defaultWidth: 82, minWidth: 68 },
    { id: 'funding', label: tx('discover.annualFunding', 'Annual funding'), defaultWidth: 148, minWidth: 110 },
    { id: 'deadline', label: tx('discover.applicationDeadline', 'Deadline'), defaultWidth: 134, minWidth: 104 },
    { id: 'advisors', label: tx('discover.advisors', 'Advisors'), defaultWidth: 82, minWidth: 64 },
    { id: 'actions', label: tx('table.actions', 'Actions'), defaultWidth: 224, minWidth: 200, maxWidth: 240, hideable: false, resizable: false },
  ], [tx])
  const { api, openMenu, menuNode } = useTableColumnMenu('discover-programs', columns)
  const hiddenMotion = useSmoothHiddenToggle(actions.toggleProgramHidden, actions.hidePrograms)
  const filterMotion = useAnimatedListPresence(programs, hiddenMotion.hidingIds)
  const itemIdentityKey = programs.map((program) => program.id).join('\u001f')
  const { visibleItems: visiblePrograms, hasMore, remainingCount, loadMore, sentinelRef } = useProgressiveList(
    filterMotion.items,
    `${resetKey}\u001e${programSort}\u001e${sortDirection}\u001e${itemIdentityKey}`,
  )
  const selectableProgramIds = useMemo(() => programs.map((program) => program.id), [programs])
  const selection = useExplorerSelection(selectableProgramIds)
  const visibleProgramOrderKey = visiblePrograms.map((program) => program.id).join('\u001f')
  const mobileResultsRef = useSmoothListReflow<HTMLDivElement>(visibleProgramOrderKey)
  const tableBodyRef = useSmoothListReflow<HTMLTableSectionElement>(visibleProgramOrderKey)
  const tableWidth = api.visibleColumns.reduce((sum, column) => sum + api.widthOf(column.id), 0)
  const allProgramsSelected = programs.length > 0 && selection.selectedCount === programs.length
  const someProgramsSelected = selection.selectedCount > 0 && !allProgramsSelected
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someProgramsSelected
  }, [someProgramsSelected])
  const sortBy = useCallback((next: DiscoverProgramSort) => {
    if (programSort === next) {
      actions.toggleSortDirection()
      return
    }
    actions.setProgramSort(next)
    const desired: DiscoverSortDirection = next === 'program' || next === 'location' || next === 'deadline' ? 'asc' : 'desc'
    if (sortDirection !== desired) actions.toggleSortDirection()
  }, [actions, programSort, sortDirection])
  const applyRowSelection = useCallback((programId: string, event: ReactMouseEvent<HTMLElement>) => {
    if (!hasExplorerSelectionModifier(event)) {
      actions.selectProgram(programId)
      return
    }
    event.preventDefault()
    selection.applyGesture(programId, event)
  }, [actions, selection])
  const toggleProgramSelection = useCallback((programId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation()
    if (event.shiftKey) selection.selectRange(programId, event.ctrlKey || event.metaKey)
    else selection.toggle(programId)
  }, [selection])
  const selectedPrograms = useMemo(
    () => programs.filter((program) => selection.selectedIds.has(program.id)),
    [programs, selection.selectedIds],
  )
  const addSelectedToCompare = useCallback(() => {
    actions.addProgramsToCompare(selection.selectedIdList)
  }, [actions, selection.selectedIdList])
  const watchSelected = useCallback(() => {
    actions.watchPrograms(selectedPrograms.filter((program) => !program.watched).map((program) => program.id))
  }, [actions, selectedPrograms])
  const hideSelected = useCallback(() => {
    hiddenMotion.requestHideMany(selectedPrograms.filter((program) => !program.hidden).map((program) => program.id))
  }, [hiddenMotion, selectedPrograms])
  const openSelectionMenu = useCallback((program: ScoredDiscoverProgram, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const ids = selection.selectedIds.has(program.id) ? selection.selectedIdList : [program.id]
    const targets = programs.filter((item) => ids.includes(item.id))
    selection.ensureSelectedForContext(program.id)
    setSelectionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: ids.length === 1
        ? program.school
        : tx('discover.selectedProgramsCount', '{count} programs selected').replace('{count}', String(ids.length)),
      subtitle: tx('discover.bulkSelectionHint', 'Use Shift for a range and Ctrl/⌘ for multiple items'),
      items: [
        {
          id: 'compare',
          label: tx('discover.addToCompare', 'Add to compare'),
          icon: <Plus size={14} />,
          shortcut: 'C',
          accessKey: 'c',
          onSelect: () => actions.addProgramsToCompare(ids),
        },
        {
          id: 'watch',
          label: tx('discover.watch', 'Favorite'),
          icon: <Bookmark size={14} />,
          shortcut: 'F',
          accessKey: 'f',
          disabled: targets.every((item) => item.watched),
          onSelect: () => actions.watchPrograms(targets.filter((item) => !item.watched).map((item) => item.id)),
        },
        {
          id: 'hide',
          label: tx('discover.hide', 'Hide'),
          icon: <EyeOff size={14} />,
          shortcut: 'H',
          accessKey: 'h',
          disabled: targets.every((item) => item.hidden),
          onSelect: () => hiddenMotion.requestHideMany(targets.filter((item) => !item.hidden).map((item) => item.id)),
        },
        {
          id: 'delete',
          label: ids.length === 1 ? tx('discover.deleteProgram', 'Delete program') : tx('discover.deleteSelected', 'Delete selected'),
          icon: <Trash2 size={14} />,
          tone: 'danger',
          shortcut: 'Delete',
          accessKey: 'delete',
          disabled: ids.some((id) => deletingProgramIds.includes(id)),
          onSelect: () => actions.requestDeletePrograms(ids),
        },
        {
          id: 'clear',
          label: tx('discover.clearSelection', 'Clear selection'),
          icon: <X size={14} />,
          onSelect: selection.clearSelection,
        },
      ],
    })
  }, [actions, deletingProgramIds, hiddenMotion, programs, selection, tx])

  useEffect(() => {
    if (selection.selectedCount === 0 || selectionContextMenu) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase())
      )) return
      const key = event.key.toLowerCase()
      if (key === 'escape') {
        event.preventDefault()
        selection.clearSelection()
      } else if (key === 'c') {
        event.preventDefault()
        addSelectedToCompare()
      } else if (key === 'f') {
        event.preventDefault()
        watchSelected()
      } else if (key === 'h') {
        event.preventDefault()
        hideSelected()
      } else if ((key === 'delete' || key === 'backspace') && !selection.selectedIdList.some((id) => deletingProgramIds.includes(id))) {
        event.preventDefault()
        actions.requestDeletePrograms(selection.selectedIdList)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [actions, addSelectedToCompare, deletingProgramIds, hideSelected, selection, selectionContextMenu, watchSelected])
  const column = (id: string) => columns.find((item) => item.id === id) as TableColumnDef
  return (
    <section className="discover-list-pane" aria-label={tx('discover.programsList', 'Programs')}>
      <div className="discover-list-count">
        <span>{tx('discover.foundPrograms', 'Found {count} programs').replace('{count}', String(programs.length))}</span>
        <ExplorerSelectionBar
          visible={selection.selectedCount > 0}
          label={tx('discover.selectedProgramsCount', '{count} programs selected').replace('{count}', String(selection.selectedCount))}
          clearLabel={tx('discover.clearSelection', 'Clear selection')}
          actions={[
            {
              id: 'compare',
              label: tx('discover.addToCompare', 'Add to compare'),
              icon: <Plus size={13} />,
              onClick: addSelectedToCompare,
            },
            {
              id: 'watch',
              label: tx('discover.watch', 'Favorite'),
              icon: <Bookmark size={13} />,
              disabled: selectedPrograms.every((program) => program.watched),
              onClick: watchSelected,
            },
            {
              id: 'hide',
              label: tx('discover.hide', 'Hide'),
              icon: <EyeOff size={13} />,
              disabled: selectedPrograms.every((program) => program.hidden),
              onClick: hideSelected,
            },
            {
              id: 'delete',
              label: tx('discover.deleteSelected', 'Delete selected'),
              icon: <Trash2 size={13} />,
              tone: 'danger',
              disabled: selection.selectedIdList.some((id) => deletingProgramIds.includes(id)),
              onClick: () => actions.requestDeletePrograms(selection.selectedIdList),
            },
          ]}
          onClear={selection.clearSelection}
        />
        <button type="button" className="discover-column-button" onClick={(event) => openMenu(event, tx('table.columns', 'Columns'))} aria-label={tx('table.columns', 'Columns')} title={tx('table.columnsHint', 'Resize columns or right-click to show and hide them.')}><Columns3 size={14} /></button>
      </div>
      <div className="discover-mobile-list-tools">
        <Select
          value={programSort}
          size="small"
          ariaLabel={tx('discover.sortBy', 'Sort by')}
          options={[
            { value: 'match', label: tx('discover.match', 'Match') },
            { value: 'program', label: tx('discover.program', 'Program') },
            { value: 'location', label: tx('discover.location', 'Location') },
            { value: 'funding', label: tx('discover.annualFunding', 'Annual funding') },
            { value: 'deadline', label: tx('discover.applicationDeadline', 'Deadline') },
            { value: 'advisors', label: tx('discover.advisors', 'Advisors') },
            { value: 'collectedAt', label: tx('discover.collectedAt', 'Fetched at') },
          ]}
          onChange={(value) => sortBy(value as DiscoverProgramSort)}
        />
        <button type="button" className="discover-mobile-sort-direction" onClick={actions.toggleSortDirection} aria-label={tx('discover.sortBy', 'Sort by')}>
          {sortDirection === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
        </button>
      </div>
      <div className="discover-program-table atlas-table-shell">
        {filterMotion.items.length ? (
          <>
          {compactViewport ? (
          <div ref={mobileResultsRef} className="discover-mobile-results">
            {visiblePrograms.map((program, index) => {
              const selected = selectedProgram?.id === program.id
              const bulkSelected = selection.selectedIds.has(program.id)
              const compared = compareIds.includes(program.id)
              const score = scoreByProgramId[program.id] ?? program.matchScore
              const deadline = programDeadline(program)
              const collectedAt = program.collectedAt || program.verification?.checkedAt
              const deleting = deletingProgramIds.includes(program.id)
              return (
                <article
                  key={program.id}
                  data-discover-reflow-key={program.id}
                  className={clsx('discover-mobile-result', selected && 'is-selected', bulkSelected && 'is-bulk-selected', program.hidden && 'is-hidden', hiddenMotion.hidingIds.includes(program.id) && 'is-hiding', filterMotion.enteringIds.includes(program.id) && 'is-filter-entering', filterMotion.exitingIds.includes(program.id) && 'is-filter-exiting', importingId === program.id && 'is-importing', deleting && 'is-deleting')}
                  style={{ '--discover-row-enter-index': Math.min(index, 8) } as CSSProperties}
                  aria-busy={deleting}
                  onContextMenu={(event) => openSelectionMenu(program, event)}
                >
                  <div className="discover-mobile-card-actions" onClick={(event) => event.stopPropagation()}>
                    <FavoriteBookmarkButton
                      className="discover-mobile-card-action"
                      active={Boolean(program.watched)}
                      disabled={deleting}
                      label={program.watched ? tx('discover.unwatch') : tx('discover.watch')}
                      iconSize={16}
                      onToggle={() => actions.toggleWatch(program.id)}
                    />
                    <button type="button" className="discover-mobile-card-action" disabled={deleting || hiddenMotion.hidingIds.includes(program.id)} onClick={() => hiddenMotion.requestToggle(program.id, Boolean(program.hidden))} aria-label={program.hidden ? tx('discover.restore') : tx('discover.hide')}>
                      {program.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  </div>
                  <button type="button" className="discover-mobile-result-main" disabled={deleting} onClick={(event) => applyRowSelection(program.id, event)}>
                    <span className="discover-mobile-result-copy">
                      <strong>{program.school}</strong>
                      <span>{program.program}</span>
                      <small>{program.city} · {localizedRegion(program.country, program.country, tx)}</small>
                      {collectedAt ? <small className="discover-program-collected"><Clock3 size={11} aria-hidden="true" />{dateTimeLabel(collectedAt, lang)}</small> : null}
                    </span>
                    <span className="discover-mobile-result-score"><strong>{Math.round(score)}%</strong><small>{tx('discover.match', 'Match')}</small></span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                  <dl className="discover-mobile-result-facts">
                    <div><dt>{tx('discover.annualFunding', 'Annual funding')}</dt><dd>{currency(program.stipendUSD, currencyCode, lang)}</dd></div>
                    <div><dt>{tx('discover.applicationDeadline', 'Deadline')}</dt><dd>{dateLabel(deadline, lang)}</dd></div>
                    <div><dt>{tx('discover.advisors', 'Advisors')}</dt><dd>{program.fittingPiCount ?? program.pis.length}</dd></div>
                  </dl>
                  <div className="discover-mobile-result-utilities" onClick={(event) => event.stopPropagation()}>
                    <label className="discover-selection-check" title={tx('discover.selectProgramResult', 'Select {school}').replace('{school}', program.school)}>
                      <input
                        className="discover-checkbox-input"
                        type="checkbox"
                        checked={bulkSelected}
                        readOnly
                        disabled={deleting}
                        onClick={(event) => toggleProgramSelection(program.id, event)}
                        aria-label={tx('discover.selectProgramResult', 'Select {school}').replace('{school}', program.school)}
                      />
                      <span className="discover-checkbox-visual" aria-hidden="true"><Check size={11} /></span>
                    </label>
                    <button type="button" className={clsx('discover-compare-action', compared && 'is-active')} disabled={deleting} onClick={() => actions.toggleCompare(program.id)} aria-pressed={compared} title={compared ? tx('discover.removeFromCompare', 'Remove from compare') : tx('discover.addToCompare', 'Add to compare')}>
                      {compared ? <X size={13} /> : <Plus size={13} />}
                      <span>{compared ? tx('discover.removeFromCompare', 'Remove from compare') : tx('discover.addToCompare', 'Add to compare')}</span>
                    </button>
                    <button type="button" className="discover-delete-program-action" disabled={deleting} onClick={() => actions.requestDeletePrograms([program.id])} aria-label={tx('discover.deleteProgram', 'Delete program')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          ) : (
          <table className="discover-data-table atlas-table" style={{ width: tableWidth, minWidth: '100%' }} onContextMenu={(event) => openMenu(event, tx('table.columns', 'Columns'))}>
            <TableColGroup columns={columns} api={api} />
            <thead className="discover-program-head">
              <tr>
                <TableHeaderCell column={column('select')} api={api}>
                  <label className="discover-selection-check">
                    <input
                      ref={selectAllRef}
                      className="discover-checkbox-input"
                      type="checkbox"
                      checked={allProgramsSelected}
                      readOnly
                      onClick={(event) => {
                        event.stopPropagation()
                        if (allProgramsSelected) selection.clearSelection()
                        else selection.setMany(selectableProgramIds)
                      }}
                      aria-label={tx('discover.selectAllPrograms', 'Select all visible programs')}
                    />
                    <span className="discover-checkbox-visual" aria-hidden="true"><Check size={11} /></span>
                  </label>
                </TableHeaderCell>
                <DiscoverSortHeader column={column('program')} api={api} activeSort={programSort} direction={sortDirection} sort="program" onSort={sortBy}>{tx('discover.program', 'Program')}</DiscoverSortHeader>
                <DiscoverSortHeader column={column('location')} api={api} activeSort={programSort} direction={sortDirection} sort="location" onSort={sortBy}>{tx('discover.location', 'Location')}</DiscoverSortHeader>
                <DiscoverSortHeader column={column('match')} api={api} activeSort={programSort} direction={sortDirection} sort="match" onSort={sortBy}>{tx('discover.match', 'Match')}</DiscoverSortHeader>
                <DiscoverSortHeader column={column('funding')} api={api} activeSort={programSort} direction={sortDirection} sort="funding" onSort={sortBy}>{tx('discover.annualFunding', 'Annual funding')}</DiscoverSortHeader>
                <DiscoverSortHeader column={column('deadline')} api={api} activeSort={programSort} direction={sortDirection} sort="deadline" onSort={sortBy}>{tx('discover.applicationDeadline', 'Deadline')}</DiscoverSortHeader>
                <DiscoverSortHeader column={column('advisors')} api={api} activeSort={programSort} direction={sortDirection} sort="advisors" onSort={sortBy}>{tx('discover.advisors', 'Advisors')}</DiscoverSortHeader>
                <TableHeaderCell column={column('actions')} api={api}><span aria-hidden="true" /></TableHeaderCell>
              </tr>
            </thead>
            <tbody ref={tableBodyRef}>
              {visiblePrograms.map((program, index) => {
                const selected = selectedProgram?.id === program.id
                const bulkSelected = selection.selectedIds.has(program.id)
                const compared = compareIds.includes(program.id)
                const score = scoreByProgramId[program.id] ?? program.matchScore
                const deadline = programDeadline(program)
                const collectedAt = program.collectedAt || program.verification?.checkedAt
                const deleting = deletingProgramIds.includes(program.id)
                return (
                  <tr
                    key={program.id}
                    data-discover-reflow-key={program.id}
                    className={clsx('discover-program-row', selected && 'is-selected', bulkSelected && 'is-bulk-selected', program.hidden && 'is-hidden', hiddenMotion.hidingIds.includes(program.id) && 'is-hiding', filterMotion.enteringIds.includes(program.id) && 'is-filter-entering', filterMotion.exitingIds.includes(program.id) && 'is-filter-exiting', importingId === program.id && 'is-importing', deleting && 'is-deleting')}
                    style={{ '--discover-row-enter-index': Math.min(index, 8) } as CSSProperties}
                    aria-busy={deleting}
                    onClick={(event) => applyRowSelection(program.id, event)}
                    onContextMenu={(event) => openSelectionMenu(program, event)}
                  >
                    <TableCell columnId="select" api={api} className="discover-select-cell">
                      <label className="discover-selection-check" title={tx('discover.selectProgramResult', 'Select {school}').replace('{school}', program.school)}>
                        <input
                          className="discover-checkbox-input"
                          type="checkbox"
                          checked={bulkSelected}
                          readOnly
                          disabled={deleting}
                          onClick={(event) => toggleProgramSelection(program.id, event)}
                          aria-label={tx('discover.selectProgramResult', 'Select {school}').replace('{school}', program.school)}
                        />
                        <span className="discover-checkbox-visual" aria-hidden="true"><Check size={11} /></span>
                      </label>
                    </TableCell>
                    <TableCell columnId="program" api={api}>
                      <button type="button" className="discover-program-identity" disabled={deleting} onClick={(event) => {
                        event.stopPropagation()
                        applyRowSelection(program.id, event)
                      }}>
                        <strong>{program.school}</strong>
                        <span>{program.program}</span>
                        {collectedAt ? <small className="discover-program-collected"><Clock3 size={11} aria-hidden="true" />{dateTimeLabel(collectedAt, lang)}</small> : null}
                      </button>
                    </TableCell>
                    <TableCell columnId="location" api={api}><span className="discover-program-location">{program.city}<small>{localizedRegion(program.country, program.country, tx)}</small></span></TableCell>
                    <TableCell columnId="match" api={api}><span className="discover-program-score">{Math.round(score)}%</span></TableCell>
                    <TableCell columnId="funding" api={api}><span className="discover-program-funding">{currency(program.stipendUSD, currencyCode, lang)}<small>{program.stipendFoundOfficial ? tx('discover.verifiedShort', 'Verified') : tx('discover.needsVerification', 'Needs verification')}</small></span></TableCell>
                    <TableCell columnId="deadline" api={api}><span className="discover-program-deadline">{dateLabel(deadline, lang)}</span></TableCell>
                    <TableCell columnId="advisors" api={api}><span className="discover-program-advisors">{program.fittingPiCount ?? program.pis.length}</span></TableCell>
                    <TableCell columnId="actions" api={api} className="discover-actions-cell">
                      <div className="discover-row-actions" onClick={(event) => event.stopPropagation()}>
                        <button type="button" className={clsx('discover-compare-action', compared && 'is-active')} disabled={deleting} onClick={() => actions.toggleCompare(program.id)} aria-pressed={compared} title={compared ? tx('discover.removeFromCompare', 'Remove from compare') : tx('discover.addToCompare', 'Add to compare')}>
                          {compared ? <X size={13} /> : <Plus size={13} />}
                          <span>{compared ? tx('discover.removeFromCompare', 'Remove from compare') : tx('discover.addToCompare', 'Add to compare')}</span>
                        </button>
                        <FavoriteBookmarkButton
                          className="discover-icon-btn"
                          active={Boolean(program.watched)}
                          disabled={deleting}
                          label={program.watched ? tx('discover.unwatch') : tx('discover.watch')}
                          iconSize={16}
                          onToggle={() => actions.toggleWatch(program.id)}
                        />
                        <button type="button" className="discover-icon-btn hover-reveal" disabled={deleting || hiddenMotion.hidingIds.includes(program.id)} onClick={() => hiddenMotion.requestToggle(program.id, Boolean(program.hidden))} aria-label={program.hidden ? tx('discover.restore') : tx('discover.hide')}>{program.hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                        <button type="button" className="discover-icon-btn discover-delete-program-action hover-reveal" disabled={deleting} onClick={() => actions.requestDeletePrograms([program.id])} aria-label={tx('discover.deleteProgram', 'Delete program')}><Trash2 size={15} /></button>
                        {importingId === program.id ? <span className="discover-table-loading-dot" aria-label={tx('discover.importing')} /> : null}
                      </div>
                    </TableCell>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}
          </>
        ) : hasVerifiedCatalog ? (
          <div className="discover-list-empty"><Search size={20} /><strong>{tx('discover.noFilterResults', 'No matching programs')}</strong><span>{tx('discover.adjustFilters', 'Try clearing one or more filters.')}</span></div>
        ) : (
          <div className="discover-list-empty">
            <Search size={20} />
            <strong>{tx('discover.noVerifiedPrograms', 'No verified programs yet')}</strong>
            <span>{tx('discover.noVerifiedProgramsHint', 'Run official-source research to build your program and advisor library.')}</span>
            <button type="button" className="primary-action discover-empty-research-button" disabled={importingId !== null} onClick={actions.openResearch}>{tx('discover.startResearch', 'Start research')}</button>
          </div>
        )}
        {menuNode}
        <ExplorerContextMenu menu={selectionContextMenu} onClose={() => setSelectionContextMenu(null)} />
        {hasMore ? (
          <div ref={sentinelRef} className="discover-lazy-sentinel">
            <button type="button" className="discover-load-more" onClick={loadMore}>
              {tx('discover.showMoreResults', 'Show {count} more').replace('{count}', String(Math.min(DISCOVER_BATCH_SIZE, remainingCount)))}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function PiList({
  pis,
  selectedPi,
  resetKey,
  actions,
}: {
  pis: ScoredDiscoverPi[]
  selectedPi: ScoredDiscoverPi | null
  resetKey: string
  actions: WorkspaceActions
}) {
  const { tx, lang } = useI18n()
  const [sort, setSort] = useState<DiscoverPiSort>('match')
  const [direction, setDirection] = useState<DiscoverSortDirection>('desc')
  const columns = useMemo<TableColumnDef[]>(() => [
    { id: 'advisor', label: tx('discover.advisor', 'Advisor'), defaultWidth: 210, minWidth: 150, hideable: false },
    { id: 'program', label: tx('discover.program', 'Program'), defaultWidth: 205, minWidth: 150 },
    { id: 'category', label: tx('discover.category', 'Type'), defaultWidth: 132, minWidth: 104 },
    { id: 'hIndex', label: tx('discover.hIndex'), defaultWidth: 88, minWidth: 76 },
    { id: 'match', label: tx('discover.match', 'Match'), defaultWidth: 82, minWidth: 68 },
    { id: 'actions', label: tx('table.actions', 'Actions'), defaultWidth: 48, minWidth: 48, maxWidth: 48, hideable: false, resizable: false },
  ], [tx])
  const { api, openMenu, menuNode } = useTableColumnMenu('discover-advisors-v2', columns)
  const sortedPis = useMemo(() => {
    const multiplier = direction === 'asc' ? 1 : -1
    return [...pis].sort((left, right) => {
      if (sort === 'advisor') return multiplier * left.name.localeCompare(right.name, lang)
      if (sort === 'program') return multiplier * `${left.school} ${left.program}`.localeCompare(`${right.school} ${right.program}`, lang)
      if (sort === 'category') return multiplier * left.category.localeCompare(right.category, lang)
      if (sort === 'hIndex') return multiplier * ((left.hIndex ?? -1) - (right.hIndex ?? -1))
      return multiplier * (left.matchScore - right.matchScore)
    })
  }, [direction, lang, pis, sort])
  const hiddenMotion = useSmoothHiddenToggle(actions.togglePiHidden)
  const filterMotion = useAnimatedListPresence(sortedPis, hiddenMotion.hidingIds)
  const itemIdentityKey = sortedPis.map((pi) => pi.id).join('\u001f')
  const { visibleItems: visiblePis, hasMore, sentinelRef } = useProgressiveList(
    filterMotion.items,
    `${resetKey}\u001e${sort}\u001e${direction}\u001e${itemIdentityKey}`,
  )
  const visiblePiOrderKey = visiblePis.map((pi) => pi.id).join('\u001f')
  const mobileResultsRef = useSmoothListReflow<HTMLDivElement>(visiblePiOrderKey)
  const tableBodyRef = useSmoothListReflow<HTMLTableSectionElement>(visiblePiOrderKey)
  const tableWidth = api.visibleColumns.reduce((sum, column) => sum + api.widthOf(column.id), 0)
  const sortBy = (next: DiscoverPiSort) => {
    if (sort === next) setDirection((value) => value === 'asc' ? 'desc' : 'asc')
    else {
      setSort(next)
      setDirection(next === 'advisor' || next === 'program' || next === 'category' ? 'asc' : 'desc')
    }
  }
  const column = (id: string) => columns.find((item) => item.id === id) as TableColumnDef
  return (
    <section className="discover-list-pane" aria-label={tx('discover.pisList', 'Advisors')}>
      <div className="discover-list-count">
        <span>{tx('discover.foundAdvisors', 'Found {count} advisors').replace('{count}', String(pis.length))}</span>
        <button type="button" className="discover-column-button" onClick={(event) => openMenu(event, tx('table.columns', 'Columns'))} aria-label={tx('table.columns', 'Columns')} title={tx('table.columnsHint', 'Resize columns or right-click to show and hide them.')}><Columns3 size={14} /></button>
      </div>
      <div className="discover-mobile-list-tools">
        <Select
          value={sort}
          size="small"
          ariaLabel={tx('discover.sortBy', 'Sort by')}
          options={[
            { value: 'match', label: tx('discover.match', 'Match') },
            { value: 'advisor', label: tx('discover.advisor', 'Advisor') },
            { value: 'program', label: tx('discover.program', 'Program') },
            { value: 'category', label: tx('discover.category', 'Type') },
            { value: 'hIndex', label: tx('discover.hIndex') },
          ]}
          onChange={(value) => sortBy(value as DiscoverPiSort)}
        />
        <button type="button" className="discover-mobile-sort-direction" onClick={() => setDirection((value) => value === 'asc' ? 'desc' : 'asc')} aria-label={tx('discover.sortBy', 'Sort by')}>
          {direction === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
        </button>
      </div>
      <div className="discover-pi-table atlas-table-shell">
        {filterMotion.items.length ? (
          <>
          <div ref={mobileResultsRef} className="discover-mobile-results">
            {visiblePis.map((pi) => (
              <article key={pi.id} data-discover-reflow-key={pi.id} className={clsx('discover-mobile-result discover-mobile-pi-result', selectedPi?.id === pi.id && 'is-selected', pi.hidden && 'is-hidden', hiddenMotion.hidingIds.includes(pi.id) && 'is-hiding', filterMotion.enteringIds.includes(pi.id) && 'is-filter-entering', filterMotion.exitingIds.includes(pi.id) && 'is-filter-exiting')}>
                <div className="discover-mobile-card-actions is-single" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="discover-mobile-card-action" disabled={hiddenMotion.hidingIds.includes(pi.id)} onClick={() => hiddenMotion.requestToggle(pi.id, Boolean(pi.hidden))} aria-label={pi.hidden ? tx('discover.restore') : tx('discover.hide')}>
                    {pi.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>
                <button type="button" className="discover-mobile-result-main" onClick={() => actions.selectPi(pi.id)}>
                  <span className="discover-mobile-result-copy">
                    <strong>{pi.name}</strong>
                    <span>{pi.school} · {pi.program}</span>
                    <small>{isRecruiting(pi.recruiting) ? tx('discover.recruitingLikely', 'Possibly recruiting') : tx('discover.recruitingUnknown', 'Recruiting unverified')}</small>
                  </span>
                  <span className="discover-mobile-result-score"><strong>{Math.round(pi.matchScore)}%</strong><small>{tx('discover.match', 'Match')}</small></span>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
                <dl className="discover-mobile-result-facts">
                  <div><dt>{tx('discover.category', 'Type')}</dt><dd>{piCategoryDescription(pi.category, lang, tx)}</dd></div>
                  <div><dt>{tx('discover.hIndex')}</dt><dd>{pi.hIndex ?? '—'}</dd></div>
                  <div><dt>{tx('discover.location', 'Location')}</dt><dd>{localizedRegion(pi.region, pi.region, tx)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <table className="discover-data-table atlas-table" style={{ width: tableWidth, minWidth: '100%' }} onContextMenu={(event) => openMenu(event, tx('table.columns', 'Columns'))}>
            <TableColGroup columns={columns} api={api} />
            <thead className="discover-pi-head"><tr>
              <DiscoverSortHeader column={column('advisor')} api={api} activeSort={sort} direction={direction} sort="advisor" onSort={sortBy}>{tx('discover.advisor', 'Advisor')}</DiscoverSortHeader>
              <DiscoverSortHeader column={column('program')} api={api} activeSort={sort} direction={direction} sort="program" onSort={sortBy}>{tx('discover.program', 'Program')}</DiscoverSortHeader>
              <DiscoverSortHeader column={column('category')} api={api} activeSort={sort} direction={direction} sort="category" onSort={sortBy}>{tx('discover.category', 'Type')}</DiscoverSortHeader>
              <DiscoverSortHeader
                column={column('hIndex')}
                api={api}
                activeSort={sort}
                direction={direction}
                sort="hIndex"
                onSort={sortBy}
                info={{ content: tx('discover.hIndexExplanation'), label: tx('discover.hIndexInfoLabel') }}
              >
                {tx('discover.hIndex')}
              </DiscoverSortHeader>
              <DiscoverSortHeader column={column('match')} api={api} activeSort={sort} direction={direction} sort="match" onSort={sortBy}>{tx('discover.match', 'Match')}</DiscoverSortHeader>
              <TableHeaderCell column={column('actions')} api={api}><span aria-hidden="true" /></TableHeaderCell>
            </tr></thead>
            <tbody ref={tableBodyRef}>{visiblePis.map((pi) => (
              <tr key={pi.id} data-discover-reflow-key={pi.id} className={clsx('discover-pi-row', selectedPi?.id === pi.id && 'is-selected', pi.hidden && 'is-hidden', hiddenMotion.hidingIds.includes(pi.id) && 'is-hiding', filterMotion.enteringIds.includes(pi.id) && 'is-filter-entering', filterMotion.exitingIds.includes(pi.id) && 'is-filter-exiting')} onClick={() => actions.selectPi(pi.id)}>
                <TableCell columnId="advisor" api={api}><button type="button" className="discover-pi-identity" onClick={() => actions.selectPi(pi.id)}><strong>{pi.name}</strong><span>{isRecruiting(pi.recruiting) ? tx('discover.recruitingLikely', 'Possibly recruiting') : tx('discover.recruitingUnknown', 'Recruiting unverified')}</span></button></TableCell>
                <TableCell columnId="program" api={api}><span className="discover-pi-program"><strong>{pi.school}</strong><small>{pi.program}</small></span></TableCell>
                <TableCell columnId="category" api={api}><span className="discover-pi-category">{piCategoryDescription(pi.category, lang, tx)}</span></TableCell>
                <TableCell columnId="hIndex" api={api}><span className="discover-pi-hindex">{pi.hIndex ?? '—'}</span></TableCell>
                <TableCell columnId="match" api={api}><span className="discover-program-score">{Math.round(pi.matchScore)}%</span></TableCell>
                <TableCell columnId="actions" api={api} className="discover-actions-cell"><div className="discover-row-actions" onClick={(event) => event.stopPropagation()}><button type="button" className="discover-icon-btn hover-reveal" disabled={hiddenMotion.hidingIds.includes(pi.id)} onClick={() => hiddenMotion.requestToggle(pi.id, Boolean(pi.hidden))} aria-label={pi.hidden ? tx('discover.restore') : tx('discover.hide')}>{pi.hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button></div></TableCell>
              </tr>
            ))}</tbody>
          </table>
          </>
        ) : <div className="discover-list-empty"><UserRound size={20} /><strong>{tx('discover.noPiResults', 'No matching advisors')}</strong><span>{tx('discover.adjustFilters', 'Try clearing one or more filters.')}</span></div>}
        {menuNode}
        {hasMore ? <div ref={sentinelRef} className="discover-lazy-sentinel" role="status" aria-label={tx('discover.loadingCatalog', 'Loading Discover…')}><span className="discover-table-loading-dot" /></div> : null}
      </div>
    </section>
  )
}

function InspectorSection({ title, summary, children, open = true }: { title: string; summary?: string; children: ReactNode; open?: boolean }) {
  return (
    <SmoothDisclosure
      className="discover-inspector-section"
      defaultOpen={open}
      summary={<span><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span>}
      indicator={<ChevronRight size={15} />}
      bodyClassName="discover-inspector-section-body"
    >
      {children}
    </SmoothDisclosure>
  )
}

function ProgramInspector({
  program,
  score,
  state,
  note,
  importingId,
  mobileOpen,
  collapsed,
  actions,
}: {
  program: ScoredDiscoverProgram | null
  score: number
  state: DiscoverUserState
  note: string
  importingId: string | null
  mobileOpen: boolean
  collapsed: boolean
  actions: WorkspaceActions
}) {
  const { tx, lang } = useI18n()
  if (!program) return <aside className="discover-inspector is-empty" aria-hidden={collapsed} inert={collapsed}><span>{tx('discover.selectProgram', 'Select a program to inspect it.')}</span></aside>
  const advisorCount = program.fittingPiCount ?? program.pis.length
  const deadline = programDeadline(program)
  const official = program.stipendFoundOfficial
  const intlEligible = program.requirements?.restrictions?.intlEligible
  return (
    <aside className={clsx('discover-inspector', mobileOpen && 'is-mobile-open')} aria-label={tx('discover.programDetails', 'Program details')} aria-hidden={collapsed && !mobileOpen} inert={collapsed && !mobileOpen}>
      <div className="discover-sheet-handle" aria-hidden="true" />
      <header className="discover-inspector-header">
        <div>
          <strong>{program.school}</strong>
          <span>{program.program}</span>
        </div>
        <button type="button" className="discover-icon-btn discover-inspector-close" onClick={actions.closeInspector} aria-label={tx('discover.close', 'Close')}><X size={17} /></button>
      </header>
      <p className="discover-fit-summary">
        {tx(official ? 'discover.fitSummaryVerified' : 'discover.fitSummaryUnverified', official
          ? 'This program matches your direction, with {count} relevant advisors and verified funding.'
          : 'This program matches your direction, with {count} relevant advisors; funding still needs verification.')
          .replace('{count}', String(advisorCount))}
      </p>

      <div className="discover-inspector-scroll">
        <dl className="discover-inspector-facts-v2">
          <div><dt>{tx('discover.match', 'Match')}</dt><dd>{Math.round(score)}%</dd></div>
          <div><dt>{tx('discover.location', 'Location')}</dt><dd>{program.city}, {localizedRegion(program.country, program.country, tx)}</dd></div>
          <div><dt>{tx('discover.applicationDeadline', 'Deadline')}</dt><dd>{dateLabel(deadline, lang)}</dd></div>
          <div><dt>{tx('discover.collectedAt', 'Collected')}</dt><dd>{dateLabel(program.collectedAt?.slice(0, 10), lang)}</dd></div>
        </dl>

        <section className="discover-inspector-section discover-advisor-jump-section">
          <button
            type="button"
            className="discover-inspector-section-jump"
            onClick={() => {
              const firstVisiblePi = program.pis.find((pi) => !state.hiddenPiIds.includes(pi.id))
              if (firstVisiblePi) actions.selectPi(firstVisiblePi.id)
              else actions.setMode('pis')
            }}
          >
            <span><strong>{tx('discover.matchingAdvisors', 'Matching advisors')}</strong><small>{tx('discover.advisorCount', '{count} advisors').replace('{count}', String(advisorCount))}</small></span>
            <ChevronRight size={15} />
          </button>
          <div className="discover-inspector-advisors">
            {program.pis.filter((pi) => !state.hiddenPiIds.includes(pi.id)).slice(0, 4).map((pi) => (
              <button key={pi.id} type="button" onClick={() => actions.selectPi(pi.id)}>
                <span className="discover-avatar-fallback">{pi.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{pi.name}</strong><small>{piCategoryDescription(pi.category, lang, tx)} · {pi.hIndex == null ? tx('discover.hIndexUnknown', 'h-index unverified') : `h-index ${pi.hIndex}`}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <InspectorSection title={tx('discover.annualFunding', 'Annual funding')} summary={currency(program.stipendUSD, 'USD', lang)} open>
          <dl className="discover-detail-list">
            <div><dt>{tx('discover.amount', 'Amount')}</dt><dd>{currency(program.stipendUSD, 'USD', lang)}</dd></div>
            <div><dt>{tx('discover.verification', 'Verification')}</dt><dd className={official ? 'is-success' : 'is-warning'}>{official ? <CircleCheck size={14} /> : null}{official ? tx('discover.officiallyVerified', 'Official source verified') : tx('discover.needsVerification', 'Needs verification')}</dd></div>
            <div><dt>{tx('discover.confidence', 'Confidence')}</dt><dd>{tx(`discover.enrichConfidence${program.stipendConfidence.charAt(0).toUpperCase()}${program.stipendConfidence.slice(1)}`, program.stipendConfidence)}</dd></div>
          </dl>
        </InspectorSection>

        <InspectorSection title={tx('discover.tuitionAndRankings', 'Tuition and rankings')} summary={program.qsWorldRank ? `QS #${program.qsWorldRank}` : (program.theWorldRank ? `THE #${program.theWorldRank}` : tx('discover.notConfirmed', 'Not confirmed'))} open>
          <dl className="discover-detail-list">
            <div><dt>{tx('discover.tuition', 'Tuition')}</dt><dd>{program.tuitionLocal || tx('discover.notConfirmed', 'Not confirmed')}</dd></div>
            <div><dt>{tx('discover.qsWorldRank', 'QS world rank')}</dt><dd>{program.qsWorldRank ? `#${program.qsWorldRank}${program.rankingYear ? ` (${program.rankingYear})` : ''}` : '—'}</dd></div>
            <div><dt>{tx('discover.qsSubjectRank', 'QS subject rank')}</dt><dd>{program.qsSubjectRank ? `#${program.qsSubjectRank} · ${program.qsSubjectName || '—'}` : '—'}</dd></div>
            <div><dt>{tx('discover.theWorldRank', 'THE world rank')}</dt><dd>{program.theWorldRank ? `#${program.theWorldRank}${program.rankingYear ? ` (${program.rankingYear})` : ''}` : '—'}</dd></div>
            <div><dt>{tx('discover.theSubjectRank', 'THE subject rank')}</dt><dd>{program.theSubjectRank ? `#${program.theSubjectRank} · ${program.theSubjectName || '—'}` : '—'}</dd></div>
          </dl>
          {program.tuitionNotes ? <p>{program.tuitionNotes}</p> : null}
          {(program.rankingSources || []).length ? <div className="discover-source-list">{uniqueDiscoverSourceLinks(program.rankingSources || []).map((source) => <a key={source} href={source} target="_blank" rel="noreferrer"><span>{compactUrl(source)}</span><ExternalLink size={13} /></a>)}</div> : null}
        </InspectorSection>

        <InspectorSection title={tx('discover.scholarshipOptions', 'Scholarship options')} summary={tx('discover.scholarshipCount', '{count} verified').replace('{count}', String(program.scholarships?.length || 0))} open>
          {(program.scholarships || []).length ? <div className="discover-scholarship-list">
            {program.scholarships?.map((scholarship) => <a key={`${scholarship.name}:${scholarship.url}`} href={scholarship.url} target="_blank" rel="noreferrer">
              <span><strong>{scholarship.name}</strong><small>{[scholarship.provider, scholarship.amount, scholarship.deadline].filter(Boolean).join(' · ')}</small>{scholarship.profileFit ? <small>{scholarship.profileFit}</small> : null}</span>
              <ExternalLink size={13} />
            </a>)}
          </div> : <p>{tx('discover.noVerifiedScholarships', 'No profile-eligible scholarship was verified in this run.')}</p>}
        </InspectorSection>

        <InspectorSection title={tx('discover.applicationRules', 'Application rules')} summary={multiApplyLabel(program.multiApply, lang)} open>
          <dl className="discover-detail-list">
            <div><dt>{tx('discover.multipleApplications', 'Multiple applications')}</dt><dd>{multiApplyLabel(program.multiApply, lang)}</dd></div>
            <div><dt>{tx('discover.supervisorContact', 'Contact advisor first')}</dt><dd>{program.requirements?.restrictions?.supervisorContact ? tx(`discover.supervisor_${program.requirements.restrictions.supervisorContact}`, program.requirements.restrictions.supervisorContact) : tx('discover.unknown', 'Unknown')}</dd></div>
            <div><dt>{tx('discover.feeWaiverLabel', 'Fee waiver')}</dt><dd>{program.requirements?.fees?.waiverAvailable ? tx('discover.available', 'Available') : tx('discover.notConfirmed', 'Not confirmed')}</dd></div>
          </dl>
        </InspectorSection>

        <InspectorSection title={tx('discover.internationalStudents', 'International students')} summary={intlEligible === false ? tx('discover.restrictionsApply', 'Restrictions apply') : tx('discover.eligible', 'Eligible')} open>
          <p>{intlEligible === false ? tx('discover.intlRestrictedBody', 'The current record indicates restrictions for international applicants. Verify the official eligibility page before applying.') : tx('discover.intlEligibleBody', 'The current record indicates international applicants are eligible. Funding and visa terms still need official confirmation.')}</p>
        </InspectorSection>

        <InspectorSection title={tx('discover.personalNote', 'Personal note')} summary={note.trim() ? tx('discover.noteSaved', 'Saved') : tx('discover.addNote', 'Add note')} open>
          <textarea value={note} onChange={(e) => actions.updateProgramNote(program.id, e.target.value)} placeholder={tx('discover.programNotePlaceholder', 'Record fit, questions and the next thing to verify.')} />
          <button type="button" className="discover-inline-action" onClick={() => actions.saveProgramNote(program.id)}>{tx('discover.saveNote', 'Save note')}</button>
        </InspectorSection>

        <InspectorSection title={tx('discover.officialSources', 'Official sources')} summary={tx('discover.sourceCount', '{count} sources').replace('{count}', String(program.sources.length))} open>
          <div className="discover-source-list">
            {uniqueDiscoverSourceLinks([program.website, ...program.sources]).map((source) => (
              <a key={source} href={source} {...DISCOVER_EXTERNAL_LINK_PROPS}><span>{compactUrl(source)}</span><ExternalLink size={13} /></a>
            ))}
          </div>
        </InspectorSection>
      </div>

      <footer className="discover-inspector-actions">
        <FavoriteBookmarkButton
          className="secondary-action"
          active={Boolean(program.watched)}
          label={program.watched ? tx('discover.unwatch') : tx('discover.watch')}
          iconSize={15}
          onToggle={() => actions.toggleWatch(program.id)}
        >
          <span>{program.watched ? tx('discover.watched') : tx('discover.watch')}</span>
        </FavoriteBookmarkButton>
        <button type="button" className="primary-action" disabled={importingId === program.id} onClick={() => actions.importProgram(program.id)}>
          <Plus size={15} />{importingId === program.id ? tx('discover.importing') : tx('discover.addToApplications', 'Add to applications')}
        </button>
      </footer>
    </aside>
  )
}

function PiInspector({
  pi,
  note,
  importingId,
  mobileOpen,
  collapsed,
  actions,
}: {
  pi: ScoredDiscoverPi | null
  note: string
  importingId: string | null
  mobileOpen: boolean
  collapsed: boolean
  actions: WorkspaceActions
}) {
  const { tx, lang } = useI18n()
  if (!pi) return <aside className="discover-inspector is-empty" aria-hidden={collapsed} inert={collapsed}><span>{tx('discover.selectAdvisor', 'Select an advisor to inspect them.')}</span></aside>
  const importKey = `${pi.programId}:${pi.id}`
  const verifiedMatchScore = pi.profileMatch?.score ?? Math.round(pi.matchScore)
  const profileMatch = pi.profileMatch
  const scholarly = pi.scholarly
  const scholarlyTopics = (scholarly?.matchedQueries || []).filter(Boolean).slice(0, 6)
  const scholarlyLinks = uniqueDiscoverSourceLinks([
    scholarly?.profileUrl || '',
    scholarly?.orcid ? `https://orcid.org/${scholarly.orcid.replace(/^https?:\/\/orcid\.org\//i, '')}` : '',
  ])
  return (
    <aside className={clsx('discover-inspector', mobileOpen && 'is-mobile-open')} aria-label={tx('discover.advisorDetails', 'Advisor details')} aria-hidden={collapsed && !mobileOpen} inert={collapsed && !mobileOpen}>
      <div className="discover-sheet-handle" aria-hidden="true" />
      <header className="discover-inspector-header">
        <div><strong>{pi.name}</strong><span>{pi.school} · {pi.program}</span></div>
        <button type="button" className="discover-icon-btn discover-inspector-close" onClick={actions.closeInspector} aria-label={tx('discover.close', 'Close')}><X size={17} /></button>
      </header>
      <p className="discover-fit-summary">{pi.whyFit || tx('discover.piSummary', 'No applicant-profile overlap was verified on the fetched official profile. Confirm current projects and recruiting status before contacting them.')}</p>
      <div className="discover-inspector-scroll">
        <dl className="discover-inspector-facts-v2">
          <div><dt>{tx('discover.category', 'Type')}</dt><dd>{piCategoryDescription(pi.category, lang, tx)}</dd></div>
          <div>
            <dt className="discover-hindex-fact-label">
              <span>{tx('discover.hIndex')}</span>
              <InfoTooltip className="discover-hindex-tooltip" content={tx('discover.hIndexExplanation')} label={tx('discover.hIndexInfoLabel')} />
            </dt>
            <dd>{pi.hIndex ?? '—'}</dd>
          </div>
          <div><dt>{tx('discover.match', 'Match')}</dt><dd>{verifiedMatchScore}%</dd></div>
        </dl>
        <InspectorSection title={tx('discover.recruitingStatus', 'Recruiting status')} summary={isRecruiting(pi.recruiting) ? tx('discover.recruitingLikely', 'Possibly recruiting') : tx('discover.recruitingUnknown', 'Recruiting unverified')} open>
          <p>{pi.recruiting || tx('discover.recruitingUnknown', 'Recruiting unverified')}</p>
          <p>{tx('discover.recruitingCaveat', 'Recruiting status changes frequently. Check the lab page and recent posts before contacting the advisor.')}</p>
        </InspectorSection>
        <InspectorSection
          title={tx('discover.profileMatchEvidence', 'Profile-match evidence')}
          summary={tx('discover.matchScoreSummary', '{score}% verified overlap').replace('{score}', String(verifiedMatchScore))}
          open
        >
          <dl className="discover-detail-list">
            <div><dt>{tx('discover.matchedInterests', 'Research interests')}</dt><dd>{(profileMatch?.matchedInterests || []).join(' · ') || '—'}</dd></div>
            <div><dt>{tx('discover.matchedMethods', 'Methods')}</dt><dd>{(profileMatch?.matchedMethods || []).join(' · ') || '—'}</dd></div>
            <div><dt>{tx('discover.matchedResearchTerms', 'Research direction')}</dt><dd>{(profileMatch?.matchedResearchTerms || []).join(' · ') || '—'}</dd></div>
            <div><dt>{tx('discover.evidenceCheckedAt', 'Evidence checked')}</dt><dd>{profileMatch?.checkedAt ? dateLabel(profileMatch.checkedAt, lang) : '—'}</dd></div>
          </dl>
          {profileMatch?.evidenceUrl ? (
            <div className="discover-source-list">
              <a href={profileMatch.evidenceUrl} {...DISCOVER_EXTERNAL_LINK_PROPS}><span>{compactUrl(profileMatch.evidenceUrl)}</span><ExternalLink size={13} /></a>
            </div>
          ) : null}
        </InspectorSection>
        <InspectorSection title={tx('discover.labProfile', 'Lab profile')} summary={pi.labSize || tx('discover.unknown', 'Unknown')} open>
          <dl className="discover-detail-list">
            <div><dt>{tx('discover.labStarted', 'Lab started')}</dt><dd>{pi.startedApprox || '—'}</dd></div>
            <div><dt>{tx('discover.labSize', 'Lab size')}</dt><dd>{pi.labSize || '—'}</dd></div>
            <div><dt>{tx('discover.wetDry', 'Research mode')}</dt><dd>{tx(`discover.wetDry_${pi.wetDry}`, pi.wetDry)}</dd></div>
          </dl>
        </InspectorSection>
        <InspectorSection title={tx('discover.officialResearchProfile', 'Official research profile')} summary={tx('discover.expandToRead', 'Expand to read')} open>
          <p lang="en">{pi.research || pi.whyFit || tx('discover.notFound', 'Not found')}</p>
        </InspectorSection>
        <InspectorSection
          title={tx('discover.scholarlyRecord', 'Scholarly record')}
          summary={scholarly
            ? tx('discover.publicationCount', '{count} matched works').replace('{count}', String(scholarly.recentWorks.length))
            : tx('discover.scholarlyUnavailable', 'No unique scholarly identity')}
          open={Boolean(scholarly)}
        >
          {scholarly ? (
            <div className="discover-scholar-evidence">
              <dl className="discover-detail-list">
                <div><dt>{tx('discover.identityEvidence', 'Identity evidence')}</dt><dd>{tx('discover.scholarlyVerified', 'Institution-scoped and profile-matched')}</dd></div>
                <div><dt>{tx('discover.dataProviders', 'Data providers')}</dt><dd>{scholarly.providers.join(' · ') || '—'}</dd></div>
                <div><dt>{tx('discover.matchedResearchTopics', 'Matched research topics')}</dt><dd>{scholarlyTopics.join(' · ') || '—'}</dd></div>
                <div><dt>{tx('discover.citations', 'Citations')}</dt><dd>{pi.citations ?? '—'}</dd></div>
              </dl>
              {scholarlyLinks.length ? <div className="discover-source-list discover-scholar-identifiers">
                {scholarlyLinks.map((source) => <a key={source} href={source} {...DISCOVER_EXTERNAL_LINK_PROPS}><span>{compactUrl(source)}</span><ExternalLink size={13} /></a>)}
              </div> : null}
              {scholarly.recentWorks.length ? (
                <div className="discover-publication-ledger">
                  <strong>{tx('discover.recentMatchedWorks', 'Recent matched works')}</strong>
                  <ol>
                    {scholarly.recentWorks.map((work) => (
                      <li key={`${work.title}:${work.year ?? 'unknown'}`}>
                        <a href={work.source} {...DISCOVER_EXTERNAL_LINK_PROPS}>{work.title}<ExternalLink size={12} /></a>
                        <small>{[work.year, `${work.citedByCount} ${tx('discover.citations', 'citations')}`, work.matchedTopic || work.matchedQuery].filter(Boolean).join(' · ')}</small>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : <p>{tx('discover.scholarlyUnavailableHint', 'No unique institution-scoped author record could be joined to this verified official profile.')}</p>}
        </InspectorSection>
        <InspectorSection title={tx('discover.personalNote', 'Personal note')} summary={note.trim() ? tx('discover.noteSaved', 'Saved') : tx('discover.addNote', 'Add note')} open>
          <textarea value={note} onChange={(e) => actions.updatePiNote(pi.id, e.target.value)} placeholder={tx('discover.piNotePlaceholder')} />
          <button type="button" className="discover-inline-action" onClick={() => actions.savePiNote(pi.id)}>{tx('discover.saveNote', 'Save note')}</button>
        </InspectorSection>
        <InspectorSection title={tx('discover.links', 'Links')} summary={tx('discover.officialSources', 'Official sources')} open>
          <div className="discover-source-list">
            {uniqueDiscoverSourceLinks([pi.url]).map((source) => <a key={source} href={source} {...DISCOVER_EXTERNAL_LINK_PROPS}><span>{compactUrl(source)}</span><ExternalLink size={13} /></a>)}
            {pi.email ? <a href={`mailto:${pi.email}`}><span>{pi.email}</span></a> : null}
          </div>
        </InspectorSection>
      </div>
      <footer className="discover-inspector-actions">
        <button type="button" className="secondary-action" onClick={() => actions.togglePiHidden(pi.id)}>{pi.hidden ? <Eye size={15} /> : <EyeOff size={15} />}{pi.hidden ? tx('discover.restore') : tx('discover.hide')}</button>
        <button type="button" className="primary-action" disabled={importingId === importKey} onClick={() => actions.importProgram(pi.programId, pi.id)}><Plus size={15} />{importingId === importKey ? tx('discover.importing') : tx('discover.addWithAdvisor', 'Add with advisor')}</button>
      </footer>
    </aside>
  )
}

function CompareView({
  programs,
  scoreByProgramId,
  state,
  importingId,
  actions,
}: {
  programs: ScoredDiscoverProgram[]
  scoreByProgramId: Record<string, number>
  state: DiscoverUserState
  importingId: string | null
  actions: WorkspaceActions
}) {
  const { tx, lang } = useI18n()
  if (!programs.length) {
    return (
      <section className="discover-compare-empty">
        <SlidersHorizontal size={22} />
        <h3>{tx('discover.compareEmptyTitle', 'Choose programs to compare')}</h3>
        <p>{tx('discover.compareEmptyBody', 'Select up to four programs from the program list.')}</p>
        <button type="button" className="primary-action" onClick={() => actions.setMode('programs')}>{tx('discover.browsePrograms', 'Browse programs')}</button>
      </section>
    )
  }
  const bestMatch = [...programs].sort((a, b) => (scoreByProgramId[b.id] ?? 0) - (scoreByProgramId[a.id] ?? 0))[0]
  const bestFunding = [...programs].filter((p) => p.stipendFoundOfficial && p.stipendUSD != null).sort((a, b) => (b.stipendUSD ?? 0) - (a.stipendUSD ?? 0))[0]
  const rows: Array<{ id: string; label: string; render: (program: ScoredDiscoverProgram) => ReactNode }> = [
    { id: 'match', label: tx('discover.match', 'Match'), render: (p) => <div className="discover-compare-meter"><strong>{Math.round(scoreByProgramId[p.id] ?? p.matchScore)}%</strong><span><i style={{ width: `${Math.round(scoreByProgramId[p.id] ?? p.matchScore)}%` }} /></span></div> },
    { id: 'funding', label: tx('discover.annualFunding', 'Annual funding'), render: (p) => <span>{currency(p.stipendUSD, 'USD', lang)} <small>{p.stipendFoundOfficial ? tx('discover.verifiedShort', 'Verified') : tx('discover.needsVerification', 'Needs verification')}</small></span> },
    { id: 'real', label: tx('discover.realPurchasingPower', 'Real purchasing power'), render: (p) => currency(p.realStipendUSD, 'USD', lang) },
    { id: 'deadline', label: tx('discover.applicationDeadline', 'Deadline'), render: (p) => dateLabel(programDeadline(p), lang) },
    { id: 'advisors', label: tx('discover.matchingAdvisors', 'Matching advisors'), render: (p) => tx('discover.advisorCount', '{count} advisors').replace('{count}', String(p.fittingPiCount ?? p.pis.length)) },
    { id: 'rule', label: tx('discover.applicationRules', 'Application rules'), render: (p) => multiApplyLabel(p.multiApply, lang) },
    { id: 'intl', label: tx('discover.internationalStudents', 'International students'), render: (p) => p.requirements?.restrictions?.intlEligible === false ? tx('discover.restrictionsApply', 'Restrictions apply') : tx('discover.eligible', 'Eligible') },
    { id: 'evidence', label: tx('discover.verification', 'Verification'), render: (p) => <span className={p.stipendFoundOfficial ? 'is-success' : 'is-warning'}>{p.stipendFoundOfficial ? <Check size={14} /> : null}{p.stipendFoundOfficial ? tx('discover.verifiedShort', 'Verified') : tx('discover.partialVerification', 'Partial')}</span> },
    { id: 'note', label: tx('discover.personalNote', 'Personal note'), render: (p) => state.programNotes[p.id] || tx('discover.noNote', 'No note') },
  ]
  return (
    <section className="discover-compare-pane">
      <header className="discover-compare-header">
        <strong>{tx('discover.selectedProgramCount', '{count} programs selected').replace('{count}', String(programs.length))}</strong>
        <button type="button" className="secondary-action" onClick={() => actions.setMode('programs')}><Plus size={14} />{tx('discover.addProgram', 'Add program')}</button>
      </header>
      <div className="discover-compare-scroll">
        <div className="discover-mobile-compare-list">
          {programs.map((program) => (
            <article key={program.id} className="discover-mobile-compare-card">
              <header>
                <div><strong>{program.school}</strong><span>{program.program}</span></div>
                <button type="button" className="discover-icon-btn" onClick={() => actions.toggleCompare(program.id)} aria-label={tx('discover.removeFromCompare', 'Remove from compare')}><X size={14} /></button>
              </header>
              <dl>
                {rows.map((row) => <div key={row.id}><dt>{row.label}</dt><dd>{row.render(program)}</dd></div>)}
              </dl>
              <button type="button" className="primary-action" disabled={importingId === program.id} onClick={() => actions.importProgram(program.id)}>{tx('discover.addToApplications', 'Add to applications')}</button>
            </article>
          ))}
        </div>
        <div className="discover-compare-table" style={{ '--compare-columns': programs.length } as CSSProperties}>
          <div className="discover-compare-label-cell discover-compare-project-label">{tx('discover.program', 'Program')}</div>
          {programs.map((program) => (
            <header key={program.id} className="discover-compare-program-head">
              <button type="button" className="discover-icon-btn" onClick={() => actions.toggleCompare(program.id)} aria-label={tx('discover.removeFromCompare', 'Remove from compare')}><X size={14} /></button>
              <strong>{program.school}</strong><span>{program.program}</span>
              <button type="button" className="discover-outline-action" disabled={importingId === program.id} onClick={() => actions.importProgram(program.id)}>{tx('discover.addToApplications', 'Add to applications')}</button>
            </header>
          ))}
          {rows.map((row) => (
            <div key={row.id} className="discover-compare-row-group">
              <div className="discover-compare-label-cell">{row.label}</div>
              {programs.map((program) => <div key={program.id} className="discover-compare-value-cell">{row.render(program)}</div>)}
            </div>
          ))}
        </div>
      </div>
      <footer className="discover-compare-summary">
        <Bookmark size={15} />
        <span>{tx('discover.compareSummary', 'Strongest research match: {match}; strongest verified funding: {funding}.')
          .replace('{match}', bestMatch?.school || '—')
          .replace('{funding}', bestFunding ? `${bestFunding.school} (${currency(bestFunding.stipendUSD, 'USD', lang)})` : '—')}</span>
      </footer>
    </section>
  )
}

export function DiscoverWorkspace(props: DiscoverWorkspaceProps) {
  const { tx } = useI18n()
  const {
    meta, state, mode, modeDirection, query, catalogProgramCount, programs, pis, selectedProgram, selectedPi, comparePrograms, compareIds,
    scoreByProgramId, filters, activeFilterCount, filterRailCollapsed, mobileFiltersOpen,
    mobileInspectorOpen, inspectorOpen, programSort, sortDirection, rankerDraft, programNoteDrafts,
    piNoteDrafts, importingId, deletingProgramIds, researching, saving, hiddenProgramCount, hiddenPiCount,
    teamContext, actions,
  } = props
  const compactViewport = useCompactDiscoverViewport()
  const discoverQueryResetKey = useMemo(() => {
    const requirements = filters.requirements
    return [
      query.trim().toLocaleLowerCase(),
      filters.regionFilters.join('\u001f'),
      filters.minStipend,
      filters.minMatch,
      filters.watchedOnly,
      filters.meetFloorOnly,
      filters.showHidden,
      filters.hedgeFilter,
      filters.piCategory,
      filters.minHIndex,
      requirements.deadlineWithinDays,
      requirements.greNotRequired,
      requirements.englishFlexible,
      requirements.feeWaiver,
      requirements.multiApplyOnly,
      requirements.supervisorOptional,
      requirements.intlFriendly,
      requirements.rollingOk,
      state.researchRuns,
      state.lastResearchAt ?? '',
    ].join('\u001e')
  }, [filters, query, state.lastResearchAt, state.researchRuns])
  const setDiscoverMode = actions.setMode
  const [layout, setLayout] = useState<DiscoverLayoutPrefs>(loadDiscoverLayout)
  const [resizingPane, setResizingPane] = useState<'filters' | 'inspector' | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const settleFrameRef = useRef<number | null>(null)
  const { exiting: mobileFiltersExiting, requestClose: requestMobileFiltersClose } = useAnimatedClose(
    mobileFiltersOpen,
    actions.closeMobileFilters,
    220,
  )
  useEffect(() => {
    try {
      window.localStorage.setItem(DISCOVER_LAYOUT_KEY, JSON.stringify(layout))
    } catch {
      // Private mode and storage quotas must not affect the workspace.
    }
  }, [layout])

  useEffect(() => {
    const compactQuery = window.matchMedia('(max-width: 820px)')
    const keepCompactModeAvailable = () => {
      if (compactQuery.matches && mode === 'compare') setDiscoverMode('programs')
    }
    keepCompactModeAvailable()
    compactQuery.addEventListener('change', keepCompactModeAvailable)
    return () => compactQuery.removeEventListener('change', keepCompactModeAvailable)
  }, [mode, setDiscoverMode])

  useEffect(() => () => {
    if (settleFrameRef.current != null) window.cancelAnimationFrame(settleFrameRef.current)
    document.body.classList.remove('discover-pane-resizing')
  }, [])

  const startPaneResize = useCallback((pane: 'filters' | 'inspector', event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (settleFrameRef.current != null) {
      window.cancelAnimationFrame(settleFrameRef.current)
      settleFrameRef.current = null
    }
    const workspace = workspaceRef.current
    if (!workspace) return
    const workspaceRect = workspace.getBoundingClientRect()
    const handleRect = event.currentTarget.getBoundingClientRect()
    const startX = event.clientX
    const grabOffset = event.clientX - (handleRect.left + handleRect.width / 2)
    const startCollapsed = pane === 'filters' ? filterRailCollapsed : !inspectorOpen
    const min = pane === 'filters' ? DISCOVER_FILTER_WIDTH_MIN : DISCOVER_INSPECTOR_WIDTH_MIN
    const max = pane === 'filters' ? DISCOVER_FILTER_WIDTH_MAX : DISCOVER_INSPECTOR_WIDTH_MAX
    const collapseThreshold = min - DISCOVER_PANE_COLLAPSE_DISTANCE
    const widthFromPointer = (clientX: number) => {
      const boundaryX = clientX - grabOffset
      return clamp(pane === 'filters' ? boundaryX - workspaceRect.left : workspaceRect.right - boundaryX, 0, max)
    }
    const initialVisibleWidth = widthFromPointer(startX)
    let lastWidth = initialVisibleWidth
    let moved = false
    let openedForDrag = false
    const widthProperty = pane === 'filters' ? '--discover-filter-width' : '--discover-inspector-width'
    const storedWidth = pane === 'filters' ? layout.filterWidth : layout.inspectorWidth
    const previewWidth = (width: number) => workspace.style.setProperty(widthProperty, `${width}px`)
    if (!startCollapsed) previewWidth(initialVisibleWidth)

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = widthFromPointer(moveEvent.clientX)
      if (!moved && Math.abs(moveEvent.clientX - startX) < DISCOVER_PANE_DRAG_START_DISTANCE) return
      if (!moved) {
        moved = true
        document.body.classList.add('discover-pane-resizing')
        setResizingPane(pane)
      }
      if (startCollapsed && !openedForDrag) {
        if (nextWidth <= initialVisibleWidth) return
        openedForDrag = true
        if (pane === 'filters') actions.toggleFilterRail()
        else actions.openInspector()
      }
      if (startCollapsed && !openedForDrag) {
        return
      }
      lastWidth = nextWidth
      previewWidth(nextWidth)
    }
    const stop = () => {
      document.body.classList.remove('discover-pane-resizing')
      setResizingPane(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)

      if (!moved) {
        if (startCollapsed) {
          settleFrameRef.current = window.requestAnimationFrame(() => {
            settleFrameRef.current = null
            if (pane === 'filters') actions.toggleFilterRail()
            else actions.openInspector()
          })
        }
        return
      }

      if (startCollapsed && !openedForDrag) {
        previewWidth(storedWidth)
        return
      }

      const shouldRemainOpen = lastWidth >= collapseThreshold
      const settledWidth = clamp(lastWidth, min, max)
      if (shouldRemainOpen) {
        setLayout((current) => pane === 'filters'
          ? { ...current, filterWidth: settledWidth }
          : { ...current, inspectorWidth: settledWidth })
      }
      settleFrameRef.current = window.requestAnimationFrame(() => {
        settleFrameRef.current = null
        if (!shouldRemainOpen) {
          if (pane === 'filters') actions.toggleFilterRail()
          else actions.closeInspector()
        }
        previewWidth(shouldRemainOpen ? settledWidth : storedWidth)
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }, [actions, filterRailCollapsed, inspectorOpen, layout.filterWidth, layout.inspectorWidth])

  const handlePaneResizeKey = useCallback((pane: 'filters' | 'inspector', event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const collapsed = pane === 'filters' ? filterRailCollapsed : !inspectorOpen
    const expands = pane === 'filters' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft'
    if (collapsed) {
      if (expands) {
        if (pane === 'filters') actions.toggleFilterRail()
        else actions.openInspector()
      }
      return
    }
    const min = pane === 'filters' ? DISCOVER_FILTER_WIDTH_MIN : DISCOVER_INSPECTOR_WIDTH_MIN
    const max = pane === 'filters' ? DISCOVER_FILTER_WIDTH_MAX : DISCOVER_INSPECTOR_WIDTH_MAX
    const currentWidth = pane === 'filters' ? layout.filterWidth : layout.inspectorWidth
    if (!expands && currentWidth <= min) {
      if (pane === 'filters') actions.toggleFilterRail()
      else actions.closeInspector()
      return
    }
    const nextWidth = clamp(currentWidth + (expands ? 24 : -24), min, max)
    setLayout((current) => pane === 'filters' ? { ...current, filterWidth: nextWidth } : { ...current, inspectorWidth: nextWidth })
  }, [actions, filterRailCollapsed, inspectorOpen, layout.filterWidth, layout.inspectorWidth])

  const workspaceStyle = {
    '--discover-filter-width': `${layout.filterWidth}px`,
    '--discover-inspector-width': `${layout.inspectorWidth}px`,
  } as CSSProperties
  const modeTabsStyle = {
    '--discover-tab-index': ['programs', 'pis', 'compare'].indexOf(mode),
  } as CSSProperties
  return (
    <div className={clsx('discover-v2', `mode-${mode}`, `mode-${modeDirection}`, mode === 'compare' && 'is-compare', teamContext && 'has-team-context', filterRailCollapsed && 'filters-collapsed', !inspectorOpen && 'inspector-closed', resizingPane && 'is-resizing')}>
      <header className="discover-toolbar">
        <div className="discover-toolbar-title">
          <h2>{tx('discover.title')}</h2>
          <DiscoverQuickGuide onOpenResearch={actions.openResearch} />
        </div>
        <nav className="discover-mode-tabs" aria-label={tx('discover.title')} style={modeTabsStyle}>
          {(['programs', 'pis', 'compare'] as DiscoverWorkspaceMode[]).map((item) => (
            <button key={item} type="button" className={clsx(item === 'compare' && 'discover-compare-tab', mode === item && 'active')} onClick={() => actions.setMode(item)}>
              {tx(item === 'programs' ? 'discover.tabPrograms' : item === 'pis' ? 'discover.tabPis' : 'discover.compareMode', item)}
              {item === 'compare' ? (
                <InlinePresence present={compareIds.length > 0} parentGap="6px">
                  <span className="discover-count-badge">{compareIds.length}</span>
                </InlinePresence>
              ) : null}
            </button>
          ))}
          <span className="discover-mode-indicator" aria-hidden="true" />
        </nav>
        <div className="discover-toolbar-search">
          <Search size={15} />
          <input value={query} onChange={(e) => actions.setQuery(e.target.value)} placeholder={tx('discover.searchAll', 'Search schools, programs, advisors or topics')} />
        </div>
        {mode !== 'compare' ? (
          <div className="discover-toolbar-filter-actions">
            <button type="button" className="discover-filter-button" onClick={filterRailCollapsed ? actions.toggleFilterRail : actions.openMobileFilters}>
              <Filter size={15} />{tx('discover.filtersTitle', 'Filters')}
              <InlinePresence present={activeFilterCount > 0} parentGap="6px">
                <span className="discover-count-badge">{activeFilterCount}</span>
              </InlinePresence>
            </button>
          </div>
        ) : null}
        <div className="discover-toolbar-actions">
          <InlinePresence present={compareIds.length > 0} parentGap="8px" durationMs={320}>
            <button type="button" className="discover-clear-compare-action" onClick={actions.clearCompare}>
              <X size={13} aria-hidden="true" />
              {tx('discover.clearAllCompare', 'Clear all comparisons')}
            </button>
          </InlinePresence>
          <button
            type="button"
            className="primary-action discover-research-trigger"
            disabled={researching || saving}
            aria-label={researching ? tx('discover.runningResearch') : tx('discover.updateResearch', 'Update research')}
            title={researching ? tx('discover.runningResearch') : tx('discover.updateResearch', 'Update research')}
            onClick={actions.openResearch}
          >
            <RefreshCw size={14} className={researching ? 'spin-icon' : undefined} />
            <span className="discover-research-trigger-label">
              {researching ? tx('discover.runningResearch') : tx('discover.updateResearch', 'Update research')}
            </span>
          </button>
        </div>
      </header>

      <main ref={workspaceRef} className="discover-workspace" style={workspaceStyle}>
        {mode !== 'compare' ? <FilterRail meta={meta} mode={mode} filters={filters} activeFilterCount={activeFilterCount} hiddenProgramCount={hiddenProgramCount} hiddenPiCount={hiddenPiCount} rankerDraft={rankerDraft} actions={actions} collapsed={filterRailCollapsed} /> : null}
        {mode === 'programs' ? <ProgramList programs={programs} hasVerifiedCatalog={catalogProgramCount > 0} selectedProgram={selectedProgram} compareIds={compareIds} scoreByProgramId={scoreByProgramId} currencyCode={meta?.currency || 'USD'} importingId={importingId} deletingProgramIds={deletingProgramIds} programSort={programSort} sortDirection={sortDirection} resetKey={discoverQueryResetKey} compactViewport={compactViewport} actions={actions} /> : null}
        {mode === 'pis' ? <PiList pis={pis} selectedPi={selectedPi} resetKey={discoverQueryResetKey} actions={actions} /> : null}
        {mode === 'compare' ? <CompareView programs={comparePrograms} scoreByProgramId={scoreByProgramId} state={state} importingId={importingId} actions={actions} /> : null}
        {mode === 'programs' ? <ProgramInspector program={selectedProgram} score={selectedProgram ? scoreByProgramId[selectedProgram.id] ?? selectedProgram.matchScore : 0} state={state} note={selectedProgram ? programNoteDrafts[selectedProgram.id] ?? state.programNotes[selectedProgram.id] ?? '' : ''} importingId={importingId} mobileOpen={mobileInspectorOpen} collapsed={!inspectorOpen} actions={actions} /> : null}
        {mode === 'pis' ? <PiInspector pi={selectedPi} note={selectedPi ? piNoteDrafts[selectedPi.id] ?? state.piNotes[selectedPi.id] ?? '' : ''} importingId={importingId} mobileOpen={mobileInspectorOpen} collapsed={!inspectorOpen} actions={actions} /> : null}
        {mode !== 'compare' ? (
          <>
            <button
              type="button"
              className={clsx('discover-pane-resizer is-left', filterRailCollapsed && 'is-edge')}
              aria-label={tx(filterRailCollapsed ? 'discover.showFilters' : 'discover.resizeFilters', filterRailCollapsed ? 'Show filters' : 'Resize filters')}
              title={tx(filterRailCollapsed ? 'discover.showFilters' : 'discover.resizeFilters', filterRailCollapsed ? 'Show filters' : 'Resize filters')}
              aria-expanded={!filterRailCollapsed}
              onPointerDown={(event) => startPaneResize('filters', event)}
              onKeyDown={(event) => handlePaneResizeKey('filters', event)}
            ><GripVertical size={13} aria-hidden="true" /></button>
            <button
              type="button"
              className={clsx('discover-pane-resizer is-right', !inspectorOpen && 'is-edge')}
              aria-label={tx(!inspectorOpen ? 'discover.showInspector' : 'discover.resizeInspector', !inspectorOpen ? 'Show details' : 'Resize details')}
              title={tx(!inspectorOpen ? 'discover.showInspector' : 'discover.resizeInspector', !inspectorOpen ? 'Show details' : 'Resize details')}
              aria-expanded={inspectorOpen}
              onPointerDown={(event) => startPaneResize('inspector', event)}
              onKeyDown={(event) => handlePaneResizeKey('inspector', event)}
            ><GripVertical size={13} aria-hidden="true" /></button>
          </>
        ) : null}
      </main>

      <div className={clsx('discover-statusbar', teamContext && 'has-team-context')}>
        {teamContext ? (
          <>
            <div className="discover-team-context">
              <button type="button" className="discover-team-context-back" onClick={teamContext.onBack}>
                <ChevronLeft size={13} aria-hidden="true" />
                <span>{tx('back', 'Back')}</span>
              </button>
              <span className="discover-team-context-divider" aria-hidden="true" />
              <UserAvatar
                avatarUrl={teamContext.avatarUrl}
                name={teamContext.name}
                email={teamContext.email}
                className="discover-team-context-avatar"
              />
              <span className="discover-team-context-copy" title={teamContext.email || teamContext.name}>
                <strong>{teamContext.name}</strong>
                <small>{tx('team.teamDiscoverStudentMeta', '{count} applications').replace('{count}', String(teamContext.count ?? 0))}</small>
              </span>
            </div>
            <div className="discover-statusbar-meta">
              <span>{tx('discover.statusCount', '{programs} programs · {advisors} advisors').replace('{programs}', String(props.programs.length)).replace('{advisors}', String(props.pis.length))}</span>
              {['queued', 'running'].includes(state.researchJob?.status || '') ? <span className="discover-research-status"><RefreshCw size={12} className="spin-icon" />{tx('discover.researchRunning', 'Research is running in the background')}</span> : null}
              <span>{state.lastResearchAt ? tx('discover.lastUpdated', 'Updated {time}').replace('{time}', new Date(state.lastResearchAt).toLocaleString()) : tx('discover.notUpdatedYet', 'Not updated yet')}</span>
            </div>
          </>
        ) : (
          <>
            <span>{tx('discover.statusCount', '{programs} programs · {advisors} advisors').replace('{programs}', String(props.programs.length)).replace('{advisors}', String(props.pis.length))}</span>
            {['queued', 'running'].includes(state.researchJob?.status || '') ? <span className="discover-research-status"><RefreshCw size={12} className="spin-icon" />{tx('discover.researchRunning', 'Research is running in the background')}</span> : null}
            <span>{state.lastResearchAt ? tx('discover.lastUpdated', 'Updated {time}').replace('{time}', new Date(state.lastResearchAt).toLocaleString()) : tx('discover.notUpdatedYet', 'Not updated yet')}</span>
          </>
        )}
      </div>

      {mobileFiltersOpen ? (
        <ModalPortal>
          <div
            className={`discover-mobile-overlay${mobileFiltersExiting ? ' is-exiting' : ''}`}
            role="presentation"
            onMouseDown={(event) => { if (event.currentTarget === event.target) requestMobileFiltersClose() }}
          >
            <FilterRail meta={meta} mode={mode} filters={filters} activeFilterCount={activeFilterCount} hiddenProgramCount={hiddenProgramCount} hiddenPiCount={hiddenPiCount} rankerDraft={rankerDraft} actions={actions} mobile onClose={requestMobileFiltersClose} />
          </div>
        </ModalPortal>
      ) : null}
    </div>
  )
}
