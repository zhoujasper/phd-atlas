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

const SchoolLogoSchema = z.object({
  dataUrl: z.string().max(260_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  source: z.enum(['website', 'link', 'upload']),
  sourceUrl: z.url().max(2_048).refine((value) => value.startsWith('https://')).optional(),
  updatedAt: z.string().max(64),
})

const MaterialRecommenderSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  contact: z.string(),
})

const CommunicationChannelSchema = z.enum([
  'Email',
  'Message',
  'Note',
  'Interview',
  'Card',
  'Meeting',
  'Portal',
])

const CommunicationDirectionSchema = z.enum(['incoming', 'outgoing', 'note'])
const BackupFrequencySchema = z.enum(['1m', '5m', '15m', '30m', '1h', '3h', '6h', '12h', 'daily', '3d', '7d', 'weekly', 'monthly'])
const SharePermissionSchema = z.enum(['view', 'upload', 'edit'])
const ShareSectionSchema = z.enum([
  'overview',
  'materials',
  'tasks',
  'communications',
  'funding',
  'timeline',
  'versions',
])
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
  versions: z
    .array(
      FileVersionSchema,
    )
    .default([]),
})

export const CommunicationSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  channel: CommunicationChannelSchema,
  date: z.iso.date(),
  summary: z.string().min(1),
  direction: CommunicationDirectionSchema.default('note'),
  messageType: z.string().default('note'),
  from: z.string().default(''),
  to: z.string().default(''),
  time: z.string().default(''),
  attachments: z.array(z.object({
    id: z.string().optional(),
    fileName: z.string().min(1),
    fileId: z.string().optional(),
    assetId: z.string().optional(),
    fileSize: z.number().nonnegative().optional(),
    mimeType: z.string().optional(),
    storageName: z.string().optional(),
    source: z.string().optional(),
  })).default([]),
  deliveryStatus: z.enum(['sent', 'log-only']).optional(),
  sourceMessageKey: z.string().optional(),
  sourceMailbox: z.string().optional(),
  importedAt: z.string().optional(),
})

export const CommunicationPatchSchema = z.object({
  subject: z.string().min(1).optional(),
  channel: CommunicationChannelSchema.optional(),
  date: z.iso.date().optional(),
  summary: z.string().min(1).optional(),
  direction: CommunicationDirectionSchema.optional(),
  messageType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  time: z.string().optional(),
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

export const VersionSchema = FileVersionSchema

export const ApplicationSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1).optional(),
  professor: z.object({
    english: z.string().min(1),
    chinese: z.string(),
    email: z.email(),
    phone: z.string(),
    social: z.string(),
    homepage: OptionalUrlSchema,
    research: z.string().min(1),
    lab: z.string().min(1),
  }),
  school: z.object({
    name: z.string().min(1),
    country: z.string().min(1),
    website: OptionalUrlSchema,
    logo: SchoolLogoSchema.optional(),
    logoAutoDetect: z.boolean().optional(),
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
  scholarships: z.array(ScholarshipSchema),
  tasks: z.array(TaskSchema),
  timeline: z.array(TimelineEventSchema),
  versions: z.array(VersionSchema),
  shares: z
    .array(
      z.object({
        id: z.string().min(1),
        token: z.string().min(1),
        createdAt: z.string().min(1),
        expiresAt: z.string().nullable(),
        permission: SharePermissionSchema.optional().default('view'),
        sections: z.array(ShareSectionSchema).optional(),
        url: z.string().optional(),
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

export const UserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'user']),
  disabledAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  lastLoginAt: z.string().nullable().optional(),
  settings: z
    .object({
      language: z.string().min(2),
      highContrast: z.boolean(),
      themeAccent: z.string(),
      sendFrom: z.email().optional(),
      receiveAt: z.email().optional(),
      receiveEmails: z
        .array(
          z.object({
            address: z.email(),
            isPrimary: z.boolean(),
            notify: z.boolean(),
            verified: z.boolean().optional().default(true),
            verificationSentAt: z.string().optional(),
          }),
        )
        .max(5)
        .optional(),
      membershipPlan: z.enum(['free', 'pro']).optional(),
      autoBackup: z.boolean().optional(),
      backupFrequency: BackupFrequencySchema.optional(),
      maxBackupsPerApp: z.number().int().min(1).optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.number().int().optional(),
      smtpUser: z.string().optional(),
      smtpPass: z.string().optional(),
      smtpTls: z.boolean().optional(),
      incomingProtocol: z.enum(['pop3', 'imap']).optional(),
      incomingHost: z.string().optional(),
      incomingPort: z.number().int().optional(),
      incomingUser: z.string().optional(),
      incomingPass: z.string().optional(),
      incomingTls: z.boolean().optional(),
      storageQuotaMb: z.number().int().optional(),
      trashRetentionDays: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(30), z.literal(60), z.null()]).optional(),
      applicationQuota: z.number().int().optional(),
      applicationCreateQuota: z.number().int().optional(),
      shareQuota: z.number().int().optional(),
      shareCreateQuota: z.number().int().optional(),
      sessionDurationMinutes: z.number().int().optional(),
    })
    .optional(),
})

export const SystemSettingsSchema = z.object({
  allowRegistration: z.boolean(),
  notificationMailbox: z.email(),
  backupFrequency: BackupFrequencySchema,
  maxBackupsPerAppLimit: z.number().int().min(1).max(20).optional(),
  encryptionAtRest: z.boolean(),
  encryptionAlgorithm: z.enum(['aes-256-gcm', 'chacha20-poly1305']).optional(),
  encryptionPasswordEnabled: z.boolean().optional(),
  encryptionPasswordSet: z.boolean().optional(),
  sqliteEncryption: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpTls: z.boolean().optional(),
  adminSessionDurationMinutes: z.number().int().optional(),
})

export const AuthSessionSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
  settings: SystemSettingsSchema,
})

export const ApiEnvelopeSchema = <T extends z.ZodType>(schema: T) =>
  z.object({
    ok: z.boolean(),
    data: schema.optional(),
    session: z
      .object({
        token: z.string().min(1),
        expiresAt: z.string().optional(),
        durationMinutes: z.number().int().optional(),
      })
      .optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        field: z.string().optional(),
      })
      .optional(),
    requestId: z.string(),
  })

export type ApplicationPayload = z.infer<typeof ApplicationSchema>
export type UserPayload = z.infer<typeof UserSchema>
export type AuthSessionPayload = z.infer<typeof AuthSessionSchema>
export type SystemSettingsPayload = z.infer<typeof SystemSettingsSchema>
