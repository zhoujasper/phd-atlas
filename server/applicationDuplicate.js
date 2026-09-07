/** Copy reusable requirements; delivery history and file-vault handles belong to the source. */
export function copyApplicationSetup(source, target, createId, date) {
  const copy = structuredClone(target)
  copy.priority = source.priority
  copy.tags = [...(source.tags ?? [])]
  copy.progress = 0
  copy.status = 'Draft'
  copy.result = ''
  copy.nextReminder = ''
  copy.timeline = [{ id: createId('time'), title: 'Draft created', date, note: '' }]
  copy.materials = (source.materials ?? []).map((item) => ({
    id: createId('mat'), name: item.name, type: item.type, group: item.group,
    details: item.details ?? '', status: 'Draft', version: 'v1', updatedAt: date,
    uploadReserved: item.uploadReserved, allowedFileTypes: [...(item.allowedFileTypes ?? [])],
    requiredCount: item.requiredCount ?? 1, reminderEnabled: false,
    reminderDate: '', reminderTime: '', reminderRepeat: 'once', versions: [], recommenders: [],
  }))
  copy.tasks = (source.tasks ?? []).map((item) => ({
    id: createId('task'), title: item.title, details: item.details ?? '', due: item.due ?? '',
    done: false, status: 'Draft', reminderEnabled: false, reminderTime: '',
    attachmentRequired: item.attachmentRequired, uploadReserved: item.uploadReserved,
    allowedFileTypes: [...(item.allowedFileTypes ?? [])], versions: [],
  }))
  copy.recommenders = (source.recommenders ?? []).map((item) => ({
    id: createId('rec'), name: item.name, email: item.email, phone: item.phone,
    contact: item.contact, profileId: item.profileId, notes: item.notes,
    deadline: item.deadline, deadlineTime: item.deadlineTime, reminderDate: '', reminderTime: '',
  }))
  if (source.dossierCards) copy.dossierCards = source.dossierCards.map((card) => ({
    ...structuredClone(card), id: createId('card'),
    fields: card.fields.map((field) => ({ ...field, id: createId('field') })),
    createdAt: target.createdAt, updatedAt: target.updatedAt,
  }))
  return copy
}
