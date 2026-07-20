const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/rtf': ['.rtf'],
  'text/rtf': ['.rtf'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'application/x-tex': ['.tex'],
  'text/x-tex': ['.tex'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip'],
  'application/vnd.rar': ['.rar'],
  'application/x-rar-compressed': ['.rar'],
  'application/x-7z-compressed': ['.7z'],
}

const WILDCARD_EXTENSIONS: Record<string, readonly string[]> = {
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  'text/*': ['.txt', '.md', '.csv', '.rtf', '.tex'],
}

export function normalizeAllowedFileTypes(types: readonly string[] | undefined) {
  return Array.from(new Set(
    (types ?? [])
      .map((type) => type.trim().toLowerCase())
      .filter(Boolean),
  ))
}

export function allowedFileTypesLabel(types: readonly string[], fallback: string) {
  const normalized = normalizeAllowedFileTypes(types)
  return normalized.length ? normalized.join(', ') : fallback
}

export function fileMatchesAllowedTypes(file: Pick<File, 'name' | 'type'>, allowedTypes: readonly string[]) {
  const allowed = normalizeAllowedFileTypes(allowedTypes)
  if (allowed.length === 0) return true

  const name = file.name.toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  const extension = dotIndex >= 0 ? name.slice(dotIndex) : ''
  const mimeType = file.type.toLowerCase()

  return allowed.some((type) => {
    if (type.startsWith('.')) return extension === type || name.endsWith(type)
    if (type.endsWith('/*')) {
      return mimeType.startsWith(type.slice(0, -1)) || (WILDCARD_EXTENSIONS[type]?.includes(extension) ?? false)
    }
    if (type.includes('/')) {
      return mimeType === type || (MIME_EXTENSIONS[type]?.includes(extension) ?? false)
    }
    return extension === `.${type}`
  })
}
