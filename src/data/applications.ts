import type { DetailTab } from '../appModel'

export type ApplicationStatus =
  | 'Draft'
  | 'Preparing'
  | 'Submitted'
  | 'Interview'
  | 'Accepted'
  | 'Rejected'
  | 'Waitlist'

export type MaterialStatus = string
export type BackupFrequency = '1m' | '5m' | '15m' | '30m' | '1h' | '3h' | '6h' | '12h' | 'daily' | '3d' | '7d' | 'weekly' | 'monthly'
export type SharePermission = 'view' | 'upload' | 'edit'
export type ShareSection =
  | 'overview'
  | 'materials'
  | 'tasks'
  | 'communications'
  | 'funding'
  | 'timeline'
  | 'versions'

const sharePermissions: readonly SharePermission[] = ['view', 'upload', 'edit']
export const shareSections: readonly ShareSection[] = [
  'overview',
  'materials',
  'tasks',
  'communications',
  'funding',
  'timeline',
  'versions',
]

export function normalizeSharePermission(value: unknown): SharePermission {
  return typeof value === 'string' && sharePermissions.includes(value as SharePermission)
    ? value as SharePermission
    : 'view'
}

export function normalizeShareSections(value: unknown): ShareSection[] {
  if (value === undefined) return [...shareSections]
  if (!Array.isArray(value)) return ['overview']
  const normalized = value.reduce<ShareSection[]>((sections, item) => {
    if (typeof item === 'string' && shareSections.includes(item as ShareSection) && !sections.includes(item as ShareSection)) {
      sections.push(item as ShareSection)
    }
    return sections
  }, [])
  return normalized.length > 0 ? normalized : ['overview']
}

export type MaterialRecommender = {
  id: string
  name: string
  contact: string
}

export type DossierCardFieldType =
  | 'url'
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'contact'
  | 'tags'
  | 'date'

export type DossierCardFieldWidth = 'half' | 'full'

export type DossierCardField = {
  id: string
  type: DossierCardFieldType
  label: string
  value: string
  width?: DossierCardFieldWidth
}

export type DossierCard = {
  id: string
  title: string
  icon: string
  color: string
  width?: 'half' | 'full'
  fields: DossierCardField[]
  createdAt?: string
  updatedAt?: string
}

export type ReviewComment = {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  targetTab?: DetailTab
  parentId?: string | null
  mentionedUserIds?: string[]
  replies?: ReviewComment[]
}

export type ApplicationRecord = {
  id: string
  ownerId?: string
  /** Set when the owner shares this application with their team (their teacher + institution admin). */
  teamId?: string | null
  teamTransferRequest?: {
    id: string
    teamId: string
    direction: 'join' | 'leave'
    status: 'pending' | 'approved' | 'rejected'
    requestedBy: string
    requestedAt: string
    decidedBy?: string | null
    decidedAt?: string | null
  } | null
  professor: {
    english: string
    chinese: string
    email: string
    phone: string
    social: string
    homepage: string
    research: string
    lab: string
  }
  school: {
    name: string
    country: string
    website: string
    logo?: {
      dataUrl: string
      source: 'website' | 'link' | 'upload'
      sourceUrl?: string
      updatedAt: string
    }
    /** Defaults to true for legacy records; false preserves an intentional removal. */
    logoAutoDetect?: boolean
  }
  program: string
  deadline: string
  status: ApplicationStatus
  progress: number
  priority: number
  tags: string[]
  nextReminder: string
  result: string
  dossierCards?: DossierCard[]
  materials: Array<{
    id: string
    name: string
    type: string
    status: MaterialStatus
    group?: string
    details?: string
    reminderEnabled?: boolean
    reminderDate?: string
    reminderTime?: string
    reminderRepeat?: string
    uploadReserved?: boolean
    allowedFileTypes?: string[]
    requiredCount?: number
    recommenders?: MaterialRecommender[]
    version: string
    updatedAt: string
    fileId?: string
    fileName?: string
    fileSize?: number
    mimeType?: string
    storageName?: string
    versions?: Array<{
      id: string
      file: string
      author: string
      createdAt: string
      fileId?: string
      storageName?: string
      size?: number
      mimeType?: string
    }>
  }>
  communications: Array<{
    id: string
    subject: string
    channel: string
    date: string
    summary: string
    direction?: 'incoming' | 'outgoing' | 'note'
    messageType?: string
    from?: string
    to?: string
    time?: string
    attachments?: Array<{
      id?: string
      fileName: string
      fileId?: string
      assetId?: string
      fileSize?: number
      mimeType?: string
      storageName?: string
      source?: string
    }>
    deliveryStatus?: 'sent' | 'log-only'
    sourceMessageKey?: string
    sourceMailbox?: string
    importedAt?: string
  }>
  scholarships: Array<{
    id: string
    name: string
    amount: string
    startDate: string
    endDate: string
    school?: string
    issuer?: string
    status?: 'Draft' | 'Preparing' | 'Submitted' | 'Awarded' | 'Rejected'
    notes?: string
    materials?: Array<{
      id: string
      name: string
      status: MaterialStatus
      due?: string
      details?: string
    }>
    tasks?: Array<{
      id: string
      title: string
      due: string
      done: boolean
      details?: string
    }>
    timeline?: Array<{
      id: string
      title: string
      date: string
      note?: string
    }>
  }>
  fees?: Array<{
    id: string
    amount: number
    currency: string
    paidDate?: string | null
    waived: boolean
    notes: string
    createdAt: string
  }>
  tasks: Array<{
    id: string
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
    fileId?: string
    fileName?: string
    fileSize?: number
    mimeType?: string
    storageName?: string
    versions?: Array<{
      id: string
      file: string
      author: string
      createdAt: string
      fileId?: string
      storageName?: string
      size?: number
      mimeType?: string
    }>
  }>
  timeline: Array<{
    id: string
    title: string
    date: string
    note: string
  }>
  versions: Array<{
    id: string
    file: string
    author: string
    createdAt: string
    fileId?: string
    storageName?: string
    size?: number
    mimeType?: string
  }>
  shares?: Array<{
    id: string
    token: string
    createdAt: string
    expiresAt: string | null
    permission?: SharePermission
    sections?: ShareSection[]
    url?: string
  }>
  /** Team review-comment thread -- distinct from `communications` (professor correspondence). */
  reviewComments?: ReviewComment[]
  backupSettings?: {
    autoBackup: boolean
    frequency: BackupFrequency
    maxBackups: number
    lastAutoBackupAt?: string
  }
  createdAt?: string
  updatedAt?: string
}

export const applications: ApplicationRecord[] = [
  {
    id: 'stanford-hci-lee',
    professor: {
      english: 'Prof. Hannah Lee',
      chinese: '李教授',
      email: 'hlee@stanford.edu',
      phone: '+1 650 555 0192',
      social: '@hannahlee-lab',
      homepage: 'https://hci.stanford.edu/lee',
      research: 'human-AI collaboration, learning interfaces, and evaluation',
      lab: 'Interactive Intelligence Lab',
    },
    school: {
      name: 'Stanford University',
      country: 'United States',
      website: 'https://gradadmissions.stanford.edu',
    },
    program: 'Computer Science PhD',
    deadline: '2026-12-05',
    status: 'Preparing',
    progress: 68,
    priority: 92,
    tags: ['HCI', 'AI', 'top choice'],
    nextReminder: '2026-07-10',
    result: 'Awaiting application submission',
    materials: [
      {
        id: 'sop',
        name: 'Statement of Purpose',
        type: 'PDF',
        status: 'Needs revision',
        version: 'v4',
        updatedAt: '2026-06-25',
      },
      {
        id: 'cv',
        name: 'Academic CV',
        type: 'PDF',
        status: 'Submitted',
        version: 'v7',
        updatedAt: '2026-06-21',
      },
      {
        id: 'transcript',
        name: 'Transcript',
        type: 'PDF',
        status: 'Draft',
        version: 'v2',
        updatedAt: '2026-06-18',
      },
    ],
    communications: [
      {
        id: 'mail-1',
        subject: 'Research fit and availability',
        channel: 'Email',
        date: '2026-06-14',
        summary:
          'Professor suggested emphasizing prior user study experience and sending a shorter project summary.',
      },
      {
        id: 'interview-1',
        subject: 'Informal lab chat',
        channel: 'Interview',
        date: '2026-06-28',
        summary:
          'Discussed research questions, methods, and possible RA funding route.',
      },
    ],
    scholarships: [
      {
        id: 'fellowship',
        name: 'Knight-Hennessy Scholars',
        amount: 'Full funding',
        startDate: '2027-09-01',
        endDate: '2032-08-31',
      },
    ],
    tasks: [
      {
        id: 'task-stanford-1',
        title: 'Revise SoP opening paragraph',
        due: '2026-07-03',
        done: false,
      },
      {
        id: 'task-stanford-2',
        title: 'Confirm third recommender',
        due: '2026-07-09',
        done: true,
      },
      {
        id: 'task-stanford-3',
        title: 'Send one-page project brief',
        due: '2026-07-10',
        done: false,
      },
    ],
    timeline: [
      {
        id: 'time-1',
        title: 'Cold email sent',
        date: '2026-06-10',
        note: 'Short email with personal website and relevant paper.',
      },
      {
        id: 'time-2',
        title: 'Reply received',
        date: '2026-06-14',
        note: 'Positive response with advice on fit statement.',
      },
    ],
    versions: [
      {
        id: 'ver-1',
        file: 'stanford-sop-v4.pdf',
        author: 'You',
        createdAt: '2026-06-25 20:10',
      },
      {
        id: 'ver-2',
        file: 'stanford-sop-v3.pdf',
        author: 'Mentor review',
        createdAt: '2026-06-20 09:35',
      },
    ],
  },
  {
    id: 'mit-robotics-kim',
    professor: {
      english: 'Prof. Daniel Kim',
      chinese: '',
      email: 'dkim@mit.edu',
      phone: '+1 617 555 0144',
      social: '@kim-robotics',
      homepage: 'https://robotics.mit.edu/kim',
      research: 'robot learning, embodied planning, and safe autonomy',
      lab: 'Robot Learning Group',
    },
    school: {
      name: 'MIT',
      country: 'United States',
      website: 'https://gradadmissions.mit.edu',
    },
    program: 'EECS PhD',
    deadline: '2026-12-15',
    status: 'Draft',
    progress: 41,
    priority: 88,
    tags: ['robotics', 'ML', 'funding'],
    nextReminder: '2026-07-08',
    result: 'Cold email drafted',
    materials: [
      {
        id: 'sop-mit',
        name: 'Statement of Purpose',
        type: 'DOCX',
        status: 'Draft',
        version: 'v1',
        updatedAt: '2026-06-26',
      },
      {
        id: 'letters-mit',
        name: 'Recommendation Letters',
        type: 'Request',
        status: 'Missing',
        version: 'v0',
        updatedAt: '2026-06-19',
      },
    ],
    communications: [
      {
        id: 'mit-mail-1',
        subject: 'Drafted first outreach',
        channel: 'Card',
        date: '2026-06-26',
        summary:
          'Need to shorten paragraph about deployment and add link to simulation demo.',
      },
    ],
    scholarships: [
      {
        id: 'mit-ra',
        name: 'RA funding route',
        amount: 'TBD',
        startDate: '2027-09-01',
        endDate: '2031-08-31',
      },
    ],
    tasks: [
      {
        id: 'task-mit-1',
        title: 'Send cold email',
        due: '2026-07-08',
        done: false,
      },
      {
        id: 'task-mit-2',
        title: 'Upload robotics paper draft',
        due: '2026-07-12',
        done: false,
      },
    ],
    timeline: [
      {
        id: 'mit-time-1',
        title: 'Shortlisted program',
        date: '2026-06-11',
        note: 'Strong overlap with current embodied agent work.',
      },
    ],
    versions: [
      {
        id: 'mit-ver-1',
        file: 'mit-email-draft-v1.md',
        author: 'You',
        createdAt: '2026-06-26 18:22',
      },
    ],
  },
  {
    id: 'eth-data-wang',
    professor: {
      english: 'Prof. Olivia Wang',
      chinese: '王教授',
      email: 'olivia.wang@ethz.ch',
      phone: '+41 44 555 0188',
      social: 'olivia-wang-lab',
      homepage: 'https://inf.ethz.ch/wang',
      research: 'trustworthy data systems and privacy-preserving analytics',
      lab: 'Secure Data Systems Lab',
    },
    school: {
      name: 'ETH Zurich',
      country: 'Switzerland',
      website: 'https://ethz.ch/en/doctorate',
    },
    program: 'Data Science PhD',
    deadline: '2026-11-30',
    status: 'Submitted',
    progress: 86,
    priority: 81,
    tags: ['systems', 'privacy', 'Europe'],
    nextReminder: '2026-07-18',
    result: 'Submitted, waiting for committee screening',
    materials: [
      {
        id: 'eth-cv',
        name: 'Academic CV',
        type: 'PDF',
        status: 'Submitted',
        version: 'v6',
        updatedAt: '2026-06-12',
      },
      {
        id: 'eth-research',
        name: 'Research Proposal',
        type: 'PDF',
        status: 'Submitted',
        version: 'v3',
        updatedAt: '2026-06-15',
      },
    ],
    communications: [
      {
        id: 'eth-mail-1',
        subject: 'Application confirmation',
        channel: 'Email',
        date: '2026-06-20',
        summary: 'Department confirmed receipt and said review starts in July.',
      },
    ],
    scholarships: [
      {
        id: 'eth-excellence',
        name: 'ETH Excellence Scholarship',
        amount: 'CHF 12,000/year',
        startDate: '2027-09-01',
        endDate: '2030-08-31',
      },
    ],
    tasks: [
      {
        id: 'task-eth-1',
        title: 'Follow up with coordinator',
        due: '2026-07-18',
        done: false,
      },
    ],
    timeline: [
      {
        id: 'eth-time-1',
        title: 'Submitted portal application',
        date: '2026-06-20',
        note: 'All required PDFs accepted by portal.',
      },
    ],
    versions: [
      {
        id: 'eth-ver-1',
        file: 'eth-proposal-v3.pdf',
        author: 'You',
        createdAt: '2026-06-15 21:45',
      },
    ],
  },
  {
    id: 'cambridge-nlp-chen',
    professor: {
      english: 'Prof. Amelia Chen',
      chinese: '陈教授',
      email: 'achen@cam.ac.uk',
      phone: '+44 1223 555 016',
      social: '@amelia-nlp',
      homepage: 'https://www.cst.cam.ac.uk/people/achen',
      research: 'multilingual NLP and evaluation for scientific discovery',
      lab: 'Language and Knowledge Lab',
    },
    school: {
      name: 'University of Cambridge',
      country: 'United Kingdom',
      website: 'https://www.postgraduate.study.cam.ac.uk',
    },
    program: 'Advanced Computer Science PhD',
    deadline: '2026-12-03',
    status: 'Interview',
    progress: 79,
    priority: 84,
    tags: ['NLP', 'interview', 'UK'],
    nextReminder: '2026-07-05',
    result: 'Interview scheduled',
    materials: [
      {
        id: 'cam-portfolio',
        name: 'Writing Sample',
        type: 'PDF',
        status: 'Submitted',
        version: 'v2',
        updatedAt: '2026-06-16',
      },
      {
        id: 'cam-plan',
        name: 'Interview Notes',
        type: 'Markdown',
        status: 'Draft',
        version: 'v5',
        updatedAt: '2026-06-27',
      },
    ],
    communications: [
      {
        id: 'cam-interview',
        subject: 'Interview invitation',
        channel: 'Email',
        date: '2026-06-24',
        summary: 'Panel interview set for July 6, includes project discussion.',
      },
    ],
    scholarships: [
      {
        id: 'gates',
        name: 'Gates Cambridge',
        amount: 'Full funding',
        startDate: '2027-10-01',
        endDate: '2031-09-30',
      },
      {
        id: 'college',
        name: 'College studentship',
        amount: 'Partial',
        startDate: '2027-10-01',
        endDate: '2028-09-30',
      },
    ],
    tasks: [
      {
        id: 'task-cam-1',
        title: 'Prepare interview slide outline',
        due: '2026-07-04',
        done: false,
      },
      {
        id: 'task-cam-2',
        title: 'Run mock interview',
        due: '2026-07-05',
        done: false,
      },
    ],
    timeline: [
      {
        id: 'cam-time-1',
        title: 'Interview invitation',
        date: '2026-06-24',
        note: 'Need to prepare methods discussion and failure analysis.',
      },
    ],
    versions: [
      {
        id: 'cam-ver-1',
        file: 'cambridge-interview-notes-v5.md',
        author: 'You',
        createdAt: '2026-06-27 22:02',
      },
    ],
  },
  {
    id: 'toronto-vision-patel',
    professor: {
      english: 'Prof. Maya Patel',
      chinese: '',
      email: 'maya.patel@utoronto.ca',
      phone: '+1 416 555 0119',
      social: '@patel-vision',
      homepage: 'https://web.cs.toronto.edu/patel',
      research: '3D vision, semantic occupancy, and uncertainty estimation',
      lab: 'Visual Intelligence Lab',
    },
    school: {
      name: 'University of Toronto',
      country: 'Canada',
      website: 'https://www.sgs.utoronto.ca',
    },
    program: 'Computer Science PhD',
    deadline: '2026-12-01',
    status: 'Accepted',
    progress: 100,
    priority: 95,
    tags: ['vision', 'offer', 'funded'],
    nextReminder: '2026-07-14',
    result: 'Accepted with funding package',
    materials: [
      {
        id: 'toronto-offer',
        name: 'Offer Letter',
        type: 'PDF',
        status: 'Submitted',
        version: 'v1',
        updatedAt: '2026-06-22',
      },
    ],
    communications: [
      {
        id: 'toronto-offer-mail',
        subject: 'Admission offer',
        channel: 'Email',
        date: '2026-06-22',
        summary: 'Offer includes RA funding and first-year coursework plan.',
      },
    ],
    scholarships: [
      {
        id: 'toronto-ra',
        name: 'RA package',
        amount: 'CAD 42,000/year',
        startDate: '2027-09-01',
        endDate: '2032-08-31',
      },
    ],
    tasks: [
      {
        id: 'task-toronto-1',
        title: 'Compare funding package',
        due: '2026-07-14',
        done: false,
      },
    ],
    timeline: [
      {
        id: 'toronto-time-1',
        title: 'Offer received',
        date: '2026-06-22',
        note: 'Need to reply by August 1.',
      },
    ],
    versions: [
      {
        id: 'toronto-ver-1',
        file: 'toronto-offer-letter.pdf',
        author: 'Admissions',
        createdAt: '2026-06-22 08:13',
      },
    ],
  },
]

export const profileAssets = [
  {
    id: 'cv-master',
    name: 'CV and transcript package',
    kind: 'CV',
    description:
      'Canonical CV, resume, transcript, and credential materials for quick reuse.',
    notes: '',
    emailPhraseEn: 'Please find my CV/resume and transcript attached. I would be grateful for the opportunity to discuss my fit further, and I am happy to provide any additional materials you may need.',
    emailPhraseZh: '附件中是我的简历和成绩单。若您方便，我非常希望有机会进一步向您请教；如果需要补充成绩单、语言成绩或其他材料，也请您告诉我。',
    attachments: [],
  },
  {
    id: 'personal-statement-bank',
    name: 'Personal statement paragraph bank',
    kind: 'Personal Statement',
    description:
      'Reusable background, motivation, and program-fit paragraphs.',
    notes: '',
    emailPhraseEn: 'I have also included a short personal statement outlining my background, motivation, and fit with the program.',
    emailPhraseZh: '我也附上了一份简短的个人陈述，概述我的背景、申请动机以及与项目方向的匹配之处，供您参考。',
    attachments: [],
  },
  {
    id: 'research-proposal-brief',
    name: 'Research proposal brief',
    kind: 'Research Proposal',
    description:
      'Research interests, project abstract, methods, and faculty-fit notes.',
    notes: '',
    emailPhraseEn: 'I have attached a brief research proposal summarizing my current interests, potential research direction, and how they connect with your group.',
    emailPhraseZh: '附件中是我的简短研究计划，主要说明我目前的研究兴趣、可能的研究方向，以及与您课题组方向的关联，供您参考。',
    attachments: [],
  },
  {
    id: 'sop-draft',
    name: 'SOP draft',
    kind: 'SOP',
    description:
      'Statement of purpose material and program-fit language.',
    notes: '',
    emailPhraseEn: 'I have included my statement of purpose draft for context. I would appreciate any advice on whether the research fit and framing are appropriate.',
    emailPhraseZh: '我附上了 SOP/目的陈述草稿，方便您了解我的申请背景和研究兴趣。如果您愿意，我也非常希望听取您对研究匹配和表述重点的建议。',
    attachments: [],
  },
]

export const adminUsers = [
  {
    id: 'user-1',
    name: 'jasper@example.com',
    role: 'Owner',
    applicationCount: 18,
  },
  {
    id: 'user-2',
    name: 'demo-student@example.com',
    role: 'User',
    applicationCount: 7,
  },
  {
    id: 'user-3',
    name: 'mentor-teacher@example.com',
    role: 'Teacher',
    applicationCount: 2,
  },
]

export const systemEvents = [
  {
    id: 'event-1',
    message: 'Registration policy updated',
    scope: 'Admin setting',
    time: '2026-06-29 14:30',
  },
  {
    id: 'event-2',
    message: 'Password reset link sent',
    scope: 'Account recovery',
    time: '2026-06-29 11:08',
  },
  {
    id: 'event-3',
    message: 'Encrypted backup completed',
    scope: 'Data security',
    time: '2026-06-28 23:00',
  },
]
