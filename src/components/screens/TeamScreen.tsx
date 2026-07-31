import '../../styles/team.css'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Fingerprint,
  FolderOpen,
  GripVertical,
  Paperclip,
  GitMerge,
  History,
  Info,
  KeyRound,
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
import { lazy, startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
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
  type TeamRole,
  type TeamStudentPermissions,
  type TeamTeacherPermissions,
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
  canUseTeamDiscover,
  teamTeacherPermissions,
} from '../../teamPermissions'
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

function hasAuditAccess(role: TeamRole | null | undefined) {
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
import { MAX_CSV_IMPORT_FILE_SIZE } from '../../fileUploads'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { NotificationPublisherPanel, type NotificationPublisherAudience, type NotificationPublisherRecipient } from '../shared/NotificationPublisherPanel'
import { AnchoredPopover } from '../shared/AnchoredPopover'
import { Select } from '../shared/Select'
import { StatusPill } from '../shared/StatusPill'
import { ScreenSkeleton } from '../shared/LaunchScreen'
import { AiKeyManager } from '../shared/AiKeyManager'
import { ProfilePresetEditorDialog, type ProfilePresetEditorValue } from '../shared/ProfilePresetEditorDialog'
import { ProfilePresetIcon } from '../shared/ProfilePresetIcon'
import { LibraryInsertionMotionBoundary } from '../shared/LibraryInsertionMotion'
import { LibraryViewSwitch, type LibraryViewMode } from '../shared/LibraryViewSwitch'
import { LazyOverlayBoundary } from '../shared/LazyOverlayBoundary'
import { PendingLabel } from '../shared/PendingLabel'
import { ProjectFooter } from '../shared/ProjectFooter'
import { UserAvatar } from '../shared/UserAvatar'
import { CopyButton } from '../shared/CopyButton'
import { downloadCsvFile } from '../shared/csv'
import { TeamPortraitFamilyDeck } from './TeamPortraitFamilyDeck'
import { ProfileScreen } from './ProfileScreen'
import { TeamJoinCodeGenerator } from '../shared/TeamJoinCodeGenerator'
import {
  TeamDefaultPermissionsEditor,
  TeamMemberPermissionEditor,
} from './TeamPermissionEditor'
import {
  buildTeamBulkInvitePreview,
  createTeamBulkInviteTemplate,
  MAX_TEAM_BULK_INVITE_ROWS,
  type TeamBulkInviteIssue,
} from './teamBulkInviteModel'
import {
  eventMetadata,
  localizeAuditMessage,
} from './teamAuditMergeModel'
import {
  readStoredTeamStudentProfiles,
  writeStoredTeamStudentProfiles,
  type TeamStudentProfileAsset,
} from './teamStudentProfileStorage'
import { normalizeTeamLogoFile, TEAM_LOGO_ACCEPT, TeamLogoError } from './teamLogo'
import { createRecoverableModuleLoader } from '../../lazyModuleRecovery'

const loadTeamSnippetEditorDialog = createRecoverableModuleLoader(() => import('../shared/SnippetEditorDialog').then((module) => ({
  default: module.SnippetEditorDialog,
})))
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
const EMPTY_TEACHER_GROUPS: TeamTeacherGroup[] = []
const EMPTY_TRANSFER_REQUESTS: NonNullable<TeamSummary['transferRequests']> = []
type HealthFilter = 'all' | ReturnType<typeof applicationHealth>
const HEALTH_FILTERS: HealthFilter[] = ['all', 'risk', 'watch', 'steady', 'closed']
type TeamMemberView = 'table' | 'map'
type MemberWorkspaceView = 'students' | 'teacher-groups'
type TeamMemberStatusFilter = 'all' | 'active' | 'pending'
type OrganizationSettingsSection = 'identity' | 'permissions' | 'quota' | 'key'
type StudentProfileFilter = 'all' | 'attention' | 'missing'
type StudentProfileSort = 'attention' | 'name' | 'progress'
type StudentProfileState = 'missing' | 'risk' | 'due' | 'feedback' | 'steady'
type OwnerOverviewFocusKey = 'transfers' | 'risk' | 'resources' | 'students' | 'invites' | 'steady'
type TeamPortraitViewTransition = {
  finished: Promise<unknown>
}
type TeamPortraitViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => TeamPortraitViewTransition
}
const TEAM_DISCOVER_VIEW_KEY = 'phd-atlas-team-discover-view:v1'
const TEAM_RELATION_INSPECTOR_WIDTH_KEY = 'phd-atlas-team-relation-inspector-width:v1'
const TEAM_RELATION_INSPECTOR_DEFAULT_WIDTH = 360
const TEAM_RELATION_INSPECTOR_MIN_WIDTH = 316
const TEAM_RELATION_INSPECTOR_MAX_WIDTH = 520
const TEAM_RELATION_INSPECTOR_CLOSE_WIDTH = 250
const TEAM_RELATION_INSPECTOR_REVEAL_WIDTH = 48
const TEAM_RELATION_INSPECTOR_DRAG_THRESHOLD = 3
const TEAM_PORTRAIT_VIEW_TRANSITION_NAME = 'team-portrait-student-profile'

function releaseTeamPortraitTransitionRoot(transitionToken: number) {
  if (typeof document === 'undefined') return
  const transitionRoot = document.documentElement
  if (transitionRoot.dataset.teamPortraitTransitionToken !== String(transitionToken)) return
  delete transitionRoot.dataset.teamPortraitTransitionToken
}

function storedTeamDiscoverView(): LibraryViewMode {
  try {
    return localStorage.getItem(TEAM_DISCOVER_VIEW_KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

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
  const name = member?.displayName || fallbackName || ''
  const email = member?.invitedEmail || ''
  const avatarUrl = member?.avatarUrl
  if (!avatarUrl) {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const initials = words.length > 1
      ? `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toLocaleUpperCase()
      : (words[0]?.slice(0, 2) || email.slice(0, 2) || '?').toLocaleUpperCase()
    const identity = `${member?.id ?? ''}:${name}:${email}`
    const tone = [...identity].reduce((total, character) => total + character.charCodeAt(0), 0) % 6
    return (
      <span
        className={`${className} team-member-avatar-fallback tone-${tone}`}
        aria-hidden="true"
      >
        {initials}
      </span>
    )
  }

  return (
    <UserAvatar
      avatarUrl={avatarUrl}
      name={name || '?'}
      email={email}
      className={className}
    />
  )
}

function TeamPortraitPresetTargetPicker({
  rows,
  targetUserId,
  className = '',
  align = 'start',
  onSelect,
  onWarm,
}: {
  rows: readonly StudentProfileRow[]
  targetUserId?: string | null
  className?: string
  align?: 'start' | 'end'
  onSelect: (studentUserId: string) => void
  onWarm?: (studentUserId: string) => void
}) {
  const { tx, format } = useI18n()
  const [query, setQuery] = useState('')
  const searchId = useId()
  const targetStudent = rows.find((row) => row.member.userId === targetUserId)
    ?? rows.find((row) => Boolean(row.member.userId))
    ?? null

  if (!targetStudent?.member.userId) return null

  const targetStudentName = memberDisplayName(targetStudent.member, tx('team.memberFallback'))
  const normalizedQuery = query.trim().toLowerCase()
  const visibleStudents = rows.filter((row) => {
    if (!row.member.userId) return false
    if (!normalizedQuery) return true
    return [
      memberDisplayName(row.member, ''),
      memberEmail(row.member),
    ].join(' ').toLowerCase().includes(normalizedQuery)
  })

  return (
    <div className={`team-portrait-preset-target${className ? ` ${className}` : ''}`}>
      <AnchoredPopover
        triggerAriaLabel={`${tx('team.studentProfilePickerTitle')}: ${targetStudentName}`}
        popoverAriaLabel={tx('team.studentProfilePickerTitle')}
        triggerClassName="team-portrait-preset-target-trigger"
        popoverClassName="team-portrait-preset-target-popover"
        width={292}
        estimatedHeight={390}
        align={align}
        onOpenChange={(open) => {
          if (!open) setQuery('')
        }}
        trigger={(
          <>
            <span className="team-portrait-preset-target-label">
              <UserRound size={14} aria-hidden="true" />
              <span>
                <small>{tx('team.studentProfilePickerEyebrow')}</small>
                <strong>{tx('team.studentProfilePickerTitle')}</strong>
              </span>
            </span>
            <TeamMemberAvatar member={targetStudent.member} className="team-portrait-preset-target-avatar" />
            <span className="team-portrait-preset-target-copy">
              <strong>{targetStudentName}</strong>
              <em>{memberEmail(targetStudent.member) || tx('team.noLinkedEmail')}</em>
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </>
        )}
      >
        {(close) => (
          <div className="team-portrait-preset-target-picker">
            <div className="team-portrait-preset-target-picker-head">
              <div>
                <span className="eyebrow">{tx('team.studentProfilePickerEyebrow')}</span>
                <strong>{tx('team.studentProfilePickerTitle')}</strong>
              </div>
              <span className="team-portrait-count">
                {format(tx('team.studentProfilePickerCount'), { count: rows.length })}
              </span>
            </div>
            <label className="search-field team-portrait-preset-target-search" htmlFor={searchId}>
              <Search size={13} aria-hidden="true" />
              <span className="sr-only">{tx('team.studentProfileSearchPlaceholder')}</span>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx('team.studentProfileSearchPlaceholder')}
                data-popover-autofocus
              />
            </label>
            <div
              className="team-portrait-preset-target-options"
              role="listbox"
              aria-label={tx('team.studentProfilePickerTitle')}
            >
              {visibleStudents.length > 0 ? visibleStudents.map((row) => {
                const studentUserId = row.member.userId!
                const name = memberDisplayName(row.member, tx('team.memberFallback'))
                const selected = studentUserId === targetStudent.member.userId
                return (
                  <button
                    key={row.member.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onPointerEnter={() => onWarm?.(studentUserId)}
                    onFocus={() => onWarm?.(studentUserId)}
                    onClick={() => {
                      onSelect(studentUserId)
                      onWarm?.(studentUserId)
                      setQuery('')
                      close()
                    }}
                  >
                    <TeamMemberAvatar member={row.member} className="team-portrait-preset-target-avatar" />
                    <span>
                      <strong>{name}</strong>
                      <em>{memberEmail(row.member) || tx('team.noLinkedEmail')}</em>
                    </span>
                    {selected ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                )
              }) : (
                <div className="team-portrait-preset-target-empty">
                  <Search size={16} aria-hidden="true" />
                  <span>{tx('noResults')}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </AnchoredPopover>
    </div>
  )
}

function TeamTeacherAssignmentPicker({
  teachers,
  assignedTeacherUserIds,
  busy,
  title,
  description,
  emptySelectionLabel,
  ariaLabel,
  onCommit,
}: {
  teachers: TeamMember[]
  assignedTeacherUserIds: readonly string[]
  busy: boolean
  title?: string
  description?: string
  emptySelectionLabel?: string
  ariaLabel?: string
  onCommit: (teacherUserIds: string[]) => void | boolean | Promise<void | boolean>
}) {
  const { tx, format, lang } = useI18n()
  const [query, setQuery] = useState('')
  const [draftTeacherUserIds, setDraftTeacherUserIds] = useState<string[] | null>(null)
  const [committing, setCommitting] = useState(false)
  const assignedIds = new Set(draftTeacherUserIds ?? assignedTeacherUserIds)
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
  const pickerTitle = title ?? tx('team.collaborationTeachersLabel')
  const pickerDescription = description ?? tx('team.relationshipQuickAssign')
  const pickerAriaLabel = ariaLabel ?? tx('team.relationshipQuickAssign')
  const selectionLabel = assignedTeachers.length > 0
    ? format(tx('team.collaborationTeachersCount'), { count: assignedTeachers.length })
    : (emptySelectionLabel ?? tx('team.relationshipNoAdvisor'))
  const teacherNames = assignedTeachers
    .slice(0, 3)
    .map((teacher) => memberDisplayName(teacher, tx('team.memberFallback')))
    .join(' · ')

  return (
    <AnchoredPopover
      triggerAriaLabel={`${pickerAriaLabel}: ${selectionLabel}`}
      popoverAriaLabel={pickerAriaLabel}
      triggerClassName={`team-teacher-picker-trigger${busy ? ' is-busy' : ''}`}
      popoverClassName="team-teacher-picker-popover-shell"
      width={360}
      estimatedHeight={420}
      align="start"
      onOpenChange={(open) => {
        if (open) {
          setDraftTeacherUserIds([...assignedTeacherUserIds])
          return
        }
        setQuery('')
        setDraftTeacherUserIds(null)
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
            <em>{teacherNames || pickerDescription}</em>
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
              <strong>{pickerTitle}</strong>
              <em>{selectionLabel}</em>
            </span>
            <button
              type="button"
              className="team-teacher-picker-close"
              onClick={() => close()}
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
                  disabled={busy || committing || !teacher.userId}
                  onClick={() => {
                    if (!teacher.userId) return
                    setDraftTeacherUserIds((current) => {
                      const next = new Set(current ?? assignedTeacherUserIds)
                      if (next.has(teacher.userId!)) next.delete(teacher.userId!)
                      else next.add(teacher.userId!)
                      return [...next]
                    })
                  }}
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
            <button
              type="button"
              className="quiet-action"
              disabled={busy || committing}
              onClick={async () => {
                const nextIds = draftTeacherUserIds ?? [...assignedTeacherUserIds]
                const changed = nextIds.length !== assignedTeacherUserIds.length
                  || nextIds.some((id) => !assignedTeacherUserIds.includes(id))
                if (!changed) {
                  close()
                  return
                }
                setCommitting(true)
                try {
                  const saved = await onCommit(nextIds)
                  if (saved === false) return
                  close()
                } finally {
                  setCommitting(false)
                }
              }}
            >
              {committing ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
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
  const notifyTeamSuccess = useCallback((notification: string) => {
    onNotify?.(notification, 'success')
  }, [onNotify])
  const notifyTeamError = useCallback((notification: string) => {
    onNotify?.(notification, 'error')
  }, [onNotify])
  const teamContentLanguages = useMemo(
    () => contentLanguagesFromSettings({
      contentLanguagePrimary: session.user.settings.contentLanguagePrimary,
      contentLanguageSecondary: session.user.settings.contentLanguageSecondary,
    }),
    [session.user.settings.contentLanguagePrimary, session.user.settings.contentLanguageSecondary],
  )
  const [loading, setLoading] = useState(!initialSummary)
  const [summary, setSummary] = useState<TeamSummary | null>(initialSummary ?? null)
  const [internalActiveTab, setInternalActiveTab] = useState<TeamSection>('overview')
  const [teamQuery, setTeamQuery] = useState('')
  const [teamDiscoverQuery, setTeamDiscoverQuery] = useState('')
  const [teamDiscoverFilter, setTeamDiscoverFilter] = useState<StudentProfileFilter>('all')
  const [renderedTeamDiscoverFilter, setRenderedTeamDiscoverFilter] = useState<StudentProfileFilter>('all')
  const [teamDiscoverFilterPhase, setTeamDiscoverFilterPhase] = useState<'idle' | 'exiting' | 'entering'>('idle')
  const [teamDiscoverView, setTeamDiscoverView] = useState<LibraryViewMode>(storedTeamDiscoverView)
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [teacherStudentFilter, setTeacherStudentFilter] = useState('all')
  const [ownerOverviewFocusKey, setOwnerOverviewFocusKey] = useState<OwnerOverviewFocusKey>('risk')
  const [ownerOverviewDetailView, setOwnerOverviewDetailView] = useState<OwnerOverviewDetailView>('priority')
  const [teacherOverviewStudentId, setTeacherOverviewStudentId] = useState<string | null>(null)
  const [overviewMoreOpen, setOverviewMoreOpen] = useState(false)
  const [teacherQuickCreateOpen, setTeacherQuickCreateOpen] = useState(false)
  const [memberView, setMemberView] = useState<TeamMemberView>('map')
  const [memberWorkspaceView, setMemberWorkspaceView] = useState<MemberWorkspaceView>('students')
  const [renderedMemberWorkspaceView, setRenderedMemberWorkspaceView] = useState<MemberWorkspaceView>('students')
  const [memberWorkspaceMotion, setMemberWorkspaceMotion] = useState<'idle' | 'exiting' | 'entering'>('idle')
  const [memberWorkspaceDirection, setMemberWorkspaceDirection] = useState<'forward' | 'backward'>('forward')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberStatusFilter, setMemberStatusFilter] = useState<TeamMemberStatusFilter>('all')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, 'owner'>>('member')
  const [inviteTeacherIds, setInviteTeacherIds] = useState<string[]>([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single')
  const [bulkInviteText, setBulkInviteText] = useState('')
  const [bulkInviteBusy, setBulkInviteBusy] = useState(false)
  const [bulkInviteFileName, setBulkInviteFileName] = useState('')
  const [bulkInviteImportMessage, setBulkInviteImportMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const bulkInviteFileInputRef = useRef<HTMLInputElement>(null)
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
  const [selectedRelationStudentId, setSelectedRelationStudentId] = useState<string | null>(null)
  const [relationInspectorOpen, setRelationInspectorOpen] = useState(false)
  const [relationInspectorWidth, setRelationInspectorWidth] = useState(storedTeamRelationInspectorWidth)
  const [relationInspectorResizing, setRelationInspectorResizing] = useState(false)
  const [relationFocus, setRelationFocus] = useState<{ memberId: string; nonce: number } | null>(null)
  const [selectedResourceStudentId, setSelectedResourceStudentId] = useState<string | null>(null)
  const [displayedResourceStudentId, setDisplayedResourceStudentId] = useState<string | null>(null)
  const [studentPortraitMobileDetailOpen, setStudentPortraitMobileDetailOpen] = useState(false)
  const [presetTargetStudentId, setPresetTargetStudentId] = useState<string | null>(null)
  const [studentResourceQuery, setStudentResourceQuery] = useState('')
  const [studentProfileFilter, setStudentProfileFilter] = useState<StudentProfileFilter>('all')
  const [studentProfileSort, setStudentProfileSort] = useState<StudentProfileSort>('attention')
  const [studentProfileAssets, setStudentProfileAssets] = useState<TeamStudentProfileAsset[]>(readStoredTeamStudentProfiles)
  const [removingStudentProfileIds, setRemovingStudentProfileIds] = useState<Set<string>>(() => new Set())
  const [presetSourceFilter, setPresetSourceFilter] = useState<ProfilePresetSourceFilter>('all')
  const [renderedPresetSourceFilter, setRenderedPresetSourceFilter] = useState<ProfilePresetSourceFilter>('all')
  const [presetSourceFilterPhase, setPresetSourceFilterPhase] = useState<'idle' | 'exiting' | 'entering'>('idle')
  const [presetQuery, setPresetQuery] = useState('')
  const [viewedStudentAssets, setViewedStudentAssets] = useState<ProfileAsset[]>([])
  const [viewedStudentAssetsLoading, setViewedStudentAssetsLoading] = useState(false)
  const [studentPortraitHandoffCycle, setStudentPortraitHandoffCycle] = useState<'a' | 'b' | null>(null)
  const [studentPortraitStable, setStudentPortraitStable] = useState(false)
  const [viewedStudentAssetQuery, setViewedStudentAssetQuery] = useState('')
  const [studentAssetView, setStudentAssetView] = useState<LibraryViewMode>('cards')
  const [expandedStudentFamilyId, setExpandedStudentFamilyId] = useState<string | null>(null)
  const [studentSnippetPreset, setStudentSnippetPreset] = useState<TeamProfilePreset | null>(null)
  const [studentSnippetTargetUserId, setStudentSnippetTargetUserId] = useState<string | null>(null)
  const [editingViewedStudentAssetId, setEditingViewedStudentAssetId] = useState<string | null>(null)
  const [enteredStudentAssetId, setEnteredStudentAssetId] = useState<string | null>(null)
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
  const displayedResourceStudentIdRef = useRef(displayedResourceStudentId)
  const studentPortraitListRef = useRef<HTMLDivElement | null>(null)
  const studentPortraitSelectionRef = useRef<HTMLSpanElement | null>(null)
  const studentPortraitRowRefs = useRef(new Map<string, HTMLButtonElement>())
  const studentPortraitProfilePaneRef = useRef<HTMLElement | null>(null)
  const studentPortraitMobileBackRef = useRef<HTMLButtonElement | null>(null)
  const studentPortraitMobileReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const studentPortraitMobileNavigationStartedRef = useRef(false)
  const studentPortraitSelectionMotionTimerRef = useRef<number | null>(null)
  const studentPortraitProfileContentRef = useRef<HTMLDivElement | null>(null)
  const studentPortraitViewTransitionTokenRef = useRef(0)
  const studentPortraitDossierScrollRef = useRef<HTMLDivElement | null>(null)
  const studentPortraitAssetCacheRef = useRef(new Map<string, ProfileAsset[]>())
  const studentPortraitAssetRequestRef = useRef(new Map<string, Promise<ProfileAsset[]>>())
  const teamLogoInputRef = useRef<HTMLInputElement>(null)
  const relationCanvasRef = useRef<HTMLDivElement | null>(null)
  const relationCanvasStageRef = useRef<HTMLDivElement | null>(null)
  const relationZoomLabelRef = useRef<HTMLOutputElement | null>(null)
  const relationBoardRef = useRef<HTMLDivElement | null>(null)
  const relationInspectorResizeHandleRef = useRef<HTMLButtonElement | null>(null)
  const relationInspectorResizeCleanupRef = useRef<(() => void) | null>(null)
  const relationInspectorSettleFrameRef = useRef<number | null>(null)
  const relationZoomRef = useRef(1)
  const relationZoomCommitTimerRef = useRef<number | null>(null)
  const relationArrivalTimerRef = useRef<number | null>(null)
  const relationZoomAnimationRef = useRef<Animation | null>(null)
  const relationWheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined)
  const relationWheelListenerRef = useRef<((event: WheelEvent) => void) | null>(null)
  const relationSuppressClickUntilRef = useRef(0)
  const renderedMemberWorkspaceViewRef = useRef(renderedMemberWorkspaceView)
  const memberWorkspaceMotionTimersRef = useRef<number[]>([])
  const teacherGroupNavRef = useRef<HTMLElement | null>(null)
  const teacherGroupNavIndicatorRef = useRef<HTMLSpanElement | null>(null)
  const teacherGroupNavButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const teacherGroupNavIndicatorTimerRef = useRef<number | null>(null)
  const studentFamilyStackRefs = useRef(new Map<string, HTMLElement>())
  const pendingStudentFamilyLayoutFlipRef = useRef<Map<HTMLElement, DOMRect> | null>(null)
  const studentFamilyLayoutAnimationsRef = useRef<Animation[]>([])
  const presetSourceFilterTimersRef = useRef<number[]>([])
  const teamDiscoverFilterTimersRef = useRef<number[]>([])
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
  displayedResourceStudentIdRef.current = displayedResourceStudentId
  renderedMemberWorkspaceViewRef.current = renderedMemberWorkspaceView
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

  const finishStudentPortraitSelectionMotion = useCallback(() => {
    if (studentPortraitSelectionMotionTimerRef.current !== null) {
      window.clearTimeout(studentPortraitSelectionMotionTimerRef.current)
      studentPortraitSelectionMotionTimerRef.current = null
    }
    studentPortraitSelectionRef.current?.classList.remove('is-moving')
  }, [])

  const finishTeacherGroupNavIndicatorMotion = useCallback(() => {
    if (teacherGroupNavIndicatorTimerRef.current !== null) {
      window.clearTimeout(teacherGroupNavIndicatorTimerRef.current)
      teacherGroupNavIndicatorTimerRef.current = null
    }
    teacherGroupNavIndicatorRef.current?.classList.remove('is-moving')
  }, [])

  const positionTeacherGroupNavIndicator = useCallback((groupId: string) => {
    const indicator = teacherGroupNavIndicatorRef.current
    const button = teacherGroupNavButtonRefs.current.get(groupId)
    if (!indicator || !button) {
      finishTeacherGroupNavIndicatorMotion()
      indicator?.classList.remove('is-ready')
      return
    }

    const nextX = `${button.offsetLeft}px`
    const nextY = `${button.offsetTop}px`
    const nextWidth = `${button.offsetWidth}px`
    const nextHeight = `${button.offsetHeight}px`
    const shouldAnimate = indicator.classList.contains('is-ready')
      && (
        indicator.style.getPropertyValue('--team-teacher-group-nav-x') !== nextX
        || indicator.style.getPropertyValue('--team-teacher-group-nav-y') !== nextY
        || indicator.style.getPropertyValue('--team-teacher-group-nav-width') !== nextWidth
        || indicator.style.getPropertyValue('--team-teacher-group-nav-height') !== nextHeight
      )

    if (shouldAnimate) {
      finishTeacherGroupNavIndicatorMotion()
      indicator.classList.add('is-moving')
      teacherGroupNavIndicatorTimerRef.current = window.setTimeout(
        finishTeacherGroupNavIndicatorMotion,
        getMotionDelay(220),
      )
    }

    indicator.style.setProperty('--team-teacher-group-nav-x', nextX)
    indicator.style.setProperty('--team-teacher-group-nav-y', nextY)
    indicator.style.setProperty('--team-teacher-group-nav-width', nextWidth)
    indicator.style.setProperty('--team-teacher-group-nav-height', nextHeight)
    indicator.classList.add('is-ready')
  }, [finishTeacherGroupNavIndicatorMotion])

  const positionStudentPortraitSelection = useCallback((
    studentUserId: string | null,
    targetRow?: HTMLButtonElement | null,
  ) => {
    const list = studentPortraitListRef.current
    const slider = studentPortraitSelectionRef.current
    const row = targetRow ?? (studentUserId ? studentPortraitRowRefs.current.get(studentUserId) : null)
    if (!list || !slider || !row) {
      finishStudentPortraitSelectionMotion()
      slider?.classList.remove('is-visible')
      list?.classList.remove('has-selection-slider')
      return
    }

    const nextTopValue = `${row.offsetTop}px`
    const nextHeightValue = `${row.offsetHeight || 66}px`
    const shouldAnimate = slider.classList.contains('is-visible')
      && (
        slider.style.getPropertyValue('--team-portrait-selection-y') !== nextTopValue
        || slider.style.getPropertyValue('--team-portrait-selection-height') !== nextHeightValue
      )

    if (shouldAnimate) {
      if (studentPortraitSelectionMotionTimerRef.current !== null) {
        window.clearTimeout(studentPortraitSelectionMotionTimerRef.current)
      }
      slider.classList.add('is-moving')
      studentPortraitSelectionMotionTimerRef.current = window.setTimeout(
        finishStudentPortraitSelectionMotion,
        280,
      )
    }

    slider.style.setProperty('--team-portrait-selection-y', nextTopValue)
    slider.style.setProperty('--team-portrait-selection-height', nextHeightValue)
    slider.classList.add('is-visible')
    list.classList.add('has-selection-slider')
  }, [finishStudentPortraitSelectionMotion])

  useEffect(() => () => {
    const transitionToken = studentPortraitViewTransitionTokenRef.current
    studentPortraitViewTransitionTokenRef.current += 1
    releaseTeamPortraitTransitionRoot(transitionToken)
    studentPortraitProfileContentRef.current?.classList.remove('is-native-handoff')
    studentPortraitProfileContentRef.current?.style.removeProperty('view-transition-name')
    if (relationZoomCommitTimerRef.current !== null) {
      window.clearTimeout(relationZoomCommitTimerRef.current)
    }
    if (relationArrivalTimerRef.current !== null) {
      window.clearTimeout(relationArrivalTimerRef.current)
    }
    if (studentPortraitSelectionMotionTimerRef.current !== null) {
      window.clearTimeout(studentPortraitSelectionMotionTimerRef.current)
    }
    relationInspectorResizeCleanupRef.current?.()
    if (relationInspectorSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(relationInspectorSettleFrameRef.current)
    }
    relationZoomAnimationRef.current?.cancel()
    studentFamilyLayoutAnimationsRef.current.forEach((animation) => animation.cancel())
    studentFamilyLayoutAnimationsRef.current = []
    presetSourceFilterTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    presetSourceFilterTimersRef.current = []
    teamDiscoverFilterTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    teamDiscoverFilterTimersRef.current = []
    memberWorkspaceMotionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    memberWorkspaceMotionTimersRef.current = []
    if (teacherGroupNavIndicatorTimerRef.current !== null) {
      window.clearTimeout(teacherGroupNavIndicatorTimerRef.current)
    }
    teacherGroupNavButtonRefs.current.clear()
    studentFamilyStackRefs.current.clear()
    studentPortraitRowRefs.current.clear()
    studentPortraitAssetCacheRef.current.clear()
    studentPortraitAssetRequestRef.current.clear()
    relationCanvasGestureRef.current.pointers.clear()
  }, [])

  useEffect(() => {
    if (!enteredStudentAssetId) return undefined
    const delay = getMotionDelay(620)
    if (delay === 0) {
      setEnteredStudentAssetId(null)
      return undefined
    }
    const timer = window.setTimeout(() => setEnteredStudentAssetId(null), delay)
    return () => window.clearTimeout(timer)
  }, [enteredStudentAssetId])

  useEffect(() => {
    if (renderedMemberWorkspaceViewRef.current === memberWorkspaceView) {
      setMemberWorkspaceMotion('idle')
      return undefined
    }

    memberWorkspaceMotionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    memberWorkspaceMotionTimersRef.current = []
    setMemberWorkspaceDirection(memberWorkspaceView === 'teacher-groups' ? 'forward' : 'backward')

    const exitDelay = getMotionDelay(90)
    const enterDelay = getMotionDelay(190)
    if (exitDelay === 0 && enterDelay === 0) {
      setRenderedMemberWorkspaceView(memberWorkspaceView)
      setMemberWorkspaceMotion('idle')
      return undefined
    }

    setMemberWorkspaceMotion('exiting')
    const swapTimer = window.setTimeout(() => {
      setRenderedMemberWorkspaceView(memberWorkspaceView)
      setMemberWorkspaceMotion('entering')
      const settleTimer = window.setTimeout(() => {
        setMemberWorkspaceMotion('idle')
        memberWorkspaceMotionTimersRef.current = []
      }, enterDelay)
      memberWorkspaceMotionTimersRef.current = [settleTimer]
    }, exitDelay)
    memberWorkspaceMotionTimersRef.current = [swapTimer]

    return () => {
      memberWorkspaceMotionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      memberWorkspaceMotionTimersRef.current = []
    }
  }, [memberWorkspaceView])

  const changePresetSourceFilter = useCallback((nextFilter: ProfilePresetSourceFilter) => {
    if (nextFilter === presetSourceFilter) return

    setPresetSourceFilter(nextFilter)
    presetSourceFilterTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    presetSourceFilterTimersRef.current = []
    setPresetSourceFilterPhase('exiting')

    const swapTimer = window.setTimeout(() => {
      setRenderedPresetSourceFilter(nextFilter)
      setPresetSourceFilterPhase('entering')
      const settleTimer = window.setTimeout(() => {
        setPresetSourceFilterPhase('idle')
        presetSourceFilterTimersRef.current = []
      }, getMotionDelay(190))
      presetSourceFilterTimersRef.current = [settleTimer]
    }, getMotionDelay(90))
    presetSourceFilterTimersRef.current = [swapTimer]
  }, [presetSourceFilter])

  const changeTeamDiscoverFilter = useCallback((nextFilter: StudentProfileFilter) => {
    if (nextFilter === teamDiscoverFilter) return
    setTeamDiscoverFilter(nextFilter)
    teamDiscoverFilterTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    teamDiscoverFilterTimersRef.current = []
    setTeamDiscoverFilterPhase('exiting')

    const swapTimer = window.setTimeout(() => {
      setRenderedTeamDiscoverFilter(nextFilter)
      setTeamDiscoverFilterPhase('entering')
      const settleTimer = window.setTimeout(() => {
        setTeamDiscoverFilterPhase('idle')
        teamDiscoverFilterTimersRef.current = []
      }, getMotionDelay(190))
      teamDiscoverFilterTimersRef.current = [settleTimer]
    }, getMotionDelay(90))
    teamDiscoverFilterTimersRef.current = [swapTimer]
  }, [teamDiscoverFilter])

  useEffect(() => {
    try {
      localStorage.setItem(TEAM_DISCOVER_VIEW_KEY, teamDiscoverView)
    } catch {
      // A blocked storage backend should never make the view switch unusable.
    }
  }, [teamDiscoverView])

  useEffect(() => {
    try {
      localStorage.setItem(TEAM_RELATION_INSPECTOR_WIDTH_KEY, String(relationInspectorWidth))
    } catch {
      // A blocked storage backend should not affect the resizable relationship inspector.
    }
  }, [relationInspectorWidth])

  useLayoutEffect(() => {
    const beforeRects = pendingStudentFamilyLayoutFlipRef.current
    pendingStudentFamilyLayoutFlipRef.current = null
    if (!beforeRects) return
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    const animations: Animation[] = []
    beforeRects.forEach((before, element) => {
      if (!element.isConnected || typeof element.animate !== 'function') return
      const after = element.getBoundingClientRect()
      const deltaX = before.left - after.left
      const deltaY = before.top - after.top
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return
      animations.push(element.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 560,
          easing: 'cubic-bezier(0.16, 0.72, 0.24, 1)',
        },
      ))
    })
    studentFamilyLayoutAnimationsRef.current = animations
  }, [expandedStudentFamilyId])

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

  useEffect(() => {
    if (displayedSection === 'resources') return
    setStudentPortraitMobileDetailOpen(false)
    studentPortraitMobileReturnFocusRef.current = null
    studentPortraitMobileNavigationStartedRef.current = false
  }, [displayedSection])

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
      if (isCurrentRequest()) notifyTeamError(normalizeErrorMessage(err, lang))
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
      notifyTeamSuccess(tx('team.contactProfileSaved'))
      await syncAfterMutation()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
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
    try {
      const saved = editingTeamPreset
        ? await phdApi.updateTeamProfilePreset(session.token, summary.team.id, editingTeamPreset.id, value)
        : await phdApi.createTeamProfilePreset(session.token, summary.team.id, value)
      updateVisibleTeamPresets(editingTeamPreset
        ? teamProfilePresets.map((preset) => preset.id === saved.id ? saved : preset)
        : [...teamProfilePresets, saved])
      notifyTeamSuccess(tx(editingTeamPreset ? 'team.profilePresetUpdated' : 'team.profilePresetCreated'))
      setEditingTeamPresetId(null)
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
      throw err
    } finally {
      setTeamPresetBusy(false)
    }
  }

  async function deleteTeamProfilePreset() {
    if (!summary || !pendingDeleteTeamPreset || teamPresetBusy) return
    if (pendingDeleteTeamPreset.builtIn) return
    setTeamPresetBusy(true)
    try {
      await phdApi.deleteTeamProfilePreset(session.token, summary.team.id, pendingDeleteTeamPreset.id)
      updateVisibleTeamPresets(teamProfilePresets.filter((preset) => preset.id !== pendingDeleteTeamPreset.id))
      setPendingDeleteTeamPreset(null)
      notifyTeamSuccess(tx('team.profilePresetDeleted'))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setTeamPresetBusy(false)
    }
  }

  async function restoreTeamProfilePresets() {
    if (!summary || (viewerRole !== 'owner' && viewerRole !== 'admin') || teamPresetBusy) return
    setTeamPresetBusy(true)
    try {
      const presets = await phdApi.restoreTeamProfilePresets(session.token, summary.team.id)
      updateVisibleTeamPresets(presets)
      notifyTeamSuccess(tx('team.profilePresetRestored'))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
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

  const studentPortraitCacheKey = useCallback((studentUserId: string) => {
    const teamId = summary?.team.id
    return teamId ? `${teamId}:${studentUserId}` : ''
  }, [summary?.team.id])

  const loadStudentPortraitAssets = useCallback((studentUserId: string) => {
    const teamId = summary?.team.id
    if (!teamId || (viewerRole !== 'owner' && viewerRole !== 'admin')) {
      return Promise.resolve([] as ProfileAsset[])
    }

    const cacheKey = `${teamId}:${studentUserId}`
    const cached = studentPortraitAssetCacheRef.current.get(cacheKey)
    if (cached !== undefined) return Promise.resolve(cached)

    const pending = studentPortraitAssetRequestRef.current.get(cacheKey)
    if (pending) return pending

    const request = phdApi.listTeamMemberProfileAssets(session.token, teamId, studentUserId)
      .then((assets) => {
        studentPortraitAssetCacheRef.current.set(cacheKey, assets)
        return assets
      })
      .finally(() => {
        studentPortraitAssetRequestRef.current.delete(cacheKey)
      })
    studentPortraitAssetRequestRef.current.set(cacheKey, request)
    return request
  }, [session.token, summary?.team.id, viewerRole])

  const warmStudentPortraitAssets = useCallback((studentUserId: string | null | undefined) => {
    if (!studentUserId) return
    void loadStudentPortraitAssets(studentUserId).catch(() => undefined)
  }, [loadStudentPortraitAssets])

  const commitStudentPortraitHandoff = useCallback((
    studentUserId: string,
    assets: ProfileAsset[],
  ) => {
    const previousStudentUserId = displayedResourceStudentIdRef.current
    const commit = () => {
      studentFamilyLayoutAnimationsRef.current.forEach((animation) => animation.cancel())
      studentFamilyLayoutAnimationsRef.current = []
      studentFamilyStackRefs.current.clear()
      displayedResourceStudentIdRef.current = studentUserId
      setDisplayedResourceStudentId(studentUserId)
      setViewedStudentAssets(assets)
      setViewedStudentAssetQuery('')
      setExpandedStudentFamilyId(null)
      setStudentSnippetPreset(null)
      setEditingViewedStudentAssetId(null)
      setEnteredStudentAssetId(null)
      setPendingViewedStudentAssetDelete(null)
      setStudentPortraitHandoffCycle((current) => current === 'a' ? 'b' : 'a')
      setStudentPortraitStable(true)
      setViewedStudentAssetsLoading(false)
    }

    const content = studentPortraitProfileContentRef.current
    const transitionDocument = typeof document === 'undefined'
      ? null
      : document as TeamPortraitViewTransitionDocument
    const transitionRoot = transitionDocument?.documentElement
    const startViewTransition = transitionDocument?.startViewTransition
    if (
      !previousStudentUserId
      || previousStudentUserId === studentUserId
      || !content
      || !transitionDocument
      || !transitionRoot
      || typeof startViewTransition !== 'function'
      || getMotionDelay(190) === 0
    ) {
      commit()
      return
    }

    const transitionToken = studentPortraitViewTransitionTokenRef.current + 1
    studentPortraitViewTransitionTokenRef.current = transitionToken
    content.classList.add('is-native-handoff')
    content.style.setProperty('view-transition-name', TEAM_PORTRAIT_VIEW_TRANSITION_NAME)
    transitionRoot.dataset.teamPortraitTransitionToken = String(transitionToken)

    const clearTransitionOwner = () => {
      if (studentPortraitViewTransitionTokenRef.current !== transitionToken) return
      content.classList.remove('is-native-handoff')
      content.style.removeProperty('view-transition-name')
      releaseTeamPortraitTransitionRoot(transitionToken)
    }

    let committed = false
    try {
      const transition = startViewTransition.call(transitionDocument, () => {
        committed = true
        flushSync(commit)
      })
      void transition.finished.then(clearTransitionOwner, clearTransitionOwner)
    } catch {
      if (!committed) commit()
      clearTransitionOwner()
    }
  }, [])

  const selectResourceStudent = useCallback((
    studentUserId: string | null | undefined,
    targetRow?: HTMLButtonElement | null,
  ) => {
    if (!studentUserId) return
    positionStudentPortraitSelection(studentUserId, targetRow)
    warmStudentPortraitAssets(studentUserId)
    setPresetTargetStudentId(studentUserId)
    if (selectedResourceStudentIdRef.current === studentUserId) return

    selectedResourceStudentIdRef.current = studentUserId
    startTransition(() => {
      setViewedStudentAssetsLoading(displayedResourceStudentIdRef.current !== studentUserId)
      setSelectedResourceStudentId(studentUserId)
    })
  }, [positionStudentPortraitSelection, warmStudentPortraitAssets])

  const openStudentPortraitMobileDetail = useCallback((
    studentUserId: string | null | undefined,
    targetRow?: HTMLButtonElement | null,
  ) => {
    if (!studentUserId) return
    selectResourceStudent(studentUserId, targetRow)
    if (
      typeof window.matchMedia !== 'function'
      || !window.matchMedia('(max-width: 820px)').matches
    ) return

    studentPortraitMobileReturnFocusRef.current = targetRow
      ?? studentPortraitRowRefs.current.get(studentUserId)
      ?? null
    studentPortraitMobileNavigationStartedRef.current = true
    setStudentPortraitMobileDetailOpen(true)
    window.requestAnimationFrame(() => {
      studentPortraitProfilePaneRef.current?.scrollIntoView?.({ block: 'start' })
      studentPortraitMobileBackRef.current?.focus({ preventScroll: true })
    })
  }, [selectResourceStudent])

  const closeStudentPortraitMobileDetail = useCallback(() => {
    const returnTarget = studentPortraitMobileReturnFocusRef.current
    setStudentPortraitMobileDetailOpen(false)
    window.requestAnimationFrame(() => {
      returnTarget?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
      returnTarget?.focus({ preventScroll: true })
    })
  }, [])

  const updateCachedStudentPortraitAssets = useCallback((
    studentUserId: string,
    update: (assets: ProfileAsset[]) => ProfileAsset[],
  ) => {
    const cacheKey = studentPortraitCacheKey(studentUserId)
    if (!cacheKey) return
    const cached = studentPortraitAssetCacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      studentPortraitAssetCacheRef.current.set(cacheKey, update(cached))
    }
  }, [studentPortraitCacheKey])

  useEffect(() => {
    if (contactProfileOpen) return
    setContactProfileDraft(teamContactProfileDraft(viewerTeamMember))
  }, [contactProfileOpen, viewerTeamMember])

  useEffect(() => {
    const transitionToken = studentPortraitViewTransitionTokenRef.current
    studentPortraitViewTransitionTokenRef.current += 1
    releaseTeamPortraitTransitionRoot(transitionToken)
    studentPortraitProfileContentRef.current?.classList.remove('is-native-handoff')
    studentPortraitProfileContentRef.current?.style.removeProperty('view-transition-name')
    studentPortraitAssetCacheRef.current.clear()
    studentPortraitAssetRequestRef.current.clear()
    displayedResourceStudentIdRef.current = null
    setDisplayedResourceStudentId(null)
    setPresetTargetStudentId(null)
    setViewedStudentAssets([])
    setViewedStudentAssetsLoading(false)
    setEnteredStudentAssetId(null)
    setStudentPortraitHandoffCycle(null)
    setStudentPortraitStable(false)
    setStudentSnippetTargetUserId(null)
    setStudentPortraitMobileDetailOpen(false)
    studentPortraitMobileReturnFocusRef.current = null
    studentPortraitMobileNavigationStartedRef.current = false
  }, [session.user.id, summary?.team.id])

  useEffect(() => {
    const teamId = summary?.team.id
    const studentUserId = selectedResourceStudentId
    if (!teamId || !studentUserId || (viewerRole !== 'owner' && viewerRole !== 'admin')) {
      displayedResourceStudentIdRef.current = null
      setDisplayedResourceStudentId(null)
      setViewedStudentAssets([])
      setViewedStudentAssetsLoading(false)
      setExpandedStudentFamilyId(null)
      setStudentSnippetPreset(null)
      setStudentSnippetTargetUserId(null)
      setEditingViewedStudentAssetId(null)
      setEnteredStudentAssetId(null)
      setPendingViewedStudentAssetDelete(null)
      return undefined
    }

    let cancelled = false
    if (displayedResourceStudentIdRef.current !== studentUserId) {
      setViewedStudentAssetsLoading(true)
    }
    void loadStudentPortraitAssets(studentUserId)
      .then((assets) => {
        if (cancelled || selectedResourceStudentIdRef.current !== studentUserId) return
        commitStudentPortraitHandoff(studentUserId, assets)
      })
      .catch((err) => {
        if (cancelled || selectedResourceStudentIdRef.current !== studentUserId) return
        const fallbackStudentId = displayedResourceStudentIdRef.current
        if (fallbackStudentId && fallbackStudentId !== studentUserId) {
          selectedResourceStudentIdRef.current = fallbackStudentId
          startTransition(() => setSelectedResourceStudentId(fallbackStudentId))
        } else {
          displayedResourceStudentIdRef.current = studentUserId
          setDisplayedResourceStudentId(studentUserId)
          setViewedStudentAssets([])
          setStudentPortraitHandoffCycle((current) => current === 'a' ? 'b' : 'a')
          setStudentPortraitStable(true)
        }
        setViewedStudentAssetsLoading(false)
        notifyTeamError(normalizeErrorMessage(err, lang))
      })

    return () => {
      cancelled = true
    }
  }, [commitStudentPortraitHandoff, lang, loadStudentPortraitAssets, notifyTeamError, selectedResourceStudentId, summary?.team.id, viewerRole])

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
    const studentUserId = studentSnippetTargetUserId ?? displayedResourceStudentId
    const presetId = studentSnippetPreset?.id ?? 'student-snippet'
    if (!teamId || !studentUserId || applyingStudentPresetId) return

    setApplyingStudentPresetId(presetId)
    try {
      const created = await phdApi.addTeamMemberProfileAsset(
        session.token,
        teamId,
        studentUserId,
        input,
      )
      updateCachedStudentPortraitAssets(
        studentUserId,
        (items) => [created, ...items.filter((item) => item.id !== created.id)],
      )
      if (displayedResourceStudentIdRef.current === studentUserId) {
        setEnteredStudentAssetId(created.id)
        setViewedStudentAssetQuery('')
        setViewedStudentAssets((items) => [created, ...items.filter((item) => item.id !== created.id)])
        setExpandedStudentFamilyId(profileAssetFamilyId(created))
      } else {
        selectResourceStudent(studentUserId)
      }
      notifyTeamSuccess(tx('team.studentProfileSnippetAdded'))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setApplyingStudentPresetId(null)
    }
  }

  function openSelectedStudentSnippet(asset: ProfileAsset) {
    if (deletingViewedStudentAssetId === asset.id) return
    void loadTeamSnippetEditorDialog().catch(() => undefined)
    setStudentSnippetPreset(null)
    setStudentSnippetTargetUserId(null)
    setEditingViewedStudentAssetId(asset.id)
  }

  function toggleStudentAssetFamily(familyId: string, open: boolean) {
    const stack = studentFamilyStackRefs.current.get(familyId)
    const grid = stack?.parentElement
    if (grid) {
      const targets = [...grid.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      )
      pendingStudentFamilyLayoutFlipRef.current = new Map(
        targets.map((element) => [element, element.getBoundingClientRect()]),
      )
      studentFamilyLayoutAnimationsRef.current.forEach((animation) => animation.cancel())
      studentFamilyLayoutAnimationsRef.current = []
    }
    setExpandedStudentFamilyId(open ? null : familyId)
  }

  async function updateSelectedStudentSnippet(assetId: string, input: Partial<ProfileAssetInput>) {
    const teamId = summary?.team.id
    const studentUserId = displayedResourceStudentId
    if (!teamId || !studentUserId) return

    try {
      const updated = await phdApi.updateTeamMemberProfileAsset(
        session.token,
        teamId,
        studentUserId,
        assetId,
        input,
      )
      updateCachedStudentPortraitAssets(
        studentUserId,
        (items) => items.map((item) => item.id === updated.id ? updated : item),
      )
      if (displayedResourceStudentIdRef.current === studentUserId) {
        setViewedStudentAssets((items) => items.map((item) => item.id === updated.id ? updated : item))
      }
      notifyTeamSuccess(tx('toast.profileAssetUpdated'))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    }
  }

  async function deleteSelectedStudentSnippet() {
    const asset = pendingViewedStudentAssetDelete
    const teamId = summary?.team.id
    const studentUserId = displayedResourceStudentId
    if (!asset || !teamId || !studentUserId || deletingViewedStudentAssetId) return

    setPendingViewedStudentAssetDelete(null)
    setDeletingViewedStudentAssetId(asset.id)
    try {
      await phdApi.deleteTeamMemberProfileAsset(
        session.token,
        teamId,
        studentUserId,
        asset.id,
      )
      updateCachedStudentPortraitAssets(
        studentUserId,
        (items) => items.filter((item) => item.id !== asset.id),
      )
      if (displayedResourceStudentIdRef.current === studentUserId) {
        setViewedStudentAssets((items) => items.filter((item) => item.id !== asset.id))
        setEditingViewedStudentAssetId((current) => current === asset.id ? null : current)
      }
      notifyTeamSuccess(tx('toast.profileAssetDeleted'))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setDeletingViewedStudentAssetId(null)
    }
  }

  const viewerTeacherPermissions = teamTeacherPermissions(
    summary?.membership?.relationships,
    summary?.team.permissionDefaults,
  )
  const canInvite = viewerRole === 'owner'
    || (viewerRole === 'admin' && viewerTeacherPermissions.inviteStudents)
  const canDiscover = canUseTeamDiscover(
    viewerRole,
    summary?.membership,
    summary?.team.permissionDefaults,
  )
  const canRename = viewerRole === 'owner'
  const canManageLogo = viewerRole === 'owner'
  const invitableRoles = useMemo<Array<Exclude<TeamRole, 'owner'>>>(
    () => viewerRole === 'owner' ? [...INVITABLE_ROLES] : ['member'],
    [viewerRole],
  )
  const visibleTeamTabs = useMemo<TeamSection[]>(() => {
    if (viewerRole === 'member') return ['overview', 'applications', 'resources']
    if (viewerRole === 'admin') {
      return [
        'overview',
        'applications',
        'members',
        'resources',
        ...(canDiscover ? ['discover' as const] : []),
      ]
    }
    return TEAM_TABS
  }, [canDiscover, viewerRole])
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
  const studentTeachersFor = useCallback(
    (member: TeamMember) => teachersForStudent(member, membersByUserId),
    [membersByUserId],
  )
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

  const teacherGroups = summary?.team.teacherGroups ?? EMPTY_TEACHER_GROUPS
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

  useLayoutEffect(() => {
    setTeacherGroupRenameDraft(activeTeacherGroup?.name ?? '')
  }, [activeTeacherGroup?.id, activeTeacherGroup?.name])

  useLayoutEffect(() => {
    if (renderedMemberWorkspaceView !== 'teacher-groups') {
      finishTeacherGroupNavIndicatorMotion()
      return undefined
    }

    positionTeacherGroupNavIndicator(selectedTeacherGroupId)
    const nav = teacherGroupNavRef.current
    const activeButton = teacherGroupNavButtonRefs.current.get(selectedTeacherGroupId)
    if (!nav || !activeButton) return undefined

    const reposition = () => positionTeacherGroupNavIndicator(selectedTeacherGroupId)
    window.addEventListener('resize', reposition)
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', reposition)
    }

    const observer = new ResizeObserver(reposition)
    observer.observe(nav)
    observer.observe(activeButton)
    return () => {
      window.removeEventListener('resize', reposition)
      observer.disconnect()
    }
  }, [
    finishTeacherGroupNavIndicatorMotion,
    positionTeacherGroupNavIndicator,
    renderedMemberWorkspaceView,
    selectedTeacherGroupId,
    teacherGroupCreateOpen,
    teacherGroups,
  ])

  const relationshipStudents = useMemo(
    () => (summary?.members ?? []).filter((member) => (
      member.status === 'active' && member.role === 'member' && Boolean(member.userId)
    )),
    [summary],
  )

  useEffect(() => {
    if (!selectedRelationStudentId) return
    if (relationshipStudents.some((student) => student.id === selectedRelationStudentId)) return
    setSelectedRelationStudentId(null)
    setRelationInspectorOpen(false)
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
  }, [activeTab, filteredApplications, applicationsByOwner, membersByUserId, studentTeachersFor, summary])

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
  const priorityApplications = useMemo(() => sortedTeamApplications
    .map((application) => ({
      application,
      due: daysUntil(application.deadline),
      health: applicationHealth(application),
    }))
    .filter((item) => item.health === 'risk' || item.health === 'watch' || (item.due >= 0 && item.due <= 30))
    .slice(0, 6), [sortedTeamApplications])
  const pendingMembers = summary?.members.filter((member) => member.status === 'pending') ?? []
  const pendingTransferRequests = summary?.transferRequests ?? EMPTY_TRANSFER_REQUESTS
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
        renderedTeamDiscoverFilter === 'attention'
        && row.state !== 'risk'
        && row.state !== 'due'
        && row.state !== 'feedback'
      ) return false
      if (renderedTeamDiscoverFilter === 'missing' && row.state !== 'missing') return false
      if (!query) return true
      const advisors = teachersForStudent(row.member, membersByUserId)
      return [
        memberDisplayName(row.member, ''),
        memberEmail(row.member),
        advisors.map((advisor) => memberDisplayName(advisor, '')).join(' '),
        row.applications.map((application) => application.school.name).join(' '),
      ].join(' ').toLowerCase().includes(query)
    })
  }, [accessibleStudentProfileRows, membersByUserId, renderedTeamDiscoverFilter, teamDiscoverQuery])
  const selectedResourceStudent = accessibleStudentProfileRows.find(
    (row) => row.member.userId === (displayedResourceStudentId ?? selectedResourceStudentId),
  ) ?? null
  const presetTargetStudent = accessibleStudentProfileRows.find(
    (row) => row.member.userId === presetTargetStudentId,
  ) ?? selectedResourceStudent ?? accessibleStudentProfileRows[0] ?? null
  const studentSnippetTarget = accessibleStudentProfileRows.find(
    (row) => row.member.userId === studentSnippetTargetUserId,
  ) ?? null
  const activeStudentSnippetEditorTarget = editingViewedStudentAsset
    ? selectedResourceStudent
    : studentSnippetTarget
  const activeStudentSnippetEditorTargetName = activeStudentSnippetEditorTarget
    ? memberDisplayName(activeStudentSnippetEditorTarget.member, tx('team.memberFallback'))
    : ''

  useEffect(() => {
    const selectable = accessibleStudentProfileRows
      .map((row) => row.member.userId)
      .filter((userId): userId is string => Boolean(userId))
    if (!selectedResourceStudentId && selectable.length > 0) {
      selectResourceStudent(selectable[0])
      return
    }
    if (selectedResourceStudentId && !selectable.includes(selectedResourceStudentId)) {
      selectedResourceStudentIdRef.current = null
      setSelectedResourceStudentId(null)
      setPresetTargetStudentId(selectable[0] ?? null)
    }
    if (presetTargetStudentId && !selectable.includes(presetTargetStudentId)) {
      setPresetTargetStudentId(selectable[0] ?? null)
    }
  }, [
    accessibleStudentProfileRows,
    presetTargetStudentId,
    selectResourceStudent,
    selectedResourceStudentId,
  ])

  useLayoutEffect(() => {
    positionStudentPortraitSelection(selectedResourceStudentId)
    const list = studentPortraitListRef.current
    const row = selectedResourceStudentId
      ? studentPortraitRowRefs.current.get(selectedResourceStudentId)
      : null
    if (!list || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(() => {
      positionStudentPortraitSelection(selectedResourceStudentId)
    })
    observer.observe(list)
    if (row) observer.observe(row)
    return () => observer.disconnect()
  }, [
    accessibleStudentProfileRows,
    positionStudentPortraitSelection,
    selectedResourceStudentId,
    studentProfileFilter,
    studentProfileSort,
    studentResourceQuery,
  ])

  useLayoutEffect(() => {
    if (!displayedResourceStudentId || !studentPortraitDossierScrollRef.current) return
    studentPortraitDossierScrollRef.current.scrollTop = 0
  }, [displayedResourceStudentId])

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
      notifyTeamError(tx('team.inviteTeacherRequired'))
      return false
    }
    setInviteBusy(true)
    try {
      await phdApi.inviteTeamMember(
        session.token,
        summary.team.id,
        inviteEmail.trim(),
        inviteRole,
        inviteRole === 'member' ? inviteTeacherIds : [],
      )
      notifyTeamSuccess(format(tx('team.inviteSent'), { email: inviteEmail.trim() }))
      setInviteEmail('')
      await syncAfterMutation()
      return true
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
      return false
    } finally {
      setInviteBusy(false)
    }
  }

  async function handleBulkInvite(
    event: FormEvent,
    allowedRoles: readonly Exclude<TeamRole, 'owner'>[],
  ): Promise<boolean> {
    event.preventDefault()
    if (!summary || !bulkInviteText.trim() || !canInvite) return false
    const preview = buildTeamBulkInvitePreview(
      bulkInviteText,
      invitationTeachers,
      allowedRoles,
    )
    if (
      preview.validRows.length === 0
      || preview.invalidRows.length > 0
      || preview.truncatedCount > 0
    ) {
      notifyTeamError(tx('team.bulkInviteResolveBeforeSubmit'))
      return false
    }
    setBulkInviteBusy(true)
    let sent = 0
    let failed = 0
    let skipped = 0
    try {
      for (const row of preview.validRows) {
        if (!row.role || !allowedRoles.includes(row.role)) {
          skipped += 1
          continue
        }
        try {
          await phdApi.inviteTeamMember(
            session.token,
            summary.team.id,
            row.email,
            row.role,
            row.teacherMemberIds,
          )
          sent += 1
        } catch {
          failed += 1
        }
      }
      notifyTeamSuccess(format(tx('team.bulkInviteResult'), { sent, failed, skipped }))
      if (sent > 0) {
        setBulkInviteText('')
        setBulkInviteFileName('')
        setBulkInviteImportMessage(null)
        await syncAfterMutation()
      }
      return sent > 0
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
      return false
    } finally {
      setBulkInviteBusy(false)
    }
  }

  async function handleBulkInviteCsvChange(
    event: ChangeEvent<HTMLInputElement>,
    allowedRoles: readonly Exclude<TeamRole, 'owner'>[],
  ) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setBulkInviteFileName(file.name)
    if (file.size > MAX_CSV_IMPORT_FILE_SIZE) {
      setBulkInviteImportMessage({
        tone: 'error',
        text: format(tx('team.bulkInviteFileTooLarge'), {
          size: Math.round(MAX_CSV_IMPORT_FILE_SIZE / (1024 * 1024)),
        }),
      })
      return
    }
    try {
      const contents = await file.text()
      const preview = buildTeamBulkInvitePreview(
        contents,
        invitationTeachers,
        allowedRoles,
      )
      if (preview.rows.length === 0) {
        setBulkInviteImportMessage({ tone: 'error', text: tx('team.bulkInviteFileInvalid') })
        return
      }
      setBulkInviteText(contents)
      setBulkInviteImportMessage({
        tone: 'success',
        text: format(tx('team.bulkInviteImported'), { count: preview.rows.length }),
      })
    } catch {
      setBulkInviteImportMessage({ tone: 'error', text: tx('team.bulkInviteFileInvalid') })
    }
  }

  function downloadBulkInviteTemplate(
    allowedRoles: readonly Exclude<TeamRole, 'owner'>[],
  ) {
    downloadCsvFile(
      createTeamBulkInviteTemplate(invitationTeachers, allowedRoles),
      tx('team.bulkInviteTemplateFilename'),
    )
  }

  function bulkInviteIssueLabel(issue: TeamBulkInviteIssue) {
    if (issue.code === 'invalid-email') return tx('team.bulkInviteIssueInvalidEmail')
    if (issue.code === 'invalid-role') {
      return format(tx('team.bulkInviteIssueInvalidRole'), { value: issue.value || '-' })
    }
    if (issue.code === 'unavailable-role') {
      return format(tx('team.bulkInviteIssueUnavailableRole'), { value: issue.value || '-' })
    }
    if (issue.code === 'missing-teachers') return tx('team.bulkInviteIssueMissingTeachers')
    if (issue.code === 'unknown-teacher') {
      return format(tx('team.bulkInviteIssueUnknownTeacher'), { value: issue.value || '-' })
    }
    if (issue.code === 'ambiguous-teacher') {
      return format(tx('team.bulkInviteIssueAmbiguousTeacher'), { value: issue.value || '-' })
    }
    return tx('team.bulkInviteIssueDuplicateEmail')
  }

  async function handleRedeemJoinCode(event: FormEvent) {
    event.preventDefault()
    const value = joinCode.trim()
    if (!value) return
    setJoinBusy(true)
    try {
      const result = await phdApi.redeemTeamJoinCode(session.token, value)
      setJoinCode('')
      notifyTeamSuccess(format(tx('team.joinCodeJoined'), { team: result.team.name }))
      await syncAfterMutation()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
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
    try {
      await phdApi.updateTeamMemberRole(session.token, summary.team.id, member.id, role)
      notifyTeamSuccess(format(tx('team.roleUpdated'), {
        name: memberDisplayName(member, tx('team.memberFallback')),
        role: tx(ROLE_LABEL_KEYS[role]),
      }))
      await syncAfterMutation()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleStudentTeachersChange(member: TeamMember, teacherMemberIds: string[]) {
    if (!summary || member.role !== 'member') return false
    setRowBusyId(member.id)
    try {
      await phdApi.updateTeamMemberAccess(
        session.token,
        summary.team.id,
        member.id,
        { teacherIds: teacherMemberIds },
      )
      notifyTeamSuccess(format(tx('team.relationshipUpdated'), {
        name: memberDisplayName(member, tx('team.memberFallback')),
      }))
      await syncAfterMutation()
      return true
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
      return false
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleDelegatedAccessChange(
    member: TeamMember,
    patch: {
      studentPermissions?: Partial<TeamStudentPermissions> | null
      teacherPermissions?: Partial<TeamTeacherPermissions> | null
    },
  ) {
    if (!summary) return
    try {
      const updated = await phdApi.updateTeamMemberAccess(
        session.token,
        summary.team.id,
        member.id,
        patch,
      )
      setSummary((current) => {
        if (!current || current.team.id !== summary.team.id) return current
        const mergeUpdatedMember = (candidate: TeamMember) => (
          candidate.id === updated.id ? { ...candidate, ...updated } : candidate
        )
        return {
          ...current,
          members: current.members.map(mergeUpdatedMember),
          membership: current.membership?.id === updated.id
            ? mergeUpdatedMember(current.membership)
            : current.membership,
        }
      })
      notifyTeamSuccess(format(tx('team.delegatedAccessUpdated'), {
        name: memberDisplayName(member, tx('team.memberFallback')),
      }))
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
      throw err
    }
  }

  async function handlePermissionDefaultsChange(patch: {
    student?: Partial<TeamStudentPermissions>
    teacher?: Partial<TeamTeacherPermissions>
  }) {
    if (!summary) return
    try {
      const updated = await phdApi.updateTeamPermissionDefaults(
        session.token,
        summary.team.id,
        patch,
      )
      setSummary((current) => (
        current?.team.id === updated.id
          ? { ...current, team: { ...current.team, ...updated } }
          : current
      ))
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
      throw err
    }
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
        transform: `scale(${zoomChange.previousZoom})`,
        opacity: 0.94,
      },
      {
        transform: `scale(${zoomChange.nextZoom})`,
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
    try {
      const created = await phdApi.createTeamTeacherGroup(session.token, summary.team.id, { name })
      updateTeacherGroupsLocally([...teacherGroups, created])
      setSelectedTeacherGroupId(created.id)
      setTeacherGroupDraftName('')
      setTeacherGroupCreateOpen(false)
      notifyTeamSuccess(format(tx('team.teacherGroupCreated'), { name: created.name }))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleRenameTeacherGroup() {
    const name = teacherGroupRenameDraft.trim()
    if (!summary || !activeTeacherGroup || !name || name === activeTeacherGroup.name) return
    setTeacherGroupBusyId(activeTeacherGroup.id)
    try {
      const updated = await phdApi.updateTeamTeacherGroup(
        session.token,
        summary.team.id,
        activeTeacherGroup.id,
        { name },
      )
      updateTeacherGroupsLocally(teacherGroups.map((group) => group.id === updated.id ? updated : group))
      notifyTeamSuccess(tx('team.teacherGroupSaved'))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
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
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleDeleteTeacherGroup() {
    if (!summary || !pendingTeacherGroupDelete) return
    const deleting = pendingTeacherGroupDelete
    setTeacherGroupBusyId(deleting.id)
    try {
      await phdApi.deleteTeamTeacherGroup(session.token, summary.team.id, deleting.id)
      updateTeacherGroupsLocally(teacherGroups.filter((group) => group.id !== deleting.id))
      setPendingTeacherGroupDelete(null)
      setSelectedTeacherGroupId('all')
      notifyTeamSuccess(format(tx('team.teacherGroupDeleted'), { name: deleting.name }))
      void onChanged?.()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setTeacherGroupBusyId(null)
    }
  }

  async function handleRemove() {
    if (!summary || !pendingRemove) return
    setRowBusyId(pendingRemove.id)
    try {
      await phdApi.removeTeamMember(session.token, summary.team.id, pendingRemove.id)
      notifyTeamSuccess(format(tx('team.memberRemoved'), {
        name: memberDisplayName(pendingRemove, tx('team.memberFallback')),
      }))
      setPendingRemove(null)
      await syncAfterMutation()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleTransferDecision(requestId: string, decision: 'approve' | 'reject', teacherMemberId?: string) {
    if (!summary) return
    setTransferBusyId(requestId)
    try {
      const result = decision === 'approve'
        ? await phdApi.approveTeamTransferRequest(session.token, summary.team.id, requestId, teacherMemberId)
        : await phdApi.rejectTeamTransferRequest(session.token, summary.team.id, requestId)
      notifyTeamSuccess(format(
        tx(decision === 'approve' ? 'team.transferApproved' : 'team.transferRejected'),
        { name: result.school.name },
      ))
      setSelectedTransferTeacherId('')
      await syncAfterMutation()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
    } finally {
      setTransferBusyId(null)
    }
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
    try {
      const logoDataUrl = await normalizeTeamLogoFile(file)
      const updatedTeam = await phdApi.updateTeam(session.token, summary.team.id, { logoDataUrl })
      setSummary((current) => current && current.team.id === updatedTeam.id
        ? { ...current, team: { ...current.team, ...updatedTeam } }
        : current)
      notifyTeamSuccess(tx('team.logoSaved'))
      await syncAfterMutation()
    } catch (err) {
      if (err instanceof TeamLogoError) {
        notifyTeamError(tx(err.reason === 'file-type'
          ? 'team.logoFormatUnsupported'
          : err.reason === 'file-size'
            ? 'team.logoFileSize'
            : 'team.logoInvalidImage'))
      } else {
        notifyTeamError(normalizeErrorMessage(err, lang))
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
    try {
      await phdApi.renameTeam(session.token, summary.team.id, teamName.trim())
      setRenaming(false)
      notifyTeamSuccess(tx('team.renameSaved'))
      await syncAfterMutation()
    } catch (err) {
      notifyTeamError(normalizeErrorMessage(err, lang))
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
    const canFocusRelationship = (member.role === 'member' || member.role === 'admin') && member.status === 'active'
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

  function openRelationInspectorForStudent(studentId: string) {
    setSelectedRelationStudentId(studentId)
    setRelationInspectorOpen(true)
  }

  function closeRelationInspector(restoreHandleFocus = false) {
    setRelationInspectorOpen(false)
    if (!restoreHandleFocus) return
    if (relationInspectorSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(relationInspectorSettleFrameRef.current)
    }
    relationInspectorSettleFrameRef.current = window.requestAnimationFrame(() => {
      relationInspectorSettleFrameRef.current = null
      const handle = relationInspectorResizeHandleRef.current
      if (handle?.isConnected) handle.focus({ preventScroll: true })
    })
  }

  function handleRelationInspectorResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !selectedRelationStudentId) return
    const board = relationBoardRef.current
    const handle = relationInspectorResizeHandleRef.current
    if (!board || !handle) return

    event.preventDefault()
    event.stopPropagation()
    relationInspectorResizeCleanupRef.current?.()

    const boardBounds = board.getBoundingClientRect()
    const handleBounds = handle.getBoundingClientRect()
    const grabOffset = event.clientX - handleBounds.left
    const startClientX = event.clientX
    const startOpen = relationInspectorOpen
    const startWidth = relationInspectorWidth
    const maximumWidth = Math.min(
      TEAM_RELATION_INSPECTOR_MAX_WIDTH,
      Math.max(TEAM_RELATION_INSPECTOR_MIN_WIDTH, boardBounds.width - 320),
    )
    let latestRawWidth = startOpen ? startWidth : 0
    let moved = false
    let revealed = startOpen

    const paintWidth = (width: number) => {
      board.style.setProperty(
        '--team-relation-inspector-width',
        `${Math.max(0, Math.min(maximumWidth, width))}px`,
      )
    }

    const widthFromPointer = (clientX: number) => (
      boardBounds.right - clientX + grabOffset - handleBounds.width
    )

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      document.body.classList.remove('team-relation-inspector-resizing')
      board.classList.remove('is-resizing')
      if (relationInspectorResizeCleanupRef.current === cleanup) {
        relationInspectorResizeCleanupRef.current = null
      }
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault()
      if (!moved && Math.abs(pointerEvent.clientX - startClientX) < TEAM_RELATION_INSPECTOR_DRAG_THRESHOLD) {
        return
      }
      moved = true
      latestRawWidth = widthFromPointer(pointerEvent.clientX)
      if (!revealed) {
        if (latestRawWidth < TEAM_RELATION_INSPECTOR_REVEAL_WIDTH) return
        revealed = true
        board.classList.remove('is-inspector-closed')
        board.classList.add('is-inspector-open')
        setRelationInspectorOpen(true)
      }
      paintWidth(latestRawWidth)
    }

    const finishResize = () => {
      cleanup()
      setRelationInspectorResizing(false)

      if (!moved) {
        paintWidth(startWidth)
        if (!startOpen) setRelationInspectorOpen(true)
        return
      }

      if (!revealed || latestRawWidth < TEAM_RELATION_INSPECTOR_CLOSE_WIDTH) {
        board.classList.remove('is-inspector-open')
        board.classList.add('is-inspector-closed')
        setRelationInspectorOpen(false)
        if (relationInspectorSettleFrameRef.current !== null) {
          window.cancelAnimationFrame(relationInspectorSettleFrameRef.current)
        }
        relationInspectorSettleFrameRef.current = window.requestAnimationFrame(() => {
          relationInspectorSettleFrameRef.current = null
          paintWidth(startWidth)
        })
        return
      }

      const settledWidth = Math.min(
        maximumWidth,
        Math.max(TEAM_RELATION_INSPECTOR_MIN_WIDTH, Math.round(latestRawWidth)),
      )
      paintWidth(settledWidth)
      setRelationInspectorWidth(settledWidth)
      setRelationInspectorOpen(true)
    }

    setRelationInspectorResizing(true)
    board.classList.add('is-resizing')
    document.body.classList.add('team-relation-inspector-resizing')
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    relationInspectorResizeCleanupRef.current = cleanup
  }

  function handleRelationInspectorResizeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!selectedRelationStudentId) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setRelationInspectorOpen((open) => !open)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (event.key === 'ArrowLeft') {
      setRelationInspectorOpen(true)
      setRelationInspectorWidth((width) => Math.min(TEAM_RELATION_INSPECTOR_MAX_WIDTH, width + 24))
      return
    }
    if (!relationInspectorOpen || relationInspectorWidth <= TEAM_RELATION_INSPECTOR_MIN_WIDTH) {
      closeRelationInspector()
      return
    }
    setRelationInspectorWidth((width) => Math.max(TEAM_RELATION_INSPECTOR_MIN_WIDTH, width - 24))
  }

  function focusMemberInRelationshipMap(member: TeamMember) {
    if ((member.role !== 'member' && member.role !== 'admin') || member.status !== 'active') return
    setMemberQuery('')
    setMemberStatusFilter('all')
    if (member.role === 'member') openRelationInspectorForStudent(member.id)
    setRelationFocus({ memberId: member.id, nonce: Date.now() })
    setMemberView('map')
  }

  useLayoutEffect(() => {
    if (renderedMemberWorkspaceView !== 'students' || memberView !== 'map' || !relationFocus) return undefined
    const frame = window.requestAnimationFrame(() => {
      const canvas = relationCanvasRef.current
      const target = [...(canvas?.querySelectorAll<HTMLElement>('[data-relation-member-id]') ?? [])]
        .find((node) => node.dataset.relationMemberId === relationFocus.memberId)
      if (!canvas || !target) return
      target.classList.remove('is-located')
      void target.offsetWidth
      target.classList.add('is-located')
      const canvasRect = canvas.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      canvas.scrollTo({
        left: Math.max(0, canvas.scrollLeft + targetRect.left + targetRect.width / 2 - canvasRect.left - canvasRect.width / 2),
        top: Math.max(0, canvas.scrollTop + targetRect.top + targetRect.height / 2 - canvasRect.top - canvasRect.height / 2),
        behavior: 'smooth',
      })
      target.focus({ preventScroll: true })
      window.setTimeout(() => target.classList.remove('is-located'), getMotionDelay(1500))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [memberView, relationFocus, renderedMemberWorkspaceView])

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
              onCommit={(teacherUserIds) => handleStudentTeachersChange(
                member,
                teacherMemberIdsForUserIds(teacherUserIds),
              )}
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

  function renderDelegatedAccessControls(member: TeamMember) {
    const canEdit = member.role === 'member'
      ? viewerRole === 'owner' || (
          viewerRole === 'admin'
          && viewerTeacherPermissions.manageStudentPermissions
          && isTeacherAssignedToStudent(member, session.user.id)
        )
      : member.role === 'admin' && viewerRole === 'owner'
    if (!canEdit) return null
    const studentStats = summary?.memberStats?.[member.id]
    return (
      <TeamMemberPermissionEditor
        role={member.role as 'member' | 'admin'}
        relationships={member.relationships}
        defaults={summary?.team.permissionDefaults}
        usage={member.relationships?.usage}
        activeApplications={studentStats?.applicationCount}
        activeShares={studentStats?.studentActiveShareCount}
        onSave={(patch) => handleDelegatedAccessChange(member, patch)}
      />
    )
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
        data-relation-member-id={student.id}
        className={`team-relation-node student ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}${dragging ? ' is-dragging' : ''}${canDrag ? ' is-draggable' : ''}${rowBusyId === student.id ? ' is-updating' : ''}${arriving ? ` is-arriving mode-${relationArrival.mode}` : ''}`}
        aria-pressed={selected}
        aria-controls="team-relation-inspector"
        aria-expanded={selected && relationInspectorOpen}
        aria-busy={rowBusyId === student.id || undefined}
        aria-haspopup="menu"
        draggable={canDrag}
        onClick={() => openRelationInspectorForStudent(student.id)}
        onContextMenu={(event) => {
          openRelationInspectorForStudent(student.id)
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
    const assignedTeacherUserIds = invitationTeachers
      .filter((teacher) => inviteTeacherIds.includes(teacher.id))
      .map((teacher) => teacher.userId)
      .filter((teacherUserId): teacherUserId is string => Boolean(teacherUserId))

    return (
      <div className="team-invite-teacher-picker">
        <div>
          <span>{tx('team.inviteTeacherAssignment')}</span>
          <p>{tx('team.inviteTeacherAssignmentDescription')}</p>
        </div>
        {invitationTeachers.length > 0 ? (
          <TeamTeacherAssignmentPicker
            teachers={invitationTeachers}
            assignedTeacherUserIds={assignedTeacherUserIds}
            busy={inviteBusy || bulkInviteBusy}
            title={tx('team.inviteTeacherAssignment')}
            description={tx('team.inviteTeacherAssignmentDescription')}
            emptySelectionLabel={tx('team.inviteTeacherRequired')}
            ariaLabel={tx('team.inviteTeacherAssignment')}
            onCommit={(teacherUserIds) => {
              const selectedUserIds = new Set(teacherUserIds)
              setInviteTeacherIds(invitationTeachers
                .filter((teacher) => Boolean(
                  teacher.userId && selectedUserIds.has(teacher.userId),
                ))
                .map((teacher) => teacher.id))
              return true
            }}
          />
        ) : (
          <p className="team-invite-teacher-empty">{tx('team.joinCodeNoTeachers')}</p>
        )}
      </div>
    )
  }

  function renderInvitePopover(close: () => void, teacherOnly = false) {
    const roles = teacherOnly ? (['member'] as const) : invitableRoles
    const preview = buildTeamBulkInvitePreview(bulkInviteText, invitationTeachers, roles)
    const previewRows = preview.rows.slice(0, 6)
    const remainingPreviewRows = Math.max(0, preview.rows.length - previewRows.length)
    const bulkInviteReady = preview.validRows.length > 0
      && preview.invalidRows.length === 0
      && preview.truncatedCount === 0
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

        {inviteMode === 'single' ? (
          <form
            className="team-invite-popover-form"
            onSubmit={async (event) => {
              const ok = await handleInvite(event)
              if (ok) close()
            }}
          >
            <div className="team-invite-popover-body">
              {inviteRole === 'member' ? renderInviteTeacherPicker() : null}
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
              {seatFull ? (
                <div className="team-inline-warning" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  {tx('team.seatLimitReached')}
                </div>
              ) : null}
            </div>
            <div className="team-invite-popover-actions">
              <button type="button" className="quiet-action" onClick={close}>{tx('cancel')}</button>
              <button
                type="submit"
                className="primary-action"
                disabled={inviteBusy || seatFull || !inviteEmail.trim() || (inviteRole === 'member' && inviteTeacherIds.length === 0)}
                aria-busy={inviteBusy || undefined}
              >
                {inviteBusy ? (
                  <PendingLabel label={tx('working')} />
                ) : (
                  <><Mail size={13} aria-hidden="true" /> {tx('team.inviteSubmit')}</>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="team-invite-popover-form"
            onSubmit={async (event) => {
              const ok = await handleBulkInvite(event, roles)
              if (ok) close()
            }}
          >
            <div className="team-invite-popover-body">
              <p className="team-panel-note">{tx('team.bulkInviteDesc')}</p>
              <div className="team-bulk-invite-workspace">
                <div className="team-bulk-invite-toolbar">
                  <span>
                    <strong>{tx('team.bulkInviteDataLabel')}</strong>
                    <small>{tx('team.bulkInviteDataHint')}</small>
                  </span>
                  <div className="team-bulk-invite-toolbar-actions">
                    <input
                      ref={bulkInviteFileInputRef}
                      className="sr-only"
                      type="file"
                      accept=".csv,text/csv"
                      tabIndex={-1}
                      onChange={(event) => void handleBulkInviteCsvChange(event, roles)}
                    />
                    <button
                      type="button"
                      className="quiet-action compact-action"
                      disabled={bulkInviteBusy || seatFull}
                      onClick={() => bulkInviteFileInputRef.current?.click()}
                    >
                      <Upload size={13} aria-hidden="true" />
                      {tx('team.bulkInviteUpload')}
                    </button>
                    <button
                      type="button"
                      className="quiet-action compact-action"
                      onClick={() => downloadBulkInviteTemplate(roles)}
                    >
                      <Download size={13} aria-hidden="true" />
                      {tx('team.bulkInviteDownloadTemplate')}
                    </button>
                  </div>
                </div>
                <textarea
                  className="team-bulk-invite-input"
                  aria-label={tx('team.bulkInviteDataLabel')}
                  autoFocus
                  value={bulkInviteText}
                  onChange={(event) => {
                    setBulkInviteText(event.target.value)
                    setBulkInviteFileName('')
                    setBulkInviteImportMessage(null)
                  }}
                  placeholder={tx('team.bulkInvitePlaceholder')}
                  rows={6}
                  disabled={bulkInviteBusy || seatFull}
                />
                {bulkInviteImportMessage ? (
                  <div
                    className={`team-bulk-invite-import-message is-${bulkInviteImportMessage.tone}`}
                    role={bulkInviteImportMessage.tone === 'error' ? 'alert' : 'status'}
                  >
                    {bulkInviteImportMessage.tone === 'success'
                      ? <Check size={13} aria-hidden="true" />
                      : <AlertTriangle size={13} aria-hidden="true" />}
                    <span>
                      {bulkInviteFileName ? <strong>{bulkInviteFileName}</strong> : null}
                      {bulkInviteImportMessage.text}
                    </span>
                  </div>
                ) : null}
                {preview.rows.length > 0 ? (
                  <div className="team-bulk-invite-preview">
                    <div className="team-bulk-invite-preview-head">
                      <span className="is-ready">
                        <Check size={12} aria-hidden="true" />
                        {format(tx('team.bulkInvitePreviewReady'), { count: preview.validRows.length })}
                      </span>
                      {preview.invalidRows.length > 0 ? (
                        <span className="has-issues">
                          <AlertTriangle size={12} aria-hidden="true" />
                          {format(tx('team.bulkInvitePreviewNeedsReview'), { count: preview.invalidRows.length })}
                        </span>
                      ) : null}
                    </div>
                    <div className="team-bulk-invite-preview-list" role="list">
                      {previewRows.map((row) => (
                        <div
                          key={`${row.lineNumber}:${row.email}`}
                          className={row.issues.length > 0 ? 'has-issues' : 'is-ready'}
                          role="listitem"
                        >
                          <span className="team-bulk-invite-line-number">{row.lineNumber}</span>
                          <span className="team-bulk-invite-row-copy">
                            <strong>{row.email || tx('team.bulkInviteMissingEmail')}</strong>
                            <small>
                              {row.role ? labelForRole(row.role) : tx('team.bulkInviteUnknownRole')}
                              {row.teacherNames.length > 0 ? ` · ${row.teacherNames.join(' · ')}` : ''}
                            </small>
                          </span>
                          <span className="team-bulk-invite-row-status">
                            {row.issues.length > 0
                              ? row.issues.map(bulkInviteIssueLabel).join(' · ')
                              : <Check size={13} aria-label={tx('team.bulkInviteRowReady')} />}
                          </span>
                        </div>
                      ))}
                    </div>
                    {remainingPreviewRows > 0 ? (
                      <p className="team-bulk-invite-preview-more">
                        {format(tx('team.bulkInvitePreviewMore'), { count: remainingPreviewRows })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {preview.truncatedCount > 0 ? (
                  <div className="team-inline-warning" role="alert">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {format(tx('team.bulkInviteRowLimit'), { count: MAX_TEAM_BULK_INVITE_ROWS })}
                  </div>
                ) : null}
              </div>
              {seatFull ? (
                <div className="team-inline-warning" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  {tx('team.seatLimitReached')}
                </div>
              ) : null}
            </div>
            <div className="team-invite-popover-actions">
              <button type="button" className="quiet-action" onClick={close}>{tx('cancel')}</button>
              <button
                type="submit"
                className="primary-action"
                disabled={
                  bulkInviteBusy
                  || seatFull
                  || !bulkInviteReady
                }
                aria-busy={bulkInviteBusy || undefined}
              >
                {bulkInviteBusy ? (
                  <PendingLabel label={tx('working')} />
                ) : (
                  <><UserPlus size={13} aria-hidden="true" /> {tx('team.bulkInviteSubmit')}</>
                )}
              </button>
            </div>
          </form>
        )}
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
    const selectedStudent = relationshipStudents.find((student) => student.id === selectedRelationStudentId) ?? null
    const inspectorVisible = Boolean(selectedStudent && relationInspectorOpen)
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
                <AnchoredPopover
                  trigger={<Info size={15} aria-hidden="true" />}
                  triggerAriaLabel={tx('team.relationshipInstructionsTitle')}
                  popoverAriaLabel={tx('team.relationshipInstructionsTitle')}
                  triggerClassName="team-relation-tool-button"
                  popoverClassName="team-relation-help-popover"
                  width={300}
                  estimatedHeight={176}
                  align="end"
                >
                  {() => (
                    <>
                      <strong>{tx('team.relationshipInstructionsTitle')}</strong>
                      <span><kbd>{tx('team.relationshipKeyAlt')}</kbd>{tx('team.relationshipInstructionAdd')}</span>
                      <span><kbd>{tx('team.relationshipKeyCtrl')}</kbd>{tx('team.relationshipInstructionMove')}</span>
                      <span><ZoomIn size={13} aria-hidden="true" />{tx('team.relationshipInstructionZoom')}</span>
                    </>
                  )}
                </AnchoredPopover>
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
        <div
          ref={relationBoardRef}
          className={`team-relation-board ${inspectorVisible ? 'is-inspector-open' : 'is-inspector-closed'}${relationInspectorResizing ? ' is-resizing' : ''}`}
          style={{ '--team-relation-inspector-width': `${relationInspectorWidth}px` } as CSSProperties}
        >
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
                      data-relation-member-id={teacher?.id}
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
          <button
            ref={relationInspectorResizeHandleRef}
            type="button"
            className="team-relation-inspector-resizer"
            aria-label={`${tx('team.relationshipInspectorEyebrow')} · ${tx('team.relationshipViewMap')}`}
            aria-controls="team-relation-inspector"
            aria-expanded={inspectorVisible}
            title={`${tx('team.relationshipInspectorEyebrow')} · ${tx('team.relationshipViewMap')}`}
            disabled={!selectedStudent}
            onPointerDown={handleRelationInspectorResizeStart}
            onKeyDown={handleRelationInspectorResizeKeyDown}
          >
            <span aria-hidden="true"><GripVertical size={13} /></span>
          </button>
          <aside
            id="team-relation-inspector"
            className="team-relation-inspector"
            aria-hidden={!inspectorVisible}
          >
            <div className="team-relation-inspector-scroll">
              {selectedStudent ? (
                <div key={selectedStudent.id} className="team-relation-inspector-content">
                  <div className="team-relation-inspector-head">
                    <TeamMemberAvatar member={selectedStudent} />
                    <span>
                      <em>{tx('team.relationshipInspectorEyebrow')}</em>
                      <strong>{memberDisplayName(selectedStudent, tx('team.memberFallback'))}</strong>
                      <small>{memberEmail(selectedStudent)}</small>
                    </span>
                    <button
                      type="button"
                      className="team-relation-inspector-close"
                      aria-label={tx('close')}
                      title={tx('close')}
                      onClick={() => closeRelationInspector(true)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
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
                        onCommit={(teacherUserIds) => handleStudentTeachersChange(
                          selectedStudent,
                          teacherMemberIdsForUserIds(teacherUserIds),
                        )}
                      />
                    ) : (
                      <div className="team-readonly-relation">
                        <span>{selectedTeachers.length
                          ? selectedTeachers.map((teacher) => memberDisplayName(teacher, tx('team.memberFallback'))).join(' · ')
                          : tx('team.relationshipNoAdvisor')}</span>
                      </div>
                    )}
                  </div>
                  {renderDelegatedAccessControls(selectedStudent)}
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
                </div>
              ) : (
                <div className="team-empty compact">
                  <span className="empty-state-icon"><Users size={18} aria-hidden="true" /></span>
                  <div>
                    <h3>{tx('team.relationshipNoStudents')}</h3>
                  </div>
                </div>
              )}
            </div>
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
                  style={{
                    '--team-overview-selected-index': selectedIndex,
                    '--team-overview-item-count': visibleRows.length,
                  } as CSSProperties}
                  data-item-count={visibleRows.length}
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
                        <span className="team-overview-queue-copy">
                          <strong>{memberDisplayName(row.member, tx('team.memberFallback'))}</strong>
                          <em>{tx(studentStateLabelKey(row.state))}</em>
                        </span>
                        <small className="team-overview-queue-count">{row.applications.length}</small>
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

    const owner = summary?.members.find((member) => (
      member.role === 'owner'
      || member.userId === summary?.team.ownerId
    )) ?? null
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
      { id: 'permissions' as const, label: tx('team.settingsPermissionsTitle'), icon: ShieldCheck },
      { id: 'quota' as const, label: tx('team.settingsQuotaTitle'), icon: Database },
      { id: 'key' as const, label: tx('team.ai.teamTitle'), icon: KeyRound },
    ]

    return (
      <div className="team-tab-panel team-settings-page role-owner team-organization-settings">
        <header className="team-organization-settings-hero">
          <span className="team-organization-settings-hero-icon"><Settings size={18} aria-hidden="true" /></span>
          <div>
            <h2>{tx('team.settingsOwnerTitle')}</h2>
            <p>{format(tx('team.settingsOwnerDesc'), { team: summary?.team.name ?? screenTitle })}</p>
          </div>
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
            <div className="team-organization-settings-account">
              <TeamMemberAvatar
                member={owner}
                fallbackName={summary?.team.name ?? screenTitle}
                className="team-organization-settings-avatar"
              />
              <span>
                <strong>{summary?.team.name ?? screenTitle}</strong>
                <em>{owner ? memberDisplayName(owner, tx('team.memberFallback')) : tx(ROLE_LABEL_KEYS.owner)}</em>
              </span>
            </div>
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
                <div className="team-organization-id-row">
                  <span className="team-organization-id-icon" aria-hidden="true">
                    <Fingerprint size={14} />
                  </span>
                  <span>
                    <small>{tx('team.settingsTeamIdLabel')}</small>
                    <code title={summary?.team.id}>{summary?.team.id}</code>
                    <em>{tx('team.settingsTeamIdDesc')}</em>
                  </span>
                  <CopyButton
                    value={summary?.team.id ?? ''}
                    label={tx('team.settingsTeamIdLabel')}
                    size={13}
                    className="team-organization-id-copy"
                    onNotify={onNotify}
                  />
                </div>
              </div>
            </section>

            <section
              id="team-organization-settings-permissions"
              className="team-organization-settings-section"
              aria-labelledby="team-organization-settings-permissions-title"
            >
              <div className="section-title team-organization-settings-title">
                <h4 id="team-organization-settings-permissions-title">
                  <ShieldCheck size={13} aria-hidden="true" />
                  {tx('team.settingsPermissionsTitle')}
                </h4>
              </div>
              <div className="team-organization-settings-group team-settings-permission-defaults">
                <TeamDefaultPermissionsEditor
                  defaults={summary?.team.permissionDefaults}
                  onSave={handlePermissionDefaultsChange}
                />
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
      shortLabel: string
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
        shortLabel: tx('team.transferQueueEyebrow'),
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
        shortLabel: tx('team.applicationHealthEyebrow'),
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
        shortLabel: tx('team.tabResources'),
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
        shortLabel: tx('team.tabMembers'),
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
        shortLabel: tx('team.pendingInvites'),
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
      shortLabel: tx('team.priorityQueueEmpty'),
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
                style={{
                  '--team-overview-selected-index': selectedIndex,
                  '--team-overview-item-count': focusItems.length,
                } as CSSProperties}
                data-item-count={focusItems.length}
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
                      aria-label={`${item.title}. ${item.desc}`}
                      onClick={() => setOwnerOverviewFocusKey(item.key)}
                    >
                      <span className="team-overview-queue-icon">{item.icon}</span>
                      <span className="team-overview-queue-copy">
                        <strong>{item.title}</strong>
                        <em>{item.desc}</em>
                        <span className="team-overview-queue-mobile-label">{item.shortLabel}</span>
                      </span>
                      <small className="team-overview-queue-count">{item.count}</small>
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
    if (!application.deadline) return '—'
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

  const renderStudentResourcesPersonalLayout = () => {
    const teamId = summary?.team.id ?? ''
    const ownProfileAssets = studentProfileAssets.filter((asset) => (
      asset.teamId === teamId && asset.studentUserId === session.user.id
    ))
    const profileAssetsForLayout: ProfileAsset[] = ownProfileAssets.map((asset) => ({
      id: asset.id,
      ownerId: session.user.id,
      kind: asset.kind,
      name: asset.name,
      description: asset.description,
      attachments: [],
      updatedAt: asset.updatedAt,
      createdAt: asset.updatedAt,
    }))
    const finishDelete = (assetId: string) => {
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
      <div className="team-tab-panel team-student-profile-parity">
        <ProfileScreen
          assets={profileAssetsForLayout}
          session={session}
          presetsOverride={teamProfilePresets}
          mode="organization-student"
          removingAssetIds={removingStudentProfileIds}
          onCreateSnippet={(input) => {
            const now = new Date().toISOString()
            setStudentProfileAssets((items) => [{
              id: `student-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              teamId,
              studentUserId: session.user.id,
              kind: input.kind,
              name: input.name.trim(),
              description: input.description.trim(),
              updatedAt: now,
            }, ...items])
          }}
          onUpdateAsset={(assetId, input) => {
            setStudentProfileAssets((items) => items.map((item) => item.id === assetId ? {
              ...item,
              kind: input.kind ?? item.kind,
              name: input.name?.trim() ?? item.name,
              description: input.description?.trim() ?? item.description,
              updatedAt: new Date().toISOString(),
            } : item))
          }}
          onDeleteAsset={(asset) => finishDelete(asset.id)}
          onUploadFiles={() => undefined}
          onRenameFile={() => undefined}
          onDeleteFile={() => undefined}
          onDownloadFile={() => undefined}
          onLoadFile={async () => new Blob()}
          onCreateShare={() => undefined}
          onRevokeShare={() => undefined}
          onUpdateSettings={() => undefined}
          onCopy={onCopy}
        />
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
      const renderedSourceFilter: ProfilePresetSourceFilter = (
        isOwnerLibrary && renderedPresetSourceFilter === 'mine'
      ) ? 'all' : renderedPresetSourceFilter
      const sourceCounts: Record<ProfilePresetSourceFilter, number> = {
        all: teamProfilePresets.length,
        system: buckets.system.length,
        org: buckets.org.length,
        mine: buckets.mine.length,
      }
      const sourcePresets = renderedSourceFilter === 'all'
        ? teamProfilePresets
        : renderedSourceFilter === 'system'
          ? buckets.system
          : renderedSourceFilter === 'org'
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
      const targetStudent = profileRows.find(
        (row) => row.member.userId === presetTargetStudent?.member.userId,
      ) ?? profileRows[0] ?? null
      const targetStudentName = targetStudent
        ? memberDisplayName(targetStudent.member, tx('team.memberFallback'))
        : ''
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
      const contextualAddSource: ProfilePresetSource = isOwnerLibrary ? 'org' : 'mine'
      const showContextualAdd = canManagePresets
        && !normalizedPresetQuery
        && renderedSourceFilter === contextualAddSource
      const contextualAddLabel = tx(
        isOwnerLibrary ? 'team.orgPortraitPresetsAdd' : 'team.teacherPortraitPresetsAdd',
      )
      const contextualAddHint = tx(
        isOwnerLibrary ? 'team.profilePresetAddHint' : 'team.profilePresetSettingsTeacherDesc',
      )
      const contextualAddSourceLabel = tx(
        isOwnerLibrary ? 'team.myPortraitPresetsSourceOrgAdmin' : 'team.studentPortraitPresetButtonTeacher',
      )

      return (
        <section className="team-portrait-presets" aria-labelledby={titleId}>
          <div className="team-portrait-presets-head">
            <div className="team-portrait-presets-heading">
              <span className="eyebrow">{tx('team.myPortraitPresetsEyebrow')}</span>
              <div className="team-portrait-presets-title-line">
                <h3 id={titleId}>
                  {tx(isOwnerLibrary ? 'team.orgPortraitPresetsTitle' : 'team.myPortraitPresetsTitle')}
                </h3>
                <span className="team-portrait-count">
                  {format(tx('team.myPortraitPresetsCount'), { count: visiblePresets.length })}
                </span>
              </div>
            </div>
          </div>

          {canApplyPreset && targetStudent ? (
            <TeamPortraitPresetTargetPicker
              rows={profileRows}
              targetUserId={targetStudent.member.userId}
              onSelect={setPresetTargetStudentId}
              onWarm={warmStudentPortraitAssets}
            />
          ) : null}

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
                onClick={() => changePresetSourceFilter(value)}
              >
                <span>{label}</span>
                <b>{sourceCounts[value]}</b>
              </button>
            ))}
          </div>

          <div
            className={`team-portrait-preset-results is-${presetSourceFilterPhase}`}
            aria-live="polite"
          >
            {visiblePresets.length === 0 && !showContextualAdd ? (
              <div className={`team-portrait-presets-empty${compactEmpty ? ' compact' : ''}`}>
              <span className="empty-state-icon"><ListChecks size={18} aria-hidden="true" /></span>
              <div>
                <strong>{tx(normalizedPresetQuery ? 'noResults' : 'team.myPortraitPresetsEmpty')}</strong>
              </div>
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
                      disabled={!canApplyPreset || !targetStudent?.member.userId || applyingStudentPresetId !== null}
                      aria-busy={applyingStudentPresetId === preset.id || undefined}
                      aria-label={`${tx('team.studentProfileUsePreset')}: ${display.name} · ${targetStudentName}`}
                      onClick={() => {
                        const targetStudentId = targetStudent?.member.userId
                        if (!targetStudentId) return
                        void loadTeamSnippetEditorDialog().catch(() => undefined)
                        warmStudentPortraitAssets(targetStudentId)
                        setEditingViewedStudentAssetId(null)
                        setStudentSnippetTargetUserId(targetStudentId)
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
                            {applyingStudentPresetId === preset.id ? (
                              <PendingLabel label={tx('working')} iconSize={11} />
                            ) : (
                              <><Plus size={11} aria-hidden="true" /> {tx('team.studentProfileUsePreset')}</>
                            )}
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
                {showContextualAdd ? (
                  <div
                    className={`team-portrait-preset-add-item${visiblePresets.length === 0 ? ' is-empty' : ''}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="team-portrait-preset-add-row"
                      aria-label={contextualAddLabel}
                      onClick={() => {
                        setEditingTeamPresetId(null)
                        setTeamPresetEditorOpen(true)
                        onComplete?.()
                      }}
                    >
                      <span className="team-portrait-preset-add-icon">
                        <Plus size={15} aria-hidden="true" />
                      </span>
                      <span className="team-portrait-preset-add-copy">
                        {visiblePresets.length === 0 ? (
                          <small>{tx('team.myPortraitPresetsEmpty')}</small>
                        ) : null}
                        <span className="team-portrait-preset-title-row">
                          <strong>{contextualAddLabel}</strong>
                          <span className={`team-portrait-source-chip source-${contextualAddSource}`}>
                            {contextualAddSourceLabel}
                          </span>
                        </span>
                        <em>{contextualAddHint}</em>
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
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
    const displayedRow = studentRows.find((row) => row.member.userId === displayedResourceStudentId) ?? null
    const contentRow = displayedRow ?? (!displayedResourceStudentId ? selectedRow : null)
    const contentStudentId = contentRow?.member.userId ?? null
    const studentPortraitPending = Boolean(
      viewedStudentAssetsLoading
      && selectedStudentId
      && selectedStudentId !== displayedResourceStudentId,
    )
    const studentPortraitColdLoading = viewedStudentAssetsLoading && !displayedResourceStudentId
    const selectedHiddenByFilters = Boolean(
      selectedResourceStudentId
      && !selectedRow
      && profileRows.some((row) => row.member.userId === selectedResourceStudentId),
    )
    const selectedAdvisors = contentRow ? studentTeachersFor(contentRow.member) : []
    const selectedStudentMailHref = contentRow ? memberMailtoHref(contentRow.member) : ''
    const selectedStudentName = contentRow
      ? memberDisplayName(contentRow.member, tx('team.memberFallback'))
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
            <div className="team-portrait-empty-students-copy">
              <h3>{tx(scope === 'owner' ? 'team.ownerStudentProfilesEmpty' : 'team.resourcesTeacherEmpty')}</h3>
              <p>{tx(scope === 'owner' ? 'team.ownerStudentProfilesEmptyDesc' : 'team.resourcesTeacherEmptyDesc')}</p>
            </div>
            {canInvite ? (
              <AnchoredPopover
                triggerAriaLabel={tx('team.teacherInviteSubmit')}
                popoverAriaLabel={tx('team.teacherInviteTitle')}
                triggerClassName="primary-action team-portrait-empty-invite-trigger"
                popoverClassName="team-invite-popover-shell team-member-invite-popover-shell"
                width={inviteMode === 'bulk' ? 560 : 420}
                estimatedHeight={inviteMode === 'bulk' ? 680 : 520}
                align="start"
                onOpenChange={(open) => {
                  if (!open) return
                  setInviteRole('member')
                  setInviteMode('single')
                }}
                trigger={<><UserPlus size={14} aria-hidden="true" />{tx('team.teacherInviteSubmit')}</>}
              >
                {(close) => renderInvitePopover(close, true)}
              </AnchoredPopover>
            ) : null}
          </div>
        ) : (
          <div className={[
            'team-portrait-workspace',
            studentPortraitMobileDetailOpen ? 'is-mobile-detail-open' : '',
            studentPortraitMobileNavigationStartedRef.current ? 'has-mobile-navigation' : '',
          ].filter(Boolean).join(' ')}>
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
                <div
                  ref={studentPortraitListRef}
                  id="team-student-portrait-list"
                  className="team-portrait-student-list"
                  role="listbox"
                  aria-label={tx('team.studentProfilePickerTitle')}
                >
                  <span
                    ref={studentPortraitSelectionRef}
                    className="team-portrait-student-selection"
                    aria-hidden="true"
                    onTransitionEnd={(event) => {
                      if (event.propertyName === 'transform') finishStudentPortraitSelectionMotion()
                    }}
                  />
                  {studentRows.map((row) => {
                    const isSelected = row.member.userId === selectedStudentId
                    const studentName = memberDisplayName(row.member, tx('team.memberFallback'))
                    const studentUserId = row.member.userId
                    return (
                      <button
                        key={row.member.id}
                        ref={(node) => {
                          if (!studentUserId) return
                          if (node) studentPortraitRowRefs.current.set(studentUserId, node)
                          else studentPortraitRowRefs.current.delete(studentUserId)
                        }}
                        type="button"
                        role="option"
                        className={`team-portrait-student-row state-${row.state}${isSelected ? ' selected' : ''}`}
                        aria-selected={isSelected}
                        aria-controls="team-student-portrait-detail"
                        aria-label={`${studentName} · ${tx('team.teacherOpenStudentProfile')}`}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || !studentUserId) return
                          positionStudentPortraitSelection(studentUserId, event.currentTarget)
                        }}
                        onPointerEnter={() => warmStudentPortraitAssets(studentUserId)}
                        onFocus={() => warmStudentPortraitAssets(studentUserId)}
                        onClick={(event) => openStudentPortraitMobileDetail(studentUserId, event.currentTarget)}
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
                        <ChevronRight className="team-portrait-mobile-disclosure" size={15} aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              )}
            </aside>

            <section
              ref={studentPortraitProfilePaneRef}
              id="team-student-portrait-detail"
              className={`team-portrait-profile-pane${studentPortraitPending ? ' is-student-loading' : ''}`}
              aria-label={tx('profile.title')}
              aria-busy={viewedStudentAssetsLoading || undefined}
            >
              {studentPortraitPending ? <span className="team-portrait-student-loading-line" aria-hidden="true" /> : null}
              <div
                ref={studentPortraitProfileContentRef}
                className={`team-portrait-profile-content${studentPortraitHandoffCycle ? ` is-handoff-${studentPortraitHandoffCycle}` : ''}`}
                data-student-portrait-stable={studentPortraitStable ? 'true' : undefined}
                inert={studentPortraitPending || undefined}
              >
              {contentRow ? (
                <>
                  <div className="team-portrait-dossier-head">
                    <div className="team-portrait-identity">
                      <TeamMemberAvatar member={contentRow.member} className="team-portrait-identity-avatar" />
                      <div>
                        <span className="eyebrow">{tx('team.studentProfileEyebrow')}</span>
                        <h2>{memberDisplayName(contentRow.member, tx('team.memberFallback'))}</h2>
                        <p>
                          {selectedStudentMailHref ? <a href={selectedStudentMailHref}>{memberEmail(contentRow.member)}</a> : (memberEmail(contentRow.member) || tx('team.noLinkedEmail'))}
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
                      {contentRow.member.userId && onViewApplications ? (
                        <button type="button" className="quiet-action compact-action" onClick={() => onViewApplications(contentRow.member.userId!)}>
                          <FolderOpen size={13} aria-hidden="true" />
                          {tx('team.studentProfileOpenApps')}
                        </button>
                      ) : null}
                      {contentRow.member.userId && onCreateApplication ? (
                        <button type="button" className="primary-action compact-action" onClick={() => onCreateApplication(contentRow.member.userId!)}>
                          <Plus size={13} aria-hidden="true" />
                          {tx('team.teacherCreateForStudent')}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div ref={studentPortraitDossierScrollRef} className="team-portrait-dossier-scroll">
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

                      <LibraryInsertionMotionBoundary
                        key={`team-library-motion:${contentStudentId ?? 'none'}`}
                        assetIds={viewedStudentAssets.map((asset) => asset.id)}
                        items={studentAssetView === 'list'
                          ? filteredStudentAssets.map((asset) => ({
                              key: `asset:${asset.id}`,
                              assetIds: [asset.id],
                            }))
                          : filteredStudentFamilies.map((family) => ({
                              key: `family:${family.familyId}`,
                              assetIds: family.versions.map((version) => version.id),
                            }))}
                        enabled={studentPortraitStable && !studentPortraitColdLoading}
                      >
                      {studentPortraitColdLoading ? (
                        <div className="team-portrait-profile-loading" aria-busy="true"><span /><span /><span /></div>
                      ) : filteredStudentAssets.length === 0 ? (
                        <div className="team-portrait-section-empty team-portrait-profile-empty">
                          <span className="team-portrait-profile-empty-icon">
                            <FileText size={17} aria-hidden="true" />
                          </span>
                          <div className="team-portrait-profile-empty-copy">
                            <strong>{tx('profile.noSnippets')}</strong>
                            <p>{tx('team.studentPortraitLibraryEmpty')}</p>
                            <span className="team-portrait-profile-empty-guide">
                              <ListChecks size={12} aria-hidden="true" />
                              {tx('team.studentProfileUsePreset')}
                              <ArrowRight size={11} aria-hidden="true" />
                            </span>
                          </div>
                        </div>
                      ) : studentAssetView === 'list' ? (
                        <div id="team-student-library-view" key="team-student-library-list" className="team-portrait-library-view is-list">
                        <div className="team-portrait-snippet-list">
                          {filteredStudentAssets.map((asset) => {
                            const KindIcon = asset.kind === 'CV' || asset.kind === 'Transcript' ? FileCheck : FileText
                            const attachmentCount = asset.attachments?.length ?? 0
                            const deleting = deletingViewedStudentAssetId === asset.id
                            const description = asset.description?.replace(/\s+/g, ' ').trim() ?? ''
                            return (
                              <article
                                key={asset.id}
                                data-library-motion-key={`asset:${asset.id}`}
                                className={`team-portrait-snippet-row${deleting ? ' is-removing' : ''}`}
                              >
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
                                    {description ? (
                                      <em>{description}</em>
                                    ) : null}
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
                                  key={`${activeTeamId ?? summary?.team.id ?? 'team'}:${contentStudentId ?? 'student'}:${family.familyId}`}
                                  family={family}
                                  familyIndex={familyIndex}
                                  open={open}
                                  preferredVersionId={enteredStudentAssetId}
                                  deletingAssetId={deletingViewedStudentAssetId}
                                  onToggle={() => toggleStudentAssetFamily(family.familyId, open)}
                                  onRootChange={(node) => {
                                    if (node) studentFamilyStackRefs.current.set(family.familyId, node)
                                    else studentFamilyStackRefs.current.delete(family.familyId)
                                  }}
                                  onOpen={openSelectedStudentSnippet}
                                  onDelete={setPendingViewedStudentAssetDelete}
                                />
                              )
                            })}
                          </div>
                        </div>
                      )}
                      </LibraryInsertionMotionBoundary>
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
                    {studentRows.slice(0, 3).map((row) => <button key={row.member.id} type="button" className="quiet-action" onClick={() => selectResourceStudent(row.member.userId)}>{memberDisplayName(row.member, tx('team.memberFallback'))}</button>)}
                  </div>
                </div>
              )}
              </div>
            </section>

            <aside className="team-portrait-template-pane" aria-label={tx('team.myPortraitPresetsEyebrow')}>
              {renderPresetLibrary(false, profileRows.length > 0, 'inspector')}
            </aside>

            {studentPortraitMobileDetailOpen ? (
              <button
                ref={studentPortraitMobileBackRef}
                type="button"
                className="mobile-detail-back-fab team-portrait-mobile-back"
                aria-label={tx('back')}
                aria-controls="team-student-portrait-list"
                onClick={closeStudentPortraitMobileDetail}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span>{tx('back')}</span>
              </button>
            ) : null}
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
    if (viewerRole === 'member') return renderStudentResourcesPersonalLayout()
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
          warmMount
          openMs={320}
          closeMs={260}
          className="team-collaboration-detail"
          innerClassName="team-collaboration-detail-inner"
        >
          {renderMemberAccessSummary(member, stats, appCount, riskTotal, false)}
          {renderDelegatedAccessControls(member)}
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
        {memberView === 'map' ? (
          <div key="relationship-map" className="team-member-view-panel is-map">
            {renderRelationshipMap(memberMatchesFilter, memberFilterActive)}
          </div>
        ) : (
          <div key="collaboration-list" className="team-member-view-panel is-list team-collaboration-list">
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

  function renderStudentCollaborationToolbar() {
    return (
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
            <span className={`team-member-view-indicator ${memberView === 'table' ? 'is-list' : ''}`} aria-hidden="true" />
            <button type="button" className={memberView === 'map' ? 'active' : ''} aria-selected={memberView === 'map'} onClick={() => setMemberView('map')}>
              <Network size={13} aria-hidden="true" />
              {tx('team.relationshipViewMap')}
            </button>
            <button type="button" className={memberView === 'table' ? 'active' : ''} aria-selected={memberView === 'table'} onClick={() => setMemberView('table')}>
              <Table2 size={13} aria-hidden="true" />
              {tx('team.collaborationListView')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderTeacherGroupToolbar() {
    return (
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
        <div className="team-teacher-group-layout">
          <nav ref={teacherGroupNavRef} className="team-teacher-group-nav" aria-label={tx('team.teacherGroupsTitle')}>
            <span ref={teacherGroupNavIndicatorRef} className="team-teacher-group-nav-indicator" aria-hidden="true" />
            <button
              ref={(node) => {
                if (node) teacherGroupNavButtonRefs.current.set('all', node)
                else teacherGroupNavButtonRefs.current.delete('all')
              }}
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
                ref={(node) => {
                  if (node) teacherGroupNavButtonRefs.current.set(group.id, node)
                  else teacherGroupNavButtonRefs.current.delete(group.id)
                }}
                type="button"
                className={selectedTeacherGroupId === group.id ? 'active' : ''}
                onClick={() => setSelectedTeacherGroupId(group.id)}
              >
                <span><span className="team-teacher-group-dot" aria-hidden="true" />{group.name}</span>
                <b>{group.memberIds.length}</b>
              </button>
            ))}
            <button
              ref={(node) => {
                if (node) teacherGroupNavButtonRefs.current.set('ungrouped', node)
                else teacherGroupNavButtonRefs.current.delete('ungrouped')
              }}
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
            <div
              key={selectedTeacherGroupId}
              className="team-teacher-group-directory-stage"
              data-teacher-group-stage={selectedTeacherGroupId}
            >
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
                const permissionsOpen = expandedMemberId === teacher.id
                return (
                  <article key={teacher.id} className={`team-teacher-directory-entry${permissionsOpen ? ' expanded' : ''}`}>
                  <div className="team-teacher-directory-row">
                    <TeamMemberAvatar member={teacher} />
                    <span className="team-collaboration-identity">
                      <strong>{memberDisplayName(teacher, tx('team.memberFallback'))}</strong>
                      <em>{memberEmail(teacher) || tx('team.noLinkedEmail')}</em>
                    </span>
                    <span className="team-teacher-directory-load">
                      <Users size={12} aria-hidden="true" />
                      <span>{format(tx('team.memberAssignedStudentsDesc'), { count: assignedStudents })}</span>
                    </span>
                    <span className="team-teacher-directory-groups">
                      {memberships.length > 0
                        ? memberships.slice(0, 3).map((group) => <em key={group.id}>{group.name}</em>)
                        : <em>{tx('team.teacherGroupUngrouped')}</em>}
                    </span>
                    <div className="team-teacher-directory-actions">
                      {memberCanEnterView(teacher) || teacher.status === 'active' ? (
                        <div className="team-teacher-directory-shortcuts">
                          {memberCanEnterView(teacher) ? (
                            <button
                              type="button"
                              className="team-teacher-directory-shortcut is-account"
                              aria-label={tx('team.enterMemberView')}
                              title={tx('team.enterMemberView')}
                              onClick={() => onImpersonateMember?.(teacher.userId!)}
                            >
                              <LogIn size={13} aria-hidden="true" />
                            </button>
                          ) : null}
                          {teacher.status === 'active' ? (
                            <button
                              type="button"
                              className="team-teacher-directory-shortcut"
                              aria-label={tx('team.viewRelationshipMap')}
                              title={tx('team.viewRelationshipMap')}
                              onClick={() => {
                                setMemberWorkspaceView('students')
                                focusMemberInRelationshipMap(teacher)
                              }}
                            >
                              <Network size={13} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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
                      {viewerRole === 'owner' ? (
                        <button
                          type="button"
                          className={`team-teacher-directory-shortcut is-permissions${permissionsOpen ? ' active' : ''}`}
                          aria-label={tx('team.permissionTeacherTitle')}
                          title={tx('team.permissionTeacherTitle')}
                          aria-expanded={permissionsOpen}
                          onClick={() => setExpandedMemberId(permissionsOpen ? null : teacher.id)}
                        >
                          <ShieldCheck size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                      {activeTeacherGroup && teacher.status === 'active' ? (
                        <button
                          type="button"
                          className={`team-teacher-group-toggle ${selected ? 'active' : ''}`}
                          aria-pressed={selected}
                          disabled={teacherGroupBusyId === activeTeacherGroup.id}
                          onClick={() => void handleToggleTeacherGroupMember(activeTeacherGroup, teacher.id)}
                        >
                          {selected
                            ? <Check size={12} aria-hidden="true" />
                            : <Plus size={12} aria-hidden="true" />}
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
                  <CollapsiblePanel
                    open={permissionsOpen}
                    warmMount
                    keepMounted
                    openMs={320}
                    closeMs={240}
                    className="team-teacher-permission-detail"
                    innerClassName="team-teacher-permission-detail-inner"
                  >
                    {renderDelegatedAccessControls(teacher)}
                  </CollapsiblePanel>
                  </article>
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
    const memberWorkspaceMotionClass = [
      memberWorkspaceMotion === 'exiting' ? 'is-exiting' : '',
      memberWorkspaceMotion === 'entering' ? 'is-entering' : '',
      memberWorkspaceDirection === 'backward' ? 'dir-backward' : 'dir-forward',
    ].filter(Boolean).join(' ')

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
                    triggerClassName="quiet-action compact-action"
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
                    triggerClassName="primary-action compact-action team-invite-trigger"
                    popoverClassName="team-invite-popover-shell team-member-invite-popover-shell"
                    width={inviteMode === 'bulk' ? 560 : 380}
                    estimatedHeight={inviteMode === 'bulk' ? 680 : 520}
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

            <div className="team-collaboration-command-row">
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

              <div className="team-collaboration-top-tools">
                <div
                  key={`tools-${renderedMemberWorkspaceView}`}
                  className={`team-collaboration-tool-stage ${memberWorkspaceMotionClass}`}
                >
                  {renderedMemberWorkspaceView === 'students'
                    ? renderStudentCollaborationToolbar()
                    : renderTeacherGroupToolbar()}
                </div>
              </div>
            </div>

            <div
              key={`workspace-${renderedMemberWorkspaceView}`}
              className={`team-collaboration-workspace team-collaboration-workspace-panel ${memberWorkspaceMotionClass}`}
            >
              {renderedMemberWorkspaceView === 'students'
                ? renderStudentCollaborationWorkspace()
                : renderTeacherGroupWorkspace()}
            </div>
          </section>
        </div>
      </div>
    )
  }

  const renderAudit = () => {
    if (!hasAuditAccess(viewerRole)) return null

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

    const transferAudit = viewerRole === 'owner' ? (
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
                    aria-busy={approvalBusy || undefined}
                    onClick={() => void handleTransferDecision(
                      approvalRequest.id,
                      'approve',
                      approvalRequiresTeacher ? selectedTransferTeacherId : undefined,
                    )}
                  >
                    {approvalBusy ? (
                      <PendingLabel label={tx('working')} />
                    ) : (
                      <><Check size={13} aria-hidden="true" /> {approvalRequiresTeacher ? tx('team.transferApproveAndAssign') : tx('team.transferApprove')}</>
                    )}
                  </button>
                </footer>
              </aside>
            ) : null}
          </div>
        )}
      </section>
    ) : null

    return <div className="team-audit-page">{transferAudit}</div>
  }

  const teamDiscoverLibraryId = `team-discover-library-${summary?.team.id ?? 'active'}`
  const renderTeamDiscover = () => (
    <section className="team-discover-directory" aria-label={tx('team.teamDiscoverTitle', 'Research a student’s programs')}>
      <div className="team-discover-directory-head">
        <div>
          <span className="eyebrow">{tx('team.teamDiscoverEyebrow', 'TEAM DISCOVER')}</span>
          <h3>{tx('team.teamDiscoverTitle', 'Research a student’s programs')}</h3>
          <p>{tx('team.teamDiscoverDesc', 'Choose one assigned student. Research uses the Team AI keys managed by the institution administrator.')}</p>
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
                  onClick={() => changeTeamDiscoverFilter(value)}
                  aria-pressed={teamDiscoverFilter === value}
                >
                  <span>{label}</span>
                  <b>{teamDiscoverFilterCounts[value]}</b>
                </button>
              ))}
            </div>

            <LibraryViewSwitch
              value={teamDiscoverView}
              onChange={setTeamDiscoverView}
              label={tx('team.teamDiscoverViewLabel')}
              cardLabel={tx('team.teamDiscoverViewCards')}
              listLabel={tx('team.teamDiscoverViewList')}
              transitionScope="team-discover"
              controlsId={teamDiscoverLibraryId}
              className="team-discover-view-switch"
            />

            <span className="team-discover-result-count">
              <strong>{teamDiscoverStudentRows.length}</strong>
              <span>{tx('team.studentProfilePickerEyebrow')}</span>
            </span>
          </div>

          <div
            id={teamDiscoverLibraryId}
            className={`team-discover-library view-${teamDiscoverView} phase-${teamDiscoverFilterPhase}`}
            data-view={teamDiscoverView}
            aria-live="polite"
          >
          {teamDiscoverStudentRows.length ? (
            <div className={`team-discover-student-grid view-${teamDiscoverView}`}>
              {teamDiscoverStudentRows.map((row, index) => {
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
                    style={{ '--team-discover-index': Math.min(index, 8) } as CSSProperties}
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
                    changeTeamDiscoverFilter('all')
                  }}
                >
                  {tx('team.studentProfileClearFilters')}
                </button>
              </div>
            </div>
          )}
          </div>
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
              <button type="submit" className="primary-action" disabled={joinBusy || !joinCode.trim()} aria-busy={joinBusy || undefined}>
                {joinBusy ? (
                  <PendingLabel label={tx('working')} iconSize={15} />
                ) : (
                  <><ArrowRight size={15} aria-hidden="true" /> {tx('team.joinCodeSubmit')}</>
                )}
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

      {summary && (displayedSection === 'overview' || displayedSection === 'settings')
        ? <ProjectFooter />
        : null}

      <ExplorerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />

      {(editingViewedStudentAsset || (studentSnippetPreset && studentSnippetPresetDisplay)) && activeStudentSnippetEditorTarget ? (
        <LazyOverlayBoundary namespaces={['core', 'shared', 'profile', 'team', 'dossier', 'share']}>
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
            contextLabel={format(tx('team.studentPortraitLibraryTitle'), { name: activeStudentSnippetEditorTargetName })}
            headerAccessory={studentSnippetPreset ? (
              <TeamPortraitPresetTargetPicker
                rows={accessibleStudentProfileRows}
                targetUserId={activeStudentSnippetEditorTarget.member.userId}
                className="is-dialog"
                align="end"
                onSelect={(studentUserId) => {
                  setStudentSnippetTargetUserId(studentUserId)
                  setPresetTargetStudentId(studentUserId)
                }}
                onWarm={warmStudentPortraitAssets}
              />
            ) : null}
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
              setStudentSnippetTargetUserId(null)
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

    </section>
  )
}

function storedTeamRelationInspectorWidth() {
  try {
    const storedValue = localStorage.getItem(TEAM_RELATION_INSPECTOR_WIDTH_KEY)
    if (storedValue === null) return TEAM_RELATION_INSPECTOR_DEFAULT_WIDTH
    const storedWidth = Number(storedValue)
    if (!Number.isFinite(storedWidth)) return TEAM_RELATION_INSPECTOR_DEFAULT_WIDTH
    return Math.min(
      TEAM_RELATION_INSPECTOR_MAX_WIDTH,
      Math.max(TEAM_RELATION_INSPECTOR_MIN_WIDTH, Math.round(storedWidth)),
    )
  } catch {
    return TEAM_RELATION_INSPECTOR_DEFAULT_WIDTH
  }
}
