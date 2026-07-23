import type { SharedApplicationPayload } from '../../api/phdApi'
import type { DetailTab } from '../../appModel'
import type { ApplicationRecord, ShareSection } from '../../data/applications'

/** Map share sections → dossier DetailTabs (materials + tasks share the checklist tab). */
export function shareSectionsToDetailTabs(sections: readonly ShareSection[]): DetailTab[] {
  const tabs: DetailTab[] = []
  const set = new Set(sections)
  if (set.has('overview')) tabs.push('dossier')
  if (set.has('materials') || set.has('tasks')) tabs.push('materials')
  if (set.has('communications')) tabs.push('mail')
  if (set.has('funding')) tabs.push('funding')
  if (set.has('timeline')) tabs.push('timeline')
  return tabs
}

export function sharedPayloadToApplication(data: SharedApplicationPayload): ApplicationRecord {
  return {
    id: 'shared-application',
    ownerId: 'share-owner',
    professor: {
      english: data.professor.english,
      chinese: data.professor.chinese ?? '',
      email: data.professor.email,
      phone: data.professor.phone ?? '',
      social: data.professor.social ?? '',
      homepage: data.professor.homepage,
      research: data.professor.research,
      lab: data.professor.lab ?? '',
    },
    school: {
      name: data.school.name,
      country: data.school.country,
      website: data.school.website,
    },
    program: data.program,
    deadline: data.deadline,
    status: data.status,
    progress: typeof data.progress === 'number' ? data.progress : 0,
    priority: typeof data.priority === 'number' ? data.priority : 0,
    tags: data.tags ?? [],
    nextReminder: data.nextReminder ?? '',
    result: data.result ?? '',
    dossierCards: data.dossierCards,
    materials: (data.materials ?? []).map((material) => ({
      id: material.id,
      name: material.name,
      type: material.type ?? 'Document',
      status: material.status,
      group: material.group,
      details: material.details,
      reminderEnabled: material.reminderEnabled,
      reminderDate: material.reminderDate,
      requiredCount: material.requiredCount,
      recommenders: material.recommenders,
      version: material.version ?? 'v0',
      updatedAt: material.updatedAt ?? '',
      fileId: material.fileId,
      fileName: material.fileName,
      fileSize: material.fileSize,
      uploadReserved: material.uploadReserved,
      allowedFileTypes: material.allowedFileTypes,
      versions: material.versions,
    })),
    communications: data.communications ?? [],
    scholarships: data.scholarships ?? [],
    fees: data.fees ?? [],
    tasks: (data.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      due: task.due,
      done: task.done,
      details: task.details,
      attachmentRequired: task.attachmentRequired,
      allowedFileTypes: task.allowedFileTypes,
      fileId: task.fileId,
      fileName: task.fileName,
      fileSize: task.fileSize,
      uploadReserved: task.uploadReserved,
      versions: task.versions,
    })),
    timeline: data.timeline ?? [],
    versions: data.versions ?? [],
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}
