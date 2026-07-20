export const STRESS_APPLICATION_ID_PREFIX = 'stress-app-'

const statuses = ['Draft', 'Preparing', 'Submitted', 'Interview', 'Accepted', 'Rejected', 'Waitlist']
const materialStatuses = ['Draft', 'In Progress', 'Submitted', 'Missing', 'Needs Review', 'Approved']
const programs = [
  'Computer Science PhD',
  'Human-Computer Interaction PhD',
  'AI for Science PhD',
  'Computational Biology PhD',
  'Information Systems PhD',
  'Robotics PhD',
  'Data Science PhD',
  'Computational Social Science PhD',
]
const countries = ['United States', 'Canada', 'United Kingdom', 'Switzerland', 'Singapore', 'Hong Kong', 'Netherlands', 'Germany']
const researchAreas = [
  'AI agents for scientific discovery',
  'privacy-preserving machine learning',
  'human-centered AI systems',
  'trustworthy multimodal reasoning',
  'robot learning under uncertainty',
  'biomedical foundation models',
  'distributed systems for AI workloads',
  'computational social science and policy',
]
const universities = [
  ['Stanford University', 'Prof. Hannah Lee', 'hannah.lee'],
  ['MIT', 'Prof. Daniel Kim', 'daniel.kim'],
  ['University of Toronto', 'Prof. Maya Patel', 'maya.patel'],
  ['University of Cambridge', 'Prof. Alice Chen', 'alice.chen'],
  ['ETH Zurich', 'Prof. Olivia Wang', 'olivia.wang'],
  ['National University of Singapore', 'Prof. Arjun Mehta', 'arjun.mehta'],
  ['University of Oxford', 'Prof. Rowan Clarke', 'rowan.clarke'],
  ['TU Munich', 'Prof. Lena Fischer', 'lena.fischer'],
  ['University of Amsterdam', 'Prof. Noor Bakker', 'noor.bakker'],
  ['HKUST', 'Prof. Vivian Lau', 'vivian.lau'],
]

function pad(value, size = 3) {
  return String(value).padStart(size, '0')
}

function addDays(baseDate, offset) {
  const date = new Date(baseDate.getTime())
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48)
}

function pick(list, index) {
  return list[index % list.length]
}

function materialFor(appIndex, itemIndex, baseDate) {
  const names = [
    ['Academic CV', 'File', 'Core materials'],
    ['Statement of Purpose', 'Essay', 'Core materials'],
    ['Research Proposal', 'Proposal', 'Core materials'],
    ['Personal Statement', 'Essay', 'Core materials'],
    ['Writing Sample', 'Writing', 'Supplemental'],
    ['Language Scores', 'Score Report', 'Testing'],
    ['Unofficial Transcript', 'Transcript', 'Core materials'],
    ['Recommendation Letters', 'Recommendation', 'Recommenders'],
    ['Portfolio Website PDF', 'Portfolio', 'Supplemental'],
    ['Funding Statement', 'Essay', 'Funding'],
  ]
  const [name, type, group] = pick(names, appIndex + itemIndex)
  const isRecommendation = name === 'Recommendation Letters'
  const id = `stress-material-${pad(appIndex)}-${pad(itemIndex, 2)}`
  return {
    id,
    name: `${name}${appIndex % 9 === 0 ? ' - long-form institutional variant' : ''}`,
    type,
    status: pick(materialStatuses, appIndex + itemIndex),
    group,
    details: itemIndex % 3 === 0
      ? `Stress detail ${appIndex}-${itemIndex}: verify wrapping, editing, reminders, uploads, and checklist filtering with realistic long copy.`
      : '',
    reminderEnabled: itemIndex % 2 === 0,
    reminderDate: itemIndex % 2 === 0 ? addDays(baseDate, -10 + appIndex + itemIndex * 3) : '',
    reminderTime: itemIndex % 2 === 0 ? '09:30' : '',
    reminderRepeat: itemIndex % 4 === 0 ? 'weekly' : 'once',
    uploadReserved: itemIndex % 5 === 0,
    allowedFileTypes: itemIndex % 4 === 0 ? ['.pdf', '.docx'] : [],
    requiredCount: isRecommendation ? 3 + (appIndex % 2) : 1,
    recommenders: isRecommendation
      ? Array.from({ length: 3 + (appIndex % 2) }, (_, recIndex) => ({
          id: `stress-rec-${pad(appIndex)}-${recIndex}`,
          name: `Recommender ${recIndex + 1}`,
          contact: `recommender${recIndex + 1}.${pad(appIndex)}@example.test`,
        }))
      : [],
    version: itemIndex % 3 === 0 ? 'v1' : 'v0',
    updatedAt: addDays(baseDate, -itemIndex),
    versions: itemIndex % 3 === 0
      ? [{
          id: `stress-version-${pad(appIndex)}-${pad(itemIndex, 2)}`,
          file: `${slug(name)}-${pad(appIndex)}.pdf`,
          author: 'Stress Seeder',
          createdAt: `${addDays(baseDate, -itemIndex)}T09:00:00.000Z`,
          fileId: `stress-file-${pad(appIndex)}-${pad(itemIndex, 2)}`,
          storageName: '',
          size: 1024 + appIndex * 17 + itemIndex,
          mimeType: 'application/pdf',
        }]
      : [],
  }
}

function taskFor(appIndex, itemIndex, baseDate) {
  const titles = [
    'Confirm supervisor fit',
    'Draft research pitch',
    'Polish SOP narrative',
    'Request recommendation update',
    'Check portal account',
    'Submit fee waiver request',
    'Upload final transcript',
    'Prepare interview notes',
    'Verify scholarship eligibility',
    'Send follow-up email',
    'Archive decision evidence',
    'Review privacy settings',
  ]
  return {
    id: `stress-task-${pad(appIndex)}-${pad(itemIndex, 2)}`,
    title: `${pick(titles, appIndex + itemIndex)} ${itemIndex % 4 === 0 ? '- edge case with a longer title' : ''}`,
    due: addDays(baseDate, -20 + appIndex * 2 + itemIndex * 4),
    done: (appIndex + itemIndex) % 5 === 0,
    details: itemIndex % 3 === 1 ? `Task detail for keyboard, edit, sort, and reminder state ${appIndex}-${itemIndex}.` : '',
    reminderEnabled: itemIndex % 2 === 1,
    reminderOffsets: itemIndex % 2 === 1 ? ['7d', '1d'] : [],
    reminderTime: itemIndex % 2 === 1 ? '08:45' : '',
    reminderRepeat: itemIndex % 6 === 1 ? 'weekly' : 'once',
    attachmentRequired: itemIndex % 4 === 2,
    uploadReserved: itemIndex % 5 === 2,
    allowedFileTypes: itemIndex % 4 === 2 ? ['.pdf', '.txt'] : [],
    versions: [],
  }
}

function scholarshipFor(appIndex, itemIndex, baseDate, schoolName) {
  const id = `stress-scholarship-${pad(appIndex)}-${pad(itemIndex, 2)}`
  const endOffset = 14 + appIndex * 3 + itemIndex * 18
  return {
    id,
    name: pick(['Graduate Fellowship', 'Research Assistantship', 'Department Scholarship', 'International Student Award'], appIndex + itemIndex),
    amount: pick(['Full tuition + stipend', '$35,000/year', 'CHF 48,000/year', 'TBD'], appIndex + itemIndex),
    startDate: addDays(baseDate, endOffset - 30),
    endDate: addDays(baseDate, endOffset),
    school: schoolName,
    issuer: pick(['Graduate School', 'Department Committee', 'External Foundation'], appIndex + itemIndex),
    status: pick(['Draft', 'Preparing', 'Submitted', 'Awarded', 'Rejected'], appIndex + itemIndex),
    notes: `Funding track ${itemIndex + 1} for stress app ${appIndex}.`,
    materials: Array.from({ length: 3 }, (_, materialIndex) => ({
      id: `${id}-material-${materialIndex}`,
      name: pick(['Budget statement', 'Eligibility form', 'Advisor nomination'], materialIndex),
      status: pick(materialStatuses, appIndex + materialIndex),
      due: addDays(baseDate, endOffset - 12 + materialIndex * 3),
      details: materialIndex === 1 ? 'Check boundary due-date rendering in inspector.' : '',
    })),
    tasks: Array.from({ length: 3 }, (_, taskIndex) => ({
      id: `${id}-task-${taskIndex}`,
      title: pick(['Ask department coordinator', 'Upload financial form', 'Confirm award rules'], taskIndex),
      due: addDays(baseDate, endOffset - 10 + taskIndex * 2),
      done: (appIndex + taskIndex) % 4 === 0,
      details: '',
    })),
    timeline: Array.from({ length: 3 }, (_, eventIndex) => ({
      id: `${id}-timeline-${eventIndex}`,
      title: pick(['Funding opens', 'Committee review', 'Award decision'], eventIndex),
      date: addDays(baseDate, endOffset - 20 + eventIndex * 10),
      note: 'Generated funding milestone.',
    })),
  }
}

function communicationFor(appIndex, itemIndex, baseDate, professorEmail) {
  const direction = pick(['outgoing', 'incoming', 'note'], appIndex + itemIndex)
  const channel = direction === 'note' ? 'Note' : pick(['Email', 'Message'], appIndex + itemIndex)
  return {
    id: `stress-comm-${pad(appIndex)}-${pad(itemIndex, 2)}`,
    subject: pick(['Research fit', 'Follow-up', 'Interview scheduling', 'Portal update', 'Decision note'], appIndex + itemIndex),
    channel,
    date: addDays(baseDate, -45 + appIndex + itemIndex * 6),
    time: `${pad(8 + (itemIndex % 10), 2)}:${pad((itemIndex * 7) % 60, 2)}`,
    summary: `Generated correspondence ${appIndex}-${itemIndex}. Direction=${direction}. Used for timeline density, search, filtering, and export checks.`,
    direction,
    messageType: direction === 'note' ? 'user-note' : channel === 'Email' ? (direction === 'incoming' ? 'incoming-email' : 'outgoing-email') : 'message',
    from: direction === 'incoming' ? professorEmail : 'jasper@example.com',
    to: direction === 'incoming' ? 'jasper@example.com' : professorEmail,
    attachments: [],
    deliveryStatus: direction === 'outgoing' && channel === 'Email' ? 'log-only' : undefined,
  }
}

export function createStressApplications({ ownerId, count = 120, baseDate = new Date('2026-07-09T00:00:00.000Z') } = {}) {
  if (!ownerId) {
    throw new Error('ownerId is required')
  }

  return Array.from({ length: count }, (_, zeroIndex) => {
    const index = zeroIndex + 1
    const [university, professor, emailLocal] = pick(universities, zeroIndex)
    const country = pick(countries, zeroIndex)
    const program = pick(programs, zeroIndex)
    const schoolName = `${university} Stress ${pad(index)}`
    const professorEmail = `${emailLocal}.${pad(index)}@example.test`
    const deadline = addDays(baseDate, -30 + index * 3)
    const materials = Array.from({ length: 10 + (index % 4) }, (_, itemIndex) => materialFor(index, itemIndex, baseDate))
    const tasks = Array.from({ length: 9 + (index % 5) }, (_, itemIndex) => taskFor(index, itemIndex, baseDate))
    const scholarships = Array.from({ length: index % 4 }, (_, itemIndex) => scholarshipFor(index, itemIndex, baseDate, schoolName))
    const versions = materials.flatMap((material) => material.versions ?? [])
    const area = pick(researchAreas, zeroIndex)

    return {
      id: `${STRESS_APPLICATION_ID_PREFIX}${pad(index)}`,
      ownerId,
      teamId: null,
      teamTransferRequest: null,
      professor: {
        english: `${professor} ${pad(index)}`,
        chinese: index % 3 === 0 ? `测试教授${index}` : '',
        email: professorEmail,
        phone: index % 4 === 0 ? `+1 650 555 ${pad(index, 4)}` : '',
        social: index % 5 === 0 ? `https://www.linkedin.com/in/stress-professor-${pad(index)}` : '',
        homepage: `https://faculty.example.edu/${slug(emailLocal)}-${pad(index)}`,
        research: `${area}. Stress fixture verifies long research notes, line wrapping, exports, dashboard aggregation, and inspector deadline density.`,
        lab: `${pick(['Atlas Lab', 'Systems Group', 'AI Safety Studio', 'Data Interaction Lab'], zeroIndex)} ${pad(index)}`,
      },
      school: {
        name: schoolName,
        country,
        website: `https://www.${slug(university)}-${pad(index)}.edu`,
      },
      program,
      deadline,
      status: pick(statuses, zeroIndex),
      progress: (index * 13) % 101,
      priority: (index * 17) % 101,
      tags: [country, program.split(' ')[0], area.split(' ')[0], `cycle-${2026 + (index % 2)}`],
      nextReminder: addDays(baseDate, -14 + index),
      result: pick(['', 'Strong research overlap', 'Interview possible', 'High funding potential', 'Needs portfolio polish'], zeroIndex),
      dossierCards: [
        {
          id: `stress-card-fit-${pad(index)}`,
          title: 'Fit notes',
          icon: 'brain',
          color: 'blue',
          width: 'full',
          fields: [
            { id: `stress-field-fit-${pad(index)}`, type: 'textarea', label: 'Research fit', value: `${area} with a deliberately longer note to stress wrapping and export fidelity.`, width: 'full' },
            { id: `stress-field-link-${pad(index)}`, type: 'url', label: 'Lab link', value: `https://labs.example.edu/${slug(area)}-${pad(index)}`, width: 'half' },
          ],
          createdAt: `${deadline}T00:00:00.000Z`,
          updatedAt: `${deadline}T00:00:00.000Z`,
        },
      ],
      materials,
      communications: Array.from({ length: 5 + (index % 4) }, (_, itemIndex) => communicationFor(index, itemIndex, baseDate, professorEmail)),
      reviewComments: [],
      scholarships,
      fees: Array.from({ length: index % 3 }, (_, feeIndex) => ({
        id: `stress-fee-${pad(index)}-${feeIndex}`,
        amount: 60 + feeIndex * 35 + (index % 5) * 10,
        currency: pick(['USD', 'CAD', 'GBP', 'CHF'], index + feeIndex),
        paidDate: feeIndex % 2 === 0 ? addDays(baseDate, -feeIndex - index) : null,
        waived: feeIndex % 2 === 1,
        notes: feeIndex % 2 === 1 ? 'Generated waiver case.' : 'Generated payment case.',
        createdAt: `${addDays(baseDate, -feeIndex - index)}T10:00:00.000Z`,
      })),
      tasks,
      timeline: Array.from({ length: 6 }, (_, eventIndex) => ({
        id: `stress-timeline-${pad(index)}-${eventIndex}`,
        title: pick(['Shortlist created', 'Professor contacted', 'Draft reviewed', 'Portal opened', 'Submitted', 'Decision expected'], eventIndex),
        date: addDays(baseDate, -60 + index + eventIndex * 16),
        note: `Generated timeline event ${eventIndex + 1} for stress app ${index}.`,
      })),
      versions,
      shares: [],
      backupSettings: {
        autoBackup: index % 7 === 0,
        frequency: pick(['15m', '1h', 'daily'], index),
        maxBackups: 5 + (index % 4),
      },
      createdAt: `${addDays(baseDate, -80 + index)}T08:00:00.000Z`,
      updatedAt: `${addDays(baseDate, -index % 20)}T12:00:00.000Z`,
    }
  })
}

export function createStressApplicationInput(index = 1, stamp = Date.now()) {
  const [university, professor, emailLocal] = pick(universities, index)
  return {
    professor: `${professor} QA ${stamp}`,
    professorChinese: '',
    professorEmail: `${emailLocal}.qa.${stamp}@example.test`,
    professorHomepage: `https://faculty.example.edu/${emailLocal.replace('.', '-')}-qa-${stamp}`,
    university: `${university} QA ${stamp}`,
    country: pick(countries, index),
    website: `https://www.qa-${stamp}-${index}.edu`,
    program: pick(programs, index),
    deadline: addDays(new Date('2026-07-09T00:00:00.000Z'), 45 + index),
    notes: 'QA-generated application used for boundary and smoke tests.',
  }
}
