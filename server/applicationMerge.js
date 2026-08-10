const auditIgnoredApplicationFields = new Set(['updatedAt', 'createdAt'])

const teamMajorApplicationChangeRoots = new Set([
  'school',
  'professor',
  'program',
  'status',
  'deadline',
  'priority',
  'progress',
  'tags',
  'nextReminder',
  'result',
  'materials',
  'tasks',
  'scholarships',
  'fees',
  'dossierCards',
])

export function auditClone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

export function summarizeApplicationChanges(before, after, prefix = '', changes = [], limit = 80) {
  if (changes.length >= limit) return changes
  if (Object.is(before, after)) return changes
  if (
    before === null ||
    after === null ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    changes.push(prefix || 'application')
    return changes
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (!prefix && auditIgnoredApplicationFields.has(key)) continue
    const pathName = prefix ? `${prefix}.${key}` : key
    summarizeApplicationChanges(before[key], after[key], pathName, changes, limit)
    if (changes.length >= limit) break
  }
  return changes
}

export function isMajorApplicationChange(changedFields) {
  return changedFields.some((field) => teamMajorApplicationChangeRoots.has(String(field).split('.')[0]))
}

export function compactChangeList(changedFields, limit = 5) {
  const roots = []
  const seen = new Set()
  for (const field of changedFields) {
    const root = String(field).split('.')[0]
    if (!root || seen.has(root)) continue
    seen.add(root)
    roots.push(root)
    if (roots.length >= limit) break
  }
  return roots
}

export function valueAtPath(value, pathName) {
  if (!pathName) return value
  return pathName.split('.').reduce((current, key) => (
    current && typeof current === 'object' ? current[key] : undefined
  ), value)
}

export function setValueAtPath(target, pathName, nextValue) {
  const keys = pathName.split('.')
  let cursor = target
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {}
    }
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = auditClone(nextValue)
}

function valuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

export function buildApplicationAutoMerge(
  baseApplication,
  submittedApplication,
  currentApplication,
  { submittedFields: explicitSubmittedFields } = {},
) {
  // The 80-field cap is useful for human-sized audit summaries, but a merge is
  // a correctness boundary: silently omitting field 81 would reintroduce a
  // partial lost update on large applications.
  const submittedFields = explicitSubmittedFields ?? summarizeApplicationChanges(
      baseApplication,
      submittedApplication,
      '',
      [],
      Number.POSITIVE_INFINITY,
    )
  const currentFields = new Set(summarizeApplicationChanges(
    baseApplication,
    currentApplication,
    '',
    [],
    Number.POSITIVE_INFINITY,
  ))
  const cleanFields = []
  const sameFields = []
  const conflicts = []

  for (const field of submittedFields) {
    const baseValue = valueAtPath(baseApplication, field)
    const submittedValue = valueAtPath(submittedApplication, field)
    const currentValue = valueAtPath(currentApplication, field)
    if (valuesEqual(submittedValue, currentValue)) {
      sameFields.push(field)
      continue
    }
    if (currentFields.has(field) && !valuesEqual(baseValue, currentValue)) {
      conflicts.push({
        field,
        status: 'conflict',
        baseValue,
        eventValue: submittedValue,
        currentValue,
      })
      continue
    }
    cleanFields.push(field)
  }

  return { cleanFields, sameFields, conflicts }
}

/**
 * Resolve a stale team edit without exposing a manual merge queue.
 *
 * Clean fields always apply. When the incoming editor is a teacher or institution
 * admin, their value also wins same-field conflicts. When the incoming editor is
 * the student, the already-saved value is retained, which preserves a concurrent
 * teacher/admin edit. This priority applies only when both edits diverged from the
 * same saved base. A later edit based on the latest saved record is a clean change
 * and therefore wins regardless of the editor's role. The returned record is a
 * detached clone.
 */
export function resolveApplicationAutoMerge(
  baseApplication,
  submittedApplication,
  currentApplication,
  { preferSubmittedConflicts = false } = {},
) {
  const merge = buildApplicationAutoMerge(baseApplication, submittedApplication, currentApplication)
  const application = auditClone(currentApplication)
  const appliedFields = [...merge.cleanFields]
  const teacherPriorityFields = []
  const retainedFields = []

  for (const field of merge.cleanFields) {
    setValueAtPath(application, field, valueAtPath(submittedApplication, field))
  }
  for (const conflict of merge.conflicts) {
    if (preferSubmittedConflicts) {
      setValueAtPath(application, conflict.field, conflict.eventValue)
      appliedFields.push(conflict.field)
      teacherPriorityFields.push(conflict.field)
    } else {
      retainedFields.push(conflict.field)
    }
  }

  return {
    application,
    cleanFields: merge.cleanFields,
    sameFields: merge.sameFields,
    conflicts: merge.conflicts,
    appliedFields,
    teacherPriorityFields,
    retainedFields,
  }
}

/**
 * Merge a stale personal-application submission without silently choosing a
 * winner for fields that both the client and server changed from the same
 * base. Disjoint changes are safe to apply; same-field divergence must be
 * surfaced to the caller as a retryable conflict.
 */
export function resolveApplicationConcurrentWrite(
  baseApplication,
  submittedApplication,
  currentApplication,
  { submittedFields, appliedApplication = submittedApplication } = {},
) {
  const merge = buildApplicationAutoMerge(
    baseApplication,
    submittedApplication,
    currentApplication,
    { submittedFields },
  )
  if (merge.conflicts.length > 0) {
    return {
      ...merge,
      application: null,
      appliedFields: [],
    }
  }

  const application = auditClone(currentApplication)
  for (const field of merge.cleanFields) {
    setValueAtPath(application, field, valueAtPath(appliedApplication, field))
  }
  return {
    ...merge,
    application,
    appliedFields: [...merge.cleanFields],
  }
}

/**
 * `updatedAt` is the compatibility precondition for clients that cannot send
 * a complete `clientBaseApplication`. Make it strictly advance even when two
 * writes land in the same millisecond or the wall clock moves backwards.
 */
export function nextApplicationVersionStamp(currentUpdatedAt, nowMs = Date.now()) {
  const currentMs = Date.parse(String(currentUpdatedAt ?? ''))
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  const nextMs = Number.isFinite(currentMs)
    ? Math.max(safeNowMs, currentMs + 1)
    : safeNowMs
  return new Date(nextMs).toISOString()
}
