import { PUBLIC_EDITION } from './edition.js'

const FALLBACK_USER_EMAIL = 'jasper@example.com'
const FALLBACK_USER_PASSWORD = 'demo123456'
const FALLBACK_ADMIN_EMAIL = 'admin@phd-atlas.local'
const FALLBACK_ADMIN_PASSWORD = 'admin123456'

export const DEFAULT_USER_EMAIL = process.env.BOOTSTRAP_USER_EMAIL?.trim() || FALLBACK_USER_EMAIL
export const DEFAULT_USER_PASSWORD = process.env.BOOTSTRAP_USER_PASSWORD || FALLBACK_USER_PASSWORD
export const DEFAULT_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || FALLBACK_ADMIN_EMAIL
export const DEFAULT_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD

if (process.env.NODE_ENV === 'production' && !PUBLIC_EDITION) {
  const unsafeDefaults = [
    [DEFAULT_USER_PASSWORD, FALLBACK_USER_PASSWORD, 'BOOTSTRAP_USER_PASSWORD'],
    [DEFAULT_ADMIN_PASSWORD, FALLBACK_ADMIN_PASSWORD, 'BOOTSTRAP_ADMIN_PASSWORD'],
  ].filter(([actual, fallback]) => actual === fallback)
  if (unsafeDefaults.length > 0) {
    console.error(`FATAL: Set non-default production credentials: ${unsafeDefaults.map(([, , name]) => name).join(', ')}.`)
    process.exit(1)
  }
}

export const seedProfileAssets = [
  {
    id: 'cv-master',
    name: 'CV and transcript package',
    kind: 'CV',
    description:
      'Canonical CV, resume, transcript, and credential materials for quick reuse.',
    notes: '',
    attachments: [],
    shares: [],
    updatedAt: '2026-06-25',
  },
  {
    id: 'personal-statement-bank',
    name: 'Personal statement paragraph bank',
    kind: 'Personal Statement',
    description:
      'Reusable background, motivation, and program-fit paragraphs.',
    notes: '',
    attachments: [],
    shares: [],
    updatedAt: '2026-06-24',
  },
  {
    id: 'research-proposal-brief',
    name: 'Research proposal brief',
    kind: 'Research Proposal',
    description:
      'Research interests, project abstract, methods, and faculty-fit notes.',
    notes: '',
    attachments: [],
    shares: [],
    updatedAt: '2026-06-21',
  },
  {
    id: 'sop-draft',
    name: 'SOP draft',
    kind: 'SOP',
    description:
      'Statement of purpose material and program-fit language.',
    notes: '',
    attachments: [],
    shares: [],
    updatedAt: '2026-06-18',
  },
]

export const seedApplications = [
  {
    id: 'stanford-hci-lee',
    professor: {
      english: 'Prof. Hannah Lee',
      chinese: 'Li jiaoshou',
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
        versions: [
          {
            id: 'ver-sop-4',
            file: 'stanford-sop-v4.pdf',
            author: 'You',
            createdAt: '2026-06-25 20:10',
          },
        ],
      },
      {
        id: 'cv',
        name: 'Academic CV',
        type: 'PDF',
        status: 'Submitted',
        version: 'v7',
        updatedAt: '2026-06-21',
        versions: [
          {
            id: 'ver-cv-7',
            file: 'academic-cv-v7.pdf',
            author: 'You',
            createdAt: '2026-06-21 09:20',
          },
        ],
      },
      {
        id: 'transcript',
        name: 'Transcript',
        type: 'PDF',
        status: 'Draft',
        version: 'v2',
        updatedAt: '2026-06-18',
        versions: [],
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
        versions: [],
      },
      {
        id: 'letters-mit',
        name: 'Recommendation Letters',
        type: 'Request',
        status: 'Missing',
        version: 'v0',
        updatedAt: '2026-06-19',
        versions: [],
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
  },
  {
    id: 'eth-data-wang',
    professor: {
      english: 'Prof. Olivia Wang',
      chinese: 'Wang jiaoshou',
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
        versions: [],
      },
      {
        id: 'eth-research',
        name: 'Research Proposal',
        type: 'PDF',
        status: 'Submitted',
        version: 'v3',
        updatedAt: '2026-06-15',
        versions: [],
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
  },
  {
    id: 'cambridge-nlp-chen',
    professor: {
      english: 'Prof. Amelia Chen',
      chinese: 'Chen jiaoshou',
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
        versions: [],
      },
      {
        id: 'cam-plan',
        name: 'Interview Notes',
        type: 'Markdown',
        status: 'Draft',
        version: 'v5',
        updatedAt: '2026-06-27',
        versions: [],
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
        versions: [
          {
            id: 'toronto-ver-1',
            file: 'toronto-offer-letter.pdf',
            author: 'Admissions',
            createdAt: '2026-06-22 08:13',
          },
        ],
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
  },
]
