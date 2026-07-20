import type { ApplicationRecord, ApplicationStatus, BackupFrequency, MaterialStatus, SharePermission, ShareSection } from '../data/applications'
import { reportApiReachable, reportApiUnavailable } from '../connectivity'

export type UserRole = 'admin' | 'user'
export type MembershipPlan = 'free' | 'pro' | 'team'

export type AiProvider = 'openai' | 'deepseek' | 'anthropic' | 'gemini'
export type AiKeyScope = 'personal' | 'team'

export type AiUserProfile = {
  preferredName: string
  pronouns: string
  location: string
  timezone: string
  citizenship: string
  currentRole: string
  institution: string
  degree: string
  field: string
  graduation: string
  researchInterests: string
  researchMethods: string
  achievements: string
  goals: string
  writingLanguage: string
  writingTone: string
  signature: string
  boundaries: string
}

export type AiKey = {
  id: string
  ownerId: string
  teamId: string | null
  scope: AiKeyScope
  provider: AiProvider
  label: string
  model: string
  baseUrl: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  usage: {
    calls: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    resetAt: string | null
  }
  secretSet: boolean
}

export type AiKeyInput = {
  scope: AiKeyScope
  teamId?: string | null
  teamName?: string | null
  provider: AiProvider
  label: string
  model: string
  baseUrl?: string
  apiKey: string
}

export type AiDraftGrants = {
  userProfile: boolean
  dossier: boolean
  checklist: boolean
  scholarships: boolean
  tasks: boolean
  correspondence: boolean
  attachments: boolean
}

export type AiDraftInput = {
  keyId: string
  applicationId: string
  mode: 'compose' | 'reply'
  instructions: string
  replyToId?: string
  /** The editable email being refined. It is sent only with this draft request. */
  currentDraft?: { subject: string; body: string }
  grants: AiDraftGrants
  attachments?: Array<{ name: string; mimeType: string; contentBase64: string }>
}

export type AiDraftEvent =
  | { type: 'status'; phase: string }
  | { type: 'token'; text: string }
  | { type: 'done'; draftOnly: boolean }
  | { type: 'error'; message: string }

export { PROFILE_PRESET_ICONS } from '../profilePresetIconCatalog'
import type { ProfilePresetIconName } from '../profilePresetIconCatalog'

export type ProfilePresetIcon = ProfilePresetIconName

export const PROFILE_PRESET_COLORS = ['system', 'blue', 'purple', 'green', 'orange', 'pink', 'teal', 'gray'] as const

export type ProfilePresetColor = typeof PROFILE_PRESET_COLORS[number]

/** A reusable template definition. It never owns files; files belong to snippets created from it. */
export type ProfilePreset = {
  id: string
  kind: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  contentZh: string
  contentEn: string
  icon: ProfilePresetIcon
  color: ProfilePresetColor
  builtIn?: boolean
  createdAt?: string
  updatedAt?: string
}

export type TeamProfilePreset = ProfilePreset & {
  createdBy: string | null
  createdByRole: TeamRole | null
  syncToTeachers: boolean
  syncToStudents: boolean
  manageable?: boolean
}

export type TeamProfilePresetInput = Omit<ProfilePreset, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'> & {
  syncToTeachers?: boolean
  syncToStudents?: boolean
}

export type UserSettings = {
  language: string
  /**
   * Two preferred content languages for email/snippet insert and bilingual field fill.
   * Defaults to English + Chinese when unset.
   */
  contentLanguagePrimary?: string
  contentLanguageSecondary?: string
  highContrast: boolean
  themeAccent: string
  /** Cropped square avatar encoded as a compact browser-safe image data URL. */
  avatarDataUrl?: string
  sendFrom?: string
  receiveAt?: string
  receiveEmails?: Array<{
    address: string
    isPrimary: boolean
    notify: boolean
    verified?: boolean
    verificationSentAt?: string
  }>
  autoBackup?: boolean
  backupFrequency?: BackupFrequency
  maxBackupsPerApp?: number
  membershipPlan?: MembershipPlan
  /** Personal plan stays independent when this identity also owns a team. */
  personalMembershipPlan?: Exclude<MembershipPlan, 'team'>
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  /** Always '' from the server — the real secret never leaves it. Check smtpPassSet instead. */
  smtpPass?: string
  smtpPassSet?: boolean
  /** Patch-only: send true to deliberately wipe the saved SMTP password. */
  clearSmtpPass?: boolean
  smtpTls?: boolean
  incomingProtocol?: 'pop3' | 'imap'
  incomingHost?: string
  incomingPort?: number
  incomingUser?: string
  /** Always '' from the server — the real secret never leaves it. Check incomingPassSet instead. */
  incomingPass?: string
  incomingPassSet?: boolean
  /** Patch-only: send true to deliberately wipe the saved incoming-mail password. */
  clearIncomingPass?: boolean
  incomingTls?: boolean
  /** Gates the automatic IMAP poller for matched incoming and externally sent professor mail. */
  autoFetchMail?: boolean
  storageQuotaMb?: number
  trashRetentionDays?: 1 | 5 | 10 | 30 | 60 | null
  applicationQuota?: number
  applicationCreateQuota?: number
  applicationCreatedCount?: number
  shareQuota?: number
  shareCreateQuota?: number
  shareCreatedCount?: number
  sessionDurationMinutes?: number
  calendarToken?: string
  /** Account-wide email auto-insert phrase template: lead + snippet name(s) + tail, one pair per language. */
  snippetPhraseLeadZh?: string
  snippetPhraseTailZh?: string
  snippetPhraseLeadEn?: string
  snippetPhraseTailEn?: string
  aiProfile?: AiUserProfile
  /** Personal-workspace presets only. Organization presets live on their team workspace. */
  profilePresets?: ProfilePreset[]
}

export type UserSettingsPatch = Partial<UserSettings> & {
  /** Patch-only command: ask the server to issue a new private calendar token. */
  generateCalendarToken?: boolean
}

export type MailFetchStatus = {
  lastFetchedAt: string | null
  lastHistorySyncAt: string | null
  lastHistoryImported: number
  trackedAddressCount: number
  lastErrorCode: string | null
  lastErrorAt: string | null
  syncJob?: MailSyncJob | null
}

export type MailSyncResult = {
  fetched: number
  filed: number
  incoming: number
  outgoing: number
  duplicates: number
  unmatched: number
  errorCode: string | null
  mode: 'incremental' | 'history'
  stateCommitted: boolean
}

export type MailSyncJob = {
  id: string
  mode: 'incremental' | 'history'
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  result: MailSyncResult | null
  errorCode: string | null
  errorMessage: string | null
}

export type MailSyncEnqueueResult = {
  job: MailSyncJob
  alreadyQueued: boolean
}

export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305'

export type AdminSettings = {
  allowRegistration: boolean
  notificationMailbox: string
  backupFrequency: BackupFrequency
  maxBackupsPerAppLimit?: number
  encryptionAtRest: boolean
  encryptionAlgorithm?: EncryptionAlgorithm
  encryptionPasswordEnabled?: boolean
  /** True when a password verifier is stored (password itself is never returned). */
  encryptionPasswordSet?: boolean
  /** Patch-only: set or rotate the encryption password (min 8 chars). */
  encryptionPassword?: string
  /** Patch-only: current password required when re-keying while protection is on. */
  encryptionCurrentPassword?: string
  /** Encrypt the SQLite database file at rest (.sqlite.sealed). */
  sqliteEncryption?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  /** Always '' from the server — the real secret never leaves it. Check smtpPassSet instead. */
  smtpPass?: string
  smtpPassSet?: boolean
  /** Patch-only: send true to deliberately wipe the saved SMTP password. */
  clearSmtpPass?: boolean
  smtpTls?: boolean
  adminSessionDurationMinutes?: number
}

export type PublicUser = {
  id: string
  name: string
  email: string
  role: UserRole
  disabledAt?: string | null
  createdAt: string
  lastLoginAt: string | null
  settings: UserSettings
  teamMemberOf?: {
    teamId: string
    teamName: string
    ownerId: string
    ownerEmail: string
    role: TeamRole
  } | null
  isTeamInternalAccount?: boolean
}

export type AuthSession = {
  token: string
  user: PublicUser
  settings: AdminSettings
  mailFetchStatus?: MailFetchStatus
  usage?: AccountUsage
  impersonation?: {
    actorId: string
    actorName: string
    actorEmail: string
    targetUserId: string
    targetName: string
    targetEmail: string
    startedAt: string
    returnTo: 'app' | 'admin'
    teamId?: string | null
  }
}

export type InitialSetupStatus = {
  required: boolean
}

export type InitialAdminSetupInput = {
  name: string
  email: string
  password: string
  notificationMailbox: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpTls: boolean
  language: string
}

export type PasskeyCredentialSummary = {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  transports: string[]
  deviceType: string
  backedUp: boolean
}

export type PasskeyOptionsPayload = {
  options: unknown
}

export type AccountPlan = 'free' | 'pro' | 'team' | 'admin'

export type AccountUsage = {
  plan: AccountPlan
  storageUsedBytes: number
  storageQuotaBytes: number | null
  applicationCount: number
  applicationQuota: number
  applicationCreatedCount: number
  applicationCreateQuota: number
  activeShareCount: number
  shareQuota: number
  shareCreatedCount: number
  shareCreateQuota: number
  trashCount: number
  trashLimit: number
  trashRetentionDays: 1 | 5 | 10 | 30 | 60 | null
}

export type ProfileAssetAttachment = {
  id: string
  fileId: string
  fileName: string
  fileSize?: number
  mimeType?: string
}

export type ProfileAssetShare = {
  id: string
  token: string
  url: string
  createdAt: string
  expiresAt: string | null
  note?: string
}

export type ProfileAsset = {
  id: string
  ownerId?: string
  name: string
  kind: string
  /** Snippet body text, e.g. a personal-statement paragraph bank. */
  description: string
  /** Private notes — never inserted into an email. */
  notes?: string
  /** Display label for a custom (non-built-in) kind, one per supported language — used as the {{name}} value in the account-wide insert phrase template. */
  customLabelZh?: string
  customLabelEn?: string
  /** User-selected library-card appearance. Older rows omit these and use the kind fallback. */
  icon?: ProfilePresetIcon
  color?: ProfilePresetColor
  /**
   * Legacy persistence metadata. The UI now groups assets automatically by material
   * type, so users never need to create or maintain families manually.
   */
  familyId?: string
  /** Legacy per-version label retained for backward-compatible API reads/writes. */
  versionLabel?: string
  /** Legacy sort key retained for backward-compatible API reads/writes. */
  versionNumber?: number
  /** Legacy default marker; automatic type groups fall back to the newest item. */
  isPrimary?: boolean
  /** Legacy group title retained for backward-compatible API reads/writes. */
  familyName?: string
  /** Keep an empty attachment slot for a later self-upload or shared upload link (same as checklist materials). */
  uploadReserved?: boolean
  /** Allowed MIME / extension list when uploading later (same convention as checklist materials). */
  allowedFileTypes?: string[]
  attachments: ProfileAssetAttachment[]
  shares?: ProfileAssetShare[]
  updatedAt?: string
  createdAt?: string
}

export type ProfileAssetInput = {
  name: string
  kind: string
  description: string
  notes?: string
  customLabelZh?: string
  customLabelEn?: string
  icon?: ProfilePresetIcon
  color?: ProfilePresetColor
  familyId?: string
  versionLabel?: string
  versionNumber?: number
  isPrimary?: boolean
  familyName?: string
  uploadReserved?: boolean
  allowedFileTypes?: string[]
}

export type AdminUser = PublicUser & {
  applicationCount: number
  applicationQuota: number
  applicationCreateQuota: number
  applicationCreatedCount: number
  storageUsedBytes: number
  storageQuotaMb: number
  storageQuotaBytes?: number | null
  shareQuota: number
  shareCreateQuota: number
  shareCreatedCount: number
  activeShareCount: number
  trashCount?: number
  trashLimit?: number
  /** Only populated when `settings.membershipPlan === 'team'` (this user owns a team). */
  teamId?: string | null
  teamName?: string | null
  seatLimit?: number | null
  activeMemberCount?: number | null
  teamMemberOf?: {
    teamId: string
    teamName: string
    ownerId: string
    ownerEmail: string
    role: TeamRole
  } | null
  isTeamInternalAccount?: boolean
  privacy: string
}

/**
 * `owner` = institution admin (full, unscoped access to the whole team).
 * `admin` = teacher/counselor (manages only the students they personally invited).
 * `member` = student (owns their own application; no visibility into other students).
 */
export type TeamRole = 'owner' | 'admin' | 'member'
export type TeamMemberStatus = 'pending' | 'active' | 'removed'

export type TeamMemberRelationships = Record<string, never>

export type Team = {
  id: string
  name: string
  ownerId: string
  seatLimit: number
  createdAt: string
  updatedAt: string
  /** Optional display names for teacher/student roles (owner stays fixed). */
  roleLabels?: {
    admin?: string
    member?: string
  }
  /** Organization-only templates, already filtered to the current member's role and reporting line. */
  profilePresets?: TeamProfilePreset[]
}

export type TeamMember = {
  id: string
  teamId: string
  userId: string | null
  displayName?: string
  /** The linked account avatar, shared across personal and team surfaces. */
  avatarUrl?: string
  invitedEmail: string
  role: TeamRole
  status: TeamMemberStatus
  invitedBy: string
  relationships?: TeamMemberRelationships
  createdAt: string
  updatedAt: string
}

export type TeamUsageSummary = {
  storageUsedBytes: number
  storageQuotaBytes: number | null
  applicationCount: number
  activeShareCount: number
  shareQuota: number
  shareCreatedCount: number
  shareCreateQuota: number
}

export type TeamCapacitySummary = {
  storageUsedBytes: number
  storageQuotaBytes: number
  teacherSeatsUsed: number
  teacherSeatLimit: number
  studentSeatsUsed: number
  studentSeatLimit: number
  activeShareCount: number
  activeShareLimit: number
  /** null means that lifetime link creation is unlimited. */
  shareCreateQuota: number | null
}

export type TeamTransferRequest = {
  id: string
  teamId: string
  direction: 'join' | 'leave'
  requestedAt: string
  requestedBy: string
  applicationId: string
  applicationName: string
  program: string
  ownerId: string
  ownerName: string
  ownerEmail: string
}

export type TeamMemberStats = {
  memberId: string
  userId: string | null
  applicationCount: number
  riskCount: number
  watchCount: number
  dueSoonCount: number
  activeShareCount: number
  storageUsedBytes: number
  storageQuotaBytes: number | null
  reviewCommentCount: number
  lastActivityAt: string | null
}

export type TeamSummary = {
  team: Team
  membership: TeamMember | null
  members: TeamMember[]
  usage?: TeamUsageSummary
  /** Organization-wide remaining capacity; only returned to the organization owner. */
  capacity?: TeamCapacitySummary
  memberStats?: Record<string, TeamMemberStats>
  roleCounts?: Record<TeamRole, number>
  applicationStatusCounts?: Partial<Record<ApplicationStatus, number>>
  recentEvents?: SystemEvent[]
  transferRequests?: TeamTransferRequest[]
}

export type TeamWorkspaceOption = {
  teamId: string
  name: string
  ownerId: string
  viewerRole: TeamRole | null
  membershipId: string | null
  memberCount: number
  applicationCount: number
  pendingTransferCount: number
  updatedAt: string
}

/**
 * An application as seen through the team-scoped browser — the same record shape as
 * `ApplicationRecord`, plus who owns it and what the current viewer may do with it.
 * `currentUserApplicationRole` is `'owner'` for the viewer's own application (full access),
 * or their literal team role (`'admin'` | `'member'`) on a teammate's application.
 */
export type TeamApplicationRecord = ApplicationRecord & {
  ownerName: string
  ownerEmail: string
  currentUserApplicationRole: TeamRole | null
}

export type TeamInvitePreview = {
  teamName: string
  inviterName: string
  role: TeamRole
  invitedEmail: string
  requiresRegistration: boolean
}

export type ReviewComment = {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  targetTab?: 'dossier' | 'materials' | 'mail' | 'funding' | 'timeline' | 'review'
}

export type SystemEvent = {
  id: string
  time: string
  scope: string
  actorId: string | null
  message: string
  metadata: Record<string, unknown>
}

export type TeamEventRestoreResult = {
  restored: boolean
  eventId: string
  application: TeamApplicationRecord
}

export type TeamMergeFieldStatus = 'clean' | 'conflict' | 'same'

export type TeamMergeField = {
  field: string
  status: TeamMergeFieldStatus
  baseValue: unknown
  eventValue: unknown
  currentValue: unknown
}

export type TeamMergePreview = {
  eventId: string
  application: TeamApplicationRecord
  fields: TeamMergeField[]
  cleanCount: number
  conflictCount: number
  sameCount: number
}

export type TeamMergeResult = {
  merged: boolean
  eventId: string
  changedFields: string[]
  application: TeamApplicationRecord
  conflicts: TeamMergeField[]
}

export type TeamMergeConflictFlagResult = {
  flagged: boolean
  eventId: string
  conflictCount: number
  application: TeamApplicationRecord
}

export type SystemInfo = {
  version: string
  nodeVersion: string
  platform: string
  arch: string
  uptime: number
  cpu: {
    model: string
    cores: number
  }
  hostname: string
  pid: number
  nodeEnv: string
  memory: {
    total: number
    free: number
    used: number
  }
  storage: {
    database: number
    uploads: number
    uploadFiles: number
    backups: number
    backupFiles: number
    total: number
  }
  counts: {
    users: number
    applications: number
    systemEvents: number
    profileAssets: number
  }
  databasePath: string
  uploadRoot: string
  backupRoot: string
}

export type SystemUpdateResult = {
  received: boolean
  fileName: string
  size: number
  storedAs: string
  version: string
  verified: boolean
  restartScheduled: boolean
  message: string
}

export type BackupRecord = {
  fileName: string
  size: number
  createdAt: string
  actorId?: string | null
  applicationId?: string | null
  applicationName?: string
  kind?: 'application' | 'workspace'
}

export type ApplicationTrashItem = {
  id: string
  deletedAt: string
  expiresAt: string | null
  application: ApplicationRecord
}

export type WorkspaceBootstrapPayload = {
  me: {
    user: PublicUser
    settings: AdminSettings
    mailFetchStatus: MailFetchStatus
    usage?: AccountUsage
  }
  applications: ApplicationRecord[]
  profileAssets: ProfileAsset[]
  backups: BackupRecord[]
  applicationTrash: ApplicationTrashItem[]
  teamWorkspaces: TeamWorkspaceOption[]
  activeTeamId: string | null
  teamSummary: TeamSummary | null
  teamApplications: TeamApplicationRecord[]
  aiKeys: AiKey[]
}

export type AnalyticsPayload = {
  statusCounts: Partial<Record<ApplicationStatus, number>>
  acceptanceRate: number
  interviewRate: number
  openTasks: number
}

export type NotificationType =
  | 'task_due'
  | 'material_reminder'
  | 'deadline_approaching'
  | 'new_email_imported'
  | 'team_invite'
  | 'team_message'
  | 'team_update'
  | 'membership_update'
  | 'admin_announcement'
  | 'push_test'
  | 'discover_match'
  | 'discover_deadline'

export type NotificationRecord = {
  id: string
  type: NotificationType
  applicationId: string | null
  title: string
  body: string
  triggerDate: string
  createdAt: string
  readAt: string | null
  archivedAt?: string | null
  targetPath?: string | null
  targetTab?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
  emailedAt: string | null
}

export type WebPushSubscriptionInput = {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export type WebPushTestResult = {
  notification: NotificationRecord
  attempted: number
  delivered: number
  failed: number
  removed: number
}

export type NotificationGroup = {
  id: string
  scope: 'admin' | 'team'
  ownerId?: string | null
  teamId?: string | null
  name: string
  memberIds: string[]
  createdAt: string
  updatedAt: string
}

export type NotificationPublishInput = {
  title: string
  body: string
  channels: Array<'in_app' | 'email'>
  userIds?: string[]
  memberIds?: string[]
  groupIds?: string[]
  audiences?: string[]
}

export type NotificationPublishResult = {
  recipients: number
  created: number
  emailed: number
}

export type SharedApplicationPayload = {
  permission: SharePermission
  sections: ShareSection[]
  school: {
    name: string
    country: string
    website: string
  }
  professor: {
    english: string
    chinese?: string
    email: string
    phone?: string
    social?: string
    homepage: string
    research: string
    lab?: string
  }
  program: string
  status: ApplicationStatus
  deadline: string
  progress?: number
  priority?: number
  tags?: string[]
  nextReminder?: string
  result?: string
  dossierCards?: NonNullable<ApplicationRecord['dossierCards']>
  createdAt?: string
  updatedAt?: string
  materials: Array<{
    id: string
    name: string
    type?: string
    status: MaterialStatus
    group?: string
    details?: string
    reminderEnabled?: boolean
    reminderDate?: string
    requiredCount?: number
    recommenders?: ApplicationRecord['materials'][number]['recommenders']
    version?: string
    updatedAt?: string
    fileId?: string
    fileName?: string
    fileSize?: number
    allowedFileTypes?: string[]
    versions?: ApplicationRecord['materials'][number]['versions']
  }>
  communications?: ApplicationRecord['communications']
  scholarships?: ApplicationRecord['scholarships']
  fees?: ApplicationRecord['fees']
  tasks?: Array<{
    id: string
    title: string
    due: string
    done: boolean
    details?: string
    attachmentRequired?: boolean
    allowedFileTypes?: string[]
    fileId?: string
    fileName?: string
    fileSize?: number
    versions?: ApplicationRecord['tasks'][number]['versions']
  }>
  timeline?: ApplicationRecord['timeline']
  versions?: ApplicationRecord['versions']
}

export type CreateApplicationInput = {
  professor: string
  professorChinese?: string
  professorEmail: string
  professorHomepage?: string
  university: string
  country: string
  website?: string
  program: string
  deadline: string
  notes?: string
  /** Shares this application with the creator's team (their teacher and the institution admin). */
  visibleToTeam?: boolean
  /** Team-mode only: institution admins or teachers may create an application owned by a student they manage. */
  ownerId?: string
}

export type MaterialInput = {
  name: string
  type: string
  status: MaterialStatus
  group?: string
  details?: string
  reminderEnabled?: boolean
  reminderDate?: string
  requiredCount?: number
  file?: File
  files?: File[]
}

export type CommunicationInput = {
  subject: string
  channel: string
  date: string
  summary: string
  direction?: 'incoming' | 'outgoing' | 'note'
  messageType?: string
  from?: string
  to?: string
  time?: string
  attachments?: CommunicationAttachmentInput[]
}

export type CommunicationPatchInput = Partial<CommunicationInput>

export type CommunicationAttachmentInput = {
  id?: string
  fileName: string
  fileId?: string
  assetId?: string
  fileSize?: number
  mimeType?: string
  file?: File
}

export type CommunicationSendInput = {
  subject: string
  summary: string
  date: string
  time?: string
  channel?: string
  direction?: 'incoming' | 'outgoing' | 'note'
  messageType?: string
  from?: string
  to?: string
  bodyHtml?: string
  attachments?: CommunicationAttachmentInput[]
}

type ApiEnvelope<T> = {
  ok: boolean
  data?: T
  session?: {
    token: string
    expiresAt?: string
    durationMinutes?: number
  }
  error?: {
    code: string
    message: string
    field?: string
  }
  requestId: string
}

type SessionTokenHandler = (token: string, sourceToken?: string) => boolean | void
type UnauthorizedHandler = (error: ApiError, sourceToken?: string) => void

let sessionTokenHandler: SessionTokenHandler | null = null
let unauthorizedHandler: UnauthorizedHandler | null = null
const latestSessionTokenBySource = new Map<string, string>()
const sessionCachePartitionByToken = new Map<string, string>()
type ConditionalCacheEntry = {
  etag?: string
  data: unknown
  storedAt: number
}

export type RealtimeInvalidationScope =
  | 'applications'
  | 'profile-assets'
  | 'backups'
  | 'teams'
  | 'notifications'
  | 'session'
  | 'ai-keys'

export type RealtimeInvalidationEvent = {
  type: 'connected' | 'invalidate'
  scopes: RealtimeInvalidationScope[]
  revision: number
  at: string
}

const conditionalResponseCache = new Map<string, ConditionalCacheEntry>()
const conditionalRequestInFlight = new Map<string, Promise<unknown>>()
const readCacheRevisionByPartition = new Map<string, number>()
/** Bumped on every login/logout/identity handoff so late 401s from a previous
 *  same-account session never call the unauthorized handler or share in-flight
 *  conditional GETs with the fresh session (re-login "session expired" loop). */
let clientSessionGeneration = 0
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const UPLOAD_REQUEST_TIMEOUT_MS = 120_000
const DOWNLOAD_REQUEST_TIMEOUT_MS = 120_000
const OFF_MAIN_JSON_THRESHOLD = 256 * 1024
const JSON_PARSE_WORKER_TIMEOUT_MS = 10_000
const DEFAULT_READ_FRESHNESS_MS = 3_000
let jsonParseWorker: Worker | null = null
let jsonParseWorkerUnavailable = false
let jsonParseWorkerSequence = 0
type JsonParseJob = {
  text: string
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
const jsonParseJobs = new Map<number, JsonParseJob>()

type JsonParseWorkerResponse = {
  id: number
  value?: unknown
  error?: string
}

function resetClientSessionState() {
  clientSessionGeneration += 1
  latestSessionTokenBySource.clear()
  sessionCachePartitionByToken.clear()
  conditionalResponseCache.clear()
  conditionalRequestInFlight.clear()
  readCacheRevisionByPartition.clear()
}

/** Clear in-memory session token chains and conditional GET caches (login / identity switch). */
export function clearClientSessionCaches() {
  resetClientSessionState()
}

/** Current client session generation — changes on every login/logout/cache scrub. */
export function getClientSessionGeneration() {
  return clientSessionGeneration
}

/**
 * Read the JWT `sub` claim without verifying the signature. Used only as a
 * client-side guard so a refreshed token for user B can never be chained onto
 * user A's source token (account mix-up / 串号).
 */
export function readSessionTokenSubject(token?: string | null): string | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    let json: string
    if (typeof atob === 'function') {
      json = atob(padded)
    } else {
      const bufferCtor = (globalThis as {
        Buffer?: { from: (data: string, encoding: string) => { toString: (encoding: string) => string } }
      }).Buffer
      if (!bufferCtor) return null
      json = bufferCtor.from(padded, 'base64').toString('utf8')
    }
    const claims = JSON.parse(json) as { sub?: unknown }
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : null
  } catch {
    return null
  }
}

function sameSessionSubject(leftToken?: string | null, rightToken?: string | null) {
  const left = readSessionTokenSubject(leftToken)
  const right = readSessionTokenSubject(rightToken)
  if (!left || !right) return true
  return left === right
}

function settleJsonParseJobOnMainThread(job: JsonParseJob) {
  clearTimeout(job.timer)
  try {
    job.resolve(JSON.parse(job.text) as unknown)
  } catch (error) {
    job.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

function fallbackJsonParseJobs() {
  for (const job of jsonParseJobs.values()) settleJsonParseJobOnMainThread(job)
  jsonParseJobs.clear()
}

function disableJsonParseWorker() {
  jsonParseWorker?.terminate()
  jsonParseWorker = null
  jsonParseWorkerUnavailable = true
  fallbackJsonParseJobs()
}

function getJsonParseWorker() {
  if (jsonParseWorkerUnavailable || typeof Worker === 'undefined') return null
  if (jsonParseWorker) return jsonParseWorker
  try {
    jsonParseWorker = new Worker(new URL('./jsonParse.worker.ts', import.meta.url), { type: 'module' })
    jsonParseWorker.addEventListener('message', (event: MessageEvent<JsonParseWorkerResponse>) => {
      const result = event.data
      const job = jsonParseJobs.get(result.id)
      if (!job) return
      jsonParseJobs.delete(result.id)
      clearTimeout(job.timer)
      if (result.error) settleJsonParseJobOnMainThread(job)
      else job.resolve(result.value)
    })
    jsonParseWorker.addEventListener('error', disableJsonParseWorker)
    jsonParseWorker.addEventListener('messageerror', disableJsonParseWorker)
    return jsonParseWorker
  } catch {
    jsonParseWorker = null
    jsonParseWorkerUnavailable = true
    return null
  }
}

function parseLargeJson(text: string) {
  if (text.length < OFF_MAIN_JSON_THRESHOLD) return Promise.resolve(JSON.parse(text) as unknown)
  const worker = getJsonParseWorker()
  if (!worker) return Promise.resolve(JSON.parse(text) as unknown)
  const id = ++jsonParseWorkerSequence
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      const job = jsonParseJobs.get(id)
      if (!job) return
      jsonParseJobs.delete(id)
      settleJsonParseJobOnMainThread(job)
      disableJsonParseWorker()
    }, JSON_PARSE_WORKER_TIMEOUT_MS)
    jsonParseJobs.set(id, { text, timer, resolve, reject })
    try {
      worker.postMessage({ id, text })
    } catch {
      const job = jsonParseJobs.get(id)
      if (!job) return
      jsonParseJobs.delete(id)
      settleJsonParseJobOnMainThread(job)
    }
  })
}

function cachePartitionForToken(token?: string) {
  if (!token) return 'anonymous'
  return sessionCachePartitionByToken.get(token) ?? token
}

function readCachePartition(token?: string) {
  const subject = readSessionTokenSubject(token)
  return subject ? `sub:${subject}` : cachePartitionForToken(token)
}

function readCacheRevision(token?: string) {
  return readCacheRevisionByPartition.get(readCachePartition(token)) ?? 0
}

/**
 * Invalidate all short-lived/conditional reads for one signed-in identity.
 * Mutation responses and realtime invalidation events both use this boundary,
 * so an older in-flight GET cannot repopulate the current cache generation.
 */
export function invalidateClientReadCache(token?: string) {
  const partition = readCachePartition(token)
  readCacheRevisionByPartition.set(partition, readCacheRevision(token) + 1)
  const prefix = `g${clientSessionGeneration}:${partition}:`
  for (const key of conditionalResponseCache.keys()) {
    if (key.startsWith(prefix)) conditionalResponseCache.delete(key)
  }
  for (const key of conditionalRequestInFlight.keys()) {
    if (key.startsWith(prefix)) conditionalRequestInFlight.delete(key)
  }
}

/**
 * Conditional GET cache keys are scoped by session generation, then by
 * authenticated subject (or token partition). Same-account rotated JWTs within
 * one login share one /api/auth/me body; a re-login bumps generation so the new
 * session never joins an in-flight 401 from the previous same-account session.
 * Different accounts never collide even if token strings were ever linked.
 */
function conditionalCacheKey(path: string, token?: string, generation = clientSessionGeneration) {
  const partition = readCachePartition(token)
  return `g${generation}:${partition}:r${readCacheRevision(token)} ${path}`
}

let clientInstanceId: string | null = null

function getClientInstanceId() {
  if (clientInstanceId) return clientInstanceId
  const key = 'phd-atlas:api-client-id'
  try {
    const existing = globalThis.sessionStorage?.getItem(key)
    if (existing) {
      clientInstanceId = existing
      return existing
    }
  } catch {
    // Storage can be disabled; a memory-only identifier still prevents loops.
  }
  clientInstanceId = globalThis.crypto?.randomUUID?.()
    ?? `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  try {
    globalThis.sessionStorage?.setItem(key, clientInstanceId)
  } catch {
    // Keep the memory-only identifier.
  }
  return clientInstanceId
}

export function setSessionTokenHandler(handler: SessionTokenHandler | null) {
  sessionTokenHandler = handler
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler
}

export function getLatestSessionToken(fallback: string) {
  let token = fallback
  const seen = new Set<string>()
  while (!seen.has(token)) {
    seen.add(token)
    const refreshedToken = latestSessionTokenBySource.get(token)
    if (!refreshedToken) return token
    // Break and scrub any poisoned cross-account chain while resolving.
    if (!sameSessionSubject(token, refreshedToken)) {
      latestSessionTokenBySource.delete(token)
      return token
    }
    token = refreshedToken
  }
  return token
}

/** True when a response identity still belongs to the request account. */
export function sessionIdentityMatches(requestUserId: string, responseUserId?: string | null, token?: string | null) {
  if (!requestUserId || !responseUserId || requestUserId !== responseUserId) return false
  const subject = readSessionTokenSubject(token)
  if (subject && subject !== requestUserId) return false
  return true
}

export class ApiError extends Error {
  code: string
  field?: string
  status: number

  constructor(message: string, code: string, status: number, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.field = field
  }
}

const unauthorizedCodes = ['TOKEN_EXPIRED', 'UNAUTHORIZED', 'UNKNOWN_USER', 'ACCOUNT_DISABLED']

function notifyUnauthorized(error: ApiError, sourceToken?: string, requestGeneration?: number) {
  // Drop unauthorized signals from requests that started before the latest
  // login/logout. Same-account re-login is the critical case: an in-flight
  // TOKEN_EXPIRED for the previous JWT must not toast+logout the new session.
  if (
    requestGeneration !== undefined
    && requestGeneration !== clientSessionGeneration
  ) {
    return
  }
  if (error.status === 401 && unauthorizedCodes.includes(error.code)) {
    unauthorizedHandler?.(error, sourceToken)
  }
}

async function parseEnvelope<T>(
  response: Response,
  sourceToken?: string,
  parseOffMain = false,
  requestGeneration?: number,
): Promise<T> {
  // A revalidated HTTP response can combine fresh 304 headers with an older cached
  // response body. The header is authoritative so a cached envelope cannot roll a
  // newly established session back to an expired token.
  // Also ignore session-token headers from responses that belong to a previous
  // client session generation (late responses after re-login).
  const generation = requestGeneration ?? clientSessionGeneration
  const acceptSessionSideEffects = generation === clientSessionGeneration
  const responseSessionToken = acceptSessionSideEffects
    ? syncSessionFromResponse(response, sourceToken)
    : (response.headers.get('X-Session-Token') || null)
  const contentType = response.headers.get('content-type') || ''
  const isJsonResponse = contentType.toLowerCase().includes('json')
  // Atlas deliberately uses gateway-range statuses for failures reported by
  // external services (SMTP, IMAP, web push, AI providers). A JSON envelope
  // proves that the Atlas API answered, so preserve its specific error code.
  // Empty/non-JSON gateway responses still mean the API itself is unavailable.
  if ([502, 503, 504].includes(response.status) && !isJsonResponse) {
    throw new ApiError(
      'The PhD Atlas server is unavailable.',
      'SERVER_UNAVAILABLE',
      response.status,
    )
  }
  // SPA shell HTML (e.g. stale server without a new /api route) must not surface as a blank parse error.
  if (contentType.includes('text/html')) {
    const error = new ApiError(
      'The API returned a web page instead of JSON. Restart the PhD Atlas server and try again.',
      'API_HTML_RESPONSE',
      response.status || 502,
    )
    notifyUnauthorized(error, sourceToken, generation)
    throw error
  }
  let envelope: ApiEnvelope<T>
  try {
    envelope = parseOffMain
      ? await response.text().then((text) => parseLargeJson(text)) as ApiEnvelope<T>
      : await response.json() as ApiEnvelope<T>
  } catch {
    const error = new ApiError(
      response.status === 401 ? 'Sign in is required.' : 'Request failed.',
      response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED',
      response.status,
    )
    notifyUnauthorized(error, sourceToken, generation)
    throw error
  }
  if (acceptSessionSideEffects && !responseSessionToken) syncSessionFromEnvelope(envelope, sourceToken)
  if (!response.ok || !envelope.ok) {
    const error = new ApiError(
      envelope.error?.message ?? 'Request failed.',
      envelope.error?.code ?? 'REQUEST_FAILED',
      response.status,
      envelope.error?.field,
    )
    notifyUnauthorized(error, sourceToken, generation)
    throw error
  }
  return envelope.data as T
}

function acceptSessionToken(refreshedToken: string, sourceToken?: string) {
  // Never link tokens that belong to different accounts — even if a cached or
  // raced response somehow presents a foreign X-Session-Token header.
  if (sourceToken && !sameSessionSubject(sourceToken, refreshedToken)) return
  const accepted = sessionTokenHandler?.(refreshedToken, sourceToken)
  if (accepted === false) return
  if (sourceToken) {
    latestSessionTokenBySource.set(sourceToken, refreshedToken)
    sessionCachePartitionByToken.set(
      refreshedToken,
      sessionCachePartitionByToken.get(sourceToken) ?? sourceToken,
    )
  }
}

function syncSessionFromResponse(response: Response, sourceToken?: string) {
  const refreshedToken = response.headers.get('X-Session-Token')
  if (!refreshedToken) return null
  acceptSessionToken(refreshedToken, sourceToken)
  return refreshedToken
}

function syncSessionFromEnvelope<T>(envelope: ApiEnvelope<T>, sourceToken?: string) {
  const refreshedToken = envelope.session?.token
  if (!refreshedToken) return
  acceptSessionToken(refreshedToken, sourceToken)
}

function requestHeaders(token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-Phd-Client-Id', getClientInstanceId())
  if (init.body !== undefined && init.body !== null && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

function timeoutForRequest(init: RequestInit = {}) {
  return init.body instanceof FormData ? UPLOAD_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS
}

function timeoutError() {
  return new ApiError('Request timed out. Check your connection and try again.', 'REQUEST_TIMEOUT', 408)
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit = {},
  timeoutMs = timeoutForRequest(init),
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(path, { ...init, cache: 'no-store' })
  }

  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const externalSignal = init.signal
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason)
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
  }

  try {
    const response = await fetch(path, {
      ...init,
      // Conditional GET state is deliberately owned by this client, not by the
      // browser HTTP cache. A cached API response can carry an old
      // X-Session-Token header; when revalidated, browsers merge that header
      // into a 304 response and would overwrite a freshly established session.
      cache: 'no-store',
      signal: controller.signal,
    })
    if (path.startsWith('/api/')) {
      const contentType = response.headers.get('content-type') ?? ''
      const isAtlasEnvelope = contentType.toLowerCase().includes('json')
      if ([502, 503, 504].includes(response.status) && !isAtlasEnvelope) reportApiUnavailable()
      else reportApiReachable()
    }
    const method = String(init.method ?? 'GET').toUpperCase()
    if (response.ok && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const authorization = new Headers(init.headers).get('Authorization') ?? ''
      const [, mutationToken] = authorization.match(/^Bearer\s+(.+)$/i) ?? []
      invalidateClientReadCache(mutationToken)
    }
    return response
  } catch (error) {
    if (timedOut) {
      if (path.startsWith('/api/')) reportApiUnavailable()
      throw timeoutError()
    }
    if (path.startsWith('/api/') && error instanceof TypeError) reportApiUnavailable()
    throw error
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

async function request<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
  timeoutMs = timeoutForRequest(init),
): Promise<T> {
  const requestGeneration = clientSessionGeneration
  const activeToken = token ? getLatestSessionToken(token) : undefined
  const response = await fetchWithTimeout(path, {
    ...init,
    headers: requestHeaders(activeToken, init),
  }, timeoutMs)
  return parseEnvelope<T>(response, token, false, requestGeneration)
}

async function streamAiDraftRequest(
  token: string,
  input: AiDraftInput,
  onEvent: (event: AiDraftEvent) => void,
  signal?: AbortSignal,
) {
  const requestGeneration = clientSessionGeneration
  const activeToken = getLatestSessionToken(token)
  const response = await fetchWithTimeout('/api/ai/draft', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: requestHeaders(activeToken, { body: JSON.stringify(input) }),
    signal,
  }, 120_000)
  if (!response.ok) {
    await parseEnvelope<never>(response, token, false, requestGeneration)
  }
  if (requestGeneration === clientSessionGeneration) {
    syncSessionFromResponse(response, token)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError('AI stream was unavailable.', 'AI_STREAM_UNAVAILABLE', 502)
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = 'message'
  const dispatch = (block: string) => {
    const lines = block.split(/\r?\n/)
    let data = ''
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim()
      if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) return
    try {
      onEvent({ type: eventType, ...JSON.parse(data) } as AiDraftEvent)
    } catch {
      // A malformed intermediary SSE frame should not crash the editor.
    } finally {
      eventType = 'message'
    }
  }
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = done ? '' : (events.pop() ?? '')
    events.forEach(dispatch)
    if (done) break
  }
  if (buffer) dispatch(buffer)
}

function resolveActiveRequestToken(token: string) {
  const activeToken = getLatestSessionToken(token)
  if (sameSessionSubject(token, activeToken)) return activeToken
  // Drop a cross-account chain link if one ever appears.
  latestSessionTokenBySource.delete(token)
  return token
}

function mePayloadUserId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const user = (data as { user?: { id?: unknown } }).user
  return user && typeof user.id === 'string' && user.id ? user.id : null
}

async function conditionalRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  options: { freshForMs?: number } = {},
): Promise<T> {
  // Resolve through the live same-account token chain so concurrent refreshes
  // share a cache partition, while a foreign account never reuses /api/auth/me.
  // Capture generation up front: after same-account re-login the key changes so
  // this call never joins a previous session's in-flight TOKEN_EXPIRED promise.
  const requestGeneration = clientSessionGeneration
  const requestToken = resolveActiveRequestToken(token)
  const cacheKey = conditionalCacheKey(path, requestToken, requestGeneration)
  const cached = conditionalResponseCache.get(cacheKey)
  const freshForMs = Math.max(0, Number(options.freshForMs ?? 0))
  if (cached && freshForMs > 0 && Date.now() - cached.storedAt < freshForMs) {
    return cached.data as T
  }
  const existing = conditionalRequestInFlight.get(cacheKey)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    const headers = requestHeaders(requestToken, init)
    if (cached?.etag) {
      headers.set('If-None-Match', cached.etag)
    }

    const response = await fetchWithTimeout(path, {
      ...init,
      headers,
    })

    if (response.status === 304 && cached) {
      if (path === '/api/auth/me') {
        const cachedUserId = mePayloadUserId(cached.data)
        const requestSubject = readSessionTokenSubject(requestToken)
        if (cachedUserId && requestSubject && cachedUserId !== requestSubject) {
          conditionalResponseCache.delete(cacheKey)
          // Identity mismatch: re-fetch without validators instead of serving
          // another account's body.
          const freshHeaders = requestHeaders(resolveActiveRequestToken(token), init)
          const freshResponse = await fetchWithTimeout(path, {
            ...init,
            headers: freshHeaders,
          })
          const etag = freshResponse.headers.get('ETag')
          const data = await parseEnvelope<T>(freshResponse, token, false, requestGeneration)
          if (etag && requestGeneration === clientSessionGeneration) {
            conditionalResponseCache.set(
              conditionalCacheKey(path, resolveActiveRequestToken(token), requestGeneration),
              { etag, data, storedAt: Date.now() },
            )
          }
          return data
        }
      }
      if (requestGeneration === clientSessionGeneration) {
        syncSessionFromResponse(response, token)
      }
      return cached.data as T
    }

    const etag = response.headers.get('ETag')
    const data = await parseEnvelope<T>(
      response,
      token,
      path === '/api/applications' || path.startsWith('/api/workspace/bootstrap'),
      requestGeneration,
    )
    if (requestGeneration === clientSessionGeneration) {
      conditionalResponseCache.set(cacheKey, { etag: etag ?? undefined, data, storedAt: Date.now() })
    }
    return data
  })()
  conditionalRequestInFlight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    if (conditionalRequestInFlight.get(cacheKey) === promise) {
      conditionalRequestInFlight.delete(cacheKey)
    }
  }
}

async function streamRealtimeUpdatesRequest(
  token: string,
  onEvent: (event: RealtimeInvalidationEvent) => void,
  signal?: AbortSignal,
) {
  const requestGeneration = clientSessionGeneration
  const activeToken = getLatestSessionToken(token)
  const response = await fetchWithTimeout('/api/events', {
    headers: requestHeaders(activeToken),
    signal,
  }, 0)
  if (!response.ok) {
    await parseEnvelope<never>(response, token, false, requestGeneration)
  }
  if (requestGeneration === clientSessionGeneration) syncSessionFromResponse(response, token)
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError('Realtime updates are unavailable.', 'REALTIME_UNAVAILABLE', 502)
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    if (!data) return
    try {
      const event = JSON.parse(data) as RealtimeInvalidationEvent
      if (event.type === 'invalidate') invalidateClientReadCache(activeToken)
      onEvent(event)
    } catch {
      // Ignore malformed intermediary frames and wait for the next event.
    }
  }
  while (!signal?.aborted) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = done ? '' : (blocks.pop() ?? '')
    blocks.forEach(dispatch)
    if (done) break
  }
  if (buffer) dispatch(buffer)
}

function primeConditionalRead(path: string, token: string, data: unknown) {
  const requestToken = resolveActiveRequestToken(token)
  conditionalResponseCache.set(
    conditionalCacheKey(path, requestToken, clientSessionGeneration),
    { data, storedAt: Date.now() },
  )
}

async function workspaceBootstrapRequest(token: string, teamId?: string | null) {
  const path = `/api/workspace/bootstrap${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`
  const data = await conditionalRequest<WorkspaceBootstrapPayload>(
    path,
    token,
    {},
    { freshForMs: 1_000 },
  )
  primeConditionalRead('/api/applications', token, data.applications)
  primeConditionalRead('/api/profile-assets', token, data.profileAssets)
  primeConditionalRead('/api/backups', token, data.backups)
  primeConditionalRead('/api/applications/trash', token, data.applicationTrash)
  primeConditionalRead('/api/teams/mine/workspaces', token, data.teamWorkspaces)
  primeConditionalRead('/api/ai/keys', token, data.aiKeys)
  if (data.activeTeamId) {
    const encodedTeamId = encodeURIComponent(data.activeTeamId)
    primeConditionalRead(`/api/teams/mine?teamId=${encodedTeamId}`, token, data.teamSummary)
    primeConditionalRead(`/api/teams/mine/applications?teamId=${encodedTeamId}`, token, data.teamApplications)
  }
  return data
}

async function blobRequest(
  path: string,
  token?: string,
  init: RequestInit = {},
  timeoutMs = DOWNLOAD_REQUEST_TIMEOUT_MS,
) {
  const requestGeneration = clientSessionGeneration
  const activeToken = token ? getLatestSessionToken(token) : undefined
  const response = await fetchWithTimeout(path, {
    ...init,
    headers: requestHeaders(activeToken, init),
  }, timeoutMs)
  if (!response.ok) {
    await parseEnvelope<never>(response, token, false, requestGeneration)
  }
  if (requestGeneration === clientSessionGeneration) {
    syncSessionFromResponse(response, token)
  }
  return response.blob()
}

function uploadFilesRequest<T>(
  path: string,
  token: string | undefined,
  files: readonly File[],
  fieldName = 'file',
) {
  const form = new FormData()
  files.forEach((file) => form.append(fieldName, file, file.name))
  return request<T>(path, token, { method: 'POST', body: form })
}

export const phdApi = {
  initialSetupStatus: () =>
    request<InitialSetupStatus>('/api/setup/status', undefined, {}, 10_000),

  completeInitialSetup: (input: InitialAdminSetupInput) =>
    request<AuthSession>('/api/setup', undefined, {
      method: 'POST',
      body: JSON.stringify(input),
    }, 30_000),

  login: (email: string, password: string, scope: 'app' | 'admin' = 'app') => {
    resetClientSessionState()
    return request<AuthSession>('/api/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, password, scope }),
    })
  },

  beginPasskeyLogin: (email = '', scope: 'app' | 'admin' = 'app') => {
    resetClientSessionState()
    return request<PasskeyOptionsPayload>('/api/auth/passkeys/login/options', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, scope }),
    })
  },

  finishPasskeyLogin: (response: unknown, scope: 'app' | 'admin' = 'app') => {
    resetClientSessionState()
    return request<AuthSession>('/api/auth/passkeys/login/verify', undefined, {
      method: 'POST',
      body: JSON.stringify({ response, scope }),
    })
  },

  listPasskeys: (token: string) =>
    request<PasskeyCredentialSummary[]>('/api/auth/passkeys', token),

  beginPasskeyRegistration: (token: string, label = '') =>
    request<PasskeyOptionsPayload>('/api/auth/passkeys/register/options', token, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  finishPasskeyRegistration: (token: string, response: unknown, label = '') =>
    request<PasskeyCredentialSummary[]>('/api/auth/passkeys/register/verify', token, {
      method: 'POST',
      body: JSON.stringify({ response, label }),
    }),

  updatePasskey: (token: string, id: string, label: string) =>
    request<PasskeyCredentialSummary>(`/api/auth/passkeys/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    }),

  deletePasskey: (token: string, id: string) =>
    request<{ id: string }>(`/api/auth/passkeys/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),

  impersonateUser: (token: string, userId: string, returnTo: 'app' | 'admin' = 'app', teamId?: string | null) =>
    request<AuthSession>('/api/auth/impersonate', token, {
      method: 'POST',
      body: JSON.stringify({ userId, returnTo, ...(teamId ? { teamId } : {}) }),
    }),

  captcha: () =>
    request<{ question: string; token: string; expiresInSeconds: number }>('/api/auth/captcha'),

  sendRegisterEmailCode: (email: string, language: string) =>
    request<{ token: string; expiresInSeconds: number }>('/api/auth/register/email-code', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, language }),
    }),

  register: (
    name: string,
    email: string,
    password: string,
    captchaToken: string,
    captchaAnswer: string,
    emailCodeToken: string,
    emailCode: string,
    language: string,
  ) => {
    resetClientSessionState()
    return request<AuthSession>('/api/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ name, email, password, captchaToken, captchaAnswer, emailCodeToken, emailCode, language }),
    })
  },

  me: (token: string) =>
    conditionalRequest<{ user: PublicUser; settings: AdminSettings; mailFetchStatus: MailFetchStatus; usage?: AccountUsage }>('/api/auth/me', token),

  workspaceBootstrap: (token: string, teamId?: string | null) =>
    workspaceBootstrapRequest(token, teamId),

  listAiKeys: (token: string) =>
    conditionalRequest<AiKey[]>('/api/ai/keys', token, {}, { freshForMs: 5_000 }),

  createAiKey: (token: string, input: AiKeyInput) =>
    request<AiKey>('/api/ai/keys', token, { method: 'POST', body: JSON.stringify(input) }),

  updateAiKey: (token: string, id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey'>>) =>
    request<AiKey>(`/api/ai/keys/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: JSON.stringify(input) }),

  deleteAiKey: (token: string, id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/ai/keys/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),

  testAiKey: (token: string, id: string) =>
    request<{
      ok: boolean
      latencyMs: number
      provider: string
      model: string
      testedAt: string
    }>(`/api/ai/keys/${encodeURIComponent(id)}/test`, token, { method: 'POST', body: '{}' }),

  resetAiKeyUsage: (token: string, id: string) =>
    request<AiKey>(`/api/ai/keys/${encodeURIComponent(id)}/usage/reset`, token, { method: 'POST', body: '{}' }),

  streamAiDraft: (token: string, input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) =>
    streamAiDraftRequest(token, input, onEvent, signal),

  streamRealtimeUpdates: (
    token: string,
    onEvent: (event: RealtimeInvalidationEvent) => void,
    signal?: AbortSignal,
  ) => streamRealtimeUpdatesRequest(token, onEvent, signal),

  listApplications: (token: string) =>
    conditionalRequest<ApplicationRecord[]>('/api/applications', token, {}, { freshForMs: 1_000 }),

  createApplication: (token: string, input: CreateApplicationInput) =>
    request<ApplicationRecord>('/api/applications', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateApplication: (token: string, application: ApplicationRecord, baseApplication?: ApplicationRecord | null) =>
    request<ApplicationRecord>(`/api/applications/${application.id}`, token, {
      method: 'PUT',
      body: JSON.stringify(baseApplication ? { ...application, clientBaseApplication: baseApplication } : application),
    }),

  replayOfflineApplicationUpdate: (
    token: string,
    application: ApplicationRecord,
    clientBaseUpdatedAt: string,
  ) =>
    request<ApplicationRecord>(`/api/applications/${application.id}`, token, {
      method: 'PUT',
      body: JSON.stringify({ ...application, clientBaseUpdatedAt }),
    }),

  updateApplicationTeamVisibility: (token: string, applicationId: string, visibleToTeam: boolean) =>
    request<ApplicationRecord>(`/api/applications/${applicationId}/team-visibility`, token, {
      method: 'PATCH',
      body: JSON.stringify({ visibleToTeam }),
    }),

  approveTeamTransferRequest: (token: string, teamId: string, requestId: string) =>
    request<ApplicationRecord>(`/api/teams/${teamId}/transfer-requests/${requestId}/approve`, token, {
      method: 'POST',
    }),

  rejectTeamTransferRequest: (token: string, teamId: string, requestId: string) =>
    request<ApplicationRecord>(`/api/teams/${teamId}/transfer-requests/${requestId}/reject`, token, {
      method: 'POST',
    }),

  deleteApplication: (token: string, id: string) =>
    request<{ id: string; trashed?: boolean; trashId?: string | null }>(`/api/applications/${id}`, token, {
      method: 'DELETE',
    }),

  listApplicationTrash: (token: string) =>
    conditionalRequest<ApplicationTrashItem[]>('/api/applications/trash', token, {}, { freshForMs: DEFAULT_READ_FRESHNESS_MS }),

  restoreApplicationFromTrash: (token: string, trashId: string) =>
    request<ApplicationRecord>(`/api/applications/trash/${trashId}/restore`, token, {
      method: 'POST',
    }),

  deleteApplicationTrashItem: (token: string, trashId: string) =>
    request<{ id: string; deleted: boolean }>(`/api/applications/trash/${trashId}`, token, {
      method: 'DELETE',
    }),

  emptyApplicationTrash: (token: string) =>
    request<{ deleted: number }>('/api/applications/trash', token, {
      method: 'DELETE',
    }),

  addMaterial: (token: string, applicationId: string, input: MaterialInput) => {
    const form = new FormData()
    form.set('name', input.name)
    form.set('type', input.type)
    form.set('status', input.status)
    if (input.group) form.set('group', input.group)
    if (input.details) form.set('details', input.details)
    if (input.reminderEnabled !== undefined) form.set('reminderEnabled', String(input.reminderEnabled))
    if (input.reminderDate) form.set('reminderDate', input.reminderDate)
    if (input.requiredCount !== undefined) form.set('requiredCount', String(input.requiredCount))
    const files = input.files?.length ? input.files : (input.file ? [input.file] : [])
    files.forEach((file) => form.append('file', file, file.name))
    return request<ApplicationRecord['materials'][number]>(
      `/api/applications/${applicationId}/materials`,
      token,
      {
        method: 'POST',
        body: form,
      },
    )
  },

  addCommunication: (
    token: string,
    applicationId: string,
    input: CommunicationInput,
  ) =>
    request<ApplicationRecord['communications'][number]>(
      `/api/applications/${applicationId}/communications`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  updateCommunication: (
    token: string,
    applicationId: string,
    communicationId: string,
    input: CommunicationPatchInput,
  ) =>
    request<ApplicationRecord['communications'][number]>(
      `/api/applications/${applicationId}/communications/${communicationId}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    ),

  /** Actually sends the email over SMTP — unlike addCommunication, which only logs a record. */
  sendCommunication: (
    token: string,
    applicationId: string,
    input: CommunicationSendInput,
  ) => {
    const attachments = input.attachments ?? []
    const hasLocalFiles = attachments.some((attachment) => attachment.file)
    const cleanAttachment = (attachment: CommunicationAttachmentInput, uploadIndex?: number) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      fileId: attachment.fileId,
      assetId: attachment.assetId,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      ...(uploadIndex !== undefined ? { uploadIndex } : {}),
    })
    const sendPath = `/api/applications/${applicationId}/communications/send`
    if (hasLocalFiles) {
      const form = new FormData()
      let uploadIndex = 0
      const payload = {
        ...input,
        attachments: attachments.map((attachment) => {
          if (!attachment.file) return cleanAttachment(attachment)
          const currentUploadIndex = uploadIndex
          uploadIndex += 1
          form.append('files', attachment.file, attachment.fileName || attachment.file.name)
          return cleanAttachment(attachment, currentUploadIndex)
        }),
      }
      form.set('payload', JSON.stringify(payload))
      return request<{
        communication: ApplicationRecord['communications'][number]
        delivery: { sent: boolean; delivery: string; errorCode?: string }
      }>(
        sendPath,
        token,
        {
          method: 'POST',
          body: form,
        },
      )
    }
    return request<{
      communication: ApplicationRecord['communications'][number]
      delivery: { sent: boolean; delivery: string; errorCode?: string }
    }>(
      sendPath,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          attachments: attachments.map((attachment) => cleanAttachment(attachment)),
        }),
      },
    )
  },

  addScholarship: (
    token: string,
    applicationId: string,
    input: Omit<ApplicationRecord['scholarships'][number], 'id'>,
  ) =>
    request<ApplicationRecord['scholarships'][number]>(
      `/api/applications/${applicationId}/scholarships`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  addFee: (
    token: string,
    applicationId: string,
    input: { amount: number; currency: string; paidDate?: string; waived: boolean; notes: string },
  ) =>
    request<{ id: string; amount: number; currency: string; paidDate?: string | null; waived: boolean; notes: string; createdAt: string }>(
      `/api/applications/${applicationId}/fees`,
      token,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  updateFee: (
    token: string,
    applicationId: string,
    feeId: string,
    patch: { amount?: number; currency?: string; paidDate?: string | null; waived?: boolean; notes?: string },
  ) =>
    request<{ id: string; amount: number; currency: string; paidDate?: string | null; waived: boolean; notes: string; createdAt: string }>(
      `/api/applications/${applicationId}/fees/${feeId}`,
      token,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  deleteFee: (token: string, applicationId: string, feeId: string) =>
    request<{ id: string }>(
      `/api/applications/${applicationId}/fees/${feeId}`,
      token,
      { method: 'DELETE' },
    ),

  addTask: (
    token: string,
    applicationId: string,
    input: {
      title: string
      due: string
      done: boolean
      details?: string
      reminderEnabled?: boolean
      reminderOffsets?: string[]
      reminderTime?: string
      reminderRepeat?: string
      attachmentRequired?: boolean
      uploadReserved?: boolean
      allowedFileTypes?: string[]
    },
  ) =>
    request<ApplicationRecord['tasks'][number]>(
      `/api/applications/${applicationId}/tasks`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  patchTask: (
    token: string,
    applicationId: string,
    taskId: string,
    input: Partial<{
      title: string
      due: string
      done: boolean
      details: string
      reminderEnabled: boolean
      reminderOffsets: string[]
      reminderTime: string
      reminderRepeat: string
      attachmentRequired: boolean
      uploadReserved: boolean
      allowedFileTypes: string[]
    }>,
  ) =>
    request<ApplicationRecord['tasks'][number]>(
      `/api/applications/${applicationId}/tasks/${taskId}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    ),

  uploadMaterialFiles: (token: string, applicationId: string, materialId: string, files: readonly File[]) =>
    uploadFilesRequest<ApplicationRecord['materials'][number]>(
      `/api/applications/${applicationId}/materials/${materialId}/file`,
      token,
      files,
    ),

  uploadMaterialFile: (token: string, applicationId: string, materialId: string, file: File) =>
    uploadFilesRequest<ApplicationRecord['materials'][number]>(
      `/api/applications/${applicationId}/materials/${materialId}/file`,
      token,
      [file],
    ),

  removeMaterialFile: (token: string, applicationId: string, materialId: string, fileId: string) =>
    request<ApplicationRecord['materials'][number]>(
      `/api/applications/${applicationId}/materials/${materialId}/files/${fileId}`,
      token,
      {
        method: 'DELETE',
      },
    ),

  renameMaterialFile: (token: string, applicationId: string, materialId: string, fileId: string, fileName: string) =>
    request<ApplicationRecord['materials'][number]>(
      `/api/applications/${applicationId}/materials/${materialId}/files/${fileId}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({ fileName }),
      },
    ),

  uploadTaskFiles: (token: string, applicationId: string, taskId: string, files: readonly File[]) =>
    uploadFilesRequest<ApplicationRecord['tasks'][number]>(
      `/api/applications/${applicationId}/tasks/${taskId}/file`,
      token,
      files,
    ),

  uploadTaskFile: (token: string, applicationId: string, taskId: string, file: File) =>
    uploadFilesRequest<ApplicationRecord['tasks'][number]>(
      `/api/applications/${applicationId}/tasks/${taskId}/file`,
      token,
      [file],
    ),

  removeTaskFile: (token: string, applicationId: string, taskId: string, fileId: string) =>
    request<ApplicationRecord['tasks'][number]>(
      `/api/applications/${applicationId}/tasks/${taskId}/files/${fileId}`,
      token,
      {
        method: 'DELETE',
      },
    ),

  renameTaskFile: (token: string, applicationId: string, taskId: string, fileId: string, fileName: string) =>
    request<ApplicationRecord['tasks'][number]>(
      `/api/applications/${applicationId}/tasks/${taskId}/files/${fileId}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({ fileName }),
      },
    ),

  shareApplication: (
    token: string,
    applicationId: string,
    expiresAt?: string | null,
    permission: SharePermission = 'view',
    sections?: ShareSection[],
  ) =>
    request<{ id: string; token: string; url: string; createdAt: string; expiresAt: string | null; permission: SharePermission; sections: ShareSection[] }>(
      `/api/applications/${applicationId}/share`,
      token,
      { method: 'POST', body: JSON.stringify({ expiresAt: expiresAt ?? null, permission, sections }) },
    ),

  revokeShare: (token: string, applicationId: string, shareId: string) =>
    request<{ id: string }>(
      `/api/applications/${applicationId}/share/${shareId}`,
      token,
      { method: 'DELETE' },
    ),

  updateShare: (
    token: string,
    applicationId: string,
    shareId: string,
    expiresAt: string | null,
    permission?: SharePermission,
    sections?: ShareSection[],
  ) =>
    request<{ id: string; token: string; url: string; createdAt: string; expiresAt: string | null; permission: SharePermission; sections: ShareSection[] }>(
      `/api/applications/${applicationId}/share/${shareId}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ expiresAt, permission, sections }) },
    ),

  getSharedApplication: (token: string) =>
    request<SharedApplicationPayload>(`/api/share/${encodeURIComponent(token)}`),

  updateSharedSection: (shareToken: string, section: ShareSection, patch: Record<string, unknown>) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/sections/${encodeURIComponent(section)}`,
      undefined,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    ),

  downloadSharedFile: (shareToken: string, fileId: string) =>
    blobRequest(`/api/share/${encodeURIComponent(shareToken)}/files/${encodeURIComponent(fileId)}/download`),

  uploadSharedMaterialFiles: (shareToken: string, materialId: string, files: readonly File[]) =>
    uploadFilesRequest<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/materials/${encodeURIComponent(materialId)}/file`,
      undefined,
      files,
    ),

  uploadSharedMaterialFile: (shareToken: string, materialId: string, file: File) =>
    uploadFilesRequest<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/materials/${encodeURIComponent(materialId)}/file`,
      undefined,
      [file],
    ),

  updateSharedMaterialStatus: (shareToken: string, materialId: string, status: MaterialStatus) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/materials/${encodeURIComponent(materialId)}`,
      undefined,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    ),

  uploadSharedTaskFiles: (shareToken: string, taskId: string, files: readonly File[]) =>
    uploadFilesRequest<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/tasks/${encodeURIComponent(taskId)}/file`,
      undefined,
      files,
    ),

  uploadSharedTaskFile: (shareToken: string, taskId: string, file: File) =>
    uploadFilesRequest<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/tasks/${encodeURIComponent(taskId)}/file`,
      undefined,
      [file],
    ),

  updateSharedTask: (shareToken: string, taskId: string, done: boolean) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      {
        method: 'PATCH',
        body: JSON.stringify({ done }),
      },
    ),

  requestPasswordReset: (email: string) =>
    request<{ sent: boolean; delivery: string; resetUrl?: string }>(
      '/api/auth/password-reset/request',
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    ),

  resetPasswordWithToken: (token: string, password: string) =>
    request<{ reset: boolean }>('/api/auth/password-reset/confirm', undefined, {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  restoreBackup: (token: string, fileName: string) =>
    request<{ restored: boolean; fileName: string; application?: ApplicationRecord }>(
      `/api/backups/${encodeURIComponent(fileName)}/restore`,
      token,
      { method: 'POST' },
    ),

  listProfileAssets: (token: string) =>
    conditionalRequest<ProfileAsset[]>('/api/profile-assets', token, {}, { freshForMs: DEFAULT_READ_FRESHNESS_MS }),

  listTeamMemberProfileAssets: (token: string, teamId: string, userId: string) =>
    conditionalRequest<ProfileAsset[]>(
      `/api/teams/${teamId}/members/${userId}/profile-assets`,
      token,
      {},
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),

  addTeamMemberProfileAsset: (token: string, teamId: string, userId: string, input: ProfileAssetInput) =>
    request<ProfileAsset>(`/api/teams/${teamId}/members/${userId}/profile-assets`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  addProfileAsset: (token: string, input: ProfileAssetInput) =>
    request<ProfileAsset>('/api/profile-assets', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateProfileAsset: (token: string, id: string, input: Partial<ProfileAssetInput>) =>
    request<ProfileAsset>(`/api/profile-assets/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteProfileAsset: (token: string, id: string) =>
    request<{ id: string }>(`/api/profile-assets/${id}`, token, {
      method: 'DELETE',
    }),

  uploadProfileAssetFiles: (token: string, id: string, files: readonly File[]) =>
    uploadFilesRequest<ProfileAsset>(`/api/profile-assets/${id}/files`, token, files),

  uploadProfileAssetFile: (token: string, id: string, file: File) =>
    uploadFilesRequest<ProfileAsset>(`/api/profile-assets/${id}/files`, token, [file]),

  renameProfileAssetFile: (token: string, id: string, fileId: string, fileName: string) =>
    request<ProfileAsset>(`/api/profile-assets/${id}/files/${fileId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ fileName }),
    }),

  deleteProfileAssetFile: (token: string, id: string, fileId: string) =>
    request<ProfileAsset>(`/api/profile-assets/${id}/files/${fileId}`, token, {
      method: 'DELETE',
    }),

  shareProfileAsset: (token: string, id: string, expiresAt: string | null = null, note = '') =>
    request<ProfileAssetShare>(`/api/profile-assets/${id}/share`, token, {
      method: 'POST',
      body: JSON.stringify({ expiresAt, note }),
    }),

  revokeProfileAssetShare: (token: string, id: string, shareId: string) =>
    request<{ id: string }>(`/api/profile-assets/${id}/share/${shareId}`, token, {
      method: 'DELETE',
    }),

  getAssetUploadInfo: (uploadToken: string) =>
    request<{ assetName: string; note: string; attachmentCount: number; allowedFileTypes?: string[] }>(
      `/api/asset-upload/${encodeURIComponent(uploadToken)}`,
    ),

  uploadFilesToAssetShare: (uploadToken: string, files: readonly File[]) =>
    uploadFilesRequest<{
      assetName: string
      fileName: string
      fileNames: string[]
      attachmentCount: number
    }>(
      `/api/asset-upload/${encodeURIComponent(uploadToken)}/file`,
      undefined,
      files,
    ),

  uploadToAssetShare: (uploadToken: string, file: File) =>
    uploadFilesRequest<{ assetName: string; fileName: string; fileNames?: string[]; attachmentCount?: number }>(
      `/api/asset-upload/${encodeURIComponent(uploadToken)}/file`,
      undefined,
      [file],
    ),

  updateSettings: (token: string, input: UserSettingsPatch) =>
    request<PublicUser>('/api/settings', token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  getDiscoverCatalog: (token: string) =>
    conditionalRequest<import('../data/discover').DiscoverCatalogPayload>(
      '/api/discover/catalog',
      token,
      {},
      { freshForMs: 5_000 },
    ),

  getDiscoverState: (token: string) =>
    conditionalRequest<import('../data/discover').DiscoverUserState>(
      '/api/discover/state',
      token,
      {},
      { freshForMs: 5_000 },
    ),

  updateDiscoverState: (token: string, patch: Partial<import('../data/discover').DiscoverUserState>) =>
    request<import('../data/discover').DiscoverCatalogPayload>('/api/discover/state', token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  runDiscoverResearch: (
    token: string,
    input?: { notify?: boolean; useAi?: boolean; keyId?: string; acceptSuggestions?: boolean },
  ) =>
    request<import('../data/discover').DiscoverResearchPayload>('/api/discover/research', token, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  importDiscoverProgram: (token: string, input: import('../data/discover').DiscoverImportInput) =>
    request<{ application: ApplicationRecord; programId: string; piId: string | null }>(
      '/api/discover/import',
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  previewDiscoverApplicationEnrichment: (
    token: string,
    applicationId: string,
    input?: { useAi?: boolean; keyId?: string },
  ) =>
    request<import('../data/discover').DiscoverApplicationEnrichmentProposal>(
      `/api/discover/applications/${encodeURIComponent(applicationId)}/enrichment/preview`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      },
      120_000,
    ),

  applyDiscoverApplicationEnrichment: (
    token: string,
    applicationId: string,
    proposal: import('../data/discover').DiscoverApplicationEnrichmentProposal,
    acceptedChangeIds: string[],
  ) =>
    request<ApplicationRecord>(
      `/api/discover/applications/${encodeURIComponent(applicationId)}/enrichment/apply`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ proposal, acceptedChangeIds }),
      },
    ),

  sendTestEmail: (token: string, input?: { delivery?: string; source?: 'personal' | 'system' }) =>
    request<{ sent: boolean; delivery: string }>('/api/settings/test-email', token, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  sendReceiveEmailVerification: (token: string, email: string) =>
    request<{ user: PublicUser; verificationSentAt: string; retryAt: string }>(
      '/api/settings/receive-email-verification',
      token,
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    ),

  testIncomingMail: (token: string) =>
    request<{ connected: boolean; protocol: 'pop3' | 'imap'; host: string; port: number }>(
      '/api/settings/test-incoming-mail',
      token,
      { method: 'POST' },
    ),

  /** Syncs only messages newer than the committed per-folder IMAP cursors. */
  fetchMailNow: (token: string) =>
    request<MailSyncEnqueueResult>(
      '/api/settings/fetch-mail-now',
      token,
      { method: 'POST' },
    ),

  /** Backfills all historical incoming and sent mail that exactly matches tracked professor addresses. */
  syncMailHistory: (token: string) =>
    request<MailSyncEnqueueResult>(
      '/api/settings/sync-mail-history',
      token,
      { method: 'POST' },
    ),

  sendAdminTestEmail: (token: string, delivery: string) =>
    request<{ sent: boolean; delivery: string }>('/api/admin/settings/test-email', token, {
      method: 'POST',
      body: JSON.stringify({ delivery }),
    }),

  deleteAccount: (token: string) =>
    request<{ deleted: boolean; id: string }>('/api/account', token, {
      method: 'DELETE',
    }),

  analytics: (token: string) =>
    conditionalRequest<AnalyticsPayload>('/api/analytics', token, {}, { freshForMs: 10_000 }),

  listNotifications: (token: string, options: { unreadOnly?: boolean; archivedOnly?: boolean; before?: string } = {}) => {
    const params = new URLSearchParams()
    if (options.unreadOnly) params.set('unread', 'true')
    if (options.archivedOnly) params.set('archived', 'true')
    if (options.before) params.set('before', options.before)
    const query = params.toString()
    return conditionalRequest<NotificationRecord[]>(
      `/api/notifications${query ? `?${query}` : ''}`,
      token,
      {},
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    )
  },

  unreadNotificationCount: (token: string) =>
    conditionalRequest<{ count: number }>(
      '/api/notifications/unread-count',
      token,
      {},
      { freshForMs: 15_000 },
    ),

  webPushPublicKey: (token: string) =>
    request<{ publicKey: string }>('/api/push/public-key', token),

  saveWebPushSubscription: (token: string, subscription: WebPushSubscriptionInput) =>
    request<{ endpoint: string }>('/api/push/subscriptions', token, {
      method: 'PUT',
      body: JSON.stringify(subscription),
    }),

  deleteWebPushSubscription: (token: string, endpoint: string) =>
    request<{ endpoint: string; deleted: boolean }>('/api/push/subscriptions', token, {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

  testWebPush: (token: string) =>
    request<WebPushTestResult>('/api/push/test', token, { method: 'POST' }),

  markNotificationRead: (token: string, id: string) =>
    request<{ id: string; read: boolean }>(`/api/notifications/${id}/read`, token, { method: 'POST' }),

  markNotificationUnread: (token: string, id: string) =>
    request<{ id: string; read: boolean }>(`/api/notifications/${id}/unread`, token, { method: 'POST' }),

  archiveNotification: (token: string, id: string) =>
    request<{ id: string; archived: boolean }>(`/api/notifications/${id}/archive`, token, { method: 'POST' }),

  markAllNotificationsRead: (token: string) =>
    request<{ updated: number }>('/api/notifications/read-all', token, { method: 'POST' }),

  updateNotificationsBulk: (token: string, ids: string[], action: 'mark_read' | 'mark_unread' | 'archive') =>
    request<{ updated: number }>('/api/notifications/bulk', token, {
      method: 'POST',
      body: JSON.stringify({ ids, action }),
    }),

  adminNotificationGroups: (token: string) =>
    request<NotificationGroup[]>('/api/admin/notification-groups', token),

  createAdminNotificationGroup: (token: string, name: string, memberIds: string[]) =>
    request<NotificationGroup>('/api/admin/notification-groups', token, {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),

  updateAdminNotificationGroup: (token: string, groupId: string, input: { name?: string; memberIds?: string[] }) =>
    request<NotificationGroup>(`/api/admin/notification-groups/${groupId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteAdminNotificationGroup: (token: string, groupId: string) =>
    request<{ id: string; deleted: boolean }>(`/api/admin/notification-groups/${groupId}`, token, {
      method: 'DELETE',
    }),

  publishAdminNotification: (token: string, input: NotificationPublishInput) =>
    request<NotificationPublishResult>('/api/admin/notifications/publish', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listBackups: (token: string, applicationId?: string) =>
    conditionalRequest<BackupRecord[]>(
      `/api/backups${applicationId ? `?applicationId=${encodeURIComponent(applicationId)}` : ''}`,
      token,
      {},
      { freshForMs: 5_000 },
    ),

  createBackup: (token: string, applicationId: string) =>
    request<BackupRecord>('/api/backups', token, {
      method: 'POST',
      body: JSON.stringify({ applicationId }),
    }),

  deleteBackup: (token: string, fileName: string) =>
    request<{ deleted: boolean; fileName: string }>(
      `/api/backups/${encodeURIComponent(fileName)}`,
      token,
      { method: 'DELETE' },
    ),

  listAdminBackups: (token: string) =>
    request<BackupRecord[]>('/api/admin/backups', token),

  createAdminBackup: (token: string) =>
    request<BackupRecord>('/api/admin/backups', token, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteAdminBackup: (token: string, fileName: string) =>
    request<{ deleted: boolean; fileName: string }>(
      `/api/admin/backups/${encodeURIComponent(fileName)}`,
      token,
      { method: 'DELETE' },
    ),

  downloadAdminBackup: (token: string, fileName: string) =>
    blobRequest(`/api/admin/backups/${encodeURIComponent(fileName)}/download`, token),

  adminUsers: (token: string) => request<AdminUser[]>('/api/admin/users', token),

  adminLogs: (token: string) => request<SystemEvent[]>('/api/admin/logs', token),

  clearAdminLogs: (token: string) =>
    request<{ deleted: number; logs: SystemEvent[] }>('/api/admin/logs', token, {
      method: 'DELETE',
    }),

  updateAdminUser: (token: string, userId: string, input: { role?: UserRole; disabled?: boolean; membershipPlan?: MembershipPlan; storageQuotaMb?: number; applicationQuota?: number; applicationCreateQuota?: number; shareQuota?: number; shareCreateQuota?: number; seatLimit?: number }) =>
    request<AdminUser>(`/api/admin/users/${userId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteAdminUser: (token: string, userId: string) =>
    request<{ deleted: boolean; id: string; removed: { applicationCount: number; assetCount: number; backupCount: number } }>(
      `/api/admin/users/${userId}`,
      token,
      { method: 'DELETE' },
    ),

  updateAdminSettings: (token: string, input: Partial<AdminSettings>) =>
    request<AdminSettings>('/api/admin/settings', token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  resetPassword: (token: string, userId: string) =>
    request<{ sent: boolean; delivery: string; resetUrl?: string }>(
      `/api/admin/users/${userId}/reset-password`,
      token,
      { method: 'POST' },
    ),

  downloadAdminLogs: (token: string, format: 'csv' | 'json') =>
    blobRequest(`/api/admin/logs/export?format=${format}`, token),

  downloadExport: async (
    token: string,
    format: 'json' | 'csv' | 'excel' | 'pdf',
    applicationId?: string,
    language?: string,
  ) => {
    const params = new URLSearchParams({ format })
    if (applicationId) params.set('applicationId', applicationId)
    if (language) params.set('language', language)
    return blobRequest(`/api/exports?${params.toString()}`, token)
  },

  downloadFile: (token: string, fileId: string) =>
    blobRequest(`/api/files/${encodeURIComponent(fileId)}/download`, token),

  changeAdminPassword: (token: string, currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/api/admin/change-password', token, {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  systemInfo: (token: string) =>
    request<SystemInfo>('/api/admin/system-info', token),

  uploadSystemUpdate: async (token: string, file: File) => {
    const requestGeneration = clientSessionGeneration
    const form = new FormData()
    form.set('package', file)
    const response = await fetchWithTimeout('/api/admin/system-update', {
      method: 'POST',
      headers: requestHeaders(token, { body: form }),
      body: form,
    })
    return parseEnvelope<SystemUpdateResult>(response, token, false, requestGeneration)
  },

  deleteSystemUpdate: (token: string, storedAs: string) =>
    request<{ deleted: boolean; storedAs: string }>(
      `/api/admin/system-update/${encodeURIComponent(storedAs)}`,
      token,
      { method: 'DELETE' },
    ),

  myTeamWorkspaces: (token: string) =>
    conditionalRequest<TeamWorkspaceOption[]>('/api/teams/mine/workspaces', token, {}, { freshForMs: DEFAULT_READ_FRESHNESS_MS }),

  myTeam: (token: string, teamId?: string | null) =>
    conditionalRequest<TeamSummary | null>(
      `/api/teams/mine${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`,
      token,
      {},
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),

  listTeamApplications: (token: string, teamId?: string | null) =>
    conditionalRequest<TeamApplicationRecord[]>(
      `/api/teams/mine/applications${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`,
      token,
      {},
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),

  updateTeam: (token: string, teamId: string, input: {
    name?: string
    seatLimit?: number
    roleLabels?: { admin?: string; member?: string }
  }) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  renameTeam: (token: string, teamId: string, name: string) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  updateTeamSeatLimit: (token: string, teamId: string, seatLimit: number) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ seatLimit }),
    }),

  updateTeamRoleLabels: (token: string, teamId: string, roleLabels: { admin?: string; member?: string }) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ roleLabels }),
    }),

  createTeamProfilePreset: (token: string, teamId: string, input: TeamProfilePresetInput) =>
    request<TeamProfilePreset>(`/api/teams/${teamId}/profile-presets`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTeamProfilePreset: (token: string, teamId: string, presetId: string, input: Partial<TeamProfilePresetInput>) =>
    request<TeamProfilePreset>(`/api/teams/${teamId}/profile-presets/${presetId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteTeamProfilePreset: (token: string, teamId: string, presetId: string) =>
    request<{ id: string; deleted: boolean }>(`/api/teams/${teamId}/profile-presets/${presetId}`, token, {
      method: 'DELETE',
    }),

  restoreTeamProfilePresets: (token: string, teamId: string) =>
    request<TeamProfilePreset[]>(`/api/teams/${teamId}/profile-presets/restore`, token, {
      method: 'POST',
    }),

  deleteTeam: (token: string, teamId: string) =>
    request<{ id: string; deleted: boolean; affectedApplications: number }>(
      `/api/teams/${teamId}`,
      token,
      { method: 'DELETE' },
    ),

  listTeamMembers: (token: string, teamId: string) =>
    request<TeamSummary>(`/api/teams/${teamId}/members`, token),

  teamNotificationGroups: (token: string, teamId: string) =>
    request<NotificationGroup[]>(`/api/teams/${teamId}/notification-groups`, token),

  createTeamNotificationGroup: (token: string, teamId: string, name: string, memberIds: string[]) =>
    request<NotificationGroup>(`/api/teams/${teamId}/notification-groups`, token, {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),

  updateTeamNotificationGroup: (
    token: string,
    teamId: string,
    groupId: string,
    input: { name?: string; memberIds?: string[] },
  ) =>
    request<NotificationGroup>(`/api/teams/${teamId}/notification-groups/${groupId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteTeamNotificationGroup: (token: string, teamId: string, groupId: string) =>
    request<{ id: string; deleted: boolean }>(`/api/teams/${teamId}/notification-groups/${groupId}`, token, {
      method: 'DELETE',
    }),

  publishTeamNotification: (token: string, teamId: string, input: NotificationPublishInput) =>
    request<NotificationPublishResult>(`/api/teams/${teamId}/notifications/publish`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  inviteTeamMember: (token: string, teamId: string, email: string, role: Exclude<TeamRole, 'owner'>) =>
    request<TeamMember>(`/api/teams/${teamId}/members`, token, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  updateTeamMemberRole: (token: string, teamId: string, memberId: string, role: Exclude<TeamRole, 'owner'>) =>
    request<TeamMember>(`/api/teams/${teamId}/members/${memberId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  updateTeamMemberAccess: (
    token: string,
    teamId: string,
    memberId: string,
    input: {
      role?: Exclude<TeamRole, 'owner'>
      invitedBy?: string
    },
  ) =>
    request<TeamMember>(`/api/teams/${teamId}/members/${memberId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeTeamMember: (token: string, teamId: string, memberId: string) =>
    request<{ id: string; removed: boolean }>(`/api/teams/${teamId}/members/${memberId}`, token, {
      method: 'DELETE',
    }),

  restoreTeamEvent: (token: string, teamId: string, eventId: string) =>
    request<TeamEventRestoreResult>(
      `/api/teams/${teamId}/events/${eventId}/restore`,
      token,
      { method: 'POST' },
    ),

  previewTeamEventMerge: (token: string, teamId: string, eventId: string) =>
    request<TeamMergePreview>(
      `/api/teams/${teamId}/events/${eventId}/merge-preview`,
      token,
    ),

  applyTeamEventMerge: (token: string, teamId: string, eventId: string, fields?: string[]) =>
    request<TeamMergeResult>(
      `/api/teams/${teamId}/events/${eventId}/apply-merge`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ fields }),
      },
    ),

  flagTeamEventMergeConflict: (token: string, teamId: string, eventId: string) =>
    request<TeamMergeConflictFlagResult>(
      `/api/teams/${teamId}/events/${eventId}/flag-conflict`,
      token,
      { method: 'POST' },
    ),

  getTeamInvite: (inviteToken: string) =>
    request<TeamInvitePreview>(`/api/teams/invites/${encodeURIComponent(inviteToken)}`),

  acceptTeamInvite: (token: string, inviteToken: string) =>
    request<{ membership: TeamMember; team: Team }>(
      `/api/teams/invites/${encodeURIComponent(inviteToken)}/accept`,
      token,
      { method: 'POST' },
    ),

  declineTeamInvite: (inviteToken: string) =>
    request<{ id: string; declined: boolean }>(
      `/api/teams/invites/${encodeURIComponent(inviteToken)}/decline`,
      undefined,
      { method: 'POST' },
    ),

  addReviewComment: (token: string, applicationId: string, body: string, targetTab?: ReviewComment['targetTab'], parentId?: string, mentionedUserIds?: string[]) =>
    request<ReviewComment>(
      `/api/applications/${applicationId}/review-comments`,
      token,
      { method: 'POST', body: JSON.stringify({ body, targetTab, parentId, mentionedUserIds }) },
    ),

  requestApplicationFeedback: (token: string, applicationId: string, note = '') =>
    request<{ requested: boolean; notified: number }>(
      `/api/applications/${applicationId}/request-feedback`,
      token,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),
}
