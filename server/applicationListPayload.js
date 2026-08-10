export const APPLICATION_LIST_SLIM_MARKER = '__listSlim'

function summarizeCommunication(communication) {
  return {
    id: communication?.id ?? '',
    subject: communication?.subject ?? '',
    channel: communication?.channel ?? '',
    date: communication?.date ?? '',
    summary: communication?.summary ?? '',
    direction: communication?.direction,
    messageType: communication?.messageType,
    from: communication?.from,
    to: communication?.to,
    time: communication?.time,
    deliveryStatus: communication?.deliveryStatus,
    scheduledAt: communication?.scheduledAt,
    sentAt: communication?.sentAt,
    deliveryId: communication?.deliveryId,
    sourceMessageKey: communication?.sourceMessageKey,
    sourceMailbox: communication?.sourceMailbox,
    importedAt: communication?.importedAt,
    mailCategories: communication?.mailCategories,
    mailCategoryOverride: communication?.mailCategoryOverride,
    mailClassification: communication?.mailClassification,
  }
}

function summarizeMaterial(material) {
  return {
    id: material?.id ?? '',
    name: material?.name ?? '',
    type: material?.type ?? '',
    status: material?.status ?? 'not_started',
    group: material?.group,
    reminderEnabled: material?.reminderEnabled,
    reminderDate: material?.reminderDate,
    reminderTime: material?.reminderTime,
    reminderRepeat: material?.reminderRepeat,
    uploadReserved: material?.uploadReserved,
    allowedFileTypes: material?.allowedFileTypes,
    requiredCount: material?.requiredCount,
    version: material?.version ?? '',
    updatedAt: material?.updatedAt ?? '',
    fileId: material?.fileId,
    fileName: material?.fileName,
    fileSize: material?.fileSize,
    mimeType: material?.mimeType,
    storageName: material?.storageName,
    versions: [],
  }
}

function summarizeScholarship(scholarship) {
  return {
    id: scholarship?.id ?? '',
    name: scholarship?.name ?? '',
    amount: scholarship?.amount ?? '',
    startDate: scholarship?.startDate ?? '',
    endDate: scholarship?.endDate ?? '',
    school: scholarship?.school,
    issuer: scholarship?.issuer,
    status: scholarship?.status,
    materials: [],
    tasks: [],
    timeline: [],
  }
}

function summarizeTask(task) {
  return {
    id: task?.id ?? '',
    title: task?.title ?? '',
    due: task?.due ?? '',
    done: Boolean(task?.done),
    status: task?.status,
    reminderEnabled: task?.reminderEnabled,
    reminderTime: task?.reminderTime,
    reminderRepeat: task?.reminderRepeat,
    attachmentRequired: task?.attachmentRequired,
    uploadReserved: task?.uploadReserved,
    allowedFileTypes: task?.allowedFileTypes,
    fileId: task?.fileId,
    fileName: task?.fileName,
    fileSize: task?.fileSize,
    mimeType: task?.mimeType,
    storageName: task?.storageName,
    versions: [],
  }
}

export function applicationListPayload(application) {
  return {
    ...application,
    [APPLICATION_LIST_SLIM_MARKER]: true,
    materials: Array.isArray(application?.materials)
      ? application.materials.map(summarizeMaterial)
      : [],
    communications: Array.isArray(application?.communications)
      ? application.communications.map(summarizeCommunication)
      : [],
    scholarships: Array.isArray(application?.scholarships)
      ? application.scholarships.map(summarizeScholarship)
      : [],
    tasks: Array.isArray(application?.tasks)
      ? application.tasks.map(summarizeTask)
      : [],
    versions: [],
    reviewComments: [],
  }
}
