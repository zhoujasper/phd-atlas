import { isApplicationServerAuthorityPath } from '../shared/applicationAuthorityFields.js'

const MAX_APPLICATION_DELTA_OPERATIONS = 2_048
const MAX_APPLICATION_DELTA_DEPTH = 64
const MAX_APPLICATION_DELTA_PATH_LENGTH = 2_048
const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor'])
const immutableIdentitySegments = new Set(['id', 'ownerId', 'teamId', 'createdAt', 'updatedAt'])

export class ApplicationDeltaError extends Error {
  constructor(message, field = 'operations') {
    super(message)
    this.name = 'ApplicationDeltaError'
    this.code = 'APPLICATION_DELTA_INVALID'
    this.status = 400
    this.field = field
  }
}

function decodePointer(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_APPLICATION_DELTA_PATH_LENGTH) {
    throw new ApplicationDeltaError('An application delta path is invalid.')
  }
  if (!path.startsWith('/')) throw new ApplicationDeltaError('Application delta paths must be JSON pointers.')
  const segments = path.slice(1).split('/').map((segment) => {
    if (/~(?:[^01]|$)/u.test(segment)) throw new ApplicationDeltaError('An application delta path has invalid escaping.')
    const decoded = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!decoded || forbiddenSegments.has(decoded)) {
      throw new ApplicationDeltaError('An application delta path is not allowed.')
    }
    return decoded
  })
  if (
    segments.length > MAX_APPLICATION_DELTA_DEPTH
    || isApplicationServerAuthorityPath(segments)
  ) {
    throw new ApplicationDeltaError('This application field must be changed through its dedicated workflow.', path)
  }
  return segments
}

function validateDeltaValue(value) {
  const stack = [{ value, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current.value || typeof current.value !== 'object') continue
    if (current.depth >= MAX_APPLICATION_DELTA_DEPTH) {
      throw new ApplicationDeltaError('An application delta value is nested too deeply.')
    }
    for (const key of Object.keys(current.value)) {
      if (forbiddenSegments.has(key)) {
        throw new ApplicationDeltaError('An application delta value contains an unsafe field.')
      }
      stack.push({ value: current.value[key], depth: current.depth + 1 })
    }
  }
}

function arrayIndex(segment, length, { allowEnd = false } = {}) {
  if (allowEnd && segment === '-') return length
  if (!/^(0|[1-9]\d*)$/u.test(segment)) {
    throw new ApplicationDeltaError('An application delta array index is invalid.')
  }
  const index = Number(segment)
  const maximum = allowEnd ? length : length - 1
  if (!Number.isSafeInteger(index) || index < 0 || index > maximum) {
    throw new ApplicationDeltaError('An application delta array index is out of range.')
  }
  return index
}

function updateAtPath(node, segments, operation, depth = 0) {
  if (!node || typeof node !== 'object') {
    throw new ApplicationDeltaError('An application delta path does not exist.', operation.path)
  }
  const segment = segments[depth]
  const final = depth === segments.length - 1
  if (Array.isArray(node)) {
    const copy = node.slice()
    if (final) {
      const index = arrayIndex(segment, copy.length, { allowEnd: operation.op === 'add' })
      if (operation.op === 'add') copy.splice(index, 0, operation.value)
      else if (operation.op === 'remove') copy.splice(index, 1)
      else copy[index] = operation.value
      return copy
    }
    const index = arrayIndex(segment, copy.length)
    copy[index] = updateAtPath(copy[index], segments, operation, depth + 1)
    return copy
  }

  const copy = { ...node }
  if (final) {
    const exists = Object.hasOwn(node, segment)
    if (operation.op !== 'add' && !exists) {
      throw new ApplicationDeltaError('An application delta path does not exist.', operation.path)
    }
    if (operation.op === 'remove') delete copy[segment]
    else copy[segment] = operation.value
    return copy
  }
  if (!Object.hasOwn(node, segment)) {
    throw new ApplicationDeltaError('An application delta path does not exist.', operation.path)
  }
  copy[segment] = updateAtPath(copy[segment], segments, operation, depth + 1)
  return copy
}

function reorderAtPath(node, segments, ids, depth = 0) {
  if (!node || typeof node !== 'object') {
    throw new ApplicationDeltaError('An application reorder path does not exist.')
  }
  if (depth === segments.length) {
    if (!Array.isArray(node)) throw new ApplicationDeltaError('Only arrays can be reordered.')
    const byId = new Map()
    for (const item of node) {
      const id = String(item?.id ?? '')
      if (!id || byId.has(id)) throw new ApplicationDeltaError('Reordered array items require unique ids.')
      byId.set(id, item)
    }
    if (ids.length !== byId.size || new Set(ids).size !== ids.length) {
      throw new ApplicationDeltaError('A reordered array must contain every item exactly once.')
    }
    return ids.map((id) => {
      if (!byId.has(id)) throw new ApplicationDeltaError('A reordered array contains an unknown id.')
      return byId.get(id)
    })
  }
  const segment = segments[depth]
  if (Array.isArray(node)) {
    const copy = node.slice()
    const index = arrayIndex(segment, copy.length)
    copy[index] = reorderAtPath(copy[index], segments, ids, depth + 1)
    return copy
  }
  if (!Object.hasOwn(node, segment)) throw new ApplicationDeltaError('An application reorder path does not exist.')
  return { ...node, [segment]: reorderAtPath(node[segment], segments, ids, depth + 1) }
}

export function applyApplicationDelta(application, input) {
  const operations = input?.operations
  if (!Array.isArray(operations) || operations.length > MAX_APPLICATION_DELTA_OPERATIONS) {
    throw new ApplicationDeltaError(`Application deltas support at most ${MAX_APPLICATION_DELTA_OPERATIONS} operations.`)
  }
  let result = application
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') throw new ApplicationDeltaError('An application delta operation is invalid.')
    if (operation.op === 'reorder') {
      const segments = decodePointer(operation.path)
      if (!Array.isArray(operation.ids) || operation.ids.length > 10_000) {
        throw new ApplicationDeltaError('An application reorder operation is invalid.', operation.path)
      }
      const ids = operation.ids.map((id) => String(id ?? ''))
      result = reorderAtPath(result, segments, ids)
      continue
    }
    if (!['add', 'remove', 'replace'].includes(operation.op)) {
      throw new ApplicationDeltaError('An application delta operation is unsupported.')
    }
    if (operation.op !== 'remove' && !Object.hasOwn(operation, 'value')) {
      throw new ApplicationDeltaError('An application delta value is missing.', operation.path)
    }
    const segments = decodePointer(operation.path)
    if (operation.op !== 'add' && immutableIdentitySegments.has(segments.at(-1))) {
      throw new ApplicationDeltaError('Application identities cannot be changed in place.', operation.path)
    }
    if (operation.op !== 'remove') validateDeltaValue(operation.value)
    result = updateAtPath(result, segments, operation)
  }
  return result
}

function canonicalFieldExcluded(root, depth, key) {
  // Logo bookkeeping belongs to the server. Both the resolved image and the
  // auto-detect flag are rewritten when the school identity changes — most
  // visibly when editing the website invalidates an auto-detected logo — and
  // neither is a value the submitter can lose by that rewrite.
  if (root === 'school' && depth === 0 && key === 'logoAutoDetect') return true
  if (root === 'school' && depth === 0) return isApplicationServerAuthorityPath([root, key])
  if ((root === 'materials' || root === 'tasks' || root === 'communications') && depth === 1) {
    return isApplicationServerAuthorityPath([root, 0, key])
  }
  return false
}

function canonicalValuesEqual(left, right, root) {
  const stack = [{ left, right, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Object.is(current.left, current.right)) continue
    if (Array.isArray(current.left) || Array.isArray(current.right)) {
      if (
        !Array.isArray(current.left)
        || !Array.isArray(current.right)
        || current.left.length !== current.right.length
      ) return false
      for (let index = current.left.length - 1; index >= 0; index -= 1) {
        stack.push({
          left: current.left[index],
          right: current.right[index],
          depth: current.depth + 1,
        })
      }
      continue
    }
    if (
      !current.left
      || !current.right
      || typeof current.left !== 'object'
      || typeof current.right !== 'object'
    ) return false
    const keys = new Set([...Object.keys(current.left), ...Object.keys(current.right)])
    for (const key of keys) {
      if (canonicalFieldExcluded(root, current.depth, key)) continue
      stack.push({
        left: current.left[key],
        right: current.right[key],
        depth: current.depth + 1,
      })
    }
  }
  return true
}

/**
 * Confirms that schema normalization and server-authority preservation did not
 * silently strip any client-owned value touched by this delta. The comparison
 * is iterative and limited to changed top-level roots, so it does not allocate
 * another serialized copy of a multi-megabyte application.
 */
export function applicationDeltaCanonicalMatches(expected, canonical, input) {
  const roots = new Set()
  for (const operation of input?.operations ?? []) {
    const [root] = decodePointer(operation.path)
    if (root) roots.add(root)
  }
  for (const root of roots) {
    if (!canonicalValuesEqual(expected?.[root], canonical?.[root], root)) return false
  }
  return true
}

function canonicalKeysRetained(submitted, canonical, root) {
  const stack = [{ submitted, canonical, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current.submitted === undefined || current.submitted === null) continue
    if (typeof current.submitted !== 'object') continue
    if (Array.isArray(current.submitted)) {
      if (!Array.isArray(current.canonical)) return false
      // Length is the array's own "key set". Normalization that drops an entry
      // is the loss this check exists to catch.
      if (current.canonical.length !== current.submitted.length) return false
      for (let index = current.submitted.length - 1; index >= 0; index -= 1) {
        stack.push({
          submitted: current.submitted[index],
          canonical: current.canonical[index],
          depth: current.depth + 1,
        })
      }
      continue
    }
    if (!current.canonical || typeof current.canonical !== 'object') return false
    for (const key of Object.keys(current.submitted)) {
      if (current.submitted[key] === undefined) continue
      if (canonicalFieldExcluded(root, current.depth, key)) continue
      if (!Object.hasOwn(current.canonical, key)) return false
      stack.push({
        submitted: current.submitted[key],
        canonical: current.canonical[key],
        depth: current.depth + 1,
      })
    }
  }
  return true
}

/**
 * Weaker companion to the canonical comparison: every key the submission
 * carried on a touched root still exists in the saved record.
 *
 * Normalization is allowed to rewrite an authored value — trimming it, filling
 * a default, coercing a type — and rejecting those refused saves that no retry
 * could fix. Making a submitted key vanish is a different thing, and remains an
 * error even when the normalized submission and the saved record agree.
 */
export function applicationDeltaRetainsSubmittedKeys(submitted, canonical, input) {
  const roots = new Set()
  for (const operation of input?.operations ?? []) {
    const [root] = decodePointer(operation.path)
    if (root) roots.add(root)
  }
  for (const root of roots) {
    const submittedRoot = submitted?.[root]
    if (submittedRoot === undefined) continue
    if (!Object.hasOwn(canonical ?? {}, root)) return false
    if (!canonicalKeysRetained(submittedRoot, canonical?.[root], root)) return false
  }
  return true
}
