import type { ApplicationRecord } from './data/applications'
import {
  allowedFileTypesLabel,
  fileMatchesAllowedTypes,
  normalizeAllowedFileTypes,
} from './fileTypes'

export { allowedFileTypesLabel, fileMatchesAllowedTypes, normalizeAllowedFileTypes }

type MaterialItem = ApplicationRecord['materials'][number]
type TaskItem = ApplicationRecord['tasks'][number]
type ChecklistAttachmentItem = MaterialItem | TaskItem

export type AttachmentRow = {
  id: string
  file: string
  author: string
  createdAt: string
  fileId?: string
  storageName?: string
  size?: number
  mimeType?: string
  current: boolean
}

export const uploadOtherTypeId = 'other'

export const uploadTypePresets = [
  { id: 'image', labelKey: 'dossier.fileTypeImages', accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], custom: false },
  { id: 'document', labelKey: 'dossier.fileTypeDocuments', accept: ['.pdf', '.doc', '.docx', '.rtf', '.txt'], custom: false },
  { id: 'spreadsheet', labelKey: 'dossier.fileTypeSpreadsheets', accept: ['.xls', '.xlsx', '.csv'], custom: false },
  { id: 'archive', labelKey: 'dossier.fileTypeArchives', accept: ['.zip', '.rar', '.7z'], custom: false },
  { id: uploadOtherTypeId, labelKey: 'dossier.fileTypeOther', accept: [], custom: true },
] as const

export function getUploadPresetSelection(existingTypes: readonly string[] | undefined) {
  const normalizedTypes = normalizeAllowedFileTypes(existingTypes)
  const presetIds = uploadTypePresets
    .filter((preset) => !preset.custom && preset.accept.every((type) => normalizedTypes.includes(type)))
    .map((preset) => preset.id)
  const presetValues: string[] = uploadTypePresets
    .filter((preset) => !preset.custom && presetIds.includes(preset.id))
    .flatMap((preset) => preset.accept)
  const customTypes = normalizedTypes.filter((type) => !presetValues.includes(type))
  return { presetIds, customTypes }
}

export function resolveUploadAllowedTypes(selectedPresetIds: readonly string[], customTypesInput: string) {
  const presetTypes = uploadTypePresets
    .filter((preset) => !preset.custom && selectedPresetIds.includes(preset.id))
    .flatMap((preset) => preset.accept)
  const customTypes = selectedPresetIds.includes(uploadOtherTypeId)
    ? customTypesInput
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
  return normalizeAllowedFileTypes([...presetTypes, ...customTypes])
}

export function createRenamedFile(file: File, name: string) {
  const normalized = name.trim()
  if (!normalized || normalized === file.name) return file
  return new File([file], normalized, { type: file.type, lastModified: file.lastModified })
}

function splitFileName(value: string) {
  const trimmed = value.trim()
  const dotIndex = trimmed.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return { stem: trimmed, extension: '' }
  }
  return {
    stem: trimmed.slice(0, dotIndex),
    extension: trimmed.slice(dotIndex),
  }
}

export function sanitizeUploadName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
}

export function buildUploadFileName(
  file: Pick<File, 'name'>,
  baseName: string,
  index: number,
  total: number,
  fallbackName: string,
) {
  const cleanBase = sanitizeUploadName(baseName)
  if (!cleanBase) return sanitizeUploadName(fallbackName) || file.name
  const base = splitFileName(cleanBase)
  const original = splitFileName(file.name)
  const stem = base.stem || original.stem || 'upload'
  const extension = base.extension || original.extension
  const suffix = total > 1 ? ` ${index + 1}` : ''
  return `${stem}${suffix}${extension}`
}

export function normalizeUploadFileName(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function attachmentRows(item: ChecklistAttachmentItem): AttachmentRow[] {
  const rows: AttachmentRow[] = []
  const seen = new Set<string>()
  const versions = item.versions ?? []
  versions.forEach((version, index) => {
    const key = version.fileId || version.id || `${version.file}-${index}`
    seen.add(key)
    rows.push({
      ...version,
      id: version.id || key,
      file: version.file,
      current: Boolean(version.fileId && version.fileId === item.fileId),
    })
  })
  if (item.fileId && !seen.has(item.fileId)) {
    rows.push({
      id: item.fileId,
      fileId: item.fileId,
      file: item.fileName ?? '',
      author: '',
      createdAt: 'updatedAt' in item ? item.updatedAt : '',
      storageName: item.storageName,
      size: item.fileSize,
      mimeType: item.mimeType,
      current: true,
    })
  }
  return rows
    .map((row) => ({ ...row, current: Boolean(row.fileId && row.fileId === item.fileId) }))
    .reverse()
}
