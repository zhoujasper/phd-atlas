import {
  createElement,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  lazy,
  memo,
  Suspense,
  useState,
  type CSSProperties,
  type ComponentType,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  Columns,
  HelpCircle,
  GripVertical,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  SunMoon,
  Undo2,
  UserRound,
  Users,
} from 'lucide-react'
import {
  ApiError,
  clearClientSessionCaches,
  getLatestSessionToken,
  phdApi,
  readSessionTokenSubject,
  sessionIdentityMatches,
  setSessionTokenHandler,
  setUnauthorizedHandler,
  type AuthSession,
  type AccountPlan,
  type AiKey,
  type AiKeyInput,
  type BackupRecord,
  type CommunicationInput,
  type ApplicationTrashItem,
  type NotificationRecord,
  type MailSyncJob,
  type PasskeyCredentialSummary,
  type ProfileAsset,
  type ProfileAssetInput,
  type TeamApplicationRecord,
  type TeamRole,
  type TeamSummary,
  type TeamWorkspaceOption,
  type UserSettings,
  type UserSettingsPatch,
} from './api/phdApi'
import type { ApplicationRecord, ApplicationStatus, MaterialStatus, SharePermission, ShareSection } from './data/applications'
import type { SharedLinkInfo } from './components/screens/settingsShareModel'
import { canAccessDiscover, discoverStudentMembers, hasPersonalDiscoverAccess, hasTeamDiscoverAccess } from './components/screens/discoverAccess'
import { teachersForStudent } from './teamRelationships'
import { toggleWorkspacePaneClass } from './workspaceLayoutMotion'
import { shareSections as allShareSections } from './data/applications'
import { appendReviewComment } from './reviewComments'
import { formatApplicationIdentity } from './data/countries'
import {
  type DetailTab,
  type InterfaceMode,
  type Screen,
  type SortKey,
  type TeamSection,
  safeParseJson,
} from './appModel'
import type { LangDict, Language } from './i18n'
import { I18nContext, useI18nValue } from './components/hooks/useI18n'
import { usePwaInstall } from './components/hooks/usePwaInstall'
import { useConnectivity } from './components/hooks/useConnectivity'
import { useRealtimeUpdates } from './components/hooks/useRealtimeUpdates'
import { useWebPushNotifications } from './components/hooks/useWebPushNotifications'
import { useToastQueue } from './components/hooks/useToastQueue'
import { getMotionDelay } from './components/hooks/useAnimatedClose'
import {
  ThemeContext,
  applyThemePreset,
  normalizeThemeAccent,
  useThemeProvider,
} from './components/hooks/useTheme'
import { AuthScreen } from './components/screens/AuthScreen'
import { Rail } from './components/layout/Rail'
import type { DossierJumpIntent } from './components/screens/DossierView'
import { EmptyDossier } from './components/screens/EmptyDossier'
import { ToastStack } from './components/shared/ToastView'
import { ConfirmDialog } from './components/shared/ConfirmDialog'
import { TeamWorkspaceChooser } from './components/shared/TeamWorkspaceChooser'
import {
  LoadingCurtain,
  PaneSkeleton,
  ScreenSkeleton,
} from './components/shared/LaunchScreen'
import type { LoadingVariant, ScreenSkeletonVariant } from './components/shared/loadingVariant'
import { waitForUiSettle } from './components/shared/uiSettle'
import type { ShareExpiry } from './components/shared/shareOptions'
import type { NewApplicationStudentOption, NewApplicationTeamMode } from './components/shared/NewApplicationDialog'
import type { CommandPaletteAction } from './components/shared/CommandPalette'
import { FormValidationPrompt } from './components/shared/FormValidationPrompt'
import { LazyOverlayBoundary } from './components/shared/LazyOverlayBoundary'
import { OfflineStatusCenter } from './components/shared/OfflineStatusCenter'
import { NotFoundScreen } from './components/screens/NotFoundScreen'
import {
  normalizeRemoteSchoolLogoDataUrl,
  normalizeSchoolLogoFile,
  SchoolLogoError,
} from './components/shared/schoolLogoModel'
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  languageOptions,
  preloadLanguage,
  registerLanguage,
  resolveLanguage,
  tpl,
  t,
} from './i18n'
import { contentLanguagesFromSettings } from './contentLanguages'
import { PUBLIC_EDITION } from './edition'
import { CONTENT_LANGUAGE_NAMESPACES } from './components/hooks/useI18n'
import { normalizeErrorMessage } from './errorMessages'
import { downloadBlob } from './downloadBlob'
import { connectivityUnavailable, probeServerConnectivity, setManualOfflineMode } from './connectivity'
import { activatePwaUpdate, PWA_OFFLINE_SYNC_EVENT, requestOfflineSync } from './serviceWorker'
import {
  blockedOfflineQueueSize,
  canQueueApplicationUpdate,
  enqueueApplicationUpdate,
  isNetworkLikeError,
  loadOfflineSnapshot,
  offlineQueueSize,
  pendingOfflineQueueSize,
  readOfflineQueue,
  markOfflineQueueItemBlocked,
  mergeOfflineApplicationUpdate,
  removeOfflineApplicationUpdates,
  removeOfflineQueueItems,
  saveOfflineSnapshot,
  type OfflineSnapshotData,
} from './offline'
import englishDashboard from './i18n/en/dashboard.json'
import englishDossier from './i18n/en/dossier.json'
import englishProfile from './i18n/en/profile.json'
import englishWorkspace from './i18n/en/workspace.json'
import chineseDashboard from './i18n/zh/dashboard.json'
import chineseDossier from './i18n/zh/dossier.json'
import chineseProfile from './i18n/zh/profile.json'
import chineseWorkspace from './i18n/zh/workspace.json'

registerLanguage('en', englishDashboard as LangDict, 'dashboard')
registerLanguage('zh', chineseDashboard as LangDict, 'dashboard')
registerLanguage('en', englishWorkspace as LangDict, 'workspace')
registerLanguage('zh', chineseWorkspace as LangDict, 'workspace')
registerLanguage('en', englishDossier as LangDict, 'dossier')
registerLanguage('zh', chineseDossier as LangDict, 'dossier')
registerLanguage('en', englishProfile as LangDict, 'profile')
registerLanguage('zh', chineseProfile as LangDict, 'profile')

type AnimatedScreenTransitionScope = 'screen' | 'workspace-view' | 'dossier-tab' | 'dossier-record'
type ScreenReadinessGate = {
  isReady: () => boolean
  preload: () => Promise<unknown>
}

type AnimatedScreenTransitionOptions = {
  scope?: AnimatedScreenTransitionScope
  direction?: 'forward' | 'backward'
  onTransitionFinished?: () => void
  ready?: Promise<unknown>
  readinessGate?: ScreenReadinessGate
  /**
   * Keep high-frequency workspace interactions on live compositor layers.
   * Native snapshots are ideal for small static routes, but capturing a large
   * dossier or four-panel workspace forces a synchronous bitmap build.
   */
  forceCssFallback?: boolean
  /** Paint the dossier shell first, then reveal dense rows concurrently. */
  deferDossierContent?: boolean
}

type CssFallbackMotion = {
  token: number
  scope: AnimatedScreenTransitionScope
  direction: 'forward' | 'backward'
  phase: 'exit' | 'enter'
  onTransitionFinished?: () => void
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

function clearCssFallbackAttributes(root: HTMLElement) {
  delete root.dataset.atlasFallbackScope
  delete root.dataset.atlasFallbackDirection
  delete root.dataset.atlasFallbackPhase
  delete root.dataset.atlasFallbackToken
  delete root.dataset.atlasFallbackCycle
}

function clearNativeTransitionAttributes(root: HTMLElement) {
  delete root.dataset.atlasTransitionScope
  delete root.dataset.atlasTransitionDirection
  delete root.dataset.atlasScreenDirection
  delete root.dataset.atlasTransitionToken
}

function setNativeTransitionAttributes(
  root: HTMLElement,
  scope: AnimatedScreenTransitionScope,
  direction: 'forward' | 'backward',
  token: number,
) {
  root.dataset.atlasTransitionScope = scope
  root.dataset.atlasTransitionDirection = direction
  root.dataset.atlasScreenDirection = direction
  root.dataset.atlasTransitionToken = String(token)
}

function markTransitionedSurface(root: HTMLElement, scope: AnimatedScreenTransitionScope) {
  if (scope === 'screen' || scope === 'workspace-view') root.dataset.atlasScreenTransitioned = 'true'
  if (scope === 'dossier-tab') root.dataset.atlasDossierTabTransitioned = 'true'
  if (scope === 'dossier-record') root.dataset.atlasDossierRecordTransitioned = 'true'
}

/**
 * Rail / primary screen switches use a short exit fade so the handoff reads as
 * a natural dissolve + slide, not a hard cut. Long enough for workspace side
 * panes (application list + inspector) to exit with the center stage.
 * Dossier tabs stay enter-only so rapid in-dossier clicks stay snappy.
 */
function cssFallbackExitDuration(scope: AnimatedScreenTransitionScope) {
  if (scope === 'screen') return 160
  // Workspace surfaces replace one another inside the already-mounted shell.
  // Committing immediately lets the incoming compositor animation start on the
  // tap frame; holding an invisible mobile surface here reads as a white flash.
  if (scope === 'workspace-view') return 0
  return 0
}

function cssFallbackEnterDuration(scope: AnimatedScreenTransitionScope) {
  if (scope === 'screen' || scope === 'workspace-view') return 260
  if (scope === 'dossier-record') return 220
  if (scope === 'dossier-tab') return 220
  return 180
}

function createPreloadedScreen<TComponent extends ComponentType<any>>(
  loader: () => Promise<{ default: TComponent }>,
) {
  type Props = ComponentProps<TComponent>
  let resolved: TComponent | null = null
  let pending: Promise<{ default: TComponent }> | null = null

  const preload = (): Promise<{ default: TComponent }> => {
    if (resolved) return Promise.resolve({ default: resolved })
    if (!pending) {
      pending = loader().then((module) => {
        resolved = module.default
        return module
      })
      void pending.catch(() => {
        pending = null
      })
    }
    return pending
  }

  const Component = (props: Props) => {
    if (!resolved) throw preload()
    return createElement(resolved, props)
  }

  return { Component, preload, isResolved: () => resolved !== null }
}

const dashboardScreen = createPreloadedScreen(() => import('./components/screens/Dashboard').then((module) => ({ default: module.Dashboard })))
const applicationPaneScreen = createPreloadedScreen(() => import('./components/screens/ApplicationPane').then((module) => ({ default: module.ApplicationPane })))
const dossierViewScreen = createPreloadedScreen(() => import('./components/screens/DossierView').then((module) => ({ default: module.DossierView })))
const kanbanBoardScreen = createPreloadedScreen(() => import('./components/screens/KanbanBoard').then((module) => ({ default: module.KanbanBoard })))
const inspectorScreen = createPreloadedScreen(() => import('./components/screens/Inspector').then((module) => ({ default: module.Inspector })))
const profileScreen = createPreloadedScreen(() => import('./components/screens/ProfileScreen').then((module) => ({ default: module.ProfileScreen })))
const discoverScreen = createPreloadedScreen(() => import('./components/screens/DiscoverScreen').then((module) => ({ default: module.DiscoverScreen })))
const settingsScreen = createPreloadedScreen(() => import('./components/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })))
const teamScreen = createPreloadedScreen(() => import('./components/screens/TeamScreen').then((module) => ({ default: module.TeamScreen })))
const loadDashboardScreen = dashboardScreen.preload
const loadApplicationPane = applicationPaneScreen.preload
const loadDossierView = dossierViewScreen.preload
const loadKanbanBoard = kanbanBoardScreen.preload
const loadInspector = inspectorScreen.preload
const loadProfileScreen = profileScreen.preload
const loadDiscoverScreen = discoverScreen.preload
const loadSettingsScreen = settingsScreen.preload
const loadTeamScreen = teamScreen.preload
const loadNewApplicationDialog = () => import('./components/shared/NewApplicationDialog').then((module) => ({ default: module.NewApplicationDialog }))
const loadShareDialog = () => import('./components/shared/ShareDialog').then((module) => ({ default: module.ShareDialog }))
const loadDiscoverApplicationEnrichmentDialog = () => import('./components/shared/DiscoverApplicationEnrichmentDialog').then((module) => ({ default: module.DiscoverApplicationEnrichmentDialog }))
const loadNotificationCenter = () => import('./components/shared/NotificationCenter').then((module) => ({ default: module.NotificationCenter }))
const loadKeyboardShortcuts = () => import('./components/shared/KeyboardShortcuts')
const loadOnboardingTour = () => import('./components/shared/OnboardingTour')
const loadCommandPalette = () => import('./components/shared/CommandPalette')

function shallowEqualViewProps<T extends object>(
  previous: T,
  next: T,
  ignoredKeys: ReadonlySet<string> = new Set(),
) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    if (ignoredKeys.has(key)) continue
    const previousValue = previous[key as keyof T]
    const nextValue = next[key as keyof T]
    if (typeof previousValue === 'function' && typeof nextValue === 'function') continue
    if (!Object.is(previousValue, nextValue)) return false
  }
  return true
}

const paneIgnoredProps = new Set(['resizeHandle'])
const Dashboard = memo(dashboardScreen.Component, shallowEqualViewProps)
const ApplicationPane = memo(
  applicationPaneScreen.Component,
  (previous, next) => shallowEqualViewProps(previous, next, paneIgnoredProps),
)
const DossierView = memo(dossierViewScreen.Component, shallowEqualViewProps)
const KanbanBoard = memo(kanbanBoardScreen.Component, shallowEqualViewProps)
const Inspector = memo(
  inspectorScreen.Component,
  (previous, next) => shallowEqualViewProps(previous, next, paneIgnoredProps),
)
const ProfileScreen = memo(profileScreen.Component, shallowEqualViewProps)
const DiscoverScreen = memo(discoverScreen.Component, shallowEqualViewProps)
const SettingsScreen = memo(settingsScreen.Component, shallowEqualViewProps)
const TeamScreen = memo(teamScreen.Component, shallowEqualViewProps)
const NewApplicationDialog = lazy(loadNewApplicationDialog)
const ShareDialog = lazy(loadShareDialog)
const DiscoverApplicationEnrichmentDialog = lazy(loadDiscoverApplicationEnrichmentDialog)
const NotificationCenter = lazy(loadNotificationCenter)
const KeyboardShortcuts = lazy(loadKeyboardShortcuts)
const OnboardingTour = lazy(loadOnboardingTour)
const CommandPalette = lazy(loadCommandPalette)

type PreloadedScreenHandle = Pick<ScreenReadinessGate, 'preload'> & {
  isResolved: () => boolean
}

function screenReadinessGate(...screens: PreloadedScreenHandle[]): ScreenReadinessGate {
  return {
    isReady: () => screens.every((screen) => screen.isResolved()),
    preload: () => Promise.all(screens.map((screen) => screen.preload())).then(() => undefined),
  }
}

function readinessGateForScreen(screen: Screen, viewMode: 'list' | 'kanban'): ScreenReadinessGate {
  if (screen === 'dashboard') return screenReadinessGate(dashboardScreen)
  if (screen === 'discover') return screenReadinessGate(discoverScreen)
  if (screen === 'profile') return screenReadinessGate(profileScreen)
  if (screen === 'settings') return screenReadinessGate(settingsScreen)
  if (screen === 'team') return screenReadinessGate(teamScreen)
  return screenReadinessGate(
    applicationPaneScreen,
    inspectorScreen,
    viewMode === 'kanban' ? kanbanBoardScreen : dossierViewScreen,
  )
}

const SESSION_KEY = 'phd-atlas-session'
const LANGUAGE_PREFERENCE_KEY = 'phd-atlas-language'
const SCREEN_KEY = 'phd-atlas-screen'
const SELECTED_ID_KEY = 'phd-atlas-selectedId'
const RECENT_OPENED_KEY = 'phd-atlas-recent-opened:v1'
const TAB_KEY = 'phd-atlas-tab'
const WORKSPACE_LAYOUT_KEY = 'phd-atlas-workspace-layout'
const VIEW_MODE_KEY = 'phd-atlas-view-mode'
const INTERFACE_MODE_KEY = 'phd-atlas-interface-mode'
const TEAM_SECTION_KEY = 'phd-atlas-team-section'
const ACTIVE_TEAM_ID_KEY = 'phd-atlas-active-team-id'
const SESSION_RETURN_STACK_KEY = 'phd-atlas-session-return-stack:v1'
const INSPECTOR_PAST_DEADLINES_KEY_PREFIX = 'phd-atlas-inspector-past-deadlines:v1'
const ONBOARDING_DONE_KEY = 'phd-atlas-onboarding-done'
const ONBOARDING_SAMPLE_ACTIVE_KEY = 'phd-atlas-onboarding-sample-active'
const TOUR_SAMPLE_APPLICATION_ID = '__phd_atlas_tour_sample__'
const RECENT_OPENED_LIMIT = 6
const validScreens: Screen[] = PUBLIC_EDITION
  ? ['dashboard', 'workspace', 'discover', 'profile', 'settings']
  : ['dashboard', 'workspace', 'discover', 'profile', 'settings', 'team']
const validTabs: DetailTab[] = ['dossier', 'materials', 'mail', 'funding', 'timeline', 'review']
const validTeamSections: TeamSection[] = ['overview', 'applications', 'members', 'resources', 'discover', 'audit', 'settings']
const shortcutTabs: DetailTab[] = ['dossier', 'materials', 'mail', 'funding', 'timeline', 'review']

function isPasskeyAbort(error: unknown) {
  return error instanceof Error && ['AbortError', 'NotAllowedError'].includes(error.name)
}

const PANE_WIDTH_MIN = 260
const PANE_WIDTH_MAX = 520
const INSPECTOR_WIDTH_MIN = 260
const INSPECTOR_WIDTH_MAX = 460
const PANE_COLLAPSE_DISTANCE = 56
const PANE_REVEAL_DISTANCE = 32
type WorkspaceJumpTarget = Omit<DossierJumpIntent, 'token'>

type WorkspaceLayoutState = {
  applicationPaneWidth: number
  inspectorWidth: number
  applicationsHidden: boolean
  inspectorHidden: boolean
  sidebarsSwapped: boolean
}

type SessionReturnStackItem = {
  session: AuthSession
  screen: Screen
  selectedId: string | null
  tab: DetailTab
  interfaceMode: InterfaceMode
  createdAt: string
}

function DeferredPanel({
  className = 'workspace-deferred-main',
  variant = 'workspace',
}: {
  className?: string
  variant?: ScreenSkeletonVariant
}) {
  return <ScreenSkeleton className={className} variant={variant} />
}

function DeferredAside({
  kind,
  className = '',
  style,
}: {
  kind: 'applications' | 'inspector'
  className?: string
  style?: CSSProperties
}) {
  return <PaneSkeleton kind={kind} className={className} style={style} />
}

function getAccountPlan(session: AuthSession | null): AccountPlan {
  if (!session) return 'free'
  return session.usage?.plan
    ?? (session.user.role === 'admin'
      ? 'admin'
      : session.user.settings.membershipPlan === 'team'
        ? 'team'
        : session.user.settings.membershipPlan === 'pro'
          ? 'pro'
          : 'free')
}

function createOfflineCommunication(input: CommunicationInput): ApplicationRecord['communications'][number] | null {
  if (input.attachments?.some((attachment) => Boolean(attachment.file))) return null
  return {
    id: `comm-${Date.now()}`,
    subject: input.subject,
    channel: input.channel,
    date: input.date,
    summary: input.summary,
    direction: input.direction,
    messageType: input.messageType,
    from: input.from,
    to: input.to,
    time: input.time,
    attachments: input.attachments?.map(({ file: _file, ...attachment }) => attachment),
    deliveryStatus: 'log-only',
  }
}

function languageNamespacesForScreen(
  screen: Screen,
  tab: DetailTab,
) {
  const namespaces = new Set<string>(['core', 'shared'])

  if (screen === 'dashboard') {
    namespaces.add('dashboard')
    // Inspector field labels (copy toast suffixes) live in the dossier pack.
    namespaces.add('dossier')
  } else if (screen === 'workspace') {
    namespaces.add('workspace')
    namespaces.add('dossier')
    namespaces.add('profile')
    if (tab === 'funding') namespaces.add('dossier')
  } else if (screen === 'discover') {
    namespaces.add('discover')
  } else if (screen === 'profile') {
    namespaces.add('profile')
  } else if (screen === 'settings') {
    namespaces.add('settings')
    namespaces.add('share')
    namespaces.add('team')
  } else if (screen === 'team') {
    namespaces.add('team')
    namespaces.add('workspace')
    namespaces.add('profile')
  }

  return Array.from(namespaces)
}

const defaultWorkspaceLayout: WorkspaceLayoutState = {
  applicationPaneWidth: 340,
  inspectorWidth: 304,
  applicationsHidden: false,
  inspectorHidden: false,
  sidebarsSwapped: false,
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function loadStoredWorkspaceLayout(): WorkspaceLayoutState {
  try {
    const stored = safeParseJson<Partial<WorkspaceLayoutState>>(localStorage.getItem(WORKSPACE_LAYOUT_KEY))
    return {
      ...defaultWorkspaceLayout,
      ...stored,
      applicationPaneWidth: clampNumber(
        Number(stored?.applicationPaneWidth ?? defaultWorkspaceLayout.applicationPaneWidth),
        PANE_WIDTH_MIN,
        PANE_WIDTH_MAX,
      ),
      inspectorWidth: clampNumber(
        Number(stored?.inspectorWidth ?? defaultWorkspaceLayout.inspectorWidth),
        INSPECTOR_WIDTH_MIN,
        INSPECTOR_WIDTH_MAX,
      ),
    }
  } catch {
    return defaultWorkspaceLayout
  }
}

function isTourSampleApplicationId(id: string | null | undefined) {
  return id === TOUR_SAMPLE_APPLICATION_ID
}

function isTourSampleApplication(application: ApplicationRecord) {
  return isTourSampleApplicationId(application.id)
}

function createTourSampleApplication(ownerId?: string): ApplicationRecord {
  return {
    id: TOUR_SAMPLE_APPLICATION_ID,
    ownerId,
    professor: {
      english: 'Prof. Ada Chen',
      chinese: '陈教授',
      email: 'ada.chen@example.edu',
      phone: '+1 415 555 0138',
      social: '@ada-chen-lab',
      homepage: 'https://example.edu/ada-chen',
      research: 'human-AI collaboration, learning analytics, and trustworthy agent workflows',
      lab: 'Applied Intelligence Lab',
    },
    school: {
      name: 'PhD Atlas Demo University',
      country: 'United States',
      website: 'https://example.edu/graduate-admissions',
    },
    program: 'Human-AI Collaboration PhD',
    deadline: '2026-12-15',
    status: 'Preparing',
    progress: 56,
    priority: 88,
    tags: ['tour sample', 'HCI', 'funding'],
    nextReminder: '2026-07-12',
    result: 'Tutorial sample created locally. It will disappear when the guide ends.',
    materials: [
      {
        id: 'tour-cv',
        name: 'Academic CV',
        type: 'PDF',
        status: 'Ready',
        group: 'Core materials',
        details: 'Keep one polished CV version here, upload revisions, and copy the latest file name when needed.',
        reminderEnabled: true,
        reminderDate: '2026-07-12',
        reminderTime: '09:00',
        reminderRepeat: 'once',
        uploadReserved: true,
        allowedFileTypes: ['.pdf', '.docx'],
        version: 'v2',
        updatedAt: '2026-07-02',
        versions: [],
      },
      {
        id: 'tour-recommendation',
        name: 'Recommendation Letters',
        type: 'Request',
        status: 'Requested',
        group: 'Recommendations',
        details: 'Track every recommender, contact address, and reminder date in the expanded detail panel.',
        reminderEnabled: true,
        reminderDate: '2026-07-18',
        reminderTime: '10:30',
        reminderRepeat: 'weekly',
        requiredCount: 3,
        recommenders: [
          { id: 'tour-rec-1', name: 'Dr. Lin', contact: 'lin@example.edu' },
          { id: 'tour-rec-2', name: 'Prof. Patel', contact: 'patel@example.edu' },
          { id: 'tour-rec-3', name: '', contact: '' },
        ],
        version: 'v0',
        updatedAt: '2026-07-01',
        versions: [],
      },
      {
        id: 'tour-sop',
        name: 'Statement of Purpose',
        type: 'DOCX',
        status: 'Draft',
        group: 'Writing',
        details: 'Use the notes area for what needs revision before upload.',
        reminderEnabled: false,
        version: 'v1',
        updatedAt: '2026-06-30',
        versions: [],
      },
    ],
    communications: [
      {
        id: 'tour-comm-1',
        subject: 'Research fit and advisor availability',
        channel: 'Email',
        date: '2026-07-01',
        time: '15:20',
        summary: 'Professor replied positively and asked for a shorter project summary.',
        direction: 'incoming',
        messageType: 'incoming-email',
        from: 'ada.chen@example.edu',
        to: 'jasper@example.com',
        attachments: [],
      },
      {
        id: 'tour-note-1',
        subject: 'Portfolio note',
        channel: 'Note',
        date: '2026-07-02',
        summary: 'Mention the user study and attach the project abstract before the next follow-up.',
        direction: 'note',
        messageType: 'note',
        attachments: [],
      },
    ],
    scholarships: [
      {
        id: 'tour-fellowship',
        name: 'Graduate Research Fellowship',
        amount: 'Full funding',
        startDate: '2027-09-01',
        endDate: '2032-08-31',
        school: 'PhD Atlas Demo University',
        issuer: 'Graduate School',
        status: 'Preparing',
        notes: 'Use funding cards to track award requirements beside the main application.',
        materials: [
          { id: 'tour-fellowship-proposal', name: 'Research statement', status: 'Draft', due: '2026-10-01', details: 'Two-page statement' },
        ],
        tasks: [
          { id: 'tour-fellowship-task', title: 'Ask department about nomination route', due: '2026-08-05', done: false },
        ],
        timeline: [
          { id: 'tour-fellowship-event', title: 'Funding shortlist', date: '2026-09-10', note: 'Department review starts.' },
        ],
      },
    ],
    fees: [
      {
        id: 'tour-fee-1',
        amount: 95,
        currency: 'USD',
        paidDate: null,
        waived: false,
        notes: 'Sample fee entry',
        createdAt: '2026-07-01T09:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'tour-task-outline',
        title: 'Finalize research fit paragraph',
        due: '2026-07-15',
        done: false,
        details: 'Tie prior work to Prof. Chen\'s current lab direction.',
        reminderEnabled: true,
        reminderOffsets: ['3d'],
        reminderTime: '09:00',
        reminderRepeat: 'once',
      },
      {
        id: 'tour-task-portal',
        title: 'Check portal document rules',
        due: '2026-07-20',
        done: false,
        details: 'Confirm PDF size limits and recommender invitation flow.',
      },
    ],
    timeline: [
      {
        id: 'tour-timeline-shortlist',
        title: 'Shortlisted program',
        date: '2026-06-28',
        note: 'Strong research overlap and realistic deadline.',
      },
      {
        id: 'tour-timeline-email',
        title: 'Advisor email reply',
        date: '2026-07-01',
        note: 'Follow up with a one-page project summary.',
      },
    ],
    versions: [],
    shares: [],
    reviewComments: [],
    backupSettings: {
      autoBackup: false,
      frequency: 'weekly',
      maxBackups: 3,
    },
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-02T09:00:00.000Z',
  }
}

function persistLanguagePreference(language: Language) {
  try {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, resolveLanguage(language))
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function readLanguagePreference(): Language | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_PREFERENCE_KEY)
    return stored ? resolveLanguage(stored) : null
  } catch {
    return null
  }
}

function readInitialLanguage(): Language {
  return readLanguagePreference() ?? browserDefaultLanguage()
}

const criticalScreenWarmups = new Map<string, Promise<void>>()

async function warmCriticalScreenAssets(
  screen: Screen,
  tab: DetailTab,
  lang: Language,
  viewMode: 'list' | 'kanban',
) {
  const cacheKey = `${screen}:${tab}:${lang}:${viewMode}`
  const inFlight = criticalScreenWarmups.get(cacheKey)
  if (inFlight) return inFlight

  const tasks: Array<() => Promise<unknown>> = [
    () => preloadLanguage(lang, languageNamespacesForScreen(screen, tab)),
  ]

  if (screen === 'dashboard') {
    tasks.push(loadDashboardScreen)
  } else if (screen === 'workspace') {
    tasks.push(loadApplicationPane, loadInspector, viewMode === 'kanban' ? loadKanbanBoard : loadDossierView)
  } else if (screen === 'discover') {
    tasks.push(loadDiscoverScreen)
  } else if (screen === 'profile') {
    tasks.push(loadProfileScreen)
  } else if (screen === 'settings') {
    tasks.push(loadSettingsScreen)
  } else if (screen === 'team') {
    tasks.push(loadTeamScreen)
  }

  const warmup = Promise.all(tasks.map((task) => task().catch(() => undefined))).then(() => undefined)
  criticalScreenWarmups.set(cacheKey, warmup)
  void warmup.finally(() => {
    if (criticalScreenWarmups.get(cacheKey) === warmup) criticalScreenWarmups.delete(cacheKey)
  })
  return warmup
}

function isJsdomRuntime() {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
}

type ConfirmDialogState = {
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
}

type NavigationGuard = (proceed: () => void) => boolean

// ---------------------------------------------------------------------------
// URL routing — deep-linkable screens without a router library. The app's
// existing navigation model (screen / selectedId / tab as plain state) stays
// the source of truth; these helpers just translate that state to and from
// `location.pathname` so the address bar reflects it and typed/bookmarked
// URLs can restore it, all via the History API (no full page reloads).
// ---------------------------------------------------------------------------

function segmentForScreen(screen: Screen): string {
  if (screen === 'dashboard') return ''
  if (screen === 'workspace') return 'applications'
  return screen
}

function screenForSegment(segment: string): Screen | null {
  if (segment === 'applications') return 'workspace'
  return (validScreens as string[]).includes(segment) ? (segment as Screen) : null
}

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseRouteTab(value: string | undefined) {
  return value && validTabs.includes(value as DetailTab) ? (value as DetailTab) : 'dossier'
}

function pathForRoute(
  screen: Screen,
  selectedId: string | null,
  tab: DetailTab,
  teamSection: TeamSection,
  interfaceMode: InterfaceMode,
): string {
  if (screen === 'workspace') {
    if (interfaceMode === 'team') {
      return selectedId
        ? `/team/applications/${encodeURIComponent(selectedId)}/${tab}`
        : '/team/applications'
    }
    if (selectedId) return `/applications/${encodeURIComponent(selectedId)}/${tab}`
  }
  if (screen === 'team') {
    return teamSection === 'overview' ? '/team' : `/team/${teamSection}`
  }
  const segment = segmentForScreen(screen)
  return segment ? `/${segment}` : '/'
}

type ParsedRoute = {
  screen: Screen
  selectedId: string | null
  tab: DetailTab
  teamSection: TeamSection
  interfaceMode: InterfaceMode | null
}

/** Returns null when the path doesn't match any known screen — the caller shows a 404. */
function parseRoute(pathname: string): ParsedRoute | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) {
    return { screen: 'dashboard', selectedId: null, tab: 'dossier', teamSection: 'overview', interfaceMode: null }
  }
  const screen = screenForSegment(parts[0])
  if (!screen) return null
  if (screen === 'workspace') {
    if (parts.length > 3) return null
    const id = parts[1] ? decodeRouteSegment(parts[1]) : null
    if (isTourSampleApplicationId(id)) {
      return { screen: 'dashboard', selectedId: null, tab: 'dossier', teamSection: 'overview', interfaceMode: null }
    }
    return { screen, selectedId: id, tab: parseRouteTab(parts[2]), teamSection: 'overview', interfaceMode: 'personal' }
  }
  if (screen === 'team') {
    const teamSegment = parts[1]
    if (!teamSegment) {
      return { screen, selectedId: null, tab: 'dossier', teamSection: 'overview', interfaceMode: 'team' }
    }
    if (teamSegment === 'applications' && !parts[2]) {
      return {
        screen: 'workspace',
        selectedId: null,
        tab: 'dossier',
        teamSection: 'applications',
        interfaceMode: 'team',
      }
    }
    if (teamSegment === 'applications' && parts[2]) {
      if (parts.length > 4) return null
      const id = decodeRouteSegment(parts[2])
      if (isTourSampleApplicationId(id)) {
        return { screen: 'dashboard', selectedId: null, tab: 'dossier', teamSection: 'overview', interfaceMode: null }
      }
      return {
        screen: 'workspace',
        selectedId: id,
        tab: parseRouteTab(parts[3]),
        teamSection: 'applications',
        interfaceMode: 'team',
      }
    }
    if (parts.length === 2 && validTeamSections.includes(teamSegment as TeamSection)) {
      return {
        screen,
        selectedId: null,
        tab: 'dossier',
        teamSection: teamSegment as TeamSection,
        interfaceMode: 'team',
      }
    }
    return null
  }
  if (parts.length > 1) return null
  return { screen, selectedId: null, tab: 'dossier', teamSection: 'overview', interfaceMode: null }
}

function loadStoredScreen(): Screen {
  const parsed = parseRoute(window.location.pathname)
  if (parsed) return parsed.screen
  try {
    const stored = localStorage.getItem(SCREEN_KEY) as Screen | null
    return stored && validScreens.includes(stored) ? stored : 'dashboard'
  } catch {
    return 'dashboard'
  }
}

function loadStoredSelectedId(): string | null {
  const parsed = parseRoute(window.location.pathname)
  if (parsed) return parsed.screen === 'workspace' ? parsed.selectedId : null
  try {
    const stored = localStorage.getItem(SELECTED_ID_KEY)
    return isTourSampleApplicationId(stored) ? null : stored
  } catch {
    return null
  }
}

function loadStoredRecentOpenedIds(): string[] {
  try {
    const stored = safeParseJson<unknown>(localStorage.getItem(RECENT_OPENED_KEY))
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === 'string' && !isTourSampleApplicationId(id)).slice(0, RECENT_OPENED_LIMIT)
      : []
  } catch {
    return []
  }
}

function inspectorPastDeadlinesKey(userId: string) {
  return `${INSPECTOR_PAST_DEADLINES_KEY_PREFIX}:${userId}`
}

function loadStoredPastDeadlineVisibility(userId?: string | null) {
  if (!userId) return false
  try {
    return localStorage.getItem(inspectorPastDeadlinesKey(userId)) === '1'
  } catch {
    return false
  }
}

function loadStoredTab(): DetailTab {
  const parsed = parseRoute(window.location.pathname)
  if (parsed) return parsed.tab
  try {
    const stored = localStorage.getItem(TAB_KEY) as DetailTab | null
    return stored && validTabs.includes(stored) ? stored : 'dossier'
  } catch {
    return 'dossier'
  }
}

function cloneApplication(application: ApplicationRecord) {
  if (typeof structuredClone === 'function') {
    return structuredClone(application) as ApplicationRecord
  }
  return JSON.parse(JSON.stringify(application)) as ApplicationRecord
}

function normalizeError(error: unknown, lang: Language = 'en') {
  return normalizeErrorMessage(error, lang)
}

function safeSetItem(key: string, value: string) {
  try { localStorage.setItem(key, value) }
  catch { console.warn('localStorage full:', key) }
}
function safeSetJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { console.warn('localStorage full:', key) }
}

function readSessionReturnStack(): SessionReturnStackItem[] {
  try {
    const stored = safeParseJson<unknown>(localStorage.getItem(SESSION_RETURN_STACK_KEY))
    if (!Array.isArray(stored)) return []
    return stored.filter((item): item is SessionReturnStackItem => (
      Boolean(item) &&
      typeof item === 'object' &&
      Boolean((item as SessionReturnStackItem).session?.token) &&
      validScreens.includes((item as SessionReturnStackItem).screen) &&
      validTabs.includes((item as SessionReturnStackItem).tab)
    ))
  } catch {
    return []
  }
}

function loadStoredTeamSection(): TeamSection {
  const parsed = parseRoute(window.location.pathname)
  if (parsed) return parsed.teamSection
  try {
    const stored = localStorage.getItem(TEAM_SECTION_KEY) as TeamSection | null
    return stored && validTeamSections.includes(stored) ? stored : 'overview'
  } catch {
    return 'overview'
  }
}

function loadStoredActiveTeamId(): string | null {
  try {
    const stored = localStorage.getItem(ACTIVE_TEAM_ID_KEY)
    return stored && stored.trim() ? stored : null
  } catch {
    return null
  }
}

function pushSessionReturnStack(item: SessionReturnStackItem) {
  const stack = readSessionReturnStack()
  safeSetJson(SESSION_RETURN_STACK_KEY, [...stack, item].slice(-4))
}

function popSessionReturnStack() {
  const stack = readSessionReturnStack()
  const item = stack.pop() ?? null
  if (stack.length > 0) {
    safeSetJson(SESSION_RETURN_STACK_KEY, stack)
  } else {
    localStorage.removeItem(SESSION_RETURN_STACK_KEY)
  }
  return item
}

function isAuthExpired(error: unknown) {
  return error instanceof ApiError &&
    error.status === 401 &&
    ['TOKEN_EXPIRED', 'UNAUTHORIZED', 'UNKNOWN_USER', 'ACCOUNT_DISABLED'].includes(error.code)
}

function safeFileSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'application'
}

function expiresAtForShare(expiry: ShareExpiry) {
  if (expiry === 'never') return null
  const durations: Record<Exclude<ShareExpiry, 'never'>, number> = {
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() + durations[expiry]).toISOString()
}

function WorkspaceResizeHandle({
  label,
  className,
  onPointerDown,
  onKeyDown,
}: {
  label: string
  className?: string
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={`workspace-resize-handle${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )
}

function WorkspaceLayoutToolbar({
  applicationsHidden,
  inspectorHidden,
  isDirty,
  saving,
  tx,
  viewMode,
  onToggleApplications,
  onToggleInspector,
  onSwap,
  onReset,
  onSave,
  onDiscard,
  onViewModeChange,
  showViewModeToggle = true,
}: {
  applicationsHidden: boolean
  inspectorHidden: boolean
  isDirty: boolean
  saving: boolean
  tx: (path: string, fallback?: string) => string
  viewMode: 'list' | 'kanban'
  onToggleApplications: () => void
  onToggleInspector: () => void
  onSwap: () => void
  onReset: () => void
  onSave: () => void
  onDiscard: () => void
  onViewModeChange: (mode: 'list' | 'kanban') => void
  // False in the team-scoped workspace — the kanban board assumes single-owner bulk status
  // changes, which doesn't fit "browsing my team's applications."
  showViewModeToggle?: boolean
}) {
  const ApplicationIcon = applicationsHidden ? PanelLeftOpen : PanelLeftClose
  const InspectorIcon = inspectorHidden ? PanelRightOpen : PanelRightClose
  const [showSaveActions, setShowSaveActions] = useState(isDirty)
  const [saveActionsClosing, setSaveActionsClosing] = useState(false)

  useEffect(() => {
    if (isDirty) {
      setSaveActionsClosing(false)
      setShowSaveActions(true)
      return undefined
    }
    if (!showSaveActions) return undefined
    setSaveActionsClosing(true)
    const timer = window.setTimeout(() => {
      setShowSaveActions(false)
      setSaveActionsClosing(false)
    }, 200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty])

  return (
    <div className="workspace-layout-toolbar">
      {showViewModeToggle ? (
        <div className={`mobile-workspace-view-toggle ${viewMode === 'kanban' ? 'is-board' : 'is-list'}`}>
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => onViewModeChange('list')}
            aria-label={tx('kanban.listView', 'List view')}
            aria-pressed={viewMode === 'list'}
          >
            <List size={16} aria-hidden="true" />
            <span>{tx('kanban.list', 'List')}</span>
          </button>
          <button
            type="button"
            className={viewMode === 'kanban' ? 'active' : ''}
            onClick={() => onViewModeChange('kanban')}
            aria-label={tx('kanban.boardView', 'Kanban view')}
            aria-pressed={viewMode === 'kanban'}
          >
            <Columns size={16} aria-hidden="true" />
            <span>{tx('kanban.board', 'Board')}</span>
          </button>
        </div>
      ) : null}
      {showSaveActions && (
        <div className={`workspace-save-actions ${saveActionsClosing ? 'is-closing' : 'is-opening'}`}>
          <button type="button" className="warning-action workspace-discard-btn" onClick={onDiscard}>
            <Undo2 size={13} aria-hidden="true" /> {tx('dossier.discardChanges')}
          </button>
          <button type="button" className="primary-action workspace-save-btn" onClick={onSave} disabled={saving}>
            <Save size={13} aria-hidden="true" /> {saving ? tx('dossier.saving') : tx('dossier.save')}
          </button>
        </div>
      )}
      <div className="workspace-layout-toolbar-panel">
        <div className="workspace-layout-toolbar-body">
          <div className="workspace-layout-toolbar-body-inner">
            <div className="workspace-layout-actions">
              <button
                type="button"
                className={!applicationsHidden ? 'active' : ''}
                onClick={onToggleApplications}
                title={applicationsHidden ? tx('explorer.showApplications') : tx('explorer.hideApplications')}
                aria-pressed={!applicationsHidden}
              >
                <ApplicationIcon size={14} aria-hidden="true" />
                <span>{applicationsHidden ? tx('explorer.showApplicationsShort') : tx('explorer.hideApplicationsShort')}</span>
              </button>
              <button
                type="button"
                className={!inspectorHidden ? 'active' : ''}
                onClick={onToggleInspector}
                title={inspectorHidden ? tx('explorer.showInspector') : tx('explorer.hideInspector')}
                aria-pressed={!inspectorHidden}
              >
                <InspectorIcon size={14} aria-hidden="true" />
                <span>{inspectorHidden ? tx('explorer.showInspectorShort') : tx('explorer.hideInspectorShort')}</span>
              </button>
              <button type="button" onClick={onSwap} title={tx('explorer.swapPanels')}>
                <ArrowRightLeft size={14} aria-hidden="true" />
                <span>{tx('explorer.swapPanelsShort')}</span>
              </button>
              <button type="button" onClick={onReset} title={tx('explorer.resetLayout')}>
                <RotateCcw size={14} aria-hidden="true" />
                <span>{tx('explorer.resetLayoutShort')}</span>
              </button>
            </div>
            {showViewModeToggle ? (
              <div className={`view-mode-toggle ${viewMode === 'kanban' ? 'is-board' : 'is-list'}`}>
                <button
                  type="button"
                  className={viewMode === 'list' ? 'active' : ''}
                  onClick={() => onViewModeChange('list')}
                  title={tx('kanban.listView', 'List view')}
                  aria-label={tx('kanban.listView', 'List view')}
                  aria-pressed={viewMode === 'list'}
                >
                  <List size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={viewMode === 'kanban' ? 'active' : ''}
                  onClick={() => onViewModeChange('kanban')}
                  title={tx('kanban.boardView', 'Kanban view')}
                  aria-label={tx('kanban.boardView', 'Kanban view')}
                  aria-pressed={viewMode === 'kanban'}
                >
                  <Columns size={13} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <button type="button" className="workspace-toolbar-toggle" aria-label={tx('explorer.layout')}>
          <SlidersHorizontal size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function MailSyncJobWatcher({
  job,
  onPoll,
}: {
  job?: MailSyncJob | null
  onPoll: (jobId: string) => Promise<boolean>
}) {
  const onPollRef = useRef(onPoll)
  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    onPollRef.current = onPoll
  }, [onPoll])

  useEffect(() => {
    if (!jobId || !jobStatus || !['queued', 'running'].includes(jobStatus)) return
    let cancelled = false
    let timer: number | null = null
    const poll = async () => {
      const keepPolling = await onPollRef.current(jobId).catch(() => true)
      if (!cancelled && keepPolling) timer = window.setTimeout(poll, 1800)
    }
    timer = window.setTimeout(poll, 900)
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [jobId, jobStatus])

  return null
}

export default function App() {
  // Theme
  const themeProvider = useThemeProvider()
  const pwaInstall = usePwaInstall()
  const connectivity = useConnectivity()
  const isOnline = connectivity.mode !== 'offline' && connectivity.mode !== 'server-unreachable'

  // Session
  const [session, setSession] = useState<AuthSession | null>(() =>
    safeParseJson<AuthSession>(localStorage.getItem(SESSION_KEY)),
  )
  const [authLanguage, setAuthLanguage] = useState<Language>(readInitialLanguage)
  const [offlineDataActive, setOfflineDataActive] = useState(false)
  const [offlineSnapshotSavedAt, setOfflineSnapshotSavedAt] = useState<string | null>(() => (
    session ? loadOfflineSnapshot(session)?.savedAt ?? null : null
  ))
  const [offlineQueueCount, setOfflineQueueCount] = useState(() =>
    session ? offlineQueueSize(session.user.id) : 0,
  )
  const [blockedOfflineCount, setBlockedOfflineCount] = useState(() =>
    session ? blockedOfflineQueueSize(session.user.id) : 0,
  )
  const [syncingOffline, setSyncingOffline] = useState(false)
  const [pwaUpdateReady, setPwaUpdateReady] = useState(false)
  const [passkeys, setPasskeys] = useState<PasskeyCredentialSummary[]>([])
  const [removingPasskeyIds, setRemovingPasskeyIds] = useState<Set<string>>(() => new Set())
  const passkeyAvailable = useMemo(() => typeof window.PublicKeyCredential === 'function', [])

  // Per-browser choice wins over account state so a visitor's local language
  // preference stays consistent across signed-in and public-link surfaces.
  const lang: Language = authLanguage
  const languageRef = useRef<Language>(lang)

  function changeAuthLanguage(nextLang: Language) {
    const resolved = resolveLanguage(nextLang)
    setAuthLanguage(resolved)
    persistLanguagePreference(resolved)
    void preloadLanguage(resolved, ['core', 'shared', 'settings', 'resetPassword'])
  }

  // Navigation
  const [screen, setScreen] = useState<Screen>(loadStoredScreen)
  // True when the current URL didn't match any known screen at all (vs. a known screen with
  // a stale/missing sub-resource, e.g. a deleted application — see applicationNotFound below).
  const [routeNotFound, setRouteNotFound] = useState(() => parseRoute(window.location.pathname) === null)
  const routeSyncedRef = useRef(false)
  // Personal ⇄ Team nav context for institution-admin/teacher/student roles — see teamViewerRole
  // below, which clamps this back to 'personal' for students and non-team users.
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(() => {
    const parsed = parseRoute(window.location.pathname)
    if (parsed?.interfaceMode) return parsed.interfaceMode
    try {
      const stored = localStorage.getItem(INTERFACE_MODE_KEY)
      return stored === 'team' ? 'team' : 'personal'
    } catch {
      return 'personal'
    }
  })
  // Which teammate's applications the Team Applications workspace is narrowed to — set from the
  // Team Overview "By Student" panel or a member's "View applications" action. Ephemeral (not
  // persisted): always resets to "everyone" on logout/mode change, never restored on reload.
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null)
  const [newApplicationOwnerHint, setNewApplicationOwnerHint] = useState<string | null>(null)

  // Data
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [applicationsLoaded, setApplicationsLoaded] = useState(false)
  /** True only after the first shell paint under the boot curtain — prevents post-load jank. */
  const [shellPaintReady, setShellPaintReady] = useState(false)
  /** Full-screen handoff while switching personal ⇄ team (or active team). */
  const [workspaceHandoff, setWorkspaceHandoff] = useState<{
    target: InterfaceMode
    variant: LoadingVariant
  } | null>(null)
  const workspaceHandoffSeqRef = useRef(0)
  const [profileAssets, setProfileAssets] = useState<ProfileAsset[]>([])
  // Keep an item mounted through its exit animation before the API mutation
  // removes it from the collection. This avoids the familiar "row jumps away"
  // feeling after a destructive confirmation.
  const [removingProfileAssetIds, setRemovingProfileAssetIds] = useState<Set<string>>(() => new Set())
  const [aiKeys, setAiKeys] = useState<AiKey[]>([])
  const [teamSummary, setTeamSummary] = useState<TeamSummary | null>(null)
  const [teamWorkspaces, setTeamWorkspaces] = useState<TeamWorkspaceOption[]>([])
  const [activeTeamId, setActiveTeamId] = useState<string | null>(loadStoredActiveTeamId)
  const [teamLookupComplete, setTeamLookupComplete] = useState(false)
  // Only populated for active team roles — see the teamApplications fetch effect below.
  const [teamApplications, setTeamApplications] = useState<TeamApplicationRecord[]>([])
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [removingBackupFileNames, setRemovingBackupFileNames] = useState<Set<string>>(() => new Set())
  const [applicationTrash, setApplicationTrash] = useState<ApplicationTrashItem[]>([])
  const [removingApplicationIds, setRemovingApplicationIds] = useState<Set<string>>(() => new Set())
  const [removingTrashItemIds, setRemovingTrashItemIds] = useState<Set<string>>(() => new Set())

  // Selection
  const [selectedId, setSelectedId] = useState<string | null>(loadStoredSelectedId)
  // Presentation preference only: keep it scoped to the signed-in account and
  // browser profile so an installed PWA and the browser share the same choice.
  const [showPastInspectorDeadlines, setShowPastInspectorDeadlines] = useState(() =>
    loadStoredPastDeadlineVisibility(session?.user.id),
  )
  const [aiInspectorOpen, setAiInspectorOpen] = useState(false)
  const handleAiInspectorOpenChange = useCallback((open: boolean) => {
    setAiInspectorOpen(open)
  }, [])
  // Mobile-only: whether the drill-down detail view (vs. the application list) is showing.
  // Independent of selectedId, which auto-falls-back to applications[0] and must never be nulled
  // out just to "go back" (see the auto-select effect below).
  const [mobileDetailOpen, setMobileDetailOpen] = useState(() => {
    const initialRoute = parseRoute(window.location.pathname)
    return initialRoute?.screen === 'workspace' && Boolean(initialRoute.selectedId)
  })
  // Phones present applications as a drill-down flow. Remember which surface
  // launched the dossier so Back returns to that surface instead of always
  // forcing the Kanban board.
  const mobileDetailOriginRef = useRef<'dashboard' | 'list' | 'kanban'>('list')
  const [compactWorkspaceViewport, setCompactWorkspaceViewport] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches
  ))
  const [recentOpenedIds, setRecentOpenedIds] = useState<string[]>(loadStoredRecentOpenedIds)
  const [draft, setDraft] = useState<ApplicationRecord | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const draftRef = useRef<ApplicationRecord | null>(null)
  const draftBaselineRef = useRef<string | null>(null)
  const draftBaselineVersionRef = useRef(0)
  const draftMutationVersionRef = useRef(0)
  const draftDirtyCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftBaselineTaskRef = useRef<{ handle: number; idle: boolean } | null>(null)
  const draftBaselinePendingRef = useRef<{ draft: ApplicationRecord | null; version: number } | null>(null)
  const schoolLogoInFlightRef = useRef(new Map<string, Promise<boolean>>())

  const clearDraftBaselineTask = useCallback(() => {
    const pending = draftBaselineTaskRef.current
    if (!pending) return
    const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void }
    if (pending.idle) idleWindow.cancelIdleCallback?.(pending.handle)
    else window.clearTimeout(pending.handle)
    draftBaselineTaskRef.current = null
  }, [])

  const scheduleDraftBaseline = useCallback((nextDraft: ApplicationRecord | null, version: number) => {
    clearDraftBaselineTask()

    const commitBaseline = () => {
      draftBaselineTaskRef.current = null
      if (draftBaselineVersionRef.current !== version) return

      const baseline = nextDraft ? JSON.stringify(nextDraft) : null
      if (draftBaselineVersionRef.current !== version) return

      draftBaselineRef.current = baseline
      if (draftBaselinePendingRef.current?.version === version) {
        draftBaselinePendingRef.current = null
      }

      const currentDraft = draftRef.current
      setDraftDirty(Boolean(currentDraft && baseline && JSON.stringify(currentDraft) !== baseline))
    }

    if (isJsdomRuntime()) {
      commitBaseline()
      return
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    }
    draftBaselineTaskRef.current = idleWindow.requestIdleCallback
      ? { handle: idleWindow.requestIdleCallback(commitBaseline, { timeout: 900 }), idle: true }
      : { handle: window.setTimeout(commitBaseline, 220), idle: false }
  }, [clearDraftBaselineTask])

  const setDraftState = useCallback((
    nextDraft: ApplicationRecord | null,
    options?: { clean?: boolean; dirty?: boolean; deferBaseline?: boolean },
  ) => {
    if (draftDirtyCheckTimerRef.current) {
      clearTimeout(draftDirtyCheckTimerRef.current)
      draftDirtyCheckTimerRef.current = null
    }
    draftMutationVersionRef.current += 1
    draftRef.current = nextDraft
    setDraft(nextDraft)
    if (options?.clean) {
      draftBaselineVersionRef.current += 1
      const baselineVersion = draftBaselineVersionRef.current
      setDraftDirty(false)
      if (options.deferBaseline && nextDraft) {
        draftBaselineRef.current = null
        draftBaselinePendingRef.current = { draft: nextDraft, version: baselineVersion }
        scheduleDraftBaseline(nextDraft, baselineVersion)
        return
      }
      clearDraftBaselineTask()
      draftBaselinePendingRef.current = null
      draftBaselineRef.current = nextDraft ? JSON.stringify(nextDraft) : null
      return
    }
    if (typeof options?.dirty === 'boolean') {
      setDraftDirty(options.dirty)
      return
    }
    const baselinePending = draftBaselinePendingRef.current
    if (!nextDraft || (!draftBaselineRef.current && !baselinePending)) {
      setDraftDirty(false)
      return
    }

    // Editing large dossiers used to stringify the complete application on every
    // keystroke. Mark the draft dirty synchronously for navigation safety, then
    // perform the exact baseline comparison once the input burst has settled.
    setDraftDirty(true)
    if (!draftBaselineRef.current) return
    const baselineVersion = draftBaselineVersionRef.current
    draftDirtyCheckTimerRef.current = setTimeout(() => {
      draftDirtyCheckTimerRef.current = null
      if (draftBaselineVersionRef.current !== baselineVersion || draftRef.current !== nextDraft) return
      setDraftDirty(JSON.stringify(nextDraft) !== draftBaselineRef.current)
    }, 180)
  }, [clearDraftBaselineTask, scheduleDraftBaseline])

  useEffect(() => () => {
    if (draftDirtyCheckTimerRef.current) clearTimeout(draftDirtyCheckTimerRef.current)
    clearDraftBaselineTask()
  }, [clearDraftBaselineTask])

  // Workspace state
  const [query, setQuery] = useState('')
  const [statusFilters, setStatusFilters] = useState<ApplicationStatus[]>([])
  const [sort, setSort] = useState<SortKey>('deadline')
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => {
    const parsed = parseRoute(window.location.pathname)
    if (parsed?.screen === 'workspace') {
      return parsed.selectedId ? 'list' : 'kanban'
    }
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY)
      return stored === 'kanban' ? 'kanban' : 'list'
    } catch {
      return 'kanban'
    }
  })
  const [teamSection, setTeamSection] = useState<TeamSection>(loadStoredTeamSection)
  const [teamDiscoverTargetUserId, setTeamDiscoverTargetUserId] = useState<string | null>(null)
  const [viewModeDirection, setViewModeDirection] = useState<'to-list' | 'to-kanban'>(
    viewMode === 'kanban' ? 'to-kanban' : 'to-list',
  )
  const [workspaceViewExit, setWorkspaceViewExit] = useState<'to-kanban' | null>(null)
  const [tab, setTab] = useState<DetailTab>(loadStoredTab)
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutState>(loadStoredWorkspaceLayout)
  const workspaceShellRef = useRef<HTMLDivElement | null>(null)
  const [workspaceOpeningFromDashboard, setWorkspaceOpeningFromDashboard] = useState(false)
  const [workspaceJumpIntent, setWorkspaceJumpIntent] = useState<DossierJumpIntent | null>(null)
  const workspaceJumpTokenRef = useRef(0)
  const workspaceViewExitTimerRef = useRef<number | null>(null)
  const detailDraftHydrationRef = useRef<{ handle: number; idle: boolean } | null>(null)
  const detailDraftHydrationGenerationRef = useRef(0)

  const clearDetailDraftHydration = useCallback(() => {
    detailDraftHydrationGenerationRef.current += 1
    const scheduled = detailDraftHydrationRef.current
    if (!scheduled) return
    const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void }
    if (scheduled.idle) idleWindow.cancelIdleCallback?.(scheduled.handle)
    else window.clearTimeout(scheduled.handle)
    detailDraftHydrationRef.current = null
  }, [])

  const scheduleDetailDraftHydration = useCallback((application: ApplicationRecord) => {
    clearDetailDraftHydration()
    const generation = ++detailDraftHydrationGenerationRef.current
    const hydrate = () => {
      detailDraftHydrationRef.current = null
      if (detailDraftHydrationGenerationRef.current !== generation) return
      const nextDraft = cloneApplication(application)
      // This callback already runs in idle time (or the jsdom fast path). Commit the
      // lightweight draft pointer immediately so it cannot be starved behind an
      // earlier navigation transition while the dossier chunk is resolving.
      setDraftState(nextDraft, { clean: true })
    }

    if (isJsdomRuntime()) {
      hydrate()
      return
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    }
    detailDraftHydrationRef.current = idleWindow.requestIdleCallback
      ? { handle: idleWindow.requestIdleCallback(hydrate, { timeout: 240 }), idle: true }
      : { handle: window.setTimeout(hydrate, 190), idle: false }
  }, [clearDetailDraftHydration, setDraftState])

  // UI state
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [pendingDiscard, setPendingDiscard] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [dossierEnrichmentOpen, setDossierEnrichmentOpen] = useState(false)
  const [teamWorkspaceChooserOpen, setTeamWorkspaceChooserOpen] = useState(false)
  const [pendingTeamWorkspaceEntry, setPendingTeamWorkspaceEntry] = useState<{ screen?: Screen; teamSection?: TeamSection } | null>(null)
  const [shareExpiry, setShareExpiry] = useState<ShareExpiry>('7d')
  const [sharePermission, setSharePermission] = useState<SharePermission>('view')
  const [shareScopeSections, setShareScopeSections] = useState<ShareSection[]>([...allShareSections])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const pendingGoShortcutRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 820px)')
    const update = () => setCompactWorkspaceViewport(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  const i18nNamespaces = useMemo(() => session
    ? languageNamespacesForScreen(screen, tab)
    : ['core', 'shared', 'settings', 'resetPassword'], [
    screen,
    session,
    tab,
  ])
  const i18nValue = useI18nValue(lang, i18nNamespaces)

  // Notifications
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [discoverRealtimeRevision, setDiscoverRealtimeRevision] = useState(0)

  // Top notification stack. Each item owns an independent pause/resume timer.
  const { toasts, notify, dismissToast, pauseToast, resumeToast, clearToasts } = useToastQueue()

  const initialSessionRef = useRef(session)
  const initialScreenRef = useRef(screen)
  const initialTabRef = useRef(tab)
  const initialViewModeRef = useRef(viewMode)
  const initialLanguageRef = useRef(lang)
  const sessionExpiredRef = useRef(false)
  const cancelledRef = useRef(false)
  // Cold-start workspace boot runs once per mount. Re-running it after logout /
  // re-login would re-seed the expired token into lineage and re-fire
  // "session expired" toasts against the fresh login.
  const sessionBootStartedRef = useRef(false)
  // Background callbacks (notification polling, push events) can outlive the render
  // that created them. Keep their credential source independent from a captured
  // `session` object so a same-account re-login cannot reuse the expired token.
  const currentSessionTokenRef = useRef<string | null>(session?.token ?? null)
  // Stable account identity for the mounted session. Token rotation is allowed;
  // swapping to another user's id is not (except intentional login/impersonate).
  const currentSessionUserIdRef = useRef<string | null>(session?.user.id ?? null)
  // Bumps on every intentional identity change so in-flight async commits that
  // captured an older generation can never rewrite the newly mounted account.
  const sessionIdentityEpochRef = useRef(0)
  const sessionTokenLineageRef = useRef<Set<string>>(new Set(session?.token ? [session.token] : []))
  const navigationGuardRef = useRef<NavigationGuard | null>(null)
  const activeTeamIdRef = useRef(activeTeamId)
  const refreshAllInFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null)
  const saveQueueByApplicationRef = useRef(new Map<string, Promise<void>>())
  const pendingSaveCountRef = useRef(0)
  const offlineSnapshotSaveRef = useRef<{ handle: number; idle: boolean } | null>(null)
  const taskToggleRequestRef = useRef(new Map<string, number>())
  // Exit motion is applied imperatively so a click never has to re-render the
  // whole application before the first composited frame can move. Enter motion
  // is committed alongside the destination tree below.
  const [cssFallbackCommit, setCssFallbackCommit] = useState<CssFallbackMotion | null>(null)
  // Native View Transition state lives on the document, so these inexpensive
  // ticks let React re-read it once the browser has released a snapshot.
  const [, setScreenTransitionEpoch] = useState(0)
  const [dossierContentDeferred, setDossierContentDeferred] = useState(false)
  const dossierContentTransitionRef = useRef(0)
  const animationSequenceRef = useRef(0)
  const animationFallbackTimersRef = useRef<number[]>([])
  const cssFallbackMotionRef = useRef<CssFallbackMotion | null>(null)
  const railNavigationSequenceRef = useRef(0)
  const deferredQuery = useDeferredValue(query)

  const applyCssFallbackMotion = useCallback((motion: CssFallbackMotion) => {
    const transitionRoot = document.documentElement
    cssFallbackMotionRef.current = motion
    clearNativeTransitionAttributes(transitionRoot)
    markTransitionedSurface(transitionRoot, motion.scope)
    transitionRoot.dataset.atlasFallbackScope = motion.scope
    transitionRoot.dataset.atlasFallbackDirection = motion.direction
    transitionRoot.dataset.atlasFallbackPhase = motion.phase
    transitionRoot.dataset.atlasFallbackToken = String(motion.token)
    transitionRoot.dataset.atlasFallbackCycle = String(motion.token % 2)
  }, [])

  const clearCssFallbackMotion = useCallback((token?: number) => {
    const transitionRoot = document.documentElement
    if (token !== undefined && transitionRoot.dataset.atlasFallbackToken !== String(token)) return
    if (token === undefined || cssFallbackMotionRef.current?.token === token) {
      cssFallbackMotionRef.current = null
    }
    clearCssFallbackAttributes(transitionRoot)
  }, [])

  useLayoutEffect(() => {
    if (!cssFallbackCommit) {
      if (!cssFallbackMotionRef.current) clearCssFallbackAttributes(document.documentElement)
      return undefined
    }

    const { token, scope, onTransitionFinished } = cssFallbackCommit
    if (animationSequenceRef.current !== token) return undefined

    applyCssFallbackMotion(cssFallbackCommit)
    const finishTimer = window.setTimeout(() => {
      if (animationSequenceRef.current !== token) return
      clearCssFallbackMotion(token)
      startTransition(() => {
        setCssFallbackCommit((current) => current?.token === token ? null : current)
      })
      onTransitionFinished?.()
    }, cssFallbackEnterDuration(scope))
    animationFallbackTimersRef.current = [finishTimer]

    return () => {
      window.clearTimeout(finishTimer)
      if (animationFallbackTimersRef.current[0] === finishTimer) {
        animationFallbackTimersRef.current = []
      }
    }
  }, [applyCssFallbackMotion, clearCssFallbackMotion, cssFallbackCommit])

  useEffect(() => () => {
    animationFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    animationFallbackTimersRef.current = []
    clearCssFallbackMotion()
  }, [clearCssFallbackMotion])

  const runAnimatedScreenUpdate = useCallback((
    update: () => void,
    {
      scope = 'screen',
      direction,
      onTransitionFinished,
      ready,
      readinessGate,
      forceCssFallback = false,
    }: AnimatedScreenTransitionOptions = {},
  ) => {
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const transitionRoot = document.documentElement
    const sequence = ++animationSequenceRef.current

    animationFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    animationFallbackTimersRef.current = []
    clearCssFallbackMotion()
    clearNativeTransitionAttributes(transitionRoot)
    if (reduceMotion || isJsdomRuntime()) {
      markTransitionedSurface(transitionRoot, scope)
      update()
      if (isJsdomRuntime()) onTransitionFinished?.()
      else window.requestAnimationFrame(() => onTransitionFinished?.())
      return
    }

    const resolvedDirection = direction ?? 'forward'
    const beginNativeTransition = () => {
      if (animationSequenceRef.current !== sequence) return

      if (forceCssFallback) {
        beginExit()
        return
      }

      const nativeDocument = document as ViewTransitionDocument
      const startViewTransition = nativeDocument.startViewTransition
      if (!startViewTransition) {
        beginExit()
        return
      }

      markTransitionedSurface(transitionRoot, scope)
      setNativeTransitionAttributes(transitionRoot, scope, resolvedDirection, sequence)

      try {
        const transition = startViewTransition.call(nativeDocument, () => {
          if (animationSequenceRef.current !== sequence) return
          // The browser retains the old bitmap while React commits the next
          // surface. This prevents a large tab or dashboard render from
          // freezing the outgoing page midway through a CSS-only handoff.
          flushSync(update)
        })

        void transition.finished.then(
          () => {
            if (animationSequenceRef.current !== sequence) return
            if (transitionRoot.dataset.atlasTransitionToken === String(sequence)) {
              clearNativeTransitionAttributes(transitionRoot)
            }
            onTransitionFinished?.()
          },
          () => {
            if (animationSequenceRef.current !== sequence) return
            if (transitionRoot.dataset.atlasTransitionToken === String(sequence)) {
              clearNativeTransitionAttributes(transitionRoot)
            }
            onTransitionFinished?.()
          },
        )
      } catch {
        clearNativeTransitionAttributes(transitionRoot)
        beginExit()
      }
    }

    const beginExit = (destinationReady?: Promise<unknown>) => {
      if (animationSequenceRef.current !== sequence) return
      // Mark the surface so child mount animations do not double-fire after the
      // handoff, then swap immediately. Sequential exit holds felt laggy.
      markTransitionedSurface(transitionRoot, scope)

      const commit = () => {
        if (animationSequenceRef.current !== sequence) return
        update()
        setCssFallbackCommit({
          token: sequence,
          scope,
          direction: resolvedDirection,
          phase: 'enter',
          onTransitionFinished,
        })
      }

      const commitWhenDestinationReady = () => {
        if (animationSequenceRef.current !== sequence) return
        // Prefer an urgent commit so the destination paints with the click, not
        // a frame later behind React's transition scheduler.
        if (
          forceCssFallback
          || ready
          || readinessGate
          || scope === 'dossier-tab'
          || scope === 'dossier-record'
          || scope === 'screen'
          || scope === 'workspace-view'
        ) {
          commit()
          return
        }
        startTransition(commit)
      }

      const exitMs = cssFallbackExitDuration(scope)
      if (exitMs <= 0) {
        if (destinationReady) {
          void destinationReady.then(commitWhenDestinationReady, commitWhenDestinationReady)
          return
        }
        commitWhenDestinationReady()
        return
      }

      // Legacy path: optional short exit hold (currently disabled via duration 0).
      applyCssFallbackMotion({
        token: sequence,
        scope,
        direction: resolvedDirection,
        phase: 'exit',
        onTransitionFinished,
      })
      const commitTimer = window.setTimeout(() => {
        if (animationSequenceRef.current !== sequence) return
        animationFallbackTimersRef.current = []
        if (destinationReady) {
          void destinationReady.then(commitWhenDestinationReady, commitWhenDestinationReady)
          return
        }
        commitWhenDestinationReady()
      }, exitMs)
      animationFallbackTimersRef.current = [commitTimer]
    }

    const waitForConcreteDestination = async () => {
      await ready
      if (!readinessGate || readinessGate.isReady()) return

      // A shared warmup can complete after an optional asset failed or was
      // cancelled. Confirm the exact lazy screen has resolved before taking a
      // native snapshot, otherwise Suspense can publish its full-page fallback.
      await readinessGate.preload()
    }

    const destinationReady = ready || readinessGate
      ? waitForConcreteDestination().catch(() => undefined)
      : undefined

    if (forceCssFallback) {
      // Hot destinations start moving immediately. For a truly cold lazy
      // screen, keep the current page steady until its concrete host exists;
      // this retains the no-skeleton guarantee without penalizing routine taps.
      if (!readinessGate || readinessGate.isReady()) {
        beginExit(destinationReady)
      } else {
        void destinationReady?.then(
          () => beginExit(),
          () => beginExit(),
        )
      }
      return
    }

    if (destinationReady) {
      // Leave the current surface intact while a cold target is prepared. The
      // rail indicator still responds immediately, and a newer click cancels
      // this preparation through its sequence token. Starting a View Transition
      // before a lazy route resolves can otherwise capture the generic Suspense
      // fallback, which reads like a full-page refresh.
      void destinationReady.then(beginNativeTransition, beginNativeTransition)
      return
    }

    beginNativeTransition()
  }, [applyCssFallbackMotion, clearCssFallbackMotion])

  const scheduleScreenProgressiveReveal = useCallback(() => {
    const reveal = () => {
      startTransition(() => setScreenTransitionEpoch((current) => current + 1))
    }
    if (isJsdomRuntime()) {
      reveal()
      return
    }
    window.requestAnimationFrame(reveal)
  }, [])

  const runAnimatedDossierUpdate = useCallback((
    update: () => void,
    options: AnimatedScreenTransitionOptions = {},
  ) => {
    const { onTransitionFinished, deferDossierContent = false, ...transitionOptions } = options
    // Keep tab/record content mounted on the same frame as the click. Deferring
    // the heavy shell produced a short blank stutter before every dossier tab.
    runAnimatedScreenUpdate(() => {
      const contentTransition = ++dossierContentTransitionRef.current
      setDossierContentDeferred(deferDossierContent)
      update()
      if (deferDossierContent && !isJsdomRuntime()) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (dossierContentTransitionRef.current !== contentTransition) return
            startTransition(() => setDossierContentDeferred(false))
          })
        })
      }
    }, {
      ...transitionOptions,
      forceCssFallback: true,
      onTransitionFinished,
    })
  }, [runAnimatedScreenUpdate])

  const runAnimatedRailScreenUpdate = useCallback((
    update: () => void,
    options: AnimatedScreenTransitionOptions = {},
  ) => {
    const { onTransitionFinished, ...transitionOptions } = options
    runAnimatedScreenUpdate(update, {
      ...transitionOptions,
      forceCssFallback: true,
      onTransitionFinished: () => {
        scheduleScreenProgressiveReveal()
        onTransitionFinished?.()
      },
    })
  }, [runAnimatedScreenUpdate, scheduleScreenProgressiveReveal])

  const prefetchDossierAssets = useCallback(() => {
    return Promise.all([
      loadDossierView(),
      loadInspector(),
      preloadLanguage(lang, ['core', 'shared', 'dossier']),
    ]).then(() => undefined, () => undefined)
  }, [lang])

  const rememberSessionToken = useCallback((token: string) => {
    sessionTokenLineageRef.current.add(token)
  }, [])

  const resetSessionTokenLineage = useCallback((token?: string) => {
    sessionTokenLineageRef.current = token ? new Set([token]) : new Set()
  }, [])

  const isCurrentSessionToken = useCallback((token?: string) => {
    return Boolean(token && sessionTokenLineageRef.current.has(token))
  }, [])

  /**
   * True when a request token still belongs to the *live* mounted session.
   * Lineage membership alone is not enough: after same-account re-login a
   * zombie pre-expiry token must never tear down the fresh session (or toast
   * "登录过期" again). Also rejects cross-account tokens (串号).
   */
  const isActiveSessionRequestToken = useCallback((token?: string) => {
    if (!token || !sessionTokenLineageRef.current.has(token)) return false
    const current = currentSessionTokenRef.current
    const currentUserId = currentSessionUserIdRef.current
    if (!current || !currentUserId) return false

    const requestSubject = readSessionTokenSubject(token)
    if (requestSubject && requestSubject !== currentUserId) return false
    const currentSubject = readSessionTokenSubject(current)
    if (currentSubject && currentSubject !== currentUserId) return false
    if (requestSubject && currentSubject && requestSubject !== currentSubject) return false

    if (token === current) return true
    const latestFromRequest = getLatestSessionToken(token)
    const latestCurrent = getLatestSessionToken(current)
    return latestFromRequest === current || latestFromRequest === latestCurrent
  }, [])

  useEffect(() => {
    languageRef.current = lang
    applyDocumentLanguage(lang)
  }, [lang])

  // Keep content-language packs (ja/ko/…) warm so insert-phrase previews and built-in
  // preset copy do not fall back to English when UI language is still en/zh.
  const sessionUserId = session?.user.id
  const sessionContentLanguagePrimary = session?.user.settings.contentLanguagePrimary
  const sessionContentLanguageSecondary = session?.user.settings.contentLanguageSecondary
  useEffect(() => {
    if (!sessionUserId) return
    const pair = contentLanguagesFromSettings({
      contentLanguagePrimary: sessionContentLanguagePrimary,
      contentLanguageSecondary: sessionContentLanguageSecondary,
    })
    void Promise.all([
      preloadLanguage(pair.primary, CONTENT_LANGUAGE_NAMESPACES),
      preloadLanguage(pair.secondary, CONTENT_LANGUAGE_NAMESPACES),
    ])
  }, [
    sessionContentLanguagePrimary,
    sessionContentLanguageSecondary,
    sessionUserId,
  ])

  useEffect(() => {
    setShowPastInspectorDeadlines(loadStoredPastDeadlineVisibility(session?.user.id))
  }, [session?.user.id])

  useEffect(() => {
    activeTeamIdRef.current = activeTeamId
    try {
      if (activeTeamId) {
        safeSetItem(ACTIVE_TEAM_ID_KEY, activeTeamId)
      } else {
        localStorage.removeItem(ACTIVE_TEAM_ID_KEY)
      }
    } catch {
      // The active organization is a convenience preference; server scoping remains authoritative.
    }
  }, [activeTeamId])

  const refreshOfflineQueueCounts = useCallback((userId?: string | null) => {
    if (!userId) {
      setOfflineQueueCount(0)
      setBlockedOfflineCount(0)
      return
    }
    setOfflineQueueCount(offlineQueueSize(userId))
    setBlockedOfflineCount(blockedOfflineQueueSize(userId))
  }, [])

  // Derived
  // Team role context (owner/admin/member), mirroring the site-admin override already
  // used in SettingsScreen (a site admin inspecting a team is always treated as its 'owner').
  // null when the user has no team at all.
  const canUseTeamFeatures = !PUBLIC_EDITION && Boolean(
    teamSummary &&
    (session?.user.role === 'admin' || teamSummary.team.ownerId === session?.user.id || teamSummary.membership?.status === 'active'),
  )
  const visibleTeamSummary = canUseTeamFeatures ? teamSummary : null
  const teamViewerRole: TeamRole | null = visibleTeamSummary
    ? (session?.user.role === 'admin' || visibleTeamSummary.team.ownerId === session?.user.id ? 'owner' : (visibleTeamSummary.membership?.role ?? null))
    : null
  // Every team role has a team-mode workspace. Students still keep their personal workspace
  // for private applications, but can switch into the team system for shared work.
  const canEnterTeamJoinSurface = !PUBLIC_EDITION && screen === 'team'
  const effectiveInterfaceMode: InterfaceMode = (teamViewerRole || canEnterTeamJoinSurface)
    ? interfaceMode
    : 'personal'
  const isTeamMode = effectiveInterfaceMode === 'team'
  const canUseWorkspaceBoard = !isTeamMode || teamViewerRole !== 'member'
  const canUsePersonalDiscover = hasPersonalDiscoverAccess(session)
  const canUseTeamDiscover = isTeamMode && hasTeamDiscoverAccess(teamViewerRole)
  const canUseDiscover = canAccessDiscover(effectiveInterfaceMode, session, teamViewerRole)
  const teamDiscoverScope = useMemo(() => (
    isTeamMode
      && teamViewerRole !== 'member'
      && teamDiscoverTargetUserId
      && (activeTeamId || visibleTeamSummary?.team.id)
      ? { teamId: activeTeamId || visibleTeamSummary!.team.id, targetUserId: teamDiscoverTargetUserId }
      : undefined
  ), [activeTeamId, isTeamMode, teamDiscoverTargetUserId, teamViewerRole, visibleTeamSummary?.team.id])

  useEffect(() => {
    if (!applicationsLoaded || screen !== 'discover') return
    if (canUseDiscover && (!isTeamMode || teamDiscoverScope)) return
    if (!canUseDiscover) setTeamDiscoverTargetUserId(null)
    if (isTeamMode && teamViewerRole) {
      setTeamSection(canUseDiscover ? 'discover' : 'overview')
      setScreen('team')
      return
    }
    setScreen('dashboard')
  }, [applicationsLoaded, canUseDiscover, isTeamMode, screen, teamDiscoverScope, teamViewerRole])

  useEffect(() => {
    if (!teamViewerRole || teamViewerRole === 'owner' || teamSection !== 'settings') return
    setTeamSection('overview')
  }, [teamSection, teamViewerRole])

  // Which application list backs the dashboard/workspace right now — team-scoped browsing reuses
  // the exact same screens and state machinery as the personal workspace, just fed a different list.
  const workspaceApplications: ApplicationRecord[] = isTeamMode ? teamApplications : applications
  const notificationApplications = useMemo(() => {
    const byId = new Map<string, ApplicationRecord>()
    applications.forEach((application) => byId.set(application.id, application))
    teamApplications.forEach((application) => byId.set(application.id, application))
    return Array.from(byId.values())
  }, [applications, teamApplications])
  // Every team-visible owner's display name, INCLUDING the viewer themselves (unlike the
  // teammates-only ownerNames map passed to Dashboard/ApplicationPane row chips) — used for the
  // owner-filter chips and the "By Student" breakdown, where "show my own apps too" is a real option.
  const ownerDirectory = useMemo(() => {
    const directory: Record<string, string> = {}
    for (const application of teamApplications) {
      const ownerId = application.ownerId
      if (!ownerId) continue
      if (!directory[ownerId]) {
        directory[ownerId] = ownerId === session?.user.id
          ? (session?.user.name ?? application.ownerName)
          : application.ownerName
      }
    }
    return directory
  }, [teamApplications, session?.user.id, session?.user.name])
  const ownerAvatarDirectory = useMemo(() => {
    const directory: Record<string, string | undefined> = {}
    for (const member of visibleTeamSummary?.members ?? []) {
      if (member.userId) directory[member.userId] = member.avatarUrl
    }
    if (session?.user.id) directory[session.user.id] = session.user.settings.avatarDataUrl
    return directory
  }, [session?.user.id, session?.user.settings.avatarDataUrl, visibleTeamSummary?.members])
  const studentGuidanceTeam = useMemo(() => {
    if (!visibleTeamSummary || teamViewerRole !== 'member') return undefined
    const members = visibleTeamSummary.members
      .filter((member) => (
        member.status === 'active'
        && (member.role === 'owner' || member.role === 'admin')
        && member.userId !== session?.user.id
      ))
      .sort((left, right) => {
        if (left.role !== right.role) return left.role === 'admin' ? -1 : 1
        return (left.displayName ?? left.invitedEmail).localeCompare(right.displayName ?? right.invitedEmail)
      })
      .map((member) => ({
        id: member.id,
        name: member.displayName ?? member.invitedEmail,
        avatarUrl: member.avatarUrl,
        role: member.role as 'owner' | 'admin',
        title: member.contactProfile?.title,
        department: member.contactProfile?.department,
        email: member.contactProfile?.contactEmail || member.invitedEmail,
        phone: member.contactProfile?.phone,
        office: member.contactProfile?.office,
        website: member.contactProfile?.website,
        availability: member.contactProfile?.availability,
        bio: member.contactProfile?.bio,
      }))
    return {
      teamName: visibleTeamSummary.team.name,
      members,
    }
  }, [session?.user.id, teamViewerRole, visibleTeamSummary])
  const applicationCountsByOwner = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const application of teamApplications) {
      const ownerId = application.ownerId
      if (!ownerId) continue
      counts[ownerId] = (counts[ownerId] ?? 0) + 1
    }
    return counts
  }, [teamApplications])
  const teamApplicationOwnerNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const application of teamApplications) {
      if (application.ownerId === session?.user.id) continue
      names[application.id] = application.ownerName
    }
    return names
  }, [teamApplications, session?.user.id])
  const ownerFilterOptions = useMemo(() => {
    const membersByUserId = new Map((visibleTeamSummary?.members ?? [])
      .filter((member) => member.userId)
      .map((member) => [member.userId!, member]))
    return Object.entries(ownerDirectory)
      .map(([id, name]) => {
        const member = membersByUserId.get(id)
        const teachers = teachersForStudent(member, membersByUserId)
        return {
          id,
          name,
          count: applicationCountsByOwner[id] ?? 0,
          advisorName: teachers.map((teacher) => teacher.displayName ?? teacher.invitedEmail).join(' · ') || null,
          role: member?.role ?? null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [applicationCountsByOwner, ownerDirectory, visibleTeamSummary?.members])
  const teamCreateStudentOptions = useMemo<NewApplicationStudentOption[]>(() => {
    const membersByUserId = new Map((visibleTeamSummary?.members ?? [])
      .filter((member) => member.userId)
      .map((member) => [member.userId!, member]))
    return discoverStudentMembers(visibleTeamSummary?.members ?? [], teamViewerRole, session?.user.id)
      .map((member) => {
        const teachers = teachersForStudent(member, membersByUserId)
        const id = member.userId!
        return {
          id,
          name: member.displayName ?? member.invitedEmail,
          email: member.invitedEmail,
          avatarUrl: member.avatarUrl,
          advisorName: teachers.map((teacher) => teacher.displayName ?? teacher.invitedEmail).join(' · ') || null,
          count: applicationCountsByOwner[id] ?? 0,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [applicationCountsByOwner, session?.user.id, teamViewerRole, visibleTeamSummary?.members])
  const newApplicationTeamMode: NewApplicationTeamMode = isTeamMode
    ? (teamViewerRole === 'member' ? 'team-self' : (teamViewerRole ? 'team-student-picker' : 'none'))
    : (teamViewerRole === 'member' ? 'student-toggle' : 'none')
  const defaultNewApplicationStudentId = newApplicationTeamMode === 'team-student-picker' &&
    (newApplicationOwnerHint || ownerFilter) &&
    teamCreateStudentOptions.some((student) => student.id === (newApplicationOwnerHint || ownerFilter))
    ? (newApplicationOwnerHint || ownerFilter)
    : null
  const teamApplicationRelations = useMemo(() => {
    const membersByUserId = new Map((visibleTeamSummary?.members ?? [])
      .filter((member) => member.userId)
      .map((member) => [member.userId!, member]))
    const relations: Record<string, { studentName: string; advisorName?: string | null }> = {}
    for (const application of teamApplications) {
      if (!application.ownerId) continue
      const owner = membersByUserId.get(application.ownerId)
      if (owner?.role !== 'member') continue
      const teachers = teachersForStudent(owner, membersByUserId)
      relations[application.id] = {
        studentName: owner.displayName ?? application.ownerName,
        advisorName: teachers.map((teacher) => teacher.displayName ?? teacher.invitedEmail).join(' · ') || null,
      }
    }
    return relations
  }, [teamApplications, visibleTeamSummary?.members])
  const readOnlyApplicationIds = useMemo(() => new Set<string>(), [])
  const effectiveOwnerFilter = isTeamMode ? ownerFilter : null

  useEffect(() => {
    if (teamLookupComplete && !PUBLIC_EDITION && screen === 'team' && interfaceMode !== 'team') {
      setInterfaceMode('team')
    }
  }, [interfaceMode, screen, teamLookupComplete])

  useEffect(() => {
    if (!teamLookupComplete || screen !== 'team' || teamViewerRole !== 'member') return
    if (teamSection !== 'members' && teamSection !== 'discover') return
    startTransition(() => setTeamSection('overview'))
  }, [screen, teamLookupComplete, teamSection, teamViewerRole])

  useEffect(() => {
    if (!teamLookupComplete || !canUseTeamFeatures || interfaceMode !== 'team') return
    if (screen !== 'dashboard' && screen !== 'profile' && screen !== 'settings') return
    startTransition(() => {
      setTeamSection(screen === 'settings' ? 'settings' : teamSection)
      setScreen('team')
    })
  }, [canUseTeamFeatures, interfaceMode, screen, teamLookupComplete, teamSection])

  useEffect(() => {
    if (!session?.impersonation?.teamId) return
    if (interfaceMode === 'team' && (screen === 'team' || screen === 'workspace')) return
    startTransition(() => {
      setInterfaceMode('team')
      setTeamSection(screen === 'settings'
        ? 'settings'
        : screen === 'workspace'
          ? 'applications'
          : teamSection)
      if (screen === 'workspace') {
        setSelectedId(null)
        setDraftState(null, { clean: true })
        setViewModeDirection('to-list')
        setViewMode('list')
      }
      setScreen('team')
      setMobileDetailOpen(false)
    })
  }, [interfaceMode, screen, session?.impersonation?.teamId, setDraftState, teamSection])

  function viewMemberApplications(ownerId: string) {
    runWithNavigationGuard(() => startTransition(() => {
      const memberApplications = teamApplications.filter((application) => application.ownerId === ownerId)
      setInterfaceMode('team')
      setTeamSection('applications')
      setQuery('')
      setStatusFilters([])
      setSort('deadline')
      setOwnerFilter(ownerId)
      setViewModeDirection('to-list')
      setViewMode('list')
      setSelectedId(memberApplications[0]?.id ?? teamApplications[0]?.id ?? null)
      setScreen('workspace')
      setMobileDetailOpen(true)
    }))
  }

  function openPersonalWorkspaceForTeamTransfer() {
    runWithNavigationGuard(() => startTransition(() => {
      const firstPersonalApplicationId = defaultSelectedIdForMode('personal')
      setInterfaceMode('personal')
      setQuery('')
      setStatusFilters([])
      setSort('deadline')
      setOwnerFilter(null)
      setSelectedId(firstPersonalApplicationId)
      setDraftState(null, { clean: true })
      setTab('dossier')
      setViewModeDirection('to-list')
      setViewMode('list')
      setScreen('workspace')
      setMobileDetailOpen(Boolean(firstPersonalApplicationId))
    }))
  }

  function defaultSelectedIdForMode(mode: InterfaceMode) {
    const list = mode === 'team' ? teamApplications : applications
    return list.find((application) => application.ownerId === session?.user.id)?.id ?? list[0]?.id ?? null
  }

  function resetWorkspaceStateForMode(mode: InterfaceMode) {
    setQuery('')
    setStatusFilters([])
    setSort('deadline')
    setOwnerFilter(null)
    setMobileDetailOpen(false)
    if (mode === 'team') {
      setSelectedId(defaultSelectedIdForMode(mode))
      setViewModeDirection('to-list')
      setViewMode('list')
      setTeamSection('overview')
    } else {
      setSelectedId(null)
      setDraftState(null, { clean: true })
      setViewModeDirection('to-kanban')
      setViewMode('kanban')
    }
  }

  function handoffVariantForMode(mode: InterfaceMode, nextScreen: Screen): LoadingVariant {
    if (mode === 'team') return nextScreen === 'workspace' ? 'workspace' : 'team'
    if (nextScreen === 'workspace') return 'workspace'
    if (nextScreen === 'profile') return 'profile'
    if (nextScreen === 'settings') return 'settings'
    return 'dashboard'
  }

  /**
   * Personal ⇄ team switch under a full-screen curtain. Heavy commits + network
   * finish before the curtain lifts so the destination never hitch-steps in.
   */
  async function switchWorkspaceMode(
    nextMode: InterfaceMode,
    options?: { screen?: Screen; teamSection?: TeamSection; teamId?: string },
  ) {
    if (!session) return
    if (session.impersonation?.teamId && nextMode === 'personal') return
    if (nextMode === 'team' && effectiveInterfaceMode !== 'team' && teamWorkspaces.length > 1 && !options?.teamId) {
      void preloadLanguage(lang, ['core', 'shared', 'team'])
      setPendingTeamWorkspaceEntry({ screen: options?.screen, teamSection: options?.teamSection })
      setTeamWorkspaceChooserOpen(true)
      return
    }
    if (nextMode === effectiveInterfaceMode && !options?.screen && !workspaceHandoff) {
      if (options?.teamSection) setTeamSection(options.teamSection)
      return
    }

    const seq = ++workspaceHandoffSeqRef.current
    const defaultPersonalScreen: Screen = (screen === 'team' || (screen === 'workspace' && isTeamMode))
      ? 'dashboard'
      : screen
    const nextScreen: Screen = options?.screen
      ?? (nextMode === 'team' ? 'team' : defaultPersonalScreen)
    const destinationViewMode = nextMode === 'team'
      ? (nextScreen === 'workspace' && teamViewerRole !== 'member' ? 'kanban' as const : 'list' as const)
      : (nextScreen === 'workspace' ? 'kanban' as const : viewMode)
    const variant = handoffVariantForMode(nextMode, nextScreen)
    const requestedTeamId = nextMode === 'team' ? options?.teamId ?? activeTeamIdRef.current : null
    const teamChanged = Boolean(requestedTeamId && requestedTeamId !== activeTeamIdRef.current)

    setWorkspaceHandoff({ target: nextMode, variant })

    // Commit destination chrome under the curtain first so paint settles on the real tree.
    setInterfaceMode(nextMode)
    resetWorkspaceStateForMode(nextMode)
    if (nextMode === 'team') {
      if (teamChanged && requestedTeamId) {
        activeTeamIdRef.current = requestedTeamId
        setActiveTeamId(requestedTeamId)
        setTeamSummary(null)
        setTeamApplications([])
      }
      setTeamSection(options?.teamSection ?? 'overview')
      setScreen(nextScreen === 'workspace' ? 'workspace' : 'team')
      if (nextScreen === 'workspace') {
        setViewModeDirection(destinationViewMode === 'kanban' ? 'to-kanban' : 'to-list')
        setViewMode(destinationViewMode)
        setMobileDetailOpen(false)
      }
    } else {
      setScreen(nextScreen)
    }

    try {
      const warm = warmCriticalScreenAssets(
        nextMode === 'team' && nextScreen !== 'workspace' ? 'team' : nextScreen,
        tab,
        lang,
        destinationViewMode,
      )

      // Team data can be cold or stale after long personal sessions — refresh when needed.
      if (nextMode === 'team') {
        const needsTeamRefresh = teamChanged
          || !teamLookupComplete
          || Boolean(activeTeamIdRef.current && !teamSummary)
          || (Boolean(activeTeamIdRef.current) && teamApplications.length === 0)
        if (needsTeamRefresh) {
          await refreshTeamWorkspace(session, requestedTeamId)
        }
      }

      await warm
      if (workspaceHandoffSeqRef.current !== seq) return
      await waitForUiSettle()
    } catch (error) {
      if (isAuthExpired(error)) {
        expireSession(session.token)
        return
      }
      if (workspaceHandoffSeqRef.current === seq) {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      if (workspaceHandoffSeqRef.current === seq) {
        setWorkspaceHandoff(null)
      }
    }
  }

  const selected = useMemo(
    () => selectedId ? workspaceApplications.find((a) => a.id === selectedId) ?? null : null,
    [workspaceApplications, selectedId],
  )
  const isDraftDirty = useMemo(
    () => {
      if (!draft || !selected || draft.id !== selected.id) return false
      return draftDirty
    },
    [draft, draftDirty, selected],
  )
  // Team-only metadata (viewer's role on this specific app, owner display name) for the currently
  // selected application — undefined in personal mode, where DossierView behaves exactly as before.
  const selectedTeamMeta = isTeamMode ? teamApplications.find((a) => a.id === selected?.id) : undefined
  const studentTeamTransferOptions = useMemo(
    () => teamWorkspaces.filter((workspace) => workspace.viewerRole === 'member'),
    [teamWorkspaces],
  )
  const selectedManagerTeamWorkspace = useMemo(
    () => (
      selected?.teamId && selected.ownerId !== session?.user.id
        ? teamWorkspaces.find((workspace) => (
            workspace.teamId === selected.teamId &&
            (workspace.viewerRole === 'owner' || workspace.viewerRole === 'admin')
          )) ?? null
        : null
    ),
    [selected?.ownerId, selected?.teamId, session?.user.id, teamWorkspaces],
  )
  const canDirectlyMoveSelectedTeamApplication = Boolean(
    isTeamMode &&
    selectedManagerTeamWorkspace,
  )
  const selectedTeamTransferOptions = canDirectlyMoveSelectedTeamApplication && selectedManagerTeamWorkspace
    ? [selectedManagerTeamWorkspace]
    : studentTeamTransferOptions
  useEffect(() => {
    if (!isTeamMode && tab === 'review') setTab('dossier')
  }, [isTeamMode, tab])
  const canToggleSelectedTeamVisibility = Boolean(
    selected &&
    (
      (selected.ownerId === session?.user.id && studentTeamTransferOptions.length > 0) ||
      canDirectlyMoveSelectedTeamApplication
    ),
  )

  const visibleApplications = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    const matchesQuery = (application: ApplicationRecord) => {
      const relation = teamApplicationRelations[application.id]
      return [
        application.school.name,
        application.program,
        application.professor.english,
        application.professor.chinese,
        application.professor.email,
        application.tags.join(' '),
        application.ownerId ? ownerDirectory[application.ownerId] ?? '' : '',
        relation?.studentName ?? '',
        relation?.advisorName ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    }
    const matchesStatus = (application: ApplicationRecord) =>
      statusFilters.length === 0 || statusFilters.includes(application.status)
    const matchesOwner = (application: ApplicationRecord) =>
      !effectiveOwnerFilter || application.ownerId === effectiveOwnerFilter
    const filtered = workspaceApplications
      .filter((application) => matchesStatus(application))
      .filter((application) => matchesOwner(application))
      .filter((application) => matchesQuery(application))

    if (!selected || filtered.some((application) => application.id === selected.id) || !matchesQuery(selected)) {
      return filtered
    }

    return [selected, ...filtered.filter(function(a) { return a.id !== selected.id })]
  }, [workspaceApplications, deferredQuery, selected, statusFilters, effectiveOwnerFilter, ownerDirectory, teamApplicationRelations])

  const teamBoardStudents = useMemo(() => {
    if (!isTeamMode || teamViewerRole === 'member') return []

    const allApplicationsByOwner = new Map<string, ApplicationRecord[]>()
    const visibleApplicationsByOwner = new Map<string, ApplicationRecord[]>()
    for (const application of teamApplications) {
      if (!application.ownerId) continue
      const current = allApplicationsByOwner.get(application.ownerId) ?? []
      current.push(application)
      allApplicationsByOwner.set(application.ownerId, current)
    }
    for (const application of visibleApplications) {
      if (!application.ownerId) continue
      const current = visibleApplicationsByOwner.get(application.ownerId) ?? []
      current.push(application)
      visibleApplicationsByOwner.set(application.ownerId, current)
    }

    const hasActiveNarrowing = Boolean(deferredQuery.trim() || statusFilters.length > 0)
    const knownStudentIds = new Set<string>()
    const rows = teamCreateStudentOptions.flatMap((student) => {
      knownStudentIds.add(student.id)
      if (effectiveOwnerFilter && student.id !== effectiveOwnerFilter) return []
      const studentVisibleApplications = visibleApplicationsByOwner.get(student.id) ?? []
      if (hasActiveNarrowing && !effectiveOwnerFilter && studentVisibleApplications.length === 0) return []
      return [{
        id: student.id,
        name: student.name,
        email: student.email,
        avatarUrl: student.avatarUrl ?? undefined,
        advisorName: student.advisorName,
        applications: studentVisibleApplications,
        allApplications: allApplicationsByOwner.get(student.id) ?? [],
        canCreateApplication: true,
      }]
    })

    for (const [ownerId, ownerApplications] of allApplicationsByOwner) {
      if (knownStudentIds.has(ownerId)) continue
      if (effectiveOwnerFilter && ownerId !== effectiveOwnerFilter) continue
      const studentVisibleApplications = visibleApplicationsByOwner.get(ownerId) ?? []
      if (hasActiveNarrowing && !effectiveOwnerFilter && studentVisibleApplications.length === 0) continue
      const firstApplication = ownerApplications[0]
      const relation = firstApplication ? teamApplicationRelations[firstApplication.id] : undefined
      rows.push({
        id: ownerId,
        name: relation?.studentName || ownerDirectory[ownerId] || ownerId,
        email: undefined,
        avatarUrl: ownerAvatarDirectory[ownerId],
        advisorName: relation?.advisorName,
        applications: studentVisibleApplications,
        allApplications: ownerApplications,
        canCreateApplication: false,
      })
    }

    return rows
  }, [
    deferredQuery,
    effectiveOwnerFilter,
    isTeamMode,
    ownerAvatarDirectory,
    ownerDirectory,
    statusFilters.length,
    teamApplicationRelations,
    teamApplications,
    teamCreateStudentOptions,
    teamViewerRole,
    visibleApplications,
  ])

  const realApplications = useMemo(
    () => applications.filter((application) => !isTourSampleApplication(application)),
    [applications],
  )

  const allShares = useMemo<SharedLinkInfo[]>(
    () => [
      ...realApplications.flatMap((application) =>
        (application.shares ?? [])
          .filter((share) => !share.expiresAt || new Date(share.expiresAt) >= new Date())
          .map((share) => ({
            kind: 'application' as const,
            applicationId: application.id,
            applicationName: formatApplicationIdentity(application, lang),
            share,
          })),
      ),
      ...profileAssets.flatMap((asset) =>
        (asset.shares ?? [])
          .filter((share) => !share.expiresAt || new Date(share.expiresAt) >= new Date())
          .map((share) => ({
            kind: 'asset-upload' as const,
            assetId: asset.id,
            assetName: asset.name,
            share,
          })),
      ),
    ],
    [lang, profileAssets, realApplications],
  )

  const selectedBackups = useMemo(
    () => backups.filter((backup) => !selected?.id || backup.applicationId === selected.id),
    [backups, selected?.id],
  )

  function applyWorkspaceSnapshot(data: OfflineSnapshotData) {
    setApplications(data.applications)
    setProfileAssets(data.profileAssets)
    setBackups(data.backups)
    setApplicationTrash(data.applicationTrash)
    setTeamWorkspaces(data.teamWorkspaces ?? [])
    setActiveTeamId(data.activeTeamId ?? data.teamSummary?.team.id ?? null)
    setTeamSummary(data.teamSummary)
    setTeamApplications(data.teamApplications)
    setTeamLookupComplete(true)
    setApplicationsLoaded(true)
    setSelectedId((current) => current ?? data.applications[0]?.id ?? null)
  }

  function currentSnapshotData(nextApplications = applications): OfflineSnapshotData {
    return {
      applications: nextApplications,
      profileAssets,
      backups,
      applicationTrash,
      teamWorkspaces,
      activeTeamId,
      teamSummary,
      teamApplications,
    }
  }

  function cancelScheduledOfflineSnapshotSave() {
    const scheduled = offlineSnapshotSaveRef.current
    if (!scheduled) return
    const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void }
    if (scheduled.idle) {
      idleWindow.cancelIdleCallback?.(scheduled.handle)
    } else {
      window.clearTimeout(scheduled.handle)
    }
    offlineSnapshotSaveRef.current = null
  }

  function scheduleOfflineSnapshotSave(nextSession: AuthSession, snapshotData: OfflineSnapshotData) {
    cancelScheduledOfflineSnapshotSave()
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    }
    const runSave = () => {
      offlineSnapshotSaveRef.current = null
      saveOfflineSnapshot(nextSession, snapshotData)
      setOfflineSnapshotSavedAt(new Date().toISOString())
    }
    if (idleWindow.requestIdleCallback) {
      offlineSnapshotSaveRef.current = {
        handle: idleWindow.requestIdleCallback(runSave, { timeout: 2500 }),
        idle: true,
      }
      return
    }
    offlineSnapshotSaveRef.current = {
      handle: window.setTimeout(runSave, 250),
      idle: false,
    }
  }

  const ensureTourSampleApplication = useCallback(() => {
    const sample = createTourSampleApplication(session?.user.id)
    try { localStorage.setItem(ONBOARDING_SAMPLE_ACTIVE_KEY, '1') } catch {}
    setApplications((items) => [sample, ...items.filter((item) => !isTourSampleApplication(item))])
    setDraftState(cloneApplication(sample), { clean: true })
    setSelectedId(sample.id)
  }, [session?.user.id, setDraftState])

  const cleanupTourSampleApplication = useCallback((markDone = true) => {
    const fallbackId = realApplications[0]?.id ?? null
    setApplications((items) => items.filter((item) => !isTourSampleApplication(item)))
    if (draftRef.current && isTourSampleApplicationId(draftRef.current.id)) {
      setDraftState(null, { clean: true })
    }
    setSelectedId((current) => isTourSampleApplicationId(current) ? fallbackId : current)
    setRecentOpenedIds((items) => items.filter((id) => !isTourSampleApplicationId(id)))
    try {
      localStorage.removeItem(ONBOARDING_SAMPLE_ACTIVE_KEY)
      const storedSelected = localStorage.getItem(SELECTED_ID_KEY)
      if (isTourSampleApplicationId(storedSelected)) localStorage.removeItem(SELECTED_ID_KEY)
      const storedRecent = safeParseJson<unknown>(localStorage.getItem(RECENT_OPENED_KEY))
      if (Array.isArray(storedRecent)) {
        safeSetJson(RECENT_OPENED_KEY, storedRecent.filter((id) => !isTourSampleApplicationId(typeof id === 'string' ? id : null)))
      }
      if (markDone) localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    } catch {
      // Storage cleanup is best effort; the sample itself never leaves local React state.
    }
    if (isTourSampleApplicationId(selectedId)) {
      setScreen('dashboard')
      setTab('dossier')
      setMobileDetailOpen(false)
    }
    if (window.location.pathname.includes(encodeURIComponent(TOUR_SAMPLE_APPLICATION_ID))) {
      window.history.replaceState(null, '', '/')
    }
  }, [realApplications, selectedId, setDraftState])

  const startOnboardingTour = useCallback(() => {
    setDialogOpen(false)
    setConfirmDialog(null)
    setPendingDiscard(false)
    setShareDialogOpen(false)
    setNotificationCenterOpen(false)
    setQuery('')
    setStatusFilters([])
    setSort('deadline')
    setInterfaceMode('personal')
    setViewModeDirection('to-list')
    setViewMode('list')
    setWorkspaceLayout(defaultWorkspaceLayout)
    setTab('dossier')
    setWorkspaceJumpIntent(null)
    setScreen('dashboard')
    setMobileDetailOpen(false)
    ensureTourSampleApplication()
    // Start the cold work, but publish the open state in the click task so the
    // lightweight overlay cue paints immediately.
    void Promise.all([
      preloadLanguage(languageRef.current, ['core', 'shared', 'tour', 'dashboard', 'workspace', 'dossier', 'profile', 'settings']),
      loadOnboardingTour(),
      loadProfileScreen(),
      loadSettingsScreen(),
    ]).catch(() => undefined)
    setShowOnboarding(true)
  }, [ensureTourSampleApplication])

  const browserNotificationsEnabled = session?.user.settings.browserNotificationsEnabled !== false
  const webPushNotifications = useWebPushNotifications(session?.token, browserNotificationsEnabled, (notification) => {
    const sourceToken = currentSessionTokenRef.current
    if (!sourceToken || !isCurrentSessionToken(sourceToken)) return
    const token = getLatestSessionToken(sourceToken)
    void phdApi.unreadNotificationCount(token)
      .then((result) => setUnreadNotificationCount(result.count))
      .catch(() => {})
    if (notificationCenterOpen) {
      void phdApi.listNotifications(token)
        .then(setNotifications)
        .catch(() => {})
    }
    if (notification.title) notify(notification.title, 'info')
  })

  useEffect(() => {
    const handleUpdateReady = () => setPwaUpdateReady(true)
    window.addEventListener('phd-atlas:pwa-update-ready', handleUpdateReady)
    return () => window.removeEventListener('phd-atlas:pwa-update-ready', handleUpdateReady)
  }, [])

  useEffect(() => {
    const handleBackgroundSync = () => {
      if (!session || !applicationsLoaded || connectivity.manualOffline) return
      void probeServerConnectivity({ force: true }).then((result) => {
        if (result.serverReachable && pendingOfflineQueueSize(session.user.id) > 0) {
          void syncOfflineQueue(session, { force: true })
        }
      })
    }
    window.addEventListener(PWA_OFFLINE_SYNC_EVENT, handleBackgroundSync)
    return () => window.removeEventListener(PWA_OFFLINE_SYNC_EVENT, handleBackgroundSync)
    // The service worker event is the durable trigger; the closure only needs
    // the currently mounted account and explicit manual-offline preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationsLoaded, connectivity.manualOffline, session?.token, session?.user.id])

  useEffect(() => {
    refreshOfflineQueueCounts(session?.user.id)
  }, [refreshOfflineQueueCounts, session?.user.id])

  const clearSessionState = useCallback(() => {
    cancelledRef.current = true
    currentSessionTokenRef.current = null
    currentSessionUserIdRef.current = null
    sessionIdentityEpochRef.current += 1
    resetSessionTokenLineage()
    clearClientSessionCaches()
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SCREEN_KEY)
    localStorage.removeItem(SELECTED_ID_KEY)
    localStorage.removeItem(RECENT_OPENED_KEY)
    localStorage.removeItem(TAB_KEY)
    localStorage.removeItem(TEAM_SECTION_KEY)
    localStorage.removeItem(ACTIVE_TEAM_ID_KEY)
    localStorage.removeItem(SESSION_RETURN_STACK_KEY)
    localStorage.removeItem(ONBOARDING_SAMPLE_ACTIVE_KEY)
    setSession(null)
    setApplications([])
    setProfileAssets([])
    setTeamSummary(null)
    setTeamApplications([])
    setInterfaceMode('personal')
    setOwnerFilter(null)
    setBackups([])
    setApplicationTrash([])
    setApplicationsLoaded(false)
    setShellPaintReady(false)
    setWorkspaceHandoff(null)
    workspaceHandoffSeqRef.current += 1
    setTeamLookupComplete(false)
    setOfflineDataActive(false)
    setOfflineSnapshotSavedAt(null)
    setOfflineQueueCount(0)
    setBlockedOfflineCount(0)
    setSyncingOffline(false)
    setPasskeys([])
    setSelectedId(null)
    setMobileDetailOpen(false)
    setRecentOpenedIds([])
    setDraftState(null, { clean: true })
    setScreen('dashboard')
    setTab('dossier')
    setTeamSection('overview')
  }, [resetSessionTokenLineage, setDraftState])

  const expireSession = useCallback((requestToken?: string) => {
    // Ignore late 401s from a previous login (or another account). Only the live
    // session's own token chain may surface "session expired" and clear state.
    if (!isActiveSessionRequestToken(requestToken)) return
    if (sessionExpiredRef.current) return
    sessionExpiredRef.current = true
    clearSessionState()
    notify(t(languageRef.current, 'toast.sessionExpired'), 'error')
  }, [clearSessionState, isActiveSessionRequestToken, notify])

  useEffect(() => {
    if (!session || screen !== 'settings') return
    let cancelled = false
    void phdApi.listPasskeys(getLatestSessionToken(session.token))
      .then((items) => {
        if (!cancelled) setPasskeys(items)
      })
      .catch((error) => {
        // Auth expiry is handled once by the global unauthorized handler.
        // Do not surface a second "session expired" toast from this catch —
        // especially when a late 401 resolves after the user already re-logged in.
        if (!cancelled && !isAuthExpired(error)) {
          notify(normalizeError(error, languageRef.current), 'error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [notify, screen, session?.user.id])

  // Update draft when selection changes
  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id)
      if (draftRef.current?.id !== selected.id) {
        scheduleDetailDraftHydration(selected)
      }
    } else {
      clearDetailDraftHydration()
      setDraftState(null, { clean: true })
    }
  }, [clearDetailDraftHydration, scheduleDetailDraftHydration, selected, setDraftState])


  // Initial data load — cold-start only. Must not re-run after logout/re-login or
  // it would re-insert the expired token into lineage and toast "session expired"
  // against the fresh session.
  useEffect(() => {
    const initialSession = initialSessionRef.current
    if (!initialSession || sessionBootStartedRef.current) return
    sessionBootStartedRef.current = true
    const requestEpoch = sessionIdentityEpochRef.current
    // Seed identity refs + lineage before any await. A missing lineage entry would
    // make isMountedSessionIdentity fail after a successful fetch and leave the
    // boot curtain spinning forever.
    sessionExpiredRef.current = false
    cancelledRef.current = false
    currentSessionUserIdRef.current = initialSession.user.id
    currentSessionTokenRef.current = initialSession.token
    rememberSessionToken(initialSession.token)
    safeSetJson(SESSION_KEY, initialSession)
    void (async () => {
      try {
        const criticalAssets = warmCriticalScreenAssets(
          initialScreenRef.current,
          initialTabRef.current,
          initialLanguageRef.current,
          initialViewModeRef.current,
        )
        const data = await fetchWorkspaceData(initialSession)
        await criticalAssets
        // Identity moved away (logout / re-login) — abandon without touching UI.
        if (
          sessionIdentityEpochRef.current !== requestEpoch
          || currentSessionUserIdRef.current !== initialSession.user.id
        ) {
          return
        }
        // Re-seed only while this boot's token is still the live session tip (or
        // chains to it). Never re-introduce an expired token after a fresh login.
        const liveToken = currentSessionTokenRef.current
        if (
          liveToken
          && (
            liveToken === initialSession.token
            || getLatestSessionToken(initialSession.token) === liveToken
          )
        ) {
          rememberSessionToken(initialSession.token)
        }
        const applied = await applyWorkspaceData(initialSession, data, requestEpoch)
        if (!applied) {
          // Never leave the signed-in shell stuck on the loading curtain.
          if (
            sessionIdentityEpochRef.current === requestEpoch
            && currentSessionUserIdRef.current === initialSession.user.id
          ) {
            sessionExpiredRef.current = true
            clearSessionState()
            notify(t(languageRef.current, 'toast.sessionExpired'), 'error')
          }
          return
        }
        try { localStorage.removeItem(ONBOARDING_SAMPLE_ACTIVE_KEY) } catch {}
        var onboardingDone = false
        try { onboardingDone = localStorage.getItem(ONBOARDING_DONE_KEY) === '1' } catch {}
        const initialRoute = parseRoute(window.location.pathname)
        const shouldShowPersonalOnboarding = !initialSession.impersonation?.teamId
          && initialRoute?.interfaceMode !== 'team'
          && initialRoute?.screen !== 'team'
        if (shouldShowPersonalOnboarding && !onboardingDone && data.nextApps.length === 0) setShowOnboarding(true)
      } catch (error) {
        if (isAuthExpired(error)) {
          expireSession(initialSession.token)
        } else if (isNetworkLikeError(error)) {
          const snapshot = loadOfflineSnapshot(initialSession)
          if (
            snapshot
            && sessionIdentityEpochRef.current === requestEpoch
            && currentSessionUserIdRef.current === initialSession.user.id
          ) {
            applyWorkspaceSnapshot(snapshot.data)
            setOfflineDataActive(true)
            setOfflineSnapshotSavedAt(snapshot.savedAt)
            refreshOfflineQueueCounts(initialSession.user.id)
            notify(t(languageRef.current, 'toast.offlineSnapshotLoaded'), 'info')
          } else if (
            sessionIdentityEpochRef.current === requestEpoch
            && currentSessionUserIdRef.current === initialSession.user.id
          ) {
            clearSessionState()
            notify(normalizeError(error, languageRef.current), 'error')
          }
        } else if (
          sessionIdentityEpochRef.current === requestEpoch
          && currentSessionUserIdRef.current === initialSession.user.id
        ) {
          // Nothing was ever loaded for this session (applicationsLoaded is still false), so
          // leaving `session` set would strand the user on the loading skeleton indefinitely —
          // AuthScreen only renders once session is null again. Fall back to the sign-in screen.
          clearSessionState()
          notify(normalizeError(error, languageRef.current), 'error')
        }
      }
    })()
  }, [expireSession, rememberSessionToken, clearSessionState, notify, refreshOfflineQueueCounts])

  // Cross-tab identity isolation: another tab signing into a different account must
  // not leave this tab writing under the old identity (or reading the new one as if
  // it were still the old one).
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== SESSION_KEY) return
      if (event.newValue == null) {
        if (currentSessionUserIdRef.current) {
          clearSessionState()
        }
        return
      }
      const remote = safeParseJson<AuthSession>(event.newValue)
      if (!remote?.user?.id || !remote.token) return
      if (remote.user.id === currentSessionUserIdRef.current) {
        // Same account: adopt a fresher token from the other tab without swapping user.
        if (remote.token !== currentSessionTokenRef.current) {
          rememberSessionToken(remote.token)
          currentSessionTokenRef.current = remote.token
          setSession((current) => {
            if (!current || current.user.id !== remote.user.id) return current
            const next = { ...current, token: remote.token }
            return next
          })
        }
        return
      }
      // Different account in another tab — hard-reset this tab onto that identity.
      clearClientSessionCaches()
      persistSession(remote)
      window.location.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearSessionState, rememberSessionToken])

  // Keep the boot curtain up until the first authenticated shell has actually painted.
  // That way the heavy first commit finishes under the overlay and lifting feels hitch-free.
  useEffect(() => {
    if (!applicationsLoaded) {
      setShellPaintReady(false)
      return undefined
    }
    let cancelled = false
    void waitForUiSettle().then(() => {
      if (!cancelled) setShellPaintReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [applicationsLoaded])

  useEffect(() => {
    if (!showOnboarding || !session || !applicationsLoaded) return
    ensureTourSampleApplication()
  }, [applicationsLoaded, ensureTourSampleApplication, session, showOnboarding])

  useEffect(() => {
    if (
      !session
      || !applicationsLoaded
      || connectivity.manualOffline
      || connectivity.serverReachable !== true
    ) return
    if (pendingOfflineQueueSize(session.user.id) === 0) return
    void syncOfflineQueue(session)
    // syncOfflineQueue is intentionally not a dependency; this effect should be
    // driven by durable state transitions, not by function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationsLoaded, connectivity.serverReachable, offlineQueueCount, session?.token, session?.user.id])

  // Cleanup non-toast timers owned directly by App.
  useEffect(() => {
    return () => {
      cancelScheduledOfflineSnapshotSave()
    }
  }, [])

  const realtimeUpdates = useRealtimeUpdates({
    token: session?.token ?? null,
    enabled: Boolean(
      session
      && applicationsLoaded
      && !connectivityUnavailable(connectivity)
      && !connectivity.manualOffline
    ),
    onInvalidate: (scopes) => {
      const active = session
      const sourceToken = currentSessionTokenRef.current
      if (!active || !sourceToken || !isCurrentSessionToken(sourceToken)) return
      const token = getLatestSessionToken(sourceToken)

      if (scopes.has('applications')) {
        void phdApi.listApplications(token)
          .then((items) => {
            if (isCurrentSessionToken(sourceToken)) setApplications(items)
          })
          .catch(() => {})
      }
      if (scopes.has('profile-assets')) {
        void phdApi.listProfileAssets(token)
          .then((items) => {
            if (isCurrentSessionToken(sourceToken)) setProfileAssets(items)
          })
          .catch(() => {})
      }
      if (scopes.has('backups')) {
        void phdApi.listBackups(token)
          .then((items) => {
            if (isCurrentSessionToken(sourceToken)) setBackups(items)
          })
          .catch(() => {})
      }
      if (scopes.has('teams')) {
        void refreshTeamWorkspace({ ...active, token }).catch(() => {})
      } else if (scopes.has('session')) {
        void refreshSessionMetadata({ ...active, token }).catch(() => {})
      }
      if (scopes.has('ai-keys')) {
        void phdApi.listAiKeys(token)
          .then((items) => {
            if (isCurrentSessionToken(sourceToken)) setAiKeys(items)
          })
          .catch(() => {})
      }
      if (scopes.has('discover')) {
        setDiscoverRealtimeRevision((revision) => revision + 1)
      }
      if (scopes.has('notifications')) {
        void phdApi.unreadNotificationCount(token)
          .then((result) => {
            if (isCurrentSessionToken(sourceToken)) setUnreadNotificationCount(result.count)
          })
          .catch(() => {})
        if (notificationCenterOpen) {
          void refreshNotificationList()
        }
      }
    },
  })

  // The stream is the primary badge refresh path. Keep a slow visible-tab poll
  // only as a compatibility fallback for proxies that block streaming responses.
  useEffect(() => {
    if (!session || !applicationsLoaded) return undefined
    let cancelled = false
    const poll = () => {
      if (connectivityUnavailable(connectivity) || document.visibilityState === 'hidden') return
      const sourceToken = currentSessionTokenRef.current
      if (!sourceToken || !isCurrentSessionToken(sourceToken)) return
      void phdApi.unreadNotificationCount(getLatestSessionToken(sourceToken))
        .then((result) => { if (!cancelled) setUnreadNotificationCount(result.count) })
        .catch(() => {})
    }
    const fallbackStart = window.setTimeout(() => {
      if (!realtimeUpdates.connected) poll()
    }, 3_000)
    const interval = window.setInterval(() => {
      if (!realtimeUpdates.connected) poll()
    }, 5 * 60_000)
    const pollWhenVisible = () => {
      if (!realtimeUpdates.connected && document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', pollWhenVisible)
    window.addEventListener('online', pollWhenVisible)
    return () => {
      cancelled = true
      window.clearTimeout(fallbackStart)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', pollWhenVisible)
      window.removeEventListener('online', pollWhenVisible)
    }
  }, [applicationsLoaded, connectivity, isCurrentSessionToken, realtimeUpdates.connected, session])

  // Keyboard shortcuts stay global but avoid hijacking rich text editing keys.
  useEffect(function() {
    function isEditingText(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (!target) return false
      const tag = target.tagName?.toLowerCase()
      return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
    }

    function handleKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      const editingText = isEditingText(event)

      if (mod && key === 'k' && !event.altKey) {
        event.preventDefault()
        void loadCommandPalette().catch(() => undefined)
        setCommandPaletteOpen(true)
        return
      }

      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !editingText) {
        event.preventDefault()
        void loadKeyboardShortcuts().catch(() => undefined)
        setShortcutsOpen(true)
        return
      }

      if (!mod && !event.altKey && !editingText) {
        const now = performance.now()
        const pendingGo = pendingGoShortcutRef.current
        const navigateWithShortcut = (action: () => void) => {
          event.preventDefault()
          pendingGoShortcutRef.current = null
          runWithNavigationGuard(() => startTransition(action))
        }

        if (pendingGo != null && now - pendingGo <= 900) {
          pendingGoShortcutRef.current = null
          if (key === 'd') {
            navigateWithShortcut(() => {
              if (isTeamMode) {
                setTeamSection('overview')
                setScreen('team')
              } else {
                setScreen('dashboard')
              }
            })
            return
          }
          if (key === 'a') {
            navigateWithShortcut(() => {
              if (isTeamMode) {
                setTeamSection('applications')
                setViewModeDirection('to-list')
                setViewMode('list')
                setMobileDetailOpen(false)
                setScreen('workspace')
              } else {
                openWorkspaceBoard()
              }
            })
            return
          }
          if (key === 'p') {
            if (activeSession.impersonation?.teamId) return
            navigateWithShortcut(() => {
              if (isTeamMode) {
                void switchWorkspaceMode('personal', { screen: 'profile' })
              } else {
                setScreen('profile')
              }
            })
            return
          }
          if (key === 's') {
            navigateWithShortcut(() => setScreen('settings'))
            return
          }
          if (key === 't' && !PUBLIC_EDITION) {
            navigateWithShortcut(() => {
              void switchWorkspaceMode('team', { screen: 'team', teamSection: 'overview' })
            })
            return
          }
        }

        if (key === 'g') {
          event.preventDefault()
          pendingGoShortcutRef.current = now
          return
        }
      }

      if (!mod) {
        const accessibleShortcutTabs = isTeamMode ? shortcutTabs : shortcutTabs.slice(0, -1)
        const tabIndex = Number(event.key) - 1
        if (
          tabIndex >= 0
          && tabIndex < accessibleShortcutTabs.length
          && !editingText
          && screen === 'workspace'
          && viewMode === 'list'
          && Boolean(selectedId)
        ) {
          event.preventDefault()
          const nextTab = accessibleShortcutTabs[tabIndex]
          const direction = accessibleShortcutTabs.indexOf(nextTab) >= accessibleShortcutTabs.indexOf(tab) ? 'forward' : 'backward'
          runAnimatedDossierUpdate(() => setTab(nextTab), { scope: 'dossier-tab', direction })
        }
        return
      }

      if (key === 's') {
        event.preventDefault()
        const latestDraft = draftRef.current
        if (latestDraft && selectedId && isDraftDirty) {
          void saveApplication(latestDraft, i18nValue.tx('toast.appSaved'))
        }
        return
      }

      if (editingText) return

      if (key === 'f') {
        event.preventDefault()
        if (screen !== 'workspace') {
          startTransition(() => setScreen('workspace'))
          window.setTimeout(() => {
            const input = document.querySelector('.search-field input') as HTMLInputElement | null
            input?.focus()
          }, 100)
        } else {
          const input = document.querySelector('.search-field input') as HTMLInputElement | null
          input?.focus()
        }
        return
      }

      if (key === 'n' && !isTeamMode) {
        event.preventDefault()
        openNewApplicationDialog(null)
        return
      }

      if (key === 'b' && screen === 'workspace') {
        event.preventDefault()
        runAnimatedScreenUpdate(() => {
          setWorkspaceLayout((current) => ({ ...current, applicationsHidden: !current.applicationsHidden }))
        })
        return
      }

      if (key === 'i' && screen === 'workspace') {
        event.preventDefault()
        runAnimatedScreenUpdate(() => {
          setWorkspaceLayout((current) => ({ ...current, inspectorHidden: !current.inspectorHidden }))
        })
      }
    }

    window.addEventListener('keydown', handleKey)
    return function() { window.removeEventListener('keydown', handleKey) }
  }, [canUseTeamFeatures, i18nValue, isDraftDirty, isTeamMode, runAnimatedDossierUpdate, runAnimatedScreenUpdate, screen, selectedId, tab, viewMode])

  useEffect(() => {
    if (!session || !applicationsLoaded) return undefined
    if (isJsdomRuntime()) return undefined

    let cancelled = false
    type WarmupTask = () => Promise<unknown>
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const scheduleWarmup = (tasks: WarmupTask[], initialDelay: number, idleTimeout: number) => {
      let index = 0
      let timer: number | null = null
      let idleHandle: number | null = null

      const scheduleNext = () => {
        if (cancelled || index >= tasks.length) return
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(runNext, { timeout: idleTimeout })
        } else {
          timer = window.setTimeout(() => runNext(), 120)
        }
      }

      const runNext = (deadline?: IdleDeadline) => {
        idleHandle = null
        timer = null
        if (cancelled || index >= tasks.length) return
        if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 6) {
          scheduleNext()
          return
        }

        const task = tasks[index]
        index += 1
        void task().catch(() => undefined).finally(() => {
          if (!cancelled && index < tasks.length) {
            timer = window.setTimeout(scheduleNext, 90)
          }
        })
      }

      timer = window.setTimeout(scheduleNext, initialDelay)
      return () => {
        if (timer !== null) window.clearTimeout(timer)
        if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
      }
    }

    // The rail can move from the dashboard straight into this group of surfaces.
    // Starting these imports one-by-one through rIC left a cold first click
    // waiting behind several 800ms idle deadlines on a busy dashboard. This
    // effect runs after React has committed the initial surface, so start the
    // independent rail targets in the next task rather than adding another
    // visible delay. Their preload handles dedupe later pointer/focus requests.
    const railCriticalTimer = window.setTimeout(() => {
      if (cancelled) return
      void Promise.all([
        loadApplicationPane(),
        loadKanbanBoard(),
        loadInspector(),
        loadDiscoverScreen(),
        loadProfileScreen(),
        loadSettingsScreen(),
      ]).catch(() => undefined)
    }, 0)

    // Dossier detail and the remaining language packs are lower-priority. Keep
    // them in the cooperative queue so the initial workspace warmup cannot make
    // the dashboard's first interactive paint feel heavy on modest devices.
    const navigationTasks: WarmupTask[] = [
      loadDossierView,
      () => preloadLanguage(lang, ['core', 'shared', 'dashboard', 'workspace', 'discover', 'profile', 'settings', 'team']),
    ]
    // Click-open overlays are interaction-critical even though they are not part
    // of first paint. Warm them cooperatively soon after the shell settles; the
    // former 3.2s delay left early clicks waiting on cold chunks.
    const overlayTasks: WarmupTask[] = [
      loadNewApplicationDialog,
      loadShareDialog,
      loadNotificationCenter,
      loadKeyboardShortcuts,
      loadOnboardingTour,
      loadCommandPalette,
      () => preloadLanguage(lang, ['dossier', 'share', 'tour']),
    ]
    if (!PUBLIC_EDITION) {
      overlayTasks.push(loadTeamScreen, () => preloadLanguage(lang, ['team', 'workspace']))
    }

    const cancelNavigation = scheduleWarmup(navigationTasks, 160, 800)
    const cancelOverlays = scheduleWarmup(overlayTasks, 700, 1_800)

    return () => {
      cancelled = true
      window.clearTimeout(railCriticalTimer)
      cancelNavigation()
      cancelOverlays()
    }
  }, [applicationsLoaded, canUseTeamFeatures, lang, session?.user.id])

  useEffect(() => {
    if (!session || screen !== 'workspace' || !applicationsLoaded) return
    if (workspaceApplications.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      if (draftRef.current !== null) setDraftState(null, { clean: true })
      return
    }
    if (viewMode === 'kanban' && canUseWorkspaceBoard) {
      if (selectedId !== null) setSelectedId(null)
      if (draftRef.current !== null) setDraftState(null, { clean: true })
      return
    }
    if (viewMode === 'kanban') {
      setViewModeDirection('to-list')
      setViewMode('list')
      return
    }
    if (!selectedId || !workspaceApplications.some((application) => application.id === selectedId)) {
      const myApps = workspaceApplications.filter(function (a) { return a.ownerId === session.user.id })
      setSelectedId(myApps[0]?.id ?? workspaceApplications[0]?.id ?? null)
    }
  }, [applicationsLoaded, canUseWorkspaceBoard, screen, selectedId, session, setDraftState, viewMode, workspaceApplications])

  useEffect(() => {
    if (!workspaceOpeningFromDashboard) return undefined

    const timer = window.setTimeout(() => setWorkspaceOpeningFromDashboard(false), 320)
    return () => window.clearTimeout(timer)
  }, [workspaceOpeningFromDashboard])

  useEffect(() => () => {
    if (workspaceViewExitTimerRef.current !== null) {
      window.clearTimeout(workspaceViewExitTimerRef.current)
    }
    clearDetailDraftHydration()
  }, [clearDetailDraftHydration])

  // Persist navigation state across refreshes without storing private payloads.
  useEffect(() => {
    if (!session) return
    try {
      safeSetItem(SCREEN_KEY, screen)
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }, [screen, session])

  useEffect(() => {
    if (!session) return
    if (isTeamMode) return
    try {
      if (selectedId) {
        safeSetItem(SELECTED_ID_KEY, selectedId)
      } else {
        localStorage.removeItem(SELECTED_ID_KEY)
      }
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }, [isTeamMode, selectedId, session])

  useEffect(() => {
    if (!session) return
    const existingIds = new Set(applications.map((application) => application.id))
    setRecentOpenedIds((current) => {
      const filtered = current.filter((id) => existingIds.has(id)).slice(0, RECENT_OPENED_LIMIT)
      return filtered.length === current.length && filtered.every((id, index) => id === current[index])
        ? current
        : filtered
    })
  }, [applications, session])

  useEffect(() => {
    if (!session || screen !== 'workspace' || !selectedId) return
    if (!applications.some((application) => application.id === selectedId)) return

    setRecentOpenedIds((current) => {
      const next = [selectedId, ...current.filter((id) => id !== selectedId)].slice(0, RECENT_OPENED_LIMIT)
      return next.every((id, index) => id === current[index]) && next.length === current.length ? current : next
    })
  }, [applications, screen, selectedId, session])

  useEffect(() => {
    if (!session) return
    try {
      if (recentOpenedIds.length > 0) {
        safeSetJson(RECENT_OPENED_KEY, recentOpenedIds)
      } else {
        localStorage.removeItem(RECENT_OPENED_KEY)
      }
    } catch {
      // Recent-opened tracking is a best-effort browser preference.
    }
  }, [recentOpenedIds, session])

  useEffect(() => {
    if (!session) return
    try {
      safeSetItem(TAB_KEY, tab)
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }, [tab, session])

  useEffect(() => {
    if (!session) return
    try {
      safeSetItem(TEAM_SECTION_KEY, teamSection)
    } catch {
      // Team section is a convenience preference; URLs remain authoritative.
    }
  }, [teamSection, session])

  // Sync state → URL: push a new history entry whenever screen / selectedId / tab change
  // while the user is signed in, and handle browser back/forward via popstate. A ref
  // guards against the local update that a popstate itself triggers from pushing again.
  useEffect(() => {
    if (!session) return
    const nextPath = pathForRoute(screen, selectedId, tab, teamSection, interfaceMode)
    const currentPath = window.location.pathname
    if (!routeSyncedRef.current) {
      // First sync after mount: just replace the initial URL so we don't add a
      // double entry for the already-loaded route.
      if (currentPath !== nextPath) window.history.replaceState(null, '', nextPath)
      routeSyncedRef.current = true
    } else if (currentPath !== nextPath) {
      window.history.pushState(null, '', nextPath)
    }
  }, [screen, selectedId, tab, teamSection, interfaceMode, session])

  useEffect(() => {
    function handlePopState() {
      const parsed = parseRoute(window.location.pathname)
      if (!parsed) {
        setRouteNotFound(true)
        return
      }
      setRouteNotFound(false)
      startTransition(() => {
        if (parsed.interfaceMode) setInterfaceMode(parsed.interfaceMode)
        setTeamSection(parsed.teamSection)
        setScreen(parsed.screen)
        if (parsed.screen === 'workspace' && parsed.selectedId) {
          setViewModeDirection('to-list')
          setViewMode('list')
          setSelectedId(parsed.selectedId)
          setMobileDetailOpen(true)
        } else if (parsed.screen === 'workspace') {
          const teamWorkspace = parsed.interfaceMode === 'team'
          setViewModeDirection(teamWorkspace ? 'to-list' : 'to-kanban')
          setViewMode(teamWorkspace ? 'list' : 'kanban')
          setSelectedId(null)
          setDraftState(null, { clean: true })
          setMobileDetailOpen(false)
        } else {
          setMobileDetailOpen(false)
        }
        setTab(parsed.tab)
      })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    try {
      safeSetItem(INTERFACE_MODE_KEY, interfaceMode)
    } catch {
      // Interface-mode preference is best-effort.
    }
  }, [interfaceMode])

  useEffect(() => {
    if (isTeamMode) return
    try {
      safeSetItem(VIEW_MODE_KEY, viewMode)
    } catch {
      // View-mode preference is best-effort.
    }
  }, [isTeamMode, viewMode])

  useEffect(() => {
    try {
      safeSetJson(WORKSPACE_LAYOUT_KEY, workspaceLayout)
    } catch {
      // Workspace layout preferences are best-effort.
    }
  }, [workspaceLayout])

  useEffect(function() {
    function handlePopstate(_e: PopStateEvent) {
      if (navigationGuardRef.current) {
        if (!navigationGuardRef.current(function() {})) {
          window.history.pushState(null, '', window.location.href)
        }
      }
    }
    window.addEventListener('popstate', handlePopstate)
    return function() { window.removeEventListener('popstate', handlePopstate) }
  }, [])

  useEffect(() => {
    const accent = normalizeThemeAccent(session?.user.settings.themeAccent ?? localStorage.getItem('phd-atlas-accent'))
    applyThemePreset(accent)
    try {
      safeSetItem('phd-atlas-accent', accent)
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }, [session?.user.settings.themeAccent])

  function persistSession(nextSession: AuthSession) {
    sessionExpiredRef.current = false
    cancelledRef.current = false
    // Always bump identity epoch on login/register/impersonation handoff — including
    // same-account re-login after expiry. Otherwise in-flight workspace commits from
    // the previous session (same userId) can still pass isMountedSessionIdentity and
    // either rewrite the new session or race refreshAll into a false "expired" teardown.
    sessionIdentityEpochRef.current += 1
    // Always scrub token-refresh maps + conditional GET bodies on login/register/
    // impersonation handoff so: (1) user B never inherits user A's /api/auth/me
    // cache (串号), and (2) a late 401 from the previous JWT chain cannot resolve
    // through getLatestSessionToken into the new session tip and re-toast expiry.
    clearClientSessionCaches()
    currentSessionUserIdRef.current = nextSession.user.id
    currentSessionTokenRef.current = nextSession.token
    resetSessionTokenLineage(nextSession.token)
    // Keep the cancelled flag off so a fresh login after a failed boot can load.
    cancelledRef.current = false
    // Authentication is a semantic boundary: expiry/error notices from the
    // previous token lineage must never follow the newly signed-in identity.
    clearToasts()
    setSession(nextSession)
    safeSetJson(SESSION_KEY, nextSession)
  }

  function isMountedSessionIdentity(requestUserId: string, requestToken: string, requestEpoch: number) {
    if (requestEpoch !== sessionIdentityEpochRef.current) return false
    if (currentSessionUserIdRef.current !== requestUserId) return false
    // Accept either the original request token or any known refresh of it. After a
    // sliding refresh the React state token may already be the successor, so only
    // checking lineage membership of the original request token is too strict and
    // can leave the boot curtain spinning forever.
    // Do NOT accept "any token while same userId is mounted" — that lets a late
    // response from a previous same-account session pass after re-login.
    if (isCurrentSessionToken(requestToken)) return true
    const latest = getLatestSessionToken(requestToken)
    if (latest !== requestToken && isCurrentSessionToken(latest)) return true
    return false
  }

  function commitSessionMetadata(
    requestSession: AuthSession,
    me: {
      user: AuthSession['user']
      settings: AuthSession['settings']
      mailFetchStatus: AuthSession['mailFetchStatus']
      // /api/auth/me omits usage until the quota aggregate is available.
      // Treat that as a valid metadata refresh instead of rejecting the session.
      usage?: AuthSession['usage']
    },
    requestToken: string,
    requestEpoch = sessionIdentityEpochRef.current,
  ): AuthSession | null {
    // A late /api/auth/me for the previous account must never rewrite the
    // currently mounted identity (demo → teacher 串号).
    const requestUserId = requestSession.user.id
    if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return null
    if (!me?.user?.id || me.user.id !== requestUserId) return null

    const refreshedToken = getLatestSessionToken(requestToken)
    // Prefer the refreshed token only when it still belongs to the same account.
    // Non-JWT / unreadable subjects are allowed (tests and legacy tokens).
    const tokenForSession = sessionIdentityMatches(requestUserId, me.user.id, refreshedToken)
      ? refreshedToken
      : sessionIdentityMatches(requestUserId, me.user.id, requestToken)
        ? requestToken
        : null
    if (!tokenForSession) return null
    if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return null

    rememberSessionToken(tokenForSession)
    currentSessionTokenRef.current = tokenForSession
    const nextSession: AuthSession = {
      ...requestSession,
      token: tokenForSession,
      user: me.user,
      settings: me.settings,
      mailFetchStatus: me.mailFetchStatus,
      usage: me.usage,
      // Preserve temporary-view metadata from the request session; /api/auth/me
      // never carries impersonation claims and must not wipe them.
      impersonation: requestSession.impersonation,
    }

    setSession((current) => {
      if (
        !current
        || current.user.id !== requestUserId
        || sessionIdentityEpochRef.current !== requestEpoch
      ) {
        return current
      }
      const committed = {
        ...current,
        token: tokenForSession,
        user: me.user,
        settings: me.settings,
        mailFetchStatus: me.mailFetchStatus,
        usage: me.usage,
        impersonation: current.impersonation ?? requestSession.impersonation,
      }
      safeSetJson(SESSION_KEY, committed)
      return committed
    })

    return nextSession
  }

  // Registered once for the component's lifetime (not keyed on `session`): isCurrentSessionToken
  // already gates every call against the live token lineage, so re-running this per session change
  // bought nothing except a window — right after a fresh login/register sets a new session — where
  // the handlers were briefly unregistered (cleanup-then-reregister happens on the next commit, but
  // refreshAll's requests can land before that commit) and a genuine 401 would silently no-op instead
  // of reaching expireSession, leaving the user stuck on the post-login loading skeleton forever.
  useEffect(() => {
    setSessionTokenHandler((token, sourceToken) => {
      if (sourceToken && !isCurrentSessionToken(sourceToken)) return false
      const tokenSubject = readSessionTokenSubject(token)
      // Refuse to attach another account's rotated JWT onto the mounted session.
      if (
        tokenSubject
        && currentSessionUserIdRef.current
        && tokenSubject !== currentSessionUserIdRef.current
      ) {
        return false
      }
      rememberSessionToken(token)
      currentSessionTokenRef.current = token
      setSession((current) => {
        if (!current || current.token === token) return current
        if (tokenSubject && current.user.id !== tokenSubject) return current
        const nextSession = { ...current, token }
        safeSetJson(SESSION_KEY, nextSession)
        return nextSession
      })
      return true
    })
    setUnauthorizedHandler((_error, sourceToken) => expireSession(sourceToken))

    return () => {
      setSessionTokenHandler(null)
      setUnauthorizedHandler(null)
    }
  }, [expireSession, isCurrentSessionToken, rememberSessionToken])

  async function run(action: () => Promise<void>, success?: string) {
    try {
      setBusy(true)
      await action()
      if (success) notify(success)
    } catch (error) {
      if (isAuthExpired(error)) {
        return
      }
      if (isNetworkLikeError(error)) {
        notify(i18nValue.tx('toast.offlineActionNeedsOnline'), 'error')
      } else {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function runInteractive<T>(action: () => Promise<T>, success?: string): Promise<T> {
    try {
      setBusy(true)
      const result = await action()
      if (success) notify(success)
      return result
    } catch (error) {
      if (!isAuthExpired(error)) {
        if (isNetworkLikeError(error)) {
          notify(i18nValue.tx('toast.offlineActionNeedsOnline'), 'error')
        } else {
          notify(normalizeError(error, languageRef.current), 'error')
        }
      }
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function fetchWorkspaceData(activeSession: AuthSession) {
    const requestToken = activeSession.token
    const lockedTeamId = activeSession.impersonation?.teamId ?? null
    const preferredTeamId = lockedTeamId ?? activeTeamIdRef.current
    try {
      const bootstrap = await phdApi.workspaceBootstrap(requestToken, preferredTeamId)
      if (!bootstrap || !Array.isArray(bootstrap.applications) || !Array.isArray(bootstrap.teamWorkspaces)) {
        throw new Error('Workspace bootstrap payload is unavailable.')
      }
      activeTeamIdRef.current = bootstrap.activeTeamId
      return {
        me: bootstrap.me,
        nextApps: bootstrap.applications,
        assets: bootstrap.profileAssets,
        nextBackups: bootstrap.backups,
        trash: bootstrap.applicationTrash,
        teamWorkspaces: bootstrap.teamWorkspaces,
        activeTeamId: bootstrap.activeTeamId,
        team: bootstrap.teamSummary,
        teamApps: bootstrap.teamApplications,
        aiKeys: Array.isArray(bootstrap.aiKeys) ? bootstrap.aiKeys : [],
      }
    } catch (error) {
      if (isAuthExpired(error)) throw error
      // Rolling deployments can briefly serve a new frontend from the service
      // worker while the previous API process is still shutting down. Preserve
      // the established granular bootstrap as a compatibility fallback.
      const [me, nextApps, assets, nextBackups, trash, workspaces, nextAiKeys] = await Promise.all([
        phdApi.me(requestToken),
        lockedTeamId ? Promise.resolve([]) : phdApi.listApplications(requestToken),
        lockedTeamId ? Promise.resolve([]) : phdApi.listProfileAssets(requestToken),
        lockedTeamId ? Promise.resolve([]) : phdApi.listBackups(requestToken),
        lockedTeamId ? Promise.resolve([]) : phdApi.listApplicationTrash(requestToken),
        phdApi.myTeamWorkspaces(requestToken),
        phdApi.listAiKeys(requestToken).catch((aiError) => {
          if (isAuthExpired(aiError)) throw aiError
          return []
        }),
      ])
      const availableTeamIds = new Set(workspaces.map((workspace) => workspace.teamId))
      const requestedTeamId = lockedTeamId && availableTeamIds.has(lockedTeamId)
        ? lockedTeamId
        : activeTeamIdRef.current && availableTeamIds.has(activeTeamIdRef.current)
          ? activeTeamIdRef.current
          : workspaces[0]?.teamId ?? null
      let team: TeamSummary | null = null
      let teamApps: TeamApplicationRecord[] = []
      if (requestedTeamId) {
        ;[team, teamApps] = await Promise.all([
          phdApi.myTeam(requestToken, requestedTeamId),
          phdApi.listTeamApplications(requestToken, requestedTeamId),
        ])
      }
      activeTeamIdRef.current = requestedTeamId
      return {
        me,
        nextApps,
        assets,
        nextBackups,
        trash,
        teamWorkspaces: workspaces,
        activeTeamId: requestedTeamId,
        team,
        teamApps,
        aiKeys: Array.isArray(nextAiKeys) ? nextAiKeys : [],
      }
    }
  }

  async function applyWorkspaceData(
    activeSession: AuthSession,
    data: Awaited<ReturnType<typeof fetchWorkspaceData>>,
    requestEpoch = sessionIdentityEpochRef.current,
  ): Promise<boolean> {
    const requestToken = activeSession.token
    let nextSession = commitSessionMetadata(activeSession, data.me, requestToken, requestEpoch)
    if (!nextSession) {
      // Soft recovery for same-account boot: me/settings commit can fail on a
      // transient token-lineage race, but the workspace payload is still valid.
      if (
        sessionIdentityEpochRef.current !== requestEpoch
        || currentSessionUserIdRef.current !== activeSession.user.id
        || data.me?.user?.id !== activeSession.user.id
      ) {
        return false
      }
      const fallbackToken = getLatestSessionToken(requestToken)
      rememberSessionToken(fallbackToken)
      currentSessionTokenRef.current = fallbackToken
      nextSession = {
        ...activeSession,
        token: fallbackToken,
        user: data.me.user,
        settings: data.me.settings,
        mailFetchStatus: data.me.mailFetchStatus,
        usage: data.me.usage,
        impersonation: activeSession.impersonation,
      }
      setSession(nextSession)
      safeSetJson(SESSION_KEY, nextSession)
    }
    const snapshotData: OfflineSnapshotData = {
      applications: data.nextApps,
      profileAssets: data.assets,
      backups: data.nextBackups,
      applicationTrash: data.trash,
      teamWorkspaces: data.teamWorkspaces,
      activeTeamId: data.activeTeamId,
      teamSummary: data.team,
      teamApplications: data.teamApps,
    }
    startTransition(() => {
      setAiKeys(data.aiKeys)
      applyWorkspaceSnapshot(snapshotData)
      setOfflineDataActive(false)
      refreshOfflineQueueCounts(nextSession.user.id)
    })
    scheduleOfflineSnapshotSave(nextSession, snapshotData)
    return true
  }

  async function performRefreshAll(activeSession: AuthSession, requestEpoch: number) {
    const criticalAssets = warmCriticalScreenAssets(screen, tab, lang, viewMode)
    const data = await fetchWorkspaceData(activeSession)
    await criticalAssets
    if (requestEpoch !== sessionIdentityEpochRef.current) return
    if (currentSessionUserIdRef.current !== activeSession.user.id) return
    await applyWorkspaceData(activeSession, data, requestEpoch)
  }

  async function refreshAll(activeSession = session) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    rememberSessionToken(requestToken)
    if (
      sessionIdentityEpochRef.current !== requestEpoch
      || currentSessionUserIdRef.current !== activeSession.user.id
    ) {
      return
    }
    const requestKey = `${activeSession.user.id}:${requestToken}:${activeTeamIdRef.current ?? ''}:${requestEpoch}`
    const current = refreshAllInFlightRef.current
    if (current?.key === requestKey) return current.promise
    const promise = performRefreshAll(activeSession, requestEpoch)
    refreshAllInFlightRef.current = { key: requestKey, promise }
    try {
      await promise
    } finally {
      if (refreshAllInFlightRef.current?.promise === promise) {
        refreshAllInFlightRef.current = null
      }
    }
  }

  async function refreshSessionMetadata(activeSession = session) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return
    const me = await phdApi.me(requestToken)
    commitSessionMetadata(activeSession, me, requestToken, requestEpoch)
  }

  async function refreshTrashAndSessionMetadata(activeSession = session) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    const [, trash] = await Promise.all([
      refreshSessionMetadata(activeSession),
      phdApi.listApplicationTrash(requestToken),
    ])
    if (!isCurrentSessionToken(requestToken)) return
    setApplicationTrash(trash)
  }

  async function refreshApplicationsAndBackups(activeSession = session) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    if (!isCurrentSessionToken(requestToken)) return
    const [nextApplications, nextBackups] = await Promise.all([
      phdApi.listApplications(requestToken),
      phdApi.listBackups(requestToken),
    ])
    if (!isCurrentSessionToken(requestToken)) return
    setApplications(nextApplications)
    setBackups(nextBackups)
    scheduleOfflineSnapshotSave(activeSession, {
      applications: nextApplications,
      profileAssets,
      backups: nextBackups,
      applicationTrash,
      teamWorkspaces,
      activeTeamId,
      teamSummary,
      teamApplications,
    })
  }

  async function refreshApplicationsAndSessionMetadata(activeSession = session) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    if (!isCurrentSessionToken(requestToken)) return
    const [, nextApplications] = await Promise.all([
      refreshSessionMetadata(activeSession),
      phdApi.listApplications(requestToken),
    ])
    if (!isCurrentSessionToken(requestToken)) return
    setApplications(nextApplications)
    scheduleOfflineSnapshotSave(activeSession, {
      applications: nextApplications,
      profileAssets,
      backups,
      applicationTrash,
      teamWorkspaces,
      activeTeamId,
      teamSummary,
      teamApplications,
    })
  }

  async function refreshTeamWorkspace(
    activeSession = session,
    preferredTeamId = activeTeamIdRef.current,
  ) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return

    const [me, workspaces] = await Promise.all([
      phdApi.me(requestToken),
      phdApi.myTeamWorkspaces(requestToken),
    ])
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return

    const lockedTeamId = activeSession.impersonation?.teamId ?? null
    const availableTeamIds = new Set(workspaces.map((workspace) => workspace.teamId))
    const requestedTeamId = lockedTeamId && availableTeamIds.has(lockedTeamId)
      ? lockedTeamId
      : preferredTeamId && availableTeamIds.has(preferredTeamId)
        ? preferredTeamId
        : workspaces[0]?.teamId ?? null
    let team: TeamSummary | null = null
    let nextTeamApplications: TeamApplicationRecord[] = []
    if (requestedTeamId) {
      ;[team, nextTeamApplications] = await Promise.all([
        phdApi.myTeam(requestToken, requestedTeamId),
        phdApi.listTeamApplications(requestToken, requestedTeamId),
      ])
    }
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return

    const nextSession = commitSessionMetadata(activeSession, me, requestToken, requestEpoch)
    if (!nextSession) return
    activeTeamIdRef.current = requestedTeamId
    startTransition(() => {
      setTeamWorkspaces(workspaces)
      setActiveTeamId(requestedTeamId)
      setTeamSummary(team)
      setTeamApplications(nextTeamApplications)
      setTeamLookupComplete(true)
    })
  }

  function switchActiveTeam(teamId: string) {
    if (!session || !teamId || teamId === activeTeamIdRef.current) return
    if (session.impersonation?.teamId && teamId !== session.impersonation.teamId) return
    runWithNavigationGuard(() => {
      const seq = ++workspaceHandoffSeqRef.current
      setWorkspaceHandoff({ target: 'team', variant: 'team' })
      activeTeamIdRef.current = teamId
      refreshAllInFlightRef.current = null
      startTransition(() => {
        setActiveTeamId(teamId)
        setTeamSummary(null)
        setTeamApplications([])
        setOwnerFilter(null)
        setNewApplicationOwnerHint(null)
        setSelectedId(null)
        setDraftState(null, { clean: true })
        setTeamSection('overview')
        setScreen('team')
      })
      void (async () => {
        try {
          await refreshTeamWorkspace(session, teamId)
          if (workspaceHandoffSeqRef.current !== seq) return
          await warmCriticalScreenAssets('team', tab, lang, 'list')
          if (workspaceHandoffSeqRef.current !== seq) return
          await waitForUiSettle()
        } catch (error) {
          if (isAuthExpired(error)) {
            expireSession(session.token)
            return
          }
          if (workspaceHandoffSeqRef.current === seq) {
            notify(normalizeError(error, languageRef.current), 'error')
          }
        } finally {
          if (workspaceHandoffSeqRef.current === seq) {
            setWorkspaceHandoff(null)
          }
        }
      })()
    })
  }

  async function syncOfflineQueue(activeSession = session, options: { force?: boolean } = {}) {
    if (
      !activeSession
      || cancelledRef.current
      || (!options.force && connectivityUnavailable(connectivity))
      || syncingOffline
    ) return

    const pendingQueue = readOfflineQueue(activeSession.user.id)
      .filter((item) => item.status !== 'blocked')
    if (pendingQueue.length === 0) return

    setSyncingOffline(true)
    let synced = 0
    let blocked = 0
    const syncedIds: string[] = []

    try {
      let requestToken = getLatestSessionToken(activeSession.token)
      let serverApplications = await phdApi.listApplications(requestToken)
      requestToken = getLatestSessionToken(requestToken)

      for (const operation of pendingQueue) {
        if (!isCurrentSessionToken(requestToken)) return
        const current = serverApplications.find((application) => application.id === operation.applicationId)
        const block = (reason: string) => {
          blocked += 1
          markOfflineQueueItemBlocked(activeSession.user.id, operation.id, reason)
        }

        if (!current) {
          block('missing')
          continue
        }
        if (current.ownerId && current.ownerId !== activeSession.user.id) {
          block('permission')
          continue
        }
        if (!operation.baseUpdatedAt || !current.updatedAt) {
          block('unverifiable')
          continue
        }
        const mergeResult = mergeOfflineApplicationUpdate(operation, current)
        if (!mergeResult) {
          block('conflict')
          continue
        }

        const saved = await phdApi.replayOfflineApplicationUpdate(
          requestToken,
          mergeResult.application,
          current.updatedAt,
        )
        requestToken = getLatestSessionToken(requestToken)
        serverApplications = serverApplications.map((application) =>
          application.id === saved.id ? saved : application,
        )
        syncedIds.push(operation.id)
        synced += 1
      }

      removeOfflineQueueItems(activeSession.user.id, syncedIds)
      refreshOfflineQueueCounts(activeSession.user.id)

      if (synced > 0) {
        notify(tpl(i18nValue.tx('toast.offlineSyncComplete'), { count: synced }), 'success')
        await refreshAll({ ...activeSession, token: requestToken })
      }
      if (blocked > 0) {
        notify(tpl(i18nValue.tx('toast.offlineSyncBlocked'), { count: blocked }), 'error')
      }
    } catch (error) {
      if (isAuthExpired(error)) return
      if (!isNetworkLikeError(error)) {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      setSyncingOffline(false)
      refreshOfflineQueueCounts(activeSession.user.id)
    }
  }

  async function retryOfflineConnection() {
    if (connectivity.manualOffline) return
    const result = await probeServerConnectivity({ force: true })
    if (!result.serverReachable || !activeSession) {
      notify(i18nValue.tx('toast.connectionStillUnavailable'), 'info')
      return
    }

    notify(i18nValue.tx('toast.connectionRestored'), 'success')
    if (pendingOfflineQueueSize(activeSession.user.id) > 0) {
      await syncOfflineQueue(activeSession, { force: true })
      return
    }
    if (offlineDataActive) {
      try {
        await refreshAll(activeSession)
      } catch (error) {
        if (!isNetworkLikeError(error) && !isAuthExpired(error)) {
          notify(normalizeError(error, languageRef.current), 'error')
        }
      }
    }
  }

  function toggleManualOffline() {
    const next = !connectivity.manualOffline
    setManualOfflineMode(next)
    if (next) {
      notify(i18nValue.tx('toast.manualOfflineEnabled'), 'info')
      return
    }
    notify(i18nValue.tx('toast.manualOfflineDisabled'), 'info')
    void probeServerConnectivity({ force: true }).then((result) => {
      if (result.serverReachable && activeSession) {
        void syncOfflineQueue(activeSession, { force: true })
      }
    })
  }

  function reviewBlockedOfflineChange() {
    if (!activeSession) return
    const blocked = readOfflineQueue(activeSession.user.id).find((item) => item.status === 'blocked')
    if (!blocked) return
    const serverApplication = applications.find((application) => application.id === blocked.applicationId)
    setScreen('workspace')
    setViewModeDirection('to-list')
    setViewMode('list')
    setSelectedId(blocked.applicationId)
    setMobileDetailOpen(true)
    if (serverApplication) {
      // Keep the fresh server record as the save baseline, then surface the
      // preserved local copy as an explicitly dirty draft. Nothing is uploaded
      // until the user reviews it and presses Save.
      setDraftState(cloneApplication(serverApplication), { clean: true })
      setDraftState(cloneApplication(blocked.application), { dirty: true })
    }
    notify(i18nValue.tx(`offlineStatus.blockedReason.${blocked.blockedReason ?? 'conflict'}`), 'info')
    notify(i18nValue.tx('offlineStatus.reviewLoaded'), 'warning')
  }

  function requestPwaUpdateInstall() {
    const install = () => {
      if (activatePwaUpdate()) setPwaUpdateReady(false)
    }
    if (!isDraftDirty) {
      install()
      return
    }
    setConfirmDialog({
      title: i18nValue.tx('offlineStatus.updateConfirmTitle'),
      message: i18nValue.tx('offlineStatus.updateConfirmMessage'),
      confirmLabel: i18nValue.tx('offlineStatus.installUpdate'),
      onConfirm: () => {
        setConfirmDialog(null)
        install()
      },
    })
  }

  function replaceApplication(saved: ApplicationRecord, expectedDraftMutationVersion?: number) {
    setApplications((items) => items.map((item) => (item.id === saved.id ? saved : item)))
    // A teammate's application edited via the team workspace lives in teamApplications, not
    // applications — patch it there too so the change reflects without a full refetch. The
    // spread preserves the extra ownerName/ownerEmail/currentUserApplicationRole fields that
    // only this list carries (the saved ApplicationRecord from the API doesn't include them).
    setTeamApplications((items) => items.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)))
    const draftStillMatchesRequest = expectedDraftMutationVersion === undefined
      || draftMutationVersionRef.current === expectedDraftMutationVersion
    if (draftRef.current?.id === saved.id && draftStillMatchesRequest) {
      setDraftState(cloneApplication(saved), { clean: true })
    }
  }

  function updateApplicationInState(
    applicationId: string,
    updater: (application: ApplicationRecord) => ApplicationRecord,
  ) {
    const versionBefore = draftBaselineVersionRef.current
    setApplications((items) =>
      items.map((item) => (item.id === applicationId ? updater(item) : item)),
    )
    // Mirror into teamApplications too, preserving its extra ownerName/ownerEmail/
    // currentUserApplicationRole fields that the plain ApplicationRecord updater doesn't know about.
    setTeamApplications((items) =>
      items.map((item) => (item.id === applicationId ? { ...item, ...updater(item) } : item)),
    )
    if (draftRef.current?.id === applicationId && draftBaselineVersionRef.current === versionBefore) {
      setDraftState(cloneApplication(updater(draftRef.current)), { clean: true })
    }
  }

  function commitSchoolLogoApplication(saved: ApplicationRecord) {
    setApplications((items) => items.map((item) => (item.id === saved.id ? saved : item)))
    setTeamApplications((items) => items.map((item) => (
      item.id === saved.id ? { ...item, ...saved } : item
    )))

    const currentDraft = draftRef.current
    if (!currentDraft || currentDraft.id !== saved.id) return
    const currentBaseline = safeParseJson<ApplicationRecord>(draftBaselineRef.current)
      ?? applications.find((application) => application.id === saved.id)
      ?? saved
    const mergeLogoState = (application: ApplicationRecord): ApplicationRecord => {
      const { logo: _logo, logoAutoDetect: _logoAutoDetect, ...schoolIdentity } = application.school
      return {
        ...application,
        updatedAt: saved.updatedAt,
        school: {
          ...schoolIdentity,
          ...(saved.school.logo ? { logo: saved.school.logo } : {}),
          logoAutoDetect: saved.school.logoAutoDetect,
        },
      }
    }
    const nextBaseline = mergeLogoState(currentBaseline)
    const nextDraft = mergeLogoState(currentDraft)
    const remainsDirty = JSON.stringify(nextDraft) !== JSON.stringify(nextBaseline)
    setDraftState(cloneApplication(nextBaseline), { clean: true })
    setDraftState(cloneApplication(nextDraft), { dirty: remainsDirty })
  }

  function schoolLogoErrorMessage(error: unknown) {
    if (error instanceof SchoolLogoError) {
      if (error.reason === 'file-type') return i18nValue.tx('dossier.schoolLogoInvalidType')
      if (error.reason === 'file-size') return i18nValue.tx('dossier.schoolLogoTooLarge')
      return i18nValue.tx('dossier.schoolLogoInvalidImage')
    }
    return normalizeError(error, languageRef.current)
  }

  async function persistSchoolLogo(
    application: ApplicationRecord,
    logo: ApplicationRecord['school']['logo'] | null,
    autoDetect: boolean,
    options: { silent?: boolean; removed?: boolean } = {},
  ) {
    const saved = await phdApi.updateSchoolLogo(activeSession.token, application.id, {
      logo,
      autoDetect,
    })
    if (!isCurrentSessionToken(activeSession.token)) return false
    commitSchoolLogoApplication(saved)
    if (!options.silent) {
      notify(i18nValue.tx(
        options.removed ? 'dossier.schoolLogoRemoved' : 'dossier.schoolLogoSaved',
      ), 'success')
    }
    return true
  }

  function resolveAndStoreSchoolLogo(
    application: ApplicationRecord,
    input: { website?: string; imageUrl?: string },
    options: { silent?: boolean } = {},
  ) {
    const requestValue = input.imageUrl?.trim() || input.website?.trim() || ''
    const requestKey = `${application.id}::${input.imageUrl ? 'link' : 'website'}::${requestValue}`
    const inFlight = schoolLogoInFlightRef.current.get(requestKey)
    if (inFlight) return inFlight

    const promise = (async () => {
      try {
        const resolved = await phdApi.resolveSchoolLogo(activeSession.token, application.id, input)
        if (!resolved.found || !resolved.dataUrl || !resolved.sourceUrl) {
          if (!options.silent) notify(i18nValue.tx('dossier.schoolLogoNotFound'), 'warning')
          return false
        }
        const dataUrl = await normalizeRemoteSchoolLogoDataUrl(resolved.dataUrl)
        return await persistSchoolLogo(
          application,
          {
            dataUrl,
            source: input.imageUrl ? 'link' : 'website',
            sourceUrl: resolved.sourceUrl,
            updatedAt: new Date().toISOString(),
          },
          !input.imageUrl,
          options,
        )
      } catch (error) {
        if (!isAuthExpired(error) && !options.silent) {
          notify(schoolLogoErrorMessage(error), 'error')
        }
        return false
      }
    })().finally(() => {
      if (schoolLogoInFlightRef.current.get(requestKey) === promise) {
        schoolLogoInFlightRef.current.delete(requestKey)
      }
    })
    schoolLogoInFlightRef.current.set(requestKey, promise)
    return promise
  }

  async function uploadAndStoreSchoolLogo(application: ApplicationRecord, file: File) {
    try {
      const dataUrl = await normalizeSchoolLogoFile(file)
      return await persistSchoolLogo(application, {
        dataUrl,
        source: 'upload',
        updatedAt: new Date().toISOString(),
      }, false)
    } catch (error) {
      if (!isAuthExpired(error)) notify(schoolLogoErrorMessage(error), 'error')
      return false
    }
  }

  async function removeStoredSchoolLogo(application: ApplicationRecord) {
    try {
      return await persistSchoolLogo(application, null, false, { removed: true })
    } catch (error) {
      if (!isAuthExpired(error)) notify(schoolLogoErrorMessage(error), 'error')
      return false
    }
  }

  function removeApplicationFromState(applicationId: string) {
    const nextApplications = applications.filter((item) => item.id !== applicationId)
    setApplications(nextApplications)
    setTeamApplications((items) => items.filter((item) => item.id !== applicationId))
    if (draftRef.current?.id === applicationId) {
      setDraftState(null, { clean: true })
    }
    if (selectedId === applicationId && !isTeamMode) {
      setViewModeDirection('to-kanban')
      setViewMode('kanban')
      setMobileDetailOpen(false)
    }
    setSelectedId((current) => current === applicationId ? null : current)
  }

  function removeApplicationsFromState(applicationIds: string[]) {
    const targets = new Set(applicationIds)
    const nextApplications = applications.filter((item) => !targets.has(item.id))
    setApplications(nextApplications)
    setTeamApplications((items) => items.filter((item) => !targets.has(item.id)))
    if (draftRef.current && targets.has(draftRef.current.id)) {
      setDraftState(null, { clean: true })
    }
    if (selectedId && targets.has(selectedId) && !isTeamMode) {
      setViewModeDirection('to-kanban')
      setViewMode('kanban')
      setMobileDetailOpen(false)
    }
    setSelectedId((current) => current && targets.has(current) ? null : current)
  }

  function isStillEstablishedLogin(establishedToken: string | null | undefined) {
    if (!establishedToken) return false
    return currentSessionTokenRef.current === establishedToken
      || isCurrentSessionToken(establishedToken)
  }

  async function handleLogin(email: string, password: string) {
    setBusy(true)
    let sessionEstablished = false
    let establishedToken: string | null = null
    try {
      const nextSession = await phdApi.login(email, password)
      persistSession(nextSession)
      sessionEstablished = true
      establishedToken = nextSession.token
      await refreshAll(nextSession)
      if (!isStillEstablishedLogin(establishedToken)) return
      notify(t(languageRef.current, 'toast.signedIn'))
    } catch (error) {
      if (sessionEstablished) {
        // persistSession already made `session` truthy, but the data load that follows failed —
        // without this, the user is stuck on the post-login loading skeleton forever (AuthScreen
        // only renders when `session` is null, and nothing else ever retries applicationsLoaded).
        //
        // Same-account re-login: a late TOKEN_EXPIRED from the previous session must NOT
        // tear down the fresh login. Only clear when this login's token is still live.
        if (!isStillEstablishedLogin(establishedToken)) return
        const alreadyExpired = sessionExpiredRef.current
        clearSessionState()
        if (!alreadyExpired) notify(normalizeError(error, languageRef.current), 'error')
      } else {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handlePasskeyLogin(email: string) {
    if (!passkeyAvailable) {
      notify(i18nValue.tx('passkeyUnavailable'), 'error')
      return
    }
    setBusy(true)
    let sessionEstablished = false
    let establishedToken: string | null = null
    try {
      const { options } = await phdApi.beginPasskeyLogin(email.trim())
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const assertion = await startAuthentication({
        optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      })
      const nextSession = await phdApi.finishPasskeyLogin(assertion)
      persistSession(nextSession)
      sessionEstablished = true
      establishedToken = nextSession.token
      await refreshAll(nextSession)
      if (!isStillEstablishedLogin(establishedToken)) return
      notify(t(languageRef.current, 'toast.signedIn'))
    } catch (error) {
      const cancelled = isPasskeyAbort(error)
      if (sessionEstablished) {
        if (!isStillEstablishedLogin(establishedToken)) return
        const alreadyExpired = sessionExpiredRef.current
        clearSessionState()
        if (!alreadyExpired) notify(cancelled ? i18nValue.tx('passkeyCancelled') : normalizeError(error, languageRef.current), 'error')
      } else {
        notify(cancelled ? i18nValue.tx('passkeyCancelled') : normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleRegister(
    name: string,
    email: string,
    password: string,
    captchaToken: string,
    captchaAnswer: string,
    emailCodeTokenOrLanguage: string,
    emailCode = '',
    language?: string,
  ) {
    const resolvedLanguage = language ?? emailCodeTokenOrLanguage
    const resolvedEmailCodeToken = language ? emailCodeTokenOrLanguage : ''
    setBusy(true)
    let sessionEstablished = false
    let establishedToken: string | null = null
    try {
      const nextSession = await phdApi.register(name, email, password, captchaToken, captchaAnswer, resolvedEmailCodeToken, emailCode, resolvedLanguage)
      persistSession(nextSession)
      sessionEstablished = true
      establishedToken = nextSession.token
      await refreshAll(nextSession)
      if (!isStillEstablishedLogin(establishedToken)) return
      notify(t(languageRef.current, 'toast.accountCreated'))
    } catch (error) {
      if (sessionEstablished) {
        // See handleLogin: without this the user is stuck on the post-signup loading skeleton
        // forever if the data load right after registration fails.
        if (!isStillEstablishedLogin(establishedToken)) return
        const alreadyExpired = sessionExpiredRef.current
        clearSessionState()
        if (!alreadyExpired) notify(normalizeError(error, languageRef.current), 'error')
      } else {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleForgotPassword(email: string) {
    setBusy(true)
    try {
      const result = await phdApi.requestPasswordReset(email)
      notify(i18nValue.tx('toast.resetLinkSent'), 'info')
      return result.resetUrl
    } catch (error) {
      notify(normalizeError(error, languageRef.current), 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    sessionExpiredRef.current = false
    cleanupTourSampleApplication(false)
    clearSessionState()
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false)
    cleanupTourSampleApplication(true)
  }

  function handleReplayTutorial() {
    try { localStorage.removeItem(ONBOARDING_DONE_KEY) } catch {}
    startOnboardingTour()
  }

  if (!session) {
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <AuthScreen
            busy={busy}
            onLogin={handleLogin}
            onPasskeyLogin={handlePasskeyLogin}
            passkeyAvailable={passkeyAvailable}
            onRegister={handleRegister}
            onForgotPassword={handleForgotPassword}
            onCaptcha={phdApi.captcha}
            onSendEmailCode={phdApi.sendRegisterEmailCode}
            languages={languageOptions()}
            onLanguageChange={changeAuthLanguage}
          />
          <OfflineStatusCenter
            connectivity={connectivity}
            language={lang}
            snapshotActive={false}
            snapshotSavedAt={null}
            pendingCount={0}
            blockedCount={0}
            syncing={false}
            updateReady={false}
            onRetry={() => { void probeServerConnectivity({ force: true }) }}
            onReviewBlocked={() => undefined}
            onInstallUpdate={() => undefined}
            onToggleOffline={() => undefined}
            tx={i18nValue.tx}
            authSurface
            allowManualOffline={false}
          />
          <ToastStack toasts={toasts} onClose={dismissToast} onPause={pauseToast} onResume={resumeToast} />
        </I18nContext.Provider>
      </ThemeContext.Provider>
    )
  }

  const activeSession = session
  const accountPlan = getAccountPlan(activeSession)
  const isAdminUser = accountPlan === 'admin'
  const isProUser = accountPlan !== 'free'
  const applicationLimit = activeSession.usage?.applicationQuota
    ?? (isAdminUser ? Number.MAX_SAFE_INTEGER : isProUser ? 300 : 3)
  const applicationCreateLimit = activeSession.usage?.applicationCreateQuota
    ?? (isProUser ? Number.MAX_SAFE_INTEGER : 3)
  const applicationLimitUsageCount = isProUser
    ? realApplications.length
    : activeSession.usage?.applicationCreatedCount ?? realApplications.length

  function clearWorkspaceForSessionSwitch() {
    setApplications([])
    setProfileAssets([])
    setAiKeys([])
    setTeamSummary(null)
    setTeamWorkspaces([])
    setActiveTeamId(null)
    activeTeamIdRef.current = null
    setTeamApplications([])
    setBackups([])
    setApplicationTrash([])
    setApplicationsLoaded(false)
    setShellPaintReady(false)
    setWorkspaceHandoff(null)
    workspaceHandoffSeqRef.current += 1
    setTeamLookupComplete(false)
    setOfflineDataActive(false)
    setOfflineSnapshotSavedAt(null)
    setOfflineQueueCount(0)
    setBlockedOfflineCount(0)
    setSyncingOffline(false)
    setPasskeys([])
    setSelectedId(null)
    setOwnerFilter(null)
    setRecentOpenedIds([])
    setMobileDetailOpen(false)
    setDraftState(null, { clean: true })
  }

  function enterTemporaryUserView(userId: string) {
    if (!activeSession || userId === activeSession.user.id) return
    runWithNavigationGuard(() => {
      void run(async () => {
        const actorSession = activeSession
        const requestedTeamId = activeTeamIdRef.current
        const nextSession = await phdApi.impersonateUser(actorSession.token, userId, 'app', requestedTeamId)
        // Hard identity checks: never mount a foreign temporary session that does
        // not match the requested member (prevents silent demo → teacher 串号).
        if (
          nextSession.user.id !== userId
          || nextSession.impersonation?.targetUserId !== userId
          || nextSession.impersonation?.actorId !== actorSession.user.id
        ) {
          throw new ApiError(
            'Session identity mismatch. Please sign in again.',
            'SESSION_IDENTITY_MISMATCH',
            409,
          )
        }
        if (!isCurrentSessionToken(actorSession.token)) return
        const lockedTeamId = nextSession.impersonation?.teamId ?? requestedTeamId
        const returnPoint: SessionReturnStackItem = {
          session: { ...actorSession, token: getLatestSessionToken(actorSession.token) },
          screen,
          selectedId,
          tab,
          interfaceMode,
          createdAt: new Date().toISOString(),
        }
        pushSessionReturnStack(returnPoint)
        clearWorkspaceForSessionSwitch()
        if (lockedTeamId) {
          activeTeamIdRef.current = lockedTeamId
          setActiveTeamId(lockedTeamId)
        }
        setInterfaceMode(lockedTeamId ? 'team' : 'personal')
        setScreen(lockedTeamId ? 'team' : 'dashboard')
        setTeamSection('overview')
        setTab('dossier')
        setViewModeDirection('to-list')
        setViewMode('list')
        persistSession(nextSession)
        await refreshAll(nextSession)
        notify(tpl(i18nValue.tx('toast.impersonationStarted'), {
          name: nextSession.impersonation?.targetName ?? nextSession.user.name,
        }), 'info')
      })
    })
  }

  function leaveTemporaryUserView() {
    if (!activeSession.impersonation) return
    runWithNavigationGuard(() => {
      void run(async () => {
        const returnPoint = popSessionReturnStack()
        if (!returnPoint) {
          if (activeSession.impersonation?.returnTo === 'admin') {
            clearSessionState()
            window.location.href = '/admin'
            return
          }
          logout()
          return
        }
        // Only restore the stacked actor identity — never a third account.
        if (
          returnPoint.session.user.id
          && activeSession.impersonation?.actorId
          && returnPoint.session.user.id !== activeSession.impersonation.actorId
        ) {
          logout()
          return
        }
        clearWorkspaceForSessionSwitch()
        setScreen(returnPoint.screen)
        setSelectedId(returnPoint.selectedId)
        setTab(returnPoint.tab)
        setInterfaceMode(returnPoint.interfaceMode)
        persistSession(returnPoint.session)
        await refreshAll(returnPoint.session)
        notify(tpl(i18nValue.tx('toast.impersonationEnded'), {
          name: returnPoint.session.user.name,
        }), 'info')
      })
    })
  }

  function touchesBackupSettings(patch: Partial<UserSettings>) {
    return 'autoBackup' in patch || 'backupFrequency' in patch || 'maxBackupsPerApp' in patch
  }

  function commitSettingsUser(
    requestSession: AuthSession,
    user: AuthSession['user'],
    patch: Partial<UserSettings>,
    requestEpoch = sessionIdentityEpochRef.current,
  ): AuthSession | null {
    const requestToken = requestSession.token
    const requestUserId = requestSession.user.id

    // A settings request may finish after leaving an impersonated user view (or
    // after entering one). Never let that old response replace the identity that
    // is currently mounted, even when its HTTP request itself succeeded.
    if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return null
    if (!sessionIdentityMatches(requestUserId, user.id, requestToken)) return null

    const nextToken = getLatestSessionToken(requestToken)
    if (!sessionIdentityMatches(requestUserId, user.id, nextToken)) return null
    if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return null

    rememberSessionToken(nextToken)
    currentSessionTokenRef.current = nextToken
    const nextUser = {
      ...user,
      settings: {
        ...requestSession.user.settings,
        ...patch,
        ...user.settings,
      },
    }
    const nextSession = {
      ...requestSession,
      token: nextToken,
      user: nextUser,
      impersonation: requestSession.impersonation,
    }

    setSession((current) => {
      if (
        !current
        || current.user.id !== requestUserId
        || !isCurrentSessionToken(current.token)
        || sessionIdentityEpochRef.current !== requestEpoch
      ) {
        return current
      }
      const committedSession = {
        ...current,
        token: nextToken,
        user: {
          ...nextUser,
          settings: {
            ...current.user.settings,
            ...patch,
            ...user.settings,
          },
        },
        impersonation: current.impersonation ?? requestSession.impersonation,
      }
      safeSetJson(SESSION_KEY, committedSession)
      return committedSession
    })

    return nextSession
  }

  function openUpgradePage(feature = 'application-limit', requested = String(applications.length + 1), limit = String(applicationLimit)) {
    const params = new URLSearchParams({ feature, requested, limit })
    window.open(`/upgrade-pro?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  async function performSaveApplication(nextApp: ApplicationRecord, message: string, queuedSession: AuthSession) {
    if (!isCurrentSessionToken(queuedSession.token)) return
    const draftMutationVersion = draftMutationVersionRef.current
    const baseApplication = draftRef.current?.id === nextApp.id
      ? safeParseJson<ApplicationRecord>(draftBaselineRef.current)
      : applications.find((application) => application.id === nextApp.id) ?? null
    const queueForSync = () => {
      const baseUpdatedAt = baseApplication?.updatedAt ?? nextApp.updatedAt ?? null
      const nextQueue = enqueueApplicationUpdate(
        queuedSession.user.id,
        nextApp,
        baseUpdatedAt,
        baseApplication,
      )
      const nextApplications = applications.map((application) =>
        application.id === nextApp.id ? nextApp : application,
      )
      replaceApplication(nextApp)
      saveOfflineSnapshot(queuedSession, currentSnapshotData(nextApplications))
      setOfflineSnapshotSavedAt(new Date().toISOString())
      setOfflineDataActive(true)
      setOfflineQueueCount(nextQueue.length)
      setBlockedOfflineCount(nextQueue.filter((item) => item.status === 'blocked').length)
      notify(tpl(i18nValue.tx('toast.offlineChangeQueued'), {
        count: pendingOfflineQueueSize(queuedSession.user.id),
      }), 'info')
      void requestOfflineSync()
    }

    if (connectivityUnavailable() && canQueueApplicationUpdate(queuedSession, nextApp, { isTeamMode })) {
      queueForSync()
      return
    }

    try {
      const saved = await phdApi.updateApplication(queuedSession.token, nextApp, baseApplication)
      if (!isCurrentSessionToken(queuedSession.token)) return
      removeOfflineApplicationUpdates(queuedSession.user.id, saved.id)
      refreshOfflineQueueCounts(queuedSession.user.id)
      replaceApplication(saved, draftMutationVersion)
      notify(message)
    } catch (error) {
      if (isAuthExpired(error)) {
        return
      }

      if (isNetworkLikeError(error) && canQueueApplicationUpdate(queuedSession, nextApp, { isTeamMode })) {
        queueForSync()
        return
      }

      if (isNetworkLikeError(error)) {
        notify(i18nValue.tx('toast.offlineSaveNeedsOnline'), 'error')
      } else {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    }
  }

  async function saveApplication(nextApp: ApplicationRecord, message: string) {
    const queuedSession = activeSession
    const previous = saveQueueByApplicationRef.current.get(nextApp.id) ?? Promise.resolve()
    pendingSaveCountRef.current += 1
    if (pendingSaveCountRef.current === 1) setSaving(true)

    const queued = previous
      .catch(() => undefined)
      .then(() => performSaveApplication(nextApp, message, queuedSession))
    saveQueueByApplicationRef.current.set(nextApp.id, queued)

    try {
      await queued
    } finally {
      if (saveQueueByApplicationRef.current.get(nextApp.id) === queued) {
        saveQueueByApplicationRef.current.delete(nextApp.id)
      }
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
      if (pendingSaveCountRef.current === 0) setSaving(false)
    }
  }

  async function toggleApplicationTeamVisibility(applicationId: string, visibleToTeam: boolean, teamId?: string) {
    pendingSaveCountRef.current += 1
    if (pendingSaveCountRef.current === 1) setSaving(true)
    try {
      const saved = await phdApi.updateApplicationTeamVisibility(activeSession.token, applicationId, visibleToTeam, teamId)
      replaceApplication(saved)
      const approvalPending = saved.teamTransferRequest?.status === 'pending'
      notify(i18nValue.tx(
        approvalPending
          ? visibleToTeam
            ? 'toast.teamTransferJoinRequested'
            : 'toast.teamTransferLeaveRequested'
          : visibleToTeam
            ? 'toast.teamVisibilityShared'
            : 'toast.teamVisibilityPrivate',
      ))
      await refreshTeamWorkspace(activeSession)
      return true
    } catch (error) {
      if (!isAuthExpired(error)) {
        notify(normalizeError(error, languageRef.current), 'error')
      }
      return false
    } finally {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
      if (pendingSaveCountRef.current === 0) setSaving(false)
    }
  }

  function discardDraft() {
    if (!selected) return
    setDraftState(cloneApplication(selected), { clean: true })
    notify(i18nValue.tx('toast.changesDiscarded'))
  }

  function confirmDeleteApplications(applicationIds: string[]) {
    const targets = applications.filter((application) => applicationIds.includes(application.id))
    if (targets.length === 0) return
    runWithNavigationGuard(() => {
      setConfirmDialog({
        title: i18nValue.tx('explorer.deleteSelected'),
        message: tpl(i18nValue.tx('confirmDeleteApplications'), { count: targets.length }),
        confirmLabel: i18nValue.tx('dossier.delete'),
        variant: 'danger',
        onConfirm: () => {
          setConfirmDialog(null)
          const targetIds = targets.map((application) => application.id)
          setRemovingApplicationIds((current) => new Set([...current, ...targetIds]))
          void (async () => {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, getMotionDelay(380))
            })
            await run(async () => {
              await Promise.all(targets.map((application) => phdApi.deleteApplication(activeSession.token, application.id)))
              removeApplicationsFromState(targetIds)
              notify(tpl(i18nValue.tx('toast.applicationsDeleted'), { count: targets.length }))
              await refreshTrashAndSessionMetadata(activeSession)
            })
          })().finally(() => {
            setRemovingApplicationIds((current) => {
              const next = new Set(current)
              targetIds.forEach((id) => next.delete(id))
              return next
            })
          })
        },
      })
    })
  }

  function openApplicationsInTabs(applicationIds: string[]) {
    const uniqueIds = Array.from(new Set(applicationIds))
    const ids = uniqueIds.filter((id) => workspaceApplications.some((application) => application.id === id))
    if (ids.length === 0) return
    ids.forEach((id) => {
      window.open(pathForRoute('workspace', id, 'dossier', teamSection, interfaceMode), '_blank', 'noopener,noreferrer')
    })
  }

  function exportSelectedApplications(applicationIds: string[]) {
    const uniqueIds = Array.from(new Set(applicationIds))
    const targets = applications.filter((application) => uniqueIds.includes(application.id))
    if (targets.length === 0) return
    void run(async () => {
      for (const target of targets) {
        const blob = await phdApi.downloadExport(activeSession.token, 'json', target.id)
        downloadBlob(blob, `phd-application-${safeFileSegment(target.school.name)}.json`)
      }
    }, tpl(i18nValue.tx('toast.exported'), { format: 'JSON' }))
  }

  function restoreTrashItem(item: ApplicationTrashItem) {
    void run(async () => {
      const restored = await phdApi.restoreApplicationFromTrash(activeSession.token, item.id)
      setApplications((items) => [restored, ...items.filter((application) => application.id !== restored.id)])
      setApplicationTrash((items) => items.filter((candidate) => candidate.id !== item.id))
      setSelectedId(restored.id)
      setDraftState(cloneApplication(restored), { clean: true })
      setScreen('workspace')
      setMobileDetailOpen(true)
      await refreshSessionMetadata(activeSession)
    }, i18nValue.tx('toast.applicationRestored'))
  }

  function confirmDeleteTrashItem(item: ApplicationTrashItem) {
    setConfirmDialog({
      title: i18nValue.tx('trash.deleteForever'),
      message: tpl(i18nValue.tx('trash.confirmDeleteForever'), { name: item.application.school.name }),
      confirmLabel: i18nValue.tx('trash.deleteForever'),
      variant: 'danger',
      onConfirm: () => {
        setConfirmDialog(null)
        setRemovingTrashItemIds((current) => new Set(current).add(item.id))
        void (async () => {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, getMotionDelay(380))
          })
          await run(async () => {
            await phdApi.deleteApplicationTrashItem(activeSession.token, item.id)
            setApplicationTrash((items) => items.filter((candidate) => candidate.id !== item.id))
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.trashDeleted'))
        })().finally(() => {
          setRemovingTrashItemIds((current) => {
            const next = new Set(current)
            next.delete(item.id)
            return next
          })
        })
      },
    })
  }

  function confirmEmptyTrash() {
    const itemIds = applicationTrash.map((item) => item.id)
    if (itemIds.length === 0) return
    setConfirmDialog({
      title: i18nValue.tx('trash.empty'),
      message: i18nValue.tx('trash.confirmEmpty'),
      confirmLabel: i18nValue.tx('trash.empty'),
      variant: 'danger',
      onConfirm: () => {
        setConfirmDialog(null)
        setRemovingTrashItemIds((current) => new Set([...current, ...itemIds]))
        void (async () => {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, getMotionDelay(380))
          })
          await run(async () => {
            await phdApi.emptyApplicationTrash(activeSession.token)
            setApplicationTrash([])
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.trashEmptied'))
        })().finally(() => {
          setRemovingTrashItemIds((current) => {
            const next = new Set(current)
            itemIds.forEach((id) => next.delete(id))
            return next
          })
        })
      },
    })
  }

  async function copyValue(value: string, label: string, options: { skipClipboard?: boolean } = {}) {
    if (!value.trim()) return

    try {
      if (!options.skipClipboard) {
        const clipboard = window.navigator.clipboard ?? navigator.clipboard
        await clipboard.writeText(value)
      }
      notify(tpl(i18nValue.tx('toast.copied'), { label }))
    } catch {
      notify(value, 'info')
    }
  }

  function updateUserSetting(key: string, value: unknown, message = i18nValue.tx('toast.settingsUpdated')) {
    void run(async () => {
      const requestSession = activeSession
      const requestEpoch = sessionIdentityEpochRef.current
      const patch = { [key]: value } as Partial<UserSettings>
      const user = await phdApi.updateSettings(
        requestSession.token,
        patch,
      )
      const nextSession = commitSettingsUser(requestSession, user, patch, requestEpoch)
      if (!nextSession) return
      if (touchesBackupSettings(patch)) {
        await refreshApplicationsAndBackups(nextSession)
      }
    }, message)
  }

  function updateUserSettings(patch: UserSettingsPatch, message = i18nValue.tx('toast.settingsUpdated')) {
    return run(async () => {
      const requestSession = activeSession
      const requestToken = requestSession.token
      const requestUserId = requestSession.user.id
      const requestEpoch = sessionIdentityEpochRef.current
      // Optimistic merge so dual-language / other settings selects update before the network returns.
      setSession((current) => {
        if (
          !current
          || current.user.id !== requestUserId
          || !isCurrentSessionToken(requestToken)
          || sessionIdentityEpochRef.current !== requestEpoch
        ) return current
        return {
          ...current,
          user: {
            ...current.user,
            settings: {
              ...current.user.settings,
              ...patch,
            },
          },
        }
      })
      const user = await phdApi.updateSettings(requestToken, patch)
      const nextSession = commitSettingsUser(requestSession, user, patch, requestEpoch)
      if (!nextSession) return
      if (touchesBackupSettings(patch)) {
        await refreshApplicationsAndBackups(nextSession)
      }
    }, message)
  }

  async function saveUserAvatar(avatarDataUrl: string) {
    const requestSession = activeSession
    const requestToken = requestSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    try {
      setBusy(true)
      const user = await phdApi.updateSettings(requestToken, { avatarDataUrl })
      const nextSession = commitSettingsUser(requestSession, user, { avatarDataUrl }, requestEpoch)
      if (!nextSession) return false
      setTeamSummary((current) => current ? {
        ...current,
        members: current.members.map((member) => member.userId === user.id
          ? { ...member, avatarUrl: avatarDataUrl || undefined }
          : member),
      } : current)
      notify(avatarDataUrl ? i18nValue.tx('toast.avatarUpdated') : i18nValue.tx('toast.avatarRemoved'))
      return true
    } catch (error) {
      if (!isAuthExpired(error)) {
        notify(
          isNetworkLikeError(error)
            ? i18nValue.tx('toast.offlineActionNeedsOnline')
            : normalizeError(error, languageRef.current),
          'error',
        )
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addAiKey(input: AiKeyInput) {
    const created = await phdApi.createAiKey(activeSession.token, input)
    setAiKeys((items) => [created, ...items.filter((item) => item.id !== created.id)])
    notify(i18nValue.tx('settings.ai.keyAdded'))
  }

  async function editAiKey(id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey'>>) {
    const updated = await phdApi.updateAiKey(activeSession.token, id, input)
    setAiKeys((items) => items.map((item) => item.id === updated.id ? updated : item))
    notify(i18nValue.tx('settings.ai.keyUpdated'))
  }

  async function removeAiKey(id: string) {
    await phdApi.deleteAiKey(activeSession.token, id)
    setAiKeys((items) => items.filter((item) => item.id !== id))
    notify(i18nValue.tx('settings.ai.keyRemoved'))
  }

  async function testAiKey(id: string) {
    const result = await phdApi.testAiKey(activeSession.token, id)
    setAiKeys((items) => items.map((item) => (
      item.id === id ? { ...item, lastUsedAt: result.testedAt } : item
    )))
    return { latencyMs: result.latencyMs, model: result.model }
  }

  async function resetAiKeyUsage(id: string) {
    const updated = await phdApi.resetAiKeyUsage(activeSession.token, id)
    setAiKeys((items) => items.map((item) => item.id === updated.id ? updated : item))
    notify(i18nValue.tx('settings.ai.usageResetDone'))
  }

  async function pollMailSyncJob(jobId: string) {
    if (!session) return false
    try {
      const requestToken = getLatestSessionToken(session.token)
      const requestSession = { ...session, token: requestToken }
      const me = await phdApi.me(requestToken)
      const committedSession = commitSessionMetadata(requestSession, me, requestToken)
      const currentJob = me.mailFetchStatus?.syncJob
      if (currentJob?.id === jobId && ['queued', 'running'].includes(currentJob.status)) return true
      if (
        committedSession
        && currentJob?.id === jobId
        && ['succeeded', 'failed'].includes(currentJob.status)
      ) {
        await refreshApplicationsAndSessionMetadata(committedSession)
        refreshUnreadNotificationCount()
        if (notificationCenterOpen) void refreshNotificationList()
        if (currentJob.status === 'failed') {
          notify(
            tpl(i18nValue.tx('toast.mailSyncBackgroundFailed'), {
              code: currentJob.errorCode ?? 'FETCH_FAILED',
            }),
            'error',
          )
        } else {
          const result = currentJob.result
          if (result && result.filed > 0) {
            notify(
              tpl(i18nValue.tx(currentJob.mode === 'history' ? 'toast.mailHistoryFiled' : 'toast.mailFetchFiled'), {
                count: result.filed,
                incoming: result.incoming,
                outgoing: result.outgoing,
              }),
              'success',
            )
          } else {
            notify(
              i18nValue.tx(currentJob.mode === 'history' ? 'toast.mailHistoryNoMail' : 'toast.mailFetchNoNewMail'),
              'info',
            )
          }
          if (result && !result.stateCommitted) notify(i18nValue.tx('toast.mailSyncNeedsRetry'), 'info')
        }
      }
      return false
    } catch (error) {
      if (isAuthExpired(error)) return false
      // A transient status request cannot cancel the durable server job.
      return true
    }
  }

  async function syncMailbox(mode: 'incremental' | 'history', patch?: Partial<UserSettings>) {
    setBusy(true)
    try {
      const requestSession = activeSession
      let nextSession = requestSession
      if (patch && Object.keys(patch).length > 0) {
        const user = await phdApi.updateSettings(requestSession.token, patch)
        const committedSession = commitSettingsUser(requestSession, user, patch)
        if (!committedSession) return
        nextSession = committedSession
      }
      const result = mode === 'history'
        ? await phdApi.syncMailHistory(nextSession.token)
        : await phdApi.fetchMailNow(nextSession.token)
      notify(
        i18nValue.tx(result.alreadyQueued ? 'toast.mailSyncAlreadyRunning' : 'toast.mailSyncQueued'),
        'info',
      )
      await refreshSessionMetadata(nextSession)
    } catch (error) {
      if (!isAuthExpired(error)) {
        notify(normalizeError(error, languageRef.current), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  function createPasskey(label: string) {
    if (!passkeyAvailable) {
      notify(i18nValue.tx('passkeyUnavailable'), 'error')
      return
    }
    void run(async () => {
      try {
        const { options } = await phdApi.beginPasskeyRegistration(activeSession.token, label)
        const { startRegistration } = await import('@simplewebauthn/browser')
        const attestation = await startRegistration({
          optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'],
        })
        const items = await phdApi.finishPasskeyRegistration(
          getLatestSessionToken(activeSession.token),
          attestation,
          label,
        )
        setPasskeys(items)
      } catch (error) {
        if (isPasskeyAbort(error)) {
          throw new Error(i18nValue.tx('passkeyCancelled'))
        }
        throw error
      }
    }, i18nValue.tx('settings.passkeyAdded'))
  }

  function renamePasskey(id: string, label: string) {
    return run(async () => {
      const updated = await phdApi.updatePasskey(activeSession.token, id, label)
      setPasskeys((items) => items.map((item) => (item.id === id ? updated : item)))
    }, i18nValue.tx('settings.passkeyRenamed'))
  }

  function deletePasskey(id: string) {
    setRemovingPasskeyIds((current) => new Set(current).add(id))
    void (async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, getMotionDelay(380))
      })
      await run(async () => {
        await phdApi.deletePasskey(activeSession.token, id)
        setPasskeys((items) => items.filter((item) => item.id !== id))
      }, i18nValue.tx('settings.passkeyRemoved'))
    })().finally(() => {
      setRemovingPasskeyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    })
  }

  function registerNavigationGuard(guard: NavigationGuard | null) {
    navigationGuardRef.current = guard
  }

  function runWithNavigationGuard(action: () => void) {
    const guard = navigationGuardRef.current
    if (guard?.(action)) return
    action()
  }

  function createWorkspaceJumpIntent(target: WorkspaceJumpTarget): DossierJumpIntent {
    workspaceJumpTokenRef.current += 1
    return { ...target, token: workspaceJumpTokenRef.current }
  }

  function clearWorkspaceViewExit() {
    if (workspaceViewExitTimerRef.current !== null) {
      window.clearTimeout(workspaceViewExitTimerRef.current)
      workspaceViewExitTimerRef.current = null
    }
    setWorkspaceViewExit(null)
  }

  function commitWorkspaceBoardOpen({
    synchronous = false,
  }: { synchronous?: boolean } = {}) {
    // The workspace data is already local, so retain mounted panes while the
    // center stage changes between board and dossier views.
    setDraftState(null, { clean: true })
    const commit = () => {
      setSelectedId(null)
      setWorkspaceJumpIntent(null)
      setViewMode('kanban')
      setScreen('workspace')
      setMobileDetailOpen(false)
      setWorkspaceViewExit(null)
    }
    if (synchronous) commit()
    else startTransition(commit)
  }

  function openWorkspaceBoard({
    synchronous = false,
    direction = 'forward',
  }: { synchronous?: boolean; direction?: 'forward' | 'backward' } = {}) {
    if (!canUseWorkspaceBoard) return
    if (screen !== 'workspace') setWorkspaceOpeningFromDashboard(true)
    setViewModeDirection('to-kanban')
    if (!synchronous && screen === 'workspace' && viewMode !== 'kanban' && selectedId) {
      clearWorkspaceViewExit()
      runAnimatedScreenUpdate(
        () => commitWorkspaceBoardOpen({ synchronous: true }),
        {
          scope: 'workspace-view',
          direction,
          ready: warmCriticalScreenAssets('workspace', tab, lang, 'kanban'),
          readinessGate: readinessGateForScreen('workspace', 'kanban'),
          forceCssFallback: true,
        },
      )
      return
    }
    clearWorkspaceViewExit()
    commitWorkspaceBoardOpen({ synchronous })
  }

  function closeMobileApplicationDetail() {
    const origin = mobileDetailOriginRef.current
    if (origin === 'dashboard') {
      runAnimatedScreenUpdate(() => {
        setMobileDetailOpen(false)
        setWorkspaceOpeningFromDashboard(false)
        setScreen('dashboard')
      }, { scope: 'screen', direction: 'backward' })
      return
    }
    if (origin === 'kanban') {
      openWorkspaceBoard({ direction: 'backward' })
      return
    }
    changeViewMode('list')
  }

  function closeApplicationDetail() {
    if (compactWorkspaceViewport) {
      closeMobileApplicationDetail()
      return
    }
    openWorkspaceBoard()
  }

  function changeViewMode(nextMode: 'list' | 'kanban') {
    if (nextMode === 'kanban') {
      openWorkspaceBoard()
      return
    }
    clearWorkspaceViewExit()
    const openingMobileList = window.matchMedia('(max-width: 820px)').matches
    if (nextMode === viewMode && (!openingMobileList || !mobileDetailOpen)) return
    if (openingMobileList) {
      runAnimatedScreenUpdate(() => {
        setViewModeDirection('to-list')
        setViewMode('list')
        setMobileDetailOpen(false)
        setScreen('workspace')
      }, {
        scope: 'workspace-view',
        direction: 'backward',
        forceCssFallback: true,
      })
      return
    }
    const firstApplicationId = selectedId ?? workspaceApplications[0]?.id
    if (firstApplicationId) {
      selectApplication(firstApplicationId)
      return
    }
    runAnimatedScreenUpdate(() => {
      setViewModeDirection('to-list')
      setViewMode('list')
    }, { scope: 'workspace-view', direction: 'backward' })
  }

  function selectApplication(applicationId: string, jumpTarget?: WorkspaceJumpTarget) {
    if (compactWorkspaceViewport && !mobileDetailOpen) {
      mobileDetailOriginRef.current = screen === 'dashboard'
        ? 'dashboard'
        : viewMode === 'kanban'
          ? 'kanban'
          : 'list'
    }
    const targetApplication = workspaceApplications.find((application) => application.id === applicationId)
    const currentIndex = selected ? visibleApplications.findIndex((application) => application.id === selected.id) : -1
    const nextIndex = visibleApplications.findIndex((application) => application.id === applicationId)
    const rowDirection = currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex
      ? 'backward'
      : 'forward'
    // Opening a focused project is always a forward spatial move on phones;
    // row-relative direction remains useful for desktop record-to-record swaps.
    const direction = compactWorkspaceViewport && !mobileDetailOpen
      ? 'forward'
      : rowDirection
    const needsScreenTransition = screen !== 'workspace'
    const needsWorkspaceViewTransition = screen === 'workspace'
      && (viewMode === 'kanban' || !selected || !draftRef.current)
    const nextJumpIntent = jumpTarget ? createWorkspaceJumpIntent(jumpTarget) : null
    const draftAlreadyReady = draftRef.current?.id === applicationId
    if (!draftAlreadyReady) clearDetailDraftHydration()

    const commitSelection = () => {
      clearWorkspaceViewExit()
      if (targetApplication && !draftAlreadyReady) {
        // Dossier edits are immutable, so the locally cached record is a safe
        // zero-copy draft seed. Its expensive dirty baseline is still prepared
        // when idle; the first edit supplies a new draft object.
        setDraftState(targetApplication, { clean: true, deferBaseline: true })
      }
      setViewModeDirection('to-list')
      setViewMode('list')
      setSelectedId(applicationId)
      if (jumpTarget) setTab(jumpTarget.tab)
      setWorkspaceJumpIntent(nextJumpIntent)
      setScreen('workspace')
      setMobileDetailOpen(true)
    }

    const transitionScope: AnimatedScreenTransitionScope = needsScreenTransition
      ? 'screen'
      : needsWorkspaceViewTransition
        ? 'workspace-view'
        : 'dossier-record'
    const destinationReady = needsWorkspaceViewTransition || needsScreenTransition
      ? prefetchDossierAssets()
      : undefined
    const beginSelection = () => runAnimatedDossierUpdate(commitSelection, {
      scope: transitionScope,
      direction,
      ready: destinationReady,
      deferDossierContent: compactWorkspaceViewport && !mobileDetailOpen,
    })

    beginSelection()
  }

  function openDashboardApplication(applicationId: string, jumpTarget?: WorkspaceJumpTarget) {
    setWorkspaceOpeningFromDashboard(true)
    setViewModeDirection('to-list')
    startTransition(() => setViewMode('list'))
    selectApplication(applicationId, jumpTarget)
  }

  function openTourSampleWorkspace(nextTab: DetailTab, jumpTarget?: WorkspaceJumpTarget) {
    ensureTourSampleApplication()
    setWorkspaceLayout(defaultWorkspaceLayout)
    setViewModeDirection('to-list')
    setQuery('')
    setStatusFilters([])
    setSort('deadline')
    setWorkspaceOpeningFromDashboard(true)
    const nextJumpIntent = jumpTarget ? createWorkspaceJumpIntent(jumpTarget) : null
    startTransition(() => {
      setSelectedId(TOUR_SAMPLE_APPLICATION_ID)
      setViewMode('list')
      setTab(nextTab)
      setWorkspaceJumpIntent(nextJumpIntent)
      setScreen('workspace')
      setMobileDetailOpen(true)
    })
  }

  function handleOnboardingStepEnter(stepKey: string) {
    if (!showOnboarding) return
    if (stepKey === 'welcome' || stepKey === 'open-application') {
      ensureTourSampleApplication()
      setWorkspaceJumpIntent(null)
      setTab('dossier')
      setScreen('dashboard')
      setMobileDetailOpen(false)
      return
    }
    if (stepKey === 'open-checklist') {
      openTourSampleWorkspace('dossier')
      return
    }
    if (stepKey === 'expand-task') {
      openTourSampleWorkspace('materials', {
        tab: 'materials',
        targetId: 'task-tour-task-outline',
      })
      return
    }
    if (stepKey === 'open-correspondence') {
      openTourSampleWorkspace('materials')
      return
    }
    if (stepKey === 'review-reply') {
      openTourSampleWorkspace('mail', {
        tab: 'mail',
        targetId: 'communication-tour-comm-1',
      })
      return
    }
    if (stepKey === 'open-ai-profile' || stepKey === 'profile-overview') {
      setScreen('profile')
      return
    }
    if (
      stepKey === 'open-mail-settings'
      || stepKey === 'mail-overview'
      || stepKey === 'open-ai-key'
      || stepKey === 'ai-key-overview'
    ) {
      setScreen('settings')
      return
    }
    if (stepKey === 'open-ai-composer') {
      openTourSampleWorkspace('mail')
    }
  }

  function openNewApplicationDialog(ownerId: string | null) {
    const limit = isProUser ? applicationLimit : applicationCreateLimit
    const shouldCheckOwnCreateLimit = !isTeamMode
    if (shouldCheckOwnCreateLimit && !isAdminUser && applicationLimitUsageCount >= limit) {
      openUpgradePage('application-limit', String(applicationLimitUsageCount + 1), String(limit))
      return
    }
    setNewApplicationOwnerHint(ownerId ?? null)
    if (ownerId) {
      setOwnerFilter(ownerId)
      setInterfaceMode('team')
    }
    runWithNavigationGuard(() => {
      // Do not make the click wait for code or locale I/O. LazyOverlayBoundary
      // owns the short pending cue while both resources warm concurrently.
      void Promise.all([
        preloadLanguage(lang, ['core', 'shared', 'dossier']),
        loadNewApplicationDialog(),
      ]).catch(() => undefined)
      setDialogOpen(true)
    })
  }

  function openShareDialog() {
    void Promise.all([
      preloadLanguage(lang, ['core', 'shared', 'share']),
      loadShareDialog(),
    ]).catch(() => undefined)
    setShareScopeSections([...allShareSections])
    setShareDialogOpen(true)
  }

  function resizeDeltaForPane(pane: 'applications' | 'inspector', delta: number, swapped: boolean) {
    if (pane === 'applications') return swapped ? -delta : delta
    return swapped ? delta : -delta
  }

  function paneWidthMin(pane: 'applications' | 'inspector') {
    return pane === 'applications' ? PANE_WIDTH_MIN : INSPECTOR_WIDTH_MIN
  }

  function paneWidthMax(pane: 'applications' | 'inspector') {
    return pane === 'applications' ? PANE_WIDTH_MAX : INSPECTOR_WIDTH_MAX
  }

  function paneStoredWidth(layout: WorkspaceLayoutState, pane: 'applications' | 'inspector') {
    return pane === 'applications' ? layout.applicationPaneWidth : layout.inspectorWidth
  }

  function paneIsHidden(layout: WorkspaceLayoutState, pane: 'applications' | 'inspector') {
    return pane === 'applications' ? layout.applicationsHidden : layout.inspectorHidden
  }

  function patchPaneLayout(
    layout: WorkspaceLayoutState,
    pane: 'applications' | 'inspector',
    patch: { hidden?: boolean; width?: number },
  ): WorkspaceLayoutState {
    if (pane === 'applications') {
      return {
        ...layout,
        applicationsHidden: patch.hidden ?? layout.applicationsHidden,
        applicationPaneWidth: patch.width ?? layout.applicationPaneWidth,
      }
    }
    return {
      ...layout,
      inspectorHidden: patch.hidden ?? layout.inspectorHidden,
      inspectorWidth: patch.width ?? layout.inspectorWidth,
    }
  }

  function updateWorkspacePaneWidth(pane: 'applications' | 'inspector', delta: number) {
    setWorkspaceLayout((current) => {
      const adjustedDelta = resizeDeltaForPane(pane, delta, current.sidebarsSwapped)
      if (paneIsHidden(current, pane)) {
        if (adjustedDelta <= 0) return current
        return patchPaneLayout(current, pane, { hidden: false })
      }
      return patchPaneLayout(current, pane, {
        width: clampNumber(
          paneStoredWidth(current, pane) + adjustedDelta,
          paneWidthMin(pane),
          paneWidthMax(pane),
        ),
      })
    })
  }

  function toggleWorkspacePane(pane: 'applications' | 'inspector') {
    const hiddenKey = pane === 'applications' ? 'applicationsHidden' : 'inspectorHidden'
    // Start the visual response before the large App tree reconciles. The
    // durable preference is non-urgent and catches up in a React transition.
    const nextHidden = toggleWorkspacePaneClass(workspaceShellRef.current, pane)
    startTransition(() => {
      setWorkspaceLayout((current) => ({
        ...current,
        [hiddenKey]: nextHidden ?? !current[hiddenKey],
      }))
    })
  }

  function startWorkspaceResize(pane: 'applications' | 'inspector', event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startLayout = workspaceLayout
    const startHidden = paneIsHidden(startLayout, pane)
    const minWidth = paneWidthMin(pane)
    const maxWidth = paneWidthMax(pane)
    const shell = workspaceShellRef.current
    let previewLayout = startLayout
    document.body.classList.add('workspace-resizing')

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const rawDelta = moveEvent.clientX - startX
      const adjustedDelta = resizeDeltaForPane(pane, rawDelta, startLayout.sidebarsSwapped)
      if (startHidden) {
        previewLayout = adjustedDelta <= PANE_REVEAL_DISTANCE
          ? patchPaneLayout(startLayout, pane, { hidden: true })
          : patchPaneLayout(startLayout, pane, {
              hidden: false,
              width: clampNumber(
                Math.max(paneStoredWidth(startLayout, pane), adjustedDelta),
                minWidth,
                maxWidth,
              ),
            })
      } else {
        const rawWidth = paneStoredWidth(startLayout, pane) + adjustedDelta
        previewLayout = rawWidth < minWidth - PANE_COLLAPSE_DISTANCE
          ? patchPaneLayout(startLayout, pane, { hidden: true })
          : patchPaneLayout(startLayout, pane, {
              hidden: false,
              width: clampNumber(rawWidth, minWidth, maxWidth),
            })
      }

      if (shell) {
        shell.style.setProperty('--pane-width', `${previewLayout.applicationPaneWidth}px`)
        shell.style.setProperty('--inspector-width', `${previewLayout.inspectorWidth}px`)
        shell.classList.toggle('hide-application-pane', previewLayout.applicationsHidden)
        shell.classList.toggle('hide-inspector-pane', previewLayout.inspectorHidden)
      }
    }

    const stopResize = () => {
      document.body.classList.remove('workspace-resizing')
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      setWorkspaceLayout(previewLayout)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  function handleWorkspaceResizeKey(pane: 'applications' | 'inspector', event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    updateWorkspacePaneWidth(pane, event.key === 'ArrowRight' ? 24 : -24)
  }

  function refreshNotificationList() {
    setNotificationsLoading(true)
    return Promise.all([
      phdApi.listNotifications(activeSession.token),
      phdApi.listNotifications(activeSession.token, { archivedOnly: true }),
    ])
      .then(([active, archived]) => setNotifications(
        [...active, ...archived].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      ))
      .catch((error) => notify(normalizeError(error, languageRef.current), 'error'))
      .finally(() => setNotificationsLoading(false))
  }

  function refreshUnreadNotificationCount() {
    void phdApi.unreadNotificationCount(activeSession.token)
      .then((result) => setUnreadNotificationCount(result.count))
      .catch(() => {})
  }

  function recoverNotificationAction(error: unknown) {
    notify(normalizeError(error, languageRef.current), 'error')
    void refreshNotificationList()
    refreshUnreadNotificationCount()
  }

  function notificationActionIds(ids: string[]) {
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  }

  function openNotificationCenter() {
    void loadNotificationCenter().catch(() => undefined)
    setNotificationCenterOpen(true)
    void refreshNotificationList()
  }

  function markNotificationsRead(ids: string[]) {
    const targetIds = notificationActionIds(ids)
    if (targetIds.length === 0) return
    const idSet = new Set(targetIds)
    const unreadCountBefore = notifications.filter((item) => idSet.has(item.id) && !item.readAt).length
    if (unreadCountBefore === 0) return
    const stamp = new Date().toISOString()
    setNotifications((items) => items.map((item) => (
      idSet.has(item.id) && !item.readAt ? { ...item, readAt: stamp } : item
    )))
    setUnreadNotificationCount((count) => Math.max(0, count - unreadCountBefore))
    void phdApi.updateNotificationsBulk(activeSession.token, targetIds, 'mark_read')
      .catch(recoverNotificationAction)
  }

  function markNotificationsUnread(ids: string[]) {
    const targetIds = notificationActionIds(ids)
    if (targetIds.length === 0) return
    const idSet = new Set(targetIds)
    const readCountBefore = notifications.filter((item) => idSet.has(item.id) && item.readAt).length
    if (readCountBefore === 0) return
    setNotifications((items) => items.map((item) => (
      idSet.has(item.id) && item.readAt ? { ...item, readAt: null } : item
    )))
    setUnreadNotificationCount((count) => count + readCountBefore)
    void phdApi.updateNotificationsBulk(activeSession.token, targetIds, 'mark_unread')
      .catch(recoverNotificationAction)
  }

  function archiveNotifications(ids: string[]) {
    const targetIds = notificationActionIds(ids)
    if (targetIds.length === 0) return
    const idSet = new Set(targetIds)
    const archivedUnreadCount = notifications.filter((item) => idSet.has(item.id) && !item.readAt).length
    const stamp = new Date().toISOString()
    setNotifications((items) => items.map((item) => (
      idSet.has(item.id) && !item.archivedAt
        ? { ...item, archivedAt: stamp, readAt: item.readAt ?? stamp }
        : item
    )))
    setUnreadNotificationCount((count) => Math.max(0, count - archivedUnreadCount))
    void phdApi.updateNotificationsBulk(activeSession.token, targetIds, 'archive')
      .catch(recoverNotificationAction)
  }

  function markAllNotificationsRead() {
    const stamp = new Date().toISOString()
    setNotifications((items) => items.map((item) => (item.readAt ? item : { ...item, readAt: stamp })))
    setUnreadNotificationCount(0)
    void phdApi.markAllNotificationsRead(activeSession.token).catch(recoverNotificationAction)
  }

  function notificationMetadataString(item: NotificationRecord, key: string) {
    const value = item.metadata?.[key]
    return typeof value === 'string' && value.trim() ? value : null
  }

  function normalizeNotificationPath(path: string | null | undefined) {
    if (!path) return ''
    try {
      const url = new URL(path, window.location.origin)
      return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : ''
    } catch {
      return path.startsWith('/') ? path : ''
    }
  }

  function notificationJumpTab(item: NotificationRecord, routeTab?: DetailTab): DetailTab {
    if (item.targetTab && validTabs.includes(item.targetTab as DetailTab)) return item.targetTab as DetailTab
    if (routeTab) return routeTab
    if (item.type === 'new_email_imported') return 'mail'
    if (item.type === 'task_due' || item.type === 'material_reminder') return 'materials'
    if (item.type === 'team_message') return 'review'
    return 'dossier'
  }

  function notificationJumpTarget(item: NotificationRecord, routeTab?: DetailTab): WorkspaceJumpTarget {
    const tab = notificationJumpTab(item, routeTab)
    const materialId = notificationMetadataString(item, 'materialId')
    const taskId = notificationMetadataString(item, 'taskId')
    const communicationId = notificationMetadataString(item, 'communicationId')
    const commentId = notificationMetadataString(item, 'commentId')
    const scholarshipId = notificationMetadataString(item, 'scholarshipId')
    const targetId = item.targetId
      ?? (tab === 'materials' && materialId ? `material-${materialId}` : null)
      ?? (tab === 'materials' && taskId ? `task-${taskId}` : null)
      ?? (tab === 'mail' && communicationId ? `communication-${communicationId}` : null)
      ?? (tab === 'review' && commentId ? `review-comment-${commentId}` : null)
      ?? (tab === 'funding' && scholarshipId ? `scholarship-${scholarshipId}` : null)
      ?? 'dossier-config-card'
    let expand: WorkspaceJumpTarget['expand']
    if (tab === 'materials' && materialId) expand = { kind: 'material', id: materialId }
    if (tab === 'materials' && taskId) expand = { kind: 'task', id: taskId }
    if (tab === 'funding' && scholarshipId) expand = { kind: 'scholarship', id: scholarshipId }
    return {
      tab,
      targetId,
      expand,
      fallbackText: [item.title, item.body].filter(Boolean),
    }
  }

  function openNotificationDestination(item: NotificationRecord) {
    setNotificationCenterOpen(false)
    const normalizedPath = normalizeNotificationPath(item.targetPath)
    if (
      normalizedPath.startsWith('/team/accept-invite/')
      || normalizedPath.startsWith('/team/join/')
    ) {
      window.location.assign(normalizedPath)
      return
    }
    const pathname = normalizedPath.split(/[?#]/)[0]
    const parsed = pathname ? parseRoute(pathname) : null
    const applicationId = parsed?.screen === 'workspace' && parsed.selectedId
      ? parsed.selectedId
      : item.applicationId
    if (applicationId) {
      const jumpTarget = notificationJumpTarget(item, parsed?.tab)
      runWithNavigationGuard(() => {
        if (parsed?.interfaceMode === 'team' || normalizedPath.startsWith('/team/applications/')) {
          setInterfaceMode('team')
          setTeamSection('applications')
        } else if (parsed?.interfaceMode === 'personal') {
          setInterfaceMode('personal')
        }
        selectApplication(applicationId, jumpTarget)
      })
      return
    }
    if (parsed) {
      runWithNavigationGuard(() => {
        startTransition(() => {
          if (parsed.interfaceMode) setInterfaceMode(parsed.interfaceMode)
          setTeamSection(parsed.teamSection)
          setSelectedId(parsed.selectedId)
          setWorkspaceJumpIntent(null)
          setScreen(parsed.screen)
          setMobileDetailOpen(false)
        })
      })
    }
  }

  function handleInspectorEditField(field: string, value: string) {
    const source = draft ?? selected
    if (!source) return

    const [section, key] = field.split('.')
    let nextApp: ApplicationRecord = source
    if (section === 'professor' && key) {
      nextApp = { ...source, professor: { ...source.professor, [key]: value } }
    } else if (section === 'school' && key) {
      nextApp = { ...source, school: { ...source.school, [key]: value } }
    } else if (field === 'program') {
      nextApp = { ...source, program: value }
    } else if (field === 'deadline') {
      nextApp = {
        ...source,
        deadline: value,
        nextReminder: !source.nextReminder || source.nextReminder === source.deadline ? value : source.nextReminder,
      }
    } else if (field === 'nextReminder') {
      nextApp = { ...source, nextReminder: value }
    } else if (field === 'progress') {
      const progress = Math.min(100, Math.max(0, Math.round(Number(value) || 0)))
      nextApp = { ...source, progress }
    } else {
      const [kind, id, childId, childField] = field.split(':')
      if (kind === 'material' && id && childId === 'reminderDate') {
        nextApp = {
          ...source,
          materials: source.materials.map((material) =>
            material.id === id ? { ...material, reminderEnabled: true, reminderDate: value } : material,
          ),
        }
      } else if (kind === 'task' && id && childId === 'due') {
        nextApp = {
          ...source,
          tasks: source.tasks.map((task) => (task.id === id ? { ...task, due: value } : task)),
        }
      } else if (kind === 'scholarship' && id && (childId === 'startDate' || childId === 'endDate')) {
        nextApp = {
          ...source,
          scholarships: source.scholarships.map((scholarship) =>
            scholarship.id === id ? { ...scholarship, [childId]: value } : scholarship,
          ),
        }
      } else if (kind === 'scholarshipMaterial' && id && childId && childField === 'due') {
        nextApp = {
          ...source,
          scholarships: source.scholarships.map((scholarship) =>
            scholarship.id === id
              ? {
                  ...scholarship,
                  materials: (scholarship.materials ?? []).map((material) =>
                    material.id === childId ? { ...material, due: value } : material,
                  ),
                }
              : scholarship,
          ),
        }
      } else if (kind === 'scholarshipTask' && id && childId && childField === 'due') {
        nextApp = {
          ...source,
          scholarships: source.scholarships.map((scholarship) =>
            scholarship.id === id
              ? {
                  ...scholarship,
                  tasks: (scholarship.tasks ?? []).map((task) =>
                    task.id === childId ? { ...task, due: value } : task,
                  ),
                }
              : scholarship,
          ),
        }
      } else if (kind === 'scholarshipTimeline' && id && childId && childField === 'date') {
        nextApp = {
          ...source,
          scholarships: source.scholarships.map((scholarship) =>
            scholarship.id === id
              ? {
                  ...scholarship,
                  timeline: (scholarship.timeline ?? []).map((event) =>
                    event.id === childId ? { ...event, date: value } : event,
                  ),
                }
              : scholarship,
          ),
        }
      }
    }

    if (nextApp === source) return
    const prevApp = cloneApplication(source)
    setDraftState(cloneApplication(nextApp))
    void saveApplication(nextApp, i18nValue.tx('toast.appSaved'))
    // Show undo toast with action to restore the previous value.
    notify(
      i18nValue.tx('toast.appSaved'),
      'success',
      { label: i18nValue.tx('undo'), onClick: function() { setDraftState(prevApp) } },
    )
  }

  // Detect when the URL requested a specific application that doesn't exist (or isn't yet loaded).
  // Only fires once applications have actually been fetched so a loading blink doesn't flash 404.
  const applicationNotFound = applicationsLoaded
    && screen === 'workspace'
    && selectedId !== null
    && !workspaceApplications.some((application) => application.id === selectedId)

  const commandPaletteActions: CommandPaletteAction[] = (() => {
    const modLabel = navigator.platform.toUpperCase().includes('MAC') ? '⌘' : 'Ctrl'
    const navigate = (action: () => void) => () => {
      runWithNavigationGuard(() => startTransition(action))
    }

    return [
      {
        id: 'go-dashboard',
        label: isTeamMode ? i18nValue.tx('team.tabOverview', 'Overview') : i18nValue.tx('nav.dashboard'),
        description: i18nValue.tx('commandPalette.goDashboardDesc'),
        icon: <LayoutDashboard size={15} aria-hidden="true" />,
        shortcut: 'G D',
        keywords: ['dashboard', 'home', 'overview'],
        onRun: navigate(() => {
          if (isTeamMode) {
            setTeamSection('overview')
            setScreen('team')
          } else {
            setScreen('dashboard')
          }
        }),
      },
      {
        id: 'go-applications',
        label: isTeamMode ? i18nValue.tx('nav.teamApplications') : i18nValue.tx('nav.applications'),
        description: i18nValue.tx('commandPalette.goApplicationsDesc'),
        icon: <List size={15} aria-hidden="true" />,
        shortcut: 'G A',
        keywords: ['applications', 'workspace', 'board', 'list'],
        onRun: navigate(() => {
          if (isTeamMode) {
            setTeamSection('applications')
            setViewModeDirection('to-list')
            setViewMode('list')
            setMobileDetailOpen(false)
            setScreen('workspace')
          } else {
            openWorkspaceBoard()
          }
        }),
      },
      {
        id: 'go-profile',
        label: i18nValue.tx('nav.profile'),
        description: i18nValue.tx('commandPalette.goProfileDesc'),
        icon: <UserRound size={15} aria-hidden="true" />,
        shortcut: 'G P',
        keywords: ['profile', 'snippets', 'assets'],
        onRun: navigate(() => {
          if (isTeamMode) {
            void switchWorkspaceMode('personal', { screen: 'profile' })
          } else {
            setScreen('profile')
          }
        }),
      },
      {
        id: 'go-settings',
        label: i18nValue.tx('nav.settings'),
        description: i18nValue.tx('commandPalette.goSettingsDesc'),
        icon: <SlidersHorizontal size={15} aria-hidden="true" />,
        shortcut: 'G S',
        keywords: ['settings', 'preferences', 'export', 'backup'],
        onRun: navigate(() => setScreen('settings')),
      },
      {
        id: 'go-team',
        label: i18nValue.tx('nav.team'),
        description: i18nValue.tx('commandPalette.goTeamDesc'),
        icon: <Users size={15} aria-hidden="true" />,
        shortcut: 'G T',
        disabled: PUBLIC_EDITION,
        keywords: ['team', 'members', 'resources', 'audit'],
        onRun: navigate(() => {
          void switchWorkspaceMode('team', { screen: 'team', teamSection: 'overview' })
        }),
      },
      {
        id: 'new-application',
        label: i18nValue.tx('workspace.new'),
        description: i18nValue.tx('commandPalette.newApplicationDesc'),
        icon: <Plus size={15} aria-hidden="true" />,
        shortcut: `${modLabel} N`,
        disabled: isTeamMode,
        keywords: ['new', 'create', 'application'],
        onRun: () => openNewApplicationDialog(null),
      },
      {
        id: 'show-board',
        label: i18nValue.tx('kanban.board'),
        description: i18nValue.tx('commandPalette.showBoardDesc'),
        icon: <LayoutGrid size={15} aria-hidden="true" />,
        disabled: !canUseWorkspaceBoard || screen !== 'workspace' || viewMode === 'kanban',
        keywords: ['board', 'kanban'],
        onRun: () => runWithNavigationGuard(openWorkspaceBoard),
      },
      {
        id: 'show-list',
        label: i18nValue.tx('kanban.list'),
        description: i18nValue.tx('commandPalette.showListDesc'),
        icon: <List size={15} aria-hidden="true" />,
        disabled: screen !== 'workspace' || viewMode === 'list',
        keywords: ['list', 'applications'],
        onRun: () => changeViewMode('list'),
      },
      {
        id: 'toggle-applications-pane',
        label: i18nValue.tx('shortcuts.toggleApplicationPane'),
        description: i18nValue.tx('commandPalette.toggleApplicationsDesc'),
        icon: <PanelLeftOpen size={15} aria-hidden="true" />,
        shortcut: `${modLabel} B`,
        disabled: screen !== 'workspace',
        keywords: ['pane', 'sidebar', 'applications'],
        onRun: () => setWorkspaceLayout((current) => ({ ...current, applicationsHidden: !current.applicationsHidden })),
      },
      {
        id: 'toggle-inspector-pane',
        label: i18nValue.tx('shortcuts.toggleInspectorPane'),
        description: i18nValue.tx('commandPalette.toggleInspectorDesc'),
        icon: <PanelRightOpen size={15} aria-hidden="true" />,
        shortcut: `${modLabel} I`,
        disabled: screen !== 'workspace',
        keywords: ['inspector', 'sidebar'],
        onRun: () => setWorkspaceLayout((current) => ({ ...current, inspectorHidden: !current.inspectorHidden })),
      },
      {
        id: 'toggle-theme',
        label: i18nValue.tx('commandPalette.toggleTheme'),
        description: i18nValue.tx('commandPalette.toggleThemeDesc'),
        icon: <SunMoon size={15} aria-hidden="true" />,
        keywords: ['theme', 'dark', 'light'],
        onRun: themeProvider.toggleTheme,
      },
      {
        id: 'notifications',
        label: i18nValue.tx('notifications.title'),
        description: i18nValue.tx('commandPalette.notificationsDesc'),
        icon: <Bell size={15} aria-hidden="true" />,
        keywords: ['notifications', 'alerts'],
        onRun: openNotificationCenter,
      },
      {
        id: 'shortcuts',
        label: i18nValue.tx('shortcuts.title'),
        description: i18nValue.tx('commandPalette.shortcutsDesc'),
        icon: <Keyboard size={15} aria-hidden="true" />,
        shortcut: '?',
        keywords: ['keyboard', 'shortcuts', 'help'],
        onRun: () => {
          void loadKeyboardShortcuts().catch(() => undefined)
          setShortcutsOpen(true)
        },
      },
      {
        id: 'tour',
        label: i18nValue.tx('commandPalette.replayTour'),
        description: i18nValue.tx('commandPalette.replayTourDesc'),
        icon: <HelpCircle size={15} aria-hidden="true" />,
        keywords: ['tour', 'tutorial', 'guide'],
        onRun: startOnboardingTour,
      },
    ]
  })()

  const activeDraft = selected && draft?.id === selected.id ? draft : null
  // Keep the outgoing dossier mounted while the next record's isolated draft is
  // cloned in idle time. Replacing the whole center pane with a skeleton made a
  // simple list-row click feel like a page refresh even though the source data is
  // already local. The handoff wrapper disables the outgoing record until the
  // target draft is ready, so no stale content can be edited or acted upon.
  const displayedDossierDraft = activeDraft ?? (selected ? draft : null)
  const displayedDossierApplication = displayedDossierDraft
    ? workspaceApplications.find((application) => application.id === displayedDossierDraft.id)
      ?? displayedDossierDraft
    : null
  const dossierHandoffPending = Boolean(selected && !activeDraft && displayedDossierDraft)
  // Ordinary rail and tab changes paint their full destination immediately.
  // On phones, board/dashboard drill-downs paint the dossier shell first and
  // reveal dense rows concurrently so a large checklist cannot block the tap.
  const deferScreenProgressiveReveal = false
  const deferDossierHeavyContent = compactWorkspaceViewport && dossierContentDeferred

  // Main content based on screen
  const mainContent =
    screen === 'discover' && (!canUseDiscover || (isTeamMode && !teamDiscoverScope)) ? (
      <DeferredPanel variant="dashboard" />
    ) : screen === 'dashboard' ? (
      <Dashboard
        applications={workspaceApplications}
        recentOpenedIds={isTeamMode ? [] : recentOpenedIds}
        onSelect={(id, target) => {
          runWithNavigationGuard(() => openDashboardApplication(id, target))
        }}
        onOpenInNewPage={isTeamMode ? undefined : (id) => openApplicationsInTabs([id])}
        onExportApplication={isTeamMode ? undefined : (id) => exportSelectedApplications([id])}
        onCopy={copyValue}
        onToggleTask={isTeamMode ? undefined : async (applicationId, taskId, done) => {
          const beforeToggle = applications.find((application) => application.id === applicationId)
          if (!beforeToggle) return
          if (connectivityUnavailable()) {
            await saveApplication({
              ...beforeToggle,
              tasks: beforeToggle.tasks.map((task) => task.id === taskId ? { ...task, done } : task),
            }, i18nValue.tx('toast.taskUpdated'))
            return
          }
          const requestKey = `${applicationId}:${taskId}`
          const requestId = (taskToggleRequestRef.current.get(requestKey) ?? 0) + 1
          taskToggleRequestRef.current.set(requestKey, requestId)
          updateApplicationInState(applicationId, (application) => ({
            ...application,
            tasks: application.tasks.map((task) => task.id === taskId ? { ...task, done } : task),
          }))
          try {
            const task = await phdApi.patchTask(activeSession.token, applicationId, taskId, { done })
            if (taskToggleRequestRef.current.get(requestKey) !== requestId) return
            updateApplicationInState(applicationId, (application) => ({
              ...application,
              tasks: application.tasks.map((item) => item.id === task.id ? task : item),
            }))
          } catch (error) {
            if (taskToggleRequestRef.current.get(requestKey) === requestId) replaceApplication(beforeToggle)
            throw error
          } finally {
            if (taskToggleRequestRef.current.get(requestKey) === requestId) {
              taskToggleRequestRef.current.delete(requestKey)
            }
          }
        }}
        onPatchMaterialStatus={isTeamMode ? undefined : async (applicationId, materialId, status) => {
          const before = applications.find((application) => application.id === applicationId)
          if (!before) return
          const nextApplication = {
            ...before,
            materials: before.materials.map((material) => (
              material.id === materialId
                ? {
                    ...material,
                    status,
                    updatedAt: material.updatedAt || new Date().toISOString().slice(0, 10),
                  }
                : material
            )),
          }
          if (connectivityUnavailable()) {
            await saveApplication(nextApplication, i18nValue.tx('toast.materialUpdated', i18nValue.tx('toast.appSaved')))
            return
          }
          updateApplicationInState(applicationId, () => nextApplication)
          try {
            const saved = await phdApi.updateApplication(activeSession.token, nextApplication, before)
            replaceApplication(saved)
          } catch (error) {
            replaceApplication(before)
            throw error
          }
        }}
        onToggleScholarshipTask={isTeamMode ? undefined : async (
          applicationId,
          scholarshipId,
          taskId,
          done,
        ) => {
          const before = applications.find((application) => application.id === applicationId)
          if (!before) return
          const nextApplication = {
            ...before,
            scholarships: before.scholarships.map((scholarship) => (
              scholarship.id === scholarshipId
                ? {
                    ...scholarship,
                    tasks: (scholarship.tasks ?? []).map((task) => (
                      task.id === taskId ? { ...task, done } : task
                    )),
                  }
                : scholarship
            )),
          }
          if (connectivityUnavailable()) {
            await saveApplication(nextApplication, i18nValue.tx('toast.taskUpdated'))
            return
          }
          updateApplicationInState(applicationId, () => nextApplication)
          try {
            const saved = await phdApi.updateApplication(activeSession.token, nextApplication, before)
            replaceApplication(saved)
          } catch (error) {
            replaceApplication(before)
            throw error
          }
        }}
        onPatchScholarshipMaterialStatus={isTeamMode ? undefined : async (
          applicationId,
          scholarshipId,
          materialId,
          status,
        ) => {
          const before = applications.find((application) => application.id === applicationId)
          if (!before) return
          const nextApplication = {
            ...before,
            scholarships: before.scholarships.map((scholarship) => (
              scholarship.id === scholarshipId
                ? {
                    ...scholarship,
                    materials: (scholarship.materials ?? []).map((material) => (
                      material.id === materialId ? { ...material, status } : material
                    )),
                  }
                : scholarship
            )),
          }
          if (connectivityUnavailable()) {
            await saveApplication(nextApplication, i18nValue.tx('toast.materialUpdated', i18nValue.tx('toast.appSaved')))
            return
          }
          updateApplicationInState(applicationId, () => nextApplication)
          try {
            const saved = await phdApi.updateApplication(activeSession.token, nextApplication, before)
            replaceApplication(saved)
          } catch (error) {
            replaceApplication(before)
            throw error
          }
        }}
        onNew={() => openNewApplicationDialog(null)}
        guidanceTeam={!isTeamMode ? studentGuidanceTeam : undefined}
        ownerNames={isTeamMode ? teamApplicationOwnerNames : undefined}
        eyebrow={isTeamMode ? i18nValue.tx('dashboard.teamEyebrow') : undefined}
        title={isTeamMode ? i18nValue.tx('dashboard.teamTitle') : undefined}
        subtitle={isTeamMode ? i18nValue.tx('dashboard.teamSubtitle') : undefined}
        ownerDirectory={isTeamMode ? ownerDirectory : undefined}
        ownerAvatars={isTeamMode ? ownerAvatarDirectory : undefined}
        onViewMember={isTeamMode ? viewMemberApplications : undefined}
        onOpenDiscover={
          isTeamMode || !canUsePersonalDiscover
            ? undefined
            : () => {
                startTransition(() => setScreen('discover'))
                setMobileDetailOpen(false)
              }
        }
        deferProgressiveReveal={deferScreenProgressiveReveal}
      />
    ) : screen === 'discover' && activeSession && canUseDiscover && (!isTeamMode || teamDiscoverScope) ? (
      <DiscoverScreen
        token={activeSession.token}
        applications={teamDiscoverScope
          ? teamApplications.filter((application) => application.ownerId === teamDiscoverScope.targetUserId)
          : applications}
        teamScope={teamDiscoverScope}
        teamTargetOptions={teamCreateStudentOptions}
        onTeamTargetChange={teamDiscoverScope ? setTeamDiscoverTargetUserId : undefined}
        onExitTeamTarget={teamDiscoverScope ? () => {
          setTeamDiscoverTargetUserId(null)
          setTeamSection('discover')
          startTransition(() => setScreen('team'))
          setMobileDetailOpen(false)
        } : undefined}
        onConfigureAiKeys={() => {
          startTransition(() => {
            if (teamDiscoverScope && teamViewerRole === 'owner') {
              setTeamSection('settings')
              setScreen('team')
            } else {
              setInterfaceMode('personal')
              setScreen('settings')
            }
          })
        }}
        deferProgressiveReveal={deferScreenProgressiveReveal}
        realtimeConnected={realtimeUpdates.connected}
        realtimeRevision={discoverRealtimeRevision}
        onNotify={(message, tone) => notify(message, tone ?? 'success')}
        onImported={(created) => {
          setApplications((items) => [created, ...items.filter((item) => item.id !== created.id)])
          setDraftState(cloneApplication(created), { clean: true })
          setSelectedId(created.id)
          setViewModeDirection('to-list')
          setViewMode('list')
          setScreen('workspace')
          setMobileDetailOpen(true)
          setTab('dossier')
        }}
      />
    ) : screen === 'profile' ? (
      <ProfileScreen
        assets={profileAssets}
        session={activeSession}
        deferProgressiveReveal={deferScreenProgressiveReveal}
        removingAssetIds={removingProfileAssetIds}
        onUpdateSettings={(patch, message) => updateUserSettings(patch, message)}
        onCreateSnippet={(input: ProfileAssetInput, files: File[]) =>
          void run(async () => {
            const created = await phdApi.addProfileAsset(activeSession.token, {
              ...input,
              // Files fulfill the reservation immediately.
              uploadReserved: files.length > 0 ? false : Boolean(input.uploadReserved),
            })
            const asset = files.length > 0
              ? await phdApi.uploadProfileAssetFiles(activeSession.token, created.id, files)
              : created
            setProfileAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)])
          }, i18nValue.tx('toast.profileAssetAdded'))
        }
        onUpdateAsset={(id, input) =>
          void run(async () => {
            const asset = await phdApi.updateProfileAsset(activeSession.token, id, input)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          }, i18nValue.tx('toast.profileAssetUpdated'))
        }
        onDeleteAsset={(asset) =>
          setConfirmDialog({
            title: i18nValue.tx('profile.deleteAsset', 'Delete snippet'),
            message: tpl(i18nValue.tx('confirmDeleteProfileAsset'), { name: asset.name }),
            confirmLabel: i18nValue.tx('dossier.delete'),
            variant: 'danger',
            onConfirm: () => {
              setConfirmDialog(null)
              setRemovingProfileAssetIds((current) => new Set(current).add(asset.id))
              void (async () => {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, getMotionDelay(380))
                })
                await run(async () => {
                  await phdApi.deleteProfileAsset(activeSession.token, asset.id)
                  setProfileAssets((items) => items.filter((item) => item.id !== asset.id))
                }, i18nValue.tx('toast.profileAssetDeleted'))
              })().finally(() => {
                setRemovingProfileAssetIds((current) => {
                  const next = new Set(current)
                  next.delete(asset.id)
                  return next
                })
              })
            },
          })
        }
        onUploadFiles={(assetId, files) =>
          run(async () => {
            const asset = await phdApi.uploadProfileAssetFiles(activeSession.token, assetId, files)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          })
        }
        onRenameFile={(assetId, fileId, fileName) =>
          void run(async () => {
            const asset = await phdApi.renameProfileAssetFile(activeSession.token, assetId, fileId, fileName)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          })
        }
        onDeleteFile={(assetId, fileId) =>
          void run(async () => {
            const asset = await phdApi.deleteProfileAssetFile(activeSession.token, assetId, fileId)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          })
        }
        onDownloadFile={(fileId, fileName) =>
          void run(async () => {
            const blob = await phdApi.downloadFile(activeSession.token, fileId)
            downloadBlob(blob, fileName)
          })
        }
        onLoadFile={(fileId) => phdApi.downloadFile(activeSession.token, fileId)}
        onCreateShare={(assetId, expiry, note) =>
          void run(async () => {
            const share = await phdApi.shareProfileAsset(activeSession.token, assetId, expiresAtForShare(expiry), note)
            setProfileAssets((items) => items.map((item) =>
              item.id === assetId ? { ...item, shares: [...(item.shares ?? []), share] } : item,
            ))
            await refreshSessionMetadata(activeSession)
          })
        }
        onRevokeShare={(assetId, shareId) =>
          void run(async () => {
            await phdApi.revokeProfileAssetShare(activeSession.token, assetId, shareId)
            setProfileAssets((items) => items.map((item) =>
              item.id === assetId ? { ...item, shares: (item.shares ?? []).filter((share) => share.id !== shareId) } : item,
            ))
            await refreshSessionMetadata(activeSession)
          })
        }
        onCopy={copyValue}
      />
    ) : screen === 'settings' ? (
      <SettingsScreen
        session={activeSession}
        installStatus={pwaInstall.status}
        webPushStatus={webPushNotifications.status}
        deferProgressiveReveal={deferScreenProgressiveReveal}
        onInstallApp={pwaInstall.install}
        onEnableWebPush={async () => {
          const result = await webPushNotifications.enable()
          if (result !== 'granted') return result
          const requestSession = activeSession
          const requestEpoch = sessionIdentityEpochRef.current
          try {
            const user = await phdApi.updateSettings(requestSession.token, { browserNotificationsEnabled: true })
            commitSettingsUser(requestSession, user, { browserNotificationsEnabled: true }, requestEpoch)
            return result
          } catch (error) {
            // A live subscription must never outlast a failed opt-in save: the
            // server-side preference is the authoritative delivery boundary.
            await webPushNotifications.disable()
            throw error
          }
        }}
        onDisableWebPush={async () => {
          // The hook first tells the service worker to discard queued events,
          // then removes the endpoint. Persist the account-wide server gate so
          // a stale endpoint on another browser cannot continue delivery.
          await webPushNotifications.disable()
          const requestSession = activeSession
          const requestEpoch = sessionIdentityEpochRef.current
          const user = await phdApi.updateSettings(requestSession.token, { browserNotificationsEnabled: false })
          commitSettingsUser(requestSession, user, { browserNotificationsEnabled: false }, requestEpoch)
          return true
        }}
        onTestWebPush={() => webPushNotifications.test()}
        onLanguage={(nextLang) => {
          void (async () => {
            const resolved = resolveLanguage(nextLang)
            persistLanguagePreference(resolved)
            setAuthLanguage(resolved)
            await preloadLanguage(resolved, i18nNamespaces)
            updateUserSetting('language', resolved, t(resolved, 'toast.languageUpdated'))
          })()
        }}
        onHighContrast={(checked) =>
          updateUserSetting('highContrast', checked, i18nValue.tx('toast.displaySettingUpdated'))
        }
        theme={themeProvider.theme}
        onToggleTheme={themeProvider.toggleTheme}
        onOpenNotifications={openNotificationCenter}
        onLogout={() => runWithNavigationGuard(logout)}
        onAccentColor={(color) => {
          const accent = normalizeThemeAccent(color)
          applyThemePreset(accent, { animate: true })
          try {
            safeSetItem('phd-atlas-accent', accent)
          } catch {
            // Storage can be unavailable in private browsing modes.
          }
          updateUserSetting('themeAccent', accent, i18nValue.tx('toast.accentUpdated'))
        }}
        onAvatarSave={saveUserAvatar}
        onUpdateSetting={(key, value) => updateUserSetting(key, value)}
        onUpdateSettings={(patch, message) => updateUserSettings(patch, message)}
        aiKeys={aiKeys}
        onCreateAiKey={addAiKey}
        onUpdateAiKey={editAiKey}
        onDeleteAiKey={removeAiKey}
        onTestAiKey={testAiKey}
        onResetAiKeyUsage={resetAiKeyUsage}
        onNotify={notify}
        passkeys={passkeys}
        removingPasskeyIds={removingPasskeyIds}
        passkeyAvailable={passkeyAvailable}
        onCreatePasskey={createPasskey}
        onRenamePasskey={renamePasskey}
        onDeletePasskey={deletePasskey}
        onTestEmail={(patch, delivery, source = 'personal') =>
          runInteractive(async () => {
            const requestSession = activeSession
            let nextSession = requestSession
            if (patch && Object.keys(patch).length > 0) {
              const user = await phdApi.updateSettings(requestSession.token, patch)
              const committedSession = commitSettingsUser(requestSession, user, patch)
              if (!committedSession) return
              nextSession = committedSession
            }
            await phdApi.sendTestEmail(nextSession.token, {
              ...(delivery ? { delivery } : {}),
              source,
            })
          }, i18nValue.tx('toast.testEmailQueued'))
        }
        onSendReceiveEmailVerification={(email) =>
          runInteractive(async () => {
            const requestSession = activeSession
            const result = await phdApi.sendReceiveEmailVerification(requestSession.token, email)
            commitSettingsUser(requestSession, result.user, {
              receiveEmails: result.user.settings.receiveEmails,
            })
            return result.verificationSentAt
          }, i18nValue.tx('toast.verificationEmailSent'))
        }
        onTestIncomingMail={(patch) =>
          run(async () => {
            const requestSession = activeSession
            let nextSession = requestSession
            if (patch && Object.keys(patch).length > 0) {
              const user = await phdApi.updateSettings(requestSession.token, patch)
              const committedSession = commitSettingsUser(requestSession, user, patch)
              if (!committedSession) return
              nextSession = committedSession
            }
            await phdApi.testIncomingMail(nextSession.token)
          }, i18nValue.tx('toast.incomingMailTestPassed'))
        }
        onFetchMailNow={(patch) => syncMailbox('incremental', patch)}
        onSyncMailHistory={(patch) => syncMailbox('history', patch)}
        onExport={(format) =>
          void run(async () => {
            const blob = await phdApi.downloadExport(activeSession.token, format, undefined, lang)
            downloadBlob(blob, `phd-applications-all.${format === 'excel' ? 'xls' : format}`)
          }, tpl(i18nValue.tx('toast.exported'), { format: format.toUpperCase() }))
        }
        onDeleteAccount={() =>
          setConfirmDialog({
            title: i18nValue.tx('settings.deleteAccount'),
            message: i18nValue.tx('confirmDeleteAccount'),
            confirmLabel: i18nValue.tx('settings.deleteAccount'),
            variant: 'danger',
            onConfirm: () => {
              setConfirmDialog(null)
              void run(async () => {
                await phdApi.deleteAccount(activeSession.token)
                logout()
              }, i18nValue.tx('toast.accountDeleted'))
            },
          })
        }
        allShares={allShares}
        onRevokeShare={(applicationId, shareId) =>
          void run(async () => {
            await phdApi.revokeShare(activeSession.token, applicationId, shareId)
            updateApplicationInState(applicationId, (application) => ({
              ...application,
              shares: (application.shares ?? []).filter((share) => share.id !== shareId),
            }))
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.shareRevoked'))
        }
        onUpdateShare={(applicationId, shareId, expiresAt, permission, sections) =>
          void run(async () => {
            const share = await phdApi.updateShare(activeSession.token, applicationId, shareId, expiresAt, permission, sections)
            updateApplicationInState(applicationId, (application) => ({
              ...application,
              shares: (application.shares ?? []).map((item) =>
                item.id === share.id
                  ? {
                      id: share.id,
                      token: share.token,
                      createdAt: share.createdAt,
                      expiresAt: share.expiresAt,
                      permission: share.permission,
                      sections: share.sections,
                    }
                  : item,
              ),
            }))
          }, i18nValue.tx('toast.shareUpdated'))
        }
        onRevokeAssetShare={(assetId, shareId) =>
          void run(async () => {
            await phdApi.revokeProfileAssetShare(activeSession.token, assetId, shareId)
            setProfileAssets((items) => items.map((asset) =>
              asset.id === assetId
                ? { ...asset, shares: (asset.shares ?? []).filter((share) => share.id !== shareId) }
                : asset,
            ))
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.shareRevoked'))
        }
        onUpdateAssetShare={(assetId, shareId, expiresAt) =>
          void run(async () => {
            const share = await phdApi.updateProfileAssetShare(activeSession.token, assetId, shareId, expiresAt)
            setProfileAssets((items) => items.map((asset) =>
              asset.id === assetId
                ? {
                    ...asset,
                    shares: (asset.shares ?? []).map((item) => item.id === share.id ? share : item),
                  }
                : asset,
            ))
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.shareUpdated'))
        }
        onReplayTutorial={handleReplayTutorial}
      />
    ) : screen === 'team' && !PUBLIC_EDITION ? (
      <TeamScreen
        session={activeSession}
        aiKeys={aiKeys}
        onCreateAiKey={addAiKey}
        onUpdateAiKey={editAiKey}
        onDeleteAiKey={removeAiKey}
        onTestAiKey={testAiKey}
        onResetAiKeyUsage={resetAiKeyUsage}
        onNotify={notify}
        initialSummary={visibleTeamSummary}
        onChanged={() => refreshTeamWorkspace(activeSession)}
        teamWorkspaces={teamWorkspaces}
        activeTeamId={activeTeamId}
        onSwitchTeam={switchActiveTeam}
        applicationCounts={applicationCountsByOwner}
        applications={teamApplications}
        activeSection={teamSection}
        hideTabs
        onSectionChange={(section) => {
          // Applications is a routed workspace surface, so it must still hand off
          // from a team tab. Other already-active team tabs need no transition.
          if (section === teamSection && section !== 'applications') return
          // Route through the same animated path as the rail team section control.
          // (In-team swaps animate inside TeamScreen; applications uses rail handoff.)
          if (section === 'applications') {
            const destinationViewMode = teamViewerRole === 'member' ? 'list' as const : 'kanban' as const
            const direction = validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection)
              ? 'forward'
              : 'backward'
            runWithNavigationGuard(() => {
              runAnimatedRailScreenUpdate(() => {
                setTeamSection('applications')
                if (destinationViewMode === 'kanban') {
                  commitWorkspaceBoardOpen({ synchronous: true })
                } else {
                  setViewModeDirection('to-list')
                  setViewMode('list')
                  setSelectedId((current) => current ?? defaultSelectedIdForMode('team'))
                  setMobileDetailOpen(false)
                  setScreen('workspace')
                }
              }, {
                direction,
                ready: warmCriticalScreenAssets('workspace', tab, lang, destinationViewMode),
                readinessGate: readinessGateForScreen('workspace', destinationViewMode),
              })
            })
            return
          }
          // Stay on the team surface — TeamScreen owns the directional section motion.
          runWithNavigationGuard(() => {
            startTransition(() => {
              setTeamSection(section)
            })
          })
        }}
        onViewApplications={viewMemberApplications}
        onOpenApplication={(applicationId) => {
          setInterfaceMode('team')
          setTeamSection('applications')
          changeViewMode('list')
          selectApplication(applicationId)
        }}
        onOpenApplicationInNewPage={(applicationId) => openApplicationsInTabs([applicationId])}
        onImpersonateMember={enterTemporaryUserView}
        onCreateApplication={(ownerId) => {
          setInterfaceMode('team')
          setTeamSection('applications')
          openNewApplicationDialog(ownerId ?? null)
        }}
        onSwitchToPersonal={openPersonalWorkspaceForTeamTransfer}
        onCopy={copyValue}
        onOpenTeamDiscover={(studentUserId) => {
          if (!canUseTeamDiscover) return
          setTeamDiscoverTargetUserId(studentUserId)
          setInterfaceMode('team')
          startTransition(() => setScreen('discover'))
          setMobileDetailOpen(false)
        }}
      />
    ) : screen === 'team' ? (
      <DeferredPanel variant="team" />
    ) : screen === 'workspace' && viewMode === 'list' && compactWorkspaceViewport && !mobileDetailOpen ? (
      <DeferredPanel />
    ) : screen === 'workspace' && viewMode === 'kanban' && canUseWorkspaceBoard ? (
      <KanbanBoard
        applications={visibleApplications}
        onNew={isTeamMode ? undefined : () => openNewApplicationDialog(null)}
        teamStudents={isTeamMode ? teamBoardStudents : undefined}
        onNewForStudent={isTeamMode ? (studentId) => openNewApplicationDialog(studentId) : undefined}
        onPrefetch={prefetchDossierAssets}
        onStatusChange={(id, status) => {
          const app = workspaceApplications.find((application) => application.id === id)
          if (!app || app.status === status) return
          void saveApplication({ ...app, status }, i18nValue.tx('toast.statusUpdated', 'Status updated'))
        }}
        onSelect={(id) => {
          selectApplication(id)
        }}
        onOpenInNewPage={(id) => openApplicationsInTabs([id])}
        onExportApplication={isTeamMode ? undefined : (id) => exportSelectedApplications([id])}
        onCopy={copyValue}
        onDeleteApplication={isTeamMode ? undefined : (id) => confirmDeleteApplications([id])}
      />
    ) : selected && !displayedDossierDraft ? (
      <DeferredPanel />
    ) : selected && displayedDossierDraft && displayedDossierApplication ? (
      <div
        className={`dossier-handoff${dossierHandoffPending ? ' is-pending' : ''}`}
        aria-busy={dossierHandoffPending || undefined}
      >
        <div className="dossier-handoff-content" inert={dossierHandoffPending || undefined}>
        <DossierView
        key={displayedDossierApplication.id}
        application={displayedDossierApplication}
        draft={displayedDossierDraft}
        tab={tab}
        saving={saving}
        isDirty={isDraftDirty}
        profileAssets={profileAssets}
        deferHeavyContent={deferDossierHeavyContent}
        aiKeys={aiKeys}
        onAiDraft={async (input, onEvent, signal) => {
          await phdApi.streamAiDraft(activeSession.token, input, onEvent, signal)
          phdApi.listAiKeys(activeSession.token).then(setAiKeys).catch(() => undefined)
        }}
        onAiInspectorOpenChange={handleAiInspectorOpenChange}
        onNotify={notify}
        session={activeSession}
        currentUserApplicationRole={selectedTeamMeta?.currentUserApplicationRole}
        applicationOwnerName={selectedTeamMeta && selectedTeamMeta.ownerId !== activeSession.user.id ? selectedTeamMeta.ownerName : undefined}
        jumpIntent={workspaceJumpIntent}
        onTab={(nextTab, direction) => runAnimatedDossierUpdate(
          () => setTab(nextTab),
          {
            scope: 'dossier-tab',
            direction,
            deferDossierContent: compactWorkspaceViewport && nextTab === 'materials',
          },
        )}
        onRegisterNavigationGuard={registerNavigationGuard}
        onDraft={setDraftState}
        onCopy={copyValue}
        onResolveSchoolLogo={(input, options) => (
          resolveAndStoreSchoolLogo(displayedDossierApplication, input, options)
        )}
        onUploadSchoolLogo={(file) => uploadAndStoreSchoolLogo(displayedDossierApplication, file)}
        onRemoveSchoolLogo={() => removeStoredSchoolLogo(displayedDossierApplication)}
        canToggleTeamVisibility={canToggleSelectedTeamVisibility}
        teamTransferRequiresApproval={!canDirectlyMoveSelectedTeamApplication}
        teamTransferOrganizations={selectedTeamTransferOptions}
        onPreflightTeamTransfer={(visibleToTeam, teamId) => (
          phdApi.preflightApplicationTeamTransfer(activeSession.token, selected.id, { visibleToTeam, teamId })
        )}
        onToggleTeamVisibility={(visibleToTeam, teamId) => {
          if (!selected) return undefined
          return toggleApplicationTeamVisibility(selected.id, visibleToTeam, teamId)
        }}
        onSave={() => {
          const latestDraft = draftRef.current
          return latestDraft ? saveApplication(latestDraft, i18nValue.tx('toast.appSaved')) : undefined
        }}
        onDiscardDraft={discardDraft}
        onDelete={() =>
          setConfirmDialog({
            title: i18nValue.tx('dossier.delete'),
            message: tpl(i18nValue.tx('confirmDeleteApplication'), { name: selected.school.name }),
            confirmLabel: i18nValue.tx('dossier.delete'),
            variant: 'danger',
            onConfirm: () => {
              setConfirmDialog(null)
              const applicationId = selected.id
              setRemovingApplicationIds((current) => new Set(current).add(applicationId))
              void (async () => {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, getMotionDelay(380))
                })
                await run(async () => {
                  await phdApi.deleteApplication(activeSession.token, applicationId)
                  removeApplicationFromState(applicationId)
                  notify(i18nValue.tx('toast.appDeleted'))
                  await refreshTrashAndSessionMetadata(activeSession)
                })
              })().finally(() => {
                setRemovingApplicationIds((current) => {
                  const next = new Set(current)
                  next.delete(applicationId)
                  return next
                })
              })
            },
          })
        }
        onShare={openShareDialog}
        onEnrich={() => {
          if (isDraftDirty) {
            notify(i18nValue.tx('dossier.enrichSaveFirst', 'Save or discard draft changes before enriching this application.'), 'warning')
            return
          }
          void Promise.all([
            preloadLanguage(lang, ['core', 'shared', 'discover']),
            loadDiscoverApplicationEnrichmentDialog(),
          ]).catch(() => undefined)
          setDossierEnrichmentOpen(true)
        }}
        onOpenUpgrade={openUpgradePage}
        onCloseApplication={() => runWithNavigationGuard(closeApplicationDetail)}
        onUpload={(file) =>
          run(async () => {
            const material = await phdApi.addMaterial(activeSession.token, selected.id, {
              name: file?.name ?? i18nValue.tx('dossier.newMaterial'),
              type: file?.type || i18nValue.tx('dossier.file'),
              status: (file ? 'Submitted' : 'Draft') as MaterialStatus,
              group: 'Uploaded files',
              details: file ? i18nValue.tx('dossier.uploadedFileDetails') : '',
              file: file ?? undefined,
            })
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              materials: [...application.materials, material],
              versions: material.versions?.length
                ? [...application.versions, ...material.versions]
                : application.versions,
            }))
          }, file ? i18nValue.tx('toast.materialUploaded') : i18nValue.tx('toast.materialAdded'))
        }
        onDownload={(fileId, name) =>
          void run(async () => {
            if (!fileId) {
              notify(i18nValue.tx('toast.noUploadedFile'), 'info')
              return
            }
            const blob = await phdApi.downloadFile(activeSession.token, fileId)
            downloadBlob(blob, name ?? i18nValue.tx('dossier.file'))
          })
        }
        onPreview={(fileId) => phdApi.downloadFile(activeSession.token, fileId)}
        onUploadMaterialFiles={(materialId, files) =>
          run(async () => {
            const material = await phdApi.uploadMaterialFiles(activeSession.token, selected.id, materialId, files)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              materials: application.materials.map((item) => (item.id === material.id ? material : item)),
              versions: material.versions?.length
                ? [
                    ...application.versions.filter((version) =>
                      !material.versions?.some((candidate) => candidate.id === version.id),
                    ),
                    ...material.versions,
                  ]
                : application.versions,
            }))
          }, i18nValue.tx('toast.materialUploaded'))
        }
        onRemoveMaterialFile={(materialId, fileId) =>
          run(async () => {
            const material = await phdApi.removeMaterialFile(activeSession.token, selected.id, materialId, fileId)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              materials: application.materials.map((item) => (item.id === material.id ? material : item)),
              versions: application.versions.filter((version) => version.fileId !== fileId),
            }))
          }, i18nValue.tx('toast.attachmentRemoved'))
        }
        onRenameMaterialFile={(materialId, fileId, fileName) =>
          run(async () => {
            const material = await phdApi.renameMaterialFile(activeSession.token, selected.id, materialId, fileId, fileName)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              materials: application.materials.map((item) => (item.id === material.id ? material : item)),
            }))
          }, i18nValue.tx('toast.attachmentRenamed', i18nValue.tx('toast.materialUpdated', 'Attachment renamed')))
        }
        onUploadTaskFiles={(taskId, files) =>
          run(async () => {
            const task = await phdApi.uploadTaskFiles(activeSession.token, selected.id, taskId, files)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
              versions: task.versions?.length
                ? [
                    ...application.versions.filter((version) =>
                      !task.versions?.some((candidate) => candidate.id === version.id),
                    ),
                    ...task.versions,
                  ]
                : application.versions,
            }))
          }, i18nValue.tx('toast.taskUpdated'))
        }
        onRemoveTaskFile={(taskId, fileId) =>
          run(async () => {
            const task = await phdApi.removeTaskFile(activeSession.token, selected.id, taskId, fileId)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
              versions: application.versions.filter((version) => version.fileId !== fileId),
            }))
          }, i18nValue.tx('toast.attachmentRemoved'))
        }
        onRenameTaskFile={(taskId, fileId, fileName) =>
          run(async () => {
            const task = await phdApi.renameTaskFile(activeSession.token, selected.id, taskId, fileId, fileName)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
            }))
          }, i18nValue.tx('toast.attachmentRenamed', i18nValue.tx('toast.taskUpdated', 'Attachment renamed')))
        }
        onAddTask={(title, due, options) =>
          connectivityUnavailable()
            ? void saveApplication({
                ...selected,
                tasks: [{
                  id: `task-${Date.now()}`,
                  title,
                  due,
                  done: false,
                  ...options,
                }, ...selected.tasks],
              }, i18nValue.tx('toast.taskAdded'))
            : void run(async () => {
            if (!title.trim()) throw new Error(i18nValue.tx('toast.taskTitleRequired'))
            const task = await phdApi.addTask(activeSession.token, selected.id, { title, due, done: false, ...options })
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              tasks: [task, ...application.tasks],
            }))
          }, i18nValue.tx('toast.taskAdded'))
        }
        onUpdateTask={(taskId, patch) =>
          connectivityUnavailable()
            ? void saveApplication({
                ...selected,
                tasks: selected.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
              }, i18nValue.tx('toast.taskUpdated'))
            : void run(async () => {
            const task = await phdApi.patchTask(activeSession.token, selected.id, taskId, patch)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
            }))
          }, i18nValue.tx('toast.taskUpdated'))
        }
        onToggleTask={(taskId, done) =>
          connectivityUnavailable()
            ? void saveApplication({
                ...selected,
                tasks: selected.tasks.map((task) => task.id === taskId ? { ...task, done } : task),
              }, i18nValue.tx('toast.taskUpdated'))
            : void run(async () => {
            const beforeToggle = selected
            const requestKey = `${selected.id}:${taskId}`
            const requestId = (taskToggleRequestRef.current.get(requestKey) ?? 0) + 1
            taskToggleRequestRef.current.set(requestKey, requestId)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              tasks: application.tasks.map((task) =>
                task.id === taskId ? { ...task, done } : task,
              ),
            }))
            try {
              const task = await phdApi.patchTask(activeSession.token, selected.id, taskId, { done })
              if (taskToggleRequestRef.current.get(requestKey) !== requestId) return
              updateApplicationInState(selected.id, (application) => ({
                ...application,
                tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
              }))
            } catch (error) {
              if (taskToggleRequestRef.current.get(requestKey) === requestId) replaceApplication(beforeToggle)
              throw error
            } finally {
              if (taskToggleRequestRef.current.get(requestKey) === requestId) {
                taskToggleRequestRef.current.delete(requestKey)
              }
            }
          })
        }
        onRemoveTask={(taskId) =>
          void saveApplication(
            { ...selected, tasks: selected.tasks.filter((t) => t.id !== taskId) },
            i18nValue.tx('toast.taskRemoved'),
          )
        }
        onRemoveTasks={(taskIds) =>
          void saveApplication(
            { ...selected, tasks: selected.tasks.filter((task) => !taskIds.includes(task.id)) },
            i18nValue.tx('toast.taskRemoved'),
          )
        }
        onAddCommunication={(input: CommunicationInput) => {
          const offlineCommunication = createOfflineCommunication(input)
          if (connectivityUnavailable() && offlineCommunication) {
            return saveApplication({
              ...selected,
              communications: [offlineCommunication, ...selected.communications],
            }, i18nValue.tx('toast.commAdded'))
          }
          return run(async () => {
            if (!input.subject.trim() || !input.summary.trim()) throw new Error(i18nValue.tx('toast.subjectSummaryRequired'))
            const communication = await phdApi.addCommunication(activeSession.token, selected.id, input)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              communications: [communication, ...application.communications],
            }))
          }, i18nValue.tx('toast.commAdded'))
        }}
        onUpdateCommunication={(id, input) =>
          run(async () => {
            if (input.subject !== undefined && !input.subject.trim()) throw new Error(i18nValue.tx('toast.subjectSummaryRequired'))
            if (input.summary !== undefined && !input.summary.trim()) throw new Error(i18nValue.tx('toast.subjectSummaryRequired'))
            const communication = await phdApi.updateCommunication(activeSession.token, selected.id, id, input)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              communications: application.communications.map((item) => (item.id === communication.id ? communication : item)),
            }))
          }, i18nValue.tx('toast.commUpdated'))
        }
        onSendCommunication={async (input) => {
          setBusy(true)
          try {
            const result = await phdApi.sendCommunication(activeSession.token, selected.id, input)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              communications: [result.communication, ...application.communications],
            }))
            notify(
              result.delivery.sent
                ? i18nValue.tx('toast.commSent')
                : i18nValue.tx('toast.commQueued'),
              result.delivery.sent ? 'success' : 'info',
            )
            return true
          } catch (error) {
            if (!isAuthExpired(error)) {
              notify(normalizeError(error, languageRef.current), 'error')
            }
            return false
          } finally {
            setBusy(false)
          }
        }}
        onRemoveCommunication={(id) =>
          void saveApplication(
            { ...selected, communications: selected.communications.filter((c) => c.id !== id) },
            i18nValue.tx('toast.commRemoved'),
          )
        }
        onRemoveCommunications={(ids) =>
          void saveApplication(
            { ...selected, communications: selected.communications.filter((item) => !ids.includes(item.id)) },
            i18nValue.tx('toast.commRemoved'),
          )
        }
        onAddScholarship={(input) =>
          connectivityUnavailable()
            ? void saveApplication({
                ...selected,
                scholarships: [...selected.scholarships, { id: `sch-${Date.now()}`, ...input }],
              }, i18nValue.tx('toast.scholarshipAdded'))
            : void run(async () => {
            if (!input.name.trim()) throw new Error(i18nValue.tx('toast.scholarshipRequired'))
            const scholarship = await phdApi.addScholarship(activeSession.token, selected.id, input)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              scholarships: [...application.scholarships, scholarship],
            }))
          }, i18nValue.tx('toast.scholarshipAdded'))
        }
        onUpdateScholarship={(id, input) =>
          saveApplication(
            {
              ...selected,
              scholarships: selected.scholarships.map((scholarship) =>
                scholarship.id === id ? { id, ...input } : scholarship,
              ),
            },
            i18nValue.tx('toast.scholarshipUpdated'),
          )
        }
        onRemoveScholarship={(id) =>
          void saveApplication(
            { ...selected, scholarships: selected.scholarships.filter((s) => s.id !== id) },
            i18nValue.tx('toast.scholarshipRemoved'),
          )
        }
        onRemoveScholarships={(ids) =>
          void saveApplication(
            { ...selected, scholarships: selected.scholarships.filter((item) => !ids.includes(item.id)) },
            i18nValue.tx('toast.scholarshipRemoved'),
          )
        }
        onAddFee={(input) =>
          connectivityUnavailable()
            ? void saveApplication({
                ...selected,
                fees: [...(selected.fees ?? []), {
                  id: `fee-${Date.now()}`,
                  ...input,
                  paidDate: input.paidDate ?? null,
                  createdAt: new Date().toISOString(),
                }],
              }, i18nValue.tx('toast.feeAdded'))
            : void run(async () => {
            const fee = await phdApi.addFee(activeSession.token, selected.id, input)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              fees: [...(application.fees ?? []), fee],
            }))
          }, i18nValue.tx('toast.feeAdded'))
        }
        onUpdateFee={(feeId, patch) =>
          connectivityUnavailable()
            ? void saveApplication({
                ...selected,
                fees: (selected.fees ?? []).map((fee) => fee.id === feeId ? { ...fee, ...patch } : fee),
              }, i18nValue.tx('toast.feeUpdated'))
            : void run(async () => {
            await phdApi.updateFee(activeSession.token, selected.id, feeId, patch)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              fees: (application.fees ?? []).map((f) => f.id === feeId ? { ...f, ...patch } : f),
            }))
          }, i18nValue.tx('toast.feeUpdated'))
        }
        onDeleteFee={(feeId) =>
          connectivityUnavailable()
            ? saveApplication({
                ...selected,
                fees: (selected.fees ?? []).filter((fee) => fee.id !== feeId),
              }, i18nValue.tx('toast.feeRemoved'))
            : runInteractive(async () => {
            await phdApi.deleteFee(activeSession.token, selected.id, feeId)
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              fees: (application.fees ?? []).filter((f) => f.id !== feeId),
            }))
          }, i18nValue.tx('toast.feeRemoved'))
        }
        onAddTimelineEvent={(title, date, note) =>
          void run(async () => {
            if (!title.trim()) throw new Error(i18nValue.tx('toast.eventTitleRequired'))
            await saveApplication(
              {
                ...selected,
                timeline: [
                  ...selected.timeline,
                  { id: `tl-${Date.now()}`, title, date, note },
                ],
              },
              i18nValue.tx('toast.timelineAdded'),
            )
          })
        }
        onUpdateTimelineEvent={(id, title, date, note) =>
          void run(async () => {
            if (!title.trim()) throw new Error(i18nValue.tx('toast.eventTitleRequired'))
            await saveApplication(
              {
                ...selected,
                timeline: selected.timeline.map((e) =>
                  e.id === id ? { ...e, title, date, note } : e,
                ),
              },
              i18nValue.tx('toast.timelineUpdated'),
            )
          })
        }
        onRemoveTimelineEvent={(id) =>
          void saveApplication(
            { ...selected, timeline: selected.timeline.filter((e) => e.id !== id) },
            i18nValue.tx('toast.timelineRemoved'),
          )
        }
        onRemoveTimelineEvents={(ids) =>
          void saveApplication(
            { ...selected, timeline: selected.timeline.filter((event) => !ids.includes(event.id)) },
            i18nValue.tx('toast.timelineRemoved'),
          )
        }
        onAddReviewComment={isTeamMode ? (body, targetTab, parentId, mentionedUserIds) =>
          runInteractive(async () => {
            const comment = await phdApi.addReviewComment(
              activeSession.token,
              selected.id,
              body,
              targetTab,
              parentId,
              mentionedUserIds,
            )
            updateApplicationInState(selected.id, (application) => ({
              ...application,
              reviewComments: appendReviewComment(application.reviewComments, comment, parentId),
            }))
          }, i18nValue.tx('toast.reviewCommentAdded'))
          : undefined}
        />
        </div>
        {dossierHandoffPending ? (
          <div className="dossier-handoff-indicator" role="status" aria-live="polite">
            <LoaderCircle size={14} aria-hidden="true" />
            <span>{tpl(i18nValue.tx('workspace.openingApplication'), { name: selected.school.name })}</span>
          </div>
        ) : null}
      </div>
    ) : (
      <EmptyDossier
        onNew={() => openNewApplicationDialog(null)}
        description={isTeamMode ? i18nValue.tx('dossier.noAppDescTeam') : undefined}
      />
    )

  const workspaceShellClass = screen === 'workspace'
    ? [
        'workspace-layout',
        workspaceOpeningFromDashboard ? 'workspace-opening' : '',
        workspaceLayout.applicationsHidden ? 'hide-application-pane' : '',
        workspaceLayout.inspectorHidden ? 'hide-inspector-pane' : '',
        workspaceLayout.sidebarsSwapped ? 'workspace-swapped' : '',
        `workspace-view-${viewMode}`,
        mobileDetailOpen ? 'mobile-detail-open' : '',
      ].filter(Boolean).join(' ')
    : ''
  const shellStyle = screen === 'workspace'
    ? ({
        '--pane-width': `${workspaceLayout.applicationPaneWidth}px`,
        '--inspector-width': `${workspaceLayout.inspectorWidth}px`,
      } as CSSProperties)
    : undefined
  const applicationPaneStyle = screen === 'workspace'
    ? ({ order: workspaceLayout.sidebarsSwapped ? 4 : 2 } as CSSProperties)
    : undefined
  const inspectorPaneStyle = screen === 'workspace'
    ? ({ order: workspaceLayout.sidebarsSwapped ? 2 : 4 } as CSSProperties)
    : undefined
  const screenStageStyle = screen === 'workspace'
    ? ({ order: 3 } as CSSProperties)
    : undefined
  // Keep the center-stage host mounted across navigation so only the content
  // participates in the handoff instead of recreating the whole surface.
  const applicationPaneIsLeft = !workspaceLayout.sidebarsSwapped
  const inspectorPaneIsLeft = workspaceLayout.sidebarsSwapped
  const applicationResizeHandle = (
    <WorkspaceResizeHandle
      label={i18nValue.tx('explorer.resizeApplications')}
      onPointerDown={(event) => startWorkspaceResize('applications', event)}
      onKeyDown={(event) => handleWorkspaceResizeKey('applications', event)}
    />
  )
  const inspectorResizeHandle = (
    <WorkspaceResizeHandle
      label={i18nValue.tx('explorer.resizeInspector')}
      onPointerDown={(event) => startWorkspaceResize('inspector', event)}
      onKeyDown={(event) => handleWorkspaceResizeKey('inspector', event)}
    />
  )
  const applicationEdgeResizeHandle = (
    <WorkspaceResizeHandle
      label={i18nValue.tx('explorer.showApplications')}
      className={`workspace-edge-handle ${applicationPaneIsLeft ? 'edge-left' : 'edge-right'}`}
      onPointerDown={(event) => startWorkspaceResize('applications', event)}
      onKeyDown={(event) => handleWorkspaceResizeKey('applications', event)}
    />
  )
  const inspectorEdgeResizeHandle = (
    <WorkspaceResizeHandle
      label={i18nValue.tx('explorer.showInspector')}
      className={`workspace-edge-handle ${inspectorPaneIsLeft ? 'edge-left' : 'edge-right'}`}
      onPointerDown={(event) => startWorkspaceResize('inspector', event)}
      onKeyDown={(event) => handleWorkspaceResizeKey('inspector', event)}
    />
  )

  return (
    <ThemeContext.Provider value={themeProvider}>
      <I18nContext.Provider value={i18nValue}>
        <FormValidationPrompt />
        <LoadingCurtain
          loading={!applicationsLoaded || !shellPaintReady || !i18nValue.ready || Boolean(workspaceHandoff)}
          delayMs={!applicationsLoaded || !shellPaintReady || !i18nValue.ready ? 0 : 90}
          message={(() => {
            // Prefer raw interfaceMode during boot — team role isn't known until data loads.
            const target = workspaceHandoff?.target
              ?? (interfaceMode === 'team' || screen === 'team' ? 'team' : 'personal')
            return target === 'team'
              ? i18nValue.tx('startup.loadingTeam')
              : i18nValue.tx('startup.loadingPersonal')
          })()}
          detail={
            !isOnline
              ? i18nValue.tx('startup.offlineCheck')
              : workspaceHandoff
                ? (workspaceHandoff.target === 'team'
                  ? i18nValue.tx('startup.loadingTeamDetail')
                  : i18nValue.tx('startup.loadingPersonalDetail'))
                : i18nValue.tx('startup.preparing')
          }
          variant={workspaceHandoff?.variant ?? (screen === 'team' ? 'team' : screen === 'discover' ? 'dashboard' : screen)}
          minimumVisibleMs={workspaceHandoff ? 180 : 240}
          exitDurationMs={360}
        />
        {applicationsLoaded ? (
        <>
        <MailSyncJobWatcher
          job={activeSession.mailFetchStatus?.syncJob}
          onPoll={pollMailSyncJob}
        />
        <div
          ref={workspaceShellRef}
          className={`atlas-shell ${shellPaintReady && i18nValue.ready && !workspaceHandoff ? 'app-shell-ready' : 'app-shell-booting'} ${workspaceShellClass} ${activeSession.user.settings.highContrast ? 'high-contrast' : ''} ${
            screen !== 'workspace' ? 'full-width' : ''
          }`}
          style={shellStyle}
        >
      {busy ? <div className="global-busy-bar" /> : null}
      {screen === 'workspace' && workspaceLayout.applicationsHidden ? applicationEdgeResizeHandle : null}
      {screen === 'workspace' && workspaceLayout.inspectorHidden ? inspectorEdgeResizeHandle : null}
      <OfflineStatusCenter
        connectivity={connectivity}
        language={lang}
        snapshotActive={offlineDataActive}
        snapshotSavedAt={offlineSnapshotSavedAt}
        pendingCount={pendingOfflineQueueSize(activeSession.user.id)}
        blockedCount={blockedOfflineCount}
        syncing={syncingOffline}
        updateReady={pwaUpdateReady}
        onRetry={() => { void retryOfflineConnection() }}
        onReviewBlocked={reviewBlockedOfflineChange}
        onInstallUpdate={requestPwaUpdateInstall}
        onToggleOffline={toggleManualOffline}
        tx={i18nValue.tx}
      />
      {activeSession.impersonation ? (
        <div className="impersonation-banner" role="status" aria-live="polite">
          <div className="impersonation-banner-copy">
            <span>{tpl(i18nValue.tx('impersonation.banner'), {
              target: activeSession.impersonation.targetName || activeSession.user.name,
            })}</span>
            <em>{tpl(i18nValue.tx('impersonation.bannerMeta'), {
              actor: activeSession.impersonation.actorName || activeSession.impersonation.actorEmail,
            })}</em>
          </div>
          <button type="button" className="quiet-action" onClick={leaveTemporaryUserView}>
            <ArrowRightLeft size={13} aria-hidden="true" />
            {activeSession.impersonation.returnTo === 'admin'
              ? i18nValue.tx('impersonation.returnAdmin')
              : tpl(i18nValue.tx('impersonation.return'), {
                actor: activeSession.impersonation.actorName || activeSession.impersonation.actorEmail,
              })}
          </button>
        </div>
      ) : null}
      <Rail
        screen={screen}
        avatarUrl={activeSession.user.settings.avatarDataUrl}
        userName={activeSession.user.name}
        userEmail={activeSession.user.email}
        unreadNotificationCount={unreadNotificationCount}
        theme={themeProvider.theme}
        interfaceMode={effectiveInterfaceMode}
        teamViewerRole={teamViewerRole}
        allowTeamJoin={!PUBLIC_EDITION}
        teamSection={teamSection}
        canUseDiscover={canUseDiscover}
        modeSwitchLocked={Boolean(activeSession.impersonation?.teamId)}
        onPrefetchScreen={(nextScreen) => {
          const destinationViewMode = nextScreen === 'workspace' && canUseWorkspaceBoard ? 'kanban' : viewMode
          void warmCriticalScreenAssets(nextScreen, tab, lang, destinationViewMode)
        }}
        onTeamSection={(section, openTeamScreen = false) => {
          // Same section on the team screen: ignore so rapid re-taps do not
          // restart a dissolve. Leaving workspace applications for another
          // team page still needs a handoff (openTeamScreen).
          if (
            section === teamSection
            && !openTeamScreen
            && (screen === 'team' || (screen === 'workspace' && section === 'applications'))
          ) {
            return
          }

          // Team applications reuse the application workspace. Teachers and owners
          // enter the student board; students retain the focused list/dossier flow.
          if (section === 'applications') {
            const destinationViewMode = teamViewerRole === 'member' ? 'list' as const : 'kanban' as const
            const direction = validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection)
              ? 'forward'
              : 'backward'
            runWithNavigationGuard(() => {
              // Same smoothness as personal → Applications: rail exit + pane enter.
              runAnimatedRailScreenUpdate(() => {
                setTeamSection('applications')
                if (destinationViewMode === 'kanban') {
                  commitWorkspaceBoardOpen({ synchronous: true })
                } else {
                  setViewModeDirection('to-list')
                  setViewMode('list')
                  setSelectedId((current) => current ?? defaultSelectedIdForMode('team'))
                  setMobileDetailOpen(false)
                  setScreen('workspace')
                }
              }, {
                direction,
                ready: warmCriticalScreenAssets('workspace', tab, lang, destinationViewMode),
                readinessGate: readinessGateForScreen('workspace', destinationViewMode),
              })
            })
            return
          }

          // Already on the team screen: swap section content in place. TeamScreen
          // runs a directional exit/enter on `.team-section-stage` (not a full-stage
          // dissolve — that flash is what users noticed before).
          if (screen === 'team' && !openTeamScreen) {
            runWithNavigationGuard(() => {
              startTransition(() => {
                setTeamSection(section)
              })
            })
            return
          }

          const direction = validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection)
            ? 'forward'
            : 'backward'
          const destinationReady = openTeamScreen || screen !== 'team'
            ? warmCriticalScreenAssets('team', tab, lang, viewMode)
            : undefined
          const destinationReadinessGate = openTeamScreen || screen !== 'team'
            ? readinessGateForScreen('team', viewMode)
            : undefined
          // Entering team from personal/workspace, or leaving team applications
          // workspace for another team page, uses the same rail handoff as personal.
          runWithNavigationGuard(() => {
            runAnimatedRailScreenUpdate(() => {
              setTeamSection(section)
              setScreen('team')
            }, { direction, ready: destinationReady, readinessGate: destinationReadinessGate })
          })
        }}
        onScreen={(nextScreen) => {
          const direction = validScreens.indexOf(nextScreen) >= validScreens.indexOf(screen)
            ? 'forward'
            : 'backward'
          if (nextScreen === screen && !(nextScreen === 'workspace' && !isTeamMode)) return

          runWithNavigationGuard(() => {
            const navigationSequence = ++railNavigationSequenceRef.current
            const destinationViewMode = nextScreen === 'workspace' && canUseWorkspaceBoard ? 'kanban' : viewMode
            const warmDestination = () => {
              if (railNavigationSequenceRef.current !== navigationSequence) return Promise.resolve()
              // Keep parsing a cold destination in the background. The visual
              // handoff itself starts immediately with its lightweight shell.
              return warmCriticalScreenAssets(nextScreen, tab, lang, destinationViewMode)
            }
            const destinationReady = warmDestination()
            const destinationReadinessGate = readinessGateForScreen(nextScreen, destinationViewMode)

            if (nextScreen === 'workspace' && canUseWorkspaceBoard) {
              runAnimatedRailScreenUpdate(
                () => {
                  openWorkspaceBoard({ synchronous: true })
                },
                { direction, ready: destinationReady, readinessGate: destinationReadinessGate },
              )
              return
            }

            runAnimatedRailScreenUpdate(() => {
              setScreen(nextScreen)
              // Student team workspaces remain list-first. Personal and teacher/admin
              // application destinations are handled above by openWorkspaceBoard().
              if (nextScreen === 'workspace') setMobileDetailOpen(false)
            }, { direction, ready: destinationReady, readinessGate: destinationReadinessGate })
          })
        }}
        onModeChange={(nextMode) => {
          if (activeSession.impersonation?.teamId && nextMode === 'personal') return
          if (nextMode === effectiveInterfaceMode) return
          if (workspaceHandoff) return
          runWithNavigationGuard(() => {
            void switchWorkspaceMode(nextMode)
          })
        }}
        onOpenNotifications={openNotificationCenter}
        onToggleTheme={themeProvider.toggleTheme}
        onLogout={() => runWithNavigationGuard(logout)}
      />

      {screen === 'workspace' ? (
        <WorkspaceLayoutToolbar
          applicationsHidden={workspaceLayout.applicationsHidden}
          inspectorHidden={workspaceLayout.inspectorHidden}
          isDirty={isDraftDirty}
          saving={saving}
          tx={i18nValue.tx}
          viewMode={viewMode}
          showViewModeToggle={canUseWorkspaceBoard}
          onToggleApplications={() => toggleWorkspacePane('applications')}
          onToggleInspector={() => toggleWorkspacePane('inspector')}
          onSwap={() =>
            setWorkspaceLayout((current) => ({ ...current, sidebarsSwapped: !current.sidebarsSwapped }))
          }
          onReset={() => setWorkspaceLayout(defaultWorkspaceLayout)}
          onSave={() => {
            const latestDraft = draftRef.current
            if (latestDraft) void saveApplication(latestDraft, i18nValue.tx('toast.appSaved'))
          }}
          onDiscard={function() { setPendingDiscard(true) }}
          onViewModeChange={(nextMode) => {
            if (nextMode === 'kanban') {
              runWithNavigationGuard(() => changeViewMode(nextMode))
              return
            }
            changeViewMode(nextMode)
          }}
        />
      ) : null}

      {screen === 'workspace' ? (
        <Suspense fallback={<DeferredAside kind="applications" className="application-pane" style={applicationPaneStyle} />}>
        <ApplicationPane
          applications={visibleApplications}
          totalApplicationCount={applicationLimitUsageCount}
          applicationLimit={isProUser ? applicationLimit : applicationCreateLimit}
          isPro={isProUser}
          trashItems={applicationTrash}
          trashCount={applicationTrash.length}
          removingApplicationIds={removingApplicationIds}
          removingTrashItemIds={removingTrashItemIds}
          trashEnabled={isProUser}
          showTrash={!isTeamMode}
          eyebrow={isTeamMode ? i18nValue.tx('nav.modeTeam') : undefined}
          title={isTeamMode ? i18nValue.tx('nav.teamApplications') : undefined}
          ownerNames={isTeamMode ? teamApplicationOwnerNames : undefined}
          ownerFilterOptions={isTeamMode ? ownerFilterOptions : undefined}
          ownerFilter={effectiveOwnerFilter}
          onOwnerFilter={setOwnerFilter}
          teamRelations={isTeamMode ? teamApplicationRelations : undefined}
          readOnlyIds={isTeamMode ? readOnlyApplicationIds : undefined}
          selectedId={selected?.id ?? null}
          query={query}
          statusFilters={statusFilters}
          sort={sort}
          onQuery={setQuery}
          onStatusFilters={setStatusFilters}
          onSort={setSort}
          onPrefetch={prefetchDossierAssets}
          onResolveMissingSchoolLogo={(application) => (
            resolveAndStoreSchoolLogo(application, { website: application.school.website }, { silent: true })
          )}
          onSelect={(id) => {
            if (id === selected?.id) {
              // The first row is commonly auto-selected before the user taps it.
              // Opening that already-selected record still changes the entire
              // mobile surface, so give it the same forward handoff as any row.
              runWithNavigationGuard(() => {
                mobileDetailOriginRef.current = 'list'
                runAnimatedDossierUpdate(() => setMobileDetailOpen(true), {
                  scope: 'workspace-view',
                  direction: 'forward',
                  deferDossierContent: true,
                })
              })
              return
            }
            runWithNavigationGuard(() => selectApplication(id))
          }}
          onNew={() => openNewApplicationDialog(null)}
          onUpgrade={() => openUpgradePage('application-limit', String(applicationLimitUsageCount + 1), String(isProUser ? applicationLimit : applicationCreateLimit))}
          onShowBoard={canUseWorkspaceBoard ? () => runWithNavigationGuard(openWorkspaceBoard) : undefined}
          onOpenMany={isTeamMode ? undefined : openApplicationsInTabs}
          onExportMany={isTeamMode ? undefined : exportSelectedApplications}
          onRestoreTrash={restoreTrashItem}
          onDeleteTrash={confirmDeleteTrashItem}
          onEmptyTrash={confirmEmptyTrash}
          onCopyApplication={copyValue}
          onDeleteMany={isTeamMode ? undefined : confirmDeleteApplications}
          style={applicationPaneStyle}
          collapsed={workspaceLayout.applicationsHidden}
          resizeHandle={workspaceLayout.applicationsHidden ? null : applicationResizeHandle}
          actionVersion={activeSession.token}
        />
        </Suspense>
      ) : null}

      <main
        className={`screen-stage screen-stage-${screen}${screen === 'workspace' ? ` workspace-view-${viewMode} workspace-view-${viewModeDirection}` : ''}${screen === 'workspace' && workspaceOpeningFromDashboard ? ' workspace-open-from-dashboard' : ''}${screen === 'workspace' && workspaceViewExit ? ` workspace-view-exit-${workspaceViewExit}` : ''}`}
        style={screenStageStyle}
      >
        {routeNotFound ? (
          <NotFoundScreen
            kind="route"
            path={`${window.location.pathname}${window.location.search}`}
            onAction={() => {
              setRouteNotFound(false)
              startTransition(() => setScreen('dashboard'))
            }}
            onBack={() => {
              setRouteNotFound(false)
              if (window.history.length > 1) {
                window.history.back()
                return
              }
              startTransition(() => setScreen('dashboard'))
            }}
          />
        ) : applicationNotFound ? (
          <NotFoundScreen
            kind="application"
            path={`${window.location.pathname}${window.location.search}`}
            title={i18nValue.tx('notFound.applicationTitle')}
            message={i18nValue.tx('notFound.applicationMessage')}
            onAction={() => {
              startTransition(() => setScreen('dashboard'))
            }}
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back()
                return
              }
              startTransition(() => setScreen('dashboard'))
            }}
          />
        ) : (
          <Suspense fallback={<DeferredPanel variant={screen === 'discover' ? 'dashboard' : screen} />}>
            {mainContent}
          </Suspense>
        )}
      </main>

      {screen === 'workspace' && compactWorkspaceViewport && mobileDetailOpen && selected ? (
        <button
          type="button"
          className="mobile-detail-back-fab"
          onClick={() => runWithNavigationGuard(closeMobileApplicationDetail)}
          aria-label={i18nValue.tx('back')}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{i18nValue.tx('back')}</span>
        </button>
      ) : null}

      {screen === 'workspace' && !compactWorkspaceViewport ? (
        <Suspense fallback={<DeferredAside kind="inspector" className="inspector-pane workspace-deferred-inspector" style={inspectorPaneStyle} />}>
        <Inspector
          application={viewMode === 'kanban' ? null : activeDraft ?? selected}
          backups={selectedBackups}
          removingBackupFileNames={removingBackupFileNames}
          busy={busy}
          isPro={isProUser}
          style={inspectorPaneStyle}
          collapsed={workspaceLayout.inspectorHidden}
          resizeHandle={workspaceLayout.inspectorHidden ? null : inspectorResizeHandle}
          aiActive={aiInspectorOpen}
          showPastDeadlines={showPastInspectorDeadlines}
          onShowPastDeadlinesChange={(show) => {
            setShowPastInspectorDeadlines(show)
            safeSetItem(inspectorPastDeadlinesKey(activeSession.user.id), show ? '1' : '0')
          }}
          onCopy={copyValue}
          onEditField={handleInspectorEditField}
          onExport={(format) =>
            runInteractive(async () => {
              const target = activeDraft ?? selected
              const blob = await phdApi.downloadExport(activeSession.token, format, target?.id, lang)
              const suffix = target ? `-${target.school.name}` : ''
              downloadBlob(blob, `phd-applications${suffix}.${format === 'excel' ? 'xls' : format}`)
            }, tpl(i18nValue.tx('toast.exported'), { format: format.toUpperCase() }))
          }
          onBackup={() =>
            runInteractive(async () => {
              const target = activeDraft ?? selected
              if (!target) return
              await phdApi.createBackup(activeSession.token, target.id)
              setBackups(await phdApi.listBackups(getLatestSessionToken(activeSession.token)))
            }, i18nValue.tx('toast.backupCreated'))
          }
          onUpgrade={() => openUpgradePage('manual-backup', 'backup', String(applicationLimit))}
          onRestore={(fileName) =>
            setConfirmDialog({
              title: i18nValue.tx('inspector.restore'),
              message: tpl(i18nValue.tx('confirmRestoreBackup'), { fileName }),
              confirmLabel: i18nValue.tx('inspector.restore'),
              variant: 'default',
              onConfirm: () => {
                setConfirmDialog(null)
                void run(async () => {
                  const result = await phdApi.restoreBackup(activeSession.token, fileName)
                  if (result.application) {
                    replaceApplication(result.application)
                  } else {
                    await refreshAll()
                  }
                }, i18nValue.tx('toast.backupRestored'))
              },
            })
          }
          onDeleteBackup={(fileName) =>
            setConfirmDialog({
              title: i18nValue.tx('inspector.deleteBackup'),
              message: tpl(i18nValue.tx('confirmDeleteBackup'), { fileName }),
              confirmLabel: i18nValue.tx('inspector.deleteBackup'),
            variant: 'danger',
            onConfirm: () => {
              setConfirmDialog(null)
              setRemovingBackupFileNames((current) => new Set(current).add(fileName))
              void (async () => {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, getMotionDelay(380))
                })
                await run(async () => {
                  await phdApi.deleteBackup(activeSession.token, fileName)
                  setBackups((items) => items.filter((item) => item.fileName !== fileName))
                }, i18nValue.tx('toast.backupDeleted'))
              })().finally(() => {
                setRemovingBackupFileNames((current) => {
                  const next = new Set(current)
                  next.delete(fileName)
                  return next
                })
              })
            },
          })
          }
          actionVersion={activeSession.token}
        />
        </Suspense>
      ) : null}

      {dialogOpen ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'dossier']}>
          <NewApplicationDialog
            open={dialogOpen}
            busy={busy}
            teamMode={newApplicationTeamMode}
            studentOptions={teamCreateStudentOptions}
            defaultStudentId={defaultNewApplicationStudentId}
            onClose={() => {
              setDialogOpen(false)
              setNewApplicationOwnerHint(null)
            }}
            onCreate={async (input) => {
              let createdSuccessfully = false
              await run(async () => {
                const created = await phdApi.createApplication(activeSession.token, {
                  professor: input.professor,
                  professorChinese: input.professorChinese,
                  professorEmail: input.professorEmail,
                  professorHomepage: input.professorHomepage.trim() || undefined,
                  university: input.university,
                  country: input.country,
                  website: input.website.trim() || undefined,
                  program: input.program,
                  deadline: input.deadline,
                  notes: input.notes,
                  visibleToTeam: input.visibleToTeam,
                  ownerId: input.ownerId,
                })
                createdSuccessfully = true
                const createdForCurrentUser = !created.ownerId || created.ownerId === activeSession.user.id
                const pendingTeamCreateApproval = newApplicationTeamMode === 'team-self' &&
                  Boolean(input.visibleToTeam) &&
                  !created.teamId &&
                  created.teamTransferRequest?.status === 'pending'
                if (createdForCurrentUser) {
                  setApplications((items) => [created, ...items.filter((item) => item.id !== created.id)])
                }
                if (pendingTeamCreateApproval) {
                  setInterfaceMode('team')
                  setTeamSection('resources')
                  setOwnerFilter(activeSession.user.id)
                  setSelectedId(null)
                  setDraftState(null, { clean: true })
                  setViewModeDirection('to-list')
                  setViewMode('list')
                  setScreen('team')
                  setMobileDetailOpen(false)
                  await refreshTeamWorkspace(activeSession)
                  notify(i18nValue.tx('toast.teamTransferJoinRequested'))
                  return
                }
                if (created.teamId) {
                  const ownerOption = teamCreateStudentOptions.find((student) => student.id === created.ownerId)
                  const teamRecord: TeamApplicationRecord = {
                    ...created,
                    ownerName: createdForCurrentUser ? activeSession.user.name : ownerOption?.name ?? '',
                    ownerEmail: createdForCurrentUser ? activeSession.user.email : ownerOption?.email ?? '',
                    currentUserApplicationRole: createdForCurrentUser ? 'owner' : teamViewerRole,
                  }
                  setTeamApplications((items) => [teamRecord, ...items.filter((item) => item.id !== created.id)])
                  if (!createdForCurrentUser) {
                    setInterfaceMode('team')
                    setOwnerFilter(created.ownerId ?? null)
                  }
                }
                setDraftState(cloneApplication(created), { clean: true })
                setSelectedId(created.id)
                setViewModeDirection('to-list')
                setViewMode('list')
                setScreen('workspace')
                setMobileDetailOpen(true)
                if (created.teamId) {
                  await refreshTeamWorkspace(activeSession)
                } else {
                  await refreshSessionMetadata(activeSession)
                }
                notify(i18nValue.tx('toast.appCreated'))
              })
              return createdSuccessfully
            }}
          />
        </LazyOverlayBoundary>
      ) : null}

      {shareDialogOpen ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'share']}>
          <ShareDialog
            open={shareDialogOpen}
            application={selected}
            expiry={shareExpiry}
            permission={sharePermission}
            activeShareCount={activeSession.usage?.activeShareCount ?? allShares.length}
            shareQuota={activeSession.usage?.shareQuota ?? activeSession.user.settings.shareQuota}
            onExpiry={setShareExpiry}
            onPermission={setSharePermission}
            sections={shareScopeSections}
            onSections={setShareScopeSections}
            onNotify={notify}
            onClose={() => setShareDialogOpen(false)}
            onCreate={() => {
              if (!selected) return
              void run(async () => {
                const share = await phdApi.shareApplication(
                  activeSession.token,
                  selected.id,
                  expiresAtForShare(shareExpiry),
                  sharePermission,
                  shareScopeSections,
                )
                await copyValue(`${window.location.origin}${share.url}`, i18nValue.tx('share.linkLabel'))
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  shares: [
                    {
                      id: share.id,
                      token: share.token,
                      createdAt: share.createdAt,
                      expiresAt: share.expiresAt,
                      permission: share.permission,
                      sections: share.sections,
                    },
                    ...(application.shares ?? []).filter((item) => item.id !== share.id),
                  ],
                }))
                await refreshSessionMetadata(activeSession)
              }, i18nValue.tx('toast.shareCreated'))
            }}
            onRevoke={(shareId) => {
              if (!selected) return
              void run(async () => {
                await phdApi.revokeShare(activeSession.token, selected.id, shareId)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  shares: (application.shares ?? []).filter((share) => share.id !== shareId),
                }))
                await refreshSessionMetadata(activeSession)
              }, i18nValue.tx('toast.shareRevoked'))
            }}
            onUpdateShare={(shareId, expiresAt, permission, sections) => {
              if (!selected) return
              void run(async () => {
                const share = await phdApi.updateShare(activeSession.token, selected.id, shareId, expiresAt, permission, sections)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  shares: (application.shares ?? []).map((item) =>
                    item.id === share.id
                      ? {
                          id: share.id,
                          token: share.token,
                          createdAt: share.createdAt,
                          expiresAt: share.expiresAt,
                          permission: share.permission,
                          sections: share.sections,
                        }
                      : item,
                  ),
                }))
                await refreshSessionMetadata(activeSession)
              }, i18nValue.tx('toast.shareUpdated'))
            }}
          />
        </LazyOverlayBoundary>
      ) : null}

      {dossierEnrichmentOpen && selected ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'discover']}>
          <DiscoverApplicationEnrichmentDialog
            open={dossierEnrichmentOpen}
            token={activeSession.token}
            application={selected}
            aiKeys={aiKeys}
            onApplied={replaceApplication}
            onNotify={notify}
            onClose={() => setDossierEnrichmentOpen(false)}
          />
        </LazyOverlayBoundary>
      ) : null}

      {teamWorkspaceChooserOpen ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'team']}>
          <TeamWorkspaceChooser
            open
            workspaces={teamWorkspaces}
            activeTeamId={activeTeamId}
            onClose={() => {
              setTeamWorkspaceChooserOpen(false)
              setPendingTeamWorkspaceEntry(null)
            }}
            onSelect={(teamId) => {
              const destination = pendingTeamWorkspaceEntry ?? {}
              setTeamWorkspaceChooserOpen(false)
              setPendingTeamWorkspaceEntry(null)
              void switchWorkspaceMode('team', { ...destination, teamId })
            }}
          />
        </LazyOverlayBoundary>
      ) : null}

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={i18nValue.tx('cancel')}
        variant={confirmDialog?.variant}
        onConfirm={() => confirmDialog?.onConfirm()}
        onCancel={() => setConfirmDialog(null)}
      />

      <ConfirmDialog
        open={pendingDiscard}
        title={i18nValue.tx('dossier.discardChanges')}
        message={i18nValue.tx('confirmDiscardChanges')}
        confirmLabel={i18nValue.tx('dossier.discardChanges')}
        variant="danger"
        onConfirm={() => { setPendingDiscard(false); discardDraft() }}
        onCancel={() => setPendingDiscard(false)}
      />

      {notificationCenterOpen ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'workspace', 'team']}>
          <NotificationCenter
            open={notificationCenterOpen}
            notifications={notifications}
            loading={notificationsLoading}
            applicationRecords={notificationApplications}
            teamMembers={visibleTeamSummary?.members ?? []}
            teamName={visibleTeamSummary?.team.name ?? activeSession.user.teamMemberOf?.teamName ?? null}
            onClose={() => setNotificationCenterOpen(false)}
            onMarkRead={markNotificationsRead}
            onMarkUnread={markNotificationsUnread}
            onMarkAllRead={markAllNotificationsRead}
            onArchive={archiveNotifications}
            onOpenNotification={openNotificationDestination}
          />
        </LazyOverlayBoundary>
      ) : null}

      {shortcutsOpen ? (
        <LazyOverlayBoundary namespaces={['core', 'shared']}>
          <KeyboardShortcuts open={shortcutsOpen} onClose={function() { setShortcutsOpen(false) }} />
        </LazyOverlayBoundary>
      ) : null}

      {commandPaletteOpen ? (
        <LazyOverlayBoundary namespaces={['core', 'shared']}>
          <CommandPalette
            open={commandPaletteOpen}
            actions={commandPaletteActions}
            onClose={() => setCommandPaletteOpen(false)}
          />
        </LazyOverlayBoundary>
      ) : null}

      <ToastStack toasts={toasts} onClose={dismissToast} onPause={pauseToast} onResume={resumeToast} />
    </div>
    {showOnboarding ? (
      <LazyOverlayBoundary namespaces={['core', 'shared', 'tour', 'dashboard', 'workspace', 'dossier', 'profile', 'settings']}>
        <OnboardingTour onComplete={handleOnboardingComplete} onStepEnter={handleOnboardingStepEnter} />
      </LazyOverlayBoundary>
    ) : null}
        </>
        ) : null}
      </I18nContext.Provider>
    </ThemeContext.Provider>
  )
}
