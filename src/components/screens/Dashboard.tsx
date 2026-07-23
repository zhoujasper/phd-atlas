import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Compass,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  GraduationCap,
  History,
  LayoutGrid,
  Mail,
  MapPin,
  PieChart,
  Phone,
  Plus,
  TrendingUp,
  Users,
} from 'lucide-react'
import { UserAvatar } from '../shared/UserAvatar'
import type { ApplicationRecord, ApplicationStatus } from '../../data/applications'
import { countryDisplayName } from '../../data/countries'
import { daysUntil, formatDate, priorityToLevel, priorityTone } from '../../appModel'
import type { DetailTab } from '../../appModel'
import { localizeStaticText } from '../../i18n'
import { materialStatusMenuTone, statusCssSlug, statusLabel } from '../../statusLabels'
import { StatusChip, StatusPill } from '../shared/StatusPill'
import { SwitchControl } from '../shared/SwitchControl'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { safeExternalHttpUrl, safeMailtoHref, safeTelHref } from '../../safeLinks'

const statusOrder: ApplicationStatus[] = [
  'Draft', 'Preparing', 'Submitted', 'Interview', 'Accepted', 'Rejected', 'Waitlist',
]

type StatusViewMode = 'bars' | 'donut' | 'grid'
type StatSwitchDirection = 'left' | 'right' | 'none'
type DashboardPanelKey = 'guidance' | 'byStudent' | 'priority' | 'tasks' | 'recentOpened' | 'status' | 'deadlines' | 'materials'

const statusViewModes: StatusViewMode[] = ['bars', 'donut', 'grid']

/** Donut / bar chart strokes — distinct pipeline colors (not the muted pill text tokens). */
const statusStrokeColor: Record<ApplicationStatus, string> = {
  Draft: 'var(--status-chart-draft)',
  Preparing: 'var(--status-chart-preparing)',
  Submitted: 'var(--status-chart-submitted)',
  Interview: 'var(--status-chart-interview)',
  Waitlist: 'var(--status-chart-waitlist)',
  Accepted: 'var(--status-chart-accepted)',
  Rejected: 'var(--status-chart-rejected)',
}
export type DashboardJumpTarget = {
  tab: DetailTab
  targetId: string
  fallbackText?: string[]
  expand?: { kind: 'material' | 'task'; id: string } | { kind: 'scholarship'; id: string }
}

export type DashboardGuidanceMember = {
  id: string
  name: string
  avatarUrl?: string
  role: 'owner' | 'admin'
  title?: string
  department?: string
  email?: string
  phone?: string
  office?: string
  website?: string
  availability?: string
  bio?: string
}

export type DashboardGuidanceTeam = {
  teamName: string
  members: DashboardGuidanceMember[]
}

const dossierJumpTarget: DashboardJumpTarget = { tab: 'dossier', targetId: 'dossier-config-card' }
/** Extra cards to append when the user scrolls toward the end. */
const DASHBOARD_APPLICATION_BATCH_SIZE = 4
/**
 * Fallback first-row count when the scroller width is not measurable yet
 * (SSR / jsdom). Real browsers measure how many cards fit in the viewport.
 */
const DASHBOARD_APPLICATION_FALLBACK_ROW = 6
const DEADLINE_DETAIL_MODE_KEY = 'phd-atlas-dashboard-deadline-detail:v1'
const TASK_SHOW_EXPIRED_KEY = 'phd-atlas-dashboard-tasks-show-expired:v1'
const MATERIAL_STATUS_OPTIONS = [
  'Missing',
  'Not started',
  'Draft',
  'Requested',
  'In progress',
  'Waiting',
  'Needs Review',
  'Ready',
  'Needs revision',
  'Submitted',
] as const

/** How many full cards fit in the visible horizontal “first row”. */
function getApplicationRowCapacity(scroller: HTMLElement | null): number {
  if (!scroller || scroller.clientWidth < 48) return DASHBOARD_APPLICATION_FALLBACK_ROW
  const firstCard = scroller.querySelector<HTMLElement>('.stat-application-card')
  const styles = typeof getComputedStyle === 'function' ? getComputedStyle(scroller) : null
  const gap = Number.parseFloat(styles?.columnGap || styles?.gap || '10') || 10
  const padL = Number.parseFloat(styles?.paddingLeft || '0') || 0
  const padR = Number.parseFloat(styles?.paddingRight || '0') || 0
  const cardWidth = firstCard?.getBoundingClientRect().width || 286
  if (cardWidth < 40) return DASHBOARD_APPLICATION_FALLBACK_ROW
  const usable = scroller.clientWidth - padL - padR
  return Math.max(1, Math.floor((usable + gap) / (cardWidth + gap)))
}
const DASHBOARD_DEADLINE_BATCH_SIZE = 10
const DASHBOARD_DEADLINE_INITIAL_COUNT = DASHBOARD_DEADLINE_BATCH_SIZE
const DASHBOARD_TASK_INITIAL_COUNT = 10
const DASHBOARD_TASK_BATCH_SIZE = 10
/** Strikethrough grace window before a completed task leaves the list. */
/** How long a completed checklist row stays visible before it leaves (user can undo). */
const DASHBOARD_TASK_COMPLETE_GRACE_MS = 3000
/** Exit animation length; starts this many ms before the grace window ends. */
const DASHBOARD_TASK_EXIT_MS = 420

type DashboardDeadlineItem = {
  key: string
  applicationId: string
  schoolName: string
  program: string
  label: string
  date: string
  jump: DashboardJumpTarget
}

type DashboardChecklistScope = 'application' | 'scholarship'
type DashboardChecklistKind = 'task' | 'material'
type DashboardScholarship = ApplicationRecord['scholarships'][number]
type DashboardScholarshipTask = NonNullable<DashboardScholarship['tasks']>[number]
type DashboardScholarshipMaterial = NonNullable<DashboardScholarship['materials']>[number]

type DashboardChecklistItem = {
  key: string
  kind: DashboardChecklistKind
  scope: DashboardChecklistScope
  applicationId: string
  application: ApplicationRecord
  scholarship?: DashboardScholarship
  title: string
  /** YYYY-MM-DD when present; null when a task has no due date. */
  due: string | null
  /** Free-form checklist status for materials, or open/done for tasks. */
  status: string
  task?: ApplicationRecord['tasks'][number] | DashboardScholarshipTask
  material?: ApplicationRecord['materials'][number] | DashboardScholarshipMaterial
}

function checklistJumpTarget(kind: 'material' | 'task', id: string): DashboardJumpTarget {
  return { tab: 'materials', targetId: `${kind}-${id}`, expand: { kind, id } }
}

function fundingJumpTarget(scholarshipId: string): DashboardJumpTarget {
  return {
    tab: 'funding',
    targetId: `scholarship-${scholarshipId}`,
    expand: { kind: 'scholarship', id: scholarshipId },
  }
}

function dashboardChecklistJumpTarget(item: DashboardChecklistItem): DashboardJumpTarget {
  if (item.scope === 'scholarship' && item.scholarship) {
    return fundingJumpTarget(item.scholarship.id)
  }
  const id = item.kind === 'task' ? item.task?.id : item.material?.id
  return checklistJumpTarget(item.kind, id ?? '')
}


function isDateString(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value))
}

function loadDeadlineDetailMode(): boolean {
  try {
    const raw = localStorage.getItem(DEADLINE_DETAIL_MODE_KEY)
    if (raw === null) return true
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

function loadShowExpiredTasks(): boolean {
  try {
    const raw = localStorage.getItem(TASK_SHOW_EXPIRED_KEY)
    return raw === '1' || raw === 'true'
  } catch {
    return false
  }
}

function isMaterialComplete(status: string) {
  const normalized = status.trim().toLowerCase()
  return normalized === 'submitted' || normalized === 'ready' || normalized === 'approved'
}

const dashboardPanelDefaults: Record<DashboardPanelKey, boolean> = {
  guidance: true,
  byStudent: true,
  priority: true,
  tasks: true,
  recentOpened: true,
  status: true,
  deadlines: true,
  materials: true,
}

function isActiveApplication(application: ApplicationRecord) {
  return application.status !== 'Accepted' && application.status !== 'Rejected'
}

function DashboardPanel({
  panelKey,
  title,
  icon,
  open,
  onToggle,
  headerExtra,
  children,
}: {
  panelKey: DashboardPanelKey
  title: string
  icon: ReactNode
  open: boolean
  onToggle: (key: DashboardPanelKey) => void
  headerExtra?: ReactNode
  children: ReactNode
}) {
  const { tx, format } = useI18n()
  const panelId = `dashboard-panel-${panelKey}`
  const labelTemplate = open
    ? tx('dashboard.collapsePanel', 'Collapse {title}')
    : tx('dashboard.expandPanel', 'Expand {title}')

  return (
    <section className={`dashboard-card dashboard-panel dashboard-panel-${panelKey} dashboard-progressive-surface ${open ? 'expanded' : 'collapsed'}`}>
      <div className="card-header dashboard-panel-header">
        <h3>{title}</h3>
        <div className="dashboard-panel-header-actions">
          {headerExtra}
          <span className="dashboard-panel-icon" aria-hidden="true">{icon}</span>
          <button
            type="button"
            className="dashboard-panel-toggle"
            onClick={() => onToggle(panelKey)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={format(labelTemplate, { title })}
          >
            <ChevronDown size={15} aria-hidden="true" className="dashboard-panel-chevron" />
          </button>
        </div>
      </div>
      <CollapsiblePanel
        open={open}
        id={panelId}
        className="dashboard-panel-collapse"
        innerClassName="dashboard-panel-content"
      >
        {children}
      </CollapsiblePanel>
    </section>
  )
}

export function Dashboard({
  applications,
  recentOpenedIds = [],
  onSelect,
  onOpenInNewPage,
  onExportApplication,
  onCopy,
  onToggleTask,
  onPatchMaterialStatus,
  onToggleScholarshipTask,
  onPatchScholarshipMaterialStatus,
  onNew,
  onOpenDiscover,
  guidanceTeam,
  ownerNames,
  ownerDirectory,
  ownerAvatars,
  onViewMember,
  eyebrow,
  title,
  subtitle,
  deferProgressiveReveal = false,
}: {
  applications: ApplicationRecord[]
  recentOpenedIds?: string[]
  onSelect: (id: string, target?: DashboardJumpTarget) => void
  onOpenInNewPage?: (id: string) => void
  onExportApplication?: (id: string) => void
  onCopy?: (value: string, label: string) => void
  onToggleTask?: (applicationId: string, taskId: string, done: boolean) => void | Promise<void>
  onPatchMaterialStatus?: (applicationId: string, materialId: string, status: string) => void | Promise<void>
  onToggleScholarshipTask?: (
    applicationId: string,
    scholarshipId: string,
    taskId: string,
    done: boolean,
  ) => void | Promise<void>
  onPatchScholarshipMaterialStatus?: (
    applicationId: string,
    scholarshipId: string,
    materialId: string,
    status: string,
  ) => void | Promise<void>
  // Omitted entirely in the team-scoped "Overview" (institution admin/teacher browsing
  // their team's applications) — no one creates an application on someone else's behalf here.
  onNew?: () => void
  /** Personal dashboard only — opens the Discover program finder. */
  onOpenDiscover?: () => void
  /** Student-only, permission-scoped organization contacts shown on the personal dashboard. */
  guidanceTeam?: DashboardGuidanceTeam
  // applicationId -> owner display name, populated only when this Dashboard is showing the
  // team-scoped list (multiple owners); absent in the personal dashboard.
  ownerNames?: Record<string, string>
  // ownerId -> display name for EVERY team-visible owner, including the viewer themselves.
  // Presence of this prop (rather than ownerNames, which excludes self) is what turns on the
  // "By student" breakdown panel below — it needs to group the viewer's own apps too.
  ownerDirectory?: Record<string, string>
  ownerAvatars?: Record<string, string | undefined>
  onViewMember?: (ownerId: string) => void
  eyebrow?: string
  title?: string
  subtitle?: string
  /** Hold secondary dashboard panels until the enclosing screen handoff ends. */
  deferProgressiveReveal?: boolean
}) {
  const { tx, format, lang } = useI18n()
  const [statusViewMode, setStatusViewMode] = useState<StatusViewMode>('donut')
  const [statusViewDirection, setStatusViewDirection] = useState<StatSwitchDirection>('none')
  const [openPanels, setOpenPanels] = useState<Record<DashboardPanelKey, boolean>>(dashboardPanelDefaults)
  const [expandedGuidanceMemberId, setExpandedGuidanceMemberId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [deadlineDetailed, setDeadlineDetailed] = useState(loadDeadlineDetailMode)
  const [deadlineVisibleCount, setDeadlineVisibleCount] = useState(DASHBOARD_DEADLINE_INITIAL_COUNT)
  const [taskVisibleCount, setTaskVisibleCount] = useState(DASHBOARD_TASK_INITIAL_COUNT)
  const [showExpiredTasks, setShowExpiredTasks] = useState(loadShowExpiredTasks)
  const [taskCompletionState, setTaskCompletionState] = useState<Record<string, 'pending' | 'exiting'>>({})
  const [hiddenTaskKeys, setHiddenTaskKeys] = useState<Set<string>>(() => new Set())
  const applicationScrollerRef = useRef<HTMLDivElement | null>(null)
  const deadlineListRef = useRef<HTMLDivElement | null>(null)
  const taskListRef = useRef<HTMLDivElement | null>(null)
  const taskCompletionTimersRef = useRef<Map<string, number[]>>(new Map())
  const [applicationScrollState, setApplicationScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
  const [renderedApplicationCount, setRenderedApplicationCount] = useState(DASHBOARD_APPLICATION_FALLBACK_ROW)
  const maxRevealPhase = ownerDirectory ? 6 : 5
  const [revealPhase, setRevealPhase] = useState(0)
  const byStudentReady = Boolean(ownerDirectory) && revealPhase >= 1
  const focusPanelsReady = revealPhase >= (ownerDirectory ? 2 : 1)
  const priorityReady = focusPanelsReady
  const deadlinesReady = focusPanelsReady
  const statusReady = revealPhase >= (ownerDirectory ? 3 : 2)
  const recentOpenedReady = revealPhase >= (ownerDirectory ? 4 : 3)
  const materialsReady = revealPhase >= (ownerDirectory ? 5 : 4)
  const totalApps = applications.length
  const renderedApplications = useMemo(
    () => applications.slice(0, renderedApplicationCount),
    [applications, renderedApplicationCount],
  )
  const hasMoreApplications = renderedApplicationCount < totalApps
  const localize = (value: string) => localizeStaticText(value, lang)
  const versionLabel = (version: string) => version.startsWith('v') ? version : `v${version}`
  const professorDisplayName = (application: ApplicationRecord) =>
    lang === 'zh' && application.professor.chinese ? application.professor.chinese : application.professor.english
  const applicationById = useMemo(
    () => materialsReady
      ? new Map(applications.map((application) => [application.id, application]))
      : new Map<string, ApplicationRecord>(),
    [applications, materialsReady],
  )

  const dashboardChecklistItems = useMemo(() => {
    const items: DashboardChecklistItem[] = []

    for (const application of applications) {
      for (const task of application.tasks) {
        if (task.done) continue
        items.push({
          key: `${application.id}:task:${task.id}`,
          kind: 'task',
          scope: 'application',
          applicationId: application.id,
          application,
          title: task.title,
          due: isDateString(task.due) ? task.due : null,
          status: 'Open',
          task,
        })
      }
      for (const material of application.materials) {
        if (!material.reminderEnabled || !isDateString(material.reminderDate)) continue
        if (isMaterialComplete(material.status ?? '')) continue
        items.push({
          key: `${application.id}:material:${material.id}`,
          kind: 'material',
          scope: 'application',
          applicationId: application.id,
          application,
          title: material.name,
          due: material.reminderDate!,
          status: material.status || 'Draft',
          material,
        })
      }
      for (const scholarship of application.scholarships) {
        for (const material of scholarship.materials ?? []) {
          if (!isDateString(material.due) || isMaterialComplete(material.status ?? '')) continue
          items.push({
            key: `${application.id}:scholarship:${scholarship.id}:material:${material.id}`,
            kind: 'material',
            scope: 'scholarship',
            applicationId: application.id,
            application,
            scholarship,
            title: material.name,
            due: material.due!,
            status: material.status || 'Draft',
            material,
          })
        }
        for (const task of scholarship.tasks ?? []) {
          if (task.done) continue
          items.push({
            key: `${application.id}:scholarship:${scholarship.id}:task:${task.id}`,
            kind: 'task',
            scope: 'scholarship',
            applicationId: application.id,
            application,
            scholarship,
            title: task.title,
            due: isDateString(task.due) ? task.due : null,
            status: 'Open',
            task,
          })
        }
      }
    }

    return items.filter((item) => !hiddenTaskKeys.has(item.key))
  }, [applications, hiddenTaskKeys])

  const sortChecklistItems = useCallback((items: typeof dashboardChecklistItems, expiredBlock: boolean) => (
    [...items].sort((a, b) => {
      const aHasDate = Boolean(a.due)
      const bHasDate = Boolean(b.due)
      if (aHasDate && bHasDate) {
        // Upcoming: nearest first. Expired block: most recently expired first.
        const byDate = expiredBlock
          ? b.due!.localeCompare(a.due!)
          : a.due!.localeCompare(b.due!)
        if (byDate !== 0) return byDate
      } else if (aHasDate !== bHasDate) {
        return aHasDate ? -1 : 1
      }
      const byPriority = b.application.priority - a.application.priority
      if (byPriority !== 0) return byPriority
      return a.title.localeCompare(b.title)
    })
  ), [])

  const upcomingTaskItems = useMemo(() => (
    sortChecklistItems(
      dashboardChecklistItems.filter((item) => !item.due || daysUntil(item.due) >= 0),
      false,
    )
  ), [dashboardChecklistItems, sortChecklistItems])

  const expiredTaskItems = useMemo(() => (
    sortChecklistItems(
      dashboardChecklistItems.filter((item) => Boolean(item.due && daysUntil(item.due) < 0)),
      true,
    )
  ), [dashboardChecklistItems, sortChecklistItems])

  const expiredTaskCount = expiredTaskItems.length
  const [expiredTasksMounted, setExpiredTasksMounted] = useState(showExpiredTasks && expiredTaskCount > 0)
  const [expiredTasksOpen, setExpiredTasksOpen] = useState(showExpiredTasks && expiredTaskCount > 0)

  useEffect(() => {
    if (expiredTaskCount === 0) {
      setExpiredTasksOpen(false)
      setExpiredTasksMounted(false)
      return undefined
    }
    if (showExpiredTasks) {
      setExpiredTasksMounted(true)
      let frame2 = 0
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => setExpiredTasksOpen(true))
      })
      return () => {
        window.cancelAnimationFrame(frame1)
        window.cancelAnimationFrame(frame2)
      }
    }

    setExpiredTasksOpen(false)
    const timer = window.setTimeout(() => {
      setExpiredTasksMounted(false)
    }, getMotionDelay(340))
    return () => window.clearTimeout(timer)
  }, [expiredTaskCount, showExpiredTasks])

  // Visible upcoming rows only (expired block animates as a group above).
  const visibleTaskItems = useMemo(
    () => upcomingTaskItems.slice(0, taskVisibleCount),
    [upcomingTaskItems, taskVisibleCount],
  )
  const hasMoreTasks = taskVisibleCount < upcomingTaskItems.length
  const openTaskCount = upcomingTaskItems.length + (showExpiredTasks || expiredTasksMounted ? expiredTaskCount : 0)
  const hasVisibleTaskRows = visibleTaskItems.length > 0 || (expiredTasksMounted && expiredTaskCount > 0)


  useEffect(() => {
    setRenderedApplicationCount((current) => {
      if (totalApps === 0) return DASHBOARD_APPLICATION_FALLBACK_ROW
      // Never keep more than available; never drop below a sensible first-row floor.
      return Math.min(totalApps, Math.max(current, Math.min(DASHBOARD_APPLICATION_FALLBACK_ROW, totalApps)))
    })
  }, [totalApps])

  useEffect(() => {
    setTaskVisibleCount((current) => {
      if (upcomingTaskItems.length === 0) return DASHBOARD_TASK_INITIAL_COUNT
      return Math.min(Math.max(current, DASHBOARD_TASK_INITIAL_COUNT), upcomingTaskItems.length)
    })
  }, [upcomingTaskItems.length])

  const clearTaskCompletionTimers = useCallback((key: string) => {
    const timers = taskCompletionTimersRef.current.get(key)
    if (!timers) return
    timers.forEach((timer) => window.clearTimeout(timer))
    taskCompletionTimersRef.current.delete(key)
  }, [])

  useEffect(() => () => {
    for (const timers of taskCompletionTimersRef.current.values()) {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
    taskCompletionTimersRef.current.clear()
  }, [])

  const loadMoreTasksIfNeeded = useCallback(() => {
    const scroller = taskListRef.current
    if (!scroller || !hasMoreTasks) return
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (remaining <= 72 || scroller.scrollHeight <= scroller.clientHeight + 4) {
      setTaskVisibleCount((current) => Math.min(upcomingTaskItems.length, current + DASHBOARD_TASK_BATCH_SIZE))
    }
  }, [hasMoreTasks, upcomingTaskItems.length])

  const handleTaskListScroll = useCallback(() => {
    loadMoreTasksIfNeeded()
  }, [loadMoreTasksIfNeeded])

  useEffect(() => {
    if (!hasMoreTasks) return undefined
    const frame = window.requestAnimationFrame(loadMoreTasksIfNeeded)
    return () => window.cancelAnimationFrame(frame)
  }, [hasMoreTasks, taskVisibleCount, loadMoreTasksIfNeeded])

  /** Ensure the first visible row is fully populated (+ one peek card when more exist). */
  const ensureApplicationFirstRow = useCallback(() => {
    const scroller = applicationScrollerRef.current
    if (totalApps === 0) return
    const row = getApplicationRowCapacity(scroller)
    setRenderedApplicationCount((current) => {
      const peek = totalApps > row ? 1 : 0
      let next = Math.max(current, Math.min(totalApps, row + peek))
      // If the track still does not overflow but more apps exist, keep adding rows.
      if (
        scroller
        && totalApps > next
        && scroller.clientWidth > 48
        && scroller.scrollWidth <= scroller.clientWidth + 8
      ) {
        next = Math.min(totalApps, next + row)
      }
      return next
    })
  }, [totalApps])

  useEffect(() => {
    const reducedMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setRevealPhase(maxRevealPhase)
      return undefined
    }

    if (deferProgressiveReveal) return undefined

    let cancelled = false
    let frame = 0
    let timer = 0
    let nextPhase = 1
    setRevealPhase(0)

    const scheduleNext = (delay: number) => {
      timer = window.setTimeout(() => {
        frame = window.requestAnimationFrame(revealNext)
      }, delay)
    }

    const revealNext = () => {
      if (cancelled) return
      setRevealPhase(nextPhase)
      nextPhase += 1
      if (nextPhase > maxRevealPhase) return
      scheduleNext(88)
    }

    scheduleNext(120)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [deferProgressiveReveal, maxRevealPhase])

  const upcomingSummary = useMemo(
    () =>
      deadlinesReady ? applications
        .filter((a) => daysUntil(a.deadline) >= 0 && isActiveApplication(a))
        .sort((a, b) => a.deadline.localeCompare(b.deadline)) : [],
    [applications, deadlinesReady],
  )

  // Detailed mode: every in-app deadline (tasks, materials, scholarships…), not just the main DDL.
  const upcomingDetailed = useMemo(() => {
    if (!deadlinesReady) return [] as DashboardDeadlineItem[]
    const localize = (value: string) => localizeStaticText(value, lang)
    const items: DashboardDeadlineItem[] = []

    for (const application of applications) {
      if (!isActiveApplication(application)) continue
      const schoolName = application.school.name
      const program = application.program

      if (isDateString(application.deadline) && daysUntil(application.deadline) >= 0) {
        items.push({
          key: `${application.id}:application-deadline`,
          applicationId: application.id,
          schoolName,
          program,
          label: tx('dashboard.deadlineKindApplication', 'Application deadline'),
          date: application.deadline,
          jump: dossierJumpTarget,
        })
      }

      for (const material of application.materials) {
        if (!material.reminderEnabled || !isDateString(material.reminderDate)) continue
        if (daysUntil(material.reminderDate!) < 0) continue
        items.push({
          key: `${application.id}:material-${material.id}`,
          applicationId: application.id,
          schoolName,
          program,
          label: format(tx('dashboard.deadlineKindMaterial', 'Checklist · {name}'), { name: localize(material.name) }),
          date: material.reminderDate!,
          jump: checklistJumpTarget('material', material.id),
        })
      }

      for (const task of application.tasks) {
        if (task.done || !isDateString(task.due)) continue
        if (daysUntil(task.due) < 0) continue
        items.push({
          key: `${application.id}:task-${task.id}`,
          applicationId: application.id,
          schoolName,
          program,
          label: format(tx('dashboard.deadlineKindTask', 'Task · {name}'), { name: localize(task.title) }),
          date: task.due,
          jump: checklistJumpTarget('task', task.id),
        })
      }

      for (const scholarship of application.scholarships) {
        if (isDateString(scholarship.endDate) && daysUntil(scholarship.endDate) >= 0) {
          items.push({
            key: `${application.id}:scholarship-${scholarship.id}`,
            applicationId: application.id,
            schoolName,
            program,
            label: format(tx('dashboard.deadlineKindScholarship', 'Funding · {name}'), { name: localize(scholarship.name) }),
            date: scholarship.endDate,
            jump: fundingJumpTarget(scholarship.id),
          })
        }
        for (const material of scholarship.materials ?? []) {
          if (!isDateString(material.due) || daysUntil(material.due!) < 0) continue
          items.push({
            key: `${application.id}:sch-mat-${scholarship.id}-${material.id}`,
            applicationId: application.id,
            schoolName,
            program,
            label: format(tx('dashboard.deadlineKindScholarshipMaterial', 'Funding material · {name}'), {
              name: localize(material.name),
            }),
            date: material.due!,
            jump: fundingJumpTarget(scholarship.id),
          })
        }
        for (const task of scholarship.tasks ?? []) {
          if (task.done || !isDateString(task.due) || daysUntil(task.due) < 0) continue
          items.push({
            key: `${application.id}:sch-task-${scholarship.id}-${task.id}`,
            applicationId: application.id,
            schoolName,
            program,
            label: format(tx('dashboard.deadlineKindScholarshipTask', 'Funding task · {name}'), {
              name: localize(task.title),
            }),
            date: task.due,
            jump: fundingJumpTarget(scholarship.id),
          })
        }
      }
    }

    return items.sort((a, b) => a.date.localeCompare(b.date) || a.schoolName.localeCompare(b.schoolName))
  }, [applications, deadlinesReady, format, lang, tx])

  const deadlineTotalCount = deadlineDetailed ? upcomingDetailed.length : upcomingSummary.length
  const visibleDetailedDeadlines = useMemo(
    () => upcomingDetailed.slice(0, deadlineVisibleCount),
    [upcomingDetailed, deadlineVisibleCount],
  )
  const visibleSummaryDeadlines = useMemo(
    () => upcomingSummary.slice(0, deadlineVisibleCount),
    [upcomingSummary, deadlineVisibleCount],
  )
  const hasMoreDeadlines = deadlineVisibleCount < deadlineTotalCount

  useEffect(() => {
    try {
      localStorage.setItem(DEADLINE_DETAIL_MODE_KEY, deadlineDetailed ? '1' : '0')
    } catch {
      // ignore quota / private mode
    }
  }, [deadlineDetailed])

  useEffect(() => {
    try {
      localStorage.setItem(TASK_SHOW_EXPIRED_KEY, showExpiredTasks ? '1' : '0')
    } catch {
      // ignore quota / private mode
    }
  }, [showExpiredTasks])

  useEffect(() => {
    setTaskVisibleCount(DASHBOARD_TASK_INITIAL_COUNT)
    const scroller = taskListRef.current
    if (scroller) scroller.scrollTop = 0
  }, [showExpiredTasks])

  // Reset progressive window when switching detailed/summary or the dataset shrinks.
  useEffect(() => {
    setDeadlineVisibleCount(DASHBOARD_DEADLINE_INITIAL_COUNT)
    const scroller = deadlineListRef.current
    if (scroller) scroller.scrollTop = 0
  }, [deadlineDetailed])

  useEffect(() => {
    setDeadlineVisibleCount((current) => {
      if (deadlineTotalCount === 0) return DASHBOARD_DEADLINE_INITIAL_COUNT
      return Math.min(Math.max(current, DASHBOARD_DEADLINE_INITIAL_COUNT), deadlineTotalCount)
    })
  }, [deadlineTotalCount])

  const loadMoreDeadlinesIfNeeded = useCallback(() => {
    const scroller = deadlineListRef.current
    if (!scroller || !hasMoreDeadlines) return
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    // Near the end, or the list does not yet fill the max-height viewport.
    if (remaining <= 72 || scroller.scrollHeight <= scroller.clientHeight + 4) {
      setDeadlineVisibleCount((current) => Math.min(deadlineTotalCount, current + DASHBOARD_DEADLINE_BATCH_SIZE))
    }
  }, [deadlineTotalCount, hasMoreDeadlines])

  const handleDeadlineListScroll = useCallback(() => {
    loadMoreDeadlinesIfNeeded()
  }, [loadMoreDeadlinesIfNeeded])

  // Keep filling until the scroll area is scrollable or the full dataset is shown.
  useEffect(() => {
    if (!hasMoreDeadlines) return undefined
    const frame = window.requestAnimationFrame(loadMoreDeadlinesIfNeeded)
    return () => window.cancelAnimationFrame(frame)
  }, [hasMoreDeadlines, deadlineVisibleCount, loadMoreDeadlinesIfNeeded, deadlineDetailed])

  const priorityApplications = useMemo(
    () =>
      priorityReady ? applications
        .filter(isActiveApplication)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 6) : [],
    [applications, priorityReady],
  )

  // Team Overview only (see ownerDirectory) — groups applications by owner so an institution
  // admin/teacher can see at a glance who has upcoming deadlines or stalled progress, ranked by
  // nearest active deadline first (the person who most needs attention surfaces to the top).
  const byStudent = useMemo(() => {
    if (!ownerDirectory || !byStudentReady) return []
    const groups = new Map<string, { ownerId: string; name: string; apps: ApplicationRecord[] }>()
    for (const application of applications) {
      const ownerId = application.ownerId
      if (!ownerId) continue
      if (!groups.has(ownerId)) {
        groups.set(ownerId, { ownerId, name: ownerDirectory[ownerId] ?? ownerId, apps: [] })
      }
      groups.get(ownerId)!.apps.push(application)
    }
    return Array.from(groups.values())
      .map((group) => {
        const nextDeadline = group.apps
          .filter(isActiveApplication)
          .map((application) => daysUntil(application.deadline))
          .filter((days) => days >= 0)
          .sort((a, b) => a - b)[0]
        const avgProgress = Math.round(
          group.apps.reduce((sum, application) => sum + application.progress, 0) / group.apps.length,
        )
        return { ownerId: group.ownerId, name: group.name, count: group.apps.length, avgProgress, nextDeadline }
      })
      .sort((a, b) => {
        if (a.nextDeadline == null && b.nextDeadline == null) return a.name.localeCompare(b.name)
        if (a.nextDeadline == null) return 1
        if (b.nextDeadline == null) return -1
        return a.nextDeadline - b.nextDeadline
      })
  }, [applications, byStudentReady, ownerDirectory])

  const statusCounts = useMemo(
    () =>
      statusReady ? statusOrder.map((s) => ({
        status: s,
        count: applications.filter((a) => a.status === s).length,
      })) : [],
    [applications, statusReady],
  )
  const maxCount = useMemo(() => Math.max(...statusCounts.map((s) => s.count), 1), [statusCounts])

  const recentMaterials = useMemo(
    () =>
      materialsReady ? applications
        .flatMap((a) =>
          a.materials.map((material) => ({
            ...material,
            school: a.school.name,
            appId: a.id,
          })),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 4) : [],
    [applications, materialsReady],
  )

  const recentOpened = useMemo(() => {
    if (!recentOpenedReady) return []
    const byId = new Map(applications.map((application) => [application.id, application]))
    return recentOpenedIds
      .map((id) => byId.get(id))
      .filter((application): application is ApplicationRecord => Boolean(application))
      .slice(0, 5)
  }, [applications, recentOpenedIds, recentOpenedReady])

  const statusTotal = useMemo(
    () => statusCounts.reduce((sum, item) => sum + item.count, 0),
    [statusCounts],
  )

  const updateApplicationScrollState = useCallback(() => {
    const scroller = applicationScrollerRef.current
    if (!scroller) {
      setApplicationScrollState((current) => (
        current.canScrollLeft || current.canScrollRight
          ? { canScrollLeft: false, canScrollRight: false }
          : current
      ))
      return
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth
    const next = {
      canScrollLeft: scroller.scrollLeft > 2,
      canScrollRight: hasMoreApplications || scroller.scrollLeft < maxScrollLeft - 2,
    }

    setApplicationScrollState((current) => (
      current.canScrollLeft === next.canScrollLeft && current.canScrollRight === next.canScrollRight
        ? current
        : next
    ))
  }, [hasMoreApplications])

  const loadMoreApplicationCards = useCallback((minBatch?: number) => {
    const scroller = applicationScrollerRef.current
    const row = getApplicationRowCapacity(scroller)
    const batch = Math.max(minBatch ?? 0, row, DASHBOARD_APPLICATION_BATCH_SIZE)
    setRenderedApplicationCount((current) => Math.min(totalApps, current + batch))
  }, [totalApps])

  const handleApplicationScroll = useCallback(() => {
    updateApplicationScrollState()
    const scroller = applicationScrollerRef.current
    if (!scroller || !hasMoreApplications) return
    const firstCard = scroller.querySelector<HTMLElement>('.stat-application-card')
    const cardWidth = firstCard?.getBoundingClientRect().width ?? 280
    // Start loading ~2 cards before the end so scrolling stays smooth.
    const preloadDistance = (cardWidth + 10) * 2
    if (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - preloadDistance) {
      loadMoreApplicationCards()
    }
  }, [hasMoreApplications, loadMoreApplicationCards, updateApplicationScrollState])

  useEffect(() => {
    const scroller = applicationScrollerRef.current
    const frame = window.requestAnimationFrame(() => {
      ensureApplicationFirstRow()
      updateApplicationScrollState()
    })
    const onResize = () => {
      ensureApplicationFirstRow()
      updateApplicationScrollState()
    }
    window.addEventListener('resize', onResize)

    let resizeObserver: ResizeObserver | null = null
    if (scroller && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(scroller)
      if (scroller.firstElementChild) resizeObserver.observe(scroller.firstElementChild)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
    }
  }, [ensureApplicationFirstRow, renderedApplicationCount, totalApps, updateApplicationScrollState])

  const scrollApplicationCards = (direction: -1 | 1) => {
    const scroller = applicationScrollerRef.current
    if (!scroller) return

    const firstCard = scroller.querySelector<HTMLElement>('.stat-application-card')
    const cardWidth = firstCard?.getBoundingClientRect().width ?? 280
    const gap = 10
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth
    const nearEnd = scroller.scrollLeft >= maxScrollLeft - 2
    if (direction > 0 && hasMoreApplications && nearEnd) {
      loadMoreApplicationCards()
      window.requestAnimationFrame(() => {
        scroller.scrollBy({ left: cardWidth + gap, behavior: reduceMotion ? 'auto' : 'smooth' })
      })
      return
    }
    // Prefetch while paging right so the next row is already in the DOM.
    if (direction > 0 && hasMoreApplications) {
      const firstCardWidth = cardWidth + gap
      if (scroller.scrollLeft + scroller.clientWidth + firstCardWidth * 1.5 >= scroller.scrollWidth) {
        loadMoreApplicationCards()
      }
    }

    scroller.scrollBy({
      left: direction * (cardWidth + gap),
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  const handleApplicationScrollerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      scrollApplicationCards(-1)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      scrollApplicationCards(1)
    }
  }

  const setStatusView = (mode: StatusViewMode) => {
    if (mode === statusViewMode) return
    const from = statusViewModes.indexOf(statusViewMode)
    const to = statusViewModes.indexOf(mode)
    setStatusViewDirection(to > from ? 'right' : to < from ? 'left' : 'none')
    setStatusViewMode(mode)
  }

  const toggleDashboardPanel = (key: DashboardPanelKey) => {
    setOpenPanels((current) => ({ ...current, [key]: !current[key] }))
  }

  const cancelPendingTaskCompletion = useCallback((key: string) => {
    clearTaskCompletionTimers(key)
    setTaskCompletionState((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setHiddenTaskKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }, [clearTaskCompletionTimers])

  const completeDashboardTask = useCallback((item: DashboardChecklistItem) => {
    const canComplete = item.kind === 'task'
      ? Boolean(item.task && (
          item.scope === 'scholarship' ? onToggleScholarshipTask : onToggleTask
        ))
      : Boolean(item.material && (
          item.scope === 'scholarship' ? onPatchScholarshipMaterialStatus : onPatchMaterialStatus
        ))
    if (!canComplete) return

    const state = taskCompletionState[item.key]
    // Second click during the grace window restores the open state.
    if (state === 'pending' || state === 'exiting') {
      cancelPendingTaskCompletion(item.key)
      return
    }

    setTaskCompletionState((current) => ({ ...current, [item.key]: 'pending' }))
    const exitTimer = window.setTimeout(() => {
      setTaskCompletionState((current) => {
        if (current[item.key] !== 'pending') return current
        return { ...current, [item.key]: 'exiting' }
      })
    }, Math.max(0, DASHBOARD_TASK_COMPLETE_GRACE_MS - DASHBOARD_TASK_EXIT_MS))
    const commitTimer = window.setTimeout(() => {
      setHiddenTaskKeys((current) => new Set(current).add(item.key))
      let commit: Promise<void | undefined>
      if (item.kind === 'task' && item.task) {
        commit = item.scope === 'scholarship' && item.scholarship
          ? Promise.resolve(onToggleScholarshipTask?.(item.applicationId, item.scholarship.id, item.task.id, true))
          : Promise.resolve(onToggleTask?.(item.applicationId, item.task.id, true))
      } else if (item.kind === 'material' && item.material) {
        commit = item.scope === 'scholarship' && item.scholarship
          ? Promise.resolve(onPatchScholarshipMaterialStatus?.(
              item.applicationId,
              item.scholarship.id,
              item.material.id,
              'Submitted',
            ))
          : Promise.resolve(onPatchMaterialStatus?.(item.applicationId, item.material.id, 'Submitted'))
      } else {
        commit = Promise.resolve()
      }
      void commit
        .catch(() => {
          setHiddenTaskKeys((current) => {
            const next = new Set(current)
            next.delete(item.key)
            return next
          })
        })
        .finally(() => {
          setTaskCompletionState((current) => {
            const next = { ...current }
            delete next[item.key]
            return next
          })
          taskCompletionTimersRef.current.delete(item.key)
        })
    }, DASHBOARD_TASK_COMPLETE_GRACE_MS)
    taskCompletionTimersRef.current.set(item.key, [exitTimer, commitTimer])
  }, [
    cancelPendingTaskCompletion,
    onPatchMaterialStatus,
    onPatchScholarshipMaterialStatus,
    onToggleScholarshipTask,
    onToggleTask,
    taskCompletionState,
  ])

  const openDashboardApplication = useCallback((id: string, target?: DashboardJumpTarget) => {
    onSelect(id, target)
  }, [onSelect])

  const openDashboardApplicationContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    application: ApplicationRecord,
    target?: DashboardJumpTarget,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    // The card's right-button mousedown suppresses browser focus. Do not restore
    // focus here: even preventScroll focus can re-engage scroll snapping in some
    // engines while the carousel is still settling.
    const trigger = event.currentTarget
    const scrollLockTarget = trigger.closest<HTMLElement>('.stat-application-grid')
    const professorName = professorDisplayName(application)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: application.school.name,
      subtitle: localize(application.program),
      scrollLockTarget,
      items: [
        {
          id: 'open',
          label: tx('explorer.open'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          shortcut: 'O',
          accessKey: 'o',
          onSelect: () => openDashboardApplication(application.id, target),
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
          id: 'export-json',
          label: tx('explorer.exportApplicationJson'),
          icon: <Download size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          disabled: !onExportApplication,
          onSelect: () => onExportApplication?.(application.id),
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
          onSelect: () => onCopy?.(localize(application.program), tx('inspector.copyProgram')),
        },
        {
          id: 'copy-professor',
          label: tx('explorer.copyProfessor'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'R',
          accessKey: 'r',
          disabled: !professorName.trim() || !onCopy,
          onSelect: () => onCopy?.(professorName, tx('inspector.copyProfessor')),
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

  const renderApplicationSnapshot = () => {
    if (applications.length === 0) {
      return (
        <div className="stat-application-empty">
          <div className="empty-state-icon"><GraduationCap size={20} aria-hidden="true" /></div>
          <h3>{tx('workspace.noApps')}</h3>
          <p>{onNew ? tx('dashboard.noApplicationCards', 'Create your first application to see the project grid here.') : tx('dashboard.noApplicationCardsTeam')}</p>
          {onNew ? (
            <button type="button" className="primary-action" onClick={onNew}>
              <Plus size={14} aria-hidden="true" /> {tx('dashboard.newApplication')}
            </button>
          ) : null}
        </div>
      )
    }

    return (
      <div className="stat-application-panel">
        <div className="stat-panel-header compact">
          <div>
            <h3>{tx('dashboard.applicationSnapshot', 'Application snapshot')}</h3>
          </div>
          <span className="stat-count-badge">{format(tx('dashboard.applicationCardCount', '{count} projects'), { count: totalApps })}</span>
        </div>
        <div
          className={`stat-application-carousel${applicationScrollState.canScrollLeft ? ' can-scroll-left' : ''}${applicationScrollState.canScrollRight ? ' can-scroll-right' : ''}`}
        >
          <button
            type="button"
            className="stat-application-scroll-btn previous"
            onClick={() => scrollApplicationCards(-1)}
            disabled={!applicationScrollState.canScrollLeft}
            aria-label={tx('dashboard.scrollApplicationsLeft', 'Scroll application cards left')}
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
          <div
            ref={applicationScrollerRef}
            className="stat-application-grid"
            tabIndex={0}
            aria-label={tx('dashboard.applicationCardScroller', 'Application cards')}
            onScroll={handleApplicationScroll}
            onKeyDown={handleApplicationScrollerKeyDown}
          >
            {renderedApplications.map((application, applicationIndex) => {
              const submittedMaterials = application.materials.filter((material) => material.status === 'Submitted').length
              const openTasks = application.tasks.filter((task) => !task.done).length
              const due = daysUntil(application.deadline)
              const deadlineTone = due < 0 ? 'past' : due <= 7 ? 'urgent' : due <= 30 ? 'warning' : 'safe'
              const deadlineRelative = due < 0
                ? format(tx('workspace.daysPast'), { count: Math.abs(due) })
                : due === 0
                  ? tx('dashboard.today')
                  : format(tx('workspace.dayShort'), { count: due })
              const professorName = professorDisplayName(application)

              return (
                <button
                  key={application.id}
                  type="button"
                  className="stat-application-card dashboard-openable"
                  onClick={() => openDashboardApplication(application.id)}
                  onMouseDown={(event) => {
                    // Prevent right-click from focusing the card before contextmenu.
                    // Focus would scroll-snap the carousel and dismiss the menu.
                    if (event.button === 2) event.preventDefault()
                  }}
                  onContextMenu={(event) => openDashboardApplicationContextMenu(event, application)}
                  aria-label={format(tx('dashboard.openApplicationCard', 'Open {name}'), { name: application.school.name })}
                  aria-posinset={applicationIndex + 1}
                  aria-setsize={totalApps}
                >
                  <div
                    className="stat-application-card-head"
                    data-tour={application.id === '__phd_atlas_tour_sample__' ? 'dashboard-application-card-target' : undefined}
                  >
                    <div>
                      <strong>{application.school.name}</strong>
                      <span>{localize(application.program)}</span>
                    </div>
                    <ArrowRight size={14} aria-hidden="true" className="stat-application-arrow" />
                  </div>
                  <div className="stat-application-status-row">
                    <StatusPill status={application.status} />
                    {ownerNames?.[application.id] ? (
                      <span className="stat-owner-chip">{ownerNames[application.id]}</span>
                    ) : null}
                    <span className={`stat-deadline-chip ${deadlineTone}`}>{deadlineRelative}</span>
                  </div>
                  <div className="stat-application-meta">
                    <span>
                      <small>{tx('dossier.deadline')}</small>
                      <strong>{formatDate(application.deadline, lang)}</strong>
                    </span>
                    <span>
                      <small>{tx('dossier.professor')}</small>
                      <strong>{professorName}</strong>
                    </span>
                    <span>
                      <small>{tx('dossier.country')}</small>
                      <strong>{countryDisplayName(application.school.country, lang) || localize(application.school.country)}</strong>
                    </span>
                    <span>
                      <small>{tx('dossier.priority')}</small>
                      <strong>{format(tx('dashboard.priorityValue', 'Priority {value}'), { value: application.priority })}</strong>
                    </span>
                  </div>
                  <div className="stat-application-progress" aria-label={format(tx('dashboard.applicationProgressValue', '{value}% progress'), { value: application.progress })}>
                    <div>
                      <span>{tx('dossier.progress')}</span>
                      <strong>{application.progress}%</strong>
                    </div>
                    <div className="stat-application-progress-track">
                      <div style={{ width: `${application.progress}%` }} />
                    </div>
                  </div>
                  <div className="stat-application-foot">
                    <span>{format(tx('dashboard.materialChecklistValue', '{done}/{total} checklist'), { done: submittedMaterials, total: application.materials.length })}</span>
                    <span>{format(tx('dashboard.openTaskValue', '{count} open tasks'), { count: openTasks })}</span>
                  </div>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="stat-application-scroll-btn next"
            onClick={() => scrollApplicationCards(1)}
            disabled={!applicationScrollState.canScrollRight}
            aria-label={tx('dashboard.scrollApplicationsRight', 'Scroll application cards right')}
          >
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  const showTaskContextMenu = (item: DashboardChecklistItem, x: number, y: number) => {
    const itemTitle = localize(item.title)
    const jumpTarget = dashboardChecklistJumpTarget(item)
    const completionState = taskCompletionState[item.key]
    const isPendingComplete = completionState === 'pending' || completionState === 'exiting'
    const canToggleComplete = item.kind === 'task'
      ? Boolean(item.scope === 'scholarship' ? onToggleScholarshipTask : onToggleTask)
      : Boolean(item.scope === 'scholarship' ? onPatchScholarshipMaterialStatus : onPatchMaterialStatus)
    const patchMaterialStatus = item.kind === 'material' && item.material
      ? (status: string) => item.scope === 'scholarship' && item.scholarship
        ? onPatchScholarshipMaterialStatus?.(
            item.applicationId,
            item.scholarship.id,
            item.material!.id,
            status,
          )
        : onPatchMaterialStatus?.(item.applicationId, item.material!.id, status)
      : null
    const currentMaterialStatus = item.kind === 'material'
      ? (item.material?.status || item.status)
      : null
    const statusItems = item.kind === 'material' && item.material && patchMaterialStatus
      ? MATERIAL_STATUS_OPTIONS.map((status) => ({
          id: `status-${status}`,
          label: statusLabel(status, tx),
          radio: true as const,
          selected: currentMaterialStatus === status,
          statusTone: materialStatusMenuTone(status),
          statusSlug: statusCssSlug(status),
          disabled: isPendingComplete,
          onSelect: () => {
            if (currentMaterialStatus === status) return
            void patchMaterialStatus(status)
          },
        }))
      : []
    const sourceLabel = item.scope === 'scholarship'
      ? item.kind === 'material'
        ? tx('dashboard.scholarshipMaterialTag', 'Funding material')
        : tx('dashboard.scholarshipTaskTag', 'Funding task')
      : item.kind === 'material'
        ? tx('dashboard.checklistMaterialTag', 'Checklist')
        : tx('dashboard.checklistTaskTag', 'Task')

    setContextMenu({
      x,
      y,
      title: itemTitle,
      subtitle: [
        item.application.school.name,
        item.scholarship ? localize(item.scholarship.name) : null,
        sourceLabel,
        item.kind === 'material'
          ? statusLabel(item.status, tx)
          : tx('dashboard.taskStatusOpen', 'Open'),
      ].filter(Boolean).join(' · '),
      items: [
        {
          id: 'open-item',
          label: item.kind === 'material'
            ? tx('dashboard.jumpToMaterial', 'Jump to checklist item')
            : tx('dashboard.jumpToTask', 'Jump to task'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          shortcut: 'Enter',
          accessKey: 'enter',
          onSelect: () => openDashboardApplication(item.applicationId, jumpTarget),
        },
        {
          id: 'open-application',
          label: tx('explorer.open'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          shortcut: 'O',
          accessKey: 'o',
          onSelect: () => openDashboardApplication(item.applicationId),
        },
        {
          id: 'open-new-page',
          label: tx('explorer.openInNewPage'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          shortcut: 'N',
          accessKey: 'n',
          disabled: !onOpenInNewPage,
          onSelect: () => onOpenInNewPage?.(item.applicationId),
        },
        {
          id: isPendingComplete ? 'undo-complete' : 'mark-done',
          label: isPendingComplete
            ? tx('dashboard.undoCompleteTask', 'Undo complete')
            : item.kind === 'material'
              ? tx('dashboard.markMaterialSubmitted', 'Mark submitted')
              : tx('dashboard.markTaskDone', 'Mark complete'),
          icon: <Check size={14} aria-hidden="true" />,
          shortcut: 'Space',
          accessKey: 'space',
          disabled: !canToggleComplete,
          onSelect: () => completeDashboardTask(item),
        },
        ...(statusItems.length > 0
          ? [{
              id: 'set-status',
              label: tx('dashboard.changeMaterialStatus', 'Change status'),
              icon: <CheckCircle2 size={14} aria-hidden="true" />,
              shortcut: 'S',
              accessKey: 's',
              submenu: {
                title: tx('dashboard.changeMaterialStatus', 'Change status'),
                subtitle: tx('explorer.materialStatusMenuHint'),
                backLabel: tx('back'),
                items: statusItems,
              },
            }]
          : []),
        {
          id: 'copy-title',
          label: item.kind === 'material'
            ? tx('dashboard.copyMaterialTitle', 'Copy checklist title')
            : tx('dashboard.copyTaskTitle', 'Copy task title'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !onCopy,
          onSelect: () => onCopy?.(
            itemTitle,
            item.kind === 'material'
              ? tx('dashboard.materialTitleLabel', 'Checklist title')
              : tx('dashboard.taskTitleLabel', 'Task title'),
          ),
        },
        {
          id: 'copy-school',
          label: tx('explorer.copySchool'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(item.application.school.name, tx('inspector.copySchool')),
        },
      ],
    })
  }

  const openTaskContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: DashboardChecklistItem,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    // Drop any focus ring the browser applied for the right-click target.
    const active = document.activeElement
    if (active instanceof HTMLElement && event.currentTarget.contains(active)) {
      active.blur()
    } else if (active === event.currentTarget && event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur()
    }
    showTaskContextMenu(item, event.clientX, event.clientY)
  }

  const handleTaskItemKeyDown = (
    event: ReactKeyboardEvent<HTMLLIElement>,
    item: DashboardChecklistItem,
  ) => {
    if (event.target !== event.currentTarget) return
    const modifierPressed = event.ctrlKey || event.metaKey
    const jumpTarget = dashboardChecklistJumpTarget(item)

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const rows = Array.from(taskListRef.current?.querySelectorAll<HTMLLIElement>('.stat-task-item') ?? [])
      const index = rows.indexOf(event.currentTarget)
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(rows.length - 1, index + 1)
        : Math.max(0, index - 1)
      rows[nextIndex]?.focus()
      return
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      showTaskContextMenu(item, rect.left + 24, rect.top + Math.min(28, rect.height / 2))
      return
    }

    if (modifierPressed && event.key.toLowerCase() === 'o') {
      event.preventDefault()
      openDashboardApplication(item.applicationId)
      return
    }

    if (modifierPressed && event.key === 'Enter') {
      if (!onOpenInNewPage) return
      event.preventDefault()
      onOpenInNewPage(item.applicationId)
      return
    }

    if (modifierPressed && event.key.toLowerCase() === 'c') {
      if (!onCopy) return
      event.preventDefault()
      onCopy(
        localize(item.title),
        item.kind === 'material'
          ? tx('dashboard.materialTitleLabel', 'Checklist title')
          : tx('dashboard.taskTitleLabel', 'Task title'),
      )
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      openDashboardApplication(item.applicationId, jumpTarget)
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      completeDashboardTask(item)
    }
  }

  const renderTaskChecklist = () => {
    const renderTaskRow = (item: (typeof dashboardChecklistItems)[number], indexInGroup = 0) => {
      const completionState = taskCompletionState[item.key]
      const isPendingComplete = completionState === 'pending' || completionState === 'exiting'
      const hasDueDate = Boolean(item.due)
      const due = hasDueDate ? daysUntil(item.due!) : null
      const isExpired = due != null && due < 0
      const dueTone = due != null && due < 0
        ? 'danger'
        : due != null && due <= 3
          ? 'danger'
          : due != null && due <= 7
            ? 'warning'
            : ''
      const dueLabel = due == null
        ? tx('dashboard.noDate', 'No date')
        : due < 0
          ? format(tx('workspace.daysPast'), { count: Math.abs(due) })
          : due === 0
            ? tx('dashboard.today', 'Today')
            : format(tx('dashboard.dayShort', '{count}d'), { count: due })
      const itemTitle = localize(item.title)
      const jumpTarget = dashboardChecklistJumpTarget(item)
      const canToggleComplete = item.kind === 'task'
        ? Boolean(item.scope === 'scholarship' ? onToggleScholarshipTask : onToggleTask)
        : Boolean(item.scope === 'scholarship' ? onPatchScholarshipMaterialStatus : onPatchMaterialStatus)
      return (
        <li
          key={item.key}
          className={`stat-task-item${isPendingComplete ? ' is-pending-done' : ''}${completionState === 'exiting' ? ' is-exiting' : ''}${isExpired ? ' is-expired' : ''}${item.kind === 'material' ? ' is-material' : ''}${item.scope === 'scholarship' ? ' is-scholarship' : ''}`}
          style={isExpired ? { ['--expired-stagger' as string]: `${Math.min(indexInGroup, 8) * 28}ms` } : undefined}
          tabIndex={0}
          data-dashboard-checklist-key={item.key}
          aria-label={`${itemTitle}, ${item.application.school.name}, ${dueLabel}`}
          onMouseDown={(event) => {
            // Right-click must not focus the row (blue focus ring).
            if (event.button === 2) event.preventDefault()
          }}
          onContextMenu={(event) => openTaskContextMenu(event, item)}
          onKeyDown={(event) => handleTaskItemKeyDown(event, item)}
        >
          <button
            type="button"
            className="stat-task-toggle"
            onMouseDown={(event) => {
              if (event.button === 2) event.preventDefault()
            }}
            onClick={() => {
              if (canToggleComplete) completeDashboardTask(item)
              else openDashboardApplication(item.applicationId, jumpTarget)
            }}
            aria-label={canToggleComplete
              ? (isPendingComplete
                ? format(tx('dashboard.undoCompleteTaskNamed', 'Undo complete: {title}'), { title: itemTitle })
                : format(
                  item.kind === 'material'
                    ? tx('dashboard.markMaterialSubmittedNamed', 'Mark submitted: {title}')
                    : tx('dashboard.markTaskDoneNamed', 'Mark complete: {title}'),
                  { title: itemTitle },
                ))
              : format(tx('dashboard.jumpToTaskNamed', 'Jump to {title}'), { title: itemTitle })}
          >
            <span className={`stat-task-check${isPendingComplete ? ' on' : ''}`} aria-hidden="true">
              {isPendingComplete
                ? <CheckCircle2 size={18} strokeWidth={2.1} className="stat-task-check-icon" />
                : <Circle size={18} strokeWidth={1.85} className="stat-task-check-icon" />}
            </span>
            <span className="stat-task-body">
              <span className="stat-task-title-wrap"><span className="stat-task-title">{itemTitle}</span></span>
              <span className="stat-task-sub">
                <em>
                  {item.application.school.name}
                  <span className={`stat-task-kind kind-${item.kind}${item.scope === 'scholarship' ? ' is-scholarship' : ''}`}>
                    {item.scope === 'scholarship'
                      ? item.kind === 'material'
                        ? tx('dashboard.scholarshipMaterialTag', 'Funding material')
                        : tx('dashboard.scholarshipTaskTag', 'Funding task')
                      : item.kind === 'material'
                        ? tx('dashboard.checklistMaterialTag', 'Checklist')
                        : tx('dashboard.checklistTaskTag', 'Task')}
                  </span>
                </em>
                <span className="stat-task-meta-end">
                  <StatusChip
                    status={item.kind === 'material'
                      ? (item.status || 'Draft')
                      : (isPendingComplete ? 'Done' : 'Open')}
                    className={isExpired ? 'is-expired-context' : ''}
                  />
                  <span className={`stat-task-due ${dueTone}`}>{dueLabel}</span>
                </span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="stat-task-jump"
            onClick={() => openDashboardApplication(item.applicationId, jumpTarget)}
            aria-label={format(tx('dashboard.jumpToTaskNamed', 'Jump to {title}'), { title: itemTitle })}
            title={item.kind === 'material'
              ? tx('dashboard.jumpToMaterial', 'Jump to checklist item')
              : tx('dashboard.jumpToTask', 'Jump to task')}
          >
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </li>
      )
    }

    return (
      <DashboardPanel
        panelKey="tasks"
        title={tx('dashboard.taskChecklist', 'Task checklist')}
        icon={<CheckCheck size={16} aria-hidden="true" />}
        open={openPanels.tasks ?? true}
        onToggle={toggleDashboardPanel}
        headerExtra={(
          <div className="dashboard-panel-header-tools">
            {expiredTaskCount > 0 ? (
              <label className="deadline-mode-control">
                <span className="deadline-mode-label">
                  {showExpiredTasks
                    ? tx('dashboard.hideExpiredTasks', 'Hide expired')
                    : tx('dashboard.showExpiredTasks', 'Show expired')}
                </span>
                <SwitchControl
                  checked={showExpiredTasks}
                  onChange={setShowExpiredTasks}
                  label={tx('dashboard.showExpiredTasksSwitch', 'Show expired checklist items')}
                />
              </label>
            ) : null}
            <span className="stat-count-badge">{openTaskCount}</span>
          </div>
        )}
      >
        {!hasVisibleTaskRows ? (
          <div className="dashboard-empty-panel compact">
            <span className="empty-state-icon" aria-hidden="true"><CheckCheck size={18} /></span>
            <strong>
              {expiredTaskCount > 0 && !showExpiredTasks
                ? tx('dashboard.noOpenTasksHiddenExpired', 'No upcoming items. Turn on expired to review overdue work.')
                : tx('dashboard.noOpenTasks', 'No open tasks.')}
            </strong>
            {expiredTaskCount > 0 && !showExpiredTasks ? (
              <button
                type="button"
                className="quiet-action"
                onClick={() => setShowExpiredTasks(true)}
              >
                {format(tx('dashboard.showExpiredCount', 'Show expired ({count})'), { count: expiredTaskCount })}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="stat-task-panel">
            <div
              ref={taskListRef}
              className="stat-task-list-scroll deadline-list-scroll"
              onScroll={handleTaskListScroll}
            >
              <ul className="stat-task-list">
                {expiredTasksMounted && expiredTaskCount > 0 ? (
                  <li
                    className={`stat-task-expired-shell${expiredTasksOpen ? ' is-open' : ''}`}
                    aria-label={tx('dashboard.showExpiredTasks', 'Show expired')}
                  >
                    <div className="stat-task-expired-clip">
                      <ul className="stat-task-expired-list">
                        {expiredTaskItems.map((item, index) => renderTaskRow(item, index))}
                      </ul>
                    </div>
                  </li>
                ) : null}
                {visibleTaskItems.map((item) => renderTaskRow(item))}
              </ul>
              {hasMoreTasks ? (
                <div className="deadline-list-sentinel" aria-hidden="true">
                  <span className="deadline-list-dot" />
                  <span className="deadline-list-dot" />
                  <span className="deadline-list-dot" />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </DashboardPanel>
    )
  }

  const renderPriorityPanel = () => priorityReady ? (
    <DashboardPanel
      panelKey="priority"
      title={tx('dashboard.priorityItems')}
      icon={<AlertCircle size={16} className="dashboard-panel-danger-icon" aria-hidden="true" />}
      open={openPanels.priority}
      onToggle={toggleDashboardPanel}
    >
      {priorityApplications.length === 0 ? (
        <div className="dashboard-empty-panel compact">
          <span className="empty-state-icon" aria-hidden="true"><AlertCircle size={18} /></span>
          <strong>{tx('dashboard.noPriority')}</strong>
          {applications.length === 0 && onNew ? (
            <button type="button" className="quiet-action" onClick={onNew}>
              <Plus size={14} aria-hidden="true" /> {tx('dashboard.newApplication')}
            </button>
          ) : applications.length > 0 ? (
            <button
              type="button"
              className="quiet-action dashboard-openable"
              onClick={() => openDashboardApplication(applications[0].id)}
              onContextMenu={(event) => openDashboardApplicationContextMenu(event, applications[0])}
            >
              <ArrowRight size={14} aria-hidden="true" /> {tx('dashboard.reviewApplications', 'Review applications')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="priority-grid">
          {priorityApplications.map((app) => {
            const priorityLevel = priorityToLevel(app.priority)
            const due = daysUntil(app.deadline)
            const dueLabel = due < 0
              ? format(tx('workspace.daysPast'), { count: Math.abs(due) })
              : due === 0
                ? tx('dashboard.today')
                : format(tx('dashboard.dayShort'), { count: due })
            return (
              <button
                key={app.id}
                type="button"
                className="priority-card dashboard-openable"
                onClick={() => openDashboardApplication(app.id)}
                onContextMenu={(event) => openDashboardApplicationContextMenu(event, app)}
              >
                <span className={`priority-dot ${priorityTone(app.priority)}`} aria-hidden="true" />
                <span className="priority-card-copy">
                  <strong>{app.school.name}</strong>
                  <span>
                    {localize(app.program)}
                    {ownerNames?.[app.id] ? ` · ${ownerNames[app.id]}` : ''}
                  </span>
                </span>
                <span className="priority-card-metrics">
                  <span
                    className={`priority-level-chip tone-${priorityTone(app.priority)}`}
                    title={format(tx('dashboard.priorityValue', 'Priority {value}'), { value: app.priority })}
                  >
                    {tx(`settings.${priorityLevel.key}`)}
                  </span>
                  <small className={due <= 7 ? 'urgent' : ''}>{dueLabel}</small>
                </span>
                <ArrowRight size={14} aria-hidden="true" className="priority-card-arrow" />
              </button>
            )
          })}
        </div>
      )}
    </DashboardPanel>
  ) : null

  const renderDeadlinePanel = () => deadlinesReady ? (
    <DashboardPanel
      panelKey="deadlines"
      title={tx('dashboard.upcomingDeadlines')}
      icon={<Calendar size={16} aria-hidden="true" />}
      open={openPanels.deadlines}
      onToggle={toggleDashboardPanel}
      headerExtra={(
        <label className="deadline-mode-control">
          <span className="deadline-mode-label">
            {deadlineDetailed
              ? tx('dashboard.deadlineModeDetailed', 'Detailed')
              : tx('dashboard.deadlineModeSummary', 'Summary')}
          </span>
          <SwitchControl
            checked={deadlineDetailed}
            onChange={setDeadlineDetailed}
            label={tx('dashboard.deadlineModeSwitch', 'Show detailed deadlines')}
          />
        </label>
      )}
    >
      <div className="deadline-view-stage" data-mode={deadlineDetailed ? 'detailed' : 'summary'}>
        <div
          key={deadlineDetailed ? 'detailed' : 'summary'}
          className="deadline-view-panel"
        >
          {deadlineTotalCount === 0 ? (
            <div className="dashboard-empty-panel compact">
              <span className="empty-state-icon" aria-hidden="true"><Calendar size={18} /></span>
              <strong>{tx('dashboard.noDeadlines')}</strong>
            </div>
          ) : (
            <div
              ref={deadlineListRef}
              className="deadline-list deadline-list-scroll"
              onScroll={handleDeadlineListScroll}
            >
              {deadlineDetailed
                ? visibleDetailedDeadlines.map((item) => {
                    const due = daysUntil(item.date)
                    const urgent = due <= 7
                    const application = applications.find((app) => app.id === item.applicationId)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`deadline-item dashboard-openable ${urgent ? 'urgent' : ''}`}
                        onClick={() => openDashboardApplication(item.applicationId, item.jump)}
                        onContextMenu={(event) => {
                          if (!application) return
                          openDashboardApplicationContextMenu(event, application, item.jump)
                        }}
                      >
                        <div className="deadline-info">
                          <strong>{item.schoolName}</strong>
                          <span>
                            {item.label}
                            {' · '}
                            {formatDate(item.date, lang)}
                          </span>
                        </div>
                        <div className="deadline-meta">
                          <span className={`deadline-days ${urgent ? 'urgent' : ''}`}>
                            {due === 0 ? tx('dashboard.today') : format(tx('dashboard.dayShort'), { count: due })}
                          </span>
                          <ArrowRight size={14} aria-hidden="true" className="deadline-arrow" />
                        </div>
                      </button>
                    )
                  })
                : visibleSummaryDeadlines.map((app) => {
                    const due = daysUntil(app.deadline)
                    const urgent = due <= 7
                    return (
                      <button
                        key={app.id}
                        type="button"
                        className={`deadline-item dashboard-openable ${urgent ? 'urgent' : ''}`}
                        onClick={() => openDashboardApplication(app.id, dossierJumpTarget)}
                        onContextMenu={(event) => openDashboardApplicationContextMenu(event, app, dossierJumpTarget)}
                      >
                        <div className="deadline-info">
                          <strong>{app.school.name}</strong>
                          <span>
                            {localize(app.program)} · {professorDisplayName(app)}
                            {ownerNames?.[app.id] ? ` · ${ownerNames[app.id]}` : ''}
                          </span>
                        </div>
                        <div className="deadline-meta">
                          <StatusPill status={app.status} />
                          <span className={`deadline-days ${urgent ? 'urgent' : ''}`}>
                            {due === 0 ? tx('dashboard.today') : format(tx('dashboard.dayShort'), { count: due })}
                          </span>
                          <ArrowRight size={14} aria-hidden="true" className="deadline-arrow" />
                        </div>
                      </button>
                    )
                  })}
              {hasMoreDeadlines ? (
                <div className="deadline-list-sentinel" aria-hidden="true">
                  <span className="deadline-list-dot" />
                  <span className="deadline-list-dot" />
                  <span className="deadline-list-dot" />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </DashboardPanel>
  ) : null

  const renderGuidancePanel = () => {
    if (!guidanceTeam) return null

    return (
      <DashboardPanel
        panelKey="guidance"
        title={tx('dashboard.guidanceTitle', 'My guidance team')}
        icon={<Users size={16} aria-hidden="true" />}
        open={openPanels.guidance}
        onToggle={toggleDashboardPanel}
        headerExtra={<span className="stat-count-badge">{guidanceTeam.members.length}</span>}
      >
        <div className="dashboard-guidance-intro">
          <span>{guidanceTeam.teamName}</span>
          <p>{format(tx('dashboard.guidanceSubtitle', 'Your assigned contacts in {team}.'), {
            team: guidanceTeam.teamName,
          })}</p>
        </div>
        {guidanceTeam.members.length === 0 ? (
          <div className="dashboard-guidance-empty">
            <span className="empty-state-icon" aria-hidden="true"><Users size={18} /></span>
            <div>
              <strong>{tx('dashboard.guidanceEmptyTitle', 'No guidance contact is assigned yet.')}</strong>
              <p>{tx('dashboard.guidanceEmptyDesc', 'Your organization administrator can assign a teacher from the Members workspace.')}</p>
            </div>
          </div>
        ) : (
          <div className="dashboard-guidance-list">
            {guidanceTeam.members.map((member) => {
              const roleLabel = member.role === 'owner'
                ? tx('dashboard.guidanceRoleOwner', 'Institution administrator')
                : tx('dashboard.guidanceRoleTeacher', 'Teacher')
              const detailId = `dashboard-guidance-${member.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
              const expanded = expandedGuidanceMemberId === member.id
              const emailHref = member.email ? safeMailtoHref(member.email) : ''
              const phoneHref = member.phone ? safeTelHref(member.phone) : ''
              const websiteHref = member.website ? safeExternalHttpUrl(member.website) : ''
              const hasDetails = Boolean(member.office || member.availability || member.bio)

              return (
                <article key={member.id} className={`dashboard-guidance-member${expanded ? ' is-expanded' : ''}`}>
                  <div className="dashboard-guidance-main">
                    <UserAvatar
                      avatarUrl={member.avatarUrl}
                      name={member.name}
                      className="dashboard-guidance-avatar"
                    />
                    {hasDetails ? (
                      <button
                        type="button"
                        className="dashboard-guidance-identity"
                        onClick={() => setExpandedGuidanceMemberId(expanded ? null : member.id)}
                        aria-expanded={expanded}
                        aria-controls={detailId}
                      >
                        <strong>{member.name}</strong>
                        <span>{[member.title || roleLabel, member.department].filter(Boolean).join(' · ')}</span>
                      </button>
                    ) : (
                      <div className="dashboard-guidance-identity">
                        <strong>{member.name}</strong>
                        <span>{[member.title || roleLabel, member.department].filter(Boolean).join(' · ')}</span>
                      </div>
                    )}
                    <div className="dashboard-guidance-actions">
                      {emailHref ? (
                        <a
                          href={emailHref}
                          aria-label={format(tx('dashboard.guidanceEmail', 'Email {name}'), { name: member.name })}
                        >
                          <Mail size={14} aria-hidden="true" />
                          <span>{tx('dashboard.guidanceEmailShort', 'Email')}</span>
                        </a>
                      ) : null}
                      {phoneHref ? (
                        <a
                          href={phoneHref}
                          aria-label={format(tx('dashboard.guidanceCall', 'Call {name}'), { name: member.name })}
                        >
                          <Phone size={14} aria-hidden="true" />
                          <span>{tx('dashboard.guidanceCallShort', 'Call')}</span>
                        </a>
                      ) : null}
                      {websiteHref ? (
                        <a
                          href={websiteHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={format(tx('dashboard.guidanceWebsite', 'Open {name}’s website'), { name: member.name })}
                        >
                          <Globe2 size={14} aria-hidden="true" />
                          <span>{tx('dashboard.guidanceWebsiteShort', 'Website')}</span>
                        </a>
                      ) : null}
                    </div>
                    {hasDetails ? (
                      <button
                        type="button"
                        className="dashboard-guidance-detail-toggle"
                        onClick={() => setExpandedGuidanceMemberId(expanded ? null : member.id)}
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        aria-label={format(
                          tx(
                            expanded ? 'dashboard.guidanceHideDetails' : 'dashboard.guidanceShowDetails',
                            expanded ? 'Hide details for {name}' : 'Show details for {name}',
                          ),
                          { name: member.name },
                        )}
                      >
                        <ChevronDown size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {hasDetails ? (
                    <CollapsiblePanel
                      open={expanded}
                      id={detailId}
                      className="dashboard-guidance-detail"
                      innerClassName="dashboard-guidance-detail-inner"
                    >
                      {member.office ? (
                        <span>
                          <MapPin size={14} aria-hidden="true" />
                          <small>{tx('dashboard.guidanceOffice', 'Office')}</small>
                          <strong>{member.office}</strong>
                        </span>
                      ) : null}
                      {member.availability ? (
                        <span>
                          <Clock3 size={14} aria-hidden="true" />
                          <small>{tx('dashboard.guidanceAvailability', 'Availability')}</small>
                          <strong>{member.availability}</strong>
                        </span>
                      ) : null}
                      {member.bio ? (
                        <span className="dashboard-guidance-support">
                          <Users size={14} aria-hidden="true" />
                          <small>{tx('dashboard.guidanceSupport', 'How I can help')}</small>
                          <strong>{member.bio}</strong>
                        </span>
                      ) : null}
                    </CollapsiblePanel>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </DashboardPanel>
    )
  }

  return (
    <section className="dashboard" aria-label={tx('dashboard.title')} data-tour="dashboard-overview">
      <header className="dashboard-header" data-tour="dashboard-header">
        <div>
          <span className="eyebrow">{eyebrow ?? tx('dashboard.overview')}</span>
          <h1>{title ?? tx('dashboard.title')}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="dashboard-header-actions">
          {onOpenDiscover ? (
            <button type="button" className="secondary-action dashboard-discover-header-btn" onClick={onOpenDiscover}>
              <Compass size={16} aria-hidden="true" />
              {tx('dashboard.openDiscover', 'Discover programs')}
            </button>
          ) : null}
          {onNew ? (
            <button type="button" className="primary-action" onClick={onNew}>
              <Plus size={16} aria-hidden="true" /> {tx('dashboard.newApplication')}
            </button>
          ) : null}
        </div>
      </header>

      <div className="dashboard-grid">
        <section
          className="dashboard-card dashboard-application-snapshot"
          aria-label={tx('dashboard.applicationSnapshot', 'Application snapshot')}
          data-tour="dashboard-stats"
        >
          {renderApplicationSnapshot()}
        </section>

        {renderGuidancePanel()}

        <div
          className="dashboard-triple-row dashboard-focus-row"
          data-tour="dashboard-focus-row"
          data-focus-reveal={focusPanelsReady ? 'ready' : 'pending'}
          aria-busy={!focusPanelsReady}
        >
          <div className={`dashboard-focus-slot ${focusPanelsReady ? 'is-ready' : 'is-pending'}`}>
            {renderPriorityPanel()}
          </div>
          <div className={`dashboard-focus-slot ${focusPanelsReady ? 'is-ready' : 'is-pending'}`}>
            {renderTaskChecklist()}
          </div>
          <div className={`dashboard-focus-slot ${focusPanelsReady ? 'is-ready' : 'is-pending'}`}>
            {renderDeadlinePanel()}
          </div>
        </div>

        {ownerDirectory && byStudentReady ? (
          <DashboardPanel
            panelKey="byStudent"
            title={tx('dashboard.byStudent', 'By student')}
            icon={<Users size={16} aria-hidden="true" />}
            open={openPanels.byStudent}
            onToggle={toggleDashboardPanel}
          >
            {byStudent.length === 0 ? (
              <div className="dashboard-empty-panel compact">
                <span className="empty-state-icon" aria-hidden="true"><Users size={18} /></span>
                <strong>{tx('dashboard.noByStudent', 'No team-visible applications yet.')}</strong>
              </div>
            ) : (
              <div className="by-student-list">
                {byStudent.map((group) => (
                  <button
                    key={group.ownerId}
                    type="button"
                    className="by-student-item"
                    onClick={() => onViewMember?.(group.ownerId)}
                  >
                    <UserAvatar
                      avatarUrl={ownerAvatars?.[group.ownerId]}
                      name={group.name}
                      className="by-student-avatar"
                    />
                    <span className="by-student-info">
                      <strong>{group.name}</strong>
                      <span>
                        {format(tx('dashboard.byStudentCount', '{count} applications'), { count: group.count })}
                        {' · '}
                        {format(tx('dashboard.byStudentProgress', 'avg {value}%'), { value: group.avgProgress })}
                      </span>
                    </span>
                    {group.nextDeadline != null ? (
                      <span className={`deadline-days ${group.nextDeadline <= 7 ? 'urgent' : ''}`}>
                        {group.nextDeadline === 0
                          ? tx('dashboard.today')
                          : format(tx('dashboard.dayShort'), { count: group.nextDeadline })}
                      </span>
                    ) : null}
                    <ArrowRight size={14} aria-hidden="true" className="by-student-arrow" />
                  </button>
                ))}
              </div>
            )}
          </DashboardPanel>
        ) : null}

        <div className="dashboard-triple-row" data-tour="dashboard-insight-row">
          {statusReady ? <DashboardPanel
            panelKey="status"
            title={tx('dashboard.statusDistribution')}
            icon={<TrendingUp size={16} />}
            open={openPanels.status}
            onToggle={toggleDashboardPanel}
            headerExtra={(
              <div
                className={`status-view-toggle mode-${statusViewMode}`}
                role="group"
                aria-label={tx('dashboard.statusViewSwitch', 'Status distribution view')}
              >
                <span className="status-view-toggle-thumb" aria-hidden="true" />
                <button
                  type="button"
                  className={statusViewMode === 'bars' ? 'active' : undefined}
                  onClick={() => setStatusView('bars')}
                  aria-pressed={statusViewMode === 'bars'}
                  aria-label={tx('dashboard.statusViewBars', 'Bar chart')}
                  title={tx('dashboard.statusViewBars', 'Bar chart')}
                >
                  <BarChart3 size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={statusViewMode === 'donut' ? 'active' : undefined}
                  onClick={() => setStatusView('donut')}
                  aria-pressed={statusViewMode === 'donut'}
                  aria-label={tx('dashboard.statusViewDonut', 'Donut chart')}
                  title={tx('dashboard.statusViewDonut', 'Donut chart')}
                >
                  <PieChart size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={statusViewMode === 'grid' ? 'active' : undefined}
                  onClick={() => setStatusView('grid')}
                  aria-pressed={statusViewMode === 'grid'}
                  aria-label={tx('dashboard.statusViewGrid', 'Grid')}
                  title={tx('dashboard.statusViewGrid', 'Grid')}
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          >
            {/* status body continues below after we close the old masonry structure */}
            <div
              key={statusViewMode}
              className={`status-view-stage direction-${statusViewDirection}`}
              data-mode={statusViewMode}
            >
              {statusViewMode === 'bars' ? (
                <div className="status-bars">
                  {statusCounts.map(({ status, count }, index) => (
                    <div
                      key={status}
                      className="status-bar-row"
                      style={{ '--status-stagger': `${index * 35}ms` } as CSSProperties}
                    >
                      <span className="status-bar-label"><StatusPill status={status} /></span>
                      <div className="status-bar-track" aria-hidden="true">
                        <div
                          className="status-bar-fill"
                          style={{
                            width: `${(count / maxCount) * 100}%`,
                            background: statusStrokeColor[status],
                          }}
                        />
                      </div>
                      <span className="status-bar-count">{count}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {statusViewMode === 'donut' ? (
                <div className="status-donut-view">
                  <div className="status-donut-chart" aria-hidden="true">
                    <svg viewBox="0 0 120 120" className="status-donut-svg">
                      <circle className="status-donut-track" cx="60" cy="60" r="44" />
                      {(() => {
                        const radius = 44
                        const circumference = 2 * Math.PI * radius
                        let consumed = 0
                        const segments = statusCounts.filter((item) => item.count > 0)
                        if (statusTotal === 0) {
                          return (
                            <circle
                              className="status-donut-empty"
                              cx="60"
                              cy="60"
                              r={radius}
                            />
                          )
                        }
                        return segments.map(({ status, count }, index) => {
                          const portion = count / statusTotal
                          const length = portion * circumference
                          const dashOffset = circumference * 0.25 - consumed
                          consumed += length
                          return (
                            <circle
                              key={status}
                              className="status-donut-segment"
                              cx="60"
                              cy="60"
                              r={radius}
                              stroke={statusStrokeColor[status]}
                              strokeDasharray={`${length} ${circumference - length}`}
                              strokeDashoffset={dashOffset}
                              style={{
                                '--status-stagger': `${index * 50}ms`,
                                color: statusStrokeColor[status],
                              } as CSSProperties}
                            />
                          )
                        })
                      })()}
                    </svg>
                    <div className="status-donut-center">
                      <strong>{statusTotal}</strong>
                      <span>{tx('dashboard.statusViewTotal', 'Total')}</span>
                    </div>
                  </div>
                  <ul className="status-donut-legend">
                    {statusCounts.map(({ status, count }, index) => {
                      const pct = statusTotal > 0 ? Math.round((count / statusTotal) * 100) : 0
                      return (
                        <li
                          key={status}
                          style={{
                            '--status-stagger': `${index * 35}ms`,
                            color: statusStrokeColor[status],
                          } as CSSProperties}
                        >
                          <span
                            className="status-donut-swatch"
                            style={{ background: statusStrokeColor[status] }}
                          />
                          <StatusPill status={status} />
                          <em>{count}</em>
                          <b>{pct}%</b>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}

              {statusViewMode === 'grid' ? (
                <div className="status-grid-view">
                  {statusCounts.map(({ status, count }, index) => {
                    const pct = statusTotal > 0 ? Math.round((count / statusTotal) * 100) : 0
                    return (
                      <div
                        key={status}
                        className="status-grid-tile"
                        style={{
                          '--status-stagger': `${index * 35}ms`,
                          '--status-tone': statusStrokeColor[status],
                        } as CSSProperties}
                      >
                        <div className="status-grid-tile-head">
                          <StatusPill status={status} />
                          <strong>{count}</strong>
                        </div>
                        <div className="status-grid-tile-track" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <span className="status-grid-tile-meta">
                          {format(tx('dashboard.statusViewShare', '{value}% of total'), { value: pct })}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </DashboardPanel> : null}

          {recentOpenedReady ? <DashboardPanel
            panelKey="recentOpened"
            title={tx('dashboard.recentOpened', 'Recently opened')}
            icon={<History size={16} />}
            open={openPanels.recentOpened}
            onToggle={toggleDashboardPanel}
          >
            {recentOpened.length === 0 ? (
              <div className="dashboard-empty-panel">
                <span className="empty-state-icon" aria-hidden="true"><History size={18} /></span>
                <strong>{tx('dashboard.noRecentOpened', 'No recently opened applications yet.')}</strong>
                <p>{tx('dashboard.noRecentOpenedHint', 'Open an application and it will be pinned here for quick access.')}</p>
                {applications.length === 0 && onNew ? (
                  <button type="button" className="quiet-action" onClick={onNew}>
                    <Plus size={14} aria-hidden="true" /> {tx('dashboard.newApplication')}
                  </button>
                ) : applications.length > 0 ? (
                  <button
                    type="button"
                    className="quiet-action dashboard-openable"
                    onClick={() => openDashboardApplication(applications[0].id)}
                    onContextMenu={(event) => openDashboardApplicationContextMenu(event, applications[0])}
                  >
                    <ArrowRight size={14} aria-hidden="true" /> {tx('dashboard.openFirstApplication', 'Open first application')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="deadline-list recent-opened-list">
                {recentOpened.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    className="deadline-item recent-opened-item dashboard-openable"
                    onClick={() => openDashboardApplication(app.id)}
                    onContextMenu={(event) => openDashboardApplicationContextMenu(event, app)}
                  >
                    <div className="deadline-info">
                      <strong>{app.school.name}</strong>
                      <span>
                        {localize(app.program)} · {professorDisplayName(app)}
                        {ownerNames?.[app.id] ? ` · ${ownerNames[app.id]}` : ''}
                      </span>
                    </div>
                    <div className="deadline-meta">
                      <StatusPill status={app.status} />
                      <span className="deadline-days">{formatDate(app.deadline, lang)}</span>
                      <ArrowRight size={14} aria-hidden="true" className="deadline-arrow" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </DashboardPanel> : null}

          {materialsReady ? <DashboardPanel
            panelKey="materials"
            title={tx('dashboard.recentMaterials')}
            icon={<FileText size={16} />}
            open={openPanels.materials}
            onToggle={toggleDashboardPanel}
          >
            <div className="activity-feed">
              {recentMaterials.length === 0 ? (
                <div className="dashboard-empty-panel compact">
                  <span className="empty-state-icon" aria-hidden="true"><FileText size={18} /></span>
                  <strong>{tx('dashboard.noMaterials')}</strong>
                </div>
              ) : (
                recentMaterials.map((mat) => {
                  const target = checklistJumpTarget('material', mat.id)
                  const application = applicationById.get(mat.appId)
                  return (
                    <button
                      key={`${mat.appId}:material:${mat.id}:${mat.updatedAt}`}
                      type="button"
                      className="activity-item dashboard-openable"
                      onClick={() => openDashboardApplication(mat.appId, target)}
                      onContextMenu={application ? (contextEvent) => openDashboardApplicationContextMenu(contextEvent, application, target) : undefined}
                    >
                      <span className="activity-dot accent" />
                      <div>
                        <strong>{localize(mat.name)}</strong>
                        <span>{mat.school} · {versionLabel(mat.version)} · {formatDate(mat.updatedAt, lang)}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </DashboardPanel> : null}
        </div>
      </div>
      <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  )
}
