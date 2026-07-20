import { fileMatchesAllowedTypes, normalizeAllowedFileTypes } from './fileTypes'

export const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024
export const MAX_UPLOAD_FILES_PER_BATCH = 20
export const MAX_MAIL_ATTACHMENT_FILES = 10
export const MAX_CSV_IMPORT_FILE_SIZE = 5 * 1024 * 1024
export const MAX_SYSTEM_UPDATE_FILE_SIZE = 100 * 1024 * 1024

export const DEFAULT_UPLOAD_ALLOWED_TYPES = [
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.doc', '.docx', '.rtf', '.txt', '.md', '.tex',
  '.xls', '.xlsx', '.csv', '.json',
  '.zip', '.rar', '.7z',
] as const

export type FileUploadRejectionReason = 'type' | 'size' | 'count' | 'single'

export type FileUploadRejection = {
  file: File
  reasons: FileUploadRejectionReason[]
}

export type FileUploadValidationOptions = {
  allowedTypes?: readonly string[]
  maxFileSize?: number
  maxFiles?: number
  existingFileCount?: number
  multiple?: boolean
}

export type FileUploadValidationResult = {
  accepted: File[]
  rejected: FileUploadRejection[]
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    const megabytes = bytes / 1024 / 1024
    return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`
  }
  const gigabytes = bytes / 1024 / 1024 / 1024
  return `${gigabytes >= 10 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`
}

export function uploadAcceptValue(allowedTypes: readonly string[] | undefined) {
  return normalizeAllowedFileTypes(allowedTypes).join(',')
}

export function validateUploadFiles(
  files: FileList | readonly File[] | null | undefined,
  {
    allowedTypes = DEFAULT_UPLOAD_ALLOWED_TYPES,
    maxFileSize = MAX_UPLOAD_FILE_SIZE,
    maxFiles = MAX_UPLOAD_FILES_PER_BATCH,
    existingFileCount = 0,
    multiple = true,
  }: FileUploadValidationOptions = {},
): FileUploadValidationResult {
  const incoming = Array.from(files ?? [])
  const normalizedAllowedTypes = normalizeAllowedFileTypes(allowedTypes)
  const accepted: File[] = []
  const rejected: FileUploadRejection[] = []
  const normalizedExistingCount = Math.max(0, Math.floor(existingFileCount))
  const normalizedMaxFiles = Math.max(0, Math.floor(multiple ? maxFiles : 1))
  const remainingSlots = Math.max(0, normalizedMaxFiles - normalizedExistingCount)

  incoming.forEach((file) => {
    const reasons: FileUploadRejectionReason[] = []

    // Size and type are checked for every individual file before capacity is considered.
    // This keeps a large file from being hidden behind a total-count error.
    if (maxFileSize > 0 && file.size > maxFileSize) reasons.push('size')
    if (normalizedAllowedTypes.length > 0 && !fileMatchesAllowedTypes(file, normalizedAllowedTypes)) {
      reasons.push('type')
    }

    if (!multiple && accepted.length >= 1) {
      reasons.push('single')
    } else if (accepted.length >= remainingSlots) {
      reasons.push(multiple ? 'count' : 'single')
    }

    if (reasons.length > 0) {
      rejected.push({ file, reasons: Array.from(new Set(reasons)) })
      return
    }

    accepted.push(file)
  })

  return { accepted, rejected }
}

export function filesRejectedForReason(
  rejected: readonly FileUploadRejection[],
  reason: FileUploadRejectionReason,
) {
  return rejected.filter((item) => item.reasons.includes(reason)).map((item) => item.file)
}
