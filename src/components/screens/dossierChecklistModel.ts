import type { ApplicationRecord, MaterialRecommender, MaterialStatus } from '../../data/applications'

export const checklistGroups = [
  'Core materials',
  'Recommendations',
  'Testing',
  'Portal',
  'Writing',
  'Funding',
  'Administrative',
  'Interview',
  'Post-submit',
  'Visa',
  'Submission',
  'Custom',
] as const

export const checklistMaterialTypes = [
  'File',
  'Academic CV',
  'Resume',
  'Statement of Purpose',
  'Personal Statement',
  'Research Proposal',
  'Writing Sample',
  'Transcript',
  'Degree Certificate',
  'Recommendation Letter',
  'Language Test',
  'GRE / GMAT Score',
  'Portfolio',
  'Publication List',
  'Passport',
  'Application Form',
  'Funding Form',
  'Interview Notes',
] as const

export type ChecklistGroup = typeof checklistGroups[number]
export type MaterialItem = ApplicationRecord['materials'][number]
export type MaterialFilter = 'all' | `status:${string}` | 'with-reminder' | 'with-attachment'

export const checklistGroupI18n: Record<ChecklistGroup, string> = {
  'Core materials': 'core',
  Recommendations: 'recommendations',
  Testing: 'testing',
  Portal: 'portal',
  Writing: 'writing',
  Funding: 'funding',
  Administrative: 'administrative',
  Interview: 'interview',
  'Post-submit': 'postSubmit',
  Visa: 'visa',
  Submission: 'submission',
  Custom: 'custom',
}

export const checklistMaterialTypeI18n: Record<(typeof checklistMaterialTypes)[number], string> = {
  File: 'file',
  'Academic CV': 'academicCv',
  Resume: 'resume',
  'Statement of Purpose': 'statementOfPurpose',
  'Personal Statement': 'personalStatement',
  'Research Proposal': 'researchProposal',
  'Writing Sample': 'writingSample',
  Transcript: 'transcript',
  'Degree Certificate': 'degreeCertificate',
  'Recommendation Letter': 'recommendationLetter',
  'Language Test': 'languageTest',
  'GRE / GMAT Score': 'greGmatScore',
  Portfolio: 'portfolio',
  'Publication List': 'publicationList',
  Passport: 'passport',
  'Application Form': 'applicationForm',
  'Funding Form': 'fundingForm',
  'Interview Notes': 'interviewNotes',
}

export function materialStatusFilterValue(status: MaterialStatus): MaterialFilter {
  return `status:${status}`
}

export function fileSizeLabel(size?: number) {
  if (!size && size !== 0) return '—'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function isChecklistGroup(value: string): value is ChecklistGroup {
  return checklistGroups.includes(value as ChecklistGroup)
}

export function isRecommendationMaterial(material: MaterialItem) {
  return material.type === 'Request' || /recommendation|recommender|推荐/i.test(material.name)
}

export function normalizeRecommenders(material: MaterialItem, count = material.requiredCount ?? 1): MaterialRecommender[] {
  return Array.from({ length: count }, (_, index) => {
    const recommender = material.recommenders?.[index]
    return {
      id: recommender?.id ?? `${material.id}-recommender-${index + 1}`,
      name: recommender?.name ?? '',
      contact: recommender?.contact ?? '',
    }
  })
}
