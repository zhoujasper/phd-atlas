import { createId, today } from './storage.js'

function buildChecklistMaterial({
  name,
  type,
  group,
  details,
  status = 'Missing',
  requiredCount = 1,
}) {
  const id = createId('material')
  const recommenders = type === 'Request'
    ? Array.from({ length: requiredCount }, (_, index) => ({
        id: `${id}-recommender-${index + 1}`,
        name: '',
        contact: '',
      }))
    : []

  return {
    id,
    name,
    type,
    group,
    details,
    status,
    reminderEnabled: false,
    reminderDate: '',
    requiredCount,
    recommenders,
    version: 'v0',
    updatedAt: today(),
    versions: [],
  }
}

export function buildDefaultChecklistMaterials() {
  return [
    buildChecklistMaterial({
      name: 'Academic CV',
      type: 'Document',
      group: 'Core materials',
      details: 'Current CV with education, publications, projects, and awards.',
    }),
    buildChecklistMaterial({
      name: 'Recommendation Letters',
      type: 'Request',
      group: 'Recommendations',
      details: 'Track each recommender, contact method, and request status.',
      requiredCount: 3,
    }),
    buildChecklistMaterial({
      name: 'Personal Statement (PS)',
      type: 'Essay',
      group: 'Core materials',
      details: 'Applicant background, motivation, and fit narrative.',
    }),
    buildChecklistMaterial({
      name: 'Research Proposal (RP)',
      type: 'Essay',
      group: 'Core materials',
      details: 'Research question, method, expected contribution, and advisor fit.',
    }),
    buildChecklistMaterial({
      name: 'Language Scores (IELTS/TOEFL)',
      type: 'Score report',
      group: 'Testing',
      details: 'Record score report availability and portal delivery status.',
    }),
    buildChecklistMaterial({
      name: 'Portal Registration',
      type: 'Portal',
      group: 'Portal',
      details: 'Register the application portal account and confirm login access.',
    }),
    buildChecklistMaterial({
      name: 'Statement of Purpose (SOP)',
      type: 'Essay',
      group: 'Core materials',
      details: 'Program-specific statement of purpose.',
    }),
    buildChecklistMaterial({
      name: 'Final Submission',
      type: 'Milestone',
      group: 'Submission',
      details: 'Final review, payment, and submission confirmation.',
    }),
  ]
}
