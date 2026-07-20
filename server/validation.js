import { z } from 'zod'

export const ApplicationStatusSchema = z.enum([
  'Draft',
  'Preparing',
  'Submitted',
  'Interview',
  'Accepted',
  'Rejected',
  'Waitlist',
])

export const MaterialStatusSchema = z.string().trim().min(1).max(64)

const ReminderDateSchema = z.union([z.iso.date(), z.literal('')]).default('')
const OptionalUrlSchema = z.union([z.url(), z.literal('')])

const MaterialRecommenderSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  contact: z.string(),
})

export const ChannelSchema = z.enum(['Email', 'Message', 'Note', 'Interview', 'Card', 'Meeting', 'Portal'])
export const CommunicationDirectionSchema = z.enum(['incoming', 'outgoing', 'note'])
export const BackupFrequencySchema = z.enum(['1m', '5m', '15m', '30m', '1h', '3h', '6h', '12h', 'daily', '3d', '7d', 'weekly', 'monthly'])
export const SharePermissionSchema = z.enum(['view', 'upload', 'edit'])
export const ShareSectionSchema = z.enum([
  'overview',
  'materials',
  'tasks',
  'communications',
  'funding',
  'timeline',
  'versions',
])
export const TeamMemberRoleSchema = z.enum(['owner', 'admin', 'member'])
export const InvitableTeamMemberRoleSchema = z.enum(['admin', 'member'])
// Keep open-ended so the client can expand the icon catalog without a server enum churn.
// Display still falls back to a default glyph when an unknown id is stored.
export const ProfilePresetIconSchema = z.string().trim().min(1).max(48)
export const ProfilePresetColorSchema = z.enum(['system', 'blue', 'purple', 'green', 'orange', 'pink', 'teal', 'gray'])
export const ProfilePresetBaseSchema = z.object({
  kind: z.string().trim().min(1).max(120),
  nameZh: z.string().trim().max(120),
  nameEn: z.string().trim().max(120),
  descriptionZh: z.string().trim().max(300),
  descriptionEn: z.string().trim().max(300),
  contentZh: z.string().trim().max(4000),
  contentEn: z.string().trim().max(4000),
  icon: ProfilePresetIconSchema,
  color: ProfilePresetColorSchema,
}).refine((value) => value.nameZh.length > 0 || value.nameEn.length > 0, {
  message: 'A preset needs at least one localized name.',
  path: ['nameZh'],
})
export const StoredProfilePresetSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.string().trim().min(1).max(120),
  nameZh: z.string().trim().max(120),
  nameEn: z.string().trim().max(120),
  descriptionZh: z.string().trim().max(300),
  descriptionEn: z.string().trim().max(300),
  contentZh: z.string().trim().max(4000),
  contentEn: z.string().trim().max(4000),
  icon: ProfilePresetIconSchema,
  color: ProfilePresetColorSchema,
  builtIn: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).refine((value) => value.nameZh.length > 0 || value.nameEn.length > 0, {
  message: 'A preset needs at least one localized name.',
  path: ['nameZh'],
})
export const TeamProfilePresetCreateSchema = z.object({
  kind: z.string().trim().min(1).max(120),
  nameZh: z.string().trim().max(120),
  nameEn: z.string().trim().max(120),
  descriptionZh: z.string().trim().max(300),
  descriptionEn: z.string().trim().max(300),
  contentZh: z.string().trim().max(4000),
  contentEn: z.string().trim().max(4000),
  icon: ProfilePresetIconSchema,
  color: ProfilePresetColorSchema,
  syncToTeachers: z.boolean().optional().default(false),
  syncToStudents: z.boolean().optional().default(false),
}).refine((value) => value.nameZh.length > 0 || value.nameEn.length > 0, {
  message: 'A preset needs at least one localized name.',
  path: ['nameZh'],
})
export const TeamProfilePresetPatchSchema = z.object({
  kind: z.string().trim().min(1).max(120).optional(),
  nameZh: z.string().trim().max(120).optional(),
  nameEn: z.string().trim().max(120).optional(),
  descriptionZh: z.string().trim().max(300).optional(),
  descriptionEn: z.string().trim().max(300).optional(),
  contentZh: z.string().trim().max(4000).optional(),
  contentEn: z.string().trim().max(4000).optional(),
  icon: ProfilePresetIconSchema.optional(),
  color: ProfilePresetColorSchema.optional(),
  syncToTeachers: z.boolean().optional(),
  syncToStudents: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Preset update cannot be empty.' })

export const ReviewCommentSchema = z.object({
  id: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string(),
  body: z.string().min(1),
  createdAt: z.string(),
  targetTab: z.enum(['dossier', 'materials', 'mail', 'funding', 'timeline', 'review']).optional(),
  parentId: z.string().min(1).optional(),
  mentionedUserIds: z.array(z.string().min(1)).optional().default([]),
})

export const ReviewCommentCreateSchema = z.object({
  body: z.string().min(1).max(4000),
  targetTab: z.enum(['dossier', 'materials', 'mail', 'funding', 'timeline', 'review']).optional(),
  parentId: z.string().min(1).optional(),
  mentionedUserIds: z.array(z.string().min(1)).max(20).optional().default([]),
})

export const TeamInviteCreateSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: InvitableTeamMemberRoleSchema,
})

export const TeamMemberRolePatchSchema = z.object({
  role: InvitableTeamMemberRoleSchema.optional(),
  invitedBy: z.string().min(1).optional(),
}).refine((value) => value.role !== undefined || value.invitedBy !== undefined, {
  message: 'Team member update must include a role or advisor.',
})

export const TeamPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  seatLimit: z.number().int().min(1).max(500).optional(),
  roleLabels: z.object({
    admin: z.string().trim().max(40).optional(),
    member: z.string().trim().max(40).optional(),
  }).optional(),
}).refine((value) => (
  value.name !== undefined
  || value.seatLimit !== undefined
  || value.roleLabels !== undefined
), {
  message: 'Team update must include a name, seat limit, or role labels.',
})

export const NotificationGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().min(1)).max(500).default([]),
})

export const NotificationPublishSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  channels: z.array(z.enum(['in_app', 'email'])).min(1).default(['in_app']),
  userIds: z.array(z.string().min(1)).max(500).optional().default([]),
  memberIds: z.array(z.string().min(1)).max(500).optional().default([]),
  groupIds: z.array(z.string().min(1)).max(100).optional().default([]),
  audiences: z.array(z.string().min(1).max(64)).max(20).optional().default([]),
})

export const PushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine((value) => value.startsWith('https://'), {
    message: 'Push subscription endpoint must use HTTPS.',
  }),
  keys: z.object({
    p256dh: z.string().min(16).max(512),
    auth: z.string().min(8).max(256),
  }),
})

export const PushSubscriptionDeleteSchema = z.object({
  endpoint: z.url().max(2048).refine((value) => value.startsWith('https://'), {
    message: 'Push subscription endpoint must use HTTPS.',
  }),
})

export const UserAuthSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  scope: z.enum(['app', 'admin']).optional().default('app'),
})

export const RegisterSchema = UserAuthSchema.extend({
  name: z.string().min(1).max(80),
  language: z.string().min(2).max(12).default('en'),
  captchaToken: z.string().min(16),
  captchaAnswer: z.string().min(1).max(8),
  emailCodeToken: z.string().min(16),
  emailCode: z.string().min(4).max(8),
})

export const SendEmailCodeSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  language: z.string().min(2).max(12).optional().default('en'),
})

export const PasswordResetRequestSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
})

export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(8).max(128),
})

const PasskeyLabelSchema = z.string().trim().max(80).optional()

export const PasskeyRegistrationStartSchema = z.object({
  label: PasskeyLabelSchema,
})

export const PasskeyRegistrationVerifySchema = z.object({
  label: PasskeyLabelSchema,
  response: z.any(),
})

export const PasskeyUpdateSchema = z.object({
  label: z.string().trim().min(1).max(80),
})

export const PasskeyAuthenticationStartSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()).or(z.literal('')).optional(),
  scope: z.enum(['app', 'admin']).optional().default('app'),
})

export const PasskeyAuthenticationVerifySchema = z.object({
  response: z.any(),
  scope: z.enum(['app', 'admin']).optional().default('app'),
})

export const ImpersonateUserSchema = z.object({
  userId: z.string().min(1),
  returnTo: z.enum(['app', 'admin']).optional().default('app'),
  teamId: z.string().min(1).optional(),
})

const FileVersionSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  author: z.string().min(1),
  createdAt: z.string().min(1),
  fileId: z.string().optional(),
  storageName: z.string().optional(),
  size: z.number().nonnegative().optional(),
  mimeType: z.string().optional(),
})

export const MaterialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  status: MaterialStatusSchema,
  group: z.string().default('Core materials'),
  details: z.string().default(''),
  reminderEnabled: z.boolean().default(false),
  reminderDate: ReminderDateSchema,
  reminderTime: z.string().default(''),
  reminderRepeat: z.string().default('once'),
  uploadReserved: z.boolean().optional().default(false),
  allowedFileTypes: z.array(z.string()).optional().default([]),
  requiredCount: z.number().int().min(1).max(12).default(1),
  recommenders: z.array(MaterialRecommenderSchema).default([]),
  version: z.string().min(1),
  updatedAt: z.iso.date(),
  fileId: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().nonnegative().optional(),
  mimeType: z.string().optional(),
  storageName: z.string().optional(),
  versions: z.array(FileVersionSchema).default([]),
})

export const CommunicationSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  channel: ChannelSchema,
  date: z.iso.date(),
  summary: z.string().min(1),
  direction: CommunicationDirectionSchema.default('note'),
  messageType: z.string().default('note'),
  from: z.string().default(''),
  to: z.string().default(''),
  time: z.string().default(''),
  deliveryStatus: z.enum(['sent', 'log-only']).optional(),
  sourceMessageKey: z.string().optional(),
  sourceMailbox: z.string().optional(),
  importedAt: z.string().optional(),
})

const ScholarshipStatusSchema = z.enum(['Draft', 'Preparing', 'Submitted', 'Awarded', 'Rejected'])

const ScholarshipMaterialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: MaterialStatusSchema.default('Draft'),
  due: ReminderDateSchema,
  details: z.string().optional().default(''),
})

const ScholarshipTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  due: z.iso.date(),
  done: z.boolean().default(false),
  details: z.string().optional().default(''),
})

const ScholarshipTimelineEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  date: z.iso.date(),
  note: z.string().optional().default(''),
})

export const ScholarshipSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().default(''),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  school: z.string().optional().default(''),
  issuer: z.string().optional().default(''),
  status: ScholarshipStatusSchema.optional().default('Preparing'),
  notes: z.string().optional().default(''),
  materials: z.array(ScholarshipMaterialSchema).optional().default([]),
  tasks: z.array(ScholarshipTaskSchema).optional().default([]),
  timeline: z.array(ScholarshipTimelineEventSchema).optional().default([]),
})

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  due: z.iso.date(),
  done: z.boolean(),
  details: z.string().optional().default(''),
  reminderEnabled: z.boolean().optional().default(false),
  reminderOffsets: z.array(z.string()).optional().default([]),
  reminderTime: z.string().optional().default(''),
  reminderRepeat: z.string().optional().default('once'),
  attachmentRequired: z.boolean().optional().default(false),
  uploadReserved: z.boolean().optional().default(false),
  allowedFileTypes: z.array(z.string()).optional().default([]),
  fileId: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().nonnegative().optional(),
  mimeType: z.string().optional(),
  storageName: z.string().optional(),
  versions: z.array(FileVersionSchema).optional().default([]),
})

export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  date: z.iso.date(),
  note: z.string().default(''),
})

export const DossierCardFieldTypeSchema = z.enum([
  'url',
  'text',
  'textarea',
  'email',
  'phone',
  'contact',
  'tags',
  'date',
])

export const DossierCardFieldSchema = z.object({
  id: z.string().min(1),
  type: DossierCardFieldTypeSchema.default('text'),
  label: z.string().max(80).default(''),
  value: z.string().max(5000).default(''),
  width: z.enum(['half', 'full']).optional().default('half'),
})

export const DossierCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(100).default(''),
  icon: z.string().min(1).max(40).default('link'),
  color: z.string().min(1).max(40).default('blue'),
  width: z.enum(['half', 'full']).optional().default('half'),
  fields: z.array(DossierCardFieldSchema).max(24).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const FeeSchema = z.object({
  id: z.string().min(1),
  amount: z.number().positive().max(10000),
  currency: z.string().min(1).max(10),
  paidDate: z.iso.date().nullable().optional(),
  waived: z.boolean().default(false),
  notes: z.string().max(500).default(''),
  createdAt: z.string(),
})

export const FeeCreateSchema = z.object({
  amount: z.number().positive().max(10000),
  currency: z.string().min(1).max(10).default('USD'),
  paidDate: z.iso.date().optional(),
  waived: z.boolean().default(false),
  notes: z.string().max(500).default(''),
})

export const FeePatchSchema = z.object({
  amount: z.number().positive().max(10000).optional(),
  currency: z.string().min(1).max(10).optional(),
  paidDate: z.iso.date().nullable().optional(),
  waived: z.boolean().optional(),
  notes: z.string().max(500).optional(),
})

export const ApplicationSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1).optional(),
  teamId: z.string().min(1).nullable().optional(),
  teamTransferRequest: z
    .object({
      id: z.string().min(1),
      teamId: z.string().min(1),
      direction: z.enum(['join', 'leave']),
      status: z.enum(['pending', 'approved', 'rejected']),
      requestedBy: z.string().min(1),
      requestedAt: z.string(),
      decidedBy: z.string().min(1).nullable().optional(),
      decidedAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  professor: z.object({
    english: z.string().min(1),
    chinese: z.string(),
    email: z.email(),
    phone: z.string(),
    social: z.string(),
    homepage: OptionalUrlSchema,
    research: z.string().min(1),
    lab: z.string(),
  }),
  school: z.object({
    name: z.string().min(1),
    country: z.string().min(1),
    website: OptionalUrlSchema,
  }),
  program: z.string().min(1),
  deadline: z.iso.date(),
  status: ApplicationStatusSchema,
  progress: z.number().min(0).max(100),
  priority: z.number().min(0).max(100),
  tags: z.array(z.string()),
  nextReminder: z.iso.date(),
  result: z.string(),
  dossierCards: z.array(DossierCardSchema).optional(),
  materials: z.array(MaterialSchema),
  communications: z.array(CommunicationSchema),
  reviewComments: z.array(ReviewCommentSchema).optional().default([]),
  scholarships: z.array(ScholarshipSchema),
  fees: z.array(FeeSchema).optional().default([]),
  tasks: z.array(TaskSchema),
  timeline: z.array(TimelineEventSchema),
  versions: z.array(FileVersionSchema).default([]),
  shares: z
    .array(
      z.object({
        id: z.string(),
        token: z.string(),
        createdAt: z.string(),
        expiresAt: z.string().nullable(),
        permission: SharePermissionSchema.optional().default('view'),
        sections: z.array(ShareSectionSchema).optional(),
      }),
    )
    .default([]),
  backupSettings: z
    .object({
      autoBackup: z.boolean().default(false),
      frequency: BackupFrequencySchema.default('15m'),
      maxBackups: z.number().int().min(1).max(100).default(5),
      lastAutoBackupAt: z.string().optional(),
    })
    .default({ autoBackup: false, frequency: '15m', maxBackups: 5 }),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const CreateApplicationSchema = z.object({
  professor: z.string().min(1),
  professorChinese: z.string().optional().default(''),
  professorEmail: z.email(),
  professorHomepage: OptionalUrlSchema.optional().default(''),
  university: z.string().min(1),
  country: z.string().min(1).default('United States'),
  website: OptionalUrlSchema.optional().default(''),
  program: z.string().min(1),
  deadline: z.iso.date(),
  notes: z.string().optional().default(''),
  visibleToTeam: z.boolean().optional().default(false),
  ownerId: z.string().min(1).optional(),
})

export const TeamVisibilityPatchSchema = z.object({
  visibleToTeam: z.boolean(),
})

export const AiProviderSchema = z.enum(['openai', 'deepseek', 'anthropic', 'gemini'])
export const AiKeyScopeSchema = z.enum(['personal', 'team'])

export const AiKeyCreateSchema = z.object({
  scope: AiKeyScopeSchema.default('personal'),
  teamId: z.string().min(1).max(128).nullable().optional(),
  provider: AiProviderSchema,
  label: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160),
  baseUrl: z.string().trim().max(500).optional().default(''),
  apiKey: z.string().trim().min(8).max(1000),
})

export const AiKeyPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().min(8).max(1000).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'AI key update must include at least one field.',
})

export const AiUserProfileSchema = z.object({
  preferredName: z.string().trim().max(120).default(''),
  pronouns: z.string().trim().max(80).default(''),
  location: z.string().trim().max(160).default(''),
  timezone: z.string().trim().max(80).default(''),
  citizenship: z.string().trim().max(160).default(''),
  currentRole: z.string().trim().max(160).default(''),
  institution: z.string().trim().max(200).default(''),
  degree: z.string().trim().max(160).default(''),
  field: z.string().trim().max(160).default(''),
  graduation: z.string().trim().max(32).default(''),
  researchInterests: z.string().trim().max(4000).default(''),
  researchMethods: z.string().trim().max(2000).default(''),
  achievements: z.string().trim().max(4000).default(''),
  goals: z.string().trim().max(3000).default(''),
  writingLanguage: z.string().trim().max(40).default(''),
  writingTone: z.string().trim().max(120).default(''),
  signature: z.string().trim().max(1000).default(''),
  boundaries: z.string().trim().max(2000).default(''),
})

const AiAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  contentBase64: z.string().min(1).max(4 * 1024 * 1024),
})

export const AiDraftRequestSchema = z.object({
  keyId: z.string().min(1).max(128),
  applicationId: z.string().min(1).max(128),
  mode: z.enum(['compose', 'reply']),
  instructions: z.string().trim().min(1).max(4000),
  replyToId: z.string().min(1).max(128).optional(),
  currentDraft: z.object({
    subject: z.string().max(512),
    body: z.string().max(30_000),
  }).optional(),
  grants: z.object({
    userProfile: z.boolean().default(false),
    dossier: z.boolean().default(true),
    checklist: z.boolean().default(false),
    scholarships: z.boolean().default(false),
    tasks: z.boolean().default(false),
    correspondence: z.boolean().default(false),
    attachments: z.boolean().default(false),
  }),
  attachments: z.array(AiAttachmentSchema).max(3).optional().default([]),
})

export const OfflineReplayMetadataSchema = z.object({
  clientBaseUpdatedAt: z.string().trim().min(1).max(64).optional(),
})

export function hasOfflineReplayConflict(currentUpdatedAt, clientBaseUpdatedAt) {
  return Boolean(
    clientBaseUpdatedAt &&
    currentUpdatedAt &&
    clientBaseUpdatedAt !== currentUpdatedAt
  )
}

export const MaterialCreateSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1).default('File'),
  status: MaterialStatusSchema.default('Draft'),
  group: z.string().optional().default('Custom'),
  details: z.string().optional().default(''),
  reminderEnabled: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  reminderDate: ReminderDateSchema,
  requiredCount: z.coerce.number().int().min(1).max(12).optional().default(1),
})

export const ProfileAssetCreateSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1).default('Other'),
  description: z.string().default(''),
  notes: z.string().default(''),
  customLabelZh: z.string().optional(),
  customLabelEn: z.string().optional(),
  icon: ProfilePresetIconSchema.optional(),
  color: ProfilePresetColorSchema.optional(),
  familyId: z.string().min(1).max(120).optional(),
  versionLabel: z.string().max(80).optional(),
  versionNumber: z.number().int().min(1).max(9999).optional(),
  isPrimary: z.boolean().optional(),
  familyName: z.string().max(160).optional(),
  uploadReserved: z.boolean().optional().default(false),
  allowedFileTypes: z.array(z.string()).optional().default([]),
})

export const ProfileAssetPatchSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  customLabelZh: z.string().optional(),
  customLabelEn: z.string().optional(),
  icon: ProfilePresetIconSchema.optional(),
  color: ProfilePresetColorSchema.optional(),
  familyId: z.string().min(1).max(120).optional(),
  versionLabel: z.string().max(80).optional(),
  versionNumber: z.number().int().min(1).max(9999).optional(),
  isPrimary: z.boolean().optional(),
  familyName: z.string().max(160).optional(),
  uploadReserved: z.boolean().optional(),
  allowedFileTypes: z.array(z.string()).optional(),
})

export const ProfileAssetFileRenameSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
})

/** Rename a checklist/task attachment version without re-uploading the blob. */
export const ChecklistFileRenameSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
})

export const ProfileAssetShareCreateSchema = z.object({
  expiresAt: z.string().nullable().optional(),
  note: z.string().default(''),
})

const CommunicationAttachmentSchema = z.object({
  id: z.string().optional(),
  fileName: z.string().trim().min(1).max(255),
  fileId: z.string().optional(),
  assetId: z.string().optional(),
  fileSize: z.coerce.number().nonnegative().optional(),
  mimeType: z.string().optional(),
  uploadIndex: z.coerce.number().int().min(0).optional(),
})

export const CommunicationCreateSchema = z.object({
  subject: z.string().min(1),
  channel: ChannelSchema.default('Email'),
  date: z.iso.date(),
  summary: z.string().min(1),
  direction: CommunicationDirectionSchema.default('note'),
  messageType: z.string().default('note'),
  from: z.string().default(''),
  to: z.string().default(''),
  time: z.string().default(''),
  attachments: z.array(CommunicationAttachmentSchema).max(20).default([]),
})

export const CommunicationPatchSchema = z.object({
  subject: z.string().min(1).optional(),
  channel: ChannelSchema.optional(),
  date: z.iso.date().optional(),
  summary: z.string().min(1).optional(),
  direction: CommunicationDirectionSchema.optional(),
  messageType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  time: z.string().optional(),
  attachments: z.array(CommunicationAttachmentSchema).max(20).optional(),
})

export const CommunicationSendSchema = z.object({
  subject: z.string().min(1),
  summary: z.string().min(1),
  date: z.iso.date(),
  time: z.string().default(''),
  channel: ChannelSchema.default('Email'),
  direction: CommunicationDirectionSchema.default('outgoing'),
  messageType: z.string().default('outgoing-email'),
  from: z.string().default(''),
  to: z.string().default(''),
  bodyHtml: z.string().optional(),
  attachments: z.array(CommunicationAttachmentSchema).max(20).default([]),
})

export const ScholarshipCreateSchema = z.object({
  name: z.string().min(1),
  amount: z.string().default(''),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  school: z.string().optional().default(''),
  issuer: z.string().optional().default(''),
  status: ScholarshipStatusSchema.optional().default('Preparing'),
  notes: z.string().optional().default(''),
  materials: z.array(ScholarshipMaterialSchema).optional().default([]),
  tasks: z.array(ScholarshipTaskSchema).optional().default([]),
  timeline: z.array(ScholarshipTimelineEventSchema).optional().default([]),
})

export const TaskCreateSchema = z.object({
  title: z.string().min(1),
  due: z.iso.date(),
  done: z.boolean().default(false),
  details: z.string().optional().default(''),
  reminderEnabled: z.boolean().optional().default(false),
  reminderOffsets: z.array(z.string()).optional().default([]),
  reminderTime: z.string().optional().default(''),
  reminderRepeat: z.string().optional().default('once'),
  attachmentRequired: z.boolean().optional().default(false),
  uploadReserved: z.boolean().optional().default(false),
  allowedFileTypes: z.array(z.string()).optional().default([]),
})

export const TaskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  due: z.iso.date().optional(),
  done: z.boolean().optional(),
  details: z.string().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderOffsets: z.array(z.string()).optional(),
  reminderTime: z.string().optional(),
  reminderRepeat: z.string().optional(),
  attachmentRequired: z.boolean().optional(),
  uploadReserved: z.boolean().optional(),
  allowedFileTypes: z.array(z.string()).optional(),
})

export const UserSettingsPatchSchema = z.object({
  language: z.string().min(2).max(12).optional(),
  contentLanguagePrimary: z.string().min(2).max(12).optional(),
  contentLanguageSecondary: z.string().min(2).max(12).optional(),
  highContrast: z.boolean().optional(),
  themeAccent: z.string().min(1).optional(),
  avatarDataUrl: z.union([
    z.literal(''),
    z.string()
      .max(600_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  ]).optional(),
  sendFrom: z.string().email().optional(),
  receiveAt: z.string().email().optional(),
  receiveEmails: z
    .array(
      z.object({
        address: z.email().transform((value) => value.toLowerCase()),
        isPrimary: z.boolean(),
        notify: z.boolean(),
        verified: z.boolean().default(false),
        verificationSentAt: z.string().optional(),
      }),
    )
    .min(1)
    .max(5)
    .optional(),
  autoBackup: z.boolean().optional(),
  backupFrequency: BackupFrequencySchema.optional(),
  maxBackupsPerApp: z.number().int().min(1).max(100).optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().email().or(z.literal('')).optional(),
  // Empty string means "leave the saved secret alone" unless clearSmtpPass is set — see index.js's PATCH /api/settings.
  smtpPass: z.string().optional(),
  clearSmtpPass: z.boolean().optional(),
  smtpTls: z.boolean().optional(),
  incomingProtocol: z.enum(['pop3', 'imap']).optional(),
  incomingHost: z.string().optional(),
  incomingPort: z.number().int().min(1).max(65535).optional(),
  incomingUser: z.string().email().or(z.literal('')).optional(),
  incomingPass: z.string().optional(),
  clearIncomingPass: z.boolean().optional(),
  incomingTls: z.boolean().optional(),
  autoFetchMail: z.boolean().optional(),
  storageQuotaMb: z.number().int().min(1).max(102400).optional(),
  trashRetentionDays: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(30), z.literal(60), z.null()]).optional(),
  sessionDurationMinutes: z.number().int().min(5).max(43200).optional(),
  snippetPhraseLeadZh: z.string().optional(),
  snippetPhraseTailZh: z.string().optional(),
  snippetPhraseLeadEn: z.string().optional(),
  snippetPhraseTailEn: z.string().optional(),
  aiProfile: AiUserProfileSchema.optional(),
  profilePresets: z.array(StoredProfilePresetSchema).max(100).optional(),
})

export const EncryptionAlgorithmSchema = z.enum(['aes-256-gcm', 'chacha20-poly1305'])

export const AdminSettingsPatchSchema = z.object({
  allowRegistration: z.boolean().optional(),
  notificationMailbox: z.email().optional(),
  backupFrequency: BackupFrequencySchema.optional(),
  maxBackupsPerAppLimit: z.number().int().min(1).max(20).optional(),
  encryptionAtRest: z.boolean().optional(),
  encryptionAlgorithm: EncryptionAlgorithmSchema.optional(),
  encryptionPasswordEnabled: z.boolean().optional(),
  /** New encryption password (never returned). Empty string means leave unchanged. */
  encryptionPassword: z.string().min(8).max(200).optional(),
  /** Current password required when rotating algorithm/password while protection is on. */
  encryptionCurrentPassword: z.string().max(200).optional(),
  sqliteEncryption: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().email().or(z.literal('')).optional(),
  smtpPass: z.string().optional(),
  clearSmtpPass: z.boolean().optional(),
  smtpTls: z.boolean().optional(),
  adminSessionDurationMinutes: z.number().int().min(5).max(43200).optional(),
})

/** Discover / program-finder user state (stored on user.settings.discover). */
export const DiscoverStatePatchSchema = z.object({
  version: z.literal(1).optional(),
  intake: z
    .object({
      field: z.string().max(200).optional(),
      subfields: z.array(z.string().max(80)).max(20).optional(),
      regions: z.array(z.string().max(16)).max(12).optional(),
      stipendFloor: z.number().int().min(0).max(200000).optional(),
      currency: z.string().max(8).optional(),
      nPrograms: z.number().int().min(5).max(50).optional(),
      nPisPerProgram: z.number().int().min(1).max(20).optional(),
      piPreferences: z.array(z.string().max(40)).max(12).optional(),
      risingStarBias: z.enum(['strong', 'moderate', 'neutral']).optional(),
      notes: z.string().max(4000).optional(),
      interestTags: z.array(z.string().max(80)).max(30).optional(),
      notifyMatches: z.boolean().optional(),
      notifyDeadlines: z.boolean().optional(),
      seedPrograms: z.array(z.string().max(160)).max(30).optional(),
    })
    .optional(),
  intakeCompleted: z.boolean().optional(),
  hiddenProgramIds: z.array(z.string().max(80)).max(200).optional(),
  hiddenPiIds: z.array(z.string().max(80)).max(400).optional(),
  watchedProgramIds: z.array(z.string().max(80)).max(200).optional(),
  piNotes: z.record(z.string().max(80), z.string().max(4000)).optional(),
  programNotes: z.record(z.string().max(80), z.string().max(4000)).optional(),
  ranker: z
    .object({
      fit: z.number().min(0).max(100).optional(),
      stipend: z.number().min(0).max(100).optional(),
      city: z.number().min(0).max(100).optional(),
      advisorDensity: z.number().min(0).max(100).optional(),
      topics: z.number().min(0).max(100).optional(),
    })
    .optional(),
  interestPicks: z.array(z.string().max(80)).max(30).optional(),
  lastResearchAt: z.string().max(40).nullable().optional(),
  lastMatchIds: z.array(z.string().max(80)).max(50).optional(),
  researchRuns: z.number().int().min(0).max(100000).optional(),
  catalogSource: z.enum(['builtin', 'custom', 'merged']).optional(),
  customPrograms: z.array(z.record(z.string(), z.unknown())).max(80).optional(),
  aiEnrichments: z.record(z.string().max(80), z.record(z.string(), z.unknown())).optional(),
  lastAiResearchAt: z.string().max(40).nullable().optional(),
  preferredAiKeyId: z.string().max(80).nullable().optional(),
})

export const DiscoverImportSchema = z.object({
  programId: z.string().min(1).max(80),
  piId: z.string().max(80).nullable().optional(),
  includeNotes: z.boolean().optional().default(true),
})

export const DiscoverResearchSchema = z.object({
  notify: z.boolean().optional().default(true),
  /** When true and keyId is set, call the configured AI provider for enrichment. */
  useAi: z.boolean().optional().default(false),
  keyId: z.string().min(1).max(80).optional(),
  /** Merge AI-suggested new programs into the custom catalog. */
  acceptSuggestions: z.boolean().optional().default(true),
})

const DiscoverEnrichmentChangeSchema = z.object({
  id: z.string().min(1).max(80),
  target: z.enum([
    'school.website',
    'deadline',
    'professor.english',
    'professor.email',
    'professor.homepage',
    'professor.research',
    'tags',
    'dossier.discover',
    'scholarship.discover',
    'timeline.discover',
  ]),
  category: z.enum(['identity', 'advisor', 'research', 'funding', 'requirements', 'workflow']),
  mode: z.enum(['fill', 'update', 'merge', 'create']),
  before: z.string().max(4000),
  after: z.string().max(4000),
  source: z.enum(['catalog', 'ai', 'catalog_ai']),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  recommended: z.boolean(),
  sources: z.array(z.string().max(500)).max(12),
})

export const InitialAdminSetupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
  notificationMailbox: z.email().transform((value) => value.toLowerCase()),
  smtpHost: z.string().trim().min(1).max(253),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.email().transform((value) => value.toLowerCase()),
  smtpPass: z.string().min(1).max(500),
  smtpTls: z.boolean(),
  language: z.string().min(2).max(12).default('en'),
})

export const DiscoverApplicationEnrichmentPreviewSchema = z.object({
  useAi: z.boolean().optional().default(false),
  keyId: z.string().min(1).max(80).optional(),
})

export const DiscoverApplicationEnrichmentApplySchema = z.object({
  proposal: z.object({
    applicationId: z.string().min(1).max(100),
    generatedAt: z.string().max(40),
    usedAi: z.boolean(),
    matchedProgram: z.object({
      id: z.string().min(1).max(80),
      school: z.string().max(240),
      program: z.string().max(240),
      matchScore: z.number().min(0).max(100),
    }).nullable(),
    changes: z.array(DiscoverEnrichmentChangeSchema).max(20),
    caveats: z.array(z.string().max(1000)).max(10),
    payload: z.object({
      snapshot: z.object({
        programId: z.string().max(80),
        school: z.string().max(240),
        program: z.string().max(240),
        website: z.string().max(500),
        deadline: z.string().max(40),
        research: z.string().max(1600),
        fit: z.string().max(1600),
        funding: z.string().max(2400),
        requirements: z.string().max(2400),
        outcomes: z.string().max(1600),
        international: z.string().max(1600),
        sources: z.array(z.string().max(500)).max(12),
      }).optional(),
      tags: z.array(z.string().max(80)).max(12).optional(),
    }),
  }),
  acceptedChangeIds: z.array(z.string().min(1).max(80)).max(20),
})

export const AdminUserPatchSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  membershipPlan: z.enum(['free', 'pro', 'team']).optional(),
  storageQuotaMb: z.number().int().min(1).max(102400).optional(),
  applicationQuota: z.number().int().min(1).max(10000).optional(),
  applicationCreateQuota: z.number().int().min(1).max(10000).optional(),
  shareQuota: z.number().int().min(1).max(10000).optional(),
  shareCreateQuota: z.number().int().min(1).max(10000).optional(),
  seatLimit: z.number().int().min(1).max(100).optional(),
})

export function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const error = new Error(issue?.message ?? 'Invalid payload')
    error.status = 400
    error.code = 'VALIDATION_ERROR'
    error.field = issue?.path.join('.')
    throw error
  }
  return parsed.data
}
