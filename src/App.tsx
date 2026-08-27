import {
  Activity,
  createElement,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  lazy,
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
  Check,
  CloudOff,
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
  ShieldCheck,
  SlidersHorizontal,
  SunMoon,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react'
import {
  ApiError,
  clearClientSessionCaches,
  communicationDeliveryPresentation,
  getLatestSessionToken,
  phdApi,
  readSessionTokenSubject,
  sessionTokenIsDefinitelyExpired,
  sessionIdentityMatches,
  setSessionTokenHandler,
  setUnauthorizedHandler,
  type AuthSession,
  type AccountPlan,
  type AiKey,
  type AiKeyInput,
  type ApplicationRecommenderDecision,
  type ApplicationRecommenderMutationResult,
  type ApplicationRecommenderSlice,
  type BackupRecord,
  type CommunicationInput,
  type ApplicationTrashItem,
  type ApplicationTrashScope,
  type NotificationRecord,
  type MailSyncJob,
  type PasskeyCredentialSummary,
  type ProfileAsset,
  type ProfileAssetInput,
  type ProfileRecommender,
  type ProfileRecommenderMutationResult,
  type TeamApplicationRecord,
  type TeamRole,
  type TeamSummary,
  type TeamWorkspaceOption,
  type UserSettings,
  type UserSettingsPatch,
} from './api/phdApi'
import { applicationTrashForScope } from './applicationTrash'
import { SupersedingTaskCoordinator } from './api/supersedingTaskCoordinator'
import { scheduleIdleRouteWarmups, type RouteWarmupTask } from './routeWarmup'
import { normalizeApplicationRecord } from './data/applications'
import type {
  ApplicationRecord,
  ApplicationStatus,
  MaterialRecommender,
  MaterialStatus,
  SharePermission,
  ShareSection,
} from './data/applications'
import type { SharedLinkInfo } from './components/screens/settingsShareModel'
import { canAccessDiscover, discoverStudentMembers, hasPersonalDiscoverAccess, hasTeamDiscoverAccess } from './components/screens/discoverAccess'
import { teachersForStudent } from './teamRelationships'
import {
  canCreateTeamApplication,
  canCreateTeamShare,
  canEditTeamApplication,
  canUseTeamInterviewPrep,
} from './teamPermissions'
import {
  createEmptyInterviewPrepWorkspace,
  createInterviewEvent,
  saveRecoverableInterviewPrepDraft,
  selectInterviewPrepAiKey,
  upsertInterviewEvent,
  type InterviewPrepStudent,
  type InterviewPrepWorkspace,
} from './interviewPrep'
import { toggleWorkspacePaneClass } from './workspaceLayoutMotion'
import { shareSections as allShareSections } from './data/applications'
import { appendReviewComment } from './reviewComments'
import { formatApplicationIdentity } from './data/countries'
import {
  applicationsWithActiveRecommenderDraft,
  profileRecommenderSuggestions,
} from './profileRecommenders'
import { useProfileRecommenderAggregation } from './profileRecommenderAggregation'
import { applicationPersistenceAcknowledged } from './persistenceAcknowledgement'
import {
  assertSettingsPersistenceAcknowledged,
  isNewerSettingsPersistenceVersion,
} from './settingsPersistenceAcknowledgement'
import {
  forgetMailClassificationRequestId,
  isBuiltInMailCategory,
  mailClassificationCommunicationIdBatches,
  mergeMailClassificationDeltas,
  persistedMailClassificationRequestId,
  rememberMailClassificationRequestId,
} from './mailClassification'
import {
  defaultChecklistMaterialType,
  inferChecklistMaterialType,
} from './components/screens/dossierChecklistModel'
import {
  type DetailTab,
  type InterfaceMode,
  type Screen,
  type SortKey,
  type TeamSection,
  safeParseJson,
} from './appModel'
import type { Language } from './i18n'
import { I18nContext, useI18nValue } from './components/hooks/useI18n'
import { usePwaInstall } from './components/hooks/usePwaInstall'
import { useConnectivity } from './components/hooks/useConnectivity'
import { useRealtimeUpdates } from './components/hooks/useRealtimeUpdates'
import { useVisibilityAwarePolling } from './components/hooks/useVisibilityAwarePolling'
import { useWebPushNotifications } from './components/hooks/useWebPushNotifications'
import { useToastQueue } from './components/hooks/useToastQueue'
import { enhanceErrorInfo, enhancedErrorToToast, isRetryableError } from './utils/errorHandling'
import {
  useApplicationAutoSave,
  type ApplicationAutoSaveResult,
  type ApplicationAutoSaveStatus,
} from './components/hooks/useApplicationAutoSave'
import { getMotionDelay } from './components/hooks/useAnimatedClose'
import {
  ThemeContext,
  applyThemePreset,
  normalizeThemeAccent,
  useThemeProvider,
} from './components/hooks/useTheme'
import { Rail } from './components/layout/Rail'
import type { DossierJumpIntent } from './components/screens/DossierView'
import { EmptyDossier } from './components/screens/EmptyDossier'
import { ToastStack } from './components/shared/ToastView'
import { ConfirmDialog } from './components/shared/ConfirmDialog'
import {
  LoadingCurtain,
  PaneSkeleton,
  ScreenSkeleton,
} from './components/shared/LaunchScreen'
import type { LoadingVariant, ScreenSkeletonVariant } from './components/shared/loadingVariant'
import { waitForUiSettle } from './components/shared/uiSettle'
import { useLatestCallback, withLatestCallbackProps } from './components/shared/withLatestCallbackProps'
import type { ShareExpiry } from './components/shared/shareOptions'
import type { NewApplicationStudentOption, NewApplicationTeamMode } from './components/shared/NewApplicationDialog'
import type { CommandPaletteAction } from './components/shared/CommandPalette'
import { FormValidationPrompt } from './components/shared/FormValidationPrompt'
import { LaunchScreen } from './components/shared/LaunchScreen'
import { flashInvalidField } from './components/shared/invalidFieldFlash'
import { GlobalOverflowReveal } from './components/shared/GlobalOverflowReveal'
import { LazyOverlayBoundary } from './components/shared/LazyOverlayBoundary'
import { OfflineStatusCenter } from './components/shared/OfflineStatusCenter'
import { UpdateReadyBanner } from './components/shared/UpdateReadyBanner'
import { ImpersonationBanner } from './components/shared/ImpersonationBanner'
import { OfflineUnavailableScreen } from './components/shared/OfflineUnavailableScreen'
import { NotFoundScreen } from './components/screens/NotFoundScreen'
import {
  normalizeRemoteSchoolLogoDataUrl,
  normalizeSchoolLogoFile,
  SchoolLogoError,
} from './components/shared/schoolLogoModel'
import { SchoolLogoRequestCoordinator } from './schoolLogoRequestCoordinator'
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  languageOptions,
  localizeStaticText,
  preloadLanguage,
  resolveLanguage,
  tpl,
  t,
} from './i18n'
import { contentLanguagesFromSettings } from './contentLanguages'
import { PUBLIC_EDITION } from './edition'
import {
  desktopRemoteEnabled,
  desktopShareEnabled,
  isDesktopShell,
  loadDesktopRuntime,
  readDesktopRuntime,
  setDesktopRuntime as rememberDesktopRuntime,
  type DesktopRuntime,
} from './desktopRuntime'
import { CONTENT_LANGUAGE_NAMESPACES } from './components/hooks/useI18n'
import { normalizeErrorMessage } from './errorMessages'
import { downloadBlob } from './downloadBlob'
import { connectivityUnavailable, probeServerConnectivity, setManualOfflineMode } from './connectivity'
import { activatePwaUpdate, PWA_OFFLINE_SYNC_EVENT, requestOfflineSync } from './serviceWorker'
import { passkeyLoginEmailHint } from './passkeyClient'
import { createRecoverableModuleLoader, loadLazyModule } from './lazyModuleRecovery'
import { reloadPage } from './pageReload'
import {
  prepareForSafeReload,
  registerSafeReloadGuard,
  SAFE_RELOAD_BLOCKED_EVENT,
} from './safeReload'
import {
  blockedOfflineQueueSize,
  canQueueApplicationUpdate,
  enqueueApplicationUpdate,
  firstBlockedOfflineReason,
  isNetworkLikeError,
  isTransientBusyError,
  loadOfflineSnapshot,
  offlineAccessForSession,
  offlineQueueSize,
  pendingOfflineQueueSize,
  personalOfflineSnapshotDataForSession,
  purgeOfflineAccountData,
  readOfflineQueue,
  isRebaseableApplicationConflict,
  isRecoverableRecommenderVersionError,
  mergeOfflineApplicationUpdate,
  removeOfflineApplicationUpdates,
  removeOfflineQueueItems,
  saveOfflineSnapshot,
  type OfflineSnapshotData,
} from './offline'
import { withSmartRetry, AGGRESSIVE_RETRY_CONFIG } from './utils/errorHandling'
import { mergeApplicationListPreservingIdentity } from './applicationListSync'

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
  // Supported browsers overlap the old snapshot and live destination through a
  // scoped View Transition; fallback browsers use a very short dimming handoff
  // before the destination starts.
  // The destination begins above zero opacity, so this never exposes a blank
  // dossier pane between records while still giving the eye a clear fade.
  if (scope === 'dossier-record') return 72
  // Workspace surfaces replace one another inside the already-mounted shell.
  // Committing immediately lets the incoming compositor animation start on the
  // tap frame; holding an invisible mobile surface here reads as a white flash.
  if (scope === 'workspace-view') return 0
  return 0
}

function cssFallbackEnterDuration(scope: AnimatedScreenTransitionScope) {
  if (scope === 'screen') return 260
  if (scope === 'workspace-view') return 210
  if (scope === 'dossier-record') return 230
  if (scope === 'dossier-tab') return 160
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
      pending = loadLazyModule(loader).then((module) => {
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

const loadAuthScreen = createRecoverableModuleLoader(() => import('./components/screens/AuthScreen').then((module) => ({ default: module.AuthScreen })))
const loadDesktopUnlockScreen = createRecoverableModuleLoader(() => import('./components/screens/DesktopUnlockScreen').then((module) => ({ default: module.DesktopUnlockScreen })))
const dashboardScreen = createPreloadedScreen(() => import('./components/screens/Dashboard').then((module) => ({ default: module.Dashboard })))
const applicationPaneScreen = createPreloadedScreen(() => import('./components/screens/ApplicationPane').then((module) => ({ default: module.ApplicationPane })))
const dossierViewScreen = createPreloadedScreen(() => import('./components/screens/DossierView').then((module) => ({ default: module.DossierView })))
const kanbanBoardScreen = createPreloadedScreen(() => import('./components/screens/KanbanBoard').then((module) => ({ default: module.KanbanBoard })))
const inspectorScreen = createPreloadedScreen(() => import('./components/screens/Inspector').then((module) => ({ default: module.Inspector })))
const profileScreen = createPreloadedScreen(() => import('./components/screens/ProfileScreen').then((module) => ({ default: module.ProfileScreen })))
const discoverScreen = createPreloadedScreen(() => import('./components/screens/DiscoverScreen').then((module) => ({ default: module.DiscoverScreen })))
const interviewPrepScreen = createPreloadedScreen(() => import('./components/screens/InterviewPrepScreen').then((module) => ({ default: module.InterviewPrepScreen })))
const settingsScreen = createPreloadedScreen(() => import('./components/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })))
const teamScreen = createPreloadedScreen(() => import('./components/screens/TeamScreen').then((module) => ({ default: module.TeamScreen })))
const loadDashboardScreen = dashboardScreen.preload
const loadApplicationPane = applicationPaneScreen.preload
const loadDossierView = dossierViewScreen.preload
const loadKanbanBoard = kanbanBoardScreen.preload
const loadInspector = inspectorScreen.preload
const loadProfileScreen = profileScreen.preload
const loadDiscoverScreen = discoverScreen.preload
const loadInterviewPrepScreen = interviewPrepScreen.preload
const loadSettingsScreen = settingsScreen.preload
const loadTeamScreen = teamScreen.preload
const loadTeamWorkspaceChooser = createRecoverableModuleLoader(() => import('./components/shared/TeamWorkspaceChooser').then((module) => ({ default: module.TeamWorkspaceChooser })))
const loadNewApplicationDialog = createRecoverableModuleLoader(() => import('./components/shared/NewApplicationDialog').then((module) => ({ default: module.NewApplicationDialog })))
const loadShareDialog = createRecoverableModuleLoader(() => import('./components/shared/ShareDialog').then((module) => ({ default: module.ShareDialog })))
const loadDiscoverApplicationEnrichmentDialog = createRecoverableModuleLoader(() => import('./components/shared/DiscoverApplicationEnrichmentDialog').then((module) => ({ default: module.DiscoverApplicationEnrichmentDialog })))
const loadNotificationCenter = createRecoverableModuleLoader(() => import('./components/shared/NotificationCenter').then((module) => ({ default: module.NotificationCenter })))
const loadKeyboardShortcuts = createRecoverableModuleLoader(() => import('./components/shared/KeyboardShortcuts'))
const loadOnboardingTour = createRecoverableModuleLoader(() => import('./components/shared/OnboardingTour'))
const loadCommandPalette = createRecoverableModuleLoader(() => import('./components/shared/CommandPalette'))

const AuthScreen = lazy(loadAuthScreen)
const DesktopUnlockScreen = lazy(loadDesktopUnlockScreen)
const Dashboard = withLatestCallbackProps(dashboardScreen.Component)
const ApplicationPane = withLatestCallbackProps(applicationPaneScreen.Component)
const DossierView = withLatestCallbackProps(dossierViewScreen.Component)
const KanbanBoard = withLatestCallbackProps(kanbanBoardScreen.Component)
const Inspector = withLatestCallbackProps(inspectorScreen.Component)
const ProfileScreen = withLatestCallbackProps(profileScreen.Component)
const DiscoverScreen = withLatestCallbackProps(discoverScreen.Component)
const InterviewPrepScreen = withLatestCallbackProps(interviewPrepScreen.Component)
const SettingsScreen = withLatestCallbackProps(settingsScreen.Component)
const TeamScreen = withLatestCallbackProps(teamScreen.Component)
const NewApplicationDialog = lazy(loadNewApplicationDialog)
const ShareDialog = lazy(loadShareDialog)
const DiscoverApplicationEnrichmentDialog = lazy(loadDiscoverApplicationEnrichmentDialog)
const NotificationCenter = lazy(loadNotificationCenter)
const KeyboardShortcuts = lazy(loadKeyboardShortcuts)
const OnboardingTour = lazy(loadOnboardingTour)
const CommandPalette = lazy(loadCommandPalette)
const TeamWorkspaceChooser = lazy(loadTeamWorkspaceChooser)

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
  if (screen === 'interview') return screenReadinessGate(interviewPrepScreen)
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
const EMPTY_RECOMMENDER_OPTIONS: readonly never[] = []
const EMPTY_TEAM_RECOMMENDER_PROFILES: Readonly<Record<string, readonly ProfileRecommender[]>> = Object.freeze({})
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
  ? ['dashboard', 'workspace', 'discover', 'interview', 'profile', 'settings']
  : ['dashboard', 'workspace', 'discover', 'interview', 'profile', 'settings', 'team']
const validTabs: DetailTab[] = ['dossier', 'materials', 'mail', 'funding', 'timeline', 'admissions', 'review']
const validTeamSections: TeamSection[] = ['overview', 'applications', 'members', 'resources', 'discover', 'interview', 'audit', 'settings']
const shortcutTabs: DetailTab[] = ['dossier', 'materials', 'mail', 'funding', 'timeline', 'admissions', 'review']

function readStartupSession(): AuthSession | null {
  const stored = safeParseJson<AuthSession>(localStorage.getItem(SESSION_KEY))
  if (!stored?.token || !stored.user?.id) {
    if (stored) localStorage.removeItem(SESSION_KEY)
    return null
  }
  const tokenSubject = readSessionTokenSubject(stored.token)
  if (
    sessionTokenIsDefinitelyExpired(stored.token)
    || (tokenSubject !== null && tokenSubject !== stored.user.id)
  ) {
    localStorage.removeItem(SESSION_KEY)
    return null
  }
  return stored
}

function isPasskeyAbort(error: unknown) {
  return error instanceof Error && ['AbortError', 'NotAllowedError'].includes(error.name)
}

function isAbortLike(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

const PANE_WIDTH_MIN = 260
const PANE_WIDTH_MAX = 520
const INSPECTOR_WIDTH_MIN = 260
const INSPECTOR_WIDTH_MAX = 460
const PANE_COLLAPSE_DISTANCE = 56
const PANE_REVEAL_DISTANCE = 32
type WorkspaceJumpTarget = Omit<DossierJumpIntent, 'applicationId' | 'token'>

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
  return (
    session.usage?.plan
    ?? (session.user.role === 'admin'
      ? 'admin'
      : session.user.settings.membershipPlan === 'team'
        ? 'team'
        : session.user.settings.membershipPlan === 'pro'
          ? 'pro'
          : 'free')
  )
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

function languageNamespacesForScreen(screen: Screen, tab: DetailTab) {
  const namespaces = new Set<string>(['core', 'shared'])

  if (screen === 'dashboard') {
    namespaces.add('dashboard')
    // Dashboard application summaries reuse workspace field and status copy.
    namespaces.add('workspace')
    // Inspector field labels (copy toast suffixes) live in the dossier pack.
    namespaces.add('dossier')
  } else if (screen === 'workspace') {
    namespaces.add('workspace')
    namespaces.add('dossier')
    namespaces.add('profile')
    // Team-owned application rows and permission-aware actions reuse Team copy.
    namespaces.add('team')
    if (tab === 'funding') namespaces.add('dossier')
  } else if (screen === 'discover') {
    namespaces.add('discover')
    // Organization Discover surfaces show Team ownership and assignment copy.
    namespaces.add('team')
  } else if (screen === 'interview') {
    namespaces.add('interview')
    namespaces.add('team')
  } else if (screen === 'profile') {
    namespaces.add('profile')
  } else if (screen === 'settings') {
    namespaces.add('settings')
    namespaces.add('workspace')
    namespaces.add('share')
    namespaces.add('team')
  } else if (screen === 'team') {
    namespaces.add('team')
    namespaces.add('workspace')
    namespaces.add('profile')
    // The owner transfer queue renders shared dossier field labels.
    namespaces.add('dossier')
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

function createTourSampleApplication(ownerId: string | undefined, lang: Language): ApplicationRecord {
  const localize = (value: string) => localizeStaticText(value, lang)
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
      research: localize('human-AI collaboration, learning analytics, and trustworthy agent workflows'),
      lab: localize('Applied Intelligence Lab'),
    },
    school: {
      name: 'PhD Atlas Demo University',
      country: 'United States',
      website: 'https://example.edu/graduate-admissions',
    },
    program: localize('Human-AI Collaboration PhD'),
    deadline: '2026-12-15',
    status: 'Preparing',
    progress: 56,
    priority: 88,
    tags: [localize('tour sample'), 'HCI', localize('funding')],
    nextReminder: '2026-07-12',
    result: localize('Tutorial sample created locally. It will disappear when the guide ends.'),
    materials: [
      {
        id: 'tour-cv',
        name: localize('Academic CV'),
        type: 'PDF',
        status: 'Ready',
        group: 'Core materials',
        details: localize(
          'Keep one polished CV version here, upload revisions, and copy the latest file name when needed.',
        ),
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
        name: localize('Recommendation Letters'),
        type: 'Request',
        status: 'Requested',
        group: 'Recommendations',
        details: localize('Track every recommender, contact address, and reminder date in the expanded detail panel.'),
        reminderEnabled: true,
        reminderDate: '2026-07-18',
        reminderTime: '10:30',
        reminderRepeat: 'weekly',
        requiredCount: 3,
        recommenders: [
          { id: 'tour-rec-1', name: 'Dr. Lin', contact: 'lin@example.edu' },
          {
            id: 'tour-rec-2',
            name: 'Prof. Patel',
            contact: 'patel@example.edu',
          },
          { id: 'tour-rec-3', name: '', contact: '' },
        ],
        version: 'v0',
        updatedAt: '2026-07-01',
        versions: [],
      },
      {
        id: 'tour-sop',
        name: localize('Statement of Purpose'),
        type: 'DOCX',
        status: 'Draft',
        group: 'Writing',
        details: localize('Use the notes area for what needs revision before upload.'),
        reminderEnabled: false,
        version: 'v1',
        updatedAt: '2026-06-30',
        versions: [],
      },
    ],
    communications: [
      {
        id: 'tour-comm-1',
        subject: localize('Research fit and advisor availability'),
        channel: 'Email',
        date: '2026-07-01',
        time: '15:20',
        summary: localize('Professor replied positively and asked for a shorter project summary.'),
        direction: 'incoming',
        messageType: 'incoming-email',
        from: 'ada.chen@example.edu',
        to: 'jasper@example.com',
        attachments: [],
      },
      {
        id: 'tour-note-1',
        subject: localize('Portfolio note'),
        channel: 'Note',
        date: '2026-07-02',
        summary: localize('Mention the user study and attach the project abstract before the next follow-up.'),
        direction: 'note',
        messageType: 'note',
        attachments: [],
      },
    ],
    scholarships: [
      {
        id: 'tour-fellowship',
        name: localize('Graduate Research Fellowship'),
        amount: localize('Full funding'),
        startDate: '2027-09-01',
        endDate: '2032-08-31',
        school: 'PhD Atlas Demo University',
        issuer: localize('Graduate School'),
        status: 'Preparing',
        notes: localize('Use funding cards to track award requirements beside the main application.'),
        materials: [
          {
            id: 'tour-fellowship-proposal',
            name: localize('Research statement'),
            status: 'Draft',
            due: '2026-10-01',
            details: localize('Two-page statement'),
          },
        ],
        tasks: [
          {
            id: 'tour-fellowship-task',
            title: localize('Ask department about nomination route'),
            due: '2026-08-05',
            done: false,
          },
        ],
        timeline: [
          {
            id: 'tour-fellowship-event',
            title: localize('Funding shortlist'),
            date: '2026-09-10',
            note: localize('Department review starts.'),
          },
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
        notes: localize('Sample fee entry'),
        createdAt: '2026-07-01T09:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'tour-task-outline',
        title: localize('Finalize research fit paragraph'),
        due: '2026-07-15',
        done: false,
        details: localize("Tie prior work to Prof. Chen's current lab direction."),
        reminderEnabled: true,
        reminderOffsets: ['3d'],
        reminderTime: '09:00',
        reminderRepeat: 'once',
      },
      {
        id: 'tour-task-portal',
        title: localize('Check portal document rules'),
        due: '2026-07-20',
        done: false,
        details: localize('Confirm PDF size limits and recommender invitation flow.'),
      },
    ],
    timeline: [
      {
        id: 'tour-timeline-shortlist',
        title: localize('Shortlisted program'),
        date: '2026-06-28',
        note: localize('Strong research overlap and realistic deadline.'),
      },
      {
        id: 'tour-timeline-email',
        title: localize('Advisor email reply'),
        date: '2026-07-01',
        note: localize('Follow up with a one-page project summary.'),
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

async function preloadCriticalWorkspaceAssets(applicationCount: number, lang: Language) {
  // Only preload if there are applications to view
  if (applicationCount === 0) return

  const tasks: Array<() => Promise<unknown>> = []

  // Preload DossierView namespace (most likely next screen)
  tasks.push(() => preloadLanguage(lang, ['dossier']))

  // Preload Dashboard namespace if not already loaded
  tasks.push(() => preloadLanguage(lang, ['dashboard']))

  // Preload Profile namespace if user has assets
  tasks.push(() => preloadLanguage(lang, ['profile']))

  // Preload the first application's DossierView chunk
  tasks.push(() => import('./components/screens/DossierView').catch(() => {}))

  await Promise.all(tasks.map((task) => task().catch(() => undefined)))
}

async function warmCriticalScreenAssets(screen: Screen, tab: DetailTab, lang: Language, viewMode: 'list' | 'kanban') {
  const cacheKey = `${screen}:${tab}:${lang}:${viewMode}`
  const inFlight = criticalScreenWarmups.get(cacheKey)
  if (inFlight) return inFlight

  const namespaces = languageNamespacesForScreen(screen, tab)
  const tasks: Array<() => Promise<unknown>> = [
    () => Promise.all(namespaces.map((ns) => preloadLanguage(lang, [ns]))),
  ]

  if (screen === 'dashboard') {
    tasks.push(loadDashboardScreen)
  } else if (screen === 'workspace') {
    tasks.push(loadApplicationPane, loadInspector, viewMode === 'kanban' ? loadKanbanBoard : loadDossierView)
  } else if (screen === 'discover') {
    tasks.push(loadDiscoverScreen)
  } else if (screen === 'interview') {
    tasks.push(loadInterviewPrepScreen)
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
  onConfirm: () => void | Promise<void>
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
      return selectedId ? `/team/applications/${encodeURIComponent(selectedId)}/${tab}` : '/team/applications'
    }
    if (selectedId) return `/applications/${encodeURIComponent(selectedId)}/${tab}`
  }
  if (screen === 'interview' && interfaceMode === 'team') return '/team/interview'
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
    return {
      screen: 'dashboard',
      selectedId: null,
      tab: 'dossier',
      teamSection: 'overview',
      interfaceMode: null,
    }
  }
  const screen = screenForSegment(parts[0])
  if (!screen) return null
  if (screen === 'workspace') {
    if (parts.length > 3) return null
    const id = parts[1] ? decodeRouteSegment(parts[1]) : null
    if (isTourSampleApplicationId(id)) {
      return {
        screen: 'dashboard',
        selectedId: null,
        tab: 'dossier',
        teamSection: 'overview',
        interfaceMode: null,
      }
    }
    return {
      screen,
      selectedId: id,
      tab: parseRouteTab(parts[2]),
      teamSection: 'overview',
      interfaceMode: 'personal',
    }
  }
  if (screen === 'team') {
    const teamSegment = parts[1]
    if (!teamSegment) {
      return {
        screen,
        selectedId: null,
        tab: 'dossier',
        teamSection: 'overview',
        interfaceMode: 'team',
      }
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
        return {
          screen: 'dashboard',
          selectedId: null,
          tab: 'dossier',
          teamSection: 'overview',
          interfaceMode: null,
        }
      }
      return {
        screen: 'workspace',
        selectedId: id,
        tab: parseRouteTab(parts[3]),
        teamSection: 'applications',
        interfaceMode: 'team',
      }
    }
    if (teamSegment === 'interview' && parts.length === 2) {
      return {
        screen: 'interview',
        selectedId: null,
        tab: 'dossier',
        teamSection: 'interview',
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
  return {
    screen,
    selectedId: null,
    tab: 'dossier',
    teamSection: 'overview',
    interfaceMode: null,
  }
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
      ? stored
          .filter((id): id is string => typeof id === 'string' && !isTourSampleApplicationId(id))
          .slice(0, RECENT_OPENED_LIMIT)
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

function notifyEnhancedError(
  error: unknown,
  lang: Language,
  notify: ReturnType<typeof useToastQueue>['notify'],
  retryAction?: () => void
) {
  const enhanced = enhanceErrorInfo(error, lang, isRetryableError(error))
  const toastConfig = enhancedErrorToToast(
    enhanced,
    retryAction,
    () => window.location.reload(),
    () => {
      // Contact/support action can be added here
    }
  )

  notify(
    toastConfig.message,
    toastConfig.tone,
    undefined,
    undefined,
    {
      title: toastConfig.title,
      category: toastConfig.category,
      actions: toastConfig.actions,
    }
  )
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    console.warn('localStorage full:', key)
  }
}
function safeSetJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    console.warn('localStorage full:', key)
  }
}

function readSessionReturnStack(): SessionReturnStackItem[] {
  try {
    const stored = safeParseJson<unknown>(localStorage.getItem(SESSION_RETURN_STACK_KEY))
    if (!Array.isArray(stored)) return []
    return stored.filter(
      (item): item is SessionReturnStackItem =>
        Boolean(item) &&
        typeof item === 'object' &&
        Boolean((item as SessionReturnStackItem).session?.token) &&
        validScreens.includes((item as SessionReturnStackItem).screen) &&
        validTabs.includes((item as SessionReturnStackItem).tab),
    )
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
  if (PUBLIC_EDITION) return null
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
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    ['TOKEN_EXPIRED', 'UNAUTHORIZED', 'UNKNOWN_USER', 'ACCOUNT_DISABLED'].includes(error.code)
  )
}

type WorkspaceBootstrapFailure = {
  error: unknown
  sessionEpoch: number
  userId: string
}

type WorkspaceBootstrapRecoveryTask = {
  execute: (signal: AbortSignal) => Promise<void>
  onLoaded?: () => void
  session: AuthSession
  sessionEpoch: number
}

type WorkspaceBootstrapOutcome =
  | { status: 'loaded' | 'superseded' }
  | { status: 'deferred'; error: unknown }

// A normal local API replacement takes roughly five seconds on Windows. Keep
// the authenticated shell under its resident launch curtain through that
// bounded handoff instead of flashing the terminal recovery screen after only
// two seconds. The attempts remain serialized and honor the server hint, so
// this extends patience without creating a retry wave.
const WORKSPACE_BOOTSTRAP_RETRY_DELAYS_MS = [350, 750, 1_500, 3_000] as const
const WORKSPACE_BOOTSTRAP_RETRY_BUDGET_MS = 12_000

function isSessionSuperseded(error: unknown) {
  return error instanceof ApiError && error.code === 'SESSION_SUPERSEDED'
}

function isWorkspaceIdentityMismatch(error: unknown) {
  return error instanceof ApiError && error.code === 'SESSION_IDENTITY_MISMATCH'
}

function isTransientWorkspaceBootstrapError(error: unknown) {
  if (error instanceof TypeError) return true
  if (!(error instanceof ApiError)) return false
  if (
    [
      'REQUEST_TIMEOUT',
      'SERVER_BUSY',
      'SERVER_STARTING',
      'SERVER_UNAVAILABLE',
      'MEMORY_PRESSURE',
      'MEMORY_PRESSURE_SOFT',
      'MEMORY_PRESSURE_HARD',
      'WORK_DEADLINE_EXCEEDED',
      'WORKSPACE_BOOTSTRAP_UNAVAILABLE',
      'WORKSPACE_SECTION_STREAM_INVALID',
      'WORKSPACE_STREAM_RETRY_REQUIRED',
      'WORKSPACE_STREAM_IDLE_TIMEOUT',
      'WORKSPACE_REVISION_CHANGED',
    ].includes(error.code)
  ) return true
  return error.status === 408 || error.status === 429 || (error.status >= 500 && error.status <= 504)
}

function workspaceBootstrapRetryDelayMs(error: unknown, attempt: number, elapsedMs: number) {
  if (!isTransientWorkspaceBootstrapError(error)) return null
  // The sectional transport owns restart frames that arrive after a stream
  // has begun. Once that bounded recovery is exhausted, do not multiply it by
  // the App-level cold-start loop; the explicit recovery action remains
  // available to the user.
  if (error instanceof ApiError && error.retryExhausted) return null
  const baseDelay = WORKSPACE_BOOTSTRAP_RETRY_DELAYS_MS[attempt]
  if (baseDelay === undefined) return null
  const retryAfterMs = error instanceof ApiError && Number.isFinite(error.retryAfterMs)
    ? Math.max(0, Number(error.retryAfterMs))
    : 0
  // Full clients behind one NAT should not all re-enter the admission queue on
  // the exact same millisecond. Never retry earlier than the server's hint.
  const jitteredDelay = Math.round(baseDelay * (1 + Math.random() * 0.2))
  const delay = Math.max(jitteredDelay, retryAfterMs)
  return elapsedMs + delay <= WORKSPACE_BOOTSTRAP_RETRY_BUDGET_MS ? delay : null
}

function workspaceBootstrapAbortReason() {
  const error = new Error('Workspace bootstrap was cancelled.')
  error.name = 'AbortError'
  return error
}

function waitForWorkspaceBootstrapRetry(delayMs: number, signal: AbortSignal) {
  signal.throwIfAborted()
  if (delayMs <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }
    const handleAbort = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
      reject(signal.reason ?? workspaceBootstrapAbortReason())
    }
    const timer = window.setTimeout(finish, delayMs)
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function isBusyWorkspaceBootstrapError(error: unknown) {
  return error instanceof ApiError && (
    [
      'SERVER_BUSY',
      'SERVER_STARTING',
      'MEMORY_PRESSURE',
      'MEMORY_PRESSURE_SOFT',
      'MEMORY_PRESSURE_HARD',
      'WORK_DEADLINE_EXCEEDED',
      'WORKSPACE_STREAM_RETRY_REQUIRED',
      'WORKSPACE_REVISION_CHANGED',
    ].includes(error.code)
    || error.status === 429
  )
}

function workspaceBootstrapRequestId(error: unknown) {
  if (!(error instanceof ApiError) || typeof error.requestId !== 'string') return null
  const requestId = error.requestId.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(requestId) ? requestId : null
}

function WorkspaceBootstrapRecoveryScreen({
  title,
  message,
  requestId,
  retrying,
  onRetry,
  onExit,
  tx,
}: {
  title: string
  message: string
  requestId: string | null
  retrying: boolean
  onRetry: () => Promise<void>
  onExit: () => void
  tx: (path: string, fallback?: string) => string
}) {
  return (
    <main className="offline-launch-canvas">
      <section className="offline-launch-content" aria-labelledby="workspace-recovery-title">
        <div className="offline-launch-state-icon">
          <TriangleAlert size={24} aria-hidden="true" />
        </div>
        <h1 id="workspace-recovery-title">{title}</h1>
        <p className="offline-launch-detail" role="alert">{message}</p>
        {requestId ? (
          <p className="offline-launch-request-reference">
            {tx('offlineStatus.requestReference', 'Request reference')}: <code>{requestId}</code>
          </p>
        ) : null}
        <div className="offline-launch-actions">
          <button
            type="button"
            className="primary-action offline-launch-retry"
            onClick={() => { void onRetry() }}
            disabled={retrying}
            aria-busy={retrying}
          >
            <LoaderCircle className={retrying ? 'spin' : ''} size={15} aria-hidden="true" />
            {retrying ? tx('offlineStatus.checking') : tx('offlineStatus.retry')}
          </button>
          <button type="button" className="quiet-action offline-launch-exit" onClick={onExit}>
            {tx('signOut')}
          </button>
        </div>
        <div className="offline-launch-security">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{tx('offlineStatus.permissionProtected')}</span>
        </div>
      </section>
    </main>
  )
}

const FILE_SEGMENT_RESERVED_CHARACTERS = new Set(Array.from('<>:"/\\|?*'))

function safeFileSegment(value: string) {
  const sanitized = Array.from(value.trim(), (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || FILE_SEGMENT_RESERVED_CHARACTERS.has(character) ? '-' : character
  }).join('')
  return sanitized.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'application'
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
  tx,
  onToggleApplications,
  onToggleInspector,
  onSwap,
  onReset,
}: {
  applicationsHidden: boolean
  inspectorHidden: boolean
  tx: (path: string, fallback?: string) => string
  onToggleApplications: () => void
  onToggleInspector: () => void
  onSwap: () => void
  onReset: () => void
}) {
  const ApplicationIcon = applicationsHidden ? PanelLeftOpen : PanelLeftClose
  const InspectorIcon = inspectorHidden ? PanelRightOpen : PanelRightClose

  return (
    <div className="workspace-layout-toolbar">
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
                <span>
                  {applicationsHidden ? tx('explorer.showApplicationsShort') : tx('explorer.hideApplicationsShort')}
                </span>
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
          </div>
        </div>
      </div>
    </div>
  )
}

function ApplicationSaveIndicator({
  status,
  tx,
  onRetry,
}: {
  status: ApplicationAutoSaveStatus
  tx: (path: string, fallback?: string) => string
  onRetry: () => void
}) {
  if (status.phase === 'idle' || status.phase === 'pending') return null
  const errorMessage = status.phase === 'error' ? status.message : undefined

  const content =
    status.phase === 'saving'
      ? {
          icon: <LoaderCircle className="spin-icon" size={12} aria-hidden="true" />,
          label: tx('dossier.saving', 'Saving…'),
        }
      : status.phase === 'saved'
        ? {
            icon: <Check size={12} aria-hidden="true" />,
            label: tx('toast.appSaved', 'Application saved'),
          }
        : status.phase === 'queued'
          ? {
              icon: <CloudOff size={12} aria-hidden="true" />,
              label: tpl(tx('toast.offlineChangeQueued', '{count} offline change(s) waiting to sync'), { count: 1 }),
            }
          : {
              icon: <TriangleAlert size={12} aria-hidden="true" />,
              label: errorMessage || tx('toast.offlineSaveNeedsOnline', 'This change needs an online connection.'),
            }

  return (
    <div
      className={`application-save-indicator is-${status.phase}`}
      role="status"
      aria-live={status.phase === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-overflow-reveal="off"
    >
      <span className="application-save-indicator-copy">
        {content.icon}
        <span>{content.label}</span>
      </span>
      {status.phase === 'error' && status.retryable ? (
        <span className="application-save-indicator-actions">
          <button type="button" onClick={onRetry}>
            <RotateCcw size={11} aria-hidden="true" />
            {tx('offlineStatus.retry', 'Retry and sync')}
          </button>
        </span>
      ) : null}
    </div>
  )
}

const MAIL_SYNC_POLL_BACKOFF = 1.35
const MAIL_SYNC_POLL_CEILING_MS = 20_000
/** Safety-net cadence used while the realtime stream owns job transitions. */
const MAIL_SYNC_STREAMED_INTERVAL_MS = 15_000
const MAIL_SYNC_STREAMED_RETRY_INTERVAL_MS = 30_000
const MAIL_SYNC_STREAMED_CEILING_MS = 60_000
/** Bounded so a record under continuous background writes still reports rather than spinning. */
const APPLICATION_SAVE_REBASE_ATTEMPTS = 3
const APPLICATION_SAVE_BUSY_RETRY_DELAYS_MS = [600, 1_400, 2_800] as const

function MailSyncJobWatcher({
  job,
  realtimeConnected,
  onPoll,
}: {
  job?: MailSyncJob | null
  /**
   * With the stream up, the server announces every job transition, so this
   * watcher is only a safety net for a dropped event. Polling every ~2s then
   * is a visible request flood for a job that runs for half a minute.
   */
  realtimeConnected: boolean
  onPoll: (jobId: string, signal: AbortSignal) => Promise<boolean>
}) {
  const jobId = job?.id
  const jobStatus = job?.status
  const active = Boolean(jobId && jobStatus && ['queued', 'running'].includes(jobStatus))
  const nextAttemptMs = Date.parse(job?.nextAttemptAt ?? '')
  const delayedRetryMs =
    jobStatus === 'queued' && Number.isFinite(nextAttemptMs) ? Math.max(0, nextAttemptMs - Date.now()) : 0
  const restartKey = `${jobId ?? ''}:${jobStatus ?? ''}:${job?.nextAttemptAt ?? ''}:${realtimeConnected}`
  const baseIntervalMs = delayedRetryMs > 5_000
    ? (realtimeConnected ? MAIL_SYNC_STREAMED_RETRY_INTERVAL_MS : 15_000)
    : (realtimeConnected ? MAIL_SYNC_STREAMED_INTERVAL_MS : 1_800)
  const ceilingMs = realtimeConnected ? MAIL_SYNC_STREAMED_CEILING_MS : MAIL_SYNC_POLL_CEILING_MS
  // A history import or a stuck job can stay `running` for minutes. Poll
  // quickly while the result is plausibly imminent, then decay towards a
  // background cadence so one long job never becomes a request flood.
  const pollCountRef = useRef(0)

  useEffect(() => {
    pollCountRef.current = 0
  }, [restartKey])

  useVisibilityAwarePolling({
    enabled: active,
    initialDelayMs: delayedRetryMs > 5_000
      ? Math.min(delayedRetryMs, 30_000)
      : (realtimeConnected ? MAIL_SYNC_STREAMED_INTERVAL_MS : 900),
    intervalMs: baseIntervalMs,
    restartKey,
    poll: async (signal) => {
      if (!jobId) return false
      const keepPolling = await onPoll(jobId, signal).catch(() => true)
      if (!keepPolling) return false
      pollCountRef.current += 1
      return Math.min(
        ceilingMs,
        Math.round(baseIntervalMs * MAIL_SYNC_POLL_BACKOFF ** Math.max(0, pollCountRef.current - 1)),
      )
    },
  })

  return null
}

type WorkspaceRefreshScope = 'all' | 'team'
type ApplicationSaveOptions = {
  feedback?: 'toast' | 'quiet'
}

function createMailClassificationRequestId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `mail-classification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function shouldRetainMailClassificationRequestId(error: unknown) {
  return isNetworkLikeError(error)
    || (
      error instanceof ApiError
      && [
        'MAIL_CLASSIFICATION_IN_PROGRESS',
        'MAIL_CLASSIFICATION_SAVE_FAILED',
        'MAIL_CLASSIFICATION_TASK_FAILED',
      ].includes(error.code)
    )
}

export default function App() {
  // Theme
  const themeProvider = useThemeProvider()
  const pwaInstall = usePwaInstall()
  const connectivity = useConnectivity()
  const isOnline = connectivity.mode !== 'offline' && connectivity.mode !== 'server-unreachable'

  // Session
  const desktopShell = isDesktopShell()
  const [session, setSession] = useState<AuthSession | null>(() => (
    desktopShell ? null : readStartupSession()
  ))
  const [desktopGate, setDesktopGate] = useState<'checking' | 'unlock' | 'open' | 'error'>(
    desktopShell ? 'checking' : 'open',
  )
  const [desktopUnlockError, setDesktopUnlockError] = useState<string | null>(null)
  const [desktopBootNonce, setDesktopBootNonce] = useState(0)
  const [initialOfflineMetadata] = useState(() => {
    if (!session) return null
    const snapshot = loadOfflineSnapshot(session)
    return snapshot
      ? {
          savedAt: snapshot.savedAt,
          expiresAt: snapshot.authorization.expiresAt,
        }
      : null
  })
  const [authLanguage, setAuthLanguage] = useState<Language>(readInitialLanguage)
  const [offlineDataActive, setOfflineDataActive] = useState(false)
  const [offlineSnapshotSavedAt, setOfflineSnapshotSavedAt] = useState<string | null>(
    initialOfflineMetadata?.savedAt ?? null,
  )
  const [offlineAccessExpiresAt, setOfflineAccessExpiresAt] = useState<string | null>(
    initialOfflineMetadata?.expiresAt ?? null,
  )
  const [offlineQueueCount, setOfflineQueueCount] = useState(() => (session ? offlineQueueSize(session.user.id) : 0))
  const [blockedOfflineCount, setBlockedOfflineCount] = useState(() =>
    session ? blockedOfflineQueueSize(session.user.id) : 0,
  )
  const [blockedOfflineReason, setBlockedOfflineReason] = useState<string | null>(() =>
    session ? firstBlockedOfflineReason(session.user.id) : null,
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
  /** A one-shot intent from Discover: arrive at the personal AI-key manager. */
  const [focusAiKeys, setFocusAiKeys] = useState(false)
  // True when the current URL didn't match any known screen at all (vs. a known screen with
  // a stale/missing sub-resource, e.g. a deleted application — see applicationNotFound below).
  const [routeNotFound, setRouteNotFound] = useState(() => parseRoute(window.location.pathname) === null)
  const routeSyncedRef = useRef(false)
  // Personal ⇄ Team nav context for institution-admin/teacher/student roles — see teamViewerRole
  // below, which clamps this back to 'personal' for students and non-team users.
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(() => {
    if (PUBLIC_EDITION) return 'personal'
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
  const [workspaceBootstrapFailure, setWorkspaceBootstrapFailure] = useState<WorkspaceBootstrapFailure | null>(null)
  const [workspaceBootstrapRetrying, setWorkspaceBootstrapRetrying] = useState(false)
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
  const enabledAiKeys = useMemo(() => aiKeys.filter((key) => key.enabled !== false), [aiKeys])
  const [classifyingCommunicationIds, setClassifyingCommunicationIds] = useState<Set<string>>(
    () => new Set(),
  )
  const mailClassificationIdempotencyKeysRef = useRef(new Map<string, string>())
  const [interviewWorkspaces, setInterviewWorkspaces] = useState<Record<string, InterviewPrepWorkspace>>({})
  const [interviewSelectedStudentId, setInterviewSelectedStudentId] = useState<string | null>(null)
  const [interviewLoadingScope, setInterviewLoadingScope] = useState<string | null>(null)
  const interviewLoadSequenceRef = useRef(0)
  const dirtyInterviewScopeKeysRef = useRef(new Set<string>())
  const [teamSummary, setTeamSummary] = useState<TeamSummary | null>(null)
  const [teamWorkspaces, setTeamWorkspaces] = useState<TeamWorkspaceOption[]>([])
  const [activeTeamId, setActiveTeamId] = useState<string | null>(loadStoredActiveTeamId)
  const [teamLookupComplete, setTeamLookupComplete] = useState(false)
  // Only populated for active team roles — see the teamApplications fetch effect below.
  const [teamApplications, setTeamApplications] = useState<TeamApplicationRecord[]>([])
  const [teamRecommenderDirectory, setTeamRecommenderDirectory] = useState<{
    scopeKey: string
    profilesByStudent: Record<string, ProfileRecommender[]>
  }>(() => ({ scopeKey: '', profilesByStudent: {} }))
  const personalRecommenderDirectoryRevisionRef = useRef({ scopeKey: '', revision: 0 })
  const teamRecommenderDirectoryRevisionRef = useRef<{
    scopeKey: string
    revisionsByDirectory: Map<string, number>
  }>({ scopeKey: '', revisionsByDirectory: new Map() })
  const [teamRecommenderLoadingKeys, setTeamRecommenderLoadingKeys] = useState<Set<string>>(
    () => new Set(),
  )
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
  const [compactWorkspaceViewport, setCompactWorkspaceViewport] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches,
  )
  const [recentOpenedIds, setRecentOpenedIds] = useState<string[]>(loadStoredRecentOpenedIds)
  const [draft, setDraft] = useState<ApplicationRecord | null>(null)
  const [pendingRecommenderDraftsByApplication, setPendingRecommenderDraftsByApplication] = useState<
    Record<string, MaterialRecommender[]>
  >({})
  const [draftDirty, setDraftDirty] = useState(false)
  const draftRef = useRef<ApplicationRecord | null>(null)
  const draftBaselineRef = useRef<string | null>(null)
  const draftBaselineVersionRef = useRef(0)
  const draftMutationVersionRef = useRef(0)
  const draftDirtyCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftBaselineTaskRef = useRef<{ handle: number; idle: boolean } | null>(null)
  const draftBaselinePendingRef = useRef<{
    draft: ApplicationRecord | null
    version: number
  } | null>(null)
  const schoolLogoRequestsRef = useRef(new SchoolLogoRequestCoordinator())
  const schoolLogoManualRevisionRef = useRef(new Map<string, number>())

  const clearDraftBaselineTask = useCallback(() => {
    const pending = draftBaselineTaskRef.current
    if (!pending) return
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void
    }
    if (pending.idle) idleWindow.cancelIdleCallback?.(pending.handle)
    else window.clearTimeout(pending.handle)
    draftBaselineTaskRef.current = null
  }, [])

  const scheduleDraftBaseline = useCallback(
    (nextDraft: ApplicationRecord | null, version: number) => {
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
        ? {
            handle: idleWindow.requestIdleCallback(commitBaseline, {
              timeout: 900,
            }),
            idle: true,
          }
        : { handle: window.setTimeout(commitBaseline, 220), idle: false }
    },
    [clearDraftBaselineTask],
  )

  const setDraftState = useCallback(
    (nextDraft: ApplicationRecord | null, options?: { clean?: boolean; dirty?: boolean; deferBaseline?: boolean }) => {
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
          draftBaselinePendingRef.current = {
            draft: nextDraft,
            version: baselineVersion,
          }
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
    },
    [clearDraftBaselineTask, scheduleDraftBaseline],
  )

  useEffect(
    () => () => {
      if (draftDirtyCheckTimerRef.current) clearTimeout(draftDirtyCheckTimerRef.current)
      clearDraftBaselineTask()
    },
    [clearDraftBaselineTask],
  )

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
  // Keep the outgoing workspace surface alive for the urgent click frame. The
  // destination is allowed to render on React's deferred lane, so a large
  // Kanban mount cannot block the toolbar, pointer feedback, or the shell.
  const previousScreenRef = useRef(screen)
  const deferredWorkspaceViewMode = useDeferredValue(viewMode)
  const hasWorkspaceViewContinuity = screen === 'workspace' && previousScreenRef.current === 'workspace'
  const reducedWorkspaceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const renderedWorkspaceViewMode = hasWorkspaceViewContinuity && !reducedWorkspaceMotion
    ? deferredWorkspaceViewMode
    : viewMode
  useLayoutEffect(() => {
    previousScreenRef.current = screen
  }, [screen])
  const [workspaceViewExit, setWorkspaceViewExit] = useState<'to-kanban' | null>(null)
  // Once the board has been opened in the current workspace visit, retain its
  // bounded DOM behind React Activity. Returning to a dossier must not make the
  // next Board click rebuild the complete pipeline from scratch.
  const [workspaceBoardResident, setWorkspaceBoardResident] = useState(
    () => screen === 'workspace' && viewMode === 'kanban',
  )
  const [tab, setTab] = useState<DetailTab>(loadStoredTab)
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutState>(loadStoredWorkspaceLayout)
  const workspaceShellRef = useRef<HTMLDivElement | null>(null)
  const [workspaceOpeningFromDashboard, setWorkspaceOpeningFromDashboard] = useState(false)
  const [workspaceJumpIntent, setWorkspaceJumpIntent] = useState<DossierJumpIntent | null>(null)
  const workspaceJumpTokenRef = useRef(0)
  const consumeWorkspaceJumpIntent = useCallback((token: number) => {
    setWorkspaceJumpIntent((current) => (current?.token === token ? null : current))
  }, [])
  const workspaceViewExitTimerRef = useRef<number | null>(null)
  const detailDraftHydrationRef = useRef<{
    handle: number
    idle: boolean
  } | null>(null)
  const detailDraftHydrationGenerationRef = useRef(0)
  const clearDetailDraftHydration = useCallback(() => {
    detailDraftHydrationGenerationRef.current += 1
    const scheduled = detailDraftHydrationRef.current
    if (!scheduled) return
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void
    }
    if (scheduled.idle) idleWindow.cancelIdleCallback?.(scheduled.handle)
    else window.clearTimeout(scheduled.handle)
    detailDraftHydrationRef.current = null
  }, [])

  const scheduleDetailDraftHydration = useCallback(
    (application: ApplicationRecord) => {
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
        ? {
            handle: idleWindow.requestIdleCallback(hydrate, { timeout: 240 }),
            idle: true,
          }
        : { handle: window.setTimeout(hydrate, 190), idle: false }
    },
    [clearDetailDraftHydration, setDraftState],
  )

  // UI state
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [dossierEnrichmentOpen, setDossierEnrichmentOpen] = useState(false)
  const [teamWorkspaceChooserOpen, setTeamWorkspaceChooserOpen] = useState(false)
  const [pendingTeamWorkspaceEntry, setPendingTeamWorkspaceEntry] = useState<{
    screen?: Screen
    teamSection?: TeamSection
  } | null>(null)
  const [shareExpiry, setShareExpiry] = useState<ShareExpiry>('7d')
  const [sharePermission, setSharePermission] = useState<SharePermission>('view')
  const [shareScopeSections, setShareScopeSections] = useState<ShareSection[]>([...allShareSections])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const pendingGoShortcutRef = useRef<number | null>(null)
  const [desktopRuntime, setDesktopRuntimeState] = useState<DesktopRuntime>(() => readDesktopRuntime())
  const establishDesktopWorkspaceRef = useRef<(
    nextSession: AuthSession,
    runtime?: DesktopRuntime | null,
  ) => Promise<boolean>>(async () => false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const runtime = await loadDesktopRuntime()
        if (cancelled) return
        rememberDesktopRuntime(runtime)
        setDesktopRuntimeState(runtime)
        if (!runtime.enabled) {
          if (!isDesktopShell()) {
            setDesktopGate('open')
            return
          }
        }
        if (runtime.unlockRequired && !runtime.unlocked) {
          setDesktopGate('unlock')
          return
        }
        const stored = readStartupSession()
        if (stored) {
          const entered = await establishDesktopWorkspaceRef.current(stored, runtime)
          if (cancelled || entered) return
        }
        let lastError: unknown = null
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            const payload = await phdApi.createDesktopSession()
            if (cancelled) return
            if (payload.runtime) {
              rememberDesktopRuntime(payload.runtime)
              setDesktopRuntimeState(payload.runtime)
            }
            await establishDesktopWorkspaceRef.current(payload, payload.runtime)
            return
          } catch (error) {
            lastError = error
            if (error instanceof ApiError && error.code === 'DESKTOP_UNLOCK_REQUIRED') {
              setDesktopGate('unlock')
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
            if (cancelled) return
          }
        }
        if (cancelled) return
        setDesktopUnlockError(normalizeError(lastError, languageRef.current))
        setDesktopGate('error')
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.code === 'DESKTOP_UNLOCK_REQUIRED') {
          setDesktopGate('unlock')
          return
        }
        if (isDesktopShell() || readDesktopRuntime().enabled) {
          setDesktopUnlockError(normalizeError(error, languageRef.current))
          setDesktopGate('error')
          return
        }
        setDesktopGate('open')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [desktopBootNonce])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 820px)')
    const update = () => setCompactWorkspaceViewport(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  const i18nNamespaces = useMemo(
    () => (session ? languageNamespacesForScreen(screen, tab) : ['core', 'shared', 'settings', 'resetPassword']),
    [screen, session, tab],
  )
  const i18nValue = useI18nValue(lang, i18nNamespaces)
  const {
    status: applicationSaveStatus,
    schedule: scheduleApplicationAutoSave,
    flush: flushApplicationAutoSave,
    retry: retryApplicationAutoSave,
    reset: resetApplicationAutoSave,
    retainFailedDraft: retainFailedApplicationDraft,
    beginExternalSave: beginExternalApplicationSave,
    finishExternalSave: finishExternalApplicationSave,
    failExternalSave: failExternalApplicationSave,
  } = useApplicationAutoSave({
    enabled: Boolean(session),
    persist: (application) =>
      saveApplication(application, i18nValue.tx('toast.appSaved'), {
        feedback: 'quiet',
      }),
  })

  useEffect(() => {
    resetApplicationAutoSave()
  }, [resetApplicationAutoSave, selectedId, session?.user.id])

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
  // Highest canonical Settings revision accepted for the mounted identity.
  // Response-bound mutation ids prove which request replied; this monotonic
  // watermark additionally prevents an older successful request from arriving
  // last and rolling the resident Settings snapshot backwards.
  const settingsCommitVersionRef = useRef({
    userId: session?.user.id ?? null,
    version: Number.isSafeInteger(session?.user.settingsVersion)
      ? Number(session?.user.settingsVersion)
      : 0,
  })
  // Bumps on every intentional identity change so in-flight async commits that
  // captured an older generation can never rewrite the newly mounted account.
  const sessionIdentityEpochRef = useRef(0)
  // The last authentication attempt started by this tab owns the handoff. A
  // slower password/passkey/register result must never replace a newer account.
  const authenticationHandoffGenerationRef = useRef(0)
  const appMountedRef = useRef(true)
  // Id of the mail sync job this tab watched running. Only that job may report a
  // result: every /api/auth/me body carries the last finished job, including the
  // one served right after login.
  const watchedMailSyncJobIdRef = useRef<string | null>(null)
  const workspaceBootstrapRunRef = useRef(0)
  const workspaceBootstrapAbortRef = useRef<AbortController | null>(null)
  const workspaceBootstrapRecoveryRef = useRef<WorkspaceBootstrapRecoveryTask | null>(null)
  const workspaceBootstrapManualRetryRef = useRef<Promise<void> | null>(null)
  // Every SESSION_KEY event supersedes every earlier cross-tab handoff, even
  // while all callers are sharing the same asynchronous safe-reload flush.
  const crossTabSessionTransitionGenerationRef = useRef(0)
  const sessionTokenLineageRef = useRef<Set<string>>(new Set(session?.token ? [session.token] : []))
  const offlineSyncSequenceRef = useRef(0)
  const offlineSyncRunRef = useRef<{
    id: number
    userId: string
    sessionEpoch: number
  } | null>(null)
  const invalidateOfflineSync = useCallback(() => {
    offlineSyncSequenceRef.current += 1
    offlineSyncRunRef.current = null
    setSyncingOffline(false)
  }, [])
  const navigationGuardRef = useRef<NavigationGuard | null>(null)
  /** Field path named by the most recent refused application save, if any. */
  const lastSaveErrorFieldRef = useRef<string | null>(null)
  const activeTeamIdRef = useRef(activeTeamId)
  const teamRecommenderLoadsRef = useRef(new Map<string, Promise<ProfileRecommender[]>>())
  const workspaceRefreshTasksRef = useRef(new SupersedingTaskCoordinator<WorkspaceRefreshScope>())
  const applicationWriteQueueRef = useRef(new Map<string, Promise<unknown>>())
  const settingsWriteQueueRef = useRef(new Map<string, Promise<unknown>>())
  const pendingSaveCountRef = useRef(0)
  const offlineSnapshotSaveRef = useRef<{
    handle: number
    idle: boolean
  } | null>(null)
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
  const dossierContentRevealTimerRef = useRef<number | null>(null)
  const animationSequenceRef = useRef(0)
  const animationFallbackTimersRef = useRef<number[]>([])
  const cssFallbackMotionRef = useRef<CssFallbackMotion | null>(null)
  const railNavigationSequenceRef = useRef(0)
  const deferredQuery = useDeferredValue(query)

  const loadTeamStudentRecommenders = useCallback((studentUserId: string) => {
    const requestSession = session
    const teamId = activeTeamId ?? teamSummary?.team.id ?? null
    if (!requestSession || !teamId || !studentUserId) return Promise.resolve([])

    const scopeKey = `${requestSession.user.id}:${teamId}`
    const loadingKey = `${scopeKey}:${studentUserId}`
    const existing = teamRecommenderLoadsRef.current.get(loadingKey)
    if (existing) return existing

    const requestEpoch = sessionIdentityEpochRef.current
    const requestStillOwnsSession = () => (
      sessionIdentityEpochRef.current === requestEpoch
      && currentSessionUserIdRef.current === requestSession.user.id
      && sessionTokenLineageRef.current.has(requestSession.token)
    )
    setTeamRecommenderLoadingKeys((current) => {
      if (current.has(loadingKey)) return current
      const next = new Set(current)
      next.add(loadingKey)
      return next
    })

    const load = phdApi
      .listTeamMemberProfileRecommenders(requestSession.token, teamId, studentUserId)
      .then((profiles) => {
        if (
          !requestStillOwnsSession()
          || (activeTeamIdRef.current ?? teamSummary?.team.id ?? null) !== teamId
        ) {
          return profiles
        }
        setTeamRecommenderDirectory((current) => ({
          scopeKey,
          profilesByStudent: {
            ...(current.scopeKey === scopeKey ? current.profilesByStudent : {}),
            [studentUserId]: profiles.map((profile) => ({ ...profile })),
          },
        }))
        return profiles
      })
      .catch((error) => {
        if (requestStillOwnsSession()) {
          notifyEnhancedError(error, languageRef.current, notify)
        }
        throw error
      })
      .finally(() => {
        teamRecommenderLoadsRef.current.delete(loadingKey)
        setTeamRecommenderLoadingKeys((current) => {
          if (!current.has(loadingKey)) return current
          const next = new Set(current)
          next.delete(loadingKey)
          return next
        })
      })

    teamRecommenderLoadsRef.current.set(loadingKey, load)
    return load
  }, [activeTeamId, notify, session, teamSummary?.team.id])

  const requestTeamStudentRecommenders = useCallback(async (studentUserId: string): Promise<void> => {
    await loadTeamStudentRecommenders(studentUserId)
  }, [loadTeamStudentRecommenders])

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
        setCssFallbackCommit((current) => (current?.token === token ? null : current))
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

  useEffect(
    () => () => {
      animationFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      animationFallbackTimersRef.current = []
      if (dossierContentRevealTimerRef.current !== null) {
        window.clearTimeout(dossierContentRevealTimerRef.current)
        dossierContentRevealTimerRef.current = null
      }
      clearCssFallbackMotion()
    },
    [clearCssFallbackMotion],
  )

  const runAnimatedScreenUpdate = useCallback(
    (
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
      const reduceMotion =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
          const nextCssFallbackCommit: CssFallbackMotion = {
            token: sequence,
            scope,
            direction: resolvedDirection,
            phase: 'enter',
            onTransitionFinished,
          }
          // A dossier-tab handoff has an urgent local highlight in the tab
          // strip. Commit the new panel and arm its CSS entrance in one
          // interruptible transition so the root animation never runs against
          // the outgoing panel while React is still preparing the destination.
          if (scope === 'dossier-tab' && !reduceMotion && !isJsdomRuntime()) {
            startTransition(() => {
              if (animationSequenceRef.current !== sequence) return
              update()
              setCssFallbackCommit(nextCssFallbackCommit)
            })
            return
          }
          update()
          setCssFallbackCommit(nextCssFallbackCommit)
        }

        const commitWhenDestinationReady = () => {
          if (animationSequenceRef.current !== sequence) return
          // Prefer an urgent commit so the destination paints with the click, not
          // a frame later behind React's transition scheduler.
          if (
            forceCssFallback ||
            ready ||
            readinessGate ||
            scope === 'dossier-tab' ||
            scope === 'dossier-record' ||
            scope === 'screen' ||
            scope === 'workspace-view'
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

        // CSS motion path: optional short exit hold (currently disabled via duration 0).
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

      const destinationReady = ready || readinessGate ? waitForConcreteDestination().catch(() => undefined) : undefined

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
    },
    [applyCssFallbackMotion, clearCssFallbackMotion],
  )

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

  const runAnimatedDossierUpdate = useCallback(
    (update: () => void, options: AnimatedScreenTransitionOptions = {}) => {
      const { onTransitionFinished, deferDossierContent = false, ...transitionOptions } = options
      const reduceMotion =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const shouldDeferContent = deferDossierContent && !reduceMotion && !isJsdomRuntime()
      const contentTransition = ++dossierContentTransitionRef.current
      if (dossierContentRevealTimerRef.current !== null) {
        window.clearTimeout(dossierContentRevealTimerRef.current)
        dossierContentRevealTimerRef.current = null
      }
      let contentCommitted = false
      let contentRevealed = false

      const revealDeferredContent = () => {
        if (dossierContentTransitionRef.current !== contentTransition) return
        if (!contentCommitted || contentRevealed) return
        contentRevealed = true
        if (dossierContentRevealTimerRef.current !== null) {
          window.clearTimeout(dossierContentRevealTimerRef.current)
          dossierContentRevealTimerRef.current = null
        }
        if (shouldDeferContent) {
          startTransition(() => setDossierContentDeferred(false))
        }
        onTransitionFinished?.()
      }

      // Record switches publish only the identity, summary, and first editable
      // cards into the transition snapshot. Dense tab-derived rows are mounted
      // after the compositor handoff, keeping that 230ms interval free of a
      // second large React commit.
      runAnimatedScreenUpdate(
        () => {
          contentCommitted = true
          setDossierContentDeferred(shouldDeferContent)
          update()
        },
        {
          ...transitionOptions,
          // Scoped native snapshots let record changes and board-to-dossier changes
          // overlap as one local cross-fade without mounting duplicate interactive
          // trees. Tabs remain on the lighter CSS path.
          forceCssFallback:
            transitionOptions.forceCssFallback ??
            (transitionOptions.scope !== 'dossier-record' && transitionOptions.scope !== 'workspace-view'),
          onTransitionFinished: revealDeferredContent,
        },
      )

      if (shouldDeferContent) {
        // View Transition promises are normally finite, but an interrupted or
        // vendor-buggy implementation must never strand the secondary dossier
        // content. The token makes this fallback latest-request-wins.
        dossierContentRevealTimerRef.current = window.setTimeout(revealDeferredContent, 480)
      }
    },
    [runAnimatedScreenUpdate],
  )

  const runAnimatedRailScreenUpdate = useCallback(
    (update: () => void, options: AnimatedScreenTransitionOptions = {}) => {
      const { onTransitionFinished, ...transitionOptions } = options
      runAnimatedScreenUpdate(update, {
        ...transitionOptions,
        forceCssFallback: true,
        onTransitionFinished: () => {
          scheduleScreenProgressiveReveal()
          onTransitionFinished?.()
        },
      })
    },
    [runAnimatedScreenUpdate, scheduleScreenProgressiveReveal],
  )

  const prefetchDossierAssets = useCallback(() => {
    return Promise.all([loadDossierView(), loadInspector(), preloadLanguage(lang, ['core', 'shared', 'dossier'])]).then(
      () => undefined,
      () => undefined,
    )
  }, [lang])

  const prefetchWorkspaceBoardAssets = useCallback(() => {
    // The board action is compact enough that a pointer/focus prefetch can
    // usually finish before activation. The same keyed warmup is reused by
    // the navigation readiness gate, so this never starts duplicate work.
    void warmCriticalScreenAssets('workspace', tab, lang, 'kanban')
  }, [lang, tab])

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

  const abortWorkspaceBootstrapRun = useCallback(() => {
    workspaceBootstrapRunRef.current += 1
    const controller = workspaceBootstrapAbortRef.current
    workspaceBootstrapAbortRef.current = null
    controller?.abort(workspaceBootstrapAbortReason())
    workspaceRefreshTasksRef.current.cancel()
    workspaceBootstrapRecoveryRef.current = null
    workspaceBootstrapManualRetryRef.current = null
  }, [])

  const resetWorkspaceBootstrapRecovery = useCallback(() => {
    abortWorkspaceBootstrapRun()
    if (!appMountedRef.current) return
    setWorkspaceBootstrapFailure(null)
    setWorkspaceBootstrapRetrying(false)
  }, [abortWorkspaceBootstrapRun])

  const workspaceBootstrapStillOwnsSession = useCallback((requestSession: AuthSession, requestEpoch: number) => (
    appMountedRef.current
    && sessionIdentityEpochRef.current === requestEpoch
    && currentSessionUserIdRef.current === requestSession.user.id
    && isCurrentSessionToken(requestSession.token)
  ), [isCurrentSessionToken])

  const runWorkspaceBootstrapWithRecovery = useCallback(async (
    task: WorkspaceBootstrapRecoveryTask,
    options: { preserveFailure?: boolean } = {},
  ): Promise<WorkspaceBootstrapOutcome> => {
    if (!workspaceBootstrapStillOwnsSession(task.session, task.sessionEpoch)) {
      return { status: 'superseded' }
    }
    workspaceBootstrapAbortRef.current?.abort(workspaceBootstrapAbortReason())
    workspaceRefreshTasksRef.current.cancel()
    const controller = new AbortController()
    const runId = workspaceBootstrapRunRef.current + 1
    workspaceBootstrapRunRef.current = runId
    workspaceBootstrapAbortRef.current = controller
    workspaceBootstrapRecoveryRef.current = task
    if (!options.preserveFailure) setWorkspaceBootstrapFailure(null)
    const startedAt = Date.now()
    let latestRequestId: string | null = null
    const runStillOwnsSession = () => (
      workspaceBootstrapRunRef.current === runId
      && workspaceBootstrapAbortRef.current === controller
      && !controller.signal.aborted
      && workspaceBootstrapStillOwnsSession(task.session, task.sessionEpoch)
    )

    for (let attempt = 0; ; attempt += 1) {
      if (!runStillOwnsSession()) return { status: 'superseded' }

      try {
        await task.execute(controller.signal)
        if (!runStillOwnsSession()) return { status: 'superseded' }
        workspaceBootstrapRecoveryRef.current = null
        setWorkspaceBootstrapFailure(null)
        task.onLoaded?.()
        if (workspaceBootstrapAbortRef.current === controller) {
          workspaceBootstrapAbortRef.current = null
        }
        return { status: 'loaded' }
      } catch (error) {
        latestRequestId = workspaceBootstrapRequestId(error) ?? latestRequestId
        if (
          !runStillOwnsSession()
          || isAbortLike(error)
          || isSessionSuperseded(error)
        ) return { status: 'superseded' }
        if (isAuthExpired(error) || isWorkspaceIdentityMismatch(error)) throw error

        const delay = workspaceBootstrapRetryDelayMs(error, attempt, Date.now() - startedAt)
        if (delay === null) {
          if (!runStillOwnsSession()) return { status: 'superseded' }
          if (error instanceof ApiError && !workspaceBootstrapRequestId(error) && latestRequestId) {
            error.requestId = latestRequestId
          }
          setWorkspaceBootstrapFailure({
            error,
            sessionEpoch: task.sessionEpoch,
            userId: task.session.user.id,
          })
          return { status: 'deferred', error }
        }
        try {
          await waitForWorkspaceBootstrapRetry(delay, controller.signal)
        } catch (waitError) {
          if (!runStillOwnsSession() || isAbortLike(waitError)) return { status: 'superseded' }
          throw waitError
        }
      }
    }
  }, [workspaceBootstrapStillOwnsSession])

  useEffect(() => {
    appMountedRef.current = true
    return () => {
      appMountedRef.current = false
      // React StrictMode immediately replays setup after its development-only
      // cleanup. Deferring the ownership check one microtask cancels real
      // unmounts without aborting the only cold-start request during that replay.
      queueMicrotask(() => {
        if (!appMountedRef.current) abortWorkspaceBootstrapRun()
      })
    }
  }, [abortWorkspaceBootstrapRun])

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
  }, [sessionContentLanguagePrimary, sessionContentLanguageSecondary, sessionUserId])

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

  const teamRecommenderScopeKey = `${session?.user.id ?? ''}:${activeTeamId ?? teamSummary?.team.id ?? ''}`
  const teamRecommenderProfilesByStudent =
    teamRecommenderDirectory.scopeKey === teamRecommenderScopeKey
      ? teamRecommenderDirectory.profilesByStudent
      : EMPTY_TEAM_RECOMMENDER_PROFILES
  const teamRecommenderLoadingIds = useMemo(() => {
    const prefix = `${teamRecommenderScopeKey}:`
    return new Set(
      [...teamRecommenderLoadingKeys]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    )
  }, [teamRecommenderLoadingKeys, teamRecommenderScopeKey])

  useEffect(() => {
    setTeamRecommenderDirectory((current) => (
      current.scopeKey === teamRecommenderScopeKey
        ? current
        : { scopeKey: teamRecommenderScopeKey, profilesByStudent: {} }
    ))
    setTeamRecommenderLoadingKeys((current) => {
      const prefix = `${teamRecommenderScopeKey}:`
      const next = new Set([...current].filter((key) => key.startsWith(prefix)))
      return next.size === current.size ? current : next
    })
  }, [teamRecommenderScopeKey])

  const refreshOfflineQueueCounts = useCallback((userId?: string | null) => {
    if (!userId) {
      setOfflineQueueCount(0)
      setBlockedOfflineCount(0)
      setBlockedOfflineReason(null)
      return
    }
    const queue = readOfflineQueue(userId)
    const blocked = queue.filter((item) => item.status === 'blocked')
    setOfflineQueueCount(queue.length)
    setBlockedOfflineCount(blocked.length)
    setBlockedOfflineReason(blocked[0]?.blockedReason ?? null)
  }, [])

  // Derived
  // Team role context (owner/admin/member), mirroring the site-admin override already
  // used in SettingsScreen (a site admin inspecting a team is always treated as its 'owner').
  // null when the user has no team at all.
  const canUseTeamFeatures =
    !PUBLIC_EDITION &&
    Boolean(
      teamSummary &&
      (session?.user.role === 'admin' ||
        teamSummary.team.ownerId === session?.user.id ||
        teamSummary.membership?.status === 'active'),
    )
  const visibleTeamSummary = canUseTeamFeatures ? teamSummary : null
  const teamViewerRole: TeamRole | null = visibleTeamSummary
    ? session?.user.role === 'admin' || visibleTeamSummary.team.ownerId === session?.user.id
      ? 'owner'
      : (visibleTeamSummary.membership?.role ?? null)
    : null
  // Every team role has a team-mode workspace. Students still keep their personal workspace
  // for private applications, but can switch into the team system for shared work.
  const canEnterTeamJoinSurface = !PUBLIC_EDITION && screen === 'team'
  const effectiveInterfaceMode: InterfaceMode = teamViewerRole || canEnterTeamJoinSurface ? interfaceMode : 'personal'
  const isTeamMode = effectiveInterfaceMode === 'team'
  const canUseWorkspaceBoard = !isTeamMode || teamViewerRole !== 'member'
  const canUsePersonalDiscover = hasPersonalDiscoverAccess(session)
  const teamMembershipRelationships = visibleTeamSummary?.membership?.relationships
  const canUseTeamDiscover =
    isTeamMode &&
    hasTeamDiscoverAccess(teamViewerRole, teamMembershipRelationships, visibleTeamSummary?.team.permissionDefaults)
  const canUseDiscover = canAccessDiscover(
    effectiveInterfaceMode,
    session,
    teamViewerRole,
    teamMembershipRelationships,
    visibleTeamSummary?.team.permissionDefaults,
  )
  const canUseInterview = !isTeamMode || canUseTeamInterviewPrep(
    teamViewerRole,
    visibleTeamSummary?.membership,
    visibleTeamSummary?.team.permissionDefaults,
  )
  const canCreateInCurrentTeam =
    !isTeamMode ||
    canCreateTeamApplication(
      teamViewerRole,
      visibleTeamSummary?.membership,
      visibleTeamSummary?.team.permissionDefaults,
    )
  const canEditInCurrentTeam =
    !isTeamMode ||
    canEditTeamApplication(teamViewerRole, visibleTeamSummary?.membership, visibleTeamSummary?.team.permissionDefaults)
  const canShareInCurrentTeam =
    desktopShareEnabled(desktopRuntime) && (
      !isTeamMode ||
      canCreateTeamShare(teamViewerRole, visibleTeamSummary?.membership, visibleTeamSummary?.team.permissionDefaults)
    )
  const teamDiscoverScope = useMemo(() => {
    const targetUserId = teamViewerRole === 'member' ? session?.user.id : teamDiscoverTargetUserId
    const teamId = activeTeamId || visibleTeamSummary?.team.id
    return isTeamMode && canUseTeamDiscover && targetUserId && teamId ? { teamId, targetUserId } : undefined
  }, [
    activeTeamId,
    canUseTeamDiscover,
    isTeamMode,
    session?.user.id,
    teamDiscoverTargetUserId,
    teamViewerRole,
    visibleTeamSummary?.team.id,
  ])

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
    if (!applicationsLoaded || screen !== 'interview' || canUseInterview) return
    setTeamSection('overview')
    setScreen(isTeamMode && teamViewerRole ? 'team' : 'dashboard')
  }, [applicationsLoaded, canUseInterview, isTeamMode, screen, teamViewerRole])

  useEffect(() => {
    if (!teamViewerRole || teamViewerRole === 'owner' || teamSection !== 'settings') return
    setTeamSection('overview')
  }, [teamSection, teamViewerRole])

  // Which application list backs the dashboard/workspace right now — team-scoped browsing reuses
  // the exact same screens and state machinery as the personal workspace, just fed a different list.
  const workspaceApplications = useMemo<ApplicationRecord[]>(
    () => (isTeamMode ? teamApplications : applications).map(normalizeApplicationRecord),
    [applications, isTeamMode, teamApplications],
  )
  const applicationTrashScope = useMemo<ApplicationTrashScope>(
    () => (isTeamMode ? { kind: 'team', teamId: activeTeamId } : { kind: 'personal' }),
    [activeTeamId, isTeamMode],
  )

  const replacePendingRecommenderDrafts = useCallback(
    (applicationId: string, drafts: MaterialRecommender[]) => {
      setPendingRecommenderDraftsByApplication((current) => {
        if (drafts.length > 0) {
          if (current[applicationId] === drafts) return current
          return { ...current, [applicationId]: drafts }
        }
        if (!current[applicationId]) return current
        const next = { ...current }
        delete next[applicationId]
        return next
      })
    },
    [],
  )
  const visibleApplicationTrash = useMemo(
    () => applicationTrashForScope(applicationTrash, applicationTrashScope),
    [applicationTrash, applicationTrashScope],
  )
  const workspaceApplicationById = useMemo(
    () => new Map(workspaceApplications.map((application) => [application.id, application])),
    [workspaceApplications],
  )
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
        directory[ownerId] =
          ownerId === session?.user.id ? (session?.user.name ?? application.ownerName) : application.ownerName
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
    const activeMembers = visibleTeamSummary.members.filter((member) => member.status === 'active')
    const membersByUserId = new Map(
      activeMembers.filter((member) => member.userId).map((member) => [member.userId!, member]),
    )
    const studentMember = session?.user.id ? membersByUserId.get(session.user.id) : undefined
    const assignedTeachers = teachersForStudent(studentMember, membersByUserId)
    const organizationOwners = activeMembers.filter((member) => member.role === 'owner')
    const guidanceMembers = [...assignedTeachers, ...organizationOwners].filter(
      (member, index, items) =>
        member.userId !== session?.user.id && items.findIndex((candidate) => candidate.id === member.id) === index,
    )
    const members = guidanceMembers
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
  const teamTrashOwnerNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const member of visibleTeamSummary?.members ?? []) {
      if (!member.userId || member.userId === session?.user.id) continue
      names[member.userId] = member.displayName ?? member.invitedEmail
    }
    return names
  }, [session?.user.id, visibleTeamSummary?.members])
  const ownerFilterOptions = useMemo(() => {
    const membersByUserId = new Map(
      (visibleTeamSummary?.members ?? []).filter((member) => member.userId).map((member) => [member.userId!, member]),
    )
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
    const membersByUserId = new Map(
      (visibleTeamSummary?.members ?? []).filter((member) => member.userId).map((member) => [member.userId!, member]),
    )
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
  const interviewStudents = useMemo<InterviewPrepStudent[]>(() => (
    teamCreateStudentOptions.map((student) => ({
      id: student.id,
      displayName: student.name,
      email: visibleTeamSummary?.members.find((member) => member.userId === student.id)?.invitedEmail,
      avatarUrl: student.avatarUrl,
      interviewCount: Object.values(interviewWorkspaces).find((workspace) => (
        workspace.subjectUserId === student.id
      ))?.interviews.length ?? 0,
      nextInterviewAt: Object.values(interviewWorkspaces)
        .find((workspace) => workspace.subjectUserId === student.id)
        ?.interviews
        .filter((interview) => interview.status !== 'completed' && interview.scheduledAt)
        .map((interview) => interview.scheduledAt as string)
        .sort()[0] ?? null,
    }))
  ), [interviewWorkspaces, teamCreateStudentOptions, visibleTeamSummary?.members])
  const interviewTeamId = isTeamMode ? (activeTeamId || visibleTeamSummary?.team.id || null) : null
  const interviewSubjectUserId = isTeamMode
    ? teamViewerRole === 'member'
      ? session?.user.id ?? ''
      : interviewStudents.some((student) => student.id === interviewSelectedStudentId)
        ? interviewSelectedStudentId ?? ''
        : interviewStudents[0]?.id ?? ''
    : session?.user.id ?? ''
  const interviewScopeKey = `${interviewTeamId ?? 'personal'}:${interviewSubjectUserId}`
  const interviewSubjectName = interviewSubjectUserId === session?.user.id
    ? session.user.name
    : interviewStudents.find((student) => student.id === interviewSubjectUserId)?.displayName ?? ''
  const interviewWorkspace = interviewWorkspaces[interviewScopeKey] ?? null
  const interviewCanonicalWorkspace = useMemo(() => (
    interviewWorkspace ?? (interviewSubjectUserId
      ? createEmptyInterviewPrepWorkspace(interviewSubjectUserId, interviewSubjectName)
      : null)
  ), [interviewSubjectName, interviewSubjectUserId, interviewWorkspace])
  const interviewAiKey = useMemo(() => selectInterviewPrepAiKey(
    aiKeys,
    session?.user.id ?? '',
    interviewTeamId,
  ), [aiKeys, interviewTeamId, session?.user.id])
  const newApplicationTeamMode: NewApplicationTeamMode = isTeamMode
    ? teamViewerRole === 'member'
      ? 'team-self'
      : teamViewerRole
        ? 'team-student-picker'
        : 'none'
    : teamViewerRole === 'member'
      ? 'student-toggle'
      : 'none'
  const defaultNewApplicationStudentId =
    newApplicationTeamMode === 'team-student-picker' &&
    (newApplicationOwnerHint || ownerFilter) &&
    teamCreateStudentOptions.some((student) => student.id === (newApplicationOwnerHint || ownerFilter))
      ? newApplicationOwnerHint || ownerFilter
      : null
  const teamApplicationRelations = useMemo(() => {
    const membersByUserId = new Map(
      (visibleTeamSummary?.members ?? []).filter((member) => member.userId).map((member) => [member.userId!, member]),
    )
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
  const readOnlyApplicationIds = useMemo(
    () =>
      isTeamMode && !canEditInCurrentTeam
        ? new Set(teamApplications.map((application) => application.id))
        : new Set<string>(),
    [canEditInCurrentTeam, isTeamMode, teamApplications],
  )
  const effectiveOwnerFilter = isTeamMode ? ownerFilter : null

  useEffect(() => {
    if (teamLookupComplete && !PUBLIC_EDITION && screen === 'team' && interfaceMode !== 'team') {
      setInterfaceMode('team')
    }
  }, [interfaceMode, screen, teamLookupComplete])

  useEffect(() => {
    if (!teamLookupComplete || screen !== 'team' || teamViewerRole !== 'member') return
    if (teamSection !== 'members') return
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
    if (interfaceMode === 'team' && (screen === 'team' || screen === 'workspace' || screen === 'interview')) return
    startTransition(() => {
      setInterfaceMode('team')
      setTeamSection(screen === 'settings' ? 'settings' : screen === 'workspace' ? 'applications' : teamSection)
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
    runWithNavigationGuard(() => {
      runAnimatedRailScreenUpdate(
        () => {
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
        },
        {
          direction: 'forward',
          ready: warmCriticalScreenAssets('workspace', tab, lang, 'list'),
          readinessGate: readinessGateForScreen('workspace', 'list'),
        },
      )
    })
  }

  function openPersonalWorkspaceForTeamTransfer() {
    runWithNavigationGuard(() =>
      startTransition(() => {
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
      }),
    )
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
      setPendingTeamWorkspaceEntry({
        screen: options?.screen,
        teamSection: options?.teamSection,
      })
      setTeamWorkspaceChooserOpen(true)
      return
    }
    if (nextMode === effectiveInterfaceMode && !options?.screen && !workspaceHandoff) {
      if (options?.teamSection) setTeamSection(options.teamSection)
      return
    }

    const seq = ++workspaceHandoffSeqRef.current
    const defaultPersonalScreen: Screen =
      screen === 'team' || (screen === 'workspace' && isTeamMode) ? 'dashboard' : screen
    const nextScreen: Screen = options?.screen ?? (
      nextMode === 'team' ? (screen === 'interview' ? 'interview' : 'team') : defaultPersonalScreen
    )
    const destinationViewMode =
      nextMode === 'team'
        ? nextScreen === 'workspace' && teamViewerRole !== 'member'
          ? ('kanban' as const)
          : ('list' as const)
        : nextScreen === 'workspace'
          ? ('kanban' as const)
          : viewMode
    const variant = handoffVariantForMode(nextMode, nextScreen)
    const requestedTeamId = nextMode === 'team' ? (options?.teamId ?? activeTeamIdRef.current) : null
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
      setTeamSection(options?.teamSection ?? (nextScreen === 'interview' ? 'interview' : 'overview'))
      setScreen(nextScreen === 'workspace' || nextScreen === 'interview' ? nextScreen : 'team')
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
        nextMode === 'team' && nextScreen !== 'workspace' && nextScreen !== 'interview' ? 'team' : nextScreen,
        tab,
        lang,
        destinationViewMode,
      )

      // Team data can be cold or stale after long personal sessions — refresh when needed.
      if (nextMode === 'team') {
        const needsTeamRefresh =
          teamChanged ||
          !teamLookupComplete ||
          Boolean(activeTeamIdRef.current && !teamSummary) ||
          (Boolean(activeTeamIdRef.current) && teamApplications.length === 0)
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
        notifyEnhancedError(error, languageRef.current, notify)
      }
    } finally {
      if (workspaceHandoffSeqRef.current === seq) {
        setWorkspaceHandoff(null)
      }
    }
  }

  const selected = useMemo(
    () => (selectedId ? (workspaceApplicationById.get(selectedId) ?? null) : null),
    [selectedId, workspaceApplicationById],
  )
  const applicationDetailPrefetchTimerRef = useRef<number | null>(null)
  const queuedApplicationDetailPrefetchRef = useRef<string | null>(null)
  const activeApplicationDetailPrefetchRef = useRef<Promise<ApplicationRecord> | null>(null)
  const drainApplicationDetailPrefetchRef = useRef<() => void>(() => undefined)
  const applicationDetailNavigationControllerRef = useRef<AbortController | null>(null)
  const loadApplicationDetailForNavigation = useCallback((applicationId: string, signal?: AbortSignal) => {
    const application = workspaceApplicationById.get(applicationId) as (
      ApplicationRecord & { __listSlim?: boolean }
    ) | undefined
    if (!application?.__listSlim || !session?.token) return null
    return phdApi.getApplicationForNavigation(session.token, applicationId, { signal })
  }, [session?.token, workspaceApplicationById])
  const drainApplicationDetailPrefetch = useCallback(() => {
    applicationDetailPrefetchTimerRef.current = null
    if (activeApplicationDetailPrefetchRef.current) return
    const applicationId = queuedApplicationDetailPrefetchRef.current
    queuedApplicationDetailPrefetchRef.current = null
    if (!applicationId) return
    const request = loadApplicationDetailForNavigation(applicationId)
    if (!request) return
    activeApplicationDetailPrefetchRef.current = request
    void request.catch(() => undefined).finally(() => {
      if (activeApplicationDetailPrefetchRef.current === request) {
        activeApplicationDetailPrefetchRef.current = null
      }
      if (
        queuedApplicationDetailPrefetchRef.current
        && applicationDetailPrefetchTimerRef.current === null
      ) {
        applicationDetailPrefetchTimerRef.current = window.setTimeout(
          () => drainApplicationDetailPrefetchRef.current(),
          80,
        )
      }
    })
  }, [loadApplicationDetailForNavigation])
  drainApplicationDetailPrefetchRef.current = drainApplicationDetailPrefetch
  const prefetchApplicationEntry = useCallback((applicationId?: string) => {
    void prefetchDossierAssets()
    const application = applicationId
      ? workspaceApplicationById.get(applicationId) as (ApplicationRecord & { __listSlim?: boolean }) | undefined
      : undefined
    if (!applicationId || !application?.__listSlim || !session?.token) return
    // Hovering across a dense table must never fan out one full-record request
    // per row. Keep only the latest dwell target and allow one speculative
    // detail read at a time; an actual click bypasses this short delay below.
    queuedApplicationDetailPrefetchRef.current = applicationId
    if (applicationDetailPrefetchTimerRef.current !== null) {
      window.clearTimeout(applicationDetailPrefetchTimerRef.current)
    }
    if (activeApplicationDetailPrefetchRef.current) {
      applicationDetailPrefetchTimerRef.current = null
      return
    }
    applicationDetailPrefetchTimerRef.current = window.setTimeout(
      drainApplicationDetailPrefetch,
      100,
    )
  }, [drainApplicationDetailPrefetch, prefetchDossierAssets, session?.token, workspaceApplicationById])
  useEffect(() => () => {
    if (applicationDetailPrefetchTimerRef.current !== null) {
      window.clearTimeout(applicationDetailPrefetchTimerRef.current)
      applicationDetailPrefetchTimerRef.current = null
    }
    queuedApplicationDetailPrefetchRef.current = null
    applicationDetailNavigationControllerRef.current?.abort()
    applicationDetailNavigationControllerRef.current = null
  }, [session?.token])
  const isDraftDirty = useMemo(() => {
    if (!draft || !selected || draft.id !== selected.id) return false
    return draftDirty
  }, [draft, draftDirty, selected])
  const draftDirtyForReloadRef = useRef(isDraftDirty)
  draftDirtyForReloadRef.current = isDraftDirty

  useEffect(() => registerSafeReloadGuard('application-autosave', {
    prepare: async () => (
      !draftDirtyForReloadRef.current || await flushApplicationAutoSave()
    ),
  }), [flushApplicationAutoSave])

  useLayoutEffect(() => {
    const handleBlockedReload = () => {
      notify(i18nValue.tx('localRecoveryUnavailable'), 'warning')
    }
    // A lazy-route failure can be reported immediately after the first screen
    // commits. Register before paint so that recovery never outruns the warning
    // surface on a cold start or after a language-pack load.
    window.addEventListener(SAFE_RELOAD_BLOCKED_EVENT, handleBlockedReload)
    return () => window.removeEventListener(SAFE_RELOAD_BLOCKED_EVENT, handleBlockedReload)
  }, [i18nValue, notify])
  const currentInspectorApplication = renderedWorkspaceViewMode === 'kanban'
    ? null
    : draft?.id === selected?.id
      ? draft
      : selected
  // The inspector is part of the same urgent record handoff as the Dossier.
  // Deferring this identity made the right pane wait for the center transition
  // to finish, which read as a delayed second navigation step.
  const inspectorApplication = currentInspectorApplication
  // Team-only metadata (viewer's role on this specific app, owner display name) for the currently
  // selected application — undefined in personal mode, where DossierView behaves exactly as before.
  const selectedTeamMeta = isTeamMode ? teamApplications.find((a) => a.id === selected?.id) : undefined
  const addCommunicationToInterviewPrep = useCallback(async (input: {
    applicationId: string
    communicationId: string
    subject: string
    school: string
    program: string
    advisor: string
  }) => {
    if (!session) return false
    const teamId = isTeamMode ? (activeTeamId || visibleTeamSummary?.team.id || null) : null
    const ownerId = isTeamMode
      ? (teamApplications.find((application) => application.id === input.applicationId)?.ownerId
        ?? session.user.id)
      : session.user.id
    const subjectName = ownerId === session.user.id
      ? session.user.name
      : interviewStudents.find((student) => student.id === ownerId)?.displayName
        || ownerDirectory[ownerId]
        || selectedTeamMeta?.ownerName
        || input.school
        || ''
    const scopeKey = `${teamId ?? 'personal'}:${ownerId}`
    const now = new Date().toISOString()
    const base = interviewWorkspaces[scopeKey] ?? createEmptyInterviewPrepWorkspace(ownerId, subjectName)
    const interview = {
      ...createInterviewEvent({
        ownerUserId: ownerId,
        createdByUserId: session.user.id,
        teamId,
        now,
      }),
      applicationId: input.applicationId,
      sourceCommunicationId: input.communicationId,
      title: input.subject,
      school: input.school,
      program: input.program,
      advisor: input.advisor,
    }
    const nextWorkspace = upsertInterviewEvent(base, interview, now)
    setInterviewWorkspaces((current) => ({ ...current, [scopeKey]: nextWorkspace }))
    const saved = saveRecoverableInterviewPrepDraft(
      { sessionUserId: session.user.id, subjectUserId: ownerId, teamId },
      {
        workspace: nextWorkspace,
        activeInterviewId: interview.id,
        activeTab: 'plan',
        selectedQuestionId: null,
        activeSessionId: null,
        mobilePane: 'interviews',
        dirty: true,
      },
    )
    if (!saved) notify(i18nValue.tx('localRecoveryUnavailable'), 'warning')
    setInterviewSelectedStudentId(ownerId === session.user.id ? null : ownerId)
    setTeamSection('interview')
    setMobileDetailOpen(false)
    startTransition(() => setScreen('interview'))
    notify(i18nValue.tx('dossier.mailAddedToInterviewPrep'), 'success')
    return true
  }, [
    activeTeamId,
    interviewStudents,
    interviewWorkspaces,
    i18nValue,
    isTeamMode,
    notify,
    ownerDirectory,
    selectedTeamMeta?.ownerName,
    session,
    setInterviewSelectedStudentId,
    setMobileDetailOpen,
    setScreen,
    setTeamSection,
    teamApplications,
    visibleTeamSummary?.team.id,
  ])
  const studentTeamTransferOptions = useMemo(
    () => teamWorkspaces.filter((workspace) => workspace.viewerRole === 'member'),
    [teamWorkspaces],
  )
  const selectedManagerTeamWorkspace = useMemo(
    () =>
      selected?.teamId && selected.ownerId !== session?.user.id
        ? (teamWorkspaces.find(
            (workspace) =>
              workspace.teamId === selected.teamId &&
              (workspace.viewerRole === 'owner' || workspace.viewerRole === 'admin'),
          ) ?? null)
        : null,
    [selected?.ownerId, selected?.teamId, session?.user.id, teamWorkspaces],
  )
  const canDirectlyMoveSelectedTeamApplication = Boolean(isTeamMode && selectedManagerTeamWorkspace)
  const selectedTeamTransferOptions = useMemo(
    () =>
      canDirectlyMoveSelectedTeamApplication && selectedManagerTeamWorkspace
        ? [selectedManagerTeamWorkspace]
        : studentTeamTransferOptions,
    [canDirectlyMoveSelectedTeamApplication, selectedManagerTeamWorkspace, studentTeamTransferOptions],
  )
  useEffect(() => {
    if (!isTeamMode && tab === 'review') setTab('dossier')
  }, [isTeamMode, tab])
  const canToggleSelectedTeamVisibility = Boolean(
    selected &&
    ((selected.ownerId === session?.user.id && studentTeamTransferOptions.length > 0) ||
      canDirectlyMoveSelectedTeamApplication),
  )

  const normalizedApplicationQuery = deferredQuery.trim().toLowerCase()
  const applicationMatchesDeferredQuery = useCallback(
    (application: ApplicationRecord) => {
      if (!normalizedApplicationQuery) return true
      const relation = teamApplicationRelations[application.id]
      return [
        application.school.name,
        application.program,
        application.professor.english,
        application.professor.chinese,
        application.professor.email,
        application.tags.join(' '),
        application.ownerId ? (ownerDirectory[application.ownerId] ?? '') : '',
        relation?.studentName ?? '',
        relation?.advisorName ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedApplicationQuery)
    },
    [normalizedApplicationQuery, ownerDirectory, teamApplicationRelations],
  )

  const filteredApplications = useMemo(() => {
    const filtered: ApplicationRecord[] = []
    for (const application of workspaceApplications) {
      if (statusFilters.length > 0 && !statusFilters.includes(application.status)) continue
      if (effectiveOwnerFilter && application.ownerId !== effectiveOwnerFilter) continue
      if (!applicationMatchesDeferredQuery(application)) continue
      filtered.push(application)
    }
    return filtered
  }, [applicationMatchesDeferredQuery, effectiveOwnerFilter, statusFilters, workspaceApplications])
  const filteredApplicationIds = useMemo(
    () => new Set(filteredApplications.map((application) => application.id)),
    [filteredApplications],
  )

  const visibleApplications = useMemo(() => {
    if (!selected || filteredApplicationIds.has(selected.id) || !applicationMatchesDeferredQuery(selected)) {
      // Returning the exact filtered collection is important: ordinary record
      // switches then leave ApplicationPane's sort/page inputs referentially
      // stable instead of rebuilding the whole 131-row explorer pipeline.
      return filteredApplications
    }

    return [selected, ...filteredApplications.filter((application) => application.id !== selected.id)]
  }, [applicationMatchesDeferredQuery, filteredApplicationIds, filteredApplications, selected])
  const visibleApplicationIndexById = useMemo(
    () => new Map(visibleApplications.map((application, index) => [application.id, index])),
    [visibleApplications],
  )

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
      return [
        {
          id: student.id,
          name: student.name,
          email: student.email,
          avatarUrl: student.avatarUrl ?? undefined,
          advisorName: student.advisorName,
          applications: studentVisibleApplications,
          allApplications: allApplicationsByOwner.get(student.id) ?? [],
          canCreateApplication: true,
        },
      ]
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

  const personalRecommenderApplications = useMemo(
    () => applicationsWithActiveRecommenderDraft(realApplications, draft),
    [draft, realApplications],
  )
  const personalRecommenderAggregation = useProfileRecommenderAggregation(
    session?.user.settings.profileRecommenders ?? [],
    personalRecommenderApplications,
    session?.user.id,
  )

  const personalRecommenderOptions = useMemo(() => {
    const ownerId = session?.user.id
    if (!ownerId) return []

    return profileRecommenderSuggestions(personalRecommenderAggregation.directory)
      .map((suggestion) => ({
        key: suggestion.key,
        ...(suggestion.profileId ? { profileId: suggestion.profileId } : {}),
        name: suggestion.name,
        email: suggestion.email,
        phone: suggestion.phone,
        title: suggestion.title,
        institution: suggestion.institution,
        relationship: suggestion.relationship,
        notes: suggestion.notes,
        updatedAt: suggestion.updatedAt,
      }))
  }, [personalRecommenderAggregation, session?.user.id])

  const selectedTeamRecommenderOwnerId = isTeamMode ? selectedTeamMeta?.ownerId ?? null : null
  const selectedTeamOwnerApplications = useMemo(() => {
    if (!selectedTeamRecommenderOwnerId) return []
    const ownerApplications = teamApplications.filter(
      (application) => application.ownerId === selectedTeamRecommenderOwnerId,
    )
    return applicationsWithActiveRecommenderDraft(ownerApplications, draft)
  }, [draft, selectedTeamRecommenderOwnerId, teamApplications])
  const selectedTeamRecommenderProfiles = selectedTeamRecommenderOwnerId
    ? teamRecommenderProfilesByStudent[selectedTeamRecommenderOwnerId] ?? EMPTY_RECOMMENDER_OPTIONS
    : EMPTY_RECOMMENDER_OPTIONS
  const selectedTeamRecommenderAggregation = useProfileRecommenderAggregation(
    selectedTeamRecommenderProfiles,
    selectedTeamOwnerApplications,
    selectedTeamRecommenderOwnerId ?? undefined,
  )
  const selectedTeamRecommenderOptions = useMemo(() => {
    if (!selectedTeamRecommenderOwnerId) return []
    return profileRecommenderSuggestions(selectedTeamRecommenderAggregation.directory).map((suggestion) => ({
      key: suggestion.key,
      ...(suggestion.profileId ? { profileId: suggestion.profileId } : {}),
      name: suggestion.name,
      email: suggestion.email,
      phone: suggestion.phone,
      title: suggestion.title,
      institution: suggestion.institution,
      relationship: suggestion.relationship,
      notes: suggestion.notes,
      updatedAt: suggestion.updatedAt,
    }))
  }, [selectedTeamRecommenderAggregation, selectedTeamRecommenderOwnerId])

  useEffect(() => {
    if (!isTeamMode || !selectedTeamRecommenderOwnerId) return
    if (Object.prototype.hasOwnProperty.call(teamRecommenderProfilesByStudent, selectedTeamRecommenderOwnerId)) return
    void loadTeamStudentRecommenders(selectedTeamRecommenderOwnerId).catch(() => undefined)
  }, [
    isTeamMode,
    loadTeamStudentRecommenders,
    selectedTeamRecommenderOwnerId,
    teamRecommenderProfilesByStudent,
  ])

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
    () =>
      backups.filter(
        (backup) => !inspectorApplication?.id || backup.applicationId === inspectorApplication.id,
      ),
    [backups, inspectorApplication?.id],
  )

  function applyWorkspaceSnapshot(data: OfflineSnapshotData, options: { offline?: boolean } = {}) {
    setApplications(data.applications)
    setProfileAssets(data.profileAssets)
    setBackups(data.backups)
    setApplicationTrash(data.applicationTrash)
    const teamDataUnavailable = Boolean(options.offline) || PUBLIC_EDITION
    const nextTeamId = teamDataUnavailable ? null : (data.activeTeamId ?? data.teamSummary?.team.id ?? null)
    setTeamWorkspaces(teamDataUnavailable ? [] : (data.teamWorkspaces ?? []))
    setActiveTeamId(nextTeamId)
    activeTeamIdRef.current = nextTeamId
    setTeamSummary(teamDataUnavailable ? null : data.teamSummary)
    setTeamApplications(teamDataUnavailable ? [] : data.teamApplications)
    if (PUBLIC_EDITION) {
      setInterfaceMode('personal')
      setOwnerFilter(null)
      if (screen === 'team' || interfaceMode === 'team') {
        setScreen('dashboard')
        setTeamSection('overview')
      }
    }
    if (options.offline) {
      setAiKeys([])
      setPasskeys([])
      setNotifications([])
      setUnreadNotificationCount(0)
      setInterfaceMode('personal')
      setOwnerFilter(null)
      setDraftState(null, { clean: true })
      setMobileDetailOpen(false)
      if (screen === 'team' || interfaceMode === 'team') {
        setScreen('dashboard')
        setTeamSection('overview')
      }
    }
    setTeamLookupComplete(true)
    setApplicationsLoaded(true)
    setSelectedId((current) =>
      current && data.applications.some((application) => application.id === current)
        ? current
        : (data.applications[0]?.id ?? null),
    )

    // Preload critical assets after workspace data is applied
    if (!options.offline && data.applications.length > 0) {
      void preloadCriticalWorkspaceAssets(data.applications.length, languageRef.current)
    }
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

  function activateSecureOfflineWorkspace(activeSession: AuthSession) {
    const personalData = personalOfflineSnapshotDataForSession(activeSession, currentSnapshotData())
    if (!personalData) return false

    const saved = saveOfflineSnapshot(activeSession, personalData)
    applyWorkspaceSnapshot(personalData, { offline: true })
    setOfflineDataActive(true)
    if (saved) {
      setOfflineSnapshotSavedAt(saved.savedAt)
      setOfflineAccessExpiresAt(saved.authorization.expiresAt)
    }
    refreshOfflineQueueCounts(activeSession.user.id)
    return true
  }

  function cancelScheduledOfflineSnapshotSave() {
    const scheduled = offlineSnapshotSaveRef.current
    if (!scheduled) return
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void
    }
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
    const commit = (data: OfflineSnapshotData) => {
      const saved = saveOfflineSnapshot(nextSession, data)
      if (saved) {
        setOfflineSnapshotSavedAt(saved.savedAt)
        setOfflineAccessExpiresAt(saved.authorization.expiresAt)
      }
    }
    const runSave = () => {
      offlineSnapshotSaveRef.current = null
      // First paint deliberately receives list-shaped applications without
      // correspondence bodies or file histories. Persisting those verbatim
      // would leave the offline workspace showing empty dossiers for every
      // record the user had not opened while online, so fetch the complete
      // set once here -- on idle, off the startup path -- and store that.
      // A failure keeps the lighter snapshot, which is still better than none.
      const hasSlimApplications = snapshotData.applications.some(
        (application) => (application as ApplicationRecord & { __listSlim?: boolean }).__listSlim === true,
      )
      if (!hasSlimApplications) {
        commit(snapshotData)
        return
      }
      phdApi.listApplications(nextSession.token)
        .then((full) => {
          if (currentSessionTokenRef.current !== nextSession.token) return
          commit({ ...snapshotData, applications: full })
        })
        .catch(() => {
          if (currentSessionTokenRef.current !== nextSession.token) return
          commit(snapshotData)
        })
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
    const sample = createTourSampleApplication(session?.user.id, lang)
    try {
      localStorage.setItem(ONBOARDING_SAMPLE_ACTIVE_KEY, '1')
    } catch {}
    setApplications((items) => [sample, ...items.filter((item) => !isTourSampleApplication(item))])
    setDraftState(cloneApplication(sample), { clean: true })
    setSelectedId(sample.id)
  }, [lang, session?.user.id, setDraftState])

  const cleanupTourSampleApplication = useCallback(
    (markDone = true) => {
      const fallbackId = realApplications[0]?.id ?? null
      setApplications((items) => items.filter((item) => !isTourSampleApplication(item)))
      if (draftRef.current && isTourSampleApplicationId(draftRef.current.id)) {
        setDraftState(null, { clean: true })
      }
      setSelectedId((current) => (isTourSampleApplicationId(current) ? fallbackId : current))
      setRecentOpenedIds((items) => items.filter((id) => !isTourSampleApplicationId(id)))
      try {
        localStorage.removeItem(ONBOARDING_SAMPLE_ACTIVE_KEY)
        const storedSelected = localStorage.getItem(SELECTED_ID_KEY)
        if (isTourSampleApplicationId(storedSelected)) localStorage.removeItem(SELECTED_ID_KEY)
        const storedRecent = safeParseJson<unknown>(localStorage.getItem(RECENT_OPENED_KEY))
        if (Array.isArray(storedRecent)) {
          safeSetJson(
            RECENT_OPENED_KEY,
            storedRecent.filter((id) => !isTourSampleApplicationId(typeof id === 'string' ? id : null)),
          )
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
    },
    [realApplications, selectedId, setDraftState],
  )

  const startOnboardingTour = useCallback(() => {
    setDialogOpen(false)
    setConfirmDialog(null)
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
      preloadLanguage(languageRef.current, [
        'core',
        'shared',
        'tour',
        'dashboard',
        'workspace',
        'dossier',
        'profile',
        'settings',
      ]),
      loadOnboardingTour(),
      loadProfileScreen(),
      loadSettingsScreen(),
    ]).catch(() => undefined)
    setShowOnboarding(true)
  }, [ensureTourSampleApplication])

  const browserNotificationsEnabled = session?.user.settings.browserNotificationsEnabled !== false
  const verifiedOnlineSessionToken = applicationsLoaded && !offlineDataActive && isOnline ? session?.token : undefined
  const webPushNotifications = useWebPushNotifications(
    verifiedOnlineSessionToken,
    browserNotificationsEnabled,
    (notification) => {
      const sourceToken = currentSessionTokenRef.current
      const sourceUserId = currentSessionUserIdRef.current
      const sourceEpoch = sessionIdentityEpochRef.current
      if (
        !sourceToken
        || !sourceUserId
        || !isMountedSessionIdentity(sourceUserId, sourceToken, sourceEpoch)
      ) return
      const token = getLatestSessionToken(sourceToken)
      void phdApi
        .unreadNotificationCount(token)
        .then((result) => {
          if (isMountedSessionIdentity(sourceUserId, sourceToken, sourceEpoch)) {
            setUnreadNotificationCount(result.count)
          }
        })
        .catch(() => {})
      if (notificationCenterOpen) {
        void phdApi
          .listNotifications(token)
          .then((items) => {
            if (isMountedSessionIdentity(sourceUserId, sourceToken, sourceEpoch)) {
              setNotifications(items)
            }
          })
          .catch(() => {})
      }
      if (
        notification.title
        && isMountedSessionIdentity(sourceUserId, sourceToken, sourceEpoch)
      ) notify(notification.title, 'info')
    },
  )

  useEffect(() => {
    const handleUpdateReady = () => setPwaUpdateReady(true)
    window.addEventListener('phd-atlas:pwa-update-ready', handleUpdateReady)
    return () => window.removeEventListener('phd-atlas:pwa-update-ready', handleUpdateReady)
  }, [])

  useEffect(() => {
    const handleBackgroundSync = () => {
      if (!session || !applicationsLoaded || connectivity.manualOffline) return
      void probeServerConnectivity({ force: true }).then((result) => {
        if (result.serverReachable && offlineQueueSize(session.user.id) > 0) {
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
    // Start the signed-out surface and its scoped marketing CSS before the
    // session state commit, so logout/expiry never exposes a cold blank frame.
    void loadAuthScreen()
    cancelledRef.current = true
    authenticationHandoffGenerationRef.current += 1
    workspaceRefreshTasksRef.current.cancel()
    resetWorkspaceBootstrapRecovery()
    invalidateOfflineSync()
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
    setPendingRecommenderDraftsByApplication({})
    setProfileAssets([])
    setAiKeys([])
    setNotifications([])
    setNotificationsLoading(false)
    setUnreadNotificationCount(0)
    setNotificationCenterOpen(false)
    setDiscoverRealtimeRevision(0)
    setTeamWorkspaces([])
    setTeamSummary(null)
    setTeamApplications([])
    setActiveTeamId(null)
    activeTeamIdRef.current = null
    setInterfaceMode('personal')
    setOwnerFilter(null)
    setBackups([])
    setApplicationTrash([])
    setApplicationsLoaded(false)
    setBusy(false)
    setShellPaintReady(false)
    setWorkspaceHandoff(null)
    workspaceHandoffSeqRef.current += 1
    setTeamLookupComplete(false)
    setOfflineDataActive(false)
    setOfflineSnapshotSavedAt(null)
    setOfflineAccessExpiresAt(null)
    setOfflineQueueCount(0)
    setBlockedOfflineCount(0)
    setBlockedOfflineReason(null)
    setPasskeys([])
    setRemovingPasskeyIds(new Set())
    setSelectedId(null)
    setMobileDetailOpen(false)
    setRecentOpenedIds([])
    setDraftState(null, { clean: true })
    setScreen('dashboard')
    setTab('dossier')
    setTeamSection('overview')
  }, [invalidateOfflineSync, resetSessionTokenLineage, resetWorkspaceBootstrapRecovery, setDraftState])

  const expireSession = useCallback(
    (requestToken?: string) => {
      // Ignore late 401s from a previous login (or another account). Only the live
      // session's own token chain may surface "session expired" and clear state.
      if (!isActiveSessionRequestToken(requestToken)) return
      if (sessionExpiredRef.current) return
      sessionExpiredRef.current = true
      clearSessionState()
      notify(t(languageRef.current, 'toast.sessionExpired'), 'error')
    },
    [clearSessionState, isActiveSessionRequestToken, notify],
  )

  const offlineConnectivityUnavailable = connectivityUnavailable(connectivity)
  useEffect(() => {
    // This timer governs an offline snapshot that has actually been mounted. A
    // transport failure during post-auth bootstrap has no offline authorization
    // to expire and must remain under the workspace recovery owner.
    if (!session || !offlineConnectivityUnavailable || !offlineDataActive) return undefined
    // A verified session that is still completing its read-only workspace
    // bootstrap must survive gateway/restart evidence. The recovery task owns
    // the retry UI; only an authoritative auth response may clear this handoff.
    if (!applicationsLoaded && workspaceBootstrapRecoveryRef.current) return undefined

    const access = offlineAccessForSession(session)
    const accessExpiryMs = access.expiresAt ? Date.parse(access.expiresAt) : Number.NaN
    const snapshotExpiryMs = offlineAccessExpiresAt ? Date.parse(offlineAccessExpiresAt) : Number.NaN
    const effectiveExpiryMs = Number.isFinite(snapshotExpiryMs)
      ? Math.min(snapshotExpiryMs, accessExpiryMs)
      : accessExpiryMs

    const endOfflineAccess = () => {
      setManualOfflineMode(false)
      clearSessionState()
      notify(t(languageRef.current, 'offlineStatus.authorizationExpired'), 'warning')
    }

    if (!access.allowed || !Number.isFinite(effectiveExpiryMs) || effectiveExpiryMs <= Date.now()) {
      endOfflineAccess()
      return undefined
    }

    const timeout = window.setTimeout(
      endOfflineAccess,
      Math.min(2_147_000_000, Math.max(0, effectiveExpiryMs - Date.now())),
    )
    return () => window.clearTimeout(timeout)
  }, [
    applicationsLoaded,
    clearSessionState,
    notify,
    offlineConnectivityUnavailable,
    offlineAccessExpiresAt,
    offlineDataActive,
    session,
  ])

  useEffect(() => {
    setInterviewWorkspaces({})
    setInterviewSelectedStudentId(null)
    setInterviewLoadingScope(null)
    dirtyInterviewScopeKeysRef.current.clear()
    interviewLoadSequenceRef.current += 1
  }, [session?.user.id])

  useEffect(() => {
    if (
      screen !== 'interview'
      || !session
      || !canUseInterview
      || !interviewSubjectUserId
      || interviewWorkspaces[interviewScopeKey]
      || offlineConnectivityUnavailable
    ) return undefined

    const sequence = ++interviewLoadSequenceRef.current
    const controller = new AbortController()
    setInterviewLoadingScope(interviewScopeKey)
    void phdApi.getInterviewPrepWorkspace(
      getLatestSessionToken(session.token),
      { subjectUserId: interviewSubjectUserId, teamId: interviewTeamId },
      { signal: controller.signal },
    ).then((workspace) => {
      if (controller.signal.aborted || interviewLoadSequenceRef.current !== sequence) return
      setInterviewWorkspaces((current) => ({ ...current, [interviewScopeKey]: workspace }))
    }).catch((error) => {
      if (!controller.signal.aborted && interviewLoadSequenceRef.current === sequence && !isAuthExpired(error)) {
        notifyEnhancedError(error, languageRef.current, notify)
      }
    }).finally(() => {
      if (!controller.signal.aborted && interviewLoadSequenceRef.current === sequence) {
        setInterviewLoadingScope((current) => current === interviewScopeKey ? null : current)
      }
    })
    return () => controller.abort()
  }, [
    canUseInterview,
    interviewScopeKey,
    interviewSubjectUserId,
    interviewTeamId,
    interviewWorkspaces,
    notify,
    offlineConnectivityUnavailable,
    screen,
    session,
  ])

  const settingsSessionToken = screen === 'settings' ? session?.token : undefined
  useEffect(() => {
    if (!settingsSessionToken) return
    let cancelled = false
    void phdApi
      .listPasskeys(getLatestSessionToken(settingsSessionToken))
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
  }, [notify, settingsSessionToken])

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

  // The first-screen bootstrap intentionally omits correspondence bodies and
  // nested file histories. Hydrate the full record once a project is selected
  // so Dossier/Inspector receive the complete application without downloading
  // every record's private detail during startup.
  useEffect(() => {
    const selectedRecord = selected as (ApplicationRecord & { __listSlim?: boolean }) | null
    if (!selectedRecord?.__listSlim || !session?.token) return
    let cancelled = false
    const requestToken = session.token
    const selectedApplicationId = selectedRecord.id
    const controller = new AbortController()
    const detailRequest = loadApplicationDetailForNavigation(selectedApplicationId, controller.signal)
    if (!detailRequest) return undefined
    detailRequest
      .then((full) => {
        if (cancelled || controller.signal.aborted || !isCurrentSessionToken(requestToken)) return
        setApplications((items) => items.map((item) => item.id === full.id ? full : item))
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted || isAbortLike(error) || isAuthExpired(error)) return
        notify(normalizeError(error, languageRef.current), 'error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isCurrentSessionToken, loadApplicationDetailForNavigation, notify, selected, session?.token])

  // Jump intents are transient and application-scoped. Any ordinary route or
  // record change invalidates an unconsumed intent so it cannot replay when a
  // keyed dossier mounts later.
  useEffect(() => {
    if (!workspaceJumpIntent) return
    if (screen === 'workspace' && selectedId === workspaceJumpIntent.applicationId) return
    consumeWorkspaceJumpIntent(workspaceJumpIntent.token)
  }, [consumeWorkspaceJumpIntent, screen, selectedId, workspaceJumpIntent])

  const applyWorkspaceDataRef = useRef(applyWorkspaceData)
  const applyWorkspaceSnapshotRef = useRef(applyWorkspaceSnapshot)
  applyWorkspaceDataRef.current = applyWorkspaceData
  applyWorkspaceSnapshotRef.current = applyWorkspaceSnapshot

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
        const outcome = await runWorkspaceBootstrapWithRecovery({
          session: initialSession,
          sessionEpoch: requestEpoch,
          execute: async (signal) => {
            const criticalAssets = warmCriticalScreenAssets(
              initialScreenRef.current,
              initialTabRef.current,
              initialLanguageRef.current,
              initialViewModeRef.current,
            )
            const data = await fetchWorkspaceData(initialSession, signal)
            await criticalAssets
            signal.throwIfAborted()
            if (!workspaceBootstrapStillOwnsSession(initialSession, requestEpoch)) {
              throw new ApiError(
                'The authenticated session changed before the workspace finished loading.',
                'SESSION_SUPERSEDED',
                409,
              )
            }
            if (data.me?.user?.id !== initialSession.user.id) {
              throw new ApiError('Session identity mismatch. Please sign in again.', 'SESSION_IDENTITY_MISMATCH', 409)
            }
            // Re-seed only while this boot's token is still the live session tip
            // (or chains to it). Never re-introduce a token after a fresh login.
            const liveToken = currentSessionTokenRef.current
            if (
              liveToken
              && (liveToken === initialSession.token || getLatestSessionToken(initialSession.token) === liveToken)
            ) rememberSessionToken(initialSession.token)

            const applied = await applyWorkspaceDataRef.current(initialSession, data, requestEpoch)
            if (!applied) {
              throw new ApiError(
                'The authenticated session changed before the workspace finished loading.',
                'SESSION_SUPERSEDED',
                409,
              )
            }
            try {
              localStorage.removeItem(ONBOARDING_SAMPLE_ACTIVE_KEY)
            } catch {}
            let onboardingDone = false
            try {
              onboardingDone = localStorage.getItem(ONBOARDING_DONE_KEY) === '1'
            } catch {}
            const initialRoute = parseRoute(window.location.pathname)
            const shouldShowPersonalOnboarding =
              !initialSession.impersonation?.teamId
              && initialRoute?.interfaceMode !== 'team'
              && initialRoute?.screen !== 'team'
            if (shouldShowPersonalOnboarding && !onboardingDone && data.nextApps.length === 0) {
              setShowOnboarding(true)
            }
          },
        })
        if (outcome.status !== 'deferred' || !isNetworkLikeError(outcome.error)) return

        const snapshot = loadOfflineSnapshot(initialSession)
        if (!snapshot || !workspaceBootstrapStillOwnsSession(initialSession, requestEpoch)) return
        applyWorkspaceSnapshotRef.current(snapshot.data, { offline: true })
        setOfflineDataActive(true)
        setOfflineSnapshotSavedAt(snapshot.savedAt)
        setOfflineAccessExpiresAt(snapshot.authorization.expiresAt)
        refreshOfflineQueueCounts(initialSession.user.id)
        resetWorkspaceBootstrapRecovery()
        notify(t(languageRef.current, 'toast.offlineSnapshotLoaded'), 'info')
      } catch (error) {
        if (isAuthExpired(error)) {
          expireSession(initialSession.token)
        } else if (
          isWorkspaceIdentityMismatch(error)
          && workspaceBootstrapStillOwnsSession(initialSession, requestEpoch)
        ) {
          sessionExpiredRef.current = true
          clearSessionState()
          notify(normalizeError(error, languageRef.current), 'error')
        }
      }
    })()
  }, [
    clearSessionState,
    expireSession,
    notify,
    refreshOfflineQueueCounts,
    rememberSessionToken,
    resetWorkspaceBootstrapRecovery,
    runWorkspaceBootstrapWithRecovery,
    workspaceBootstrapStillOwnsSession,
  ])

  const persistSessionRef = useRef(persistSession)
  persistSessionRef.current = persistSession

  // Cross-tab identity isolation: another tab signing into a different account must
  // not leave this tab writing under the old identity (or reading the new one as if
  // it were still the old one).
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== SESSION_KEY) return
      if (event.storageArea && event.storageArea !== localStorage) return

      const transitionGeneration = ++crossTabSessionTransitionGenerationRef.current
      const mountedUserId = currentSessionUserIdRef.current
      const mountedIdentityEpoch = sessionIdentityEpochRef.current
      const eventValue = event.newValue
      const transitionIsStillLatest = () => {
        if (crossTabSessionTransitionGenerationRef.current !== transitionGeneration) return false
        if (sessionIdentityEpochRef.current !== mountedIdentityEpoch) return false
        if (currentSessionUserIdRef.current !== mountedUserId) return false
        try {
          // Storage may already contain a newer value before its queued event is
          // delivered. Exact comparison prevents the older callback from ever
          // being persisted during that gap.
          return localStorage.getItem(SESSION_KEY) === eventValue
        } catch {
          return false
        }
      }

      if (event.newValue == null) {
        if (mountedUserId) {
          void prepareForSafeReload({ reason: 'remote-logout' }).then((allowed) => {
            if (!transitionIsStillLatest()) return
            if (allowed) clearSessionState()
            else clearClientSessionCaches()
          })
        }
        return
      }
      const remote = safeParseJson<AuthSession>(event.newValue)
      if (!remote?.user?.id || !remote.token) return
      if (remote.user.id === mountedUserId) {
        // Same account: adopt a fresher token from the other tab without swapping user.
        if (!transitionIsStillLatest()) return
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
      // Flush under the old account before changing any identity-owned state.
      // A blocked reload leaves the resident editor mounted and keeps its
      // recovery namespace isolated from the account opened in the other tab.
      void prepareForSafeReload({ reason: 'identity-change' }).then((allowed) => {
        if (!allowed || !transitionIsStillLatest()) return
        persistSessionRef.current(remote)
        reloadPage()
      })
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
    if (!session || !applicationsLoaded || connectivity.manualOffline || connectivity.serverReachable !== true) return
    if (offlineQueueSize(session.user.id) > 0) {
      void syncOfflineQueue(session)
    } else if (offlineDataActive) {
      void refreshAll(session).catch((error) => {
        if (!isNetworkLikeError(error) && !isAuthExpired(error)) {
          notify(normalizeError(error, languageRef.current), 'error')
        }
      })
    }
    // The sync/refresh functions are intentionally not dependencies; this
    // effect is driven by durable connectivity and local-workspace state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applicationsLoaded,
    connectivity.manualOffline,
    connectivity.serverReachable,
    offlineDataActive,
    offlineQueueCount,
    session?.token,
    session?.user.id,
  ])

  useEffect(() => {
    if (!session || !applicationsLoaded || offlineDataActive || !connectivityUnavailable(connectivity)) return
    runWithNavigationGuard(() => activateSecureOfflineWorkspace(session))
    // Entering offline mode is a security transition. Mount a freshly filtered
    // personal-only workspace even when the full online workspace was already
    // in memory; Team, admin-adjacent and capability data must not linger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applicationsLoaded,
    connectivity.manualOffline,
    connectivity.mode,
    offlineDataActive,
    session?.token,
    session?.user.id,
  ])

  // Cleanup non-toast timers owned directly by App.
  useEffect(() => {
    return () => {
      cancelScheduledOfflineSnapshotSave()
    }
  }, [])

  const realtimeUpdates = useRealtimeUpdates({
    token: session?.token ?? null,
    enabled: Boolean(
      session && applicationsLoaded && !connectivityUnavailable(connectivity) && !connectivity.manualOffline,
    ),
    onInvalidate: (scopes) => {
      const active = session
      const sourceToken = currentSessionTokenRef.current
      if (!active || !sourceToken || !isCurrentSessionToken(sourceToken)) return
      const token = getLatestSessionToken(sourceToken)

      if (scopes.has('applications')) {
        void phdApi
          .listApplications(token)
          .then((items) => {
            if (!isCurrentSessionToken(sourceToken)) return
            // The editor's own save echoes back through this stream. Reuse the
            // records it already holds so an echo cannot re-render the open
            // application and close whatever popover is being typed into.
            setApplications((current) => mergeApplicationListPreservingIdentity(current, items))
          })
          .catch(() => {})
      }
      if (scopes.has('profile-assets')) {
        void phdApi
          .listProfileAssets(token)
          .then((items) => {
            if (isCurrentSessionToken(sourceToken)) setProfileAssets(items)
          })
          .catch(() => {})
      }
      if (scopes.has('backups')) {
        void phdApi
          .listBackups(token)
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
        void phdApi
          .listAiKeys(token)
          .then((items) => {
            if (isCurrentSessionToken(sourceToken)) setAiKeys(items)
          })
          .catch(() => {})
      }
      if (scopes.has('discover')) {
        setDiscoverRealtimeRevision((revision) => revision + 1)
      }
      if (
        scopes.has('interview')
        && screen === 'interview'
        && canUseInterview
        && interviewSubjectUserId
        && !dirtyInterviewScopeKeysRef.current.has(interviewScopeKey)
      ) {
        const sequence = ++interviewLoadSequenceRef.current
        const scopeKey = interviewScopeKey
        void phdApi
          .getInterviewPrepWorkspace(token, {
            subjectUserId: interviewSubjectUserId,
            teamId: interviewTeamId,
          })
          .then((workspace) => {
            if (
              isCurrentSessionToken(sourceToken)
              && interviewLoadSequenceRef.current === sequence
              && !dirtyInterviewScopeKeysRef.current.has(scopeKey)
            ) {
              setInterviewWorkspaces((current) => ({ ...current, [scopeKey]: workspace }))
            }
          })
          .catch(() => {})
      }
      if (scopes.has('notifications')) {
        void phdApi
          .unreadNotificationCount(token)
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

  // The stream is the primary badge refresh path. A single shared poller keeps
  // current installations usable when an intermediary blocks streaming responses.
  useVisibilityAwarePolling({
    enabled: Boolean(
      session && applicationsLoaded && !realtimeUpdates.connected && !connectivityUnavailable(connectivity),
    ),
    initialDelayMs: 3_000,
    intervalMs: 5 * 60_000,
    restartKey: `${session?.user.id ?? ''}:${applicationsLoaded ? 'ready' : 'loading'}`,
    poll: async (signal) => {
      const sourceToken = currentSessionTokenRef.current
      if (!sourceToken || !isCurrentSessionToken(sourceToken)) return
      try {
        const result = await phdApi.unreadNotificationCount(getLatestSessionToken(sourceToken), { signal })
        if (!signal.aborted && isCurrentSessionToken(sourceToken)) {
          setUnreadNotificationCount(result.count)
        }
      } catch {
        // Realtime remains the primary path; transient fallback failures are quiet.
      }
    },
  })

  const shortcutRuntimeRef = useRef({
    activeImpersonationTeamId: session?.impersonation?.teamId,
    isDraftDirty,
    isTeamMode,
    openNewApplicationDialog,
    openWorkspaceBoard,
    runAnimatedDossierUpdate,
    runAnimatedScreenUpdate,
    runWithNavigationGuard,
    saveCurrentDraft,
    screen,
    selectedId,
    switchWorkspaceMode,
    tab,
    viewMode,
  })
  shortcutRuntimeRef.current = {
    activeImpersonationTeamId: session?.impersonation?.teamId,
    isDraftDirty,
    isTeamMode,
    openNewApplicationDialog,
    openWorkspaceBoard,
    runAnimatedDossierUpdate,
    runAnimatedScreenUpdate,
    runWithNavigationGuard,
    saveCurrentDraft,
    screen,
    selectedId,
    switchWorkspaceMode,
    tab,
    viewMode,
  }

  // Keyboard shortcuts stay global but avoid hijacking rich text editing keys.
  useEffect(function () {
    function isEditingText(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (!target) return false
      const tag = target.tagName?.toLowerCase()
      return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
    }

    function handleKey(event: KeyboardEvent) {
      const runtime = shortcutRuntimeRef.current
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
          runtime.runWithNavigationGuard(() => startTransition(action))
        }

        if (pendingGo != null && now - pendingGo <= 900) {
          pendingGoShortcutRef.current = null
          if (key === 'd') {
            navigateWithShortcut(() => {
              if (runtime.isTeamMode) {
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
              if (runtime.isTeamMode) {
                setTeamSection('applications')
                setViewModeDirection('to-list')
                setViewMode('list')
                setMobileDetailOpen(false)
                setScreen('workspace')
              } else {
                runtime.openWorkspaceBoard()
              }
            })
            return
          }
          if (key === 'p') {
            if (runtime.activeImpersonationTeamId) return
            navigateWithShortcut(() => {
              if (runtime.isTeamMode) {
                void runtime.switchWorkspaceMode('personal', {
                  screen: 'profile',
                })
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
              void runtime.switchWorkspaceMode('team', {
                screen: 'team',
                teamSection: 'overview',
              })
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
        const accessibleShortcutTabs = runtime.isTeamMode ? shortcutTabs : shortcutTabs.slice(0, -1)
        const tabIndex = Number(event.key) - 1
        if (
          tabIndex >= 0 &&
          tabIndex < accessibleShortcutTabs.length &&
          !editingText &&
          runtime.screen === 'workspace' &&
          runtime.viewMode === 'list' &&
          Boolean(runtime.selectedId)
        ) {
          event.preventDefault()
          const nextTab = accessibleShortcutTabs[tabIndex]
          const direction =
            accessibleShortcutTabs.indexOf(nextTab) >= accessibleShortcutTabs.indexOf(runtime.tab)
              ? 'forward'
              : 'backward'
          runtime.runAnimatedDossierUpdate(() => setTab(nextTab), {
            scope: 'dossier-tab',
            direction,
          })
        }
        return
      }

      if (key === 's') {
        event.preventDefault()
        if (runtime.selectedId && runtime.isDraftDirty) {
          void runtime.saveCurrentDraft()
        }
        return
      }

      if (editingText) return

      if (key === 'f') {
        if (runtime.screen !== 'workspace') return
        event.preventDefault()
        const input = document.querySelector('.application-pane .search-field input') as HTMLInputElement | null
        input?.focus()
        return
      }

      if (key === 'n' && !runtime.isTeamMode) {
        event.preventDefault()
        runtime.openNewApplicationDialog(null)
        return
      }

      if (key === 'b' && runtime.screen === 'workspace') {
        event.preventDefault()
        runtime.runAnimatedScreenUpdate(() => {
          setWorkspaceLayout((current) => ({
            ...current,
            applicationsHidden: !current.applicationsHidden,
          }))
        })
        return
      }

      if (key === 'i' && runtime.screen === 'workspace') {
        event.preventDefault()
        runtime.runAnimatedScreenUpdate(() => {
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorHidden: !current.inspectorHidden,
          }))
        })
      }
    }

    window.addEventListener('keydown', handleKey)
    return function () {
      window.removeEventListener('keydown', handleKey)
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id || !applicationsLoaded) return undefined
    if (isJsdomRuntime()) return undefined
    // Optional route chunks are intentionally absent from the HTML entry. Warm
    // them one at a time only during a visible, online, unmetered idle window;
    // Rail pointer/focus intent still bypasses this background queue.
    const warmupTasks: RouteWarmupTask[] = [
      loadApplicationPane,
      loadKanbanBoard,
      loadInspector,
    ]
    // Keep automatic transfer to three small, frequently adjacent workspace
    // surfaces. Heavy routes and rich editors load on navigation or explicit
    // Rail pointer/focus intent instead of consuming a background data budget.
    return scheduleIdleRouteWarmups(warmupTasks, { maxTasks: 3 })
  }, [applicationsLoaded, session?.user.id])

  useEffect(() => {
    if (!session || screen !== 'workspace' || !applicationsLoaded) return
    if (workspaceApplications.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      if (draftRef.current !== null) setDraftState(null, { clean: true })
      return
    }
    if (renderedWorkspaceViewMode === 'kanban' && canUseWorkspaceBoard) {
      // Cleanup is bookkeeping after the board has painted, never part of the
      // board's first interactive commit.
      startTransition(() => {
        if (selectedId !== null) setSelectedId(null)
        if (draftRef.current !== null) setDraftState(null, { clean: true })
        setWorkspaceJumpIntent(null)
      })
      return
    }
    if (viewMode === 'kanban' && !canUseWorkspaceBoard) {
      setViewModeDirection('to-list')
      setViewMode('list')
      return
    }
    if (!selectedId || !workspaceApplicationById.has(selectedId)) {
      const myApps = workspaceApplications.filter(function (a) {
        return a.ownerId === session.user.id
      })
      setSelectedId(myApps[0]?.id ?? workspaceApplications[0]?.id ?? null)
    }
  }, [
    applicationsLoaded,
    canUseWorkspaceBoard,
    screen,
    selectedId,
    session,
    setDraftState,
    renderedWorkspaceViewMode,
    viewMode,
    workspaceApplicationById,
    workspaceApplications,
  ])

  useEffect(() => {
    if (!workspaceOpeningFromDashboard) return undefined

    const timer = window.setTimeout(() => setWorkspaceOpeningFromDashboard(false), 320)
    return () => window.clearTimeout(timer)
  }, [workspaceOpeningFromDashboard])

  useEffect(() => {
    if (screen === 'workspace' || !workspaceBoardResident) return
    setWorkspaceBoardResident(false)
  }, [screen, workspaceBoardResident])

  useEffect(
    () => () => {
      if (workspaceViewExitTimerRef.current !== null) {
        window.clearTimeout(workspaceViewExitTimerRef.current)
      }
      clearDetailDraftHydration()
    },
    [clearDetailDraftHydration],
  )

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

    const commitRecentSelection = () => {
      startTransition(() => {
        setRecentOpenedIds((current) => {
          const next = [selectedId, ...current.filter((id) => id !== selectedId)].slice(0, RECENT_OPENED_LIMIT)
          return next.every((id, index) => id === current[index]) && next.length === current.length ? current : next
        })
      })
    }

    if (isJsdomRuntime()) {
      commitRecentSelection()
      return
    }

    // Dashboard recency is bookkeeping, not click feedback. Keep its whole-App
    // render outside the dossier's compositor interval.
    const timer = window.setTimeout(commitRecentSelection, 240)
    return () => window.clearTimeout(timer)
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
      const targetPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const parsed = parseRoute(window.location.pathname)
      const proceed = () => {
        // A guarded popstate temporarily restores the resident route below.
        // Re-apply the user's original destination only after Save/Discard has
        // acknowledged the editor exit, then commit the matching React state.
        window.history.replaceState(null, '', targetPath)
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

      const guard = navigationGuardRef.current
      if (guard?.(proceed)) {
        // popstate has already changed the address bar. Keep the resident
        // editor and URL aligned while its Save/Discard/Cancel choice is open.
        window.history.pushState(null, '', pathForRoute(screen, selectedId, tab, teamSection, interfaceMode))
        return
      }
      proceed()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [interfaceMode, screen, selectedId, setDraftState, tab, teamSection])

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

  useEffect(() => {
    const accent = normalizeThemeAccent(session?.user.settings.themeAccent ?? localStorage.getItem('phd-atlas-accent'))
    applyThemePreset(accent)
    try {
      safeSetItem('phd-atlas-accent', accent)
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }, [session?.user.settings.themeAccent])

  useEffect(() => {
    const userId = session?.user.id ?? null
    const version = Number.isSafeInteger(session?.user.settingsVersion)
      ? Number(session?.user.settingsVersion)
      : 0
    const tracked = settingsCommitVersionRef.current
    settingsCommitVersionRef.current = tracked.userId === userId
      ? { userId, version: Math.max(tracked.version, version) }
      : { userId, version }
  }, [session?.user.id, session?.user.settingsVersion])

  function persistSession(nextSession: AuthSession, handoffGeneration?: number) {
    if (
      handoffGeneration !== undefined
      && authenticationHandoffGenerationRef.current !== handoffGeneration
    ) return false
    if (handoffGeneration === undefined) authenticationHandoffGenerationRef.current += 1
    sessionExpiredRef.current = false
    cancelledRef.current = false
    const identityChanged = currentSessionUserIdRef.current !== nextSession.user.id
    resetWorkspaceBootstrapRecovery()
    invalidateOfflineSync()
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
    settingsCommitVersionRef.current = {
      userId: nextSession.user.id,
      version: Number.isSafeInteger(nextSession.user.settingsVersion)
        ? Number(nextSession.user.settingsVersion)
        : 0,
    }
    resetSessionTokenLineage(nextSession.token)
    if (identityChanged) {
      setAiKeys([])
      setNotifications([])
      setNotificationsLoading(false)
      setUnreadNotificationCount(0)
      setNotificationCenterOpen(false)
      setPasskeys([])
      setTeamWorkspaces([])
      setTeamSummary(null)
      setTeamApplications([])
      setActiveTeamId(null)
      activeTeamIdRef.current = null
    }
    // Keep the cancelled flag off so a fresh login after a failed boot can load.
    cancelledRef.current = false
    // Authentication is a semantic boundary: expiry/error notices from the
    // previous token lineage must never follow the newly signed-in identity.
    clearToasts()
    setSession(nextSession)
    safeSetJson(SESSION_KEY, nextSession)
    return true
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
      if (!current || current.user.id !== requestUserId || sessionIdentityEpochRef.current !== requestEpoch) {
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
      if (tokenSubject && currentSessionUserIdRef.current && tokenSubject !== currentSessionUserIdRef.current) {
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

  async function runOrThrow(action: () => Promise<void>, success?: string) {
    try {
      setBusy(true)
      await action()
      if (success) notify(success)
    } catch (error) {
      if (isAuthExpired(error)) return Promise.reject(error)
      if (isNetworkLikeError(error)) {
        notify(i18nValue.tx('toast.offlineActionNeedsOnline'), 'error')
      } else {
        notify(normalizeError(error, languageRef.current), 'error')
      }
      throw error
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

  async function runApplicationMutation<T>(applicationId: string, action: () => Promise<T>): Promise<T | undefined> {
    const saveToken = beginExternalApplicationSave()
    try {
      const result = await enqueueApplicationWrite(applicationId, action)
      finishExternalApplicationSave(saveToken, { status: 'saved' })
      return result
    } catch (error) {
      if (isAuthExpired(error)) {
        resetApplicationAutoSave()
        return undefined
      }
      failExternalApplicationSave(
        saveToken,
        isNetworkLikeError(error)
          ? i18nValue.tx('toast.offlineActionNeedsOnline')
          : normalizeError(error, languageRef.current),
      )
      return undefined
    }
  }

  function runInteractiveApplicationMutation<T>(
    applicationId: string,
    action: () => Promise<T>,
    successMessage?: string,
  ) {
    return runInteractive(async () => {
      await enqueueApplicationWrite(applicationId, action)
    }, successMessage)
  }

  async function fetchWorkspaceData(
    activeSession: AuthSession,
    signal?: AbortSignal,
    requestedTeamId = activeTeamIdRef.current,
  ) {
    const requestToken = activeSession.token
    const lockedTeamId = PUBLIC_EDITION ? null : (activeSession.impersonation?.teamId ?? null)
    const preferredTeamId = PUBLIC_EDITION ? null : (lockedTeamId ?? requestedTeamId)
    const bootstrap = await phdApi.workspaceBootstrap(requestToken, preferredTeamId, { signal })
    if (!bootstrap || !Array.isArray(bootstrap.applications) || !Array.isArray(bootstrap.teamWorkspaces)) {
      throw new ApiError('Workspace bootstrap payload is unavailable.', 'WORKSPACE_BOOTSTRAP_UNAVAILABLE', 502)
    }
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
  }

  async function waitForRemovalHandoff<T>(mutation: Promise<T>): Promise<T> {
    const [mutationResult] = await Promise.allSettled([
      mutation,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, getMotionDelay(380))
      }),
    ])
    if (mutationResult.status === 'rejected') throw mutationResult.reason
    return mutationResult.value
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
        sessionIdentityEpochRef.current !== requestEpoch ||
        currentSessionUserIdRef.current !== activeSession.user.id ||
        data.me?.user?.id !== activeSession.user.id
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
      teamWorkspaces: PUBLIC_EDITION ? [] : data.teamWorkspaces,
      activeTeamId: PUBLIC_EDITION ? null : data.activeTeamId,
      teamSummary: PUBLIC_EDITION ? null : data.team,
      teamApplications: PUBLIC_EDITION ? [] : data.teamApps,
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

  async function performRefreshAll(
    activeSession: AuthSession,
    requestEpoch: number,
    expectedTeamId: string | null,
    signal: AbortSignal,
  ) {
    const criticalAssets = warmCriticalScreenAssets(screen, tab, lang, viewMode)
    const data = await fetchWorkspaceData(activeSession, signal, expectedTeamId)
    await criticalAssets
    signal.throwIfAborted()
    if (requestEpoch !== sessionIdentityEpochRef.current) return false
    if (currentSessionUserIdRef.current !== activeSession.user.id) return false
    if ((activeSession.impersonation?.teamId ?? activeTeamIdRef.current) !== expectedTeamId) return false
    if (data.me?.user?.id !== activeSession.user.id) {
      throw new ApiError('Session identity mismatch. Please sign in again.', 'SESSION_IDENTITY_MISMATCH', 409)
    }
    return applyWorkspaceData(activeSession, data, requestEpoch)
  }

  async function refreshAll(activeSession = session) {
    if (!activeSession || cancelledRef.current) return false
    const requestToken = activeSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return false
    rememberSessionToken(requestToken)
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return false
    const expectedTeamId = activeSession.impersonation?.teamId ?? activeTeamIdRef.current
    const requestKey = `${activeSession.user.id}:${requestToken}:${expectedTeamId ?? ''}:${requestEpoch}`
    try {
      return await workspaceRefreshTasksRef.current.run('all', requestKey, (signal) =>
        performRefreshAll(activeSession, requestEpoch, expectedTeamId, signal),
      )
    } catch (error) {
      if (isAbortLike(error)) return false
      throw error
    }
  }

  async function bootstrapEstablishedSession(
    activeSession: AuthSession,
    sessionEpoch: number,
    onLoaded: () => void,
  ) {
    return runWorkspaceBootstrapWithRecovery({
      session: activeSession,
      sessionEpoch,
      execute: async (signal) => {
        signal.throwIfAborted()
        const cancelRefresh = () => workspaceRefreshTasksRef.current.cancel()
        signal.addEventListener('abort', cancelRefresh, { once: true })
        try {
          const loaded = await refreshAll(activeSession)
          signal.throwIfAborted()
          if (!loaded) {
            throw new ApiError(
              'The authenticated session changed before the workspace finished loading.',
              'SESSION_SUPERSEDED',
              409,
            )
          }
        } finally {
          signal.removeEventListener('abort', cancelRefresh)
        }
      },
      onLoaded,
    })
  }

  async function establishDesktopWorkspace(nextSession: AuthSession, runtime?: DesktopRuntime | null) {
    const handoffGeneration = authenticationHandoffGenerationRef.current + 1
    authenticationHandoffGenerationRef.current = handoffGeneration
    setBusy(true)
    try {
      if (runtime) {
        rememberDesktopRuntime(runtime)
        setDesktopRuntimeState(runtime)
      }
      if (!persistSession(nextSession, handoffGeneration)) return false
      const outcome = await bootstrapEstablishedSession(nextSession, sessionIdentityEpochRef.current, () => undefined)
      if (outcome.status !== 'loaded') return false
      if (!authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, sessionIdentityEpochRef.current)) {
        return false
      }
      setDesktopUnlockError(null)
      setDesktopGate('open')
      return true
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DESKTOP_UNLOCK_REQUIRED') {
        setDesktopGate('unlock')
        return false
      }
      if (handleAuthoritativeWorkspaceBootstrapError(error, nextSession, sessionIdentityEpochRef.current)) {
        return false
      }
      setDesktopUnlockError(normalizeError(error, languageRef.current))
      setDesktopGate(error instanceof ApiError && error.code === 'DESKTOP_UNLOCK_REQUIRED' ? 'unlock' : 'error')
      return false
    } finally {
      if (appMountedRef.current) setBusy(false)
    }
  }
  establishDesktopWorkspaceRef.current = establishDesktopWorkspace

  async function refreshSessionMetadata(activeSession = session, options: { signal?: AbortSignal } = {}) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return
    const me = await phdApi.me(requestToken, options)
    if (options.signal?.aborted) return
    const committedSession = commitSessionMetadata(activeSession, me, requestToken, requestEpoch)
    const job = observeMailSyncJob(me.mailFetchStatus?.syncJob)
    // The stream publishes mail sync transitions, so a background sync now
    // usually completes through this ordinary session refresh — no poll needed.
    if (job && committedSession) void settleMailSyncJob(committedSession, job).catch(() => {})
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

  async function refreshApplicationsAndSessionMetadata(
    activeSession = session,
    options: { signal?: AbortSignal } = {},
  ) {
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    if (!isCurrentSessionToken(requestToken)) return
    const [, nextApplications] = await Promise.all([
      refreshSessionMetadata(activeSession, options),
      phdApi.listApplications(requestToken, options),
    ])
    if (options.signal?.aborted || !isCurrentSessionToken(requestToken)) return
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

  async function refreshTeamWorkspace(activeSession = session, preferredTeamId = activeTeamIdRef.current) {
    if (PUBLIC_EDITION) {
      setTeamWorkspaces([])
      setActiveTeamId(null)
      activeTeamIdRef.current = null
      setTeamSummary(null)
      setTeamApplications([])
      setTeamLookupComplete(true)
      return
    }
    if (!activeSession || cancelledRef.current) return
    const requestToken = activeSession.token
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return
    const lockedTeamId = activeSession.impersonation?.teamId ?? null
    const expectedTeamId = lockedTeamId ?? preferredTeamId
    const requestKey = `${activeSession.user.id}:${requestToken}:${expectedTeamId ?? ''}:${requestEpoch}`
    try {
      await workspaceRefreshTasksRef.current.run('team', requestKey, async (signal) => {
        const [me, workspaces] = await Promise.all([
          phdApi.me(requestToken, { signal }),
          phdApi.myTeamWorkspaces(requestToken, { signal }),
        ])
        signal.throwIfAborted()
        if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return

        const availableTeamIds = new Set(workspaces.map((workspace) => workspace.teamId))
        const resolvedTeamId =
          lockedTeamId && availableTeamIds.has(lockedTeamId)
            ? lockedTeamId
            : expectedTeamId && availableTeamIds.has(expectedTeamId)
              ? expectedTeamId
              : (workspaces[0]?.teamId ?? null)
        let team: TeamSummary | null = null
        let nextTeamApplications: TeamApplicationRecord[] = []
        if (resolvedTeamId) {
          ;[team, nextTeamApplications] = await Promise.all([
            phdApi.myTeam(requestToken, resolvedTeamId, { signal }),
            phdApi.listTeamApplications(requestToken, resolvedTeamId, {
              signal,
            }),
          ])
        }
        signal.throwIfAborted()
        if (!isMountedSessionIdentity(activeSession.user.id, requestToken, requestEpoch)) return
        if ((lockedTeamId ?? activeTeamIdRef.current) !== expectedTeamId) return

        const nextSession = commitSessionMetadata(activeSession, me, requestToken, requestEpoch)
        if (!nextSession) return
        activeTeamIdRef.current = resolvedTeamId
        startTransition(() => {
          setTeamWorkspaces(workspaces)
          setActiveTeamId(resolvedTeamId)
          setTeamSummary(team)
          setTeamApplications(nextTeamApplications)
          setTeamLookupComplete(true)
        })
      })
    } catch (error) {
      if (isAbortLike(error)) return
      throw error
    }
  }

  function switchActiveTeam(teamId: string) {
    if (!session || !teamId || teamId === activeTeamIdRef.current) return
    if (session.impersonation?.teamId && teamId !== session.impersonation.teamId) return
    runWithNavigationGuard(() => {
      const seq = ++workspaceHandoffSeqRef.current
      setWorkspaceHandoff({ target: 'team', variant: 'team' })
      activeTeamIdRef.current = teamId
      workspaceRefreshTasksRef.current.cancel('all')
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

  async function syncOfflineQueue(
    activeSession = session,
    options: { force?: boolean; userInitiated?: boolean } = {},
  ) {
    const requestEpoch = sessionIdentityEpochRef.current
    if (
      !activeSession ||
      cancelledRef.current ||
      (!options.force && connectivityUnavailable(connectivity)) ||
      !isMountedSessionIdentity(activeSession.user.id, activeSession.token, requestEpoch) ||
      offlineSyncRunRef.current
    )
      return 0

    // Every entry is retried, including ones an older build parked as blocked.
    // Disjoint personal edits merge; a divergent same-field edit is settled by
    // authoring time so reconnecting is always enough to drain the queue.
    const pendingQueue = readOfflineQueue(activeSession.user.id)
    if (pendingQueue.length === 0) return 0

    const run = {
      id: ++offlineSyncSequenceRef.current,
      userId: activeSession.user.id,
      sessionEpoch: requestEpoch,
    }
    offlineSyncRunRef.current = run
    const isCurrentRun = () => (
      offlineSyncRunRef.current?.id === run.id
      && offlineSyncRunRef.current.userId === run.userId
      && sessionIdentityEpochRef.current === run.sessionEpoch
      && currentSessionUserIdRef.current === run.userId
    )
    setSyncingOffline(true)
    let synced = 0
    let autoMerged = 0
    let discarded = 0
    let deferred = 0
    const syncedIds: string[] = []
    // A queued change whose target no longer accepts writes can never sync, no
    // matter how many times the server comes back. Those leave the queue here
    // instead of sitting behind a button that cannot do anything.
    const discardedIds: string[] = []

    try {
      let requestToken = getLatestSessionToken(activeSession.token)
      let serverApplications = await phdApi.listApplications(requestToken)
      if (!isCurrentRun()) return synced
      requestToken = getLatestSessionToken(requestToken)

      for (const operation of pendingQueue) {
        if (!isCurrentRun() || !isCurrentSessionToken(requestToken)) return synced
        const current = serverApplications.find((application) => application.id === operation.applicationId)
        const discard = () => {
          discardedIds.push(operation.id)
          discarded += 1
        }

        if (!current || (current.ownerId && current.ownerId !== activeSession.user.id)) {
          discard()
          continue
        }
        // Same person, two devices: settle any same-field divergence by
        // authoring time rather than parking the change for manual recovery.
        const mergeResult = mergeOfflineApplicationUpdate(operation, current, { autoResolve: true })
        if (!mergeResult) {
          discard()
          continue
        }
        if (mergeResult.autoResolved.length > 0) autoMerged += 1
        if (!mergeResult.replayRequired) {
          // The server already owns every winning value. Clearing the queued
          // operation is the save: do not write an identical record merely to
          // manufacture a newer server timestamp.
          syncedIds.push(operation.id)
          synced += 1
          continue
        }

        try {
          const mutation = await phdApi.replayOfflineApplicationUpdate(
            requestToken,
            mergeResult.application,
            // Without a server timestamp there is no delta baseline to verify
            // against, so replay the whole record rather than refusing to sync.
            current.updatedAt ? current : null,
          )
          const saved = mutation.application
          if (!isCurrentRun()) return synced
          requestToken = getLatestSessionToken(requestToken)
          serverApplications = serverApplications.map((application) =>
            application.id === saved.id ? saved : application,
          )
          syncedIds.push(operation.id)
          synced += 1
        } catch (error) {
          if (!isCurrentRun() || isAuthExpired(error)) throw error
          // One rejected replay must not abandon the rest of the queue, and it
          // must not surface as a bare "request failed" banner. The entry stays
          // pending so the next reconnect retries it against a fresh baseline.
          deferred += 1
        }
      }

      if (!isCurrentRun()) return synced
      removeOfflineQueueItems(activeSession.user.id, [...syncedIds, ...discardedIds])
      refreshOfflineQueueCounts(run.userId)

      if (synced > 0) {
        notify(tpl(i18nValue.tx('toast.offlineSyncComplete'), { count: synced }), 'success')
      }
      // Auto-merging is a silent overwrite unless it is named. Say that a
      // divergence was settled so the person can check the result.
      if (autoMerged > 0) {
        notify(tpl(i18nValue.tx('toast.offlineSyncAutoMerged'), { count: autoMerged }), 'info')
      }
      if (discarded > 0) {
        notify(tpl(i18nValue.tx('toast.offlineSyncDiscarded'), { count: discarded }), 'warning')
      }
      // Deferred entries retry on their own; only say so when the person asked
      // for this run and nothing at all moved.
      if (deferred > 0 && synced === 0 && options.userInitiated) {
        notify(tpl(i18nValue.tx('toast.offlineSyncDeferred'), { count: deferred }), 'info')
      }
      if (synced > 0 || discarded > 0) {
        await refreshAll({ ...activeSession, token: requestToken })
      }
    } catch (error) {
      if (!isCurrentRun()) return synced
      if (isAuthExpired(error)) return synced
      if (!isNetworkLikeError(error)) {
        // The queue survives; this run just could not finish. Keep the wording
        // in offline-sync terms instead of a generic request failure.
        notify(i18nValue.tx('toast.offlineSyncRetryLater'), 'info')
      }
    } finally {
      if (offlineSyncRunRef.current?.id === run.id) {
        offlineSyncRunRef.current = null
        if (
          sessionIdentityEpochRef.current === run.sessionEpoch
          && currentSessionUserIdRef.current === run.userId
        ) {
          setSyncingOffline(false)
          refreshOfflineQueueCounts(run.userId)
        }
      }
    }
    return synced
  }

  async function retryOfflineConnection() {
    if (connectivity.manualOffline) return
    // The panel stays open while the server is reachable (a queued change keeps it
    // there), so only announce a recovery that actually happened.
    const wasUnreachable = connectivity.serverReachable !== true
    const result = await probeServerConnectivity({ force: true })
    if (!result.serverReachable || !activeSession) {
      notify(i18nValue.tx('toast.connectionStillUnavailable'), 'info')
      return
    }

    if (wasUnreachable) notify(i18nValue.tx('toast.connectionRestored'), 'success')
    if (offlineQueueSize(activeSession.user.id) > 0) {
      // syncOfflineQueue refreshes the workspace itself once anything syncs,
      // and reports its own outcome in offline-sync wording.
      const synced = await syncOfflineQueue(activeSession, { force: true, userInitiated: true })
      if (synced !== 0) return
    }
    if (offlineDataActive) {
      try {
        await refreshAll(activeSession)
      } catch (error) {
        // This button's job is the sync, not this opportunistic refresh. A bare
        // "request failed" here reads as though retrying did nothing, which is
        // exactly the dead-end the queue no longer has.
        if (!isNetworkLikeError(error) && !isAuthExpired(error)) {
          notify(i18nValue.tx('toast.offlineSyncRetryLater'), 'info')
        }
      }
    }
  }

  function toggleManualOffline() {
    const next = !connectivity.manualOffline
    if (next && activeSession) {
      runWithNavigationGuard(() => {
        activateSecureOfflineWorkspace(activeSession)
        setManualOfflineMode(true)
        notify(i18nValue.tx('toast.manualOfflineEnabled'), 'info')
      })
      return
    }
    setManualOfflineMode(next)
    notify(i18nValue.tx('toast.manualOfflineDisabled'), 'info')
    void probeServerConnectivity({ force: true }).then((result) => {
      if (result.serverReachable && activeSession) {
        void syncOfflineQueue(activeSession, { force: true })
      }
    })
  }

  function requestPwaUpdateInstall() {
    runWithNavigationGuard(() => {
      void (async () => {
        if (isDraftDirty && !(await flushApplicationAutoSave())) return
        if (activatePwaUpdate()) setPwaUpdateReady(false)
      })()
    })
  }

  function replaceApplication(saved: ApplicationRecord, expectedDraftMutationVersion?: number) {
    setApplications((items) => items.map((item) => (item.id === saved.id ? saved : item)))
    // A teammate's application edited via the team workspace lives in teamApplications, not
    // applications — patch it there too so the change reflects without a full refetch. The
    // spread preserves the extra ownerName/ownerEmail/currentUserApplicationRole fields that
    // only this list carries (the saved ApplicationRecord from the API doesn't include them).
    setTeamApplications((items) => items.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)))
    const currentDraftMatchesBaseline = Boolean(
      draftRef.current && draftBaselineRef.current && JSON.stringify(draftRef.current) === draftBaselineRef.current,
    )
    const draftStillMatchesRequest =
      expectedDraftMutationVersion === undefined
        ? currentDraftMatchesBaseline
        : draftMutationVersionRef.current === expectedDraftMutationVersion
    if (draftRef.current?.id !== saved.id) return
    if (draftStillMatchesRequest) {
      setDraftState(cloneApplication(saved), { clean: true })
      return
    }

    // A user can keep typing while an autosave is in flight. Advance the
    // baseline to the server-confirmed revision without replacing those newer
    // local edits; the trailing save will then merge against the correct
    // updatedAt/version instead of replaying a stale baseline.
    const currentDraft = draftRef.current
    const nextDraft = {
      ...currentDraft,
      updatedAt: saved.updatedAt,
    }
    setDraftState(cloneApplication(saved), { clean: true })
    setDraftState(cloneApplication(nextDraft), {
      dirty: JSON.stringify(nextDraft) !== JSON.stringify(saved),
    })
  }

  function updateApplicationInState(
    applicationId: string,
    updater: (application: ApplicationRecord) => ApplicationRecord,
  ) {
    const versionBefore = draftBaselineVersionRef.current
    setApplications((items) => items.map((item) => (item.id === applicationId ? updater(item) : item)))
    // Mirror into teamApplications too, preserving its extra ownerName/ownerEmail/
    // currentUserApplicationRole fields that the plain ApplicationRecord updater doesn't know about.
    setTeamApplications((items) =>
      items.map((item) => (item.id === applicationId ? { ...item, ...updater(item) } : item)),
    )
    const currentDraft = draftRef.current
    if (currentDraft?.id !== applicationId || draftBaselineVersionRef.current !== versionBefore) return

    // Granular endpoints (task, fee, communication, etc.) may complete while a
    // different field is still waiting for its debounced autosave. Advance only
    // the affected part of the baseline and preserve every newer local edit.
    const currentBaseline =
      safeParseJson<ApplicationRecord>(draftBaselineRef.current) ??
      applications.find((application) => application.id === applicationId) ??
      currentDraft
    const nextBaseline = updater(currentBaseline)
    const nextDraft = updater(currentDraft)
    const remainsDirty = JSON.stringify(nextDraft) !== JSON.stringify(nextBaseline)
    setDraftState(cloneApplication(nextBaseline), { clean: true })
    setDraftState(cloneApplication(nextDraft), { dirty: remainsDirty })
  }

  function commitSchoolLogoApplication(saved: ApplicationRecord) {
    setApplications((items) => items.map((item) => (item.id === saved.id ? saved : item)))
    setTeamApplications((items) => items.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)))

    const currentDraft = draftRef.current
    if (!currentDraft || currentDraft.id !== saved.id) return
    const currentBaseline =
      safeParseJson<ApplicationRecord>(draftBaselineRef.current) ??
      applications.find((application) => application.id === saved.id) ??
      saved
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
    options: {
      silent?: boolean
      removed?: boolean
      expectedManualRevision?: number
    } = {},
  ) {
    const saved = await enqueueApplicationWrite(application.id, async () => {
      if (
        options.expectedManualRevision !== undefined &&
        (schoolLogoManualRevisionRef.current.get(application.id) ?? 0) !== options.expectedManualRevision
      )
        return null
      const acknowledgementBaseline = currentApplicationServerBaseline(application.id) ?? application
      return phdApi.updateSchoolLogo(activeSession.token, acknowledgementBaseline, {
        logo,
        autoDetect,
      })
    })
    if (!saved) return false
    if (!isCurrentSessionToken(activeSession.token)) return false
    commitSchoolLogoApplication(saved)
    if (!options.silent) {
      notify(i18nValue.tx(options.removed ? 'dossier.schoolLogoRemoved' : 'dossier.schoolLogoSaved'), 'success')
    }
    return true
  }

  function resolveAndStoreSchoolLogo(
    application: ApplicationRecord,
    input: {
      website?: string
      imageUrl?: string
      auto?: true
      refresh?: boolean
    },
    options: { silent?: boolean } = {},
  ) {
    const requestKind = input.imageUrl ? 'link' : input.auto ? 'auto' : 'website'
    const requestValue = input.auto
      ? `${application.school.name.trim()}::${input.website?.trim() || ''}`
      : input.imageUrl?.trim() || input.website?.trim() || ''
    const requestKey = `${activeSession.user.id}::${application.id}::${requestKind}::${input.refresh ? 'refresh' : 'cached'}::${requestValue}`
    return schoolLogoRequestsRef.current.run(
      requestKey,
      async () => {
        const currentManualRevision = schoolLogoManualRevisionRef.current.get(application.id) ?? 0
        const expectedManualRevision = input.auto ? currentManualRevision : currentManualRevision + 1
        if (!input.auto) {
          schoolLogoManualRevisionRef.current.set(application.id, expectedManualRevision)
        }
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
            ...(!input.imageUrl && (resolved.websiteUrl || input.website)
              ? {
                  websiteUrl: resolved.websiteUrl ?? input.website,
                  cacheKey: resolved.cacheKey,
                  candidateKind: resolved.candidateKind,
                }
              : {}),
            updatedAt: new Date().toISOString(),
          },
          Boolean(input.auto),
          { ...options, expectedManualRevision },
        )
      },
      { retainSettledResult: Boolean(input.auto && !input.refresh) },
    ).catch((error) => {
        if (!isAuthExpired(error) && !options.silent) {
          notify(schoolLogoErrorMessage(error), 'error')
        }
        return false
    })
  }

  async function uploadAndStoreSchoolLogo(application: ApplicationRecord, file: File) {
    const expectedManualRevision = (schoolLogoManualRevisionRef.current.get(application.id) ?? 0) + 1
    schoolLogoManualRevisionRef.current.set(application.id, expectedManualRevision)
    try {
      const dataUrl = await normalizeSchoolLogoFile(file)
      return await persistSchoolLogo(
        application,
        {
          dataUrl,
          source: 'upload',
          updatedAt: new Date().toISOString(),
        },
        false,
        { expectedManualRevision },
      )
    } catch (error) {
      if (!isAuthExpired(error)) notify(schoolLogoErrorMessage(error), 'error')
      return false
    }
  }

  async function removeStoredSchoolLogo(application: ApplicationRecord) {
    const expectedManualRevision = (schoolLogoManualRevisionRef.current.get(application.id) ?? 0) + 1
    schoolLogoManualRevisionRef.current.set(application.id, expectedManualRevision)
    try {
      return await persistSchoolLogo(application, null, false, {
        removed: true,
        expectedManualRevision,
      })
    } catch (error) {
      if (!isAuthExpired(error)) notify(schoolLogoErrorMessage(error), 'error')
      return false
    }
  }

  function removeApplicationFromState(applicationId: string) {
    const nextApplications = applications.filter((item) => item.id !== applicationId)
    setApplications(nextApplications)
    setTeamApplications((items) => items.filter((item) => item.id !== applicationId))
    replacePendingRecommenderDrafts(applicationId, [])
    if (draftRef.current?.id === applicationId) {
      setDraftState(null, { clean: true })
    }
    if (selectedId === applicationId && !isTeamMode) {
      setViewModeDirection('to-kanban')
      setViewMode('kanban')
      setMobileDetailOpen(false)
    }
    setSelectedId((current) => (current === applicationId ? null : current))
  }

  function removeApplicationsFromState(applicationIds: string[]) {
    const targets = new Set(applicationIds)
    const nextApplications = applications.filter((item) => !targets.has(item.id))
    setApplications(nextApplications)
    setTeamApplications((items) => items.filter((item) => !targets.has(item.id)))
    setPendingRecommenderDraftsByApplication((current) => {
      const next = { ...current }
      let changed = false
      for (const applicationId of targets) {
        if (!next[applicationId]) continue
        delete next[applicationId]
        changed = true
      }
      return changed ? next : current
    })
    if (draftRef.current && targets.has(draftRef.current.id)) {
      setDraftState(null, { clean: true })
    }
    if (selectedId && targets.has(selectedId) && !isTeamMode) {
      setViewModeDirection('to-kanban')
      setViewMode('kanban')
      setMobileDetailOpen(false)
    }
    setSelectedId((current) => (current && targets.has(current) ? null : current))
  }

  function authenticationHandoffStillOwnsSession(
    handoffGeneration: number,
    establishedSession: AuthSession,
    sessionEpoch: number,
  ) {
    return authenticationHandoffGenerationRef.current === handoffGeneration
      && workspaceBootstrapStillOwnsSession(establishedSession, sessionEpoch)
  }

  function handleAuthoritativeWorkspaceBootstrapError(
    error: unknown,
    establishedSession: AuthSession,
    sessionEpoch: number,
  ) {
    if (!appMountedRef.current || !workspaceBootstrapStillOwnsSession(establishedSession, sessionEpoch)) return true
    if (isAuthExpired(error)) {
      expireSession(establishedSession.token)
      return true
    }
    if (isWorkspaceIdentityMismatch(error)) {
      sessionExpiredRef.current = true
      clearSessionState()
      notify(normalizeError(error, languageRef.current), 'error')
      return true
    }
    return false
  }

  function retryWorkspaceBootstrap() {
    const existing = workspaceBootstrapManualRetryRef.current
    if (existing) return existing
    const task = workspaceBootstrapRecoveryRef.current
    if (!task || !workspaceBootstrapStillOwnsSession(task.session, task.sessionEpoch)) {
      return Promise.resolve()
    }

    const retryOwner = { promise: null as Promise<void> | null }
    const retryPromise = (async () => {
      if (!workspaceBootstrapStillOwnsSession(task.session, task.sessionEpoch)) return
      setWorkspaceBootstrapRetrying(true)
      let retryRunId = -1
      try {
        const outcomePromise = runWorkspaceBootstrapWithRecovery(task, { preserveFailure: true })
        retryRunId = workspaceBootstrapRunRef.current
        const outcome = await outcomePromise
        if (
          outcome.status === 'loaded'
          && !task.onLoaded
          && workspaceBootstrapStillOwnsSession(task.session, task.sessionEpoch)
        ) notify(i18nValue.tx('toast.connectionRestored'), 'success')
      } catch (error) {
        handleAuthoritativeWorkspaceBootstrapError(error, task.session, task.sessionEpoch)
      } finally {
        const ownsManualRetry = workspaceBootstrapManualRetryRef.current === retryOwner.promise
        if (ownsManualRetry) {
          workspaceBootstrapManualRetryRef.current = null
        }
        if (
          ownsManualRetry
          && appMountedRef.current
          && workspaceBootstrapRunRef.current === retryRunId
          && workspaceBootstrapStillOwnsSession(task.session, task.sessionEpoch)
        ) setWorkspaceBootstrapRetrying(false)
      }
    })()
    retryOwner.promise = retryPromise
    workspaceBootstrapManualRetryRef.current = retryPromise
    return retryPromise
  }

  function leaveWorkspaceBootstrapRecovery() {
    // This is an identity exit, not destructive logout. Keep the account-scoped
    // offline snapshot/queue so authored local work can be recovered after the
    // user signs back into the correct account.
    setManualOfflineMode(false)
    clearSessionState()
  }

  async function handleDesktopUnlock(password: string) {
    const handoffGeneration = authenticationHandoffGenerationRef.current + 1
    authenticationHandoffGenerationRef.current = handoffGeneration
    setBusy(true)
    setDesktopUnlockError(null)
    try {
      const payload = await phdApi.unlockDesktop(password)
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      if (payload.runtime) {
        rememberDesktopRuntime(payload.runtime)
        setDesktopRuntimeState(payload.runtime)
      }
      await establishDesktopWorkspace(payload, payload.runtime)
    } catch (error) {
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      setDesktopUnlockError(normalizeError(error, languageRef.current))
      setDesktopGate('unlock')
    } finally {
      if (appMountedRef.current && authenticationHandoffGenerationRef.current === handoffGeneration) setBusy(false)
    }
  }

  async function handleLogin(email: string, password: string) {
    const handoffGeneration = authenticationHandoffGenerationRef.current + 1
    authenticationHandoffGenerationRef.current = handoffGeneration
    setBusy(true)
    let establishedSession: AuthSession | null = null
    let establishedEpoch = -1
    try {
      const nextSession = await phdApi.login(email, password)
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      if (!persistSession(nextSession, handoffGeneration)) return
      establishedSession = nextSession
      establishedEpoch = sessionIdentityEpochRef.current
      const outcome = await bootstrapEstablishedSession(nextSession, establishedEpoch, () => {
        if (authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, establishedEpoch)) {
          notify(t(languageRef.current, 'toast.signedIn'))
        }
      })
      if (outcome.status !== 'loaded') return
      if (!authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, establishedEpoch)) return
    } catch (error) {
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      if (establishedSession) {
        if (!authenticationHandoffStillOwnsSession(handoffGeneration, establishedSession, establishedEpoch)) return
        if (handleAuthoritativeWorkspaceBootstrapError(error, establishedSession, establishedEpoch)) return
        setWorkspaceBootstrapFailure({
          error,
          sessionEpoch: establishedEpoch,
          userId: establishedSession.user.id,
        })
        return
      }
      notify(normalizeError(error, languageRef.current), 'error')
    } finally {
      if (appMountedRef.current && authenticationHandoffGenerationRef.current === handoffGeneration) setBusy(false)
    }
  }

  async function handlePasskeyLogin(email: string) {
    if (!passkeyAvailable) {
      notify(i18nValue.tx('passkeyUnavailable'), 'error')
      return
    }
    const handoffGeneration = authenticationHandoffGenerationRef.current + 1
    authenticationHandoffGenerationRef.current = handoffGeneration
    setBusy(true)
    let establishedSession: AuthSession | null = null
    let establishedEpoch = -1
    try {
      const [{ options }, { startAuthentication }] = await Promise.all([
        phdApi.beginPasskeyLogin(passkeyLoginEmailHint(email)),
        import('@simplewebauthn/browser'),
      ])
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      const assertion = await startAuthentication({
        optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      })
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      const nextSession = await phdApi.finishPasskeyLogin(assertion)
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      if (!persistSession(nextSession, handoffGeneration)) return
      establishedSession = nextSession
      establishedEpoch = sessionIdentityEpochRef.current
      const outcome = await bootstrapEstablishedSession(nextSession, establishedEpoch, () => {
        if (authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, establishedEpoch)) {
          notify(t(languageRef.current, 'toast.signedIn'))
        }
      })
      if (outcome.status !== 'loaded') return
      if (!authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, establishedEpoch)) return
    } catch (error) {
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      const cancelled = isPasskeyAbort(error)
      if (establishedSession) {
        if (!authenticationHandoffStillOwnsSession(handoffGeneration, establishedSession, establishedEpoch)) return
        if (handleAuthoritativeWorkspaceBootstrapError(error, establishedSession, establishedEpoch)) return
        setWorkspaceBootstrapFailure({
          error,
          sessionEpoch: establishedEpoch,
          userId: establishedSession.user.id,
        })
        return
      }
      notify(cancelled ? i18nValue.tx('passkeyCancelled') : normalizeError(error, languageRef.current), 'error')
    } finally {
      if (appMountedRef.current && authenticationHandoffGenerationRef.current === handoffGeneration) setBusy(false)
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
    const handoffGeneration = authenticationHandoffGenerationRef.current + 1
    authenticationHandoffGenerationRef.current = handoffGeneration
    setBusy(true)
    let establishedSession: AuthSession | null = null
    let establishedEpoch = -1
    try {
      const nextSession = await phdApi.register(
        name,
        email,
        password,
        captchaToken,
        captchaAnswer,
        resolvedEmailCodeToken,
        emailCode,
        resolvedLanguage,
      )
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      if (!persistSession(nextSession, handoffGeneration)) return
      establishedSession = nextSession
      establishedEpoch = sessionIdentityEpochRef.current
      const outcome = await bootstrapEstablishedSession(nextSession, establishedEpoch, () => {
        if (authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, establishedEpoch)) {
          notify(t(languageRef.current, 'toast.accountCreated'))
        }
      })
      if (outcome.status !== 'loaded') return
      if (!authenticationHandoffStillOwnsSession(handoffGeneration, nextSession, establishedEpoch)) return
    } catch (error) {
      if (authenticationHandoffGenerationRef.current !== handoffGeneration) return
      if (establishedSession) {
        if (!authenticationHandoffStillOwnsSession(handoffGeneration, establishedSession, establishedEpoch)) return
        if (handleAuthoritativeWorkspaceBootstrapError(error, establishedSession, establishedEpoch)) return
        setWorkspaceBootstrapFailure({
          error,
          sessionEpoch: establishedEpoch,
          userId: establishedSession.user.id,
        })
        return
      }
      notify(normalizeError(error, languageRef.current), 'error')
    } finally {
      if (appMountedRef.current && authenticationHandoffGenerationRef.current === handoffGeneration) setBusy(false)
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
    if (session) purgeOfflineAccountData(session.user.id)
    setManualOfflineMode(false)
    clearSessionState()
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false)
    cleanupTourSampleApplication(true)
  }

  function handleReplayTutorial() {
    try {
      localStorage.removeItem(ONBOARDING_DONE_KEY)
    } catch {}
    startOnboardingTour()
  }

  const startApplicationResize = useLatestCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    startWorkspaceResize('applications', event)
  })
  const resizeApplicationWithKeyboard = useLatestCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    handleWorkspaceResizeKey('applications', event)
  })
  const startInspectorResize = useLatestCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    startWorkspaceResize('inspector', event)
  })
  const resizeInspectorWithKeyboard = useLatestCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    handleWorkspaceResizeKey('inspector', event)
  })
  const applicationResizeLabel = i18nValue.tx('explorer.resizeApplications')
  const inspectorResizeLabel = i18nValue.tx('explorer.resizeInspector')
  const applicationResizeHandle = useMemo(
    () => (
      <WorkspaceResizeHandle
        label={applicationResizeLabel}
        onPointerDown={startApplicationResize}
        onKeyDown={resizeApplicationWithKeyboard}
      />
    ),
    [applicationResizeLabel, resizeApplicationWithKeyboard, startApplicationResize],
  )
  const inspectorResizeHandle = useMemo(
    () => (
      <WorkspaceResizeHandle
        label={inspectorResizeLabel}
        onPointerDown={startInspectorResize}
        onKeyDown={resizeInspectorWithKeyboard}
      />
    ),
    [inspectorResizeLabel, resizeInspectorWithKeyboard, startInspectorResize],
  )

  if (!session) {
    const showOfflineUnavailable = connectivity.mode === 'offline' && !connectivity.browserOnline
    const showDesktopUnlock = desktopShell && desktopGate === 'unlock'
    const showDesktopBootError = desktopShell && desktopGate === 'error'
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <GlobalOverflowReveal />
          <UpdateReadyBanner
            updateReady={pwaUpdateReady}
            tx={i18nValue.tx}
            onInstall={() => void requestPwaUpdateInstall()}
          />
          {showOfflineUnavailable ? (
            <OfflineUnavailableScreen onRetry={() => probeServerConnectivity({ force: true })} tx={i18nValue.tx} />
          ) : showDesktopUnlock ? (
              <Suspense fallback={<LaunchScreen message="PhD Atlas" />}>
                <DesktopUnlockScreen
                  busy={busy}
                  error={desktopUnlockError}
                  onUnlock={handleDesktopUnlock}
                />
              </Suspense>
          ) : showDesktopBootError ? (
            <main className="desktop-unlock-screen">
              <section className="desktop-unlock-card" aria-labelledby="desktop-boot-error-title">
                <h1 id="desktop-boot-error-title">{i18nValue.tx('settings.desktopBootFailed')}</h1>
                <p>{desktopUnlockError || i18nValue.tx('settings.desktopBootFailed')}</p>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => {
                    setDesktopUnlockError(null)
                    setDesktopGate('checking')
                    setDesktopBootNonce((value) => value + 1)
                  }}
                >
                  {i18nValue.tx('settings.desktopBootRetry')}
                </button>
              </section>
            </main>
          ) : desktopShell || desktopRuntime.enabled ? (
            <LaunchScreen message="PhD Atlas" />
          ) : (
            <>
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
                language={authLanguage}
                snapshotActive={false}
                snapshotSavedAt={null}
                offlineAccessExpiresAt={null}
                pendingCount={0}
                blockedCount={0}
                syncing={false}
                updateReady={pwaUpdateReady}
                onRetry={() => {
                  void probeServerConnectivity({ force: true })
                }}
                onInstallUpdate={() => {
                  void requestPwaUpdateInstall()
                }}
                onToggleOffline={() => undefined}
                tx={i18nValue.tx}
                authSurface
                allowManualOffline={false}
              />
            </>
          )}
          <ToastStack toasts={toasts} onClose={dismissToast} onPause={pauseToast} onResume={resumeToast} />
        </I18nContext.Provider>
      </ThemeContext.Provider>
    )
  }

  const activeWorkspaceBootstrapFailure = workspaceBootstrapFailure
    && workspaceBootstrapFailure.userId === session.user.id
    && workspaceBootstrapFailure.sessionEpoch === sessionIdentityEpochRef.current
    ? workspaceBootstrapFailure
    : null
  if (!applicationsLoaded && activeWorkspaceBootstrapFailure) {
    return (
      <ThemeContext.Provider value={themeProvider}>
        <I18nContext.Provider value={i18nValue}>
          <FormValidationPrompt />
          <GlobalOverflowReveal />
          <WorkspaceBootstrapRecoveryScreen
            title={i18nValue.tx(
              isBusyWorkspaceBootstrapError(activeWorkspaceBootstrapFailure.error)
                ? 'offlineStatus.slow'
                : 'offlineStatus.serverUnavailable',
            )}
            message={normalizeError(activeWorkspaceBootstrapFailure.error, languageRef.current)}
            requestId={workspaceBootstrapRequestId(activeWorkspaceBootstrapFailure.error)}
            retrying={workspaceBootstrapRetrying}
            onRetry={retryWorkspaceBootstrap}
            onExit={leaveWorkspaceBootstrapRecovery}
            tx={i18nValue.tx}
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
  const applicationLimit =
    activeSession.usage?.applicationQuota ?? (isAdminUser ? Number.MAX_SAFE_INTEGER : isProUser ? 300 : 3)
  const applicationCreateLimit =
    activeSession.usage?.applicationCreateQuota ?? (isProUser ? Number.MAX_SAFE_INTEGER : 3)
  const applicationLimitUsageCount = isProUser
    ? realApplications.length
    : (activeSession.usage?.applicationCreatedCount ?? realApplications.length)

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
    setOfflineAccessExpiresAt(null)
    setOfflineQueueCount(0)
    setBlockedOfflineCount(0)
    setBlockedOfflineReason(null)
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
          nextSession.user.id !== userId ||
          nextSession.impersonation?.targetUserId !== userId ||
          nextSession.impersonation?.actorId !== actorSession.user.id
        ) {
          throw new ApiError('Session identity mismatch. Please sign in again.', 'SESSION_IDENTITY_MISMATCH', 409)
        }
        if (!isCurrentSessionToken(actorSession.token)) return
        const lockedTeamId = nextSession.impersonation?.teamId ?? requestedTeamId
        const returnPoint: SessionReturnStackItem = {
          session: {
            ...actorSession,
            token: getLatestSessionToken(actorSession.token),
          },
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
        notify(
          tpl(i18nValue.tx('toast.impersonationStarted'), {
            name: nextSession.impersonation?.targetName ?? nextSession.user.name,
          }),
          'info',
        )
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
          returnPoint.session.user.id &&
          activeSession.impersonation?.actorId &&
          returnPoint.session.user.id !== activeSession.impersonation.actorId
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
        notify(
          tpl(i18nValue.tx('toast.impersonationEnded'), {
            name: returnPoint.session.user.name,
          }),
          'info',
        )
      })
    })
  }

  function touchesBackupSettings(patch: Partial<UserSettings>) {
    return 'autoBackup' in patch || 'backupFrequency' in patch || 'maxBackupsPerApp' in patch
  }

  function settingsValueEqual(left: unknown, right: unknown) {
    if (Object.is(left, right)) return true
    try {
      return JSON.stringify(left) === JSON.stringify(right)
    } catch {
      return false
    }
  }

  function rollbackOptimisticSettings(
    requestToken: string,
    requestUserId: string,
    requestEpoch: number,
    patch: UserSettingsPatch,
    previousSettings: UserSettings,
  ) {
    setSession((current) => {
      if (
        !current
        || current.user.id !== requestUserId
        || !isCurrentSessionToken(requestToken)
        || sessionIdentityEpochRef.current !== requestEpoch
      ) return current

      const nextSettings = { ...current.user.settings } as UserSettings
      const mutableSettings = nextSettings as unknown as Record<string, unknown>
      const savedSettings = previousSettings as Record<string, unknown>
      let changed = false
      for (const keyName of Object.keys(patch)) {
        const optimisticValue = (patch as Record<string, unknown>)[keyName]
        // Do not overwrite a newer user action that has already replaced this
        // field. Only revert the value painted by this failed request.
        if (!settingsValueEqual(mutableSettings[keyName], optimisticValue)) continue
        const previousValue = savedSettings[keyName]
        if (previousValue === undefined) {
          if (!(keyName in mutableSettings)) continue
          delete mutableSettings[keyName]
        } else {
          mutableSettings[keyName] = previousValue
        }
        changed = true
      }
      if (!changed) return current
      const nextSession = {
        ...current,
        user: { ...current.user, settings: nextSettings },
      }
      safeSetJson(SESSION_KEY, nextSession)
      return nextSession
    })
  }

  function commitSettingsUser(
    requestSession: AuthSession,
    user: AuthSession['user'],
    patch: UserSettingsPatch,
    requestEpoch = sessionIdentityEpochRef.current,
    requireDurableReceipt = true,
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

    assertSettingsPersistenceAcknowledged({
      previous: requestSession.user,
      patch,
      response: user,
      requireDurableReceipt,
    })

    const responseSettingsVersion = Number(user.settingsVersion)
    const requestSettingsVersion = Number(requestSession.user.settingsVersion)
    const trackedSettingsVersion = settingsCommitVersionRef.current.userId === requestUserId
      ? settingsCommitVersionRef.current.version
      : (Number.isSafeInteger(requestSettingsVersion) ? requestSettingsVersion : 0)
    if (!isNewerSettingsPersistenceVersion(trackedSettingsVersion, responseSettingsVersion)) return null
    settingsCommitVersionRef.current = {
      userId: requestUserId,
      version: responseSettingsVersion,
    }

    rememberSessionToken(nextToken)
    currentSessionTokenRef.current = nextToken
    const canonicalUser = { ...user } as AuthSession['user'] & { settingsAcknowledgement?: unknown }
    // The mutation receipt is transport metadata, not account/session state.
    delete canonicalUser.settingsAcknowledgement
    const nextUser = {
      ...canonicalUser,
      settings: {
        ...requestSession.user.settings,
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
        !current ||
        current.user.id !== requestUserId ||
        !isCurrentSessionToken(current.token) ||
        sessionIdentityEpochRef.current !== requestEpoch
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

  function openUpgradePage(
    feature = 'application-limit',
    requested = String(applications.length + 1),
    limit = String(applicationLimit),
  ) {
    if (desktopRuntime.enabled && !desktopRemoteEnabled(desktopRuntime)) return
    const params = new URLSearchParams({ feature, requested, limit })
    window.open(`/upgrade-pro?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  async function performSaveApplication(
    nextApp: ApplicationRecord,
    message: string,
    queuedSession: AuthSession,
    options: ApplicationSaveOptions,
  ): Promise<ApplicationAutoSaveResult> {
    if (!isCurrentSessionToken(queuedSession.token)) return { status: 'ignored' }
    const applicationToSave = draftRef.current?.id === nextApp.id ? cloneApplication(draftRef.current) : nextApp
    const draftMutationVersion = draftMutationVersionRef.current
    const baseApplication =
      draftRef.current?.id === applicationToSave.id
        ? safeParseJson<ApplicationRecord>(draftBaselineRef.current)
        : (applications.find((application) => application.id === applicationToSave.id) ?? null)
    const queueForSync = (queueOptions: { busy?: boolean } = {}): ApplicationAutoSaveResult => {
      const busy = queueOptions.busy === true
      const nextApplications = applications.map((application) =>
        application.id === applicationToSave.id ? applicationToSave : application,
      )
      try {
        const baseUpdatedAt = baseApplication?.updatedAt ?? applicationToSave.updatedAt ?? null
        const nextQueue = enqueueApplicationUpdate(queuedSession, applicationToSave, baseUpdatedAt, baseApplication)
        const saved = saveOfflineSnapshot(queuedSession, currentSnapshotData(nextApplications))
        if (!saved) throw new Error('Offline snapshot storage did not acknowledge the application update.')

        replaceApplication(applicationToSave, draftMutationVersion)
        setOfflineSnapshotSavedAt(saved.savedAt)
        setOfflineAccessExpiresAt(saved.authorization.expiresAt)
        // A transport outage switches to the offline workspace; a busy server
        // keeps the normal online surface and only the change is parked for
        // the automatic replay.
        if (!busy) setOfflineDataActive(true)
        const blockedAfterQueueing = nextQueue.filter((item) => item.status === 'blocked')
        setOfflineQueueCount(nextQueue.length)
        setBlockedOfflineCount(blockedAfterQueueing.length)
        setBlockedOfflineReason(blockedAfterQueueing[0]?.blockedReason ?? null)
        if (options.feedback !== 'quiet') {
          notify(
            tpl(i18nValue.tx('toast.offlineChangeQueued'), {
              count: pendingOfflineQueueSize(queuedSession.user.id),
            }),
            'info',
          )
        }
        void requestOfflineSync()
        return { status: 'queued' }
      } catch {
        refreshOfflineQueueCounts(queuedSession.user.id)
        const errorMessage = i18nValue.tx('apiErrors.REQUEST_FAILED')
        if (options.feedback !== 'quiet') notify(errorMessage, 'error')
        return { status: 'error', message: errorMessage }
      }
    }

    if (
      connectivityUnavailable() &&
      canQueueApplicationUpdate(queuedSession, applicationToSave, {
        isTeamMode,
      })
    ) {
      return queueForSync()
    }

    const commitOnce = async (
      target: ApplicationRecord,
      base: ApplicationRecord | null,
    ): Promise<ApplicationAutoSaveResult> => {
      // Wrap API call with smart retry for transient network issues
      // while preserving session validity checks
      const mutation = await withSmartRetry(
        () => phdApi.updateApplication(queuedSession.token, target, base),
        {
          ...AGGRESSIVE_RETRY_CONFIG,
          shouldRetry: (error, attempt) => {
            // Don't retry if session changed
            if (!isCurrentSessionToken(queuedSession.token)) return false
            // Don't retry rebaseable conflicts (handled by outer loop)
            if (isRebaseableApplicationConflict(error)) return false
            // Don't retry busy errors (handled by outer busy retry logic)
            if (isTransientBusyError(error)) return false
            // Use default retry logic for other errors
            return AGGRESSIVE_RETRY_CONFIG.shouldRetry?.(error, attempt) ?? false
          },
        }
      )
      if (!isCurrentSessionToken(queuedSession.token)) return { status: 'ignored' }
      if (!applicationPersistenceAcknowledged(target, mutation.application, base)) {
        return {
          status: 'error',
          message: i18nValue.tx('apiErrors.REQUEST_FAILED'),
        }
      }
      const saved = mutation.application
      removeOfflineApplicationUpdates(queuedSession.user.id, saved.id)
      refreshOfflineQueueCounts(queuedSession.user.id)
      replaceApplication(saved, draftMutationVersion)
      if (options.feedback !== 'quiet') notify(message)
      return { status: 'saved' }
    }

    try {
      return await commitOnce(applicationToSave, baseApplication)
    } catch (error) {
      if (isAuthExpired(error)) {
        return { status: 'ignored' }
      }

      // A structured busy response means the server admitted the request but
      // cannot run it right now (admission queue full, memory pressure, a
      // maintenance pass in flight). The edit is valid, so retry a few times
      // with backoff before doing anything the author would read as failure.
      let retryableError: unknown = error
      if (isTransientBusyError(retryableError) && isCurrentSessionToken(queuedSession.token)) {
        let busyAttempt = 0
        while (
          busyAttempt < APPLICATION_SAVE_BUSY_RETRY_DELAYS_MS.length
          && isTransientBusyError(retryableError)
          && isCurrentSessionToken(queuedSession.token)
        ) {
          const retryAfterMs = retryableError instanceof ApiError
            && Number.isFinite(retryableError.retryAfterMs)
            ? Math.max(0, Number(retryableError.retryAfterMs))
            : 0
          await new Promise((resolve) => {
            window.setTimeout(resolve, Math.max(APPLICATION_SAVE_BUSY_RETRY_DELAYS_MS[busyAttempt], retryAfterMs))
          })
          busyAttempt += 1
          try {
            return await commitOnce(applicationToSave, baseApplication)
          } catch (busyRetryError) {
            if (isAuthExpired(busyRetryError)) return { status: 'ignored' }
            retryableError = busyRetryError
          }
        }
      }

      // A record can move under an editor without anyone else touching it: a
      // recommender save, a logo resolve, an attachment or an incoming mail all
      // write the same record through their own routes. The resident baseline
      // is then stale and the next autosave is rejected. Rebase on the current
      // server copy and replay, silently — a conflict dialog for edits the
      // same person just made is never the right answer.
      //
      // Replaying only once was not enough. Background writers (mail sync
      // filing correspondence, logo resolution, automatic backups) can move the
      // record again inside the rebase round-trip, and that second collision
      // surfaced a conflict toast for a save nobody was competing over. Each
      // pass reads a fresh copy, so a bounded loop converges as soon as the
      // record stops moving; a genuine same-field conflict is decided by the
      // merge, not by exhausting the attempts.
      let rebaseError: unknown = retryableError
      for (
        let attempt = 0;
        attempt < APPLICATION_SAVE_REBASE_ATTEMPTS
        && isRebaseableApplicationConflict(rebaseError)
        && isCurrentSessionToken(queuedSession.token);
        attempt += 1
      ) {
        const rebased = await rebaseApplicationForRetry(queuedSession, applicationToSave, baseApplication)
        if (!rebased || !isCurrentSessionToken(queuedSession.token)) break
        if (!rebased.replayRequired) {
          // The server already holds everything this save carried.
          removeOfflineApplicationUpdates(queuedSession.user.id, rebased.server.id)
          refreshOfflineQueueCounts(queuedSession.user.id)
          replaceApplication(rebased.server, draftMutationVersion)
          if (options.feedback !== 'quiet') notify(message)
          return { status: 'saved' }
        }
        try {
          return await commitOnce(rebased.application, rebased.server)
        } catch (retryError) {
          if (isAuthExpired(retryError)) return { status: 'ignored' }
          rebaseError = retryError
          if (!isRebaseableApplicationConflict(retryError)) {
            const retryMessage = isNetworkLikeError(retryError)
              ? i18nValue.tx('toast.offlineSaveNeedsOnline')
              : normalizeError(retryError, languageRef.current)
            if (options.feedback !== 'quiet') notify(retryMessage, 'error')
            return { status: 'error', message: retryMessage }
          }
        }
      }
      if (rebaseError !== retryableError) {
        const retryMessage = isNetworkLikeError(rebaseError)
          ? i18nValue.tx('toast.offlineSaveNeedsOnline')
          : normalizeError(rebaseError, languageRef.current)
        if (options.feedback !== 'quiet') notify(retryMessage, 'error')
        return { status: 'error', message: retryMessage }
      }

      if (
        (isNetworkLikeError(rebaseError) || isTransientBusyError(rebaseError)) &&
        canQueueApplicationUpdate(queuedSession, applicationToSave, {
          isTeamMode,
        })
      ) {
        return queueForSync({ busy: isTransientBusyError(rebaseError) })
      }

      const errorMessage = isNetworkLikeError(rebaseError)
        ? i18nValue.tx('toast.offlineSaveNeedsOnline')
        : normalizeError(rebaseError, languageRef.current)
      // Naming the field in a toast still leaves it to be found. Mark it too,
      // and remember it so the leave dialog's "review" action can point at the
      // same field later, once the toast is long gone.
      if (rebaseError instanceof ApiError) {
        lastSaveErrorFieldRef.current = rebaseError.field ?? null
        flashInvalidField(rebaseError.field)
      } else {
        lastSaveErrorFieldRef.current = null
      }
      if (isNetworkLikeError(rebaseError)) {
        if (options.feedback !== 'quiet') notify(errorMessage, 'error')
      } else if (options.feedback !== 'quiet') {
        notify(errorMessage, 'error')
      }
      return { status: 'error', message: errorMessage }
    }
  }

  async function rebaseApplicationForRetry(
    session: AuthSession,
    local: ApplicationRecord,
    base: ApplicationRecord | null,
  ): Promise<{ application: ApplicationRecord; server: ApplicationRecord; replayRequired: boolean } | null> {
    try {
      const server = await phdApi.getApplication(session.token, local.id)
      if (!server || server.id !== local.id) return null
      const authoredAt = new Date().toISOString()
      const merge = mergeOfflineApplicationUpdate(
        {
          id: `rebase:${local.id}:${authoredAt}`,
          type: 'updateApplication',
          userId: session.user.id,
          applicationId: local.id,
          baseUpdatedAt: base?.updatedAt ?? null,
          ...(base ? { baseApplication: base } : {}),
          createdAt: authoredAt,
          updatedAt: authoredAt,
          localEditedAt: authoredAt,
          application: local,
        },
        server,
        { autoResolve: true },
      )
      if (!merge) return null
      // The recommender directory is only ever written by its own atomic route,
      // so the server copy is authoritative by construction. Carrying a local
      // one into the replay is what made the retry fail identically.
      // Adopting the server copy can only remove a difference, so the merge's
      // own verdict stays correct; a replay that turns out to be a no-op builds
      // an empty delta and never reaches the network.
      const rebased = { ...merge.application, recommenders: server.recommenders ?? [] }
      return { application: rebased, server, replayRequired: merge.replayRequired }
    } catch {
      return null
    }
  }

  function enqueueApplicationWrite<T>(applicationId: string, action: () => Promise<T>): Promise<T> {
    const previous = applicationWriteQueueRef.current.get(applicationId) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(action)
    applicationWriteQueueRef.current.set(applicationId, queued)
    const release = () => {
      if (applicationWriteQueueRef.current.get(applicationId) === queued) {
        applicationWriteQueueRef.current.delete(applicationId)
      }
    }
    void queued.then(release, release)
    return queued
  }

  function deleteApplicationAfterPendingWrites(applicationId: string) {
    const requestSession = activeSession
    return enqueueApplicationWrite(
      applicationId,
      () => phdApi.deleteApplication(requestSession.token, applicationId),
    )
  }

  async function saveApplication(
    nextApp: ApplicationRecord,
    message: string,
    options: ApplicationSaveOptions = {},
  ): Promise<ApplicationAutoSaveResult> {
    const queuedSession = activeSession
    pendingSaveCountRef.current += 1
    if (pendingSaveCountRef.current === 1) setSaving(true)

    const queued = enqueueApplicationWrite(nextApp.id, () =>
      performSaveApplication(nextApp, message, queuedSession, options),
    )

    try {
      return await queued
    } finally {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
      if (pendingSaveCountRef.current === 0) setSaving(false)
    }
  }

  async function saveCurrentDraft(): Promise<boolean> {
    if (!draftRef.current) return true
    return flushApplicationAutoSave()
  }

  async function saveApplicationQuietly(
    nextApp: ApplicationRecord,
    message: string,
  ): Promise<ApplicationAutoSaveResult> {
    const updatesActiveDraft = draftRef.current?.id === nextApp.id
    if (updatesActiveDraft) {
      resetApplicationAutoSave()
      setDraftState(cloneApplication(nextApp))
    } else if (draftRef.current) {
      await flushApplicationAutoSave()
    }
    const saveToken = beginExternalApplicationSave()
    const result = await saveApplication(nextApp, message, {
      feedback: 'quiet',
    })
    if (result.status === 'saved' || result.status === 'queued') {
      finishExternalApplicationSave(saveToken, result)
    } else if (result.status === 'error') {
      if (updatesActiveDraft) {
        retainFailedApplicationDraft(nextApp, result.message)
      } else {
        failExternalApplicationSave(saveToken, result.message)
      }
    } else {
      finishExternalApplicationSave(saveToken, result)
    }
    return result
  }

  function currentApplicationDraft(application: ApplicationRecord): ApplicationRecord {
    return draftRef.current?.id === application.id ? draftRef.current : application
  }

  function currentApplicationServerBaseline(applicationId: string): ApplicationRecord | null {
    if (draftRef.current?.id === applicationId) {
      const residentBaseline = safeParseJson<ApplicationRecord>(draftBaselineRef.current)
      if (residentBaseline?.id === applicationId) return residentBaseline
    }
    return applications.find((application) => application.id === applicationId)
      ?? teamApplications.find((application) => application.id === applicationId)
      ?? null
  }

  async function toggleApplicationTeamVisibility(applicationId: string, visibleToTeam: boolean, teamId?: string) {
    pendingSaveCountRef.current += 1
    if (pendingSaveCountRef.current === 1) setSaving(true)
    try {
      const baseline = currentApplicationServerBaseline(applicationId)
      if (!baseline) throw new Error('APPLICATION_NOT_FOUND')
      const saved = await phdApi.updateApplicationTeamVisibility(
        activeSession.token,
        baseline,
        visibleToTeam,
        teamId,
      )
      replaceApplication(saved)
      const approvalPending = saved.teamTransferRequest?.status === 'pending'
      notify(
        i18nValue.tx(
          approvalPending
            ? visibleToTeam
              ? 'toast.teamTransferJoinRequested'
              : 'toast.teamTransferLeaveRequested'
            : visibleToTeam
              ? 'toast.teamVisibilityShared'
              : 'toast.teamVisibilityPrivate',
        ),
      )
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
    resetApplicationAutoSave()
    replacePendingRecommenderDrafts(selected.id, [])
    setDraftState(cloneApplication(selected), { clean: true })
    notify(i18nValue.tx('toast.changesDiscarded'))
  }

  function confirmDeleteApplications(applicationIds: string[]) {
    const targets = workspaceApplications.filter((application) => applicationIds.includes(application.id))
    if (targets.length === 0) return
    runWithNavigationGuard(() => {
      setConfirmDialog({
        title: i18nValue.tx('explorer.deleteSelected'),
        message: tpl(i18nValue.tx('confirmDeleteApplications'), {
          count: targets.length,
        }),
        confirmLabel: i18nValue.tx('dossier.delete'),
        variant: 'danger',
        onConfirm: () => {
          const targetIds = targets.map((application) => application.id)
          setRemovingApplicationIds((current) => new Set([...current, ...targetIds]))
          return runOrThrow(async () => {
              await waitForRemovalHandoff(Promise.all(
                targets.map((application) => deleteApplicationAfterPendingWrites(application.id)),
              ))
              removeApplicationsFromState(targetIds)
              notify(
                tpl(i18nValue.tx('toast.applicationsDeleted'), {
                  count: targets.length,
                }),
              )
              await refreshTrashAndSessionMetadata(activeSession)
            }).finally(() => {
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
    const ids = uniqueIds.filter((id) => workspaceApplicationById.has(id))
    if (ids.length === 0) return
    ids.forEach((id) => {
      window.open(pathForRoute('workspace', id, 'dossier', teamSection, interfaceMode), '_blank', 'noopener,noreferrer')
    })
  }

  function exportSelectedApplications(applicationIds: string[]) {
    const uniqueIds = Array.from(new Set(applicationIds))
    const targets = applications.filter((application) => uniqueIds.includes(application.id))
    if (targets.length === 0) return
    void run(
      async () => {
        for (const target of targets) {
          const blob = await phdApi.downloadExport(activeSession.token, 'json', target.id)
          downloadBlob(blob, `phd-application-${safeFileSegment(target.school.name)}.json`)
        }
      },
      tpl(i18nValue.tx('toast.exported'), { format: 'JSON' }),
    )
  }

  function restoreTrashItem(item: ApplicationTrashItem) {
    void run(async () => {
      const restored = await phdApi.restoreApplicationFromTrash(activeSession.token, item.id, item.application)
      setApplicationTrash((items) => items.filter((candidate) => candidate.id !== item.id))
      if (restored.teamId) {
        await refreshTeamWorkspace(activeSession, restored.teamId)
      } else {
        setApplications((items) => [restored, ...items.filter((application) => application.id !== restored.id)])
        await refreshSessionMetadata(activeSession)
      }
      setSelectedId(restored.id)
      setDraftState(cloneApplication(restored), { clean: true })
      setScreen('workspace')
      setMobileDetailOpen(true)
    }, i18nValue.tx('toast.applicationRestored'))
  }

  function confirmDeleteTrashItem(item: ApplicationTrashItem) {
    setConfirmDialog({
      title: i18nValue.tx('trash.deleteForever'),
      message: tpl(i18nValue.tx('trash.confirmDeleteForever'), {
        name: item.application.school.name,
      }),
      confirmLabel: i18nValue.tx('trash.deleteForever'),
      variant: 'danger',
      onConfirm: () => {
        setRemovingTrashItemIds((current) => new Set(current).add(item.id))
        return runOrThrow(async () => {
            await waitForRemovalHandoff(
              phdApi.deleteApplicationTrashItem(activeSession.token, item.id),
            )
            setApplicationTrash((items) => items.filter((candidate) => candidate.id !== item.id))
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.trashDeleted')).finally(() => {
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
    const itemIds = visibleApplicationTrash.map((item) => item.id)
    if (itemIds.length === 0) return
    setConfirmDialog({
      title: i18nValue.tx('trash.empty'),
      message: i18nValue.tx('trash.confirmEmpty'),
      confirmLabel: i18nValue.tx('trash.empty'),
      variant: 'danger',
      onConfirm: () => {
        setRemovingTrashItemIds((current) => new Set([...current, ...itemIds]))
        return runOrThrow(async () => {
            await waitForRemovalHandoff(
              phdApi.emptyApplicationTrash(activeSession.token, applicationTrashScope),
            )
            setApplicationTrash((items) => items.filter((item) => !itemIds.includes(item.id)))
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.trashEmptied')).finally(() => {
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
      const user = await persistSettingsPatch(requestSession, patch, requestEpoch)
      const nextSession = commitSettingsUser(requestSession, user, patch, requestEpoch)
      if (!nextSession) return
      if (touchesBackupSettings(patch)) {
        await refreshApplicationsAndBackups(nextSession)
      }
    }, message)
  }

  function updateUserSettings(
    patch: UserSettingsPatch,
    message = i18nValue.tx('toast.settingsUpdated'),
    options: { throwOnError?: boolean } = {},
  ) {
    const execute = options.throwOnError ? runOrThrow : run
    return execute(async () => {
      const requestSession = activeSession
      const requestToken = requestSession.token
      const requestUserId = requestSession.user.id
      const requestEpoch = sessionIdentityEpochRef.current
      const previousSettings = requestSession.user.settings
      // Strict interactive saves (the profile preset editor is one) must not
      // paint an item as saved before the server acknowledges it. Otherwise a
      // rejected request leaves a phantom preset in the current session and a
      // later reopen looks successful until the next full reload. Background
      // settings controls retain their existing optimistic response.
      if (!options.throwOnError) {
        setSession((current) => {
          if (
            !current ||
            current.user.id !== requestUserId ||
            !isCurrentSessionToken(requestToken) ||
            sessionIdentityEpochRef.current !== requestEpoch
          )
            return current
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
      }
      try {
        const user = await persistSettingsPatch(requestSession, patch, requestEpoch)
        const nextSession = commitSettingsUser(requestSession, user, patch, requestEpoch)
        if (!nextSession) return
        if (touchesBackupSettings(patch)) {
          await refreshApplicationsAndBackups(nextSession)
        }
      } catch (error) {
        if (!options.throwOnError) {
          rollbackOptimisticSettings(requestToken, requestUserId, requestEpoch, patch, previousSettings)
        }
        throw error
      }
    }, message)
  }

  function enqueueSettingsWrite<T>(userId: string, action: () => Promise<T>): Promise<T> {
    const previous = settingsWriteQueueRef.current.get(userId) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(action)
    settingsWriteQueueRef.current.set(userId, queued)
    const release = () => {
      if (settingsWriteQueueRef.current.get(userId) === queued) {
        settingsWriteQueueRef.current.delete(userId)
      }
    }
    void queued.then(release, release)
    return queued
  }

  function persistSettingsPatch(
    requestSession: AuthSession,
    patch: UserSettingsPatch,
    requestEpoch = sessionIdentityEpochRef.current,
  ) {
    return enqueueSettingsWrite(requestSession.user.id, async () => {
      if (!isMountedSessionIdentity(requestSession.user.id, requestSession.token, requestEpoch)) {
        throw new ApiError(
          'The settings write belongs to a session which is no longer active.',
          'SETTINGS_MUTATION_SUPERSEDED',
          409,
        )
      }
      return phdApi.updateSettings(getLatestSessionToken(requestSession.token), patch)
    })
  }

  function mergeRecommenderApplicationSnapshots(savedApplications: readonly ApplicationRecommenderSlice[]) {
    const latestById = new Map(savedApplications.map((application) => [application.id, application]))
    for (const saved of latestById.values()) {
      updateApplicationInState(saved.id, (current) => {
        const currentVersion = Date.parse(String(current.updatedAt ?? ''))
        const savedVersion = Date.parse(String(saved.updatedAt ?? ''))
        // Concurrent granular writes share one monotonic application version.
        // A late recommender response must not roll a newer resident snapshot
        // (or its draft baseline) back to an older canonical slice.
        if (Number.isFinite(currentVersion) && Number.isFinite(savedVersion) && currentVersion > savedVersion) {
          return current
        }
        return {
          ...current,
          recommenders: saved.recommenders.map((recommender) => ({ ...recommender })),
          updatedAt: saved.updatedAt,
        }
      })
    }
  }

  function commitPersonalRecommenderMutation(
    requestSession: AuthSession,
    requestEpoch: number,
    result: ApplicationRecommenderMutationResult | ProfileRecommenderMutationResult,
  ) {
    const requestToken = requestSession.token
    const requestUserId = requestSession.user.id
    if (result.ownerId !== requestUserId || !isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) {
      return false
    }

    const directoryScopeKey = `${requestUserId}:${requestEpoch}`
    const directoryRevision = personalRecommenderDirectoryRevisionRef.current
    const directoryIsNewer = directoryRevision.scopeKey !== directoryScopeKey
      || result.directoryRevision > directoryRevision.revision
    if (directoryIsNewer) {
      personalRecommenderDirectoryRevisionRef.current = {
        scopeKey: directoryScopeKey,
        revision: result.directoryRevision,
      }
      // Merge only the recommender directory into the mounted identity. A whole
      // session replacement here would be able to roll back unrelated settings
      // authored while this request was in flight.
      setSession((current) => {
        if (
          !current ||
          current.user.id !== requestUserId ||
          !isCurrentSessionToken(current.token) ||
          sessionIdentityEpochRef.current !== requestEpoch
        ) {
          return current
        }
        const nextSession: AuthSession = {
          ...current,
          user: {
            ...current.user,
            settings: {
              ...current.user.settings,
              profileRecommenders: result.profiles.map((profile) => ({ ...profile })),
              profileRecommendersTotal: result.profiles.length,
              profileRecommendersNextCursor: null,
            },
          },
        }
        safeSetJson(SESSION_KEY, nextSession)
        return nextSession
      })
    }

    const applicationSnapshots = [
      ...('application' in result ? [result.application] : []),
      ...(result.applications ?? []),
    ]
    mergeRecommenderApplicationSnapshots(applicationSnapshots)
    return true
  }

  async function replacePersonalProfileRecommenders(
    nextProfiles: ProfileRecommender[],
    baseProfiles: ProfileRecommender[],
  ) {
    const requestSession = activeSession
    const requestEpoch = sessionIdentityEpochRef.current
    await runOrThrow(async () => {
      const result = await phdApi.replaceProfileRecommenders(
        requestSession.token,
        nextProfiles,
        baseProfiles,
      )
      commitPersonalRecommenderMutation(requestSession, requestEpoch, result)
    }, i18nValue.tx('profile.recommenders.saved'))
  }

  async function resolvePersonalApplicationRecommender(
    applicationId: string,
    recommender: MaterialRecommender,
    decision: ApplicationRecommenderDecision,
  ) {
    // Flush unrelated resident fields first so the atomic recommender route
    // starts from the current durable application version. This uses the same
    // per-application write queue, keeping a late autosave from overtaking it.
    if (!(await flushApplicationAutoSave())) {
      throw new Error(i18nValue.tx('apiErrors.REQUEST_FAILED'))
    }

    const requestSession = activeSession
    const requestEpoch = sessionIdentityEpochRef.current
    const saveToken = beginExternalApplicationSave()
    pendingSaveCountRef.current += 1
    if (pendingSaveCountRef.current === 1) setSaving(true)

    const submitResolve = (
      profilesOverride?: AuthSession['user']['settings']['profileRecommenders'],
    ) => enqueueApplicationWrite(applicationId, async () => {
      const durableDraft =
        draftRef.current?.id === applicationId
          ? safeParseJson<ApplicationRecord>(draftBaselineRef.current) ?? draftRef.current
          : applications.find((application) => application.id === applicationId)
      const applicationUpdatedAt = durableDraft?.updatedAt
      if (!applicationUpdatedAt) {
        throw new ApiError(
          i18nValue.tx('apiErrors.REQUEST_FAILED'),
          'APPLICATION_VERSION_REQUIRED',
          409,
        )
      }
      // The server resolves the referenced profile from the submitted row
      // *or* the stored one, so the version has to be looked up the same way.
      // Sending it only for an explicitly bound profileId made every edit of
      // an already-linked row arrive without the version the server wanted.
      const referencedProfileId = recommender.profileId
        || (durableDraft?.recommenders ?? []).find((row) => row.id === recommender.id)?.profileId
        || ''
      // The retry passes the directory it just re-read. Reading React state
      // here instead would still see the pre-refresh render's copy and send the
      // same stale version the server already rejected.
      const profiles = profilesOverride ?? requestSession.user.settings.profileRecommenders
      const linkedProfile = referencedProfileId
        ? profiles?.find((profile) => profile.id === referencedProfileId)
        : undefined

      return phdApi.resolveApplicationRecommender(
        requestSession.token,
        applicationId,
        recommender,
        {
          applicationUpdatedAt,
          ...(referencedProfileId ? { profileUpdatedAt: linkedProfile?.updatedAt ?? null } : {}),
        },
        decision,
      )
    })

    try {
      let result
      try {
        result = await submitResolve()
      } catch (error) {
        // The stale half of this save is the recommender directory this client
        // holds, and nothing else refreshes it on failure — so every retry sent
        // the same stale version and failed identically, leaving the edit
        // permanently unsavable. Re-read the directory and replay once.
        if (!isRecoverableRecommenderVersionError(error)) throw error
        const refreshed = await phdApi.me(requestSession.token)
        commitSessionMetadata(requestSession, refreshed, requestSession.token, requestEpoch)
        result = await submitResolve(refreshed.user.settings.profileRecommenders)
      }

      commitPersonalRecommenderMutation(requestSession, requestEpoch, result)
      finishExternalApplicationSave(saveToken, { status: 'saved' })
    } catch (error) {
      const message = isNetworkLikeError(error)
        ? i18nValue.tx('toast.offlineSaveNeedsOnline')
        : normalizeError(error, languageRef.current)
      failExternalApplicationSave(saveToken, message)
      // The decision-required response is handled inside Dossier by opening
      // the three-way choice. Other failures need visible feedback while the
      // resident row remains mounted and retryable.
      if (!(error instanceof ApiError && error.code === 'RECOMMENDER_SYNC_DECISION_REQUIRED') && !isAuthExpired(error)) {
        notify(message, 'error')
      }
      throw error
    } finally {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
      if (pendingSaveCountRef.current === 0) setSaving(false)
    }
  }

  function commitTeamRecommenderMutation(
    requestSession: AuthSession,
    requestEpoch: number,
    expectedTeamId: string,
    studentUserId: string,
    result: ApplicationRecommenderMutationResult | ProfileRecommenderMutationResult,
  ) {
    if (
      result.ownerId !== studentUserId
      || !isMountedSessionIdentity(requestSession.user.id, requestSession.token, requestEpoch)
      || (activeTeamIdRef.current ?? visibleTeamSummary?.team.id ?? null) !== expectedTeamId
    ) {
      return false
    }

    const scopeKey = `${requestSession.user.id}:${expectedTeamId}`
    const revisionScopeKey = `${requestSession.user.id}:${requestEpoch}`
    let directoryRevisions = teamRecommenderDirectoryRevisionRef.current
    if (directoryRevisions.scopeKey !== revisionScopeKey) {
      directoryRevisions = {
        scopeKey: revisionScopeKey,
        revisionsByDirectory: new Map(),
      }
      teamRecommenderDirectoryRevisionRef.current = directoryRevisions
    }
    const directoryKey = `${expectedTeamId}:${studentUserId}`
    const currentDirectoryRevision = directoryRevisions.revisionsByDirectory.get(directoryKey) ?? 0
    if (result.directoryRevision > currentDirectoryRevision) {
      directoryRevisions.revisionsByDirectory.set(directoryKey, result.directoryRevision)
      setTeamRecommenderDirectory((current) => ({
        scopeKey,
        profilesByStudent: {
          ...(current.scopeKey === scopeKey ? current.profilesByStudent : {}),
          [studentUserId]: result.profiles.map((profile) => ({ ...profile })),
        },
      }))
    }
    const applicationSnapshots = [
      ...('application' in result ? [result.application] : []),
      ...(result.applications ?? []),
    ]
    mergeRecommenderApplicationSnapshots(applicationSnapshots)
    return true
  }

  async function replaceTeamStudentProfileRecommenders(
    studentUserId: string,
    nextProfiles: ProfileRecommender[],
  ) {
    const requestSession = activeSession
    const requestEpoch = sessionIdentityEpochRef.current
    const expectedTeamId = activeTeamIdRef.current ?? visibleTeamSummary?.team.id ?? null
    if (!expectedTeamId) throw new Error(i18nValue.tx('apiErrors.REQUEST_FAILED'))

    let baseProfiles = teamRecommenderProfilesByStudent[studentUserId]
    if (!baseProfiles) {
      baseProfiles = await loadTeamStudentRecommenders(studentUserId)
    }

    await runOrThrow(async () => {
      const result = await phdApi.replaceTeamMemberProfileRecommenders(
        requestSession.token,
        expectedTeamId,
        studentUserId,
        nextProfiles,
        [...baseProfiles],
      )
      commitTeamRecommenderMutation(
        requestSession,
        requestEpoch,
        expectedTeamId,
        studentUserId,
        result,
      )
    }, i18nValue.tx('profile.recommenders.saved'))
  }

  async function resolveTeamApplicationRecommender(
    applicationId: string,
    recommender: MaterialRecommender,
    decision: ApplicationRecommenderDecision,
  ) {
    if (!(await flushApplicationAutoSave())) {
      throw new Error(i18nValue.tx('apiErrors.REQUEST_FAILED'))
    }

    const application = teamApplications.find((candidate) => candidate.id === applicationId)
    const studentUserId = application?.ownerId
    const expectedTeamId = application?.teamId ?? null
    if (
      !studentUserId
      || !expectedTeamId
      || expectedTeamId !== (activeTeamIdRef.current ?? visibleTeamSummary?.team.id ?? null)
    ) {
      throw new ApiError(i18nValue.tx('apiErrors.REQUEST_FAILED'), 'TEAM_RECOMMENDER_SCOPE_REQUIRED', 409)
    }

    const requestSession = activeSession
    const requestEpoch = sessionIdentityEpochRef.current
    let profiles = teamRecommenderProfilesByStudent[studentUserId]
    if (!profiles) profiles = await loadTeamStudentRecommenders(studentUserId)

    const saveToken = beginExternalApplicationSave()
    pendingSaveCountRef.current += 1
    if (pendingSaveCountRef.current === 1) setSaving(true)

    try {
      const result = await enqueueApplicationWrite(applicationId, async () => {
        const durableDraft =
          draftRef.current?.id === applicationId
            ? safeParseJson<ApplicationRecord>(draftBaselineRef.current) ?? draftRef.current
            : teamApplications.find((candidate) => candidate.id === applicationId)
        const applicationUpdatedAt = durableDraft?.updatedAt
        if (!applicationUpdatedAt) {
          throw new ApiError(
            i18nValue.tx('apiErrors.REQUEST_FAILED'),
            'APPLICATION_VERSION_REQUIRED',
            409,
          )
        }
        const referencedProfileId = recommender.profileId
          || (durableDraft?.recommenders ?? []).find((row) => row.id === recommender.id)?.profileId
          || ''
        const linkedProfile = referencedProfileId
          ? profiles.find((profile) => profile.id === referencedProfileId)
          : undefined
        return phdApi.resolveApplicationRecommender(
          requestSession.token,
          applicationId,
          recommender,
          {
            applicationUpdatedAt,
            ...(referencedProfileId ? { profileUpdatedAt: linkedProfile?.updatedAt ?? null } : {}),
          },
          decision,
        )
      })

      commitTeamRecommenderMutation(
        requestSession,
        requestEpoch,
        expectedTeamId,
        studentUserId,
        result,
      )
      finishExternalApplicationSave(saveToken, { status: 'saved' })
    } catch (error) {
      const message = isNetworkLikeError(error)
        ? i18nValue.tx('toast.offlineSaveNeedsOnline')
        : normalizeError(error, languageRef.current)
      failExternalApplicationSave(saveToken, message)
      if (!(error instanceof ApiError && error.code === 'RECOMMENDER_SYNC_DECISION_REQUIRED') && !isAuthExpired(error)) {
        notify(message, 'error')
      }
      throw error
    } finally {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
      if (pendingSaveCountRef.current === 0) setSaving(false)
    }
  }

  async function saveUserAvatar(avatarDataUrl: string) {
    const requestSession = activeSession
    const requestEpoch = sessionIdentityEpochRef.current
    try {
      setBusy(true)
      const user = await persistSettingsPatch(requestSession, { avatarDataUrl }, requestEpoch)
      const nextSession = commitSettingsUser(requestSession, user, { avatarDataUrl }, requestEpoch)
      if (!nextSession) return false
      setTeamSummary((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.userId === user.id ? { ...member, avatarUrl: avatarDataUrl || undefined } : member,
              ),
            }
          : current,
      )
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

  async function editAiKey(id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey' | 'maxConcurrency' | 'requestMode' | 'weight' | 'enabled'>>) {
    const updated = await phdApi.updateAiKey(activeSession.token, id, input)
    setAiKeys((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    notify(i18nValue.tx('settings.ai.keyUpdated'))
  }

  async function removeAiKey(id: string) {
    await phdApi.deleteAiKey(activeSession.token, id)
    setAiKeys((items) => items.filter((item) => item.id !== id))
    notify(i18nValue.tx('settings.ai.keyRemoved'))
  }

  async function testAiKey(id: string) {
    const result = await phdApi.testAiKey(activeSession.token, id)
    setAiKeys((items) => items.map((item) => (item.id === id ? { ...item, lastUsedAt: result.testedAt } : item)))
    return { latencyMs: result.latencyMs, model: result.model }
  }

  async function resetAiKeyUsage(id: string) {
    const updated = await phdApi.resetAiKeyUsage(activeSession.token, id)
    setAiKeys((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    notify(i18nValue.tx('settings.ai.usageResetDone'))
  }

  /**
   * Remembers a job while it is still running and returns it once it reaches a
   * terminal state, so a result is reported only to the tab that watched it.
   */
  function observeMailSyncJob(job: MailSyncJob | null | undefined) {
    if (!job) return null
    if (['queued', 'running'].includes(job.status)) {
      watchedMailSyncJobIdRef.current = job.id
      return null
    }
    return job
  }

  /**
   * Reports a finished mail sync exactly once, whichever channel observed it.
   * The realtime stream now announces job transitions, so a terminal status can
   * arrive through an ordinary `session` invalidation rather than a poll.
   */
  async function settleMailSyncJob(committedSession: AuthSession, job: MailSyncJob) {
    if (!['succeeded', 'failed'].includes(job.status)) return
    // Only a job this client watched running may report: a stale terminal job
    // is present in every /api/auth/me body, including the one served at login.
    if (watchedMailSyncJobIdRef.current !== job.id) return
    watchedMailSyncJobIdRef.current = null
    // Committing the terminal job status disables MailSyncJobWatcher and
    // aborts its polling signal. The final application refresh must outlive
    // that watcher-owned signal or newly imported correspondence can remain
    // invisible until a later manual reload.
    await refreshApplicationsAndSessionMetadata(committedSession)
    refreshUnreadNotificationCount()
    if (notificationCenterOpen) void refreshNotificationList()
    if (job.status === 'failed') {
      notify(
        tpl(i18nValue.tx('toast.mailSyncBackgroundFailed'), {
          code: job.errorCode ?? 'FETCH_FAILED',
        }),
        'error',
      )
      return
    }
    const result = job.result
    if (result && result.filed > 0) {
      notify(
        tpl(i18nValue.tx(job.mode === 'history' ? 'toast.mailHistoryFiled' : 'toast.mailFetchFiled'), {
          count: result.filed,
          incoming: result.incoming,
          outgoing: result.outgoing,
        }),
        'success',
      )
    } else {
      notify(
        i18nValue.tx(job.mode === 'history' ? 'toast.mailHistoryNoMail' : 'toast.mailFetchNoNewMail'),
        'info',
      )
    }
    if (result && !result.stateCommitted) notify(i18nValue.tx('toast.mailSyncNeedsRetry'), 'info')
  }

  async function pollMailSyncJob(jobId: string, signal: AbortSignal) {
    if (!session) return false
    try {
      const requestToken = getLatestSessionToken(session.token)
      const requestSession = { ...session, token: requestToken }
      const me = await phdApi.me(requestToken, { signal })
      if (signal.aborted) return false
      const committedSession = commitSessionMetadata(requestSession, me, requestToken)
      const currentJob = me.mailFetchStatus?.syncJob
      if (currentJob?.id === jobId && ['queued', 'running'].includes(currentJob.status)) {
        observeMailSyncJob(currentJob)
        return true
      }
      if (committedSession && currentJob?.id === jobId) {
        await settleMailSyncJob(committedSession, currentJob)
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
        const user = await persistSettingsPatch(requestSession, patch)
        const committedSession = commitSettingsUser(requestSession, user, patch)
        if (!committedSession) return
        nextSession = committedSession
      }
      const result =
        mode === 'history'
          ? await phdApi.syncMailHistory(nextSession.token)
          : await phdApi.fetchMailNow(nextSession.token)
      notify(i18nValue.tx(result.alreadyQueued ? 'toast.mailSyncAlreadyRunning' : 'toast.mailSyncQueued'), 'info')
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

  async function deletePasskey(id: string) {
    if (removingPasskeyIds.has(id)) return
    setRemovingPasskeyIds((current) => new Set(current).add(id))
    try {
      await runOrThrow(async () => {
        await waitForRemovalHandoff(phdApi.deletePasskey(activeSession.token, id))
        setPasskeys((items) => items.filter((item) => item.id !== id))
      }, i18nValue.tx('settings.passkeyRemoved'))
    } finally {
      setRemovingPasskeyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  function registerNavigationGuard(guard: NavigationGuard | null) {
    navigationGuardRef.current = guard
  }

  function runWithNavigationGuard(action: () => void) {
    const guard = navigationGuardRef.current
    if (guard?.(action)) return
    action()
  }

  function createWorkspaceJumpIntent(applicationId: string, target: WorkspaceJumpTarget): DossierJumpIntent {
    workspaceJumpTokenRef.current += 1
    return { ...target, applicationId, token: workspaceJumpTokenRef.current }
  }

  function clearWorkspaceViewExit() {
    if (workspaceViewExitTimerRef.current !== null) {
      window.clearTimeout(workspaceViewExitTimerRef.current)
      workspaceViewExitTimerRef.current = null
    }
    setWorkspaceViewExit(null)
  }

  function commitWorkspaceBoardOpen({ synchronous = false }: { synchronous?: boolean } = {}) {
    const commit = () => {
      // Keep the outgoing record mounted until the deferred center stage has
      // committed the board. Clearing these values in the click commit made
      // the list briefly render its empty fallback while the board was still
      // being built, adding a second large App reconciliation.
      setWorkspaceBoardResident(true)
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
      runAnimatedScreenUpdate(() => commitWorkspaceBoardOpen({ synchronous: true }), {
        scope: 'workspace-view',
        direction,
        ready: warmCriticalScreenAssets('workspace', tab, lang, 'kanban'),
        readinessGate: readinessGateForScreen('workspace', 'kanban'),
        forceCssFallback: true,
      })
      return
    }
    clearWorkspaceViewExit()
    commitWorkspaceBoardOpen({ synchronous })
  }

  function closeMobileApplicationDetail() {
    const origin = mobileDetailOriginRef.current
    if (origin === 'dashboard') {
      runAnimatedScreenUpdate(
        () => {
          setMobileDetailOpen(false)
          setWorkspaceOpeningFromDashboard(false)
          setScreen('dashboard')
        },
        { scope: 'screen', direction: 'backward' },
      )
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
      runAnimatedScreenUpdate(
        () => {
          setViewModeDirection('to-list')
          setViewMode('list')
          setMobileDetailOpen(false)
          setScreen('workspace')
        },
        {
          scope: 'workspace-view',
          direction: 'backward',
          forceCssFallback: true,
        },
      )
      return
    }
    const firstApplicationId = selectedId ?? workspaceApplications[0]?.id
    if (firstApplicationId) {
      selectApplication(firstApplicationId)
      return
    }
    runAnimatedScreenUpdate(
      () => {
        setViewModeDirection('to-list')
        setViewMode('list')
      },
      { scope: 'workspace-view', direction: 'backward' },
    )
  }

  function selectApplication(applicationId: string, jumpTarget?: WorkspaceJumpTarget) {
    // Cancel the previous one-shot focus immediately, before a lazy destination
    // or View Transition can delay the next record commit.
    setWorkspaceJumpIntent(null)
    if (compactWorkspaceViewport && !mobileDetailOpen) {
      mobileDetailOriginRef.current = screen === 'dashboard' ? 'dashboard' : viewMode === 'kanban' ? 'kanban' : 'list'
    }
    const targetApplication = workspaceApplicationById.get(applicationId)
    const currentIndex = selected ? (visibleApplicationIndexById.get(selected.id) ?? -1) : -1
    const nextIndex = visibleApplicationIndexById.get(applicationId) ?? -1
    const rowDirection = currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex ? 'backward' : 'forward'
    // Opening a focused project is always a forward spatial move on phones;
    // row-relative direction remains useful for desktop record-to-record swaps.
    const direction = compactWorkspaceViewport && !mobileDetailOpen ? 'forward' : rowDirection
    const needsScreenTransition = screen !== 'workspace'
    const needsWorkspaceViewTransition =
      screen === 'workspace' && (viewMode === 'kanban' || !selected || !draftRef.current)
    const nextJumpIntent = jumpTarget ? createWorkspaceJumpIntent(applicationId, jumpTarget) : null
    const draftAlreadyReady = draftRef.current?.id === applicationId
    if (!draftAlreadyReady) clearDetailDraftHydration()
    // Begin the complete-record read in the activation turn. The selected
    // effect below subscribes to the same keyed navigation request, so a hover
    // prefetch, pointer activation, and React commit still use one transport.
    queuedApplicationDetailPrefetchRef.current = null
    if (applicationDetailPrefetchTimerRef.current !== null) {
      window.clearTimeout(applicationDetailPrefetchTimerRef.current)
      applicationDetailPrefetchTimerRef.current = null
    }
    applicationDetailNavigationControllerRef.current?.abort()
    applicationDetailNavigationControllerRef.current = null
    if ((targetApplication as (ApplicationRecord & { __listSlim?: boolean }) | undefined)?.__listSlim) {
      const controller = new AbortController()
      applicationDetailNavigationControllerRef.current = controller
      void loadApplicationDetailForNavigation(applicationId, controller.signal)?.catch(() => undefined)
    }

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
      // A direct project switch always starts from the dossier overview.
      // Notification/task deep links retain their explicit destination tab.
      setTab(jumpTarget?.tab ?? 'dossier')
      setWorkspaceJumpIntent(nextJumpIntent)
      setScreen('workspace')
      setMobileDetailOpen(true)
    }

    const transitionScope: AnimatedScreenTransitionScope = needsScreenTransition
      ? 'screen'
      : needsWorkspaceViewTransition
        ? 'workspace-view'
        : 'dossier-record'
    const destinationReady = needsWorkspaceViewTransition || needsScreenTransition ? prefetchDossierAssets() : undefined
    const beginSelection = () =>
      runAnimatedDossierUpdate(commitSelection, {
        scope: transitionScope,
        direction,
        ready: destinationReady,
        // Cold dashboard/workspace entries and record swaps all publish the
        // lightweight Dossier shell first. Dense tab-derived rows reveal after
        // the handoff, keeping the click and inspector identity responsive.
        deferDossierContent: true,
        // A native record snapshot still has to rasterize the outgoing and
        // incoming Dossier trees together. The local CSS opacity handoff keeps
        // the same visual motion without freezing the pointer turn.
        forceCssFallback: true,
      })

    // The application row has already primed its selection surface in the
    // pointer handler. Commit the Dossier and inspector in that same click
    // turn so neither pane waits for the row's visual settle.
    beginSelection()
  }

  function openDashboardApplication(applicationId: string, jumpTarget?: WorkspaceJumpTarget) {
    setWorkspaceOpeningFromDashboard(true)
    selectApplication(applicationId, jumpTarget)
  }

  function openTourSampleWorkspace(nextTab: DetailTab, jumpTarget?: WorkspaceJumpTarget) {
    setWorkspaceJumpIntent(null)
    ensureTourSampleApplication()
    setWorkspaceLayout(defaultWorkspaceLayout)
    setViewModeDirection('to-list')
    setQuery('')
    setStatusFilters([])
    setSort('deadline')
    setWorkspaceOpeningFromDashboard(true)
    const nextJumpIntent = jumpTarget ? createWorkspaceJumpIntent(TOUR_SAMPLE_APPLICATION_ID, jumpTarget) : null
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
      stepKey === 'open-mail-settings' ||
      stepKey === 'mail-overview' ||
      stepKey === 'open-ai-key' ||
      stepKey === 'ai-key-overview'
    ) {
      setScreen('settings')
      return
    }
    if (stepKey === 'open-ai-composer') {
      openTourSampleWorkspace('mail')
    }
  }

  function openNewApplicationDialog(ownerId: string | null) {
    if (isTeamMode && !canCreateInCurrentTeam) {
      notify(
        i18nValue.tx(
          'team.permissionCreateApplicationsDenied',
          'Your Team permissions do not allow creating applications.',
        ),
        'info',
      )
      return
    }
    const limit = isProUser ? applicationLimit : applicationCreateLimit
    const shouldCheckOwnCreateLimit = !isTeamMode
    if (shouldCheckOwnCreateLimit && !isAdminUser && applicationLimitUsageCount >= limit) {
      openUpgradePage('application-limit', String(applicationLimitUsageCount + 1), String(limit))
      return
    }
    setNewApplicationOwnerHint(ownerId ?? null)
    if (ownerId) {
      // The student id seeds the dialog only. A card-level add action must not
      // narrow the board or application list behind the modal.
      setInterfaceMode('team')
    }
    runWithNavigationGuard(() => {
      // Do not make the click wait for code or locale I/O. LazyOverlayBoundary
      // owns the short pending cue while both resources warm concurrently.
      void Promise.all([preloadLanguage(lang, ['core', 'shared', 'dossier']), loadNewApplicationDialog()]).catch(
        () => undefined,
      )
      setDialogOpen(true)
    })
  }

  function openShareDialog(permission: SharePermission = 'view') {
    if (isTeamMode && !canShareInCurrentTeam) {
      notify(
        i18nValue.tx('team.permissionShareDenied', 'Your Team permissions do not allow creating share links.'),
        'info',
      )
      return
    }
    void Promise.all([preloadLanguage(lang, ['core', 'shared', 'share']), loadShareDialog()]).catch(() => undefined)
    setSharePermission(permission)
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
        width: clampNumber(paneStoredWidth(current, pane) + adjustedDelta, paneWidthMin(pane), paneWidthMax(pane)),
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
        previewLayout =
          adjustedDelta <= PANE_REVEAL_DISTANCE
            ? patchPaneLayout(startLayout, pane, { hidden: true })
            : patchPaneLayout(startLayout, pane, {
                hidden: false,
                width: clampNumber(Math.max(paneStoredWidth(startLayout, pane), adjustedDelta), minWidth, maxWidth),
              })
      } else {
        const rawWidth = paneStoredWidth(startLayout, pane) + adjustedDelta
        previewLayout =
          rawWidth < minWidth - PANE_COLLAPSE_DISTANCE
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
    const requestToken = activeSession.token
    const requestUserId = activeSession.user.id
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return Promise.resolve()
    setNotificationsLoading(true)
    return Promise.all([
      phdApi.listNotifications(requestToken),
      phdApi.listNotifications(requestToken, { archivedOnly: true }),
    ])
      .then(([active, archived]) => {
        if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return
        setNotifications([...active, ...archived].sort((left, right) => right.createdAt.localeCompare(left.createdAt)))
      })
      .catch((error) => {
        if (isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) {
          notify(normalizeError(error, languageRef.current), 'error')
        }
      })
      .finally(() => {
        if (isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) {
          setNotificationsLoading(false)
        }
      })
  }

  function refreshUnreadNotificationCount() {
    const requestToken = activeSession.token
    const requestUserId = activeSession.user.id
    const requestEpoch = sessionIdentityEpochRef.current
    if (!isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) return
    void phdApi
      .unreadNotificationCount(requestToken)
      .then((result) => {
        if (isMountedSessionIdentity(requestUserId, requestToken, requestEpoch)) {
          setUnreadNotificationCount(result.count)
        }
      })
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
    setNotifications((items) =>
      items.map((item) => (idSet.has(item.id) && !item.readAt ? { ...item, readAt: stamp } : item)),
    )
    setUnreadNotificationCount((count) => Math.max(0, count - unreadCountBefore))
    void phdApi.updateNotificationsBulk(activeSession.token, targetIds, 'mark_read').catch(recoverNotificationAction)
  }

  function markNotificationsUnread(ids: string[]) {
    const targetIds = notificationActionIds(ids)
    if (targetIds.length === 0) return
    const idSet = new Set(targetIds)
    const readCountBefore = notifications.filter((item) => idSet.has(item.id) && item.readAt).length
    if (readCountBefore === 0) return
    setNotifications((items) =>
      items.map((item) => (idSet.has(item.id) && item.readAt ? { ...item, readAt: null } : item)),
    )
    setUnreadNotificationCount((count) => count + readCountBefore)
    void phdApi.updateNotificationsBulk(activeSession.token, targetIds, 'mark_unread').catch(recoverNotificationAction)
  }

  function archiveNotifications(ids: string[]) {
    const targetIds = notificationActionIds(ids)
    if (targetIds.length === 0) return
    const idSet = new Set(targetIds)
    const archivedUnreadCount = notifications.filter((item) => idSet.has(item.id) && !item.readAt).length
    const stamp = new Date().toISOString()
    setNotifications((items) =>
      items.map((item) =>
        idSet.has(item.id) && !item.archivedAt ? { ...item, archivedAt: stamp, readAt: item.readAt ?? stamp } : item,
      ),
    )
    setUnreadNotificationCount((count) => Math.max(0, count - archivedUnreadCount))
    void phdApi.updateNotificationsBulk(activeSession.token, targetIds, 'archive').catch(recoverNotificationAction)
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
    const targetId =
      item.targetId ??
      (tab === 'materials' && materialId ? `material-${materialId}` : null) ??
      (tab === 'materials' && taskId ? `task-${taskId}` : null) ??
      (tab === 'mail' && communicationId ? `communication-${communicationId}` : null) ??
      (tab === 'review' && commentId ? `review-comment-${commentId}` : null) ??
      (tab === 'funding' && scholarshipId ? `scholarship-${scholarshipId}` : null) ??
      'dossier-config-card'
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
    if (normalizedPath.startsWith('/team/accept-invite/') || normalizedPath.startsWith('/team/join/')) {
      window.location.assign(normalizedPath)
      return
    }
    const pathname = normalizedPath.split(/[?#]/)[0]
    const parsed = pathname ? parseRoute(pathname) : null
    const applicationId = parsed?.screen === 'workspace' && parsed.selectedId ? parsed.selectedId : item.applicationId
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
    setDraftState(cloneApplication(nextApp))
    scheduleApplicationAutoSave(nextApp, 'immediate')
  }

  // Detect when the URL requested a specific application that doesn't exist (or isn't yet loaded).
  // Only fires once applications have actually been fetched so a loading blink doesn't flash 404.
  const applicationNotFound =
    applicationsLoaded && screen === 'workspace' && selectedId !== null && !workspaceApplicationById.has(selectedId)

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
          void switchWorkspaceMode('team', {
            screen: 'team',
            teamSection: 'overview',
          })
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
        onRun: () =>
          setWorkspaceLayout((current) => ({
            ...current,
            applicationsHidden: !current.applicationsHidden,
          })),
      },
      {
        id: 'toggle-inspector-pane',
        label: i18nValue.tx('shortcuts.toggleInspectorPane'),
        description: i18nValue.tx('commandPalette.toggleInspectorDesc'),
        icon: <PanelRightOpen size={15} aria-hidden="true" />,
        shortcut: `${modLabel} I`,
        disabled: screen !== 'workspace',
        keywords: ['inspector', 'sidebar'],
        onRun: () =>
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorHidden: !current.inspectorHidden,
          })),
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
    ? (workspaceApplicationById.get(displayedDossierDraft.id) ?? displayedDossierDraft)
    : null
  const dossierHandoffPending = Boolean(selected && !activeDraft && displayedDossierDraft)
  // Ordinary rail and desktop tab changes paint their full destination
  // immediately. Record changes intentionally publish a bounded dossier shell
  // first; secondary cards and long tab-derived rows join after the handoff.
  const deferScreenProgressiveReveal = false
  const deferDossierHeavyContent = dossierContentDeferred
  const isTeamStudentDashboard =
    screen === 'team' && isTeamMode && teamViewerRole === 'member' && teamSection === 'overview'
  const openAiKeyConfiguration = () => {
    setDossierEnrichmentOpen(false)
    if (isTeamMode && teamViewerRole === 'owner') {
      runAnimatedScreenUpdate(
        () => {
          setTeamSection('settings')
          setScreen('team')
          setMobileDetailOpen(false)
        },
        {
          scope: 'screen',
          direction: 'forward',
          readinessGate: screenReadinessGate(teamScreen),
        },
      )
      return
    }
    setFocusAiKeys(true)
    runAnimatedScreenUpdate(
      () => {
        setInterfaceMode('personal')
        setScreen('settings')
        setMobileDetailOpen(false)
      },
      {
        scope: 'screen',
        direction: 'forward',
        readinessGate: screenReadinessGate(settingsScreen),
      },
    )
  }

  const returnToDashboardFromMissingRoute = () => {
    runWithNavigationGuard(() => {
      runAnimatedRailScreenUpdate(
        () => {
          setRouteNotFound(false)
          setScreen('dashboard')
          setMobileDetailOpen(false)
        },
        {
          direction: 'backward',
          ready: warmCriticalScreenAssets('dashboard', tab, lang, viewMode),
          readinessGate: readinessGateForScreen('dashboard', viewMode),
        },
      )
    })
  }

  const workspaceKanbanContent = canUseWorkspaceBoard ? (
    <KanbanBoard
      applications={visibleApplications}
      customApplicationStatuses={activeSession.user.settings.customApplicationStatuses}
      onNew={isTeamMode ? undefined : () => openNewApplicationDialog(null)}
      teamStudents={isTeamMode ? teamBoardStudents : undefined}
      onNewForStudent={
        isTeamMode && canCreateInCurrentTeam ? (studentId) => openNewApplicationDialog(studentId) : undefined
      }
      onPrefetch={prefetchApplicationEntry}
      onStatusChange={(id, status) => {
        const app = workspaceApplicationById.get(id)
        if (!app || app.status === status) return
        void saveApplicationQuietly(
          { ...currentApplicationDraft(app), status },
          i18nValue.tx('toast.statusUpdated', 'Status updated'),
        )
      }}
      onSelect={(id) => {
        selectApplication(id)
      }}
      onOpenInNewPage={(id) => openApplicationsInTabs([id])}
      onOpenMany={openApplicationsInTabs}
      onExportApplication={isTeamMode ? undefined : (id) => exportSelectedApplications([id])}
      onExportMany={isTeamMode ? undefined : exportSelectedApplications}
      onCopy={copyValue}
      onDeleteApplication={isTeamMode ? undefined : (id) => confirmDeleteApplications([id])}
      onDeleteMany={isTeamMode ? undefined : confirmDeleteApplications}
      deferInactiveView
    />
  ) : null

  // Main content based on screen
  const mainContent =
    screen === 'discover' && (!canUseDiscover || (isTeamMode && !teamDiscoverScope)) ? (
      <DeferredPanel variant="dashboard" />
    ) : screen === 'dashboard' || isTeamStudentDashboard ? (
      <Dashboard
        applications={workspaceApplications}
        recentOpenedIds={isTeamMode ? [] : recentOpenedIds}
        onSelect={(id, target) => {
          runWithNavigationGuard(() => openDashboardApplication(id, target))
        }}
        onOpenInNewPage={isTeamMode ? undefined : (id) => openApplicationsInTabs([id])}
        onExportApplication={isTeamMode ? undefined : (id) => exportSelectedApplications([id])}
        onCopy={copyValue}
        onToggleTask={
          isTeamMode
            ? undefined
            : async (applicationId, taskId, done) => {
                const beforeToggle = applications.find((application) => application.id === applicationId)
                if (!beforeToggle) return
                if (connectivityUnavailable()) {
                  await saveApplicationQuietly(
                    {
                      ...beforeToggle,
                      tasks: beforeToggle.tasks.map((task) => (task.id === taskId ? { ...task, done } : task)),
                    },
                    i18nValue.tx('toast.taskUpdated'),
                  )
                  return
                }
                await runApplicationMutation(applicationId, async () => {
                  const requestKey = `${applicationId}:${taskId}`
                  const requestId = (taskToggleRequestRef.current.get(requestKey) ?? 0) + 1
                  taskToggleRequestRef.current.set(requestKey, requestId)
                  updateApplicationInState(applicationId, (application) => ({
                    ...application,
                    tasks: application.tasks.map((task) => (task.id === taskId ? { ...task, done } : task)),
                  }))
                  try {
                    const task = await phdApi.patchTask(activeSession.token, applicationId, taskId, { done })
                    if (taskToggleRequestRef.current.get(requestKey) !== requestId) return
                    updateApplicationInState(applicationId, (application) => ({
                      ...application,
                      tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
                    }))
                  } catch (error) {
                    if (taskToggleRequestRef.current.get(requestKey) === requestId) {
                      const previousDone = beforeToggle.tasks.find((task) => task.id === taskId)?.done ?? !done
                      updateApplicationInState(applicationId, (application) => ({
                        ...application,
                        tasks: application.tasks.map((task) =>
                          task.id === taskId ? { ...task, done: previousDone } : task,
                        ),
                      }))
                    }
                    throw error
                  } finally {
                    if (taskToggleRequestRef.current.get(requestKey) === requestId) {
                      taskToggleRequestRef.current.delete(requestKey)
                    }
                  }
                })
              }
        }
        onPatchMaterialStatus={
          isTeamMode
            ? undefined
            : async (applicationId, materialId, status) => {
                const before = applications.find((application) => application.id === applicationId)
                if (!before) return
                const nextApplication = {
                  ...before,
                  materials: before.materials.map((material) =>
                    material.id === materialId
                      ? {
                          ...material,
                          status,
                          updatedAt: material.updatedAt || new Date().toISOString().slice(0, 10),
                        }
                      : material,
                  ),
                }
                if (connectivityUnavailable()) {
                  await saveApplicationQuietly(
                    nextApplication,
                    i18nValue.tx('toast.materialUpdated', i18nValue.tx('toast.appSaved')),
                  )
                  return
                }
                await runApplicationMutation(applicationId, async () => {
                  updateApplicationInState(applicationId, () => nextApplication)
                  try {
                    const saved = (
                      await phdApi.updateApplication(activeSession.token, nextApplication, before)
                    ).application
                    replaceApplication(saved)
                  } catch (error) {
                    replaceApplication(before)
                    throw error
                  }
                })
              }
        }
        onToggleScholarshipTask={
          isTeamMode
            ? undefined
            : async (applicationId, scholarshipId, taskId, done) => {
                const before = applications.find((application) => application.id === applicationId)
                if (!before) return
                const nextApplication = {
                  ...before,
                  scholarships: before.scholarships.map((scholarship) =>
                    scholarship.id === scholarshipId
                      ? {
                          ...scholarship,
                          tasks: (scholarship.tasks ?? []).map((task) =>
                            task.id === taskId ? { ...task, done } : task,
                          ),
                        }
                      : scholarship,
                  ),
                }
                if (connectivityUnavailable()) {
                  await saveApplicationQuietly(nextApplication, i18nValue.tx('toast.taskUpdated'))
                  return
                }
                await runApplicationMutation(applicationId, async () => {
                  updateApplicationInState(applicationId, () => nextApplication)
                  try {
                    const saved = (
                      await phdApi.updateApplication(activeSession.token, nextApplication, before)
                    ).application
                    replaceApplication(saved)
                  } catch (error) {
                    replaceApplication(before)
                    throw error
                  }
                })
              }
        }
        onPatchScholarshipMaterialStatus={
          isTeamMode
            ? undefined
            : async (applicationId, scholarshipId, materialId, status) => {
                const before = applications.find((application) => application.id === applicationId)
                if (!before) return
                const nextApplication = {
                  ...before,
                  scholarships: before.scholarships.map((scholarship) =>
                    scholarship.id === scholarshipId
                      ? {
                          ...scholarship,
                          materials: (scholarship.materials ?? []).map((material) =>
                            material.id === materialId ? { ...material, status } : material,
                          ),
                        }
                      : scholarship,
                  ),
                }
                if (connectivityUnavailable()) {
                  await saveApplicationQuietly(
                    nextApplication,
                    i18nValue.tx('toast.materialUpdated', i18nValue.tx('toast.appSaved')),
                  )
                  return
                }
                await runApplicationMutation(applicationId, async () => {
                  updateApplicationInState(applicationId, () => nextApplication)
                  try {
                    const saved = (
                      await phdApi.updateApplication(activeSession.token, nextApplication, before)
                    ).application
                    replaceApplication(saved)
                  } catch (error) {
                    replaceApplication(before)
                    throw error
                  }
                })
              }
        }
        onNew={canCreateInCurrentTeam ? () => openNewApplicationDialog(null) : undefined}
        guidanceTeam={isTeamStudentDashboard ? studentGuidanceTeam : undefined}
        guidanceDraftScope={isTeamStudentDashboard && visibleTeamSummary
          ? { userId: activeSession.user.id, workspaceId: visibleTeamSummary.team.id }
          : undefined}
        onSendGuidanceMessage={
          isTeamStudentDashboard && visibleTeamSummary
            ? async (memberId, messageTitle, messageBody) => {
                await phdApi.publishTeamNotification(activeSession.token, visibleTeamSummary.team.id, {
                  title: messageTitle,
                  body: messageBody,
                  channels: ['in_app'],
                  memberIds: [memberId],
                })
                const recipientName = studentGuidanceTeam?.members.find((member) => member.id === memberId)?.name ?? ''
                notify(
                  tpl(i18nValue.tx('dashboard.guidanceMessageSent', 'Message sent to {name}.'), {
                    name: recipientName,
                  }),
                  'success',
                )
              }
            : undefined
        }
        ownerNames={isTeamMode && !isTeamStudentDashboard ? teamApplicationOwnerNames : undefined}
        eyebrow={isTeamMode && !isTeamStudentDashboard ? i18nValue.tx('dashboard.teamEyebrow') : undefined}
        title={isTeamMode && !isTeamStudentDashboard ? i18nValue.tx('dashboard.teamTitle') : undefined}
        subtitle={isTeamMode && !isTeamStudentDashboard ? i18nValue.tx('dashboard.teamSubtitle') : undefined}
        ownerDirectory={isTeamMode && !isTeamStudentDashboard ? ownerDirectory : undefined}
        ownerAvatars={isTeamMode && !isTeamStudentDashboard ? ownerAvatarDirectory : undefined}
        onViewMember={isTeamMode && !isTeamStudentDashboard ? viewMemberApplications : undefined}
        onOpenDiscover={
          isTeamMode || !canUsePersonalDiscover
            ? undefined
            : () => {
                runWithNavigationGuard(() => {
                  runAnimatedRailScreenUpdate(
                    () => {
                      setScreen('discover')
                      setMobileDetailOpen(false)
                    },
                    {
                      direction: 'forward',
                      ready: warmCriticalScreenAssets('discover', tab, lang, viewMode),
                      readinessGate: readinessGateForScreen('discover', viewMode),
                    },
                  )
                })
              }
        }
        deferProgressiveReveal={deferScreenProgressiveReveal}
      />
    ) : screen === 'discover' && activeSession && canUseDiscover && (!isTeamMode || teamDiscoverScope) ? (
      <DiscoverScreen
        token={activeSession.token}
        applications={
          teamDiscoverScope
            ? teamApplications.filter((application) => application.ownerId === teamDiscoverScope.targetUserId)
            : applications
        }
        teamScope={teamDiscoverScope}
        teamTargetOptions={teamCreateStudentOptions}
        onTeamTargetChange={teamDiscoverScope ? setTeamDiscoverTargetUserId : undefined}
        onExitTeamTarget={
          teamDiscoverScope
            ? () => {
                setTeamDiscoverTargetUserId(null)
                setTeamSection('discover')
                startTransition(() => setScreen('team'))
                setMobileDetailOpen(false)
              }
            : undefined
        }
        onConfigureAiKeys={openAiKeyConfiguration}
        deferProgressiveReveal={deferScreenProgressiveReveal}
        realtimeConnected={realtimeUpdates.connected}
        realtimeRevision={discoverRealtimeRevision}
        onNotify={(message, tone) => notify(message, tone ?? 'success')}
        onImported={(created) => {
          setApplications((items) => [created, ...items.filter((item) => item.id !== created.id)])
          runAnimatedDossierUpdate(
            () => {
              setDraftState(cloneApplication(created), { clean: true })
              setSelectedId(created.id)
              setViewModeDirection('to-list')
              setViewMode('list')
              setScreen('workspace')
              setMobileDetailOpen(true)
              setTab('dossier')
            },
            {
              scope: 'screen',
              direction: 'forward',
              ready: prefetchDossierAssets(),
              deferDossierContent: true,
              forceCssFallback: true,
            },
          )
        }}
      />
    ) : screen === 'interview' && !canUseInterview ? (
      <DeferredPanel variant="dashboard" />
    ) : screen === 'interview' && interviewLoadingScope === interviewScopeKey && !interviewWorkspace ? (
      <DeferredPanel variant="dashboard" />
    ) : screen === 'interview' ? (
      <InterviewPrepScreen
        key={interviewScopeKey}
        viewer={{
          userId: activeSession.user.id,
          displayName: activeSession.user.name,
          mode: isTeamMode ? (teamViewerRole === 'member' ? 'student' : 'teacher') : 'personal',
          canEdit: canUseInterview && Boolean(interviewSubjectUserId),
          teamId: interviewTeamId,
        }}
        workspace={interviewCanonicalWorkspace}
        students={isTeamMode && teamViewerRole !== 'member' ? interviewStudents : []}
        selectedStudentId={isTeamMode && teamViewerRole !== 'member' ? interviewSubjectUserId : null}
        onSelectedStudentChange={setInterviewSelectedStudentId}
        recoveryScope={{ sessionUserId: activeSession.user.id, teamId: interviewTeamId }}
        onWorkspaceChange={(workspace) => {
          setInterviewWorkspaces((current) => ({ ...current, [interviewScopeKey]: workspace }))
        }}
        onSave={async (workspace, expectedRevision) => {
          if (connectivityUnavailable()) {
            throw new Error(i18nValue.tx('toast.offlineActionNeedsOnline'))
          }
          const saved = await phdApi.saveInterviewPrepWorkspace(activeSession.token, {
            subjectUserId: interviewSubjectUserId,
            teamId: interviewTeamId,
            workspace,
            expectedRevision,
          })
          setInterviewWorkspaces((current) => ({ ...current, [interviewScopeKey]: saved }))
          return saved
        }}
        onGenerateQuestions={interviewAiKey ? async (request) => {
          return phdApi.generateInterviewQuestions(activeSession.token, {
            ...request,
            teamId: interviewTeamId,
            keyId: interviewAiKey.id,
          })
        } : undefined}
        onGenerateMockTurn={interviewAiKey ? async (request) => {
          return phdApi.generateInterviewMockTurn(activeSession.token, {
            ...request,
            teamId: interviewTeamId,
            keyId: interviewAiKey.id,
          })
        } : undefined}
        aiCapabilityId={interviewAiKey?.id ?? null}
        onGenerateFeedback={interviewAiKey ? async (request) => {
          return phdApi.generateInterviewFeedback(activeSession.token, {
            ...request,
            teamId: interviewTeamId,
            keyId: interviewAiKey.id,
          })
        } : undefined}
        onDirtyChange={(dirty) => {
          if (dirty) dirtyInterviewScopeKeysRef.current.add(interviewScopeKey)
          else dirtyInterviewScopeKeysRef.current.delete(interviewScopeKey)
          if (!dirty) {
            registerNavigationGuard(null)
            return
          }
          registerNavigationGuard((proceed) => {
            setConfirmDialog({
              title: i18nValue.tx('interview.leaveTitle'),
              message: i18nValue.tx('interview.leaveMessage'),
              confirmLabel: i18nValue.tx('interview.leaveConfirm'),
              onConfirm: () => {
                registerNavigationGuard(null)
                proceed()
              },
            })
            return true
          })
        }}
        onNotify={(message, tone) => notify(message, tone ?? 'success')}
      />
    ) : screen === 'profile' ? (
      <ProfileScreen
        assets={profileAssets}
        applications={personalRecommenderApplications}
        session={activeSession}
        deferProgressiveReveal={deferScreenProgressiveReveal}
        removingAssetIds={removingProfileAssetIds}
        onOpenRecommenderApplication={(use) =>
          runWithNavigationGuard(() =>
            selectApplication(use.applicationId, {
              tab: 'dossier',
              targetId: 'application-recommenders',
              fallbackText: [use.schoolName, use.program].filter(Boolean),
            }),
          )
        }
        onUpdateSettings={(patch, message, options) => updateUserSettings(patch, message, options)}
        onUpdateProfileRecommenders={replacePersonalProfileRecommenders}
        onCreateSnippet={(input: ProfileAssetInput, files: File[]) =>
          runOrThrow(async () => {
            const created = await phdApi.addProfileAsset(activeSession.token, {
              ...input,
              // Files fulfill the reservation immediately.
              uploadReserved: files.length > 0 ? false : Boolean(input.uploadReserved),
            })
            try {
              const asset =
                files.length > 0 ? await phdApi.uploadProfileAssetFiles(activeSession.token, created.id, files) : created
              setProfileAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)])
            } catch (error) {
              // Creation and upload are two API calls. If the second call
              // fails, remove the just-created shell before rethrowing so a
              // retry cannot leave duplicate custom snippets behind.
              try {
                await phdApi.deleteProfileAsset(activeSession.token, created.id)
              } catch {
                // The original failure remains the user-facing error. A later
                // profile refresh will reconcile an exceptionally failed
                // cleanup request.
              }
              throw error
            }
          }, i18nValue.tx('toast.profileAssetAdded'))
        }
        onUpdateAsset={(id, input) =>
          runOrThrow(async () => {
            const asset = await phdApi.updateProfileAsset(activeSession.token, id, input)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          }, i18nValue.tx('toast.profileAssetUpdated'))
        }
        onExportAsset={(assetId, format) =>
          runOrThrow(async () => {
            const asset = profileAssets.find((item) => item.id === assetId)
            const blob = await phdApi.downloadProfileAssetExport(activeSession.token, assetId, format, lang)
            const extension = format === 'word' ? 'doc' : 'pdf'
            downloadBlob(blob, `${safeFileSegment(asset?.name || 'profile-document')}.${extension}`)
          }, i18nValue.tx('profile.exportReady'))
        }
        onDeleteAsset={(asset) =>
          setConfirmDialog({
            title: i18nValue.tx('profile.deleteAsset', 'Delete snippet'),
            message: tpl(i18nValue.tx('confirmDeleteProfileAsset'), {
              name: asset.name,
            }),
            confirmLabel: i18nValue.tx('dossier.delete'),
            variant: 'danger',
            onConfirm: () => {
              setRemovingProfileAssetIds((current) => new Set(current).add(asset.id))
              return runOrThrow(async () => {
                  await waitForRemovalHandoff(phdApi.deleteProfileAsset(activeSession.token, asset.id))
                  setProfileAssets((items) => items.filter((item) => item.id !== asset.id))
                }, i18nValue.tx('toast.profileAssetDeleted')).finally(() => {
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
          runOrThrow(async () => {
            const asset = await phdApi.uploadProfileAssetFiles(activeSession.token, assetId, files)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          })
        }
        onRenameFile={(assetId, fileId, fileName) =>
          runOrThrow(async () => {
            const asset = await phdApi.renameProfileAssetFile(activeSession.token, assetId, fileId, fileName)
            setProfileAssets((items) => items.map((item) => (item.id === asset.id ? asset : item)))
          })
        }
        onDeleteFile={(assetId, fileId) =>
          runOrThrow(async () => {
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
          runOrThrow(async () => {
            const share = await phdApi.shareProfileAsset(activeSession.token, assetId, expiresAtForShare(expiry), note)
            setProfileAssets((items) =>
              items.map((item) => (item.id === assetId ? { ...item, shares: [...(item.shares ?? []), share] } : item)),
            )
            // Share creation is durably acknowledged by the POST itself. A
            // metadata refresh is secondary and must not make the user retry
            // a request that already succeeded (which would create a duplicate).
            try {
              await refreshSessionMetadata(activeSession)
            } catch {
              // The next normal session refresh will reconcile the quota/count.
            }
          })
        }
        onRevokeShare={(assetId, shareId) =>
          runOrThrow(async () => {
            await phdApi.revokeProfileAssetShare(activeSession.token, assetId, shareId)
            setProfileAssets((items) =>
              items.map((item) =>
                item.id === assetId
                  ? {
                      ...item,
                      shares: (item.shares ?? []).filter((share) => share.id !== shareId),
                    }
                : item,
              ),
            )
            // The revoke request and local share removal are the durable
            // acknowledgement.  A best-effort metadata refresh must not make
            // the user retry a revoke that already succeeded.
            try {
              await refreshSessionMetadata(activeSession)
            } catch {
              // A later session refresh will reconcile the quota/count.
            }
          })
        }
        onCopy={copyValue}
      />
    ) : screen === 'settings' ? (
      <SettingsScreen
        session={activeSession}
        focusAiKeys={focusAiKeys}
        onAiKeysFocused={() => setFocusAiKeys(false)}
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
            const user = await persistSettingsPatch(requestSession, {
              browserNotificationsEnabled: true,
            }, requestEpoch)
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
          const user = await persistSettingsPatch(requestSession, {
            browserNotificationsEnabled: false,
          }, requestEpoch)
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
        onLogout={desktopRuntime.enabled ? undefined : () => runWithNavigationGuard(logout)}
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
        onUpdateSettings={(patch, message, options) => updateUserSettings(patch, message, options)}
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
              const user = await persistSettingsPatch(requestSession, patch)
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
            }, sessionIdentityEpochRef.current, false)
            return result.verificationSentAt
          }, i18nValue.tx('toast.verificationEmailSent'))
        }
        onTestIncomingMail={(patch) =>
          run(async () => {
            const requestSession = activeSession
            let nextSession = requestSession
            if (patch && Object.keys(patch).length > 0) {
              const user = await persistSettingsPatch(requestSession, patch)
              const committedSession = commitSettingsUser(requestSession, user, patch)
              if (!committedSession) return
              nextSession = committedSession
            }
            await phdApi.testIncomingMail(nextSession.token)
          }, i18nValue.tx('toast.incomingMailTestPassed'))
        }
        onFetchMailNow={(patch) => syncMailbox('incremental', patch)}
        onSyncMailHistory={(patch) => syncMailbox('history', patch)}
        exportApplicationCount={applications.length}
        desktopRuntime={desktopRuntime}
        onDesktopUnlockPassword={async (input) => {
          const runtime = await phdApi.setDesktopUnlockPassword(activeSession.token, input)
          rememberDesktopRuntime(runtime)
          setDesktopRuntimeState(runtime)
        }}
        onCompleteExport={async () => {
          const snapshot = await phdApi.exportCompleteWorkspace(activeSession.token)
          const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
          downloadBlob(blob, `phd-atlas-complete-${new Date().toISOString().slice(0, 10)}.json`)
        }}
        onDesktopConnect={async (origin, email, password) => {
          const result = await phdApi.connectDesktopRemote(activeSession.token, origin, email, password)
          rememberDesktopRuntime(result.runtime)
          setDesktopRuntimeState(result.runtime)
          await refreshSessionMetadata(activeSession)
        }}
        onDesktopDisconnect={async () => {
          const runtime = await phdApi.disconnectDesktopRemote(activeSession.token)
          rememberDesktopRuntime(runtime)
          setDesktopRuntimeState(runtime)
          await refreshSessionMetadata(activeSession)
        }}
        onCompleteImport={async (file) => {
          const text = await file.text()
          const snapshot = JSON.parse(text) as Record<string, unknown>
          await phdApi.importCompleteWorkspace(activeSession.token, snapshot)
          await refreshApplicationsAndSessionMetadata(activeSession)
          const nextAssets = await phdApi.listProfileAssets(activeSession.token)
          setProfileAssets(nextAssets)
        }}
        onExport={(format) => {
          if (applications.length === 0) {
            notify(i18nValue.tx('settings.noApplicationsToExport'), 'info')
            return
          }
          void run(
            async () => {
              const blob = await phdApi.downloadExport(activeSession.token, format, undefined, lang)
              downloadBlob(blob, `phd-applications-all.${format === 'excel' ? 'xls' : format}`)
            },
            tpl(i18nValue.tx('toast.exported'), {
              format: format.toUpperCase(),
            }),
          )
        }}
        onDeleteAccount={() =>
          setConfirmDialog({
            title: i18nValue.tx('settings.deleteAccount'),
            message: i18nValue.tx('confirmDeleteAccount'),
            confirmLabel: i18nValue.tx('settings.deleteAccount'),
            variant: 'danger',
            onConfirm: () => runOrThrow(async () => {
              await phdApi.deleteAccount(activeSession.token)
              logout()
            }, i18nValue.tx('toast.accountDeleted')),
          })
        }
        allShares={allShares}
        onRevokeShare={(applicationId, shareId) =>
          runOrThrow(async () => {
            await phdApi.revokeShare(activeSession.token, applicationId, shareId)
            updateApplicationInState(applicationId, (application) => ({
              ...application,
              shares: (application.shares ?? []).filter((share) => share.id !== shareId),
            }))
            try {
              await refreshSessionMetadata(activeSession)
            } catch {
              // The share mutation already succeeded; do not force a retry.
            }
          }, i18nValue.tx('toast.shareRevoked'))
        }
        onUpdateShare={(applicationId, shareId, expiresAt, permission, sections) =>
          void run(async () => {
            const share = await phdApi.updateShare(
              activeSession.token,
              applicationId,
              shareId,
              expiresAt,
              permission,
              sections,
            )
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
          runOrThrow(async () => {
            await phdApi.revokeProfileAssetShare(activeSession.token, assetId, shareId)
            setProfileAssets((items) =>
              items.map((asset) =>
                asset.id === assetId
                  ? {
                      ...asset,
                      shares: (asset.shares ?? []).filter((share) => share.id !== shareId),
                    }
                : asset,
              ),
            )
            try {
              await refreshSessionMetadata(activeSession)
            } catch {
              // The share mutation already succeeded; do not force a retry.
            }
          }, i18nValue.tx('toast.shareRevoked'))
        }
        onUpdateAssetShare={(assetId, shareId, expiresAt) =>
          void run(async () => {
            const share = await phdApi.updateProfileAssetShare(activeSession.token, assetId, shareId, expiresAt)
            setProfileAssets((items) =>
              items.map((asset) =>
                asset.id === assetId
                  ? {
                      ...asset,
                      shares: (asset.shares ?? []).map((item) => (item.id === share.id ? share : item)),
                    }
                  : asset,
              ),
            )
            await refreshSessionMetadata(activeSession)
          }, i18nValue.tx('toast.shareUpdated'))
        }
        onReplayTutorial={handleReplayTutorial}
      />
    ) : screen === 'team' && !PUBLIC_EDITION ? (
      <TeamScreen
        key={`team-screen:${activeSession.user.id}:${activeTeamId ?? visibleTeamSummary?.team.id ?? 'default'}`}
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
        studentRecommenderProfiles={teamRecommenderProfilesByStudent}
        studentRecommenderLoadingIds={teamRecommenderLoadingIds}
        onLoadStudentRecommenders={requestTeamStudentRecommenders}
        onUpdateStudentRecommenders={replaceTeamStudentProfileRecommenders}
        canEditStudentRecommenders={() => canEditInCurrentTeam}
        activeSection={teamSection}
        hideTabs
        personalProfileAssets={profileAssets}
        onCreatePersonalProfileAsset={async (input) => {
          const created = await phdApi.addProfileAsset(activeSession.token, {
            ...input,
            uploadReserved: false,
          })
          setProfileAssets((items) => [created, ...items.filter((item) => item.id !== created.id)])
          notify(i18nValue.tx('toast.profileAssetAdded'), 'success')
        }}
        onUpdatePersonalProfileAsset={async (assetId, input) => {
          const saved = await phdApi.updateProfileAsset(activeSession.token, assetId, input)
          setProfileAssets((items) => items.map((item) => (item.id === saved.id ? saved : item)))
          notify(i18nValue.tx('toast.profileAssetUpdated'), 'success')
        }}
        onDeletePersonalProfileAsset={async (assetId) => {
          await phdApi.deleteProfileAsset(activeSession.token, assetId)
          setProfileAssets((items) => items.filter((item) => item.id !== assetId))
          notify(i18nValue.tx('toast.profileAssetDeleted'), 'success')
        }}
        onSectionChange={(section) => {
          // Applications is a routed workspace surface, so it must still hand off
          // from a team tab. Other already-active team tabs need no transition.
          if (section === teamSection && section !== 'applications') return
          // Route through the same animated path as the rail team section control.
          // (In-team swaps animate inside TeamScreen; applications uses rail handoff.)
          if (section === 'applications') {
            const destinationViewMode = teamViewerRole === 'member' ? ('list' as const) : ('kanban' as const)
            const direction =
              validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection) ? 'forward' : 'backward'
            runWithNavigationGuard(() => {
              runAnimatedRailScreenUpdate(
                () => {
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
                },
                {
                  direction,
                  ready: warmCriticalScreenAssets('workspace', tab, lang, destinationViewMode),
                  readinessGate: readinessGateForScreen('workspace', destinationViewMode),
                },
              )
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
        onCreateApplication={
          canCreateInCurrentTeam
            ? (ownerId) => {
                setInterfaceMode('team')
                setTeamSection('applications')
                openNewApplicationDialog(ownerId ?? null)
              }
            : undefined
        }
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
    ) : screen === 'workspace' && renderedWorkspaceViewMode === 'list' && compactWorkspaceViewport && !mobileDetailOpen ? (
      <DeferredPanel />
    ) : screen === 'workspace' && renderedWorkspaceViewMode === 'kanban' && canUseWorkspaceBoard ? (
      null
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
            recommenderOptions={
              !isTeamMode
                ? personalRecommenderOptions
                : selectedTeamRecommenderOptions
            }
            pendingRecommenderDrafts={
              pendingRecommenderDraftsByApplication[displayedDossierApplication.id] ?? EMPTY_RECOMMENDER_OPTIONS
            }
            onPendingRecommenderDraftsChange={(drafts) =>
              replacePendingRecommenderDrafts(displayedDossierApplication.id, drafts)
            }
            onResolveRecommender={
              isTeamMode
                ? (recommender, decision) =>
                    resolveTeamApplicationRecommender(
                      displayedDossierApplication.id,
                      recommender,
                      decision,
                    )
                : (recommender, decision) =>
                    resolvePersonalApplicationRecommender(
                      displayedDossierApplication.id,
                      recommender,
                      decision,
                    )
            }
            deferHeavyContent={deferDossierHeavyContent}
            aiKeys={enabledAiKeys}
            onAiDraft={async (input, onEvent, signal) => {
              await phdApi.streamAiDraft(activeSession.token, input, onEvent, signal)
              phdApi
                .listAiKeys(activeSession.token)
                .then(setAiKeys)
                .catch(() => undefined)
            }}
            onAiInspectorOpenChange={handleAiInspectorOpenChange}
            onNotify={notify}
            session={activeSession}
            currentUserApplicationRole={selectedTeamMeta?.currentUserApplicationRole}
            applicationOwnerName={
              selectedTeamMeta && selectedTeamMeta.ownerId !== activeSession.user.id
                ? selectedTeamMeta.ownerName
                : undefined
            }
            readOnly={isTeamMode && !canEditInCurrentTeam}
            canShareApplication={canShareInCurrentTeam}
            canDeliverMail={desktopRemoteEnabled(desktopRuntime)}
            canDeleteApplication={!isTeamMode || canEditInCurrentTeam}
            jumpIntent={workspaceJumpIntent}
            onJumpIntentConsumed={consumeWorkspaceJumpIntent}
            onTab={(nextTab, direction) =>
              runAnimatedDossierUpdate(
                () => {
                  setWorkspaceJumpIntent(null)
                  setTab(nextTab)
                },
                {
                  scope: 'dossier-tab',
                  direction,
                  deferDossierContent: compactWorkspaceViewport && nextTab === 'materials',
                },
              )
            }
            onRegisterNavigationGuard={registerNavigationGuard}
            saveErrorMessage={
              applicationSaveStatus.phase === 'error' ? applicationSaveStatus.message : undefined
            }
            onReviewSaveFailure={() => {
              // Put the person in front of the field that refused the save. If
              // the server named no field, the status banner is the best the
              // editor can offer, so scroll that into view instead.
              if (flashInvalidField(lastSaveErrorFieldRef.current)) return
              document
                .querySelector('.application-save-status, .save-status')
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }}
            onDraftInteraction={clearDetailDraftHydration}
            autoSaveEnabled
            onFlushAutoSave={flushApplicationAutoSave}
            onDraft={(nextDraft, intent = 'settled') => {
              // A Dossier interaction is newer than a queued idle hydration.
              // In particular, an intentionally blank recommender row is kept
              // local until it gains real content; do not let the selection's
              // older normalized snapshot replace that affordance mid-edit.
              if (nextDraft.id === selected.id) clearDetailDraftHydration()
              setDraftState(nextDraft)
              if (intent !== 'external') {
                scheduleApplicationAutoSave(nextDraft, intent)
              }
            }}
            onCopy={copyValue}
            onResolveSchoolLogo={(input, options) =>
              resolveAndStoreSchoolLogo(displayedDossierApplication, input, options)
            }
            onUploadSchoolLogo={(file) => uploadAndStoreSchoolLogo(displayedDossierApplication, file)}
            onRemoveSchoolLogo={() => removeStoredSchoolLogo(displayedDossierApplication)}
            canToggleTeamVisibility={canToggleSelectedTeamVisibility}
            teamTransferRequiresApproval={!canDirectlyMoveSelectedTeamApplication}
            teamTransferOrganizations={selectedTeamTransferOptions}
            onPreflightTeamTransfer={(visibleToTeam, teamId) =>
              phdApi.preflightApplicationTeamTransfer(activeSession.token, selected.id, { visibleToTeam, teamId })
            }
            onToggleTeamVisibility={(visibleToTeam, teamId) => {
              if (!selected) return undefined
              return toggleApplicationTeamVisibility(selected.id, visibleToTeam, teamId)
            }}
            onCustomApplicationStatusesChange={(statuses) =>
              updateUserSettings({
                customApplicationStatuses: statuses,
              })
            }
            onCustomChecklistStatusesChange={(statuses) =>
              updateUserSettings({
                customChecklistStatuses: statuses,
              })
            }
            onCustomMailCategoriesChange={(categories) =>
              updateUserSettings({
                customMailCategories: categories,
              })
            }
            onCustomChecklistMaterialFormatsChange={(formats) =>
              updateUserSettings({
                customChecklistMaterialFormats: formats,
              })
            }
            onSave={saveCurrentDraft}
            onDiscardDraft={discardDraft}
            onDelete={() => runWithNavigationGuard(() =>
              setConfirmDialog({
                title: i18nValue.tx('dossier.delete'),
                message: tpl(i18nValue.tx('confirmDeleteApplication'), {
                  name: selected.school.name,
                }),
                confirmLabel: i18nValue.tx('dossier.delete'),
                variant: 'danger',
                onConfirm: () => {
                  const applicationId = selected.id
                  setRemovingApplicationIds((current) => new Set(current).add(applicationId))
                  return runOrThrow(async () => {
                      await waitForRemovalHandoff(deleteApplicationAfterPendingWrites(applicationId))
                      removeApplicationFromState(applicationId)
                      notify(i18nValue.tx('toast.appDeleted'))
                      await refreshTrashAndSessionMetadata(activeSession)
                    }).finally(() => {
                    setRemovingApplicationIds((current) => {
                      const next = new Set(current)
                      next.delete(applicationId)
                      return next
                    })
                  })
                },
              }),
            )}
            onShare={openShareDialog}
            onEnrich={() => {
              void (async () => {
                if (isDraftDirty && !(await saveCurrentDraft())) return
                await Promise.all([
                  preloadLanguage(lang, ['core', 'shared', 'discover']),
                  loadDiscoverApplicationEnrichmentDialog(),
                ]).catch(() => undefined)
                setDossierEnrichmentOpen(true)
              })()
            }}
            onOpenUpgrade={openUpgradePage}
            onCloseApplication={() => runWithNavigationGuard(closeApplicationDetail)}
            onUpload={(file) =>
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const material = await phdApi.addMaterial(activeSession.token, selected.id, {
                    name: file?.name ?? i18nValue.tx('dossier.newMaterial'),
                    type: file
                      ? inferChecklistMaterialType(file.name, file.type)
                      : defaultChecklistMaterialType,
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
                },
                file ? i18nValue.tx('toast.materialUploaded') : i18nValue.tx('toast.materialAdded'),
              )
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
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const material = await phdApi.uploadMaterialFiles(activeSession.token, selected.id, materialId, files)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    materials: application.materials.map((item) => (item.id === material.id ? material : item)),
                    versions: material.versions?.length
                      ? [
                          ...application.versions.filter(
                            (version) => !material.versions?.some((candidate) => candidate.id === version.id),
                          ),
                          ...material.versions,
                        ]
                      : application.versions,
                  }))
                },
                i18nValue.tx('toast.materialUploaded'),
              )
            }
            onRemoveMaterialFile={(materialId, fileId) =>
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const material = await phdApi.removeMaterialFile(activeSession.token, selected.id, materialId, fileId)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    materials: application.materials.map((item) => (item.id === material.id ? material : item)),
                    versions: application.versions.filter((version) => version.fileId !== fileId),
                  }))
                },
                i18nValue.tx('toast.attachmentRemoved'),
              )
            }
            onRenameMaterialFile={(materialId, fileId, fileName) =>
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const material = await phdApi.renameMaterialFile(
                    activeSession.token,
                    selected.id,
                    materialId,
                    fileId,
                    fileName,
                  )
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    materials: application.materials.map((item) => (item.id === material.id ? material : item)),
                  }))
                },
                i18nValue.tx('toast.attachmentRenamed', i18nValue.tx('toast.materialUpdated', 'Attachment renamed')),
              )
            }
            onUploadTaskFiles={(taskId, files) =>
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const task = await phdApi.uploadTaskFiles(activeSession.token, selected.id, taskId, files)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
                    versions: task.versions?.length
                      ? [
                          ...application.versions.filter(
                            (version) => !task.versions?.some((candidate) => candidate.id === version.id),
                          ),
                          ...task.versions,
                        ]
                      : application.versions,
                  }))
                },
                i18nValue.tx('toast.taskUpdated'),
              )
            }
            onRemoveTaskFile={(taskId, fileId) =>
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const task = await phdApi.removeTaskFile(activeSession.token, selected.id, taskId, fileId)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
                    versions: application.versions.filter((version) => version.fileId !== fileId),
                  }))
                },
                i18nValue.tx('toast.attachmentRemoved'),
              )
            }
            onRenameTaskFile={(taskId, fileId, fileName) =>
              runInteractiveApplicationMutation(
                selected.id,
                async () => {
                  const task = await phdApi.renameTaskFile(activeSession.token, selected.id, taskId, fileId, fileName)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
                  }))
                },
                i18nValue.tx('toast.attachmentRenamed', i18nValue.tx('toast.taskUpdated', 'Attachment renamed')),
              )
            }
            onAddTask={(title, due, options) =>
              connectivityUnavailable()
                ? void saveApplicationQuietly(
                    {
                      ...currentApplicationDraft(selected),
                      tasks: [
                        {
                          id: `task-${Date.now()}`,
                          title,
                          due,
                          done: false,
                          ...options,
                        },
                        ...currentApplicationDraft(selected).tasks,
                      ],
                    },
                    i18nValue.tx('toast.taskAdded'),
                  )
                : void runApplicationMutation(selected.id, async () => {
                    if (!title.trim()) throw new Error(i18nValue.tx('toast.taskTitleRequired'))
                    const task = await phdApi.addTask(activeSession.token, selected.id, {
                      title,
                      due,
                      done: false,
                      ...options,
                    })
                    updateApplicationInState(selected.id, (application) => ({
                      ...application,
                      tasks: [task, ...application.tasks],
                    }))
                  })
            }
            onUpdateTask={(taskId, patch) =>
              connectivityUnavailable()
                ? void saveApplicationQuietly(
                    {
                      ...currentApplicationDraft(selected),
                      tasks: currentApplicationDraft(selected).tasks.map((task) =>
                        task.id === taskId ? { ...task, ...patch } : task,
                      ),
                    },
                    i18nValue.tx('toast.taskUpdated'),
                  )
                : void runApplicationMutation(selected.id, async () => {
                    const task = await phdApi.patchTask(activeSession.token, selected.id, taskId, patch)
                    updateApplicationInState(selected.id, (application) => ({
                      ...application,
                      tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
                    }))
                  })
            }
            onToggleTask={(taskId, done, status) =>
              connectivityUnavailable()
                ? void saveApplicationQuietly(
                    {
                      ...currentApplicationDraft(selected),
                      tasks: currentApplicationDraft(selected).tasks.map((task) =>
                        task.id === taskId ? { ...task, done, ...(status ? { status } : {}) } : task,
                      ),
                    },
                    i18nValue.tx('toast.taskUpdated'),
                  )
                : void runApplicationMutation(selected.id, async () => {
                    const beforeToggle = selected
                    const requestKey = `${selected.id}:${taskId}`
                    const requestId = (taskToggleRequestRef.current.get(requestKey) ?? 0) + 1
                    taskToggleRequestRef.current.set(requestKey, requestId)
                    updateApplicationInState(selected.id, (application) => ({
                      ...application,
                      tasks: application.tasks.map((task) => (task.id === taskId ? { ...task, done } : task)),
                    }))
                    try {
                    const task = await phdApi.patchTask(activeSession.token, selected.id, taskId, {
                      done,
                      ...(status ? { status } : {}),
                    })
                      if (taskToggleRequestRef.current.get(requestKey) !== requestId) return
                      updateApplicationInState(selected.id, (application) => ({
                        ...application,
                        tasks: application.tasks.map((item) => (item.id === task.id ? task : item)),
                      }))
                    } catch (error) {
                      if (taskToggleRequestRef.current.get(requestKey) === requestId) {
                        const previousDone = beforeToggle.tasks.find((task) => task.id === taskId)?.done ?? !done
                        updateApplicationInState(selected.id, (application) => ({
                          ...application,
                          tasks: application.tasks.map((task) =>
                            task.id === taskId ? { ...task, done: previousDone } : task,
                          ),
                        }))
                      }
                      throw error
                    } finally {
                      if (taskToggleRequestRef.current.get(requestKey) === requestId) {
                        taskToggleRequestRef.current.delete(requestKey)
                      }
                    }
                  })
            }
            onRemoveTask={(taskId) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  tasks: currentApplicationDraft(selected).tasks.filter((t) => t.id !== taskId),
                },
                i18nValue.tx('toast.taskRemoved'),
              )
            }
            onRemoveTasks={(taskIds) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  tasks: currentApplicationDraft(selected).tasks.filter((task) => !taskIds.includes(task.id)),
                },
                i18nValue.tx('toast.taskRemoved'),
              )
            }
            onAddCommunication={async (input: CommunicationInput) => {
              const offlineCommunication = createOfflineCommunication(input)
              if (connectivityUnavailable() && offlineCommunication) {
                const source = currentApplicationDraft(selected)
                const result = await saveApplicationQuietly(
                  {
                    ...source,
                    communications: [offlineCommunication, ...source.communications],
                  },
                  i18nValue.tx('toast.commAdded'),
                )
                return result.status === 'saved' || result.status === 'queued'
              }
              const saved = await runApplicationMutation(selected.id, async () => {
                if (!input.subject.trim() || !input.summary.trim())
                  throw new Error(i18nValue.tx('toast.subjectSummaryRequired'))
                const communication = await phdApi.addCommunication(activeSession.token, selected.id, input)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  communications: [communication, ...application.communications],
                }))
                return true
              })
              return saved === true
            }}
            onUpdateCommunication={async (id, input) => {
              const saved = await runApplicationMutation(selected.id, async () => {
                if (input.subject !== undefined && !input.subject.trim())
                  throw new Error(i18nValue.tx('toast.subjectSummaryRequired'))
                if (input.summary !== undefined && !input.summary.trim())
                  throw new Error(i18nValue.tx('toast.subjectSummaryRequired'))
                const communication = await phdApi.updateCommunication(activeSession.token, selected.id, id, input)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  communications: application.communications.map((item) =>
                    item.id === communication.id ? communication : item,
                  ),
                }))
                return true
              })
              return saved === true
            }}
            onSetCommunicationCategory={async (communicationIds, categories) => {
              const targetBatches = mailClassificationCommunicationIdBatches(communicationIds)
              const targetIds = targetBatches.flat()
              if (targetIds.length === 0) return false

              if (connectivityUnavailable()) {
                notify(i18nValue.tx('toast.offlineActionNeedsOnline'), 'warning')
                return false
              }

              const saved = await runApplicationMutation(selected.id, async () => {
                for (const batchIds of targetBatches) {
                  const requestSignature = JSON.stringify([
                    activeSession.user.id,
                    selected.id,
                    'manual',
                    [...batchIds].sort(),
                    categories,
                  ])
                  const requestId = mailClassificationIdempotencyKeysRef.current.get(requestSignature)
                    ?? persistedMailClassificationRequestId(activeSession.user.id, requestSignature)
                    ?? createMailClassificationRequestId()
                  mailClassificationIdempotencyKeysRef.current.set(requestSignature, requestId)
                  if (!rememberMailClassificationRequestId(
                    activeSession.user.id,
                    requestSignature,
                    requestId,
                  )) {
                    mailClassificationIdempotencyKeysRef.current.delete(requestSignature)
                    throw new Error(i18nValue.tx('localRecoveryUnavailable'))
                  }
                  const result = await phdApi.setCommunicationCategories(
                    activeSession.token,
                    selected.id,
                    {
                      communicationIds: batchIds,
                      categories,
                      // Primary built-in, for readers of the single-valued shape.
                      category: categories.find(isBuiltInMailCategory) ?? null,
                    },
                    { idempotencyKey: requestId },
                  ).catch((error) => {
                    if (!shouldRetainMailClassificationRequestId(error)) {
                      mailClassificationIdempotencyKeysRef.current.delete(requestSignature)
                      forgetMailClassificationRequestId(activeSession.user.id, requestSignature)
                    }
                    throw error
                  })
                  mailClassificationIdempotencyKeysRef.current.delete(requestSignature)
                  forgetMailClassificationRequestId(activeSession.user.id, requestSignature)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    communications: mergeMailClassificationDeltas(
                      application.communications,
                      result.communications,
                    ),
                  }))
                }
                notify(i18nValue.tx('toast.commUpdated'))
                return true
              })
              return saved === true
            }}
            onClassifyCommunications={async (communicationIds) => {
              const targetBatches = mailClassificationCommunicationIdBatches(communicationIds)
              const targetIds = targetBatches.flat()
              if (targetIds.length === 0) return false
              if (connectivityUnavailable()) {
                notify(i18nValue.tx('toast.offlineActionNeedsOnline'), 'warning')
                return false
              }

              const eligibleKeys = selected.teamId
                ? enabledAiKeys.filter((key) => key.scope === 'team' && key.teamId === selected.teamId)
                : enabledAiKeys.filter((key) => key.scope === 'personal' && key.ownerId === activeSession.user.id)
              const aiKey = eligibleKeys.find((key) => key.model === 'gpt-5.6-luna') ?? eligibleKeys[0]
              if (!aiKey) {
                notify(i18nValue.tx('dossier.mailClassificationNoKey'), 'warning')
                return false
              }

              setClassifyingCommunicationIds((current) => new Set([...current, ...targetIds]))
              try {
                const saved = await runApplicationMutation(selected.id, async () => {
                  for (const batchIds of targetBatches) {
                    const requestSignature = JSON.stringify([
                      activeSession.user.id,
                      selected.id,
                      'ai',
                      [...batchIds].sort(),
                      aiKey.id,
                      // The account taxonomy is part of the AI request identity;
                      // renaming or adding a category must not replay an older
                      // task that was prepared with a different catalog.
                      activeSession.user.settings.customMailCategories ?? [],
                    ])
                    const requestId = mailClassificationIdempotencyKeysRef.current.get(requestSignature)
                      ?? persistedMailClassificationRequestId(activeSession.user.id, requestSignature)
                      ?? createMailClassificationRequestId()
                    mailClassificationIdempotencyKeysRef.current.set(requestSignature, requestId)
                    if (!rememberMailClassificationRequestId(
                      activeSession.user.id,
                      requestSignature,
                      requestId,
                    )) {
                      mailClassificationIdempotencyKeysRef.current.delete(requestSignature)
                      throw new Error(i18nValue.tx('localRecoveryUnavailable'))
                    }
                    const result = await phdApi.classifyCommunications(
                      activeSession.token,
                      selected.id,
                      { communicationIds: batchIds, keyId: aiKey.id },
                      { idempotencyKey: requestId },
                    ).catch((error) => {
                      if (!shouldRetainMailClassificationRequestId(error)) {
                        mailClassificationIdempotencyKeysRef.current.delete(requestSignature)
                        forgetMailClassificationRequestId(activeSession.user.id, requestSignature)
                      }
                      throw error
                    })
                    mailClassificationIdempotencyKeysRef.current.delete(requestSignature)
                    forgetMailClassificationRequestId(activeSession.user.id, requestSignature)
                    updateApplicationInState(selected.id, (application) => ({
                      ...application,
                      communications: mergeMailClassificationDeltas(
                        application.communications,
                        result.communications,
                      ),
                    }))
                  }
                  notify(i18nValue.tx('toast.commUpdated'))
                  return true
                })
                return saved === true
              } finally {
                setClassifyingCommunicationIds((current) => {
                  const next = new Set(current)
                  for (const id of targetIds) next.delete(id)
                  return next
                })
              }
            }}
            classifyingCommunicationIds={classifyingCommunicationIds}
            onAddToInterviewPrep={
              canUseInterview && (canEditInCurrentTeam || !isTeamMode)
                ? addCommunicationToInterviewPrep
                : undefined
            }
            onSendCommunication={async (input) => {
              setBusy(true)
              try {
                const sent = await runApplicationMutation(selected.id, async () => {
                  const result = await phdApi.sendCommunication(activeSession.token, selected.id, input)
                  updateApplicationInState(selected.id, (application) => ({
                    ...application,
                    professor: {
                      ...application.professor,
                      correspondenceEmails: Array.isArray(result.correspondenceEmails)
                        ? result.correspondenceEmails
                        : application.professor.correspondenceEmails,
                    },
                    communications: [
                      result.communication,
                      ...application.communications.filter(
                        (item) => item.id !== result.communication.id && item.id !== input.sourceDraftId,
                      ),
                    ],
                  }))
                  const deliveryPresentation = communicationDeliveryPresentation(result.delivery)
                  notify(i18nValue.tx(deliveryPresentation.toastKey), deliveryPresentation.tone)
                  // SMTP may already have accepted this message. Keep the
                  // resident composer intact until the user checks Sent mail;
                  // clearing it would encourage an unsafe duplicate retry.
                  return deliveryPresentation.composerSettled
                })
                return sent === true
              } finally {
                setBusy(false)
              }
            }}
            onRemoveCommunication={(id) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  communications: currentApplicationDraft(selected).communications.filter((c) => c.id !== id),
                },
                i18nValue.tx('toast.commRemoved'),
              )
            }
            onRemoveCommunications={(ids) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  communications: currentApplicationDraft(selected).communications.filter(
                    (item) => !ids.includes(item.id),
                  ),
                },
                i18nValue.tx('toast.commRemoved'),
              )
            }
            onAddScholarship={async (input) => {
              if (connectivityUnavailable()) {
                const source = currentApplicationDraft(selected)
                const result = await saveApplicationQuietly(
                  {
                    ...source,
                    scholarships: [...source.scholarships, { id: `sch-${Date.now()}`, ...input }],
                  },
                  i18nValue.tx('toast.scholarshipAdded'),
                )
                return result.status === 'saved' || result.status === 'queued'
              }
              const saved = await runApplicationMutation(selected.id, async () => {
                if (!input.name.trim()) throw new Error(i18nValue.tx('toast.scholarshipRequired'))
                const scholarship = await phdApi.addScholarship(activeSession.token, selected.id, input)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  scholarships: [...application.scholarships, scholarship],
                }))
                return true
              })
              return saved === true
            }}
            onUpdateScholarship={async (id, input) => {
              const source = currentApplicationDraft(selected)
              const result = await saveApplicationQuietly(
                {
                  ...source,
                  scholarships: source.scholarships.map((scholarship) =>
                    scholarship.id === id ? { id, ...input } : scholarship,
                  ),
                },
                i18nValue.tx('toast.scholarshipUpdated'),
              )
              return result.status === 'saved' || result.status === 'queued'
            }}
            onRemoveScholarship={(id) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  scholarships: currentApplicationDraft(selected).scholarships.filter((s) => s.id !== id),
                },
                i18nValue.tx('toast.scholarshipRemoved'),
              )
            }
            onRemoveScholarships={(ids) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  scholarships: currentApplicationDraft(selected).scholarships.filter((item) => !ids.includes(item.id)),
                },
                i18nValue.tx('toast.scholarshipRemoved'),
              )
            }
            onAddFee={async (input) => {
              if (connectivityUnavailable()) {
                const source = currentApplicationDraft(selected)
                const result = await saveApplicationQuietly(
                  {
                    ...source,
                    fees: [
                      ...(source.fees ?? []),
                      {
                        id: `fee-${Date.now()}`,
                        ...input,
                        paidDate: input.paidDate ?? null,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  },
                  i18nValue.tx('toast.feeAdded'),
                )
                return result.status === 'saved' || result.status === 'queued'
              }
              const saved = await runApplicationMutation(selected.id, async () => {
                const fee = await phdApi.addFee(activeSession.token, selected.id, input)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  fees: [...(application.fees ?? []), fee],
                }))
                return true
              })
              return saved === true
            }}
            onUpdateFee={async (feeId, patch) => {
              if (connectivityUnavailable()) {
                const source = currentApplicationDraft(selected)
                const result = await saveApplicationQuietly(
                  {
                    ...source,
                    fees: (source.fees ?? []).map((fee) => (fee.id === feeId ? { ...fee, ...patch } : fee)),
                  },
                  i18nValue.tx('toast.feeUpdated'),
                )
                return result.status === 'saved' || result.status === 'queued'
              }
              const saved = await runApplicationMutation(selected.id, async () => {
                await phdApi.updateFee(activeSession.token, selected.id, feeId, patch)
                updateApplicationInState(selected.id, (application) => ({
                  ...application,
                  fees: (application.fees ?? []).map((f) => (f.id === feeId ? { ...f, ...patch } : f)),
                }))
                return true
              })
              return saved === true
            }}
            onDeleteFee={(feeId) =>
              connectivityUnavailable()
                ? saveApplicationQuietly(
                    {
                      ...currentApplicationDraft(selected),
                      fees: (currentApplicationDraft(selected).fees ?? []).filter((fee) => fee.id !== feeId),
                    },
                    i18nValue.tx('toast.feeRemoved'),
                  ).then((result) => {
                    if (result.status === 'error') {
                      throw new Error(result.message || i18nValue.tx('apiErrors.REQUEST_FAILED'))
                    }
                  })
                : runApplicationMutation(selected.id, async () => {
                    await phdApi.deleteFee(activeSession.token, selected.id, feeId)
                    updateApplicationInState(selected.id, (application) => ({
                      ...application,
                      fees: (application.fees ?? []).filter((f) => f.id !== feeId),
                    }))
                    return true
                  }).then((saved) => {
                    if (saved !== true) {
                      throw new Error(i18nValue.tx('apiErrors.REQUEST_FAILED'))
                    }
                  })
            }
            onAddTimelineEvent={async (title, date, note) => {
              if (!title.trim()) {
                await runApplicationMutation(selected.id, async () => {
                  throw new Error(i18nValue.tx('toast.eventTitleRequired'))
                })
                return false
              }
              const source = currentApplicationDraft(selected)
              const result = await saveApplicationQuietly(
                {
                  ...source,
                  timeline: [...source.timeline, { id: `tl-${Date.now()}`, title, date, note }],
                },
                i18nValue.tx('toast.timelineAdded'),
              )
              return result.status === 'saved' || result.status === 'queued'
            }}
            onUpdateTimelineEvent={async (id, title, date, note) => {
              if (!title.trim()) {
                await runApplicationMutation(selected.id, async () => {
                  throw new Error(i18nValue.tx('toast.eventTitleRequired'))
                })
                return false
              }
              const source = currentApplicationDraft(selected)
              const result = await saveApplicationQuietly(
                {
                  ...source,
                  timeline: source.timeline.map((event) => (event.id === id ? { ...event, title, date, note } : event)),
                },
                i18nValue.tx('toast.timelineUpdated'),
              )
              return result.status === 'saved' || result.status === 'queued'
            }}
            onRemoveTimelineEvent={(id) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  timeline: currentApplicationDraft(selected).timeline.filter((e) => e.id !== id),
                },
                i18nValue.tx('toast.timelineRemoved'),
              )
            }
            onRemoveTimelineEvents={(ids) =>
              void saveApplicationQuietly(
                {
                  ...currentApplicationDraft(selected),
                  timeline: currentApplicationDraft(selected).timeline.filter((event) => !ids.includes(event.id)),
                },
                i18nValue.tx('toast.timelineRemoved'),
              )
            }
            onAddReviewComment={
              isTeamMode
                ? (body, targetTab, parentId, mentionedUserIds) =>
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
                : undefined
            }
          />
        </div>
        {dossierHandoffPending ? (
          <div className="dossier-handoff-indicator" role="status" aria-live="polite">
            <LoaderCircle size={14} aria-hidden="true" />
            <span>
              {tpl(i18nValue.tx('workspace.openingApplication'), {
                name: selected.school.name,
              })}
            </span>
          </div>
        ) : null}
      </div>
    ) : (
      <EmptyDossier
        onNew={canCreateInCurrentTeam ? () => openNewApplicationDialog(null) : undefined}
        description={isTeamMode ? i18nValue.tx('dossier.noAppDescTeam') : undefined}
      />
    )

  const workspaceShellClass =
    screen === 'workspace'
      ? [
          'workspace-layout',
          workspaceOpeningFromDashboard ? 'workspace-opening' : '',
          workspaceLayout.applicationsHidden ? 'hide-application-pane' : '',
          workspaceLayout.inspectorHidden ? 'hide-inspector-pane' : '',
          workspaceLayout.sidebarsSwapped ? 'workspace-swapped' : '',
          `workspace-view-${renderedWorkspaceViewMode}`,
          mobileDetailOpen ? 'mobile-detail-open' : '',
        ]
          .filter(Boolean)
          .join(' ')
      : ''
  const shellStyle =
    screen === 'workspace'
      ? ({
          '--pane-width': `${workspaceLayout.applicationPaneWidth}px`,
          '--inspector-width': `${workspaceLayout.inspectorWidth}px`,
        } as CSSProperties)
      : undefined
  const applicationPaneStyle =
    screen === 'workspace' ? ({ order: workspaceLayout.sidebarsSwapped ? 4 : 2 } as CSSProperties) : undefined
  const inspectorPaneStyle =
    screen === 'workspace' ? ({ order: workspaceLayout.sidebarsSwapped ? 2 : 4 } as CSSProperties) : undefined
  const screenStageStyle = screen === 'workspace' ? ({ order: 3 } as CSSProperties) : undefined
  // Keep the center-stage host mounted across navigation so only the content
  // participates in the handoff instead of recreating the whole surface.
  const applicationPaneIsLeft = !workspaceLayout.sidebarsSwapped
  const inspectorPaneIsLeft = workspaceLayout.sidebarsSwapped
  const applicationEdgeResizeHandle = (
    <WorkspaceResizeHandle
      label={i18nValue.tx('explorer.showApplications')}
      className={`workspace-edge-handle ${applicationPaneIsLeft ? 'edge-left' : 'edge-right'}`}
      onPointerDown={startApplicationResize}
      onKeyDown={resizeApplicationWithKeyboard}
    />
  )
  const inspectorEdgeResizeHandle = (
    <WorkspaceResizeHandle
      label={i18nValue.tx('explorer.showInspector')}
      className={`workspace-edge-handle ${inspectorPaneIsLeft ? 'edge-left' : 'edge-right'}`}
      onPointerDown={startInspectorResize}
      onKeyDown={resizeInspectorWithKeyboard}
    />
  )

  return (
    <ThemeContext.Provider value={themeProvider}>
      <I18nContext.Provider value={i18nValue}>
        <FormValidationPrompt />
        <GlobalOverflowReveal />
        <LoadingCurtain
          loading={!applicationsLoaded || !shellPaintReady || !i18nValue.ready || Boolean(workspaceHandoff)}
          preserveMobileRail={applicationsLoaded && Boolean(workspaceHandoff)}
          delayMs={!applicationsLoaded || !shellPaintReady || !i18nValue.ready ? 0 : 90}
          message={(() => {
            // Prefer raw interfaceMode during boot — team role isn't known until data loads.
            const target =
              workspaceHandoff?.target ?? (interfaceMode === 'team' || screen === 'team' ? 'team' : 'personal')
            return target === 'team' ? i18nValue.tx('startup.loadingTeam') : i18nValue.tx('startup.loadingPersonal')
          })()}
          detail={
            !isOnline
              ? i18nValue.tx('startup.offlineCheck')
              : workspaceHandoff
                ? workspaceHandoff.target === 'team'
                  ? i18nValue.tx('startup.loadingTeamDetail')
                  : i18nValue.tx('startup.loadingPersonalDetail')
                : i18nValue.tx('startup.preparing')
          }
          variant={
            workspaceHandoff?.variant ?? (
              screen === 'team'
                ? 'team'
                : screen === 'discover' || screen === 'interview'
                  ? 'dashboard'
                  : screen
            )
          }
          minimumVisibleMs={workspaceHandoff ? 180 : 240}
          exitDurationMs={360}
        />
        {applicationsLoaded ? (
          <>
            <MailSyncJobWatcher
              job={activeSession.mailFetchStatus?.syncJob}
              realtimeConnected={realtimeUpdates.connected}
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
                offlineAccessExpiresAt={offlineAccessExpiresAt}
                pendingCount={Math.max(0, offlineQueueCount - blockedOfflineCount)}
                blockedCount={blockedOfflineCount}
                blockedReason={blockedOfflineReason}
                syncing={syncingOffline}
                updateReady={pwaUpdateReady}
                onRetry={() => {
                  void retryOfflineConnection()
                }}
                onInstallUpdate={() => {
                  void requestPwaUpdateInstall()
                }}
                onToggleOffline={toggleManualOffline}
                tx={i18nValue.tx}
              />
              {activeSession.impersonation ? (
                <ImpersonationBanner
                  key={`${activeSession.impersonation.actorId}:${activeSession.impersonation.targetUserId}:${activeSession.impersonation.returnTo}`}
                  targetLabel={tpl(i18nValue.tx('impersonation.banner'), {
                    target: activeSession.impersonation.targetName || activeSession.user.name,
                  })}
                  actorLabel={tpl(i18nValue.tx('impersonation.bannerMeta'), {
                    actor: activeSession.impersonation.actorName || activeSession.impersonation.actorEmail,
                  })}
                  returnLabel={activeSession.impersonation.returnTo === 'admin'
                    ? i18nValue.tx('impersonation.returnAdmin')
                    : tpl(i18nValue.tx('impersonation.return'), {
                        actor: activeSession.impersonation.actorName || activeSession.impersonation.actorEmail,
                      })}
                  onReturn={leaveTemporaryUserView}
                />
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
                canUseInterview={canUseInterview}
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
                    section === teamSection &&
                    !openTeamScreen &&
                    (
                      screen === 'team'
                      || (screen === 'workspace' && section === 'applications')
                      || (screen === 'interview' && section === 'interview')
                    )
                  ) {
                    return
                  }

                  // Team applications reuse the application workspace. Teachers and owners
                  // enter the student board; students retain the focused list/dossier flow.
                  if (section === 'discover' && teamViewerRole === 'member') {
                    if (!canUseTeamDiscover || !activeSession.user.id) return
                    setTeamDiscoverTargetUserId(activeSession.user.id)
                    runWithNavigationGuard(() => {
                      runAnimatedRailScreenUpdate(
                        () => {
                          setTeamSection('discover')
                          setScreen('discover')
                        },
                        {
                          direction: 'forward',
                          ready: warmCriticalScreenAssets('discover', tab, lang, viewMode),
                          readinessGate: readinessGateForScreen('discover', viewMode),
                        },
                      )
                    })
                    return
                  }

                  if (section === 'interview') {
                    if (!canUseInterview) return
                    const direction =
                      validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection)
                        ? 'forward'
                        : 'backward'
                    runWithNavigationGuard(() => {
                      runAnimatedRailScreenUpdate(
                        () => {
                          setTeamSection('interview')
                          setScreen('interview')
                          setMobileDetailOpen(false)
                        },
                        {
                          direction,
                          ready: warmCriticalScreenAssets('interview', tab, lang, viewMode),
                          readinessGate: readinessGateForScreen('interview', viewMode),
                        },
                      )
                    })
                    return
                  }

                  if (section === 'applications') {
                    const destinationViewMode = teamViewerRole === 'member' ? ('list' as const) : ('kanban' as const)
                    const direction =
                      validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection)
                        ? 'forward'
                        : 'backward'
                    runWithNavigationGuard(() => {
                      // Same smoothness as personal → Applications: rail exit + pane enter.
                      runAnimatedRailScreenUpdate(
                        () => {
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
                        },
                        {
                          direction,
                          ready: warmCriticalScreenAssets('workspace', tab, lang, destinationViewMode),
                          readinessGate: readinessGateForScreen('workspace', destinationViewMode),
                        },
                      )
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

                  const direction =
                    validTeamSections.indexOf(section) >= validTeamSections.indexOf(teamSection)
                      ? 'forward'
                      : 'backward'
                  const destinationReady =
                    openTeamScreen || screen !== 'team'
                      ? warmCriticalScreenAssets('team', tab, lang, viewMode)
                      : undefined
                  const destinationReadinessGate =
                    openTeamScreen || screen !== 'team' ? readinessGateForScreen('team', viewMode) : undefined
                  // Entering team from personal/workspace, or leaving team applications
                  // workspace for another team page, uses the same rail handoff as personal.
                  runWithNavigationGuard(() => {
                    runAnimatedRailScreenUpdate(
                      () => {
                        setTeamSection(section)
                        setScreen('team')
                      },
                      {
                        direction,
                        ready: destinationReady,
                        readinessGate: destinationReadinessGate,
                      },
                    )
                  })
                }}
                onScreen={(nextScreen) => {
                  const direction =
                    validScreens.indexOf(nextScreen) >= validScreens.indexOf(screen) ? 'forward' : 'backward'
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
                        {
                          direction,
                          ready: destinationReady,
                          readinessGate: destinationReadinessGate,
                        },
                      )
                      return
                    }

                    runAnimatedRailScreenUpdate(
                      () => {
                        setScreen(nextScreen)
                        // Student team workspaces remain list-first. Personal and teacher/admin
                        // application destinations are handled above by openWorkspaceBoard().
                        if (nextScreen === 'workspace') setMobileDetailOpen(false)
                      },
                      {
                        direction,
                        ready: destinationReady,
                        readinessGate: destinationReadinessGate,
                      },
                    )
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
                onLogout={desktopRuntime.enabled ? undefined : () => runWithNavigationGuard(logout)}
              />

              {screen === 'workspace' ? (
                <WorkspaceLayoutToolbar
                  applicationsHidden={workspaceLayout.applicationsHidden}
                  inspectorHidden={workspaceLayout.inspectorHidden}
                  tx={i18nValue.tx}
                  onToggleApplications={() => toggleWorkspacePane('applications')}
                  onToggleInspector={() => toggleWorkspacePane('inspector')}
                  onSwap={() =>
                    setWorkspaceLayout((current) => ({
                      ...current,
                      sidebarsSwapped: !current.sidebarsSwapped,
                    }))
                  }
                  onReset={() => setWorkspaceLayout(defaultWorkspaceLayout)}
                />
              ) : null}

              <ApplicationSaveIndicator
                status={applicationSaveStatus}
                tx={i18nValue.tx}
                onRetry={() => {
                  void retryApplicationAutoSave()
                }}
              />

              {screen === 'workspace' ? (
                <Suspense
                  fallback={
                    <DeferredAside kind="applications" className="application-pane" style={applicationPaneStyle} />
                  }
                >
                  <ApplicationPane
                    applications={visibleApplications}
                    totalApplicationCount={applicationLimitUsageCount}
                    applicationLimit={isProUser ? applicationLimit : applicationCreateLimit}
                    isPro={isProUser}
                    trashItems={visibleApplicationTrash}
                    trashCount={visibleApplicationTrash.length}
                    removingApplicationIds={removingApplicationIds}
                    removingTrashItemIds={removingTrashItemIds}
                    trashEnabled={isTeamMode || isProUser}
                    showTrash={!activeSession.impersonation?.teamId && (!isTeamMode || Boolean(activeTeamId))}
                    eyebrow={isTeamMode ? i18nValue.tx('nav.modeTeam') : undefined}
                    title={isTeamMode ? i18nValue.tx('nav.teamApplications') : undefined}
                    ownerNames={isTeamMode ? teamApplicationOwnerNames : undefined}
                    trashOwnerNames={isTeamMode ? teamTrashOwnerNames : undefined}
                    ownerFilterOptions={isTeamMode ? ownerFilterOptions : undefined}
                    ownerFilter={effectiveOwnerFilter}
                    onOwnerFilter={setOwnerFilter}
                    teamRelations={isTeamMode && teamViewerRole !== 'member' ? teamApplicationRelations : undefined}
                    readOnlyIds={isTeamMode ? readOnlyApplicationIds : undefined}
                    selectedId={selected?.id ?? null}
                    query={query}
                    statusFilters={statusFilters}
                    sort={sort}
                    onQuery={setQuery}
                    onStatusFilters={setStatusFilters}
                    onSort={setSort}
                    onPrefetch={prefetchApplicationEntry}
                    onPrefetchBoard={prefetchWorkspaceBoardAssets}
                    onSelect={(id) => {
                      if (id === selected?.id) {
                        setWorkspaceJumpIntent(null)
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
                    onNew={canCreateInCurrentTeam ? () => openNewApplicationDialog(null) : undefined}
                    onUpgrade={() =>
                      openUpgradePage(
                        'application-limit',
                        String(applicationLimitUsageCount + 1),
                        String(isProUser ? applicationLimit : applicationCreateLimit),
                      )
                    }
                    onShowBoard={canUseWorkspaceBoard ? () => runWithNavigationGuard(openWorkspaceBoard) : undefined}
                    /* Respond to requested view immediately; waiting for the
                       deferred board made the click look ignored. */
                    boardActive={viewMode === 'kanban'}
                    onOpenMany={isTeamMode ? undefined : openApplicationsInTabs}
                    onExportMany={isTeamMode ? undefined : exportSelectedApplications}
                    onRestoreTrash={restoreTrashItem}
                    onDeleteTrash={confirmDeleteTrashItem}
                    onEmptyTrash={confirmEmptyTrash}
                    onCopyApplication={copyValue}
                    onDeleteMany={!isTeamMode || canEditInCurrentTeam ? confirmDeleteApplications : undefined}
                    style={applicationPaneStyle}
                    collapsed={workspaceLayout.applicationsHidden}
                    resizeHandle={workspaceLayout.applicationsHidden ? null : applicationResizeHandle}
                    actionVersion={activeSession.token}
                  />
                </Suspense>
              ) : null}

              <main
                className={`screen-stage screen-stage-${screen}${screen === 'workspace' ? ` workspace-view-${renderedWorkspaceViewMode} workspace-view-${viewModeDirection}` : ''}${screen === 'workspace' && workspaceOpeningFromDashboard ? ' workspace-open-from-dashboard' : ''}${screen === 'workspace' && workspaceViewExit ? ` workspace-view-exit-${workspaceViewExit}` : ''}`}
        style={screenStageStyle}
      >
        {routeNotFound ? (
          <NotFoundScreen
            kind="route"
                    path={`${window.location.pathname}${window.location.search}`}
                    onAction={returnToDashboardFromMissingRoute}
                    onBack={() => {
                      setRouteNotFound(false)
                      if (window.history.length > 1) {
                        window.history.back()
                        return
                      }
                      returnToDashboardFromMissingRoute()
                    }}
                  />
                ) : applicationNotFound ? (
                  <NotFoundScreen
                    kind="application"
                    path={`${window.location.pathname}${window.location.search}`}
                    title={i18nValue.tx('notFound.applicationTitle')}
                    message={i18nValue.tx('notFound.applicationMessage')}
                    onAction={returnToDashboardFromMissingRoute}
                    onBack={() => {
                      if (window.history.length > 1) {
                        window.history.back()
                        return
                      }
                      returnToDashboardFromMissingRoute()
                    }}
                  />
                ) : (
                  <Suspense fallback={<DeferredPanel variant={screen === 'discover' || screen === 'interview' ? 'dashboard' : screen} />}>
                    {screen === 'workspace' && workspaceBoardResident && workspaceKanbanContent ? (
                      <>
                        <Activity mode={renderedWorkspaceViewMode === 'kanban' ? 'visible' : 'hidden'}>
                          {/* Keep a real Suspense boundary inside Activity. If a
                              cold board chunk settles while the resident tree
                              is being hidden or removed, React must retry the
                              Suspense node rather than a detached Activity
                              boundary. The fallback also preserves the filled
                              workspace surface on the first board visit. */}
                          <Suspense fallback={<DeferredPanel variant="workspace" />}>
                            {workspaceKanbanContent}
                          </Suspense>
                        </Activity>
                        {renderedWorkspaceViewMode === 'kanban' ? null : mainContent}
                      </>
                    ) : mainContent}
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
                <Suspense
                  fallback={
                    <DeferredAside
                      kind="inspector"
                      className="inspector-pane workspace-deferred-inspector"
                      style={inspectorPaneStyle}
                    />
                  }
                >
                  <Inspector
                    application={inspectorApplication}
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
                      runInteractive(
                        async () => {
                          const target = activeDraft ?? selected
                          const blob = await phdApi.downloadExport(activeSession.token, format, target?.id, lang)
                          const suffix = target ? `-${target.school.name}` : ''
                          downloadBlob(blob, `phd-applications${suffix}.${format === 'excel' ? 'xls' : format}`)
                        },
                        tpl(i18nValue.tx('toast.exported'), {
                          format: format.toUpperCase(),
                        }),
                      )
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
                        message: tpl(i18nValue.tx('confirmRestoreBackup'), {
                          fileName,
                        }),
                        confirmLabel: i18nValue.tx('inspector.restore'),
                        variant: 'default',
                        onConfirm: () => runOrThrow(async () => {
                            const result = await phdApi.restoreBackup(activeSession.token, fileName)
                            if (result.application) {
                              replaceApplication(result.application)
                            } else {
                              await refreshAll()
                            }
                          }, i18nValue.tx('toast.backupRestored')),
                      })
                    }
                    onDeleteBackup={(fileName) =>
                      setConfirmDialog({
                        title: i18nValue.tx('inspector.deleteBackup'),
                        message: tpl(i18nValue.tx('confirmDeleteBackup'), {
                          fileName,
                        }),
                        confirmLabel: i18nValue.tx('inspector.deleteBackup'),
                        variant: 'danger',
                        onConfirm: () => {
                          setRemovingBackupFileNames((current) => new Set(current).add(fileName))
                          return runOrThrow(async () => {
                              const result = await waitForRemovalHandoff(
                                phdApi.deleteBackup(activeSession.token, fileName),
                              )
                              setBackups((items) => items.filter((item) => item.fileName !== fileName))
                              // `deleted: false` means retention had already removed it, so
                              // the rest of this list is stale too. Reconcile it.
                              if (!result.deleted) {
                                setBackups(await phdApi.listBackups(getLatestSessionToken(activeSession.token)))
                              }
                            }, i18nValue.tx('toast.backupDeleted')).finally(() => {
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
                    key={`new-application:${activeSession.user.id}:${isTeamMode ? activeTeamId || visibleTeamSummary?.team.id || 'team' : 'personal'}:${newApplicationTeamMode}`}
                    open={dialogOpen}
                    busy={busy}
                    teamMode={newApplicationTeamMode}
                    studentOptions={teamCreateStudentOptions}
                    defaultStudentId={defaultNewApplicationStudentId}
                    draftIdentity={{
                      userId: activeSession.user.id,
                      workspaceId: isTeamMode ? activeTeamId || visibleTeamSummary?.team.id || 'team' : 'personal',
                    }}
                    onClose={() => {
                      setDialogOpen(false)
                      setNewApplicationOwnerHint(null)
                    }}
                    onCreate={async (input) => {
                      let createdSuccessfully = false
                      try {
                        await runOrThrow(async () => {
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
                          const pendingTeamCreateApproval =
                            newApplicationTeamMode === 'team-self' &&
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
                              ownerName: createdForCurrentUser ? activeSession.user.name : (ownerOption?.name ?? ''),
                              ownerEmail: createdForCurrentUser ? activeSession.user.email : (ownerOption?.email ?? ''),
                              currentUserApplicationRole: createdForCurrentUser ? 'owner' : teamViewerRole,
                            }
                            setTeamApplications((items) => [
                              teamRecord,
                              ...items.filter((item) => item.id !== created.id),
                            ])
                            if (!createdForCurrentUser) {
                              setInterfaceMode('team')
                              setOwnerFilter(created.ownerId ?? null)
                            }
                          }
                          setDraftState(cloneApplication(created), {
                            clean: true,
                          })
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
                      } catch (error) {
                        // runOrThrow already emits the localized API message;
                        // give the mounted dialog an immediate pulse and leave
                        // the structured error for it to keep the state visible.
                        if (error instanceof ApiError) flashInvalidField(error.field)
                        throw error
                      }
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
                      if (!selected) return Promise.resolve()
                      return runOrThrow(async () => {
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
                        try {
                          await refreshSessionMetadata(activeSession)
                        } catch {
                          // Share creation already succeeded; reconcile counts
                          // on the next normal session refresh.
                        }
                      }, i18nValue.tx('toast.shareCreated'))
                    }}
                    onRevoke={(shareId) => {
                      if (!selected) return Promise.resolve()
                      return runOrThrow(async () => {
                        await phdApi.revokeShare(activeSession.token, selected.id, shareId)
                        updateApplicationInState(selected.id, (application) => ({
                          ...application,
                          shares: (application.shares ?? []).filter((share) => share.id !== shareId),
                        }))
                        try {
                          await refreshSessionMetadata(activeSession)
                        } catch {
                          // Do not make a successful revoke look retryable.
                        }
                      }, i18nValue.tx('toast.shareRevoked'))
                    }}
                    onUpdateShare={(shareId, expiresAt, permission, sections) => {
                      if (!selected) return Promise.resolve()
                      return runOrThrow(async () => {
                        const share = await phdApi.updateShare(
                          activeSession.token,
                          selected.id,
                          shareId,
                          expiresAt,
                          permission,
                          sections,
                        )
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
                        try {
                          await refreshSessionMetadata(activeSession)
                        } catch {
                          // The update is already durable; refresh counts later.
                        }
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
                    aiKeys={enabledAiKeys}
                    onConfigureAiKeys={openAiKeyConfiguration}
                    onApplied={replaceApplication}
                    onNotify={notify}
                    onClose={() => setDossierEnrichmentOpen(false)}
                  />
                </LazyOverlayBoundary>
              ) : null}

              {!PUBLIC_EDITION && teamWorkspaceChooserOpen ? (
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
                      void switchWorkspaceMode('team', {
                        ...destination,
                        teamId,
                      })
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
                  <KeyboardShortcuts
                    open={shortcutsOpen}
                    onClose={function () {
                      setShortcutsOpen(false)
                    }}
                  />
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
              <LazyOverlayBoundary
                namespaces={['core', 'shared', 'tour', 'dashboard', 'workspace', 'dossier', 'profile', 'settings']}
              >
                <OnboardingTour onComplete={handleOnboardingComplete} onStepEnter={handleOnboardingStepEnter} />
              </LazyOverlayBoundary>
            ) : null}
          </>
        ) : null}
      </I18nContext.Provider>
    </ThemeContext.Provider>
  )
}
