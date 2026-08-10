import type { ApplicationRecord, MaterialRecommender, MaterialStatus } from '../../data/applications'

export const checklistGroups = [
  'Core materials',
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

const checklistFileFormats = ['PDF', 'DOCX', 'Spreadsheet', 'Presentation', 'Image'] as const
const checklistSubmissionChannels = ['Online form', 'Link', 'Request', 'Other'] as const

/**
 * Material type describes how an item is submitted, not what the document is
 * about. Content meaning (CV, SOP, transcript, recommendation, and so on)
 * belongs in the item name and workflow group instead.
 */
export const checklistMaterialTypes = [
  ...checklistFileFormats,
  ...checklistSubmissionChannels,
] as const

export type ChecklistMaterialType = (typeof checklistMaterialTypes)[number]
export type ChecklistMaterialFormatSection = 'files' | 'workflow'

export const defaultChecklistMaterialType: ChecklistMaterialType = 'PDF'

export const checklistMaterialFormatSection: Record<ChecklistMaterialType, ChecklistMaterialFormatSection> = {
  PDF: 'files',
  DOCX: 'files',
  Spreadsheet: 'files',
  Presentation: 'files',
  Image: 'files',
  'Online form': 'workflow',
  Link: 'workflow',
  Request: 'workflow',
  Other: 'workflow',
}

/** Account-scoped custom formats live beside the built-ins, capped like statuses. */
export const checklistMaterialFormatLimit = 30

export function normalizeChecklistMaterialFormat(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function checklistMaterialFormatKey(value: string) {
  return normalizeChecklistMaterialFormat(value).toLocaleLowerCase()
}

/**
 * Custom formats are account-wide: a new application must not inherit one from
 * nowhere, and adding one anywhere must reach every application's menu. This
 * drops blanks, built-in collisions, and duplicates while preserving order.
 */
export function normalizeChecklistCustomMaterialFormats(values: readonly string[] | undefined) {
  const builtInKeys = new Set(checklistMaterialTypes.map(checklistMaterialFormatKey))
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of values ?? []) {
    if (typeof candidate !== 'string') continue
    const value = normalizeChecklistMaterialFormat(candidate)
    const key = checklistMaterialFormatKey(value)
    if (!value || value.length > 64 || builtInKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= checklistMaterialFormatLimit) break
  }
  return result
}

export type ChecklistGroup = (typeof checklistGroups)[number]
export type MaterialItem = ApplicationRecord['materials'][number]
export type MaterialFilter = 'all' | `status:${string}` | 'with-reminder' | 'with-attachment'

export const checklistGroupI18n: Record<ChecklistGroup, string> = {
  'Core materials': 'core',
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

export const checklistMaterialTypeI18n: Record<ChecklistMaterialType, string> = {
  PDF: 'pdf',
  DOCX: 'docx',
  Spreadsheet: 'spreadsheet',
  Presentation: 'presentation',
  Image: 'image',
  'Online form': 'onlineForm',
  Link: 'link',
  Request: 'request',
  Other: 'other',
}

const materialFileExtensions: Readonly<Record<ChecklistMaterialType, readonly string[]>> = {
  PDF: ['pdf'],
  DOCX: ['doc', 'docx', 'odt', 'rtf'],
  Spreadsheet: ['csv', 'numbers', 'ods', 'xls', 'xlsb', 'xlsm', 'xlsx'],
  Presentation: ['key', 'odp', 'pps', 'ppsx', 'ppt', 'pptx'],
  Image: ['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'],
  'Online form': [],
  Link: ['url', 'webloc'],
  Request: [],
  Other: [],
}

function fileExtension(fileName: string) {
  const cleanName = fileName.trim().split(/[?#]/, 1)[0] ?? ''
  const lastDot = cleanName.lastIndexOf('.')
  return lastDot >= 0 ? cleanName.slice(lastDot + 1).toLowerCase() : ''
}

/** Resolve an uploaded file to the product-owned format taxonomy. */
export function inferChecklistMaterialType(fileName = '', mimeType = ''): ChecklistMaterialType {
  const normalizedMime = mimeType.trim().toLowerCase().split(';', 1)[0] ?? ''
  const extension = fileExtension(fileName)

  for (const format of checklistFileFormats) {
    if (materialFileExtensions[format].includes(extension)) return format
  }
  if (materialFileExtensions.Link.includes(extension)) return 'Link'

  if (normalizedMime === 'application/pdf') return 'PDF'
  if (
    normalizedMime.includes('wordprocessingml')
    || normalizedMime === 'application/msword'
    || normalizedMime === 'application/rtf'
    || normalizedMime === 'text/rtf'
    || normalizedMime.includes('opendocument.text')
  ) return 'DOCX'
  if (
    normalizedMime.includes('spreadsheetml')
    || normalizedMime.includes('ms-excel')
    || normalizedMime.includes('opendocument.spreadsheet')
    || normalizedMime === 'text/csv'
  ) return 'Spreadsheet'
  if (
    normalizedMime.includes('presentationml')
    || normalizedMime.includes('ms-powerpoint')
    || normalizedMime.includes('opendocument.presentation')
  ) return 'Presentation'
  if (normalizedMime.startsWith('image/')) return 'Image'
  if (normalizedMime === 'text/uri-list') return 'Link'

  return 'Other'
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
  const type = material.type.trim().toLowerCase()
  const group = material.group?.trim().toLowerCase()
  return type === 'recommendation letter'
    || group === 'recommendations'
    || /recommendation|recommender|推荐/i.test(material.name)
}

export function normalizeRecommenders(
  material: MaterialItem,
  count = material.requiredCount ?? 1,
): MaterialRecommender[] {
  const saved = material.recommenders ?? []
  const lastPopulatedIndex = saved.reduce(
    (last, recommender, index) =>
      recommender.name.trim()
      || recommender.contact.trim()
      || recommender.email?.trim()
      || recommender.phone?.trim()
      || recommender.notes?.trim()
      || recommender.deadline?.trim()
      || recommender.deadlineTime?.trim()
      || recommender.reminderDate?.trim()
      || recommender.reminderTime?.trim()
      || recommender.profileId
        ? index
        : last,
    -1,
  )
  const visibleCount = Math.max(count, lastPopulatedIndex + 1)
  return Array.from({ length: visibleCount }, (_, index) => {
    const recommender = saved[index]
    return {
      id: recommender?.id ?? `${material.id}-recommender-${index + 1}`,
      name: recommender?.name ?? '',
      contact: recommender?.contact ?? '',
      email: recommender?.email ?? (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(recommender?.contact ?? '') ? recommender?.contact ?? '' : ''),
      phone: recommender?.phone ?? (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(recommender?.contact ?? '') ? '' : recommender?.contact ?? ''),
      notes: recommender?.notes ?? '',
      deadline: recommender?.deadline ?? '',
      deadlineTime: recommender?.deadlineTime ?? '',
      reminderDate: recommender?.reminderDate ?? '',
      reminderTime: recommender?.reminderTime ?? '',
      ...(recommender?.profileId ? { profileId: recommender.profileId } : {}),
    }
  })
}
