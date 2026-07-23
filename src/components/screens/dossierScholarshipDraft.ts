import { today } from '../../appModel'
import type { ApplicationRecord } from '../../data/applications'

export const scholarshipStatusOrder = ['Draft', 'Preparing', 'Submitted', 'Awarded', 'Rejected'] as const

export type ScholarshipStatus = typeof scholarshipStatusOrder[number]
export type ScholarshipItem = ApplicationRecord['scholarships'][number]
export type ScholarshipMaterialItem = NonNullable<ScholarshipItem['materials']>[number]
export type ScholarshipTaskItem = NonNullable<ScholarshipItem['tasks']>[number]
export type ScholarshipTimelineItem = NonNullable<ScholarshipItem['timeline']>[number]

export type ScholarshipFormDraft = {
  name: string
  amount: string
  startDate: string
  endDate: string
  school: string
  issuer: string
  status: ScholarshipStatus
  notes: string
  materials: ScholarshipMaterialItem[]
  tasks: ScholarshipTaskItem[]
  timeline: ScholarshipTimelineItem[]
}

export function createScholarshipDraft(school = ''): ScholarshipFormDraft {
  return {
    name: '',
    amount: '',
    startDate: today,
    endDate: today,
    school,
    issuer: '',
    status: 'Preparing',
    notes: '',
    materials: [],
    tasks: [],
    timeline: [],
  }
}

export function scholarshipToDraft(
  scholarship: ScholarshipItem,
  fallbackSchool = '',
): ScholarshipFormDraft {
  return {
    name: scholarship.name ?? '',
    amount: scholarship.amount ?? '',
    startDate: scholarship.startDate || today,
    endDate: scholarship.endDate || scholarship.startDate || today,
    school: scholarship.school || fallbackSchool,
    issuer: scholarship.issuer ?? '',
    status: scholarship.status ?? 'Preparing',
    notes: scholarship.notes ?? '',
    materials: (scholarship.materials ?? []).map((material) => ({
      id: material.id,
      name: material.name,
      status: material.status ?? 'Draft',
      due: material.due ?? '',
      details: material.details ?? '',
    })),
    tasks: (scholarship.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      due: task.due || scholarship.endDate || today,
      done: Boolean(task.done),
      details: task.details ?? '',
    })),
    timeline: (scholarship.timeline ?? []).map((event) => ({
      id: event.id,
      title: event.title,
      date: event.date || scholarship.endDate || today,
      note: event.note ?? '',
    })),
  }
}

/**
 * Trims user-entered values and omits blank nested records before persistence.
 * Keeping this alongside the inverse draft conversion makes the boundary between
 * editable UI state and the persisted application record explicit.
 */
export function cleanScholarshipDraft(draft: ScholarshipFormDraft): Omit<ScholarshipItem, 'id'> {
  const startDate = draft.startDate || today
  const endDate = draft.endDate || startDate
  return {
    name: draft.name.trim(),
    amount: draft.amount.trim(),
    startDate,
    endDate,
    school: draft.school.trim(),
    issuer: draft.issuer.trim(),
    status: draft.status,
    notes: draft.notes.trim(),
    materials: draft.materials
      .filter((material) => material.name.trim())
      .map((material) => ({
        id: material.id,
        name: material.name.trim(),
        status: material.status,
        due: material.due || '',
        details: material.details?.trim() ?? '',
      })),
    tasks: draft.tasks
      .filter((task) => task.title.trim())
      .map((task) => ({
        id: task.id,
        title: task.title.trim(),
        due: task.due || endDate,
        done: Boolean(task.done),
        details: task.details?.trim() ?? '',
      })),
    timeline: draft.timeline
      .filter((event) => event.title.trim())
      .map((event) => ({
        id: event.id,
        title: event.title.trim(),
        date: event.date || endDate,
        note: event.note?.trim() ?? '',
      })),
  }
}
