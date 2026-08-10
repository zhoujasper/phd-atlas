export const checklistTaskStatusOrder = ['Open', 'Done'] as const

export const checklistStatusLimit = 30

export function normalizeChecklistStatus(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function checklistStatusKey(value: string) {
  return normalizeChecklistStatus(value).toLocaleLowerCase()
}

/**
 * Keeps built-ins stable, account-created values in their saved order, and
 * legacy values reachable without accidentally creating duplicate options.
 * Legacy values are intentionally appended so old records remain editable
 * after an account taxonomy entry is deleted.
 */
export function mergeChecklistStatuses(
  builtIns: readonly string[],
  custom: readonly string[] = [],
  legacyValues: readonly string[] = [],
) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of [...builtIns, ...custom, ...legacyValues]) {
    const value = normalizeChecklistStatus(candidate)
    const key = checklistStatusKey(value)
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

export function normalizeChecklistCustomStatuses(
  values: readonly string[] | undefined,
  builtIns: readonly string[],
) {
  const builtInKeys = new Set(builtIns.map(checklistStatusKey))
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of values ?? []) {
    const value = normalizeChecklistStatus(candidate)
    const key = checklistStatusKey(value)
    if (!value || value.length > 64 || builtInKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= checklistStatusLimit) break
  }
  return result
}
