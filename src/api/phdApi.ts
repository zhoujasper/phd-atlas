import type {
  ApplicationRecord,
  ApplicationStatus,
  BackupFrequency,
  MaterialRecommender,
  MaterialStatus,
  ReviewComment as ApplicationReviewComment,
  SharePermission,
  ShareSection,
} from '../data/applications'
import type { CustomMailCategory, MailCategory, MailClassificationDelta } from '../mailClassification'
import type {
  GenerateInterviewFeedbackRequest,
  GenerateInterviewMockTurnRequest,
  GenerateInterviewQuestionsRequest,
  InterviewFeedback,
  InterviewPrepWorkspace,
  InterviewQuestion,
} from '../interviewPrep'
import {
  apiRequestBlockReason,
  getConnectivityGeneration,
  reportApiReachable,
  reportApiUnavailable,
} from '../connectivity'
import {
  applicationPersistenceAcknowledged,
  persistedSubsetMatches,
} from '../persistenceAcknowledgement'
import { scopesForMutation, type RealtimeScope } from '../../shared/realtimeScopes.js'
import { ApplicationDeltaTooLargeError, buildApplicationDelta } from '../applicationDelta'
import {
  APPLICATION_AUTHORED_PROJECTION_VERSION,
  type AcknowledgedApplicationMutation,
  type ApplicationMutationAcknowledgement,
  type ApplicationMutationAuthorityPolicy,
  applyApplicationMutationAcknowledgement,
  applicationAuthoredContentHash,
  canonicalValueHash,
} from '../applicationMutationAcknowledgement'
import { SharedReadCoordinator, SharedReadInvalidatedError } from './sharedReadCoordinator'
import {
  applyDiscoverEnrichmentAcknowledged,
  createApplicationAcknowledged,
  decideTeamTransferAcknowledged,
  importDiscoverProgramAcknowledged,
  restoreApplicationFromTrashAcknowledged,
  updateApplicationTeamVisibilityAcknowledged,
  updateSchoolLogoAcknowledged,
} from './applicationMutationRoutes'

export type UserRole = 'admin' | 'user'
export type MembershipPlan = 'free' | 'pro' | 'team'

export type AiProvider = 'openai' | 'deepseek' | 'anthropic' | 'gemini'
export type AiKeyScope = 'personal' | 'team'
export type AiKeyRequestMode = 'auto' | 'responses' | 'chat_completions'

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
  maxConcurrency: number
  requestMode?: AiKeyRequestMode
  weight?: number
  enabled?: boolean
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
  maxConcurrency?: number
  requestMode?: AiKeyRequestMode
  weight?: number
  enabled?: boolean
}

export type AiDraftGrants = {
  userProfile: boolean
  dossier: boolean
  checklist: boolean
  scholarships: boolean
  tasks: boolean
  correspondence: boolean
  /**
   * Narrows `userProfile` to these material ids. Omitted or empty means the
   * whole profile, which is what the switch alone has always meant.
   */
  profileAssetIds?: string[]
}

export type AiDraftAttachmentSelection = {
  /** Server-issued id for a readable file from an enabled source. */
  attachmentId: string
  /** AI-proposed, server-sanitized name shown to the email recipient. */
  fileName: string
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
}

export type AiDraftEvent =
  | { type: 'status'; phase: string }
  /** A provider function call produced the complete attachment plan for the editable draft. */
  | { type: 'attachment-selection'; attachments: AiDraftAttachmentSelection[] }
  | { type: 'token'; text: string }
  | { type: 'done'; draftOnly: boolean }
  | { type: 'error'; message: string; code?: string; retryAfterSeconds?: number }

export { PROFILE_PRESET_ICONS } from '../profilePresetIconCatalog'
import type { ProfilePresetIconName } from '../profilePresetIconCatalog'

export type ProfilePresetIcon = ProfilePresetIconName

export const PROFILE_PRESET_COLORS = ['system', 'blue', 'purple', 'green', 'orange', 'pink', 'teal', 'gray'] as const

export type ProfilePresetColor = (typeof PROFILE_PRESET_COLORS)[number]

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

export type ProfileWritingBriefField = {
  id: string
  label: string
  value: string
  /** Explicit opt-in: private planning metadata is excluded from exports by default. */
  includeInExport?: boolean
  /** Export placement is constrained to document structure rather than arbitrary coordinates. */
  placement?: 'beforeBody' | 'afterBody'
}

export type ProfileWritingSection = {
  id: string
  title: string
  content: string
  /** Editor layout preference. Phones always present sections in one readable column. */
  width?: 'full' | 'half'
}

export type ProfileWritingBrief = {
  /** Official portal prompt or programme-specific instructions. Private planning context. */
  requirements?: string
  /** Public source for the official prompt. Never embedded into exports automatically. */
  sourceUrl?: string
  wordLimit?: number
  pageLimit?: number
  customFields?: ProfileWritingBriefField[]
  /** Private, user-authored supporting sections shown beside the main draft. */
  sections?: ProfileWritingSection[]
}

export type ProfileRecommender = {
  id: string
  name: string
  email: string
  phone?: string
  title?: string
  institution?: string
  relationship?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export type ApplicationRecommenderDecision = 'auto' | 'sync' | 'independent'

export type ApplicationRecommenderSlice = {
  id: string
  updatedAt: string
  recommenders: MaterialRecommender[]
}

export type ApplicationRecommenderMutationResult = {
  application: ApplicationRecommenderSlice
  /** Other affected applications the caller may already view; excludes `application`. */
  applications: ApplicationRecommenderSlice[]
  profiles: ProfileRecommender[]
  /** Monotonic server-store revision for the complete recommender directory. */
  directoryRevision: number
  profile: ProfileRecommender
  recommender: MaterialRecommender
  affectedApplicationIds: string[]
  resolution: 'linked' | 'created' | 'synced' | 'merged'
  ownerId: string
}

export type ProfileRecommenderMutationResult = {
  profiles: ProfileRecommender[]
  /** Monotonic server-store revision for the complete recommender directory. */
  directoryRevision: number
  /** Every affected application, projected to recommender-owned fields only. */
  applications: ApplicationRecommenderSlice[]
  affectedApplicationIds: string[]
  ownerId: string
}

export type ProfileRecommenderDirectoryPage = {
  items: ProfileRecommender[]
  total: number
  nextCursor: string | null
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
  /** Account-wide opt-in for batched system-notification emails. */
  emailNotificationsEnabled?: boolean
  /** Account-wide kill switch for browser push delivery; existing browser permission is left unchanged. */
  browserNotificationsEnabled?: boolean
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
  /** Account-scoped application statuses shown after the canonical pipeline. */
  customApplicationStatuses?: ApplicationStatus[]
  /** Account-scoped statuses shared by the material and task checklists. */
  customChecklistStatuses?: string[]
  /** Account-scoped checklist material formats shown after the built-in taxonomy. */
  customChecklistMaterialFormats?: string[]
  /** Account-scoped correspondence categories shown after the built-in taxonomy. */
  customMailCategories?: CustomMailCategory[]
  aiProfile?: AiUserProfile
  /** Personal-workspace presets only. Organization presets live on their team workspace. */
  profilePresets?: ProfilePreset[]
  /** Personal recommender library used for cross-application aggregation and explicit autofill. */
  profileRecommenders?: ProfileRecommender[]
  /** Bootstrap-only pagination metadata for the recommender directory. */
  profileRecommendersTotal?: number
  profileRecommendersNextCursor?: string | null
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
  attemptCount?: number
  nextAttemptAt?: string | null
}

export type MailSyncEnqueueResult = {
  job: MailSyncJob
  alreadyQueued: boolean
}

export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305'

export type DatabaseEngine = 'sqlite' | 'mysql' | 'postgresql' | 'mssql'

export type DatabaseConnectionInput = {
  type: DatabaseEngine
  sqlitePath?: string
  host?: string
  port?: number
  database?: string
  username?: string
  /** Sent only when creating or rotating a connection; never returned by the API. */
  password?: string
  ssl?: boolean
  /** Use the conservative MySQL 5.7.44-compatible connection and SQL path. */
  mysql57Compatibility?: boolean
  schema?: string
}

export type DatabaseConfiguration = Omit<DatabaseConnectionInput, 'password'> & {
  configured: boolean
  passwordSet: boolean
  cachePath: string
}

export type AdminSettings = {
  allowRegistration: boolean
  /** Hide the administrator entry route until this browser is activated. */
  adminEntryHidden?: boolean
  /** True when an activation code verifier is stored; the code itself is never returned. */
  adminEntryCodeSet?: boolean
  /** Patch-only: set or rotate the path activation code. */
  adminEntryCode?: string
  notificationMailbox: string
  /** Null keeps the full system log indefinitely. */
  systemLogRetentionDays?: number | null
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
  /** Monotonic durable revision of this account's settings row. */
  settingsVersion?: number
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

export const SETTINGS_PERSISTENCE_ACK_PROTOCOL = 'phd-atlas-settings-ack-v1' as const

export type SettingsSecretMutationReceipt = {
  operation: 'set' | 'clear'
  present: boolean
  /** The durable users.settings_version produced by this exact mutation. */
  version: number
}

/**
 * Returned only by the durable PATCH /api/settings mutation boundary. The
 * canonical user remains the source of field values; this receipt proves that
 * the responding server understands the current acknowledgement contract and
 * committed every submitted key before replying.
 */
export type SettingsPersistenceAcknowledgement = {
  protocol: typeof SETTINGS_PERSISTENCE_ACK_PROTOCOL
  version: 1
  durable: true
  mutationId: string
  settingsVersion: number
  keys: string[]
  secretReceipts: {
    smtpPass?: SettingsSecretMutationReceipt
    incomingPass?: SettingsSecretMutationReceipt
  }
}

export type SettingsUpdateResponse = PublicUser & {
  settingsAcknowledgement: SettingsPersistenceAcknowledgement
}

/** Negotiated wire response. The API adapter verifies the request nonce before exposing the user. */
type SettingsMutationAcknowledgement = SettingsPersistenceAcknowledgement & {
  user: PublicUser
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

export type InitialSetupClaim = {
  token: string
  expiresAt: string
  expiresInSeconds: number
}

export type InitialAdminSetupInput = {
  name: string
  email: string
  password: string
  adminEntryHidden: boolean
  adminEntryCode?: string
  notificationMailbox: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpTls: boolean
  /** 配置的 SMTP 账号已实际投递一次初始化验证码的凭据。 */
  smtpVerificationToken: string
  language: string
  database: DatabaseConnectionInput
}

export type InitialSetupSmtpVerificationInput = Pick<
  InitialAdminSetupInput,
  'notificationMailbox' | 'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPass' | 'smtpTls' | 'language'
>

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

export type CodexAuthorizationStatus =
  | 'active'
  | 'disabled'
  | 'expired'
  | 'idle_expired'
  | 'revoked'
  | 'invalidated'

export type CodexAuthorizationSummary = {
  id: string
  name: string
  clientName: string
  deviceName: string
  scopeVersion: number
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  /** Set while the owner has paused the authorization; clearing it resumes access. */
  disabledAt: string | null
  status: CodexAuthorizationStatus
  tokenHint: string
}

export type CodexAuthorizationCreateInput = {
  name: string
  scopeVersion: 2
  scopes: string[]
}

export type CodexAuthorizationCreated = {
  authorization: CodexAuthorizationSummary
  /** Returned exactly once. It must never be persisted by the browser. */
  token: string
}

export type CodexDeviceAuthorizationPreview = {
  id: string
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'invalidated'
  clientName: string
  deviceName: string
  scopeVersion: number
  requestedScopes: string[]
  requestedExpiresInDays: number
  /** Expiry of the short-lived approval request, not the resulting authorization. */
  expiresAt: string | null
}

export type CodexDeviceAuthorizationDecision = {
  deviceAuthorization: CodexDeviceAuthorizationPreview
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
  /** Optional programme-specific planning context for authored application documents. */
  writingBrief?: ProfileWritingBrief
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
  writingBrief?: ProfileWritingBrief
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
 * `admin` = teacher/counselor (manages students on their collaboration roster).
 * `member` = student (owns their own application; no visibility into other students).
 */
export type TeamRole = 'owner' | 'admin' | 'member'
export type TeamMemberStatus = 'pending' | 'active' | 'removed'

export type TeamStudentPermissions = {
  editApplications: boolean
  createApplications: boolean
  useDiscover: boolean
  useInterviewPrep?: boolean
  createShareLinks: boolean
  requestTeamTransfers: boolean
  activeApplicationLimit: number | null
  lifetimeApplicationLimit: number | null
  activeShareLimit: number | null
  lifetimeShareLimit: number | null
}

export type TeamTeacherPermissions = {
  inviteStudents: boolean
  manageStudentPermissions: boolean
  useDiscover: boolean
  manageStudentInterviewPrep?: boolean
  createStudentApplications: boolean
  editStudentApplications: boolean
  manageStudentShares: boolean
}

export type TeamPermissionDefaults = {
  student: TeamStudentPermissions
  teacher: TeamTeacherPermissions
}

export type TeamMemberUsage = {
  applicationsCreated: number
  sharesCreated: number
}

export type TeamMemberRelationships = {
  /**
   * User ids of every teacher/institution admin jointly responsible for this
   * student. Missing keeps the legacy `invitedBy` fallback; [] is unassigned.
   */
  teacherIds?: string[]
  /** Internal migration marker: personal settings are sparse overrides of Team defaults. */
  permissionOverridesVersion?: 1
  studentPermissions?: Partial<TeamStudentPermissions>
  teacherPermissions?: Partial<TeamTeacherPermissions>
  usage?: TeamMemberUsage
}

export type TeamMemberContactProfile = {
  /** Student-facing role or appointment title inside this organization. */
  title?: string
  department?: string
  contactEmail?: string
  phone?: string
  office?: string
  website?: string
  /** Short availability or office-hours note. */
  availability?: string
  /** Short description of how this person supports students. */
  bio?: string
}

export type TeamTeacherGroup = {
  id: string
  name: string
  /** Team-member ids; teachers may belong to more than one functional group. */
  memberIds: string[]
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type Team = {
  id: string
  name: string
  ownerId: string
  seatLimit: number
  /** True until the one-time institution-admin credential is claimed. */
  provisioning?: boolean
  /** PNG organization logo stored as a compact data URL; rectangular artwork is preserved. */
  logoDataUrl?: string
  createdAt: string
  updatedAt: string
  /** Optional display names for teacher/student roles (owner stays fixed). */
  roleLabels?: {
    admin?: string
    member?: string
  }
  /** Role defaults inherited by members until a personal setting overrides them. */
  permissionDefaults?: TeamPermissionDefaults
  /** Organization-only templates, already filtered to the current member's role and reporting line. */
  profilePresets?: TeamProfilePreset[]
  /** Functional teacher groups such as writing, external affairs, or interview preparation. */
  teacherGroups?: TeamTeacherGroup[]
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
  /** Organization-scoped contact details shared only through the existing member-visibility boundary. */
  contactProfile?: TeamMemberContactProfile
  createdAt: string
  updatedAt: string
}

export type TeamUsageSummary = {
  storageUsedBytes: number
  storageQuotaBytes: number | null
  applicationCount: number
  activeShareCount: number
  shareQuota: number | null
  shareCreatedCount: number
  /** Team links have no per-member lifetime creation cap. */
  shareCreateQuota: number | null
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

export type TeamTransferPreflightCheck = {
  id: 'permission' | 'applicationQuota' | 'storage'
  ok: boolean
  reasonCode: string | null
  used: number | null
  limit: number | null
  incoming?: number
}

export type TeamTransferPreflight = {
  direction: 'join' | 'leave'
  teamId: string
  teamName: string
  eligible: boolean
  checks: TeamTransferPreflightCheck[]
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
  assignedTeacherId?: string | null
  preflight: TeamTransferPreflight
}

export type TeamMemberStats = {
  memberId: string
  userId: string | null
  applicationCount: number
  riskCount: number
  watchCount: number
  dueSoonCount: number
  activeShareCount: number
  /** Active links created by this student; used by per-student share limits. */
  studentActiveShareCount?: number
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

export type TeamJoinCode = {
  id: string
  teamId: string
  teamName: string
  role: TeamRole
  code: string
  url: string
  teacherIds: string[]
  managerNames: string[]
  expiresAt: string
  maxUses: number | null
  useCount: number
  reusable: boolean
  createdAt: string
  updatedAt: string
}

export type TeamJoinCodePreview = {
  teamId: string
  teamName: string
  role: TeamRole
  expiresAt: string
  reusable: boolean
  managerNames: string[]
}

export type AdminTeamRecord = {
  team: Team
  owner: PublicUser | null
  memberCount: number
  teacherCount: number
  studentCount: number
}

export type ReviewComment = ApplicationReviewComment

export type SystemEvent = {
  id: string
  time: string
  scope: string
  actorId: string | null
  message: string
  metadata: Record<string, unknown>
}

export type SystemLogQuery = {
  page?: number
  pageSize?: number
  search?: string
  scope?: string
  actor?: 'all' | 'admin' | 'system'
  sortField?: 'time' | 'scope' | 'message' | 'actorId'
  direction?: 'asc' | 'desc'
}

export type SystemLogPage = {
  items: SystemEvent[]
  total: number
  retainedTotal: number
  page: number
  pageSize: number
  scopes: string[]
}

export type BootstrapSecrets = {
  autoGenerated: boolean
  jwtSecretPreview: string
  encryptionKeyPreview: string
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
  accepted?: boolean
  background?: boolean
  jobId?: string
  fileName: string
  size: number
  storedAs: string
  version: string
  verified: boolean
  restartScheduled: boolean
  source?: {
    id: string
    kind: 'official' | 'mirror' | 'manual'
    host: string | null
  } | null
  message: string
}

export type SystemUpdateStatus = {
  phase:
    | 'idle'
    | 'resolving'
    | 'probing'
    | 'downloading'
    | 'verifying'
    | 'preparing'
    | 'installing'
    | 'restarting'
    | 'stored'
    | 'ready'
    | 'timeout'
    | 'error'
  jobId?: string | null
  source: string | null
  bytes: number
  total: number
  targetVersion: string | null
  errorCode: string | null
  errorMessage?: string | null
  requestedAt?: string | null
  updatedAt: string
  currentVersion: string
  operationInFlight: boolean
  restartPending: boolean
}

export type SystemUpdateLogEntry = {
  at: string
  jobId: string | null
  level: 'debug' | 'info' | 'warning' | 'error'
  phase: string | null
  message: string
  errorCode: string | null
  detail: string | null
}

export type SystemUpdateLogs = {
  entries: SystemUpdateLogEntry[]
  fileName: string
}

export type ReleaseUpdateInfo = {
  version: string
  tagName: string
  name: string
  publishedAt: string
  htmlUrl: string
  prerelease: boolean
  package: {
    name: string
    size: number
    kind?: 'full' | 'delta'
    fromVersion?: string | null
    fullSize?: number
  }
}

export type ReleaseUpdateCheck = {
  currentVersion: string
  updateAvailable: boolean
  release: ReleaseUpdateInfo | null
  checkedAt: string
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

export type AdminBackupRestoreResult = {
  restored: true
  fileName: string
  format?: 'sqlite-uploads-v1'
}

export type ApplicationTrashItem = {
  id: string
  deletedAt: string
  expiresAt: string | null
  application: ApplicationRecord
}

export type ApplicationTrashScope =
  | { kind: 'personal' }
  | { kind: 'team'; teamId: string | null }

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

const WORKSPACE_SECTION_STREAM_PROTOCOL = 'phd-atlas-workspace-sections-v1'
const WORKSPACE_SECTION_STREAM_MAX_RESTARTS = 3
/**
 * A revision-changed restart used to fire again immediately, so one save still
 * in flight could collide with every remaining attempt inside a few
 * milliseconds and surface "the workspace kept changing" to someone editing
 * alone. Each retry now waits for that write to land first, and gets a couple
 * more tries than the capacity path, whose budget stays at 3 so an overloaded
 * server is not hammered. Total added wait stays under ~2s.
 */
const WORKSPACE_SECTION_REVISION_MAX_RESTARTS = 5
const WORKSPACE_SECTION_REVISION_RETRY_MS = [120, 280, 620, 1_000] as const
const WORKSPACE_SECTION_STREAM_MAX_ATTEMPTS = Math.max(
  WORKSPACE_SECTION_STREAM_MAX_RESTARTS,
  WORKSPACE_SECTION_REVISION_MAX_RESTARTS,
)
const WORKSPACE_SECTION_STREAM_RETRY_BASE_MS = 500
const WORKSPACE_SECTION_STREAM_RETRY_MAX_MS = 15_000
const WORKSPACE_SECTION_STREAM_RETRY_JITTER_RATIO = 0.25
const WORKSPACE_SECTION_STREAM_MAX_LINE_CHARACTERS = 512 * 1024
const WORKSPACE_SECTION_STREAM_MAX_BUFFER_CHARACTERS = 1024 * 1024
const WORKSPACE_SECTION_STREAM_IDLE_TIMEOUT_MS = 30_000
const WORKSPACE_BOOTSTRAP_SECTION_NAMES = [
  'me',
  'applications',
  'profileAssets',
  'backups',
  'applicationTrash',
  'teamWorkspaces',
  'activeTeamId',
  'teamSummary',
  'teamApplications',
  'aiKeys',
] as const satisfies readonly (keyof WorkspaceBootstrapPayload)[]

const WORKSPACE_SECTION_STREAM_NAMES = [
  ...WORKSPACE_BOOTSTRAP_SECTION_NAMES,
  'teamMemberProfileAssets',
  'interviewWorkspace',
] as const

type WorkspaceBootstrapSectionName = (typeof WORKSPACE_SECTION_STREAM_NAMES)[number]
type WorkspaceSectionPayload = WorkspaceBootstrapPayload & {
  teamMemberProfileAssets: ProfileAsset[]
  interviewWorkspace: InterviewPrepWorkspace
}
type WorkspaceBootstrapSections = Partial<WorkspaceSectionPayload>

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
  | 'discover_research_complete'
  | 'discover_research_failed'

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
    labUrl?: string
    projectUrl?: string
  }
  program: string
  status: ApplicationStatus
  deadline: string
  progress?: number
  priority?: number
  tags?: string[]
  nextReminder?: string
  result?: string
  /** Application-level recommender snapshots visible with the Overview share section. */
  recommenders?: ApplicationRecord['recommenders']
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
    uploadReserved?: boolean
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
    status?: string
    details?: string
    attachmentRequired?: boolean
    allowedFileTypes?: string[]
    fileId?: string
    fileName?: string
    fileSize?: number
    uploadReserved?: boolean
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

export type SchoolLogoResolveInput = {
  website?: string
  imageUrl?: string
  auto?: true
  refresh?: boolean
}

export type SchoolLogoResolveResult = {
  found: boolean
  dataUrl?: string
  sourceUrl?: string
  candidateKind?: string
  cacheKey?: string
  websiteUrl?: string
  cacheHit?: boolean
  catalogHit?: boolean
  catalogId?: string
  reason?: 'invalid-url' | 'unavailable' | 'unreachable' | 'not-found'
}

export type SchoolLogoPatchInput = {
  logo: ApplicationRecord['school']['logo'] | null
  autoDetect: boolean
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

export type CommunicationCategoryPatchInput = {
  communicationIds: string[]
  /** One or more categories, built-in or `custom:`. Empty clears the selection. */
  categories: string[]
  /** Primary built-in category, for readers of the earlier single-valued shape. */
  category: MailCategory | null
}

export type CommunicationClassificationInput = {
  communicationIds: string[]
  keyId: string
  force?: boolean
}

export type CommunicationClassificationBatchResult = {
  communications: MailClassificationDelta[]
  revision?: number | string | null
  updatedIds?: string[]
  classifiedIds?: string[]
  reusedIds?: string[]
}

export type InterviewPrepScopeInput = {
  subjectUserId: string
  teamId?: string | null
}

export type InterviewPrepAiInput = InterviewPrepScopeInput & {
  keyId: string
}

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
  bodyFormat?: 'plain' | 'markdown' | 'html'
  date: string
  time?: string
  sendAt?: string
  idempotencyKey?: string
  sourceDraftId?: string
  channel?: string
  direction?: 'incoming' | 'outgoing' | 'note'
  messageType?: string
  from?: string
  to?: string
  trackRecipient?: boolean
  attachments?: CommunicationAttachmentInput[]
}

export type CommunicationSendResult = {
  communication: ApplicationRecord['communications'][number]
  delivery: {
    sent: boolean
    delivery: 'smtp' | 'queued' | 'log-only' | 'ambiguous'
    errorCode?: string
    messageId?: string
    pendingFinalize?: boolean
    outcomeUnknown?: boolean
    requiresReconciliation?: boolean
  }
  correspondenceEmails?: string[]
}

export function communicationDeliveryPresentation(
  delivery: CommunicationSendResult['delivery'],
) {
  const outcomeUnknown = delivery.delivery === 'ambiguous'
    || delivery.outcomeUnknown === true
    || delivery.requiresReconciliation === true
  if (outcomeUnknown) {
    return {
      toastKey: 'toast.commOutcomeUnknown' as const,
      tone: 'warning' as const,
      composerSettled: false,
    }
  }
  return delivery.sent
    ? {
        toastKey: 'toast.commSent' as const,
        tone: 'success' as const,
        composerSettled: true,
      }
    : {
        toastKey: 'toast.commQueued' as const,
        tone: 'info' as const,
        composerSettled: true,
      }
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

export type ApiReadOptions = {
  signal?: AbortSignal
  idempotencyKey?: string
}

export type AdmissionSourceStatus = 'ok' | 'empty' | 'disabled' | 'not-configured' | 'error'

export type AdmissionSourceError = {
  kind?: string
  message?: string
}

export type AdmissionSourceReport = {
  id: string
  name: string
  status: AdmissionSourceStatus
  /** Rows the source returned, before relevance checking. */
  recordCount: number
  /** Rows that survived relevance checking. Absent for sources that skip it. */
  verifiedCount?: number
  warnings?: string[]
  error?: AdmissionSourceError
}

/**
 * Why a record was, or was not, attributed to the queried person or programme.
 * Present on every record the verification layer inspected.
 */
export type AdmissionMatch = {
  verified: boolean
  confidence: number
  nameMatch?: 'exact' | 'strong' | 'initial' | 'none'
  institutionMatch?: boolean | null
  matchedName?: string | null
  schoolMatch?: boolean | null
  programOverlap?: number | null
  reasons: string[]
}

export type AdmissionOutcomeValue = {
  school: string
  program: string
  decision: string
  date: string
  detailUrl?: string
  rawText?: string
}

export type AdmissionOutcomeRecord = {
  kind?: string
  value: AdmissionOutcomeValue
  sourceId: string
  /** The readable page this row lives on. */
  sourceUrl: string
  /** The API endpoint it was parsed from, when that differs from the page. */
  apiUrl?: string
  fetchedAt: string
  confidence?: number
  match?: AdmissionMatch
}

export type AdmissionDiscussionValue = {
  id?: string
  title: string
  selfText?: string
  url?: string
  permalink?: string
  createdAt?: string
  score?: number | null
  numComments?: number | null
  subreddit?: string
  transport?: 'oauth-password' | 'oauth-client-credentials' | 'official-atom-feed'
}

export type AdmissionDiscussionRecord = {
  kind?: string
  value: AdmissionDiscussionValue
  sourceId?: string
  sourceUrl: string
  fetchedAt: string
  confidence?: number
}

export type AdmissionOutcomeSummary = {
  total: number
  accepted: number
  rejected: number
  waitlisted: number
  interview: number
  pending: number
  unclassified: number
  latestDecisionAt: string | null
  acceptedShare: number | null
}

export type AdmissionCycleSummary = AdmissionOutcomeSummary & {
  /** Four-digit decision year, or "unknown" when the source row has no usable date. */
  cycle: string
}

export type AdmissionOutcomesInput = {
  school: string
  program: string
  officialUrl?: string
  year?: number | null
}

export type AdmissionOfficialFact = {
  kind: 'official-admission-fact'
  value: {
    factType: 'acceptance-rate' | 'applications' | 'offers-or-admits' | 'enrolled-or-cohort'
    label: string
    value: number
    unit: 'percent' | 'people'
    year: number | null
    statement: string
    pageTitle: string
  }
  sourceId: 'official-program-history'
  sourceUrl: string
  fetchedAt: string
  confidence?: number
  match?: AdmissionMatch
}

export type AdmissionOfficialPage = {
  title: string
  url: string
  types: string[]
  fetchedAt: string
}

export type AdmissionOutcomesResponse = {
  query: AdmissionOutcomesInput & { year: number | null }
  summary: AdmissionOutcomeSummary
  /** Verified applicant-reported results grouped by decision year. */
  cycles?: AdmissionCycleSummary[]
  /** Rows verified as this school and programme. Only these are counted. */
  outcomes: AdmissionOutcomeRecord[]
  /** Rows the source returned that name a different school or field. */
  unmatchedOutcomes?: AdmissionOutcomeRecord[]
  /** Explicit numeric claims parsed from university-owned pages, with sentence-level provenance. */
  officialFacts?: AdmissionOfficialFact[]
  /** Official programme/admissions pages checked even when they publish no usable numeric claim. */
  officialPages?: AdmissionOfficialPage[]
  discussions: AdmissionDiscussionRecord[]
  /** Reddit rows returned by search but not visibly attributable to this target. */
  unmatchedDiscussions?: AdmissionDiscussionRecord[]
  sources: AdmissionSourceReport[]
  fetchedAt: string
}

export type AdvisorSignalsInput = {
  name: string
  institution?: string
}

export type AdvisorFunding = {
  awardCount: number
  projectCount: number
  hasPublicAward: boolean
  /** Records that share a surname and initial but could not be confirmed. */
  possibleAwardCount?: number
  possibleProjectCount?: number
}

export type AdvisorRecord = {
  kind?: string
  value: Record<string, unknown>
  sourceId: string
  /** The readable page this record lives on (award page, project page). */
  sourceUrl: string
  /** The API endpoint it was parsed from, when that differs from the page. */
  apiUrl?: string
  fetchedAt: string
  confidence?: number
  match?: AdmissionMatch
}

export type AdvisorSignalsResponse = {
  query: AdvisorSignalsInput & { institution: string }
  funding: AdvisorFunding
  /** Records verified as this advisor's. Only these speak for them. */
  awards: AdvisorRecord[]
  projects: AdvisorRecord[]
  works: AdvisorRecord[]
  /** Near misses, usually a different person sharing a surname and initial. */
  possibleAwards?: AdvisorRecord[]
  possibleProjects?: AdvisorRecord[]
  possibleWorks?: AdvisorRecord[]
  sources: AdmissionSourceReport[]
  fetchedAt: string
}

export type AdmissionExploreLink = {
  kind: 'primary' | 'search' | 'raw'
  id: string
  label: string
  url: string
}

/**
 * The model's reading of the records it was shown. Every index points into the
 * verified lists on the same report; the server drops any that do not.
 */
export type AdmissionInsights = {
  fundingOutlook: string
  fundingConfidence: 'strong' | 'moderate' | 'weak' | 'unknown'
  profileFit: string
  relevantAwardIndexes: number[]
  relevantProjectIndexes: number[]
  relevantWorkIndexes: number[]
  mismatchedIndexes: Array<{ kind: string; index: number; reason: string }>
  outcomeReading: string
  talkingPoints: string[]
  openQuestions: string[]
}

/** One saved lookup for one application. */
export type AdmissionSignalReport = {
  version: number
  /** What was actually searched for, taken from the stored application. */
  target: { school: string; program: string; advisorName: string }
  outcomes: AdmissionOutcomesResponse | null
  advisor: AdvisorSignalsResponse
  links: { advisor: AdmissionExploreLink[]; program: AdmissionExploreLink[] }
  insights: AdmissionInsights | null
  insightsError: string | null
  fetchedAt: string
  savedAt?: string
}

/** A saved lookup observation. This is freshness history, never an admissions cycle. */
export type AdmissionSignalObservation = {
  observedAt: string
  accepted: number
  total: number
  acceptedShare: number | null
  hasPublicAward: boolean
  awardCount: number
}

export type AdmissionBookmark = {
  id: string
  applicationId: string
  type: 'outcome' | 'funding' | 'discussion'
  title: string
  data: Record<string, unknown>
  note?: string | null
  createdAt: string
  updatedAt: string
}

let sessionTokenHandler: SessionTokenHandler | null = null
let unauthorizedHandler: UnauthorizedHandler | null = null
const latestSessionTokenBySource = new Map<string, string>()
const sessionCachePartitionByToken = new Map<string, string>()
type ConditionalCacheEntry = {
  etag?: string
  data: unknown
  storedAt: number
  /**
   * A realtime echo said this record may have moved on. The cached body can no
   * longer be served, but its validator is still a true statement about what
   * this client last saw — so the next read revalidates with it rather than
   * pulling the whole record down again only to learn nothing changed.
   */
  mustRevalidate?: boolean
}

export type RealtimeInvalidationScope = RealtimeScope

export type RealtimeInvalidationEvent = {
  type: 'connected' | 'invalidate'
  scopes: RealtimeInvalidationScope[]
  revision: number
  at: string
}

const conditionalResponseCache = new Map<string, ConditionalCacheEntry>()
const sharedReadCoordinator = new SharedReadCoordinator()
const readCacheRevisionByPartition = new Map<string, number>()
type PendingMutationInvalidation = {
  scopes: Set<RealtimeInvalidationScope>
  token: string
}
const pendingMutationInvalidations = new Map<string, PendingMutationInvalidation>()
let mutationInvalidationFlushQueued = false
const MAX_CONDITIONAL_READ_CACHE_ENTRIES = 64
/** Bumped on every login/logout/identity handoff so late 401s from a previous
 *  same-account session never call the unauthorized handler or share in-flight
 *  conditional GETs with the fresh session (re-login "session expired" loop). */
let clientSessionGeneration = 0
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const AUTH_CAPACITY_RETRY_BUDGET_MS = 75_000
const AUTH_CAPACITY_RETRY_BASE_MS = 500
const AUTH_CAPACITY_RETRY_MAX_MS = 8_000
const UPLOAD_REQUEST_TIMEOUT_MS = 120_000
const SYSTEM_UPDATE_REQUEST_TIMEOUT_MS = 30 * 60_000
const DOWNLOAD_REQUEST_TIMEOUT_MS = 120_000
const OFF_MAIN_JSON_THRESHOLD = 256 * 1024
const JSON_PARSE_WORKER_TIMEOUT_MS = 10_000
const DEFAULT_READ_FRESHNESS_MS = 3_000
const APPLICATION_NAVIGATION_RETRY_DELAYS_MS = [160, 600, 1_400] as const
const APPLICATION_NAVIGATION_MAX_RETRY_AFTER_MS = 1_800
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
type ActiveAuthenticatedRequest = {
  controller: AbortController
  generation: number
}
const activeAuthenticatedRequests = new Set<ActiveAuthenticatedRequest>()

type JsonParseWorkerResponse = {
  id: number
  value?: unknown
  error?: string
}

function resetClientSessionState() {
  clientSessionGeneration += 1
  const reason = sessionSupersededError()
  for (const request of activeAuthenticatedRequests) {
    if (request.generation !== clientSessionGeneration) request.controller.abort(reason)
  }
  activeAuthenticatedRequests.clear()
  latestSessionTokenBySource.clear()
  sessionCachePartitionByToken.clear()
  conditionalResponseCache.clear()
  sharedReadCoordinator.clear(reason)
  readCacheRevisionByPartition.clear()
  pendingMutationInvalidations.clear()
  mutationInvalidationFlushQueued = false
}

/** Clear in-memory session token chains and conditional GET caches (login / identity switch). */
export function clearClientSessionCaches() {
  resetClientSessionState()
}

/** Current client session generation — changes on every login/logout/cache scrub. */
export function getClientSessionGeneration() {
  return clientSessionGeneration
}

function readSessionTokenClaims(token?: string | null): Record<string, unknown> | null {
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
      const bufferCtor = (
        globalThis as {
          Buffer?: {
            from: (data: string, encoding: string) => { toString: (encoding: string) => string }
          }
        }
      ).Buffer
      if (!bufferCtor) return null
      json = bufferCtor.from(padded, 'base64').toString('utf8')
    }
    const claims = JSON.parse(json) as unknown
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Read the JWT `sub` claim without verifying the signature. Used only as a
 * client-side guard so a refreshed token for user B can never be chained onto
 * user A's source token (account mix-up / 串号).
 */
export function readSessionTokenSubject(token?: string | null): string | null {
  const subject = readSessionTokenClaims(token)?.sub
  return typeof subject === 'string' && subject ? subject : null
}

/**
 * Returns true only when an otherwise parseable JWT explicitly says it has
 * expired. This is a cold-start noise guard, not authentication: unparseable
 * tokens and non-expired JWTs still go to the server for authoritative checks.
 */
export function sessionTokenIsDefinitelyExpired(token?: string | null, now = Date.now()): boolean {
  const expiresAt = readSessionTokenClaims(token)?.exp
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt * 1_000 <= now
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
  sharedReadCoordinator.invalidatePrefix(prefix)
}

const REALTIME_SCOPE_READ_PREFIXES: Readonly<Record<RealtimeInvalidationScope, readonly string[]>> = {
  applications: ['/api/applications', '/api/teams/mine/applications'],
  'profile-assets': ['/api/profile-assets'],
  backups: ['/api/backups', '/api/admin/backups'],
  teams: ['/api/teams'],
  notifications: ['/api/notifications'],
  session: ['/api/auth/me'],
  'ai-keys': ['/api/ai/keys'],
  discover: ['/api/discover'],
  interview: ['/api/interview-prep'],
  admission: [
    '/api/admission-bookmarks',
    '/api/admission-notifications',
    '/api/admission-signals',
  ],
}

const WORKSPACE_BOOTSTRAP_SCOPES = new Set<RealtimeInvalidationScope>([
  'applications',
  'profile-assets',
  'backups',
  'teams',
  'session',
  'ai-keys',
])

function realtimeReadPathPrefixes(scopes: ReadonlySet<RealtimeInvalidationScope>) {
  const prefixes = new Set<string>()
  for (const scope of scopes) {
    for (const prefix of REALTIME_SCOPE_READ_PREFIXES[scope]) prefixes.add(prefix)
    if (WORKSPACE_BOOTSTRAP_SCOPES.has(scope)) prefixes.add('/api/workspace/bootstrap')
  }
  return prefixes
}

function pathMatchesReadPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
}

function conditionalPathFromCacheKey(key: string) {
  const separator = key.indexOf(' ')
  return separator < 0 ? '' : key.slice(separator + 1)
}

function sharedPathFromCacheKey(key: string) {
  const revisionSeparator = key.indexOf(' ')
  if (revisionSeparator < 0) return ''
  const kindSeparator = key.indexOf(' ', revisionSeparator + 1)
  if (kindSeparator < 0) return ''
  const pathEnd = key.indexOf(' ', kindSeparator + 1)
  return pathEnd < 0 ? key.slice(kindSeparator + 1) : key.slice(kindSeparator + 1, pathEnd)
}

/**
 * Invalidate only reads represented by a realtime scope batch. Unlike a local
 * mutation, an SSE event already describes the affected datasets, so unrelated
 * downloads and GETs should be allowed to finish instead of being aborted and
 * automatically restarted alongside every collaborative edit.
 */
export function invalidateClientReadCacheForScopes(
  token: string | undefined,
  scopes: ReadonlySet<RealtimeInvalidationScope>,
) {
  if (scopes.size === 0) return
  const prefixes = realtimeReadPathPrefixes(scopes)
  if (prefixes.size === 0) return
  const prefixList = [...prefixes]
  const partitionPrefix = `g${clientSessionGeneration}:${readCachePartition(token)}:`
  const matchesPath = (path: string) => (
    path !== '' && (
      prefixList.some((prefix) => pathMatchesReadPrefix(path, prefix))
      || scopes.has('admission')
        && /^\/api\/applications\/[^/?]+\/admission-signals(?:[/?]|$)/i.test(path)
    )
  )

  // Keep the validator, drop the trust in the body. Deleting the entry outright
  // made every realtime echo cost a full re-download to discover the record had
  // not actually changed.
  for (const [key, entry] of conditionalResponseCache) {
    if (!key.startsWith(partitionPrefix)) continue
    if (!matchesPath(conditionalPathFromCacheKey(key))) continue
    if (entry.etag) conditionalResponseCache.set(key, { ...entry, mustRevalidate: true })
    else conditionalResponseCache.delete(key)
  }
  sharedReadCoordinator.invalidateMatching((key) => (
    key.startsWith(partitionPrefix) && matchesPath(sharedPathFromCacheKey(key))
  ))
}

function scheduleMutationReadInvalidation(method: string, path: string, token?: string) {
  if (!token) return
  const scopes = scopesForMutation(method, path)
  if (scopes.length === 0) return
  const generation = clientSessionGeneration
  const partition = readCachePartition(token)
  const key = `g${generation}:${partition}`
  const pending = pendingMutationInvalidations.get(key)
  if (pending) {
    for (const scope of scopes) pending.scopes.add(scope)
  } else {
    pendingMutationInvalidations.set(key, { scopes: new Set(scopes), token })
  }
  if (mutationInvalidationFlushQueued) return
  mutationInvalidationFlushQueued = true
  queueMicrotask(() => {
    mutationInvalidationFlushQueued = false
    const pending = [...pendingMutationInvalidations.entries()]
    pendingMutationInvalidations.clear()
    for (const [key, invalidation] of pending) {
      if (!key.startsWith(`g${clientSessionGeneration}:`)) continue
      invalidateClientReadCacheForScopes(invalidation.token, invalidation.scopes)
    }
  })
}

function readConditionalResponse(key: string) {
  const entry = conditionalResponseCache.get(key)
  if (!entry) return undefined
  conditionalResponseCache.delete(key)
  conditionalResponseCache.set(key, entry)
  return entry
}

function rememberConditionalResponse(key: string, entry: ConditionalCacheEntry) {
  conditionalResponseCache.delete(key)
  conditionalResponseCache.set(key, entry)
  while (conditionalResponseCache.size > MAX_CONDITIONAL_READ_CACHE_ENTRIES) {
    const oldestKey = conditionalResponseCache.keys().next().value
    if (oldestKey === undefined) break
    conditionalResponseCache.delete(oldestKey)
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

export function getClientInstanceId() {
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
  clientInstanceId =
    globalThis.crypto?.randomUUID?.() ?? `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  try {
    globalThis.sessionStorage?.setItem(key, clientInstanceId)
  } catch {
    // Keep the memory-only identifier.
  }
  return clientInstanceId
}

function createSettingsMutationId() {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  return `settings-${randomPart}`
}

function settingsAcknowledgementFailure(): ApiError {
  return new ApiError(
    'The server did not provide a verifiable durable settings acknowledgement. The editor remains available so you can retry.',
    'SETTINGS_PERSISTENCE_NOT_ACKNOWLEDGED',
    409,
  )
}

async function updateSettingsRequest(
  token: string,
  input: UserSettingsPatch,
): Promise<SettingsUpdateResponse> {
  const mutationId = createSettingsMutationId()
  const acknowledgement = await request<SettingsMutationAcknowledgement>('/api/settings', token, {
    method: 'PATCH',
    body: JSON.stringify(input),
    headers: {
      'X-PhD-Settings-Acknowledgement': 'v1',
      'X-PhD-Settings-Mutation-Id': mutationId,
    },
  })
  if (
    !acknowledgement
    || acknowledgement.protocol !== SETTINGS_PERSISTENCE_ACK_PROTOCOL
    || acknowledgement.version !== 1
    || acknowledgement.durable !== true
    || acknowledgement.mutationId !== mutationId
    || !Number.isSafeInteger(acknowledgement.settingsVersion)
    || acknowledgement.settingsVersion < 1
    || !acknowledgement.user
    || typeof acknowledgement.user !== 'object'
  ) throw settingsAcknowledgementFailure()

  const { user, ...settingsAcknowledgement } = acknowledgement
  return {
    ...user,
    settingsAcknowledgement,
  }
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
  requestId?: string
  retryAfterMs?: number
  retryExhausted?: boolean
  status: number

  constructor(message: string, code: string, status: number, field?: string, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.field = field
    this.requestId = requestId
  }
}

type ApplicationAcknowledgementExpectation = {
  baseUpdatedAt: string | null
  operationCount: number
  mutationHash: string
  authorityPurpose?: ApplicationMutationAuthorityPolicy
}

function applicationAcknowledgementFailure(): ApiError {
  return new ApiError(
    'The server did not durably acknowledge the application update. The editor remains available so you can retry.',
    'REQUEST_FAILED',
    409,
  )
}

async function verifyApplicationAcknowledgement(
  acknowledgement: ApplicationMutationAcknowledgement,
  submitted: ApplicationRecord | Record<string, unknown>,
  expected: ApplicationAcknowledgementExpectation,
  acceptsCanonical?: (canonical: ApplicationRecord) => boolean,
) {
  try {
    const canonical = await applyApplicationMutationAcknowledgement(acknowledgement, submitted, expected)
    if (acceptsCanonical && !acceptsCanonical(canonical)) throw new Error('ACK_MISMATCH')
    return canonical
  } catch {
    throw applicationAcknowledgementFailure()
  }
}

/**
 * Delta rejections that describe the shape of the patch, not the intent behind
 * it. A base copy that has drifted from the saved record produces a pointer the
 * server cannot resolve, an index out of range, or a reorder referencing an id
 * that is no longer there — none of which the person editing can act on, and
 * none of which a retry of the same delta would ever clear. Every one of them
 * is answered by sending the whole application instead.
 */
const DELTA_SHAPE_REJECTION_CODES = new Set([
  'APPLICATION_DELTA_INVALID',
  'APPLICATION_DELTA_TOO_LARGE',
  'APPLICATION_DELTA_CANONICAL_MISMATCH',
])

function isDeltaShapeRejection(error: unknown) {
  return error instanceof ApiError && DELTA_SHAPE_REJECTION_CODES.has(error.code)
}

async function updateApplicationRequest(
  token: string,
  application: ApplicationRecord,
  baseApplication?: ApplicationRecord | null,
): Promise<AcknowledgedApplicationMutation> {
  // The full-application write. It has no preconditions on the client's base
  // copy, so it is both the first-save path and the recovery path for every
  // delta that cannot be applied. Its acknowledgement still proves that every
  // submitted field was persisted, so falling back here loses no guarantee.
  const sendWholeApplication = async (): Promise<AcknowledgedApplicationMutation> => {
    const baselineHash = await applicationAuthoredContentHash(application)
    const acknowledgement = await request<ApplicationMutationAcknowledgement>(`/api/applications/${application.id}`, token, {
      method: 'PUT',
      body: JSON.stringify(application),
      headers: {
        'X-PhD-Application-Acknowledgement': 'v2',
        'X-PhD-Application-Projection-Version': String(APPLICATION_AUTHORED_PROJECTION_VERSION),
        'X-PhD-Application-Baseline-Hash': baselineHash,
      },
    })
    const canonical = await verifyApplicationAcknowledgement(acknowledgement, application, {
      baseUpdatedAt: application.updatedAt ?? null,
      operationCount: 0,
      mutationHash: baselineHash,
    }, (saved) => applicationPersistenceAcknowledged(application, saved, null))
    return {
      unchanged: false,
      application: canonical,
      acknowledgement,
    }
  }

  if (!baseApplication) return sendWholeApplication()

  let delta
  try {
    delta = buildApplicationDelta(baseApplication, application)
  } catch (error) {
    // Too many changes to express as a patch, or a base that cannot anchor one.
    // Neither is a reason to refuse the save.
    if (error instanceof ApplicationDeltaTooLargeError) return sendWholeApplication()
    return sendWholeApplication()
  }
  if (delta.operations.length === 0) {
    return {
      unchanged: true,
      application: baseApplication,
      acknowledgement: null,
    }
  }
  const [baselineHash, mutationHash] = await Promise.all([
    applicationAuthoredContentHash(application),
    canonicalValueHash(delta.operations),
  ])
  let acknowledgement: ApplicationMutationAcknowledgement
  try {
    acknowledgement = await request<ApplicationMutationAcknowledgement>(`/api/applications/${application.id}/delta`, token, {
      method: 'PATCH',
      body: JSON.stringify(delta),
      headers: {
        'X-PhD-Application-Acknowledgement': 'v2',
        'X-PhD-Application-Projection-Version': String(APPLICATION_AUTHORED_PROJECTION_VERSION),
        'X-PhD-Application-Baseline-Hash': baselineHash,
      },
    })
  } catch (error) {
    if (isDeltaShapeRejection(error)) return sendWholeApplication()
    throw error
  }
  const canonical = await verifyApplicationAcknowledgement(acknowledgement, application, {
    baseUpdatedAt: baseApplication.updatedAt ?? null,
    operationCount: delta.operations.length,
    mutationHash,
  }, (saved) => applicationPersistenceAcknowledged(application, saved, baseApplication))
  return {
    unchanged: false,
    application: canonical,
    acknowledgement,
  }
}

function acknowledgeProfileAssetWrite(
  input: Partial<ProfileAssetInput>,
  saved: ProfileAsset,
): ProfileAsset {
  if (persistedSubsetMatches(input, saved)) return saved
  throw new ApiError(
    'The server response did not contain every saved profile field. Keep the editor open and retry after updating the server.',
    'REQUEST_FAILED',
    409,
  )
}

function authoredRecommenderFields(recommender: MaterialRecommender) {
  return {
    id: recommender.id,
    name: recommender.name,
    email: recommender.email ?? '',
    phone: recommender.phone ?? '',
    contact: recommender.contact,
    notes: recommender.notes ?? '',
    deadline: recommender.deadline ?? '',
    deadlineTime: recommender.deadlineTime ?? '',
    reminderDate: recommender.reminderDate ?? '',
    reminderTime: recommender.reminderTime ?? '',
  }
}

function authoredRecommenderProfileFields(recommender: MaterialRecommender) {
  const legacyContact = recommender.contact.trim()
  const legacyContactIsEmail = legacyContact.includes('@')
  return {
    name: recommender.name,
    email: recommender.email ?? (legacyContactIsEmail ? legacyContact : ''),
    phone: recommender.phone ?? (legacyContact && !legacyContactIsEmail ? legacyContact : ''),
  }
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isApplicationRecommenderSlice(value: unknown): value is ApplicationRecommenderSlice {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ApplicationRecommenderSlice>
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && isCanonicalIsoTimestamp(candidate.updatedAt)
    && Array.isArray(candidate.recommenders)
    && candidate.recommenders.length <= 12
    && candidate.recommenders.every((recommender) => (
      Boolean(recommender)
      && typeof recommender.id === 'string'
      && recommender.id.length > 0
      && typeof recommender.name === 'string'
      && typeof recommender.contact === 'string'
    ))
}

function compactSlicesAcknowledgeAffectedIds(
  slices: readonly ApplicationRecommenderSlice[],
  affectedApplicationIds: readonly string[],
) {
  if (!Array.isArray(slices) || !Array.isArray(affectedApplicationIds)) return false
  if (!slices.every(isApplicationRecommenderSlice)) return false
  const sliceIds = slices.map((slice) => slice.id)
  const affectedIds = affectedApplicationIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (affectedIds.length !== affectedApplicationIds.length) return false
  if (sliceIds.length !== new Set(sliceIds).size || affectedIds.length !== new Set(affectedIds).size) return false
  if (sliceIds.length !== affectedIds.length) return false
  const affected = new Set(affectedIds)
  return sliceIds.every((id) => affected.has(id))
}

function acknowledgeApplicationRecommenderWrite(
  applicationId: string,
  input: MaterialRecommender,
  result: ApplicationRecommenderMutationResult,
) {
  const hasOtherApplications = Array.isArray(result?.applications)
  const otherApplications = hasOtherApplications ? result.applications : []
  const applicationSlicesAcknowledged = Boolean(
    hasOtherApplications
    && Array.isArray(result?.affectedApplicationIds)
    && isSafePositiveInteger(result?.directoryRevision)
    && isApplicationRecommenderSlice(result?.application)
    && result.application.id === applicationId
    && !otherApplications.some((application) => application.id === applicationId)
    && compactSlicesAcknowledgeAffectedIds(
      [result.application, ...otherApplications],
      result.affectedApplicationIds,
    ),
  )
  const saved = result?.application?.recommenders?.find((candidate) => candidate.id === input.id)
  const resolved = result?.recommender
  const profile = result?.profile
  const profileFromLibrary = Array.isArray(result?.profiles)
    ? result.profiles.find((candidate) => candidate.id === profile?.id)
    : undefined
  const applicationAcknowledged = Boolean(
    saved
    && persistedSubsetMatches(authoredRecommenderFields(input), authoredRecommenderFields(saved)),
  )
  const resolvedRowAcknowledged = Boolean(
    resolved
    && persistedSubsetMatches(authoredRecommenderFields(input), authoredRecommenderFields(resolved)),
  )
  const linkedProfileAcknowledged = Boolean(
    saved?.profileId
    && resolved?.profileId === saved.profileId
    && profile?.id === saved.profileId
    && profileFromLibrary
    && persistedSubsetMatches(authoredRecommenderProfileFields(input), profile)
    && persistedSubsetMatches(profile, profileFromLibrary),
  )
  if (
    applicationSlicesAcknowledged
    && applicationAcknowledged
    && resolvedRowAcknowledged
    && linkedProfileAcknowledged
  ) {
    return result
  }
  throw new ApiError(
    'The server did not acknowledge every recommender field. The editor remains open so you can retry.',
    'REQUEST_FAILED',
    409,
  )
}

function acknowledgeProfileRecommenderList(
  input: readonly ProfileRecommender[],
  result: ProfileRecommenderMutationResult,
) {
  if (!Array.isArray(result?.profiles)) {
    throw new ApiError(
      'The server did not acknowledge the complete recommender library. Keep the editor open and retry.',
      'REQUEST_FAILED',
      409,
    )
  }
  const savedById = new Map(result.profiles.map((profile) => [profile.id, profile]))
  const acknowledged = input.every((profile) => {
    const saved = savedById.get(profile.id)
    if (!saved) return false
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...authored } = profile
    return persistedSubsetMatches(authored, saved)
  })
  const applicationSlicesAcknowledged = Boolean(
    Array.isArray(result?.applications)
    && Array.isArray(result?.affectedApplicationIds)
    && isSafePositiveInteger(result?.directoryRevision)
    && compactSlicesAcknowledgeAffectedIds(
      result.applications,
      result.affectedApplicationIds,
    )
  )
  if (acknowledged && applicationSlicesAcknowledged && input.length === result.profiles.length) return result
  throw new ApiError(
    'The server did not acknowledge the complete recommender library. Keep the editor open and retry.',
    'REQUEST_FAILED',
    409,
  )
}

function sessionSupersededError() {
  return new ApiError('The authenticated session changed before the request completed.', 'SESSION_SUPERSEDED', 409)
}

function throwIfSessionSuperseded(
  sourceToken?: string,
  requestGeneration?: number,
  generationBound = false,
) {
  if (
    (sourceToken || generationBound)
    && requestGeneration !== undefined
    && requestGeneration !== clientSessionGeneration
  ) {
    throw sessionSupersededError()
  }
}

function responseRetryAfterMs(response: Response) {
  const explicitHeader = response.headers.get('X-PhD-Retry-After-Ms')
  if (explicitHeader !== null) {
    const explicitMs = Number(explicitHeader)
    if (Number.isFinite(explicitMs) && explicitMs >= 0) return Math.round(explicitMs)
  }
  const retryAfter = response.headers.get('Retry-After')?.trim()
  if (!retryAfter) return undefined
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const retryAt = Date.parse(retryAfter)
  if (!Number.isFinite(retryAt)) return undefined
  return Math.max(0, retryAt - Date.now())
}

function safeRequestId(value: unknown) {
  if (typeof value !== 'string') return undefined
  const requestId = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(requestId)) return undefined
  return requestId
}

function responseRequestId(response: Response, envelopeRequestId?: unknown) {
  return safeRequestId(response.headers.get('X-Request-Id')) ?? safeRequestId(envelopeRequestId)
}

const unauthorizedCodes = ['TOKEN_EXPIRED', 'UNAUTHORIZED', 'UNKNOWN_USER', 'ACCOUNT_DISABLED']

function notifyUnauthorized(error: ApiError, sourceToken?: string, requestGeneration?: number) {
  // Drop unauthorized signals from requests that started before the latest
  // login/logout. Same-account re-login is the critical case: an in-flight
  // TOKEN_EXPIRED for the previous JWT must not toast+logout the new session.
  if (requestGeneration !== undefined && requestGeneration !== clientSessionGeneration) {
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
  signal?: AbortSignal,
  generationBound = false,
): Promise<T> {
  // A revalidated HTTP response can combine fresh 304 headers with an older cached
  // response body. The header is authoritative so a cached envelope cannot roll a
  // newly established session back to an expired token.
  // Also ignore session-token headers from responses that belong to a previous
  // client session generation (late responses after re-login).
  const generation = requestGeneration ?? clientSessionGeneration
  throwIfAborted(signal)
  throwIfSessionSuperseded(sourceToken, generation, generationBound)
  const acceptSessionSideEffects = generation === clientSessionGeneration
  const responseSessionToken = acceptSessionSideEffects
    ? syncSessionFromResponse(response, sourceToken)
    : response.headers.get('X-Session-Token') || null
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
      undefined,
      responseRequestId(response),
    )
  }
  // SPA shell HTML (e.g. stale server without a new /api route) must not surface as a blank parse error.
  if (contentType.includes('text/html')) {
    const error = new ApiError(
      'The API returned a web page instead of JSON. Restart the PhD Atlas server and try again.',
      'API_HTML_RESPONSE',
      response.status || 502,
      undefined,
      responseRequestId(response),
    )
    notifyUnauthorized(error, sourceToken, generation)
    throw error
  }
  let envelope: ApiEnvelope<T>
  try {
    envelope = parseOffMain
      ? ((await response.text().then((text) => parseLargeJson(text))) as ApiEnvelope<T>)
      : ((await response.json()) as ApiEnvelope<T>)
  } catch {
    throwIfAborted(signal)
    throwIfSessionSuperseded(sourceToken, generation, generationBound)
    const error = new ApiError(
      response.status === 401 ? 'Sign in is required.' : 'Request failed.',
      response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED',
      response.status,
      undefined,
      responseRequestId(response),
    )
    notifyUnauthorized(error, sourceToken, generation)
    throw error
  }
  throwIfAborted(signal)
  throwIfSessionSuperseded(sourceToken, generation, generationBound)
  if (acceptSessionSideEffects && !responseSessionToken) syncSessionFromEnvelope(envelope, sourceToken)
  if (!response.ok || !envelope.ok) {
    const error = new ApiError(
      envelope.error?.message ?? 'Request failed.',
      envelope.error?.code ?? 'REQUEST_FAILED',
      response.status,
      envelope.error?.field,
      responseRequestId(response, envelope.requestId),
    )
    error.retryAfterMs = responseRetryAfterMs(response)
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
    sessionCachePartitionByToken.set(refreshedToken, sessionCachePartitionByToken.get(sourceToken) ?? sourceToken)
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
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
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

function serverUnavailableError() {
  return new ApiError('The PhD Atlas server is unavailable.', 'SERVER_UNAVAILABLE', 503)
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted()
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}

function abortReasonForSignal(signal: AbortSignal) {
  if (signal.reason !== undefined) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReasonForSignal(signal))
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup()
      reject(abortReasonForSignal(signal))
    }
    const cleanup = () => signal.removeEventListener('abort', handleAbort)
    signal.addEventListener('abort', handleAbort, { once: true })
    void operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function authCapacityRetryDelay(error: ApiError, attempt: number) {
  const exponentialDelay = Math.min(
    AUTH_CAPACITY_RETRY_MAX_MS,
    AUTH_CAPACITY_RETRY_BASE_MS * (2 ** Math.min(attempt, 16)),
  )
  const baseDelay = error.retryAfterMs === undefined
    ? exponentialDelay
    : Math.max(exponentialDelay, error.retryAfterMs)
  return Math.round(baseDelay * (1 + (Math.random() * 0.1)))
}

function waitForAbortableDelay(delayMs: number, signal: AbortSignal) {
  throwIfAborted(signal)
  if (delayMs <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      cleanup()
      reject(abortReasonForSignal(signal))
    }
    const timeoutId = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    const cleanup = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', handleAbort)
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

type ManagedResponseReader = ReadableStreamDefaultReader<Uint8Array> & {
  cancel?: (reason?: unknown) => Promise<void>
  releaseLock?: () => void
}

function cancelResponseReader(reader: ManagedResponseReader, reason?: unknown) {
  try {
    return Promise.resolve(reader.cancel?.(reason)).catch(() => undefined)
  } catch {
    return Promise.resolve()
  }
}

async function closeResponseReader(reader: ManagedResponseReader, reason?: unknown) {
  await cancelResponseReader(reader, reason)
  try {
    reader.releaseLock?.()
  } catch {
    // A mocked or already released reader is still considered closed.
  }
}

function sharedReadKey(
  kind: 'plain' | 'conditional' | 'navigation-detail' | 'workspace-sections',
  path: string,
  token: string | undefined,
  generation: number,
  headers: Headers,
  init: RequestInit,
  timeoutMs: number,
) {
  const headerSignature = Array.from(headers.entries())
    .filter(([name]) => name !== 'authorization')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const requestProfile = JSON.stringify({
    cache: init.cache ?? '',
    credentials: init.credentials ?? '',
    headers: headerSignature,
    method: String(init.method ?? 'GET').toUpperCase(),
    mode: init.mode ?? '',
    redirect: init.redirect ?? '',
    referrerPolicy: init.referrerPolicy ?? '',
    timeoutMs,
  })
  return `g${generation}:${readCachePartition(token)}:r${readCacheRevision(token)} ${kind} ${path} ${requestProfile}`
}

type RequestLifecycle = {
  generation?: number
  generationBound?: boolean
  sourceToken?: string
}

async function fetchWithTimeout<T>(
  path: string,
  init: RequestInit,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
  timeoutMs = timeoutForRequest(init),
  lifecycle: RequestLifecycle = {},
): Promise<T> {
  throwIfAborted(init.signal ?? undefined)
  throwIfSessionSuperseded(lifecycle.sourceToken, lifecycle.generation, lifecycle.generationBound)
  const method = String(init.method ?? 'GET').toUpperCase()
  if (path.startsWith('/api/') && apiRequestBlockReason(method)) {
    throw serverUnavailableError()
  }

  const observedConnectivityGeneration = getConnectivityGeneration()
  const controller = new AbortController()
  const activeRequest = (lifecycle.sourceToken || lifecycle.generationBound) && lifecycle.generation !== undefined
    ? { controller, generation: lifecycle.generation }
    : null
  if (activeRequest) activeAuthenticatedRequests.add(activeRequest)
  let timedOut = false
  const hasDeadline = Number.isFinite(timeoutMs) && timeoutMs > 0
  const timeoutId = hasDeadline
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    : null
  const externalSignal = init.signal
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason)
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    })
  }

  try {
    const response = await raceWithAbort(
      fetch(path, {
        ...init,
        // Conditional GET state is deliberately owned by this client, not by the
        // browser HTTP cache. A cached API response can carry an old
        // X-Session-Token header; when revalidated, browsers merge that header
        // into a 304 response and would overwrite a freshly established session.
        cache: 'no-store',
        signal: controller.signal,
      }),
      controller.signal,
    )
    if (path.startsWith('/api/')) {
      const contentType = response.headers.get('content-type') ?? ''
      const isAtlasEnvelope = contentType.toLowerCase().includes('json')
      const gatewayUnavailable = [502, 503, 504].includes(response.status)
        && response.headers.get('X-PhD-Gateway-Error')?.trim().toLowerCase() === 'unavailable'
      if (gatewayUnavailable || ([502, 503, 504].includes(response.status) && !isAtlasEnvelope)) {
        reportApiUnavailable({
          evidence: 'gateway',
          observedGeneration: observedConnectivityGeneration,
        })
      } else {
        reportApiReachable(undefined, {
          observedGeneration: observedConnectivityGeneration,
        })
      }
    }
    if (response.ok && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const authorization = new Headers(init.headers).get('Authorization') ?? ''
      const [, mutationToken] = authorization.match(/^Bearer\s+(.+)$/i) ?? []
      if (!lifecycle.sourceToken || lifecycle.generation === clientSessionGeneration) {
        scheduleMutationReadInvalidation(method, path, mutationToken)
      }
    }
    const abortResponseBody = () => {
      try {
        void response.body?.cancel(controller.signal.reason).catch(() => undefined)
      } catch {
        // A locked stream is cancelled by its active reader instead.
      }
    }
    controller.signal.addEventListener('abort', abortResponseBody, { once: true })
    const consumption = Promise.resolve().then(() => consume(response, controller.signal))
    // If timeout/session cancellation wins the race, the body consumer can still
    // finish cleanup in the background without creating an unhandled rejection.
    void consumption.catch(() => undefined)
    let result: T
    try {
      result = await raceWithAbort(consumption, controller.signal)
    } finally {
      controller.signal.removeEventListener('abort', abortResponseBody)
    }
    if (timedOut) throw timeoutError()
    throwIfSessionSuperseded(lifecycle.sourceToken, lifecycle.generation, lifecycle.generationBound)
    throwIfAborted(controller.signal)
    return result
  } catch (error) {
    throwIfSessionSuperseded(lifecycle.sourceToken, lifecycle.generation, lifecycle.generationBound)
    if (timedOut) {
      if (path.startsWith('/api/')) {
        reportApiUnavailable({
          evidence: 'timeout',
          observedGeneration: observedConnectivityGeneration,
        })
      }
      throw timeoutError()
    }
    if (externalSignal?.aborted && externalSignal.reason instanceof SharedReadInvalidatedError) {
      throw externalSignal.reason
    }
    if (path.startsWith('/api/') && error instanceof TypeError && !controller.signal.aborted) {
      reportApiUnavailable({
        evidence: 'transport',
        observedGeneration: observedConnectivityGeneration,
      })
    }
    throw error
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
    if (activeRequest) activeAuthenticatedRequests.delete(activeRequest)
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
  const headers = requestHeaders(activeToken, init)
  const execute = async (signal?: AbortSignal) => {
    return fetchWithTimeout(
      path,
      {
        ...init,
        headers,
        signal,
      },
      (response, lifecycleSignal) => parseEnvelope<T>(response, token, false, requestGeneration, lifecycleSignal),
      timeoutMs,
      { generation: requestGeneration, sourceToken: token },
    )
  }
  const method = String(init.method ?? 'GET').toUpperCase()
  if (method === 'GET' && init.body === undefined) {
    try {
      return await sharedReadCoordinator.run(
        sharedReadKey('plain', path, activeToken, requestGeneration, headers, init, timeoutMs),
        execute,
        init.signal ?? undefined,
      )
    } catch (error) {
      if (
        error instanceof SharedReadInvalidatedError &&
        !init.signal?.aborted &&
        requestGeneration === clientSessionGeneration
      ) {
        return request<T>(path, token, init, timeoutMs)
      }
      throw error
    }
  }
  return execute(init.signal ?? undefined)
}

async function generationBoundRequest<T>(
  path: string,
  requestGeneration: number,
  init: RequestInit,
  timeoutMs: number,
) {
  const headers = requestHeaders(undefined, init)
  return fetchWithTimeout(
    path,
    {
      ...init,
      headers,
    },
    (response, lifecycleSignal) => (
      parseEnvelope<T>(response, undefined, false, requestGeneration, lifecycleSignal, true)
    ),
    timeoutMs,
    { generation: requestGeneration, generationBound: true },
  )
}

async function loginWithCapacityRetry(
  email: string,
  password: string,
  scope: 'app' | 'admin',
  options: ApiReadOptions,
) {
  resetClientSessionState()
  const requestGeneration = clientSessionGeneration
  const controller = new AbortController()
  const activeRequest = { controller, generation: requestGeneration }
  const callerSignal = options.signal
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason)
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  activeAuthenticatedRequests.add(activeRequest)

  const deadline = Date.now() + AUTH_CAPACITY_RETRY_BUDGET_MS
  let capacityAttempt = 0
  let lastCapacityError: ApiError | undefined
  try {
    while (true) {
      throwIfAborted(controller.signal)
      throwIfSessionSuperseded(undefined, requestGeneration, true)
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw lastCapacityError ?? timeoutError()
      try {
        return await generationBoundRequest<AuthSession>(
          '/api/auth/login',
          requestGeneration,
          {
            method: 'POST',
            body: JSON.stringify({ email, password, scope }),
            signal: controller.signal,
          },
          Math.max(1, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, remainingMs)),
        )
      } catch (error) {
        throwIfAborted(controller.signal)
        throwIfSessionSuperseded(undefined, requestGeneration, true)
        if (
          !(error instanceof ApiError)
          || error.status !== 429
          || error.code !== 'AUTH_CAPACITY_EXCEEDED'
        ) {
          throw error
        }
        lastCapacityError = error
        const retryBudgetMs = deadline - Date.now()
        if (retryBudgetMs <= 0) throw error
        const retryDelayMs = authCapacityRetryDelay(error, capacityAttempt)
        capacityAttempt += 1
        if (retryDelayMs >= retryBudgetMs) {
          await waitForAbortableDelay(retryBudgetMs, controller.signal)
          throwIfSessionSuperseded(undefined, requestGeneration, true)
          throw error
        }
        await waitForAbortableDelay(retryDelayMs, controller.signal)
      }
    }
  } finally {
    callerSignal?.removeEventListener('abort', abortFromCaller)
    activeAuthenticatedRequests.delete(activeRequest)
  }
}

async function streamAiDraftRequest(
  token: string,
  input: AiDraftInput,
  onEvent: (event: AiDraftEvent) => void,
  signal?: AbortSignal,
) {
  const requestGeneration = clientSessionGeneration
  const activeToken = getLatestSessionToken(token)
  return fetchWithTimeout(
    '/api/ai/draft',
    {
      method: 'POST',
      body: JSON.stringify(input),
      headers: requestHeaders(activeToken, {
        body: JSON.stringify(input),
        headers: { Accept: 'text/event-stream' },
      }),
      signal,
    },
    async (response, lifecycleSignal) => {
      if (!response.ok) {
        await parseEnvelope<never>(response, token, false, requestGeneration, lifecycleSignal)
      }
      throwIfSessionSuperseded(token, requestGeneration)
      syncSessionFromResponse(response, token)
      const reader = response.body?.getReader() as ManagedResponseReader | undefined
      if (!reader) throw new ApiError('AI stream was unavailable.', 'AI_STREAM_UNAVAILABLE', 502)
      const abortReader = () => {
        void cancelResponseReader(reader, lifecycleSignal.reason)
      }
      lifecycleSignal.addEventListener('abort', abortReader, { once: true })
      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = 'message'
      let terminalReceived = false
      const dispatch = (block: string) => {
        throwIfAborted(lifecycleSignal)
        throwIfSessionSuperseded(token, requestGeneration)
        const lines = block.split(/\r?\n/)
        let data = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim()
          if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        const type = eventType
        eventType = 'message'
        if (!data) return
        let payload: Record<string, unknown>
        try {
          const parsed = JSON.parse(data) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload')
          payload = parsed as Record<string, unknown>
        } catch {
          throw new ApiError('The AI stream returned an invalid event.', 'AI_STREAM_INVALID', 502)
        }
        if (type === 'done' || type === 'error') terminalReceived = true
        onEvent({ type, ...payload } as AiDraftEvent)
      }
      try {
        while (true) {
          throwIfAborted(lifecycleSignal)
          throwIfSessionSuperseded(token, requestGeneration)
          const { done, value } = await reader.read()
          throwIfAborted(lifecycleSignal)
          throwIfSessionSuperseded(token, requestGeneration)
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = done ? '' : (events.pop() ?? '')
          events.forEach(dispatch)
          if (done) break
        }
        if (buffer) dispatch(buffer)
        if (!terminalReceived) {
          throw new ApiError('The AI stream ended before the draft completed.', 'AI_STREAM_INCOMPLETE', 502)
        }
      } finally {
        lifecycleSignal.removeEventListener('abort', abortReader)
        await closeResponseReader(reader, lifecycleSignal.reason)
      }
    },
    120_000,
    { generation: requestGeneration, sourceToken: token },
  )
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
  options: { freshForMs?: number; parseOffMain?: boolean } = {},
): Promise<T> {
  // Resolve through the live same-account token chain so concurrent refreshes
  // share a cache partition, while a foreign account never reuses /api/auth/me.
  // Capture generation up front: after same-account re-login the key changes so
  // this call never joins a previous session's in-flight TOKEN_EXPIRED promise.
  const requestGeneration = clientSessionGeneration
  const requestToken = resolveActiveRequestToken(token)
  const cacheKey = conditionalCacheKey(path, requestToken, requestGeneration)
  const cached = readConditionalResponse(cacheKey)
  const freshForMs = Math.max(0, Number(options.freshForMs ?? 0))
  // An entry an invalidation marked must-revalidate keeps its validator but
  // forfeits its freshness window: the body is served only after the server
  // confirms it with a 304.
  if (cached && !cached.mustRevalidate && freshForMs > 0 && Date.now() - cached.storedAt < freshForMs) {
    throwIfAborted(init.signal ?? undefined)
    return cached.data as T
  }
  const headers = requestHeaders(requestToken, init)
  if (cached?.etag) {
    headers.set('If-None-Match', cached.etag)
  }
  const coordinatorKey = sharedReadKey(
    'conditional',
    path,
    requestToken,
    requestGeneration,
    headers,
    init,
    timeoutForRequest(init),
  )

  try {
    return await sharedReadCoordinator.run(
      coordinatorKey,
      async (signal) => {
        return fetchWithTimeout(
          path,
          {
            ...init,
            headers,
            signal,
          },
          async (response, lifecycleSignal) => {
            if (response.status === 304 && cached) {
              if (path === '/api/auth/me') {
                const cachedUserId = mePayloadUserId(cached.data)
                const requestSubject = readSessionTokenSubject(requestToken)
                if (cachedUserId && requestSubject && cachedUserId !== requestSubject) {
                  conditionalResponseCache.delete(cacheKey)
                  // Identity mismatch: re-fetch without validators instead of serving
                  // another account's body.
                  const freshHeaders = requestHeaders(resolveActiveRequestToken(token), init)
                  return fetchWithTimeout(
                    path,
                    {
                      ...init,
                      headers: freshHeaders,
                      signal: lifecycleSignal,
                    },
                    async (freshResponse, freshLifecycleSignal) => {
                      const etag = freshResponse.headers.get('ETag')
                      const data = await parseEnvelope<T>(
                        freshResponse,
                        token,
                        false,
                        requestGeneration,
                        freshLifecycleSignal,
                      )
                      if (etag && requestGeneration === clientSessionGeneration) {
                        rememberConditionalResponse(
                          conditionalCacheKey(path, resolveActiveRequestToken(token), requestGeneration),
                          { etag, data, storedAt: Date.now() },
                        )
                      }
                      return data
                    },
                    timeoutForRequest(init),
                    { generation: requestGeneration, sourceToken: token },
                  )
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
              options.parseOffMain === true
                || path === '/api/applications'
                || path.startsWith('/api/workspace/bootstrap'),
              requestGeneration,
              lifecycleSignal,
            )
            if (requestGeneration === clientSessionGeneration) {
              rememberConditionalResponse(cacheKey, {
                etag: etag ?? undefined,
                data,
                storedAt: Date.now(),
              })
            }
            return data
          },
          timeoutForRequest(init),
          { generation: requestGeneration, sourceToken: token },
        )
      },
      init.signal ?? undefined,
    )
  } catch (error) {
    if (
      error instanceof SharedReadInvalidatedError &&
      !init.signal?.aborted &&
      requestGeneration === clientSessionGeneration
    ) {
      return conditionalRequest<T>(path, token, init, options)
    }
    throw error
  }
}

const APPLICATION_NAVIGATION_TRANSIENT_CODES = new Set([
  'DATABASE_MAINTENANCE',
  'MEMORY_PRESSURE',
  'MEMORY_PRESSURE_SOFT',
  'MEMORY_PRESSURE_HARD',
  'REQUEST_TIMEOUT',
  'SERVER_BUSY',
  'SERVER_STARTING',
  'SERVER_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'WORK_DEADLINE_EXCEEDED',
])

function isTransientApplicationNavigationError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false
  return APPLICATION_NAVIGATION_TRANSIENT_CODES.has(error.code)
    || error.status === 408
    || error.status === 429
    || error.status === 502
    || error.status === 503
    || error.status === 504
}

async function applicationNavigationDetailRequest(
  token: string,
  id: string,
  options: ApiReadOptions = {},
) {
  const requestGeneration = clientSessionGeneration
  const requestToken = resolveActiveRequestToken(token)
  const path = `/api/applications/${encodeURIComponent(id)}`
  const headers = requestHeaders(requestToken)
  const coordinatorKey = sharedReadKey(
    'navigation-detail',
    path,
    requestToken,
    requestGeneration,
    headers,
    {},
    DEFAULT_REQUEST_TIMEOUT_MS,
  )

  try {
    return await sharedReadCoordinator.run<ApplicationRecord>(
      coordinatorKey,
      async (signal) => {
        let lastError: ApiError | null = null
        for (let attempt = 0; attempt <= APPLICATION_NAVIGATION_RETRY_DELAYS_MS.length; attempt += 1) {
          throwIfAborted(signal)
          throwIfSessionSuperseded(token, requestGeneration)
          try {
            return await conditionalRequest<ApplicationRecord>(
              path,
              token,
              { signal },
              { freshForMs: DEFAULT_READ_FRESHNESS_MS, parseOffMain: true },
            )
          } catch (error) {
            throwIfAborted(signal)
            throwIfSessionSuperseded(token, requestGeneration)
            if (!isTransientApplicationNavigationError(error)) throw error
            lastError = error
            const retryDelay = APPLICATION_NAVIGATION_RETRY_DELAYS_MS[attempt]
            if (retryDelay === undefined) {
              error.retryExhausted = true
              throw error
            }
            const serverDelay = Math.min(
              APPLICATION_NAVIGATION_MAX_RETRY_AFTER_MS,
              Math.max(0, error.retryAfterMs ?? 0),
            )
            await waitForAbortableDelay(Math.max(retryDelay, serverDelay), signal)
          }
        }
        throw lastError ?? new ApiError('Application detail is unavailable.', 'SERVICE_UNAVAILABLE', 503)
      },
      options.signal,
    )
  } catch (error) {
    if (
      error instanceof SharedReadInvalidatedError
      && !options.signal?.aborted
      && requestGeneration === clientSessionGeneration
    ) {
      return applicationNavigationDetailRequest(token, id, options)
    }
    throw error
  }
}

async function streamRealtimeUpdatesRequest(
  token: string,
  onEvent: (event: RealtimeInvalidationEvent) => void,
  signal?: AbortSignal,
) {
  const requestGeneration = clientSessionGeneration
  const activeToken = getLatestSessionToken(token)
  return fetchWithTimeout(
    '/api/events',
    {
      headers: requestHeaders(activeToken, {
        headers: { Accept: 'text/event-stream' },
      }),
      signal,
    },
    async (response, lifecycleSignal) => {
      if (!response.ok) {
        await parseEnvelope<never>(response, token, false, requestGeneration, lifecycleSignal)
      }
      throwIfSessionSuperseded(token, requestGeneration)
      syncSessionFromResponse(response, token)
      const reader = response.body?.getReader() as ManagedResponseReader | undefined
      if (!reader) throw new ApiError('Realtime updates are unavailable.', 'REALTIME_UNAVAILABLE', 502)
      const abortReader = () => {
        void cancelResponseReader(reader, lifecycleSignal.reason)
      }
      lifecycleSignal.addEventListener('abort', abortReader, { once: true })
      const decoder = new TextDecoder()
      let buffer = ''
      const dispatch = (block: string) => {
        throwIfAborted(lifecycleSignal)
        throwIfSessionSuperseded(token, requestGeneration)
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
        if (!data) return
        try {
          const event = JSON.parse(data) as RealtimeInvalidationEvent
          onEvent(event)
        } catch {
          // Ignore malformed intermediary frames and wait for the next event.
        }
      }
      try {
        while (true) {
          throwIfAborted(lifecycleSignal)
          throwIfSessionSuperseded(token, requestGeneration)
          const { done, value } = await reader.read()
          throwIfAborted(lifecycleSignal)
          throwIfSessionSuperseded(token, requestGeneration)
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
          const blocks = buffer.split(/\r?\n\r?\n/)
          buffer = done ? '' : (blocks.pop() ?? '')
          blocks.forEach(dispatch)
          if (done) break
        }
        if (buffer) dispatch(buffer)
      } finally {
        lifecycleSignal.removeEventListener('abort', abortReader)
        await closeResponseReader(reader, lifecycleSignal.reason)
      }
    },
    0,
    { generation: requestGeneration, sourceToken: token },
  )
}

function primeConditionalRead(path: string, token: string, data: unknown) {
  const requestToken = resolveActiveRequestToken(token)
  rememberConditionalResponse(conditionalCacheKey(path, requestToken, clientSessionGeneration), {
    data,
    storedAt: Date.now(),
  })
}

function readFreshConditionalData<T>(
  path: string,
  token: string,
  freshForMs: number,
  signal?: AbortSignal,
): T | undefined {
  const requestToken = resolveActiveRequestToken(token)
  const cached = readConditionalResponse(conditionalCacheKey(path, requestToken, clientSessionGeneration))
  if (!cached || Date.now() - cached.storedAt >= Math.max(0, freshForMs)) return undefined
  throwIfAborted(signal)
  return cached.data as T
}

class WorkspaceSectionRevisionChangedError extends Error {
  requestId?: string

  constructor(requestId?: string) {
    super('The workspace changed while its sectional snapshot was being transferred.')
    this.name = 'WorkspaceSectionRevisionChangedError'
    this.requestId = requestId
  }
}

class WorkspaceSectionTransientRestartError extends ApiError {
  constructor(message: string, code: string, requestId?: string) {
    super(message, code, 503, undefined, requestId)
    this.name = 'WorkspaceSectionTransientRestartError'
  }
}

const WORKSPACE_SECTION_TRANSIENT_RESTART_CODES = new Set([
  'SERVER_BUSY',
  'MEMORY_PRESSURE',
  'MEMORY_PRESSURE_SOFT',
  'MEMORY_PRESSURE_HARD',
  'WORKSPACE_STREAM_RETRY_REQUIRED',
])

type WorkspaceSectionReader = {
  section: WorkspaceBootstrapSectionName
  shape: 'array' | 'value'
  count: number
  values: unknown[]
  item: number
  chunks: string[]
  characters: number
  /** A section re-sent after final validation, replacing what already arrived. */
  refresh: boolean
}

function workspaceSectionProtocolError(message: string) {
  return new ApiError(message, 'WORKSPACE_SECTION_STREAM_INVALID', 502)
}

function workspaceSectionInteger(value: unknown, name: string) {
  const integer = Number(value)
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw workspaceSectionProtocolError(`Workspace stream ${name} is invalid.`)
  }
  return integer
}

function workspaceSectionRestartError(frame: Record<string, unknown>, response: Response) {
  const code = typeof frame.code === 'string' ? frame.code.trim().toUpperCase() : ''
  const requestId = responseRequestId(response, frame.requestId)
  if (code === 'WORKSPACE_REVISION_CHANGED') {
    return new WorkspaceSectionRevisionChangedError(requestId)
  }
  if (!WORKSPACE_SECTION_TRANSIENT_RESTART_CODES.has(code)) {
    return workspaceSectionProtocolError('The workspace stream restart code is unsupported.')
  }

  let retryAfterMs = responseRetryAfterMs(response)
  if (Object.hasOwn(frame, 'retryAfterMs')) {
    const frameRetryAfterMs = frame.retryAfterMs
    if (
      typeof frameRetryAfterMs !== 'number'
      || !Number.isSafeInteger(frameRetryAfterMs)
      || frameRetryAfterMs < 0
      || frameRetryAfterMs > 60_000
    ) {
      return workspaceSectionProtocolError('The workspace stream retry delay is invalid.')
    }
    retryAfterMs = Math.max(retryAfterMs ?? 0, frameRetryAfterMs)
  }

  const error = new WorkspaceSectionTransientRestartError(
    'The server is temporarily busy while loading this workspace. Please retry shortly.',
    code === 'MEMORY_PRESSURE' ? 'SERVER_BUSY' : code,
    requestId,
  )
  error.retryAfterMs = retryAfterMs ?? 1_000
  return error
}

function workspaceSectionTransientRetryDelay(error: ApiError, attempt: number) {
  const exponentialDelay = Math.min(
    WORKSPACE_SECTION_STREAM_RETRY_MAX_MS,
    WORKSPACE_SECTION_STREAM_RETRY_BASE_MS * (2 ** Math.min(attempt, 8)),
  )
  const baseDelay = Math.max(exponentialDelay, error.retryAfterMs ?? 0)
  // A longer server delay remains available to the caller on ApiError, but is
  // not silently converted into an unbounded bootstrap wait.
  if (baseDelay > WORKSPACE_SECTION_STREAM_RETRY_MAX_MS) return null
  const jitterWindow = Math.min(
    WORKSPACE_SECTION_STREAM_RETRY_MAX_MS - baseDelay,
    Math.max(100, Math.round(baseDelay * WORKSPACE_SECTION_STREAM_RETRY_JITTER_RATIO)),
  )
  return baseDelay + Math.round(Math.random() * jitterWindow)
}

function workspaceSectionStreamPath(
  teamId: string | null | undefined,
  sections: readonly WorkspaceBootstrapSectionName[],
  extraQuery: Readonly<Record<string, string>> = {},
) {
  const params = new URLSearchParams()
  if (teamId) params.set('teamId', teamId)
  for (const [key, value] of Object.entries(extraQuery)) {
    if (value) params.set(key, value)
  }
  if (
    sections.length !== WORKSPACE_BOOTSTRAP_SECTION_NAMES.length
    || sections.some((section, index) => section !== WORKSPACE_BOOTSTRAP_SECTION_NAMES[index])
  ) {
    params.set('sections', sections.join(','))
  }
  const query = params.toString()
  return `/api/workspace/bootstrap/stream${query ? `?${query}` : ''}`
}

async function readWorkspaceSectionStreamChunk(reader: ManagedResponseReader, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ApiError(
          'The workspace transfer stopped making progress. Check the connection and retry.',
          'WORKSPACE_STREAM_IDLE_TIMEOUT',
          408,
        )), WORKSPACE_SECTION_STREAM_IDLE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
    throwIfAborted(signal)
  }
}

async function consumeWorkspaceSectionStream(
  response: Response,
  token: string,
  requestGeneration: number,
  lifecycleSignal: AbortSignal,
  requestedSections: readonly WorkspaceBootstrapSectionName[],
): Promise<WorkspaceBootstrapSections> {
  if (!response.ok) {
    await parseEnvelope<never>(response, token, false, requestGeneration, lifecycleSignal)
  }
  throwIfSessionSuperseded(token, requestGeneration)
  const protocolHeader = response.headers.get('X-Workspace-Stream-Protocol')
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (
    protocolHeader !== WORKSPACE_SECTION_STREAM_PROTOCOL
    || !contentType.includes('application/x-ndjson')
  ) {
    throw workspaceSectionProtocolError('The workspace sectional stream is unavailable.')
  }
  syncSessionFromResponse(response, token)
  const reader = response.body?.getReader() as ManagedResponseReader | undefined
  if (!reader) throw workspaceSectionProtocolError('The workspace sectional stream has no response body.')
  const abortReader = () => {
    void cancelResponseReader(reader, lifecycleSignal.reason)
  }
  lifecycleSignal.addEventListener('abort', abortReader, { once: true })

  const decoder = new TextDecoder()
  const result = Object.create(null) as WorkspaceBootstrapSections
  let buffer = ''
  let revision: number | null = null
  let manifestSeen = false
  let complete = false
  let completedSections = 0
  let current: WorkspaceSectionReader | null = null
  const streamRequestId = responseRequestId(response)

  const requireRevision = (frame: Record<string, unknown>) => {
    const frameRevision = workspaceSectionInteger(frame.revision, 'revision')
    if (revision === null || frameRevision !== revision) {
      throw new WorkspaceSectionRevisionChangedError(streamRequestId)
    }
  }

  const processFrame = async (line: string) => {
    if (!line.trim()) return
    if (line.length > WORKSPACE_SECTION_STREAM_MAX_LINE_CHARACTERS) {
      throw workspaceSectionProtocolError('A workspace stream frame exceeded its safe size.')
    }
    let frame: Record<string, unknown>
    try {
      const parsed = JSON.parse(line) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('frame')
      frame = parsed as Record<string, unknown>
    } catch {
      throw workspaceSectionProtocolError('A workspace stream frame could not be decoded.')
    }
    const kind = String(frame.kind ?? '')
    if (kind === 'restart') throw workspaceSectionRestartError(frame, response)
    if (complete) throw workspaceSectionProtocolError('The workspace stream continued after completion.')

    if (kind === 'manifest') {
      if (manifestSeen || current || completedSections !== 0) {
        throw workspaceSectionProtocolError('The workspace stream manifest was duplicated.')
      }
      if (frame.protocol !== WORKSPACE_SECTION_STREAM_PROTOCOL) {
        throw workspaceSectionProtocolError('The workspace stream protocol is unsupported.')
      }
      const sections = Array.isArray(frame.sections) ? frame.sections.map(String) : []
      if (
        sections.length !== requestedSections.length
        || sections.some((section, index) => section !== requestedSections[index])
      ) {
        throw workspaceSectionProtocolError('The workspace stream returned unexpected sections.')
      }
      revision = workspaceSectionInteger(frame.revision, 'revision')
      const headerRevision = response.headers.get('X-Workspace-Revision')
      if (headerRevision !== null && workspaceSectionInteger(headerRevision, 'header revision') !== revision) {
        throw new WorkspaceSectionRevisionChangedError(streamRequestId)
      }
      manifestSeen = true
      return
    }

    if (!manifestSeen) throw workspaceSectionProtocolError('The workspace stream manifest is missing.')
    requireRevision(frame)

    if (kind === 'section-begin') {
      if (current || completedSections >= requestedSections.length) {
        throw workspaceSectionProtocolError('The workspace stream section order is invalid.')
      }
      const section = String(frame.section ?? '') as WorkspaceBootstrapSectionName
      if (section !== requestedSections[completedSections]) {
        throw workspaceSectionProtocolError('The workspace stream section does not match its manifest.')
      }
      const shape = frame.shape === 'array' ? 'array' : frame.shape === 'value' ? 'value' : null
      const count = workspaceSectionInteger(frame.count, 'section count')
      if (!shape || (shape === 'value' && count !== 1)) {
        throw workspaceSectionProtocolError('The workspace stream section shape is invalid.')
      }
      current = { section, shape, count, values: [], item: 0, chunks: [], characters: 0, refresh: false }
      return
    }

    /**
     * A small metadata section that moved while the rest of the workspace was
     * being transferred. The server re-sends just that section instead of
     * invalidating the whole stream, so an ordinary sign-in no longer downloads
     * the entire workspace again because a settings nonce advanced.
     */
    if (kind === 'section-refresh-begin') {
      if (current || completedSections !== requestedSections.length) {
        throw workspaceSectionProtocolError('The workspace stream refreshed a section out of order.')
      }
      const section = String(frame.section ?? '') as WorkspaceBootstrapSectionName
      if (!requestedSections.includes(section)) {
        throw workspaceSectionProtocolError('The workspace stream refreshed an unrequested section.')
      }
      const shape = frame.shape === 'array' ? 'array' : frame.shape === 'value' ? 'value' : null
      const count = workspaceSectionInteger(frame.count, 'section count')
      if (!shape || (shape === 'value' && count !== 1)) {
        throw workspaceSectionProtocolError('The workspace stream section shape is invalid.')
      }
      current = { section, shape, count, values: [], item: 0, chunks: [], characters: 0, refresh: true }
      return
    }

    if (kind === 'complete') {
      const sectionCount = workspaceSectionInteger(frame.sections, 'completed section count')
      if (current || sectionCount !== requestedSections.length || completedSections !== requestedSections.length) {
        throw workspaceSectionProtocolError('The workspace stream completed before every section arrived.')
      }
      complete = true
      return
    }

    if (!current || frame.section !== current.section) {
      throw workspaceSectionProtocolError('The workspace stream frame has no active section.')
    }
    if (kind === 'chunk') {
      const item = workspaceSectionInteger(frame.item, 'item index')
      const sequence = workspaceSectionInteger(frame.sequence, 'chunk sequence')
      if (item !== current.item || sequence !== current.chunks.length || typeof frame.data !== 'string') {
        throw workspaceSectionProtocolError('The workspace stream chunk sequence is invalid.')
      }
      if (frame.data.length > 128 * 1024) {
        throw workspaceSectionProtocolError('A workspace stream data chunk exceeded its safe size.')
      }
      current.chunks.push(frame.data)
      current.characters += frame.data.length
      return
    }
    if (kind === 'item-complete') {
      const item = workspaceSectionInteger(frame.item, 'item index')
      const chunks = workspaceSectionInteger(frame.chunks, 'item chunk count')
      const characters = workspaceSectionInteger(frame.characters, 'item character count')
      if (
        item !== current.item
        || chunks !== current.chunks.length
        || characters !== current.characters
        || item >= current.count
      ) {
        throw workspaceSectionProtocolError('The workspace stream item boundary is invalid.')
      }
      const serialized = current.chunks.join('')
      current.chunks = []
      current.characters = 0
      try {
        current.values.push(await parseLargeJson(serialized))
      } catch {
        throw workspaceSectionProtocolError('A workspace stream item could not be decoded.')
      }
      throwIfAborted(lifecycleSignal)
      throwIfSessionSuperseded(token, requestGeneration)
      current.item += 1
      return
    }
    if (kind === 'section-complete' || kind === 'section-refresh-complete') {
      const items = workspaceSectionInteger(frame.items, 'completed item count')
      if (
        current.refresh !== (kind === 'section-refresh-complete')
        || current.chunks.length !== 0
        || items !== current.item
        || items !== current.count
        || current.values.length !== current.count
      ) {
        throw workspaceSectionProtocolError('The workspace stream section is incomplete.')
      }
      ;(result as Record<string, unknown>)[current.section] = current.shape === 'array'
        ? current.values
        : current.values[0]
      const refreshed = current.refresh
      current = null
      // A refresh replaces a section that was already counted as delivered.
      if (!refreshed) completedSections += 1
      return
    }
    throw workspaceSectionProtocolError('The workspace stream contained an unknown frame.')
  }

  const drainLines = async (final = false) => {
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline).replace(/\r$/u, '')
      buffer = buffer.slice(newline + 1)
      await processFrame(line)
    }
    if (final && buffer.trim()) {
      const line = buffer.replace(/\r$/u, '')
      buffer = ''
      await processFrame(line)
    }
    if (buffer.length > WORKSPACE_SECTION_STREAM_MAX_BUFFER_CHARACTERS) {
      throw workspaceSectionProtocolError('The workspace stream line buffer exceeded its safe size.')
    }
  }

  try {
    while (true) {
      throwIfAborted(lifecycleSignal)
      throwIfSessionSuperseded(token, requestGeneration)
      const { done, value } = await readWorkspaceSectionStreamChunk(reader, lifecycleSignal)
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      await drainLines(done)
      if (done) break
    }
    if (!manifestSeen || !complete || current || completedSections !== requestedSections.length) {
      throw workspaceSectionProtocolError('The workspace stream ended before its atomic completion marker.')
    }
    return result
  } finally {
    lifecycleSignal.removeEventListener('abort', abortReader)
    await closeResponseReader(reader, lifecycleSignal.reason)
  }
}

async function workspaceSectionStreamRequest(
  token: string,
  sections: readonly WorkspaceBootstrapSectionName[],
  teamId?: string | null,
  options: ApiReadOptions = {},
  extraQuery: Readonly<Record<string, string>> = {},
  extraHeaders: Readonly<Record<string, string>> = {},
) {
  const requestGeneration = clientSessionGeneration
  const path = workspaceSectionStreamPath(teamId, sections, extraQuery)
  const requestToken = resolveActiveRequestToken(token)
  const cachePath = extraHeaders['X-PhD-Workspace-Slim'] === '1'
    ? `${path}?slim=1`
    : path
  const cacheKey = conditionalCacheKey(cachePath, requestToken, requestGeneration)
  const cached = readConditionalResponse(cacheKey)
  const headers = requestHeaders(requestToken, {
    headers: {
      Accept: 'application/x-ndjson',
      ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
      ...extraHeaders,
    },
  })
  const execute = async (signal: AbortSignal) => {
    for (let attempt = 0; attempt < WORKSPACE_SECTION_STREAM_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await fetchWithTimeout(
          path,
          { headers, signal },
          async (response, lifecycleSignal) => {
            if (response.status === 304) {
              const current = readConditionalResponse(cacheKey) ?? cached
              if (!current) {
                throw workspaceSectionProtocolError(
                  'The workspace stream was not modified but no local snapshot is available.',
                )
              }
              throwIfAborted(lifecycleSignal)
              throwIfSessionSuperseded(token, requestGeneration)
              syncSessionFromResponse(response, token)
              return current.data as WorkspaceBootstrapSections
            }
            const data = await consumeWorkspaceSectionStream(
              response,
              token,
              requestGeneration,
              lifecycleSignal,
              sections,
            )
            if (requestGeneration === clientSessionGeneration) {
              rememberConditionalResponse(cacheKey, {
                etag: response.headers.get('etag') ?? undefined,
                data,
                storedAt: Date.now(),
              })
            }
            return data
          },
          0,
          { generation: requestGeneration, sourceToken: token },
        )
      } catch (error) {
        const revisionChanged = error instanceof WorkspaceSectionRevisionChangedError
        // Only a restart frame from an already accepted NDJSON stream is
        // retried here. A complete HTTP 503 is an outer bootstrap failure and
        // must be returned to the App recovery owner; treating both as the
        // same ApiError multiplies the bounded 3-attempt policies into nine
        // wire requests during overload.
        const transientRestart = error instanceof WorkspaceSectionTransientRestartError
        if (!revisionChanged && !transientRestart) throw error
        throwIfAborted(signal)
        throwIfSessionSuperseded(token, requestGeneration)
        const restartBudget = transientRestart
          ? WORKSPACE_SECTION_STREAM_MAX_RESTARTS
          : WORKSPACE_SECTION_REVISION_MAX_RESTARTS
        if (attempt + 1 >= restartBudget) {
          if (transientRestart) {
            error.retryExhausted = true
            throw error
          }
          const exhausted = new ApiError(
            'The workspace kept changing while it was loading. Please retry after current saves finish.',
            'WORKSPACE_REVISION_CHANGED',
            409,
            undefined,
            error.requestId,
          )
          exhausted.retryExhausted = true
          throw exhausted
        }
        if (transientRestart) {
          const retryDelayMs = workspaceSectionTransientRetryDelay(error, attempt)
          if (retryDelayMs === null) throw error
          await waitForAbortableDelay(retryDelayMs, signal)
          throwIfSessionSuperseded(token, requestGeneration)
        } else {
          const revisionDelayMs = WORKSPACE_SECTION_REVISION_RETRY_MS[
            Math.min(attempt, WORKSPACE_SECTION_REVISION_RETRY_MS.length - 1)
          ]
          await waitForAbortableDelay(revisionDelayMs, signal)
          throwIfSessionSuperseded(token, requestGeneration)
        }
      }
    }
    throw new ApiError('Workspace sections are unavailable.', 'WORKSPACE_SECTION_STREAM_INVALID', 502)
  }

  try {
    return await sharedReadCoordinator.run(
      sharedReadKey(
        'workspace-sections',
        path,
        requestToken,
        requestGeneration,
        headers,
        {},
        0,
      ),
      execute,
      options.signal ?? undefined,
    )
  } catch (error) {
    if (
      error instanceof SharedReadInvalidatedError
      && !options.signal?.aborted
      && requestGeneration === clientSessionGeneration
    ) {
      return workspaceSectionStreamRequest(
        token,
        sections,
        teamId,
        options,
        extraQuery,
        extraHeaders,
      )
    }
    throw error
  }
}

async function workspaceBootstrapRequest(token: string, teamId?: string | null, options: ApiReadOptions = {}) {
  const path = `/api/workspace/bootstrap${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`
  const cached = readFreshConditionalData<WorkspaceBootstrapPayload>(path, token, 1_000, options.signal)
  if (cached) return cached
  const data = await workspaceSectionStreamRequest(
    token,
    WORKSPACE_BOOTSTRAP_SECTION_NAMES,
    teamId,
    options,
    {},
    { 'X-PhD-Workspace-Slim': '1' },
  ) as WorkspaceBootstrapPayload
  if (!data || typeof data !== 'object' || !Array.isArray(data.applications) || !Array.isArray(data.teamWorkspaces)) {
    throw new ApiError('Workspace bootstrap payload is unavailable.', 'WORKSPACE_BOOTSTRAP_UNAVAILABLE', 502)
  }
  const slimApplications = data.applications.some(
    (application) => (application as { __listSlim?: boolean }).__listSlim === true,
  )
  if (!slimApplications) primeConditionalRead('/api/applications', token, data.applications)
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
  primeConditionalRead(path, token, data)
  return data
}

async function workspaceArraySectionRequest<T>(
  token: string,
  section: WorkspaceBootstrapSectionName,
  readPrimary: () => Promise<T[]>,
  options: ApiReadOptions = {},
  teamId?: string | null,
  primaryCachePath?: string,
  extraQuery: Readonly<Record<string, string>> = {},
) {
  try {
    return await readPrimary()
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 413 || error.code !== 'RESPONSE_TOO_LARGE') throw error
    const sections = await workspaceSectionStreamRequest(token, [section], teamId, options, extraQuery)
    const value = sections[section]
    if (!Array.isArray(value)) {
      throw workspaceSectionProtocolError(`Workspace section ${section} is unavailable.`)
    }
    if (primaryCachePath) primeConditionalRead(primaryCachePath, token, value)
    return value as T[]
  }
}

async function workspaceValueSectionRequest<T>(
  token: string,
  section: WorkspaceBootstrapSectionName,
  readPrimary: () => Promise<T>,
  options: ApiReadOptions = {},
  teamId?: string | null,
  extraQuery: Readonly<Record<string, string>> = {},
) {
  try {
    return await readPrimary()
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 413 || error.code !== 'RESPONSE_TOO_LARGE') throw error
    const sections = await workspaceSectionStreamRequest(token, [section], teamId, options, extraQuery)
    const value = sections[section]
    if (value === undefined) {
      throw workspaceSectionProtocolError(`Workspace section ${section} is unavailable.`)
    }
    return value as T
  }
}

function listApplicationsRequest(token: string, options: ApiReadOptions = {}) {
  return workspaceArraySectionRequest<ApplicationRecord>(
    token,
    'applications',
    () => conditionalRequest<ApplicationRecord[]>(
      '/api/applications',
      token,
      { signal: options.signal },
      { freshForMs: 1_000 },
    ),
    options,
    null,
    '/api/applications',
  )
}

function listProfileAssetsRequest(token: string, options: ApiReadOptions = {}) {
  return workspaceArraySectionRequest<ProfileAsset>(
    token,
    'profileAssets',
    () => conditionalRequest<ProfileAsset[]>(
      '/api/profile-assets',
      token,
      { signal: options.signal },
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),
    options,
    null,
    '/api/profile-assets',
  )
}

async function listProfileRecommendersRequest(
  token: string,
  options: ApiReadOptions & { cursor?: string; limit?: number } = {},
) {
  const params = new URLSearchParams()
  if (options.cursor) params.set('cursor', options.cursor)
  params.set('limit', String(options.limit ?? 50))
  return request<ProfileRecommenderDirectoryPage>(
    `/api/profile/recommenders?${params.toString()}`,
    token,
    { signal: options.signal },
  )
}

function getProfileRecommenderRequest(token: string, id: string) {
  return request<ProfileRecommender>(
    `/api/profile/recommenders/${encodeURIComponent(id)}`,
    token,
  )
}

function listApplicationTrashRequest(token: string, options: ApiReadOptions = {}) {
  return workspaceArraySectionRequest<ApplicationTrashItem>(
    token,
    'applicationTrash',
    () => conditionalRequest<ApplicationTrashItem[]>(
      '/api/applications/trash',
      token,
      { signal: options.signal },
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),
    options,
    null,
    '/api/applications/trash',
  )
}

function listTeamMemberProfileAssetsRequest(
  token: string,
  teamId: string,
  userId: string,
  options: ApiReadOptions = {},
) {
  const primaryPath = `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/profile-assets`
  return workspaceArraySectionRequest<ProfileAsset>(
    token,
    'teamMemberProfileAssets',
    () => conditionalRequest<ProfileAsset[]>(
      primaryPath,
      token,
      { signal: options.signal },
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),
    options,
    teamId,
    primaryPath,
    { subjectUserId: userId },
  )
}

function listTeamApplicationsRequest(
  token: string,
  teamId?: string | null,
  options: ApiReadOptions = {},
) {
  const primaryPath = `/api/teams/mine/applications${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`
  return workspaceArraySectionRequest<TeamApplicationRecord>(
    token,
    'teamApplications',
    () => conditionalRequest<TeamApplicationRecord[]>(
      primaryPath,
      token,
      { signal: options.signal },
      { freshForMs: 1_000 },
    ),
    options,
    teamId,
    primaryPath,
  )
}

function getInterviewPrepWorkspaceRequest(
  token: string,
  input: InterviewPrepScopeInput,
  options: ApiReadOptions = {},
) {
  const query = new URLSearchParams({ subjectUserId: input.subjectUserId })
  if (input.teamId) query.set('teamId', input.teamId)
  return workspaceValueSectionRequest<InterviewPrepWorkspace>(
    token,
    'interviewWorkspace',
    () => request<InterviewPrepWorkspace>(`/api/interview-prep/workspace?${query}`, token, {
      signal: options.signal,
    }),
    options,
    input.teamId,
    { subjectUserId: input.subjectUserId },
  )
}

async function blobRequest(
  path: string,
  token?: string,
  init: RequestInit = {},
  timeoutMs = DOWNLOAD_REQUEST_TIMEOUT_MS,
) {
  const requestGeneration = clientSessionGeneration
  const activeToken = token ? getLatestSessionToken(token) : undefined
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/octet-stream')
  return fetchWithTimeout(
    path,
    {
      ...init,
      headers: requestHeaders(activeToken, { ...init, headers }),
    },
    async (response, lifecycleSignal) => {
      if (!response.ok) {
        await parseEnvelope<never>(response, token, false, requestGeneration, lifecycleSignal)
      }
      throwIfSessionSuperseded(token, requestGeneration)
      const blob = await response.blob()
      throwIfAborted(lifecycleSignal)
      throwIfSessionSuperseded(token, requestGeneration)
      syncSessionFromResponse(response, token)
      return blob
    },
    timeoutMs,
    { generation: requestGeneration, sourceToken: token },
  )
}

function uploadFilesRequest<T>(path: string, token: string | undefined, files: readonly File[], fieldName = 'file') {
  const form = new FormData()
  files.forEach((file) => form.append(fieldName, file, file.name))
  return request<T>(path, token, { method: 'POST', body: form })
}

export type DiscoverResearchScope = {
  teamId: string
  targetUserId: string
}

export type DiscoverResearchInput = {
  notify?: boolean
  /** Discover research is AI-orchestrated; deterministic crawling remains its evidence boundary. */
  useAi: true
  keyId: string
  keyIds: [string, ...string[]]
  teamId?: string
  targetUserId?: string
  acceptSuggestions?: boolean
}

function discoverScopePath(path: string, scope?: DiscoverResearchScope) {
  if (!scope) return path
  const params = new URLSearchParams({
    teamId: scope.teamId,
    targetUserId: scope.targetUserId,
  })
  return `${path}?${params.toString()}`
}

export type AdminAccessStatus = {
  hidden: boolean
  allowed: boolean
}

export const phdApi = {
  adminAccessStatus: () => request<AdminAccessStatus>('/api/admin-access/status', undefined, {}, 10_000),

  activateAdminAccess: (code: string) =>
    request<AdminAccessStatus>(
      '/api/admin-access/activate',
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({ code }),
      },
      10_000,
    ),

  rememberAdminAccess: () =>
    request<AdminAccessStatus>(
      '/api/admin-access/remember',
      undefined,
      {
        method: 'POST',
      },
      10_000,
    ),

  initialSetupStatus: (options: ApiReadOptions = {}) =>
    request<InitialSetupStatus>('/api/setup/status', undefined, { signal: options.signal }, 10_000),

  claimInitialSetup: (operatorToken: string) =>
    request<InitialSetupClaim>(
      '/api/setup/claim',
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({ token: operatorToken }),
      },
      10_000,
    ),

  initialSetupSecrets: (claimToken: string, options: ApiReadOptions = {}) =>
    request<BootstrapSecrets>(
      '/api/setup/secrets',
      undefined,
      {
        signal: options.signal,
        headers: { 'X-PhD-Bootstrap-Claim': claimToken },
      },
      10_000,
    ),

  completeInitialSetup: (input: InitialAdminSetupInput, claimToken: string) =>
    request<AuthSession>(
      '/api/setup',
      undefined,
      {
        method: 'POST',
        headers: { 'X-PhD-Bootstrap-Claim': claimToken },
        body: JSON.stringify(input),
      },
      30_000,
    ),

  sendInitialSetupSmtpVerification: (input: InitialSetupSmtpVerificationInput, claimToken: string) =>
    request<{ token: string; expiresInSeconds: number }>(
      '/api/setup/smtp-verification/send',
      undefined,
      {
        method: 'POST',
        headers: { 'X-PhD-Bootstrap-Claim': claimToken },
        body: JSON.stringify(input),
      },
      30_000,
    ),

  verifyInitialSetupSmtpVerification: (
    input: InitialSetupSmtpVerificationInput & { token: string; code: string },
    claimToken: string,
  ) =>
    request<{ verified: true; token: string }>(
      '/api/setup/smtp-verification/check',
      undefined,
      {
        method: 'POST',
        headers: { 'X-PhD-Bootstrap-Claim': claimToken },
        body: JSON.stringify(input),
      },
      15_000,
    ),

  login: (
    email: string,
    password: string,
    scope: 'app' | 'admin' = 'app',
    options: ApiReadOptions = {},
  ) => loginWithCapacityRetry(email, password, scope, options),

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

  listPasskeys: (token: string) => request<PasskeyCredentialSummary[]>('/api/auth/passkeys', token),

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

  listCodexAuthorizations: (token: string, options: ApiReadOptions = {}) =>
    request<CodexAuthorizationSummary[]>('/api/codex/authorizations', token, {
      signal: options.signal,
    }),

  createCodexAuthorization: (token: string, input: CodexAuthorizationCreateInput) =>
    request<CodexAuthorizationCreated>('/api/codex/authorizations', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCodexAuthorization: (token: string, id: string, name: string) =>
    request<{ authorization: CodexAuthorizationSummary }>(`/api/codex/authorizations/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }).then(({ authorization }) => authorization),

  /** Narrowing only — the server rejects any scope the grant never included. */
  updateCodexAuthorizationScopes: (token: string, id: string, scopes: string[]) =>
    request<{ authorization: CodexAuthorizationSummary }>(`/api/codex/authorizations/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ scopes }),
    }).then(({ authorization }) => authorization),

  setCodexAuthorizationDisabled: (token: string, id: string, disabled: boolean) =>
    request<{ authorization: CodexAuthorizationSummary }>(`/api/codex/authorizations/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    }).then(({ authorization }) => authorization),

  deleteCodexAuthorization: (token: string, id: string) =>
    request<{ authorization: CodexAuthorizationSummary }>(`/api/codex/authorizations/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }).then(({ authorization }) => authorization),

  previewCodexDeviceAuthorization: (token: string, userCode: string, options: ApiReadOptions = {}) =>
    request<CodexDeviceAuthorizationPreview>(
      `/api/codex/device-authorizations/${encodeURIComponent(userCode)}`,
      token,
      { signal: options.signal },
    ),

  approveCodexDeviceAuthorization: (token: string, userCode: string) =>
    request<CodexDeviceAuthorizationDecision>(
      `/api/codex/device-authorizations/${encodeURIComponent(userCode)}/approve`,
      token,
      { method: 'POST' },
    ),

  denyCodexDeviceAuthorization: (token: string, userCode: string) =>
    request<CodexDeviceAuthorizationDecision>(
      `/api/codex/device-authorizations/${encodeURIComponent(userCode)}/deny`,
      token,
      { method: 'POST' },
    ),

  impersonateUser: (token: string, userId: string, returnTo: 'app' | 'admin' = 'app', teamId?: string | null) =>
    request<AuthSession>('/api/auth/impersonate', token, {
      method: 'POST',
      body: JSON.stringify({ userId, returnTo, ...(teamId ? { teamId } : {}) }),
    }),

  captcha: () =>
    request<
      | {
          provider: 'math'
          question: string
          token: string
          expiresInSeconds: number
        }
      | {
          provider: 'turnstile'
          siteKey: string
          action: string
          expiresInSeconds: number
        }
    >('/api/auth/captcha'),

  sendRegisterEmailCode: (
    email: string,
    language: string,
    challenge: {
      provider: 'math' | 'turnstile'
      token: string
      answer?: string
    },
  ) =>
    request<{ token: string; expiresInSeconds: number }>('/api/auth/register/email-code', undefined, {
      method: 'POST',
      body: JSON.stringify({
        email,
        language,
        captchaProvider: challenge.provider,
        captchaToken: challenge.token,
        captchaAnswer: challenge.answer ?? '',
      }),
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
      body: JSON.stringify({
        name,
        email,
        password,
        captchaToken,
        captchaAnswer,
        emailCodeToken,
        emailCode,
        language,
      }),
    })
  },

  me: (token: string, options: ApiReadOptions = {}) =>
    conditionalRequest<{
      user: PublicUser
      settings: AdminSettings
      mailFetchStatus: MailFetchStatus
      usage?: AccountUsage
    }>('/api/auth/me', token, { signal: options.signal }),

  workspaceBootstrap: (token: string, teamId?: string | null, options: ApiReadOptions = {}) =>
    workspaceBootstrapRequest(token, teamId, options),

  listAiKeys: (token: string, options: ApiReadOptions = {}) =>
    conditionalRequest<AiKey[]>('/api/ai/keys', token, { signal: options.signal }, { freshForMs: 5_000 }),

  createAiKey: (token: string, input: AiKeyInput) =>
    request<AiKey>('/api/ai/keys', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAiKey: (
    token: string,
    id: string,
    input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey' | 'maxConcurrency' | 'requestMode' | 'weight' | 'enabled'>>,
  ) =>
    request<AiKey>(`/api/ai/keys/${encodeURIComponent(id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteAiKey: (token: string, id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/ai/keys/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),

  testAiKey: (token: string, id: string) =>
    request<{
      ok: boolean
      latencyMs: number
      provider: string
      model: string
      testedAt: string
    }>(`/api/ai/keys/${encodeURIComponent(id)}/test`, token, {
      method: 'POST',
      body: '{}',
    }),

  resetAiKeyUsage: (token: string, id: string) =>
    request<AiKey>(`/api/ai/keys/${encodeURIComponent(id)}/usage/reset`, token, { method: 'POST', body: '{}' }),

  streamAiDraft: (token: string, input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) =>
    streamAiDraftRequest(token, input, onEvent, signal),

  streamRealtimeUpdates: (token: string, onEvent: (event: RealtimeInvalidationEvent) => void, signal?: AbortSignal) =>
    streamRealtimeUpdatesRequest(token, onEvent, signal),

  listApplications: (token: string, options: ApiReadOptions = {}) =>
    listApplicationsRequest(token, options),

  getApplication: (token: string, id: string, options: ApiReadOptions = {}) =>
    conditionalRequest<ApplicationRecord>(
      `/api/applications/${encodeURIComponent(id)}`,
      token,
      { signal: options.signal },
      { freshForMs: DEFAULT_READ_FRESHNESS_MS, parseOffMain: true },
    ),

  getApplicationForNavigation: (token: string, id: string, options: ApiReadOptions = {}) =>
    applicationNavigationDetailRequest(token, id, options),

  createApplication: (token: string, input: CreateApplicationInput) =>
    createApplicationAcknowledged(request, applicationAcknowledgementFailure, token, input),

  resolveSchoolLogo: (token: string, applicationId: string, input: SchoolLogoResolveInput) =>
    request<SchoolLogoResolveResult>(
      `/api/applications/${applicationId}/school-logo/resolve`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      30_000,
    ),

  updateSchoolLogo: (token: string, application: ApplicationRecord, input: SchoolLogoPatchInput) =>
    updateSchoolLogoAcknowledged(request, applicationAcknowledgementFailure, token, application, input),

  updateApplication: updateApplicationRequest,

  resolveApplicationRecommender: async (
    token: string,
    applicationId: string,
    recommender: MaterialRecommender,
    expected: { applicationUpdatedAt: string; profileUpdatedAt?: string | null },
    decision: ApplicationRecommenderDecision = 'auto',
  ) => acknowledgeApplicationRecommenderWrite(
    applicationId,
    recommender,
    await request<ApplicationRecommenderMutationResult>(
      `/api/applications/${applicationId}/recommenders/${recommender.id}/resolve`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          recommender,
          decision,
          expectedApplicationUpdatedAt: expected.applicationUpdatedAt,
          expectedProfileUpdatedAt: expected.profileUpdatedAt,
        }),
      },
    ),
  ),

  replaceProfileRecommenders: async (
    token: string,
    profiles: ProfileRecommender[],
    baseProfiles: ProfileRecommender[],
  ) =>
    acknowledgeProfileRecommenderList(
      profiles,
      await request<ProfileRecommenderMutationResult>('/api/profile-recommenders', token, {
        method: 'PUT',
        body: JSON.stringify({ profiles, baseProfiles }),
      }),
    ),

  replayOfflineApplicationUpdate: (
    token: string,
    application: ApplicationRecord,
    // A record with no server timestamp has no delta baseline to verify
    // against; passing null replays the whole record instead of refusing.
    baseApplication: ApplicationRecord | null,
  ) => updateApplicationRequest(token, application, baseApplication),

  preflightApplicationTeamTransfer: (
    token: string,
    applicationId: string,
    input: { visibleToTeam: boolean; teamId?: string },
  ) =>
    request<TeamTransferPreflight>(
      `/api/applications/${applicationId}/team-transfer/preflight`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      10_000,
    ),

  updateApplicationTeamVisibility: (
    token: string,
    application: ApplicationRecord,
    visibleToTeam: boolean,
    teamId?: string,
  ) => updateApplicationTeamVisibilityAcknowledged(
    request,
    applicationAcknowledgementFailure,
    token,
    application,
    visibleToTeam,
    teamId,
  ),

  approveTeamTransferRequest: (
    token: string,
    teamId: string,
    requestId: string,
    application: ApplicationRecord,
    teacherMemberId?: string,
  ) => decideTeamTransferAcknowledged(
    request,
    applicationAcknowledgementFailure,
    token,
    teamId,
    requestId,
    'approve',
    application,
    teacherMemberId,
  ),

  rejectTeamTransferRequest: (
    token: string,
    teamId: string,
    requestId: string,
    application: ApplicationRecord,
  ) => decideTeamTransferAcknowledged(
    request,
    applicationAcknowledgementFailure,
    token,
    teamId,
    requestId,
    'reject',
    application,
  ),

  deleteApplication: (token: string, id: string) =>
    request<{ id: string; trashed?: boolean; trashId?: string | null }>(`/api/applications/${id}`, token, {
      method: 'DELETE',
    }),

  listApplicationTrash: (token: string, options: ApiReadOptions = {}) =>
    listApplicationTrashRequest(token, options),

  restoreApplicationFromTrash: (token: string, trashId: string, application: ApplicationRecord) =>
    restoreApplicationFromTrashAcknowledged(
      request,
      applicationAcknowledgementFailure,
      token,
      trashId,
      application,
    ),

  deleteApplicationTrashItem: (token: string, trashId: string) =>
    request<{ id: string; deleted: boolean }>(`/api/applications/trash/${trashId}`, token, {
      method: 'DELETE',
    }),

  emptyApplicationTrash: (token: string, scope: ApplicationTrashScope = { kind: 'personal' }) =>
    request<{ deleted: number }>(
      scope.kind === 'team'
        ? `/api/applications/trash?teamId=${encodeURIComponent(scope.teamId ?? '')}`
        : '/api/applications/trash?scope=personal',
      token,
      {
      method: 'DELETE',
      },
    ),

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
    const files = input.files?.length ? input.files : input.file ? [input.file] : []
    files.forEach((file) => form.append('file', file, file.name))
    return request<ApplicationRecord['materials'][number]>(`/api/applications/${applicationId}/materials`, token, {
      method: 'POST',
      body: form,
    })
  },

  addCommunication: (token: string, applicationId: string, input: CommunicationInput) =>
    request<ApplicationRecord['communications'][number]>(`/api/applications/${applicationId}/communications`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

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

  setCommunicationCategories: (
    token: string,
    applicationId: string,
    input: CommunicationCategoryPatchInput,
    options: ApiReadOptions = {},
  ) =>
    request<CommunicationClassificationBatchResult>(
      `/api/applications/${applicationId}/communications/categories`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: options.idempotencyKey
          ? { 'Idempotency-Key': options.idempotencyKey }
          : undefined,
        signal: options.signal,
      },
    ),

  classifyCommunications: (
    token: string,
    applicationId: string,
    input: CommunicationClassificationInput,
    options: ApiReadOptions = {},
  ) =>
    request<CommunicationClassificationBatchResult>(
      `/api/applications/${applicationId}/communications/classify`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: options.idempotencyKey
          ? { 'Idempotency-Key': options.idempotencyKey }
          : undefined,
        signal: options.signal,
      },
    ),

  getInterviewPrepWorkspace: (
    token: string,
    input: InterviewPrepScopeInput,
    options: ApiReadOptions = {},
  ) => getInterviewPrepWorkspaceRequest(token, input, options),

  saveInterviewPrepWorkspace: (
    token: string,
    input: InterviewPrepScopeInput & { workspace: InterviewPrepWorkspace; expectedRevision: number },
    options: ApiReadOptions = {},
  ) =>
    request<InterviewPrepWorkspace>('/api/interview-prep/workspace', token, {
      method: 'PUT',
      body: JSON.stringify(input),
      signal: options.signal,
    }),

  generateInterviewQuestions: (
    token: string,
    input: InterviewPrepAiInput & GenerateInterviewQuestionsRequest,
    options: ApiReadOptions = {},
  ) =>
    request<InterviewQuestion[]>('/api/interview-prep/ai/questions', token, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options.signal,
    }),

  generateInterviewFeedback: (
    token: string,
    input: InterviewPrepAiInput & GenerateInterviewFeedbackRequest,
    options: ApiReadOptions = {},
  ) =>
    request<InterviewFeedback[]>('/api/interview-prep/ai/feedback', token, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options.signal,
    }),

  generateInterviewMockTurn: (
    token: string,
    input: InterviewPrepAiInput & GenerateInterviewMockTurnRequest,
    options: ApiReadOptions = {},
  ) =>
    request<InterviewQuestion[]>('/api/interview-prep/ai/mock-turn', token, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options.signal,
    }),

  /** Actually sends the email over SMTP — unlike addCommunication, which only logs a record. */
  sendCommunication: (token: string, applicationId: string, input: CommunicationSendInput) => {
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
      return request<CommunicationSendResult>(sendPath, token, {
        method: 'POST',
        body: form,
      })
    }
    return request<CommunicationSendResult>(sendPath, token, {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        attachments: attachments.map((attachment) => cleanAttachment(attachment)),
      }),
    })
  },

  addScholarship: (
    token: string,
    applicationId: string,
    input: Omit<ApplicationRecord['scholarships'][number], 'id'>,
  ) =>
    request<ApplicationRecord['scholarships'][number]>(`/api/applications/${applicationId}/scholarships`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  addFee: (
    token: string,
    applicationId: string,
    input: {
      amount: number
      currency: string
      paidDate?: string
      waived: boolean
      notes: string
    },
  ) =>
    request<{
      id: string
      amount: number
      currency: string
      paidDate?: string | null
      waived: boolean
      notes: string
      createdAt: string
    }>(`/api/applications/${applicationId}/fees`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateFee: (
    token: string,
    applicationId: string,
    feeId: string,
    patch: {
      amount?: number
      currency?: string
      paidDate?: string | null
      waived?: boolean
      notes?: string
    },
  ) =>
    request<{
      id: string
      amount: number
      currency: string
      paidDate?: string | null
      waived: boolean
      notes: string
      createdAt: string
    }>(`/api/applications/${applicationId}/fees/${feeId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteFee: (token: string, applicationId: string, feeId: string) =>
    request<{ id: string }>(`/api/applications/${applicationId}/fees/${feeId}`, token, { method: 'DELETE' }),

  addTask: (
    token: string,
    applicationId: string,
    input: {
      title: string
      due: string
      done: boolean
      status?: string
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
    request<ApplicationRecord['tasks'][number]>(`/api/applications/${applicationId}/tasks`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  patchTask: (
    token: string,
    applicationId: string,
    taskId: string,
    input: Partial<{
      title: string
      due: string
      done: boolean
      status?: string
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
    request<ApplicationRecord['tasks'][number]>(`/api/applications/${applicationId}/tasks/${taskId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

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
    request<{
      id: string
      token: string
      url: string
      createdAt: string
      expiresAt: string | null
      permission: SharePermission
      sections: ShareSection[]
    }>(`/api/applications/${applicationId}/share`, token, {
      method: 'POST',
      body: JSON.stringify({
        expiresAt: expiresAt ?? null,
        permission,
        sections,
      }),
    }),

  revokeShare: (token: string, applicationId: string, shareId: string) =>
    request<{ id: string }>(`/api/applications/${applicationId}/share/${shareId}`, token, { method: 'DELETE' }),

  updateShare: (
    token: string,
    applicationId: string,
    shareId: string,
    expiresAt: string | null,
    permission?: SharePermission,
    sections?: ShareSection[],
  ) =>
    request<{
      id: string
      token: string
      url: string
      createdAt: string
      expiresAt: string | null
      permission: SharePermission
      sections: ShareSection[]
    }>(`/api/applications/${applicationId}/share/${shareId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expiresAt, permission, sections }),
    }),

  getSharedApplication: (token: string) => request<SharedApplicationPayload>(`/api/share/${encodeURIComponent(token)}`),

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

  removeSharedMaterialFile: (shareToken: string, materialId: string, fileId: string) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/materials/${encodeURIComponent(materialId)}/files/${encodeURIComponent(fileId)}`,
      undefined,
      { method: 'DELETE' },
    ),

  renameSharedMaterialFile: (shareToken: string, materialId: string, fileId: string, fileName: string) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/materials/${encodeURIComponent(materialId)}/files/${encodeURIComponent(fileId)}`,
      undefined,
      { method: 'PATCH', body: JSON.stringify({ fileName }) },
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

  removeSharedTaskFile: (shareToken: string, taskId: string, fileId: string) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}`,
      undefined,
      { method: 'DELETE' },
    ),

  renameSharedTaskFile: (shareToken: string, taskId: string, fileId: string, fileName: string) =>
    request<SharedApplicationPayload>(
      `/api/share/${encodeURIComponent(shareToken)}/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}`,
      undefined,
      { method: 'PATCH', body: JSON.stringify({ fileName }) },
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
    request<{ sent: boolean; delivery: string; resetUrl?: string }>('/api/auth/password-reset/request', undefined, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPasswordWithToken: (token: string, password: string) =>
    request<{ reset: boolean }>('/api/auth/password-reset/confirm', undefined, {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  restoreBackup: (token: string, fileName: string) =>
    request<{
      restored: boolean
      fileName: string
      application?: ApplicationRecord
    }>(`/api/backups/${encodeURIComponent(fileName)}/restore`, token, {
      method: 'POST',
    }),

  listProfileAssets: (token: string, options: ApiReadOptions = {}) =>
    listProfileAssetsRequest(token, options),

  listProfileRecommenders: (
    token: string,
    options: ApiReadOptions & { cursor?: string; limit?: number } = {},
  ) => listProfileRecommendersRequest(token, options),
  getProfileRecommender: (token: string, id: string) => getProfileRecommenderRequest(token, id),

  listTeamMemberProfileAssets: (
    token: string,
    teamId: string,
    userId: string,
    options: ApiReadOptions = {},
  ) => listTeamMemberProfileAssetsRequest(token, teamId, userId, options),

  listTeamMemberProfileRecommenders: (token: string, teamId: string, userId: string) =>
    conditionalRequest<ProfileRecommender[]>(
      `/api/teams/${teamId}/members/${userId}/profile-recommenders`,
      token,
      {},
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),

  replaceTeamMemberProfileRecommenders: async (
    token: string,
    teamId: string,
    userId: string,
    profiles: ProfileRecommender[],
    baseProfiles: ProfileRecommender[],
  ) => acknowledgeProfileRecommenderList(
    profiles,
    await request<ProfileRecommenderMutationResult>(
      `/api/teams/${teamId}/members/${userId}/profile-recommenders`,
      token,
      {
        method: 'PUT',
        body: JSON.stringify({ profiles, baseProfiles }),
      },
    ),
  ),

  addTeamMemberProfileAsset: async (token: string, teamId: string, userId: string, input: ProfileAssetInput) =>
    acknowledgeProfileAssetWrite(input, await request<ProfileAsset>(`/api/teams/${teamId}/members/${userId}/profile-assets`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    })),

  updateTeamMemberProfileAsset: (
    token: string,
    teamId: string,
    userId: string,
    assetId: string,
    input: Partial<ProfileAssetInput>,
  ) =>
    request<ProfileAsset>(`/api/teams/${teamId}/members/${userId}/profile-assets/${assetId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }).then((saved) => acknowledgeProfileAssetWrite(input, saved)),

  deleteTeamMemberProfileAsset: (token: string, teamId: string, userId: string, assetId: string) =>
    request<{ id: string }>(`/api/teams/${teamId}/members/${userId}/profile-assets/${assetId}`, token, {
      method: 'DELETE',
    }),

  addProfileAsset: async (token: string, input: ProfileAssetInput) =>
    acknowledgeProfileAssetWrite(input, await request<ProfileAsset>('/api/profile-assets', token, {
      method: 'POST',
      body: JSON.stringify(input),
    })),

  updateProfileAsset: (token: string, id: string, input: Partial<ProfileAssetInput>) =>
    request<ProfileAsset>(`/api/profile-assets/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }).then((saved) => acknowledgeProfileAssetWrite(input, saved)),

  downloadProfileAssetExport: (token: string, id: string, format: 'pdf' | 'word', language?: string) => {
    const params = new URLSearchParams({ format })
    if (language) params.set('language', language)
    return blobRequest(`/api/profile-assets/${encodeURIComponent(id)}/export?${params.toString()}`, token)
  },

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

  updateProfileAssetShare: (token: string, id: string, shareId: string, expiresAt: string | null, note?: string) =>
    request<ProfileAssetShare>(`/api/profile-assets/${id}/share/${shareId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        expiresAt,
        ...(note === undefined ? {} : { note }),
      }),
    }),

  revokeProfileAssetShare: (token: string, id: string, shareId: string) =>
    request<{ id: string }>(`/api/profile-assets/${id}/share/${shareId}`, token, {
      method: 'DELETE',
    }),

  getAssetUploadInfo: (uploadToken: string) =>
    request<{
      assetName: string
      note: string
      attachmentCount: number
      allowedFileTypes?: string[]
    }>(`/api/asset-upload/${encodeURIComponent(uploadToken)}`),

  uploadFilesToAssetShare: (uploadToken: string, files: readonly File[]) =>
    uploadFilesRequest<{
      assetName: string
      fileName: string
      fileNames: string[]
      attachmentCount: number
    }>(`/api/asset-upload/${encodeURIComponent(uploadToken)}/file`, undefined, files),

  uploadToAssetShare: (uploadToken: string, file: File) =>
    uploadFilesRequest<{
      assetName: string
      fileName: string
      fileNames?: string[]
      attachmentCount?: number
    }>(`/api/asset-upload/${encodeURIComponent(uploadToken)}/file`, undefined, [file]),

  updateSettings: updateSettingsRequest,

  getDiscoverCatalog: (token: string, scope?: DiscoverResearchScope, options: ApiReadOptions = {}) =>
    conditionalRequest<import('../data/discover').DiscoverCatalogPayload>(
      discoverScopePath('/api/discover/catalog', scope),
      token,
      { signal: options.signal },
      { freshForMs: 5_000 },
    ),

  getDiscoverState: (token: string, scope?: DiscoverResearchScope, options: ApiReadOptions = {}) =>
    conditionalRequest<import('../data/discover').DiscoverUserState>(
      discoverScopePath('/api/discover/state', scope),
      token,
      { signal: options.signal },
      { freshForMs: 5_000 },
    ),

  getDiscoverSourceIndex: (token: string, scope?: DiscoverResearchScope, options: ApiReadOptions = {}) =>
    conditionalRequest<import('../data/discover').DiscoverSourceIndex>(
      discoverScopePath('/api/discover/source-index', scope),
      token,
      { signal: options.signal },
      { freshForMs: 5_000 },
    ),

  updateDiscoverState: (
    token: string,
    patch: Partial<import('../data/discover').DiscoverUserState>,
    scope?: DiscoverResearchScope,
  ) =>
    request<import('../data/discover').DiscoverCatalogPayload>(discoverScopePath('/api/discover/state', scope), token, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  runDiscoverResearch: (token: string, input: DiscoverResearchInput) =>
    request<import('../data/discover').DiscoverResearchStartPayload>('/api/discover/research/start', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteDiscoverPrograms: (token: string, input: { ids: string[] } & Partial<DiscoverResearchScope>) =>
    request<import('../data/discover').DiscoverCatalogPayload>('/api/discover/programs/delete', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  importDiscoverProgram: (token: string, input: import('../data/discover').DiscoverImportInput) =>
    importDiscoverProgramAcknowledged(request, applicationAcknowledgementFailure, token, input),

  previewDiscoverApplicationEnrichment: (
    token: string,
    applicationId: string,
    input: { keyId: string; useAi?: true },
  ) =>
    request<import('../data/discover').DiscoverApplicationEnrichmentProposal>(
      `/api/discover/applications/${encodeURIComponent(applicationId)}/enrichment/preview`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      },
      360_000,
    ),

  applyDiscoverApplicationEnrichment: (
    token: string,
    application: ApplicationRecord,
    proposal: import('../data/discover').DiscoverApplicationEnrichmentProposal,
    acceptedChangeIds: string[],
  ) => applyDiscoverEnrichmentAcknowledged(
    request,
    applicationAcknowledgementFailure,
    token,
    application,
    proposal,
    acceptedChangeIds,
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
    request<{
      connected: boolean
      protocol: 'pop3' | 'imap'
      host: string
      port: number
    }>('/api/settings/test-incoming-mail', token, { method: 'POST' }),

  /** Syncs only messages newer than the committed per-folder IMAP cursors. */
  fetchMailNow: (token: string) =>
    request<MailSyncEnqueueResult>('/api/settings/fetch-mail-now', token, {
      method: 'POST',
    }),

  /** Backfills all historical incoming and sent mail that exactly matches tracked professor addresses. */
  syncMailHistory: (token: string) =>
    request<MailSyncEnqueueResult>('/api/settings/sync-mail-history', token, {
      method: 'POST',
    }),

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

  listNotifications: (
    token: string,
    options: {
      unreadOnly?: boolean
      archivedOnly?: boolean
      before?: string
    } = {},
  ) => {
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

  unreadNotificationCount: (token: string, options: ApiReadOptions = {}) =>
    conditionalRequest<{ count: number }>(
      '/api/notifications/unread-count',
      token,
      { signal: options.signal },
      { freshForMs: 15_000 },
    ),

  webPushPublicKey: (token: string) => request<{ publicKey: string }>('/api/push/public-key', token),

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

  testWebPush: (token: string) => request<WebPushTestResult>('/api/push/test', token, { method: 'POST' }),

  markNotificationRead: (token: string, id: string) =>
    request<{ id: string; read: boolean }>(`/api/notifications/${id}/read`, token, { method: 'POST' }),

  markNotificationUnread: (token: string, id: string) =>
    request<{ id: string; read: boolean }>(`/api/notifications/${id}/unread`, token, { method: 'POST' }),

  archiveNotification: (token: string, id: string) =>
    request<{ id: string; archived: boolean }>(`/api/notifications/${id}/archive`, token, { method: 'POST' }),

  markAllNotificationsRead: (token: string) =>
    request<{ updated: number }>('/api/notifications/read-all', token, {
      method: 'POST',
    }),

  updateNotificationsBulk: (token: string, ids: string[], action: 'mark_read' | 'mark_unread' | 'archive') =>
    request<{ updated: number }>('/api/notifications/bulk', token, {
      method: 'POST',
      body: JSON.stringify({ ids, action }),
    }),

  adminNotificationGroups: (token: string) => request<NotificationGroup[]>('/api/admin/notification-groups', token),

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

  listBackups: (token: string, applicationId?: string, options: ApiReadOptions = {}) =>
    conditionalRequest<BackupRecord[]>(
      `/api/backups${applicationId ? `?applicationId=${encodeURIComponent(applicationId)}` : ''}`,
      token,
      { signal: options.signal },
      { freshForMs: 5_000 },
    ),

  createBackup: (token: string, applicationId: string) =>
    request<BackupRecord>('/api/backups', token, {
      method: 'POST',
      body: JSON.stringify({ applicationId }),
    }),

  deleteBackup: (token: string, fileName: string) =>
    request<{ deleted: boolean; fileName: string }>(`/api/backups/${encodeURIComponent(fileName)}`, token, {
      method: 'DELETE',
    }),

  listAdminBackups: (token: string) => request<BackupRecord[]>('/api/admin/backups', token),

  createAdminBackup: (token: string) =>
    request<BackupRecord>('/api/admin/backups', token, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteAdminBackup: (token: string, fileName: string) =>
    request<{ deleted: boolean; fileName: string }>(`/api/admin/backups/${encodeURIComponent(fileName)}`, token, {
      method: 'DELETE',
    }),

  restoreAdminBackup: (token: string, fileName: string) =>
    request<AdminBackupRestoreResult>(
      `/api/admin/backups/${encodeURIComponent(fileName)}/restore`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    ),

  adminDatabaseConfiguration: (token: string) => request<DatabaseConfiguration>('/api/admin/database', token),

  testAdminDatabaseConfiguration: (token: string, input: DatabaseConnectionInput) =>
    request<DatabaseConfiguration>('/api/admin/database/test', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAdminDatabaseConfiguration: (token: string, input: DatabaseConnectionInput) =>
    request<DatabaseConfiguration>('/api/admin/database', token, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  downloadAdminBackup: (token: string, fileName: string) =>
    blobRequest(`/api/admin/backups/${encodeURIComponent(fileName)}/download`, token),

  adminUsers: (token: string) => request<AdminUser[]>('/api/admin/users', token),

  adminTeams: (token: string) => request<AdminTeamRecord[]>('/api/admin/teams', token),

  createAdminTeam: (token: string, name: string) =>
    request<AdminTeamRecord>('/api/admin/teams', token, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  adminLogs: (token: string, query: SystemLogQuery = {}) => {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
    })
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return request<SystemLogPage>(`/api/admin/logs${suffix}`, token)
  },

  clearAdminLogs: (token: string) =>
    request<{ deleted: number; logs: SystemLogPage }>('/api/admin/logs', token, {
      method: 'DELETE',
    }),

  updateAdminUser: (
    token: string,
    userId: string,
    input: {
      role?: UserRole
      disabled?: boolean
      membershipPlan?: MembershipPlan
      storageQuotaMb?: number
      applicationQuota?: number
      applicationCreateQuota?: number
      shareQuota?: number
      shareCreateQuota?: number
      seatLimit?: number
    },
  ) =>
    request<AdminUser>(`/api/admin/users/${userId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteAdminUser: (token: string, userId: string) =>
    request<{
      deleted: boolean
      id: string
      removed: {
        applicationCount: number
        assetCount: number
        backupCount: number
      }
    }>(`/api/admin/users/${userId}`, token, { method: 'DELETE' }),

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

  desktopRuntime: (token?: string) =>
    request<import('../desktopRuntime').DesktopRuntime>('/api/desktop/runtime', token ?? '', { method: 'GET' }),

  createDesktopSession: () => {
    resetClientSessionState()
    return request<AuthSession & { runtime?: import('../desktopRuntime').DesktopRuntime }>(
      '/api/desktop/session',
      undefined,
      { method: 'POST', body: JSON.stringify({}) },
    )
  },

  unlockDesktop: (password: string) => {
    resetClientSessionState()
    return request<AuthSession & { runtime?: import('../desktopRuntime').DesktopRuntime }>(
      '/api/desktop/unlock',
      undefined,
      { method: 'POST', body: JSON.stringify({ password }) },
    )
  },

  setDesktopUnlockPassword: (
    token: string,
    input: {
      enabled: boolean
      password?: string
      confirmPassword?: string
      currentPassword?: string
    },
  ) =>
    request<import('../desktopRuntime').DesktopRuntime>('/api/desktop/unlock-password', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  exportCompleteWorkspace: (token: string) =>
    request<Record<string, unknown>>('/api/workspace/complete-export', token),

  importCompleteWorkspace: (token: string, snapshot: Record<string, unknown>) =>
    request<{ applicationsImported: number, assetsImported: number, filesImported: number }>(
      '/api/desktop/import',
      token,
      { method: 'POST', body: JSON.stringify({ snapshot }) },
    ),

  connectDesktopRemote: (token: string, origin: string, email: string, password: string) =>
    request<{
      runtime: import('../desktopRuntime').DesktopRuntime
      pushed: number
      remoteApplicationCount: number
    }>('/api/desktop/connect', token, {
      method: 'POST',
      body: JSON.stringify({ origin, email, password }),
    }),

  disconnectDesktopRemote: (token: string) =>
    request<import('../desktopRuntime').DesktopRuntime>('/api/desktop/disconnect', token, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  downloadFile: (token: string, fileId: string) =>
    blobRequest(`/api/files/${encodeURIComponent(fileId)}/download`, token),

  changeAdminPassword: (token: string, currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/api/admin/change-password', token, {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  systemInfo: (token: string) => request<SystemInfo>('/api/admin/system-info', token),

  bootstrapSecrets: (token: string) => request<BootstrapSecrets>('/api/admin/bootstrap-secrets', token),

  regenerateBootstrapSecrets: (token: string) =>
    request<BootstrapSecrets>('/api/admin/bootstrap-secrets/regenerate', token, {
      method: 'POST',
      body: JSON.stringify({ confirm: 'REGENERATE' }),
    }),

  uploadSystemUpdate: async (token: string, file: File) => {
    const requestGeneration = clientSessionGeneration
    const form = new FormData()
    form.set('package', file)
    return fetchWithTimeout(
      '/api/admin/system-update',
      {
        method: 'POST',
        headers: requestHeaders(token, { body: form }),
        body: form,
      },
      (response, lifecycleSignal) =>
        parseEnvelope<SystemUpdateResult>(response, token, false, requestGeneration, lifecycleSignal),
      SYSTEM_UPDATE_REQUEST_TIMEOUT_MS,
      { generation: requestGeneration, sourceToken: token },
    )
  },

  checkSystemUpdate: (token: string, options: ApiReadOptions = {}) =>
    request<ReleaseUpdateCheck>('/api/admin/system-update/check', token, {
      signal: options.signal,
    }),

  systemUpdateStatus: (token: string, options: ApiReadOptions = {}) =>
    request<SystemUpdateStatus>('/api/admin/system-update/status', token, {
      signal: options.signal,
    }),

  systemUpdateLogs: (token: string, limit = 80, options: ApiReadOptions = {}) =>
    request<SystemUpdateLogs>(`/api/admin/system-update/logs?limit=${encodeURIComponent(String(limit))}`, token, {
      signal: options.signal,
    }),

  installReleaseUpdate: (token: string, tagName: string) =>
    request<SystemUpdateResult>(
      '/api/admin/system-update/install-release',
      token,
      {
        method: 'POST',
        body: JSON.stringify({ tagName }),
      },
      SYSTEM_UPDATE_REQUEST_TIMEOUT_MS,
    ),

  deleteSystemUpdate: (token: string, storedAs: string) =>
    request<{ deleted: boolean; storedAs: string }>(`/api/admin/system-update/${encodeURIComponent(storedAs)}`, token, {
      method: 'DELETE',
    }),

  myTeamWorkspaces: (token: string, options: ApiReadOptions = {}) =>
    conditionalRequest<TeamWorkspaceOption[]>(
      '/api/teams/mine/workspaces',
      token,
      { signal: options.signal },
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),

  myTeam: (token: string, teamId?: string | null, options: ApiReadOptions = {}) =>
    conditionalRequest<TeamSummary | null>(
      `/api/teams/mine${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`,
      token,
      { signal: options.signal },
      { freshForMs: DEFAULT_READ_FRESHNESS_MS },
    ),

  listTeamApplications: (token: string, teamId?: string | null, options: ApiReadOptions = {}) =>
    listTeamApplicationsRequest(token, teamId, options),

  updateTeam: (
    token: string,
    teamId: string,
    input: {
      name?: string
      seatLimit?: number
      logoDataUrl?: string
      roleLabels?: { admin?: string; member?: string }
      permissionDefaults?: {
        student?: Partial<TeamStudentPermissions>
        teacher?: Partial<TeamTeacherPermissions>
      }
    },
  ) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  renameTeam: (token: string, teamId: string, name: string) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  updateTeamPermissionDefaults: (
    token: string,
    teamId: string,
    permissionDefaults: {
      student?: Partial<TeamStudentPermissions>
      teacher?: Partial<TeamTeacherPermissions>
    },
  ) =>
    request<Team>(`/api/teams/${teamId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ permissionDefaults }),
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
    request<{ id: string; deleted: boolean; affectedApplications: number }>(`/api/teams/${teamId}`, token, {
      method: 'DELETE',
    }),

  listTeamMembers: (token: string, teamId: string) => request<TeamSummary>(`/api/teams/${teamId}/members`, token),

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

  inviteTeamMember: (
    token: string,
    teamId: string,
    email: string,
    role: Exclude<TeamRole, 'owner'>,
    teacherIds: string[] = [],
  ) =>
    request<TeamMember>(`/api/teams/${teamId}/members`, token, {
      method: 'POST',
      body: JSON.stringify({ email, role, teacherIds }),
    }),

  createTeamJoinCode: (token: string, teamId: string, input: { role: TeamRole; teacherIds?: string[] }) =>
    request<TeamJoinCode>(`/api/teams/${teamId}/join-codes`, token, {
      method: 'POST',
      body: JSON.stringify(input),
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
      teacherIds?: string[]
      studentPermissions?: Partial<TeamStudentPermissions> | null
      teacherPermissions?: Partial<TeamTeacherPermissions> | null
    },
  ) =>
    request<TeamMember>(`/api/teams/${teamId}/members/${memberId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  updateMyTeamContactProfile: (token: string, teamId: string, input: TeamMemberContactProfile) =>
    request<TeamMember>(`/api/teams/${teamId}/members/me/contact-profile`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeTeamMember: (token: string, teamId: string, memberId: string, inviteOnly = false) =>
    request<{ id: string; removed: boolean }>(`/api/teams/${teamId}/members/${memberId}${inviteOnly ? '?invite=1' : ''}`, token, {
      method: 'DELETE',
    }),

  createTeamTeacherGroup: (token: string, teamId: string, input: { name: string; memberIds?: string[] }) =>
    request<TeamTeacherGroup>(`/api/teams/${teamId}/teacher-groups`, token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTeamTeacherGroup: (
    token: string,
    teamId: string,
    groupId: string,
    input: { name?: string; memberIds?: string[] },
  ) =>
    request<TeamTeacherGroup>(`/api/teams/${teamId}/teacher-groups/${groupId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteTeamTeacherGroup: (token: string, teamId: string, groupId: string) =>
    request<{ id: string; deleted: boolean }>(`/api/teams/${teamId}/teacher-groups/${groupId}`, token, {
      method: 'DELETE',
    }),

  getTeamInvite: (inviteToken: string) =>
    request<TeamInvitePreview>(`/api/teams/invites/${encodeURIComponent(inviteToken)}`),

  getTeamJoinCode: (code: string) => request<TeamJoinCodePreview>(`/api/teams/join-codes/${encodeURIComponent(code)}`),

  redeemTeamJoinCode: (token: string, code: string) =>
    request<{ membership: TeamMember; team: Team }>(`/api/teams/join-codes/${encodeURIComponent(code)}/redeem`, token, {
      method: 'POST',
    }),

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

  addReviewComment: (
    token: string,
    applicationId: string,
    body: string,
    targetTab?: ReviewComment['targetTab'],
    parentId?: string,
    mentionedUserIds?: string[],
  ) =>
    request<ReviewComment>(`/api/applications/${applicationId}/review-comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body, targetTab, parentId, mentionedUserIds }),
    }),

  requestApplicationFeedback: (token: string, applicationId: string, note = '') =>
    request<{ requested: boolean; notified: number }>(`/api/applications/${applicationId}/request-feedback`, token, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  queryAdmissionOutcomes: (
    token: string,
    input: AdmissionOutcomesInput,
    options: ApiReadOptions = {},
  ) =>
    request<AdmissionOutcomesResponse>(
      '/api/sources/admission-outcomes',
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options.signal,
      },
      120_000,
    ),

  queryAdvisorSignals: (
    token: string,
    input: AdvisorSignalsInput,
    options: ApiReadOptions = {},
  ) =>
    request<AdvisorSignalsResponse>(
      '/api/sources/advisor-signals',
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options.signal,
      },
      120_000,
    ),

  /** The last saved lookup, so reopening the tab shows the previous answer. */
  getAdmissionSignalReport: (
    token: string,
    applicationId: string,
    options: ApiReadOptions = {},
  ) =>
    conditionalRequest<{
      report: AdmissionSignalReport | null
      stale?: boolean
      target?: AdmissionSignalReport['target']
      staleTarget?: AdmissionSignalReport['target'] | null
    }>(
      `/api/applications/${applicationId}/admission-signals`,
      token,
      { signal: options.signal },
      { freshForMs: 10_000 },
    ),

  /**
   * Runs a lookup and saves it. The school, programme and professor come from
   * the stored application on the server, never from here, so the saved report
   * is provably about the record it is filed against.
   */
  refreshAdmissionSignalReport: (
    token: string,
    applicationId: string,
    input: { keyId?: string; year?: number } = {},
    options: ApiReadOptions = {},
  ) =>
    request<{ report: AdmissionSignalReport }>(
      `/api/applications/${applicationId}/admission-signals`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options.signal,
      },
      180_000,
    ),

  getAdmissionSignalHistory: (token: string, applicationId: string, options: ApiReadOptions = {}) =>
    conditionalRequest<{ trend: AdmissionSignalObservation[] }>(
      `/api/applications/${applicationId}/admission-signals/history`,
      token,
      { signal: options.signal },
      { freshForMs: 10_000 },
    ).then((data) => data.trend || []),

  getAdmissionBookmarks: (token: string, applicationId?: string, options: ApiReadOptions = {}) =>
    conditionalRequest<{ bookmarks: AdmissionBookmark[] }>(
      applicationId ? `/api/admission-bookmarks?applicationId=${applicationId}` : '/api/admission-bookmarks',
      token,
      { signal: options.signal },
      { freshForMs: 10_000 },
    ).then((data) => data.bookmarks || []),

  createAdmissionBookmark: (
    token: string,
    bookmark: {
      applicationId: string
      type: AdmissionBookmark['type']
      title: string
      data: Record<string, unknown>
      note?: string
    },
  ) =>
    request<{ bookmarkId: string }>('/api/admission-bookmarks', token, {
      method: 'POST',
      body: JSON.stringify(bookmark),
    }).then((data) => data.bookmarkId),

  deleteAdmissionBookmark: (token: string, bookmarkId: string) =>
    request<void>(`/api/admission-bookmarks/${bookmarkId}`, token, {
      method: 'DELETE',
    }),

  exportAdmissionReportToPdf: () => {
    window.print()
  },
}
