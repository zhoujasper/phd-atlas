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

export function summarizeApplicationChanges(before, after, prefix = '', changes = []) {
  if (changes.length >= 80) return changes
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
    summarizeApplicationChanges(before[key], after[key], pathName, changes)
    if (changes.length >= 80) break
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

export function buildApplicationMergePreview(baseApplication, eventApplication, currentApplication) {
  const fields = summarizeApplicationChanges(baseApplication, eventApplication)
  return fields.map((field) => {
    const baseValue = valueAtPath(baseApplication, field)
    const eventValue = valueAtPath(eventApplication, field)
    const currentValue = valueAtPath(currentApplication, field)
    const currentChanged = !valuesEqual(baseValue, currentValue)
    const alreadyApplied = valuesEqual(eventValue, currentValue)
    return {
      field,
      status: alreadyApplied ? 'same' : currentChanged ? 'conflict' : 'clean',
      baseValue,
      eventValue,
      currentValue,
    }
  })
}

export function buildApplicationAutoMerge(baseApplication, submittedApplication, currentApplication) {
  const submittedFields = summarizeApplicationChanges(baseApplication, submittedApplication)
  const currentFields = new Set(summarizeApplicationChanges(baseApplication, currentApplication))
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
 * teacher/admin edit. The returned record is a detached clone.
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
