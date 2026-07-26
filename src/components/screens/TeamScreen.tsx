import '../../styles/team.css'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Copy,
  Database,
  ExternalLink,
  FileCheck,
  FileText,
  FolderOpen,
  Paperclip,
  GitMerge,
  History,
  Info,
  KeyRound,
  Link2,
  ListChecks,
  LoaderCircle,
  LogIn,
  Mail,
  MessageSquare,
  Network,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Table2,
  Target,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  phdApi,
  type AuthSession,
  type AiKey,
  type AiKeyInput,
  type NotificationGroup,
  type SystemEvent,
  type TeamApplicationRecord,
  type TeamMember,
  type TeamMemberContactProfile,
  type TeamMergePreview,
  type TeamRole,
  type ProfileAsset,
  type ProfileAssetInput,
  type TeamProfilePreset,
  type TeamSummary,
  type TeamTeacherGroup,
  type TeamWorkspaceOption,
} from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { countReviewComments } from '../../reviewComments'
import { daysUntil, type TeamSection } from '../../appModel'
import {
  isTeacherAssignedToStudent,
  teamMemberTeacherIds,
  teachersForStudent,
} from '../../teamRelationships'
import {
  clampRelationshipZoom,
  RELATIONSHIP_ZOOM_MAX,
  RELATIONSHIP_ZOOM_MIN,
  RELATIONSHIP_ZOOM_STEP,
  relationshipDropMode,
  relationshipScrollForZoom,
  relationshipZoomFromPinch,
  teacherIdsAfterRelationshipDrop,
  type RelationshipCanvasPoint,
  type RelationshipDropMode,
} from './teamRelationshipMapModel'

const TEAM_SECTION_ORDER: TeamSection[] = ['overview', 'applications', 'members', 'resources', 'discover', 'audit', 'settings']

function hasOwnerAuditAccess(role: TeamRole | null | undefined) {
  return role === 'owner'
}
import { normalizeErrorMessage } from '../../errorMessages'
import { localeForLanguage, registerLanguage, type LangDict } from '../../i18n'
import { statusLabel as localizeStatusLabel } from '../../statusLabels'
import englishTeam from '../../i18n/en/team.json'
import chineseTeam from '../../i18n/zh/team.json'
import { safeMailtoHref } from '../../safeLinks'
import { contentLanguagesFromSettings } from '../../contentLanguages'
import { groupProfileAssetsIntoFamilies, profileAssetFamilyId } from '../../profileAssets'
import { defaultProfilePresets, profilePresetText } from '../../profilePresets'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { InlineConfirm } from '../shared/InlineConfirm'
import { InlinePresence } from '../shared/InlinePresence'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { NotificationPublisherPanel, type NotificationPublisherAudience, type NotificationPublisherRecipient } from '../shared/NotificationPublisherPanel'
import { AnchoredPopover } from '../shared/AnchoredPopover'
import { Select } from '../shared/Select'
import { StatusPill } from '../shared/StatusPill'
import { MarkdownContent } from '../shared/MarkdownContent'
import { ScreenSkeleton } from '../shared/LaunchScreen'
import { AiKeyManager } from '../shared/AiKeyManager'
import { ProfilePresetEditorDialog, type ProfilePresetEditorValue } from '../shared/ProfilePresetEditorDialog'
import { ProfilePresetIcon } from '../shared/ProfilePresetIcon'
import { LibraryViewSwitch, type LibraryViewMode } from '../shared/LibraryViewSwitch'
import { LazyOverlayBoundary } from '../shared/LazyOverlayBoundary'
import { UserAvatar } from '../shared/UserAvatar'
import { TeamPortraitFamilyDeck } from './TeamPortraitFamilyDeck'
import { TeamJoinCodeGenerator } from '../shared/TeamJoinCodeGenerator'
import {
  auditFieldSummary,
  canMergeEvent,
  canRestoreEvent,
  changedFields,
  eventApplicationOwnerId,
  eventMetadata,
  formatMergeValue,
  isAutomaticMergeAuditEvent,
  isManualMergeEvent,
  localizeAuditMessage,
  localizeAuditScope,
  mergeChangeKindKey,
  mergeConflictDeltaKey,
  mergeFieldLabel,
  mergeFieldRoot,
  mergeFieldSectionLabel,
  mergeImpactText,
  mergeStatusRank,
  mergeStatusRecommendationKey,
} from './teamAuditMergeModel'
import {
  defaultStudentProfileDraft,
  readStoredTeamStudentProfiles,
  writeStoredTeamStudentProfiles,
  type TeamStudentProfileAsset,
  type TeamStudentProfileDraft,
} from './teamStudentProfileStorage'
import { normalizeTeamLogoFile, TEAM_LOGO_ACCEPT, TeamLogoError } from './teamLogo'

const loadTeamSnippetEditorDialog = () => import('../shared/SnippetEditorDialog').then((module) => ({
  default: module.SnippetEditorDialog,
}))
const TeamSnippetEditorDialog = lazy(loadTeamSnippetEditorDialog)

registerLanguage('en', englishTeam as LangDict, 'team')
registerLanguage('zh', chineseTeam as LangDict, 'team')

const ROLE_LABEL_KEYS: Record<TeamRole, string> = {
  owner: 'team.roleOwner',
  admin: 'team.roleAdmin',
  member: 'team.roleMember',
}

const ROLE_DESCRIPTION_KEYS: Record<TeamRole, string> = {
  owner: 'team.roleOwnerDescription',
  admin: 'team.roleAdminDescription',
  member: 'team.roleMemberDescription',
}

const INVITABLE_ROLES = ['admin', 'member'] as const
const TEAM_TABS: TeamSection[] = ['overview', 'applications', 'members', 'resources', 'discover', 'audit', 'settings']
type HealthFilter = 'all' | ReturnType<typeof applicationHealth>
const HEALTH_FILTERS: HealthFilter[] = ['all', 'risk', 'watch', 'steady', 'closed']
type TeamMemberView = 'table' | 'map'
type MemberWorkspaceView = 'students' | 'teacher-groups'
type TeamMemberStatusFilter = 'all' | 'active' | 'pending'
type OrganizationSettingsSection = 'identity' | 'quota' | 'key'
type StudentProfileFilter = 'all' | 'attention' | 'missing'
type StudentProfileSort = 'attention' | 'name' | 'progress'
type StudentProfileState = 'missing' | 'risk' | 'due' | 'feedback' | 'steady'
type OwnerOverviewFocusKey = 'transfers' | 'risk' | 'resources' | 'students' | 'invites' | 'steady'
type OwnerOverviewDetailView = 'priority' | 'students'
type ProfilePresetSourceFilter = 'all' | 'system' | 'org' | 'mine'
type ProfilePresetSource = Exclude<ProfilePresetSourceFilter, 'all'>
type OverviewDetailModel = {
  icon: ReactNode
  eyebrow: string
  title: string
  subtitle: string
  description: string
  progress?: number
  metrics: Array<{
    label: string
    value: ReactNode
    tone?: 'attention' | 'positive'
  }>
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}
type RelationshipCanvasPointer = {
  pointerType: string
  x: number
  y: number
}
type RelationshipCanvasPinch = {
  startDistance: number
  startZoom: number
  startScrollLeft: number
  startScrollTop: number
  startAnchor: RelationshipCanvasPoint
  viewportLeft: number
  viewportTop: number
}
type StudentProfileRow = {
  member: TeamMember
  applications: TeamApplicationRecord[]
  stats: NonNullable<TeamSummary['memberStats']>[string] | undefined
  riskCount: number
  watchCount: number
  dueSoonCount: number
  feedbackCount: number
  averageProgress: number
  state: StudentProfileState
}
function memberDisplayName(member: TeamMember, fallback: string) {
  return member.displayName || member.invitedEmail || fallback
}

function memberEmail(member: TeamMember) {
  return member.invitedEmail || member.displayName || ''
}

function memberMailtoHref(member: TeamMember) {
  return safeMailtoHref(memberEmail(member))
}

const emptyTeamContactProfile: Required<TeamMemberContactProfile> = {
  title: '',
  department: '',
  contactEmail: '',
  phone: '',
  office: '',
  website: '',
  availability: '',
  bio: '',
}

function teamContactProfileDraft(member?: TeamMember | null): Required<TeamMemberContactProfile> {
  const profile = member?.contactProfile
  return {
    title: profile?.title ?? '',
    department: profile?.department ?? '',
    contactEmail: profile?.contactEmail || member?.invitedEmail || '',
    phone: profile?.phone ?? '',
    office: profile?.office ?? '',
    website: profile?.website ?? '',
    availability: profile?.availability ?? '',
    bio: profile?.bio ?? '',
  }
}

function TeamMemberAvatar({
  member,
  className = 'team-member-avatar',
  fallbackName,
}: {
  member?: TeamMember | null
  className?: string
  fallbackName?: string
}) {
  return (
    <UserAvatar
      avatarUrl={member?.avatarUrl}
      name={member?.displayName || fallbackName || '?'}
      email={member?.invitedEmail}
      className={className}
    />
  )
}

function TeamTeacherAssignmentPicker({
  teachers,
  assignedTeacherUserIds,
  busy,
  onToggle,
}: {
  teachers: TeamMember[]
  assignedTeacherUserIds: readonly string[]
  busy: boolean
  onToggle: (teacher: TeamMember) => void | Promise<void>
}) {
  const { tx, format, lang } = useI18n()
  const [query, setQuery] = useState('')
  const assignedIds = new Set(assignedTeacherUserIds)
  const assignedTeachers = teachers.filter((teacher) => (
    Boolean(teacher.userId && assignedIds.has(teacher.userId))
  ))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleTeachers = teachers
    .filter((teacher) => {
      if (!normalizedQuery) return true
      return [
        memberDisplayName(teacher, tx('team.memberFallback')),
        memberEmail(teacher),
        tx(ROLE_LABEL_KEYS[teacher.role]),
      ].join(' ').toLocaleLowerCase().includes(normalizedQuery)
    })
    .sort((left, right) => {
      const leftSelected = Boolean(left.userId && assignedIds.has(left.userId))
      const rightSelected = Boolean(right.userId && assignedIds.has(right.userId))
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1
      return memberDisplayName(left, tx('team.memberFallback')).localeCompare(
        memberDisplayName(right, tx('team.memberFallback')),
        lang,
      )
    })
  const selectionLabel = assignedTeachers.length > 0
    ? format(tx('team.collaborationTeachersCount'), { count: assignedTeachers.length })
    : tx('team.relationshipNoAdvisor')
  const teacherNames = assignedTeachers
    .slice(0, 3)
    .map((teacher) => memberDisplayName(teacher, tx('team.memberFallback')))
    .join(' · ')

  return (
    <AnchoredPopover
      triggerAriaLabel={`${tx('team.relationshipQuickAssign')}: ${selectionLabel}`}
      popoverAriaLabel={tx('team.relationshipQuickAssign')}
      triggerClassName={`team-teacher-picker-trigger${busy ? ' is-busy' : ''}`}
      popoverClassName="team-teacher-picker-popover-shell"
      width={360}
      estimatedHeight={420}
      align="start"
      onOpenChange={(open) => {
        if (!open) setQuery('')
      }}
      trigger={(
        <span className="team-teacher-picker-trigger-inner" aria-busy={busy || undefined}>
          <span className="team-teacher-picker-trigger-avatars" aria-hidden="true">
            {assignedTeachers.length > 0 ? assignedTeachers.slice(0, 3).map((teacher) => (
              <TeamMemberAvatar
                key={teacher.id}
                member={teacher}
                className="team-teacher-picker-trigger-avatar"
              />
            )) : (
              <span className="team-teacher-picker-trigger-empty">
                <UserPlus size={14} />
              </span>
            )}
          </span>
          <span className="team-teacher-picker-trigger-copy">
            <strong>{selectionLabel}</strong>
            <em>{teacherNames || tx('team.relationshipQuickAssign')}</em>
          </span>
          {busy
            ? <LoaderCircle className="spin" size={15} aria-hidden="true" />
            : <ChevronDown className="team-teacher-picker-trigger-chevron" size={15} aria-hidden="true" />}
        </span>
      )}
    >
      {(close) => (
        <div className="team-teacher-picker-popover">
          <div className="team-teacher-picker-popover-head">
            <span>
              <strong>{tx('team.collaborationTeachersLabel')}</strong>
              <em>{selectionLabel}</em>
            </span>
            <button
              type="button"
              className="team-teacher-picker-close"
              onClick={close}
              aria-label={tx('close')}
              title={tx('close')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          <label className="team-teacher-picker-search">
            <Search size={14} aria-hidden="true" />
            <input
              data-popover-autofocus
              type="search"
              value={query}
              placeholder={tx('search')}
              aria-label={tx('search')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div
            className="team-teacher-picker-options"
            role="listbox"
            aria-multiselectable="true"
            aria-busy={busy || undefined}
          >
            {visibleTeachers.length > 0 ? visibleTeachers.map((teacher) => {
              const selected = Boolean(teacher.userId && assignedIds.has(teacher.userId))
              const email = memberEmail(teacher)
              return (
                <button
                  key={teacher.id}
                  type="button"
                  role="option"
                  className={selected ? 'is-selected' : ''}
                  aria-selected={selected}
                  disabled={busy}
                  onClick={() => void onToggle(teacher)}
                >
                  <TeamMemberAvatar member={teacher} className="team-teacher-picker-option-avatar" />
                  <span>
                    <strong>{memberDisplayName(teacher, tx('team.memberFallback'))}</strong>
                    <em>
                      {tx(ROLE_LABEL_KEYS[teacher.role])}
                      {email ? ` · ${email}` : ''}
                    </em>
                  </span>
                  <span className="team-teacher-picker-check" aria-hidden="true">
                    <Check size={12} />
                  </span>
                </button>
              )
            }) : (
              <div className="team-teacher-picker-empty">
                <Search size={18} aria-hidden="true" />
                <span>{tx('noResults')}</span>
              </div>
            )}
          </div>

          <div className="team-teacher-picker-popover-foot">
            <span>{selectionLabel}</span>
            <button type="button" className="quiet-action" onClick={close}>
              {tx('done')}
            </button>
          </div>
        </div>
      )}
    </AnchoredPopover>
  )
}

function formatMemberDate(value: string, lang: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function eventTime(value: string, lang: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatBytes(value: number, lang: string) {
  const abs = Math.abs(value)
  const unit = abs >= 1024 * 1024 * 1024 ? 'GB' : 'MB'
  const divisor = unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024
  const amount = value / divisor
  return `${new Intl.NumberFormat(localeForLanguage(lang), {
    maximumFractionDigits: unit === 'GB' ? 1 : 0,
  }).format(amount)} ${unit}`
}

function applicationHealth(application: ApplicationRecord) {
  const due = daysUntil(application.deadline)
  if (application.status === 'Accepted' || application.status === 'Rejected') return 'closed'
  if (due < 0 || application.progress < 35) return 'risk'
  if (due <= 14 || application.progress < 65) return 'watch'
  return 'steady'
}

function healthLabelKey(health: string) {
  if (health === 'risk') return 'team.appRiskLabel'
  if (health === 'watch') return 'team.appWatchLabel'
  if (health === 'closed') return 'team.appClosedLabel'
  return 'team.appSteadyLabel'
}

function teamPresetSource(preset: TeamProfilePreset): ProfilePresetSource {
  if (preset.builtIn) return 'system'
  if (preset.createdByRole === 'admin' || (preset.manageable && preset.createdByRole !== 'owner')) return 'mine'
  return 'org'
}

function studentStateLabelKey(state: string) {
  if (state === 'missing') return 'team.teacherStudentStateMissing'
  if (state === 'risk') return 'team.teacherStudentStateRisk'
  if (state === 'due') return 'team.teacherStudentStateDue'
  if (state === 'feedback') return 'team.teacherStudentStateFeedback'
  return 'team.teacherStudentStateSteady'
}

function applicationHealthRank(health: ReturnType<typeof applicationHealth>) {
  if (health === 'risk') return 0
  if (health === 'watch') return 1
  if (health === 'steady') return 2
  return 3
}

export function TeamScreen({
  session,
  initialSummary,
  onChanged,
  applicationCounts,
  applications = [],
  activeSection,
  hideTabs = false,
  onSectionChange,
  onViewApplications,
  onOpenApplication,
  onOpenApplicationInNewPage,
  onImpersonateMember,
  onCreateApplication,
  onSwitchToPersonal,
  teamWorkspaces = [],
  activeTeamId,
  onSwitchTeam,
  onCopy,
  aiKeys = [],
  onCreateAiKey,
  onUpdateAiKey,
  onDeleteAiKey,
  onTestAiKey,
  onResetAiKeyUsage,
  onNotify,
  onOpenTeamDiscover,
}: {
  session: AuthSession
  initialSummary?: TeamSummary | null
  onChanged?: () => void | Promise<void>
  applicationCounts?: Record<string, number>
  applications?: TeamApplicationRecord[]
  activeSection?: TeamSection
  hideTabs?: boolean
  onSectionChange?: (section: TeamSection) => void
  onViewApplications?: (ownerId: string) => void
  onOpenApplication?: (applicationId: string) => void
  onOpenApplicationInNewPage?: (applicationId: string) => void
  onImpersonateMember?: (userId: string) => void
  onCreateApplication?: (ownerId?: string | null) => void
  onSwitchToPersonal?: () => void
  teamWorkspaces?: TeamWorkspaceOption[]
  activeTeamId?: string | null
  onSwitchTeam?: (teamId: string) => void
  onCopy?: (value: string, label: string) => void
  aiKeys?: AiKey[]
  onCreateAiKey?: (input: AiKeyInput) => Promise<void> | void
  onUpdateAiKey?: (id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey'>>) => Promise<void> | void
  onDeleteAiKey?: (id: string) => Promise<void> | void
  onTestAiKey?: (id: string) => Promise<{ latencyMs: number; model?: string }>
  onResetAiKeyUsage?: (id: string) => Promise<void> | void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onOpenTeamDiscover?: (studentUserId: string) => void
}) {
  const { tx, format, lang } = useI18n()
  const teamContentLanguages = useMemo(
    () => contentLanguagesFromSettings({
      contentLanguagePrimary: session.user.settings.contentLanguagePrimary,
      contentLanguageSecondary: session.user.settings.contentLanguageSecondary,
    }),
    [session.user.settings.contentLanguagePrimary, session.user.settings.contentLanguageSecondary],
  )
  const [loading, setLoading] = useState(!initialSummary)
  const [summary, setSummary] = useState<TeamSummary | null>(initialSummary ?? null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [internalActiveTab, setInternalActiveTab] = useState<TeamSection>('overview')
  const [teamQuery, setTeamQuery] = useState('')
  const [teamDiscoverQuery, setTeamDiscoverQuery] = useState('')
  const [teamDiscoverFilter, setTeamDiscoverFilter] = useState<StudentProfileFilter>('all')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [teacherStudentFilter, setTeacherStudentFilter] = useState('all')
  const [ownerOverviewFocusKey, setOwnerOverviewFocusKey] = useState<OwnerOverviewFocusKey>('risk')
  const [ownerOverviewDetailView, setOwnerOverviewDetailView] = useState<OwnerOverviewDetailView>('priority')
  const [teacherOverviewStudentId, setTeacherOverviewStudentId] = useState<string | null>(null)
  const [overviewMoreOpen, setOverviewMoreOpen] = useState(false)
  const [teacherQuickCreateOpen, setTeacherQuickCreateOpen] = useState(false)
  const [memberView, setMemberView] = useState<TeamMemberView>('table')
  const [memberWorkspaceView, setMemberWorkspaceView] = useState<MemberWorkspaceView>('students')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberStatusFilter, setMemberStatusFilter] = useState<TeamMemberStatusFilter>('all')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, 'owner'>>('member')
  const [inviteTeacherIds, setInviteTeacherIds] = useState<string[]>([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single')
  const [bulkInviteText, setBulkInviteText] = useState('')
  const [bulkInviteBusy, setBulkInviteBusy] = useState(false)
  const [joinMethod, setJoinMethod] = useState<'invite' | 'code'>('code')
  const [joinCode, setJoinCode] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [relationDragStudentId, setRelationDragStudentId] = useState<string | null>(null)
  const [relationDragSourceTeacherId, setRelationDragSourceTeacherId] = useState<string | null>(null)
  const [relationDragMode, setRelationDragMode] = useState<RelationshipDropMode>('move')
  const [relationDropTeacherId, setRelationDropTeacherId] = useState<string | null>(null)
  const [relationArrival, setRelationArrival] = useState<{
    studentId: string
    teacherId: string
    mode: RelationshipDropMode
  } | null>(null)
  const [relationZoom, setRelationZoom] = useState(1)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [transferBusyId, setTransferBusyId] = useState<string | null>(null)
  const [selectedTransferRequestId, setSelectedTransferRequestId] = useState<string | null>(null)
  const [selectedTransferTeacherId, setSelectedTransferTeacherId] = useState('')
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null)
  const [pendingRestore, setPendingRestore] = useState<SystemEvent | null>(null)
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null)
  const [mergePreview, setMergePreview] = useState<TeamMergePreview | null>(null)
  const [mergePreviewEvent, setMergePreviewEvent] = useState<SystemEvent | null>(null)
  const [mergeBusyId, setMergeBusyId] = useState<string | null>(null)
  const [mergeApplyBusy, setMergeApplyBusy] = useState(false)
  const [mergeConflictBusy, setMergeConflictBusy] = useState(false)
  const [selectedMergeFields, setSelectedMergeFields] = useState<string[]>([])
  const [auditExpanded, setAuditExpanded] = useState(false)
  const [selectedAuditEventId, setSelectedAuditEventId] = useState<string | null>(null)
  const [selectedAuditStudentId, setSelectedAuditStudentId] = useState('all')
  const [selectedRelationStudentId, setSelectedRelationStudentId] = useState<string | null>(null)
  const [selectedResourceStudentId, setSelectedResourceStudentId] = useState<string | null>(null)
  const [studentResourceQuery, setStudentResourceQuery] = useState('')
  const [studentProfileFilter, setStudentProfileFilter] = useState<StudentProfileFilter>('all')
  const [studentProfileSort, setStudentProfileSort] = useState<StudentProfileSort>('attention')
  const [studentProfileAssets, setStudentProfileAssets] = useState<TeamStudentProfileAsset[]>(readStoredTeamStudentProfiles)
  const [studentProfileEditorOpen, setStudentProfileEditorOpen] = useState(false)
  const [editingStudentProfileId, setEditingStudentProfileId] = useState<string | null>(null)
  const [pendingStudentProfileDeleteId, setPendingStudentProfileDeleteId] = useState<string | null>(null)
  const [removingStudentProfileIds, setRemovingStudentProfileIds] = useState<Set<string>>(() => new Set())
  const [studentProfileDraft, setStudentProfileDraft] = useState<TeamStudentProfileDraft>(defaultStudentProfileDraft)
  const [presetSourceFilter, setPresetSourceFilter] = useState<ProfilePresetSourceFilter>('all')
  const [presetQuery, setPresetQuery] = useState('')
  const [viewedStudentAssets, setViewedStudentAssets] = useState<ProfileAsset[]>([])
  const [viewedStudentAssetsLoading, setViewedStudentAssetsLoading] = useState(false)
  const [viewedStudentAssetQuery, setViewedStudentAssetQuery] = useState('')
  const [studentAssetView, setStudentAssetView] = useState<LibraryViewMode>('list')
  const [expandedStudentFamilyId, setExpandedStudentFamilyId] = useState<string | null>(null)
  const [studentSnippetPreset, setStudentSnippetPreset] = useState<TeamProfilePreset | null>(null)
  const [editingViewedStudentAssetId, setEditingViewedStudentAssetId] = useState<string | null>(null)
  const [pendingViewedStudentAssetDelete, setPendingViewedStudentAssetDelete] = useState<ProfileAsset | null>(null)
  const [deletingViewedStudentAssetId, setDeletingViewedStudentAssetId] = useState<string | null>(null)
  const [applyingStudentPresetId, setApplyingStudentPresetId] = useState<string | null>(null)
  const [teamPresetEditorOpen, setTeamPresetEditorOpen] = useState(false)
  const [editingTeamPresetId, setEditingTeamPresetId] = useState<string | null>(null)
  const [pendingDeleteTeamPreset, setPendingDeleteTeamPreset] = useState<TeamProfilePreset | null>(null)
  const [confirmRestoreTeamPresets, setConfirmRestoreTeamPresets] = useState(false)
  const [teamPresetBusy, setTeamPresetBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamLogoBusy, setTeamLogoBusy] = useState(false)
  const [contactProfileOpen, setContactProfileOpen] = useState(false)
  const [contactProfileBusy, setContactProfileBusy] = useState(false)
  const [contactProfileDraft, setContactProfileDraft] = useState<Required<TeamMemberContactProfile>>(emptyTeamContactProfile)
  const [organizationSettingsSection, setOrganizationSettingsSection] = useState<OrganizationSettingsSection>('identity')
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null)
  const [expandedAdvisorId, setExpandedAdvisorId] = useState<string | null>(null)
  const [memberRevealStep, setMemberRevealStep] = useState(0)
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [notificationGroups, setNotificationGroups] = useState<NotificationGroup[]>([])
  const [selectedTeacherGroupId, setSelectedTeacherGroupId] = useState('all')
  const [teacherGroupDraftName, setTeacherGroupDraftName] = useState('')
  const [teacherGroupRenameDraft, setTeacherGroupRenameDraft] = useState('')
  const [teacherGroupCreateOpen, setTeacherGroupCreateOpen] = useState(false)
  const [teacherGroupBusyId, setTeacherGroupBusyId] = useState<string | null>(null)
  const [pendingTeacherGroupDelete, setPendingTeacherGroupDelete] = useState<TeamTeacherGroup | null>(null)
  const activeTab = activeSection ?? internalActiveTab
  /** Section currently painted — lags briefly during soft exit→enter swaps. */
  const [displayedSection, setDisplayedSection] = useState<TeamSection>(activeTab)
  const [sectionMotion, setSectionMotion] = useState<'idle' | 'exit' | 'enter'>('idle')
  const [sectionDirection, setSectionDirection] = useState<'forward' | 'backward'>('forward')
  const sectionMotionSeqRef = useRef(0)
  const displayedSectionRef = useRef(displayedSection)
  displayedSectionRef.current = displayedSection
  const teamRequestGenerationRef = useRef(0)
  const activeTeamIdRef = useRef(activeTeamId)
  const sessionTokenRef = useRef(session.token)
  const selectedResourceStudentIdRef = useRef(selectedResourceStudentId)
  const teamLogoInputRef = useRef<HTMLInputElement>(null)
  const relationCanvasRef = useRef<HTMLDivElement | null>(null)
  const relationCanvasStageRef = useRef<HTMLDivElement | null>(null)
  const relationZoomLabelRef = useRef<HTMLOutputElement | null>(null)
  const relationZoomRef = useRef(1)
  const relationZoomCommitTimerRef = useRef<number | null>(null)
  const relationArrivalTimerRef = useRef<number | null>(null)
  const relationZoomAnimationRef = useRef<Animation | null>(null)
  const relationWheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined)
  const relationWheelListenerRef = useRef<((event: WheelEvent) => void) | null>(null)
  const relationSuppressClickUntilRef = useRef(0)
  const relationCanvasGestureRef = useRef<{
    pointers: Map<number, RelationshipCanvasPointer>
    panPointerId: number | null
    panStartX: number
    panStartY: number
    panStartScrollLeft: number
    panStartScrollTop: number
    pinch: RelationshipCanvasPinch | null
    moved: boolean
  }>({
    pointers: new Map(),
    panPointerId: null,
    panStartX: 0,
    panStartY: 0,
    panStartScrollLeft: 0,
    panStartScrollTop: 0,
    pinch: null,
    moved: false,
  })
  activeTeamIdRef.current = activeTeamId
  sessionTokenRef.current = session.token
  selectedResourceStudentIdRef.current = selectedResourceStudentId
  relationWheelHandlerRef.current = handleRelationshipWheel

  const setRelationCanvas = useCallback((node: HTMLDivElement | null) => {
    const previousNode = relationCanvasRef.current
    const previousListener = relationWheelListenerRef.current
    if (previousNode && previousListener) {
      previousNode.removeEventListener('wheel', previousListener)
    }

    relationCanvasRef.current = node
    if (!node) {
      relationWheelListenerRef.current = null
      const gesture = relationCanvasGestureRef.current
      gesture.pointers.clear()
      gesture.panPointerId = null
      gesture.pinch = null
      gesture.moved = false
      return
    }

    const listener = (event: WheelEvent) => relationWheelHandlerRef.current(event)
    relationWheelListenerRef.current = listener
    node.addEventListener('wheel', listener, { passive: false })
  }, [])

  const setRelationCanvasStage = useCallback((node: HTMLDivElement | null) => {
    relationCanvasStageRef.current = node
    node?.style.setProperty('--team-relation-zoom', String(relationZoomRef.current))
  }, [])

  useEffect(() => () => {
    if (relationZoomCommitTimerRef.current !== null) {
      window.clearTimeout(relationZoomCommitTimerRef.current)
    }
    if (relationArrivalTimerRef.current !== null) {
      window.clearTimeout(relationArrivalTimerRef.current)
    }
    relationZoomAnimationRef.current?.cancel()
    relationCanvasGestureRef.current.pointers.clear()
  }, [])

  useEffect(() => {
    // In-place directional handoff for team page switches (mirrors personal rail feel
    // without dissolving the whole stage / rail). Depend only on activeTab so settle
    // timers are not cancelled when content swaps.
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setDisplayedSection(activeTab)
      setSectionMotion('idle')
      return undefined
    }

    if (displayedSectionRef.current === activeTab) {
      setSectionMotion('idle')
      return undefined
    }

    const from = TEAM_SECTION_ORDER.indexOf(displayedSectionRef.current)
    const to = TEAM_SECTION_ORDER.indexOf(activeTab)
    const nextDirection: 'forward' | 'backward' = to >= 0 && from >= 0 && to < from
      ? 'backward'
      : 'forward'
    setSectionDirection(nextDirection)

    const seq = ++sectionMotionSeqRef.current
    setSectionMotion('exit')
    // Match personal rail exit (~160ms) so the outgoing page fully dissolves
    // before the destination mounts — avoids the old hard cut.
    const exitMs = 160
    const enterMs = 260
    const exitTimer = window.setTimeout(() => {
      if (sectionMotionSeqRef.current !== seq) return
      setDisplayedSection(activeTab)
      setSectionMotion('enter')
    }, exitMs)
    const settleTimer = window.setTimeout(() => {
      if (sectionMotionSeqRef.current !== seq) return
      setSectionMotion('idle')
    }, exitMs + enterMs)
    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(settleTimer)
    }
  }, [activeTab])

  useEffect(() => {
    if (displayedSection === 'members') setMemberRevealStep(2)
    else setMemberRevealStep(0)
  }, [displayedSection, activeTeamId])

  function changeTab(tab: TeamSection) {
    if (onSectionChange) {
      onSectionChange(tab)
      return
    }
    startTransition(() => setInternalActiveTab(tab))
  }

  async function loadNotificationGroups(nextSummary: TeamSummary, generation: number) {
    const requestToken = session.token
    const requestTeamId = nextSummary.team.id
    const isCurrentRequest = () => teamRequestGenerationRef.current === generation
      && sessionTokenRef.current === requestToken
      && (!activeTeamIdRef.current || activeTeamIdRef.current === requestTeamId)
    const nextRole: TeamRole | null = session.user.role === 'admin' || nextSummary.team.ownerId === session.user.id
      ? 'owner'
      : nextSummary.membership?.role ?? null
    if (nextRole !== 'owner' && nextRole !== 'admin') {
      if (isCurrentRequest()) setNotificationGroups([])
      return
    }
    try {
      const groups = await phdApi.teamNotificationGroups(requestToken, requestTeamId)
      if (isCurrentRequest()) setNotificationGroups(Array.isArray(groups) ? groups : [])
    } catch {
      if (isCurrentRequest()) setNotificationGroups([])
    }
  }

  async function reload() {
    const generation = ++teamRequestGenerationRef.current
    const requestToken = session.token
    const requestTeamId = activeTeamId
    const isCurrentRequest = () => teamRequestGenerationRef.current === generation
      && sessionTokenRef.current === requestToken
      && activeTeamIdRef.current === requestTeamId
    const showSkeleton = !summary
    if (showSkeleton) setLoading(true)
    setError(null)
    try {
      const result = await phdApi.myTeam(requestToken, requestTeamId)
      if (!isCurrentRequest()) return
      setSummary(result)
      if (result) {
        setTeamName(result.team.name)
        setExpandedMemberId((current) => current && result.members.some((member) => member.id === current)
          ? current
          : null)
        await loadNotificationGroups(result, generation)
      } else {
        setExpandedMemberId(null)
        setNotificationGroups([])
      }
    } catch (err) {
      if (isCurrentRequest()) setError(normalizeErrorMessage(err, lang))
    } finally {
      if (showSkeleton && isCurrentRequest()) setLoading(false)
    }
  }

  useEffect(() => {
    if (initialSummary && (!activeTeamId || initialSummary.team.id === activeTeamId)) {
      const generation = ++teamRequestGenerationRef.current
      void loadNotificationGroups(initialSummary, generation)
      return
    }
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, initialSummary?.team.id, session.token])

  useEffect(() => {
    if (!initialSummary || (activeTeamId && initialSummary.team.id !== activeTeamId)) return
    setSummary(initialSummary)
    setLoading(false)
    setTeamName(initialSummary.team.name)
    setExpandedMemberId((current) => current && initialSummary.members.some((member) => member.id === current)
      ? current
      : null)
  }, [activeTeamId, initialSummary])

  async function syncAfterMutation() {
    if (onChanged) {
      await onChanged()
      return
    }
    await reload()
  }

  async function handleTeamContactProfileSave(event: FormEvent) {
    event.preventDefault()
    if (!summary || !viewerTeamMember || !canEditContactProfile || contactProfileBusy) return
    setContactProfileBusy(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await phdApi.updateMyTeamContactProfile(
        session.token,
        summary.team.id,
        contactProfileDraft,
      )
      setSummary((current) => current ? {
        ...current,
        membership: current.membership?.id === saved.id
          ? { ...current.membership, ...saved }
          : current.membership,
        members: current.members.map((member) => (
          member.id === saved.id ? { ...member, ...saved } : member
        )),
      } : current)
      setContactProfileDraft(teamContactProfileDraft(saved))
      setContactProfileOpen(false)
      setMessage(tx('team.contactProfileSaved'))
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setContactProfileBusy(false)
    }
  }

  const updateVisibleTeamPresets = (presets: TeamProfilePreset[]) => {
    setSummary((current) => current ? {
      ...current,
      team: { ...current.team, profilePresets: presets },
    } : current)
  }

  async function saveTeamProfilePreset(value: ProfilePresetEditorValue) {
    if (!summary || (viewerRole !== 'owner' && viewerRole !== 'admin')) return
    if (editingTeamPreset?.builtIn) return
    setTeamPresetBusy(true)
    setError(null)
    try {
      const saved = editingTeamPreset
        ? await phdApi.updateTeamProfilePreset(session.token, summary.team.id, editingTeamPreset.id, value)
        : await phdApi.createTeamProfilePreset(session.token, summary.team.id, value)
      updateVisibleTeamPresets(editingTeamPreset
        ? teamProfilePresets.map((preset) => preset.id === saved.id ? saved : preset)
        : [...teamProfilePresets, saved])
      setMessage(tx(editingTeamPreset ? 'team.profilePresetUpdated' : 'team.profilePresetCreated'))
      setEditingTeamPresetId(null)
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
      throw err
    } finally {
      setTeamPresetBusy(false)
    }
  }

  async function deleteTeamProfilePreset() {
    if (!summary || !pendingDeleteTeamPreset || teamPresetBusy) return
    if (pendingDeleteTeamPreset.builtIn) return
    setTeamPresetBusy(true)
    setError(null)
    try {
      await phdApi.deleteTeamProfilePreset(session.token, summary.team.id, pendingDeleteTeamPreset.id)
      updateVisibleTeamPresets(teamProfilePresets.filter((preset) => preset.id !== pendingDeleteTeamPreset.id))
      setPendingDeleteTeamPreset(null)
      setMessage(tx('team.profilePresetDeleted'))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTeamPresetBusy(false)
    }
  }

  async function restoreTeamProfilePresets() {
    if (!summary || (viewerRole !== 'owner' && viewerRole !== 'admin') || teamPresetBusy) return
    setTeamPresetBusy(true)
    setError(null)
    try {
      const presets = await phdApi.restoreTeamProfilePresets(session.token, summary.team.id)
      updateVisibleTeamPresets(presets)
      setMessage(tx('team.profilePresetRestored'))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTeamPresetBusy(false)
    }
  }

  useEffect(() => {
    writeStoredTeamStudentProfiles(studentProfileAssets)
  }, [studentProfileAssets])

  const viewerRole: TeamRole | null = summary
    ? (session.user.role === 'admin' || summary.team.ownerId === session.user.id
      ? 'owner'
      : summary.membership?.role ?? null)
    : null

  const viewerTeamMember = summary?.members.find((member) => member.userId === session.user.id)
    ?? (summary?.membership?.userId === session.user.id ? summary.membership : null)
  const canEditContactProfile = Boolean(
    viewerTeamMember
    && viewerTeamMember.status === 'active'
    && (viewerRole === 'owner' || viewerRole === 'admin')
    && (viewerTeamMember.role === 'owner' || viewerTeamMember.role === 'admin'),
  )

  useEffect(() => {
    if (contactProfileOpen) return
    setContactProfileDraft(teamContactProfileDraft(viewerTeamMember))
  }, [contactProfileOpen, viewerTeamMember])

  useEffect(() => {
    const teamId = summary?.team.id
    const studentUserId = selectedResourceStudentId
    if (!teamId || !studentUserId || (viewerRole !== 'owner' && viewerRole !== 'admin')) {
      setViewedStudentAssets([])
      setViewedStudentAssetsLoading(false)
      setExpandedStudentFamilyId(null)
      setStudentSnippetPreset(null)
      setEditingViewedStudentAssetId(null)
      setPendingViewedStudentAssetDelete(null)
      return undefined
    }

    let cancelled = false
    setViewedStudentAssetsLoading(true)
    setViewedStudentAssetQuery('')
    setExpandedStudentFamilyId(null)
    setStudentSnippetPreset(null)
    setEditingViewedStudentAssetId(null)
    setPendingViewedStudentAssetDelete(null)
    void phdApi.listTeamMemberProfileAssets(session.token, teamId, studentUserId)
      .then((assets) => {
        if (cancelled) return
        setViewedStudentAssets(assets)
      })
      .catch((err) => {
        if (cancelled) return
        setViewedStudentAssets([])
        setError(normalizeErrorMessage(err, lang))
      })
      .finally(() => {
        if (!cancelled) setViewedStudentAssetsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedResourceStudentId, summary?.team.id, session.token, lang, viewerRole])

  const teamProfilePresets = useMemo<TeamProfilePreset[]>(() => {
    if (summary?.team.profilePresets) return summary.team.profilePresets
    return defaultProfilePresets().map((preset) => ({
      ...preset,
      createdBy: null,
      createdByRole: null,
      syncToTeachers: true,
      syncToStudents: true,
      manageable: !preset.builtIn && viewerRole === 'owner',
    }))
  }, [summary?.team.profilePresets, viewerRole])
  const editingTeamPreset = editingTeamPresetId
    ? teamProfilePresets.find((preset) => preset.id === editingTeamPresetId) ?? null
    : null
  const studentSnippetPresetDisplay = studentSnippetPreset
    ? profilePresetText(studentSnippetPreset, lang, teamContentLanguages)
    : null
  const editingViewedStudentAsset = editingViewedStudentAssetId
    ? viewedStudentAssets.find((asset) => asset.id === editingViewedStudentAssetId) ?? null
    : null

  async function createSelectedStudentSnippet(input: ProfileAssetInput) {
    const teamId = summary?.team.id
    const studentUserId = selectedResourceStudentId
    const presetId = studentSnippetPreset?.id ?? 'student-snippet'
    if (!teamId || !studentUserId || applyingStudentPresetId) return

    setApplyingStudentPresetId(presetId)
    setError(null)
    try {
      const created = await phdApi.addTeamMemberProfileAsset(
        session.token,
        teamId,
        studentUserId,
        input,
      )
      if (selectedResourceStudentIdRef.current === studentUserId) {
        setViewedStudentAssetQuery('')
        setViewedStudentAssets((items) => [created, ...items.filter((item) => item.id !== created.id)])
        setExpandedStudentFamilyId(profileAssetFamilyId(created))
      }
      setMessage(tx('team.studentProfileSnippetAdded'))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setApplyingStudentPresetId(null)
    }
  }

  function openSelectedStudentSnippet(asset: ProfileAsset) {
    if (deletingViewedStudentAssetId === asset.id) return
    void loadTeamSnippetEditorDialog().catch(() => undefined)
    setError(null)
    setMessage(null)
    setStudentSnippetPreset(null)
    setEditingViewedStudentAssetId(asset.id)
  }

  async function updateSelectedStudentSnippet(assetId: string, input: Partial<ProfileAssetInput>) {
    const teamId = summary?.team.id
    const studentUserId = selectedResourceStudentId
    if (!teamId || !studentUserId) return

    setError(null)
    try {
      const updated = await phdApi.updateTeamMemberProfileAsset(
        session.token,
        teamId,
        studentUserId,
        assetId,
        input,
      )
      if (selectedResourceStudentIdRef.current === studentUserId) {
        setViewedStudentAssets((items) => items.map((item) => item.id === updated.id ? updated : item))
      }
      setMessage(tx('toast.profileAssetUpdated'))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    }
  }

  async function deleteSelectedStudentSnippet() {
    const asset = pendingViewedStudentAssetDelete
    const teamId = summary?.team.id
    const studentUserId = selectedResourceStudentId
    if (!asset || !teamId || !studentUserId || deletingViewedStudentAssetId) return

    setPendingViewedStudentAssetDelete(null)
    setDeletingViewedStudentAssetId(asset.id)
    setError(null)
    try {
      await phdApi.deleteTeamMemberProfileAsset(
        session.token,
        teamId,
        studentUserId,
        asset.id,
      )
      if (selectedResourceStudentIdRef.current === studentUserId) {
        setViewedStudentAssets((items) => items.filter((item) => item.id !== asset.id))
        setEditingViewedStudentAssetId((current) => current === asset.id ? null : current)
      }
      setMessage(tx('toast.profileAssetDeleted'))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setDeletingViewedStudentAssetId(null)
    }
  }

  const canInvite = viewerRole === 'owner' || viewerRole === 'admin'
  const canRename = viewerRole === 'owner'
  const canManageLogo = viewerRole === 'owner'
  const canRestore = viewerRole === 'owner'
  const invitableRoles = useMemo<Array<Exclude<TeamRole, 'owner'>>>(
    () => viewerRole === 'owner' ? [...INVITABLE_ROLES] : ['member'],
    [viewerRole],
  )
  const visibleTeamTabs = useMemo<TeamSection[]>(() => {
    if (viewerRole === 'member') return ['overview', 'applications', 'resources']
    if (viewerRole === 'admin') return ['overview', 'applications', 'members', 'resources', 'discover']
    return TEAM_TABS
  }, [viewerRole])
  const safeActiveTab = visibleTeamTabs.includes(activeTab) ? activeTab : 'overview'

  useEffect(() => {
    if (summary && !visibleTeamTabs.includes(activeTab)) changeTab('overview')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, summary, visibleTeamTabs])

  useEffect(() => {
    if (!invitableRoles.includes(inviteRole)) {
      setInviteRole(invitableRoles[0] ?? 'member')
    }
  }, [inviteRole, invitableRoles])

  const teamStats = useMemo(() => {
    const members = summary?.members ?? []
    const active = members.filter((member) => member.status === 'active').length
    const pending = members.filter((member) => member.status === 'pending').length
    const seatCount = active + pending
    const limit = summary?.team.seatLimit ?? 0
    const seatPercent = limit > 0 ? Math.min(100, Math.round((seatCount / limit) * 100)) : 0
    return { active, pending, seatCount, limit, seatPercent }
  }, [summary])

  const teamCapacity = viewerRole === 'owner' ? summary?.capacity ?? null : null
  const inviteSeatUsage = inviteRole === 'admin'
    ? { used: teamCapacity?.teacherSeatsUsed ?? 0, limit: teamCapacity?.teacherSeatLimit ?? 5 }
    : { used: teamCapacity?.studentSeatsUsed ?? 0, limit: teamCapacity?.studentSeatLimit ?? 100 }
  const seatFull = Boolean(teamCapacity && inviteSeatUsage.used >= inviteSeatUsage.limit)

  const membersByUserId = useMemo(() => {
    const map = new Map<string, TeamMember>()
    for (const member of summary?.members ?? []) {
      if (member.userId) map.set(member.userId, member)
    }
    return map
  }, [summary])
  const notificationMembers = useMemo(() => {
    const active = (summary?.members ?? []).filter((member) => member.status === 'active' && member.userId)
    if (viewerRole === 'owner') return active
    if (viewerRole === 'admin') {
      return active.filter((member) => (
        member.userId === session.user.id ||
        member.role === 'admin' ||
        (member.role === 'member' && isTeacherAssignedToStudent(member, session.user.id))
      ))
    }
    return []
  }, [session.user.id, summary?.members, viewerRole])
  const notificationRecipients = useMemo<NotificationPublisherRecipient[]>(() => (
    notificationMembers.map((member) => ({
      id: member.id,
      label: memberDisplayName(member, tx('team.memberFallback')),
      description: member.invitedEmail,
      badge: tx(ROLE_LABEL_KEYS[member.role]),
    }))
  ), [notificationMembers, tx])
  const notificationAudiences = useMemo<NotificationPublisherAudience[]>(() => {
    const base: NotificationPublisherAudience[] = [
      { id: 'all', label: tx('team.notificationAudienceAll'), description: tx('team.notificationAudienceAllDesc') },
      { id: 'students', label: tx('team.notificationAudienceStudents'), description: tx('team.notificationAudienceStudentsDesc') },
    ]
    if (viewerRole === 'owner') {
      base.splice(1, 0, { id: 'teachers', label: tx('team.notificationAudienceTeachers'), description: tx('team.notificationAudienceTeachersDesc') })
    }
    if (viewerRole === 'admin') {
      base.push({ id: 'my_students', label: tx('team.notificationAudienceMyStudents'), description: tx('team.notificationAudienceMyStudentsDesc') })
    }
    return base
  }, [tx, viewerRole])

  const relationshipManagers = useMemo(
    () => (summary?.members ?? []).filter((member) => (
      member.status === 'active'
      && (member.role === 'admin' || member.role === 'owner')
      && Boolean(member.userId)
    )),
    [summary],
  )

  const invitationTeachers = useMemo(
    () => (summary?.members ?? []).filter((member) => (
      member.status === 'active'
      && member.role === 'admin'
      && Boolean(member.userId)
    )),
    [summary],
  )

  useEffect(() => {
    const available = new Set(invitationTeachers.map((teacher) => teacher.id))
    setInviteTeacherIds((current) => {
      const retained = current.filter((id) => available.has(id))
      if (retained.length > 0) return retained
      const self = invitationTeachers.find((teacher) => teacher.userId === session.user.id)
      return self ? [self.id] : (invitationTeachers[0] ? [invitationTeachers[0].id] : [])
    })
  }, [invitationTeachers, session.user.id])

  const teacherGroups = summary?.team.teacherGroups ?? []
  const activeTeacherGroup = selectedTeacherGroupId === 'all' || selectedTeacherGroupId === 'ungrouped'
    ? null
    : teacherGroups.find((group) => group.id === selectedTeacherGroupId) ?? null

  useEffect(() => {
    if (
      selectedTeacherGroupId !== 'all'
      && selectedTeacherGroupId !== 'ungrouped'
      && !teacherGroups.some((group) => group.id === selectedTeacherGroupId)
    ) {
      setSelectedTeacherGroupId('all')
    }
  }, [selectedTeacherGroupId, teacherGroups])

  useEffect(() => {
    setTeacherGroupRenameDraft(activeTeacherGroup?.name ?? '')
  }, [activeTeacherGroup?.id, activeTeacherGroup?.name])

  const relationshipStudents = useMemo(
    () => (summary?.members ?? []).filter((member) => (
      member.status === 'active' && member.role === 'member' && Boolean(member.userId)
    )),
    [summary],
  )

  useEffect(() => {
    if (relationshipStudents.length === 0) {
      if (selectedRelationStudentId) setSelectedRelationStudentId(null)
      return
    }
    if (!selectedRelationStudentId || !relationshipStudents.some((student) => student.id === selectedRelationStudentId)) {
      setSelectedRelationStudentId(relationshipStudents[0].id)
    }
  }, [relationshipStudents, selectedRelationStudentId])

  const filteredApplications = useMemo(() => {
    if (activeTab !== 'applications') return []
    const query = teamQuery.trim().toLowerCase()
    return applications.filter((application) => {
      const health = applicationHealth(application)
      if (healthFilter !== 'all' && health !== healthFilter) return false
      if (!query) return true
      return [
        application.school.name,
        application.program,
        application.professor.english,
        application.professor.chinese,
        application.ownerName,
        application.ownerEmail,
        application.status,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))
    })
  }, [activeTab, applications, healthFilter, teamQuery])

  const applicationsByOwner = useMemo(() => {
    const map = new Map<string, TeamApplicationRecord[]>()
    for (const application of filteredApplications) {
      const ownerId = application.ownerId ?? 'unknown'
      const items = map.get(ownerId)
      if (items) items.push(application)
      else map.set(ownerId, [application])
    }
    for (const items of map.values()) {
      items.sort((a, b) => a.deadline.localeCompare(b.deadline))
    }
    return map
  }, [filteredApplications])

  const allApplicationsByOwner = useMemo(() => {
    const map = new Map<string, TeamApplicationRecord[]>()
    if (activeTab === 'audit' || activeTab === 'settings') return map
    for (const application of applications) {
      const ownerId = application.ownerId ?? 'unknown'
      const items = map.get(ownerId)
      if (items) items.push(application)
      else map.set(ownerId, [application])
    }
    for (const items of map.values()) {
      items.sort((a, b) => a.deadline.localeCompare(b.deadline))
    }
    return map
  }, [activeTab, applications])

  const advisorGroups = useMemo(() => {
    if (!summary || activeTab !== 'applications') return []
    const teachers = summary.members.filter((member) => member.role === 'admin' || member.role === 'owner')
    const groups = new Map<string, { advisor: TeamMember | null; students: Map<string, { member: TeamMember | null; applications: TeamApplicationRecord[] }> }>()

    for (const teacher of teachers) {
      const key = teacher.userId ?? teacher.id
      groups.set(key, { advisor: teacher, students: new Map() })
    }

    for (const member of summary.members.filter((item) => item.role === 'member')) {
      const advisors = studentTeachersFor(member)
      const assignmentTargets = advisors.length
        ? advisors
        : [summary.members.find((item) => item.role === 'owner') ?? null]
      for (const advisor of assignmentTargets) {
        const groupKey = advisor?.userId ?? advisor?.id ?? 'unassigned'
        if (!groups.has(groupKey)) groups.set(groupKey, { advisor, students: new Map() })
        const studentKey = member.userId ?? member.id
        groups.get(groupKey)!.students.set(studentKey, {
          member,
          applications: member.userId ? applicationsByOwner.get(member.userId) ?? [] : [],
        })
      }
    }

    for (const application of filteredApplications) {
      const owner = application.ownerId ? membersByUserId.get(application.ownerId) ?? null : null
      const advisors = owner ? studentTeachersFor(owner) : []
      const assignmentTargets = advisors.length
        ? advisors
        : [summary.members.find((item) => item.role === 'owner') ?? null]
      for (const advisor of assignmentTargets) {
        const groupKey = advisor?.userId ?? advisor?.id ?? 'unassigned'
        if (!groups.has(groupKey)) groups.set(groupKey, { advisor, students: new Map() })
        const studentKey = application.ownerId ?? 'unknown'
        const group = groups.get(groupKey)!
        if (!group.students.has(studentKey)) {
          group.students.set(studentKey, { member: owner, applications: [] })
        }
        const row = group.students.get(studentKey)!
        if (!row.applications.some((item) => item.id === application.id)) {
          row.applications.push(application)
        }
      }
    }

    return Array.from(groups.entries())
      .map(([id, group]) => ({
        id,
        advisor: group.advisor,
        students: Array.from(group.students.entries()).map(([studentId, student]) => ({
          id: studentId,
          ...student,
          applications: student.applications.sort((a, b) => a.deadline.localeCompare(b.deadline)),
        })),
      }))
      .filter((group) => group.students.length > 0 || group.advisor)
  }, [activeTab, filteredApplications, applicationsByOwner, membersByUserId, summary])

  useEffect(() => {
    if (!expandedAdvisorId && advisorGroups[0]) setExpandedAdvisorId(advisorGroups[0].id)
  }, [advisorGroups, expandedAdvisorId])

  const storagePercent = teamCapacity?.storageQuotaBytes
    ? Math.min(100, Math.round((teamCapacity.storageUsedBytes / teamCapacity.storageQuotaBytes) * 100))
    : 0
  const riskApps = applications.filter((application) => applicationHealth(application) === 'risk').length
  const watchApps = applications.filter((application) => applicationHealth(application) === 'watch').length
  const upcomingApps = applications.filter((application) => {
    const due = daysUntil(application.deadline)
    return due >= 0 && due <= 30
  }).length
  const sortedTeamApplications = useMemo(
    () => activeTab === 'overview' ? [...applications].sort((a, b) => {
      return applicationHealthRank(applicationHealth(a)) - applicationHealthRank(applicationHealth(b)) || a.deadline.localeCompare(b.deadline)
    }) : [],
    [activeTab, applications],
  )
  const applicationsById = useMemo(() => {
    const map = new Map<string, TeamApplicationRecord>()
    if (activeTab !== 'audit' && activeTab !== 'overview') return map
    for (const application of applications) {
      map.set(application.id, application)
    }
    return map
  }, [activeTab, applications])
  const auditVisibleOwnerIds = useMemo(() => {
    if (viewerRole === 'owner') return null
    if (viewerRole === 'member') return new Set([session.user.id])
    if (viewerRole === 'admin') {
      return new Set(relationshipStudents
        .filter((student) => isTeacherAssignedToStudent(student, session.user.id))
        .map((student) => student.userId)
        .filter(Boolean) as string[])
    }
    return new Set<string>()
  }, [relationshipStudents, session.user.id, viewerRole])
  const auditStudents = useMemo(() => {
    if (!summary) return []
    return relationshipStudents.filter((student) => {
      if (!student.userId) return false
      if (viewerRole === 'owner') return true
      return auditVisibleOwnerIds?.has(student.userId) ?? false
    })
  }, [auditVisibleOwnerIds, relationshipStudents, summary, viewerRole])
  const auditStudentOptions = useMemo(() => [
    {
      value: 'all',
      label: tx('team.gitStudentAll'),
      description: format(tx('team.gitStudentAllDesc'), { count: auditStudents.length }),
      disabled: viewerRole === 'member',
    },
    ...auditStudents.map((student) => ({
      value: student.userId ?? student.id,
      label: memberDisplayName(student, tx('team.unknownMember')),
      description: format(tx('team.gitStudentDesc'), {
        count: applicationCounts?.[student.userId ?? ''] ?? 0,
      }),
    })),
  ], [applicationCounts, auditStudents, format, tx, viewerRole])

  useEffect(() => {
    if (viewerRole === 'member') {
      if (selectedAuditStudentId !== session.user.id) setSelectedAuditStudentId(session.user.id)
      return
    }
    if (selectedAuditStudentId !== 'all' && !auditStudents.some((student) => student.userId === selectedAuditStudentId)) {
      setSelectedAuditStudentId('all')
    }
  }, [auditStudents, selectedAuditStudentId, session.user.id, viewerRole])

  const canAccessAuditEvent = (event: SystemEvent) => {
    if (viewerRole === 'owner') return true
    const metadata = eventMetadata(event)
    const ownerId = eventApplicationOwnerId(event) ?? (
      metadata.applicationId ? applicationsById.get(metadata.applicationId)?.ownerId ?? null : null
    )
    return Boolean(ownerId && auditVisibleOwnerIds?.has(ownerId))
  }
  const canPreviewMergeEvent = (event: SystemEvent) => canMergeEvent(event, viewerRole) && canAccessAuditEvent(event)
  const canRestoreAuditEvent = (event: SystemEvent) => canRestoreEvent(event, viewerRole) && canAccessAuditEvent(event)
  const priorityApplications = useMemo(() => sortedTeamApplications
    .map((application) => ({
      application,
      due: daysUntil(application.deadline),
      health: applicationHealth(application),
    }))
    .filter((item) => item.health === 'risk' || item.health === 'watch' || (item.due >= 0 && item.due <= 30))
    .slice(0, 6), [sortedTeamApplications])
  const pendingMembers = summary?.members.filter((member) => member.status === 'pending') ?? []
  const pendingTransferRequests = summary?.transferRequests ?? []
  const studentPendingTransferRequests = viewerRole === 'member'
    ? pendingTransferRequests.filter((request) => request.ownerId === session.user.id)
    : []
  useEffect(() => {
    if (viewerRole !== 'owner' || pendingTransferRequests.length === 0) {
      setSelectedTransferRequestId(null)
      setSelectedTransferTeacherId('')
      return
    }
    if (!selectedTransferRequestId || !pendingTransferRequests.some((request) => request.id === selectedTransferRequestId)) {
      setSelectedTransferRequestId(pendingTransferRequests[0].id)
      setSelectedTransferTeacherId('')
    }
  }, [pendingTransferRequests, selectedTransferRequestId, viewerRole])
  const activeTeachers = summary?.members.filter((member) => member.role === 'admin' && member.status === 'active').length ?? 0
  const reviewCommentCount = applications.reduce((total, application) => total + countReviewComments(application.reviewComments), 0)
  const studentsWithoutApplications = (summary?.members ?? [])
    .filter((member) => member.role === 'member' && member.status === 'active')
    .filter((member) => !member.userId || (applicationCounts?.[member.userId] ?? 0) === 0)
  const studentFeedbackCount = applications.reduce((total, application) => total + countReviewComments(application.reviewComments), 0)
  const resourceAlerts = viewerRole === 'owner' ? [
    seatFull ? tx('team.alertSeatsFull') : teamStats.limit > 0 && teamStats.seatPercent >= 80 ? tx('team.alertSeatsHigh') : '',
    storagePercent >= 85 ? tx('team.alertStorageHigh') : '',
  ].filter(Boolean) : []
  const memberStats = useMemo(() => summary?.memberStats ?? {}, [summary?.memberStats])
  const activeStudents = (summary?.members ?? []).filter((member) => member.role === 'member' && member.status === 'active').length
  const currentMember = useMemo(
    () => (summary?.members ?? []).find((member) => member.userId === session.user.id) ?? null,
    [session.user.id, summary?.members],
  )
  const assignedTeachers = currentMember?.role === 'member'
    ? teachersForStudent(currentMember, membersByUserId)
    : []
  const supervisedStudents = useMemo(() => {
    const students = relationshipStudents.filter((student) => (
      viewerRole === 'admin'
        ? isTeacherAssignedToStudent(student, session.user.id)
        : true
    ))
    return students.sort((a, b) => memberDisplayName(a, '').localeCompare(memberDisplayName(b, '')))
  }, [relationshipStudents, session.user.id, viewerRole])
  const supervisedStudentIds = useMemo(
    () => new Set(supervisedStudents.map((student) => student.userId).filter(Boolean) as string[]),
    [supervisedStudents],
  )
  const supervisedApplications = useMemo(
    () => viewerRole === 'admin'
      ? applications.filter((application) => Boolean(application.ownerId && supervisedStudentIds.has(application.ownerId)))
      : applications,
    [applications, supervisedStudentIds, viewerRole],
  )
  const teacherRiskApplications = supervisedApplications.filter((application) => {
    const health = applicationHealth(application)
    return health === 'risk' || health === 'watch'
  })
  const teacherUpcomingApplications = supervisedApplications.filter((application) => {
    const due = daysUntil(application.deadline)
    return due >= 0 && due <= 30
  })
  const teacherFeedbackTotal = supervisedApplications.reduce((total, application) => total + countReviewComments(application.reviewComments), 0)
  const teacherStudentsWithoutApplications = supervisedStudents.filter((student) => {
    if (!student.userId) return true
    return (allApplicationsByOwner.get(student.userId) ?? []).length === 0
  })
  const buildStudentProfileRows = useCallback((students: TeamMember[]): StudentProfileRow[] => students.map((student) => {
    const studentApplications = student.userId ? allApplicationsByOwner.get(student.userId) ?? [] : []
    const stats = memberStats[student.id]
    const riskCount = studentApplications.filter((application) => applicationHealth(application) === 'risk').length
    const watchCount = studentApplications.filter((application) => applicationHealth(application) === 'watch').length
    const dueSoonCount = stats?.dueSoonCount ?? studentApplications.filter((application) => {
      const due = daysUntil(application.deadline)
      return due >= 0 && due <= 30
    }).length
    const feedbackCount = stats?.reviewCommentCount ?? studentApplications.reduce((total, application) => total + countReviewComments(application.reviewComments), 0)
    const averageProgress = Math.round(studentApplications.reduce((sum, application) => sum + application.progress, 0) / Math.max(1, studentApplications.length))
    const state: StudentProfileState = studentApplications.length === 0
      ? 'missing'
      : riskCount > 0 || watchCount > 0
        ? 'risk'
        : dueSoonCount > 0
          ? 'due'
          : feedbackCount > 0
            ? 'feedback'
            : 'steady'
    return {
      member: student,
      applications: studentApplications,
      stats,
      riskCount,
      watchCount,
      dueSoonCount,
      feedbackCount,
      averageProgress,
      state,
    }
  }).sort((a, b) => {
    const rank: Record<StudentProfileState, number> = { missing: 0, risk: 1, due: 2, feedback: 3, steady: 4 }
    return rank[a.state] - rank[b.state] || memberDisplayName(a.member, '').localeCompare(memberDisplayName(b.member, ''))
  }), [allApplicationsByOwner, memberStats])
  const supervisedStudentRows = useMemo(
    () => buildStudentProfileRows(supervisedStudents),
    [buildStudentProfileRows, supervisedStudents],
  )
  const organizationStudentRows = useMemo(
    () => buildStudentProfileRows(relationshipStudents),
    [buildStudentProfileRows, relationshipStudents],
  )
  const accessibleStudentProfileRows = useMemo(() => (
    viewerRole === 'owner'
      ? organizationStudentRows
      : viewerRole === 'admin'
        ? supervisedStudentRows
        : []
  ), [organizationStudentRows, supervisedStudentRows, viewerRole])
  const teamDiscoverFilterCounts = useMemo<Record<StudentProfileFilter, number>>(() => ({
    all: accessibleStudentProfileRows.length,
    attention: accessibleStudentProfileRows.filter((row) => (
      row.state === 'risk' || row.state === 'due' || row.state === 'feedback'
    )).length,
    missing: accessibleStudentProfileRows.filter((row) => row.state === 'missing').length,
  }), [accessibleStudentProfileRows])
  const teamDiscoverStudentRows = useMemo(() => {
    const query = teamDiscoverQuery.trim().toLowerCase()
    return accessibleStudentProfileRows.filter((row) => {
      if (
        teamDiscoverFilter === 'attention'
        && row.state !== 'risk'
        && row.state !== 'due'
        && row.state !== 'feedback'
      ) return false
      if (teamDiscoverFilter === 'missing' && row.state !== 'missing') return false
      if (!query) return true
      const advisors = teachersForStudent(row.member, membersByUserId)
      return [
        memberDisplayName(row.member, ''),
        memberEmail(row.member),
        advisors.map((advisor) => memberDisplayName(advisor, '')).join(' '),
        row.applications.map((application) => application.school.name).join(' '),
      ].join(' ').toLowerCase().includes(query)
    })
  }, [accessibleStudentProfileRows, membersByUserId, teamDiscoverFilter, teamDiscoverQuery])
  const selectedResourceStudent = accessibleStudentProfileRows.find(
    (row) => row.member.userId === selectedResourceStudentId,
  ) ?? null
  const selectedResourceStudentName = selectedResourceStudent
    ? memberDisplayName(selectedResourceStudent.member, tx('team.memberFallback'))
    : ''

  useEffect(() => {
    const selectable = accessibleStudentProfileRows
      .map((row) => row.member.userId)
      .filter((userId): userId is string => Boolean(userId))
    if (!selectedResourceStudentId && selectable.length > 0) {
      setSelectedResourceStudentId(selectable[0])
      return
    }
    if (selectedResourceStudentId && !selectable.includes(selectedResourceStudentId)) {
      setSelectedResourceStudentId(null)
      setStudentProfileEditorOpen(false)
      setEditingStudentProfileId(null)
    }
  }, [accessibleStudentProfileRows, selectedResourceStudentId])

  useEffect(() => {
    if (teacherStudentFilter !== 'all' && !supervisedStudentIds.has(teacherStudentFilter)) {
      setTeacherStudentFilter('all')
    }
  }, [supervisedStudentIds, teacherStudentFilter])

  const teacherApplicationRows = useMemo(() => {
    const query = teamQuery.trim().toLowerCase()
    const matchesApplication = (application: TeamApplicationRecord) => {
      const health = applicationHealth(application)
      if (healthFilter !== 'all' && health !== healthFilter) return false
      if (!query) return true
      return [
        application.school.name,
        application.program,
        application.professor.english,
        application.professor.chinese,
        application.ownerName,
        application.ownerEmail,
        application.status,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))
    }

    return supervisedStudentRows
      .filter((row) => teacherStudentFilter === 'all' || row.member.userId === teacherStudentFilter)
      .map((row) => {
        const studentText = [
          memberDisplayName(row.member, ''),
          memberEmail(row.member),
        ].filter(Boolean).join(' ').toLowerCase()
        const studentMatches = !query || studentText.includes(query)
        const visibleApplications = row.applications.filter(matchesApplication)
        return {
          ...row,
          visibleApplications,
          hiddenBySearch: !studentMatches && visibleApplications.length === 0,
        }
      })
      .filter((row) => teacherStudentFilter !== 'all' || !row.hiddenBySearch)
  }, [healthFilter, supervisedStudentRows, teacherStudentFilter, teamQuery])

  const teacherFilteredApplicationCount = teacherApplicationRows.reduce((total, row) => total + row.visibleApplications.length, 0)
  const selectedTeacherStudentRow = teacherStudentFilter === 'all'
    ? null
    : supervisedStudentRows.find((row) => row.member.userId === teacherStudentFilter) ?? null
  const selectedTeacherApplicationRow = teacherStudentFilter === 'all'
    ? null
    : teacherApplicationRows.find((row) => row.member.userId === teacherStudentFilter) ?? null
  const teacherCreateTargetRow = selectedTeacherStudentRow
    ?? supervisedStudentRows.find((row) => Boolean(row.member.userId))
    ?? null
  const teacherCreateTargetId = teacherCreateTargetRow?.member.userId ?? ''
  const studentApplicationIds = useMemo(
    () => new Set(applications.filter((application) => application.ownerId === session.user.id).map((application) => application.id)),
    [applications, session.user.id],
  )
  const studentRecentEvents = useMemo(() => (summary?.recentEvents ?? [])
    .filter((event) => {
      const metadata = eventMetadata(event)
      return (
        (metadata.applicationId && studentApplicationIds.has(metadata.applicationId)) ||
        metadata.impersonation?.targetUserId === session.user.id ||
        event.actorId === session.user.id
      )
    })
    .slice(0, 5), [session.user.id, studentApplicationIds, summary?.recentEvents])

  const studentActionItems = useMemo(() => applications
    .map((application) => {
      const due = daysUntil(application.deadline)
      const health = applicationHealth(application)
      const comments = countReviewComments(application.reviewComments)
      if (comments > 0) {
        return {
          key: `${application.id}-feedback`,
          application,
          due,
          tone: 'feedback',
          titleKey: 'team.studentActionFeedbackTitle',
          descKey: 'team.studentActionFeedbackDesc',
          count: comments,
        }
      }
      if (due < 0) {
        return {
          key: `${application.id}-overdue`,
          application,
          due,
          tone: 'risk',
          titleKey: 'team.studentActionOverdueTitle',
          descKey: 'team.studentActionOverdueDesc',
          count: Math.abs(due),
        }
      }
      if (due <= 14) {
        return {
          key: `${application.id}-due`,
          application,
          due,
          tone: 'due',
          titleKey: 'team.studentActionDueTitle',
          descKey: 'team.studentActionDueDesc',
          count: due,
        }
      }
      if (health === 'risk' || health === 'watch') {
        return {
          key: `${application.id}-progress`,
          application,
          due,
          tone: 'risk',
          titleKey: 'team.studentActionProgressTitle',
          descKey: 'team.studentActionProgressDesc',
          count: application.progress,
        }
      }
      return {
        key: `${application.id}-steady`,
        application,
        due,
        tone: 'steady',
        titleKey: 'team.studentActionSteadyTitle',
        descKey: 'team.studentActionSteadyDesc',
        count: application.progress,
      }
    })
    .sort((a, b) => {
      const toneRank = { risk: 0, due: 1, feedback: 2, steady: 3 } as Record<string, number>
      return toneRank[a.tone] - toneRank[b.tone] || a.due - b.due
    })
    .slice(0, 6), [applications])

  async function handleInvite(event: FormEvent): Promise<boolean> {
    event.preventDefault()
    if (!summary || !inviteEmail.trim()) return false
    if (inviteRole === 'member' && inviteTeacherIds.length === 0) {
      setError(tx('team.inviteTeacherRequired'))
      return false
    }
    setInviteBusy(true)
    setError(null)
    setMessage(null)
    try {
      await phdApi.inviteTeamMember(
        session.token,
        summary.team.id,
        inviteEmail.trim(),
        inviteRole,
        inviteRole === 'member' ? inviteTeacherIds : [],
      )
      setMessage(format(tx('team.inviteSent'), { email: inviteEmail.trim() }))
      setInviteEmail('')
      await syncAfterMutation()
      return true
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
      return false
    } finally {
      setInviteBusy(false)
    }
  }

  function parseBulkInviteLines(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[,;\t]/).map((part) => part.trim()).filter(Boolean)
        const email = (parts[0] ?? '').toLowerCase()
        const roleRaw = (parts[1] ?? 'member').toLowerCase()
        const role: Exclude<TeamRole, 'owner'> | null =
          roleRaw === 'admin' || roleRaw === 'teacher' || roleRaw === 'counselor'
            ? 'admin'
            : roleRaw === 'member' || roleRaw === 'student'
              ? 'member'
              : null
        return { line, email, role }
      })
  }

  async function handleBulkInvite(event: FormEvent): Promise<boolean> {
    event.preventDefault()
    if (!summary || !bulkInviteText.trim() || !canInvite) return false
    const rows = parseBulkInviteLines(bulkInviteText)
    if (rows.some((row) => row.role === 'member') && inviteTeacherIds.length === 0) {
      setError(tx('team.inviteTeacherRequired'))
      return false
    }
    setBulkInviteBusy(true)
    setError(null)
    setMessage(null)
    let sent = 0
    let failed = 0
    let skipped = 0
    try {
      for (const row of rows) {
        if (!row.email.includes('@') || !row.role) {
          skipped += 1
          continue
        }
        if (!invitableRoles.includes(row.role)) {
          skipped += 1
          continue
        }
        try {
          await phdApi.inviteTeamMember(
            session.token,
            summary.team.id,
            row.email,
            row.role,
            row.role === 'member' ? inviteTeacherIds : [],
          )
          sent += 1
        } catch {
          failed += 1
        }
      }
      setMessage(format(tx('team.bulkInviteResult'), { sent, failed, skipped }))
      if (sent > 0) {
        setBulkInviteText('')
        await syncAfterMutation()
      }
      return sent > 0
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
      return false
    } finally {
      setBulkInviteBusy(false)
    }
  }

  async function handleRedeemJoinCode(event: FormEvent) {
    event.preventDefault()
    const value = joinCode.trim()
    if (!value) return
    setJoinBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await phdApi.redeemTeamJoinCode(session.token, value)
      setJoinCode('')
      setMessage(format(tx('team.joinCodeJoined'), { team: result.team.name }))
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setJoinBusy(false)
    }
  }

  function labelForRole(role: TeamRole) {
    const custom = summary?.team.roleLabels
    if (role === 'admin' && custom?.admin?.trim()) return custom.admin.trim()
    if (role === 'member' && custom?.member?.trim()) return custom.member.trim()
    return tx(ROLE_LABEL_KEYS[role])
  }

  async function createNotificationGroup(name: string, memberIds: string[]) {
    if (!summary) return
    const group = await phdApi.createTeamNotificationGroup(session.token, summary.team.id, name, memberIds)
    setNotificationGroups((current) => [group, ...current.filter((item) => item.id !== group.id)])
  }

  async function deleteNotificationGroup(groupId: string) {
    if (!summary) return
    await phdApi.deleteTeamNotificationGroup(session.token, summary.team.id, groupId)
    setNotificationGroups((current) => current.filter((group) => group.id !== groupId))
  }

  async function handleRoleChange(member: TeamMember, role: Exclude<TeamRole, 'owner'>) {
    if (!summary) return
    setRowBusyId(member.id)
    setError(null)
    setMessage(null)
    try {
      await phdApi.updateTeamMemberRole(session.token, summary.team.id, member.id, role)
      setMessage(format(tx('team.roleUpdated'), {
        name: memberDisplayName(member, tx('team.memberFallback')),
        role: tx(ROLE_LABEL_KEYS[role]),
      }))
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setRowBusyId(null)
    }
  }

  function studentTeachersFor(member: TeamMember) {
    return teachersForStudent(member, membersByUserId)
  }

  async function handleStudentTeachersChange(member: TeamMember, teacherMemberIds: string[]) {
    if (!summary || member.role !== 'member') return false
    setRowBusyId(member.id)
    setError(null)
    setMessage(null)
    try {
      await phdApi.updateTeamMemberAccess(
        session.token,
        summary.team.id,
        member.id,
        { teacherIds: teacherMemberIds },
      )
      setMessage(format(tx('team.relationshipUpdated'), {
        name: memberDisplayName(member, tx('team.memberFallback')),
      }))
      await syncAfterMutation()
      return true
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
      return false
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleToggleStudentTeacher(member: TeamMember, teacher: TeamMember) {
    if (!teacher.userId) return
    const assigned = new Set(teamMemberTeacherIds(member))
    if (assigned.has(teacher.userId)) assigned.delete(teacher.userId)
    else assigned.add(teacher.userId)
    const teacherMemberIds = relationshipManagers
      .filter((candidate) => Boolean(candidate.userId && assigned.has(candidate.userId)))
      .map((candidate) => candidate.id)
    await handleStudentTeachersChange(member, teacherMemberIds)
  }

  function teacherMemberIdsForUserIds(teacherUserIds: readonly string[]) {
    const membersById = new Map(
      relationshipManagers
        .filter((teacher): teacher is TeamMember & { userId: string } => Boolean(teacher.userId))
        .map((teacher) => [teacher.userId, teacher.id]),
    )
    return teacherUserIds
      .map((teacherUserId) => membersById.get(teacherUserId))
      .filter((memberId): memberId is string => Boolean(memberId))
  }

  async function handleRelationshipDrop(
    student: TeamMember,
    sourceTeacherMemberId: string | null,
    targetTeacher: TeamMember,
    mode: RelationshipDropMode,
  ) {
    const targetTeacherUserId = targetTeacher.userId
    if (!targetTeacherUserId) return
    const sourceTeacherUserId = sourceTeacherMemberId
      ? relationshipManagers.find((teacher) => teacher.id === sourceTeacherMemberId)?.userId ?? null
      : null
    const currentTeacherUserIds = teamMemberTeacherIds(student)
    const nextTeacherUserIds = teacherIdsAfterRelationshipDrop(
      currentTeacherUserIds,
      sourceTeacherUserId,
      targetTeacherUserId,
      mode,
    )
    if (nextTeacherUserIds.join('\u0000') === currentTeacherUserIds.join('\u0000')) return

    const updated = await handleStudentTeachersChange(
      student,
      teacherMemberIdsForUserIds(nextTeacherUserIds),
    )
    if (!updated) return

    setRelationArrival({ studentId: student.id, teacherId: targetTeacher.id, mode })
    if (relationArrivalTimerRef.current !== null) {
      window.clearTimeout(relationArrivalTimerRef.current)
    }
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    relationArrivalTimerRef.current = window.setTimeout(() => {
      setRelationArrival(null)
      relationArrivalTimerRef.current = null
    }, reduceMotion ? 40 : 520)
  }

  function writeRelationshipZoom(nextValue: number, commit: boolean) {
    const nextZoom = clampRelationshipZoom(nextValue)
    const previousZoom = relationZoomRef.current
    if (nextZoom === previousZoom) return null

    relationZoomRef.current = nextZoom
    relationCanvasStageRef.current?.style.setProperty('--team-relation-zoom', String(nextZoom))
    if (relationZoomLabelRef.current) {
      relationZoomLabelRef.current.value = `${Math.round(nextZoom * 100)}%`
    }
    if (commit) setRelationZoom(nextZoom)
    return { nextZoom, previousZoom }
  }

  function paintRelationshipZoom(
    nextValue: number,
    commit = true,
    animate = true,
    anchor?: RelationshipCanvasPoint,
  ) {
    const nextZoom = clampRelationshipZoom(nextValue)
    const previousZoom = relationZoomRef.current
    if (nextZoom === previousZoom) return

    const canvas = relationCanvasRef.current
    const resolvedAnchor = canvas
      ? anchor ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
      : null
    const nextScroll = canvas && resolvedAnchor
      ? relationshipScrollForZoom({
          startZoom: previousZoom,
          nextZoom,
          startScrollLeft: canvas.scrollLeft,
          startScrollTop: canvas.scrollTop,
          startAnchor: resolvedAnchor,
        })
      : null

    const zoomChange = writeRelationshipZoom(nextZoom, commit)
    if (!zoomChange) return
    if (canvas && nextScroll) {
      canvas.scrollLeft = nextScroll.left
      canvas.scrollTop = nextScroll.top
    }

    const stage = relationCanvasStageRef.current
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animate || reduceMotion || !stage?.animate) return

    relationZoomAnimationRef.current?.cancel()
    stage.style.willChange = 'transform, opacity'
    const animation = stage.animate([
      {
        transform: `scale(${zoomChange.previousZoom / zoomChange.nextZoom})`,
        opacity: 0.94,
      },
      {
        transform: 'scale(1)',
        opacity: 1,
      },
    ], {
      duration: 220,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    })
    relationZoomAnimationRef.current = animation
    const finish = () => {
      if (relationZoomAnimationRef.current !== animation) return
      relationZoomAnimationRef.current = null
      stage.style.removeProperty('will-change')
    }
    animation.onfinish = finish
    animation.oncancel = finish
  }

  function handleRelationshipWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return
    const canvas = relationCanvasRef.current
    if (!canvas) return
    event.preventDefault()
    const bounds = canvas.getBoundingClientRect()
    const delta = Math.max(-0.12, Math.min(0.12, -event.deltaY * 0.0015))
    paintRelationshipZoom(
      relationZoomRef.current + delta,
      false,
      false,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
    )
    if (relationZoomCommitTimerRef.current !== null) {
      window.clearTimeout(relationZoomCommitTimerRef.current)
    }
    relationZoomCommitTimerRef.current = window.setTimeout(() => {
      setRelationZoom(relationZoomRef.current)
      relationZoomCommitTimerRef.current = null
    }, 120)
  }

  function relationshipCanvasTargetIsInteractive(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [draggable="true"]',
    ))
  }

  function beginRelationshipCanvasPan(
    canvas: HTMLDivElement,
    pointerId: number,
    pointer: RelationshipCanvasPointer,
  ) {
    const gesture = relationCanvasGestureRef.current
    gesture.panPointerId = pointerId
    gesture.panStartX = pointer.x
    gesture.panStartY = pointer.y
    gesture.panStartScrollLeft = canvas.scrollLeft
    gesture.panStartScrollTop = canvas.scrollTop
    gesture.pinch = null
    canvas.classList.remove('is-pinching')
    canvas.classList.add('is-panning')
  }

  function beginRelationshipCanvasPinch(canvas: HTMLDivElement) {
    const gesture = relationCanvasGestureRef.current
    const touches = [...gesture.pointers.entries()]
      .filter(([, pointer]) => pointer.pointerType === 'touch')
      .slice(0, 2)
    if (touches.length < 2) return

    for (const [pointerId] of touches) {
      try {
        canvas.setPointerCapture?.(pointerId)
      } catch {
        // A pointer that ended between events simply drops out on the next update.
      }
    }

    const first = touches[0][1]
    const second = touches[1][1]
    const bounds = canvas.getBoundingClientRect()
    const centerX = (first.x + second.x) / 2
    const centerY = (first.y + second.y) / 2
    gesture.pinch = {
      startDistance: Math.hypot(second.x - first.x, second.y - first.y),
      startZoom: relationZoomRef.current,
      startScrollLeft: canvas.scrollLeft,
      startScrollTop: canvas.scrollTop,
      startAnchor: { x: centerX - bounds.left, y: centerY - bounds.top },
      viewportLeft: bounds.left,
      viewportTop: bounds.top,
    }
    gesture.panPointerId = null
    gesture.moved = true
    relationZoomAnimationRef.current?.cancel()
    canvas.classList.remove('is-panning')
    canvas.classList.add('is-pinching')
  }

  function handleRelationshipPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' && event.button !== 0) return
    const canvas = event.currentTarget
    const gesture = relationCanvasGestureRef.current
    const pointer = {
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    }
    gesture.pointers.set(event.pointerId, pointer)

    if (event.pointerType === 'touch') {
      const touchCount = [...gesture.pointers.values()]
        .filter((candidate) => candidate.pointerType === 'touch').length
      if (touchCount >= 2) {
        event.preventDefault()
        beginRelationshipCanvasPinch(canvas)
        return
      }
      if (relationshipCanvasTargetIsInteractive(event.target)) return
    } else if (relationshipCanvasTargetIsInteractive(event.target)) {
      gesture.pointers.delete(event.pointerId)
      return
    }

    event.preventDefault()
    canvas.setPointerCapture?.(event.pointerId)
    gesture.moved = false
    beginRelationshipCanvasPan(canvas, event.pointerId, pointer)
  }

  function handleRelationshipPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const canvas = event.currentTarget
    const gesture = relationCanvasGestureRef.current
    const pointer = gesture.pointers.get(event.pointerId)
    if (!pointer) return
    pointer.x = event.clientX
    pointer.y = event.clientY

    const touches = [...gesture.pointers.values()]
      .filter((candidate) => candidate.pointerType === 'touch')
    if (touches.length >= 2) {
      if (!gesture.pinch) beginRelationshipCanvasPinch(canvas)
      const pinch = gesture.pinch
      if (!pinch) return
      event.preventDefault()

      const first = touches[0]
      const second = touches[1]
      const center = {
        x: (first.x + second.x) / 2 - pinch.viewportLeft,
        y: (first.y + second.y) / 2 - pinch.viewportTop,
      }
      const nextZoom = relationshipZoomFromPinch(
        pinch.startZoom,
        pinch.startDistance,
        Math.hypot(second.x - first.x, second.y - first.y),
      )
      const nextScroll = relationshipScrollForZoom({
        startZoom: pinch.startZoom,
        nextZoom,
        startScrollLeft: pinch.startScrollLeft,
        startScrollTop: pinch.startScrollTop,
        startAnchor: pinch.startAnchor,
        nextAnchor: center,
      })
      writeRelationshipZoom(nextZoom, false)
      canvas.scrollLeft = nextScroll.left
      canvas.scrollTop = nextScroll.top
      return
    }

    if (gesture.panPointerId !== event.pointerId) return
    event.preventDefault()
    const deltaX = event.clientX - gesture.panStartX
    const deltaY = event.clientY - gesture.panStartY
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) gesture.moved = true
    canvas.scrollLeft = gesture.panStartScrollLeft - deltaX
    canvas.scrollTop = gesture.panStartScrollTop - deltaY
  }

  function finishRelationshipPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const canvas = event.currentTarget
    const gesture = relationCanvasGestureRef.current
    gesture.pointers.delete(event.pointerId)
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture?.(event.pointerId)
    }

    if (gesture.pinch) {
      gesture.pinch = null
      setRelationZoom((current) => current === relationZoomRef.current ? current : relationZoomRef.current)
      const remainingTouch = [...gesture.pointers.entries()]
        .find(([, pointer]) => pointer.pointerType === 'touch')
      if (remainingTouch) {
        beginRelationshipCanvasPan(canvas, remainingTouch[0], remainingTouch[1])
      } else {
        gesture.panPointerId = null
        canvas.classList.remove('is-pinching', 'is-panning')
      }
    } else if (gesture.panPointerId === event.pointerId) {
      gesture.panPointerId = null
      canvas.classList.remove('is-panning')
    }

    if (gesture.moved) relationSuppressClickUntilRef.current = Date.now() + 240
    if (gesture.pointers.size === 0) {
      gesture.moved = false
      gesture.panPointerId = null
      gesture.pinch = null
      canvas.classList.remove('is-pinching', 'is-panning')
    }
  }

  function updateTeacherGroupsLocally(groups: TeamTeacherGroup[]) {
    setSummary((current) => current ? {
      ...current,
      team: { ...current.team, teacherGroups: groups },
    } : current)
  }

  async function handleCreateTeacherGroup(event: FormEvent) {
    event.preventDefault()
    const name = teacherGroupDraftName.trim()
    if (!summary || !name) return
    setTeacherGroupBusyId('create')
    setError(null)
    try {
      const created = await phdApi.createTeamTeacherGroup(session.token, summary.team.id, { name })
      updateTeacherGroupsLocally([...teacherGroups, created])
      setSelectedTeacherGroupId(created.id)
      setTeacherGroupDraftName('')
      setTeacherGroupCreateOpen(false)
      setMessage(format(tx('team.teacherGroupCreated'), { name: created.name }))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleRenameTeacherGroup() {
    const name = teacherGroupRenameDraft.trim()
    if (!summary || !activeTeacherGroup || !name || name === activeTeacherGroup.name) return
    setTeacherGroupBusyId(activeTeacherGroup.id)
    setError(null)
    try {
      const updated = await phdApi.updateTeamTeacherGroup(
        session.token,
        summary.team.id,
        activeTeacherGroup.id,
        { name },
      )
      updateTeacherGroupsLocally(teacherGroups.map((group) => group.id === updated.id ? updated : group))
      setMessage(tx('team.teacherGroupSaved'))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleToggleTeacherGroupMember(group: TeamTeacherGroup, teacherMemberId: string) {
    if (!summary) return
    const memberIds = group.memberIds.includes(teacherMemberId)
      ? group.memberIds.filter((memberId) => memberId !== teacherMemberId)
      : [...group.memberIds, teacherMemberId]
    setTeacherGroupBusyId(group.id)
    setError(null)
    try {
      const updated = await phdApi.updateTeamTeacherGroup(
        session.token,
        summary.team.id,
        group.id,
        { memberIds },
      )
      updateTeacherGroupsLocally(teacherGroups.map((item) => item.id === updated.id ? updated : item))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleDeleteTeacherGroup() {
    if (!summary || !pendingTeacherGroupDelete) return
    const deleting = pendingTeacherGroupDelete
    setTeacherGroupBusyId(deleting.id)
    setError(null)
    try {
      await phdApi.deleteTeamTeacherGroup(session.token, summary.team.id, deleting.id)
      updateTeacherGroupsLocally(teacherGroups.filter((group) => group.id !== deleting.id))
      setPendingTeacherGroupDelete(null)
      setSelectedTeacherGroupId('all')
      setMessage(format(tx('team.teacherGroupDeleted'), { name: deleting.name }))
      void onChanged?.()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleRemove() {
    if (!summary || !pendingRemove) return
    setRowBusyId(pendingRemove.id)
    setError(null)
    setMessage(null)
    try {
      await phdApi.removeTeamMember(session.token, summary.team.id, pendingRemove.id)
      setMessage(format(tx('team.memberRemoved'), {
        name: memberDisplayName(pendingRemove, tx('team.memberFallback')),
      }))
      setPendingRemove(null)
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleRestoreEvent() {
    if (!summary || !pendingRestore) return
    setRestoreBusyId(pendingRestore.id)
    setError(null)
    setMessage(null)
    try {
      const result = await phdApi.restoreTeamEvent(session.token, summary.team.id, pendingRestore.id)
      setPendingRestore(null)
      setMessage(format(tx('team.restoreSucceeded'), { name: result.application.school.name }))
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setRestoreBusyId(null)
    }
  }

  async function handleTransferDecision(requestId: string, decision: 'approve' | 'reject', teacherMemberId?: string) {
    if (!summary) return
    setTransferBusyId(requestId)
    setError(null)
    setMessage(null)
    try {
      const result = decision === 'approve'
        ? await phdApi.approveTeamTransferRequest(session.token, summary.team.id, requestId, teacherMemberId)
        : await phdApi.rejectTeamTransferRequest(session.token, summary.team.id, requestId)
      setMessage(format(
        tx(decision === 'approve' ? 'team.transferApproved' : 'team.transferRejected'),
        { name: result.school.name },
      ))
      setSelectedTransferTeacherId('')
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setTransferBusyId(null)
    }
  }

  async function handlePreviewMerge(event: SystemEvent) {
    if (!summary) return
    setMergeBusyId(event.id)
    setSelectedAuditEventId(event.id)
    setError(null)
    setMessage(null)
    try {
      const preview = await phdApi.previewTeamEventMerge(session.token, summary.team.id, event.id)
      setMergePreview(preview)
      setMergePreviewEvent(event)
      setSelectedMergeFields(preview.fields.filter((field) => field.status === 'clean').map((field) => field.field))
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setMergeBusyId(null)
    }
  }

  function clearMergePreview() {
    setMergePreview(null)
    setMergePreviewEvent(null)
    setSelectedMergeFields([])
  }

  async function handleApplyMerge() {
    if (!summary || !mergePreview) return
    setMergeApplyBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await phdApi.applyTeamEventMerge(session.token, summary.team.id, mergePreview.eventId, selectedMergeFields)
      setMessage(format(tx('team.mergeSucceeded'), { count: result.changedFields.length, name: result.application.school.name }))
      clearMergePreview()
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setMergeApplyBusy(false)
    }
  }

  async function handleFlagMergeConflict() {
    if (!summary || !mergePreview) return
    setMergeConflictBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await phdApi.flagTeamEventMergeConflict(session.token, summary.team.id, mergePreview.eventId)
      setMessage(format(tx('team.mergeConflictFlagged'), {
        count: result.conflictCount,
        name: result.application.school.name,
      }))
      clearMergePreview()
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    } finally {
      setMergeConflictBusy(false)
    }
  }

  function toggleMergeField(field: string) {
    setSelectedMergeFields((current) => (
      current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field]
    ))
  }

  function openOrganizationSettingsSection(section: OrganizationSettingsSection) {
    setOrganizationSettingsSection(section)
    const target = document.getElementById(`team-organization-settings-${section}`)
    if (!target) return
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  async function handleTeamLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !summary || !canManageLogo || teamLogoBusy) return

    setTeamLogoBusy(true)
    setError(null)
    setMessage(null)
    try {
      const logoDataUrl = await normalizeTeamLogoFile(file)
      const updatedTeam = await phdApi.updateTeam(session.token, summary.team.id, { logoDataUrl })
      setSummary((current) => current && current.team.id === updatedTeam.id
        ? { ...current, team: { ...current.team, ...updatedTeam } }
        : current)
      setMessage(tx('team.logoSaved'))
      await syncAfterMutation()
    } catch (err) {
      if (err instanceof TeamLogoError) {
        setError(tx(err.reason === 'file-type'
          ? 'team.logoFormatUnsupported'
          : err.reason === 'file-size'
            ? 'team.logoFileSize'
            : 'team.logoInvalidImage'))
      } else {
        setError(normalizeErrorMessage(err, lang))
      }
    } finally {
      setTeamLogoBusy(false)
    }
  }

  async function handleRename() {
    if (!summary || !teamName.trim() || teamName.trim() === summary.team.name) {
      setRenaming(false)
      setTeamName(summary?.team.name ?? '')
      return
    }
    setError(null)
    setMessage(null)
    try {
      await phdApi.renameTeam(session.token, summary.team.id, teamName.trim())
      setRenaming(false)
      setMessage(tx('team.renameSaved'))
      await syncAfterMutation()
    } catch (err) {
      setError(normalizeErrorMessage(err, lang))
    }
  }

  function memberCanEditRole(member: TeamMember) {
    return viewerRole === 'owner' && member.role !== 'owner' && member.userId !== session.user.id
  }

  function memberCanRemove(member: TeamMember) {
    const isSelf = member.userId === session.user.id
    return (
      (viewerRole === 'owner' && member.role !== 'owner') ||
      (viewerRole === 'admin' && isTeacherAssignedToStudent(member, session.user.id)) ||
      (isSelf && member.role !== 'owner')
    )
  }

  function memberCanEnterView(member: TeamMember) {
    if (!onImpersonateMember || !member.userId || member.userId === session.user.id || member.status !== 'active') return false
    if (viewerRole === 'owner') return true
    return viewerRole === 'admin' && isTeacherAssignedToStudent(member, session.user.id)
  }

  function openApplicationContextMenu(event: ReactMouseEvent<HTMLElement>, application: TeamApplicationRecord) {
    event.preventDefault()
    const due = daysUntil(application.deadline)
    const studentLabel = application.ownerName || application.ownerEmail || tx('team.memberFallback')
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: application.school.name,
      subtitle: `${studentLabel} · ${due >= 0 ? format(tx('workspace.dayShort'), { count: due }) : format(tx('workspace.daysPast'), { count: Math.abs(due) })}`,
      items: [
        {
          id: 'open',
          label: tx('explorer.open'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          disabled: !onOpenApplication,
          onSelect: () => onOpenApplication?.(application.id),
        },
        {
          id: 'open-new-page',
          label: tx('explorer.openInNewPage'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          disabled: !onOpenApplicationInNewPage,
          onSelect: () => onOpenApplicationInNewPage?.(application.id),
        },
        {
          id: 'view-owner-applications',
          label: tx('team.contextViewStudentApplications'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          disabled: !application.ownerId || !onViewApplications,
          onSelect: () => application.ownerId && onViewApplications?.(application.ownerId),
        },
        {
          id: 'copy-school',
          label: tx('explorer.copySchool'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(application.school.name, tx('team.copySchoolLabel')),
        },
        {
          id: 'copy-program',
          label: tx('explorer.copyProgram'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(application.program, tx('team.copyProgramLabel')),
        },
        {
          id: 'copy-professor',
          label: tx('explorer.copyProfessor'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(application.professor.english, tx('team.copyProfessorLabel')),
        },
        {
          id: 'copy-student',
          label: tx('team.contextCopyStudent'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(studentLabel, tx('team.copyStudentLabel')),
        },
      ],
    })
  }

  function openMemberContextMenu(event: ReactMouseEvent<HTMLElement>, member: TeamMember) {
    event.preventDefault()
    event.stopPropagation()
    showMemberContextMenu(member, event.clientX, event.clientY)
  }

  function openMemberContextMenuFromKeyboard(
    event: ReactKeyboardEvent<HTMLElement>,
    member: TeamMember,
    openOnActivate = false,
  ) {
    const contextKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
    const activationKey = openOnActivate && (event.key === 'Enter' || event.key === ' ')
    if (!contextKey && !activationKey) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    showMemberContextMenu(member, rect.left + Math.min(18, rect.width / 2), rect.top + Math.min(18, rect.height / 2))
  }

  function showMemberContextMenu(member: TeamMember, x: number, y: number) {
    const displayName = memberDisplayName(member, tx('team.memberFallback'))
    const email = memberEmail(member)
    const isSelf = member.userId === session.user.id
    const appCount = member.userId ? applicationCounts?.[member.userId] ?? 0 : 0
    const canRemove = memberCanRemove(member)
    const canEnterView = memberCanEnterView(member)
    const canFocusRelationship = member.role === 'member' && member.status === 'active'
    setContextMenu({
      x,
      y,
      title: displayName,
      subtitle: `${tx(ROLE_LABEL_KEYS[member.role])} · ${tx(member.status === 'active' ? 'team.statusActive' : 'team.statusPending')}`,
      items: [
        {
          id: 'view-applications',
          label: appCount > 0 ? format(tx('team.viewApplications'), { count: appCount }) : tx('team.viewApplicationsEmpty'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          disabled: !member.userId || !onViewApplications || isSelf,
          onSelect: () => member.userId && onViewApplications?.(member.userId),
        },
        {
          id: 'new-application',
          label: tx('team.contextNewApplicationForMember'),
          icon: <Plus size={14} aria-hidden="true" />,
          disabled: !member.userId || !onCreateApplication || member.role !== 'member',
          onSelect: () => onCreateApplication?.(member.userId ?? null),
        },
        {
          id: 'enter-view',
          label: tx(member.role === 'member' ? 'team.enterStudentView' : 'team.enterMemberView'),
          icon: <LogIn size={14} aria-hidden="true" />,
          disabled: !canEnterView,
          onSelect: () => member.userId && onImpersonateMember?.(member.userId),
        },
        {
          id: 'view-relationship',
          label: tx('team.viewRelationshipMap'),
          icon: <Network size={14} aria-hidden="true" />,
          disabled: !canFocusRelationship,
          onSelect: () => focusMemberInRelationshipMap(member),
        },
        {
          id: 'copy-name',
          label: tx('explorer.copyName'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(displayName, tx('team.copyMemberNameLabel')),
        },
        {
          id: 'copy-email',
          label: tx('explorer.copyEmail'),
          icon: <Mail size={14} aria-hidden="true" />,
          disabled: !email || !onCopy,
          onSelect: () => onCopy?.(email, tx('team.copyMemberEmailLabel')),
        },
        {
          id: 'remove-member',
          label: isSelf ? tx('team.leaveTeam') : tx('team.removeMemberTitle'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          disabled: !canRemove,
          tone: 'danger',
          onSelect: () => setPendingRemove(member),
        },
      ],
    })
  }

  function focusMemberInRelationshipMap(member: TeamMember) {
    if (member.role !== 'member' || member.status !== 'active') return
    setMemberQuery('')
    setMemberStatusFilter('all')
    setSelectedRelationStudentId(member.id)
    setMemberView('map')
  }

  function openAuditContextMenu(event: ReactMouseEvent<HTMLElement>, auditEvent: SystemEvent) {
    event.preventDefault()
    const fields = changedFields(auditEvent)
    const metadata = eventMetadata(auditEvent)
    const restorable = canRestore && canRestoreAuditEvent(auditEvent)
    const mergeable = canPreviewMergeEvent(auditEvent)
    const humanFields = fields.map((field) => mergeFieldPath(field))
    const summaryText = auditFieldSummary(fields, tx, format, lang)
    const summary = [
      localizeAuditMessage(auditEvent.message, tx),
      `${auditActorLabel(auditEvent)} · ${eventTime(auditEvent.time, lang)} · ${localizeAuditScope(auditEvent.scope, tx)}`,
      summaryText,
    ].filter(Boolean).join('\n')
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: localizeAuditMessage(auditEvent.message, tx),
      subtitle: eventTime(auditEvent.time, lang),
      items: [
        {
          id: 'open-application',
          label: tx('team.contextOpenRelatedApplication'),
          icon: <FolderOpen size={14} aria-hidden="true" />,
          disabled: !metadata.applicationId || !onOpenApplication,
          onSelect: () => metadata.applicationId && onOpenApplication?.(metadata.applicationId),
        },
        {
          id: 'open-application-new-page',
          label: tx('explorer.openInNewPage'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          disabled: !metadata.applicationId || !onOpenApplicationInNewPage,
          onSelect: () => metadata.applicationId && onOpenApplicationInNewPage?.(metadata.applicationId),
        },
        {
          id: 'preview-merge',
          label: tx('team.auditMergePreview'),
          icon: <GitMerge size={14} aria-hidden="true" />,
          disabled: !mergeable || mergeBusyId === auditEvent.id,
          onSelect: () => handlePreviewMerge(auditEvent),
        },
        {
          id: 'restore',
          label: tx('team.auditRestore'),
          icon: <RotateCcw size={14} aria-hidden="true" />,
          disabled: !restorable || restoreBusyId === auditEvent.id,
          onSelect: () => setPendingRestore(auditEvent),
        },
        {
          id: 'copy-summary',
          label: tx('explorer.copySummary'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(summary, tx('team.copyAuditSummaryLabel')),
        },
        {
          id: 'copy-fields',
          label: tx('team.contextCopyChangedFields'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: fields.length === 0 || !onCopy,
          onSelect: () => onCopy?.(humanFields.join(', '), tx('team.changedFields')),
        },
      ],
    })
  }

  function renderRelationshipControls(member: TeamMember) {
    if (member.role === 'member') {
      const teachers = studentTeachersFor(member)
      const canEditTeachers = (
        viewerRole === 'owner'
        || (viewerRole === 'admin' && isTeacherAssignedToStudent(member, session.user.id))
      ) && relationshipManagers.length > 0
      return (
        <div className="team-relation-editor team-relation-editor-student">
          <div className="team-relation-editor-head">
            <span className="team-relation-editor-icon" aria-hidden="true">
              <UserRound size={15} />
            </span>
            <span className="team-relation-editor-copy">
              <strong>{tx('team.collaborationTeachersLabel')}</strong>
              <em>{canEditTeachers
                ? tx('team.relationshipQuickAssign')
                : teachers.length > 0
                ? format(tx('team.collaborationTeachersCount'), { count: teachers.length })
                : tx('team.relationshipNoAdvisor')}</em>
            </span>
          </div>
          {canEditTeachers ? (
            <TeamTeacherAssignmentPicker
              teachers={relationshipManagers}
              assignedTeacherUserIds={teamMemberTeacherIds(member)}
              busy={rowBusyId === member.id}
              onToggle={(teacher) => handleToggleStudentTeacher(member, teacher)}
            />
          ) : (
            <div className="team-readonly-relation">
              <span>{teachers.length
                ? teachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · ')
                : tx('team.relationshipNoAdvisor')}</span>
            </div>
          )}
        </div>
      )
    }
    if (member.role === 'admin') {
      const assignedStudents = relationshipStudents.filter((student) => (
        Boolean(member.userId && isTeacherAssignedToStudent(student, member.userId))
      ))
      return (
        <div className="team-relation-editor">
          <div className="team-relation-editor-head">
            <span>
              <strong>{tx('team.memberAssignedStudentsTitle')}</strong>
              <em>{format(tx('team.memberAssignedStudentsDesc'), { count: assignedStudents.length })}</em>
            </span>
          </div>
          {assignedStudents.length === 0 ? (
            <div className="team-readonly-relation">
              <span>{tx('team.memberAssignedStudentsEmpty')}</span>
            </div>
          ) : (
            <div className="team-assigned-student-list">
              {assignedStudents.map((student) => {
                const stats = memberStats[student.id]
                const appCount = stats?.applicationCount ?? (student.userId ? applicationCounts?.[student.userId] ?? 0 : 0)
                return (
                  <div key={student.id} className="team-assigned-student-row">
                    <TeamMemberAvatar member={student} />
                    <span>
                      <strong>{memberDisplayName(student, tx('team.memberFallback'))}</strong>
                      <em>{format(tx('team.relationshipStudentMeta'), {
                        applications: appCount,
                        teacher: memberDisplayName(member, tx('team.memberFallback')),
                      })}</em>
                    </span>
                    <div>
                      {student.userId ? (
                        <button
                          type="button"
                          className="quiet-action compact-action"
                          onClick={() => {
                            setSelectedResourceStudentId(student.userId!)
                            changeTab('resources')
                          }}
                        >
                          <UserRound size={12} aria-hidden="true" />
                          {tx('team.teacherOpenStudentProfile')}
                        </button>
                      ) : null}
                      {student.userId && onViewApplications ? (
                        <button type="button" className="quiet-action compact-action" onClick={() => onViewApplications(student.userId!)}>
                          <FolderOpen size={12} aria-hidden="true" />
                          {tx('team.viewApplicationsEmpty')}
                        </button>
                      ) : null}
                      <button type="button" className="quiet-action compact-action" onClick={() => focusMemberInRelationshipMap(student)}>
                        <Network size={12} aria-hidden="true" />
                        {tx('team.viewRelationshipMap')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }
    return null
  }

  function renderMemberAccessSummary(
    member: TeamMember,
    stats: NonNullable<TeamSummary['memberStats']>[string] | undefined,
    appCount: number,
    riskTotal: number,
    includeRelation = true,
  ) {
    const assignedTeachers = member.role === 'member' ? studentTeachersFor(member) : []
    const assignedStudentCount = member.role === 'admin'
      ? relationshipStudents.filter((student) => (
          Boolean(member.userId && isTeacherAssignedToStudent(student, member.userId))
        )).length
      : 0
    const activeMemberCount = summary?.members.filter((item) => item.status === 'active').length ?? 0
    const dataValue = member.role === 'owner'
      ? format(tx('team.memberAccessOwnerData'), { count: activeMemberCount })
      : member.role === 'admin'
        ? format(tx('team.memberAccessTeacherData'), { count: assignedStudentCount })
        : format(tx('team.memberAccessStudentData'), { count: appCount })
    const relationValue = member.role === 'owner'
      ? tx('team.memberAccessOwnerRelation')
      : member.role === 'admin'
        ? format(tx('team.memberAccessTeacherRelation'), { count: assignedStudentCount })
        : assignedTeachers.length
          ? assignedTeachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · ')
          : tx('team.relationshipNoAdvisor')

    return (
      <div
        className={`team-member-access-summary${includeRelation ? '' : ' is-collaboration-summary'}`}
        aria-label={tx('team.memberAccessSummaryTitle')}
      >
        <span>
          <ShieldCheck size={14} aria-hidden="true" />
          <strong>{tx('team.memberAccessScopeLabel')}</strong>
          <em>{tx(ROLE_DESCRIPTION_KEYS[member.role])}</em>
        </span>
        <span>
          <FileText size={14} aria-hidden="true" />
          <strong>{tx('team.memberAccessDataLabel')}</strong>
          <em>{dataValue}</em>
        </span>
        <span>
          <AlertTriangle size={14} aria-hidden="true" />
          <strong>{tx('team.memberAccessHealthLabel')}</strong>
          <em>{format(tx('team.memberAccessHealth'), {
            risk: riskTotal,
            feedback: stats?.reviewCommentCount ?? 0,
          })}</em>
        </span>
        {includeRelation ? (
          <span>
            <Network size={14} aria-hidden="true" />
            <strong>{tx('team.memberAccessRelationLabel')}</strong>
            <em>{relationValue}</em>
          </span>
        ) : null}
      </div>
    )
  }

  function renderStudentNode(student: TeamMember, compact = false, sourceTeacherId: string | null = null) {
    const displayName = memberDisplayName(student, tx('team.memberFallback'))
    const stats = memberStats[student.id]
    const appCount = stats?.applicationCount ?? (student.userId ? applicationCounts?.[student.userId] ?? 0 : 0)
    const teachers = studentTeachersFor(student)
    const selected = selectedRelationStudentId === student.id
    const canDrag = (viewerRole === 'owner' || viewerRole === 'admin') && student.status === 'active'
    const dragging = relationDragStudentId === student.id
      && relationDragSourceTeacherId === sourceTeacherId
    const arriving = relationArrival?.studentId === student.id
      && relationArrival.teacherId === sourceTeacherId
    return (
      <button
        key={student.id}
        type="button"
        className={`team-relation-node student ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}${dragging ? ' is-dragging' : ''}${canDrag ? ' is-draggable' : ''}${rowBusyId === student.id ? ' is-updating' : ''}${arriving ? ` is-arriving mode-${relationArrival.mode}` : ''}`}
        aria-pressed={selected}
        aria-busy={rowBusyId === student.id || undefined}
        aria-haspopup="menu"
        draggable={canDrag}
        onClick={() => setSelectedRelationStudentId(student.id)}
        onContextMenu={(event) => {
          setSelectedRelationStudentId(student.id)
          openMemberContextMenu(event, student)
        }}
        onKeyDown={(event) => openMemberContextMenuFromKeyboard(event, student)}
        onDragStart={(event) => {
          if (!canDrag) return
          const mode = relationshipDropMode(event.altKey)
          event.dataTransfer.effectAllowed = 'copyMove'
          event.dataTransfer.setData('text/plain', student.id)
          event.dataTransfer.setData('application/x-phd-atlas-relation', JSON.stringify({
            studentId: student.id,
            sourceTeacherId,
          }))
          setRelationDragStudentId(student.id)
          setRelationDragSourceTeacherId(sourceTeacherId)
          setRelationDragMode(mode)
          setSelectedRelationStudentId(student.id)
        }}
        onDragEnd={() => {
          setRelationDragStudentId(null)
          setRelationDragSourceTeacherId(null)
          setRelationDropTeacherId(null)
          setRelationDragMode('move')
        }}
        onAnimationEnd={() => {
          if (arriving) setRelationArrival(null)
        }}
      >
        <TeamMemberAvatar member={student} />
        <div className="team-relation-node-copy">
          <strong>{displayName}</strong>
          <em>{format(tx('team.relationshipStudentMeta'), {
           applications: appCount,
            teacher: teachers.length
              ? teachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · ')
              : tx('team.unassignedAdvisor'),
          })}</em>
        </div>
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    )
  }

  function renderInviteTeacherPicker() {
    return (
      <div className="team-invite-teacher-picker">
        <div>
          <span>{tx('team.inviteTeacherAssignment')}</span>
          <p>{tx('team.inviteTeacherAssignmentDescription')}</p>
        </div>
        {invitationTeachers.length > 0 ? (
          <div className="team-invite-teacher-options">
            {invitationTeachers.map((teacher) => {
              const selected = inviteTeacherIds.includes(teacher.id)
              return (
                <button
                  key={teacher.id}
                  type="button"
                  className={selected ? 'selected' : ''}
                  aria-pressed={selected}
                  onClick={() => setInviteTeacherIds((current) => current.includes(teacher.id)
                    ? current.filter((id) => id !== teacher.id)
                    : [...current, teacher.id])}
                >
                  <TeamMemberAvatar member={teacher} />
                  <span>{memberDisplayName(teacher, tx('team.memberFallback'))}</span>
                  {selected ? <Check size={12} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="team-invite-teacher-empty">{tx('team.joinCodeNoTeachers')}</p>
        )}
      </div>
    )
  }

  function renderInvitePopover(close: () => void, teacherOnly = false) {
    const roles = teacherOnly ? (['member'] as const) : invitableRoles
    return (
      <div className="team-invite-popover">
        <div className="team-invite-popover-head">
          <div>
            <span className="eyebrow">{tx('team.inviteEyebrow')}</span>
            <strong>{tx('team.inviteTitle')}</strong>
          </div>
          <div className="team-invite-mode-switch" role="tablist" aria-label={tx('team.inviteModeLabel', 'Invite mode')}>
            <button
              type="button"
              className={inviteMode === 'single' ? 'active' : undefined}
              aria-selected={inviteMode === 'single'}
              onClick={() => setInviteMode('single')}
            >
              {tx('team.inviteModeSingle', 'Single')}
            </button>
            <button
              type="button"
              className={inviteMode === 'bulk' ? 'active' : undefined}
              aria-selected={inviteMode === 'bulk'}
              onClick={() => setInviteMode('bulk')}
            >
              {tx('team.bulkInviteTitle')}
            </button>
          </div>
        </div>

        {(inviteMode === 'bulk' || inviteRole === 'member') ? renderInviteTeacherPicker() : null}

        {inviteMode === 'single' ? (
          <form
            className="team-invite-popover-form"
            onSubmit={async (event) => {
              const ok = await handleInvite(event)
              if (ok) close()
            }}
          >
            <label className="team-field">
              <span>{tx('team.inviteEmailLabel')}</span>
              <input
                type="email"
                required
                autoFocus
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder={tx('team.inviteEmailPlaceholder')}
                disabled={inviteBusy || seatFull}
              />
            </label>
            {!teacherOnly ? (
              <label className="team-field">
                <span>{tx('team.inviteRoleLabel')}</span>
                <Select
                  size="small"
                  value={inviteRole}
                  options={roles.map((role) => ({
                    value: role,
                    label: labelForRole(role),
                    description: tx(ROLE_DESCRIPTION_KEYS[role]),
                  }))}
                  disabled={inviteBusy || seatFull}
                  ariaLabel={tx('team.inviteRoleLabel')}
                  onChange={(role) => setInviteRole(role as Exclude<TeamRole, 'owner'>)}
                />
              </label>
            ) : (
              <input type="hidden" value="member" readOnly />
            )}
            <div className="team-invite-popover-actions">
              <button type="button" className="quiet-action" onClick={close}>{tx('cancel')}</button>
              <button
                type="submit"
                className="primary-action"
                disabled={inviteBusy || seatFull || !inviteEmail.trim() || (inviteRole === 'member' && inviteTeacherIds.length === 0)}
              >
                <Mail size={13} aria-hidden="true" />
                {inviteBusy ? tx('working') : tx('team.inviteSubmit')}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="team-invite-popover-form"
            onSubmit={async (event) => {
              const ok = await handleBulkInvite(event)
              if (ok) close()
            }}
          >
            <p className="team-panel-note">{tx('team.bulkInviteDesc')}</p>
            <textarea
              className="team-bulk-invite-input"
              value={bulkInviteText}
              onChange={(event) => setBulkInviteText(event.target.value)}
              placeholder={tx('team.bulkInvitePlaceholder')}
              rows={5}
              disabled={bulkInviteBusy || seatFull}
            />
            <div className="team-invite-popover-actions">
              <button type="button" className="quiet-action" onClick={close}>{tx('cancel')}</button>
              <button
                type="submit"
                className="primary-action"
                disabled={
                  bulkInviteBusy
                  || seatFull
                  || !bulkInviteText.trim()
                  || (
                    inviteTeacherIds.length === 0
                    && parseBulkInviteLines(bulkInviteText).some((row) => row.role === 'member')
                  )
                }
              >
                <UserPlus size={13} aria-hidden="true" />
                {bulkInviteBusy ? tx('working') : tx('team.bulkInviteSubmit')}
              </button>
            </div>
          </form>
        )}

        {seatFull ? (
          <div className="team-message team-message-warning" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            {tx('team.seatLimitReached')}
          </div>
        ) : null}
      </div>
    )
  }

  function renderRelationshipMap(memberMatchesFilter?: (member: TeamMember) => boolean, filterActive = false) {
    const filteredRelationshipTeachers = filterActive && memberMatchesFilter
      ? relationshipManagers.filter((teacher) => memberMatchesFilter(teacher))
      : relationshipManagers
    const matchedTeacherIds = new Set(filteredRelationshipTeachers.map((teacher) => teacher.id))
    const filteredRelationshipStudents = filterActive && memberMatchesFilter
      ? relationshipStudents.filter((student) => {
          if (memberMatchesFilter(student)) return true
          return studentTeachersFor(student).some((teacher) => matchedTeacherIds.has(teacher.id))
        })
      : relationshipStudents
    const teachersWithMatchingStudents = new Set(filteredRelationshipStudents
      .flatMap((student) => studentTeachersFor(student).map((teacher) => teacher.id)))
    const visibleRelationshipTeachers = filterActive
      ? relationshipManagers.filter((teacher) => matchedTeacherIds.has(teacher.id) || teachersWithMatchingStudents.has(teacher.id))
      : relationshipManagers

    const studentsByAdvisorId = new Map<string, TeamMember[]>()
    for (const student of filteredRelationshipStudents) {
      const teachers = studentTeachersFor(student)
      if (teachers.length === 0) {
        studentsByAdvisorId.set('unassigned', [...(studentsByAdvisorId.get('unassigned') ?? []), student])
        continue
      }
      for (const teacher of teachers) {
        studentsByAdvisorId.set(teacher.id, [...(studentsByAdvisorId.get(teacher.id) ?? []), student])
      }
    }
    const owner = summary?.members.find((member) => member.role === 'owner') ?? visibleRelationshipTeachers[0] ?? null
    const unassignedStudents = studentsByAdvisorId.get('unassigned') ?? []
    const relationBranches = [
      ...visibleRelationshipTeachers.map((teacher) => ({ id: teacher.id, teacher, students: studentsByAdvisorId.get(teacher.id) ?? [], muted: false })),
      ...(unassignedStudents.length > 0 ? [{ id: 'unassigned', teacher: null, students: unassignedStudents, muted: true }] : []),
    ]
    const selectedStudent = filteredRelationshipStudents.find((student) => student.id === selectedRelationStudentId) ?? filteredRelationshipStudents[0] ?? null
    const selectedTeachers = selectedStudent ? studentTeachersFor(selectedStudent) : []
    const selectedStats = selectedStudent ? memberStats[selectedStudent.id] : null
    const selectedStudentApps = selectedStudent?.userId ? allApplicationsByOwner.get(selectedStudent.userId) ?? [] : []
    const canEditSelectedAdvisor = Boolean(
      selectedStudent
      && relationshipManagers.length > 0
      && (
        viewerRole === 'owner'
        || (viewerRole === 'admin' && isTeacherAssignedToStudent(selectedStudent, session.user.id))
      ),
    )
    return (
      <div className="team-relation-map">
        <div className="team-relation-map-head">
          <div>
            <span className="eyebrow">{tx('team.relationshipMapEyebrow')}</span>
            <strong>{tx('team.relationshipMapTitle')}</strong>
          </div>
          <div className="team-relation-map-head-actions">
            <span className="team-relation-map-stats">{format(tx('team.relationshipMapStats'), {
              teachers: visibleRelationshipTeachers.length,
              students: filteredRelationshipStudents.length,
            })}</span>
            <div className="team-relation-map-tools">
              <div className="team-relation-help">
                <button
                  type="button"
                  className="team-relation-tool-button"
                  aria-label={tx('team.relationshipInstructionsTitle')}
                  aria-describedby="team-relation-instructions"
                >
                  <Info size={15} aria-hidden="true" />
                </button>
                <div id="team-relation-instructions" className="team-relation-help-popover" role="tooltip">
                  <strong>{tx('team.relationshipInstructionsTitle')}</strong>
                  <span><kbd>{tx('team.relationshipKeyAlt')}</kbd>{tx('team.relationshipInstructionAdd')}</span>
                  <span><kbd>{tx('team.relationshipKeyCtrl')}</kbd>{tx('team.relationshipInstructionMove')}</span>
                  <span><ZoomIn size={13} aria-hidden="true" />{tx('team.relationshipInstructionZoom')}</span>
                </div>
              </div>
              <div className="team-relation-zoom-controls" role="group" aria-label={tx('team.relationshipZoomControls')}>
                <button
                  type="button"
                  onClick={() => paintRelationshipZoom(relationZoomRef.current - RELATIONSHIP_ZOOM_STEP)}
                  disabled={relationZoom <= RELATIONSHIP_ZOOM_MIN}
                  aria-label={tx('team.relationshipZoomOut')}
                  title={tx('team.relationshipZoomOut')}
                >
                  <ZoomOut size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="team-relation-zoom-level"
                  onClick={() => paintRelationshipZoom(1)}
                  aria-label={tx('team.relationshipZoomReset')}
                  title={tx('team.relationshipZoomReset')}
                >
                  <output
                    ref={relationZoomLabelRef}
                    aria-label={format(tx('team.relationshipZoomLevel'), {
                      level: Math.round(relationZoom * 100),
                    })}
                  >
                    {Math.round(relationZoom * 100)}%
                  </output>
                </button>
                <button
                  type="button"
                  onClick={() => paintRelationshipZoom(relationZoomRef.current + RELATIONSHIP_ZOOM_STEP)}
                  disabled={relationZoom >= RELATIONSHIP_ZOOM_MAX}
                  aria-label={tx('team.relationshipZoomIn')}
                  title={tx('team.relationshipZoomIn')}
                >
                  <ZoomIn size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="team-relation-board">
          <div
            ref={setRelationCanvas}
            className="team-relation-canvas"
            onPointerDown={handleRelationshipPointerDown}
            onPointerMove={handleRelationshipPointerMove}
            onPointerUp={finishRelationshipPointer}
            onPointerCancel={finishRelationshipPointer}
            onClickCapture={(event) => {
              if (Date.now() >= relationSuppressClickUntilRef.current) return
              event.preventDefault()
              event.stopPropagation()
            }}
            aria-label={tx('team.relationshipMapTitle')}
          >
            <div
              ref={setRelationCanvasStage}
              className="team-relation-canvas-stage"
              style={{ '--team-relation-columns': Math.max(1, relationBranches.length) } as CSSProperties}
            >
              {owner ? (
                <div className="team-relation-hub">
                  <TeamMemberAvatar member={owner} />
                  <div className="team-relation-node-copy">
                    <strong>{summary?.team.name ?? memberDisplayName(owner, tx('team.memberFallback'))}</strong>
                    <em>{memberDisplayName(owner, tx('team.memberFallback'))} · {tx(ROLE_LABEL_KEYS.owner)}</em>
                  </div>
                </div>
              ) : null}
              <div className="team-relation-flow">
                {relationBranches.map(({ id, teacher, students, muted }, branchIndex) => {
                  const dropActive = Boolean(teacher && relationDropTeacherId === teacher.id && relationDragStudentId)
                  const arriving = Boolean(teacher && relationArrival?.teacherId === teacher.id)
                  const canDrop = Boolean(
                    (viewerRole === 'owner' || viewerRole === 'admin')
                    && teacher
                    && relationDragStudentId,
                  )
                  const dropLabel = relationDragMode === 'add'
                    ? tx('team.relationshipDropAdd')
                    : tx('team.relationshipDropMove')
                  return (
                  <article
                    key={id}
                    className={`team-relation-branch ${muted ? 'muted' : ''}${dropActive ? ` is-drop-target mode-${relationDragMode}` : ''}${canDrop ? ' is-droppable' : ''}${arriving ? ` has-arrival mode-${relationArrival?.mode}` : ''}`}
                    style={{ '--branch-index': branchIndex } as CSSProperties}
                    onDragOver={(event) => {
                      if (!canDrop || !teacher) return
                      event.preventDefault()
                      const mode = relationshipDropMode(event.altKey)
                      event.dataTransfer.dropEffect = mode === 'add' ? 'copy' : 'move'
                      if (relationDragMode !== mode) setRelationDragMode(mode)
                      setRelationDropTeacherId(teacher.id)
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                      if (relationDropTeacherId === teacher?.id) setRelationDropTeacherId(null)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!teacher || (viewerRole !== 'owner' && viewerRole !== 'admin')) return
                      const studentId = event.dataTransfer.getData('text/plain') || relationDragStudentId
                      let sourceTeacherId = relationDragSourceTeacherId
                      const encodedRelation = event.dataTransfer.getData('application/x-phd-atlas-relation')
                      if (encodedRelation) {
                        try {
                          const relation = JSON.parse(encodedRelation) as { sourceTeacherId?: string | null }
                          sourceTeacherId = relation.sourceTeacherId ?? null
                        } catch {
                          // The plain-text student id and in-memory source remain the safe fallback.
                        }
                      }
                      const student = filteredRelationshipStudents.find((item) => item.id === studentId)
                        ?? relationshipStudents.find((item) => item.id === studentId)
                      const mode = relationshipDropMode(event.altKey)
                      setRelationDragStudentId(null)
                      setRelationDragSourceTeacherId(null)
                      setRelationDropTeacherId(null)
                      setRelationDragMode('move')
                      if (!student || !teacher.userId) return
                      void handleRelationshipDrop(student, sourceTeacherId, teacher, mode)
                    }}
                  >
                    <div className="team-relation-branch-line" aria-hidden="true" />
                    <div
                      className={`team-relation-node teacher${teacher ? ' is-contextual' : ''}${dropActive ? ` is-drop-active mode-${relationDragMode}` : ''}`}
                      role={teacher ? 'button' : undefined}
                      tabIndex={teacher ? 0 : undefined}
                      aria-haspopup={teacher ? 'menu' : undefined}
                      onContextMenu={teacher ? (event) => openMemberContextMenu(event, teacher) : undefined}
                      onKeyDown={teacher ? (event) => openMemberContextMenuFromKeyboard(event, teacher, true) : undefined}
                    >
                      <TeamMemberAvatar member={teacher} />
                      <div className="team-relation-node-copy">
                        <strong>{teacher ? memberDisplayName(teacher, tx('team.memberFallback')) : tx('team.unassignedAdvisor')}</strong>
                        <em>
                          {dropActive
                            ? dropLabel
                            : format(tx('team.relationshipTeacherMeta'), { count: students.length })}
                        </em>
                      </div>
                    </div>
                    <div className="team-relation-children">
                      {students.length === 0 ? (
                        <div className="team-relation-empty">
                          {canDrop ? dropLabel : tx('team.relationshipNoAssignedStudents')}
                        </div>
                      ) : students.map((student) => renderStudentNode(student, true, teacher?.id ?? null))}
                    </div>
                  </article>
                  )
                })}
              </div>
            </div>
          </div>
          <aside className="team-relation-inspector">
            {selectedStudent ? (
              <>
                <div className="team-relation-inspector-head">
                  <TeamMemberAvatar member={selectedStudent} />
                  <span>
                    <em>{tx('team.relationshipInspectorEyebrow')}</em>
                    <strong>{memberDisplayName(selectedStudent, tx('team.memberFallback'))}</strong>
                    <small>{memberEmail(selectedStudent)}</small>
                  </span>
                </div>
                <div className="team-relation-inspector-metrics">
                  <span><strong>{selectedStats?.applicationCount ?? selectedStudentApps.length}</strong><em>{tx('team.studentMembersSharedApps')}</em></span>
                  <span><strong>{selectedStats?.riskCount ?? selectedStudentApps.filter((application) => applicationHealth(application) === 'risk').length}</strong><em>{tx('team.teacherKpiRisk')}</em></span>
                  <span><strong>{selectedStats?.reviewCommentCount ?? selectedStudentApps.reduce((total, application) => total + countReviewComments(application.reviewComments), 0)}</strong><em>{tx('team.studentMembersFeedback')}</em></span>
                </div>
                <div className="team-relation-inspector-section">
                  <span>{tx('team.collaborationTeachersLabel')}</span>
                  {canEditSelectedAdvisor ? (
                    <TeamTeacherAssignmentPicker
                      teachers={relationshipManagers}
                      assignedTeacherUserIds={teamMemberTeacherIds(selectedStudent)}
                      busy={rowBusyId === selectedStudent.id}
                      onToggle={(teacher) => handleToggleStudentTeacher(selectedStudent, teacher)}
                    />
                  ) : (
                    <div className="team-readonly-relation">
                      <span>{selectedTeachers.length
                        ? selectedTeachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · ')
                        : tx('team.relationshipNoAdvisor')}</span>
                    </div>
                  )}
                </div>
                <div className="team-relation-inspector-actions">
                  {selectedStudent.userId && onViewApplications ? (
                    <button type="button" className="primary-action" onClick={() => onViewApplications(selectedStudent.userId!)}>
                      <FileText size={13} aria-hidden="true" />
                      {selectedStats?.applicationCount
                        ? format(tx('team.viewApplications'), { count: selectedStats.applicationCount })
                        : tx('team.viewApplicationsEmpty')}
                    </button>
                  ) : null}
                  {memberCanEnterView(selectedStudent) ? (
                    <button type="button" className="quiet-action" onClick={() => onImpersonateMember?.(selectedStudent.userId!)}>
                      <LogIn size={13} aria-hidden="true" />
                      {tx('team.enterStudentView')}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="team-empty compact">
                <span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span>
                <div>
                  <h3>{tx('team.relationshipNoStudents')}</h3>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    )
  }

  function actorName(event: SystemEvent) {
    const metadata = eventMetadata(event)
    const delegated = metadata.impersonation
    if (delegated?.actorId && delegated.actorId === event.actorId && delegated.actorName) return delegated.actorName
    if (!event.actorId) return tx('team.systemActor')
    const member = membersByUserId.get(event.actorId)
    return member ? memberDisplayName(member, tx('team.memberFallback')) : tx('team.unknownActor')
  }

  function auditActorLabel(event: SystemEvent) {
    const actor = actorName(event)
    const delegated = eventMetadata(event).impersonation
    if (!delegated?.targetUserId) return actor
    const targetMember = membersByUserId.get(delegated.targetUserId)
    const target = targetMember
      ? memberDisplayName(targetMember, tx('team.memberFallback'))
      : (delegated.targetName || delegated.targetEmail || tx('team.memberFallback'))
    return format(tx('team.auditActingAs'), { actor, target })
  }

  function shortEventId(eventId: string) {
    return eventId.replace(/^(evt|event|sys)[_-]?/i, '').slice(0, 7) || eventId.slice(0, 7)
  }

  function auditStatus(event: SystemEvent, mergeable: boolean, restorable: boolean) {
    const metadata = eventMetadata(event)
    if (metadata.mergedFromEventId) return 'merged'
    if (metadata.restoredFromEventId) return 'restored'
    if (metadata.flaggedConflictForEventId) return 'manual'
    if (mergeable) return 'merge'
    if (restorable) return 'restore'
    return 'logged'
  }

  function mergeFieldGroups(fields: TeamMergePreview['fields']) {
    const groups = new Map<string, {
      key: string
      label: string
      fields: TeamMergePreview['fields']
    }>()
    for (const field of fields) {
      const key = mergeFieldRoot(field.field)
      const label = mergeFieldSectionLabel(field.field, tx)
      const group = groups.get(key) ?? { key, label, fields: [] }
      group.fields.push(field)
      groups.set(key, group)
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      fields: [...group.fields].sort((left, right) => (
        mergeStatusRank(left.status) - mergeStatusRank(right.status) || left.field.localeCompare(right.field)
      )),
    }))
  }

  function mergeFieldPath(field: string) {
    const section = mergeFieldSectionLabel(field, tx)
    const label = mergeFieldLabel(field, tx, format)
    return section === label ? section : format(tx('team.mergeFieldLocation'), { section, field: label })
  }

  const roleLabel = viewerRole ? labelForRole(viewerRole) : ''
  const screenTitle = tx('team.screenTitle')
  const workspaceOptions = useMemo(() => teamWorkspaces.map((workspace) => ({
    value: workspace.teamId,
    label: workspace.name,
    description: format(tx('team.workspaceOptionDesc'), {
      role: workspace.viewerRole ? tx(ROLE_LABEL_KEYS[workspace.viewerRole]) : tx('team.workspaceRoleUnknown'),
      members: workspace.memberCount,
      applications: workspace.applicationCount,
      pending: workspace.pendingTransferCount,
    }),
  })), [format, teamWorkspaces, tx])
  const workspaceSelectValue = activeTeamId ?? summary?.team.id ?? teamWorkspaces[0]?.teamId ?? ''
  const teamContacts = (summary?.members ?? []).filter((member) => (
    member.status === 'active' &&
    (member.role === 'owner' || member.role === 'admin') &&
    member.userId !== session.user.id
  ))
  const teacherPrimaryStudent = supervisedStudentRows.find((row) => row.member.userId)?.member ?? null

  function teamTabLabel(tab: TeamSection) {
    if (viewerRole === 'admin' && tab === 'applications') return tx('team.tabTeacherApps')
    if (viewerRole === 'admin' && tab === 'members') return tx('team.tabTeacherStudents')
    if ((viewerRole === 'admin' || viewerRole === 'owner') && tab === 'resources') return tx('team.tabTeacherResources')
    if (viewerRole === 'member' && tab === 'applications') return tx('team.tabStudentApps')
    if (viewerRole === 'member' && tab === 'members') return tx('team.tabStudentPeople')
    if (viewerRole === 'member' && tab === 'resources') return tx('team.tabStudentResources')
    return tx(`team.tab${tab[0].toUpperCase()}${tab.slice(1)}`)
  }

  const renderTabs = () => (
    <div className="team-tabs" role="tablist" aria-label={tx('team.tabsLabel')}>
      {visibleTeamTabs.map((tab) => {
        const Icon = tab === 'overview'
          ? ShieldCheck
          : tab === 'applications'
            ? FileText
            : tab === 'members'
              ? Users
                : tab === 'resources'
                  ? ((viewerRole === 'admin' || viewerRole === 'owner') ? UserRound : Database)
                : tab === 'discover'
                  ? Compass
                  : tab === 'audit'
                  ? History
                  : Settings
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            className={safeActiveTab === tab ? 'active' : ''}
            aria-selected={safeActiveTab === tab}
            onClick={() => changeTab(tab)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{teamTabLabel(tab)}</span>
          </button>
        )
      })}
    </div>
  )

  const renderApplicationFilters = (
    shown = filteredApplications.length,
    total = applications.length,
  ) => (
    <div className="team-filter-bar">
      <label className="team-search-field">
        <Search size={14} aria-hidden="true" />
        <input
          value={teamQuery}
          onChange={(event) => setTeamQuery(event.target.value)}
          placeholder={tx('team.searchPlaceholder')}
          aria-label={tx('team.searchPlaceholder')}
        />
      </label>
      <div className="team-health-filter" aria-label={tx('team.healthFilterLabel')}>
        {HEALTH_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={healthFilter === filter ? 'active' : ''}
            onClick={() => setHealthFilter(filter)}
          >
            {filter === 'all' ? tx('team.healthFilterAll') : tx(healthLabelKey(filter))}
          </button>
        ))}
      </div>
      <span className="team-filter-count">
        {format(tx('team.filteredCount'), { shown, total })}
      </span>
    </div>
  )

  const renderTeamContactCard = (member: TeamMember) => (
    <article key={member.id} className="team-contact-card">
      <TeamMemberAvatar member={member} />
      <span>
        <strong>{memberDisplayName(member, tx('team.memberFallback'))}</strong>
        <em>{tx(ROLE_LABEL_KEYS[member.role])}</em>
        <small>{memberEmail(member)}</small>
      </span>
      {memberMailtoHref(member) ? (
        <a className="quiet-action compact-action" href={memberMailtoHref(member)}>
          <Mail size={12} aria-hidden="true" />
          {tx('team.contactByEmail')}
        </a>
      ) : null}
    </article>
  )

  const renderAssignedTeacherContacts = () => (
    <div className="team-assigned-teacher-list">
      {assignedTeachers.length > 0 ? assignedTeachers.map((teacher) => (
        <div key={teacher.id} className="team-assigned-teacher-row">
          <TeamMemberAvatar member={teacher} />
          <span>
            <strong>{memberDisplayName(teacher, tx('team.memberFallback'))}</strong>
            <em>{tx('team.studentAdvisorSubtitle')}</em>
            <small>{memberEmail(teacher)}</small>
          </span>
          {memberMailtoHref(teacher) ? (
            <a className="quiet-action compact-action" href={memberMailtoHref(teacher)}>
              <Mail size={12} aria-hidden="true" />
              {tx('team.contactByEmail')}
            </a>
          ) : null}
        </div>
      )) : (
        <div className="team-assigned-teacher-row is-empty">
          <span className="empty-state-icon"><UserPlus size={16} aria-hidden="true" /></span>
          <span>
            <strong>{tx('team.relationshipNoAdvisor')}</strong>
            <em>{tx('team.studentAdvisorMissingDesc')}</em>
            <small>{tx('team.studentAdvisorMissingHint')}</small>
          </span>
        </div>
      )}
    </div>
  )

  const renderStudentPendingRequestsPreview = () => {
    if (studentPendingTransferRequests.length === 0) return null

    return (
      <div className="team-student-pending-requests" aria-label={tx('team.studentPendingRequestsTitle')}>
        <div className="team-student-pending-requests-head">
          <span>
            <ShieldCheck size={13} aria-hidden="true" />
            <strong>{tx('team.studentPendingRequestsTitle')}</strong>
          </span>
          <em>{format(tx('team.studentPendingRequestsMeta'), { count: studentPendingTransferRequests.length })}</em>
        </div>
        <div className="team-student-pending-request-list">
          {studentPendingTransferRequests.slice(0, 3).map((request) => (
            <span key={request.id}>
              <strong>{request.applicationName}</strong>
              <em>
                {tx(request.direction === 'join' ? 'team.studentPendingJoinLabel' : 'team.studentPendingLeaveLabel')}
                {' · '}
                {format(tx('team.studentPendingRequestLine'), {
                  program: request.program || tx('team.studentPendingUnknownProgram'),
                  time: eventTime(request.requestedAt, lang),
                })}
              </em>
            </span>
          ))}
        </div>
        <button type="button" className="quiet-action compact-action" onClick={() => changeTab('resources')}>
          <ArrowRight size={12} aria-hidden="true" />
          {tx('team.studentPendingViewAll')}
        </button>
      </div>
    )
  }

  const renderStudentIntakePanel = () => (
    <div className="team-student-intake-panel">
      <span className="team-resource-icon"><ShieldCheck size={16} aria-hidden="true" /></span>
      <span>
        <strong>{tx('team.studentApplicationIntakeTitle')}</strong>
        <em>{format(tx('team.studentApplicationIntakeMeta'), {
          pending: studentPendingTransferRequests.length,
        })}</em>
      </span>
      <div className="team-student-intake-actions">
        {onCreateApplication ? (
          <button type="button" className="primary-action compact-action" onClick={() => onCreateApplication(null)}>
            <Plus size={12} aria-hidden="true" />
            {tx('team.studentRequestNewApplication')}
          </button>
        ) : null}
        {onSwitchToPersonal ? (
          <button type="button" className="quiet-action compact-action" onClick={onSwitchToPersonal}>
            <FolderOpen size={12} aria-hidden="true" />
            {tx('team.studentMoveFromPersonal')}
          </button>
        ) : null}
      </div>
      {renderStudentPendingRequestsPreview()}
    </div>
  )

  const renderStudentWorkbench = () => (
    <div className="team-student-workbench">
      <button type="button" onClick={() => changeTab('applications')}>
        <FileText size={15} aria-hidden="true" />
        <span><strong>{format(tx('team.studentWorkbenchShared'), { count: applications.length })}</strong><em>{tx('team.studentWorkbenchSharedDesc')}</em></span>
      </button>
      <button type="button" onClick={() => changeTab('applications')}>
        <MessageSquare size={15} aria-hidden="true" />
        <span><strong>{format(tx('team.studentWorkbenchFeedback'), { count: studentFeedbackCount })}</strong><em>{tx('team.studentWorkbenchFeedbackDesc')}</em></span>
      </button>
      <button type="button" onClick={() => changeTab('resources')}>
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          <strong>{tx('team.studentPendingRequestsTitle')}</strong>
          <em>{format(tx('team.studentPendingRequestsMeta'), { count: studentPendingTransferRequests.length })}</em>
        </span>
      </button>
    </div>
  )

  const renderNotificationLauncher = () => {
    if (!summary || !canInvite) return null
    return (
      <NotificationPublisherPanel
        className="team-panel team-notification-launcher team-notification-panel"
        eyebrow={tx('team.notificationPublisherEyebrow')}
        title={tx('team.notificationPublisherTitle')}
        description=""
        recipientField="memberIds"
        recipients={notificationRecipients}
        groups={notificationGroups}
        audiences={notificationAudiences}
        onPublish={(input) => phdApi.publishTeamNotification(session.token, summary.team.id, input)}
        onCreateGroup={createNotificationGroup}
        onDeleteGroup={deleteNotificationGroup}
      />
    )
  }

  const renderTeacherCreateStrip = (
    targetId = teacherCreateTargetId,
    onTargetChange: (studentId: string) => void = setTeacherStudentFilter,
  ) => (
    <div className="team-teacher-create-strip">
      <label className="team-teacher-create-select">
        <span>{tx('team.teacherStudentSelectLabel')}</span>
        <Select
          size="small"
          searchable
          value={targetId}
          ariaLabel={tx('team.teacherStudentSelectLabel')}
          disabled={supervisedStudentRows.length === 0}
          options={supervisedStudentRows
            .filter((row) => row.member.userId)
            .map((row) => ({
              value: row.member.userId!,
              label: memberDisplayName(row.member, tx('team.memberFallback')),
              description: format(tx('team.teacherStudentSelectDesc'), {
                applications: row.applications.length,
                email: memberEmail(row.member) || tx('team.noLinkedEmail'),
              }),
            }))}
          onChange={onTargetChange}
        />
      </label>
      <button
        type="button"
        className="primary-action"
        disabled={!targetId || !onCreateApplication}
        onClick={() => onCreateApplication?.(targetId)}
      >
        <Plus size={13} aria-hidden="true" />
        {tx('team.teacherCreateApplication')}
      </button>
    </div>
  )

  const renderOverviewDock = (items: Array<{
    key: string
    icon: ReactNode
    label: string
    count?: number
    action: () => void
  }>) => (
    <nav className="team-overview-dock" aria-label={tx('team.overviewPortalsTitle')}>
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.action}>
          <span className="team-overview-dock-icon">{item.icon}</span>
          <strong>{item.label}</strong>
          {typeof item.count === 'number' ? <small>{item.count}</small> : null}
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      ))}
    </nav>
  )

  const renderOverviewMore = (description: string, content: ReactNode) => (
    <section className={`team-overview-more${overviewMoreOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="team-overview-more-toggle"
        onClick={() => setOverviewMoreOpen((open) => !open)}
        aria-expanded={overviewMoreOpen}
        aria-controls="team-overview-more-content"
        aria-label={tx(overviewMoreOpen ? 'team.overviewMoreClose' : 'team.overviewMoreOpen')}
      >
        <span>
          <strong>{tx('team.overviewMoreTitle')}</strong>
          <em>{description}</em>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <CollapsiblePanel
        open={overviewMoreOpen}
        id="team-overview-more-content"
        className="team-overview-more-collapse"
        innerClassName="team-overview-more-inner"
      >
        {content}
      </CollapsiblePanel>
    </section>
  )

  const renderTeacherOverview = () => {
    const visibleRows = supervisedStudentRows.slice(0, 6)
    const selectedRow = visibleRows.find((row) => row.member.userId === teacherOverviewStudentId)
      ?? visibleRows[0]
      ?? null
    const selectedStudentId = selectedRow?.member.userId ?? ''
    const selectedIndex = Math.max(0, visibleRows.findIndex((row) => row === selectedRow))
    const nextAction = selectedRow ? teacherNextAction(selectedRow) : null

    return (
      <div className="team-tab-panel team-overview-redesign role-teacher">
        <section className="team-overview-workbench">
          <header className="team-overview-workbench-head">
            <span>
              <span className="eyebrow">{tx('team.teacherQueueEyebrow')}</span>
              <h3>{tx('team.teacherQueueTitle')}</h3>
              <p>{format(tx('team.teacherWorkspaceDesc'), { team: summary?.team.name ?? screenTitle })}</p>
            </span>
            <span className="team-overview-attention-count">
              <strong>{teacherRiskApplications.length + teacherStudentsWithoutApplications.length}</strong>
              <em>{tx('team.teacherIdentityAttention')}</em>
            </span>
          </header>

          {selectedRow ? (
            <div className="team-overview-stage">
              <div className="team-overview-queue">
                <div
                  className="team-overview-queue-list"
                  style={{ '--team-overview-selected-index': selectedIndex } as CSSProperties}
                  aria-label={tx('team.teacherQueueTitle')}
                >
                  <span className="team-overview-queue-slider" aria-hidden="true" />
                  {visibleRows.map((row, index) => {
                    const selected = row === selectedRow
                    return (
                      <button
                        key={row.member.id}
                        type="button"
                        className={`team-overview-queue-item tone-${row.state}${selected ? ' is-selected' : ''}`}
                        style={{ '--team-overview-item-index': index } as CSSProperties}
                        aria-pressed={selected}
                        onClick={() => setTeacherOverviewStudentId(row.member.userId)}
                      >
                        <TeamMemberAvatar member={row.member} className="team-overview-student-avatar" />
                        <span>
                          <strong>{memberDisplayName(row.member, tx('team.memberFallback'))}</strong>
                          <em>{tx(studentStateLabelKey(row.state))}</em>
                        </span>
                        <small>{row.applications.length}</small>
                        <ArrowRight size={13} aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  className="team-overview-create-toggle"
                  onClick={() => setTeacherQuickCreateOpen((open) => !open)}
                  aria-expanded={teacherQuickCreateOpen}
                  aria-controls="team-overview-teacher-create"
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{tx('team.teacherCreateApplication')}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <CollapsiblePanel
                  open={teacherQuickCreateOpen}
                  id="team-overview-teacher-create"
                  className="team-overview-create-collapse"
                  innerClassName="team-overview-create-inner"
                >
                  {renderTeacherCreateStrip(selectedStudentId, setTeacherOverviewStudentId)}
                </CollapsiblePanel>
              </div>

              <section className="team-overview-preview" aria-live="polite">
                <div key={selectedRow.member.id} className="team-overview-preview-content">
                  <header className="team-overview-student-head">
                    <TeamMemberAvatar member={selectedRow.member} className="team-overview-preview-avatar" />
                    <span>
                      <span className="eyebrow">{tx('team.nextActionsEyebrow')}</span>
                      <h4>{memberDisplayName(selectedRow.member, tx('team.memberFallback'))}</h4>
                      <p>{memberEmail(selectedRow.member) || tx('team.noLinkedEmail')}</p>
                    </span>
                    <div className="team-overview-preview-tools">
                      {memberMailtoHref(selectedRow.member) ? (
                        <a href={memberMailtoHref(selectedRow.member)} aria-label={tx('team.contactByEmail')}>
                          <Mail size={14} aria-hidden="true" />
                        </a>
                      ) : null}
                      {memberCanEnterView(selectedRow.member) ? (
                        <button
                          type="button"
                          onClick={() => onImpersonateMember?.(selectedRow.member.userId!)}
                          aria-label={tx('team.enterStudentView')}
                        >
                          <LogIn size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </header>

                  <div className="team-overview-preview-metrics" aria-label={tx('team.studentMetricsLabel')}>
                    <span><strong>{selectedRow.applications.length}</strong><em>{tx('team.metricApplications')}</em></span>
                    <span>
                      <strong>{selectedRow.averageProgress}%</strong>
                      <em>{tx('team.metricProgress')}</em>
                      <i
                        className="team-overview-metric-progress"
                        style={{ '--team-overview-progress': selectedRow.averageProgress / 100 } as CSSProperties}
                        aria-hidden="true"
                      />
                    </span>
                    <span className={selectedRow.riskCount + selectedRow.watchCount > 0 ? 'is-attention' : ''}>
                      <strong>{selectedRow.riskCount + selectedRow.watchCount}</strong>
                      <em>{tx('team.metricRisk')}</em>
                    </span>
                    <span><strong>{selectedRow.dueSoonCount}</strong><em>{tx('team.metricDue')}</em></span>
                    <span><strong>{selectedRow.feedbackCount}</strong><em>{tx('team.metricFeedback')}</em></span>
                  </div>

                  {nextAction ? (
                    <div className={`team-overview-next-action tone-${nextAction.tone}`}>
                      <span className="team-overview-next-icon">{actionIconForTone(nextAction.tone)}</span>
                      <span>
                        <em>{tx('team.nextActionsEyebrow')}</em>
                        <strong>{nextAction.title}</strong>
                        <p>{nextAction.desc}</p>
                      </span>
                      {nextAction.application ? (
                        <button type="button" className="primary-action" onClick={() => onOpenApplication?.(nextAction.application!.id)}>
                          {nextAction.cta}
                          <ArrowRight size={13} aria-hidden="true" />
                        </button>
                      ) : selectedStudentId && onCreateApplication ? (
                        <button type="button" className="primary-action" onClick={() => onCreateApplication(selectedStudentId)}>
                          {nextAction.cta}
                          <ArrowRight size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <footer className="team-overview-preview-footer">
                    <button type="button" className="quiet-action" onClick={() => changeTab('applications')}>
                      <FileText size={13} aria-hidden="true" />
                      {tx('team.tabTeacherApps')}
                    </button>
                    {selectedStudentId && onViewApplications ? (
                      <button type="button" className="quiet-action" onClick={() => onViewApplications(selectedStudentId)}>
                        <FolderOpen size={13} aria-hidden="true" />
                        {tx('team.viewApplicationsEmpty')}
                      </button>
                    ) : null}
                  </footer>
                </div>
              </section>
            </div>
          ) : (
            <div className="team-overview-empty">
              <span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span>
              <span>
                <strong>{tx('team.teacherNoStudents')}</strong>
                <em>{tx('team.teacherNoStudentsDesc')}</em>
              </span>
            </div>
          )}
        </section>

        {renderOverviewDock([
          {
            key: 'members',
            icon: <Users size={16} aria-hidden="true" />,
            label: tx('team.tabTeacherStudents'),
            count: supervisedStudentRows.length,
            action: () => changeTab('members'),
          },
          {
            key: 'applications',
            icon: <FileText size={16} aria-hidden="true" />,
            label: tx('team.tabTeacherApps'),
            count: supervisedApplications.length,
            action: () => changeTab('applications'),
          },
          {
            key: 'resources',
            icon: <Database size={16} aria-hidden="true" />,
            label: tx('team.tabResources'),
            action: () => changeTab('resources'),
          },
          {
            key: 'discover',
            icon: <Compass size={16} aria-hidden="true" />,
            label: tx('team.tabDiscover'),
            action: () => changeTab('discover'),
          },
        ])}

        {renderOverviewMore(
          tx('team.teacherContactsTitle'),
          teamContacts.length === 0 ? (
            <div className="team-overview-empty compact">
              <span className="empty-state-icon"><Mail size={18} aria-hidden="true" /></span>
              <span>
                <strong>{tx('team.teacherNoContacts')}</strong>
                <em>{tx('team.teacherNoContactsDesc')}</em>
              </span>
            </div>
          ) : (
            <div className="team-overview-contact-list">
              {teamContacts.slice(0, 5).map(renderTeamContactCard)}
            </div>
          ),
        )}
      </div>
    )
  }

  const renderStudentOverview = () => (
    <div className="team-tab-panel">
      <section className="team-panel team-role-landing student">
        <div className="team-panel-head">
          <div>
            <span className="eyebrow">{tx('team.studentWorkspaceEyebrow')}</span>
            <h3>{tx('team.studentWorkspaceTitle')}</h3>
          </div>
          <UserPlus size={16} aria-hidden="true" />
        </div>
        {renderAssignedTeacherContacts()}
        {renderStudentIntakePanel()}
        {renderStudentWorkbench()}
      </section>

      <div className="team-command-grid">
        <section className="team-command-panel team-command-panel-wide">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{tx('team.studentSharedEyebrow')}</span>
              <h3>{format(tx('team.studentSharedTitle'), { count: applications.length })}</h3>
            </div>
            <FileText size={16} aria-hidden="true" />
          </div>
          {renderStudentActionPlan()}
          {applications.length === 0 ? (
            <div className="team-empty compact">
              <span className="empty-state-icon"><FileText size={18} aria-hidden="true" /></span>
              <div>
                <h3>{tx('team.noStudentSharedApps')}</h3>
                <p>{tx('team.noStudentSharedAppsDesc')}</p>
              </div>
            </div>
          ) : (
            <div className="team-queue-list">
              {applications.slice(0, 5).map(renderApplicationCard)}
            </div>
          )}
        </section>

        <section className="team-command-panel">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{tx('team.studentActivityEyebrow')}</span>
              <h3>{tx('team.studentActivityTitle')}</h3>
            </div>
            <Activity size={16} aria-hidden="true" />
          </div>
          {studentRecentEvents.length === 0 ? (
            <div className="team-empty compact">
              <span className="empty-state-icon"><Activity size={18} aria-hidden="true" /></span>
              <div>
                <h3>{tx('team.studentNoActivity')}</h3>
                <p>{tx('team.studentNoActivityDesc')}</p>
              </div>
            </div>
          ) : (
            <div className="team-student-activity-list">
              {studentRecentEvents.map((event) => (
                <button key={event.id} type="button" onClick={() => changeTab('applications')}>
                  <span className="team-ops-dot" aria-hidden="true" />
                  <span>
                    <strong>{localizeAuditMessage(event.message, tx)}</strong>
                    <em>{auditActorLabel(event)} · {eventTime(event.time, lang)}</em>
                  </span>
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )

  const permissionRows = (): Array<{ role: TeamRole; visibility: string; action: string; audit: string }> => [
    {
      role: 'owner',
      visibility: tx('team.permissionOwnerVisibility'),
      action: tx('team.permissionOwnerAction'),
      audit: tx('team.permissionOwnerAudit'),
    },
    {
      role: 'admin',
      visibility: tx('team.permissionAdminVisibility'),
      action: tx('team.permissionAdminAction'),
      audit: tx('team.permissionAdminAudit'),
    },
    {
      role: 'member',
      visibility: tx('team.permissionMemberVisibility'),
      action: tx('team.permissionMemberAction'),
      audit: tx('team.permissionMemberAudit'),
    },
  ]

  const renderScopedPermissionPanel = (role: TeamRole) => {
    const row = permissionRows().find((item) => item.role === role)
    if (!row) return null
    const items = [
      { key: 'visibility', label: tx('team.permissionVisibility'), value: row.visibility, icon: <Users size={15} aria-hidden="true" /> },
      { key: 'action', label: tx('team.permissionAction'), value: row.action, icon: <Settings size={15} aria-hidden="true" /> },
      ...(role === 'owner'
        ? [{ key: 'audit', label: tx('team.permissionAudit'), value: row.audit, icon: <ShieldCheck size={15} aria-hidden="true" /> }]
        : []),
    ]
    return (
      <section className="team-panel team-scoped-permission-panel">
        <div className="team-panel-head">
          <div>
            <span className="eyebrow">{tx('team.permissionEyebrow')}</span>
            <h3>{tx('team.permissionTitle')}</h3>
          </div>
          <ShieldCheck size={16} aria-hidden="true" />
        </div>
        <div className="team-scoped-permission-grid">
          {items.map((item) => (
            <article key={item.key} className="team-scoped-permission-card">
              <span className="team-resource-icon">{item.icon}</span>
              <span>
                <em>{item.label}</em>
                <strong>{item.value}</strong>
              </span>
            </article>
          ))}
        </div>
      </section>
    )
  }

  const renderAiKeySettings = () => summary?.team ? (
    <AiKeyManager
      keys={aiKeys}
      scope="team"
      teamId={summary.team.id}
      canManage={viewerRole === 'owner'}
      copyPrefix="team"
      onCreate={onCreateAiKey}
      onUpdate={onUpdateAiKey}
      onDelete={onDeleteAiKey}
      onTest={onTestAiKey}
      onResetUsage={onResetAiKeyUsage}
      onNotify={onNotify}
    />
  ) : null

  const renderTeamProfilePresetSettings = () => (
    <section className="team-panel team-profile-preset-settings">
      <div className="team-panel-head">
        <div>
          <span className="eyebrow">{tx('team.profilePresetSettingsEyebrow')}</span>
          <h3>{tx('team.profilePresetSettingsTitle')}</h3>
        </div>
        <ProfilePresetIcon icon="file-text" color="blue" />
      </div>
      <div className="team-profile-preset-settings-row">
        <span>
          <strong>{format(tx('team.profilePresetSettingsCount'), { count: teamProfilePresets.length })}</strong>
          <em>{tx(viewerRole === 'owner' ? 'team.profilePresetSettingsOwnerDesc' : 'team.profilePresetSettingsTeacherDesc')}</em>
        </span>
        <div>
          <button type="button" className="quiet-action" onClick={() => changeTab('resources')}>
            <Pencil size={13} aria-hidden="true" /> {tx('team.profilePresetManage')}
          </button>
          <button type="button" className="quiet-action" disabled={teamPresetBusy} onClick={() => setConfirmRestoreTeamPresets(true)}>
            <RotateCcw size={13} aria-hidden="true" /> {tx('team.profilePresetRestore')}
          </button>
        </div>
      </div>
    </section>
  )

  const renderSettings = () => {
    if (viewerRole === 'admin') {
      return (
        <div className="team-tab-panel team-settings-page role-admin">
          <section className="team-panel team-settings-identity">
            <div className="team-panel-head">
              <div>
                <span className="eyebrow">{tx('team.settingsEyebrow')}</span>
                <h3>{tx('team.settingsTeacherTitle')}</h3>
              </div>
              <Settings size={16} aria-hidden="true" />
            </div>
            <div className="team-settings-person-card">
              <UserAvatar
                avatarUrl={session.user.settings.avatarDataUrl}
                name={session.user.name}
                email={session.user.email}
                className="team-member-avatar"
              />
              <div>
                <strong>{session.user.name}</strong>
                <em>{session.user.email}</em>
              </div>
              <span className="team-settings-role-chip">{tx(ROLE_LABEL_KEYS.admin)}</span>
            </div>
            <div className="team-settings-metrics">
              <span><strong>{supervisedStudents.length}</strong><em>{tx('team.teacherIdentityStudents')}</em></span>
              <span><strong>{teacherRiskApplications.length}</strong><em>{tx('team.teacherIdentityAttention')}</em></span>
              <span><strong>{teacherUpcomingApplications.length}</strong><em>{tx('team.teacherKpiDue')}</em></span>
              <span><strong>{teacherFeedbackTotal}</strong><em>{tx('team.teacherIdentityFeedback')}</em></span>
            </div>
            <div className="team-settings-actions">
              <button type="button" className="primary-action" disabled={!teacherPrimaryStudent || !onCreateApplication} onClick={() => onCreateApplication?.(teacherPrimaryStudent?.userId ?? null)}>
                <Plus size={13} aria-hidden="true" />
                {tx('team.teacherCreateApplication')}
              </button>
              <button type="button" className="quiet-action" onClick={() => changeTab('members')}>
                <Users size={13} aria-hidden="true" />
                {tx('team.teacherOpenStudents')}
              </button>
              <button type="button" className="quiet-action" onClick={() => changeTab('applications')}>
                <FileText size={13} aria-hidden="true" />
                {tx('team.tabTeacherApps')}
              </button>
            </div>
          </section>

          <section className="team-panel">
            <div className="team-panel-head">
              <div>
                <span className="eyebrow">{tx('team.settingsScopeEyebrow')}</span>
                <h3>{tx('team.settingsTeacherScopeTitle')}</h3>
              </div>
              <Users size={16} aria-hidden="true" />
            </div>
            {supervisedStudentRows.length === 0 ? (
              <div className="team-empty compact">
                <span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span>
                <div>
                  <h3>{tx('team.teacherNoStudents')}</h3>
                  <p>{tx('team.teacherNoStudentsDesc')}</p>
                </div>
              </div>
            ) : (
              <div className="team-settings-scope-list">
                {supervisedStudentRows.slice(0, 6).map((row) => (
                  <button key={row.member.id} type="button" onClick={() => {
                    if (row.member.userId) setTeacherStudentFilter(row.member.userId)
                    changeTab('applications')
                  }}>
                    <TeamMemberAvatar member={row.member} />
                    <span>
                      <strong>{memberDisplayName(row.member, tx('team.memberFallback'))}</strong>
                      <em>{format(tx('team.settingsStudentScopeMeta'), {
                        applications: row.applications.length,
                        progress: row.averageProgress,
                      })}</em>
                    </span>
                    <span className={`team-student-state-chip state-${row.state}`}>{tx(studentStateLabelKey(row.state))}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="team-panel">
            <div className="team-panel-head">
              <div>
                <span className="eyebrow">{tx('team.teacherContactsEyebrow')}</span>
                <h3>{tx('team.teacherContactsTitle')}</h3>
              </div>
              <Mail size={16} aria-hidden="true" />
            </div>
            <div className="team-contact-list">
              {teamContacts.length > 0 ? teamContacts.map(renderTeamContactCard) : (
                <div className="team-empty compact">
                  <span className="empty-state-icon"><Mail size={18} aria-hidden="true" /></span>
                  <div>
                    <h3>{tx('team.teacherNoContacts')}</h3>
                    <p>{tx('team.teacherNoContactsDesc')}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {renderTeamProfilePresetSettings()}
          {renderAiKeySettings()}
          {renderScopedPermissionPanel('admin')}
        </div>
      )
    }

    if (viewerRole === 'member') {
      const studentPendingTransferRequests = pendingTransferRequests.filter((request) => request.ownerId === session.user.id)
      return (
        <div className="team-tab-panel team-settings-page role-member">
          <section className="team-panel team-settings-identity">
            <div className="team-panel-head">
              <div>
                <span className="eyebrow">{tx('team.settingsEyebrow')}</span>
                <h3>{tx('team.settingsStudentTitle')}</h3>
              </div>
              <Settings size={16} aria-hidden="true" />
            </div>
            <div className="team-settings-person-card">
              <UserAvatar
                avatarUrl={session.user.settings.avatarDataUrl}
                name={session.user.name}
                email={session.user.email}
                className="team-member-avatar"
              />
              <div>
                <strong>{session.user.name}</strong>
                <em>{session.user.email}</em>
              </div>
              <span className="team-settings-role-chip">{tx(ROLE_LABEL_KEYS.member)}</span>
            </div>
            <div className="team-settings-metrics">
              <span><strong>{applications.length}</strong><em>{tx('team.settingsMetricSharedApps')}</em></span>
              <span><strong>{studentFeedbackCount}</strong><em>{tx('team.metricFeedback')}</em></span>
              <span><strong>{studentPendingTransferRequests.length}</strong><em>{tx('team.studentPendingRequestsTitle')}</em></span>
            </div>
          </section>

          <section className="team-panel">
            <div className="team-panel-head">
              <div>
                <span className="eyebrow">{tx('team.studentAdvisorSubtitle')}</span>
                <h3>{tx('team.settingsStudentAdvisorTitle')}</h3>
              </div>
              <Mail size={16} aria-hidden="true" />
            </div>
            {renderAssignedTeacherContacts()}
            <div className="team-settings-actions">
              <button type="button" className="primary-action" onClick={() => changeTab('applications')}>
                <FileText size={13} aria-hidden="true" />
                {tx('team.studentOpenSharedApps')}
              </button>
              <button type="button" className="quiet-action" onClick={() => changeTab('resources')}>
                <ShieldCheck size={13} aria-hidden="true" />
                {tx('team.studentPendingRequestsTitle')}
              </button>
            </div>
          </section>

          <section className="team-panel team-student-capability-panel">
            <div className="team-panel-head">
              <div>
                <span className="eyebrow">{tx('team.studentCapabilityEyebrow')}</span>
                <h3>{tx('team.studentCapabilityTitle')}</h3>
              </div>
              <ShieldCheck size={16} aria-hidden="true" />
            </div>
            <div className="team-student-capability-grid">
              <button type="button" onClick={() => changeTab('applications')}>
                <span className="team-resource-icon"><FileText size={16} aria-hidden="true" /></span>
                <span>
                  <strong>{tx('team.studentCapabilityApps')}</strong>
                  <em>{format(tx('team.studentCapabilityAppsDesc'), { count: applications.length })}</em>
                </span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onCreateApplication?.(null)} disabled={!onCreateApplication}>
                <span className="team-resource-icon"><Plus size={16} aria-hidden="true" /></span>
                <span>
                  <strong>{tx('team.studentCapabilityCreate')}</strong>
                  <em>{format(tx('team.studentCapabilityCreateDesc'), { count: studentPendingTransferRequests.length })}</em>
                </span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => changeTab('resources')}>
                <span className="team-resource-icon"><ShieldCheck size={16} aria-hidden="true" /></span>
                <span>
                  <strong>{tx('team.studentPendingRequestsTitle')}</strong>
                  <em>{format(tx('team.studentPendingRequestsMeta'), { count: studentPendingTransferRequests.length })}</em>
                </span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </div>
          </section>

          {renderAiKeySettings()}
          {renderScopedPermissionPanel('member')}
        </div>
      )
    }

    const quotaRows = [
      {
        id: 'storage',
        label: tx('team.capacityStorage'),
        value: teamCapacity
          ? `${formatBytes(teamCapacity.storageUsedBytes, lang)} / ${formatBytes(teamCapacity.storageQuotaBytes, lang)}`
          : '-',
      },
      {
        id: 'teachers',
        label: tx('team.capacityTeachers'),
        value: teamCapacity ? `${teamCapacity.teacherSeatsUsed} / ${teamCapacity.teacherSeatLimit}` : '-',
      },
      {
        id: 'students',
        label: tx('team.capacityStudents'),
        value: teamCapacity ? `${teamCapacity.studentSeatsUsed} / ${teamCapacity.studentSeatLimit}` : '-',
      },
      {
        id: 'shares',
        label: tx('team.capacityActiveLinks'),
        value: teamCapacity
          ? `${teamCapacity.activeShareCount} / ${teamCapacity.activeShareLimit.toLocaleString(localeForLanguage(lang))}`
          : '-',
      },
      {
        id: 'created-shares',
        label: tx('team.capacityCreatedLinks'),
        value: teamCapacity?.shareCreateQuota == null
          ? tx('team.capacityUnlimited')
          : teamCapacity.shareCreateQuota.toLocaleString(localeForLanguage(lang)),
      },
    ]
    const settingsSections = [
      { id: 'identity' as const, label: tx('team.settingsOrganizationName'), icon: Pencil },
      { id: 'quota' as const, label: tx('team.settingsQuotaTitle'), icon: Database },
      { id: 'key' as const, label: tx('team.ai.teamTitle'), icon: KeyRound },
    ]

    return (
      <div className="team-tab-panel team-settings-page role-owner team-organization-settings">
        <header className="team-organization-settings-hero">
          <h2>{tx('team.settingsOwnerTitle')}</h2>
        </header>

        <div className="team-organization-settings-layout">
          <aside className="team-organization-settings-index">
            <nav aria-label={tx('team.settingsOwnerTitle')}>
              <span className="team-organization-settings-index-label">{tx('team.settingsOwnerTitle')}</span>
              {settingsSections.map((item) => {
                const Icon = item.icon
                const active = organizationSettingsSection === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? 'active' : ''}
                    aria-current={active ? 'location' : undefined}
                    onClick={() => openOrganizationSettingsSection(item.id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="team-organization-settings-body">
            <section
              id="team-organization-settings-identity"
              className="team-organization-settings-section"
              aria-labelledby="team-organization-settings-identity-title"
            >
              <div className="section-title team-organization-settings-title">
                <h4 id="team-organization-settings-identity-title">
                  <Pencil size={13} aria-hidden="true" />
                  {tx('team.settingsOrganizationName')}
                </h4>
              </div>
              <div className="team-organization-settings-group">
                {renaming ? (
                  <form
                    className="team-organization-name-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void handleRename()
                    }}
                  >
                    <label>
                      <span className="sr-only">{tx('team.settingsOrganizationName')}</span>
                      <input
                        value={teamName}
                        onChange={(event) => setTeamName(event.target.value)}
                        maxLength={120}
                        autoFocus
                      />
                    </label>
                    <div className="team-organization-name-actions">
                      <button type="submit" className="primary-action" disabled={!teamName.trim()}>
                        <Check size={13} aria-hidden="true" />
                        {tx('team.settingsSaveRename')}
                      </button>
                      <button
                        type="button"
                        className="quiet-action"
                        onClick={() => {
                          setRenaming(false)
                          setTeamName(summary?.team.name ?? '')
                        }}
                      >
                        <X size={13} aria-hidden="true" />
                        {tx('cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="team-organization-name-row">
                    <strong>{summary?.team.name ?? screenTitle}</strong>
                    <button type="button" className="quiet-action" onClick={() => setRenaming(true)}>
                      <Pencil size={13} aria-hidden="true" />
                      {tx('team.settingsEditTeamName')}
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section
              id="team-organization-settings-quota"
              className="team-organization-settings-section"
              aria-labelledby="team-organization-settings-quota-title"
            >
              <div className="section-title team-organization-settings-title">
                <h4 id="team-organization-settings-quota-title">
                  <Database size={13} aria-hidden="true" />
                  {tx('team.settingsQuotaTitle')}
                </h4>
              </div>
              <div className="team-organization-settings-group team-organization-quota-list" role="list">
                {quotaRows.map((row) => (
                  <div key={row.id} className="team-organization-quota-row" role="listitem">
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section
              id="team-organization-settings-key"
              className="team-organization-settings-section team-organization-settings-key"
            >
              {renderAiKeySettings()}
            </section>
          </div>
        </div>
      </div>
    )
  }

  const renderOwnerOverview = () => {
    const actionableFocusItems: Array<{
      key: OwnerOverviewFocusKey
      show: boolean
      tone: 'attention' | 'resource' | 'student' | 'invite' | 'steady'
      icon: ReactNode
      title: string
      desc: string
      count: number
      action: () => void
    }> = [
      {
        key: 'transfers' as const,
        show: pendingTransferRequests.length > 0,
        tone: 'attention',
        icon: <GitMerge size={15} aria-hidden="true" />,
        title: format(tx('team.overviewFocusTransfersTitle'), { count: pendingTransferRequests.length }),
        desc: tx('team.overviewFocusTransfersDesc'),
        count: pendingTransferRequests.length,
        action: () => changeTab('audit'),
      },
      {
        key: 'risk' as const,
        show: riskApps + watchApps > 0,
        tone: 'attention',
        icon: <AlertTriangle size={15} aria-hidden="true" />,
        title: format(tx('team.overviewFocusApplicationsTitle'), { count: riskApps + watchApps }),
        desc: tx('team.overviewFocusApplicationsDesc'),
        count: riskApps + watchApps,
        action: () => changeTab('applications'),
      },
      {
        key: 'resources' as const,
        show: resourceAlerts.length > 0,
        tone: 'resource',
        icon: <Database size={15} aria-hidden="true" />,
        title: format(tx('team.overviewFocusResourcesTitle'), { count: resourceAlerts.length }),
        desc: resourceAlerts[0] || tx('team.overviewFocusResourcesDesc'),
        count: resourceAlerts.length,
        action: () => changeTab('resources'),
      },
      {
        key: 'students' as const,
        show: studentsWithoutApplications.length > 0,
        tone: 'student',
        icon: <Users size={15} aria-hidden="true" />,
        title: format(tx('team.overviewFocusStudentsTitle'), { count: studentsWithoutApplications.length }),
        desc: tx('team.overviewFocusStudentsDesc'),
        count: studentsWithoutApplications.length,
        action: () => changeTab('members'),
      },
      {
        key: 'invites' as const,
        show: pendingMembers.length > 0,
        tone: 'invite',
        icon: <Mail size={15} aria-hidden="true" />,
        title: format(tx('team.overviewFocusInvitesTitle'), { count: pendingMembers.length }),
        desc: tx('team.overviewFocusInvitesDesc'),
        count: pendingMembers.length,
        action: () => changeTab('members'),
      },
    ]
    const visibleFocusItems = actionableFocusItems.filter((item) => item.show).slice(0, 5)
    const focusItems = visibleFocusItems.length > 0 ? visibleFocusItems : [{
      key: 'steady' as const,
      show: true,
      tone: 'steady' as const,
      icon: <Check size={15} aria-hidden="true" />,
      title: tx('team.overviewFocusClearTitle'),
      desc: tx('team.overviewFocusClearDesc'),
      count: 0,
      action: () => changeTab('applications'),
    }]
    const selectedFocus = focusItems.find((item) => item.key === ownerOverviewFocusKey) ?? focusItems[0]!
    const selectedIndex = Math.max(0, focusItems.findIndex((item) => item.key === selectedFocus.key))
    const priorityFocus = priorityApplications.find((item) => item.health === 'risk' || item.health === 'watch')
      ?? priorityApplications[0]
      ?? null
    const firstTransfer = pendingTransferRequests[0] ?? null
    const firstStudent = studentsWithoutApplications[0] ?? null
    const firstInvite = pendingMembers[0] ?? null

    const detail: OverviewDetailModel = (() => {
      if (selectedFocus.key === 'risk' && priorityFocus) {
        const { application, due } = priorityFocus
        return {
          icon: <AlertTriangle size={17} aria-hidden="true" />,
          eyebrow: tx('team.applicationHealthEyebrow'),
          title: application.school.name,
          subtitle: `${application.ownerName ? `${application.ownerName} · ` : ''}${application.program}`,
          description: selectedFocus.desc,
          progress: application.progress,
          metrics: [
            { label: tx('team.metricProgress'), value: `${application.progress}%` },
            {
              label: tx('team.metricDue'),
              value: due >= 0
                ? format(tx('workspace.dayShort'), { count: due })
                : format(tx('workspace.daysPast'), { count: Math.abs(due) }),
              tone: due < 0 || due <= 14 ? 'attention' : undefined,
            },
            { label: tx('team.currentRole'), value: localizeStatusLabel(application.status, tx) },
          ],
          primaryLabel: tx('team.transferOpenApplication'),
          onPrimary: () => onOpenApplication ? onOpenApplication(application.id) : changeTab('applications'),
          secondaryLabel: tx('team.viewApplicationsEmpty'),
          onSecondary: () => changeTab('applications'),
        }
      }

      if (selectedFocus.key === 'transfers' && firstTransfer) {
        return {
          icon: <GitMerge size={17} aria-hidden="true" />,
          eyebrow: tx('team.transferQueueEyebrow'),
          title: firstTransfer.applicationName,
          subtitle: `${firstTransfer.ownerName || firstTransfer.ownerEmail || tx('team.memberFallback')} · ${firstTransfer.program}`,
          description: format(
            tx(firstTransfer.direction === 'join' ? 'team.transferDirectionJoin' : 'team.transferDirectionLeave'),
            { student: firstTransfer.ownerName || firstTransfer.ownerEmail || tx('team.memberFallback') },
          ),
          metrics: [
            {
              label: tx('team.overviewScopeTitle'),
              value: firstTransfer.direction === 'join' ? tx('team.transferOrganizationSpace') : tx('team.transferPersonalSpace'),
            },
            { label: tx('team.detailLastActivity'), value: formatMemberDate(firstTransfer.requestedAt, lang) },
            { label: tx('team.heroMetricPending'), value: pendingTransferRequests.length, tone: 'attention' },
          ],
          primaryLabel: tx('team.transferQueueEyebrow'),
          onPrimary: () => changeTab('audit'),
          secondaryLabel: applicationsById.has(firstTransfer.applicationId) ? tx('team.transferOpenApplication') : undefined,
          onSecondary: applicationsById.has(firstTransfer.applicationId)
            ? () => onOpenApplication?.(firstTransfer.applicationId)
            : undefined,
        }
      }

      if (selectedFocus.key === 'resources') {
        return {
          icon: <Database size={17} aria-hidden="true" />,
          eyebrow: tx('team.tabResources'),
          title: summary?.team.name ?? screenTitle,
          subtitle: resourceAlerts[0] || tx('team.overviewFocusResourcesDesc'),
          description: format(tx('team.overviewPortalResourcesDesc'), { count: resourceAlerts.length }),
          progress: Math.max(storagePercent, teamStats.seatPercent),
          metrics: [
            { label: tx('team.detailStorage'), value: `${storagePercent}%`, tone: storagePercent >= 85 ? 'attention' : undefined },
            { label: tx('team.seatsTitle'), value: `${teamStats.active}/${teamStats.limit}`, tone: teamStats.seatPercent >= 80 ? 'attention' : undefined },
            { label: tx('team.detailLinks'), value: teamCapacity?.activeShareCount ?? 0 },
          ],
          primaryLabel: tx('team.tabResources'),
          onPrimary: () => changeTab('resources'),
        }
      }

      if (selectedFocus.key === 'students' && firstStudent) {
        return {
          icon: <Users size={17} aria-hidden="true" />,
          eyebrow: tx('team.membersEyebrow'),
          title: memberDisplayName(firstStudent, tx('team.memberFallback')),
          subtitle: memberEmail(firstStudent) || tx('team.noLinkedEmail'),
          description: tx('team.overviewFocusStudentsDesc'),
          metrics: [
            { label: tx('team.metricApplications'), value: 0, tone: 'attention' },
            { label: tx('team.overviewScopeStudents'), value: activeStudents },
            { label: tx('team.overviewScopeTeachers'), value: activeTeachers },
          ],
          primaryLabel: tx('team.teacherOpenStudents'),
          onPrimary: () => changeTab('members'),
          secondaryLabel: firstStudent.userId && onCreateApplication ? tx('team.teacherCreateForStudent') : undefined,
          onSecondary: firstStudent.userId && onCreateApplication
            ? () => onCreateApplication(firstStudent.userId)
            : undefined,
        }
      }

      if (selectedFocus.key === 'invites' && firstInvite) {
        return {
          icon: <Mail size={17} aria-hidden="true" />,
          eyebrow: tx('team.pendingInvites'),
          title: memberDisplayName(firstInvite, tx('team.memberFallback')),
          subtitle: memberEmail(firstInvite) || tx('team.noLinkedEmail'),
          description: tx('team.overviewFocusInvitesDesc'),
          metrics: [
            { label: tx('team.heroMetricPending'), value: pendingMembers.length, tone: 'attention' },
            { label: tx('team.currentRole'), value: tx(ROLE_LABEL_KEYS[firstInvite.role]) },
            { label: tx('team.activeMembers'), value: teamStats.active },
          ],
          primaryLabel: tx('team.tabMembers'),
          onPrimary: () => changeTab('members'),
        }
      }

      return {
        icon: <Check size={17} aria-hidden="true" />,
        eyebrow: tx('team.overviewFocusEyebrow'),
        title: tx('team.overviewFocusClearTitle'),
        subtitle: summary?.team.name ?? screenTitle,
        description: tx('team.overviewFocusClearDesc'),
        progress: applications.length > 0
          ? Math.round(applications.reduce((sum, application) => sum + application.progress, 0) / applications.length)
          : 100,
        metrics: [
          { label: tx('team.overviewScopeApplications'), value: applications.length },
          { label: tx('team.overviewScopeMembers'), value: teamStats.active },
          { label: tx('team.heroMetricAttention'), value: riskApps + watchApps, tone: 'positive' },
        ],
        primaryLabel: tx('team.viewApplicationsEmpty'),
        onPrimary: () => changeTab('applications'),
      }
    })()

    return (
      <div className="team-tab-panel team-overview-redesign role-owner">
        <section className="team-overview-workbench">
          <header className="team-overview-workbench-head">
            <span>
              <span className="eyebrow">{tx('team.overviewFocusEyebrow')}</span>
              <h3>{tx('team.overviewFocusTitle')}</h3>
              <p>{tx('team.overviewFocusDesc')}</p>
            </span>
            <span className="team-overview-attention-count">
              <strong>{visibleFocusItems.reduce((sum, item) => sum + item.count, 0)}</strong>
              <em>{tx('team.heroMetricAttention')}</em>
            </span>
          </header>

          <div className="team-overview-stage">
            <div className="team-overview-queue">
              <div
                className="team-overview-queue-list"
                style={{ '--team-overview-selected-index': selectedIndex } as CSSProperties}
                aria-label={tx('team.overviewFocusTitle')}
              >
                <span className="team-overview-queue-slider" aria-hidden="true" />
                {focusItems.map((item, index) => {
                  const selected = item.key === selectedFocus.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`team-overview-queue-item tone-${item.tone}${selected ? ' is-selected' : ''}`}
                      style={{ '--team-overview-item-index': index } as CSSProperties}
                      aria-pressed={selected}
                      onClick={() => setOwnerOverviewFocusKey(item.key)}
                    >
                      <span className="team-overview-queue-icon">{item.icon}</span>
                      <span>
                        <strong>{item.title}</strong>
                        <em>{item.desc}</em>
                      </span>
                      <small>{item.count}</small>
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
              <button type="button" className="team-overview-queue-footer" onClick={selectedFocus.action}>
                <span>{tx('team.overviewScopeTitle')}</span>
                <strong>{summary?.team.name ?? screenTitle}</strong>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </div>

            <section className="team-overview-preview" aria-live="polite">
              <div key={selectedFocus.key} className="team-overview-preview-content">
                <header className="team-overview-preview-head">
                  <span className={`team-overview-preview-icon tone-${selectedFocus.tone}`}>{detail.icon}</span>
                  <span>
                    <span className="eyebrow">{detail.eyebrow}</span>
                    <h4>{detail.title}</h4>
                    <p>{detail.subtitle}</p>
                  </span>
                </header>

                <div className="team-overview-preview-metrics">
                  {detail.metrics.map((metric) => (
                    <span key={metric.label} className={metric.tone ? `is-${metric.tone}` : ''}>
                      <strong>{metric.value}</strong>
                      <em>{metric.label}</em>
                    </span>
                  ))}
                </div>

                {typeof detail.progress === 'number' ? (
                  <div className="team-overview-progress-row">
                    <span>
                      <em>{tx('team.metricProgress')}</em>
                      <strong>{detail.progress}%</strong>
                    </span>
                    <i aria-hidden="true">
                      <span style={{ '--team-overview-progress': detail.progress / 100 } as CSSProperties} />
                    </i>
                  </div>
                ) : null}

                <div className="team-overview-preview-summary">
                  <span>
                    <em>{tx('team.nextActionsEyebrow')}</em>
                    <p>{detail.description}</p>
                  </span>
                  <div>
                    <button type="button" className="primary-action" onClick={detail.onPrimary}>
                      {detail.primaryLabel}
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                    {detail.secondaryLabel && detail.onSecondary ? (
                      <button type="button" className="quiet-action" onClick={detail.onSecondary}>
                        {detail.secondaryLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>

        {renderOverviewDock([
          {
            key: 'applications',
            icon: <FileText size={16} aria-hidden="true" />,
            label: tx('team.overviewPortalApplicationsTitle'),
            count: applications.length,
            action: () => changeTab('applications'),
          },
          {
            key: 'members',
            icon: <Users size={16} aria-hidden="true" />,
            label: tx('team.overviewPortalMembersTitle'),
            count: summary?.members.length ?? 0,
            action: () => changeTab('members'),
          },
          {
            key: 'resources',
            icon: <Database size={16} aria-hidden="true" />,
            label: tx('team.overviewPortalResourcesTitle'),
            count: resourceAlerts.length,
            action: () => changeTab('resources'),
          },
          {
            key: 'discover',
            icon: <Compass size={16} aria-hidden="true" />,
            label: tx('team.tabDiscover'),
            action: () => changeTab('discover'),
          },
          {
            key: 'audit',
            icon: <History size={16} aria-hidden="true" />,
            label: tx('team.tabAudit'),
            count: pendingTransferRequests.length,
            action: () => changeTab('audit'),
          },
        ])}

        {renderOverviewMore(
          tx('team.overviewMoreDesc'),
          <div className="team-overview-more-content">
            <div className={`team-overview-more-tabs is-${ownerOverviewDetailView}`} role="tablist" aria-label={tx('team.overviewDetailsEyebrow')}>
              <span aria-hidden="true" />
              <button
                type="button"
                role="tab"
                aria-selected={ownerOverviewDetailView === 'priority'}
                onClick={() => setOwnerOverviewDetailView('priority')}
              >
                <Target size={13} aria-hidden="true" />
                {tx('team.priorityQueueTitle')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={ownerOverviewDetailView === 'students'}
                onClick={() => setOwnerOverviewDetailView('students')}
              >
                <Users size={13} aria-hidden="true" />
                {tx('team.opsStudentsNoApps')}
              </button>
            </div>

            {ownerOverviewDetailView === 'priority' ? (
              priorityApplications.length === 0 ? (
                <div className="team-overview-empty compact">
                  <span className="empty-state-icon"><Check size={18} aria-hidden="true" /></span>
                  <span>
                    <strong>{tx('team.priorityQueueEmpty')}</strong>
                    <em>{tx('team.priorityQueueEmptyDesc')}</em>
                  </span>
                </div>
              ) : (
                <div className="team-overview-detail-list" role="tabpanel">
                  {priorityApplications.slice(0, 6).map(({ application, due, health }) => (
                    <button key={application.id} type="button" onClick={() => onOpenApplication?.(application.id)}>
                      <span className={`team-overview-detail-marker health-${health}`} aria-hidden="true" />
                      <span>
                        <strong>{application.school.name}</strong>
                        <em>{application.ownerName ? `${application.ownerName} · ` : ''}{application.program}</em>
                      </span>
                      <small>{application.progress}%</small>
                      <small>
                        {due >= 0
                          ? format(tx('workspace.dayShort'), { count: due })
                          : format(tx('workspace.daysPast'), { count: Math.abs(due) })}
                      </small>
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )
            ) : studentsWithoutApplications.length === 0 ? (
              <div className="team-overview-empty compact">
                <span className="empty-state-icon"><Check size={18} aria-hidden="true" /></span>
                <span>
                  <strong>{tx('team.opsStudentsClear')}</strong>
                  <em>{tx('team.overviewFocusClearDesc')}</em>
                </span>
              </div>
            ) : (
              <div className="team-overview-detail-list people" role="tabpanel">
                {studentsWithoutApplications.slice(0, 6).map((member) => (
                  <button key={member.id} type="button" onClick={() => changeTab('members')}>
                    <TeamMemberAvatar member={member} className="team-overview-student-avatar" />
                    <span>
                      <strong>{memberDisplayName(member, tx('team.memberFallback'))}</strong>
                      <em>{memberEmail(member) || tx('team.noLinkedEmail')}</em>
                    </span>
                    <small>{tx('team.teacherKpiMissing')}</small>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>,
        )}
      </div>
    )
  }

  const renderOverview = () => (
    viewerRole === 'admin' ? renderTeacherOverview() : viewerRole === 'member' ? renderStudentOverview() : renderOwnerOverview()
  )

  const renderApplicationCard = (application: TeamApplicationRecord) => {
    const health = applicationHealth(application)
    const due = daysUntil(application.deadline)
    const commentCount = countReviewComments(application.reviewComments)
    return (
      <button
        type="button"
        key={application.id}
        className={`team-application-mini health-${health}`}
        onClick={() => onOpenApplication?.(application.id)}
        onContextMenu={(event) => openApplicationContextMenu(event, application)}
      >
        <span>
          <strong>{application.school.name}</strong>
          <em>{application.program} · {application.professor.english}</em>
        </span>
        <StatusPill status={application.status} />
        <small>{tx(healthLabelKey(health))}</small>
        <small>{format(tx('team.commentsCount'), { count: commentCount })}</small>
        <small>{due >= 0 ? format(tx('workspace.dayShort'), { count: due }) : format(tx('workspace.daysPast'), { count: Math.abs(due) })}</small>
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    )
  }

  const applicationDueLabel = (application: ApplicationRecord) => {
    const due = daysUntil(application.deadline)
    if (due === 0) return tx('team.applicationDueToday')
    return due > 0
      ? format(tx('workspace.dayShort'), { count: due })
      : format(tx('workspace.daysPast'), { count: Math.abs(due) })
  }

  const actionIconForTone = (tone: string) => {
    if (tone === 'feedback') return <MessageSquare size={15} aria-hidden="true" />
    if (tone === 'due') return <CalendarDays size={15} aria-hidden="true" />
    if (tone === 'steady') return <Check size={15} aria-hidden="true" />
    return <AlertTriangle size={15} aria-hidden="true" />
  }

  const teacherNextAction = (row: typeof supervisedStudentRows[number]) => {
    const riskApplication = row.applications
      .filter((application) => {
        const health = applicationHealth(application)
        return health === 'risk' || health === 'watch'
      })
      .sort((a, b) => a.deadline.localeCompare(b.deadline))[0]
    const dueApplication = row.applications
      .filter((application) => {
        const due = daysUntil(application.deadline)
        return due >= 0 && due <= 30
      })
      .sort((a, b) => a.deadline.localeCompare(b.deadline))[0]
    const feedbackApplication = row.applications
      .find((application) => countReviewComments(application.reviewComments) > 0)
    const firstApplication = riskApplication ?? dueApplication ?? feedbackApplication ?? row.applications[0] ?? null

    if (row.applications.length === 0) {
      return {
        tone: 'missing',
        title: tx('team.teacherActionCreateFirstTitle'),
        desc: tx('team.teacherActionCreateFirstDesc'),
        application: null,
        cta: tx('team.teacherActionCreateFirstCta'),
      }
    }
    if (riskApplication) {
      return {
        tone: 'risk',
        title: format(tx('team.teacherActionRiskTitle'), { school: riskApplication.school.name }),
        desc: format(tx('team.teacherActionRiskDesc'), {
          progress: riskApplication.progress,
          due: applicationDueLabel(riskApplication),
        }),
        application: riskApplication,
        cta: tx('team.teacherActionOpenApplication'),
      }
    }
    if (dueApplication) {
      return {
        tone: 'due',
        title: format(tx('team.teacherActionDueTitle'), { school: dueApplication.school.name }),
        desc: format(tx('team.teacherActionDueDesc'), { due: applicationDueLabel(dueApplication) }),
        application: dueApplication,
        cta: tx('team.teacherActionOpenApplication'),
      }
    }
    if (feedbackApplication) {
      return {
        tone: 'feedback',
        title: format(tx('team.teacherActionFeedbackTitle'), { school: feedbackApplication.school.name }),
        desc: format(tx('team.teacherActionFeedbackDesc'), { count: countReviewComments(feedbackApplication.reviewComments) }),
        application: feedbackApplication,
        cta: tx('team.teacherActionOpenApplication'),
      }
    }
    return {
      tone: 'steady',
      title: tx('team.teacherActionSteadyTitle'),
      desc: format(tx('team.teacherActionSteadyDesc'), { count: row.applications.length }),
      application: firstApplication,
      cta: tx('team.teacherActionOpenApplication'),
    }
  }

  const renderTeacherNextAction = (row: typeof supervisedStudentRows[number]) => {
    const action = teacherNextAction(row)
    return (
      <div className={`team-student-next-action tone-${action.tone}`}>
        <span className="team-student-next-icon">{actionIconForTone(action.tone)}</span>
        <span>
          <strong>{action.title}</strong>
          <em>{action.desc}</em>
        </span>
        {action.application ? (
          <button type="button" className="quiet-action compact-action" onClick={() => onOpenApplication?.(action.application!.id)}>
            <ArrowRight size={12} aria-hidden="true" />
            {action.cta}
          </button>
        ) : row.member.userId && onCreateApplication ? (
          <button type="button" className="quiet-action compact-action" onClick={() => onCreateApplication(row.member.userId)}>
            <Plus size={12} aria-hidden="true" />
            {action.cta}
          </button>
        ) : null}
      </div>
    )
  }

  const renderTeacherStudentFocus = (row: typeof supervisedStudentRows[number]) => {
    const advisors = studentTeachersFor(row.member)
    const nextAction = teacherNextAction(row)
    return (
      <section className={`team-student-focus-card tone-${nextAction.tone}`}>
        <div className="team-student-focus-main">
          <TeamMemberAvatar member={row.member} />
          <span>
            <strong>{memberDisplayName(row.member, tx('team.memberFallback'))}</strong>
            <em>{format(tx('team.teacherFocusSubtitle'), {
              email: memberEmail(row.member) || tx('team.noLinkedEmail'),
              teacher: advisors.length
                ? advisors.map((advisor) => memberDisplayName(advisor, tx('team.memberFallback'))).join(' · ')
                : session.user.name,
            })}</em>
          </span>
          <span className={`team-student-state-chip state-${row.state}`}>{tx(studentStateLabelKey(row.state))}</span>
        </div>
        <div className="team-student-focus-metrics">
          <span><strong>{row.applications.length}</strong><em>{tx('team.metricApplications')}</em></span>
          <span><strong>{row.averageProgress}%</strong><em>{tx('team.metricProgress')}</em></span>
          <span><strong>{row.riskCount + row.watchCount}</strong><em>{tx('team.metricRisk')}</em></span>
          <span><strong>{row.dueSoonCount}</strong><em>{tx('team.metricDue')}</em></span>
          <span><strong>{row.feedbackCount}</strong><em>{tx('team.metricFeedback')}</em></span>
        </div>
        {renderTeacherNextAction(row)}
      </section>
    )
  }

  const renderStudentActionPlan = () => (
    <section className="team-action-plan">
      <div className="team-action-plan-head">
        <span>
          <strong>{tx('team.studentActionPlanTitle')}</strong>
          <em>{assignedTeachers.length
            ? format(tx('team.studentActionPlanDesc'), {
                teacher: assignedTeachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · '),
              })
            : tx('team.studentActionPlanNoTeacher')}</em>
        </span>
        <Target size={16} aria-hidden="true" />
      </div>
      {studentActionItems.length === 0 ? (
        <div className="team-action-plan-empty">
          <Check size={16} aria-hidden="true" />
          <span>
            <strong>{tx('team.studentActionPlanEmpty')}</strong>
            <em>{tx('team.studentActionPlanEmptyDesc')}</em>
          </span>
        </div>
      ) : (
        <div className="team-action-list">
          {studentActionItems.map((item) => (
            <button key={item.key} type="button" className={`team-action-item tone-${item.tone}`} onClick={() => onOpenApplication?.(item.application.id)}>
              <span className="team-student-next-icon">{actionIconForTone(item.tone)}</span>
              <span>
                <strong>{format(tx(item.titleKey), { school: item.application.school.name })}</strong>
                <em>{format(tx(item.descKey), {
                  count: item.count,
                  due: applicationDueLabel(item.application),
                  progress: item.application.progress,
                  status: localizeStatusLabel(item.application.status, tx),
                })}</em>
              </span>
              <small>{applicationDueLabel(item.application)}</small>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  )

  const renderTeacherApplicationRow = (row: typeof teacherApplicationRows[number]) => {
    const displayName = memberDisplayName(row.member, tx('team.memberFallback'))
    const email = memberEmail(row.member)
    return (
      <article key={row.member.id} className={`team-teacher-app-card state-${row.state}`}>
        <div className="team-teacher-app-head">
          <div className="team-teacher-app-person">
            <TeamMemberAvatar member={row.member} />
            <span>
              <strong>{displayName}</strong>
              <em>{email || tx('team.noLinkedEmail')}</em>
            </span>
            <span className={`team-student-state-chip state-${row.state}`}>{tx(studentStateLabelKey(row.state))}</span>
          </div>
          <div className="team-teacher-app-actions">
            {row.member.userId && onCreateApplication ? (
              <button type="button" className="quiet-action compact-action" onClick={() => onCreateApplication(row.member.userId)}>
                <Plus size={12} aria-hidden="true" />
                {tx('team.teacherCreateForStudent')}
              </button>
            ) : null}
            {row.member.userId && onViewApplications ? (
              <button type="button" className="quiet-action compact-action" onClick={() => onViewApplications(row.member.userId!)}>
                <FolderOpen size={12} aria-hidden="true" />
                {tx('team.viewApplicationsEmpty')}
              </button>
            ) : null}
            {memberCanEnterView(row.member) ? (
              <button type="button" className="quiet-action compact-action" onClick={() => onImpersonateMember?.(row.member.userId!)}>
                <LogIn size={12} aria-hidden="true" />
                {tx('team.enterStudentView')}
              </button>
            ) : null}
          </div>
        </div>
        <div className="team-teacher-app-metrics">
          <span><strong>{row.applications.length}</strong><em>{tx('team.metricApplications')}</em></span>
          <span><strong>{row.visibleApplications.length}</strong><em>{tx('team.teacherVisibleAfterFilter')}</em></span>
          <span><strong>{row.averageProgress}%</strong><em>{tx('team.metricProgress')}</em></span>
          <span><strong>{row.riskCount + row.watchCount}</strong><em>{tx('team.metricRisk')}</em></span>
          <span><strong>{row.dueSoonCount}</strong><em>{tx('team.metricDue')}</em></span>
          <span><strong>{row.feedbackCount}</strong><em>{tx('team.metricFeedback')}</em></span>
        </div>
        {renderTeacherNextAction(row)}
        {row.visibleApplications.length === 0 ? (
          <div className="team-teacher-app-empty">
            <FileText size={15} aria-hidden="true" />
            <span>
              <strong>{row.applications.length === 0 ? tx('team.teacherStudentNoApplications') : tx('team.teacherStudentNoFilteredApplications')}</strong>
              <em>{row.applications.length === 0 ? tx('team.teacherStudentNoApplicationsDesc') : tx('team.teacherStudentNoFilteredApplicationsDesc')}</em>
            </span>
          </div>
        ) : (
          <div className="team-application-mini-list teacher">
            {row.visibleApplications.map(renderApplicationCard)}
          </div>
        )}
      </article>
    )
  }

  const renderTeacherApplications = () => (
    <div className="team-tab-panel">
      <section className="team-panel">
        <div className="team-panel-head">
          <div>
            <span className="eyebrow">{tx('team.teacherApplicationsEyebrow')}</span>
            <h3>{tx('team.teacherApplicationsTitle')}</h3>
          </div>
          <FileText size={16} aria-hidden="true" />
        </div>
        {renderApplicationFilters(
          teacherFilteredApplicationCount,
          selectedTeacherStudentRow ? selectedTeacherStudentRow.applications.length : supervisedApplications.length,
        )}

        <div className="team-teacher-app-toolbar">
          <label className="team-teacher-app-select">
            <span>{tx('team.teacherStudentSelectLabel')}</span>
            <Select
              size="small"
              searchable
              value={teacherStudentFilter}
              ariaLabel={tx('team.teacherStudentSelectLabel')}
              options={[
                {
                  value: 'all',
                  label: tx('team.teacherStudentSelectAll'),
                  description: format(tx('team.teacherStudentSelectAllDesc'), { count: supervisedStudentRows.length }),
                },
                ...supervisedStudentRows
                  .filter((row) => row.member.userId)
                  .map((row) => ({
                    value: row.member.userId!,
                    label: memberDisplayName(row.member, tx('team.memberFallback')),
                    description: format(tx('team.teacherStudentSelectDesc'), {
                      applications: row.applications.length,
                      email: memberEmail(row.member) || tx('team.noLinkedEmail'),
                    }),
                  })),
              ]}
              onChange={(value) => setTeacherStudentFilter(value)}
            />
          </label>
          <div className="team-teacher-app-toolbar-actions">
            <button
              type="button"
              className="primary-action"
              disabled={!onCreateApplication || !teacherCreateTargetId}
              onClick={() => onCreateApplication?.(teacherCreateTargetId)}
            >
              <Plus size={13} aria-hidden="true" />
              {selectedTeacherStudentRow ? tx('team.teacherCreateForSelected') : tx('team.teacherCreateApplication')}
            </button>
            <button type="button" className="quiet-action" onClick={() => changeTab('members')}>
              <Users size={13} aria-hidden="true" />
              {tx('team.teacherOpenStudents')}
            </button>
          </div>
        </div>

        <div className="team-student-workbench teacher">
          <button type="button" onClick={() => changeTab('members')}>
            <Users size={15} aria-hidden="true" />
            <span><strong>{format(tx('team.teacherWorkbenchStudents'), { count: teacherStudentsWithoutApplications.length })}</strong><em>{tx('team.teacherWorkbenchStudentsDesc')}</em></span>
          </button>
          <button type="button" onClick={() => setHealthFilter('watch')}>
            <AlertTriangle size={15} aria-hidden="true" />
            <span><strong>{format(tx('team.teacherWorkbenchRisk'), { count: teacherRiskApplications.length })}</strong><em>{tx('team.teacherWorkbenchRiskDesc')}</em></span>
          </button>
          <button type="button" onClick={() => setHealthFilter('all')}>
            <CalendarDays size={15} aria-hidden="true" />
            <span><strong>{format(tx('team.teacherWorkbenchDue'), { count: teacherUpcomingApplications.length })}</strong><em>{tx('team.teacherWorkbenchDueDesc')}</em></span>
          </button>
          <button type="button" onClick={() => changeTab('applications')}>
            <MessageSquare size={15} aria-hidden="true" />
            <span><strong>{format(tx('team.teacherWorkbenchFeedback'), { count: teacherFeedbackTotal })}</strong><em>{tx('team.teacherWorkbenchFeedbackDesc')}</em></span>
          </button>
        </div>

        {selectedTeacherStudentRow ? renderTeacherStudentFocus(selectedTeacherStudentRow) : null}

        {supervisedStudentRows.length === 0 ? (
          <div className="team-empty compact">
            <span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span>
            <div>
              <h3>{tx('team.teacherNoStudents')}</h3>
              <p>{tx('team.teacherNoStudentsDesc')}</p>
            </div>
          </div>
        ) : selectedTeacherStudentRow ? (
          <div className="team-selected-student-apps">
            <div className="team-selected-student-apps-head">
              <span>
                <strong>{tx('team.teacherSelectedStudentAppsTitle')}</strong>
                <em>{format(tx('team.teacherSelectedStudentAppsDesc'), {
                  count: selectedTeacherApplicationRow?.visibleApplications.length ?? 0,
                  total: selectedTeacherStudentRow.applications.length,
                })}</em>
              </span>
              {selectedTeacherStudentRow.member.userId && onViewApplications ? (
                <button type="button" className="quiet-action compact-action" onClick={() => onViewApplications(selectedTeacherStudentRow.member.userId!)}>
                  <FolderOpen size={12} aria-hidden="true" />
                  {tx('team.viewApplicationsEmpty')}
                </button>
              ) : null}
            </div>
            {(selectedTeacherApplicationRow?.visibleApplications.length ?? 0) === 0 ? (
              <div className="team-teacher-app-empty">
                <FileText size={15} aria-hidden="true" />
                <span>
                  <strong>{selectedTeacherStudentRow.applications.length === 0 ? tx('team.teacherStudentNoApplications') : tx('team.teacherStudentNoFilteredApplications')}</strong>
                  <em>{selectedTeacherStudentRow.applications.length === 0 ? tx('team.teacherStudentNoApplicationsDesc') : tx('team.teacherStudentNoFilteredApplicationsDesc')}</em>
                </span>
              </div>
            ) : (
              <div className="team-application-mini-list teacher selected">
                {selectedTeacherApplicationRow!.visibleApplications.map(renderApplicationCard)}
              </div>
            )}
          </div>
        ) : teacherApplicationRows.length === 0 ? (
          <div className="team-empty compact">
            <span className="empty-state-icon"><Search size={18} aria-hidden="true" /></span>
            <div>
              <h3>{tx('team.teacherNoFilteredStudents')}</h3>
              <p>{tx('team.teacherNoFilteredStudentsDesc')}</p>
            </div>
          </div>
        ) : (
          <div className="team-teacher-app-list">
            {teacherApplicationRows.map(renderTeacherApplicationRow)}
          </div>
        )}
      </section>
    </div>
  )

  const renderApplications = () => {
    if (viewerRole === 'admin') return renderTeacherApplications()

    return (
    <div className="team-tab-panel">
      <section className="team-panel">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{tx(viewerRole === 'member' ? 'team.studentApplicationsEyebrow' : 'team.applicationsEyebrow')}</span>
              <h3>{viewerRole === 'member' ? tx('team.studentShareTitle') : tx('team.applicationsTitle')}</h3>
            </div>
          <FileText size={16} aria-hidden="true" />
        </div>
        {renderApplicationFilters()}

        {viewerRole !== 'member' ? (
          <div className="team-student-workbench">
            <button type="button" onClick={() => changeTab('members')}>
              <Users size={15} aria-hidden="true" />
              <span><strong>{format(tx('team.adminWorkbenchStudents'), { count: studentsWithoutApplications.length })}</strong><em>{tx('team.adminWorkbenchStudentsDesc')}</em></span>
            </button>
            <button
              type="button"
              onClick={() => {
                setHealthFilter('all')
                changeTab('applications')
              }}
            >
              <AlertTriangle size={15} aria-hidden="true" />
              <span><strong>{format(tx('team.adminWorkbenchRisk'), { count: riskApps + watchApps })}</strong><em>{tx('team.adminWorkbenchRiskDesc')}</em></span>
            </button>
            <button
              type="button"
              onClick={() => {
                changeTab('applications')
              }}
            >
              <CalendarDays size={15} aria-hidden="true" />
              <span><strong>{format(tx('team.adminWorkbenchDue'), { count: upcomingApps })}</strong><em>{tx('team.adminWorkbenchDueDesc')}</em></span>
            </button>
            <button
              type="button"
              onClick={() => {
                changeTab('applications')
              }}
            >
              <MessageSquare size={15} aria-hidden="true" />
              <span><strong>{format(tx('team.adminWorkbenchFeedback'), { count: reviewCommentCount })}</strong><em>{tx('team.adminWorkbenchFeedbackDesc')}</em></span>
            </button>
          </div>
        ) : null}

        {viewerRole === 'member' ? (
          <>
            {renderStudentIntakePanel()}
            {renderStudentWorkbench()}
            {renderStudentActionPlan()}
            {filteredApplications.length === 0 ? (
              <div className="team-empty compact">
                <span className="empty-state-icon"><FileText size={18} aria-hidden="true" /></span>
                <div>
                  <h3>{applications.length === 0 ? tx('team.noStudentSharedApps') : tx('team.noFilteredApplications')}</h3>
                  <p>{applications.length === 0 ? tx('team.noStudentSharedAppsDesc') : tx('team.noFilteredApplicationsDesc')}</p>
                  {applications.length === 0 ? (
                    <div className="team-empty-actions">
                      {onSwitchToPersonal ? (
                        <button type="button" className="primary-action compact-action" onClick={onSwitchToPersonal}>
                          <FolderOpen size={12} aria-hidden="true" />
                          {tx('team.studentOpenPersonalToShare')}
                        </button>
                      ) : null}
                      {onCreateApplication ? (
                        <button type="button" className="quiet-action compact-action" onClick={() => onCreateApplication(null)}>
                          <Plus size={12} aria-hidden="true" />
                          {tx('team.studentCreateTeamApplication')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="team-queue-list">
                {filteredApplications.map(renderApplicationCard)}
              </div>
            )}
          </>
        ) : advisorGroups.length === 0 ? (
          <div className="team-empty compact">
            <span className="empty-state-icon"><FileText size={18} aria-hidden="true" /></span>
            <div>
              <h3>{applications.length === 0 ? tx('team.noTeamApplications') : tx('team.noFilteredApplications')}</h3>
              <p>{applications.length === 0 ? tx('team.noTeamApplicationsDesc') : tx('team.noFilteredApplicationsDesc')}</p>
            </div>
          </div>
        ) : (
          <div className="team-advisor-list">
            {advisorGroups.map((group) => {
              const isExpanded = expandedAdvisorId === group.id
              const advisorName = group.advisor ? memberDisplayName(group.advisor, tx('team.memberFallback')) : tx('team.unassignedAdvisor')
              const appCount = group.students.reduce((total, student) => total + student.applications.length, 0)
              return (
                <article key={group.id} className={`team-advisor-card ${isExpanded ? 'expanded' : ''}`}>
                  <button type="button" className="team-advisor-main" onClick={() => setExpandedAdvisorId(isExpanded ? null : group.id)} aria-expanded={isExpanded}>
                    <TeamMemberAvatar member={group.advisor} fallbackName={advisorName} />
                    <span>
                      <strong>{advisorName}</strong>
                      <em>{format(tx('team.advisorLoad'), { students: group.students.length, applications: appCount })}</em>
                    </span>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  <CollapsiblePanel open={isExpanded} className="team-advisor-detail" innerClassName="team-advisor-detail-inner">
                    <div className="team-student-application-list">
                      {group.students.map((student) => {
                        const studentName = student.member ? memberDisplayName(student.member, tx('team.memberFallback')) : applications.find((app) => app.ownerId === student.id)?.ownerName ?? tx('team.memberFallback')
                        const avgProgress = Math.round(student.applications.reduce((sum, app) => sum + app.progress, 0) / Math.max(1, student.applications.length))
                        const studentRisk = student.applications.filter((app) => applicationHealth(app) === 'risk').length
                        const studentDueSoon = student.applications.filter((app) => {
                          const due = daysUntil(app.deadline)
                          return due >= 0 && due <= 30
                        }).length
                        const studentComments = student.applications.reduce((total, app) => total + countReviewComments(app.reviewComments), 0)
                        return (
                          <div
                            key={student.id}
                            className="team-student-row"
                            onContextMenu={student.member ? (event) => openMemberContextMenu(event, student.member!) : undefined}
                          >
                            <div className="team-student-head">
                              <span>
                                <strong>{studentName}</strong>
                                <em>{student.applications.length > 0
                                  ? format(tx('team.studentProgressSummary'), { count: student.applications.length, progress: avgProgress })
                                  : tx('team.studentNoApps')}</em>
                              </span>
                              <div className="team-student-metrics" aria-label={tx('team.studentMetricsLabel')}>
                                <span><strong>{studentRisk}</strong><em>{tx('team.metricRisk')}</em></span>
                                <span><strong>{studentDueSoon}</strong><em>{tx('team.metricDue')}</em></span>
                                <span><strong>{studentComments}</strong><em>{tx('team.metricFeedback')}</em></span>
                              </div>
                              {student.member?.userId && onViewApplications ? (
                                <button type="button" className="quiet-action compact-action" onClick={() => onViewApplications(student.member!.userId!)}>
                                  <FolderOpen size={12} aria-hidden="true" />
                                  {tx('team.viewApplicationsEmpty')}
                                </button>
                              ) : null}
                            </div>
                            {student.applications.length > 0 ? (
                              <div className="team-application-mini-list">
                                {student.applications.map(renderApplicationCard)}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </CollapsiblePanel>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
    )
  }

  const renderStudentResources = () => {
    const stats = currentMember ? memberStats[currentMember.id] ?? null : null
    const teamId = summary?.team.id ?? ''
    const ownProfileAssets = studentProfileAssets.filter((asset) => asset.teamId === teamId && asset.studentUserId === session.user.id)
    const editingOwnProfile = editingStudentProfileId
      ? ownProfileAssets.find((asset) => asset.id === editingStudentProfileId) ?? null
      : null
    const openOwnProfileEditor = (preset?: Partial<TeamStudentProfileDraft>) => {
      setEditingStudentProfileId(null)
      setStudentProfileDraft({ ...defaultStudentProfileDraft, ...preset })
      setStudentProfileEditorOpen(true)
    }
    const editOwnProfile = (asset: TeamStudentProfileAsset) => {
      setEditingStudentProfileId(asset.id)
      setStudentProfileDraft({ kind: asset.kind, name: asset.name, description: asset.description })
      setStudentProfileEditorOpen(true)
    }
    const saveOwnProfile = () => {
      if (!teamId || !studentProfileDraft.name.trim()) return
      const now = new Date().toISOString()
      setStudentProfileAssets((items) => editingOwnProfile
        ? items.map((item) => item.id === editingOwnProfile.id ? {
            ...item,
            kind: studentProfileDraft.kind,
            name: studentProfileDraft.name.trim(),
            description: studentProfileDraft.description.trim(),
            updatedAt: now,
          } : item)
        : [{
            id: `student-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            teamId,
            studentUserId: session.user.id,
            kind: studentProfileDraft.kind,
            name: studentProfileDraft.name.trim(),
            description: studentProfileDraft.description.trim(),
            updatedAt: now,
          }, ...items])
      setStudentProfileEditorOpen(false)
      setEditingStudentProfileId(null)
      setStudentProfileDraft(defaultStudentProfileDraft)
      setMessage(tx('team.studentProfileSaved'))
    }
    const confirmOwnProfileDelete = (assetId: string) => {
      setPendingStudentProfileDeleteId(null)
      setRemovingStudentProfileIds((current) => new Set(current).add(assetId))
      window.setTimeout(() => {
        setStudentProfileAssets((items) => items.filter((item) => item.id !== assetId))
        setRemovingStudentProfileIds((current) => {
          const next = new Set(current)
          next.delete(assetId)
          return next
        })
      }, getMotionDelay(380))
    }

    return (
      <div className="team-tab-panel team-role-resource-page role-member">
        <section className="team-panel">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{tx('team.resourcesStudentEyebrow')}</span>
              <h3>{tx('team.resourcesStudentTitle')}</h3>
            </div>
            <Database size={16} aria-hidden="true" />
          </div>
          <div className="team-resource-grid team-resource-grid-scoped">
            <section className="team-resource-card">
              <span className="team-resource-icon"><FileText size={18} aria-hidden="true" /></span>
              <div>
                <strong>{stats?.applicationCount ?? applications.length}</strong>
                <span>{tx('team.settingsMetricSharedApps')}</span>
              </div>
            </section>
            <section className="team-resource-card">
              <span className="team-resource-icon"><MessageSquare size={18} aria-hidden="true" /></span>
              <div>
                <strong>{stats?.reviewCommentCount ?? studentFeedbackCount}</strong>
                <span>{tx('team.metricFeedback')}</span>
              </div>
            </section>
            <section className="team-resource-card">
              <span className="team-resource-icon"><Link2 size={18} aria-hidden="true" /></span>
              <div>
                <strong>{stats?.activeShareCount ?? 0}</strong>
                <span>{format(tx('team.memberStatLinks'), { count: stats?.activeShareCount ?? 0 })}</span>
              </div>
            </section>
            <section className="team-resource-card">
              <span className="team-resource-icon"><Database size={18} aria-hidden="true" /></span>
              <div>
                <strong>{formatBytes(stats?.storageUsedBytes ?? 0, lang)}</strong>
                <span>{tx('team.capacityUsedOnly')}</span>
              </div>
            </section>
          </div>
          <div className="team-student-resource-flow">
            <section className="team-student-resource-policy">
              <span className="team-resource-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
              <div>
                <strong>{tx('team.studentResourcePolicyTitle')}</strong>
                <em>{tx('team.studentResourcePolicyDesc')}</em>
              </div>
              {onCreateApplication ? (
                <button type="button" className="primary-action compact-action" onClick={() => onCreateApplication(null)}>
                  <Plus size={13} aria-hidden="true" />
                  {tx('team.studentRequestNewApplication')}
                </button>
              ) : null}
            </section>
            <section className="team-student-resource-requests">
              <div className="team-student-resource-requests-head">
                <span>{tx('team.studentPendingRequests')}</span>
                <strong>{studentPendingTransferRequests.length}</strong>
              </div>
              {studentPendingTransferRequests.length === 0 ? (
                <p>{tx('team.studentNoPendingRequests')}</p>
              ) : (
                <div className="team-student-resource-request-list">
                  {studentPendingTransferRequests.slice(0, 4).map((request) => (
                    <span key={request.id}>
                      <strong>{request.applicationName}</strong>
                      <em>{format(tx(request.direction === 'join' ? 'team.transferDirectionJoin' : 'team.transferDirectionLeave'), {
                        student: request.ownerName || request.ownerEmail || tx('team.memberFallback'),
                      })} · {eventTime(request.requestedAt, lang)}</em>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
          <div className="team-role-primary-actions">
            <button type="button" className="primary-action" onClick={() => changeTab('applications')}>
              <FileText size={13} aria-hidden="true" />
              {tx('team.studentOpenSharedApps')}
            </button>
          </div>
        </section>

        <section className="team-panel team-member-profile-workspace" aria-labelledby="team-member-profile-library-title">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{tx('team.studentProfileOrgEyebrow')}</span>
              <h3 id="team-member-profile-library-title">{tx('team.studentProfileOrgTitle')}</h3>
            </div>
            <span className="profile-count-badge">{ownProfileAssets.length}</span>
          </div>
          <p className="team-profile-boundary-note">{tx('team.studentProfileOrgBoundary')}</p>

          {ownProfileAssets.length === 0 ? (
            <div className="team-empty compact">
              <span className="empty-state-icon"><FileText size={18} aria-hidden="true" /></span>
              <div><h3>{tx('team.studentProfileOrgEmpty')}</h3><p>{tx('team.studentProfileOrgEmptyDesc')}</p></div>
            </div>
          ) : (
            <div className="snippet-grid team-student-profile-grid">
              {ownProfileAssets.map((asset) => {
                const isRemoving = removingStudentProfileIds.has(asset.id)
                return (
                <article key={asset.id} className={`snippet-card team-student-profile-card${isRemoving ? ' is-removing' : ''}`}>
                  <button type="button" className="snippet-card-main" onClick={() => editOwnProfile(asset)}>
                    <div className="snippet-card-icon"><FileText size={18} aria-hidden="true" /></div>
                    <div className="snippet-card-info">
                      <div className="snippet-card-title-row"><strong>{asset.name}</strong><span>{asset.kind}</span></div>
                      {asset.description ? <MarkdownContent value={asset.description} className="snippet-card-description" /> : null}
                    </div>
                  </button>
                  <div className="snippet-card-foot">
                    <span className="snippet-card-chip">{tx('team.studentProfileOrganizationOnly')}</span>
                    <div className="snippet-card-actions">
                      <button type="button" className="icon-action" title={tx('team.studentProfileEdit')} disabled={isRemoving} onClick={() => editOwnProfile(asset)}><Pencil size={13} aria-hidden="true" /></button>
                      <InlineConfirm
                        className="team-student-profile-delete"
                        open={pendingStudentProfileDeleteId === asset.id}
                        busy={isRemoving}
                        disabled={isRemoving}
                        confirmLabel={tx('team.studentProfileDelete')}
                        cancelLabel={tx('cancel')}
                        confirmTone="danger"
                        idleClassName="icon-action"
                        idleTitle={tx('team.studentProfileDelete')}
                        idleAriaLabel={tx('team.studentProfileDelete')}
                        onOpen={() => setPendingStudentProfileDeleteId(asset.id)}
                        onCancel={() => setPendingStudentProfileDeleteId(null)}
                        onConfirm={() => confirmOwnProfileDelete(asset.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </InlineConfirm>
                    </div>
                  </div>
                </article>
                )
              })}
            </div>
          )}

          <CollapsiblePanel open={studentProfileEditorOpen} keepMounted className="team-student-profile-editor-collapse" innerClassName="team-student-profile-editor-collapse-inner" openMs={380} closeMs={320}>
            <div className="team-student-profile-editor">
              <div className="team-student-profile-editor-head"><span>{editingOwnProfile ? tx('team.studentProfileEdit') : tx('team.studentProfileAdd')}</span></div>
              <div className="team-student-profile-editor-grid">
                <label><span>{tx('team.studentProfileName')}</span><input value={studentProfileDraft.name} onChange={(event) => setStudentProfileDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>{tx('team.studentProfileKind')}</span><Select size="small" value={studentProfileDraft.kind} options={teamProfilePresets.map((preset) => ({ value: preset.kind, label: profilePresetText(preset, lang).name }))} onChange={(kind) => setStudentProfileDraft((current) => ({ ...current, kind }))} /></label>
                <label className="wide"><span>{tx('team.studentProfileContent')}</span><textarea rows={4} value={studentProfileDraft.description} onChange={(event) => setStudentProfileDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              </div>
              <div className="team-student-profile-editor-actions">
                <button type="button" className="quiet-action" onClick={() => { setStudentProfileEditorOpen(false); setEditingStudentProfileId(null) }}>{tx('cancel')}</button>
                <button type="button" className="primary-action" onClick={saveOwnProfile} disabled={!studentProfileDraft.name.trim()}><Check size={13} aria-hidden="true" />{tx('team.studentProfileSave')}</button>
              </div>
            </div>
          </CollapsiblePanel>
          <CollapsiblePanel open={!studentProfileEditorOpen} keepMounted className="team-student-profile-presets-collapse" innerClassName="team-student-profile-presets-collapse-inner" openMs={380} closeMs={320}>
            <div className="profile-preset-section team-student-profile-section">
              <div className="profile-section-head">
                <div><span className="eyebrow">{tx('team.studentProfilePresetEyebrow')}</span><h3>{tx('team.studentProfilePresetTitle')}</h3></div>
                <span className="profile-count-badge">{teamProfilePresets.length}</span>
              </div>
              <div className="profile-preset-grid team-student-profile-presets">
                {teamProfilePresets.map((preset) => {
                  const display = profilePresetText(preset, lang)
                  return (
                    <button key={preset.id} type="button" className="profile-preset-card" onClick={() => openOwnProfileEditor({ kind: preset.kind, name: display.name, description: display.content })}>
                      <ProfilePresetIcon icon={preset.icon} color={preset.color} />
                      <strong>{display.name}</strong><em>{display.description}</em>
                      <span className="profile-preset-action"><Plus size={12} aria-hidden="true" />{tx('team.studentProfileUsePreset')}</span>
                    </button>
                  )
                })}
                <button type="button" className="profile-preset-card profile-preset-add-card" onClick={() => openOwnProfileEditor()}>
                  <span className="profile-preset-icon"><Plus size={16} aria-hidden="true" /></span><strong>{tx('team.studentProfileAdd')}</strong><em>{tx('team.studentProfileOwnSnippetHint')}</em>
                </button>
              </div>
            </div>
          </CollapsiblePanel>
        </section>
      </div>
    )
  }

  const renderStudentProfileResources = (
    profileRows: StudentProfileRow[],
    scope: 'teacher' | 'owner' = 'teacher',
    embedded = false,
    detailReady = true,
  ) => {
    const profileClassName = `${embedded ? 'team-student-profile-embedded' : 'team-tab-panel'} team-role-resource-page ${scope === 'owner' ? 'role-owner' : 'role-admin'} team-portrait-page`
    const resolvePresetSource = (preset: TeamProfilePreset): ProfilePresetSource => {
      const source = teamPresetSource(preset)
      // Org admins treat every non-system preset as organization-owned (no “mine” lane).
      if (scope === 'owner' && source === 'mine') return 'org'
      return source
    }

    const categorizePresets = () => {
      const system: TeamProfilePreset[] = []
      const org: TeamProfilePreset[] = []
      const mine: TeamProfilePreset[] = []
      for (const preset of teamProfilePresets) {
        const source = resolvePresetSource(preset)
        if (source === 'system') system.push(preset)
        else if (source === 'org') org.push(preset)
        else mine.push(preset)
      }
      return { system, org, mine }
    }

    const renderPresetLibrary = (
      compactEmpty = false,
      canApplyPreset = false,
      surface: 'inspector' | 'shortcut' = 'inspector',
      onComplete?: () => void,
    ) => {
      const buckets = categorizePresets()
      const isOwnerLibrary = scope === 'owner'
      const activeSourceFilter: ProfilePresetSourceFilter = (
        isOwnerLibrary && presetSourceFilter === 'mine'
      ) ? 'all' : presetSourceFilter
      const sourceCounts: Record<ProfilePresetSourceFilter, number> = {
        all: teamProfilePresets.length,
        system: buckets.system.length,
        org: buckets.org.length,
        mine: buckets.mine.length,
      }
      const sourcePresets = activeSourceFilter === 'all'
        ? teamProfilePresets
        : activeSourceFilter === 'system'
          ? buckets.system
          : activeSourceFilter === 'org'
            ? buckets.org
            : buckets.mine
      const normalizedPresetQuery = presetQuery.trim().toLowerCase()
      const visiblePresets = normalizedPresetQuery
        ? sourcePresets.filter((preset) => {
            const display = profilePresetText(preset, lang)
            return [
              preset.kind,
              preset.nameEn,
              preset.nameZh,
              preset.descriptionEn,
              preset.descriptionZh,
              preset.contentEn,
              preset.contentZh,
              display.name,
              display.description,
              display.content,
            ].join(' ').toLowerCase().includes(normalizedPresetQuery)
          })
        : sourcePresets
      const canManagePresets = viewerRole === 'owner' || viewerRole === 'admin'
      const titleId = `team-portrait-presets-title-${scope}-${surface}`
      const searchId = `team-portrait-preset-search-${scope}-${surface}`
      const sourceTabs: Array<[ProfilePresetSourceFilter, string]> = isOwnerLibrary
        ? [
            ['all', tx('team.myPortraitPresetsSourceAll')],
            ['system', tx('team.myPortraitPresetsSourceSystem')],
            ['org', tx('team.myPortraitPresetsSourceOrg')],
          ]
        : [
            ['all', tx('team.myPortraitPresetsSourceAll')],
            ['system', tx('team.myPortraitPresetsSourceSystem')],
            ['org', tx('team.myPortraitPresetsSourceOrg')],
            ['mine', tx('team.myPortraitPresetsSourceMine')],
          ]

      return (
        <section className="team-portrait-presets" aria-labelledby={titleId}>
          <div className="team-portrait-presets-head">
            <div>
              <span className="eyebrow">{tx('team.myPortraitPresetsEyebrow')}</span>
              <h3 id={titleId}>
                {tx(isOwnerLibrary ? 'team.orgPortraitPresetsTitle' : 'team.myPortraitPresetsTitle')}
              </h3>
            </div>
            <div className="team-portrait-presets-head-actions">
              <span className="team-portrait-count">{format(tx('team.myPortraitPresetsCount'), { count: visiblePresets.length })}</span>
              {canManagePresets ? (
                <button
                  type="button"
                  className="primary-action compact-action"
                  onClick={() => {
                    setEditingTeamPresetId(null)
                    setTeamPresetEditorOpen(true)
                    onComplete?.()
                  }}
                >
                  <Plus size={13} aria-hidden="true" />
                  {tx(isOwnerLibrary ? 'team.orgPortraitPresetsAdd' : 'profile.addPreset')}
                </button>
              ) : null}
            </div>
          </div>

          <label className="search-field team-portrait-preset-search" htmlFor={searchId}>
            <Search size={13} aria-hidden="true" />
            <span className="sr-only">{tx('team.profilePresetSearchPlaceholder')}</span>
            <input
              id={searchId}
              type="search"
              value={presetQuery}
              onChange={(event) => setPresetQuery(event.target.value)}
              placeholder={tx('team.profilePresetSearchPlaceholder')}
              data-popover-autofocus={surface === 'shortcut' ? true : undefined}
            />
          </label>

          <div className="team-portrait-source-tabs" role="tablist" aria-label={tx('team.myPortraitPresetsSourceLabel')}>
            {sourceTabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                className={activeSourceFilter === value ? 'active' : ''}
                aria-selected={activeSourceFilter === value}
                onClick={() => setPresetSourceFilter(value)}
              >
                <span>{label}</span>
                <b>{sourceCounts[value]}</b>
              </button>
            ))}
          </div>

          {visiblePresets.length === 0 ? (
            <div className={`team-portrait-presets-empty${compactEmpty ? ' compact' : ''}`}>
              <span className="empty-state-icon"><ListChecks size={18} aria-hidden="true" /></span>
              <div>
                <strong>{tx(normalizedPresetQuery ? 'noResults' : 'team.myPortraitPresetsEmpty')}</strong>
              </div>
              {canManagePresets && !normalizedPresetQuery ? (
                <button
                  type="button"
                  className="quiet-action compact-action"
                  onClick={() => {
                    setEditingTeamPresetId(null)
                    setTeamPresetEditorOpen(true)
                    onComplete?.()
                  }}
                >
                  <Plus size={13} aria-hidden="true" />
                  {tx(isOwnerLibrary ? 'team.orgPortraitPresetsAdd' : 'profile.addPreset')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="team-portrait-preset-list" role="list">
              {visiblePresets.map((preset) => {
                const display = profilePresetText(preset, lang)
                const source = resolvePresetSource(preset)
                const sourceLabel = source === 'system'
                  ? tx('team.myPortraitPresetsSourceSystem')
                  : source === 'org'
                    ? tx(isOwnerLibrary ? 'team.myPortraitPresetsSourceOrgAdmin' : 'team.myPortraitPresetsSourceOrg')
                    : tx('team.myPortraitPresetsSourceMine')
                return (
                  <article
                    key={preset.id}
                    className={`team-portrait-preset-row${applyingStudentPresetId === preset.id ? ' is-applying' : ''}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="team-portrait-preset-main"
                      disabled={!canApplyPreset || applyingStudentPresetId !== null}
                      aria-label={`${tx('team.studentProfileUsePreset')}: ${display.name}`}
                      onClick={() => {
                        void loadTeamSnippetEditorDialog().catch(() => undefined)
                        setError(null)
                        setMessage(null)
                        setEditingViewedStudentAssetId(null)
                        setStudentSnippetPreset(preset)
                        onComplete?.()
                      }}
                    >
                      <ProfilePresetIcon icon={preset.icon} color={preset.color} />
                      <span className="team-portrait-preset-copy">
                        <span className="team-portrait-preset-title-row">
                          <strong>{display.name}</strong>
                          <span className={`team-portrait-source-chip source-${source}`}>{sourceLabel}</span>
                        </span>
                        {display.description ? <em>{display.description}</em> : null}
                        {canApplyPreset ? (
                          <span className="team-portrait-preset-use">
                            <Plus size={11} aria-hidden="true" />
                            {applyingStudentPresetId === preset.id ? tx('working') : tx('team.studentProfileUsePreset')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <div className="team-portrait-preset-actions">
                      {preset.manageable ? (
                        <>
                          <button
                            type="button"
                            className="team-portrait-icon-btn"
                            title={tx('profile.editPreset')}
                            onClick={() => {
                              setEditingTeamPresetId(preset.id)
                              setTeamPresetEditorOpen(true)
                              onComplete?.()
                            }}
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="team-portrait-icon-btn danger"
                            title={tx('profile.deletePreset')}
                            onClick={() => {
                              setPendingDeleteTeamPreset(preset)
                              onComplete?.()
                            }}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )
    }

    if (!detailReady) {
      return (
        <div className={`${profileClassName} team-progressive-surface`} aria-busy="true">
          <section className="team-portrait-hero">
            <div>
              <span className="eyebrow">{tx(scope === 'owner' ? 'team.ownerStudentProfilesEyebrow' : 'team.resourcesTeacherEyebrow')}</span>
              <h3>{tx(scope === 'owner' ? 'team.ownerStudentProfilesTitle' : 'team.resourcesTeacherTitle')}</h3>
            </div>
          </section>
          <div className="team-resource-deferred" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      )
    }

    const studentQuery = studentResourceQuery.trim().toLowerCase()
    const stateRank: Record<StudentProfileState, number> = { missing: 0, risk: 1, due: 2, feedback: 3, steady: 4 }
    const attentionStudentCount = profileRows.filter((row) => row.state === 'risk' || row.state === 'due' || row.state === 'feedback').length
    const missingStudentCount = profileRows.filter((row) => row.state === 'missing').length
    const studentFilterCounts: Record<StudentProfileFilter, number> = {
      all: profileRows.length,
      attention: attentionStudentCount,
      missing: missingStudentCount,
    }
    const studentRows = profileRows
      .filter((row) => {
        if (studentProfileFilter === 'attention' && row.state !== 'risk' && row.state !== 'due' && row.state !== 'feedback') return false
        if (studentProfileFilter === 'missing' && row.state !== 'missing') return false
        if (!studentQuery) return true
        return [
          memberDisplayName(row.member, tx('team.memberFallback')),
          memberEmail(row.member),
          row.applications.map((application) => application.school.name).join(' '),
        ].join(' ').toLowerCase().includes(studentQuery)
      })
      .sort((a, b) => {
        if (studentProfileSort === 'name') {
          return memberDisplayName(a.member, '').localeCompare(memberDisplayName(b.member, ''))
        }
        if (studentProfileSort === 'progress') return a.averageProgress - b.averageProgress
        return stateRank[a.state] - stateRank[b.state] || memberDisplayName(a.member, '').localeCompare(memberDisplayName(b.member, ''))
      })
    const selectedRow = studentRows.find((row) => row.member.userId === selectedResourceStudentId) ?? null
    const selectedStudentId = selectedRow?.member.userId ?? null
    const selectedHiddenByFilters = Boolean(
      selectedResourceStudentId
      && !selectedRow
      && profileRows.some((row) => row.member.userId === selectedResourceStudentId),
    )
    const selectedAdvisors = selectedRow ? studentTeachersFor(selectedRow.member) : []
    const selectedStudentMailHref = selectedRow ? memberMailtoHref(selectedRow.member) : ''
    const selectedStudentName = selectedRow
      ? memberDisplayName(selectedRow.member, tx('team.memberFallback'))
      : ''
    const filteredStudentAssets = viewedStudentAssets.filter((asset) => {
      const needle = viewedStudentAssetQuery.trim().toLowerCase()
      if (!needle) return true
      return [asset.name, asset.kind, asset.description, asset.customLabelZh, asset.customLabelEn]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    const filteredStudentFamilies = groupProfileAssetsIntoFamilies(filteredStudentAssets)

    const clearStudentProfileFilters = () => {
      setStudentResourceQuery('')
      setStudentProfileFilter('all')
    }

    return (
      <div className={`${profileClassName} team-portrait-page`} data-scope={scope}>
        {profileRows.length === 0 ? (
          <div className="team-portrait-empty-students">
            <span className="empty-state-icon"><UserRound size={22} aria-hidden="true" /></span>
            <div>
              <h3>{tx(scope === 'owner' ? 'team.ownerStudentProfilesEmpty' : 'team.resourcesTeacherEmpty')}</h3>
              <p>{tx(scope === 'owner' ? 'team.ownerStudentProfilesEmptyDesc' : 'team.resourcesTeacherEmptyDesc')}</p>
            </div>
          </div>
        ) : (
          <div className="team-portrait-workspace">
            <aside className="team-portrait-list-pane" aria-label={tx('team.studentProfilePickerTitle')}>
              <div className="team-portrait-list-head">
                <div>
                  <span className="eyebrow">{tx('team.studentProfilePickerEyebrow')}</span>
                  <h1>{tx('team.studentProfilePickerTitle')}</h1>
                </div>
                <span className="team-portrait-count">{format(tx('team.studentProfilePickerCount'), { count: studentRows.length })}</span>
              </div>

              <label className="search-field team-portrait-student-search">
                <Search size={15} aria-hidden="true" />
                <span className="sr-only">{tx('team.studentProfileSearchPlaceholder')}</span>
                <input
                  type="search"
                  value={studentResourceQuery}
                  onChange={(event) => setStudentResourceQuery(event.target.value)}
                  placeholder={tx('team.studentProfileSearchPlaceholder')}
                />
              </label>

              <div className="team-portrait-filterbar" data-active-filter={studentProfileFilter}>
                <span className="team-portrait-filter-indicator" aria-hidden="true" />
                {([
                  ['all', tx('team.studentProfileFilterAll')],
                  ['attention', tx('team.studentProfileFilterAttention')],
                  ['missing', tx('team.studentProfileFilterMissing')],
                ] as Array<[StudentProfileFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={studentProfileFilter === value ? 'active' : ''}
                    onClick={() => setStudentProfileFilter(value)}
                    aria-pressed={studentProfileFilter === value}
                  >
                    <span>{label}</span>
                    <b>{studentFilterCounts[value]}</b>
                  </button>
                ))}
              </div>

              <div className="team-portrait-sort-control">
                <span>{tx('team.studentProfileSortLabel')}</span>
                <Select
                  size="small"
                  value={studentProfileSort}
                  ariaLabel={tx('team.studentProfileSortLabel')}
                  options={[
                    { value: 'attention', label: tx('team.studentProfileSortAttention') },
                    { value: 'name', label: tx('team.studentProfileSortName') },
                    { value: 'progress', label: tx('team.studentProfileSortProgress') },
                  ]}
                  onChange={(value) => setStudentProfileSort(value as StudentProfileSort)}
                />
              </div>

              {studentRows.length === 0 ? (
                <div className="empty-list team-portrait-list-empty">
                  <Search size={24} aria-hidden="true" />
                  <span>{tx('team.studentProfileNoMatches')}</span>
                  <button type="button" className="quiet-action compact-action" onClick={clearStudentProfileFilters}>
                    {tx('team.studentProfileClearFilters')}
                  </button>
                </div>
              ) : (
                <div className="team-portrait-student-list" role="listbox" aria-label={tx('team.studentProfilePickerTitle')}>
                  {studentRows.map((row) => {
                    const isSelected = row.member.userId === selectedStudentId
                    const studentName = memberDisplayName(row.member, tx('team.memberFallback'))
                    return (
                      <button
                        key={row.member.id}
                        type="button"
                        role="option"
                        className={`team-portrait-student-row state-${row.state}${isSelected ? ' selected' : ''}`}
                        aria-selected={isSelected}
                        onClick={() => {
                          setSelectedResourceStudentId(row.member.userId ?? null)
                          setStudentProfileEditorOpen(false)
                        }}
                      >
                        <TeamMemberAvatar member={row.member} className="team-portrait-student-avatar" />
                        <span className="team-portrait-student-copy">
                          <strong>{studentName}</strong>
                          <em>{memberEmail(row.member) || tx('team.noLinkedEmail')}</em>
                          <span>
                            <i aria-hidden="true" />
                            {tx(studentStateLabelKey(row.state))}
                            <b>{format(tx('team.studentProfileStudentMeta'), { applications: row.applications.length, assets: row.feedbackCount })}</b>
                          </span>
                        </span>
                        <span className="team-portrait-student-score">
                          <strong>{row.averageProgress}%</strong>
                          <i aria-hidden="true"><b style={{ width: `${row.averageProgress}%` }} /></i>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </aside>

            <section className="team-portrait-profile-pane" aria-label={tx('profile.title')}>
              {selectedRow ? (
                <>
                  <div className="team-portrait-dossier-head">
                    <div className="team-portrait-identity">
                      <TeamMemberAvatar member={selectedRow.member} className="team-portrait-identity-avatar" />
                      <div>
                        <span className="eyebrow">{tx('team.studentProfileEyebrow')}</span>
                        <h2>{memberDisplayName(selectedRow.member, tx('team.memberFallback'))}</h2>
                        <p>
                          {selectedStudentMailHref ? <a href={selectedStudentMailHref}>{memberEmail(selectedRow.member)}</a> : (memberEmail(selectedRow.member) || tx('team.noLinkedEmail'))}
                          <span aria-hidden="true">·</span>
                          {format(tx('team.studentPortraitAdvisorMeta'), {
                            name: selectedAdvisors.length
                              ? selectedAdvisors.map((advisor) => memberDisplayName(advisor, tx('team.memberFallback'))).join(' · ')
                              : tx('team.studentProfileAdvisorFallback'),
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="team-portrait-identity-actions">
                      {selectedRow.member.userId && onViewApplications ? (
                        <button type="button" className="quiet-action compact-action" onClick={() => onViewApplications(selectedRow.member.userId!)}>
                          <FolderOpen size={13} aria-hidden="true" />
                          {tx('team.studentProfileOpenApps')}
                        </button>
                      ) : null}
                      {selectedRow.member.userId && onCreateApplication ? (
                        <button type="button" className="primary-action compact-action" onClick={() => onCreateApplication(selectedRow.member.userId!)}>
                          <Plus size={13} aria-hidden="true" />
                          {tx('team.teacherCreateForStudent')}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="team-portrait-dossier-scroll">
                    <section className="team-portrait-content-section" aria-labelledby="team-student-library-title">
                      <div className="team-portrait-section-head team-portrait-library-head">
                        <div>
                          <span className="eyebrow">{tx('profile.libraryEyebrow')}</span>
                          <h3 id="team-student-library-title">
                            {format(tx('team.studentPortraitLibraryTitle'), { name: selectedStudentName })}
                          </h3>
                        </div>
                        <div className="team-portrait-library-tools">
                          <div className="search-field team-portrait-library-search">
                            <Search size={13} aria-hidden="true" />
                            <input
                              type="search"
                              value={viewedStudentAssetQuery}
                              onChange={(event) => setViewedStudentAssetQuery(event.target.value)}
                              placeholder={tx('profile.searchAssets')}
                              aria-label={tx('profile.searchAssets')}
                            />
                          </div>
                          <AnchoredPopover
                            triggerAriaLabel={tx(scope === 'owner' ? 'team.studentPortraitPresetButtonOrg' : 'team.studentPortraitPresetButtonTeacher')}
                            popoverAriaLabel={tx(scope === 'owner' ? 'team.orgPortraitPresetsTitle' : 'team.myPortraitPresetsTitle')}
                            triggerClassName="quiet-action team-portrait-preset-trigger"
                            popoverClassName="team-portrait-preset-popover"
                            width={344}
                            estimatedHeight={460}
                            align="end"
                            trigger={(
                              <>
                                <ListChecks size={12} aria-hidden="true" />
                                <span>{tx(scope === 'owner' ? 'team.studentPortraitPresetButtonOrg' : 'team.studentPortraitPresetButtonTeacher')}</span>
                              </>
                            )}
                          >
                            {(close) => renderPresetLibrary(true, true, 'shortcut', close)}
                          </AnchoredPopover>
                          <LibraryViewSwitch
                            value={studentAssetView}
                            onChange={setStudentAssetView}
                            label={tx('profile.viewModeLabel')}
                            cardLabel={tx('profile.cardView')}
                            listLabel={tx('profile.listView')}
                            transitionScope="team"
                            controlsId="team-student-library-view"
                          />
                          <span className="profile-count-badge">{filteredStudentAssets.length}</span>
                        </div>
                      </div>

                      {viewedStudentAssetsLoading ? (
                        <div className="team-portrait-profile-loading" aria-busy="true"><span /><span /><span /></div>
                      ) : filteredStudentAssets.length === 0 ? (
                        <div className="team-portrait-section-empty team-portrait-profile-empty">
                          <FileText size={18} aria-hidden="true" />
                          <span>{tx('profile.noSnippets')}</span>
                          <p>{tx('team.studentPortraitLibraryEmpty')}</p>
                        </div>
                      ) : studentAssetView === 'list' ? (
                        <div id="team-student-library-view" key="team-student-library-list" className="team-portrait-library-view is-list">
                        <div className="team-portrait-snippet-list">
                          {filteredStudentAssets.map((asset) => {
                            const KindIcon = asset.kind === 'CV' || asset.kind === 'Transcript' ? FileCheck : FileText
                            const attachmentCount = asset.attachments?.length ?? 0
                            const deleting = deletingViewedStudentAssetId === asset.id
                            return (
                              <article key={asset.id} className={`team-portrait-snippet-row${deleting ? ' is-removing' : ''}`}>
                                <button
                                  type="button"
                                  className="team-portrait-snippet-main"
                                  disabled={deleting}
                                  onClick={() => openSelectedStudentSnippet(asset)}
                                  aria-label={`${tx('profile.openSnippet')}: ${asset.name}`}
                                >
                                  <span className="team-portrait-snippet-icon"><KindIcon size={16} aria-hidden="true" /></span>
                                  <span className="team-portrait-snippet-copy">
                                    <span><strong>{asset.name}</strong><b>{asset.kind}</b></span>
                                    {asset.description ? <em>{asset.description.replace(/\s+/g, ' ').slice(0, 132)}{asset.description.length > 132 ? '…' : ''}</em> : null}
                                    <small><Paperclip size={11} aria-hidden="true" />{attachmentCount > 0 ? format(tx(attachmentCount === 1 ? 'profile.attachmentCount' : 'profile.attachmentCountPlural'), { count: attachmentCount }) : tx('profile.noAttachments')}</small>
                                  </span>
                                </button>
                                <div className="team-portrait-snippet-actions">
                                  <button
                                    type="button"
                                    className="icon-action"
                                    title={tx('profile.editSnippet')}
                                    disabled={deleting}
                                    onClick={() => openSelectedStudentSnippet(asset)}
                                  >
                                    <Pencil size={13} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-action"
                                    title={tx('profile.deleteSnippet')}
                                    disabled={deleting}
                                    onClick={() => setPendingViewedStudentAssetDelete(asset)}
                                  >
                                    <Trash2 size={13} aria-hidden="true" />
                                  </button>
                                </div>
                              </article>
                            )
                          })}
                        </div>
                        </div>
                      ) : (
                        <div id="team-student-library-view" key="team-student-library-cards" className="team-portrait-library-view is-cards">
                          <div className="snippet-grid snippet-stack-grid team-portrait-snippet-card-grid" role="list">
                            {filteredStudentFamilies.map((family, familyIndex) => {
                              const open = expandedStudentFamilyId === family.familyId
                              return (
                                <TeamPortraitFamilyDeck
                                  key={`${activeTeamId ?? summary?.team.id ?? 'team'}:${selectedStudentId ?? 'student'}:${family.familyId}`}
                                  family={family}
                                  familyIndex={familyIndex}
                                  open={open}
                                  deletingAssetId={deletingViewedStudentAssetId}
                                  onToggle={() => setExpandedStudentFamilyId(open ? null : family.familyId)}
                                  onOpen={openSelectedStudentSnippet}
                                  onDelete={setPendingViewedStudentAssetDelete}
                                />
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <div className="empty-dossier team-portrait-pick-hint">
                  <span className="empty-state-icon"><UserRound size={22} aria-hidden="true" /></span>
                  <div>
                    <h3>{tx('team.studentProfileEmptyTitle')}</h3>
                    <p>{tx(selectedHiddenByFilters ? 'team.studentProfileFilteredOutDesc' : 'team.studentProfileEmptyDesc')}</p>
                  </div>
                  <div className="team-portrait-detail-empty-actions">
                    {selectedHiddenByFilters ? <button type="button" className="primary-action" onClick={clearStudentProfileFilters}>{tx('team.studentProfileClearFilters')}</button> : null}
                    {studentRows.slice(0, 3).map((row) => <button key={row.member.id} type="button" className="quiet-action" onClick={() => setSelectedResourceStudentId(row.member.userId ?? null)}>{memberDisplayName(row.member, tx('team.memberFallback'))}</button>)}
                  </div>
                </div>
              )}
            </section>

            <aside className="team-portrait-template-pane" aria-label={tx('team.myPortraitPresetsEyebrow')}>
              {renderPresetLibrary(false, Boolean(selectedRow), 'inspector')}
            </aside>
          </div>
        )}
      </div>
    )
  }

  const renderTeacherResources = () => renderStudentProfileResources(
    supervisedStudentRows,
    'teacher',
    false,
    true,
  )

  const renderResources = () => {
    if (viewerRole === 'member') return renderStudentResources()
    // Institution admin and teacher share the same student-portrait layout.
    if (viewerRole === 'admin') return renderTeacherResources()
    return renderStudentProfileResources(
      organizationStudentRows,
      'owner',
      false,
      true,
    )
  }

  const normalizedMemberQuery = memberQuery.trim().toLowerCase()
  const memberFilterActive = Boolean(normalizedMemberQuery || memberStatusFilter !== 'all')
  const memberMatchesFilter = (member: TeamMember) => {
    if (memberStatusFilter !== 'all' && member.status !== memberStatusFilter) return false
    if (!normalizedMemberQuery) return true

    const assignedTeachers = member.role === 'member' ? studentTeachersFor(member) : []
    const statusLabel = tx(member.status === 'active' ? 'team.statusActive' : 'team.statusPending')
    return [
      memberDisplayName(member, tx('team.memberFallback')),
      memberEmail(member),
      tx(ROLE_LABEL_KEYS[member.role]),
      statusLabel,
      ...assignedTeachers.flatMap((teacher) => [
        memberDisplayName(teacher, tx('team.memberFallback')),
        memberEmail(teacher),
      ]),
    ].join(' ').toLowerCase().includes(normalizedMemberQuery)
  }
  const collaborationStudents = (summary?.members ?? []).filter((member) => member.role === 'member')
  const filteredCollaborationStudents = collaborationStudents.filter(memberMatchesFilter)
  const unassignedStudentCount = collaborationStudents.filter((member) => (
    member.status === 'active' && teamMemberTeacherIds(member).length === 0
  )).length
  const teacherDirectory = (summary?.members ?? []).filter((member) => member.role === 'admin')
  const groupedTeacherMemberIds = new Set(teacherGroups.flatMap((group) => group.memberIds))
  const filteredTeacherDirectory = teacherDirectory
    .filter(memberMatchesFilter)
    .filter((teacher) => {
      if (selectedTeacherGroupId === 'all') return true
      if (selectedTeacherGroupId === 'ungrouped') return !groupedTeacherMemberIds.has(teacher.id)
      return activeTeacherGroup?.memberIds.includes(teacher.id) ?? false
    })

  function renderTeacherAvatarStack(member: TeamMember) {
    const teachers = studentTeachersFor(member)
    return (
      <div
        className={`team-collaboration-assignees ${teachers.length === 0 ? 'is-empty' : ''}`}
        aria-label={teachers.length
          ? teachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(', ')
          : tx('team.collaborationUnassigned')}
      >
        <span className="team-collaboration-avatar-stack" aria-hidden="true">
          {teachers.slice(0, 3).map((teacher) => (
            <TeamMemberAvatar key={teacher.id} member={teacher} className="team-collaboration-teacher-avatar" />
          ))}
          {teachers.length === 0 ? <UserPlus size={14} /> : null}
        </span>
        <span>
          <strong>{teachers.length
            ? format(tx('team.collaborationTeachersCount'), { count: teachers.length })
            : tx('team.collaborationUnassigned')}</strong>
          <em>{teachers.length
            ? teachers.slice(0, 2).map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · ')
            : tx('team.collaborationAssignHint')}</em>
        </span>
      </div>
    )
  }

  function renderCollaborationStudentRow(member: TeamMember) {
    const isExpanded = expandedMemberId === member.id
    const displayName = memberDisplayName(member, tx('team.memberFallback'))
    const email = memberEmail(member)
    const busy = rowBusyId === member.id
    const stats = memberStats[member.id]
    const appCount = stats?.applicationCount ?? (member.userId ? applicationCounts?.[member.userId] ?? 0 : 0)
    const riskTotal = (stats?.riskCount ?? 0) + (stats?.watchCount ?? 0)
    const canRemove = memberCanRemove(member)
    const canEnterView = memberCanEnterView(member)
    const canEditRole = memberCanEditRole(member)

    return (
      <article
        key={member.id}
        className={`team-collaboration-row ${isExpanded ? 'expanded' : ''}`}
        onContextMenu={(event) => openMemberContextMenu(event, member)}
      >
        <button
          type="button"
          className="team-collaboration-row-main"
          onClick={() => setExpandedMemberId(isExpanded ? null : member.id)}
          aria-expanded={isExpanded}
        >
          <ChevronDown className="team-collaboration-chevron" size={14} aria-hidden="true" />
          <TeamMemberAvatar member={member} />
          <span className="team-collaboration-identity">
            <strong>{displayName}</strong>
            <em>{email || tx('team.noLinkedEmail')}</em>
          </span>
          <span className="team-collaboration-health">
            <span className={`team-status-chip team-status-${member.status}`}>
              {member.status === 'active' ? <Check size={11} aria-hidden="true" /> : <Clock size={11} aria-hidden="true" />}
              {tx(member.status === 'active' ? 'team.statusActive' : 'team.statusPending')}
            </span>
            {appCount > 0 ? <span>{format(tx('team.applicationCount'), { count: appCount })}</span> : null}
            {riskTotal > 0 ? (
              <span className="is-risk"><AlertTriangle size={11} aria-hidden="true" />{format(tx('team.memberStatRisk'), { count: riskTotal })}</span>
            ) : null}
          </span>
          {renderTeacherAvatarStack(member)}
        </button>

        <CollapsiblePanel
          open={isExpanded}
          className="team-collaboration-detail"
          innerClassName="team-collaboration-detail-inner"
        >
          {renderMemberAccessSummary(member, stats, appCount, riskTotal, false)}
          {member.status === 'active' ? renderRelationshipControls(member) : (
            <p className="team-collaboration-pending-note">
              {format(tx('team.pendingHint'), { email: email || displayName })}
            </p>
          )}
          <div className="team-collaboration-row-actions">
            <div
              className="team-collaboration-primary-actions"
              role="group"
              aria-label={tx('team.columnActions')}
            >
              {canEnterView ? (
                <button
                  type="button"
                  className="quiet-action team-enter-view-action"
                  onClick={() => onImpersonateMember?.(member.userId!)}
                >
                  <LogIn size={13} aria-hidden="true" />
                  {tx('team.enterStudentView')}
                </button>
              ) : null}
              {member.userId && onViewApplications ? (
                <button type="button" className="quiet-action" onClick={() => onViewApplications(member.userId!)}>
                  <FolderOpen size={13} aria-hidden="true" />
                  {appCount ? format(tx('team.viewApplications'), { count: appCount }) : tx('team.viewApplicationsEmpty')}
                </button>
              ) : null}
              {member.userId ? (
                <button
                  type="button"
                  className="quiet-action"
                  onClick={() => {
                    setSelectedResourceStudentId(member.userId)
                    changeTab('resources')
                  }}
                >
                  <UserRound size={13} aria-hidden="true" />
                  {tx('team.teacherOpenStudentProfile')}
                </button>
              ) : null}
              {member.status === 'active' ? (
                <button type="button" className="quiet-action" onClick={() => focusMemberInRelationshipMap(member)}>
                  <Network size={13} aria-hidden="true" />
                  {tx('team.viewRelationshipMap')}
                </button>
              ) : null}
            </div>
            <div className="team-collaboration-governance">
              {canEditRole ? (
                <label className="team-field team-role-field">
                  <span>{tx('team.inviteRoleLabel')}</span>
                  <Select
                    size="small"
                    value={member.role}
                    options={INVITABLE_ROLES.map((role) => ({
                      value: role,
                      label: tx(ROLE_LABEL_KEYS[role]),
                      description: tx(ROLE_DESCRIPTION_KEYS[role]),
                    }))}
                    disabled={busy}
                    ariaLabel={format(tx('team.roleForMember'), { name: displayName })}
                    onChange={(role) => handleRoleChange(member, role as Exclude<TeamRole, 'owner'>)}
                  />
                </label>
              ) : null}
              {canRemove ? (
                <button
                  type="button"
                  className="danger-action team-collaboration-remove-action"
                  disabled={busy}
                  onClick={() => setPendingRemove(member)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {tx('team.removeMemberTitle')}
                </button>
              ) : null}
            </div>
          </div>
        </CollapsiblePanel>
      </article>
    )
  }

  function renderStudentCollaborationWorkspace() {
    return (
      <>
        <div className="team-collaboration-toolbar">
          <label className="team-member-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder={tx('team.collaborationStudentSearch')}
            />
          </label>
          <span className="team-member-filter-count">
            {format(tx('team.memberFilteredCount'), {
              visible: filteredCollaborationStudents.length,
              total: collaborationStudents.length,
            })}
          </span>
          <div className="team-collaboration-toolbar-actions">
            <label className="team-member-filter-select">
              <span className="sr-only">{tx('team.memberStatusFilterLabel')}</span>
              <Select
                size="small"
                value={memberStatusFilter}
                ariaLabel={tx('team.memberStatusFilterLabel')}
                options={[
                  { value: 'all', label: tx('team.memberStatusAll') },
                  { value: 'active', label: tx('team.statusActive') },
                  { value: 'pending', label: tx('team.statusPending') },
                ]}
                onChange={(value) => setMemberStatusFilter(value as TeamMemberStatusFilter)}
              />
            </label>
            <div className="team-member-view-switch" role="tablist" aria-label={tx('team.relationshipViewLabel')}>
              <span className={`team-member-view-indicator ${memberView === 'map' ? 'is-map' : ''}`} aria-hidden="true" />
              <button type="button" className={memberView === 'table' ? 'active' : ''} aria-selected={memberView === 'table'} onClick={() => setMemberView('table')}>
                <Table2 size={13} aria-hidden="true" />
                {tx('team.collaborationListView')}
              </button>
              <button type="button" className={memberView === 'map' ? 'active' : ''} aria-selected={memberView === 'map'} onClick={() => setMemberView('map')}>
                <Network size={13} aria-hidden="true" />
                {tx('team.relationshipViewMap')}
              </button>
            </div>
          </div>
        </div>

        {memberView === 'map' ? renderRelationshipMap(memberMatchesFilter, memberFilterActive) : (
          <div className="team-collaboration-list">
            {filteredCollaborationStudents.length > 0
              ? filteredCollaborationStudents.map(renderCollaborationStudentRow)
              : (
                <div className="team-empty compact">
                  <span className="empty-state-icon"><Search size={18} aria-hidden="true" /></span>
                  <div>
                    <h3>{tx('team.memberNoMatchesTitle')}</h3>
                    <p>{tx('team.memberNoMatchesDesc')}</p>
                  </div>
                  {memberFilterActive ? (
                    <button type="button" className="quiet-action" onClick={() => {
                      setMemberQuery('')
                      setMemberStatusFilter('all')
                    }}>
                      {tx('team.studentProfileClearFilters')}
                    </button>
                  ) : null}
                </div>
              )}
          </div>
        )}
      </>
    )
  }

  function renderTeacherGroupWorkspace() {
    const selectedTitle = activeTeacherGroup?.name
      ?? (selectedTeacherGroupId === 'ungrouped' ? tx('team.teacherGroupUngrouped') : tx('team.teacherGroupAll'))
    const selectedDescription = activeTeacherGroup
      ? format(tx('team.teacherGroupSelectedDesc'), { count: activeTeacherGroup.memberIds.length })
      : selectedTeacherGroupId === 'ungrouped'
        ? tx('team.teacherGroupUngroupedDesc')
        : tx('team.teacherGroupAllDesc')

    return (
      <>
        <div className="team-collaboration-toolbar teacher-groups">
          <label className="team-member-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder={tx('team.teacherGroupSearch')}
            />
          </label>
          <span className="team-member-filter-count">
            {format(tx('team.memberFilteredCount'), {
              visible: filteredTeacherDirectory.length,
              total: teacherDirectory.length,
            })}
          </span>
        </div>

        <div className="team-teacher-group-layout">
          <nav className="team-teacher-group-nav" aria-label={tx('team.teacherGroupsTitle')}>
            <button
              type="button"
              className={selectedTeacherGroupId === 'all' ? 'active' : ''}
              onClick={() => setSelectedTeacherGroupId('all')}
            >
              <span><Users size={13} aria-hidden="true" />{tx('team.teacherGroupAll')}</span>
              <b>{teacherDirectory.length}</b>
            </button>
            {teacherGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={selectedTeacherGroupId === group.id ? 'active' : ''}
                onClick={() => setSelectedTeacherGroupId(group.id)}
              >
                <span><span className="team-teacher-group-dot" aria-hidden="true" />{group.name}</span>
                <b>{group.memberIds.length}</b>
              </button>
            ))}
            <button
              type="button"
              className={selectedTeacherGroupId === 'ungrouped' ? 'active' : ''}
              onClick={() => setSelectedTeacherGroupId('ungrouped')}
            >
              <span><UserRound size={13} aria-hidden="true" />{tx('team.teacherGroupUngrouped')}</span>
              <b>{teacherDirectory.filter((teacher) => !groupedTeacherMemberIds.has(teacher.id)).length}</b>
            </button>
            {teacherGroupCreateOpen ? (
              <form className="team-teacher-group-create is-inline animate-enter" onSubmit={handleCreateTeacherGroup}>
                <label>
                  <span className="sr-only">{tx('team.teacherGroupName')}</span>
                  <input
                    autoFocus
                    value={teacherGroupDraftName}
                    onChange={(event) => setTeacherGroupDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      setTeacherGroupCreateOpen(false)
                      setTeacherGroupDraftName('')
                    }}
                    placeholder={tx('team.teacherGroupNamePlaceholder')}
                    maxLength={40}
                  />
                </label>
                <div className="team-teacher-group-create-actions">
                  <button
                    type="button"
                    className="team-teacher-group-create-cancel"
                    onClick={() => {
                      setTeacherGroupCreateOpen(false)
                      setTeacherGroupDraftName('')
                    }}
                    aria-label={tx('cancel')}
                    title={tx('cancel')}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="submit"
                    className="team-teacher-group-create-confirm"
                    disabled={!teacherGroupDraftName.trim() || teacherGroupBusyId === 'create'}
                    aria-label={tx('team.teacherGroupCreateAction')}
                    title={tx('team.teacherGroupCreateAction')}
                  >
                    {teacherGroupBusyId === 'create'
                      ? <LoaderCircle className="spin-icon" size={13} aria-hidden="true" />
                      : <Check size={13} aria-hidden="true" />}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="team-teacher-group-add-trigger"
                onClick={() => setTeacherGroupCreateOpen(true)}
                aria-expanded={false}
              >
                <span><Plus size={13} aria-hidden="true" />{tx('team.teacherGroupCreate')}</span>
              </button>
            )}
          </nav>

          <div className="team-teacher-group-directory">
            <div className="team-teacher-group-directory-head">
              <div>
                <span className="eyebrow">{tx('team.teacherGroupsEyebrow')}</span>
                {activeTeacherGroup ? (
                  <div className="team-teacher-group-name-editor">
                    <Pencil size={13} aria-hidden="true" />
                    <input
                      value={teacherGroupRenameDraft}
                      onChange={(event) => setTeacherGroupRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleRenameTeacherGroup()
                        }
                        if (event.key === 'Escape') {
                          setTeacherGroupRenameDraft(activeTeacherGroup.name)
                          event.currentTarget.blur()
                        }
                      }}
                      aria-label={tx('team.teacherGroupName')}
                      maxLength={40}
                    />
                  </div>
                ) : <h3>{selectedTitle}</h3>}
                <p>{selectedDescription}</p>
              </div>
              {activeTeacherGroup ? (
                <div className="team-teacher-group-actions">
                  <button
                    type="button"
                    className="quiet-action"
                    disabled={
                      teacherGroupBusyId === activeTeacherGroup.id
                      || !teacherGroupRenameDraft.trim()
                      || teacherGroupRenameDraft.trim() === activeTeacherGroup.name
                    }
                    onClick={() => void handleRenameTeacherGroup()}
                  >
                    <Check size={12} aria-hidden="true" />
                    {tx('save')}
                  </button>
                  <button type="button" className="team-mini-btn team-delete-btn" onClick={() => setPendingTeacherGroupDelete(activeTeacherGroup)} aria-label={tx('team.teacherGroupDelete')}>
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>

            <div className="team-teacher-directory-list">
              {filteredTeacherDirectory.length > 0 ? filteredTeacherDirectory.map((teacher) => {
                const assignedStudents = teacher.userId
                  ? relationshipStudents.filter((student) => isTeacherAssignedToStudent(student, teacher.userId)).length
                  : 0
                const memberships = teacherGroups.filter((group) => group.memberIds.includes(teacher.id))
                const selected = Boolean(activeTeacherGroup?.memberIds.includes(teacher.id))
                const canRemove = memberCanRemove(teacher)
                return (
                  <div key={teacher.id} className="team-teacher-directory-row">
                    <TeamMemberAvatar member={teacher} />
                    <span className="team-collaboration-identity">
                      <strong>{memberDisplayName(teacher, tx('team.memberFallback'))}</strong>
                      <em>{memberEmail(teacher) || tx('team.noLinkedEmail')}</em>
                    </span>
                    <span className="team-teacher-directory-load">
                      {format(tx('team.memberAssignedStudentsDesc'), { count: assignedStudents })}
                    </span>
                    <span className="team-teacher-directory-groups">
                      {memberships.length > 0
                        ? memberships.slice(0, 3).map((group) => <em key={group.id}>{group.name}</em>)
                        : <em>{tx('team.teacherGroupUngrouped')}</em>}
                    </span>
                    <div className="team-teacher-directory-actions">
                      {memberCanEditRole(teacher) ? (
                        <Select
                          size="small"
                          value={teacher.role}
                          options={INVITABLE_ROLES.map((role) => ({
                            value: role,
                            label: tx(ROLE_LABEL_KEYS[role]),
                            description: tx(ROLE_DESCRIPTION_KEYS[role]),
                          }))}
                          disabled={rowBusyId === teacher.id}
                          ariaLabel={format(tx('team.roleForMember'), {
                            name: memberDisplayName(teacher, tx('team.memberFallback')),
                          })}
                          onChange={(role) => handleRoleChange(teacher, role as Exclude<TeamRole, 'owner'>)}
                        />
                      ) : null}
                      {activeTeacherGroup && teacher.status === 'active' ? (
                        <button
                          type="button"
                          className={`team-teacher-group-toggle ${selected ? 'active' : ''}`}
                          aria-pressed={selected}
                          disabled={teacherGroupBusyId === activeTeacherGroup.id}
                          onClick={() => void handleToggleTeacherGroupMember(activeTeacherGroup, teacher.id)}
                        >
                          <Check size={13} aria-hidden="true" />
                          {selected ? tx('team.teacherGroupIncluded') : tx('team.teacherGroupAdd')}
                        </button>
                      ) : null}
                      {canRemove ? (
                        <button type="button" className="team-mini-btn team-delete-btn" onClick={() => setPendingRemove(teacher)} aria-label={tx('team.removeMemberTitle')}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              }) : (
                <div className="team-empty compact">
                  <span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span>
                  <div>
                    <h3>{tx('team.teacherGroupEmpty')}</h3>
                    <p>{tx('team.teacherGroupEmptyDesc')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  const renderOwnContactProfile = () => {
    if (!viewerTeamMember || !canEditContactProfile) return null

    const savedProfile = teamContactProfileDraft(viewerTeamMember)
    const visibleProfile = contactProfileOpen ? contactProfileDraft : savedProfile
    const completedFieldCount = Object.values(visibleProfile)
      .filter((value) => value.trim().length > 0)
      .length
    const completionPercent = Math.round((completedFieldCount / Object.keys(emptyTeamContactProfile).length) * 100)
    const profileReady = Boolean(
      visibleProfile.title
      && visibleProfile.contactEmail
      && (visibleProfile.phone || visibleProfile.office || visibleProfile.availability || visibleProfile.bio),
    )
    const roleLabel = tx(ROLE_LABEL_KEYS[viewerTeamMember.role])
    const profileMeta = [
      visibleProfile.title || roleLabel,
      visibleProfile.department,
    ].filter(Boolean).join(' · ')

    const updateDraft = (field: keyof TeamMemberContactProfile, value: string) => {
      setContactProfileDraft((current) => ({ ...current, [field]: value }))
    }

    return (
      <section className={`team-contact-profile${contactProfileOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="team-contact-profile-summary"
          aria-expanded={contactProfileOpen}
          aria-controls="team-contact-profile-editor"
          disabled={contactProfileBusy}
          onClick={() => {
            if (!contactProfileOpen) setContactProfileDraft(savedProfile)
            setContactProfileOpen((current) => !current)
          }}
        >
          <TeamMemberAvatar member={viewerTeamMember} className="team-contact-profile-avatar" />
          <span className="team-contact-profile-copy">
            <small>{tx('team.contactProfileEyebrow')}</small>
            <strong>{memberDisplayName(viewerTeamMember, tx('team.memberFallback'))}</strong>
            <em>{profileMeta}</em>
          </span>
          <span
            className={`team-contact-profile-readiness${profileReady ? ' is-ready' : ''}`}
            style={{ '--team-contact-progress': `${completionPercent}%` } as CSSProperties}
          >
            <span aria-hidden="true"><i /></span>
            <small>{format(tx('team.contactProfileProgress'), {
              completed: completedFieldCount,
              total: Object.keys(emptyTeamContactProfile).length,
            })}</small>
            <strong>{tx(profileReady ? 'team.contactProfileReady' : 'team.contactProfileNeedsDetails')}</strong>
          </span>
          <span className="team-contact-profile-edit-label">
            <Pencil size={13} aria-hidden="true" />
            {tx('team.contactProfileEdit')}
          </span>
          <ChevronDown size={15} aria-hidden="true" className="team-contact-profile-chevron" />
        </button>

        <CollapsiblePanel
          open={contactProfileOpen}
          id="team-contact-profile-editor"
          className="team-contact-profile-collapse"
          innerClassName="team-contact-profile-editor"
          keepMounted
        >
          <form onSubmit={handleTeamContactProfileSave} aria-busy={contactProfileBusy}>
            <div className="team-contact-profile-form-grid">
              <label>
                <span>{tx('team.contactProfileTitleField')}</span>
                <input
                  value={contactProfileDraft.title}
                  maxLength={120}
                  onChange={(event) => updateDraft('title', event.target.value)}
                />
              </label>
              <label>
                <span>{tx('team.contactProfileDepartmentField')}</span>
                <input
                  value={contactProfileDraft.department}
                  maxLength={160}
                  onChange={(event) => updateDraft('department', event.target.value)}
                />
              </label>
              <label>
                <span>{tx('team.contactProfileEmailField')}</span>
                <input
                  type="email"
                  value={contactProfileDraft.contactEmail}
                  maxLength={254}
                  placeholder="name@university.edu"
                  onChange={(event) => updateDraft('contactEmail', event.target.value)}
                />
              </label>
              <label>
                <span>{tx('team.contactProfilePhoneField')}</span>
                <input
                  type="tel"
                  value={contactProfileDraft.phone}
                  maxLength={48}
                  placeholder="+44 20 0000 0000"
                  onChange={(event) => updateDraft('phone', event.target.value)}
                />
              </label>
              <label>
                <span>{tx('team.contactProfileOfficeField')}</span>
                <input
                  value={contactProfileDraft.office}
                  maxLength={160}
                  onChange={(event) => updateDraft('office', event.target.value)}
                />
              </label>
              <label>
                <span>{tx('team.contactProfileWebsiteField')}</span>
                <input
                  type="url"
                  value={contactProfileDraft.website}
                  maxLength={300}
                  onChange={(event) => updateDraft('website', event.target.value)}
                />
              </label>
              <label className="team-contact-profile-full-field">
                <span>{tx('team.contactProfileAvailabilityField')}</span>
                <input
                  value={contactProfileDraft.availability}
                  maxLength={200}
                  onChange={(event) => updateDraft('availability', event.target.value)}
                />
              </label>
              <label className="team-contact-profile-full-field">
                <span>{tx('team.contactProfileBioField')}</span>
                <textarea
                  rows={3}
                  value={contactProfileDraft.bio}
                  maxLength={800}
                  onChange={(event) => updateDraft('bio', event.target.value)}
                />
              </label>
            </div>
            <footer className="team-contact-profile-actions">
              <p>{tx('team.contactProfileVisibilityHint')}</p>
              <div>
                <button
                  type="button"
                  className="quiet-action"
                  disabled={contactProfileBusy}
                  onClick={() => {
                    setContactProfileDraft(savedProfile)
                    setContactProfileOpen(false)
                  }}
                >
                  {tx('cancel')}
                </button>
                <button type="submit" className="primary-action" disabled={contactProfileBusy}>
                  {contactProfileBusy
                    ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
                    : <Check size={14} aria-hidden="true" />}
                  {tx(contactProfileBusy ? 'team.contactProfileSaving' : 'save')}
                </button>
              </div>
            </footer>
          </form>
        </CollapsiblePanel>
      </section>
    )
  }

  const renderMembers = () => {
    if (viewerRole === 'member') return renderStudentOverview()
    return (
      <div className="team-tab-panel team-collaboration-page">
        <div className="team-layout single-column members-fullwidth">
          {memberRevealStep >= 2 ? renderNotificationLauncher() : null}
          <section className="team-panel team-collaboration-panel">
            <div className="team-collaboration-hero">
              <div>
                <span className="eyebrow">{tx('team.collaborationEyebrow')}</span>
                <h3>{tx('team.collaborationTitle')}</h3>
                <p>{tx(viewerRole === 'admin' ? 'team.collaborationTeacherDesc' : 'team.collaborationOwnerDesc')}</p>
              </div>
              {canInvite ? (
                <div className="team-collaboration-hero-actions">
                  <AnchoredPopover
                    triggerAriaLabel={tx('team.joinCodeTitle')}
                    popoverAriaLabel={tx('team.joinCodeTitle')}
                    triggerClassName="quiet-action"
                    popoverClassName="team-invite-popover-shell"
                    width={400}
                    estimatedHeight={540}
                    align="end"
                    trigger={<><KeyRound size={14} aria-hidden="true" />{tx('team.joinCodeButton')}</>}
                  >
                    {() => (
                      <TeamJoinCodeGenerator
                        roles={viewerRole === 'owner' ? ['admin', 'member'] : ['member']}
                        teachers={invitationTeachers}
                        defaultRole="member"
                        defaultTeacherIds={inviteTeacherIds}
                        onGenerate={(input) => phdApi.createTeamJoinCode(
                          session.token,
                          summary!.team.id,
                          input,
                        )}
                      />
                    )}
                  </AnchoredPopover>
                  <AnchoredPopover
                    triggerAriaLabel={tx('team.inviteTitle')}
                    popoverAriaLabel={tx('team.inviteTitle')}
                    triggerClassName="primary-action team-invite-trigger"
                    popoverClassName="team-invite-popover-shell"
                    width={380}
                    estimatedHeight={520}
                    align="end"
                    trigger={<><UserPlus size={14} aria-hidden="true" />{tx('team.inviteTitle')}</>}
                  >
                    {(close) => renderInvitePopover(close)}
                  </AnchoredPopover>
                </div>
              ) : null}
            </div>

            {renderOwnContactProfile()}

            <div className="team-collaboration-metrics" aria-label={tx('team.collaborationMetricsLabel')}>
              <span><strong>{activeStudents}</strong><em>{tx('team.memberOpsStudents')}</em></span>
              <span><strong>{activeTeachers}</strong><em>{tx('team.memberOpsTeachers')}</em></span>
              <span className={unassignedStudentCount > 0 ? 'needs-attention' : ''}><strong>{unassignedStudentCount}</strong><em>{tx('team.collaborationUnassignedMetric')}</em></span>
              <span><strong>{pendingMembers.length}</strong><em>{tx('team.memberOpsPending')}</em></span>
            </div>

            <div className="team-collaboration-mode-switch" role="tablist" aria-label={tx('team.collaborationModeLabel')}>
              <span className={`team-collaboration-mode-indicator ${memberWorkspaceView === 'teacher-groups' ? 'is-groups' : ''}`} aria-hidden="true" />
              <button type="button" className={memberWorkspaceView === 'students' ? 'active' : ''} aria-selected={memberWorkspaceView === 'students'} onClick={() => setMemberWorkspaceView('students')}>
                <Users size={14} aria-hidden="true" />
                <span>{tx('team.collaborationStudentsTab')}</span>
                <b>{collaborationStudents.length}</b>
              </button>
              <button type="button" className={memberWorkspaceView === 'teacher-groups' ? 'active' : ''} aria-selected={memberWorkspaceView === 'teacher-groups'} onClick={() => setMemberWorkspaceView('teacher-groups')}>
                <Network size={14} aria-hidden="true" />
                <span>{tx('team.teacherGroupsTitle')}</span>
                <b>{teacherGroups.length}</b>
              </button>
            </div>

            <div className="team-collaboration-workspace">
              {memberWorkspaceView === 'students'
                ? renderStudentCollaborationWorkspace()
                : renderTeacherGroupWorkspace()}
            </div>
          </section>
        </div>
      </div>
    )
  }

  const renderAudit = () => {
    if (!hasOwnerAuditAccess(viewerRole)) return null

    const approvalRequest = pendingTransferRequests.find((request) => request.id === selectedTransferRequestId)
      ?? pendingTransferRequests[0]
      ?? null
    const approvalApplication = approvalRequest ? applicationsById.get(approvalRequest.applicationId) ?? null : null
    const approvalTeachers = (summary?.members ?? []).filter((member) => (
      member.role === 'admin' && member.status === 'active' && Boolean(member.userId)
    ))
    const approvalBusy = Boolean(approvalRequest && transferBusyId === approvalRequest.id)
    const approvalRequiresTeacher = approvalRequest?.direction === 'join'
    const approvalCanSubmit = Boolean(
      approvalRequest
      && approvalRequest.preflight.eligible
      && (!approvalRequiresTeacher || selectedTransferTeacherId)
      && !approvalBusy,
    )
    const approvalCheckIcon = {
      permission: ShieldCheck,
      applicationQuota: FileText,
      storage: Database,
    } as const

    if (hasOwnerAuditAccess(viewerRole)) return (
      <section className="team-transfer-audit">
        <header className="team-transfer-audit-hero">
          <div>
            <span className="eyebrow">{tx('team.transferQueueEyebrow')}</span>
            <h2>{format(tx('team.transferQueueTitle'), { count: pendingTransferRequests.length })}</h2>
            <p>{tx('team.transferQueueDesc')}</p>
          </div>
          <span className="team-transfer-audit-count" aria-label={format(tx('team.transferQueueTitle'), { count: pendingTransferRequests.length })}>
            {pendingTransferRequests.length}
          </span>
        </header>

        {pendingTransferRequests.length === 0 ? (
          <div className="team-transfer-audit-empty">
            <span aria-hidden="true"><ShieldCheck size={20} /></span>
            <div>
              <h3>{tx('team.transferNoRequestsTitle')}</h3>
              <p>{tx('team.transferNoRequestsDesc')}</p>
            </div>
          </div>
        ) : (
          <div className="team-transfer-audit-layout">
            <section className="team-transfer-audit-queue" aria-label={tx('team.transferSelectRequestTitle')}>
              <div className="team-transfer-audit-section-head">
                <div>
                  <h3>{tx('team.transferSelectRequestTitle')}</h3>
                  <p>{tx('team.transferSelectRequestDesc')}</p>
                </div>
                <span>{pendingTransferRequests.length}</span>
              </div>
              <div className="team-transfer-audit-list">
                {pendingTransferRequests.map((request) => {
                  const selected = request.id === approvalRequest?.id
                  return (
                    <button
                      key={request.id}
                      type="button"
                      className={selected ? 'selected' : ''}
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedTransferRequestId(request.id)
                        setSelectedTransferTeacherId('')
                      }}
                    >
                      <span className={`team-transfer-audit-direction direction-${request.direction}`} aria-hidden="true">
                        {request.direction === 'join' ? <ArrowRight size={14} /> : <X size={14} />}
                      </span>
                      <span className="team-transfer-audit-request-copy">
                        <strong>{request.applicationName}</strong>
                        <em>{request.program}</em>
                        <small>
                          {request.ownerName || request.ownerEmail || tx('team.memberFallback')}
                          {' · '}
                          {formatMemberDate(request.requestedAt, lang)}
                        </small>
                      </span>
                      <span className={`team-transfer-audit-eligibility${request.preflight.eligible ? ' eligible' : ' blocked'}`}>
                        {request.preflight.eligible
                          ? tx('dossier.teamTransferAvailable')
                          : tx('dossier.teamTransferUnavailable')}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            {approvalRequest ? (
              <aside className="team-transfer-audit-detail" aria-label={approvalRequest.applicationName}>
                <header className="team-transfer-audit-detail-head">
                  <div>
                    <span className="eyebrow">{tx('team.transferQueueEyebrow')}</span>
                    <h3>{approvalRequest.applicationName}</h3>
                    <p>{approvalRequest.program}</p>
                  </div>
                  {approvalApplication && onOpenApplication ? (
                    <button
                      type="button"
                      className="quiet-action compact-action"
                      onClick={() => onOpenApplication(approvalRequest.applicationId)}
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                      {tx('team.transferOpenApplication')}
                    </button>
                  ) : null}
                </header>

                <div className="team-transfer-audit-flow" aria-label={tx(
                  approvalRequest.direction === 'join' ? 'team.transferDirectionJoin' : 'team.transferDirectionLeave',
                )}>
                  <span>
                    <small>{approvalRequest.direction === 'join' ? tx('team.transferPersonalSpace') : tx('team.transferOrganizationSpace')}</small>
                    <strong>{approvalRequest.direction === 'join'
                      ? approvalRequest.ownerName || approvalRequest.ownerEmail
                      : summary?.team.name}</strong>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                  <span>
                    <small>{approvalRequest.direction === 'join' ? tx('team.transferOrganizationSpace') : tx('team.transferPersonalSpace')}</small>
                    <strong>{approvalRequest.direction === 'join'
                      ? summary?.team.name
                      : approvalRequest.ownerName || approvalRequest.ownerEmail}</strong>
                  </span>
                </div>

                <section className="team-transfer-audit-preflight">
                  <h4>{tx('dossier.teamTransferPreflightTitle')}</h4>
                  <div>
                    {approvalRequest.preflight.checks.map((check) => {
                      const Icon = approvalCheckIcon[check.id]
                      return (
                        <span key={check.id} className={check.ok ? 'passed' : 'blocked'}>
                          <Icon size={14} aria-hidden="true" />
                          <strong>{tx(`dossier.teamTransferCheck${check.id[0].toUpperCase()}${check.id.slice(1)}`)}</strong>
                          {check.ok
                            ? <Check size={14} aria-label={tx('dossier.teamTransferCheckPassed')} />
                            : <AlertTriangle size={14} aria-label={tx('dossier.teamTransferCheckFailed')} />}
                        </span>
                      )
                    })}
                  </div>
                  {!approvalRequest.preflight.eligible ? <p>{tx('team.transferBlockedDesc')}</p> : null}
                </section>

                {approvalRequiresTeacher ? (
                  <section className="team-transfer-audit-teachers">
                    <div className="team-transfer-audit-section-head">
                      <div>
                        <h4>{tx('team.transferAssignTeacher')}</h4>
                        <p>{tx('team.transferAssignTeacherDesc')}</p>
                      </div>
                    </div>
                    <div className="team-transfer-audit-teacher-list">
                      {approvalTeachers.map((teacher) => {
                        const teacherUserId = teacher.userId as string
                        const supervised = relationshipStudents.filter((student) => (
                          isTeacherAssignedToStudent(student, teacherUserId)
                        ))
                        const applicationLoad = supervised.reduce((total, student) => (
                          total + (applicationCounts?.[student.userId ?? ''] ?? 0)
                        ), 0)
                        const selected = selectedTransferTeacherId === teacher.id
                        return (
                          <button
                            key={teacher.id}
                            type="button"
                            className={selected ? 'selected' : ''}
                            aria-pressed={selected}
                            onClick={() => setSelectedTransferTeacherId(teacher.id)}
                          >
                            <span className="team-transfer-audit-radio" aria-hidden="true">
                              {selected ? <Check size={11} /> : null}
                            </span>
                            <TeamMemberAvatar member={teacher} className="team-transfer-audit-teacher-avatar" />
                            <span>
                              <strong>{memberDisplayName(teacher, tx('team.memberFallback'))}</strong>
                              <em>{format(tx('team.transferTeacherLoad'), {
                                students: supervised.length,
                                applications: applicationLoad,
                              })}</em>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {approvalTeachers.length === 0 || !selectedTransferTeacherId ? (
                      <p className="team-transfer-audit-teacher-required">{tx('team.transferTeacherRequired')}</p>
                    ) : null}
                  </section>
                ) : null}

                <div className="team-transfer-audit-auto-note">
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>{tx('team.transferAutoResolutionNote')}</span>
                </div>

                <footer className="team-transfer-audit-actions">
                  <button
                    type="button"
                    className="quiet-action"
                    disabled={approvalBusy}
                    onClick={() => void handleTransferDecision(approvalRequest.id, 'reject')}
                  >
                    <X size={13} aria-hidden="true" />
                    {tx('team.transferReject')}
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={!approvalCanSubmit}
                    onClick={() => void handleTransferDecision(
                      approvalRequest.id,
                      'approve',
                      approvalRequiresTeacher ? selectedTransferTeacherId : undefined,
                    )}
                  >
                    <Check size={13} aria-hidden="true" />
                    {approvalBusy
                      ? tx('working')
                      : approvalRequiresTeacher
                        ? tx('team.transferApproveAndAssign')
                        : tx('team.transferApprove')}
                  </button>
                </footer>
              </aside>
            ) : null}
          </div>
        )}
      </section>
    )

    const allAuditEvents = summary?.recentEvents ?? []
    const selectedOwnerId = selectedAuditStudentId === 'all' ? null : selectedAuditStudentId
    const ownerForEvent = (event: SystemEvent) => {
      const metadata = eventMetadata(event)
      return eventApplicationOwnerId(event)
        ?? (metadata.applicationId ? applicationsById.get(metadata.applicationId)?.ownerId ?? null : null)
    }
    const applicationForEvent = (event: SystemEvent) => {
      const applicationId = eventMetadata(event).applicationId
      return applicationId ? applicationsById.get(applicationId) ?? null : null
    }
    const studentLabelForEvent = (event: SystemEvent) => {
      const ownerId = ownerForEvent(event)
      const owner = ownerId ? membersByUserId.get(ownerId) : null
      return owner ? memberDisplayName(owner, tx('team.memberFallback')) : tx('team.gitUnknownStudent')
    }
    const eventContextLabel = (event: SystemEvent) => {
      const application = applicationForEvent(event)
      const student = studentLabelForEvent(event)
      return application
        ? format(tx('team.auditEventContext'), { student, application: application.school.name })
        : format(tx('team.auditEventContextNoApp'), { student })
    }
    const eventMatchesSelectedStudent = (event: SystemEvent) => {
      const ownerId = ownerForEvent(event)
      return !selectedOwnerId || ownerId === selectedOwnerId
    }
    const auditEvents = allAuditEvents
      .filter(canAccessAuditEvent)
      .filter(eventMatchesSelectedStudent)
    const conflictEvents = auditEvents.filter(isManualMergeEvent)
    const automaticEvents = auditEvents.filter(isAutomaticMergeAuditEvent)
    const visibleAuditEvents = auditExpanded ? conflictEvents : conflictEvents.slice(0, 7)
    const mergeSourceEventFor = (event: SystemEvent) => {
      const flaggedId = eventMetadata(event).flaggedConflictForEventId
      return flaggedId
        ? allAuditEvents.find((candidate) => candidate.id === flaggedId) ?? event
        : event
    }
    const defaultAuditEvent = visibleAuditEvents[0]
      ?? null
    const selectedAuditEvent = conflictEvents.find((event) => event.id === selectedAuditEventId)
      ?? mergePreviewEvent
      ?? defaultAuditEvent
    const selectedMergeSourceEvent = selectedAuditEvent ? mergeSourceEventFor(selectedAuditEvent) : null
    const selectedAuditFields = selectedAuditEvent ? changedFields(selectedAuditEvent) : []
    const selectedAuditMetadata = selectedAuditEvent ? eventMetadata(selectedAuditEvent) : {}
    const selectedAuditRestorable = Boolean(selectedAuditEvent && canRestore && canRestoreAuditEvent(selectedAuditEvent))
    const selectedAuditMergeable = Boolean(selectedMergeSourceEvent && canPreviewMergeEvent(selectedMergeSourceEvent))
    const selectedAuditStatus = selectedAuditEvent
      ? auditStatus(selectedAuditEvent, selectedAuditMergeable, selectedAuditRestorable)
      : 'logged'
    const selectedAuditSummary = selectedAuditEvent
      ? auditFieldSummary(selectedAuditFields, tx, format, lang)
      : ''
    const mergeDecisionTone = !mergePreview
      ? 'idle'
      : mergePreview.conflictCount > 0
        ? 'conflict'
        : mergePreview.cleanCount > 0
          ? 'clean'
          : 'same'
    return (
    <div className="team-tab-panel">
      <div className="team-activity-grid">
        <section className="team-panel">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{tx('team.auditEyebrow')}</span>
              <h3>{tx('team.gitStudentVersionTitle')}</h3>
            </div>
            <History size={16} aria-hidden="true" />
          </div>
          <div className="team-git-scope-bar">
            <div>
              <span>{tx('team.gitStudentScope')}</span>
              <Select
                value={selectedAuditStudentId}
                options={auditStudentOptions}
                onChange={(value) => {
                  setSelectedAuditStudentId(value)
                  setSelectedAuditEventId(null)
                  setAuditExpanded(false)
                  clearMergePreview()
                }}
                ariaLabel={tx('team.gitStudentScope')}
                size="small"
                searchable
              />
            </div>
          </div>
          <div className="team-git-stats">
            <span>
              <strong>{conflictEvents.length}</strong>
              <em>{tx('team.gitConflictQueue')}</em>
            </span>
            <span>
              <strong>{automaticEvents.length}</strong>
              <em>{tx('team.gitAutoMergedCount')}</em>
            </span>
            <span>
              <strong>{auditEvents.length}</strong>
              <em>{tx('team.gitAuditTotal')}</em>
            </span>
          </div>
          {auditEvents.length === 0 ? (
            <div className="team-empty compact">
              <span className="empty-state-icon"><History size={18} aria-hidden="true" /></span>
              <div>
                <h3>{tx('team.noAuditEvents')}</h3>
                <p>{tx('team.noAuditEventsDesc')}</p>
              </div>
            </div>
          ) : conflictEvents.length === 0 ? (
            <div className="team-empty compact">
              <span className="empty-state-icon"><GitMerge size={18} aria-hidden="true" /></span>
              <div>
                <h3>{tx('team.gitNoManualQueueTitle')}</h3>
              </div>
            </div>
          ) : (
            <div className="team-version-queue">
              <div className="team-version-queue-head">
                <span>{tx('team.auditManualQueueTitle')}</span>
                <em>{format(tx('team.auditManualQueueCount'), { count: conflictEvents.length })}</em>
              </div>
              <div className="team-version-timeline">
                {conflictEvents.map((event, index) => {
                  const fields = changedFields(event)
                  const restorable = canRestore && canRestoreAuditEvent(event)
                  const mergeSourceEvent = mergeSourceEventFor(event)
                  const mergeable = canPreviewMergeEvent(mergeSourceEvent)
                  const metadata = eventMetadata(event)
                  const status = auditStatus(event, mergeable, restorable)
                  const summaryText = auditFieldSummary(fields, tx, format, lang)
                  const eventRow = (
                    <article
                      className={`team-version-row status-${status} ${selectedAuditEvent?.id === event.id ? 'selected' : ''}`}
                      tabIndex={0}
                      onClick={() => {
                        setSelectedAuditEventId(event.id)
                        if (mergePreview && mergePreview.eventId !== event.id) clearMergePreview()
                      }}
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return
                        keyEvent.preventDefault()
                        setSelectedAuditEventId(event.id)
                        if (mergePreview && mergePreview.eventId !== event.id) clearMergePreview()
                      }}
                      onContextMenu={(contextEvent) => openAuditContextMenu(contextEvent, event)}
                    >
                      <div className="team-version-rail" aria-hidden="true">
                        <span />
                        {index < conflictEvents.length - 1 ? <i /> : null}
                      </div>
                      <div className="team-version-card">
                        <div className="team-version-main">
                          <div className="team-version-copy">
                            <div className="team-version-context">
                              <FileText size={12} aria-hidden="true" />
                              <span>{eventContextLabel(event)}</span>
                            </div>
                            <div className="team-version-title-row">
                              <strong>{localizeAuditMessage(event.message, tx)}</strong>
                              <span className={`team-version-status status-${status}`}>{tx(`team.auditStatus${status[0].toUpperCase()}${status.slice(1)}`)}</span>
                            </div>
                            <span>{auditActorLabel(event)} · {eventTime(event.time, lang)}</span>
                            {summaryText ? <p className="team-version-summary">{summaryText}</p> : null}
                          </div>
                          <div className="team-version-actions">
                            {mergeable ? (
                              <button
                                type="button"
                                className="quiet-action compact-action"
                                disabled={mergeBusyId === mergeSourceEvent.id}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation()
                                  handlePreviewMerge(mergeSourceEvent)
                                }}
                              >
                                <GitMerge size={12} aria-hidden="true" />
                                {mergeBusyId === mergeSourceEvent.id ? tx('working') : tx('team.auditMergePreview')}
                              </button>
                            ) : null}
                            {restorable ? (
                              <button
                                type="button"
                                className="quiet-action compact-action"
                                disabled={restoreBusyId === event.id}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation()
                                  setPendingRestore(event)
                                }}
                              >
                                <RotateCcw size={12} aria-hidden="true" />
                                {restoreBusyId === event.id ? tx('working') : tx('team.auditRestore')}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="team-version-meta">
                          {fields.slice(0, 3).map((field) => <em key={field}>{mergeFieldPath(field)}</em>)}
                          {fields.length > 3 ? <em>{format(tx('team.changedFieldsMore'), { count: fields.length - 3 })}</em> : null}
                          {metadata.mergedFromEventId ? <em>{format(tx('team.auditMergedFrom'), { id: shortEventId(metadata.mergedFromEventId) })}</em> : null}
                          {metadata.restoredFromEventId ? <em>{format(tx('team.auditRestoredFrom'), { id: shortEventId(metadata.restoredFromEventId) })}</em> : null}
                          {metadata.flaggedConflictForEventId ? <em>{format(tx('team.auditManualFor'), { id: shortEventId(metadata.flaggedConflictForEventId) })}</em> : null}
                          {typeof metadata.conflictCount === 'number' ? <em>{format(tx('team.auditConflictCount'), { count: metadata.conflictCount })}</em> : null}
                        </div>
                      </div>
                    </article>
                  )
                  if (index < 7) return <div key={event.id} className="team-version-row-stage">{eventRow}</div>
                  return (
                    <CollapsiblePanel
                      key={event.id}
                      open={auditExpanded}
                      keepMounted
                      className="team-version-extra-collapse"
                      innerClassName="team-version-extra-collapse-inner"
                      openMs={380}
                      closeMs={320}
                    >
                      {eventRow}
                    </CollapsiblePanel>
                  )
                })}
                {conflictEvents.length > 7 ? (
                  <button type="button" className="team-version-expand" onClick={() => setAuditExpanded((current) => !current)}>
                    <History size={12} aria-hidden="true" />
                    <InlinePresence present={auditExpanded} className="team-version-expand-label" parentGap="6px">
                      <span>{tx('team.auditShowLess')}</span>
                    </InlinePresence>
                    <InlinePresence present={!auditExpanded} className="team-version-expand-label" parentGap="6px">
                      <span>{format(tx('team.auditShowMore'), { count: conflictEvents.length - 7 })}</span>
                    </InlinePresence>
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <section className="team-panel">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">{mergePreview ? tx('team.mergePreviewEyebrow') : selectedAuditEvent ? tx('team.auditDetailEyebrow') : tx('team.recoveryEyebrow')}</span>
              <h3>{mergePreview ? tx('team.mergePreviewTitle') : selectedAuditEvent ? tx('team.auditDetailTitle') : tx('team.recoveryTitle')}</h3>
            </div>
            <GitMerge size={16} aria-hidden="true" />
          </div>
          {mergePreview ? (
            <div className="team-merge-preview">
              <div className="team-merge-intro">
                <span className="team-merge-app-chip">
                  <FileText size={12} aria-hidden="true" />
                  {mergePreview.application.school.name}
                </span>
                <strong>{tx('team.mergeDecisionTitle')}</strong>
                {mergePreviewEvent ? (
                  <div className="team-merge-source-row">
                    <span>{auditActorLabel(mergePreviewEvent)}</span>
                    <span>{eventTime(mergePreviewEvent.time, lang)}</span>
                    <span>{localizeAuditMessage(mergePreviewEvent.message, tx)}</span>
                  </div>
                ) : null}
              </div>
              <div className={`team-merge-decision-strip tone-${mergeDecisionTone}`}>
                <span aria-hidden="true">
                  {mergeDecisionTone === 'conflict'
                    ? <AlertTriangle size={15} />
                    : mergeDecisionTone === 'clean'
                      ? <GitMerge size={15} />
                      : <Check size={15} />}
                </span>
                <div>
                  <strong>{tx(`team.mergeDecision${mergeDecisionTone[0].toUpperCase()}${mergeDecisionTone.slice(1)}`)}</strong>
                  <p>{format(tx('team.mergeDecisionSummary'), {
                    clean: mergePreview.cleanCount,
                    conflict: mergePreview.conflictCount,
                    same: mergePreview.sameCount,
                    selected: selectedMergeFields.length,
                  })}</p>
                </div>
              </div>
              <div className="team-merge-summary">
                <span><strong>{mergePreview.cleanCount}</strong><em>{tx('team.mergeCleanFields')}</em></span>
                <span><strong>{mergePreview.conflictCount}</strong><em>{tx('team.mergeConflictFields')}</em></span>
                <span><strong>{mergePreview.sameCount}</strong><em>{tx('team.mergeSameFields')}</em></span>
              </div>
              <div className="team-merge-field-list">
                {mergePreview.fields.length === 0 ? (
                  <div className="team-review-empty">{tx('team.mergeNoFields')}</div>
                ) : mergeFieldGroups(mergePreview.fields).map((group) => (
                  <section key={group.key} className="team-merge-section">
                    <div className="team-merge-section-head">
                      <span>{group.label}</span>
                      <em>{format(tx('team.mergeSectionCount'), { count: group.fields.length })}</em>
                    </div>
                    <div className="team-merge-section-fields">
                      {group.fields.map((field) => {
                        const selectable = field.status === 'clean'
                        const selected = selectedMergeFields.includes(field.field)
                        const label = mergeFieldLabel(field.field, tx, format)
                        const changeKindKey = mergeChangeKindKey(field)
                        const impact = mergeImpactText(field, label, tx, format)
                        const conflictDeltaKey = mergeConflictDeltaKey(field)
                        return (
                          <article key={field.field} className={`team-merge-field status-${field.status} ${selected ? 'selected' : ''}`}>
                            <div className="team-merge-field-head">
                              <div className="team-merge-checkline">
                                {selectable ? (
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={mergeApplyBusy}
                                    aria-label={format(tx('team.mergeToggleField'), { field: label })}
                                    onChange={() => toggleMergeField(field.field)}
                                  />
                                ) : (
                                  <span className={`team-merge-state-dot status-${field.status}`} aria-hidden="true">
                                    {field.status === 'conflict'
                                      ? <AlertTriangle size={11} />
                                      : <Check size={11} />}
                                  </span>
                                )}
                                <span>
                                  <strong>{label}</strong>
                                  <em>{mergeFieldPath(field.field)}</em>
                                </span>
                              </div>
                              <span className={`team-merge-status-pill status-${field.status}`}>
                                {tx(`team.mergeStatus${field.status[0].toUpperCase()}${field.status.slice(1)}`)}
                              </span>
                            </div>
                            <div className="team-merge-field-brief">
                              <span className={`team-merge-change-kind status-${field.status}`}>
                                {tx(changeKindKey)}
                              </span>
                              <p>{impact}</p>
                            </div>
                            <p className="team-merge-recommendation">{tx(mergeStatusRecommendationKey(field.status))}</p>
                            {field.status === 'same' ? (
                              <div className="team-merge-readable-values same">
                                <span className="team-merge-value-row current">
                                  <small>{tx('team.mergeCurrentKept')}</small>
                                  <b>{formatMergeValue(field.currentValue, tx, format)}</b>
                                </span>
                              </div>
                            ) : field.status === 'conflict' ? (
                              <div className="team-merge-readable-values conflict">
                                <p className="team-merge-conflict-note">{tx(conflictDeltaKey)}</p>
                                <span className="team-merge-value-row incoming">
                                  <small>{tx('team.mergeIncomingChange')}</small>
                                  <b>{formatMergeValue(field.eventValue, tx, format)}</b>
                                </span>
                                <span className="team-merge-value-row current">
                                  <small>{tx('team.mergeCurrentVersion')}</small>
                                  <b>{formatMergeValue(field.currentValue, tx, format)}</b>
                                </span>
                                <span className="team-merge-value-row base">
                                  <small>{tx('team.mergeCommonBase')}</small>
                                  <b>{formatMergeValue(field.baseValue, tx, format)}</b>
                                </span>
                              </div>
                            ) : (
                              <div className="team-merge-readable-values clean">
                                <span className="team-merge-value-row removed">
                                  <small>{tx('team.mergeWillReplace')}</small>
                                  <b>{formatMergeValue(field.baseValue, tx, format)}</b>
                                </span>
                                <span className="team-merge-arrow" aria-hidden="true">
                                  <ArrowRight size={13} />
                                </span>
                                <span className="team-merge-value-row added">
                                  <small>{tx('team.mergeWillBecome')}</small>
                                  <b>{formatMergeValue(field.eventValue, tx, format)}</b>
                                </span>
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <div className="team-merge-actions">
                <button type="button" className="quiet-action" onClick={clearMergePreview} disabled={mergeApplyBusy || mergeConflictBusy}>
                  <X size={12} aria-hidden="true" />
                  {tx('cancel')}
                </button>
                {mergePreview.conflictCount > 0 ? (
                  <button type="button" className="quiet-action" onClick={handleFlagMergeConflict} disabled={mergeConflictBusy}>
                    <AlertTriangle size={12} aria-hidden="true" />
                    {mergeConflictBusy ? tx('working') : tx('team.flagMergeConflict')}
                  </button>
                ) : null}
                <button type="button" className="primary-action" onClick={handleApplyMerge} disabled={mergeApplyBusy || mergeConflictBusy || selectedMergeFields.length === 0}>
                  <GitMerge size={13} aria-hidden="true" />
                  {mergeApplyBusy
                    ? tx('working')
                    : mergePreview.conflictCount === 0
                      ? format(tx('team.autoMergeClean'), { count: selectedMergeFields.length })
                      : format(tx('team.applySelectedMerge'), { count: selectedMergeFields.length })}
                </button>
              </div>
            </div>
          ) : selectedAuditEvent ? (
            <div className="team-audit-detail">
              <div className="team-audit-detail-card">
                <span className={`team-version-status status-${selectedAuditStatus}`}>
                  {tx(`team.auditStatus${selectedAuditStatus[0].toUpperCase()}${selectedAuditStatus.slice(1)}`)}
                </span>
                <strong>{localizeAuditMessage(selectedAuditEvent.message, tx)}</strong>
                <p>
                  {applicationForEvent(selectedAuditEvent)
                    ? format(tx('team.auditDetailContextWithApp'), {
                        student: studentLabelForEvent(selectedAuditEvent),
                        application: applicationForEvent(selectedAuditEvent)?.school.name ?? '',
                      })
                    : format(tx('team.auditDetailContext'), { student: studentLabelForEvent(selectedAuditEvent) })}
                </p>
                <div className="team-audit-detail-meta">
                  <span>
                    <small>{tx('team.auditDetailActor')}</small>
                    <b>{auditActorLabel(selectedAuditEvent)}</b>
                  </span>
                  <span>
                    <small>{tx('team.auditDetailTime')}</small>
                    <b>{eventTime(selectedAuditEvent.time, lang)}</b>
                  </span>
                  <span>
                    <small>{tx('team.auditDetailScope')}</small>
                    <b>{localizeAuditScope(selectedAuditEvent.scope, tx)}</b>
                  </span>
                </div>
              </div>

              <div className="team-audit-impact-card">
                <div className="team-audit-impact-head">
                  <span>
                    <ListChecks size={14} aria-hidden="true" />
                    {tx('team.auditDetailImpact')}
                  </span>
                  <em>{format(tx('team.auditDetailFieldCount'), { count: selectedAuditFields.length })}</em>
                </div>
                {selectedAuditFields.length === 0 ? (
                  <p className="team-panel-note">{tx('team.auditDetailNoFields')}</p>
                ) : (
                  <div className="team-audit-field-grid">
                    {selectedAuditFields.slice(0, 8).map((field) => (
                      <span key={field}>{mergeFieldPath(field)}</span>
                    ))}
                    {selectedAuditFields.length > 8 ? (
                      <span>{format(tx('team.changedFieldsMore'), { count: selectedAuditFields.length - 8 })}</span>
                    ) : null}
                  </div>
                )}
              </div>

              {(selectedAuditMergeable || selectedAuditRestorable) ? (
              <div className="team-audit-decision-card">
                <strong>{tx('team.auditDetailActions')}</strong>
                <p>{selectedAuditSummary || tx('team.auditDetailNoFields')}</p>
                <div className="team-audit-detail-actions">
                  {selectedAuditMergeable ? (
                    <button
                      type="button"
                      className="primary-action"
                      disabled={mergeBusyId === selectedMergeSourceEvent?.id}
                      onClick={() => {
                        if (selectedMergeSourceEvent) handlePreviewMerge(selectedMergeSourceEvent)
                      }}
                    >
                      <GitMerge size={13} aria-hidden="true" />
                      {mergeBusyId === selectedMergeSourceEvent?.id ? tx('working') : tx('team.auditMergePreview')}
                    </button>
                  ) : null}
                  {selectedAuditRestorable ? (
                    <button
                      type="button"
                      className="quiet-action"
                      disabled={restoreBusyId === selectedAuditEvent.id}
                      onClick={() => setPendingRestore(selectedAuditEvent)}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      {restoreBusyId === selectedAuditEvent.id ? tx('working') : tx('team.auditRestore')}
                    </button>
                  ) : null}
                </div>
              </div>
              ) : null}

              {(selectedAuditMetadata.mergedFromEventId || selectedAuditMetadata.restoredFromEventId || selectedAuditMetadata.flaggedConflictForEventId || typeof selectedAuditMetadata.conflictCount === 'number') ? (
                <div className="team-audit-related-card">
                  <strong>{tx('team.auditDetailRelated')}</strong>
                  <div className="team-version-meta">
                    {selectedAuditMetadata.mergedFromEventId ? <em>{format(tx('team.auditMergedFrom'), { id: shortEventId(selectedAuditMetadata.mergedFromEventId) })}</em> : null}
                    {selectedAuditMetadata.restoredFromEventId ? <em>{format(tx('team.auditRestoredFrom'), { id: shortEventId(selectedAuditMetadata.restoredFromEventId) })}</em> : null}
                    {selectedAuditMetadata.flaggedConflictForEventId ? <em>{format(tx('team.auditManualFor'), { id: shortEventId(selectedAuditMetadata.flaggedConflictForEventId) })}</em> : null}
                    {typeof selectedAuditMetadata.conflictCount === 'number' ? <em>{format(tx('team.auditConflictCount'), { count: selectedAuditMetadata.conflictCount })}</em> : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="team-empty compact">
              <span className="empty-state-icon"><GitMerge size={18} aria-hidden="true" /></span>
              <div>
                <h3>{tx('team.auditSelectConflictTitle')}</h3>
                <p>{tx('team.auditSelectConflictDesc')}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
    )
  }

  const renderTeamDiscover = () => (
    <section className="team-discover-directory" aria-label={tx('team.teamDiscoverTitle', 'Research a student’s programs')}>
      <div className="team-discover-directory-head">
        <div>
          <span className="eyebrow">{tx('team.teamDiscoverEyebrow', 'TEAM DISCOVER')}</span>
          <h3>{tx('team.teamDiscoverTitle', 'Research a student’s programs')}</h3>
          <p>{tx('team.teamDiscoverDesc', 'Choose one assigned student. Research uses teacher-authorized personal or team AI keys; students cannot access this surface or its keys.')}</p>
        </div>
        <span className="team-discover-directory-total" aria-label={tx('team.studentProfilePickerTitle')}>
          <Users size={16} aria-hidden="true" />
          <strong>{accessibleStudentProfileRows.length}</strong>
        </span>
      </div>

      {accessibleStudentProfileRows.length ? (
        <>
          <div className="team-discover-controls">
            <label className="search-field team-discover-search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">{tx('team.studentProfileSearchPlaceholder')}</span>
              <input
                type="search"
                value={teamDiscoverQuery}
                onChange={(event) => setTeamDiscoverQuery(event.target.value)}
                placeholder={tx('team.studentProfileSearchPlaceholder')}
              />
            </label>

            <div className="team-discover-filterbar" data-active-filter={teamDiscoverFilter}>
              <span className="team-discover-filter-indicator" aria-hidden="true" />
              {([
                ['all', tx('team.studentProfileFilterAll')],
                ['attention', tx('team.studentProfileFilterAttention')],
                ['missing', tx('team.studentProfileFilterMissing')],
              ] as Array<[StudentProfileFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={teamDiscoverFilter === value ? 'active' : ''}
                  onClick={() => setTeamDiscoverFilter(value)}
                  aria-pressed={teamDiscoverFilter === value}
                >
                  <span>{label}</span>
                  <b>{teamDiscoverFilterCounts[value]}</b>
                </button>
              ))}
            </div>

            <span className="team-discover-result-count">
              <strong>{teamDiscoverStudentRows.length}</strong>
              <span>{tx('team.studentProfilePickerEyebrow')}</span>
            </span>
          </div>

          {teamDiscoverStudentRows.length ? (
            <div className="team-discover-student-grid">
              {teamDiscoverStudentRows.map((row) => {
                const studentName = memberDisplayName(row.member, tx('team.memberFallback'))
                const advisors = studentTeachersFor(row.member)
                return (
                  <button
                    key={row.member.id}
                    type="button"
                    className={`team-discover-student-card state-${row.state}`}
                    disabled={!row.member.userId}
                    onClick={() => row.member.userId && onOpenTeamDiscover?.(row.member.userId)}
                    aria-label={`${tx('team.teamDiscoverOpen', 'Open research')}: ${studentName}`}
                  >
                    <span className="team-discover-card-head">
                      <TeamMemberAvatar member={row.member} className="team-discover-card-avatar" />
                      <span className="team-discover-card-identity">
                        <strong>{studentName}</strong>
                        <small>{memberEmail(row.member) || tx('team.noLinkedEmail')}</small>
                      </span>
                      <span className="team-discover-card-state">
                        <i aria-hidden="true" />
                        {tx(studentStateLabelKey(row.state))}
                      </span>
                    </span>

                    <span className="team-discover-card-facts">
                      <span>
                        <FileText size={14} aria-hidden="true" />
                        {format(tx('team.teamDiscoverStudentMeta', '{count} applications'), { count: row.applications.length })}
                      </span>
                      <span>
                        <Target size={14} aria-hidden="true" />
                        {tx('team.studentProfileProgress')} {row.averageProgress}%
                      </span>
                    </span>

                    <span className="team-discover-card-footer">
                      <span>
                        {advisors.length
                          ? format(tx('team.studentPortraitAdvisorMeta'), {
                              name: advisors.map((advisor) => memberDisplayName(advisor, tx('team.memberFallback'))).join(' · '),
                            })
                          : tx('team.studentProfileAdvisorFallback')}
                      </span>
                      <strong>
                        {tx('team.teamDiscoverOpen', 'Open research')}
                        <ArrowRight size={14} aria-hidden="true" />
                      </strong>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="team-discover-no-results">
              <span className="empty-state-icon"><Search size={18} aria-hidden="true" /></span>
              <div>
                <strong>{tx('team.studentProfileNoMatches')}</strong>
                <button
                  type="button"
                  className="quiet-action compact-action"
                  onClick={() => {
                    setTeamDiscoverQuery('')
                    setTeamDiscoverFilter('all')
                  }}
                >
                  {tx('team.studentProfileClearFilters')}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="team-empty compact"><span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span><div><strong>{tx('team.teamDiscoverEmptyTitle', 'No assigned students yet')}</strong><p>{tx('team.teamDiscoverEmptyDesc', 'Assign a student to a teacher before starting Team Discover.')}</p></div></div>
      )}
    </section>
  )

  // Follow painted section so the hero dissolves with content, not a hard cut.
  const showTeamHero = !summary || displayedSection === 'overview'

  useEffect(() => {
    if (!showTeamHero && displayedSection !== 'settings' && renaming) {
      setRenaming(false)
      if (summary?.team.name) setTeamName(summary.team.name)
    }
  }, [displayedSection, showTeamHero, renaming, summary?.team.name])

  return (
    <section className="simple-screen team-screen content-flow-enter" aria-busy={loading}>
      {showTeamHero ? (
        <header className="team-hero">
          <div className="team-hero-main">
            {canManageLogo && summary ? (
              <>
                <button
                  type="button"
                  className={`team-hero-icon team-logo-action${summary.team.logoDataUrl ? ' has-logo' : ''}${teamLogoBusy ? ' is-busy' : ''}`}
                  aria-label={teamLogoBusy ? tx('working') : tx('team.logoUpload')}
                  title={tx('team.logoUpload')}
                  disabled={teamLogoBusy}
                  onClick={() => teamLogoInputRef.current?.click()}
                >
                  {summary.team.logoDataUrl ? (
                    <img src={summary.team.logoDataUrl} alt="" draggable={false} />
                  ) : (
                    <Users size={22} aria-hidden="true" />
                  )}
                  <span className="team-logo-action-indicator" aria-hidden="true">
                    {teamLogoBusy
                      ? <LoaderCircle size={11} className="spin-icon" />
                      : <Upload size={11} />}
                  </span>
                </button>
                <input
                  ref={teamLogoInputRef}
                  className="sr-only"
                  type="file"
                  accept={TEAM_LOGO_ACCEPT}
                  disabled={teamLogoBusy}
                  onChange={handleTeamLogoFile}
                />
              </>
            ) : (
              <div className={`team-hero-icon${summary?.team.logoDataUrl ? ' has-logo' : ''}`} aria-hidden="true">
                {summary?.team.logoDataUrl ? (
                  <img src={summary.team.logoDataUrl} alt="" draggable={false} />
                ) : (
                  <Users size={22} />
                )}
              </div>
            )}
            <div className="team-hero-copy">
              <span className="eyebrow">{screenTitle}</span>
              {renaming && canRename && summary ? (
                <div className="team-rename-row">
                  <input
                    value={teamName}
                    onChange={(event) => setTeamName(event.target.value)}
                    autoFocus
                    maxLength={120}
                    aria-label={tx('team.teamNameLabel')}
                  />
                  <button type="button" className="icon-action" onClick={handleRename} aria-label={tx('confirm')}>
                    <Check size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => {
                      setRenaming(false)
                      setTeamName(summary.team.name)
                    }}
                    aria-label={tx('cancel')}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="team-title-row">
                  <h2>{summary?.team.name ?? screenTitle}</h2>
                  {summary ? <span className="team-account-chip">{tx('teamLabel')}</span> : null}
                  {canRename && summary ? (
                    <button type="button" className="team-mini-btn" onClick={() => setRenaming(true)} aria-label={tx('team.renameTeam')}>
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              )}
              <p>
                {summary
                  ? format(tx('team.heroSubtitle'), { role: roleLabel })
                  : tx('team.noTeamDescription')}
              </p>
            </div>
          </div>

          {summary ? (
            <div className="team-hero-actions">
              {workspaceOptions.length > 1 ? (
                <div className="team-workspace-switcher">
                  <span>
                    <em>{tx('team.workspaceSwitcherLabel')}</em>
                    <small>{tx('team.workspaceSwitcherDesc')}</small>
                  </span>
                  <Select
                    value={workspaceSelectValue}
                    options={workspaceOptions}
                    onChange={(teamId) => onSwitchTeam?.(teamId)}
                    ariaLabel={tx('team.workspaceSwitcherLabel')}
                    size="small"
                    searchable
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </header>
      ) : null}

      {error ? (
        <div className="team-message team-message-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="team-message" role="status">
          <Check size={14} aria-hidden="true" />
          {message}
        </div>
      ) : null}

      {loading ? (
        <ScreenSkeleton variant="team" className="team-screen-skeleton" />
      ) : !summary ? (
        <div className="team-join-empty">
          <div className="team-join-empty-heading">
            <span className="empty-state-icon"><Users size={22} aria-hidden="true" /></span>
            <div>
              <span className="eyebrow">{tx('team.joinWorkspaceEyebrow')}</span>
              <h3>{tx('team.noTeam')}</h3>
              <p>{tx('team.noTeamDescription')}</p>
            </div>
          </div>
          <div className="team-join-method-switch" role="tablist" aria-label={tx('team.joinMethodLabel')}>
            <span className={joinMethod === 'invite' ? 'is-invite' : 'is-code'} aria-hidden="true" />
            <button
              type="button"
              className={joinMethod === 'invite' ? 'active' : ''}
              aria-selected={joinMethod === 'invite'}
              onClick={() => setJoinMethod('invite')}
            >
              <Mail size={15} aria-hidden="true" />
              {tx('team.joinMethodInvite')}
            </button>
            <button
              type="button"
              className={joinMethod === 'code' ? 'active' : ''}
              aria-selected={joinMethod === 'code'}
              onClick={() => setJoinMethod('code')}
            >
              <KeyRound size={15} aria-hidden="true" />
              {tx('team.joinMethodCode')}
            </button>
          </div>
          {joinMethod === 'invite' ? (
            <div className="team-join-invite-guidance">
              <span><Mail size={18} aria-hidden="true" /></span>
              <div>
                <strong>{tx('team.joinInviteTitle')}</strong>
                <p>{tx('team.joinInviteDescription')}</p>
              </div>
            </div>
          ) : (
            <form className="team-join-code-form" onSubmit={handleRedeemJoinCode}>
              <label>
                <span>{tx('team.joinCodeInputLabel')}</span>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder={tx('team.joinCodeInputPlaceholder')}
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  maxLength={32}
                  autoFocus
                />
              </label>
              <button type="submit" className="primary-action" disabled={joinBusy || !joinCode.trim()}>
                {joinBusy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
                {joinBusy ? tx('working') : tx('team.joinCodeSubmit')}
              </button>
              <p>{tx('team.joinCodeInputDescription')}</p>
            </form>
          )}
        </div>
      ) : (
        <>
          {hideTabs ? null : renderTabs()}
          <div
            className={[
              'team-section-stage',
              sectionMotion === 'exit' ? 'is-exit' : '',
              sectionMotion === 'enter' ? 'is-enter' : '',
              sectionDirection === 'backward' ? 'dir-backward' : 'dir-forward',
            ].filter(Boolean).join(' ')}
            data-team-section={displayedSection}
          >
            {displayedSection === 'overview' ? renderOverview() : null}
            {displayedSection === 'applications' ? renderApplications() : null}
            {displayedSection === 'resources' ? renderResources() : null}
            {displayedSection === 'members' ? renderMembers() : null}
            {displayedSection === 'discover' ? renderTeamDiscover() : null}
            {displayedSection === 'audit' ? renderAudit() : null}
            {displayedSection === 'settings' && viewerRole === 'owner' ? renderSettings() : null}
          </div>
        </>
      )}

      <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />

      {(editingViewedStudentAsset || (studentSnippetPreset && studentSnippetPresetDisplay)) && selectedResourceStudent ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'profile', 'team']}>
          <TeamSnippetEditorDialog
            open
            asset={editingViewedStudentAsset}
            initialKind={studentSnippetPreset?.kind}
            initialName={studentSnippetPresetDisplay?.name}
            initialContent={studentSnippetPresetDisplay?.content}
            initialCustomLabelEn={studentSnippetPreset?.nameEn}
            initialCustomLabelZh={studentSnippetPreset?.nameZh}
            initialIcon={studentSnippetPreset?.icon}
            initialColor={studentSnippetPreset?.color}
            fromPreset={Boolean(studentSnippetPreset)}
            attachmentsEnabled={false}
            contextLabel={format(tx('team.studentPortraitLibraryTitle'), { name: selectedResourceStudentName })}
            profilePresets={[]}
            contentLanguages={teamContentLanguages}
            globalPhrase={{
              leadZh: session.user.settings.snippetPhraseLeadZh ?? '',
              tailZh: session.user.settings.snippetPhraseTailZh ?? '',
              leadEn: session.user.settings.snippetPhraseLeadEn ?? '',
              tailEn: session.user.settings.snippetPhraseTailEn ?? '',
            }}
            onClose={() => {
              setStudentSnippetPreset(null)
              setEditingViewedStudentAssetId(null)
            }}
            onCreate={(input) => createSelectedStudentSnippet(input)}
            onUpdate={(assetId, input) => void updateSelectedStudentSnippet(assetId, input)}
            onUploadFiles={() => undefined}
            onRenameFile={() => undefined}
            onDeleteFile={() => undefined}
            onDownloadFile={() => undefined}
            onCreateShare={() => undefined}
            onRevokeShare={() => undefined}
          />
        </LazyOverlayBoundary>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingViewedStudentAssetDelete)}
        title={tx('profile.deleteAsset')}
        message={pendingViewedStudentAssetDelete
          ? format(tx('confirmDeleteProfileAsset'), { name: pendingViewedStudentAssetDelete.name })
          : ''}
        confirmLabel={tx('profile.deleteSnippet')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => void deleteSelectedStudentSnippet()}
        onCancel={() => setPendingViewedStudentAssetDelete(null)}
      />

      {teamPresetEditorOpen && (viewerRole === 'owner' || viewerRole === 'admin') ? (
        <ProfilePresetEditorDialog
          open
          preset={editingTeamPreset}
          scope="team"
          role={viewerRole}
          onClose={() => {
            setTeamPresetEditorOpen(false)
            setEditingTeamPresetId(null)
          }}
          onSave={saveTeamProfilePreset}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDeleteTeamPreset)}
        title={tx('profile.deletePreset')}
        message={pendingDeleteTeamPreset ? format(tx('team.profilePresetDeleteConfirm'), { name: profilePresetText(pendingDeleteTeamPreset, lang).name }) : ''}
        confirmLabel={teamPresetBusy ? tx('working') : tx('profile.deletePreset')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => void deleteTeamProfilePreset()}
        onCancel={() => setPendingDeleteTeamPreset(null)}
      />

      <ConfirmDialog
        open={confirmRestoreTeamPresets}
        title={tx('team.profilePresetRestore')}
        message={tx(viewerRole === 'owner' ? 'team.profilePresetRestoreOwnerConfirm' : 'team.profilePresetRestoreTeacherConfirm')}
        confirmLabel={teamPresetBusy ? tx('working') : tx('team.profilePresetRestore')}
        cancelLabel={tx('cancel')}
        onConfirm={() => {
          setConfirmRestoreTeamPresets(false)
          void restoreTeamProfilePresets()
        }}
        onCancel={() => setConfirmRestoreTeamPresets(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingTeacherGroupDelete)}
        title={tx('team.teacherGroupDelete')}
        message={pendingTeacherGroupDelete
          ? format(tx('team.teacherGroupDeleteConfirm'), { name: pendingTeacherGroupDelete.name })
          : ''}
        confirmLabel={teacherGroupBusyId === pendingTeacherGroupDelete?.id ? tx('working') : tx('team.teacherGroupDelete')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => void handleDeleteTeacherGroup()}
        onCancel={() => setPendingTeacherGroupDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title={pendingRemove?.userId === session.user.id ? tx('team.leaveTeam') : tx('team.removeMemberTitle')}
        message={pendingRemove
          ? (pendingRemove.userId === session.user.id
            ? format(tx('team.confirmLeaveTeam'), { team: summary?.team.name ?? '' })
            : format(tx('team.removeMemberConfirm'), {
              name: memberDisplayName(pendingRemove, tx('team.memberFallback')),
              team: summary?.team.name ?? '',
            }))
          : ''}
        confirmLabel={tx('confirm')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingRestore)}
        title={tx('team.auditRestoreTitle')}
        message={pendingRestore ? format(tx('team.auditRestoreConfirm'), { event: pendingRestore.message }) : ''}
        confirmLabel={restoreBusyId ? tx('working') : tx('team.auditRestore')}
        cancelLabel={tx('cancel')}
        onConfirm={handleRestoreEvent}
        onCancel={() => setPendingRestore(null)}
      />

    </section>
  )
}
